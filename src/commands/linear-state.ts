import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { canonicalJson } from "../core/canonical.ts";

const STATE_SCHEMA = "urn:usf:hermes-linear-state:1";
const STATE_VERSION = 1;
const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_INTENTS = 512;
const MAX_HISTORY = 2048;
const MAX_PROGRESS = 512;
const MAX_EVIDENCE_REFS = 32;
const MAX_TEXT = 512;
const MAX_JSON_NODES = 256;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;

export type LinearIntentState = "prepared" | "sent" | "unknown" | "confirmed" | "refused";
export type LinearProgressStage = "prepared" | "sent" | "unknown" | "confirmed" | "refused" | "blocked" | "completed";

export interface LinearOperationIdentity {
  readonly bindingIri: string;
  readonly operation: string;
  readonly remoteOperationId: string;
}

export interface LinearIntent {
  readonly id: string;
  readonly identity: LinearOperationIdentity;
  readonly requestDigest: `sha256:${string}`;
  readonly state: LinearIntentState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LinearProgressRecord {
  readonly bindingIri: string;
  /** The derived binding basis that produced this progress. Legacy records may omit it. */
  readonly basisDigest?: string;
  readonly stage: LinearProgressStage;
  readonly blocker: string | null;
  readonly evidenceRefs: readonly string[];
  readonly updatedAt: string;
}

export interface LinearCycleSummary {
  readonly intents: Readonly<Record<LinearIntentState, number>>;
  readonly progress: Readonly<Record<LinearProgressStage, number>>;
  readonly blockedBindings: readonly string[];
  readonly pendingUnknownIntentIds: readonly string[];
}

export interface LinearRemoteEvidence {
  readonly intentId: string;
  readonly remoteOperationId: string;
  readonly requestDigest: `sha256:${string}`;
  readonly outcome: "confirmed" | "refused";
  readonly evidenceRefs: readonly string[];
}

export interface LinearRecordObject {
  readonly [key: string]: LinearRecordValue;
}

export type LinearRecordValue = null | boolean | number | string | readonly LinearRecordValue[] | LinearRecordObject;

interface Transition {
  readonly intentId: string;
  readonly from: LinearIntentState | null;
  readonly to: LinearIntentState;
  readonly at: string;
  readonly evidenceRefs: readonly string[];
}

interface PersistedState {
  readonly schema: typeof STATE_SCHEMA;
  readonly version: typeof STATE_VERSION;
  readonly intents: readonly LinearIntent[];
  readonly transitions: readonly Transition[];
  readonly progress: readonly LinearProgressRecord[];
}

export class LinearStateError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "LinearStateError";
    this.reasonCode = reasonCode;
  }
}

function refuse(reasonCode: string): never { throw new LinearStateError(reasonCode); }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}
function validText(value: unknown, maximum = MAX_TEXT): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\u0000");
}
function validDigest(value: unknown): value is `sha256:${string}` { return typeof value === "string" && DIGEST.test(value); }
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validEvidenceRefs(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_EVIDENCE_REFS && value.every((entry) => validText(entry));
}
function validRecordKey(value: string): boolean { return RECORD_KEY.test(value) && value !== "." && value !== ".."; }
function validRecordValue(value: unknown, budget: { nodes: number }): value is LinearRecordValue {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return validText(value);
  if (Array.isArray(value)) return value.length <= MAX_JSON_NODES && value.every((item) => validRecordValue(item, budget));
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.keys(value).length <= MAX_JSON_NODES && Object.entries(value).every(([key, item]) => validRecordKey(key) && !/(?:credential|secret|token|authorization|api[_-]?key|password)/iu.test(key) && validRecordValue(item, budget));
}
function identityKey(identity: LinearOperationIdentity): string {
  if (!isObject(identity) || !exactKeys(identity, ["bindingIri", "operation", "remoteOperationId"])
    || !validText(identity.bindingIri) || !identity.bindingIri.startsWith("urn:")
    || !validText(identity.operation) || !validText(identity.remoteOperationId)) refuse("LINEAR_STATE_IDENTITY_INVALID");
  return canonicalJson({ bindingIri: identity.bindingIri, operation: identity.operation, remoteOperationId: identity.remoteOperationId }, { rejectAbsolutePaths: true });
}
function deterministicUuid(identity: LinearOperationIdentity): string {
  const bytes = createHash("sha256").update(identityKey(identity), "utf8").digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function intentValid(value: unknown): value is LinearIntent {
  if (!isObject(value) || !exactKeys(value, ["id", "identity", "requestDigest", "state", "createdAt", "updatedAt"])) return false;
  if (!validUuid(value.id) || !isObject(value.identity) || !validDigest(value.requestDigest) || !validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt)) return false;
  try { return value.id === deterministicUuid(value.identity as unknown as LinearOperationIdentity) && ["prepared", "sent", "unknown", "confirmed", "refused"].includes(value.state as string); }
  catch { return false; }
}
function transitionValid(value: unknown): value is Transition {
  return isObject(value) && exactKeys(value, ["intentId", "from", "to", "at", "evidenceRefs"])
    && validUuid(value.intentId) && (value.from === null || ["prepared", "sent", "unknown", "confirmed", "refused"].includes(value.from as string))
    && ["prepared", "sent", "unknown", "confirmed", "refused"].includes(value.to as string)
    && validTimestamp(value.at) && validEvidenceRefs(value.evidenceRefs);
}
function progressValid(value: unknown): value is LinearProgressRecord {
  const keys = isObject(value) ? Object.keys(value).sort().join(",") : "";
  const legacyKeys = ["bindingIri", "blocker", "evidenceRefs", "stage", "updatedAt"].join(",");
  const currentKeys = ["basisDigest", "bindingIri", "blocker", "evidenceRefs", "stage", "updatedAt"].join(",");
  return isObject(value) && (keys === legacyKeys || keys === currentKeys)
    && validText(value.bindingIri) && value.bindingIri.startsWith("urn:")
    && (value.basisDigest === undefined || validDigest(value.basisDigest))
    && ["prepared", "sent", "unknown", "confirmed", "refused", "blocked", "completed"].includes(value.stage as string)
    && (value.blocker === null || validText(value.blocker)) && validEvidenceRefs(value.evidenceRefs) && validTimestamp(value.updatedAt);
}
function parseState(bytes: string): PersistedState {
  if (Buffer.byteLength(bytes, "utf8") > MAX_STATE_BYTES) refuse("LINEAR_STATE_TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { refuse("LINEAR_STATE_CORRUPT"); }
  if (!isObject(value) || !exactKeys(value, ["schema", "version", "intents", "transitions", "progress"])
    || value.schema !== STATE_SCHEMA || value.version !== STATE_VERSION
    || !Array.isArray(value.intents) || !Array.isArray(value.transitions) || !Array.isArray(value.progress)
    || value.intents.length > MAX_INTENTS || value.transitions.length > MAX_HISTORY || value.progress.length > MAX_PROGRESS
    || !value.intents.every(intentValid) || !value.transitions.every(transitionValid) || !value.progress.every(progressValid)) refuse("LINEAR_STATE_CORRUPT");
  const intents = value.intents as LinearIntent[];
  if (new Set(intents.map((intent) => intent.id)).size !== intents.length || new Set(value.progress.map((record) => record.bindingIri)).size !== value.progress.length) refuse("LINEAR_STATE_CORRUPT");
  return Object.freeze({ schema: STATE_SCHEMA, version: STATE_VERSION, intents: Object.freeze(intents), transitions: Object.freeze(value.transitions as Transition[]), progress: Object.freeze(value.progress as LinearProgressRecord[]) });
}
function emptyState(): PersistedState {
  return Object.freeze({ schema: STATE_SCHEMA, version: STATE_VERSION, intents: Object.freeze([]), transitions: Object.freeze([]), progress: Object.freeze([]) });
}
function assertTransition(from: LinearIntentState, to: LinearIntentState): void {
  const allowed: Readonly<Record<LinearIntentState, readonly LinearIntentState[]>> = {
    prepared: ["sent"], sent: ["unknown", "confirmed", "refused"], unknown: ["confirmed", "refused"], confirmed: [], refused: [],
  };
  if (!allowed[from].includes(to)) refuse("LINEAR_STATE_TRANSITION_REFUSED");
}

export class LinearStateStore {
  private state: PersistedState;
  private readonly statePath: string;
  private readonly root: string;
  private mutations: Promise<void> = Promise.resolve();

  private constructor(root: string, state: PersistedState) {
    this.root = root;
    this.statePath = resolve(root, ".usf/hermes/linear/state.json");
    this.state = state;
  }

  static async open(repositoryRoot: string): Promise<LinearStateStore> {
    const root = await secureRepositoryRoot(repositoryRoot);
    const statePath = resolve(root, ".usf/hermes/linear/state.json");
    const directory = dirname(statePath);
    await securePrivateDirectory(root, directory);
    const state = await readState(statePath);
    return new LinearStateStore(root, state);
  }

  intents(): readonly LinearIntent[] { return this.state.intents; }
  progress(): readonly LinearProgressRecord[] { return this.state.progress; }

  async prepare(identity: LinearOperationIdentity, requestDigest: `sha256:${string}`, at = new Date().toISOString()): Promise<LinearIntent> {
    return this.serialize(async () => {
      const key = identityKey(identity);
      if (!validDigest(requestDigest) || !validTimestamp(at)) refuse("LINEAR_STATE_INTENT_INVALID");
      const id = deterministicUuid(identity);
      const existing = this.state.intents.find((intent) => intent.id === id);
      if (existing !== undefined) {
        if (identityKey(existing.identity) !== key || existing.requestDigest !== requestDigest) refuse("LINEAR_STATE_INTENT_CONFLICT");
        return existing;
      }
      if (this.state.intents.length >= MAX_INTENTS || this.state.transitions.length >= MAX_HISTORY) refuse("LINEAR_STATE_CAPACITY_EXCEEDED");
      const intent: LinearIntent = Object.freeze({ id, identity: Object.freeze({ ...identity }), requestDigest, state: "prepared", createdAt: at, updatedAt: at });
      await this.replace({ ...this.state, intents: [...this.state.intents, intent], transitions: [...this.state.transitions, { intentId: id, from: null, to: "prepared", at, evidenceRefs: [] }] });
      return intent;
    });
  }

  async markSent(intentId: string, at = new Date().toISOString()): Promise<LinearIntent> {
    return this.serialize(() => this.transitionNow(intentId, "sent", [], at));
  }

  /** Records an interrupted or timed-out send; it never authorizes a retry. */
  async markUnknown(intentId: string, at = new Date().toISOString()): Promise<LinearIntent> {
    return this.serialize(() => this.transitionNow(intentId, "unknown", [], at));
  }

  async reconcile(evidence: LinearRemoteEvidence, at = new Date().toISOString()): Promise<{ readonly status: "reconciled" | "ambiguous"; readonly intent: LinearIntent }> {
    return this.serialize(async () => {
      if (!isObject(evidence) || !exactKeys(evidence, ["intentId", "remoteOperationId", "requestDigest", "outcome", "evidenceRefs"])
        || !validUuid(evidence.intentId) || !validText(evidence.remoteOperationId) || !validDigest(evidence.requestDigest)
        || !["confirmed", "refused"].includes(evidence.outcome) || !validEvidenceRefs(evidence.evidenceRefs) || !validTimestamp(at)) refuse("LINEAR_STATE_EVIDENCE_INVALID");
      const intent = this.find(evidence.intentId);
      if (intent.identity.remoteOperationId !== evidence.remoteOperationId || intent.requestDigest !== evidence.requestDigest) return Object.freeze({ status: "ambiguous" as const, intent });
      if (intent.state === "confirmed" || intent.state === "refused") return Object.freeze({ status: intent.state === evidence.outcome ? "reconciled" as const : "ambiguous" as const, intent });
      if (intent.state !== "sent" && intent.state !== "unknown") return Object.freeze({ status: "ambiguous" as const, intent });
      return Object.freeze({ status: "reconciled" as const, intent: await this.transitionNow(intent.id, evidence.outcome, evidence.evidenceRefs, at) });
    });
  }

  async recordProgress(record: Omit<LinearProgressRecord, "updatedAt">, at = new Date().toISOString()): Promise<LinearProgressRecord> {
    return this.serialize(async () => {
      const candidate = Object.freeze({ ...record, evidenceRefs: Object.freeze([...record.evidenceRefs]), updatedAt: at });
      if (!progressValid(candidate) || !validTimestamp(at)) refuse("LINEAR_STATE_PROGRESS_INVALID");
      const previous = this.state.progress.find((item) => item.bindingIri === candidate.bindingIri);
      if (previous?.stage === "completed" && candidate.stage !== "completed"
        && (previous.basisDigest === undefined || candidate.basisDigest === undefined || previous.basisDigest === candidate.basisDigest)) {
        refuse("LINEAR_STATE_PROGRESS_REGRESSION");
      }
      const progress = previous === undefined ? [...this.state.progress, candidate] : this.state.progress.map((item) => item.bindingIri === candidate.bindingIri ? candidate : item);
      if (progress.length > MAX_PROGRESS) refuse("LINEAR_STATE_CAPACITY_EXCEEDED");
      await this.replace({ ...this.state, progress });
      return candidate;
    });
  }

  summary(): LinearCycleSummary {
    const intents: Record<LinearIntentState, number> = { prepared: 0, sent: 0, unknown: 0, confirmed: 0, refused: 0 };
    const progress: Record<LinearProgressStage, number> = { prepared: 0, sent: 0, unknown: 0, confirmed: 0, refused: 0, blocked: 0, completed: 0 };
    for (const intent of this.state.intents) intents[intent.state] += 1;
    for (const record of this.state.progress) progress[record.stage] += 1;
    return Object.freeze({ intents: Object.freeze(intents), progress: Object.freeze(progress), blockedBindings: Object.freeze(this.state.progress.filter((record) => record.stage === "blocked").map((record) => record.bindingIri).sort()), pendingUnknownIntentIds: Object.freeze(this.state.intents.filter((intent) => intent.state === "unknown").map((intent) => intent.id).sort()) });
  }

  private find(intentId: string): LinearIntent {
    if (!validUuid(intentId)) refuse("LINEAR_STATE_INTENT_NOT_FOUND");
    return this.state.intents.find((intent) => intent.id === intentId) ?? refuse("LINEAR_STATE_INTENT_NOT_FOUND");
  }

  private async transitionNow(intentId: string, to: LinearIntentState, evidenceRefs: readonly string[], at: string): Promise<LinearIntent> {
    if (!validTimestamp(at) || !validEvidenceRefs(evidenceRefs)) refuse("LINEAR_STATE_TRANSITION_REFUSED");
    const prior = this.find(intentId);
    if (prior.state === to) return prior;
    assertTransition(prior.state, to);
    if (this.state.transitions.length >= MAX_HISTORY) refuse("LINEAR_STATE_CAPACITY_EXCEEDED");
    const next = Object.freeze({ ...prior, state: to, updatedAt: at });
    await this.replace({ ...this.state, intents: this.state.intents.map((intent) => intent.id === prior.id ? next : intent), transitions: [...this.state.transitions, Object.freeze({ intentId: prior.id, from: prior.state, to, at, evidenceRefs: Object.freeze([...evidenceRefs]) })] });
    return next;
  }

  private async replace(next: PersistedState): Promise<void> {
    await writeState(this.root, this.statePath, next);
    this.state = parseState(canonicalJson(next, { rejectAbsolutePaths: true }));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutations.then(operation, operation);
    this.mutations = run.then(() => undefined, () => undefined);
    return run;
  }
}

async function secureRepositoryRoot(repositoryRoot: string): Promise<string> {
  const lexical = resolve(repositoryRoot);
  const entry = await lstat(lexical).catch(() => refuse("LINEAR_STATE_ROOT_UNSAFE"));
  if (!entry.isDirectory() || entry.isSymbolicLink()) refuse("LINEAR_STATE_ROOT_UNSAFE");
  const root = await realpath(lexical).catch(() => refuse("LINEAR_STATE_ROOT_UNSAFE"));
  if (root !== lexical) refuse("LINEAR_STATE_ROOT_UNSAFE");
  return root;
}
async function securePrivateDirectory(root: string, directory: string, create = true): Promise<boolean> {
  const relativePath = relative(root, directory);
  if (relativePath === "" || relativePath.startsWith("..") || resolve(root, relativePath) !== directory) refuse("LINEAR_STATE_PATH_UNSAFE");
  let cursor = root;
  for (const part of relativePath.split(sep)) {
    cursor = resolve(cursor, part);
    if (create) await mkdir(cursor, { mode: privateDirectoryMode }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") refuse("LINEAR_STATE_PATH_UNSAFE"); });
    const isPrivateLeaf = cursor !== resolve(root, ".usf");
    const entry = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (!create && error.code === "ENOENT") return null;
      return refuse("LINEAR_STATE_PATH_UNSAFE");
    });
    if (entry === null) return false;
    const unsafeMode = isPrivateLeaf ? (entry.mode & 0o077) !== 0 : (entry.mode & 0o002) !== 0;
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid?.() || unsafeMode || await realpath(cursor).catch(() => "") !== cursor) refuse("LINEAR_STATE_PATH_UNSAFE");
  }
  return true;
}
async function readState(path: string): Promise<PersistedState> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); refuse("LINEAR_STATE_PATH_UNSAFE"); }
  try {
    const before = await lstat(path);
    const actual = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o077) !== 0 || before.size > MAX_STATE_BYTES || before.dev !== actual.dev || before.ino !== actual.ino) refuse("LINEAR_STATE_PATH_UNSAFE");
    return parseState(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}
async function writeState(root: string, path: string, state: PersistedState): Promise<void> {
  await writePrivateJson(root, path, state, "LINEAR_STATE_CAPACITY_EXCEEDED");
}
async function writePrivateJson(root: string, path: string, value: LinearRecordValue | PersistedState, oversizeReason: string): Promise<void> {
  const directory = dirname(path);
  await securePrivateDirectory(root, directory);
  const bytes = `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`;
  if (Buffer.byteLength(bytes, "utf8") > MAX_STATE_BYTES) refuse(oversizeReason);
  const temporary = resolve(directory, `.state-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), privateFileMode);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    const prior = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (prior !== undefined && (!prior.isFile() || prior.isSymbolicLink() || prior.nlink !== 1 || (prior.mode & 0o077) !== 0)) refuse("LINEAR_STATE_PATH_UNSAFE");
    await rename(temporary, path);
    const directoryHandle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    if (error instanceof LinearStateError) throw error;
    refuse("LINEAR_STATE_WRITE_FAILED");
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

function recordPath(root: string, key: string): string {
  if (!validRecordKey(key)) refuse("LINEAR_STATE_RECORD_KEY_INVALID");
  const directory = resolve(root, ".usf/hermes/linear/records");
  const path = resolve(directory, `${key}.json`);
  if (dirname(path) !== directory) refuse("LINEAR_STATE_PATH_UNSAFE");
  return path;
}

/** Reads a bounded owner-private control record. A missing record is null. */
export async function readLinearRecord(repositoryRoot: string, key: string): Promise<LinearRecordValue | null> {
  const root = await secureRepositoryRoot(repositoryRoot);
  const path = recordPath(root, key);
  if (!await securePrivateDirectory(root, dirname(path), false)) return null;
  let handle;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; refuse("LINEAR_STATE_PATH_UNSAFE"); }
  try {
    const named = await lstat(path);
    const actual = await handle.stat();
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || (named.mode & 0o077) !== 0 || named.size > MAX_STATE_BYTES || named.dev !== actual.dev || named.ino !== actual.ino) refuse("LINEAR_STATE_PATH_UNSAFE");
    let value: unknown;
    try { value = JSON.parse(await handle.readFile("utf8")); } catch { refuse("LINEAR_STATE_RECORD_CORRUPT"); }
    if (!validRecordValue(value, { nodes: 0 })) refuse("LINEAR_STATE_RECORD_CORRUPT");
    return value;
  } finally { await handle.close(); }
}

/** Atomically replaces one bounded owner-private control record after fsync. */
export async function writeLinearRecord(repositoryRoot: string, key: string, value: LinearRecordValue): Promise<void> {
  const root = await secureRepositoryRoot(repositoryRoot);
  if (!validRecordValue(value, { nodes: 0 })) refuse("LINEAR_STATE_RECORD_INVALID");
  await writePrivateJson(root, recordPath(root, key), value, "LINEAR_STATE_RECORD_TOO_LARGE");
}
