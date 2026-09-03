import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { exitCodes, UsfError } from "../core/errors.ts";
import { observeLifecycleStatus, validateInstanceSlug, validateRepositoryManifest, validateVersionedProfile } from "../continuous/lifecycle.ts";
import { loadSemanticGraph, objectsFor, objectValues, resourceDigest, type SemanticGraph } from "../graph/index.ts";
import { deriveWork, type WorkPacket } from "../graph/work.ts";
import type { CommandHandler } from "./dispatcher.ts";

const statusNonclaims = Object.freeze([
  "status-is-observation-not-semantic-authority",
  "configured-route-count-is-not-live-provider-eligibility",
  "lifecycle-running-is-not-work-completion-or-proof",
  "unobserved-values-are-not-zero",
  "no-full-anqr-staging-production-or-terminal-proof-claim",
  "carrier-observation-covers-exactly-this-checkout-not-sibling-clones",
  "closure-satisfiability-is-file-presence-not-byte-authentication",
  "blast-radius-is-a-projection-not-a-performed-policy-change",
  "a-writable-path-is-not-an-authorized-change-the-mechanism-still-gates-it",
] as const);

interface StatusArguments {
  readonly instance: string;
  readonly profile?: string;
  readonly manifest?: string;
  readonly detail: "summary" | "full";
  readonly maxItems: number;
}

function parseStatusArguments(args: readonly string[]): StatusArguments {
  if (args.length % 2 !== 0) throw new UsfError("STATUS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Status options require explicit values.");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1]!;
    if (!['--instance', '--profile', '--manifest', '--detail', '--max-items'].includes(option) || values.has(option) || value.length === 0 || value.startsWith("--")) {
      throw new UsfError("STATUS_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Status options are invalid or duplicated.");
    }
    values.set(option, value);
  }
  const profile = values.get("--profile");
  const manifest = values.get("--manifest");
  if ((profile === undefined) !== (manifest === undefined)) {
    throw new UsfError("STATUS_SCOPE_INCOMPLETE", exitCodes.INVALID_INPUT, "Semantic status requires both --profile and --manifest; no product overlay is selected implicitly.");
  }
  const detail = values.get("--detail") ?? "summary";
  if (detail !== "summary" && detail !== "full") throw new UsfError("STATUS_DETAIL_INVALID", exitCodes.INVALID_INPUT, "Status detail must be summary or full.");
  const maxValue = values.get("--max-items") ?? "100";
  if (!/^[1-9][0-9]{0,3}$/.test(maxValue) || Number(maxValue) > 1_000) throw new UsfError("STATUS_MAX_ITEMS_INVALID", exitCodes.INVALID_INPUT, "Status max items must be an integer from 1 through 1000.");
  return Object.freeze({
    instance: validateInstanceSlug(values.get("--instance") ?? "default"),
    ...(profile === undefined ? {} : { profile: validateVersionedProfile(profile), manifest: validateRepositoryManifest(manifest!) }),
    detail,
    maxItems: Number(maxValue),
  });
}

const graphPredicate = (name: string): string => `urn:usf:predicate:${name}`;
const typePredicate = graphPredicate("type");
const productionClosureType = "urn:usf:type:ProductionLeafRuntimeClosure";
const constructionPolicyType = "urn:usf:type:ConstructionAuthorityPublicationPolicy";
const completionPolicyType = "urn:usf:type:NoChangeWorkCompletionPublicationPolicy";

/** Bound every projection so a malformed graph cannot make status unbounded. */
const maxClosures = 64;
const maxClosureMembers = 256;
const maxPolicies = 128;
const maxStagedPaths = 256;

function subjectsOfType(graph: SemanticGraph, type: string): string[] {
  return [...new Set(graph.quads
    .filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri" && quad.object === type)
    .map((quad) => quad.subject))].sort();
}

function singleGraphValue(graph: SemanticGraph, subject: string, name: string): string | null {
  const quads = objectsFor(graph, subject, graphPredicate(name));
  return quads.length === 1 ? quads[0]!.object : null;
}

/**
 * Same-root regular-file authentication for one declared closure member.
 * Lexical containment alone is insufficient: an intermediate symlink can leave
 * the repository while every path component still looks contained.
 */
function memberDisposition(repositoryRoot: string, member: string): "present" | "missing" | "not-regular-file" | "outside-root" {
  if (member.length === 0 || member.startsWith("/") || member.split("/").includes("..")) return "outside-root";
  const absolute = resolve(repositoryRoot, member);
  let canonicalRoot: string;
  try { canonicalRoot = realpathSync(repositoryRoot); }
  catch { return "outside-root"; }
  if (absolute !== resolve(canonicalRoot, member)) return "outside-root";
  let metadata;
  try { metadata = lstatSync(absolute); }
  catch { return "missing"; }
  if (metadata.isSymbolicLink() || !metadata.isFile()) return "not-regular-file";
  let canonicalMember: string;
  try { canonicalMember = realpathSync(absolute); }
  catch { return "missing"; }
  return canonicalMember === absolute && canonicalMember.startsWith(canonicalRoot + sep) ? "present" : "outside-root";
}

/**
 * Assert that every typed ProductionLeafRuntimeClosure could actually be
 * honoured by the executable repository.
 *
 * While a packet is incomplete its leaf dispatcher refuses at the proofblock
 * boundary before closure authentication, so a missing member is unreachable
 * and the packet's own confined validation cannot observe it. Publishing
 * completion moves execution past that boundary and the missing member becomes
 * a currentness refusal at the outer CLI. This projection is the
 * pre-publication reading of that post-publication failure.
 */
export function closureSatisfiability(graph: SemanticGraph, repositoryRoot: string): Readonly<Record<string, unknown>> {
  const closures = subjectsOfType(graph, productionClosureType).slice(0, maxClosures);
  const rows = closures.map((closure) => {
    const reasonCodes: string[] = [];
    const declared = singleGraphValue(graph, closure, "closureMemberCount");
    const declaredMemberCount = declared !== null && /^[0-9]{1,4}$/.test(declared) ? Number(declared) : null;
    const runtimePaths = [...new Set(objectValues(graph, closure, graphPredicate("runtimePath")))].sort().slice(0, maxClosureMembers);
    const entryModulePath = singleGraphValue(graph, closure, "entryModulePath");
    const ownerWork = singleGraphValue(graph, closure, "ownerWork");
    if (declaredMemberCount === null) reasonCodes.push("CLOSURE_MEMBER_COUNT_UNDECLARED");
    else if (declaredMemberCount !== runtimePaths.length) reasonCodes.push(`CLOSURE_MEMBER_COUNT_MISMATCH:${declaredMemberCount}:${runtimePaths.length}`);
    for (const member of runtimePaths) {
      const disposition = memberDisposition(repositoryRoot, member);
      if (disposition !== "present") reasonCodes.push(`CLOSURE_MEMBER_${disposition === "missing" ? "MISSING" : disposition === "not-regular-file" ? "NOT_REGULAR_FILE" : "OUTSIDE_ROOT"}:${member}`);
    }
    if (entryModulePath !== null && !runtimePaths.includes(entryModulePath)) reasonCodes.push(`CLOSURE_ENTRY_MODULE_NOT_A_MEMBER:${entryModulePath}`);
    return Object.freeze({
      closure, ownerWork, entryModulePath, declaredMemberCount,
      runtimePathCount: runtimePaths.length,
      satisfiable: reasonCodes.length === 0,
      reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    });
  });
  const unsatisfiable = rows.filter((row) => !row.satisfiable);
  return Object.freeze({
    status: rows.length === 0 ? "not-observed" : unsatisfiable.length === 0 ? "satisfiable" : "unsatisfiable",
    closures: rows.length,
    unsatisfiableClosures: unsatisfiable.length,
    blockedWorks: Object.freeze([...new Set(unsatisfiable.map((row) => row.ownerWork).filter((owner): owner is string => owner !== null))].sort()),
    rows: Object.freeze(rows),
  });
}

/**
 * Assert publication-policy coverage over the exact selected closure before
 * evidence derivation is attempted. Zero eligible policies make a work
 * permanently non-actionable with CONSTRUCTION_WORK_NOT_ELIGIBLE even though
 * it can still report dependencyReady with verified-completion authority.
 */
export function publicationPolicyCoverage(graph: SemanticGraph, packets: readonly WorkPacket[]): Readonly<Record<string, unknown>> {
  const eligibleByWork = (type: string): Map<string, string[]> => {
    const byWork = new Map<string, string[]>();
    for (const policy of subjectsOfType(graph, type).slice(0, maxPolicies)) {
      for (const work of objectValues(graph, policy, graphPredicate("eligibleWork"))) {
        byWork.set(work, [...(byWork.get(work) ?? []), policy].sort());
      }
    }
    return byWork;
  };
  const construction = eligibleByWork(constructionPolicyType);
  const completion = eligibleByWork(completionPolicyType);
  const rows = packets.map((packet) => {
    const constructionPolicies = construction.get(packet.id) ?? [];
    const completionPolicies = completion.get(packet.id) ?? [];
    const riskCodes: string[] = [];
    if (constructionPolicies.length === 0) riskCodes.push("CONSTRUCTION_WORK_NOT_ELIGIBLE");
    if (constructionPolicies.length > 1) riskCodes.push("CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS");
    if (completionPolicies.length === 0) riskCodes.push("WORK_COMPLETION_NOT_ELIGIBLE");
    if (completionPolicies.length > 1) riskCodes.push("WORK_COMPLETION_POLICY_AMBIGUOUS");
    for (const policy of [...constructionPolicies, ...completionPolicies]) {
      const algorithms = objectValues(graph, policy, graphPredicate("publicationAlgorithm"));
      if (algorithms.length !== 1 || !objectValues(graph, algorithms[0]!, graphPredicate("publicationPolicy")).includes(policy)) {
        riskCodes.push(`CONSTRUCTION_AUTHORITY_PUBLICATION_CHAIN_INVALID:${policy}`);
      }
    }
    return Object.freeze({
      work: packet.id,
      constructionAuthorityPolicies: Object.freeze(constructionPolicies),
      completionPolicies: Object.freeze(completionPolicies),
      riskCodes: Object.freeze([...new Set(riskCodes)].sort()),
    });
  });
  const atRisk = rows.filter((row) => row.riskCodes.length > 0);
  return Object.freeze({
    status: rows.length === 0 ? "not-observed" : atRisk.length === 0 ? "covered" : "at-risk",
    works: rows.length,
    worksAtRisk: atRisk.length,
    rows: Object.freeze(rows),
  });
}

/**
 * Project which current grants and completions a proposed policy change would
 * stale, so widening an existing policy versus adding a disjoint sibling is a
 * read-back decision rather than a trial amendment and rollback.
 *
 * Membership comes from each work's actual scoped dependency closure, not from
 * eligibleWork edges. The two differ: a policy can sit inside the closure of a
 * work it does not enumerate, and a work's own completion policy is not always
 * inside its closure. Only the closure decides what a digest move stales.
 */
/**
 * Which mechanism may write a path, and by what authority. The repository has
 * two and they authorize differently: a semantic transaction matches declared
 * path prefixes, while contract permitsWrite and work writePath govern only the
 * staged contribution chain. Resolving ownership without first asking which
 * mechanism applies produces a confident wrong answer -- "no work owns this
 * graph path" reads as a missing owner when the path was prefix-authorized all
 * along -- so this states both side by side rather than leaving it to a grep.
 */
export function writeAuthority(graph: SemanticGraph): Readonly<Record<string, unknown>> {
  const literals = (subject: string, name: string): string[] => [...new Set(
    objectsFor(graph, subject, graphPredicate(name))
      .filter((quad) => quad.objectKind === "literal")
      .map((quad) => quad.object))].sort();

  const authorityIri = "urn:usf:transaction-authority:v3:1";
  const prefixes = literals(authorityIri, "authorizedPathPrefix");
  // An authority outside the selected manifest's closure is absent, not empty.
  // Reporting no prefixes for it would read as "nothing is transactable", which
  // is the confusion this projection exists to remove.
  const authorityDeclared = graph.quads.some((quad) => quad.subject === authorityIri);
  const owners = new Map<string, { contracts: Set<string>; works: Set<string> }>();
  const record = (path: string, kind: "contracts" | "works", owner: string): void => {
    const entry = owners.get(path) ?? { contracts: new Set<string>(), works: new Set<string>() };
    entry[kind].add(owner);
    owners.set(path, entry);
  };
  for (const quad of graph.quads) {
    if (quad.objectKind !== "literal") continue;
    if (quad.predicate === graphPredicate("permitsWrite")) record(quad.object, "contracts", quad.subject);
    else if (quad.predicate === graphPredicate("writePath")) record(quad.object, "works", quad.subject);
  }

  const covered = (path: string): boolean => prefixes.some((prefix) => path.startsWith(prefix));
  const staged = [...owners.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(0, maxStagedPaths);
  return Object.freeze({
    status: "observed",
    transaction: Object.freeze({
      mechanism: "usf transact",
      authorizedBy: authorityIri,
      declared: authorityDeclared,
      pathPrefixes: Object.freeze(prefixes),
      match: "prefix",
      rule: literals(authorityIri, "rule")[0] ?? null,
      ...(authorityDeclared ? {} : {
        note: "The transaction authority is not in this manifest's closure, so no prefix is listed here. That is an absent declaration, not an empty one: select a manifest whose closure includes the graph declaring it before concluding a path is not transactable.",
      }),
    }),
    stagedChain: Object.freeze({
      mechanism: "usf call -> resolve -> apply -> check -> integrate",
      authorizedBy: "contract permitsWrite and work writePath",
      match: "exact path, or prefix when the declared value ends in /",
      declaredPathCount: owners.size,
      paths: Object.freeze(staged.map(([path, entry]) => Object.freeze({
        path,
        contracts: Object.freeze([...entry.contracts].sort()),
        works: Object.freeze([...entry.works].sort()),
        alsoTransactable: covered(path),
      }))),
      truncated: owners.size > staged.length,
    }),
    // The two sets genuinely differ, and that difference is the whole point.
    transactableWithNoStagedOwner: Object.freeze(prefixes.filter(
      (prefix) => ![...owners.keys()].some((path) => path.startsWith(prefix)))),
    nonClaim: "a-writable-path-is-not-an-authorized-change-the-mechanism-still-gates-it",
  });
}

export function policyBlastRadius(graph: SemanticGraph, packets: readonly WorkPacket[]): Readonly<Record<string, unknown>> {
  const policies = [...new Set([...subjectsOfType(graph, constructionPolicyType), ...subjectsOfType(graph, completionPolicyType)])].sort().slice(0, maxPolicies);
  const rows = policies.map((policy) => {
    const stales: { work: string; stage: string; currentAuthority: string }[] = [];
    for (const packet of packets) {
      if (!(packet.realisationBasis?.work.dependencies ?? []).some((dependency) => dependency.key === policy)) continue;
      const currentAuthority = packet.realisationStage?.completion?.verified === true
        ? "verified-completion"
        : packet.eligibility?.construction.authority === "active-permission"
          ? "construction-grant"
          : "none";
      if (currentAuthority !== "none") stales.push({ work: packet.id, stage: packet.realisationStage?.stage ?? "unknown", currentAuthority });
    }
    stales.sort((left, right) => left.work.localeCompare(right.work));
    return Object.freeze({
      policy,
      policyResourceDigest: resourceDigest(graph, policy),
      eligibleWork: Object.freeze(objectValues(graph, policy, graphPredicate("eligibleWork"))),
      stalesOnChange: Object.freeze(stales.map((entry) => Object.freeze(entry))),
      currentGrantsAtRisk: stales.filter((entry) => entry.currentAuthority === "construction-grant").length,
      currentCompletionsAtRisk: stales.filter((entry) => entry.currentAuthority === "verified-completion").length,
    });
  });
  return Object.freeze({
    status: rows.length === 0 ? "not-observed" : "observed",
    derivation: "scoped-dependency-closure-membership",
    policies: rows.length,
    rows: Object.freeze(rows),
  });
}

function repositoryObservation(repositoryRoot: string): Readonly<Record<string, unknown>> {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD^{commit}"], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const tree = execFileSync("git", ["rev-parse", `${commit}^{tree}`], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = spawnSync("git", ["diff-index", "--quiet", "HEAD", "--"], { cwd: repositoryRoot, stdio: "ignore" });
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tree) || ![0, 1].includes(dirty.status ?? -1)) throw new Error("repository-observation-invalid");
    return Object.freeze({ status: "observed", commit, tree, trackedTreeClean: dirty.status === 0, remoteContact: false });
  } catch {
    throw new UsfError("STATUS_REPOSITORY_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "Local Git carrier status is unavailable.");
  }
}

/** One bounded local git read that never contacts a remote. */
function gitValue(repositoryRoot: string, args: readonly string[]): string | null {
  try {
    const value = execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return value.length === 0 || value.length > 512 ? null : value;
  } catch { return null; }
}

/**
 * Locate the authoritative carrier for this checkout without shell archaeology
 * and without guessing.
 *
 * This observes exactly one checkout. Comparing a primary against a sibling
 * clone is the caller's composition over two invocations; inventing that
 * comparison from one root would be a guess. Upstream distance is read from
 * already-fetched local remote-tracking refs only, so it is honest about
 * staleness and contacts nothing. Absent upstream information is reported as
 * not-observed with a reason code, never as "up to date".
 */
function carrierObservation(repositoryRoot: string, semanticDigest: string | null): Readonly<Record<string, unknown>> {
  const gitDir = gitValue(repositoryRoot, ["rev-parse", "--git-dir"]);
  const commonDir = gitValue(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  const insideWorktree = gitValue(repositoryRoot, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const detached = gitValue(repositoryRoot, ["symbolic-ref", "--quiet", "HEAD"]) === null;
  const branch = detached ? null : gitValue(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const originConfigured = gitValue(repositoryRoot, ["config", "--get", "remote.origin.url"]) !== null;
  const worktreeKind = gitDir === null || commonDir === null
    ? "unknown"
    : gitDir === commonDir ? "main-worktree" : "linked-worktree";

  const upstreamRef = detached ? null : gitValue(repositoryRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  let upstream: Readonly<Record<string, unknown>>;
  if (upstreamRef === null) {
    upstream = Object.freeze({
      status: "not-observed",
      ref: null,
      ahead: null,
      behind: null,
      reasonCode: detached ? "CARRIER_HEAD_DETACHED" : "CARRIER_UPSTREAM_NOT_CONFIGURED",
      observedFromLocalRefsOnly: true,
      remoteContact: false,
    });
  } else {
    const counts = gitValue(repositoryRoot, ["rev-list", "--left-right", "--count", `HEAD...${upstreamRef}`]);
    const parsed = counts === null ? null : /^([0-9]{1,9})\s+([0-9]{1,9})$/.exec(counts);
    upstream = parsed === null
      ? Object.freeze({ status: "not-observed", ref: upstreamRef, ahead: null, behind: null, reasonCode: "CARRIER_UPSTREAM_REF_UNREADABLE", observedFromLocalRefsOnly: true, remoteContact: false })
      : Object.freeze({ status: "observed", ref: upstreamRef, ahead: Number(parsed[1]), behind: Number(parsed[2]), reasonCode: null, observedFromLocalRefsOnly: true, remoteContact: false });
  }

  return Object.freeze({
    status: insideWorktree ? "observed" : "not-observed",
    worktreeKind,
    headDetached: detached,
    branch,
    originConfigured,
    semanticDigest,
    upstream,
    comparisonScope: "this-checkout-only",
    remoteContact: false,
  });
}

async function providerObservation(repositoryRoot: string): Promise<Readonly<Record<string, unknown>>> {
  const path = resolve(repositoryRoot, "config/providers.json");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > 64 * 1024) {
    throw new UsfError("STATUS_PROVIDERS_INVALID", exitCodes.CONTAINMENT_REFUSAL, "The configured provider source is not a bounded regular file.");
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new UsfError("STATUS_PROVIDERS_INVALID", exitCodes.INVALID_INPUT, "The configured provider source is invalid JSON."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (value as Record<string, unknown>).$schema !== "urn:usf:providers:1"
    || (value as Record<string, unknown>).catalogueSource !== "models.dev"
    || !Array.isArray((value as Record<string, unknown>).routes)) {
    throw new UsfError("STATUS_PROVIDERS_INVALID", exitCodes.INVALID_INPUT, "The configured provider source does not satisfy its bootstrap shape.");
  }
  const configuredRoutes = ((value as Record<string, unknown>).routes as unknown[]).length;
  return Object.freeze({
    status: "observed",
    configuredRoutes,
    configuredRoutesDenominator: "entries-in-config/providers.json",
    configuredProviderCount: null,
    actualProviderCount: null,
    actualModelCount: null,
    eligibility: "not-probed",
    reasonCode: configuredRoutes === 0 ? "PROVIDER_ROUTES_EMPTY" : "PROVIDER_DETAIL_NOT_SELECTED",
    detailCommand: "usf providers status",
    remoteContact: false,
  });
}

async function metricsSourceObservation(repositoryRoot: string): Promise<Readonly<Record<string, unknown>>> {
  const path = resolve(repositoryRoot, ".usf/metrics/events.jsonl");
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return Object.freeze({ status: "refused", source: ".usf/metrics/events.jsonl", reasonCode: "METRICS_SOURCE_UNSAFE" });
    return Object.freeze({ status: "available", source: ".usf/metrics/events.jsonl", bytes: metadata.size, aggregation: "run-usf-metrics", historyScanned: false });
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({ status: "not-observed", source: ".usf/metrics/events.jsonl", reasonCode: "METRICS_SOURCE_MISSING", historyScanned: false });
    }
    throw error;
  }
}

function semanticObservation(repositoryRoot: string, parsed: StatusArguments): Readonly<Record<string, unknown>> {
  if (parsed.profile === undefined || parsed.manifest === undefined) {
    return Object.freeze({ status: "not-selected", reasonCode: "STATUS_PROFILE_NOT_SELECTED", selectionRequired: ["--profile", "--manifest"] });
  }
  let work;
  try { work = deriveWork(loadSemanticGraph(repositoryRoot, parsed.manifest), { selector: `profile:${parsed.profile}`, maxItems: parsed.maxItems }); }
  catch (error) {
    const stable = error instanceof UsfError
      ? error.code
      : error instanceof Error
        ? /^([A-Z][A-Z0-9_]{1,95})(?::|$)/.exec(error.message)?.[1] ?? "GRAPH_LOAD_FAILED"
        : "GRAPH_LOAD_FAILED";
    throw new UsfError("STATUS_SEMANTIC_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The explicitly selected semantic status could not be derived.", { reasonCode: stable });
  }
  if (work.status !== "ok" || work.items === undefined || work.semanticDigest === undefined || work.truncation === undefined) {
    throw new UsfError("STATUS_SEMANTIC_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "The explicitly selected semantic status was refused.", { reasonCode: work.reasonCode ?? "WORK_DERIVATION_REFUSED" });
  }
  return Object.freeze({
    status: "observed",
    profile: parsed.profile,
    manifest: parsed.manifest,
    semanticDigest: work.semanticDigest,
    work: {
      returned: work.items.length,
      maxItems: work.truncation.maxItems,
      truncated: work.truncation.truncated,
      ...(parsed.detail === "full" ? { ids: work.items.map((item) => item.id) } : {}),
      ready: null,
      completion: "not-observed",
    },
  });
}

async function broadStatus(repositoryRoot: string, args: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseStatusArguments(args);
  const [lifecycle, providers, metrics] = await Promise.all([
    observeLifecycleStatus(repositoryRoot, parsed.instance),
    providerObservation(repositoryRoot),
    metricsSourceObservation(repositoryRoot),
  ]);
  const semantic = semanticObservation(repositoryRoot, parsed);
  const selectedGraph = parsed.profile === undefined || parsed.manifest === undefined
    ? null
    : loadSemanticGraph(repositoryRoot, parsed.manifest);
  const selectedPackets = selectedGraph === null
    ? []
    : deriveWork(selectedGraph, { selector: `profile:${parsed.profile!}`, maxItems: parsed.maxItems }).items ?? [];
  const notSelected = Object.freeze({ status: "not-selected", reasonCode: "STATUS_PROFILE_NOT_SELECTED", selectionRequired: ["--profile", "--manifest"] });
  const unobserved = [
    ...(semantic.status === "not-selected" ? ["semantic", "work", "closure-satisfiability", "publication-policy-coverage", "policy-blast-radius", "write-authority"] : []),
    "active-chains",
    "eligible-routes",
    "throughput",
    "latest-checks",
    "integration-queue",
    "terminal-proof",
  ];
  return Object.freeze({
    schema: "urn:usf:status-result:1",
    version: 1,
    status: "observed",
    detail: parsed.detail,
    repository: repositoryObservation(repositoryRoot),
    carrier: carrierObservation(repositoryRoot, typeof semantic.semanticDigest === "string" ? semantic.semanticDigest : null),
    semantic,
    closureSatisfiability: selectedGraph === null ? notSelected : closureSatisfiability(selectedGraph, repositoryRoot),
    publicationPolicyCoverage: selectedGraph === null ? notSelected : publicationPolicyCoverage(selectedGraph, selectedPackets),
    policyBlastRadius: selectedGraph === null ? notSelected : policyBlastRadius(selectedGraph, selectedPackets),
    writeAuthority: selectedGraph === null ? notSelected : writeAuthority(selectedGraph),
    lifecycle,
    providers,
    metrics,
    checks: { status: "not-observed" },
    integrationQueue: { status: "not-observed" },
    terminalProof: { status: "not-evaluated" },
    coverage: { complete: unobserved.length === 0, unobserved },
    externalContact: false,
    authorityEffect: "none",
    nonclaims: statusNonclaims,
  });
}

export const broadStatusCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  // Compatibility for the initial lifecycle slice. The explicit noun is the
  // stable spelling; `status --instance NAME` remains a lifecycle-only alias.
  if (args[0] === "lifecycle" || (args.length === 2 && args[0] === "--instance")) {
    const lifecycleArgs = args[0] === "lifecycle" ? args.slice(1) : args;
    if (lifecycleArgs.length !== 0 && (lifecycleArgs.length !== 2 || lifecycleArgs[0] !== "--instance")) {
      throw new UsfError("STATUS_LIFECYCLE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Lifecycle status accepts only --instance.");
    }
    const instance = validateInstanceSlug(lifecycleArgs[1] ?? "default");
    return { output: await observeLifecycleStatus(repositoryRoot, instance), exitCode: exitCodes.SUCCESS };
  }
  return { output: await broadStatus(repositoryRoot, args), exitCode: exitCodes.SUCCESS };
};
