import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
 * A record counts only when it names the exact route, carries a qualified role
 * for the task class, and has not expired. An expired record is not a downgrade
 * to be argued about -- the policy sets a validity window precisely so that a
 * stale pass stops being a claim.
 */
export interface ObservedQualification {
  /** `provider:model` to the task classes it currently holds a role for. */
  readonly byRoute: ReadonlyMap<string, readonly string[]>;
  readonly recordCount: number;
  readonly expiredCount: number;
  readonly evaluated: true;
}

const qualificationDirectoryName = "qualifications";

export async function observeQualifiedTaskClasses(
  repositoryRoot: string,
  now: Date,
): Promise<ObservedQualification> {
  const directory = resolve(repositoryRoot, ".usf", qualificationDirectoryName);
  const names = await readdir(directory).catch(() => [] as string[]);
  const byRoute = new Map<string, Set<string>>();
  let recordCount = 0;
  let expiredCount = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    recordCount += 1;
    let record: {
      readonly status?: unknown; readonly role?: unknown; readonly taskClass?: unknown;
      readonly expiresAt?: unknown; readonly route?: { readonly provider?: unknown; readonly model?: unknown };
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
    const expiresAt = record.expiresAt;
    if (typeof expiresAt !== "string") continue;
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry)) continue;
    if (expiry <= now.getTime()) { expiredCount += 1; continue; }
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
    expiredCount,
    evaluated: true as const,
  });
}
