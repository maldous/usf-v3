import { canonicalDigest } from "./canonical.ts";
import { UsfError, exitCodes } from "./errors.ts";

export interface Dependency {
  key: string;
  digest: `sha256:${string}`;
  kind?: "semantic" | "path" | "policy" | "schema" | "tool" | "provider";
}

export type CurrentDependencyState = Readonly<Record<string, `sha256:${string}` | undefined>>;

function validated(dependencies: readonly Dependency[]): Dependency[] {
  const seen = new Set<string>();
  return dependencies.map((dependency) => {
    if (!dependency.key || !dependency.digest) throw new UsfError("DEPENDENCY_INVALID", exitCodes.INVALID_INPUT, "Dependencies require a key and digest.");
    if (seen.has(dependency.key)) throw new UsfError("DEPENDENCY_DUPLICATE", exitCodes.INVALID_INPUT, "A dependency key may appear only once.", { key: dependency.key });
    seen.add(dependency.key);
    return { ...dependency };
  }).sort((left, right) => left.key.localeCompare(right.key));
}

export function dependencyDigest(dependencies: readonly Dependency[]): `sha256:${string}` {
  return canonicalDigest(validated(dependencies));
}

export interface FreshnessResult { fresh: boolean; stale: Dependency[]; }

export function dependencyFreshness(dependencies: readonly Dependency[], current: CurrentDependencyState): FreshnessResult {
  const scoped = validated(dependencies);
  const stale = scoped.filter((dependency) => current[dependency.key] !== dependency.digest);
  return { fresh: stale.length === 0, stale };
}

export function assertFresh(dependencies: readonly Dependency[], current: CurrentDependencyState): void {
  const result = dependencyFreshness(dependencies, current);
  if (!result.fresh) throw new UsfError("SCOPED_DEPENDENCY_STALE", exitCodes.CURRENTNESS_FAILURE, "One or more scoped dependencies have changed.", { stale: result.stale });
}

export type DependencyImpact = "unaffected" | "affected" | "full-gate";

export interface DependencyImpactInput {
  readonly changed: readonly Dependency[];
  readonly closure: readonly Dependency[];
  /** Inputs whose impact cannot be bounded by the selected closure. */
  readonly unknownKeys?: readonly string[];
  /** Exact inputs that always require whole-gate certification. */
  readonly fullGateKeys?: readonly string[];
}

export interface DependencyImpactResult {
  readonly impact: DependencyImpact;
  readonly changedKeys: readonly string[];
  readonly affectedKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

/**
 * Classify a candidate against an authenticated dependency closure.
 *
 * This is intentionally a conservative kernel for affected-run selection:
 * unknown inputs and explicitly whole-gate inputs fail closed, while a
 * non-empty closure intersection is only an affected run, never proof that a
 * complete certification can be reused. Callers still need fresh affected
 * evidence and a fresh aggregate receipt.
 */
export function classifyDependencyImpact(input: DependencyImpactInput): DependencyImpactResult {
  const changed = validated(input.changed);
  const closure = validated(input.closure);
  const changedKeys = Object.freeze(changed.map(dependency => dependency.key));
  const closureKeys = new Set(closure.map(dependency => dependency.key));
  const unknownKeys = [...new Set(input.unknownKeys ?? [])].sort();
  const fullGateKeys = new Set(input.fullGateKeys ?? []);
  const fullGateChangedKeys = changedKeys.filter(key => fullGateKeys.has(key));
  const affectedKeys = Object.freeze(changedKeys.filter(key => closureKeys.has(key)));
  const reasonCodes: string[] = [];
  if (unknownKeys.length > 0) reasonCodes.push("IMPACT_UNKNOWN_INPUT");
  if (fullGateChangedKeys.length > 0) reasonCodes.push("IMPACT_FULL_GATE_INPUT");
  if (affectedKeys.length > 0) reasonCodes.push("IMPACT_CLOSURE_INTERSECTION");
  if (reasonCodes.length > 0 && unknownKeys.length > 0 || fullGateChangedKeys.length > 0) {
    return Object.freeze({ impact: "full-gate", changedKeys, affectedKeys, reasonCodes: Object.freeze(reasonCodes) });
  }
  return Object.freeze({
    impact: affectedKeys.length === 0 ? "unaffected" : "affected",
    changedKeys,
    affectedKeys,
    reasonCodes: Object.freeze(reasonCodes),
  });
}
