import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { parseRepositoryPath } from "../core/scope.ts";
import { loadSemanticGraph, objectValues, resourceDigest } from "../graph/index.ts";
import { deriveLinearBindingDeclaration } from "../graph/linear-binding.ts";
import { deriveWork, type WorkPacket } from "../graph/work.ts";
import { authenticateCandidateWorkspace, inspectCandidateIntegrationRecovery } from "../realisation/index.ts";
import { readLinearRecord, writeLinearRecord, type LinearRecordValue } from "./linear-state.ts";
import type { LinearBindingResult } from "./linear-binding.ts";
import type { PublicationCheckpoint, PublicationEffect } from "./construction-authority.ts";

const policyIri = "urn:usf:policy:linear-construction-continuation:1";
const controllerManifest = "graph/manifests/hermes-linear-autonomy.json";
const controllerProfile = "urn:usf:profile:hermes-linear-autonomy:1";
const controllerWork = "urn:usf:work:hermes-linear-autonomy";
const controllerPolicy = "urn:usf:policy:hermes-linear-transport:1";
const selectedWork = "urn:usf:work:cli-provider-qualification-help";
const selectedProfile = "urn:usf:profile:cli-provider-qualification-help:1";
const selectedManifest = "graph/manifests/cli-provider-qualification-help.json";
const changedPath = "src/commands/help.ts";
const acceptancePath = "tests/fixtures/cli-provider-qualification-help.acceptance.ts";
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const pointerKey = "metadata-continuation-" + canonicalDigest({ policyIri }).slice(7);
const predicate = (name: string): string => "urn:usf:predicate:" + name;
const maximumFiles = 1024;

function refuse(code: string): never {
  throw Object.assign(new Error(code), { reasonCode: code });
}
function same(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }
function digest(value: unknown): string {
  if (typeof value !== "string" || !digestPattern.test(value)) refuse("LINEAR_CONTINUATION_DIGEST_INVALID");
  return value;
}

/** Closed data grammar, not a TypeScript evaluator or a general impact waiver. */
class HelpLiteralReader {
  offset = 0;
  private nodes = 0;
  private readonly source: string;
  constructor(source: string) { this.source = source; }
  space(): void { while (/[ \t\r\n]/u.test(this.source[this.offset] ?? "") && this.offset < this.source.length) this.offset++; }
  take(text: string): void {
    this.space();
    if (!this.source.startsWith(text, this.offset)) refuse("LINEAR_CONTINUATION_METADATA_GRAMMAR");
    this.offset += text.length;
  }
  string(): string {
    this.space();
    const match = /^"(?:[^"\\\x00-\x1f\x7f\u2028\u2029]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/u.exec(this.source.slice(this.offset));
    if (match === null || match[0].length > 8192 || ++this.nodes > 256) refuse("LINEAR_CONTINUATION_METADATA_GRAMMAR");
    const value: unknown = JSON.parse(match[0]);
    if (typeof value !== "string" || /[\x00-\x1f\x7f\u2028\u2029]/u.test(value)) refuse("LINEAR_CONTINUATION_METADATA_GRAMMAR");
    this.offset += match[0].length;
    return value;
  }
  array<T>(read: () => T): T[] {
    this.take("[");
    const result: T[] = [];
    for (let index = 0; index <= 64; index++) {
      this.space();
      if (this.source[this.offset] === "]") { this.offset++; return result; }
      if (index === 64) refuse("LINEAR_CONTINUATION_METADATA_BOUNDS");
      result.push(read());
      this.space();
      if (this.source[this.offset] === "]") { this.offset++; return result; }
      this.take(",");
    }
    return refuse("LINEAR_CONTINUATION_METADATA_BOUNDS");
  }
  fields(): { purpose: string; synopsis: string[]; options: unknown[] } {
    this.take("purpose"); this.take(":"); const purpose = this.string(); this.take(",");
    this.take("synopsis"); this.take(":"); const synopsis = this.array(() => this.string()); this.take(",");
    this.take("options"); this.take(":");
    let identities = 0;
    const options = this.array(() => {
      this.space();
      if (this.source.startsWith("envFileOption", this.offset)) {
        this.offset += "envFileOption".length; identities++;
        return { reference: "envFileOption" };
      }
      this.take("{"); this.take("syntax"); this.take(":"); const syntax = this.string();
      this.take(","); this.take("description"); this.take(":"); const description = this.string();
      this.space(); if (this.source[this.offset] === ",") this.offset++;
      this.take("}");
      return { syntax, description };
    });
    this.take(","); this.space();
    if (identities !== 1 || !purpose || !synopsis.length || !options.length
      || !this.source.startsWith("outputSchema:", this.offset)) refuse("LINEAR_CONTINUATION_METADATA_GRAMMAR");
    return { purpose, synopsis, options };
  }
}

export function classifyProbeQualifyMetadataDeltaForTest(input: {
  path: string; beforeBytes: Uint8Array; afterBytes: Uint8Array;
  beforeMode: string | null; afterMode: string | null; expectedAcceptanceDigest: string;
}) {
  if (input.path !== changedPath || input.beforeMode !== "100644" || input.afterMode !== "100644"
    || input.beforeBytes.length > 2 * 1024 * 1024 || input.afterBytes.length > 2 * 1024 * 1024) {
    refuse("LINEAR_CONTINUATION_METADATA_SCOPE");
  }
  digest(input.expectedAcceptanceDigest);
  const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const before = decode(input.beforeBytes), after = decode(input.afterBytes);
  const marker = 'const probeQualifyTopic = topic(["probe", "qualify"], {';
  const parts = (source: string) => {
    const position = source.indexOf(marker);
    if (position < 0 || source.indexOf(marker, position + marker.length) >= 0) refuse("LINEAR_CONTINUATION_METADATA_AMBIGUOUS");
    const start = position + marker.length;
    const reader = new HelpLiteralReader(source.slice(start, start + 32768));
    const fields = reader.fields();
    return { prefix: source.slice(0, start), suffix: source.slice(start + reader.offset), fields };
  };
  const a = parts(before), b = parts(after);
  if (before === after || a.prefix !== b.prefix || a.suffix !== b.suffix) refuse("LINEAR_CONTINUATION_PROTECTED_BYTES_CHANGED");
  const beforeImageDigest = sha256(input.beforeBytes), afterImageDigest = sha256(input.afterBytes);
  return Object.freeze({
    schema: "urn:usf:probe-qualify-help-metadata-delta:1" as const,
    beforeImageDigest, afterImageDigest, postimageDigest: afterImageDigest,
    deltaDigest: canonicalDigest({ beforeImageDigest, afterImageDigest }),
    immutableRegionDigest: canonicalDigest({ prefix: a.prefix, suffix: a.suffix }),
    mutableFieldSetDigest: canonicalDigest(["options", "purpose", "synopsis"]),
    acceptanceDigest: input.expectedAcceptanceDigest,
  });
}

interface FileFact { readonly path: string; readonly digest: string | null; readonly mode: number | null; }
/** Deterministic publication boundary classification; missing/foreign bytes never mean success. */
export function classifyContinuationPublication(
  expected: FileFact, effect: PublicationEffect, source: FileFact, receipt: FileFact,
): "unapplied" | "receipt-pending" | "applied" {
  if (source.path !== effect.sourcePath || expected.path !== effect.sourcePath || receipt.path !== effect.receiptPath
    || expected.digest !== effect.beforeDigest || source.mode !== expected.mode
    || !digestPattern.test(effect.beforeDigest) || !digestPattern.test(effect.afterDigest)
    || effect.beforeDigest === effect.afterDigest || !digestPattern.test(effect.receiptFileDigest)
    || ![effect.beforeDigest, effect.afterDigest].includes(source.digest ?? "")
    || (receipt.digest === null ? receipt.mode !== null : receipt.digest !== effect.receiptFileDigest || receipt.mode !== 0o644)
    || (source.digest === effect.beforeDigest && receipt.digest !== null)) {
    refuse("LINEAR_CONTINUATION_PUBLICATION_CONFLICT");
  }
  if (source.digest === effect.beforeDigest) return "unapplied";
  return receipt.digest === null ? "receipt-pending" : "applied";
}

/**
 * Operational evidence is not contribution scope. Only these ignored artifact
 * namespaces may supplement the unchanged semantic repository-path grammar.
 */
export function isContinuationInputPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length > 4096) return false;
  if (parseRepositoryPath(path, "file") !== null) return true;
  return /^\.usf\/(?:work|receipts|candidates)\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|nq)$/u.test(path);
}

function readFileFact(root: string, path: string): { fact: FileFact; bytes: Buffer | null } {
  if (!isContinuationInputPath(path)) refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
  const absolute = resolve(root, path);
  // Each existing parent is checked, including for an expected absent file.
  let parent = dirname(absolute);
  for (;;) {
    if (parent === root) break;
    if (relative(root, parent).startsWith("..")) refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
    try {
      const info = lstatSync(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    parent = dirname(parent);
  }
  let fd: number | undefined;
  try {
    const named = lstatSync(absolute);
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || named.size > 16 * 1024 * 1024) refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
    fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.mode !== named.mode || opened.uid !== named.uid
      || opened.nlink !== 1 || (path.startsWith(".usf/") && opened.uid !== process.getuid?.())) refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
    const bytes = readFileSync(fd), after = fstatSync(fd);
    if (opened.size !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs || after.nlink !== 1) refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
    return { fact: { path, digest: sha256(bytes), mode: opened.mode & 0o777 }, bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { fact: { path, digest: null, mode: null }, bytes: null };
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

function gitText(root: string, args: readonly string[]): string {
  try { return execFileSync("git", [...args], { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 2 * 1024 * 1024 }); }
  catch { return refuse("LINEAR_CONTINUATION_REPOSITORY_UNAVAILABLE"); }
}
function repositoryChanges(root: string, commit: string): FileFact[] {
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) refuse("LINEAR_CONTINUATION_CARRIER_INVALID");
  const paths = [...new Set([
    ...gitText(root, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", commit, "--"]).split("\0"),
    ...gitText(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
  ].filter(Boolean))].sort();
  if (paths.length > maximumFiles) refuse("LINEAR_CONTINUATION_CLOSURE_BOUNDS");
  return paths.map(path => readFileFact(root, path).fact);
}

export interface LinearPublicationSelection {
  readonly workIri: string; readonly profile: string; readonly manifestPath: string;
  readonly constructionProofObligation: string;
  readonly completionProofObligation: string | null;
  readonly completionValidationObligations: readonly string[];
}
function selection(packet: WorkPacket, profile: string, manifestPath: string): LinearPublicationSelection {
  const authority = packet.realisationAuthority;
  if (!authority?.constructionProofObligation) refuse("LINEAR_CONTINUATION_AUTHORITY_MISSING");
  return {
    workIri: packet.id, profile, manifestPath,
    constructionProofObligation: authority.constructionProofObligation,
    completionProofObligation: authority.completionProofObligation ?? null,
    completionValidationObligations: authority.completionValidationObligations ?? [],
  };
}
function packet(root: string, selected: { workIri: string; profile: string; manifestPath: string }): WorkPacket {
  const result = deriveWork(loadSemanticGraph(root, selected.manifestPath),
    { profile: selected.profile, selector: selected.workIri, maxItems: 1 });
  const value = result.status === "ok" ? result.items?.[0] : undefined;
  if (!value?.realisationBasis) refuse("LINEAR_CONTINUATION_WORK_UNAVAILABLE");
  return value;
}
function policy(root: string) {
  const graph = loadSemanticGraph(root, controllerManifest);
  const expected: Record<string, readonly string[]> = {
    type: ["urn:usf:type:ConstructionContinuationPolicy"], version: ["1"],
    forContract: ["urn:usf:contract:hermes-linear-autonomy:1"],
    controllerWork: [controllerWork], controllerProfile: [controllerProfile], controllerManifest: [controllerManifest],
    controllerPolicy: [controllerPolicy], eligibleWork: [selectedWork], selectedProfile: [selectedProfile],
    targetManifest: [selectedManifest], allowedChangedPath: [changedPath], residentDisposition: ["metadata-only"],
    acceptedIntegrationSchema: ["urn:usf:integration-observation:2"], acceptedRecoveryState: ["primary-advanced"],
    classifierSchema: ["urn:usf:probe-qualify-help-metadata-delta:1"],
    targetDeclaration: ["probeQualifyTopic"], targetFactory: ["topic"], targetTopicPath: ['["probe","qualify"]'],
    mutableLiteralField: ["options", "purpose", "synopsis"], requiredIdentityReference: ["envFileOption"],
    requiredIdentityCardinality: ["1"], immutableAcceptance: ["urn:usf:acceptance:cli-provider-qualification-help"],
    selectedCompletionDisposition: ["resume-original-idempotent"], controllerCompletionDisposition: ["forbidden"],
    providerReplayDisposition: ["forbidden"], integrationReplayDisposition: ["forbidden"],
    derivedPublicationDisposition: ["authenticated-exact-append-idempotent"],
    algorithm: ["urn:usf:algorithm:linear-construction-continuation:1"],
    schema: ["urn:usf:linear-construction-continuation-intent:1"],
  };
  for (const [name, values] of Object.entries(expected)) {
    if (!same(objectValues(graph, policyIri, predicate(name)).sort(), [...values].sort())) refuse("LINEAR_CONTINUATION_POLICY_INVALID");
  }
  const acceptance = objectValues(graph, policyIri, predicate("immutableAcceptanceDigest"));
  if (acceptance.length !== 1) refuse("LINEAR_CONTINUATION_POLICY_INVALID");
  const acceptanceDigest = digest(acceptance[0]);
  if (readFileFact(root, acceptancePath).fact.digest !== acceptanceDigest) refuse("LINEAR_CONTINUATION_ACCEPTANCE_CHANGED");
  return { graph, acceptanceDigest, digest: resourceDigest(graph, policyIri) };
}

async function writeBlob(root: string, value: unknown): Promise<string> {
  const source = canonicalJson(value), hash = canonicalDigest(value);
  if (source.length > 512 * 1024) refuse("LINEAR_CONTINUATION_RECORD_BOUNDS");
  const chunks: string[] = [];
  for (let offset = 0; offset < source.length; offset += 400) chunks.push(source.slice(offset, offset + 400));
  for (let offset = 0; offset < chunks.length; offset += 128) {
    const key = "continuation-blob-" + hash.slice(7) + "-" + String(offset / 128);
    const record = { digest: hash, offset, chunks: chunks.slice(offset, offset + 128), count: chunks.length };
    const previous = await readLinearRecord(root, key);
    if (previous !== null && !same(previous, record)) refuse("LINEAR_CONTINUATION_RECORD_CONFLICT");
    if (previous === null) await writeLinearRecord(root, key, record);
  }
  return hash;
}
async function readBlob<T>(root: string, hash: string): Promise<T> {
  digest(hash);
  const chunks: string[] = [];
  let count = 1;
  for (let index = 0; index < Math.ceil(count / 128); index++) {
    const value = await readLinearRecord(root, "continuation-blob-" + hash.slice(7) + "-" + String(index));
    if (!value || typeof value !== "object" || Array.isArray(value)) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
    const record = value as Record<string, LinearRecordValue>;
    if (record.digest !== hash || record.offset !== index * 128 || !Number.isInteger(record.count)
      || typeof record.count !== "number" || record.count < 1 || record.count > 1311
      || !Array.isArray(record.chunks) || record.chunks.length !== Math.min(128, record.count - index * 128)
      || record.chunks.some(chunk => typeof chunk !== "string" || chunk.length > 400)) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
    if (index > 0 && record.count !== count) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
    count = record.count; chunks.push(...record.chunks as string[]);
  }
  const source = chunks.join("");
  let result: T;
  try { result = JSON.parse(source) as T; } catch { return refuse("LINEAR_CONTINUATION_RECORD_INVALID"); }
  if (canonicalJson(result) !== source || canonicalDigest(result) !== hash) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  return result;
}

interface ContinuationIntent {
  readonly schema: "urn:usf:linear-construction-continuation-intent:1";
  readonly policyDigest: string;
  readonly repositoryCommit: string;
  readonly repositoryDirtyFiles: readonly FileFact[];
  readonly bindingIri: string; readonly bindingManifest: string; readonly bindingDigest: string;
  readonly attemptKey: string; readonly basisDigest: string; readonly candidateDigest: string;
  readonly workspaceIdentityDigest: string;
  readonly selected: LinearPublicationSelection; readonly controller: LinearPublicationSelection;
  readonly controllerBasisDigest: string;
  readonly classification: ReturnType<typeof classifyProbeQualifyMetadataDeltaForTest>;
  readonly beforeFiles: readonly FileFact[];
  readonly checkReceiptPaths: readonly string[];
}
interface PendingEffect {
  readonly effect: PublicationEffect;
  readonly proof: FileFact;
}
interface ContinuationState {
  readonly intentDigest: string;
  readonly integration: null | { readonly observationDigest: string; readonly commit: string; readonly files: readonly FileFact[] };
  readonly nextStep: number;
  readonly completedEffects: readonly PendingEffect[];
  readonly pending: PendingEffect | null;
  readonly terminal: boolean;
}
async function saveState(root: string, state: ContinuationState): Promise<void> {
  const stateDigest = await writeBlob(root, state);
  await writeLinearRecord(root, pointerKey, { schema: "urn:usf:linear-continuation-pointer:1", intentDigest: state.intentDigest, stateDigest });
}
async function retained(root: string): Promise<{ intent: ContinuationIntent; state: ContinuationState } | null> {
  const pointer = await readLinearRecord(root, pointerKey);
  if (pointer === null) return null;
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  const record = pointer as Record<string, LinearRecordValue>;
  if (record.schema !== "urn:usf:linear-continuation-pointer:1") refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  const intentDigest = digest(record.intentDigest), stateDigest = digest(record.stateDigest);
  const intent = await readBlob<ContinuationIntent>(root, intentDigest);
  const state = await readBlob<ContinuationState>(root, stateDigest);
  if (intent.schema !== "urn:usf:linear-construction-continuation-intent:1" || state.intentDigest !== intentDigest
    || !Number.isInteger(state.nextStep) || state.nextStep < 0 || state.nextStep > 3
    || !Array.isArray(state.completedEffects) || state.completedEffects.length !== state.nextStep
    || state.terminal !== (state.nextStep === 3) || (state.terminal && state.pending !== null)
    || intent.beforeFiles.length > maximumFiles) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  return { intent, state };
}

function protectedFiles(root: string, bindings: readonly { manifestPath: string; packet?: WorkPacket }[], extras: readonly string[]): FileFact[] {
  const paths = new Set(extras);
  for (const entry of bindings) {
    const graph = loadSemanticGraph(root, entry.manifestPath);
    for (const source of graph.sources) paths.add(source.path);
    for (const manifest of graph.manifests) paths.add(manifest.path);
    if (entry.packet) {
      for (const path of [...entry.packet.readSet, ...entry.packet.writeSet]) paths.add(path);
      for (const dependency of entry.packet.realisationBasis!.work.dependencies) {
        if (dependency.kind === "semantic-resource" || dependency.kind === "semantic-graph") continue;
        if (isContinuationInputPath(dependency.key)) paths.add(dependency.key);
        else if (dependency.kind === "file" || dependency.kind === "manifest") refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
      }
    }
  }
  if (paths.size > maximumFiles) refuse("LINEAR_CONTINUATION_CLOSURE_BOUNDS");
  return [...paths].sort().map(path => readFileFact(root, path).fact);
}

export async function prepareLinearMetadataContinuation(rootPath: string, binding: LinearBindingResult,
  candidateDigest: string, checkReceiptPaths: readonly string[]): Promise<boolean> {
  if (binding.binding.unit.workIri !== selectedWork) return false;
  const root = realpathSync(rootPath);
  const p = policy(root);
  if (binding.status !== "SETTLED" || binding.binding.authority.realisationDisposition !== undefined
    || binding.binding.unit.profile !== selectedProfile || binding.binding.unit.manifestPath !== selectedManifest) {
    refuse("LINEAR_CONTINUATION_SELECTION_INVALID");
  }
  const { readLinearPolicySource } = await import("./linear-client.ts");
  await readLinearPolicySource(root, controllerManifest, controllerPolicy);
  const currentController = packet(root, { workIri: controllerWork, profile: controllerProfile, manifestPath: controllerManifest });
  const authenticated = await authenticateCandidateWorkspace(root, candidateDigest);
  if (authenticated.constructionBasis.basisDigest !== binding.binding.unit.basisDigest
    || authenticated.actualOperationDelta.length !== 1 || checkReceiptPaths.length < 1 || checkReceiptPaths.length > 32) {
    refuse("LINEAR_CONTINUATION_CANDIDATE_MISMATCH");
  }
  const delta = authenticated.actualOperationDelta[0]!;
  if (delta.before === null || delta.after === null) refuse("LINEAR_CONTINUATION_METADATA_SCOPE");
  const beforeBytes = Buffer.from(delta.before, "base64"), afterBytes = Buffer.from(delta.after, "base64");
  if (beforeBytes.toString("base64") !== delta.before || afterBytes.toString("base64") !== delta.after
    || sha256(beforeBytes) !== delta.beforeDigest || sha256(afterBytes) !== delta.afterDigest) refuse("LINEAR_CONTINUATION_CANDIDATE_MISMATCH");
  const classification = classifyProbeQualifyMetadataDeltaForTest({
    path: delta.path, beforeBytes, afterBytes, beforeMode: delta.beforeMode, afterMode: delta.afterMode,
    expectedAcceptanceDigest: p.acceptanceDigest,
  });
  const attemptBytes = readFileFact(root, binding.binding.attemptPath).bytes;
  if (attemptBytes === null || !same(JSON.parse(attemptBytes.toString("utf8")), binding.binding.attempt)) refuse("LINEAR_CONTINUATION_ATTEMPT_CHANGED");
  const checkDependencies: string[] = [];
  for (const path of checkReceiptPaths) {
    const bytes = readFileFact(root, path).bytes;
    if (bytes === null) refuse("LINEAR_CONTINUATION_CHECK_MISSING");
    const checked = JSON.parse(bytes.toString("utf8")) as { candidateDigest: string; originalConstructionBasisDigest: string; validationAuthorityDependencies: { path: string }[] };
    if (checked.candidateDigest !== candidateDigest || checked.originalConstructionBasisDigest !== binding.binding.unit.basisDigest
      || !Array.isArray(checked.validationAuthorityDependencies)) refuse("LINEAR_CONTINUATION_CHECK_MISMATCH");
    checkDependencies.push(...checked.validationAuthorityDependencies.map(dependency => dependency.path));
  }
  const repositoryCommit = gitText(root, ["rev-parse", "--verify", "HEAD"]).trim();
  const intent: ContinuationIntent = {
    schema: "urn:usf:linear-construction-continuation-intent:1", policyDigest: p.digest,
    repositoryCommit, repositoryDirtyFiles: repositoryChanges(root, repositoryCommit),
    bindingIri: binding.binding.authority.bindingIri, bindingManifest: binding.binding.selector.manifestPath,
    bindingDigest: canonicalDigest(binding.binding.authority), attemptKey: binding.binding.unit.attemptKey,
    basisDigest: binding.binding.unit.basisDigest, candidateDigest, workspaceIdentityDigest: authenticated.workspaceIdentityDigest,
    selected: selection(binding.binding.unit.packet, selectedProfile, selectedManifest),
    controller: selection(currentController, controllerProfile, controllerManifest),
    controllerBasisDigest: currentController.realisationBasis!.basisDigest,
    classification, checkReceiptPaths: [...new Set(checkReceiptPaths)].sort(),
    beforeFiles: protectedFiles(root, [
      { manifestPath: controllerManifest, packet: currentController },
      { manifestPath: selectedManifest, packet: binding.binding.unit.packet },
      { manifestPath: binding.binding.selector.manifestPath },
    ], [acceptancePath, binding.binding.attemptPath, binding.binding.unitPath, ...checkReceiptPaths, ...checkDependencies]),
  };
  const prior = await retained(root);
  if (prior !== null) {
    if (!same(prior.intent, intent) || prior.state.integration !== null || prior.state.terminal) refuse("LINEAR_CONTINUATION_ALREADY_RETAINED");
    return true;
  }
  const intentDigest = await writeBlob(root, intent);
  await saveState(root, { intentDigest, integration: null, nextStep: 0, completedEffects: [], pending: null, terminal: false });
  assertFiles(root, intent.beforeFiles);
  return true;
}
function assertFiles(root: string, files: readonly FileFact[]): void {
  for (const expected of files) {
    if (!same(readFileFact(root, expected.path).fact, expected)) refuse("LINEAR_CONTINUATION_PROTECTED_INPUT_CHANGED");
  }
}
function expectedPostimages(intent: ContinuationIntent, state: ContinuationState): FileFact[] {
  const files = new Map(intent.beforeFiles.map(file => [file.path, file]));
  const changed = files.get(changedPath);
  if (!changed || changed.digest !== intent.classification.beforeImageDigest || changed.mode !== 0o644) refuse("LINEAR_CONTINUATION_POSTIMAGE_INVALID");
  files.set(changedPath, { ...changed, digest: intent.classification.afterImageDigest });
  for (const file of state.integration?.files ?? []) files.set(file.path, file);
  for (const { effect, proof } of state.completedEffects) {
    const before = files.get(effect.sourcePath);
    if (!before || before.digest !== effect.beforeDigest) refuse("LINEAR_CONTINUATION_PUBLICATION_CHAIN_INVALID");
    files.set(effect.sourcePath, { ...before, digest: effect.afterDigest });
    files.set(effect.receiptPath, { path: effect.receiptPath, digest: effect.receiptFileDigest, mode: 0o644 });
    files.set(proof.path, proof);
  }
  return [...files.values()];
}
function authenticateRetained(root: string, intent: ContinuationIntent, state: ContinuationState): void {
  if (policy(root).digest !== intent.policyDigest
    || !same(intent.selected, selection(packet(root, intent.selected), selectedProfile, selectedManifest))
    || !same(intent.controller, selection(packet(root, intent.controller), controllerProfile, controllerManifest))
    || canonicalDigest(deriveLinearBindingDeclaration(loadSemanticGraph(root, intent.bindingManifest), intent.bindingIri)) !== intent.bindingDigest) {
    refuse("LINEAR_CONTINUATION_AUTHORITY_CHANGED");
  }
  const allowedChanges = new Set([changedPath, ...state.completedEffects.flatMap(({ effect }) => [effect.sourcePath, effect.receiptPath]),
    ...(state.pending === null ? [] : [state.pending.effect.sourcePath, state.pending.effect.receiptPath])]);
  const baseline = intent.repositoryDirtyFiles.filter(file => !allowedChanges.has(file.path));
  const currentChanges = repositoryChanges(root, intent.repositoryCommit).filter(file => !allowedChanges.has(file.path));
  if (!same(baseline, currentChanges)) refuse("LINEAR_CONTINUATION_UNRELATED_CHANGE");
  const expected = expectedPostimages(intent, state);
  const pending = state.pending;
  if (pending === null) assertFiles(root, expected);
  else {
    assertFiles(root, expected.filter(file => file.path !== pending.effect.sourcePath && file.path !== pending.effect.receiptPath));
    assertFiles(root, [pending.proof]);
    const source = readFileFact(root, pending.effect.sourcePath).fact;
    const baseline = expected.find(file => file.path === pending.effect.sourcePath);
    const receipt = readFileFact(root, pending.effect.receiptPath).fact;
    if (!baseline) refuse("LINEAR_CONTINUATION_PUBLICATION_CONFLICT");
    classifyContinuationPublication(baseline, pending.effect, source, receipt);
  }
  if (state.integration !== null) {
    if (!/^[a-f0-9]{40,64}$/u.test(state.integration.commit)) refuse("LINEAR_CONTINUATION_CARRIER_INVALID");
    try { execFileSync("git", ["merge-base", "--is-ancestor", state.integration.commit, "HEAD"],
      { cwd: root, stdio: "pipe", timeout: 10000, maxBuffer: 65536 }); }
    catch { refuse("LINEAR_CONTINUATION_CARRIER_MOVED"); }
  }
}
async function captureIntegration(root: string, intent: ContinuationIntent, state: ContinuationState): Promise<ContinuationState> {
  const observed = await inspectCandidateIntegrationRecovery(root, { candidateDigests: [intent.candidateDigest] });
  const success = observed.observation, prepared = observed.prepared;
  if (observed.state !== "primary-advanced" || !success || !prepared
    || success.schema !== "urn:usf:integration-observation:2" || success.outcome !== "urn:usf:outcome:integration-success"
    || success.startingCarrierCommit !== intent.repositoryCommit
    || success.workspaceIdentityDigest !== intent.workspaceIdentityDigest || success.originalConstructionBases.length !== 1
    || success.originalConstructionBases[0]?.basisDigest !== intent.basisDigest
    || success.originalConstructionBases[0]?.work.id !== selectedWork
    || success.authoritativeGitDiff?.length !== 1 || success.authoritativeGitDiff[0]?.path !== changedPath
    || success.authoritativeGitDiff[0]?.afterDigest !== intent.classification.afterImageDigest
    || success.authoritativeGitDiff[0]?.beforeDigest !== intent.classification.beforeImageDigest
    || !success.observedCarrierCommit) refuse("LINEAR_CONTINUATION_INTEGRATION_UNAUTHENTICATED");
  const checkedDigests = intent.checkReceiptPaths.map(path => {
    const bytes = readFileFact(root, path).bytes;
    if (bytes === null) refuse("LINEAR_CONTINUATION_CHECK_MISSING");
    return canonicalDigest(JSON.parse(bytes.toString("utf8")) as unknown);
  }).sort();
  if (!same(checkedDigests, success.checkedCandidateReceipts.map(checked => canonicalDigest(checked)).sort())) refuse("LINEAR_CONTINUATION_CHECK_MISMATCH");
  const retainedIntent = readFileFact(root, prepared.intentPath);
  if (retainedIntent.bytes === null) refuse("LINEAR_CONTINUATION_INTEGRATION_UNAUTHENTICATED");
  const parsed = JSON.parse(retainedIntent.bytes.toString("utf8")) as { observationPath?: unknown };
  if (typeof parsed.observationPath !== "string" || !/^\.usf\/receipts\/integration\/[a-f0-9]{64}\.json$/u.test(parsed.observationPath)) refuse("LINEAR_CONTINUATION_INTEGRATION_UNAUTHENTICATED");
  const receipt = readFileFact(root, parsed.observationPath);
  if (receipt.bytes === null || receipt.bytes.toString("utf8") !== canonicalJson(success) + "\n") refuse("LINEAR_CONTINUATION_INTEGRATION_UNAUTHENTICATED");
  const next: ContinuationState = { ...state, integration: {
    observationDigest: success.observationDigest, commit: success.observedCarrierCommit,
    files: [retainedIntent.fact, receipt.fact],
  } };
  authenticateRetained(root, intent, next);
  await saveState(root, next);
  return next;
}

export interface ContinuationOperationOptions {
  readonly resume: boolean;
  readonly checkpoint: PublicationCheckpoint;
}
export interface ContinuationOperations {
  construct(selection: LinearPublicationSelection, identity: string, options: ContinuationOperationOptions): Promise<unknown>;
  complete(selection: LinearPublicationSelection, identity: string, options: ContinuationOperationOptions): Promise<unknown>;
}

/** One retained attempt, exactly three authorized steps, never a provider/integration loop. */
export async function resumeLinearMetadataContinuation(rootPath: string, operations: ContinuationOperations):
  Promise<null | { status: "completed"; bindingIri: string; attemptKey: string; candidateDigest: string }> {
  const root = realpathSync(rootPath);
  const found = await retained(root);
  if (found === null) return null;
  const { intent } = found;
  // A closed attempt is history, not a permanent global lock on future work.
  // Ordinary current policy and selected-work completion govern later cycles.
  if (found.state.terminal) return null;
  let state = found.state;
  if (state.integration === null) state = await captureIntegration(root, intent, state);
  authenticateRetained(root, intent, state);
  for (let index = state.nextStep; index < 3; index++) {
    const selected = index === 2 ? intent.controller : intent.selected;
    const kind = index === 1 ? "completion" : "construction";
    const identity = canonicalDigest({ intentDigest: state.intentDigest, step: index });
    const proofPath = ".usf/candidates/" + (kind === "completion" ? "work-completion/" : "construction-authority/") + identity.slice(7) + ".proof.json";
    const operation = kind === "completion" ? operations.complete : operations.construct;
    const alreadyApplied = state.pending !== null
      && readFileFact(root, state.pending.effect.sourcePath).fact.digest === state.pending.effect.afterDigest
      && readFileFact(root, state.pending.effect.receiptPath).fact.digest === state.pending.effect.receiptFileDigest;
    if (!alreadyApplied) {
      await operation(selected, identity, {
        resume: state.pending !== null,
        checkpoint: async effect => {
          authenticateRetained(root, intent, state);
          const expected = expectedPostimages(intent, state).find(file => file.path === effect.sourcePath);
          if (effect.kind !== kind || !same(effect.workIris, [selected.workIri]) || !expected
            || expected.digest !== effect.beforeDigest || effect.beforeDigest === effect.afterDigest
            || !digestPattern.test(effect.afterDigest) || !digestPattern.test(effect.receiptFileDigest)
            || !digestPattern.test(effect.receiptDigest) || !/^evidence\/(?:construction-authority|work-completion)\/[a-f0-9]{64}\.json$/u.test(effect.receiptPath)) {
            refuse("LINEAR_CONTINUATION_PUBLICATION_EFFECT_INVALID");
          }
          const pending = { effect, proof: readFileFact(root, proofPath).fact };
          if (pending.proof.digest === null || (state.pending !== null && !same(state.pending, pending))) refuse("LINEAR_CONTINUATION_PUBLICATION_CONFLICT");
          state = { ...state, pending };
          await saveState(root, state);
          authenticateRetained(root, intent, state);
        },
      });
    }
    if (state.pending === null) refuse("LINEAR_CONTINUATION_PUBLICATION_NOT_CHECKPOINTED");
    authenticateRetained(root, intent, state);
    const applied = state.pending;
    if (readFileFact(root, applied.effect.sourcePath).fact.digest !== applied.effect.afterDigest
      || readFileFact(root, applied.effect.receiptPath).fact.digest !== applied.effect.receiptFileDigest) refuse("LINEAR_CONTINUATION_PUBLICATION_UNPROVEN");
    const current = packet(root, selected);
    if (kind === "completion" ? current.realisationStage?.completion.verified !== true : current.eligibility?.construction.eligible !== true) {
      refuse("LINEAR_CONTINUATION_PUBLICATION_READBACK_REFUSED");
    }
    state = { ...state, nextStep: index + 1, completedEffects: [...state.completedEffects, applied], pending: null, terminal: index === 2 };
    await saveState(root, state);
  }
  authenticateRetained(root, intent, state);
  if (packet(root, intent.selected).realisationStage?.completion.verified !== true
    || packet(root, intent.controller).eligibility?.construction.eligible !== true) refuse("LINEAR_CONTINUATION_TERMINAL_UNPROVEN");
  return { status: "completed", bindingIri: intent.bindingIri, attemptKey: intent.attemptKey, candidateDigest: intent.candidateDigest };
}
