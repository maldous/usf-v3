import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createQualificationPolicy, createQualificationSuite } from "./qualification.ts";

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
 * A record counts when it names the exact route, carries a qualified role for
 * the task class, and was earned under the suite, corpus and policy identities
 * still in force. It does not expire.
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
  /** Records earned under a suite, corpus or policy identity no longer in force. */
  readonly supersededCount: number;
  /** The identities admitted records were required to match. */
  readonly basis: Readonly<{
    suiteId: string; suiteVersion: string;
    corpusDigest: string; qualificationPolicyDigest: string;
  }>;
  readonly evaluated: true;
}

const qualificationDirectoryName = "qualifications";

export async function observeQualifiedTaskClasses(
  repositoryRoot: string,
): Promise<ObservedQualification> {
  // The identities in force now. A record earned under a different suite,
  // corpus or policy proved something about a contract that has since changed,
  // which is the only kind of ageing that matters here.
  // Absent or unreadable authority admits nothing. There is no contract to bind
  // a record against, so every record becomes inadmissible rather than trusted,
  // and the result still reports itself as evaluated so an empty answer is not
  // mistaken for an unknown one.
  const authority = await readFile(resolve(repositoryRoot, "config/qualification.json"), "utf8")
    .then((bytes) => {
      const parsed = JSON.parse(bytes) as {
        readonly suite: Parameters<typeof createQualificationSuite>[0];
        readonly policy: Parameters<typeof createQualificationPolicy>[0];
      };
      const suite = createQualificationSuite(parsed.suite);
      const policy = createQualificationPolicy(parsed.policy);
      return Object.freeze({
        suiteId: suite.suiteId,
        suiteVersion: suite.suiteVersion,
        corpusDigest: suite.corpusDigest,
        qualificationPolicyDigest: policy.policyDigest,
      });
    })
    .catch(() => null);
  const basis = authority ?? Object.freeze({
    suiteId: "", suiteVersion: "", corpusDigest: "", qualificationPolicyDigest: "",
  });

  const directory = resolve(repositoryRoot, ".usf", qualificationDirectoryName);
  const names = await readdir(directory).catch(() => [] as string[]);
  const byRoute = new Map<string, Set<string>>();
  let recordCount = 0;
  let supersededCount = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    recordCount += 1;
    let record: {
      readonly status?: unknown; readonly role?: unknown; readonly taskClass?: unknown;
      readonly route?: { readonly provider?: unknown; readonly model?: unknown };
      readonly qualification?: {
        readonly inputs?: { readonly corpusDigest?: unknown; readonly qualificationPolicyDigest?: unknown };
        readonly profile?: {
          readonly requested?: { readonly provider?: unknown; readonly model?: unknown };
          readonly actual?: { readonly provider?: unknown; readonly model?: unknown };
        };
      };
    };
    try { record = JSON.parse(bytes) as typeof record; } catch { continue; }
    if (record.status !== "ok") continue;
    // UNQUALIFIED is the policy default and a recorded fact, not a capability.
    if (typeof record.role !== "string" || record.role === "UNQUALIFIED") continue;
    const taskClass = record.taskClass;
    // A stored file may not mint catalogue evidence: only a real task class
    // counts, so a record naming a model feature grants nothing.
    if (typeof taskClass !== "string" || capabilityKind(taskClass) !== "task-class") continue;
    const provider = record.route?.provider;
    const model = record.route?.model;
    if (typeof provider !== "string" || typeof model !== "string") continue;
    // Earned under the contract still in force, decided the same way the routing
    // replay decides it. A record with no bound identity at all proved nothing
    // checkable and is refused rather than trusted.
    if (authority === null) continue;
    const inputs = record.qualification?.inputs;
    if (typeof inputs?.corpusDigest !== "string" || typeof inputs.qualificationPolicyDigest !== "string") continue;
    if (inputs.corpusDigest !== basis.corpusDigest
      || inputs.qualificationPolicyDigest !== basis.qualificationPolicyDigest) {
      supersededCount += 1;
      continue;
    }
    // The evidence must have been produced by the route it is indexed under, in
    // both directions: what was asked and what answered.
    const profile = record.qualification?.profile;
    if (profile?.requested?.provider !== provider || profile.requested.model !== model
      || profile.actual?.provider !== provider || profile.actual.model !== model) continue;
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
