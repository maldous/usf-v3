import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";
import { canonicalDigest, sha256 } from "../core/canonical.ts";
import { objectValues, objectsFor, resourceDigest, transitiveResourceIris, type SemanticGraph } from "./index.ts";
import { contractNonClaims, contractWrites, type Dependency } from "./query.ts";

const typePredicate = "urn:usf:predicate:type";
const workType = "urn:usf:type:WorkPacket";
const contractType = "urn:usf:type:SemanticContract";
const profileType = "urn:usf:type:RealisationProfile";
const artifactRequirementType = "urn:usf:type:ArtifactRequirement";
const environmentApplicabilityType = "urn:usf:type:EnvironmentApplicability";
const predicate = (name: string) => `urn:usf:predicate:${name}`;
const applicabilityStates = ["required", "not-required", "conditional", "reserved", "unresolved"] as const;
const privacyClasses = ["public", "private-metadata", "private-source", "restricted"] as const;

export type Applicability = typeof applicabilityStates[number];
export type PrivacyClassification = typeof privacyClasses[number];

export interface RequirementProjection {
  id: string;
  types: string[];
  fields: Array<{ predicate: string; value: string; valueKind: "iri" | "literal" }>;
}

export interface ArtifactProjection {
  id: string;
  artifactKind: string;
  mediaType: string;
  targetPath: string;
  modelCapabilities: string[];
}

export interface DecisionBoundary {
  kind: "unscoped" | "contract" | "work" | "realisation-profile";
  root: string | null;
}

export interface WorkPacket {
  schema: "urn:usf:work-packet:1";
  id: string;
  contract: string;
  decisionBoundary: DecisionBoundary;
  objective: string;
  dependsOn: string[];
  semanticDependencies: Dependency[];
  readSet: string[];
  writeSet: string[];
  constraints: string[];
  requirements: RequirementProjection[];
  artifacts: ArtifactProjection[];
  acceptanceCriteria: Array<{ id: string; text: string }>;
  validationPlan: Array<{ id: string; command: string; environment: string; executionMode: string; applicability: Applicability }>;
  proofObligations: Array<{ id: string; text: string; environment: string; executionMode: string; applicability: Applicability }>;
  modelCapabilities: string[];
  constructionRouteConstraints: string[];
  targetRuntimeProvider: string;
  privacy: PrivacyClassification;
  environmentPosture: Array<{ binding?: string; environment: string; applicability: Applicability }>;
  outputSchema: string;
  stopConditions: string[];
  scopedDependencyDigest: string;
}

export interface WorkOptions { selector?: string; ready?: boolean; maxItems?: number; shard?: string; stream?: boolean; accepted?: Iterable<string>; }
export interface WorkResult { schema: "urn:usf:work-result:1"; status: "ok" | "refused"; reasonCode?: string; semanticDigest?: string; outputMode?: "json" | "jsonl"; items?: WorkPacket[]; truncation?: { maxItems: number; returnedItems: number; truncated: boolean }; }

function refuse(reason: string): never { throw new Error(reason); }

function one(graph: SemanticGraph, subject: string, name: string): string {
  const values = objectValues(graph, subject, predicate(name));
  if (values.length !== 1) refuse(`WORK_PACKET_${name.toUpperCase()}_INVALID:${subject}`);
  return values[0];
}

function applicability(graph: SemanticGraph, subject: string): Applicability {
  const value = one(graph, subject, "applicability");
  if (!applicabilityStates.includes(value as Applicability)) refuse(`APPLICABILITY_INVALID:${subject}`);
  return value as Applicability;
}

function descriptions(graph: SemanticGraph, iris: string[], name: string): Array<{ id: string; text: string }> {
  return iris.map((id) => ({ id, text: one(graph, id, name) }));
}

function requirementProjections(graph: SemanticGraph, ids: string[]): RequirementProjection[] {
  return ids.map((id) => ({
    id,
    types: objectValues(graph, id, typePredicate),
    fields: objectsFor(graph, id)
      .map((quad) => ({ predicate: quad.predicate, value: quad.object, valueKind: quad.objectKind }))
      .sort((left, right) => `${left.predicate}|${left.valueKind}|${left.value}`.localeCompare(`${right.predicate}|${right.valueKind}|${right.value}`)),
  }));
}

function artifactProjections(graph: SemanticGraph, requirements: RequirementProjection[], writeSet: string[]): ArtifactProjection[] {
  return requirements.filter((requirement) => requirement.types.includes(artifactRequirementType)).map((requirement) => {
    const targetPath = repositoryPath(one(graph, requirement.id, "targetPath"), "ARTIFACT_TARGET");
    if (!writeSet.includes(targetPath)) refuse(`ARTIFACT_TARGET_NOT_IN_WRITE_SET:${requirement.id}:${targetPath}`);
    const modelCapabilities = objectValues(graph, requirement.id, predicate("modelCapability"));
    if (modelCapabilities.length === 0) refuse(`ARTIFACT_MODEL_CAPABILITY_REQUIRED:${requirement.id}`);
    return {
      id: requirement.id,
      artifactKind: one(graph, requirement.id, "artifactKind"),
      mediaType: one(graph, requirement.id, "mediaType"),
      targetPath,
      modelCapabilities,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
}

/** Concrete files and explicitly slash-terminated directories only; patterns are never pre-images. */
function repositoryPath(value: string, role: string): string {
  if (value.length === 0 || value === "." || value.includes("\\") || value.includes("\0") || value.startsWith("/") || value.startsWith("./") || /[*?\[\]{}!]/.test(value)) {
    return refuse(`WORK_${role}_PATH_INVALID:${value}`);
  }
  const directory = value.endsWith("/");
  const segments = value.slice(0, directory ? -1 : undefined).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return refuse(`WORK_${role}_PATH_INVALID:${value}`);
  if (posix.normalize(value) !== value) return refuse(`WORK_${role}_PATH_INVALID:${value}`);
  const first = segments[0];
  if (first === ".git" || first === ".usf" || first === ".env" || segments.some((segment) => segment === ".env")) return refuse(`WORK_${role}_PATH_PROHIBITED:${value}`);
  return value;
}

function directoryEntries(root: string, declaredPath: string): Array<{ path: string; digest: string }> {
  const walk = (directory: string): Array<{ path: string; digest: string }> => readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) return refuse(`WORK_DEPENDENCY_SYMLINK_REFUSED:${declaredPath}`);
      if (entry.isDirectory()) return walk(child);
      if (!entry.isFile()) return refuse(`WORK_DEPENDENCY_SPECIAL_FILE_REFUSED:${declaredPath}`);
      return [{ path: relative(root, child).split(sep).join("/"), digest: sha256(readFileSync(child)) }];
    });
  return walk(resolve(root, declaredPath));
}

function pathDigest(root: string, declaredPath: string, missingAllowed: boolean): string {
  const absolute = resolve(root, declaredPath);
  if (!isContained(root, absolute)) return refuse(`WORK_DEPENDENCY_PATH_ESCAPE:${declaredPath}`);
  if (!existsSync(absolute)) {
    if (!missingAllowed) return refuse(`WORK_DEPENDENCY_MISSING:${declaredPath}`);
    return sha256(`missing\u0000${declaredPath}`);
  }
  const real = realpathSync(absolute);
  if (!isContained(root, real)) return refuse(`WORK_DEPENDENCY_SYMLINK_ESCAPE:${declaredPath}`);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return refuse(`WORK_DEPENDENCY_SYMLINK_REFUSED:${declaredPath}`);
  if (declaredPath.endsWith("/") && !stat.isDirectory()) return refuse(`WORK_DIRECTORY_EXPECTED:${declaredPath}`);
  if (!declaredPath.endsWith("/") && stat.isDirectory()) return refuse(`WORK_FILE_EXPECTED:${declaredPath}`);
  if (stat.isDirectory()) return canonicalDigest(directoryEntries(root, declaredPath));
  if (!stat.isFile()) return refuse(`WORK_DEPENDENCY_SPECIAL_FILE_REFUSED:${declaredPath}`);
  return sha256(readFileSync(absolute));
}

function declaredPaths(graph: SemanticGraph, subjects: string[], name: "policyPath" | "schemaPath" | "toolPath"): string[] {
  return [...new Set(subjects.flatMap((subject) => objectValues(graph, subject, predicate(name))).map((path) => repositoryPath(path, name.toUpperCase())))].sort();
}

function fileDependency(graph: SemanticGraph, path: string, kind: Dependency["kind"], missingAllowed: boolean): Dependency {
  return { key: path, digest: pathDigest(graph.repositoryRoot, path, missingAllowed), kind };
}

function uniqueDependencies(dependencies: Dependency[]): Dependency[] {
  const byIdentity = new Map<string, Dependency>();
  for (const dependency of dependencies) {
    const identity = `${dependency.kind}|${dependency.key}`;
    const previous = byIdentity.get(identity);
    if (previous !== undefined && previous.digest !== dependency.digest) refuse(`WORK_DEPENDENCY_CONFLICT:${dependency.key}`);
    byIdentity.set(identity, dependency);
  }
  return [...byIdentity.values()].sort((left, right) => `${left.kind}|${left.key}`.localeCompare(`${right.kind}|${right.key}`));
}

function projectEnvironmentPosture(graph: SemanticGraph, contract: string): WorkPacket["environmentPosture"] {
  const bindings = objectValues(graph, contract, predicate("environmentApplicability"));
  if (bindings.length === 0) return refuse(`CONTRACT_ENVIRONMENT_APPLICABILITY_REQUIRED:${contract}`);
  const environments = new Set<string>();
  return bindings.map((binding) => {
    const typed = objectsFor(graph, binding, typePredicate).some((quad) => quad.objectKind === "iri" && quad.object === environmentApplicabilityType);
    if (!typed) return refuse(`ENVIRONMENT_APPLICABILITY_TYPE_INVALID:${binding}`);
    const environment = one(graph, binding, "environment");
    if (environments.has(environment)) return refuse(`ENVIRONMENT_APPLICABILITY_DUPLICATE:${contract}:${environment}`);
    environments.add(environment);
    return { binding, environment, applicability: applicability(graph, binding) };
  }).sort((left, right) => left.environment.localeCompare(right.environment));
}

function obligation(
  graph: SemanticGraph,
  id: string,
  textPredicate: "text" | "command",
  postures: WorkPacket["environmentPosture"],
): { id: string; environment: string; executionMode: string; applicability: Applicability; text?: string; command?: string } {
  const environment = one(graph, id, "environment");
  if (!postures.some((posture) => posture.environment === environment)) refuse(`OBLIGATION_ENVIRONMENT_NOT_BOUND:${id}`);
  return { id, [textPredicate]: one(graph, id, textPredicate), environment, executionMode: one(graph, id, "executionMode"), applicability: applicability(graph, id) };
}

function isPermittedWrite(write: string, permits: string[]): boolean {
  return permits.some((permission) => permission === write || (permission.endsWith("/") && write.startsWith(permission)));
}

/** Generic kernel projection: work packets are discovered solely by typed graph data. */
export function semanticWorkPackets(graph: SemanticGraph): string[] {
  return [...new Set(graph.quads.filter((quad) => quad.predicate === typePredicate && quad.object === workType).map((quad) => quad.subject))].sort();
}

function packetFor(graph: SemanticGraph, id: string, decisionBoundary: DecisionBoundary): WorkPacket {
  const contract = one(graph, id, "contract");
  const readSet = objectValues(graph, id, predicate("readPath")).map((path) => repositoryPath(path, "READ")).sort();
  const writeSet = objectValues(graph, id, predicate("writePath")).map((path) => repositoryPath(path, "WRITE")).sort();
  const permits = contractWrites(graph, contract).map((path) => repositoryPath(path, "PERMITTED_WRITE"));
  for (const write of writeSet) if (!isPermittedWrite(write, permits)) refuse(`WORK_WRITE_NOT_PERMITTED:${id}:${write}`);

  const acceptanceIds = objectValues(graph, id, predicate("acceptance"));
  const validationIds = objectValues(graph, id, predicate("validation"));
  const proofIds = objectValues(graph, id, predicate("proof"));
  const requirementIds = objectValues(graph, contract, predicate("requires"));
  const requirements = requirementProjections(graph, requirementIds);
  const artifacts = artifactProjections(graph, requirements, writeSet);
  const postures = projectEnvironmentPosture(graph, contract);
  const policyPaths = declaredPaths(graph, [contract, id], "policyPath");
  const schemaPaths = declaredPaths(graph, [contract, id], "schemaPath");
  const toolPaths = declaredPaths(graph, [contract, id], "toolPath");
  const resourceSeeds = [id, contract, ...requirementIds, ...acceptanceIds, ...validationIds, ...proofIds, ...postures.flatMap((posture) => posture.binding === undefined ? [posture.environment] : [posture.binding, posture.environment])];
  const resources = transitiveResourceIris(graph, resourceSeeds);
  // A profile digest binds its exact selection policy, but its other selected
  // contracts are sibling roots rather than dependencies of this packet.
  if (decisionBoundary.kind === "realisation-profile" && decisionBoundary.root !== null) {
    resources.push(decisionBoundary.root, ...objectValues(graph, decisionBoundary.root, predicate("product")));
  }
  resources.sort();
  const dependencies = uniqueDependencies([
    ...resources.map((key): Dependency => ({ key, digest: resourceDigest(graph, key), kind: "semantic-resource" })),
    ...readSet.map((path) => fileDependency(graph, path, "file", false)),
    ...writeSet.map((path) => fileDependency(graph, path, "file", true)),
    ...policyPaths.map((path) => fileDependency(graph, path, "policy", false)),
    ...schemaPaths.map((path) => fileDependency(graph, path, "schema", false)),
    ...toolPaths.map((path) => fileDependency(graph, path, "tool", false)),
  ]);

  const modelCapabilities = [...new Set([
    ...objectValues(graph, contract, predicate("modelCapability")),
    ...objectValues(graph, id, predicate("modelCapability")),
    ...artifacts.flatMap((artifact) => artifact.modelCapabilities),
  ])].sort();
  if (modelCapabilities.length === 0) refuse(`MODEL_CAPABILITY_REQUIRED:${id}`);
  const privacy = one(graph, contract, "privacy");
  if (!privacyClasses.includes(privacy as PrivacyClassification)) refuse(`PRIVACY_CLASSIFICATION_INVALID:${contract}`);

  const validationPlan = validationIds.map((validationId) => obligation(graph, validationId, "command", postures)) as WorkPacket["validationPlan"];
  const proofObligations = proofIds.map((proofId) => obligation(graph, proofId, "text", postures)) as WorkPacket["proofObligations"];
  return {
    schema: "urn:usf:work-packet:1",
    id,
    contract,
    decisionBoundary,
    objective: one(graph, id, "objective"),
    dependsOn: objectValues(graph, id, predicate("dependsOn")),
    semanticDependencies: dependencies,
    readSet,
    writeSet,
    constraints: contractNonClaims(graph, contract),
    requirements,
    artifacts,
    acceptanceCriteria: descriptions(graph, acceptanceIds, "text"),
    validationPlan,
    proofObligations,
    modelCapabilities,
    constructionRouteConstraints: [...new Set([...objectValues(graph, contract, predicate("constructionRouteConstraint")), ...objectValues(graph, id, predicate("constructionRouteConstraint"))])].sort(),
    targetRuntimeProvider: one(graph, contract, "targetRuntimeProvider"),
    privacy: privacy as PrivacyClassification,
    environmentPosture: postures,
    outputSchema: one(graph, id, "outputSchema"),
    stopConditions: ["Refuse any write outside writeSet.", "Stop when focused validation passes or a declared constraint is contradicted."],
    scopedDependencyDigest: canonicalDigest(dependencies),
  };
}

function validLimit(value: number | undefined): number | undefined { return value === undefined ? 20 : Number.isSafeInteger(value) && value > 0 && value <= 100 ? value : undefined; }

interface WorkSelection { ids: string[]; decisionBoundary: DecisionBoundary; }

function select(graph: SemanticGraph, selector?: string): WorkSelection | undefined {
  if (selector === undefined || selector === "all") return { ids: semanticWorkPackets(graph), decisionBoundary: { kind: "unscoped", root: null } };
  if (selector.startsWith("contract:")) {
    const contract = selector.slice("contract:".length);
    const exists = graph.quads.some((quad) => quad.subject === contract && quad.predicate === typePredicate && quad.object === contractType);
    return exists ? { ids: semanticWorkPackets(graph).filter((id) => objectValues(graph, id, predicate("contract")).includes(contract)), decisionBoundary: { kind: "contract", root: contract } } : undefined;
  }
  if (selector.startsWith("profile:")) {
    const profile = selector.slice("profile:".length);
    const typed = graph.quads.some((quad) => quad.subject === profile && quad.predicate === typePredicate && quad.object === profileType);
    if (!typed) return undefined;
    const contracts = objectValues(graph, profile, predicate("selectsContract"));
    if (contracts.length === 0 || objectValues(graph, profile, predicate("product")).length !== 1) refuse(`REALISATION_PROFILE_INVALID:${profile}`);
    if (one(graph, profile, "adoptionPolicy") !== "explicit-semantic-delta" || one(graph, profile, "reconstructionPolicy") !== "exact-closure-or-block") refuse(`REALISATION_PROFILE_POLICY_INVALID:${profile}`);
    const excluded = new Set(objectValues(graph, profile, predicate("excludesContract")));
    if (contracts.some((contract) => excluded.has(contract))) refuse(`REALISATION_PROFILE_CONTRADICTION:${profile}`);
    for (const contract of contracts) if (!graph.quads.some((quad) => quad.subject === contract && quad.predicate === typePredicate && quad.object === contractType)) refuse(`REALISATION_PROFILE_CONTRACT_UNKNOWN:${profile}:${contract}`);
    const ids = semanticWorkPackets(graph).filter((id) => objectValues(graph, id, predicate("contract")).some((contract) => contracts.includes(contract)));
    const selectedIds = new Set(ids);
    for (const id of ids) {
      for (const dependency of objectValues(graph, id, predicate("dependsOn"))) {
        if (!selectedIds.has(dependency)) refuse(`REALISATION_PROFILE_DEPENDENCY_NOT_SELECTED:${profile}:${id}:${dependency}`);
      }
    }
    return {
      ids,
      decisionBoundary: { kind: "realisation-profile", root: profile },
    };
  }
  return semanticWorkPackets(graph).includes(selector) ? { ids: [selector], decisionBoundary: { kind: "work", root: selector } } : undefined;
}

function shardIds(ids: string[], shard: string | undefined): string[] | undefined {
  if (shard === undefined) return ids;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  if (!match) return undefined;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total < 1 || index < 1 || index > total) return undefined;
  return ids.filter((_, position) => position % total === index - 1);
}

function validateWorkDag(graph: SemanticGraph, selectedIds: string[]): void {
  const all = new Set(semanticWorkPackets(graph));
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const cycleStart = visiting.indexOf(id);
    if (cycleStart >= 0) refuse(`WORK_DEPENDENCY_CYCLE:${[...visiting.slice(cycleStart), id].join("->")}`);
    if (!all.has(id)) refuse(`WORK_DEPENDENCY_UNRESOLVED:${id}`);
    visiting.push(id);
    for (const dependency of objectValues(graph, id, predicate("dependsOn"))) visit(dependency);
    visiting.pop();
    visited.add(id);
  };
  for (const id of selectedIds) visit(id);
}

/** Derive only declared work; no inferred or ticket-backed work is fabricated. */
export function deriveWork(graph: SemanticGraph, options: WorkOptions = {}): WorkResult {
  const maxItems = validLimit(options.maxItems);
  if (maxItems === undefined) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "WORK_MAX_ITEMS_INVALID" };
  const selection = select(graph, options.selector);
  if (selection === undefined) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "WORK_SELECTOR_UNKNOWN" };
  validateWorkDag(graph, selection.ids);
  const sharded = shardIds(selection.ids, options.shard);
  if (sharded === undefined) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "WORK_SHARD_INVALID" };
  const accepted = new Set(options.accepted ?? []);
  const selected = options.ready ? sharded.filter((id) => !accepted.has(id) && objectValues(graph, id, predicate("dependsOn")).every((dependency) => accepted.has(dependency))) : sharded;
  const items = selected.slice(0, maxItems).map((id) => packetFor(graph, id, selection.decisionBoundary));
  return { schema: "urn:usf:work-result:1", status: "ok", semanticDigest: graph.semanticDigest, outputMode: options.stream ? "jsonl" : "json", items, truncation: { maxItems, returnedItems: items.length, truncated: selected.length > items.length } };
}

export function isWorkPacketFresh(packet: WorkPacket, current: Iterable<Dependency>): boolean {
  const digestByKey = new Map([...current].map((dependency) => [`${dependency.kind}|${dependency.key}`, dependency.digest]));
  return packet.semanticDependencies.every((dependency) => digestByKey.get(`${dependency.kind}|${dependency.key}`) === dependency.digest);
}

/** Only required applicability is satisfiable; silence and every other state fail closed. */
export function canSatisfyEnvironment(packet: WorkPacket, environment: string): boolean {
  return packet.environmentPosture.some((posture) => posture.environment === environment && posture.applicability === "required");
}

export function contractPermittedWrites(graph: SemanticGraph, contract: string): string[] { return contractWrites(graph, contract); }
