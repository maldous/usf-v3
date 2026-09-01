import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";

/**
 * The semantic result cache answers one question: do we already possess a valid
 * result for this semantic requirement under current authority?
 *
 * It is deliberately not a prompt cache. Identity derives from the meaning of
 * the work -- what is required, what authoritative inputs it reads, what
 * results it composes and what contract the output must satisfy. Two agents,
 * cycles or providers that encounter the same semantic requirement compute the
 * same key and reuse one result.
 *
 * It is also deliberately not execution evidence. Evidence answers what
 * happened during an invocation; one cached result may have several historical
 * evidence records. Provider and model identity therefore belong to evidence,
 * not to cache identity, unless the requirement itself demands a named provider.
 */
export const semanticCacheVersion = "1";

export interface SemanticWorkIdentity {
  /** The semantic requirement this work satisfies. */
  readonly requirement: string;
  /** Digests of the authoritative inputs the work reads. */
  readonly inputDigests: readonly string[];
  /** Digests of the dependency results the work composes. */
  readonly dependencyResultDigests: readonly string[];
  /** Acceptance conditions the result must satisfy. */
  readonly acceptanceRequirements: readonly string[];
  /** Model capabilities the work requires, not the model chosen. */
  readonly requiredCapabilities: readonly string[];
  /** Identity of the contract or schema the output must satisfy. */
  readonly outputContract: string | null;
  /** Identity of the economic and execution policy in force. */
  readonly policyDigest: string;
  /**
   * Only set when the requirement genuinely demands a named provider or model.
   * Left null, a result is reusable across every provider that can satisfy the
   * output contract, which is what provider-neutral operation requires.
   */
  readonly requiredProvider: string | null;
  readonly requiredModel: string | null;
}

export interface CachedSemanticResult {
  readonly schema: "urn:usf:semantic-cache-entry:1";
  readonly version: 1;
  readonly cacheVersion: string;
  readonly key: string;
  readonly identity: SemanticWorkIdentity;
  readonly text: string;
  readonly resultDigest: string;
  /** Evidence records for invocations that produced or confirmed this result. */
  readonly executionEvidenceDigests: readonly string[];
  readonly firstProducedAt: string;
  readonly reuseCount: number;
  readonly nonClaims: readonly string[];
}

const entryNonClaims = Object.freeze([
  "This entry asserts that a result satisfying the named output contract was produced for exactly this semantic identity. It asserts nothing about which provider produced it; that is execution evidence.",
  "A change to any authoritative input, dependency result, acceptance requirement, required capability, output contract or policy yields a different key, so a stale result cannot be returned.",
]);

/**
 * Canonicalize identity before digesting. Ordering of input and dependency
 * digests is not semantic, so it is normalized; anything incidental is absent
 * from the structure entirely rather than filtered later.
 */
function canonicalIdentity(identity: SemanticWorkIdentity): unknown {
  return Object.freeze({
    cacheVersion: semanticCacheVersion,
    requirement: identity.requirement,
    inputDigests: Object.freeze([...new Set(identity.inputDigests)].sort()),
    dependencyResultDigests: Object.freeze([...new Set(identity.dependencyResultDigests)].sort()),
    acceptanceRequirements: Object.freeze([...new Set(identity.acceptanceRequirements)].sort()),
    requiredCapabilities: Object.freeze([...new Set(identity.requiredCapabilities)].sort()),
    outputContract: identity.outputContract,
    policyDigest: identity.policyDigest,
    requiredProvider: identity.requiredProvider,
    requiredModel: identity.requiredModel,
  });
}

export function semanticCacheKey(identity: SemanticWorkIdentity): string {
  return canonicalDigest(canonicalIdentity(identity));
}

/** Facts a cache key deliberately excludes, stated so the exclusion is auditable. */
export const excludedFromCacheIdentity: readonly string[] = Object.freeze([
  "cycle identity", "wall-clock timestamps", "temporary paths", "agent identity",
  "transaction identity", "provider attempt ordering", "provider identity",
  "model identity", "execution evidence digests",
]);

function entryPath(repositoryRoot: string, key: string): string {
  return resolve(repositoryRoot, ".usf", "semantic-cache", `${key.slice("sha256:".length)}.json`);
}

export interface CacheLookup {
  readonly key: string;
  readonly hit: boolean;
  /** Explicit so an absent entry is never ambiguous with an unevaluated lookup. */
  readonly evaluated: true;
  readonly entry: CachedSemanticResult | null;
  readonly refusal: "identity-mismatch" | "unreadable" | "cache-version-changed" | null;
}

export async function lookupSemanticResult(
  repositoryRoot: string,
  identity: SemanticWorkIdentity,
): Promise<CacheLookup> {
  const key = semanticCacheKey(identity);
  const bytes = await readFile(entryPath(repositoryRoot, key), "utf8").catch(() => undefined);
  if (bytes === undefined) {
    return Object.freeze({ key, hit: false, evaluated: true as const, entry: null, refusal: null });
  }
  let entry: CachedSemanticResult;
  try { entry = JSON.parse(bytes) as CachedSemanticResult; }
  catch { return Object.freeze({ key, hit: false, evaluated: true as const, entry: null, refusal: "unreadable" as const }); }
  if (entry.cacheVersion !== semanticCacheVersion) {
    return Object.freeze({ key, hit: false, evaluated: true as const, entry: null, refusal: "cache-version-changed" as const });
  }
  // The key is a digest of identity, but the entry is re-checked against the
  // requested identity so a corrupted or hand-written file cannot be reused.
  if (semanticCacheKey(entry.identity) !== key || entry.key !== key) {
    return Object.freeze({ key, hit: false, evaluated: true as const, entry: null, refusal: "identity-mismatch" as const });
  }
  if (canonicalDigest(entry.text) !== entry.resultDigest) {
    return Object.freeze({ key, hit: false, evaluated: true as const, entry: null, refusal: "identity-mismatch" as const });
  }
  return Object.freeze({ key, hit: true, evaluated: true as const, entry, refusal: null });
}

export async function storeSemanticResult(
  repositoryRoot: string,
  identity: SemanticWorkIdentity,
  text: string,
  executionEvidenceDigest: string | null,
): Promise<CachedSemanticResult> {
  const key = semanticCacheKey(identity);
  const existing = await lookupSemanticResult(repositoryRoot, identity);
  const evidence = Object.freeze([...new Set([
    ...(existing.entry?.executionEvidenceDigests ?? []),
    ...(executionEvidenceDigest === null ? [] : [executionEvidenceDigest]),
  ])].sort());
  const entry: CachedSemanticResult = Object.freeze({
    schema: "urn:usf:semantic-cache-entry:1" as const,
    version: 1 as const,
    cacheVersion: semanticCacheVersion,
    key,
    identity: canonicalIdentity(identity) as SemanticWorkIdentity,
    text,
    resultDigest: canonicalDigest(text),
    executionEvidenceDigests: evidence,
    firstProducedAt: existing.entry?.firstProducedAt ?? new Date().toISOString(),
    reuseCount: existing.entry?.reuseCount ?? 0,
    nonClaims: entryNonClaims,
  });
  const directory = resolve(repositoryRoot, ".usf", "semantic-cache");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(entryPath(repositoryRoot, key), `${JSON.stringify(entry, null, 1)}\n`, { mode: 0o600 });
  return entry;
}

/** Record that a stored result was reused without invoking a provider. */
export async function recordSemanticReuse(
  repositoryRoot: string,
  entry: CachedSemanticResult,
): Promise<CachedSemanticResult> {
  const updated: CachedSemanticResult = Object.freeze({ ...entry, reuseCount: entry.reuseCount + 1 });
  await writeFile(entryPath(repositoryRoot, entry.key), `${JSON.stringify(updated, null, 1)}\n`, { mode: 0o600 });
  return updated;
}

export interface CacheStatistics {
  readonly entryCount: number;
  readonly totalReuse: number;
  readonly evaluated: true;
}

export async function semanticCacheStatistics(repositoryRoot: string): Promise<CacheStatistics> {
  const directory = resolve(repositoryRoot, ".usf", "semantic-cache");
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
  let totalReuse = 0;
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    try { totalReuse += (JSON.parse(bytes) as CachedSemanticResult).reuseCount ?? 0; } catch { continue; }
  }
  return Object.freeze({ entryCount: names.length, totalReuse, evaluated: true as const });
}
