import { deriveLinearBindingDeclaration, LinearBindingError, type LinearBindingAuthority, type OwningModel } from "../graph/linear-binding.ts";
export { LinearBindingError, type LinearBindingAuthority, type OwningModel } from "../graph/linear-binding.ts";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, readdir, rename, unlink } from "node:fs/promises";
import { dirname, parse, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import { canonicalQuadDigest, canonicalQuadLine, parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import { loadSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import { deriveWork, type WorkPacket } from "../graph/work.ts";
import { assertBasisMatchesPacket, assertRealisationBasis, type RealisationBasis } from "../realisation/basis.ts";

const P = "urn:usf:predicate:";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const maximumRecordBytes = 4 * 1024 * 1024;

export type LinearAttemptState = "PREPARED" | "STARTED" | "REFUSED" | "SETTLED" | "UNKNOWN";

export interface LinearBindingSelector {
  readonly repositoryRoot: string;
  readonly manifestPath: string;
  readonly bindingIri: string;
}

export interface BoundSemanticWorkUnit {
  readonly schema: "urn:usf:bound-semantic-work-unit:1";
  readonly unitIri: string;
  readonly intentKey: `sha256:${string}`;
  readonly attemptKey: `sha256:${string}`;
  readonly bindingIri: string;
  readonly locator: string;
  readonly owner: OwningModel;
  readonly profile: string;
  readonly bindingManifestPath: string;
  readonly manifestPath: string;
  readonly workIri: string;
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly prompt: string;
  readonly maximumPromptTokens: number;
  readonly modelCapabilities: readonly string[];
  readonly packet: WorkPacket;
}

export interface LinearAttemptRecord {
  readonly schema: "urn:usf:linear-binding-attempt:1";
  readonly intentKey: `sha256:${string}`;
  readonly attemptKey: `sha256:${string}`;
  readonly unitIri: string;
  readonly bindingIri: string;
  readonly workIri: string;
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly state: LinearAttemptState;
  readonly executionResultIri: string | null;
  readonly executionResultDigest: string | null;
}

export interface PreparedLinearBinding {
  readonly selector: LinearBindingSelector;
  readonly authority: LinearBindingAuthority;
  readonly basis: RealisationBasis;
  readonly unit: BoundSemanticWorkUnit;
  readonly attempt: LinearAttemptRecord;
  readonly unitPath: string;
  readonly attemptPath: string;
}

export type GraphExecutionEvidenceDigest = `sha256:${string}`;

interface GraphExecutionEvidenceUnit {
  readonly unit: string;
  readonly sourceAssertionDigest: string;
  readonly requiredCapabilities: readonly string[];
  readonly candidatesConsidered: number;
  readonly attempts: readonly unknown[];
  readonly status: string;
  readonly selectedCandidateId: string | null;
  readonly transport: string | null;
  readonly actualModel: unknown;
  readonly invocationIdentity: string | null;
  readonly usage: object | null;
  readonly transportReportedCostUsd: unknown;
  readonly resultDigest: string | null;
  readonly resultText: string | null;
}

interface LinearIssueRecord {
  readonly locator: string;
  readonly basisDigest: string;
  readonly intentKey: string;
  readonly attemptKey: string;
  readonly bindingIri: string;
  readonly state: "STARTED" | "REFUSED" | "UNKNOWN" | "SETTLED";
}

interface GraphExecutionEvidence {
  readonly schema: string;
  readonly version: number;
  readonly status: string;
  readonly observedAt: string;
  readonly sourceGraph: string;
  readonly sourceGraphDigest: string;
  readonly economicsClosureDigest: string;
  readonly resultGraph: string;
  readonly resultGraphDigest: string;
  readonly workUnitCount: number;
  readonly declaredUnitCount: number;
  readonly dependencyEdgeCount: number;
  readonly dependencyAcyclic: boolean;
  readonly selectedUnits: readonly string[];
  readonly externallySatisfiedDependencies: readonly unknown[];
  readonly succeededCount: number;
  readonly authoritySnapshot: unknown;
  readonly catalogue: unknown;
  readonly concurrency: unknown;
  readonly localAgentDispositions: readonly unknown[];
  readonly units: readonly GraphExecutionEvidenceUnit[];
  readonly nonClaims: readonly string[];
  readonly deferredRouteCount: number;
}

export type LinearBindingResult =
  | { readonly status: "PREPARED" | "STARTED" | "REFUSED" | "SETTLED" | "UNKNOWN"; readonly binding: PreparedLinearBinding }
  | { readonly status: "COMPLETED"; readonly binding: PreparedLinearBinding; readonly integrationReceipt: string; readonly evidence: string; readonly proofResult: string };

function refuse(reasonCode: string): never { throw new LinearBindingError(reasonCode); }
function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}
function assertSelector(value: LinearBindingSelector): void {
  if (!value || typeof value !== "object" || !exactKeys(value, ["repositoryRoot", "manifestPath", "bindingIri"])) refuse("LINEAR_BINDING_CALLER_AUTHORITY_REFUSED");
  if (typeof value.repositoryRoot !== "string" || typeof value.manifestPath !== "string" || typeof value.bindingIri !== "string" || !value.bindingIri.startsWith("urn:")) refuse("LINEAR_BINDING_SELECTOR_INVALID");
}
function derivePacket(graph: SemanticGraph, authority: LinearBindingAuthority): WorkPacket {
  const result = deriveWork(graph, { selector: authority.workIri, profile: authority.profile });
  if (result.status !== "ok") refuse(result.reasonCode ?? "LINEAR_BINDING_WORK_INACTIVE");
  if (result.items?.length !== 1 || result.items[0]?.id !== authority.workIri) refuse("LINEAR_BINDING_WORK_MISSING");
  const packet = result.items[0];
  if (packet.realisationBasis === undefined || packet.eligibility === undefined || packet.realisationStage === undefined) refuse("LINEAR_BINDING_WORK_INACTIVE");
  assertRealisationBasis(packet.realisationBasis);
  assertBasisMatchesPacket(packet.realisationBasis, packet);
  if (packet.realisationBasis.selection.profile !== authority.profile || packet.realisationBasis.selection.manifestPath !== authority.targetManifest) refuse("LINEAR_BINDING_AUTHORITY_MISMATCH");
  if (packet.realisationBasis.work.scopedDependencyDigest !== packet.scopedDependencyDigest) refuse("LINEAR_BINDING_BASIS_NONCURRENT");
  if (packet.realisationStage.completion.verified !== true && packet.eligibility.construction.eligible !== true) refuse("LINEAR_BINDING_WORK_INACTIVE");
  return packet;
}
function promptFor(packet: WorkPacket, fixedPrompt: string): string {
  return canonicalJson({
    fixedPrompt,
    objective: packet.objective,
    requirements: packet.requirements,
    readSet: packet.readSet,
    writeSet: packet.writeSet,
    validationPlan: packet.validationPlan,
    proofObligations: packet.proofObligations,
    constraints: packet.constraints,
  }, { rejectAbsolutePaths: true });
}
function records(authority: LinearBindingAuthority, packet: WorkPacket, bindingManifestPath: string): { unit: BoundSemanticWorkUnit; attempt: LinearAttemptRecord } {
  const basis = packet.realisationBasis!;
  const intentKey = canonicalDigest({
    locator: authority.locator,
    owner: authority.owner,
    profile: authority.profile,
    manifestPath: authority.targetManifest,
    workIri: authority.workIri,
    fixedPrompt: authority.fixedPrompt,
    maximumPromptTokens: authority.maximumPromptTokens,
    supersedes: authority.supersedes,
  });
  const attemptKey = canonicalDigest({ intentKey, basisDigest: basis.basisDigest, scopedDependencyDigest: packet.scopedDependencyDigest });
  const unitIri = `urn:usf:work-unit:${attemptKey}`;
  const prompt = promptFor(packet, authority.fixedPrompt);
  if (Buffer.byteLength(prompt, "utf8") > authority.maximumPromptTokens) refuse("LINEAR_BINDING_PROMPT_POLICY_INVALID");
  const unit: BoundSemanticWorkUnit = Object.freeze({
    schema: "urn:usf:bound-semantic-work-unit:1",
    unitIri,
    intentKey,
    attemptKey,
    bindingIri: authority.bindingIri,
    locator: authority.locator,
    owner: authority.owner,
    profile: authority.profile,
    bindingManifestPath,
    manifestPath: authority.targetManifest,
    workIri: packet.id,
    basisDigest: basis.basisDigest,
    scopedDependencyDigest: packet.scopedDependencyDigest,
    prompt,
    maximumPromptTokens: authority.maximumPromptTokens,
    modelCapabilities: Object.freeze([...packet.modelCapabilities]),
    packet,
  });
  const attempt: LinearAttemptRecord = Object.freeze({
    schema: "urn:usf:linear-binding-attempt:1",
    intentKey,
    attemptKey,
    unitIri,
    bindingIri: authority.bindingIri,
    workIri: packet.id,
    basisDigest: basis.basisDigest,
    scopedDependencyDigest: packet.scopedDependencyDigest,
    state: "PREPARED",
    executionResultIri: null,
    executionResultDigest: null,
  });
  return { unit, attempt };
}
function sha256Text(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function semanticWorkUnitGraph(unit: BoundSemanticWorkUnit): string {
  const graph = `urn:usf:graph:hermes-input:${unit.attemptKey}`;
  const values: ReadonlyArray<readonly [string, string, "iri" | "literal"]> = [
    ["type", "urn:usf:type:SemanticWorkUnit", "iri"],
    ["attemptKey", unit.attemptKey, "literal"],
    ["intentKey", unit.intentKey, "literal"],
    ["bindingIri", unit.bindingIri, "iri"],
    ["workIri", unit.workIri, "iri"],
    ["basisDigest", unit.basisDigest, "literal"],
    ["scopedDependencyDigest", unit.scopedDependencyDigest, "literal"],
    ["owningModel", unit.owner, "literal"],
    ["selectedProfile", unit.profile, "iri"],
    ["bindingManifestPath", unit.bindingManifestPath, "literal"],
    ["targetManifest", unit.manifestPath, "literal"],
    ["prompt", unit.prompt, "literal"],
    ["maximumPromptTokens", String(unit.maximumPromptTokens), "literal"],
    ...unit.modelCapabilities.map((capability) => ["modelCapability", capability, capability.startsWith("urn:") ? "iri" : "literal"] as const),
  ];
  const lines = values.map(([predicate, object, objectKind]) => canonicalQuadLine({
    subject: unit.unitIri,
    predicate: `${P}${predicate}`,
    object,
    objectKind,
    graph,
    canonical: "",
  } satisfies Quad)).sort();
  return `${lines.join("\n")}\n`;
}
async function validateDirectoryAncestry(path: string, permitAbsent = false): Promise<boolean> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  let absent = false;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (absent) continue;
    let entry;
    try { entry = await lstat(current); }
    catch (error) {
      if (permitAbsent && (error as NodeJS.ErrnoException).code === "ENOENT") { absent = true; continue; }
      refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
  }
  return !absent;
}
async function secureDirectory(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try { await mkdir(current, { mode: privateDirectoryMode }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
    }
    const entry = await lstat(current).catch(() => refuse("LINEAR_BINDING_RUNTIME_UNSAFE"));
    if (!entry.isDirectory() || entry.isSymbolicLink()) refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
  }
  const entry = await lstat(absolute);
  if ((entry.mode & 0o077) !== 0) refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
}
async function readTextRecord(path: string): Promise<string | null> {
  if (!await validateDirectoryAncestry(dirname(path), true)) return null;
  let handle;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
  }
  try {
    const entry = await handle.stat();
    if (!entry.isFile() || entry.nlink !== 1 || (entry.mode & 0o077) !== 0 || entry.size > maximumRecordBytes) refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}
async function readRecord<T>(path: string): Promise<T | null> {
  const text = await readTextRecord(path);
  if (text === null) return null;
  try { return JSON.parse(text) as T; }
  catch { refuse("LINEAR_BINDING_RECORD_INVALID"); }
}
async function durableBytes(path: string, bytes: string, replace: boolean): Promise<void> {
  await secureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), privateFileMode);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (replace) {
      await rename(temporary, path);
    } else {
      await link(temporary, path);
      await unlink(temporary);
    }
  } catch (error) {
    if (!replace && (error as NodeJS.ErrnoException).code === "EEXIST") refuse("LINEAR_BINDING_RECORD_EXISTS");
    refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
  const directory = await open(dirname(path), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await directory.sync(); } finally { await directory.close(); }
}
async function durableWrite(path: string, value: unknown, replace: boolean): Promise<void> {
  await durableBytes(path, `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`, replace);
}
function validAttempt(value: unknown, expected: LinearAttemptRecord): value is LinearAttemptRecord {
  if (!value || typeof value !== "object" || !exactKeys(value, ["schema", "intentKey", "attemptKey", "unitIri", "bindingIri", "workIri", "basisDigest", "scopedDependencyDigest", "state", "executionResultIri", "executionResultDigest"])) return false;
  const record = value as LinearAttemptRecord;
  const unsettled = record.state === "PREPARED" || record.state === "STARTED" || record.state === "UNKNOWN";
  const refused = record.state === "REFUSED";
  const settled = record.state === "SETTLED";
  const validResultPair = unsettled
    ? record.executionResultIri === null && record.executionResultDigest === null
    : refused
      ? typeof record.executionResultIri === "string" && record.executionResultIri.startsWith("urn:usf:graph-execution-evidence:") && typeof record.executionResultDigest === "string" && DIGEST.test(record.executionResultDigest)
    : settled && typeof record.executionResultIri === "string" && record.executionResultIri.startsWith("urn:") && typeof record.executionResultDigest === "string" && DIGEST.test(record.executionResultDigest);
  return record.schema === expected.schema && record.intentKey === expected.intentKey && record.attemptKey === expected.attemptKey && record.unitIri === expected.unitIri && record.bindingIri === expected.bindingIri && record.workIri === expected.workIri && record.basisDigest === expected.basisDigest && record.scopedDependencyDigest === expected.scopedDependencyDigest && validResultPair;
}
function validIssueRecord(value: unknown): value is LinearIssueRecord {
  if (!value || typeof value !== "object" || !exactKeys(value, ["locator", "basisDigest", "intentKey", "attemptKey", "bindingIri", "state"])) return false;
  const record = value as LinearIssueRecord;
  return typeof record.locator === "string" && typeof record.basisDigest === "string" && DIGEST.test(record.basisDigest) && typeof record.intentKey === "string" && DIGEST.test(record.intentKey) && typeof record.attemptKey === "string" && DIGEST.test(record.attemptKey) && typeof record.bindingIri === "string" && record.bindingIri.startsWith("urn:") && ["STARTED", "REFUSED", "UNKNOWN", "SETTLED"].includes(record.state);
}
function issueRecordPath(binding: PreparedLinearBinding): string {
  const issueKey = canonicalDigest({ locator: binding.authority.locator });
  return resolve(binding.selector.repositoryRoot, `.usf/work/linear/issues/${issueKey.slice(7)}.json`);
}
async function recoverStaleRefusedIssue(binding: PreparedLinearBinding, issue: LinearIssueRecord): Promise<boolean> {
  if (issue.state !== "STARTED"
    || issue.locator !== binding.authority.locator
    || issue.bindingIri !== binding.authority.bindingIri
    || issue.intentKey !== binding.unit.intentKey
    || issue.attemptKey === binding.unit.attemptKey) return false;
  const oldAttemptPath = resolve(binding.selector.repositoryRoot, `.usf/work/linear/${issue.intentKey.slice(7)}/${issue.attemptKey.slice(7)}.json`);
  const oldAttempt = await readRecord<LinearAttemptRecord>(oldAttemptPath);
  if (oldAttempt === null
    || !exactKeys(oldAttempt, ["schema", "intentKey", "attemptKey", "unitIri", "bindingIri", "workIri", "basisDigest", "scopedDependencyDigest", "state", "executionResultIri", "executionResultDigest"])
    || oldAttempt.schema !== "urn:usf:linear-binding-attempt:1"
    || oldAttempt.intentKey !== issue.intentKey
    || oldAttempt.attemptKey !== issue.attemptKey
    || oldAttempt.unitIri !== `urn:usf:work-unit:${issue.attemptKey}`
    || oldAttempt.bindingIri !== binding.authority.bindingIri
    || oldAttempt.workIri !== binding.authority.workIri
    || oldAttempt.basisDigest !== issue.basisDigest
    || !DIGEST.test(oldAttempt.scopedDependencyDigest)
    || oldAttempt.state !== "STARTED"
    || oldAttempt.executionResultIri !== null
    || oldAttempt.executionResultDigest !== null) return false;
  const oldUnit = Object.freeze({
    ...binding.unit,
    unitIri: oldAttempt.unitIri,
    attemptKey: oldAttempt.attemptKey,
    basisDigest: oldAttempt.basisDigest,
    scopedDependencyDigest: oldAttempt.scopedDependencyDigest,
  });
  const oldBinding = Object.freeze({
    ...binding,
    unit: oldUnit,
    attempt: oldAttempt,
    unitPath: `.usf/work/${oldAttempt.attemptKey.slice(7)}.nq`,
    attemptPath: `.usf/work/linear/${oldAttempt.intentKey.slice(7)}/${oldAttempt.attemptKey.slice(7)}.json`,
  });
  const refusalDigest = await latestRefusedEvidence(oldBinding);
  if (refusalDigest === null) return false;
  const refused = Object.freeze({
    ...oldAttempt,
    state: "REFUSED" as const,
    executionResultIri: `urn:usf:graph-execution-evidence:${refusalDigest}`,
    executionResultDigest: refusalDigest,
  });
  await durableWrite(oldAttemptPath, refused, true);
  await durableWrite(issueRecordPath(binding), { ...issue, state: "REFUSED" }, true);
  return true;
}
async function freshlyDerived(selector: LinearBindingSelector): Promise<PreparedLinearBinding> {
  assertSelector(selector);
  const repositoryRoot = await realpath(selector.repositoryRoot).catch(() => refuse("LINEAR_BINDING_REPOSITORY_UNREADABLE"));
  const bindingGraph = loadSemanticGraph(repositoryRoot, selector.manifestPath);
  const authority = deriveLinearBindingDeclaration(bindingGraph, selector.bindingIri);
  const workGraph = loadSemanticGraph(repositoryRoot, authority.targetManifest);
  const packet = derivePacket(workGraph, authority);
  const { unit, attempt } = records(authority, packet, selector.manifestPath);
  const unitPath = `.usf/work/${unit.attemptKey.slice(7)}.nq`;
  const attemptPath = `.usf/work/linear/${unit.intentKey.slice(7)}/${unit.attemptKey.slice(7)}.json`;
  return Object.freeze({ selector: Object.freeze({ ...selector, repositoryRoot }), authority, basis: packet.realisationBasis!, unit, attempt, unitPath, attemptPath });
}
function completion(binding: PreparedLinearBinding): LinearBindingResult | null {
  const value = binding.unit.packet.realisationStage?.completion;
  if (value?.verified !== true || value.integrationReceipt === null || value.evidence === null || value.proofResult === null) return null;
  return Object.freeze({ status: "COMPLETED", binding, integrationReceipt: value.integrationReceipt, evidence: value.evidence, proofResult: value.proofResult });
}
async function reconcile(binding: PreparedLinearBinding): Promise<LinearBindingResult> {
  const attemptPath = resolve(binding.selector.repositoryRoot, binding.attemptPath);
  const prior = await readRecord<LinearAttemptRecord>(attemptPath);
  if (prior === null) {
    const unitPath = resolve(binding.selector.repositoryRoot, binding.unitPath);
    const graph = semanticWorkUnitGraph(binding.unit);
    try { await durableBytes(unitPath, graph, false); }
    catch (error) {
      if (!(error instanceof LinearBindingError) || error.reasonCode !== "LINEAR_BINDING_RECORD_EXISTS") throw error;
      if (await readTextRecord(unitPath) !== graph) refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
    }
    try { await durableWrite(attemptPath, binding.attempt, false); }
    catch (error) {
      if (!(error instanceof LinearBindingError) || error.reasonCode !== "LINEAR_BINDING_RECORD_EXISTS") throw error;
      const raced = await readRecord<LinearAttemptRecord>(attemptPath);
      if (raced === null || !validAttempt(raced, binding.attempt)) refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
      return Object.freeze({ status: raced.state, binding: Object.freeze({ ...binding, attempt: Object.freeze(raced) }) });
    }
    return Object.freeze({ status: "PREPARED", binding });
  }
  if (!validAttempt(prior, binding.attempt)) refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
  const current = Object.freeze({ ...binding, attempt: Object.freeze(prior) });
  return Object.freeze({ status: prior.state, binding: current });
}

export async function prepareLinearBinding(selector: LinearBindingSelector): Promise<LinearBindingResult> {
  const binding = await freshlyDerived(selector);
  const accepted = completion(binding);
  if (accepted !== null) return accepted;
  const issue = await readRecord<LinearIssueRecord>(issueRecordPath(binding));
  if (issue !== null) {
    if (!validIssueRecord(issue)) refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
    if (issue.state === "STARTED" || issue.state === "REFUSED" || issue.state === "UNKNOWN") {
      const mismatchedAttempt = issue.intentKey !== binding.unit.intentKey || issue.attemptKey !== binding.unit.attemptKey;
      const recovered = mismatchedAttempt ? await recoverStaleRefusedIssue(binding, issue) : false;
      if (mismatchedAttempt && !recovered && issue.state !== "REFUSED") refuse("LINEAR_BINDING_OUTCOME_UNKNOWN");
      if (!mismatchedAttempt && (issue.locator !== binding.authority.locator || issue.basisDigest !== binding.unit.basisDigest || issue.bindingIri !== binding.authority.bindingIri)) refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
    }
  }
  return reconcile(binding);
}

export async function beforeHermesDispatch(selector: LinearBindingSelector): Promise<LinearBindingResult> {
  const binding = await freshlyDerived(selector);
  const accepted = completion(binding);
  if (accepted !== null) return accepted;
  const observed = await reconcile(binding);
  if (observed.status === "STARTED" || observed.status === "UNKNOWN") {
    const unknown = Object.freeze({ ...observed.binding.attempt, state: "UNKNOWN" as const });
    if (observed.status === "STARTED") {
      const refusalDigest = await latestRefusedEvidence(observed.binding);
      if (refusalDigest !== null) {
        await afterHermesRefusal(selector, refusalDigest);
        return beforeHermesDispatch(selector);
      }
      await durableWrite(resolve(binding.selector.repositoryRoot, binding.attemptPath), unknown, true);
      const issueKey = canonicalDigest({ locator: binding.authority.locator });
      const dispatchPath = resolve(binding.selector.repositoryRoot, `.usf/work/linear/issues/${issueKey.slice(7)}.json`);
      const dispatch = await readRecord<Record<string, unknown>>(dispatchPath);
      if (dispatch === null || dispatch.intentKey !== binding.unit.intentKey || dispatch.attemptKey !== binding.unit.attemptKey || dispatch.state !== "STARTED") refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
      await durableWrite(dispatchPath, { ...dispatch, state: "UNKNOWN" }, true);
    }
    return Object.freeze({ status: "UNKNOWN", binding: Object.freeze({ ...binding, attempt: unknown }) });
  }
  if (observed.status === "SETTLED") return observed;
  const issueKey = canonicalDigest({ locator: binding.authority.locator });
  const dispatchPath = resolve(binding.selector.repositoryRoot, `.usf/work/linear/issues/${issueKey.slice(7)}.json`);
  const dispatch = Object.freeze({ locator: binding.authority.locator, basisDigest: binding.unit.basisDigest, intentKey: binding.unit.intentKey, attemptKey: binding.unit.attemptKey, bindingIri: binding.authority.bindingIri, state: "STARTED" as const });
  const priorDispatch = await readRecord<Record<string, unknown>>(dispatchPath);
  if (priorDispatch !== null) {
    if (!exactKeys(priorDispatch, ["locator", "basisDigest", "intentKey", "attemptKey", "bindingIri", "state"]) || priorDispatch.locator !== binding.authority.locator || typeof priorDispatch.basisDigest !== "string" || !DIGEST.test(priorDispatch.basisDigest) || typeof priorDispatch.intentKey !== "string" || !DIGEST.test(priorDispatch.intentKey) || typeof priorDispatch.attemptKey !== "string" || !DIGEST.test(priorDispatch.attemptKey) || typeof priorDispatch.bindingIri !== "string" || typeof priorDispatch.state !== "string" || !["STARTED", "REFUSED", "UNKNOWN", "SETTLED"].includes(priorDispatch.state)) refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
    if (priorDispatch.state !== "SETTLED" && priorDispatch.state !== "REFUSED") refuse("LINEAR_BINDING_REDISPATCH_REFUSED");
    if (priorDispatch.state === "SETTLED" && (priorDispatch.intentKey === binding.unit.intentKey || binding.authority.supersedes !== priorDispatch.bindingIri)) refuse("LINEAR_BINDING_SUPERSESSION_REQUIRED");
    await durableWrite(dispatchPath, dispatch, true);
  } else {
    try { await durableWrite(dispatchPath, dispatch, false); }
    catch (error) {
      if (error instanceof LinearBindingError && error.reasonCode === "LINEAR_BINDING_RECORD_EXISTS") refuse("LINEAR_BINDING_REDISPATCH_REFUSED");
      throw error;
    }
  }
  const started = Object.freeze({ ...binding.attempt, state: "STARTED" as const });
  await durableWrite(resolve(binding.selector.repositoryRoot, binding.attemptPath), started, true);
  return Object.freeze({ status: "STARTED", binding: Object.freeze({ ...binding, attempt: started }) });
}

function refusalEvidenceMatches(binding: PreparedLinearBinding, evidenceDigest: GraphExecutionEvidenceDigest, evidence: GraphExecutionEvidence, assertionDigest: string): boolean {
  const unit = evidence.units[0];
  return canonicalDigest(evidence) === evidenceDigest
    && evidence.schema === "urn:usf:graph-execution-evidence:1"
    && evidence.version === 1
    && evidence.status === "refused"
    && typeof evidence.observedAt === "string"
    && evidence.sourceGraph === `urn:usf:graph:hermes-input:${binding.unit.attemptKey}`
    && DIGEST.test(evidence.sourceGraphDigest)
    && DIGEST.test(evidence.economicsClosureDigest)
    && typeof evidence.resultGraph === "string"
    && evidence.resultGraph.startsWith("urn:")
    && DIGEST.test(evidence.resultGraphDigest)
    && evidence.workUnitCount === 1
    && evidence.declaredUnitCount === 1
    && Number.isSafeInteger(evidence.dependencyEdgeCount)
    && evidence.dependencyAcyclic === true
    && Array.isArray(evidence.selectedUnits)
    && evidence.selectedUnits.includes(binding.unit.unitIri)
    && evidence.succeededCount === 0
    && Array.isArray(evidence.units)
    && evidence.units.length === 1
    && unit !== undefined
    && unit.unit === binding.unit.unitIri
    && unit.sourceAssertionDigest === assertionDigest
    && Array.isArray(unit.requiredCapabilities)
    && unit.requiredCapabilities.every((value: unknown) => typeof value === "string")
    && Number.isSafeInteger(unit.candidatesConsidered)
    && unit.candidatesConsidered >= 1
    && Array.isArray(unit.attempts)
    && unit.status === "refused"
    && unit.selectedCandidateId === null
    && unit.transport === null
    && unit.actualModel === null
    && unit.invocationIdentity === null
    && (unit.usage === null || (typeof unit.usage === "object" && !Array.isArray(unit.usage)))
    && unit.resultDigest === null
    && unit.resultText === null;
}

async function latestRefusedEvidence(binding: PreparedLinearBinding): Promise<GraphExecutionEvidenceDigest | null> {
  const directory = resolve(binding.selector.repositoryRoot, ".usf", "graph-executions");
  if (!await validateDirectoryAncestry(directory, true)) return null;
  const graphText = await readTextRecord(resolve(binding.selector.repositoryRoot, binding.unitPath));
  if (graphText !== semanticWorkUnitGraph(binding.unit)) return null;
  const assertionDigest = canonicalQuadDigest(parseStrictNQuads(graphText, `urn:usf:graph:hermes-input:${binding.unit.attemptKey}`));
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    refuse("LINEAR_BINDING_RUNTIME_UNSAFE");
  });
  const candidates: Array<{ digest: GraphExecutionEvidenceDigest; observedAt: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/u.test(entry.name)) continue;
    const digest = `sha256:${entry.name.slice(0, -5)}` as GraphExecutionEvidenceDigest;
    try {
      const evidence = await readRecord<GraphExecutionEvidence>(resolve(directory, entry.name));
      if (evidence !== null && refusalEvidenceMatches(binding, digest, evidence, assertionDigest)) candidates.push({ digest, observedAt: evidence.observedAt });
    } catch { /* malformed evidence is not a retry authority */ }
  }
  candidates.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.digest.localeCompare(right.digest));
  return candidates.at(-1)?.digest ?? null;
}

export async function afterHermesRefusal(selector: LinearBindingSelector, evidenceDigest: GraphExecutionEvidenceDigest): Promise<LinearBindingResult> {
  if (typeof evidenceDigest !== "string" || !DIGEST.test(evidenceDigest)) refuse("LINEAR_BINDING_RESULT_INVALID");
  const binding = await freshlyDerived(selector);
  const prior = await readRecord<LinearAttemptRecord>(resolve(binding.selector.repositoryRoot, binding.attemptPath));
  if (prior === null || !validAttempt(prior, binding.attempt) || prior.state === "PREPARED") refuse("LINEAR_BINDING_RESULT_UNKNOWN");
  const evidence = await readRecord<GraphExecutionEvidence>(resolve(binding.selector.repositoryRoot, `.usf/graph-executions/${evidenceDigest.slice(7)}.json`));
  const graphText = await readTextRecord(resolve(binding.selector.repositoryRoot, binding.unitPath));
  if (graphText === null || graphText !== semanticWorkUnitGraph(binding.unit)) refuse("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH");
  const assertionDigest = canonicalQuadDigest(parseStrictNQuads(graphText, `urn:usf:graph:hermes-input:${binding.unit.attemptKey}`));
  if (evidence === null || !refusalEvidenceMatches(binding, evidenceDigest, evidence, assertionDigest)) refuse("LINEAR_BINDING_RESULT_INVALID");
  const executionResultIri = `urn:usf:graph-execution-evidence:${evidenceDigest}`;
  if (prior.state === "REFUSED" && (prior.executionResultIri !== executionResultIri || prior.executionResultDigest !== evidenceDigest)) refuse("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH");
  const dispatchPath = issueRecordPath(binding);
  const dispatch = await readRecord<LinearIssueRecord>(dispatchPath);
  if (dispatch === null || !validIssueRecord(dispatch) || dispatch.locator !== binding.authority.locator || dispatch.basisDigest !== binding.unit.basisDigest || dispatch.intentKey !== binding.unit.intentKey || dispatch.attemptKey !== binding.unit.attemptKey || dispatch.bindingIri !== binding.authority.bindingIri || (dispatch.state !== "STARTED" && dispatch.state !== "REFUSED")) refuse("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH");
  const refused = Object.freeze({ ...prior, state: "REFUSED" as const, executionResultIri, executionResultDigest: evidenceDigest });
  if (prior.state !== "REFUSED") await durableWrite(resolve(binding.selector.repositoryRoot, binding.attemptPath), refused, true);
  if (dispatch.state !== "REFUSED") await durableWrite(dispatchPath, { ...dispatch, state: "REFUSED" }, true);
  return Object.freeze({ status: "REFUSED", binding: Object.freeze({ ...binding, attempt: refused }) });
}

export async function afterHermesResult(selector: LinearBindingSelector, evidenceDigest: GraphExecutionEvidenceDigest): Promise<LinearBindingResult> {
  if (typeof evidenceDigest !== "string" || !DIGEST.test(evidenceDigest)) refuse("LINEAR_BINDING_RESULT_INVALID");
  const binding = await freshlyDerived(selector);
  const prior = await readRecord<LinearAttemptRecord>(resolve(binding.selector.repositoryRoot, binding.attemptPath));
  if (prior === null || !validAttempt(prior, binding.attempt) || prior.state === "PREPARED") refuse("LINEAR_BINDING_RESULT_UNKNOWN");
  const evidence = await readRecord<GraphExecutionEvidence>(resolve(binding.selector.repositoryRoot, `.usf/graph-executions/${evidenceDigest.slice(7)}.json`));
  if (evidence === null || canonicalDigest(evidence) !== evidenceDigest || evidence.schema !== "urn:usf:graph-execution-evidence:1" || evidence.version !== 1 || evidence.status !== "ok" || typeof evidence.observedAt !== "string" || typeof evidence.sourceGraph !== "string" || !evidence.sourceGraph.startsWith("urn:") || !DIGEST.test(evidence.sourceGraphDigest) || !DIGEST.test(evidence.economicsClosureDigest) || typeof evidence.resultGraph !== "string" || !evidence.resultGraph.startsWith("urn:") || !DIGEST.test(evidence.resultGraphDigest) || !Number.isSafeInteger(evidence.workUnitCount) || !Number.isSafeInteger(evidence.declaredUnitCount) || !Number.isSafeInteger(evidence.dependencyEdgeCount) || evidence.dependencyAcyclic !== true || !Array.isArray(evidence.selectedUnits) || !evidence.selectedUnits.every((value: unknown) => typeof value === "string") || !Array.isArray(evidence.externallySatisfiedDependencies) || !Number.isSafeInteger(evidence.succeededCount) || !Array.isArray(evidence.units) || evidence.units.length !== 1) refuse("LINEAR_BINDING_RESULT_INVALID");
  const unit = evidence.units[0];
  if (unit === undefined || !unit || typeof unit !== "object" || typeof unit.unit !== "string" || !unit.unit.startsWith("urn:") || !DIGEST.test(unit.sourceAssertionDigest) || !Array.isArray(unit.requiredCapabilities) || !unit.requiredCapabilities.every((value: unknown) => typeof value === "string") || !Number.isSafeInteger(unit.candidatesConsidered) || unit.candidatesConsidered < 1 || !Array.isArray(unit.attempts) || unit.status !== "ok" || typeof unit.selectedCandidateId !== "string" || unit.selectedCandidateId.length === 0 || typeof unit.transport !== "string" || unit.transport.length === 0 || (unit.invocationIdentity !== null && typeof unit.invocationIdentity !== "string") || (unit.usage !== null && (typeof unit.usage !== "object" || Array.isArray(unit.usage))) || !DIGEST.test(unit.resultDigest) || typeof unit.resultText !== "string" || canonicalDigest(unit.resultText) !== unit.resultDigest) refuse("LINEAR_BINDING_RESULT_INVALID");
  const graphText = await readTextRecord(resolve(binding.selector.repositoryRoot, binding.unitPath));
  const expectedGraph = semanticWorkUnitGraph(binding.unit);
  const expectedGraphIri = `urn:usf:graph:hermes-input:${binding.unit.attemptKey}`;
  let assertionDigest: string;
  try { assertionDigest = canonicalQuadDigest(parseStrictNQuads(graphText ?? "", expectedGraphIri)); }
  catch { refuse("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH"); }
  if (graphText !== expectedGraph || evidence.sourceGraph !== expectedGraphIri || evidence.sourceGraphDigest !== assertionDigest || unit.sourceAssertionDigest !== assertionDigest || unit.unit !== binding.unit.unitIri || evidence.workUnitCount !== 1 || evidence.declaredUnitCount !== 1 || evidence.succeededCount !== 1 || !evidence.selectedUnits.includes(binding.unit.unitIri)) refuse("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH");
  const executionResultIri = `urn:usf:graph-execution-evidence:${evidenceDigest}`;
  if (prior.state === "SETTLED" && (prior.executionResultIri !== executionResultIri || prior.executionResultDigest !== unit.resultDigest)) refuse("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH");
  const settled = Object.freeze({ ...prior, state: "SETTLED" as const, executionResultIri, executionResultDigest: unit.resultDigest });
  const dispatchPath = issueRecordPath(binding);
  const dispatch = await readRecord<LinearIssueRecord>(dispatchPath);
  if (dispatch === null || !validIssueRecord(dispatch) || dispatch.locator !== binding.authority.locator || dispatch.basisDigest !== binding.unit.basisDigest || dispatch.intentKey !== binding.unit.intentKey || dispatch.attemptKey !== binding.unit.attemptKey || dispatch.bindingIri !== binding.authority.bindingIri) refuse("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH");
  if (prior.state !== "SETTLED" && dispatch.state === "SETTLED") refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
  if (prior.state !== "SETTLED") await durableWrite(resolve(binding.selector.repositoryRoot, binding.attemptPath), settled, true);
  if (dispatch.state !== "SETTLED") await durableWrite(dispatchPath, { ...dispatch, state: "SETTLED" }, true);
  return Object.freeze({ status: "SETTLED", binding: Object.freeze({ ...binding, attempt: settled }) });
}

export async function observeLinearBinding(selector: LinearBindingSelector): Promise<LinearBindingResult> {
  const binding = await freshlyDerived(selector);
  const accepted = completion(binding);
  if (accepted !== null) return accepted;
  const prior = await readRecord<LinearAttemptRecord>(resolve(binding.selector.repositoryRoot, binding.attemptPath));
  if (prior === null) return Object.freeze({ status: "PREPARED", binding });
  if (!validAttempt(prior, binding.attempt)) refuse("LINEAR_BINDING_ATTEMPT_CONFLICT");
  return Object.freeze({ status: prior.state, binding: Object.freeze({ ...binding, attempt: Object.freeze(prior) }) });
}
