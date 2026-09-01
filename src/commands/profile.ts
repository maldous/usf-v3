import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph, resourceDigest, transitiveResourceIris, type SemanticGraph } from "../graph/index.ts";
import { canonicalQuadLine } from "../graph/nquads.ts";
import {
  authenticateProductRepositoryRoot, readProductRepositories,
} from "../core/product-repository.ts";
import type { CommandResult } from "./dispatcher.ts";

/**
 * Profile-to-foundation currentness.
 *
 * A product profile is realised against a foundation revision, but it does not
 * depend on all of it. The binding declares seeds; the closure is the transitive
 * resource closure of those seeds; and currentness is decided per resource by
 * comparing derived digests against those recorded when the realisation was
 * produced. Foundation movement outside that closure leaves the profile current,
 * which is the whole point of scoping the dependency rather than the repository.
 *
 * External facts are recorded, never compared for staleness. Third-party
 * catalogues and services evolve on their own schedule; a realisation produced
 * against yesterday's catalogue is not wrong today, it was produced against
 * different facts, and saying which is what makes a difference explainable.
 */
const P = "urn:usf:predicate:";
const bindingType = "urn:usf:type:ProfileFoundationBinding";
const foundationRevisionType = "urn:usf:type:FoundationRevision";

function one(graph: SemanticGraph, subject: string, predicate: string): string | null {
  const values = graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`);
  return values.length === 1 ? values[0]!.object : null;
}
function many(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return Object.freeze([...new Set(graph.quads
    .filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object))].sort());
}

export interface ProfileClosure {
  readonly binding: string;
  readonly profileRevision: string | null;
  readonly foundationRevision: string | null;
  readonly seeds: readonly string[];
  /** Transitive resource closure of the seeds, with each resource's digest. */
  readonly resources: readonly Readonly<{ resource: string; digest: string }>[];
  readonly closureDigest: string;
  readonly externalFactSources: readonly string[];
  readonly recordRoot: string;
}

export function deriveProfileClosure(
  productGraph: SemanticGraph,
  coreGraph: SemanticGraph,
  binding: string,
): ProfileClosure {
  const seeds = many(productGraph, binding, "coreDependencySeed");
  const missing = seeds.filter((seed) => coreGraph.quads.every((quad) => quad.subject !== seed));
  if (missing.length > 0) {
    throw new UsfError("PROFILE_SEED_UNRESOLVED", exitCodes.DOMAIN_FAILURE,
      "A declared core dependency seed does not exist in the foundation.", { binding, missing });
  }
  const resources = transitiveResourceIris(coreGraph, seeds).sort()
    .map((resource) => Object.freeze({ resource, digest: resourceDigest(coreGraph, resource) }));
  return Object.freeze({
    binding,
    profileRevision: one(productGraph, binding, "boundProfileRevision"),
    foundationRevision: one(productGraph, binding, "boundFoundationRevision"),
    seeds,
    resources: Object.freeze(resources),
    closureDigest: canonicalDigest(resources),
    externalFactSources: many(productGraph, binding, "externalFactSource"),
    recordRoot: one(productGraph, binding, "realisationRecordRoot") ?? ".usf/profile",
  });
}

export interface RealisationRecord {
  readonly schema: "urn:usf:profile-realisation-record:1";
  readonly version: 1;
  readonly binding: string;
  readonly profileRevision: string | null;
  readonly foundationRevision: string | null;
  readonly closureDigest: string;
  readonly resources: readonly Readonly<{ resource: string; digest: string }>[];
  /** Recorded, never compared: external drift is not staleness. */
  readonly externalFacts: Readonly<Record<string, string>>;
  readonly recordedAt: string;
  readonly nonClaims: readonly string[];
}

function recordPath(closure: ProfileClosure): string {
  const revision = (closure.profileRevision ?? closure.binding).split(":").slice(-2).join("-");
  return `${closure.recordRoot}/${revision}.realisation.json`;
}

/** External facts a realisation was produced against, observed not asserted. */
async function observeExternalFacts(repositoryRoot: string): Promise<Readonly<Record<string, string>>> {
  const facts: Record<string, string> = {};
  const catalogue = await readFile(resolve(repositoryRoot, ".usf/catalog/models-dev.normalized.json"), "utf8")
    .then((bytes) => canonicalDigest(bytes), () => null);
  if (catalogue !== null) facts["models-dev-catalogue"] = catalogue;
  const lock = await readFile(resolve(repositoryRoot, "pnpm-lock.yaml"), "utf8")
    .then((bytes) => canonicalDigest(bytes), () => null);
  if (lock !== null) facts["dependency-lock"] = lock;
  return Object.freeze(facts);
}

export type ProfileCurrentness = "current" | "stale" | "never-realised";

export interface ProfileStatus {
  readonly schema: "urn:usf:profile-status:1";
  readonly version: 1;
  readonly binding: string;
  readonly profileRevision: string | null;
  readonly foundationRevision: string | null;
  readonly currentness: ProfileCurrentness;
  readonly closureResourceCount: number;
  readonly closureDigest: string;
  /** Resources whose digest moved since the recorded realisation. */
  readonly movedResources: readonly Readonly<{ resource: string; recorded: string; current: string }>[];
  readonly addedResources: readonly string[];
  readonly removedResources: readonly string[];
  readonly externalFactDrift: readonly Readonly<{ fact: string; recorded: string; current: string }>[];
  readonly recordPath: string;
  readonly nonClaims: readonly string[];
}

const statusNonClaims = Object.freeze([
  "Currentness is decided per resource over the declared closure. Foundation movement outside that closure is not staleness and is deliberately not reported as such.",
  "External fact drift is reported and never makes a profile stale. A realisation produced against a different catalogue or lockfile was produced against different facts; it was not wrong.",
  "A stale profile names exactly the resources that moved. Regenerating anything beyond the outputs depending on those resources would be rebuilding on suspicion.",
]);

export async function profileStatus(
  repositoryRoot: string,
  closure: ProfileClosure,
): Promise<ProfileStatus> {
  const path = recordPath(closure);
  const bytes = await readFile(resolve(repositoryRoot, path), "utf8").catch(() => undefined);
  const current = new Map(closure.resources.map((entry) => [entry.resource, entry.digest] as const));
  const externalNow = await observeExternalFacts(repositoryRoot);
  if (bytes === undefined) {
    return Object.freeze({
      schema: "urn:usf:profile-status:1" as const, version: 1 as const,
      binding: closure.binding, profileRevision: closure.profileRevision,
      foundationRevision: closure.foundationRevision, currentness: "never-realised" as const,
      closureResourceCount: closure.resources.length, closureDigest: closure.closureDigest,
      movedResources: Object.freeze([]), addedResources: Object.freeze([...current.keys()].sort()),
      removedResources: Object.freeze([]), externalFactDrift: Object.freeze([]),
      recordPath: path, nonClaims: statusNonClaims,
    });
  }
  let record: RealisationRecord;
  try { record = JSON.parse(bytes) as RealisationRecord; }
  catch {
    throw new UsfError("PROFILE_RECORD_INVALID", exitCodes.INVALID_INPUT,
      "The recorded realisation is not valid JSON.", { path });
  }
  const recorded = new Map((record.resources ?? []).map((entry) => [entry.resource, entry.digest] as const));
  const moved = [...current.entries()]
    .filter(([resource, digest]) => recorded.has(resource) && recorded.get(resource) !== digest)
    .map(([resource, digest]) => Object.freeze({ resource, recorded: recorded.get(resource)!, current: digest }));
  const added = [...current.keys()].filter((resource) => !recorded.has(resource)).sort();
  const removed = [...recorded.keys()].filter((resource) => !current.has(resource)).sort();
  const drift = Object.entries(externalNow)
    .filter(([fact, digest]) => (record.externalFacts ?? {})[fact] !== undefined && record.externalFacts[fact] !== digest)
    .map(([fact, digest]) => Object.freeze({ fact, recorded: record.externalFacts[fact]!, current: digest }));
  return Object.freeze({
    schema: "urn:usf:profile-status:1" as const, version: 1 as const,
    binding: closure.binding, profileRevision: closure.profileRevision,
    foundationRevision: closure.foundationRevision,
    currentness: moved.length + added.length + removed.length === 0 ? "current" as const : "stale" as const,
    closureResourceCount: closure.resources.length, closureDigest: closure.closureDigest,
    movedResources: Object.freeze(moved), addedResources: Object.freeze(added),
    removedResources: Object.freeze(removed), externalFactDrift: Object.freeze(drift),
    recordPath: path, nonClaims: statusNonClaims,
  });
}

async function writeRealisationRecord(
  repositoryRoot: string,
  closure: ProfileClosure,
): Promise<RealisationRecord> {
  const record: RealisationRecord = Object.freeze({
    schema: "urn:usf:profile-realisation-record:1" as const, version: 1 as const,
    binding: closure.binding, profileRevision: closure.profileRevision,
    foundationRevision: closure.foundationRevision, closureDigest: closure.closureDigest,
    resources: closure.resources,
    externalFacts: await observeExternalFacts(repositoryRoot),
    recordedAt: new Date().toISOString(),
    nonClaims: Object.freeze([
      "This records the foundation resources and external facts a realisation was produced against. It is not a claim that the realisation is correct, complete, or reproducible against different facts.",
    ]),
  });
  const path = recordPath(closure);
  await mkdir(resolve(repositoryRoot, closure.recordRoot), { recursive: true, mode: 0o700 });
  const target = resolve(repositoryRoot, path);
  const transient = `${target}.tmp-${process.pid}`;
  await writeFile(transient, `${JSON.stringify(record, null, 1)}\n`, { mode: 0o600 });
  await rename(transient, target);
  return record;
}

function invalid(message: string): never {
  throw new UsfError("PROFILE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

export async function profileCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const operation = args[0];
  const operations = ["status", "closure", "record", "export", "import", "build"] as const;
  if (operation === undefined || !(operations as readonly string[]).includes(operation)) {
    invalid(`Profile requires exactly one of: ${operations.join(", ")}.`);
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--manifest", "--binding", "--output", "--bundle"].includes(option) || values.has(option)) {
      invalid(`Unknown or repeated option: ${option}`);
    }
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    values.set(option, value);
  }
  if (operation === "import" || operation === "build") {
    const bundlePath = values.get("--bundle");
    if (bundlePath === undefined) invalid(`Profile ${operation} requires --bundle naming an exported bundle.`);
    const bytes = await readFile(resolve(repositoryRoot, bundlePath), "utf8").catch(() => undefined);
    if (bytes === undefined) invalid("The bundle could not be read.");
    let bundle: ProfileExport;
    try { bundle = JSON.parse(bytes) as ProfileExport; }
    catch { invalid("The bundle is not valid JSON."); }
    if (bundle.schema !== "urn:usf:profile-export:1") {
      throw new UsfError("PROFILE_BUNDLE_UNRECOGNISED", exitCodes.INVALID_INPUT,
        "The bundle does not carry the profile-export schema.", { schema: bundle.schema });
    }
    const bundleManifest = bundle.profileSources?.[0]?.path;
    if (bundleManifest === undefined) {
      throw new UsfError("PROFILE_BUNDLE_INCOMPLETE", exitCodes.DOMAIN_FAILURE,
        "The bundle carries no profile manifest, so nothing can be reconstructed from it.");
    }
    const currentGraph = loadSemanticGraph(repositoryRoot, bundleManifest);
    const comparison = await compareImport(repositoryRoot, bundle, currentGraph);
    if (operation === "import") return { output: comparison, exitCode: exitCodes.SUCCESS };

    // build: state the point-in-time context a rebuild would run under. It
    // reports rather than realises, because realisation is Hermes's to perform
    // and a bundle must not become a second way to write product code.
    return {
      output: Object.freeze({
        schema: "urn:usf:profile-build-plan:1" as const, version: 1 as const,
        profileRevision: bundle.profileRevision, foundationRevision: bundle.foundationRevision,
        boundaryExportedAt: bundle.exportedAt,
        foundationMatches: comparison.foundationMatches,
        movedResources: comparison.movedResources,
        externalFactDrift: comparison.externalFactDrift,
        productRepository: bundle.productRepository,
        outputsAtBoundary: (bundle.realisedOutputs ?? []).length,
        rebuildContext: comparison.foundationMatches
          ? "The live foundation still matches this boundary, so a rebuild differs only by external facts."
          : "The live foundation has moved past this boundary. A rebuild against the bundled foundation reconstructs the boundary; a rebuild against the live foundation produces the next one.",
        nonClaims: Object.freeze([
          "This is the context a rebuild would run under, not a rebuild. Product code is realised by Hermes through the ordinary transaction path, and a bundle must not become a second way to write it.",
          "External fact drift is reported so a rebuild's difference is attributable. It is not a reason the boundary is invalid.",
        ]),
      }),
      exitCode: exitCodes.SUCCESS,
    };
  }

  const manifest = values.get("--manifest");
  if (manifest === undefined) invalid("Profile requires --manifest naming the product manifest.");
  const productGraph = loadSemanticGraph(repositoryRoot, manifest);
  const bindings = productGraph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === bindingType)
    .map((quad) => quad.subject).sort();
  const selected = values.get("--binding") ?? bindings[0];
  if (selected === undefined || !bindings.includes(selected)) {
    throw new UsfError("PROFILE_BINDING_UNKNOWN", exitCodes.INVALID_INPUT,
      "The manifest declares no such profile-to-foundation binding.", { declared: bindings });
  }
  // The binding names the foundation authority it resolves against, by path.
  // A product overlay must not import the foundation: doing so absorbs every
  // Core contract into the product and destroys the isolation that keeps
  // unrelated Core movement from staling it.
  const foundationManifest = one(productGraph, selected, "foundationAuthorityManifest");
  if (foundationManifest === null) {
    throw new UsfError("PROFILE_FOUNDATION_MANIFEST_UNDECLARED", exitCodes.DOMAIN_FAILURE,
      "The binding names no foundation authority manifest to resolve against.", { binding: selected });
  }
  const coreGraph = loadSemanticGraph(repositoryRoot, foundationManifest);
  const boundRevision = one(productGraph, selected, "boundFoundationRevision");
  if (boundRevision !== null && !coreGraph.quads.some((quad) =>
    quad.subject === boundRevision && quad.predicate === `${P}type` && quad.object === foundationRevisionType)) {
    throw new UsfError("PROFILE_FOUNDATION_REVISION_UNKNOWN", exitCodes.DOMAIN_FAILURE,
      "The bound foundation revision is not declared by the foundation authority the binding names.",
      { boundRevision, foundationManifest });
  }
  const closure = deriveProfileClosure(productGraph, coreGraph, selected);

  if (operation === "closure") {
    return {
      output: Object.freeze({
        schema: "urn:usf:profile-closure:1" as const, version: 1 as const,
        binding: closure.binding, profileRevision: closure.profileRevision,
        foundationRevision: closure.foundationRevision, seeds: closure.seeds,
        resourceCount: closure.resources.length, closureDigest: closure.closureDigest,
        resources: closure.resources, externalFactSources: closure.externalFactSources,
        nonClaims: Object.freeze([
          "The closure is the transitive resource closure of the declared seeds. A foundation resource absent from it cannot make this profile stale.",
        ]),
      }),
      exitCode: exitCodes.SUCCESS,
    };
  }
  if (operation === "export") {
    const bundle = await buildProfileExport(repositoryRoot, coreGraph, productGraph, closure, manifest);
    const digest = canonicalDigest(bundle);
    const output = values.get("--output")
      ?? `${closure.recordRoot}/${(closure.profileRevision ?? closure.binding).split(":").slice(-2).join("-")}.export.json`;
    await mkdir(resolve(repositoryRoot, output.split("/").slice(0, -1).join("/")), { recursive: true, mode: 0o700 });
    await writeFile(resolve(repositoryRoot, output), `${JSON.stringify(bundle, null, 1)}\n`, { mode: 0o600 });
    return {
      output: Object.freeze({
        schema: "urn:usf:profile-export-result:1" as const, version: 1 as const,
        bundlePath: output, bundleDigest: digest,
        profileRevision: bundle.profileRevision, foundationRevision: bundle.foundationRevision,
        foundationResourceCount: bundle.foundationResources.length,
        profileSourceCount: bundle.profileSources.length,
        realisedOutputCount: bundle.realisedOutputs.length,
        externalFacts: Object.keys(bundle.externalFacts).sort(),
        nonClaims: bundle.nonClaims,
      }),
      exitCode: exitCodes.SUCCESS,
    };
  }
  if (operation === "record") {
    const record = await writeRealisationRecord(repositoryRoot, closure);
    return { output: Object.freeze({ ...record, recordPath: recordPath(closure) }), exitCode: exitCodes.SUCCESS };
  }
  return { output: await profileStatus(repositoryRoot, closure), exitCode: exitCodes.SUCCESS };
}

// ---------------------------------------------------------------------------
// Point-in-time export, import and build
// ---------------------------------------------------------------------------

/**
 * A version-boundary bundle.
 *
 * Digests establish that something has moved; they cannot rebuild it. An export
 * therefore carries the closure's content, not just its identity, so a product
 * can be reconstructed at a boundary long after the foundation has moved on.
 *
 * That is also how a dependency update is performed: take the bundle, keep the
 * foundation and profile fixed, and rebuild against today's external facts.
 * What changes is attributable to the external world rather than to drift
 * nobody recorded.
 */
export interface ProfileExport {
  readonly schema: "urn:usf:profile-export:1";
  readonly version: 1;
  readonly binding: string;
  readonly profileRevision: string | null;
  readonly foundationRevision: string | null;
  readonly closureDigest: string;
  /** Closure content, sufficient to reconstruct the foundation slice. */
  readonly foundationResources: readonly Readonly<{
    resource: string; digest: string; quads: readonly string[];
  }>[];
  /** The profile's own graph sources, verbatim. */
  readonly profileSources: readonly Readonly<{ path: string; digest: string; content: string }>[];
  readonly externalFacts: Readonly<Record<string, string>>;
  /** Product outputs at this boundary, by digest. */
  readonly realisedOutputs: readonly Readonly<{ path: string; digest: string }>[];
  readonly productRepository: Readonly<{
    repository: string; locator: string; requiredFiles: readonly string[];
  }> | null;
  readonly exportedAt: string;
  readonly nonClaims: readonly string[];
}

const exportNonClaims = Object.freeze([
  "This bundle carries the foundation closure content, the profile sources and the digests of the product outputs at one boundary. It is sufficient to reconstruct that boundary; it is not a claim that the outputs were correct.",
  "External facts are recorded, not carried. Rebuilding against a later catalogue, provider set or dependency lock may legitimately produce different output, and the recorded facts are what make that difference attributable.",
  "A bundle is not a licence to skip validation. Reconstructed output earns satisfaction the same way original output does: by executing and being evaluated.",
]);

async function collectRealisedOutputs(
  repositoryRoot: string,
  root: string,
  prefixes: readonly string[],
): Promise<readonly Readonly<{ path: string; digest: string }>[]> {
  const { readdir } = await import("node:fs/promises");
  const outputs: Array<Readonly<{ path: string; digest: string }>> = [];
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(resolve(root, relative), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const next = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) { await walk(next); continue; }
      if (!entry.isFile()) continue;
      const bytes = await readFile(resolve(root, next), "utf8").catch(() => undefined);
      if (bytes !== undefined) outputs.push(Object.freeze({ path: next, digest: canonicalDigest(bytes) }));
    }
  };
  for (const prefix of prefixes) await walk(prefix.replace(/\/$/u, ""));
  return Object.freeze(outputs);
}

export async function buildProfileExport(
  repositoryRoot: string,
  coreGraph: SemanticGraph,
  productGraph: SemanticGraph,
  closure: ProfileClosure,
  manifest: string,
): Promise<ProfileExport> {
  const foundationResources = closure.resources.map((entry) => Object.freeze({
    resource: entry.resource,
    digest: entry.digest,
    quads: Object.freeze(coreGraph.quads
      .filter((quad) => quad.subject === entry.resource)
      .map((quad) => quad.canonical.length > 0 ? quad.canonical : canonicalQuadLine(quad))
      .sort()),
  }));

  // Profile sources come from the manifest that declared the binding, so a
  // bundle carries the product's own authority rather than a copy of Core's.
  const manifestBytes = await readFile(resolve(repositoryRoot, manifest), "utf8").catch(() => undefined);
  const profileSources: Array<Readonly<{ path: string; digest: string; content: string }>> = [];
  if (manifestBytes !== undefined) {
    profileSources.push(Object.freeze({ path: manifest, digest: canonicalDigest(manifestBytes), content: manifestBytes }));
    const parsed = JSON.parse(manifestBytes) as { sources?: Array<{ path?: unknown }> };
    for (const source of parsed.sources ?? []) {
      if (typeof source.path !== "string") continue;
      const bytes = await readFile(resolve(repositoryRoot, source.path), "utf8").catch(() => undefined);
      if (bytes !== undefined) {
        profileSources.push(Object.freeze({ path: source.path, digest: canonicalDigest(bytes), content: bytes }));
      }
    }
  }

  const revision = closure.profileRevision;
  const declared = readProductRepositories(productGraph).find((entry) =>
    productGraph.quads.some((quad) =>
      quad.subject === revision && quad.predicate === `${P}productRepository` && quad.object === entry.repository));
  let realisedOutputs: readonly Readonly<{ path: string; digest: string }>[] = Object.freeze([]);
  if (declared !== undefined) {
    const root = await authenticateProductRepositoryRoot(repositoryRoot, declared).catch(() => null);
    if (root !== null) realisedOutputs = await collectRealisedOutputs(repositoryRoot, root, declared.authorizedPathPrefixes);
  }

  return Object.freeze({
    schema: "urn:usf:profile-export:1" as const, version: 1 as const,
    binding: closure.binding, profileRevision: closure.profileRevision,
    foundationRevision: closure.foundationRevision, closureDigest: closure.closureDigest,
    foundationResources: Object.freeze(foundationResources),
    profileSources: Object.freeze(profileSources),
    externalFacts: await observeExternalFacts(repositoryRoot),
    realisedOutputs,
    productRepository: declared === undefined ? null : Object.freeze({
      repository: declared.repository, locator: declared.locator, requiredFiles: declared.requiredFiles,
    }),
    exportedAt: new Date().toISOString(),
    nonClaims: exportNonClaims,
  });
}

export interface ImportComparison {
  readonly schema: "urn:usf:profile-import:1";
  readonly version: 1;
  readonly bundleDigest: string;
  readonly profileRevision: string | null;
  readonly foundationRevision: string | null;
  readonly foundationMatches: boolean;
  readonly movedResources: readonly Readonly<{ resource: string; bundled: string; current: string }>[];
  readonly absentResources: readonly string[];
  readonly externalFactDrift: readonly Readonly<{ fact: string; bundled: string; current: string }>[];
  readonly reconstructable: boolean;
  readonly nonClaims: readonly string[];
}

/**
 * Compare a bundle against the current repository.
 *
 * A bundle whose foundation slice differs from the current one is not invalid:
 * it is a different point in time, which is what it exists to be. The
 * comparison says what differs so a rebuild is a decision rather than a
 * surprise.
 */
export async function compareImport(
  repositoryRoot: string,
  bundle: ProfileExport,
  currentGraph: SemanticGraph,
): Promise<ImportComparison> {
  const moved: Array<Readonly<{ resource: string; bundled: string; current: string }>> = [];
  const absent: string[] = [];
  for (const entry of bundle.foundationResources ?? []) {
    const present = currentGraph.quads.some((quad) => quad.subject === entry.resource);
    if (!present) { absent.push(entry.resource); continue; }
    const current = resourceDigest(currentGraph, entry.resource);
    if (current !== entry.digest) moved.push(Object.freeze({ resource: entry.resource, bundled: entry.digest, current }));
  }
  const now = await observeExternalFacts(repositoryRoot);
  const drift = Object.entries(now)
    .filter(([fact, digest]) => bundle.externalFacts?.[fact] !== undefined && bundle.externalFacts[fact] !== digest)
    .map(([fact, digest]) => Object.freeze({ fact, bundled: bundle.externalFacts[fact]!, current: digest }));
  return Object.freeze({
    schema: "urn:usf:profile-import:1" as const, version: 1 as const,
    bundleDigest: canonicalDigest(bundle),
    profileRevision: bundle.profileRevision, foundationRevision: bundle.foundationRevision,
    foundationMatches: moved.length === 0 && absent.length === 0,
    movedResources: Object.freeze(moved), absentResources: Object.freeze(absent.sort()),
    externalFactDrift: Object.freeze(drift),
    // Content travels with the bundle, so a boundary stays reconstructable even
    // when the live foundation has moved past it.
    reconstructable: (bundle.foundationResources ?? []).every((entry) => entry.quads.length > 0),
    nonClaims: Object.freeze([
      "A difference between a bundle and the current repository is a difference in time, not a defect in either.",
      "Reconstructability means the bundle carries the content needed to rebuild its boundary. It is not a claim that a rebuild will produce identical output, which depends on external facts the bundle records but does not own.",
    ]),
  });
}
