import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSemanticGraph } from "../graph/index.ts";
import { deriveWork, type WorkPacket } from "../graph/work.ts";
import { publicationPolicyCoverage } from "./status.ts";
import { exitCodes, type ExitCode, UsfError } from "../core/errors.ts";
import type { CommandResult } from "./dispatcher.ts";

/**
 * Corpus-wide realisation-lane census.
 *
 * A lane is one graph manifest bound to one declared RealisationProfile. The
 * corpus has more manifests and more profiles than live lanes, and profile
 * identity is part of completion identity, so a work completed under one
 * profile reads ineligible under another with the same bytes. Reading a single
 * lane therefore cannot tell an operator which lane is live; only the cross
 * product can, and assembling it by hand invites the mistake of reading a
 * policy-uncovered lane as an implementation backlog.
 *
 * This is observation. It derives, it stores nothing, and it contacts nothing.
 */
const profileType = "urn:usf:type:RealisationProfile";
const typePredicate = "urn:usf:predicate:type";
const selectsContractPredicate = "urn:usf:predicate:selectsContract";
const semanticContractType = "urn:usf:type:SemanticContract";
const fixtureDirectory = "fixtures";
const maximumLanes = 512;
const suspendedProductManifestPrefixes = ["graph/manifests/anqr-", "graph/products/anqr/"] as const;

async function manifestPaths(repositoryRoot: string): Promise<readonly string[]> {
  const root = resolve(repositoryRoot, "graph");
  const walk = async (directory: string, prefix: string): Promise<readonly string[]> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === fixtureDirectory) continue;
        found.push(...await walk(resolve(directory, entry.name), `${prefix}${entry.name}/`));
      } else if (entry.name.endsWith(".json")) {
        found.push(`${prefix}${entry.name}`);
      }
    }
    return found;
  };
  const candidates = await walk(root, "");
  const manifests: string[] = [];
  for (const candidate of candidates) {
    const source = await readFile(resolve(root, candidate), "utf8").catch(() => undefined);
    if (source === undefined) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { continue; }
    if (typeof parsed !== "object" || parsed === null) continue;
    const shape = parsed as Record<string, unknown>;
    // A manifest declares sources; anything else under graph/ is not one.
    if (!Array.isArray(shape.sources)) continue;
    manifests.push(`graph/${candidate}`);
  }
  return manifests.slice().sort();
}

async function directlyDeclaredProfiles(repositoryRoot: string, manifest: string): Promise<readonly string[]> {
  const manifestSource = await readFile(resolve(repositoryRoot, manifest), "utf8").catch(() => undefined);
  if (manifestSource === undefined) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(manifestSource); } catch { return []; }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Record<string, unknown>).sources)) return [];
  const profiles = new Set<string>();
  for (const entry of (parsed as { sources: Array<{ path?: unknown }> }).sources) {
    if (typeof entry.path !== "string") continue;
    const source = await readFile(resolve(repositoryRoot, entry.path), "utf8").catch(() => undefined);
    if (source === undefined) continue;
    const expression = /<([^<>]+)>\s+<urn:usf:predicate:type>\s+<urn:usf:type:RealisationProfile>/gu;
    for (const match of source.matchAll(expression)) profiles.add(match[1]!);
  }
  return [...profiles].sort();
}

function stageCounts(packets: readonly WorkPacket[]): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const packet of packets) {
    const stage = (packet as unknown as { realisationStage?: { stage?: string } }).realisationStage?.stage ?? "unstaged";
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return Object.freeze(Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))));
}

export async function graphLanesCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  if (args.some((argument) => argument !== "--json")) {
    throw new UsfError("GRAPH_LANES_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Graph lanes accepts only --json.");
  }
  const manifests = await manifestPaths(repositoryRoot);
  // Profiles are declared across the corpus, so they are discovered from every
  // manifest's own closure rather than assumed to live in one place.
  const profiles = new Set<string>();
  for (const manifest of manifests) {
    let graph;
    try { graph = loadSemanticGraph(repositoryRoot, manifest); } catch { continue; }
    for (const quad of graph.quads) {
      if (quad.predicate === typePredicate && quad.object === profileType) profiles.add(quad.subject);
    }
  }
  const orderedProfiles = [...profiles].sort();

  const lanes: Array<Readonly<Record<string, unknown>>> = [];
  let workSlotCount = 0;
  let workSlotsAtRisk = 0;
  let coveredLaneCount = 0;
  manifests: for (const manifest of manifests) {
    if (suspendedProductManifestPrefixes.some((prefix) => manifest.startsWith(prefix))) continue;
    let graph;
    try { graph = loadSemanticGraph(repositoryRoot, manifest); } catch { continue; }
    const manifestProfiles = await directlyDeclaredProfiles(repositoryRoot, manifest);
    for (const profile of manifestProfiles) {
      if (lanes.length >= maximumLanes) break manifests;
      let packets: readonly WorkPacket[] = [];
      try { packets = deriveWork(graph, { selector: `profile:${profile}`, maxItems: 100 }).items ?? []; } catch { continue; }
      if (packets.length === 0) continue;
      const coverage = publicationPolicyCoverage(graph, packets) as Record<string, unknown>;
      const works = typeof coverage.works === "number" ? coverage.works : packets.length;
      const atRisk = typeof coverage.worksAtRisk === "number" ? coverage.worksAtRisk : works;
      workSlotCount += works;
      workSlotsAtRisk += atRisk;
      const covered = coverage.status === "covered";
      if (covered) coveredLaneCount += 1;
      lanes.push(Object.freeze({
        manifest, profile, workCount: packets.length,
        stages: stageCounts(packets),
        policyCoverage: Object.freeze({ works, worksAtRisk: atRisk, status: coverage.status ?? "unknown" }),
        live: covered,
      }));
    }
  }

  return {
    output: Object.freeze({
      schema: "urn:usf:lane-census-result:1" as const,
      version: 1 as const,
      evaluated: true as const,
      manifestCount: manifests.length,
      profileCount: orderedProfiles.length,
      laneCount: lanes.length,
      policyCoveredLaneCount: coveredLaneCount,
      workSlotCount,
      workSlotsAtRisk,
      lanes: Object.freeze(lanes),
      nonClaims: Object.freeze([
        "A lane is one manifest bound to one profile. A manifest-by-profile pair that derives no packet is not a lane and is omitted.",
        "Policy coverage is a precondition, not an outcome: an uncovered lane cannot record completion under any amount of work, so its blocked packets are a structural fact rather than an implementation backlog.",
        "An uncovered lane is not a superseded lane. Disposition is a recorded decision and is read from the profile-disposition records, never inferred from coverage.",
        "This projection derives from committed authority, stores nothing and contacts nothing.",
      ]),
    }),
    exitCode: exitCodes.SUCCESS as ExitCode,
  };
}
