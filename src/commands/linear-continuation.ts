import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { parseRepositoryPath } from "../core/scope.ts";
import { loadSemanticGraph, objectValues, resourceDigest } from "../graph/index.ts";
import { canonicalQuadLine } from "../graph/nquads.ts";
import { deriveLinearBindingDeclaration } from "../graph/linear-binding.ts";
import { deriveWork, type WorkPacket } from "../graph/work.ts";
import { authenticateCandidateWorkspace, inspectCandidateIntegrationRecovery, withCandidateLock } from "../realisation/index.ts";
import { constructionGrantIri, constructionReceiptPath, deriveConstructionAuthority, validateConstructionReceiptShape } from "../realisation/construction-authority.ts";
import { acquirePrimaryMutationLock } from "../realisation/transition.ts";
import { LinearStateStore, readLinearRecord, writeLinearRecord, type LinearRecordValue } from "./linear-state.ts";
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
const repairPolicyIri = "urn:usf:policy:linear-continuation-repair-handoff:1";
const repairPolicySource = "graph/linear-issue-bindings.nq";
const controllerContract = "urn:usf:contract:hermes-linear-autonomy:1";
const currentAuthorityPublicationSource = "graph/linear-work-binding-grants.nq";
const bindingPublicationSelection = Object.freeze({
  workIri: "urn:usf:work:linear-work-binding",
  profile: "urn:usf:profile:linear-work-binding:1",
  manifestPath: "graph/manifests/linear-work-binding.json",
});

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
      || opened.nlink !== 1 || ((path.startsWith(".usf/") || path === currentAuthorityPublicationSource) && opened.uid !== process.getuid?.())) refuse("LINEAR_CONTINUATION_PATH_UNSAFE");
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

function continuationBlobKey(hash: string, version: 1 | 2, index: number): string {
  return (version === 1 ? "continuation-blob-" : "continuation-blob-v2-") + hash.slice(7) + "-" + String(index);
}

async function readContinuationBlobRecords(root: string, hash: string, version: 1 | 2): Promise<(LinearRecordValue | null)[]> {
  const records: (LinearRecordValue | null)[] = [];
  // Inspect every bounded slot so a missing head cannot conceal orphaned records.
  for (let index = 0; index < Math.ceil(1311 / 128); index++) {
    records.push(await readLinearRecord(root, continuationBlobKey(hash, version, index)));
  }
  return records;
}

function decodeContinuationBlob<T>(hash: string, version: 1 | 2,
  records: readonly (LinearRecordValue | null)[]): { source: string; value: T } | null {
  const invalid = (): never => refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  if (records.length !== Math.ceil(1311 / 128)) return invalid();
  if (records.every(record => record === null)) return null;
  const first = records[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return invalid();
  const count = (first as Record<string, LinearRecordValue>).count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 1311) return invalid();
  const chunks: string[] = [];
  const fields = version === 1 ? ["digest", "offset", "chunks", "count"] : ["schema", "digest", "offset", "chunks", "count"];
  for (let index = 0; index < records.length; index++) {
    const value = records[index];
    if (index >= Math.ceil(count / 128)) {
      if (value !== null) return invalid();
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const record = value as Record<string, LinearRecordValue>;
    if (Object.keys(record).length !== fields.length || Object.keys(record).some(key => !fields.includes(key))
      || record.digest !== hash || record.offset !== index * 128 || record.count !== count
      || (version === 2 && record.schema !== "urn:usf:linear-continuation-blob:2")
      || !Array.isArray(record.chunks) || record.chunks.length !== Math.min(128, count - index * 128)) return invalid();
    for (const chunk of record.chunks) {
      if (typeof chunk !== "string" || chunk.length < 1 || chunk.length > (version === 1 ? 400 : 409)) return invalid();
      let decoded = chunk;
      if (version === 2) {
        const frame = /^usf2:([1-9][0-9]{0,2}):([\s\S]*)$/u.exec(chunk);
        if (!frame) return invalid();
        const length = Number(frame[1]);
        decoded = frame[2]!;
        if (length > 400 || decoded.length !== length || (chunks.length < count - 1 && length !== 400)) return invalid();
      }
      chunks.push(decoded);
    }
  }
  // Rejoin UTF-16 code units before JSON parsing or UTF-8 hashing. A pair may
  // intentionally straddle two frames without either half being transcoded.
  const source = chunks.join("");
  if (source.length > 512 * 1024) return invalid();
  let value: T;
  try {
    value = JSON.parse(source) as T;
    if (canonicalJson(value) !== source || canonicalDigest(value) !== hash) return invalid();
  } catch { return invalid(); }
  if (version === 2) canonicalJson(value, { rejectAbsolutePaths: true });
  return { source, value };
}

function continuationBlobRecords(source: string, hash: string): LinearRecordValue[] {
  if (source.length < 1 || source.length > 512 * 1024) refuse("LINEAR_CONTINUATION_RECORD_BOUNDS");
  const chunks: string[] = [];
  for (let offset = 0; offset < source.length; offset += 400) {
    const fragment = source.slice(offset, offset + 400);
    chunks.push("usf2:" + String(fragment.length) + ":" + fragment);
  }
  const records: LinearRecordValue[] = [];
  for (let offset = 0; offset < chunks.length; offset += 128) {
    records.push({ schema: "urn:usf:linear-continuation-blob:2", digest: hash,
      offset, chunks: chunks.slice(offset, offset + 128), count: chunks.length });
  }
  return records;
}

async function writeBlob(root: string, value: unknown): Promise<string> {
  const source = canonicalJson(value), hash = canonicalDigest(value);
  if (source.length > 512 * 1024) refuse("LINEAR_CONTINUATION_RECORD_BOUNDS");
  const key = canonicalDigest({ purpose: "linear-continuation-blob", digest: hash });
  return withCandidateLock(root, key, async () => {
    const legacyRecords = await readContinuationBlobRecords(root, hash, 1);
    const legacy = decodeContinuationBlob<unknown>(hash, 1, legacyRecords);
    const framedRecords = await readContinuationBlobRecords(root, hash, 2);
    if (legacy !== null) {
      const framed = decodeContinuationBlob<unknown>(hash, 2, framedRecords);
      if (legacy.source !== source || (framed !== null && framed.source !== source)) refuse("LINEAR_CONTINUATION_RECORD_CONFLICT");
      // An existing raw representation is immutable, including its wire version.
      if (canonicalJson(await readBlob(root, hash)) !== source) refuse("LINEAR_CONTINUATION_RECORD_CONFLICT");
      return hash;
    }
    // Apply containment to logical values, never to accidental fragment starts.
    // The generic record validator still handles each small framed envelope.
    canonicalJson(value, { rejectAbsolutePaths: true });
    const expected = continuationBlobRecords(source, hash);
    const assertMatching = (previous: LinearRecordValue, record: LinearRecordValue | undefined): void => {
      let matches = false;
      try { matches = record !== undefined && same(previous, record); } catch { /* Malformed existing data is not replaceable. */ }
      if (!matches) refuse("LINEAR_CONTINUATION_RECORD_CONFLICT");
    };
    // Authenticate every existing v2 slot against the exact intended payload
    // before completing an interrupted write. Never overwrite a conflicting slot.
    for (const [index, previous] of framedRecords.entries()) {
      if (previous !== null) assertMatching(previous, expected[index]);
    }
    for (const [index, record] of expected.entries()) {
      const recordKey = continuationBlobKey(hash, 2, index);
      const previous = await readLinearRecord(root, recordKey);
      if (previous !== null) assertMatching(previous, record);
      else await writeLinearRecord(root, recordKey, record);
    }
    // Both namespaces must authenticate before the caller may reference the blob.
    if (canonicalJson(await readBlob(root, hash)) !== source) refuse("LINEAR_CONTINUATION_RECORD_CONFLICT");
    return hash;
  });
}
async function readBlob<T>(root: string, hash: string): Promise<T> {
  digest(hash);
  const legacy = decodeContinuationBlob<T>(hash, 1, await readContinuationBlobRecords(root, hash, 1));
  const framed = decodeContinuationBlob<T>(hash, 2, await readContinuationBlobRecords(root, hash, 2));
  if (legacy !== null && framed !== null && legacy.source !== framed.source) refuse("LINEAR_CONTINUATION_RECORD_CONFLICT");
  if (legacy !== null) return legacy.value;
  if (framed !== null) return framed.value;
  return refuse("LINEAR_CONTINUATION_RECORD_INVALID");
}

interface CurrentAuthorityInput {
  readonly disposition: "current-authority-only";
  readonly historicalEquivalence: "not-claimed";
  readonly source: FileFact;
  readonly publicationReceipt: FileFact;
  readonly publicationIntentDigest: string;
  readonly publicationReceiptDigest: string;
  readonly authorityBasisDigest: string;
  readonly selectedDependencyIndependenceDigest: string;
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
  readonly repairHandoff?: {
    readonly predecessorIntentDigest: string;
    readonly predecessorStateDigest: string;
    readonly admissionDigest: string;
    readonly currentAuthorityInputs?: readonly CurrentAuthorityInput[];
  };
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
async function saveState(root: string, state: ContinuationState, beforePointerWrite?: () => void): Promise<void> {
  const stateDigest = await writeBlob(root, state);
  const previous = await readLinearRecord(root, pointerKey);
  beforePointerWrite?.();
  if (previous !== null && typeof previous === "object" && !Array.isArray(previous)) {
    const pointer = previous as Record<string, LinearRecordValue>;
    if (pointer.intentDigest !== state.intentDigest) refuse("LINEAR_CONTINUATION_POINTER_CONFLICT");
    if (pointer.schema === "urn:usf:linear-continuation-pointer:2") {
      await writeLinearRecord(root, pointerKey, { ...pointer, stateDigest });
      return;
    }
  }
  await writeLinearRecord(root, pointerKey, { schema: "urn:usf:linear-continuation-pointer:1", intentDigest: state.intentDigest, stateDigest });
}
async function retained(root: string): Promise<{ intent: ContinuationIntent; state: ContinuationState } | null> {
  const pointer = await readLinearRecord(root, pointerKey);
  if (pointer === null) return null;
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  const record = pointer as Record<string, LinearRecordValue>;
  if (record.schema !== "urn:usf:linear-continuation-pointer:1" && record.schema !== "urn:usf:linear-continuation-pointer:2") refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  const intentDigest = digest(record.intentDigest), stateDigest = digest(record.stateDigest);
  const intent = await readBlob<ContinuationIntent>(root, intentDigest);
  const state = await readBlob<ContinuationState>(root, stateDigest);
  if (intent.schema !== "urn:usf:linear-construction-continuation-intent:1" || state.intentDigest !== intentDigest
    || !Number.isInteger(state.nextStep) || state.nextStep < 0 || state.nextStep > 3
    || !Array.isArray(state.completedEffects) || state.completedEffects.length !== state.nextStep
    || state.terminal !== (state.nextStep === 3) || (state.terminal && state.pending !== null)
    || intent.beforeFiles.length > maximumFiles) refuse("LINEAR_CONTINUATION_RECORD_INVALID");
  if (record.schema === "urn:usf:linear-continuation-pointer:2") {
    const receipt = await readBlob<RepairHandoffReceipt>(root, digest(record.handoffReceiptDigest));
    const original = await readBlob<ContinuationIntent>(root, receipt.predecessorIntentDigest);
    const originalState = await readBlob<ContinuationState>(root, receipt.predecessorStateDigest);
    const admittedState = await readBlob<ContinuationState>(root, receipt.successorStateDigest);
    assertRepairBoundary(original, originalState, receipt.predecessorIntentDigest, receipt.predecessorStateDigest);
    assertCurrentAuthorityInputLineage(receipt.currentAuthorityInputs, intent);
    if (receipt.schema !== "urn:usf:linear-continuation-repair-handoff-receipt:1"
      || receipt.successorIntentDigest !== intentDigest || admittedState.intentDigest !== intentDigest
      || admittedState.nextStep !== 0 || admittedState.pending !== null || admittedState.terminal
      || admittedState.completedEffects.length !== 0 || admittedState.integration === null
      || !same(admittedState.integration, state.integration)
      || !same(intent.repairHandoff, { predecessorIntentDigest: receipt.predecessorIntentDigest,
        predecessorStateDigest: receipt.predecessorStateDigest, admissionDigest: receipt.admissionDigest,
        ...(receipt.currentAuthorityInputs === undefined ? {} : { currentAuthorityInputs: receipt.currentAuthorityInputs }) })
      || receipt.controllerBasisDigest !== intent.controllerBasisDigest
      || !same({ ...intent, beforeFiles: original.beforeFiles, repositoryDirtyFiles: original.repositoryDirtyFiles,
        controllerBasisDigest: original.controllerBasisDigest, repairHandoff: undefined }, { ...original, repairHandoff: undefined })) {
      refuse("LINEAR_CONTINUATION_HANDOFF_LINEAGE_INVALID");
    }
  } else if (intent.repairHandoff !== undefined) refuse("LINEAR_CONTINUATION_HANDOFF_LINEAGE_INVALID");
  return { intent, state };
}

interface RepairInput { readonly before: FileFact; readonly after: FileFact; }
interface RepairAdmission {
  readonly predecessorIntentDigest: string; readonly predecessorStateDigest: string;
  readonly observationDigest: string; readonly inputs: readonly RepairInput[];
  readonly rows: readonly string[]; readonly digest: string;
  readonly currentAuthorityOnlyPublicationSource?: string;
}
interface RepairHandoffReceipt {
  readonly schema: "urn:usf:linear-continuation-repair-handoff-receipt:1";
  readonly predecessorIntentDigest: string; readonly predecessorStateDigest: string;
  readonly successorIntentDigest: string; readonly successorStateDigest: string;
  readonly admissionDigest: string; readonly controllerBasisDigest: string;
  readonly publicationReceipts: readonly FileFact[];
  readonly currentAuthorityInputs?: readonly CurrentAuthorityInput[];
}

function repairAdmission(root: string, intent: ContinuationIntent): RepairAdmission | null {
  const graph = loadSemanticGraph(root, intent.bindingManifest);
  const rootRows = graph.quads.filter(row => row.subject === repairPolicyIri);
  if (rootRows.length === 0) return null;
  const invalid = (): never => refuse("LINEAR_CONTINUATION_HANDOFF_POLICY_INVALID");
  const field = (subject: string, name: string, kind: "iri" | "literal"): string => {
    const rows = graph.quads.filter(row => row.subject === subject && row.predicate === predicate(name));
    if (rows.length !== 1 || rows[0]!.objectKind !== kind) return invalid();
    return rows[0]!.object;
  };
  const closed = (subject: string, names: readonly string[]) => {
    if (graph.quads.some(row => row.subject === subject && !names.includes(row.predicate.slice("urn:usf:predicate:".length)))) invalid();
  };
  closed(repairPolicyIri, ["type", "version", "forContract", "forPolicy", "failureClass", "predecessorIntentDigest",
    "predecessorStateDigest", "integrationObservationDigest", "approvedRepairInput", "currentAuthorityOnlyPublicationSource"]);
  if (field(repairPolicyIri, "type", "iri") !== "urn:usf:type:ConstructionContinuationRepairAdmission"
    || field(repairPolicyIri, "version", "literal") !== "1"
    || field(repairPolicyIri, "forContract", "iri") !== controllerContract
    || field(repairPolicyIri, "forPolicy", "iri") !== policyIri
    || field(repairPolicyIri, "failureClass", "literal") !== "WORKSPACE_IDENTITY_MEMBER_COHORT_MISMATCH") invalid();
  const currentAuthorityRows = rootRows.filter(row => row.predicate === predicate("currentAuthorityOnlyPublicationSource"));
  if (currentAuthorityRows.length > 1 || (currentAuthorityRows.length === 1
    && (currentAuthorityRows[0]!.objectKind !== "literal"
      || currentAuthorityRows[0]!.object !== currentAuthorityPublicationSource))) invalid();
  const references = graph.quads.filter(row => row.subject === repairPolicyIri && row.predicate === predicate("approvedRepairInput"));
  const subjects = references.map(row => row.object);
  if (subjects.length < 1 || subjects.length > 64 || new Set(subjects).size !== subjects.length
    || subjects.includes(repairPolicyIri) || references.some(row => row.objectKind !== "iri")) invalid();
  const mode = (subject: string, name: string): number => {
    const value = field(subject, name, "literal"), parsed = Number(value);
    if (!/^[1-9][0-9]{2}$/u.test(value) || parsed > 0o777 || (parsed & 0o600) !== 0o600 || (parsed & 0o002) !== 0) return invalid();
    return parsed;
  };
  const inputs = subjects.map(subject => {
    closed(subject, ["type", "repositoryPath", "preimageDigest", "preimageMode", "postimageDigest", "postimageMode"]);
    if (field(subject, "type", "iri") !== "urn:usf:type:ConstructionContinuationRepairInput") invalid();
    const path = field(subject, "repositoryPath", "literal");
    if (parseRepositoryPath(path, "file") === null || path.startsWith("evidence/") || path === changedPath || path === acceptancePath) invalid();
    const before = { path, digest: digest(field(subject, "preimageDigest", "literal")), mode: mode(subject, "preimageMode") };
    const after = { path, digest: path === repairPolicySource ? null : digest(field(subject, "postimageDigest", "literal")), mode: mode(subject, "postimageMode") };
    if (before.mode !== after.mode || (path === repairPolicySource && objectValues(graph, subject, predicate("postimageDigest")).length !== 0)) invalid();
    return { before, after };
  }).sort((a, b) => a.before.path.localeCompare(b.before.path));
  if (new Set(inputs.map(input => input.before.path)).size !== inputs.length || !inputs.some(input => input.before.path === repairPolicySource)) invalid();
  const source = graph.sources.find(entry => entry.path === repairPolicySource);
  const selectedSubjects = new Set([repairPolicyIri, ...subjects]);
  const rows = graph.quads.filter(row => selectedSubjects.has(row.subject));
  if (!source || rows.some(row => row.graph !== source.graph)) invalid();
  return {
    predecessorIntentDigest: digest(field(repairPolicyIri, "predecessorIntentDigest", "literal")),
    predecessorStateDigest: digest(field(repairPolicyIri, "predecessorStateDigest", "literal")),
    observationDigest: digest(field(repairPolicyIri, "integrationObservationDigest", "literal")), inputs,
    rows: rows.map(canonicalQuadLine).sort(), digest: canonicalDigest(rows.map(canonicalQuadLine).sort()),
    ...(currentAuthorityRows.length === 0 ? {} : { currentAuthorityOnlyPublicationSource: currentAuthorityPublicationSource }),
  };
}

function assertRepairBoundary(intent: ContinuationIntent, state: ContinuationState, intentDigest: string, stateDigest: string): void {
  if (intent.repairHandoff !== undefined || canonicalDigest(intent) !== intentDigest || canonicalDigest(state) !== stateDigest
    || state.intentDigest !== intentDigest || state.nextStep !== 0 || state.integration !== null
    || state.pending !== null || state.terminal || state.completedEffects.length !== 0) refuse("LINEAR_CONTINUATION_HANDOFF_BOUNDARY_INVALID");
}

/** An append is reversible only if the complete, exact tail is the authorized typed record set. */
function reverseRepairAppendBytes(bytes: Buffer, lines: readonly string[], expectedDigest: string): Buffer {
  const source = bytes.toString("utf8");
  if (!source.endsWith("\n") || source.includes("\r") || new Set(lines).size !== lines.length) refuse("LINEAR_CONTINUATION_HANDOFF_DELTA_INVALID");
  const all = source.slice(0, -1).split("\n");
  if (all.length <= lines.length) refuse("LINEAR_CONTINUATION_HANDOFF_DELTA_INVALID");
  const remaining = [...all];
  for (const line of lines) {
    const index = remaining.indexOf(line);
    if (index < 0) refuse("LINEAR_CONTINUATION_HANDOFF_DELTA_INVALID");
    remaining.splice(index, 1);
  }
  const result = Buffer.from(remaining.join("\n") + "\n");
  if (sha256(result) !== expectedDigest) refuse("LINEAR_CONTINUATION_HANDOFF_DELTA_INVALID");
  return result;
}

function reverseRepairAppend(bytes: Buffer, lines: readonly string[], expectedDigest: string): void {
  reverseRepairAppendBytes(bytes, lines, expectedDigest);
}

function authenticateRepairPreimage(root: string, intent: ContinuationIntent, expected: FileFact): void {
  const retainedFacts = [...intent.beforeFiles, ...intent.repositoryDirtyFiles].filter(file => file.path === expected.path);
  if (retainedFacts.length > 0) {
    if (retainedFacts.some(file => !same(file, expected))) refuse("LINEAR_CONTINUATION_HANDOFF_PREIMAGE_INVALID");
    return;
  }
  // Git authenticates bytes and the executable class, not historical group-write bits.
  const entry = gitText(root, ["ls-tree", "-z", intent.repositoryCommit, "--", expected.path]);
  const match = /^(100644|100755) blob [a-f0-9]{40,64}\t([^\0]+)\0$/u.exec(entry);
  if (!match || match[2] !== expected.path || expected.mode === null
    || (match[1] === "100755") !== ((expected.mode & 0o111) !== 0)) refuse("LINEAR_CONTINUATION_HANDOFF_PREIMAGE_INVALID");
  const bytes = execFileSync("git", ["show", intent.repositoryCommit + ":" + expected.path],
    { cwd: root, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (sha256(bytes) !== expected.digest) refuse("LINEAR_CONTINUATION_HANDOFF_PREIMAGE_INVALID");
}

function currentRepairPublication(root: string, selected: { workIri: string; profile: string; manifestPath: string }) {
  const graph = loadSemanticGraph(root, selected.manifestPath), current = packet(root, selected);
  const permission = current.realisationAuthority?.permission;
  if (current.eligibility?.construction.eligible !== true || current.eligibility.construction.authority !== "active-permission"
    || current.eligibility.activation.eligible !== true || permission?.activationState !== "urn:usf:contract-state:active"
    || (selected.workIri === controllerWork && current.contract !== controllerContract)) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_INACTIVE");
  const authority = deriveConstructionAuthority(graph, selected.workIri, selected.manifestPath);
  const grant = constructionGrantIri(selected.workIri, permission.id, current.eligibility.authorityBasisDigest);
  const values = objectValues(graph, grant, predicate("publicationIntentDigest"));
  if (values.length !== 1) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_INACTIVE");
  const path = constructionReceiptPath(digest(values[0]), authority), file = readFileFact(root, path);
  if (file.bytes === null) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
  const value: unknown = JSON.parse(file.bytes.toString("utf8"));
  if (!validateConstructionReceiptShape(root, value, authority)) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
  const { receiptDigest, ...body } = value;
  if (value.status !== "verified" || value.members.length !== 1 || value.members[0]?.grantIri !== grant
    || value.members[0]?.workIri !== selected.workIri || value.members[0]?.authorityBasisDigest !== current.eligibility.authorityBasisDigest
    || value.semanticSourcePath !== authority.sourcePath || value.publicationReceiptPath !== path
    || value.publicationIntentDigest !== values[0] || value.profileIri !== selected.profile || value.manifestPath !== selected.manifestPath
    || canonicalDigest(body, { rejectAbsolutePaths: true }) !== receiptDigest
    || canonicalJson(value, { rejectAbsolutePaths: true }) + "\n" !== file.bytes.toString("utf8")
    || value.operations.some(operation => operation.kind !== "add" || operation.sourcePath !== authority.sourcePath)
    || value.operations.length === 0) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
  return { graph, current, selected, authority, receipt: value, file: file.fact, source: readFileFact(root, authority.sourcePath) };
}

/** Authenticate the entire current source, not merely the existence of an active grant. */
function authenticateCurrentPublicationSource(publication: ReturnType<typeof currentRepairPublication>): void {
  const { source, receipt } = publication;
  const mode = source.fact.mode;
  if (source.bytes === null || mode === null || (mode & 0o600) !== 0o600 || (mode & 0o113) !== 0
    || source.fact.digest !== sha256(source.bytes) || source.fact.digest !== receipt.resultingSourceDigest
    || source.fact.path !== receipt.semanticSourcePath || !digestPattern.test(receipt.baseSourceDigest)
    || receipt.baseSourceDigest === receipt.resultingSourceDigest) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
  reverseRepairAppend(source.bytes, receipt.operations.map(operation => operation.line), receipt.baseSourceDigest);
}

/** Authenticate every additive publication between a retained source and the current grant. */
function authenticatePublicationChain(root: string, publication: ReturnType<typeof currentRepairPublication>, expectedBase: string): FileFact[] {
  const { authority } = publication;
  let bytes = publication.source.bytes, receipt = publication.receipt;
  if (bytes === null || publication.source.fact.digest !== sha256(bytes)) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
  const intents = [...new Set(publication.graph.quads
    .filter(row => row.predicate === predicate("publicationIntentDigest") && row.objectKind === "literal" && digestPattern.test(row.object))
    .map(row => row.object))];
  const seen = new Set<string>();
  const receiptFiles = [publication.file];
  for (let hop = 0; hop < 64; hop++) {
    if (seen.has(receipt.publicationIntentDigest) || receipt.resultingSourceDigest !== sha256(bytes)) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
    seen.add(receipt.publicationIntentDigest);
    bytes = reverseRepairAppendBytes(bytes, receipt.operations.map(operation => operation.line), receipt.baseSourceDigest);
    if (receipt.baseSourceDigest === expectedBase) return receiptFiles;
    const matches = intents.flatMap(intent => {
      if (seen.has(intent)) return [];
      const path = constructionReceiptPath(intent, authority), file = readFileFact(root, path);
      if (file.bytes === null) return [];
      let value: any;
      try { value = JSON.parse(file.bytes.toString("utf8")); } catch { return []; }
      const { receiptDigest, ...body } = value ?? {};
      return validateConstructionReceiptShape(root, value, authority)
        && value.status === "verified" && value.members.length === 1
        && value.members[0]?.workIri === publication.current.id
        && value.semanticSourcePath === publication.source.fact.path
        && value.publicationReceiptPath === path && value.publicationIntentDigest === intent
        && value.profileIri === publication.selected.profile
        && value.manifestPath === publication.selected.manifestPath
        && value.resultingSourceDigest === receipt.baseSourceDigest
        && canonicalDigest(body, { rejectAbsolutePaths: true }) === receiptDigest
        && canonicalJson(value, { rejectAbsolutePaths: true }) + "\n" === file.bytes.toString("utf8")
        && value.operations.length > 0
        && value.operations.every((operation: any) => operation.kind === "add" && operation.sourcePath === publication.source.fact.path)
        ? [{ value, fact: file.fact }] : [];
    });
    if (matches.length !== 1) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
    receipt = matches[0].value;
    receiptFiles.push(matches[0].fact);
  }
  refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
}

/** A missing historical fact is never converted to an absent historical file. */
function currentAuthorityInput(root: string, intent: ContinuationIntent, admission: RepairAdmission,
  integration: NonNullable<ContinuationState["integration"]>, publication: ReturnType<typeof currentRepairPublication>): CurrentAuthorityInput {
  const eligibility = publication.current.eligibility;
  if (!eligibility) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_INACTIVE");
  if (admission.currentAuthorityOnlyPublicationSource !== currentAuthorityPublicationSource
    || publication.source.fact.path !== currentAuthorityPublicationSource
    || publication.current.id !== bindingPublicationSelection.workIri
    || [...intent.beforeFiles, ...intent.repositoryDirtyFiles].some(file => file.path === currentAuthorityPublicationSource)) {
    refuse("LINEAR_CONTINUATION_HANDOFF_CURRENT_AUTHORITY_SCOPE_INVALID");
  }
  authenticateCurrentPublicationSource(publication);
  const source = publication.graph.sources.find(entry => entry.path === currentAuthorityPublicationSource);
  if (!source) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
  const subjects = [...new Set(publication.graph.quads.filter(row => row.graph === source.graph).map(row => row.subject))].sort();
  if (subjects.length === 0 || subjects.length > 16384) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
  const forbidden = new Set([currentAuthorityPublicationSource, publication.file.path, source.graph, ...subjects]);
  let nodes = 0;
  const inspect = (value: unknown): void => {
    if (++nodes > 100000) refuse("LINEAR_CONTINUATION_HANDOFF_INDEPENDENCE_UNPROVEN");
    if (typeof value === "string") {
      if (forbidden.has(value)) refuse("LINEAR_CONTINUATION_HANDOFF_SELECTED_DEPENDENCY_INTERSECTION");
    } else if (Array.isArray(value)) {
      for (const child of value) inspect(child);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) { inspect(key); inspect(child); }
    }
  };
  const observationPath = ".usf/receipts/integration/" + integration.observationDigest.slice(7) + ".json";
  const observation = readFileFact(root, observationPath);
  if (observation.bytes === null || !same(observation.fact, integration.files.find(file => file.path === observationPath))) {
    refuse("LINEAR_CONTINUATION_HANDOFF_INDEPENDENCE_UNPROVEN");
  }
  const observed = JSON.parse(observation.bytes.toString("utf8")) as { observationDigest?: unknown };
  if (observed.observationDigest !== integration.observationDigest) refuse("LINEAR_CONTINUATION_HANDOFF_INDEPENDENCE_UNPROVEN");
  // The caller authenticated this exact native observation, including original/postimage
  // selected bases, checks, cohort and integration evidence, before reaching this snapshot.
  inspect(observed);
  const checks = intent.checkReceiptPaths.map(path => {
    const checked = readFileFact(root, path);
    if (checked.bytes === null || !same(checked.fact, intent.beforeFiles.find(file => file.path === path))) {
      refuse("LINEAR_CONTINUATION_HANDOFF_INDEPENDENCE_UNPROVEN");
    }
    inspect(JSON.parse(checked.bytes.toString("utf8")) as unknown);
    return checked.fact;
  });
  return {
    disposition: "current-authority-only", historicalEquivalence: "not-claimed",
    source: publication.source.fact, publicationReceipt: publication.file,
    publicationIntentDigest: digest(publication.receipt.publicationIntentDigest),
    publicationReceiptDigest: digest(publication.receipt.receiptDigest),
    authorityBasisDigest: digest(eligibility.authorityBasisDigest),
    selectedDependencyIndependenceDigest: canonicalDigest({
      candidateDigest: intent.candidateDigest, basisDigest: intent.basisDigest,
      workspaceIdentityDigest: intent.workspaceIdentityDigest, sourcePath: currentAuthorityPublicationSource,
      sourceGraph: source.graph, subjects, observation: observation.fact, checks,
    }),
  };
}

function assertCurrentAuthorityInputLineage(value: unknown, intent: ContinuationIntent): void {
  if (value === undefined) return;
  const invalid = (): never => refuse("LINEAR_CONTINUATION_HANDOFF_LINEAGE_INVALID");
  if (!Array.isArray(value) || value.length !== 1) return invalid();
  const fileFact = (value: unknown): value is { path: string; digest: string; mode: number } => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const fact = value as Record<string, unknown>;
    return Object.keys(fact).length === 3 && typeof fact.path === "string"
      && typeof fact.digest === "string" && digestPattern.test(fact.digest)
      && typeof fact.mode === "number" && Number.isInteger(fact.mode) && fact.mode >= 0 && fact.mode <= 0o777;
  };
  const input = value[0] as CurrentAuthorityInput | undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)
    || input.disposition !== "current-authority-only" || input.historicalEquivalence !== "not-claimed"
    || !fileFact(input.source) || !fileFact(input.publicationReceipt)
    || input.source.path !== currentAuthorityPublicationSource
    || !isContinuationInputPath(input.publicationReceipt.path)) return invalid();
  for (const field of [input.publicationIntentDigest, input.publicationReceiptDigest,
    input.authorityBasisDigest, input.selectedDependencyIndependenceDigest]) {
    if (typeof field !== "string" || !digestPattern.test(field)) return invalid();
  }
  if ((input.source.mode & 0o600) !== 0o600 || (input.source.mode & 0o113) !== 0
    || !Array.isArray(intent.beforeFiles)) return invalid();
  const capturedSource = intent.beforeFiles.find(file => file?.path === input.source.path);
  const capturedReceipt = intent.beforeFiles.find(file => file?.path === input.publicationReceipt.path);
  if (!fileFact(capturedSource) || !fileFact(capturedReceipt)) return invalid();
  if (!same(capturedSource, input.source) || !same(capturedReceipt, input.publicationReceipt)) return invalid();
}

function bindingPublicationCapture(root: string,
  bindings: readonly { manifestPath: string; packet?: WorkPacket }[], extras: readonly string[]) {
  const publication = currentRepairPublication(root, bindingPublicationSelection);
  const eligibility = publication.current.eligibility;
  if (!eligibility) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_INACTIVE");
  authenticateCurrentPublicationSource(publication);
  const files = protectedFiles(root, [...bindings,
    { manifestPath: bindingPublicationSelection.manifestPath, packet: publication.current }],
  [...extras, publication.source.fact.path, publication.file.path]);
  if (!same(files.find(file => file.path === publication.source.fact.path), publication.source.fact)
    || !same(files.find(file => file.path === publication.file.path), publication.file)) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED");
  return { files, basisDigest: publication.current.realisationBasis!.basisDigest,
    authorityBasisDigest: eligibility.authorityBasisDigest,
    source: publication.source.fact, receipt: publication.file, receiptDigest: publication.receipt.receiptDigest };
}

function repairSnapshot(root: string, intent: ContinuationIntent, state: ContinuationState,
  admission: RepairAdmission, integration: NonNullable<ContinuationState["integration"]>) {
  assertRepairBoundary(intent, state, admission.predecessorIntentDigest, admission.predecessorStateDigest);
  if (!same(repairAdmission(root, intent), admission) || policy(root).digest !== intent.policyDigest
    || integration.observationDigest !== admission.observationDigest
    || canonicalDigest(deriveLinearBindingDeclaration(loadSemanticGraph(root, intent.bindingManifest), intent.bindingIri)) !== intent.bindingDigest
    || !same(intent.selected, selection(packet(root, intent.selected), selectedProfile, selectedManifest))) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED");
  const publications = [currentRepairPublication(root, intent.selected), currentRepairPublication(root, intent.controller),
    currentRepairPublication(root, bindingPublicationSelection)];
  const controller = publications[1]!.current;
  if (!same(intent.controller, selection(controller, controllerProfile, controllerManifest))) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED");
  const replacements = new Map<string, FileFact>();
  const publicationReceipts: FileFact[] = [];
  for (const input of admission.inputs) {
    authenticateRepairPreimage(root, intent, input.before);
    if (publications.some(publication => publication.source.fact.path === input.before.path)) refuse("LINEAR_CONTINUATION_HANDOFF_POLICY_INVALID");
    const actual = readFileFact(root, input.before.path);
    if (input.before.path === repairPolicySource) {
      if (actual.bytes === null || actual.fact.mode !== input.after.mode
        || !controller.realisationBasis!.work.dependencies.some(dependency => dependency.kind === "file"
          && dependency.key === repairPolicySource && dependency.digest === actual.fact.digest)) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_INACTIVE");
      reverseRepairAppend(actual.bytes, admission.rows, input.before.digest!);
    } else if (!same(actual.fact, input.after)) refuse("LINEAR_CONTINUATION_HANDOFF_POSTIMAGE_INVALID");
    replacements.set(actual.fact.path, actual.fact);
  }
  const currentAuthorityInputs: CurrentAuthorityInput[] = [];
  for (const publication of publications) {
    const before = intent.beforeFiles.find(file => file.path === publication.source.fact.path);
    if (!before) {
      if (admission.currentAuthorityOnlyPublicationSource !== publication.source.fact.path) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
      currentAuthorityInputs.push(currentAuthorityInput(root, intent, admission, integration, publication));
      replacements.set(publication.source.fact.path, publication.source.fact);
      replacements.set(publication.file.path, publication.file);
      continue;
    }
    if (admission.currentAuthorityOnlyPublicationSource === publication.source.fact.path) refuse("LINEAR_CONTINUATION_HANDOFF_CURRENT_AUTHORITY_SCOPE_INVALID");
    if (publication.source.bytes === null || publication.source.fact.mode !== before.mode) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
    if (same(before, publication.source.fact)) continue;
    if (publication.source.fact.digest !== publication.receipt.resultingSourceDigest) refuse("LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID");
    for (const receiptFile of authenticatePublicationChain(root, publication, before.digest!)) {
      replacements.set(receiptFile.path, receiptFile);
      publicationReceipts.push(receiptFile);
    }
    replacements.set(publication.source.fact.path, publication.source.fact);
    replacements.set(publication.file.path, publication.file);
  }
  if (currentAuthorityInputs.length !== (admission.currentAuthorityOnlyPublicationSource === undefined ? 0 : 1)) {
    refuse("LINEAR_CONTINUATION_HANDOFF_POLICY_INVALID");
  }
  const allowed = new Set([changedPath, ...replacements.keys()]);
  const changes = repositoryChanges(root, intent.repositoryCommit);
  if (!same(intent.repositoryDirtyFiles.filter(file => !allowed.has(file.path)), changes.filter(file => !allowed.has(file.path)))) refuse("LINEAR_CONTINUATION_UNRELATED_CHANGE");
  const expected = expectedPostimages(intent, { ...state, integration }).filter(file => !replacements.has(file.path));
  assertFiles(root, expected);
  const beforeFiles = new Map(intent.beforeFiles.map(file => [file.path, file]));
  for (const [path, fact] of replacements) beforeFiles.set(path, fact);
  return {
    beforeFiles: [...beforeFiles.values()].sort((a, b) => a.path.localeCompare(b.path)),
    repositoryDirtyFiles: changes.filter(file => file.path !== changedPath),
    controllerBasisDigest: controller.realisationBasis!.basisDigest,
    publicationReceipts: [...publicationReceipts,
      ...publications.filter(publication => !publicationReceipts.some(file => file.path === publication.file.path)).map(publication => publication.file)],
    currentAuthorityInputs,
  };
}

async function admitRepairHandoff(root: string, intent: ContinuationIntent, state: ContinuationState,
  admission: RepairAdmission): Promise<{ intent: ContinuationIntent; state: ContinuationState }> {
  const binding = deriveLinearBindingDeclaration(loadSemanticGraph(root, intent.bindingManifest), intent.bindingIri);
  const issueKey = canonicalDigest({ purpose: "linear-binding-issue-execution", locator: binding.locator });
  return withCandidateLock(root, issueKey, async () => {
    const lock = await acquirePrimaryMutationLock(root);
    try {
      const expectedPointer = { schema: "urn:usf:linear-continuation-pointer:1", intentDigest: canonicalDigest(intent), stateDigest: canonicalDigest(state) };
      const assertPointer = async () => {
        if (!same(await readLinearRecord(root, pointerKey), expectedPointer)) refuse("LINEAR_CONTINUATION_POINTER_CONFLICT");
        const store = await LinearStateStore.open(root);
        const graph = loadSemanticGraph(root, intent.bindingManifest);
        const selected = deriveLinearBindingDeclaration(graph, intent.bindingIri);
        if (canonicalDigest(selected) !== intent.bindingDigest) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED");
        for (const entry of store.intents()) {
          if (entry.state !== "prepared" && entry.state !== "sent" && entry.state !== "unknown") continue;
          if (entry.identity.bindingIri === intent.bindingIri) refuse("LINEAR_CONTINUATION_HANDOFF_REMOTE_INTENT_PENDING");
          let target: ReturnType<typeof deriveLinearBindingDeclaration>;
          try { target = deriveLinearBindingDeclaration(graph, entry.identity.bindingIri); }
          catch { refuse("LINEAR_CONTINUATION_HANDOFF_REMOTE_INTENT_TARGET_UNRESOLVED"); }
          // The existing issue-ownership key uses this canonical, workspace-qualified locator.
          // Neither a successor binding nor a comment's remote operation ID changes its target.
          if (target.locator === selected.locator) refuse("LINEAR_CONTINUATION_HANDOFF_REMOTE_INTENT_PENDING");
        }
      };
      await assertPointer();
      assertRepairBoundary(intent, state, admission.predecessorIntentDigest, admission.predecessorStateDigest);
      const integration = await authenticatedIntegration(root, intent, true);
      const snapshot = repairSnapshot(root, intent, state, admission, integration);
      const currentAuthorityInputs = snapshot.currentAuthorityInputs ?? [];
      const successor: ContinuationIntent = { ...intent, beforeFiles: snapshot.beforeFiles,
        repositoryDirtyFiles: snapshot.repositoryDirtyFiles, controllerBasisDigest: snapshot.controllerBasisDigest,
        repairHandoff: { predecessorIntentDigest: admission.predecessorIntentDigest,
          predecessorStateDigest: admission.predecessorStateDigest, admissionDigest: admission.digest,
          ...(currentAuthorityInputs.length === 0 ? {} : { currentAuthorityInputs }) } };
      const successorIntentDigest = await writeBlob(root, successor);
      const next: ContinuationState = { ...state, intentDigest: successorIntentDigest, integration };
      const successorStateDigest = await writeBlob(root, next);
      const receipt: RepairHandoffReceipt = { schema: "urn:usf:linear-continuation-repair-handoff-receipt:1",
        predecessorIntentDigest: admission.predecessorIntentDigest, predecessorStateDigest: admission.predecessorStateDigest,
        successorIntentDigest, successorStateDigest, admissionDigest: admission.digest,
        controllerBasisDigest: snapshot.controllerBasisDigest, publicationReceipts: snapshot.publicationReceipts,
        ...(currentAuthorityInputs.length === 0 ? {} : { currentAuthorityInputs }) };
      const handoffReceiptDigest = await writeBlob(root, receipt);
      await assertPointer();
      if (!same(snapshot, repairSnapshot(root, intent, state, admission, integration))) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED");
      authenticateRetained(root, successor, next);
      await writeLinearRecord(root, pointerKey, { schema: "urn:usf:linear-continuation-pointer:2",
        intentDigest: successorIntentDigest, stateDigest: successorStateDigest, handoffReceiptDigest });
      return { intent: successor, state: next };
    } finally { await lock.handle.close(); }
  });
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
  const captureBindings = [
    { manifestPath: controllerManifest, packet: currentController },
    { manifestPath: selectedManifest, packet: binding.binding.unit.packet },
    { manifestPath: binding.binding.selector.manifestPath },
  ];
  const captureExtras = [acceptancePath, binding.binding.attemptPath, binding.binding.unitPath, ...checkReceiptPaths, ...checkDependencies];
  const captured = bindingPublicationCapture(root, captureBindings, captureExtras);
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
    beforeFiles: captured.files,
  };
  const assertPreparedCurrent = () => {
    if (policy(root).digest !== intent.policyDigest
      || canonicalDigest(deriveLinearBindingDeclaration(loadSemanticGraph(root, intent.bindingManifest), intent.bindingIri)) !== intent.bindingDigest
      || packet(root, intent.controller).realisationBasis!.basisDigest !== intent.controllerBasisDigest
      || !same(bindingPublicationCapture(root, captureBindings, captureExtras), captured)) refuse("LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED");
    assertFiles(root, intent.beforeFiles);
  };
  const prior = await retained(root);
  assertPreparedCurrent();
  if (prior !== null) {
    if (!same(prior.intent, intent) || prior.state.integration !== null || prior.state.terminal) refuse("LINEAR_CONTINUATION_ALREADY_RETAINED");
    return true;
  }
  const intentDigest = await writeBlob(root, intent);
  assertPreparedCurrent();
  await saveState(root, { intentDigest, integration: null, nextStep: 0, completedEffects: [], pending: null, terminal: false }, assertPreparedCurrent);
  assertPreparedCurrent();
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
    || (intent.repairHandoff !== undefined && repairAdmission(root, intent)?.digest !== intent.repairHandoff.admissionDigest)
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
async function authenticatedIntegration(root: string, intent: ContinuationIntent, allowStalePostimage = false): Promise<NonNullable<ContinuationState["integration"]>> {
  const observed = await inspectCandidateIntegrationRecovery(root, { candidateDigests: [intent.candidateDigest] });
  const success = observed.observation, prepared = observed.prepared;
  const staleRepair = allowStalePostimage && observed.state === "stale" && success !== null && prepared !== null;
  if ((!staleRepair && observed.state !== "primary-advanced") || !success || !prepared
    || success.schema !== "urn:usf:integration-observation:2" || success.outcome !== "urn:usf:outcome:integration-success"
    || success.startingCarrierCommit !== intent.repositoryCommit
    || success.workspaceIdentityDigest !== canonicalDigest([intent.workspaceIdentityDigest]) || success.originalConstructionBases.length !== 1
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
  return {
    observationDigest: success.observationDigest, commit: success.observedCarrierCommit,
    files: [retainedIntent.fact, receipt.fact],
  };
}
async function captureIntegration(root: string, intent: ContinuationIntent, state: ContinuationState): Promise<ContinuationState> {
  const next: ContinuationState = { ...state, integration: await authenticatedIntegration(root, intent) };
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
  let found = await retained(root);
  if (found === null) return null;
  // A closed attempt is history, not a permanent global lock on future work.
  // Ordinary current policy and selected-work completion govern later cycles.
  if (found.state.terminal) return null;
  if (found.state.integration === null && found.intent.repairHandoff === undefined) {
    const admission = repairAdmission(root, found.intent);
    if (admission !== null) found = await admitRepairHandoff(root, found.intent, found.state, admission);
  }
  const { intent } = found;
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
