import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { readGraphDerivedEconomics } from "./economics-projection.ts";
import {
  createQualificationPolicy, createQualificationSuite, promptDigest,
  qualifySemanticProfile, type QualificationAgentProfile,
  type QualificationObservation, type QualificationPolicySnapshot,
  type QualificationSuiteSnapshot, type SemanticQualificationResult,
} from "./qualification.ts";

/**
 * One capability vocabulary, in two kinds that never borrow each other's
 * evidence.
 *
 * The repository had two vocabularies with no overlap and no join. Work packets
 * declare `modelCapability` across nine task classes -- typescript 22 times,
 * node-test 20, and so on -- while the catalogue describes models with
 * attachment, reasoning, structured-output, temperature and tool-call. Nothing
 * translated between them, so a capability a work unit required could only ever
 * be unmatched. It was never noticed because the dispatcher read a third
 * predicate, `requiredCapability`, which the graph does not contain at all: the
 * requirement was always empty, so the mismatch never surfaced as a refusal.
 *
 * The fix is not to merge the vocabularies. They answer different questions and
 * rest on different evidence:
 *
 *   - A **model feature** is an observation of catalogue metadata. It says what
 *     the model's API can do -- accept an attachment, emit structured output --
 *     and it is true or false before anyone calls it. The set is deliberately
 *     open: the catalogue defines it, it grows when models.dev adds a feature,
 *     and a closed list here would refuse every route the day that happened.
 *   - A **task class** is earned. It says this route answered the qualification
 *     suite well enough to be trusted with that kind of work, and it can only
 *     come from a stored qualification record bound to that exact route.
 *
 * Merging them would let a route claim `typescript` because the catalogue says
 * `reasoning`, which is precisely the false claim the ladder exists to prevent.
 * So both kinds live here, are matched separately, and a name belonging to
 * neither refuses rather than passing unmatched.
 */

/**
 * The model features this catalogue snapshot happens to carry, for reporting
 * and for tests. It is **not** an admission list: a name absent from it is
 * still treated as a model feature and matched against the model's own
 * catalogue entry, so a feature models.dev adds tomorrow needs no change here.
 */
export const observedModelFeatureCapabilities = Object.freeze([
  "attachment",
  "reasoning",
  "structured-output",
  "temperature",
  "tool-call",
] as const);

/**
 * Qualification-earned task classes. Closed: every value the graph's work
 * packets declare through `modelCapability`, so a packet can never name a task
 * class the vocabulary does not know.
 */
export const taskClassCapabilities = Object.freeze([
  "cli-design",
  "node-test",
  "process-lifecycle",
  "provider-routing",
  "rdf-semantics",
  "semantic-evaluation",
  "semantic-review",
  "technical-writing",
  "typescript",
] as const);

export type TaskClassCapability = (typeof taskClassCapabilities)[number];
export type CapabilityKind = "model-feature" | "task-class";

const taskClassSet: ReadonlySet<string> = new Set(taskClassCapabilities);

/**
 * Which vocabulary a capability name belongs to.
 *
 * Task classes are the closed half, so membership decides the kind and
 * everything else is a model feature. There is deliberately no third answer: a
 * name nothing advertises is a feature no model holds, which already refuses
 * every candidate under `CAPABILITY_MISSING`. Adding an `unknown` verdict on
 * top of a hardcoded feature list bought a nicer diagnostic and paid for it
 * with a list that would refuse the whole catalogue the first time models.dev
 * published a new feature name.
 */
export function capabilityKind(name: string): CapabilityKind {
  return taskClassSet.has(name) ? "task-class" : "model-feature";
}

/** A requirement split by the vocabulary each name belongs to. */
export interface CapabilityRequirementSplit {
  readonly modelFeatures: readonly string[];
  readonly taskClasses: readonly string[];
}

export function splitCapabilityRequirement(names: readonly string[]): CapabilityRequirementSplit {
  const modelFeatures: string[] = [];
  const taskClasses: string[] = [];
  for (const name of [...new Set(names)].sort()) {
    if (capabilityKind(name) === "task-class") taskClasses.push(name);
    else modelFeatures.push(name);
  }
  return Object.freeze({
    modelFeatures: Object.freeze(modelFeatures),
    taskClasses: Object.freeze(taskClasses),
  });
}

/** What one route can evidence, kept separate by the kind of evidence it is. */
export interface RouteCapabilityEvidence {
  /** Observed from catalogue metadata for this exact model. */
  readonly modelFeatures: readonly string[];
  /** Earned from stored qualification records bound to this exact route. */
  readonly qualifiedTaskClasses: readonly string[];
}

/**
 * What a route cannot satisfy, reported by kind so the caller can refuse under
 * the right reason. A missing feature and an unearned task class are different
 * failures: one is a property the model does not have, the other is work the
 * route has not yet been trusted with, and only the second is fixed by running
 * the qualification suite.
 */
export interface UnmetCapabilities {
  readonly missingModelFeatures: readonly string[];
  readonly unqualifiedTaskClasses: readonly string[];
}

export function unmetCapabilities(
  requirement: readonly string[],
  evidence: RouteCapabilityEvidence,
): UnmetCapabilities {
  const split = splitCapabilityRequirement(requirement);
  const held = new Set(evidence.modelFeatures);
  const earned = new Set(evidence.qualifiedTaskClasses);
  return Object.freeze({
    missingModelFeatures: Object.freeze(split.modelFeatures.filter((name) => !held.has(name))),
    unqualifiedTaskClasses: Object.freeze(split.taskClasses.filter((name) => !earned.has(name))),
  });
}

export function satisfiesCapabilities(
  requirement: readonly string[],
  evidence: RouteCapabilityEvidence,
): boolean {
  const unmet = unmetCapabilities(requirement, evidence);
  return unmet.missingModelFeatures.length === 0
    && unmet.unqualifiedTaskClasses.length === 0;
}

/**
 * The single implementation that decides which task classes a route has earned,
 * for the same reason `observeAvailableRoutes` is the single implementation of
 * observed availability: two implementations of one decision is the defect.
 *
 * A record counts only when the current suite and economics policy reproduce
 * its complete qualification result from sealed observations, and every
 * observation matches its exact content-addressed invocation record. It does
 * not expire merely because time passed.
 *
 * It used to expire after fifteen minutes. That number was not derived: the
 * commit that introduced the qualification policy set `validitySeconds` to 900
 * in the same change that set `probeFreshnessSeconds` to 900, and the decision
 * record justifies neither. Those are different kinds of fact. Probe freshness
 * asks whether a route is answering right now, which genuinely decays. A
 * qualification asks whether a model demonstrated competence at a task class,
 * which does not decay with the clock: a model does not become worse at
 * TypeScript because a quarter of an hour passed, a process restarted, an
 * account receipt aged or a provider rate-limited.
 *
 * What does invalidate it is a change of identity, and the routing replay has
 * decided it that way all along -- it compares the corpus, policy and effective
 * policy digests and the requested and actual route identity, and never once
 * consults the clock. This observer disagreed with it, and the repair is to
 * make the newer consumer agree with the established one rather than to invent
 * a third rule.
 *
 * There is deliberately no time parameter. Removing it is what makes wall-clock
 * expiry unrepresentable here instead of merely absent.
 */
export interface ObservedQualification {
  /** `provider:model` to the task classes it currently holds a role for. */
  readonly byRoute: ReadonlyMap<string, readonly string[]>;
  readonly recordCount: number;
  /** Records earned under suite, corpus, qualification or economics identities no longer in force. */
  readonly supersededCount: number;
  /** The identities admitted records were required to match. */
  readonly basis: Readonly<{
    suiteId: string; suiteVersion: string;
    suiteDigest: string; corpusDigest: string;
    qualificationPolicyDigest: string; effectivePolicyDigest: string;
  }>;
  readonly evaluated: true;
}

const qualificationDirectoryName = "qualifications";
const qualificationInvocationDirectoryName = "qualification-invocations";
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumQualificationRecordBytes = 1024 * 1024;
const maximumInvocationEvidenceBytes = 256 * 1024;

interface CurrentQualificationAuthority {
  readonly suite: QualificationSuiteSnapshot;
  readonly policy: QualificationPolicySnapshot;
  readonly effectivePolicyDigest: string;
}

interface StoredQualificationRecord {
  readonly schema: "urn:usf:qualification-record:1";
  readonly status: "ok";
  readonly role: string;
  readonly taskClass: string;
  readonly route: Readonly<{ readonly provider: string; readonly model: string }>;
  readonly qualificationDigest: string;
  readonly observationSetDigest: string;
  readonly observations: readonly QualificationObservation<string | null>[];
  readonly qualification: SemanticQualificationResult<string | null, string | null>;
}

const recordKeys = Object.freeze([
  "schema", "status", "role", "taskClass", "route", "qualificationDigest",
  "observationSetDigest", "observations", "qualification",
]);
const legacyInvocationEvidenceKeys = Object.freeze([
  "schema", "provider", "requestedModel", "actualModel", "transport",
  "adapterPackage", "adapterVersion", "adapterLockDigest", "suiteId",
  "suiteVersion", "caseId", "prompt", "answer", "startedAt", "completedAt",
  "latencyMs", "usage", "evidenceDigest",
]);
// Records written before the CLI branch did not carry an invocation identity.
// That exact old shape remains readable only for the API transport that wrote
// it. Every new shape, and every CLI record, must state the field as a bounded
// string or null so absence cannot be confused with an observed unknown.
const invocationEvidenceKeys = Object.freeze([
  ...legacyInvocationEvidenceKeys,
  "invocationIdentity",
]);
const qualificationObservationKeys = Object.freeze([
  "schema", "provider", "requestedModel", "actualModel", "transport",
  "adapterPackage", "adapterVersion", "adapterLockDigest", "caseId",
  "promptDigest", "answer", "answerDigest", "executionEvidenceDigest",
  "observedAt", "latencyMs", "usage", "observationDigest",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validInvocationIdentity(value: unknown): value is string | null {
  return value === null || (typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= 1_024
    && !/[\u0000-\u001f\u007f]/u.test(value));
}

function validUsageValue(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

async function readJsonFile(path: string, maximumBytes: number): Promise<unknown> {
  const metadata = await lstat(path).catch(() => undefined);
  if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()
    || metadata.nlink !== 1 || metadata.size === 0 || metadata.size > maximumBytes) return undefined;
  const bytes = await readFile(path).catch(() => undefined);
  const after = await lstat(path).catch(() => undefined);
  if (bytes === undefined || after === undefined || after.dev !== metadata.dev || after.ino !== metadata.ino
    || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs
    || bytes.byteLength !== metadata.size) return undefined;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { return undefined; }
}

async function readCurrentQualificationAuthority(
  repositoryRoot: string,
): Promise<CurrentQualificationAuthority | null> {
  try {
    const qualificationValue = await readJsonFile(
      resolve(repositoryRoot, "config/qualification.json"), maximumQualificationRecordBytes);
    if (!isRecord(qualificationValue)) return null;
    const suite = createQualificationSuite(
      qualificationValue.suite as Parameters<typeof createQualificationSuite>[0]);
    const policy = createQualificationPolicy(
      qualificationValue.policy as Parameters<typeof createQualificationPolicy>[0]);
    const economicsValue = await readJsonFile(
      resolve(repositoryRoot, "config/execution-economics.json"), maximumQualificationRecordBytes);
    const economics = readGraphDerivedEconomics(
      economicsValue,
      loadSemanticGraph(repositoryRoot, "graph/manifests/v3-convention.json"),
    );
    return Object.freeze({ suite, policy, effectivePolicyDigest: economics.closureDigest });
  } catch {
    return null;
  }
}

function qualificationProfile(
  result: SemanticQualificationResult<string | null, string | null>,
): QualificationAgentProfile<string | null> {
  const requested = result.profile.requested;
  return Object.freeze({
    schema: "urn:usf:agent-profile:1" as const,
    provider: requested.provider,
    requestedModel: requested.model,
    adapter: requested.adapter,
    adapterVersion: requested.adapterVersion,
    adapterLockDigest: requested.adapterLockDigest,
    authMode: requested.authMode,
    toolProfile: requested.toolProfile,
    toolProfileDigest: requested.toolProfileDigest,
    promptVersion: requested.promptVersion,
    promptDigest: requested.promptDigest,
    contextConfig: requested.contextConfig,
    contextConfigDigest: requested.contextConfigDigest,
    outputConfig: requested.outputConfig,
    outputConfigDigest: requested.outputConfigDigest,
  });
}

async function invocationEvidenceMatches(
  repositoryRoot: string,
  authority: CurrentQualificationAuthority,
  observations: readonly QualificationObservation<string | null>[],
): Promise<boolean> {
  const cases = new Map(authority.suite.corpus.cases.map((item) => [item.caseId, item]));
  const seen = new Set<string>();
  for (const observation of observations) {
    if (!isRecord(observation) || !exactKeys(observation, qualificationObservationKeys)
      || !digestPattern.test(observation.executionEvidenceDigest)
      || seen.has(observation.executionEvidenceDigest)) return false;
    seen.add(observation.executionEvidenceDigest);
    const evidenceValue = await readJsonFile(resolve(
      repositoryRoot, ".usf", qualificationInvocationDirectoryName,
      `${observation.executionEvidenceDigest.slice("sha256:".length)}.json`,
    ), maximumInvocationEvidenceBytes);
    if (!isRecord(evidenceValue)) return false;
    const currentEvidenceShape = exactKeys(evidenceValue, invocationEvidenceKeys);
    const legacyApiEvidenceShape = exactKeys(evidenceValue, legacyInvocationEvidenceKeys)
      && evidenceValue.transport === "vercel-ai-sdk";
    if (!currentEvidenceShape && !legacyApiEvidenceShape) return false;
    const { evidenceDigest, ...evidence } = evidenceValue;
    const item = cases.get(observation.caseId);
    const usage = isRecord(evidenceValue.usage) ? evidenceValue.usage : null;
    if (item === undefined
      || evidenceValue.schema !== "urn:usf:qualification-invocation-evidence:1"
      || (currentEvidenceShape && !validInvocationIdentity(evidenceValue.invocationIdentity))
      || evidenceDigest !== observation.executionEvidenceDigest
      || canonicalDigest(evidence, { rejectAbsolutePaths: true }) !== observation.executionEvidenceDigest
      || evidenceValue.provider !== observation.provider
      || evidenceValue.requestedModel !== observation.requestedModel
      || evidenceValue.actualModel !== observation.actualModel
      || evidenceValue.transport !== observation.transport
      || evidenceValue.adapterPackage !== observation.adapterPackage
      || evidenceValue.adapterVersion !== observation.adapterVersion
      || evidenceValue.adapterLockDigest !== observation.adapterLockDigest
      || evidenceValue.suiteId !== authority.suite.corpus.corpusId
      || evidenceValue.suiteVersion !== authority.suite.suiteVersion
      || evidenceValue.caseId !== observation.caseId
      || evidenceValue.prompt !== item.prompt
      || observation.promptDigest !== promptDigest(item.prompt)
      || evidenceValue.answer !== observation.answer
      || evidenceValue.completedAt !== observation.observedAt
      || evidenceValue.latencyMs !== observation.latencyMs
      || !validInstant(evidenceValue.startedAt)
      || !validInstant(evidenceValue.completedAt)
      || Date.parse(evidenceValue.completedAt) - Date.parse(evidenceValue.startedAt) !== observation.latencyMs
      || usage === null || !exactKeys(usage, ["inputTokens", "outputTokens", "totalTokens"])
      || Object.values(usage).some((value) => !validUsageValue(value))
      || usage?.inputTokens !== observation.usage.inputTokens
      || usage?.outputTokens !== observation.usage.outputTokens
      || usage?.totalTokens !== observation.usage.totalTokens) return false;
  }
  return true;
}

function currentInputs(
  result: SemanticQualificationResult<string | null, string | null>,
  authority: CurrentQualificationAuthority,
): boolean {
  return result.inputs.suiteDigest === authority.suite.suiteDigest
    && result.inputs.corpusDigest === authority.suite.corpusDigest
    && result.inputs.qualificationPolicyDigest === authority.policy.policyDigest
    && result.inputs.effectivePolicyDigest === authority.effectivePolicyDigest;
}

async function replayedRecordMatches(
  repositoryRoot: string,
  name: string,
  record: StoredQualificationRecord,
  authority: CurrentQualificationAuthority,
): Promise<boolean> {
  try {
    if (name !== `${record.qualificationDigest.slice("sha256:".length)}.json`
      || record.qualificationDigest !== record.qualification.qualificationDigest
      || record.observationSetDigest !== record.qualification.inputs.observationSetDigest
      || record.taskClass !== record.qualification.taskClass
      || record.role !== record.qualification.derivedRoles[0]
      || record.route.provider !== record.qualification.profile.actual.provider
      || record.route.model !== record.qualification.profile.requested.model) return false;
    const replayed = qualifySemanticProfile({
      profile: qualificationProfile(record.qualification),
      taskClass: record.taskClass,
      suite: authority.suite,
      policy: authority.policy,
      effectivePolicyDigest: authority.effectivePolicyDigest,
      observations: record.observations,
      evaluatedAt: record.qualification.evaluatedAt,
    });
    if (replayed.status !== "qualified"
      || replayed.derivedRoles[0] === "UNQUALIFIED"
      || replayed.qualificationDigest !== record.qualificationDigest
      || canonicalDigest(replayed, { rejectAbsolutePaths: true })
        !== canonicalDigest(record.qualification, { rejectAbsolutePaths: true })) return false;
    return invocationEvidenceMatches(repositoryRoot, authority, record.observations);
  } catch {
    return false;
  }
}

export async function observeQualifiedTaskClasses(
  repositoryRoot: string,
): Promise<ObservedQualification> {
  // The identities in force now. A record earned under a different suite,
  // corpus, qualification policy or execution-economics closure proved
  // something about a contract that has since changed.
  // Absent or unreadable authority admits nothing. There is no contract to bind
  // a record against, so every record becomes inadmissible rather than trusted,
  // and the result still reports itself as evaluated so an empty answer is not
  // mistaken for an unknown one.
  const authority = await readCurrentQualificationAuthority(repositoryRoot);
  const basis = authority === null ? Object.freeze({
    suiteId: "", suiteVersion: "", suiteDigest: "", corpusDigest: "",
    qualificationPolicyDigest: "", effectivePolicyDigest: "",
  }) : Object.freeze({
    suiteId: authority.suite.suiteId,
    suiteVersion: authority.suite.suiteVersion,
    suiteDigest: authority.suite.suiteDigest,
    corpusDigest: authority.suite.corpusDigest,
    qualificationPolicyDigest: authority.policy.policyDigest,
    effectivePolicyDigest: authority.effectivePolicyDigest,
  });

  const directory = resolve(repositoryRoot, ".usf", qualificationDirectoryName);
  const names = await readdir(directory).catch(() => [] as string[]);
  const byRoute = new Map<string, Set<string>>();
  let recordCount = 0;
  let supersededCount = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const value = await readJsonFile(resolve(directory, name), maximumQualificationRecordBytes);
    recordCount += 1;
    if (!isRecord(value) || !exactKeys(value, recordKeys)) continue;
    const record = value as unknown as StoredQualificationRecord;
    if (record.schema !== "urn:usf:qualification-record:1" || record.status !== "ok") continue;
    // UNQUALIFIED is the policy default and a recorded fact, not a capability.
    if (typeof record.role !== "string" || record.role === "UNQUALIFIED") continue;
    const taskClass = record.taskClass;
    // A stored file may not mint catalogue evidence: only a real task class
    // counts, so a record naming a model feature grants nothing.
    if (typeof taskClass !== "string" || capabilityKind(taskClass) !== "task-class") continue;
    if (!isRecord(record.route) || !exactKeys(record.route, ["provider", "model"])) continue;
    const provider = record.route.provider;
    const model = record.route.model;
    if (typeof provider !== "string" || typeof model !== "string") continue;
    // Earned under the contract still in force, decided the same way the routing
    // replay decides it. A record with no bound identity at all proved nothing
    // checkable and is refused rather than trusted.
    if (authority === null) continue;
    if (!isRecord(record.qualification) || !isRecord(record.qualification.inputs)
      || !Array.isArray(record.observations)) continue;
    if (!currentInputs(record.qualification, authority)) {
      supersededCount += 1;
      continue;
    }
    if (!await replayedRecordMatches(repositoryRoot, name, record, authority)) continue;
    const routeId = `${provider}:${model}`;
    const held = byRoute.get(routeId) ?? new Set<string>();
    held.add(taskClass);
    byRoute.set(routeId, held);
  }
  const frozen = new Map<string, readonly string[]>();
  for (const [routeId, held] of [...byRoute].sort(([left], [right]) => left.localeCompare(right))) {
    frozen.set(routeId, Object.freeze([...held].sort()));
  }
  return Object.freeze({
    byRoute: frozen,
    recordCount,
    supersededCount,
    basis,
    evaluated: true as const,
  });
}
