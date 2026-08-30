import { createHash } from "node:crypto";
import { performance as nodePerformance } from "node:perf_hooks";
import { Parser as SparqlParser } from "@traqula/parser-sparql-1-1";
import { Parser as N3Parser, type Quad, type Term } from "n3";
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node } from "yaml";
import { canonicalizeDataset } from "../semantic/canonical.ts";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;
const iriPattern = /^(?:urn:[^<>\s]+|https?:\/\/[^<>\s]+)$/u;
const sourceExtractionResults = new WeakSet<object>();
const aggregateExtractionResults = new WeakSet<object>();
const utf8 = new TextEncoder();
const monotonicNow = nodePerformance.now.bind(nodePerformance);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const typedArraySet = Uint8Array.prototype.set;

export class LegacyExtractionError extends Error {
  readonly reasonCode: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(reasonCode: string, details?: Readonly<Record<string, unknown>>) {
    super(reasonCode);
    this.name = "LegacyExtractionError";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export interface LegacyExtractionLimits {
  readonly maxSources: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxManifests: number;
  readonly maxManifestDepth: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxRecords: number;
  readonly maxQuads: number;
  readonly maxElapsedMilliseconds: number;
}

export const defaultLegacyExtractionLimits: Readonly<LegacyExtractionLimits> = Object.freeze({
  maxSources: 32,
  maxFiles: 250_000,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxManifests: 10_000,
  maxManifestDepth: 128,
  maxNodes: 5_000_000,
  maxDepth: 128,
  maxRecords: 1_000_000,
  maxQuads: 2_000_000,
  maxElapsedMilliseconds: 300_000,
});

export const legacyExtractorProfile = deepFreeze({
  schema: "urn:usf:legacy-extractor-profile:2" as const,
  version: 2 as const,
  parsers: {
    yaml: { package: "yaml", version: "2.9.0", language: "YAML 1.2", aliases: false, mergeKeys: false, customTags: false },
    json: { package: "yaml", version: "2.9.0", lexicalProfile: "RFC 8259 JSON" },
    rdf: { package: "n3", version: "2.0.1", formats: ["text/turtle", "application/trig"] },
    sparql: { package: "@traqula/parser-sparql-1-1", version: "1.2.1", mode: "parse-only" },
    canonicalization: { algorithm: "RDFC-1.0", maxWorkFactor: 1 },
  },
  sourceProvenance: {
    objectFormat: "sha1",
    pathEncoding: "utf-8",
    fileModes: ["100644", "100755", "120000"],
    blobVerification: "git-blob-object-sha1",
    treeVerification: "recursive-git-tree-object-sha1",
    commitVerification: "git-commit-object-sha1-with-unique-tree-header",
  },
  execution: {
    semanticOrdering: "utf-16-code-unit-order",
    rdfParseContext: ["path", "baseIri"],
    parserNodeAccounting: "per-parser-budget-delta",
    inputSnapshot: "own-ordinary-enumerable-data-properties",
    byteSnapshot: "standard-uint8array-intrinsic-copy-after-prospective-bounds",
    deadlineClock: "node:perf_hooks.performance.now",
    deadlineScope: "shared-aggregate",
    deadlineIncludesInputSnapshot: true,
  },
});

export const legacyExtractorDigest = digest(canonicalJson(legacyExtractorProfile));

export type ExactLegacyFileMode = "100644" | "100755" | "120000";

export interface ExactLegacyFile {
  readonly path: string;
  readonly mode: ExactLegacyFileMode;
  readonly bytes: Uint8Array;
}

export interface ExactLegacySourceInput {
  readonly sourceSetDigest: string;
  readonly id: string;
  readonly revision: string;
  readonly tree: string;
  /** Exact payload of the pinned Git commit object, excluding its Git object header. */
  readonly commitBytes: Uint8Array;
  /** Repository-relative paths. Entries inside a manifest resolve relative to it. */
  readonly manifestRoots: readonly string[];
  /** Exact bytes for the complete pinned tracked-tree denominator. */
  readonly files: readonly ExactLegacyFile[];
}

export interface ExactLegacyExtractionInput {
  readonly schema: "urn:usf:exact-legacy-extraction-input:1";
  readonly version: 1;
  readonly sourceSetDigest: string;
  readonly sources: readonly Omit<ExactLegacySourceInput, "sourceSetDigest">[];
}

export type LegacyParserFormat = "yaml-1.2" | "json" | "turtle" | "trig" | "sparql-1.1";

export interface LegacyParserOutcome {
  readonly format: LegacyParserFormat;
  readonly status: "parsed";
  readonly sourceDigest: string;
  readonly semanticDigest: string;
  readonly nodeCount: number;
  readonly recordCount: number;
  readonly quadCount: number;
  readonly operationKind: string | null;
}

export interface LegacyTrackedFile {
  readonly path: string;
  readonly mode: ExactLegacyFileMode;
  readonly blobOid: string;
  readonly digest: string;
  readonly bytes: number;
  /** Roles are mechanically derived from the selected manifest section and path. */
  readonly roles: readonly string[];
  readonly parserOutcomes: readonly LegacyParserOutcome[];
}

export interface LegacyQuadObservation {
  readonly subject: string;
  readonly subjectKind: "iri" | "blank-node";
  readonly predicate: string;
  readonly object: string;
  readonly objectKind: "iri" | "blank-node" | "literal-digest";
  readonly graph: string | null;
  readonly graphKind: "iri" | "blank-node" | "default";
  readonly statementDigest: string;
}

export interface LegacyResourceDefinition {
  readonly iri: string;
  readonly quadCount: number;
  readonly definitionDigest: string;
}

export interface LegacyBlankNodeComponent {
  readonly componentId: string;
  readonly quadCount: number;
  readonly componentDigest: string;
}

interface LegacyManifestEntryBase {
  readonly id: string;
  readonly section: string;
  readonly role: string;
  readonly classification: "selected" | "derived" | "retired" | "inactive" | "fixture";
  readonly declarationIndex: number;
}

interface LegacyRdfEntryBase extends LegacyManifestEntryBase {
  readonly path: string;
  readonly digest: string;
  readonly graphIri: string;
  readonly loadOrder: number;
  readonly validationOrder: number;
  readonly format: "turtle" | "trig";
  readonly quadCount: number;
  readonly semanticDigest: string;
  readonly quads: readonly LegacyQuadObservation[];
  readonly resourceDefinitions: readonly LegacyResourceDefinition[];
  readonly blankNodeComponents: readonly LegacyBlankNodeComponent[];
}

export interface LegacyDefinitionGraphEntry extends LegacyRdfEntryBase {
  readonly kind: "definition-graph";
  readonly section: "definitionGraphs";
  readonly role: "definition";
  readonly classification: "selected";
}

export interface LegacyAuthoredGraphEntry extends LegacyRdfEntryBase {
  readonly kind: "authored-graph";
  readonly section: "authoredGraphs";
  readonly role: "authored";
  readonly classification: "selected";
}

export interface LegacyObservedGraphEntry extends LegacyRdfEntryBase {
  readonly kind: "observed-graph";
  readonly section: "observedGraphs";
  readonly role: "observed";
  readonly classification: "selected";
  readonly collector: string;
}

export interface LegacyShapeGraphEntry extends LegacyRdfEntryBase {
  readonly kind: "shape-graph";
  readonly section: "shapeGraphs";
  readonly role: "shape";
  readonly classification: "selected";
  readonly liveValidation: boolean | null;
}

export interface LegacyDerivedGraphEntry extends LegacyRdfEntryBase {
  readonly kind: "derived-graph";
  readonly section: "derivedGraphs";
  readonly role: "derived";
  readonly classification: "derived";
}

export interface LegacyRuleEntry extends LegacyManifestEntryBase {
  readonly kind: "rule";
  readonly section: "rules";
  readonly role: "rule";
  readonly classification: "selected";
  readonly path: string;
  readonly digest: string;
  readonly ruleKind: "derivation" | "integrity";
  readonly outputGraphIri: string | null;
  readonly operationKind: string;
  readonly parseDigest: string;
}

export interface LegacyRetiredGraphEntry extends LegacyManifestEntryBase {
  readonly kind: "retired-graph";
  readonly section: "retiredGraphs";
  readonly role: "retired";
  readonly classification: "retired";
  readonly graphIri: string;
  readonly supersededByIri: string;
}

export interface LegacyInactiveSourceEntry extends LegacyManifestEntryBase {
  readonly kind: "inactive-source";
  readonly section: "inactiveSources";
  readonly role: "inactive";
  readonly classification: "inactive";
  readonly path: string;
  readonly digest: string;
  readonly disposition: string;
  readonly authorityEligible: false;
}

export interface LegacyFixtureRootEntry extends LegacyManifestEntryBase {
  readonly kind: "fixture-root";
  readonly section: "fixtures";
  readonly role: "fixture";
  readonly classification: "fixture";
  readonly fixtureKind: "conforming" | "defect";
  readonly path: string;
  readonly loadAsAuthority: false;
  readonly declaredFileCount: number;
  readonly fixtureDigest: string;
}

export type LegacyManifestEntry =
  | LegacyDefinitionGraphEntry
  | LegacyAuthoredGraphEntry
  | LegacyObservedGraphEntry
  | LegacyShapeGraphEntry
  | LegacyDerivedGraphEntry
  | LegacyRuleEntry
  | LegacyRetiredGraphEntry
  | LegacyInactiveSourceEntry
  | LegacyFixtureRootEntry;

export interface LegacyManifest {
  readonly path: string;
  readonly digest: string;
  readonly imports: readonly string[];
  readonly declaredEntryCount: number;
  readonly entries: readonly LegacyManifestEntry[];
}

export interface LegacyRegistryRecord {
  /** Collision-free JSON-Pointer-like locator; `$` identifies the document root. */
  readonly key: string;
  readonly recordKind: "mapping" | "sequence" | "string" | "number" | "integer" | "boolean" | "null";
  readonly digest: string;
}

export interface LegacyRegistry {
  readonly id: string;
  readonly path: string;
  readonly digest: string;
  readonly format: "yaml-1.2" | "json";
  readonly declaredRecordCount: number;
  readonly records: readonly LegacyRegistryRecord[];
}

export interface LegacyExtractionReceipt {
  readonly schema: "urn:usf:legacy-extraction-receipt:1";
  readonly status: "independently-extracted";
  readonly extractorDigest: string;
  readonly sourceSetDigest: string;
  readonly sourceId: string;
  readonly revision: string;
  readonly tree: string;
  readonly gitVerification: {
    readonly objectFormat: "sha1";
    readonly pathEncoding: "utf-8";
    readonly blobMethod: "git-blob-object-sha1";
    readonly treeMethod: "recursive-git-tree-object-sha1";
    readonly commitMethod: "git-commit-object-sha1-with-unique-tree-header";
    readonly commitBytes: number;
    readonly commitContentDigest: string;
    readonly commitObjectOid: string;
    readonly treeEntriesDigest: string;
    readonly treeObjectOid: string;
  };
  readonly observationsDigest: string;
  readonly counts: {
    readonly trackedFiles: number;
    readonly trackedBytes: number;
    readonly manifests: number;
    readonly manifestEntries: number;
    readonly quads: number;
    readonly registries: number;
    readonly registryRecords: number;
    readonly roleAssertions: number;
    readonly parserNodes: number;
  };
  readonly receiptDigest: string;
}

export interface LegacySourceClosure {
  readonly id: string;
  readonly revision: string;
  readonly tree: string;
  readonly trackedFiles: readonly LegacyTrackedFile[];
  readonly manifestRoots: readonly string[];
  readonly manifests: readonly LegacyManifest[];
  readonly registries: readonly LegacyRegistry[];
  readonly extraction: LegacyExtractionReceipt;
}

export interface LegacySourceExtraction {
  readonly schema: "urn:usf:legacy-source-extraction:1";
  readonly version: 1;
  readonly sourceSetDigest: string;
  readonly extractorDigest: string;
  readonly source: LegacySourceClosure;
  readonly sourceResultDigest: string;
}

export interface LegacyExtractionResult {
  readonly schema: "urn:usf:legacy-extraction-result:1";
  readonly version: 1;
  readonly sourceSetDigest: string;
  readonly extractorDigest: string;
  readonly sources: readonly LegacySourceClosure[];
  readonly resultDigest: string;
}

export interface LegacyExtractionExpectation {
  readonly sourceSetDigest: string;
  readonly sources: readonly {
    readonly id: string;
    readonly revision: string;
    readonly tree: string;
    readonly trackedFileCount: number;
    readonly trackedByteCount: number;
    readonly graphManifest?: { readonly path: string; readonly digest: string };
  }[];
}

interface MutableFileMetadata {
  readonly path: string;
  readonly mode: ExactLegacyFileMode;
  readonly blobOid: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly roles: Set<string>;
  readonly parserOutcomes: LegacyParserOutcome[];
}

interface StructuredDocument {
  readonly value: unknown;
  readonly registry: LegacyRegistry;
  readonly outcome: LegacyParserOutcome;
}

interface RdfMetadata {
  readonly format: "turtle" | "trig";
  readonly quadCount: number;
  readonly semanticDigest: string;
  readonly quads: readonly LegacyQuadObservation[];
  readonly resourceDefinitions: readonly LegacyResourceDefinition[];
  readonly blankNodeComponents: readonly LegacyBlankNodeComponent[];
  readonly outcome: LegacyParserOutcome;
}

interface Budget {
  readonly limits: LegacyExtractionLimits;
  readonly started: number;
  readonly now: () => number;
  nodes: number;
  records: number;
  quads: number;
}

function refuse(reasonCode: string, details?: Readonly<Record<string, unknown>>): never {
  throw new LegacyExtractionError(reasonCode, details);
}

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function snapshotExactDataObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  reason: string,
  budget?: Budget,
): Readonly<Record<string, unknown>> {
  if (budget !== undefined) checkDeadline(budget);
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(reason);
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    refuse(reason);
  }
  if (prototype !== Object.prototype && prototype !== null) refuse(reason);
  const allowed = new Set([...required, ...optional]);
  if (keys.length < required.length || keys.length > allowed.size || keys.some((key) => typeof key !== "string" || !allowed.has(key))) refuse(reason);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (budget !== undefined) checkDeadline(budget);
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
    catch { refuse(reason); }
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) refuse(reason);
    snapshot[key as string] = descriptor.value;
  }
  if (required.some((key) => !Object.hasOwn(snapshot, key))) refuse(reason);
  if (budget !== undefined) checkDeadline(budget);
  return snapshot;
}

function snapshotExactArray(value: unknown, maximumLength: number, reason: string, budget?: Budget): readonly unknown[] {
  if (budget !== undefined) checkDeadline(budget);
  if (!Array.isArray(value)) refuse(reason);
  let prototype: object | null;
  let lengthDescriptor: PropertyDescriptor | undefined;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    keys = Reflect.ownKeys(value);
  } catch {
    refuse(reason);
  }
  if (prototype !== Array.prototype || lengthDescriptor === undefined || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > maximumLength) refuse(reason);
  const length = lengthDescriptor.value as number;
  if (keys.length !== length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) refuse(reason);
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    if (budget !== undefined) checkDeadline(budget);
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
    catch { refuse(reason); }
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) refuse(reason);
    snapshot.push(descriptor.value);
  }
  if (budget !== undefined) checkDeadline(budget);
  return snapshot;
}

function snapshotBytes(
  value: unknown,
  reason: string,
  maximumBytes: number,
  byteLimitReason: string,
  consumedBytes: number,
  maximumTotalBytes: number,
  budget?: Budget,
): Uint8Array {
  if (budget !== undefined) checkDeadline(budget);
  if (!(value instanceof Uint8Array) || !ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype || Object.hasOwn(value, Symbol.iterator)) refuse(reason);
  let byteLength: number;
  try { byteLength = Reflect.apply(typedArrayByteLength, value, []) as number; }
  catch { return refuse(reason); }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) refuse(reason);
  if (byteLength > maximumBytes) refuse(byteLimitReason, { bytes: byteLength, maximumBytes });
  const prospectiveTotal = consumedBytes + byteLength;
  if (!Number.isSafeInteger(prospectiveTotal) || prospectiveTotal > maximumTotalBytes) refuse("LEGACY_EXTRACTION_TOTAL_BYTE_LIMIT_EXCEEDED", { maximumBytes: maximumTotalBytes });
  const snapshot = new Uint8Array(byteLength);
  try { Reflect.apply(typedArraySet, snapshot, [value]); }
  catch { return refuse(reason); }
  if (budget !== undefined) checkDeadline(budget);
  return snapshot;
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === "boolean" || typeof input === "string") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input) || Object.is(input, -0)) refuse("LEGACY_CANONICAL_VALUE_INVALID");
      return input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    if (!isRecord(input)) refuse("LEGACY_CANONICAL_VALUE_INVALID");
    return Object.fromEntries(Object.keys(input).sort(compareCodeUnits).filter((key) => input[key] !== undefined).map((key) => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function authenticated<T extends object>(value: T, registry: WeakSet<object>): T {
  const frozen = deepFreeze(value);
  registry.add(frozen);
  return frozen;
}

function checkedLimits(overrides: Partial<LegacyExtractionLimits>): LegacyExtractionLimits {
  const known = new Set(Object.keys(defaultLegacyExtractionLimits));
  const snapshot = snapshotExactDataObject(overrides, [], [...known], "LEGACY_EXTRACTION_LIMIT_INVALID");
  const limits = { ...defaultLegacyExtractionLimits, ...snapshot } as LegacyExtractionLimits;
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) refuse("LEGACY_EXTRACTION_LIMIT_INVALID");
  return limits;
}

function checkDeadline(budget: Budget): void {
  const elapsed = budget.now() - budget.started;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > budget.limits.maxElapsedMilliseconds) {
    refuse("LEGACY_EXTRACTION_DEADLINE_EXCEEDED", { maximumMilliseconds: budget.limits.maxElapsedMilliseconds });
  }
}

function remainingMilliseconds(budget: Budget): number {
  checkDeadline(budget);
  const remaining = Math.floor(budget.limits.maxElapsedMilliseconds - (budget.now() - budget.started));
  if (remaining < 1) refuse("LEGACY_EXTRACTION_DEADLINE_EXCEEDED", { maximumMilliseconds: budget.limits.maxElapsedMilliseconds });
  return Math.min(remaining, 2_147_483_647);
}

function repositoryPath(value: unknown, reason = "LEGACY_EXTRACTION_PATH_INVALID"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) refuse(reason);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) refuse("LEGACY_EXTRACTION_PATH_UTF8_INVALID");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      refuse("LEGACY_EXTRACTION_PATH_UTF8_INVALID");
    }
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) refuse(reason, { path: value });
  return parts.join("/");
}

function gitObjectOid(type: "blob" | "tree" | "commit", payloadLength: number, payloadParts: readonly Uint8Array[]): string {
  const hash = createHash("sha1");
  hash.update(utf8.encode(`${type} ${payloadLength}\0`));
  for (const part of payloadParts) hash.update(part);
  return hash.digest("hex");
}

function assertGitFileMode(value: unknown): asserts value is ExactLegacyFileMode {
  if (value !== "100644" && value !== "100755" && value !== "120000") refuse("LEGACY_EXTRACTION_FILE_MODE_INVALID");
}

function snapshotExactLegacyFile(value: unknown, limits: LegacyExtractionLimits, consumedBytes: number, budget: Budget): ExactLegacyFile {
  const fields = snapshotExactDataObject(value, ["path", "mode", "bytes"], [], "LEGACY_EXTRACTION_FILE_INVALID", budget);
  if (typeof fields.path !== "string") refuse("LEGACY_EXTRACTION_FILE_INVALID");
  assertGitFileMode(fields.mode);
  const bytes = snapshotBytes(fields.bytes, "LEGACY_EXTRACTION_FILE_INVALID", limits.maxFileBytes, "LEGACY_EXTRACTION_FILE_BYTE_LIMIT_EXCEEDED", consumedBytes, limits.maxTotalBytes, budget);
  return { path: fields.path, mode: fields.mode, bytes };
}

function snapshotExactLegacySource(
  value: unknown,
  limits: LegacyExtractionLimits,
  budget: Budget,
  inheritedSourceSetDigest?: string,
): ExactLegacySourceInput {
  const required = inheritedSourceSetDigest === undefined
    ? ["sourceSetDigest", "id", "revision", "tree", "commitBytes", "manifestRoots", "files"]
    : ["id", "revision", "tree", "commitBytes", "manifestRoots", "files"];
  const fields = snapshotExactDataObject(value, required, [], "LEGACY_EXTRACTION_INPUT_INVALID", budget);
  const sourceSetDigest = inheritedSourceSetDigest ?? fields.sourceSetDigest;
  if (typeof sourceSetDigest !== "string" || typeof fields.id !== "string" || typeof fields.revision !== "string" || typeof fields.tree !== "string") refuse("LEGACY_EXTRACTION_INPUT_INVALID");
  const manifestRootValues = snapshotExactArray(fields.manifestRoots, limits.maxManifests, "LEGACY_EXTRACTION_INPUT_INVALID", budget);
  if (!manifestRootValues.every((root) => typeof root === "string")) refuse("LEGACY_EXTRACTION_INPUT_INVALID");
  const fileValues = snapshotExactArray(fields.files, limits.maxFiles, "LEGACY_EXTRACTION_FILE_LIMIT_EXCEEDED", budget);
  const commitBytes = snapshotBytes(fields.commitBytes, "LEGACY_EXTRACTION_COMMIT_BYTES_INVALID", limits.maxFileBytes, "LEGACY_EXTRACTION_COMMIT_BYTE_LIMIT_EXCEEDED", 0, limits.maxTotalBytes, budget);
  let consumedBytes = commitBytes.byteLength;
  const files: ExactLegacyFile[] = [];
  for (const fileValue of fileValues) {
    const file = snapshotExactLegacyFile(fileValue, limits, consumedBytes, budget);
    consumedBytes += file.bytes.byteLength;
    files.push(file);
  }
  return {
    sourceSetDigest,
    id: fields.id,
    revision: fields.revision,
    tree: fields.tree,
    commitBytes,
    manifestRoots: manifestRootValues as readonly string[],
    files,
  };
}

function gitBlobOid(bytes: Uint8Array): string {
  return gitObjectOid("blob", bytes.byteLength, [bytes]);
}

/** Pure, default-bounded helper for constructing or checking a synthetic exact-byte test fixture. */
export function computeExactLegacyGitBlobOid(bytes: Uint8Array): string {
  const started = monotonicNow();
  const budget: Budget = { limits: defaultLegacyExtractionLimits, started, now: monotonicNow, nodes: 0, records: 0, quads: 0 };
  const exactBytes = snapshotBytes(bytes, "LEGACY_EXTRACTION_FILE_INVALID", defaultLegacyExtractionLimits.maxFileBytes, "LEGACY_EXTRACTION_FILE_BYTE_LIMIT_EXCEEDED", 0, defaultLegacyExtractionLimits.maxTotalBytes, budget);
  return gitBlobOid(exactBytes);
}

interface GitTreeBlobEntry {
  readonly kind: "blob";
  readonly name: string;
  readonly mode: ExactLegacyFileMode;
  readonly oid: string;
}

interface GitTreeDirectoryEntry {
  readonly kind: "tree";
  readonly name: string;
  readonly children: Map<string, GitTreeEntry>;
}

type GitTreeEntry = GitTreeBlobEntry | GitTreeDirectoryEntry;

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function gitTreeOrderKey(entry: GitTreeEntry): Uint8Array {
  const name = utf8.encode(entry.name);
  const key = new Uint8Array(name.byteLength + 1);
  key.set(name);
  key[name.byteLength] = entry.kind === "tree" ? 0x2f : 0x00;
  return key;
}

function oidBytes(oid: string): Uint8Array {
  if (!revisionPattern.test(oid)) refuse("LEGACY_EXTRACTION_GIT_OBJECT_OID_INVALID");
  const bytes = new Uint8Array(20);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(oid.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function gitTreeOidFromBlobEntries(entries: readonly { readonly path: string; readonly mode: ExactLegacyFileMode; readonly blobOid: string }[], maximumDepth: number): string {
  const root = new Map<string, GitTreeEntry>();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (parts.length > maximumDepth) refuse("LEGACY_EXTRACTION_PATH_DEPTH_LIMIT_EXCEEDED", { path: entry.path, maximumDepth });
    let children = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index]!;
      const prior = children.get(name);
      if (prior?.kind === "blob") refuse("LEGACY_EXTRACTION_GIT_TREE_PATH_CONFLICT", { path: entry.path });
      if (prior === undefined) {
        const directory: GitTreeDirectoryEntry = { kind: "tree", name, children: new Map<string, GitTreeEntry>() };
        children.set(name, directory);
        children = directory.children;
      } else {
        children = prior.children;
      }
    }
    const name = parts.at(-1)!;
    if (children.has(name)) refuse("LEGACY_EXTRACTION_GIT_TREE_PATH_CONFLICT", { path: entry.path });
    children.set(name, { kind: "blob", name, mode: entry.mode, oid: entry.blobOid });
  }

  const compute = (children: Map<string, GitTreeEntry>): string => {
    const ordered = [...children.values()].sort((left, right) => compareBytes(gitTreeOrderKey(left), gitTreeOrderKey(right)));
    const parts: Uint8Array[] = [];
    let length = 0;
    for (const entry of ordered) {
      const mode = entry.kind === "tree" ? "40000" : entry.mode;
      const oid = entry.kind === "tree" ? compute(entry.children) : entry.oid;
      const prefix = utf8.encode(`${mode} ${entry.name}\0`);
      const objectId = oidBytes(oid);
      parts.push(prefix, objectId);
      length += prefix.byteLength + objectId.byteLength;
    }
    return gitObjectOid("tree", length, parts);
  };
  return compute(root);
}

/** Pure helper for constructing or checking a synthetic exact-byte test fixture. */
export function computeExactLegacyGitTreeOid(files: readonly ExactLegacyFile[]): string {
  const started = monotonicNow();
  const budget: Budget = { limits: defaultLegacyExtractionLimits, started, now: monotonicNow, nodes: 0, records: 0, quads: 0 };
  const fileValues = snapshotExactArray(files, defaultLegacyExtractionLimits.maxFiles, "LEGACY_EXTRACTION_FILE_LIMIT_EXCEEDED", budget);
  if (fileValues.length === 0) refuse("LEGACY_EXTRACTION_FILE_LIMIT_EXCEEDED", { maximumFiles: defaultLegacyExtractionLimits.maxFiles });
  const exactFiles: ExactLegacyFile[] = [];
  let snapshottedByteCount = 0;
  for (const fileValue of fileValues) {
    const file = snapshotExactLegacyFile(fileValue, defaultLegacyExtractionLimits, snapshottedByteCount, budget);
    snapshottedByteCount += file.bytes.byteLength;
    exactFiles.push(file);
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  const entries = exactFiles.map((file) => {
    const path = repositoryPath(file.path);
    if (paths.has(path)) refuse("LEGACY_EXTRACTION_DUPLICATE_FILE", { path });
    paths.add(path);
    assertGitFileMode(file.mode);
    if (file.bytes.byteLength > defaultLegacyExtractionLimits.maxFileBytes) refuse("LEGACY_EXTRACTION_FILE_BYTE_LIMIT_EXCEEDED", { path, maximumBytes: defaultLegacyExtractionLimits.maxFileBytes });
    totalBytes += file.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > defaultLegacyExtractionLimits.maxTotalBytes) refuse("LEGACY_EXTRACTION_TOTAL_BYTE_LIMIT_EXCEEDED", { maximumBytes: defaultLegacyExtractionLimits.maxTotalBytes });
    return { path, mode: file.mode, blobOid: gitBlobOid(file.bytes) };
  });
  return gitTreeOidFromBlobEntries(entries, defaultLegacyExtractionLimits.maxDepth);
}

/** Pure helper for constructing or checking a synthetic exact-byte test fixture. */
export function computeExactLegacyGitCommitOid(commitBytes: Uint8Array): string {
  const started = monotonicNow();
  const budget: Budget = { limits: defaultLegacyExtractionLimits, started, now: monotonicNow, nodes: 0, records: 0, quads: 0 };
  const exactCommitBytes = snapshotBytes(commitBytes, "LEGACY_EXTRACTION_COMMIT_BYTES_INVALID", defaultLegacyExtractionLimits.maxFileBytes, "LEGACY_EXTRACTION_COMMIT_BYTE_LIMIT_EXCEEDED", 0, defaultLegacyExtractionLimits.maxTotalBytes, budget);
  return gitObjectOid("commit", exactCommitBytes.byteLength, [exactCommitBytes]);
}

function commitTreeHeader(commitBytes: Uint8Array): string {
  let headerEnd = -1;
  for (let index = 0; index + 1 < commitBytes.byteLength; index += 1) {
    if (commitBytes[index] === 0x0a && commitBytes[index + 1] === 0x0a) {
      headerEnd = index;
      break;
    }
  }
  if (headerEnd < 0) refuse("LEGACY_EXTRACTION_COMMIT_HEADER_INVALID");
  const treePrefix = [0x74, 0x72, 0x65, 0x65, 0x20] as const;
  const treeHeaders: string[] = [];
  let lineStart = 0;
  for (let index = 0; index <= headerEnd; index += 1) {
    if (index !== headerEnd && commitBytes[index] !== 0x0a) continue;
    const line = commitBytes.subarray(lineStart, index);
    const isTree = line.byteLength >= treePrefix.length && treePrefix.every((byte, prefixIndex) => line[prefixIndex] === byte);
    if (isTree) {
      if (line.byteLength !== 45) refuse("LEGACY_EXTRACTION_COMMIT_TREE_HEADER_INVALID");
      let oid = "";
      for (const byte of line.subarray(treePrefix.length)) {
        const isDigit = byte >= 0x30 && byte <= 0x39;
        const isLowerHex = byte >= 0x61 && byte <= 0x66;
        if (!isDigit && !isLowerHex) refuse("LEGACY_EXTRACTION_COMMIT_TREE_HEADER_INVALID");
        oid += String.fromCharCode(byte);
      }
      treeHeaders.push(oid);
    }
    lineStart = index + 1;
  }
  if (treeHeaders.length !== 1) refuse("LEGACY_EXTRACTION_COMMIT_TREE_HEADER_INVALID");
  return treeHeaders[0]!;
}

function resolveManifestPath(manifestPath: string, selectedPath: unknown): string {
  const selected = repositoryPath(selectedPath, "LEGACY_MANIFEST_ENTRY_PATH_INVALID");
  const base = manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/")) : "";
  return repositoryPath(base.length === 0 ? selected : `${base}/${selected}`, "LEGACY_MANIFEST_ENTRY_PATH_INVALID");
}

function assertNonEmpty(value: unknown, reason: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) refuse(reason);
}

function assertDigest(value: unknown, reason: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) refuse(reason);
}

function assertIri(value: unknown, reason: string): asserts value is string {
  if (typeof value !== "string" || !iriPattern.test(value)) refuse(reason);
}

function orderValue(value: unknown, reason: string): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) refuse(reason);
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) refuse(reason);
  return value as number;
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return refuse("LEGACY_EXTRACTION_UTF8_INVALID", { path }); }
}

function pathRoles(path: string): string[] {
  const roles = new Set<string>();
  const lower = path.toLowerCase();
  if (/(?:^|\/)(?:test|tests|spec|fixtures?)(?:\/|\.|$)/u.test(lower)) roles.add("test-obligation");
  if (/\.(?:md|adoc|rst)$/u.test(lower)) roles.add("semantic-document");
  if (/\.schema\.json$/u.test(lower) || /(?:^|\/)schemas?(?:\/|$)/u.test(lower)) roles.add("structured-schema");
  if (/\.(?:yaml|yml|json)$/u.test(lower)) roles.add("structured-source");
  if (/\.(?:ttl|trig)$/u.test(lower)) roles.add("rdf-source");
  if (/\.rq$/u.test(lower)) roles.add("sparql-rule");
  if (/(?:^|\/)(?:registry|registries|taxonomy|taxonomies|vocabulary|vocabularies)(?:\/|\.|$)/u.test(lower)) roles.add("semantic-registry");
  return [...roles].sort(compareCodeUnits);
}

function preflightFlowDepth(source: string, maximumDepth: number, path: string): void {
  let flow = 0;
  let quoted: "single" | "double" | null = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted === "double") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = null;
      continue;
    }
    if (quoted === "single") {
      if (character === "'" && source[index + 1] === "'") index += 1;
      else if (character === "'") quoted = null;
      continue;
    }
    if (character === '"') quoted = "double";
    else if (character === "'") quoted = "single";
    else if (character === "#") {
      const nextLine = source.indexOf("\n", index);
      if (nextLine === -1) break;
      index = nextLine;
    } else if (character === "{" || character === "[") {
      flow += 1;
      if (flow > maximumDepth) refuse("LEGACY_EXTRACTION_DEPTH_LIMIT_EXCEEDED", { path, maximumDepth });
    } else if (character === "}" || character === "]") {
      flow = Math.max(0, flow - 1);
    }
  }
}

function inspectYamlNode(node: Node | null, depth: number, budget: Budget, path: string): void {
  if (node === null) return;
  if (depth > budget.limits.maxDepth) refuse("LEGACY_EXTRACTION_DEPTH_LIMIT_EXCEEDED", { path, maximumDepth: budget.limits.maxDepth });
  budget.nodes += 1;
  if (budget.nodes > budget.limits.maxNodes) refuse("LEGACY_EXTRACTION_NODE_LIMIT_EXCEEDED", { path, maximumNodes: budget.limits.maxNodes });
  const tagged = node as Node & { readonly tag?: string; readonly anchor?: string };
  if (isAlias(node) || (typeof tagged.anchor === "string" && tagged.anchor.length > 0)) refuse("LEGACY_EXTRACTION_YAML_ALIAS_FORBIDDEN", { path });
  if (typeof tagged.tag === "string" && tagged.tag.length > 0) refuse("LEGACY_EXTRACTION_YAML_TAG_FORBIDDEN", { path, tag: tagged.tag });
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") refuse("LEGACY_EXTRACTION_YAML_KEY_INVALID", { path });
      if (pair.key.value === "<<") refuse("LEGACY_EXTRACTION_YAML_MERGE_FORBIDDEN", { path });
      inspectYamlNode(pair.key, depth + 1, budget, path);
      inspectYamlNode(pair.value as Node | null, depth + 1, budget, path);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) inspectYamlNode(item as Node | null, depth + 1, budget, path);
  }
}

function treeKind(value: unknown): LegacyRegistryRecord["recordKind"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "sequence";
  if (isRecord(value)) return "mapping";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return refuse("LEGACY_EXTRACTION_STRUCTURED_VALUE_INVALID");
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function structuredRecords(value: unknown, budget: Budget, path: string): { readonly records: LegacyRegistryRecord[]; readonly rootDigest: string; readonly nodeCount: number } {
  const records: LegacyRegistryRecord[] = [];
  const startingNodes = budget.nodes;
  const visit = (current: unknown, pointer: string, depth: number): string => {
    if (depth > budget.limits.maxDepth) refuse("LEGACY_EXTRACTION_DEPTH_LIMIT_EXCEEDED", { path, maximumDepth: budget.limits.maxDepth });
    budget.nodes += 1;
    budget.records += 1;
    if (budget.nodes > budget.limits.maxNodes) refuse("LEGACY_EXTRACTION_NODE_LIMIT_EXCEEDED", { path, maximumNodes: budget.limits.maxNodes });
    if (budget.records > budget.limits.maxRecords) refuse("LEGACY_EXTRACTION_RECORD_LIMIT_EXCEEDED", { path, maximumRecords: budget.limits.maxRecords });
    const kind = treeKind(current);
    let basis: unknown;
    if (Array.isArray(current)) {
      const children = current.map((child, index) => visit(child, `${pointer}/${index}`, depth + 1));
      basis = ["sequence", children];
    } else if (isRecord(current)) {
      const keys = Object.keys(current).sort(compareCodeUnits);
      const children = keys.map((key) => [key, visit(current[key], `${pointer}/${pointerSegment(key)}`, depth + 1)]);
      basis = ["mapping", children];
    } else if (typeof current === "bigint") basis = ["integer", current.toString(10)];
    else if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) refuse("LEGACY_EXTRACTION_STRUCTURED_VALUE_INVALID", { path, pointer });
      basis = [kind, current.toString()];
    } else basis = [kind, current];
    const recordDigest = digest(canonicalJson(basis));
    records.push({ key: pointer, recordKind: kind, digest: recordDigest });
    return recordDigest;
  };
  const rootDigest = visit(value, "$", 1);
  records.sort((left, right) => compareCodeUnits(left.key, right.key));
  return { records, rootDigest, nodeCount: budget.nodes - startingNodes };
}

function parseStructured(file: MutableFileMetadata, format: "yaml-1.2" | "json", budget: Budget): StructuredDocument {
  checkDeadline(budget);
  const source = decodeUtf8(file.bytes, file.path);
  preflightFlowDepth(source, budget.limits.maxDepth, file.path);
  if (/^%TAG(?:\s|$)/mu.test(source)) refuse("LEGACY_EXTRACTION_YAML_TAG_FORBIDDEN", { path: file.path });
  if (format === "json") {
    try { JSON.parse(source); }
    catch { return refuse("LEGACY_EXTRACTION_JSON_SYNTAX_INVALID", { path: file.path }); }
  }
  const document = parseDocument(source, {
    version: "1.2",
    schema: format === "json" ? "json" : "core",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    merge: false,
    customTags: [],
    resolveKnownTags: false,
    intAsBigInt: true,
    logLevel: "silent",
  });
  checkDeadline(budget);
  if (document.errors.length > 0 || document.warnings.length > 0) {
    refuse("LEGACY_EXTRACTION_STRUCTURED_PARSE_FAILED", {
      path: file.path,
      issue: document.errors[0]?.code ?? document.warnings[0]?.code ?? "unknown",
    });
  }
  const directives = document.directives as unknown as { readonly yaml?: { readonly version?: string } } | undefined;
  if (directives?.yaml?.version !== undefined && directives.yaml.version !== "1.2") refuse("LEGACY_EXTRACTION_YAML_VERSION_INVALID", { path: file.path });
  const startingNodes = budget.nodes;
  inspectYamlNode(document.contents, 1, budget, file.path);
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 0, mapAsMap: false }); }
  catch { return refuse("LEGACY_EXTRACTION_YAML_ALIAS_FORBIDDEN", { path: file.path }); }
  const extracted = structuredRecords(value, budget, file.path);
  const registry: LegacyRegistry = {
    id: `structured:${file.path}`,
    path: file.path,
    digest: file.digest,
    format,
    declaredRecordCount: extracted.records.length,
    records: extracted.records,
  };
  const outcome: LegacyParserOutcome = {
    format,
    status: "parsed",
    sourceDigest: file.digest,
    semanticDigest: extracted.rootDigest,
    nodeCount: budget.nodes - startingNodes,
    recordCount: extracted.records.length,
    quadCount: 0,
    operationKind: null,
  };
  file.parserOutcomes.push(outcome);
  return { value, registry, outcome };
}

function countParsedTree(value: unknown, budget: Budget, path: string): number {
  const startingNodes = budget.nodes;
  const active = new WeakSet<object>();
  const seen = new WeakSet<object>();
  const visit = (current: unknown, depth: number): void => {
    if (depth > budget.limits.maxDepth) refuse("LEGACY_EXTRACTION_DEPTH_LIMIT_EXCEEDED", { path, maximumDepth: budget.limits.maxDepth });
    budget.nodes += 1;
    if (budget.nodes > budget.limits.maxNodes) refuse("LEGACY_EXTRACTION_NODE_LIMIT_EXCEEDED", { path, maximumNodes: budget.limits.maxNodes });
    if (current === null || typeof current !== "object") return;
    if (active.has(current)) refuse("LEGACY_EXTRACTION_PARSED_CYCLE_INVALID", { path });
    if (seen.has(current)) return;
    active.add(current);
    seen.add(current);
    if (Array.isArray(current)) for (const child of current) visit(child, depth + 1);
    else for (const child of Object.values(current as Record<string, unknown>)) visit(child, depth + 1);
    active.delete(current);
  };
  visit(value, 1);
  return budget.nodes - startingNodes;
}

function termIdentity(term: Term): { readonly kind: LegacyQuadObservation["objectKind"] | "default"; readonly value: string | null } {
  if (term.termType === "NamedNode") return { kind: "iri", value: term.value };
  if (term.termType === "BlankNode") return { kind: "blank-node", value: `_:${term.value}` };
  if (term.termType === "DefaultGraph") return { kind: "default", value: null };
  if (term.termType === "Literal") {
    return { kind: "literal-digest", value: digest(canonicalJson([term.value, term.language ?? "", term.datatype?.value ?? ""])) };
  }
  return refuse("LEGACY_EXTRACTION_RDF_TERM_INVALID", { termType: term.termType });
}

function rdfObservations(quads: readonly Quad[]): {
  readonly quads: LegacyQuadObservation[];
  readonly resourceDefinitions: LegacyResourceDefinition[];
  readonly blankNodeComponents: LegacyBlankNodeComponent[];
} {
  const observations: LegacyQuadObservation[] = [];
  const definitionStatements = new Map<string, string[]>();
  const blankParents = new Map<string, string>();
  const quadBlanks: string[][] = [];
  const find = (value: string): string => {
    const parent = blankParents.get(value);
    if (parent === undefined) { blankParents.set(value, value); return value; }
    if (parent === value) return value;
    const root = find(parent);
    blankParents.set(value, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) blankParents.set(rightRoot, leftRoot);
    else blankParents.set(leftRoot, rightRoot);
  };

  const statementDigests: string[] = [];

  for (const quad of quads) {
    const subject = termIdentity(quad.subject);
    const predicate = termIdentity(quad.predicate);
    const object = termIdentity(quad.object);
    const graph = termIdentity(quad.graph);
    if ((subject.kind !== "iri" && subject.kind !== "blank-node") || predicate.kind !== "iri" || (object.kind !== "iri" && object.kind !== "blank-node" && object.kind !== "literal-digest") || (graph.kind !== "iri" && graph.kind !== "blank-node" && graph.kind !== "default")) {
      refuse("LEGACY_EXTRACTION_RDF_TERM_INVALID");
    }
    const basis = {
      subject: subject.value,
      subjectKind: subject.kind,
      predicate: predicate.value,
      object: object.value,
      objectKind: object.kind,
      graph: graph.value,
      graphKind: graph.kind,
    };
    const statementDigest = digest(canonicalJson(basis));
    statementDigests.push(statementDigest);
    const observation: LegacyQuadObservation = {
      subject: subject.value!,
      subjectKind: subject.kind,
      predicate: predicate.value!,
      object: object.value!,
      objectKind: object.kind,
      graph: graph.value,
      graphKind: graph.kind,
      statementDigest,
    };
    observations.push(observation);
    if (subject.kind === "iri") {
      const statements = definitionStatements.get(subject.value!) ?? [];
      statements.push(statementDigest);
      definitionStatements.set(subject.value!, statements);
    }
    const blanks = [subject, object, graph].filter((term) => term.kind === "blank-node").map((term) => term.value!);
    for (const blank of blanks) find(blank);
    for (let index = 1; index < blanks.length; index += 1) union(blanks[0]!, blanks[index]!);
    quadBlanks.push(blanks);
  }
  observations.sort((left, right) => compareCodeUnits(left.statementDigest, right.statementDigest));
  const resourceDefinitions = [...definitionStatements].map(([iri, statements]) => ({
    iri,
    quadCount: statements.length,
    definitionDigest: digest(canonicalJson([...statements].sort(compareCodeUnits))),
  })).sort((left, right) => compareCodeUnits(left.iri, right.iri));

  const componentBlanks = new Map<string, Set<string>>();
  const componentStatements = new Map<string, Set<string>>();
  for (let index = 0; index < quadBlanks.length; index += 1) {
    const blanks = quadBlanks[index]!;
    if (blanks.length === 0) continue;
    const root = find(blanks[0]!);
    const members = componentBlanks.get(root) ?? new Set<string>();
    for (const blank of blanks) members.add(blank);
    componentBlanks.set(root, members);
    const statements = componentStatements.get(root) ?? new Set<string>();
    statements.add(statementDigests[index]!);
    componentStatements.set(root, statements);
  }
  const blankNodeComponents = [...componentBlanks].map(([root, members]) => {
    const statements = [...(componentStatements.get(root) ?? [])].sort(compareCodeUnits);
    return {
      componentId: digest(canonicalJson([...members].sort(compareCodeUnits))),
      quadCount: statements.length,
      componentDigest: digest(canonicalJson(statements)),
    };
  }).sort((left, right) => compareCodeUnits(left.componentId, right.componentId));
  return { quads: observations, resourceDefinitions, blankNodeComponents };
}

async function parseRdf(file: MutableFileMetadata, baseIri: string, budget: Budget): Promise<RdfMetadata> {
  checkDeadline(budget);
  const format = file.path.endsWith(".ttl") ? "turtle" : file.path.endsWith(".trig") ? "trig" : refuse("LEGACY_EXTRACTION_RDF_FORMAT_UNSUPPORTED", { path: file.path });
  const source = decodeUtf8(file.bytes, file.path);
  let parsed: Quad[];
  try { parsed = new N3Parser({ format: format === "turtle" ? "text/turtle" : "application/trig", baseIRI: baseIri }).parse(source); }
  catch { return refuse("LEGACY_EXTRACTION_RDF_PARSE_FAILED", { path: file.path, format }); }
  checkDeadline(budget);
  budget.quads += parsed.length;
  if (budget.quads > budget.limits.maxQuads) refuse("LEGACY_EXTRACTION_QUAD_LIMIT_EXCEEDED", { path: file.path, maximumQuads: budget.limits.maxQuads });
  let canonical: Awaited<ReturnType<typeof canonicalizeDataset>>;
  try { canonical = await canonicalizeDataset(parsed, { timeoutMs: remainingMilliseconds(budget) }); }
  catch { return refuse("LEGACY_EXTRACTION_RDF_CANONICALIZATION_FAILED", { path: file.path }); }
  checkDeadline(budget);
  // N3 otherwise adds a process-global parser counter to blank-node labels.
  // A fixed prefix preserves the RDFC-1.0 labels as stable metadata identities.
  const canonicalParserOptions = { format: "application/n-quads", blankNodePrefix: "canonical_" };
  const canonicalQuads = new N3Parser(canonicalParserOptions).parse(canonical.canonicalNQuads);
  const observations = rdfObservations(canonicalQuads);
  const outcome: LegacyParserOutcome = {
    format,
    status: "parsed",
    sourceDigest: file.digest,
    semanticDigest: canonical.semanticDigest,
    nodeCount: 0,
    recordCount: 0,
    quadCount: parsed.length,
    operationKind: null,
  };
  file.parserOutcomes.push(outcome);
  return { format, quadCount: parsed.length, semanticDigest: canonical.semanticDigest, ...observations, outcome };
}

function parseSparql(file: MutableFileMetadata, parser: SparqlParser, budget: Budget): { readonly operationKind: string; readonly parseDigest: string; readonly outcome: LegacyParserOutcome } {
  checkDeadline(budget);
  const source = decodeUtf8(file.bytes, file.path);
  // V1/V2 deliberately bundle independent SPARQL units behind this exact
  // comment delimiter. Each unit is still parsed by the pinned SPARQL parser.
  const units = source.split(/^\s*#---NEXT---#\s*$/mu);
  if (units.some((unit) => unit.trim().length === 0)) refuse("LEGACY_EXTRACTION_SPARQL_EMPTY_UNIT", { path: file.path });
  const operationKinds: string[] = [];
  let nodeCount = 0;
  for (const unit of units) {
    let ast: unknown;
    try { ast = parser.parse(unit); }
    catch { return refuse("LEGACY_EXTRACTION_SPARQL_PARSE_FAILED", { path: file.path }); }
    checkDeadline(budget);
    nodeCount += countParsedTree(ast, budget, file.path);
    const astRecord = isRecord(ast) ? ast : refuse("LEGACY_EXTRACTION_SPARQL_PARSE_FAILED", { path: file.path });
    operationKinds.push(typeof astRecord.subType === "string" ? astRecord.subType : typeof astRecord.type === "string" ? astRecord.type : "unknown");
  }
  const operationKind = operationKinds.length === 1 ? operationKinds[0]! : `bundle:${operationKinds.join(",")}`;
  const parseDigest = digest(canonicalJson([file.digest, operationKinds, nodeCount]));
  const outcome: LegacyParserOutcome = {
    format: "sparql-1.1",
    status: "parsed",
    sourceDigest: file.digest,
    semanticDigest: parseDigest,
    nodeCount,
    recordCount: 0,
    quadCount: 0,
    operationKind,
  };
  file.parserOutcomes.push(outcome);
  return { operationKind, parseDigest, outcome };
}

function manifestEntryId(value: unknown): string {
  return `entry:${digest(canonicalJson(value)).slice("sha256:".length)}`;
}

function roleForSection(section: string): string {
  return ({ definitionGraphs: "definition", authoredGraphs: "authored", observedGraphs: "observed", shapeGraphs: "shape", derivedGraphs: "derived" } as const)[section as "definitionGraphs"];
}

function kindForSection(section: string): "definition-graph" | "authored-graph" | "observed-graph" | "shape-graph" | "derived-graph" {
  return ({ definitionGraphs: "definition-graph", authoredGraphs: "authored-graph", observedGraphs: "observed-graph", shapeGraphs: "shape-graph", derivedGraphs: "derived-graph" } as const)[section as "definitionGraphs"];
}

function entryIdentityBasis(entry: LegacyManifestEntry): unknown {
  switch (entry.kind) {
    case "definition-graph":
    case "authored-graph":
    case "derived-graph":
      return [entry.kind, entry.section, entry.path, entry.graphIri, entry.loadOrder, entry.validationOrder];
    case "observed-graph":
      return [entry.kind, entry.section, entry.path, entry.graphIri, entry.loadOrder, entry.validationOrder, entry.collector];
    case "shape-graph":
      return [entry.kind, entry.section, entry.path, entry.graphIri, entry.loadOrder, entry.validationOrder, entry.liveValidation];
    case "rule":
      return [entry.kind, entry.section, entry.path, entry.ruleKind, entry.outputGraphIri];
    case "retired-graph":
      return [entry.kind, entry.section, entry.graphIri, entry.supersededByIri];
    case "inactive-source":
      return [entry.kind, entry.section, entry.path, entry.digest, entry.disposition, entry.authorityEligible];
    case "fixture-root":
      return [entry.kind, entry.section, entry.fixtureKind, entry.path, entry.loadAsAuthority];
  }
}

function requireFile(files: Map<string, MutableFileMetadata>, path: string, reason = "LEGACY_MANIFEST_ENTRY_FILE_MISSING"): MutableFileMetadata {
  return files.get(path) ?? refuse(reason, { path });
}

function exactObject(value: unknown, required: readonly string[], optional: readonly string[], reason: string): Record<string, unknown> {
  if (!isRecord(value) || !exactKeys(value, required, optional)) refuse(reason);
  return value;
}

async function extractManifestEntries(
  manifestPath: string,
  manifestValue: Record<string, unknown>,
  files: Map<string, MutableFileMetadata>,
  rdfCache: Map<string, Promise<RdfMetadata>>,
  sparqlCache: Map<string, ReturnType<typeof parseSparql>>,
  sparqlParser: SparqlParser,
  budget: Budget,
): Promise<LegacyManifestEntry[]> {
  const entries: LegacyManifestEntry[] = [];
  const baseIri = typeof manifestValue.baseIri === "string" && iriPattern.test(manifestValue.baseIri) ? manifestValue.baseIri : "urn:usf:";
  const graphSections = ["definitionGraphs", "authoredGraphs", "observedGraphs", "shapeGraphs", "derivedGraphs"] as const;
  for (const section of graphSections) {
    const declared = manifestValue[section];
    if (declared === undefined) continue;
    if (!Array.isArray(declared)) refuse("LEGACY_MANIFEST_SECTION_INVALID", { manifestPath, section });
    for (let index = 0; index < declared.length; index += 1) {
      checkDeadline(budget);
      const allowedOptional = section === "observedGraphs" ? ["collector"] : section === "shapeGraphs" ? ["liveValidation"] : [];
      const item = exactObject(declared[index], ["file", "graph", "loadOrder", "validationOrder"], allowedOptional, "LEGACY_MANIFEST_GRAPH_ENTRY_INVALID");
      const path = resolveManifestPath(manifestPath, item.file);
      assertIri(item.graph, "LEGACY_MANIFEST_GRAPH_ENTRY_INVALID");
      const loadOrder = orderValue(item.loadOrder, "LEGACY_MANIFEST_GRAPH_ENTRY_INVALID");
      const validationOrder = orderValue(item.validationOrder, "LEGACY_MANIFEST_GRAPH_ENTRY_INVALID");
      const file = requireFile(files, path);
      file.roles.add(roleForSection(section));
      file.roles.add("rdf-source");
      const rdfCacheKey = canonicalJson([path, baseIri]);
      let rdf = rdfCache.get(rdfCacheKey);
      if (rdf === undefined) { rdf = parseRdf(file, baseIri, budget); rdfCache.set(rdfCacheKey, rdf); }
      const parsed = await rdf;
      const common = {
        declarationIndex: index,
        path,
        digest: file.digest,
        graphIri: item.graph,
        loadOrder,
        validationOrder,
        format: parsed.format,
        quadCount: parsed.quadCount,
        semanticDigest: parsed.semanticDigest,
        quads: parsed.quads,
        resourceDefinitions: parsed.resourceDefinitions,
        blankNodeComponents: parsed.blankNodeComponents,
      };
      const kind = kindForSection(section);
      let entry: LegacyManifestEntry;
      if (kind === "observed-graph") {
        assertNonEmpty(item.collector, "LEGACY_MANIFEST_GRAPH_ENTRY_INVALID");
        entry = { ...common, id: "", kind, section: "observedGraphs", role: "observed", classification: "selected", collector: item.collector };
      } else if (kind === "shape-graph") {
        if (item.liveValidation !== undefined && typeof item.liveValidation !== "boolean") refuse("LEGACY_MANIFEST_GRAPH_ENTRY_INVALID");
        entry = { ...common, id: "", kind, section: "shapeGraphs", role: "shape", classification: "selected", liveValidation: item.liveValidation as boolean | undefined ?? null };
      } else if (kind === "definition-graph") entry = { ...common, id: "", kind, section: "definitionGraphs", role: "definition", classification: "selected" };
      else if (kind === "authored-graph") entry = { ...common, id: "", kind, section: "authoredGraphs", role: "authored", classification: "selected" };
      else entry = { ...common, id: "", kind, section: "derivedGraphs", role: "derived", classification: "derived" };
      entry = { ...entry, id: manifestEntryId(entryIdentityBasis(entry)) } as LegacyManifestEntry;
      entries.push(entry);
    }
  }

  const rules = manifestValue.rules;
  if (rules !== undefined) {
    if (!Array.isArray(rules)) refuse("LEGACY_MANIFEST_SECTION_INVALID", { manifestPath, section: "rules" });
    for (let index = 0; index < rules.length; index += 1) {
      const item = exactObject(rules[index], ["file", "kind"], ["output"], "LEGACY_MANIFEST_RULE_ENTRY_INVALID");
      const path = resolveManifestPath(manifestPath, item.file);
      if (item.kind !== "derivation" && item.kind !== "integrity") refuse("LEGACY_MANIFEST_RULE_ENTRY_INVALID");
      if (item.output !== undefined) assertIri(item.output, "LEGACY_MANIFEST_RULE_ENTRY_INVALID");
      const file = requireFile(files, path);
      if (!path.endsWith(".rq")) refuse("LEGACY_EXTRACTION_SPARQL_FORMAT_UNSUPPORTED", { path });
      file.roles.add("rule");
      file.roles.add("sparql-rule");
      let parsed = sparqlCache.get(path);
      if (parsed === undefined) { parsed = parseSparql(file, sparqlParser, budget); sparqlCache.set(path, parsed); }
      let entry: LegacyRuleEntry = {
        id: "",
        kind: "rule",
        section: "rules",
        role: "rule",
        classification: "selected",
        declarationIndex: index,
        path,
        digest: file.digest,
        ruleKind: item.kind,
        outputGraphIri: item.output as string | undefined ?? null,
        operationKind: parsed.operationKind,
        parseDigest: parsed.parseDigest,
      };
      entry = { ...entry, id: manifestEntryId(entryIdentityBasis(entry)) };
      entries.push(entry);
    }
  }

  const retired = manifestValue.retiredGraphs;
  if (retired !== undefined) {
    if (!Array.isArray(retired)) refuse("LEGACY_MANIFEST_SECTION_INVALID", { manifestPath, section: "retiredGraphs" });
    for (let index = 0; index < retired.length; index += 1) {
      const item = exactObject(retired[index], ["graph", "supersededBy"], [], "LEGACY_MANIFEST_RETIRED_ENTRY_INVALID");
      assertIri(item.graph, "LEGACY_MANIFEST_RETIRED_ENTRY_INVALID");
      assertIri(item.supersededBy, "LEGACY_MANIFEST_RETIRED_ENTRY_INVALID");
      let entry: LegacyRetiredGraphEntry = { id: "", kind: "retired-graph", section: "retiredGraphs", role: "retired", classification: "retired", declarationIndex: index, graphIri: item.graph, supersededByIri: item.supersededBy };
      entry = { ...entry, id: manifestEntryId(entryIdentityBasis(entry)) };
      entries.push(entry);
    }
  }

  const inactive = manifestValue.inactiveSources;
  if (inactive !== undefined) {
    if (!Array.isArray(inactive)) refuse("LEGACY_MANIFEST_SECTION_INVALID", { manifestPath, section: "inactiveSources" });
    for (let index = 0; index < inactive.length; index += 1) {
      const item = exactObject(inactive[index], ["file", "contentDigest", "disposition", "authorityEligible"], [], "LEGACY_MANIFEST_INACTIVE_ENTRY_INVALID");
      const path = resolveManifestPath(manifestPath, item.file);
      assertDigest(item.contentDigest, "LEGACY_MANIFEST_INACTIVE_ENTRY_INVALID");
      assertNonEmpty(item.disposition, "LEGACY_MANIFEST_INACTIVE_ENTRY_INVALID");
      if (item.authorityEligible !== false) refuse("LEGACY_MANIFEST_INACTIVE_AUTHORITY_FORBIDDEN", { path });
      const file = requireFile(files, path);
      if (file.digest !== item.contentDigest) refuse("LEGACY_MANIFEST_INACTIVE_DIGEST_MISMATCH", { path });
      file.roles.add("inactive");
      let entry: LegacyInactiveSourceEntry = { id: "", kind: "inactive-source", section: "inactiveSources", role: "inactive", classification: "inactive", declarationIndex: index, path, digest: file.digest, disposition: item.disposition, authorityEligible: false };
      entry = { ...entry, id: manifestEntryId(entryIdentityBasis(entry)) };
      entries.push(entry);
    }
  }

  const fixtures = manifestValue.fixtures;
  if (fixtures !== undefined) {
    const item = exactObject(fixtures, ["conforming", "defects", "loadAsAuthority"], [], "LEGACY_MANIFEST_FIXTURES_INVALID");
    if (item.loadAsAuthority !== false) refuse("LEGACY_MANIFEST_FIXTURE_AUTHORITY_FORBIDDEN", { manifestPath });
    for (const [index, fixtureKind] of (["conforming", "defect"] as const).entries()) {
      const declaredKey = fixtureKind === "defect" ? "defects" : "conforming";
      const path = resolveManifestPath(manifestPath, item[declaredKey]);
      const selectedFiles = [...files.values()].filter((file) => file.path === path || file.path.startsWith(`${path}/`)).sort((left, right) => compareCodeUnits(left.path, right.path));
      for (const file of selectedFiles) file.roles.add("fixture");
      let entry: LegacyFixtureRootEntry = {
        id: "",
        kind: "fixture-root",
        section: "fixtures",
        role: "fixture",
        classification: "fixture",
        declarationIndex: index,
        fixtureKind,
        path,
        loadAsAuthority: false,
        declaredFileCount: selectedFiles.length,
        fixtureDigest: digest(canonicalJson(selectedFiles.map((file) => [file.path, file.digest]))),
      };
      entry = { ...entry, id: manifestEntryId(entryIdentityBasis(entry)) };
      entries.push(entry);
    }
  }
  return entries;
}

const manifestTopLevelKeys = new Set([
  "version", "database", "baseIri", "authorityPublicationBudget", "imports",
  "definitionGraphs", "authoredGraphs", "observedGraphs", "shapeGraphs", "rules", "derivedGraphs",
  "retiredGraphs", "inactiveSources", "fixtures",
]);

function manifestImports(manifestPath: string, value: Record<string, unknown>): string[] {
  if (value.imports === undefined) return [];
  if (!Array.isArray(value.imports) || !value.imports.every((entry) => typeof entry === "string")) refuse("LEGACY_MANIFEST_IMPORTS_INVALID", { manifestPath });
  const imports = value.imports.map((entry) => resolveManifestPath(manifestPath, entry));
  if (new Set(imports).size !== imports.length) refuse("LEGACY_MANIFEST_DUPLICATE_IMPORT", { manifestPath });
  return [...new Set(imports)].sort(compareCodeUnits);
}

function validateManifestRoot(value: unknown, manifestPath: string): Record<string, unknown> {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 1n) || Object.keys(value).some((key) => !manifestTopLevelKeys.has(key))) refuse("LEGACY_MANIFEST_INVALID", { manifestPath });
  if (value.database !== undefined) assertNonEmpty(value.database, "LEGACY_MANIFEST_INVALID");
  if (value.baseIri !== undefined) assertIri(value.baseIri, "LEGACY_MANIFEST_INVALID");
  return value;
}

function sourceObservationBasis(source: Omit<LegacySourceClosure, "extraction">): unknown {
  return source;
}

function receiptDigest(value: Omit<LegacyExtractionReceipt, "receiptDigest">): string {
  return digest(canonicalJson(value));
}

export async function extractLegacySource(
  input: ExactLegacySourceInput,
  limitOverrides: Partial<LegacyExtractionLimits> = {},
): Promise<LegacySourceExtraction> {
  const started = monotonicNow();
  if (!Number.isFinite(started)) refuse("LEGACY_EXTRACTION_CLOCK_INVALID");
  const limits = checkedLimits(limitOverrides);
  const snapshotBudget: Budget = { limits, started, now: monotonicNow, nodes: 0, records: 0, quads: 0 };
  checkDeadline(snapshotBudget);
  const exactInput = snapshotExactLegacySource(input, limits, snapshotBudget);
  return extractLegacySourceWithin(exactInput, limits, started);
}

async function extractLegacySourceWithin(
  input: ExactLegacySourceInput,
  limits: LegacyExtractionLimits,
  started: number,
): Promise<LegacySourceExtraction> {
  const budget: Budget = { limits, started, now: monotonicNow, nodes: 0, records: 0, quads: 0 };
  const { sourceSetDigest, id: sourceId, revision, tree, commitBytes: exactCommitBytes, manifestRoots, files: exactFiles } = input;
  assertDigest(sourceSetDigest, "LEGACY_EXTRACTION_SOURCE_SET_DIGEST_INVALID");
  assertNonEmpty(sourceId, "LEGACY_EXTRACTION_SOURCE_ID_INVALID");
  if (!revisionPattern.test(revision)) refuse("LEGACY_EXTRACTION_SOURCE_REVISION_INVALID", { sourceId });
  if (!revisionPattern.test(tree)) refuse("LEGACY_EXTRACTION_SOURCE_TREE_INVALID", { sourceId });
  if (exactCommitBytes.byteLength > limits.maxFileBytes) refuse("LEGACY_EXTRACTION_COMMIT_BYTE_LIMIT_EXCEEDED", { sourceId, bytes: exactCommitBytes.byteLength, maximumBytes: limits.maxFileBytes });
  const commitObjectOid = gitObjectOid("commit", exactCommitBytes.byteLength, [exactCommitBytes]);
  if (commitObjectOid !== revision) refuse("LEGACY_EXTRACTION_COMMIT_OID_MISMATCH", { sourceId });
  const declaredCommitTree = commitTreeHeader(exactCommitBytes);
  if (exactFiles.length === 0 || exactFiles.length > limits.maxFiles) refuse("LEGACY_EXTRACTION_FILE_LIMIT_EXCEEDED", { sourceId, maximumFiles: limits.maxFiles });
  if (manifestRoots.length > limits.maxManifests) refuse("LEGACY_EXTRACTION_MANIFEST_LIMIT_EXCEEDED");

  const files = new Map<string, MutableFileMetadata>();
  let totalBytes = 0;
  let totalInputBytes = exactCommitBytes.byteLength;
  if (totalInputBytes > limits.maxTotalBytes) refuse("LEGACY_EXTRACTION_TOTAL_BYTE_LIMIT_EXCEEDED", { maximumBytes: limits.maxTotalBytes });
  for (const candidate of exactFiles) {
    checkDeadline(budget);
    const { path: suppliedPath, mode, bytes: exactBytes } = candidate;
    const path = repositoryPath(suppliedPath);
    if (files.has(path)) refuse("LEGACY_EXTRACTION_DUPLICATE_FILE", { path });
    assertGitFileMode(mode);
    if (path.split("/").length > limits.maxDepth) refuse("LEGACY_EXTRACTION_PATH_DEPTH_LIMIT_EXCEEDED", { path, maximumDepth: limits.maxDepth });
    if (exactBytes.byteLength > limits.maxFileBytes) refuse("LEGACY_EXTRACTION_FILE_BYTE_LIMIT_EXCEEDED", { path, bytes: exactBytes.byteLength, maximumBytes: limits.maxFileBytes });
    totalBytes += exactBytes.byteLength;
    totalInputBytes += exactBytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(totalInputBytes) || totalInputBytes > limits.maxTotalBytes) refuse("LEGACY_EXTRACTION_TOTAL_BYTE_LIMIT_EXCEEDED", { maximumBytes: limits.maxTotalBytes });
    files.set(path, { path, mode, blobOid: gitBlobOid(exactBytes), bytes: exactBytes, digest: digest(exactBytes), roles: new Set(pathRoles(path)), parserOutcomes: [] });
  }
  const treeObjectOid = gitTreeOidFromBlobEntries([...files.values()], limits.maxDepth);
  if (treeObjectOid !== tree) refuse("LEGACY_EXTRACTION_TREE_OID_MISMATCH", { sourceId });
  if (declaredCommitTree !== tree) refuse("LEGACY_EXTRACTION_COMMIT_TREE_MISMATCH", { sourceId });

  const structuredByPath = new Map<string, StructuredDocument>();
  const registries: LegacyRegistry[] = [];
  for (const file of [...files.values()].sort((left, right) => compareCodeUnits(left.path, right.path))) {
    const format = file.path.endsWith(".json") ? "json" as const : /\.ya?ml$/u.test(file.path) ? "yaml-1.2" as const : null;
    if (format === null) continue;
    const structured = parseStructured(file, format, budget);
    structuredByPath.set(file.path, structured);
    registries.push(structured.registry);
  }

  const roots = manifestRoots.map((path) => repositoryPath(path, "LEGACY_MANIFEST_PATH_INVALID"));
  if (new Set(roots).size !== roots.length) refuse("LEGACY_MANIFEST_DUPLICATE_ROOT");
  for (const root of roots) {
    const file = requireFile(files, root, "LEGACY_MANIFEST_FILE_MISSING");
    file.roles.add("manifest");
    if (!/\.(?:json|ya?ml)$/u.test(root)) refuse("LEGACY_MANIFEST_FORMAT_UNSUPPORTED", { path: root });
  }

  const loaded = new Map<string, LegacyManifest>();
  const active = new Set<string>();
  const manifests: LegacyManifest[] = [];
  const rdfCache = new Map<string, Promise<RdfMetadata>>();
  const sparqlCache = new Map<string, ReturnType<typeof parseSparql>>();
  const sparqlParser = new SparqlParser();
  const entryIds = new Set<string>();
  const currentGraphs = new Set<string>();
  const retiredGraphs = new Set<string>();

  const loadManifest = async (path: string, depth: number): Promise<LegacyManifest> => {
    checkDeadline(budget);
    if (depth > limits.maxManifestDepth) refuse("LEGACY_MANIFEST_DEPTH_LIMIT_EXCEEDED", { path, maximumDepth: limits.maxManifestDepth });
    const prior = loaded.get(path);
    if (prior) return prior;
    if (active.has(path)) refuse("LEGACY_MANIFEST_IMPORT_CYCLE", { path });
    if (loaded.size + active.size >= limits.maxManifests) refuse("LEGACY_EXTRACTION_MANIFEST_LIMIT_EXCEEDED", { maximumManifests: limits.maxManifests });
    const file = requireFile(files, path, "LEGACY_MANIFEST_FILE_MISSING");
    file.roles.add("manifest");
    const structured = structuredByPath.get(path) ?? refuse("LEGACY_MANIFEST_FORMAT_UNSUPPORTED", { path });
    const value = validateManifestRoot(structured.value, path);
    active.add(path);
    const imports = manifestImports(path, value);
    for (const importedPath of imports) await loadManifest(importedPath, depth + 1);
    const entries = await extractManifestEntries(path, value, files, rdfCache, sparqlCache, sparqlParser, budget);
    for (const entry of entries) {
      if (entryIds.has(entry.id)) refuse("LEGACY_MANIFEST_DUPLICATE_ENTRY_IDENTITY", { entryId: entry.id });
      entryIds.add(entry.id);
      if ("graphIri" in entry && ["definition-graph", "authored-graph", "observed-graph", "shape-graph", "derived-graph"].includes(entry.kind)) currentGraphs.add(entry.graphIri);
      if (entry.kind === "retired-graph") retiredGraphs.add(entry.graphIri);
    }
    const manifest: LegacyManifest = { path, digest: file.digest, imports, declaredEntryCount: entries.length, entries };
    active.delete(path);
    loaded.set(path, manifest);
    manifests.push(manifest);
    return manifest;
  };
  for (const root of [...roots].sort(compareCodeUnits)) await loadManifest(root, 1);
  for (const graph of retiredGraphs) if (currentGraphs.has(graph)) refuse("LEGACY_MANIFEST_CURRENT_RETIRED_CONTRADICTION", { graph });

  const trackedFiles: LegacyTrackedFile[] = [...files.values()].map((file) => ({
    path: file.path,
    mode: file.mode,
    blobOid: file.blobOid,
    digest: file.digest,
    bytes: file.bytes.byteLength,
    roles: [...file.roles].sort(compareCodeUnits),
    parserOutcomes: [...file.parserOutcomes].sort((left, right) => compareCodeUnits(left.format, right.format)),
  })).sort((left, right) => compareCodeUnits(left.path, right.path));
  const body: Omit<LegacySourceClosure, "extraction"> = {
    id: sourceId,
    revision,
    tree,
    trackedFiles,
    manifestRoots: [...roots].sort(compareCodeUnits),
    manifests,
    registries: registries.sort((left, right) => compareCodeUnits(left.path, right.path)),
  };
  const receiptWithoutDigest: Omit<LegacyExtractionReceipt, "receiptDigest"> = {
    schema: "urn:usf:legacy-extraction-receipt:1",
    status: "independently-extracted",
    extractorDigest: legacyExtractorDigest,
    sourceSetDigest,
    sourceId,
    revision,
    tree,
    gitVerification: {
      objectFormat: "sha1",
      pathEncoding: "utf-8",
      blobMethod: "git-blob-object-sha1",
      treeMethod: "recursive-git-tree-object-sha1",
      commitMethod: "git-commit-object-sha1-with-unique-tree-header",
      commitBytes: exactCommitBytes.byteLength,
      commitContentDigest: digest(exactCommitBytes),
      commitObjectOid,
      treeEntriesDigest: digest(canonicalJson(trackedFiles.map((file) => [file.path, file.mode, file.blobOid]))),
      treeObjectOid,
    },
    observationsDigest: digest(canonicalJson(sourceObservationBasis(body))),
    counts: {
      trackedFiles: trackedFiles.length,
      trackedBytes: totalBytes,
      manifests: manifests.length,
      manifestEntries: manifests.reduce((sum, manifest) => sum + manifest.entries.length, 0),
      quads: budget.quads,
      registries: registries.length,
      registryRecords: registries.reduce((sum, registry) => sum + registry.records.length, 0),
      roleAssertions: trackedFiles.reduce((sum, file) => sum + file.roles.length, 0),
      parserNodes: budget.nodes,
    },
  };
  const source: LegacySourceClosure = { ...body, extraction: { ...receiptWithoutDigest, receiptDigest: receiptDigest(receiptWithoutDigest) } };
  const sourceResultBody = {
    schema: "urn:usf:legacy-source-extraction:1" as const,
    version: 1 as const,
    sourceSetDigest,
    extractorDigest: legacyExtractorDigest,
    source,
  };
  const result: LegacySourceExtraction = { ...sourceResultBody, sourceResultDigest: digest(canonicalJson(sourceResultBody)) };
  checkDeadline(budget);
  return authenticated(result, sourceExtractionResults);
}

function verifySourceExtraction(value: unknown): LegacySourceExtraction {
  if (!isRecord(value) || !sourceExtractionResults.has(value) || value.schema !== "urn:usf:legacy-source-extraction:1" || value.version !== 1 || value.extractorDigest !== legacyExtractorDigest || !isRecord(value.source)) refuse("LEGACY_EXTRACTION_RESULT_UNAUTHENTIC");
  const result = value as unknown as LegacySourceExtraction;
  const { sourceResultDigest: _digest, ...basis } = result;
  if (digest(canonicalJson(basis)) !== result.sourceResultDigest) refuse("LEGACY_EXTRACTION_RESULT_DIGEST_MISMATCH");
  return result;
}

export function combineLegacyExtractionResults(
  sourceSetDigest: string,
  sourceResults: readonly LegacySourceExtraction[],
  limitOverrides: Partial<LegacyExtractionLimits> = {},
): LegacyExtractionResult {
  const limits = checkedLimits(limitOverrides);
  const exactSourceResults = snapshotExactArray(sourceResults, limits.maxSources, "LEGACY_EXTRACTION_SOURCE_LIMIT_EXCEEDED") as readonly LegacySourceExtraction[];
  const started = monotonicNow();
  if (!Number.isFinite(started)) refuse("LEGACY_EXTRACTION_CLOCK_INVALID");
  return combineLegacyExtractionResultsWithin(sourceSetDigest, exactSourceResults, limits, started);
}

function combineLegacyExtractionResultsWithin(
  sourceSetDigest: string,
  sourceResults: readonly LegacySourceExtraction[],
  limits: LegacyExtractionLimits,
  started: number,
): LegacyExtractionResult {
  const budget: Budget = { limits, started, now: monotonicNow, nodes: 0, records: 0, quads: 0 };
  checkDeadline(budget);
  assertDigest(sourceSetDigest, "LEGACY_EXTRACTION_SOURCE_SET_DIGEST_INVALID");
  if (!Array.isArray(sourceResults) || sourceResults.length === 0 || sourceResults.length > limits.maxSources) refuse("LEGACY_EXTRACTION_SOURCE_LIMIT_EXCEEDED");
  const verified = sourceResults.map(verifySourceExtraction);
  checkDeadline(budget);
  if (verified.some((result) => result.sourceSetDigest !== sourceSetDigest)) refuse("LEGACY_EXTRACTION_SOURCE_SET_DIGEST_MISMATCH");
  const sources = verified.map((result) => result.source).sort((left, right) => compareCodeUnits(left.id, right.id));
  if (sources.some((source, index) => index > 0 && source.id === sources[index - 1]!.id)) refuse("LEGACY_EXTRACTION_DUPLICATE_SOURCE", { sourceId: sources.find((source, index) => index > 0 && source.id === sources[index - 1]!.id)?.id });
  const aggregate = sources.reduce((total, source) => ({
    files: total.files + source.extraction.counts.trackedFiles,
    bytes: total.bytes + source.extraction.counts.trackedBytes + source.extraction.gitVerification.commitBytes,
    manifests: total.manifests + source.extraction.counts.manifests,
    nodes: total.nodes + source.extraction.counts.parserNodes,
    records: total.records + source.extraction.counts.registryRecords,
    quads: total.quads + source.extraction.counts.quads,
  }), { files: 0, bytes: 0, manifests: 0, nodes: 0, records: 0, quads: 0 });
  if (aggregate.files > limits.maxFiles) refuse("LEGACY_EXTRACTION_FILE_LIMIT_EXCEEDED", { maximumFiles: limits.maxFiles });
  if (!Number.isSafeInteger(aggregate.bytes) || aggregate.bytes > limits.maxTotalBytes) refuse("LEGACY_EXTRACTION_TOTAL_BYTE_LIMIT_EXCEEDED", { maximumBytes: limits.maxTotalBytes });
  if (aggregate.manifests > limits.maxManifests) refuse("LEGACY_EXTRACTION_MANIFEST_LIMIT_EXCEEDED", { maximumManifests: limits.maxManifests });
  if (aggregate.nodes > limits.maxNodes) refuse("LEGACY_EXTRACTION_NODE_LIMIT_EXCEEDED", { maximumNodes: limits.maxNodes });
  if (aggregate.records > limits.maxRecords) refuse("LEGACY_EXTRACTION_RECORD_LIMIT_EXCEEDED", { maximumRecords: limits.maxRecords });
  if (aggregate.quads > limits.maxQuads) refuse("LEGACY_EXTRACTION_QUAD_LIMIT_EXCEEDED", { maximumQuads: limits.maxQuads });
  checkDeadline(budget);
  const body = { schema: "urn:usf:legacy-extraction-result:1" as const, version: 1 as const, sourceSetDigest, extractorDigest: legacyExtractorDigest, sources };
  const result: LegacyExtractionResult = { ...body, resultDigest: digest(canonicalJson(body)) };
  checkDeadline(budget);
  return authenticated(result, aggregateExtractionResults);
}

export async function extractLegacySources(
  input: ExactLegacyExtractionInput,
  limitOverrides: Partial<LegacyExtractionLimits> = {},
): Promise<LegacyExtractionResult> {
  const started = monotonicNow();
  if (!Number.isFinite(started)) refuse("LEGACY_EXTRACTION_CLOCK_INVALID");
  const limits = checkedLimits(limitOverrides);
  const aggregateBudget: Budget = { limits, started, now: monotonicNow, nodes: 0, records: 0, quads: 0 };
  checkDeadline(aggregateBudget);
  const fields = snapshotExactDataObject(input, ["schema", "version", "sourceSetDigest", "sources"], [], "LEGACY_EXTRACTION_INPUT_INVALID", aggregateBudget);
  if (fields.schema !== "urn:usf:exact-legacy-extraction-input:1" || fields.version !== 1 || typeof fields.sourceSetDigest !== "string") refuse("LEGACY_EXTRACTION_INPUT_INVALID");
  assertDigest(fields.sourceSetDigest, "LEGACY_EXTRACTION_SOURCE_SET_DIGEST_INVALID");
  const sourceValues = snapshotExactArray(fields.sources, limits.maxSources, "LEGACY_EXTRACTION_SOURCE_LIMIT_EXCEEDED", aggregateBudget);
  if (sourceValues.length === 0) refuse("LEGACY_EXTRACTION_SOURCE_LIMIT_EXCEEDED", { maximumSources: limits.maxSources });
  const sourceSetDigest = fields.sourceSetDigest;
  const results: LegacySourceExtraction[] = [];
  let consumed = { files: 0, bytes: 0, manifests: 0, nodes: 0, records: 0, quads: 0 };
  for (const sourceValue of sourceValues) {
    checkDeadline(aggregateBudget);
    const remainingLimits: LegacyExtractionLimits = {
      ...limits,
      maxFiles: limits.maxFiles - consumed.files,
      maxTotalBytes: limits.maxTotalBytes - consumed.bytes,
      maxManifests: limits.maxManifests - consumed.manifests,
      maxNodes: limits.maxNodes - consumed.nodes,
      maxRecords: limits.maxRecords - consumed.records,
      maxQuads: limits.maxQuads - consumed.quads,
    };
    if ([remainingLimits.maxFiles, remainingLimits.maxTotalBytes, remainingLimits.maxManifests, remainingLimits.maxNodes, remainingLimits.maxRecords, remainingLimits.maxQuads].some((value) => value < 1)) refuse("LEGACY_EXTRACTION_AGGREGATE_LIMIT_EXCEEDED");
    const source = snapshotExactLegacySource(sourceValue, remainingLimits, aggregateBudget, sourceSetDigest);
    const result = await extractLegacySourceWithin(source, remainingLimits, started);
    checkDeadline(aggregateBudget);
    results.push(result);
    const counts = result.source.extraction.counts;
    consumed = {
      files: consumed.files + counts.trackedFiles,
      bytes: consumed.bytes + counts.trackedBytes + result.source.extraction.gitVerification.commitBytes,
      manifests: consumed.manifests + counts.manifests,
      nodes: consumed.nodes + counts.parserNodes,
      records: consumed.records + counts.registryRecords,
      quads: consumed.quads + counts.quads,
    };
  }
  const combined = combineLegacyExtractionResultsWithin(sourceSetDigest, results, limits, started);
  checkDeadline(aggregateBudget);
  return combined;
}

export function verifyLegacyExtractionResult(value: unknown, expectation?: LegacyExtractionExpectation): LegacyExtractionResult {
  if (!isRecord(value) || !aggregateExtractionResults.has(value) || value.schema !== "urn:usf:legacy-extraction-result:1" || value.version !== 1 || value.extractorDigest !== legacyExtractorDigest || !Array.isArray(value.sources)) refuse("LEGACY_EXTRACTION_RESULT_UNAUTHENTIC");
  const result = value as unknown as LegacyExtractionResult;
  const { resultDigest: _digest, ...basis } = result;
  if (digest(canonicalJson(basis)) !== result.resultDigest) refuse("LEGACY_EXTRACTION_RESULT_DIGEST_MISMATCH");
  if (expectation !== undefined) {
    if (expectation.sourceSetDigest !== result.sourceSetDigest) refuse("LEGACY_EXTRACTION_SOURCE_SET_DIGEST_MISMATCH");
    if (expectation.sources.length !== result.sources.length) refuse("LEGACY_EXTRACTION_SOURCE_DENOMINATOR_MISMATCH");
    const expectedIds = expectation.sources.map((source) => source.id);
    if (new Set(expectedIds).size !== expectedIds.length) refuse("LEGACY_EXTRACTION_SOURCE_DENOMINATOR_MISMATCH");
    const actualById = new Map(result.sources.map((source) => [source.id, source]));
    for (const expected of expectation.sources) {
      const actual = actualById.get(expected.id);
      if (actual === undefined || actual.revision !== expected.revision || actual.tree !== expected.tree || actual.trackedFiles.length !== expected.trackedFileCount || actual.extraction.counts.trackedBytes !== expected.trackedByteCount) refuse("LEGACY_EXTRACTION_SOURCE_DENOMINATOR_MISMATCH", { sourceId: expected.id });
      if (expected.graphManifest !== undefined) {
        const manifest = actual.manifests.find((candidate) => candidate.path === expected.graphManifest!.path);
        if (manifest === undefined || manifest.digest !== expected.graphManifest.digest || !actual.manifestRoots.includes(expected.graphManifest.path)) refuse("LEGACY_EXTRACTION_MANIFEST_BINDING_MISMATCH", { sourceId: expected.id });
      }
    }
  }
  return result;
}
