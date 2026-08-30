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
