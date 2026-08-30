import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  loadSemanticGraph,
  objectsFor,
  resourceDigest,
  resourceExists,
  transitiveResourceIris,
  type GraphLoadLimits,
  type LoadedSemanticGraph,
} from "./index.ts";
import {
  verifyLegacyExtractionResult,
  legacyExtractorDigest,
  type LegacyExtractionReceipt,
  type LegacyExtractionResult,
  type LegacyAuthoredGraphEntry,
  type LegacyDefinitionGraphEntry,
  type LegacyDerivedGraphEntry,
  type LegacyManifest,
  type LegacyManifestEntry,
  type LegacyObservedGraphEntry,
  type LegacyQuadObservation,
  type LegacyRegistry,
  type LegacyShapeGraphEntry,
  type LegacySourceClosure,
  type LegacyTrackedFile,
} from "./recovery-extract.ts";

type LegacyRdfManifestEntry = LegacyDefinitionGraphEntry | LegacyAuthoredGraphEntry | LegacyObservedGraphEntry | LegacyShapeGraphEntry | LegacyDerivedGraphEntry;

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const iriPattern = /^(?:urn:[^<>\s]+|https?:\/\/[^<>\s]+)$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;
const monotonicNow = performance.now.bind(performance);

export const recoveryCandidateKinds = [
  "tracked-source-artifact",
  "graph-selection",
  "named-semantic-resource",
  "rdf-type-assertion",
  "predicate-vocabulary",
  "referenced-iri",
  "structured-schema-or-registry-record",
  "test-obligation",
  "semantic-document",
] as const;

const legacyGraphSelectionKinds = ["definition-graph", "authored-graph", "observed-graph", "shape-graph", "derived-graph", "rule", "retired-graph", "inactive-source", "fixture-root"] as const;

export type RecoveryCandidateKind = typeof recoveryCandidateKinds[number];
export type RecoveryDisposition = "re-express-ready" | "metadata-only" | "defer" | "not-claimed" | "historical-only" | "reject" | "unresolved";
export type ManifestClassification = "selected" | "derived" | "retired" | "inactive" | "fixture";

export class SemanticRecoveryError extends Error {
  readonly reasonCode: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(reasonCode: string, details?: Readonly<Record<string, unknown>>) {
    super(reasonCode);
    this.name = "SemanticRecoveryError";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export interface RecoveryLimits {
  readonly maxSources: number;
  readonly maxTrackedFiles: number;
  readonly maxTrackedBytes: number;
  readonly maxManifests: number;
  readonly maxManifestDepth: number;
  readonly maxManifestEntries: number;
  readonly maxManifestImports: number;
  readonly maxQuads: number;
  readonly maxRegistries: number;
  readonly maxRegistryRecords: number;
  readonly maxCandidates: number;
  readonly maxRules: number;
  readonly maxReadinessRecords: number;
  readonly maxExactDispositions: number;
  readonly maxReviewedMappings: number;
  readonly maxAdverseLessons: number;
  readonly maxConsumers: number;
  readonly maxConnections: number;
  readonly maxReviewDigests: number;
  readonly maxRolesPerFile: number;
  readonly maxTypesPerCandidate: number;
  readonly maxMitigationsPerRecord: number;
  readonly maxMappingItems: number;
  readonly maxElapsedMilliseconds: number;
}

export const defaultRecoveryLimits: RecoveryLimits = Object.freeze({
  maxSources: 32,
  maxTrackedFiles: 250_000,
  maxTrackedBytes: 8 * 1024 * 1024 * 1024,
  maxManifests: 10_000,
  maxManifestDepth: 128,
  maxManifestEntries: 250_000,
  maxManifestImports: 1_000_000,
  maxQuads: 2_000_000,
  maxRegistries: 25_000,
  maxRegistryRecords: 1_000_000,
  maxCandidates: 5_000_000,
  maxRules: 50_000,
  maxReadinessRecords: 250_000,
  maxExactDispositions: 5_000_000,
  maxReviewedMappings: 250_000,
  maxAdverseLessons: 50_000,
  maxConsumers: 250_000,
  maxConnections: 250_000,
  maxReviewDigests: 250_000,
  maxRolesPerFile: 256,
  maxTypesPerCandidate: 10_000,
  maxMitigationsPerRecord: 50_000,
  maxMappingItems: 250_000,
  maxElapsedMilliseconds: 30_000,
});

export interface RecoverySourceSetContract {
  readonly schema: "urn:usf:semantic-recovery-source-set:1";
  readonly version: 1;
  readonly sourceSetDigest: string;
  readonly sources: readonly RecoverySourceContract[];
}

export interface RecoverySourceContract {
  readonly id: string;
  readonly kind: string;
  readonly revision: string;
  readonly tree: string;
  readonly selection: {
    readonly mode: "full-tracked-tree-closure";
    readonly trackedFileCount: number;
    readonly trackedByteCount: number;
    readonly filters: readonly string[];
  };
  readonly graphManifest?: {
    readonly path: string;
    readonly digest: string;
    readonly selectionMode: "full-declared-closure";
  };
  readonly licence: {
    readonly status: "declared" | "undetermined" | "restricted";
    readonly identifier?: string;
    readonly evidencePath?: string;
    readonly evidenceDigest?: string;
    readonly reuseBoundary: string;
  };
}

export interface RecoveryCandidateIdentity {
  readonly sourceSetDigest: string;
  readonly logicalSourceId: string;
  readonly pinnedSourceRevision: string;
  readonly selectedFileGraphOrRegistryId: string;
  readonly candidateKind: RecoveryCandidateKind;
  readonly candidateIriPathOrRegistryKey: string;
  readonly discriminator: string;
}

export interface RecoveryCandidate {
  readonly candidateId: string;
  readonly identity: RecoveryCandidateIdentity;
  readonly evidenceLocation: string;
  readonly sourceDigest: string;
  readonly pathClass: string;
  readonly graphIri: string | null;
  readonly typeIris: readonly string[];
  readonly predicate: string | null;
}

export interface LegacyGraphInventory {
  readonly schema: "urn:usf:legacy-graph-inventory:1";
  readonly version: 1;
  readonly sourceSetDigest: string;
  readonly sources: readonly LegacyInventorySource[];
  readonly trackedFiles: readonly LegacyInventoryTrackedFile[];
  readonly graphSelections: readonly LegacyInventoryGraphSelection[];
  readonly semanticRecords: readonly LegacyInventorySemanticRecord[];
  readonly structuredRecords: readonly LegacyInventoryStructuredRecord[];
  readonly candidates: readonly RecoveryCandidate[];
  readonly inventoryDigest: string;
}

export interface LegacyInventorySource {
  readonly sourceId: string;
  readonly revision: string;
  readonly tree: string;
  readonly sourceContractDigest: string;
  readonly licenceStatus: RecoverySourceContract["licence"]["status"];
  readonly licenceIdentifier: string | null;
  readonly reuseBoundary: string;
  readonly extractionReceipt: LegacyExtractionReceipt;
  readonly trackedFileCount: number;
  readonly trackedByteCount: number;
  readonly manifestCount: number;
  readonly graphSelectionCount: number;
  readonly quadObservationCount: number;
  readonly registryCount: number;
  readonly structuredRecordCount: number;
  readonly roleAssertionCount: number;
  readonly candidateCount: number;
}

export interface LegacyInventoryTrackedFile {
  readonly sourceId: string;
  readonly path: string;
  readonly mode: LegacyTrackedFile["mode"];
  readonly blobOid: string;
  readonly digest: string;
  readonly bytes: number;
  readonly roles: readonly string[];
  readonly parserOutcomes: LegacyTrackedFile["parserOutcomes"];
}

/** Exact RDF observation metadata retained to rederive every RDF candidate family. */
export interface LegacyInventorySemanticRecord {
  readonly sourceId: string;
  readonly selectionId: string;
  readonly filePath: string;
  readonly sourceDigest: string;
  readonly graphIri: string;
  readonly subject: string;
  readonly subjectKind: LegacyQuadObservation["subjectKind"];
  readonly predicate: string;
  readonly object: string;
  readonly objectKind: LegacyQuadObservation["objectKind"];
  readonly graph: string | null;
  readonly graphKind: LegacyQuadObservation["graphKind"];
  readonly statementDigest: string;
}

export interface LegacyInventoryGraphSelection {
  readonly sourceId: string;
  readonly manifestPath: string;
  readonly entryId: string;
  readonly kind: LegacyManifestEntry["kind"];
  readonly filePath: string | null;
  readonly digest: string;
  readonly graphIri: string | null;
  readonly loadOrder: number | null;
  readonly validationOrder: number | null;
  readonly role: string;
  readonly section: string;
  readonly outputGraphIri: string | null;
  readonly classification: ManifestClassification;
}

export interface LegacyInventoryStructuredRecord {
  readonly sourceId: string;
  readonly registryId: string;
  readonly registryPath: string;
  readonly key: string;
  readonly recordKind: string;
  readonly digest: string;
}

export interface RecoveryConfig {
  readonly schema: "urn:usf:semantic-recovery:1";
  readonly version: 1;
  readonly sourceSetDigest: string;
  readonly inventoryDigest: string;
  readonly exactDispositions: readonly ExactDisposition[];
  readonly rules: readonly CompactDispositionRule[];
  readonly readinessRecords: readonly AdoptionReadinessRecord[];
  readonly reviewedMappings: readonly ReviewedSemanticMapping[];
  readonly recoveryDigest: string;
}

export interface V3RecoverySelection {
  readonly profileIri: string;
  readonly profileVersion: string;
  readonly semanticDigest: string;
  readonly closureDigest: string;
  readonly consumers: readonly V3Consumer[];
  readonly connections: readonly {
    readonly targetIri: string;
    readonly relationType: string;
    readonly digest: string;
  }[];
  readonly validationObligationDigests: readonly string[];
  readonly testObligationDigests: readonly string[];
}

export interface V3Consumer {
  readonly iri: string;
  readonly kind: "contract" | "requirement" | "consumer";
  readonly digest: string;
  readonly status: "unsatisfied" | "satisfied" | "unknown";
}

export interface AdverseLesson {
  readonly id: string;
  readonly kind: "adverse-lesson" | "retirement" | "supersession" | "defect" | "operational-failure";
  readonly sourceIds: readonly string[];
  readonly evidenceDigest: string;
}

export interface DispositionResolution {
  readonly disposition: RecoveryDisposition;
  readonly rationale: string;
  readonly targetV3Iri: string | null;
  readonly definitionCoverageState: "covered" | "partial" | "absent" | "unknown";
  readonly operationalImplementationState: "implemented" | "partial" | "not-implemented" | "not-applicable" | "unknown";
  readonly readinessRecordDigest: string | null;
}

export interface ReviewProvenance {
  readonly reviewId: string;
  readonly reviewDigest: string;
}

export interface ExactDisposition {
  readonly candidateId: string;
  readonly resolution: DispositionResolution;
  readonly provenance: ReviewProvenance;
}

export interface CompactRuleMatch {
  readonly sourceId: string;
  readonly candidateKind: RecoveryCandidateKind;
  readonly exactType?: string;
  readonly predicate?: string;
  readonly pathClass?: string;
}

export interface CompactDispositionRule {
  readonly id: string;
  readonly match: CompactRuleMatch;
  readonly resolution: DispositionResolution;
  readonly provenance: ReviewProvenance;
}

export interface AdoptionReadinessRecord {
  readonly schema: "urn:usf:semantic-adoption-readiness:1";
  readonly candidateId: string;
  readonly sourceDigest: string;
  readonly reviewed: true;
  readonly reviewDigest: string;
  readonly relevance: {
    readonly consumerIri: string;
    readonly consumerKind: "contract" | "requirement" | "consumer";
    readonly consumerDigest: string;
    readonly unsatisfied: true;
    readonly duplicate: false;
  };
  readonly connectivity: {
    readonly status: "connected" | "accepted-new-root" | "disconnected" | "unknown";
    readonly selectedProfileIri: string;
    readonly selectedProfileVersion: string;
    readonly closureDigest: string;
    readonly targetIri: string;
    readonly relationType: string;
    readonly intendedConsumers: readonly string[];
    readonly newRootExceptionDigest: string | null;
  };
  readonly licence: {
    readonly status: "cleared" | "restricted" | "unknown";
    readonly decisionDigest: string;
  };
  readonly layer: {
    readonly targetLayer: "core" | "product";
    readonly productProfileIri: string | null;
    readonly productProfileVersion: string | null;
    readonly isolationStatus: "cleared" | "violated" | "unknown";
    readonly decisionDigest: string;
  };
  readonly mitigations: readonly {
    readonly lessonId: string;
    readonly mitigation: string;
    readonly verificationDigest: string;
  }[];
  readonly currentness: {
    readonly sourceSetDigest: string;
    readonly inventoryDigest: string;
    readonly selectedProfileIri: string;
    readonly selectedProfileVersion: string;
    readonly semanticDigest: string;
    readonly closureDigest: string;
    readonly validationObligationDigest: string;
    readonly testObligationDigest: string;
  };
  readonly bauCeilings: readonly BauCeilingAssessment[];
  readonly lifecycle: LifecycleAssessment;
  readonly readinessDigest: string;
}

export const requiredBauDimensions = [
  "authority-dependencies",
  "storage-dependencies",
  "network-use",
  "provider-use",
  "update-triggers",
  "scan-bytes",
  "scan-runtime-ms",
  "memory-bytes",
  "test-runtime-ms",
  "maintenance-cost",
  "failure-scope",
  "rollback-cost",
  "retirement-cost",
] as const;

export type BauDimension = typeof requiredBauDimensions[number];

export interface BauCeilingAssessment {
  readonly dimension: BauDimension;
  readonly ceiling: number;
  readonly observed: number;
  readonly unit: string;
  readonly status: "within" | "over" | "unknown";
}

export type LifecycleAssessment =
  | { readonly applicability: "not-applicable"; readonly rationale: string }
  | {
    readonly applicability: "applicable";
    readonly rationale: string;
    readonly commands: { readonly start: true; readonly status: true; readonly stop: true };
    readonly retryBound: number;
    readonly drainMilliseconds: number;
    readonly restartBound: number;
    readonly noPartialAuthorityMutation: true;
  }
  | { readonly applicability: "unknown"; readonly rationale: string };

export interface ReviewedSemanticMapping {
  readonly id: string;
  readonly kind: "split" | "merge" | "equivalent" | "replacement";
  readonly sourceCandidateIds: readonly string[];
  readonly targetV3Iris: readonly string[];
  readonly reviewDigest: string;
}

export interface RecoveryAuthorityContext {
  readonly sourceSet: RecoverySourceSetContract;
  readonly acceptedInventoryDigest: string;
  readonly acceptedRecoveryDigest: string;
  readonly v3Selection: V3RecoverySelection;
  readonly adverseLessons: readonly AdverseLesson[];
  readonly bauPolicy: readonly {
    readonly dimension: BauDimension;
    readonly maximumCeiling: number;
    readonly unit: string;
  }[];
  readonly licenceDecisions: readonly {
    readonly sourceId: string;
    readonly status: "cleared-for-original-v3-reexpression" | "metadata-only" | "unresolved";
    readonly decisionDigest: string;
  }[];
  readonly layerDecisions: readonly {
    readonly targetIri: string;
    readonly targetLayer: "core" | "product";
    readonly productProfileIri: string | null;
    readonly productProfileVersion: string | null;
    readonly isolationStatus: "cleared" | "violated";
    readonly decisionDigest: string;
  }[];
  readonly allowedReviewDigests: readonly string[];
  readonly acceptedNewRootExceptionDigests: readonly string[];
}

export interface DeriveRecoveryAuthorityOptions {
  readonly manifestPath: string;
  readonly authorityIri: string;
  readonly profileIri: string;
  readonly sourceSet: RecoverySourceSetContract;
  readonly inventory: LegacyGraphInventory;
  readonly config: RecoveryConfig;
  readonly recoveryLimits?: Partial<RecoveryLimits>;
  readonly graphLoadLimits?: Partial<GraphLoadLimits>;
}

export const recoveryAuthorityVocabulary = deepFreeze({
  predicate: {
    type: "urn:usf:predicate:type",
    version: "urn:usf:predicate:version",
    profile: "urn:usf:predicate:recoveryProfile",
    acceptedSourceSetDigest: "urn:usf:predicate:acceptedSourceSetDigest",
    consumer: "urn:usf:predicate:recoveryConsumer",
    connection: "urn:usf:predicate:recoveryConnection",
    validationObligation: "urn:usf:predicate:recoveryValidationObligation",
    testObligation: "urn:usf:predicate:recoveryTestObligation",
    adverseLesson: "urn:usf:predicate:adverseLesson",
    bauPolicy: "urn:usf:predicate:recoveryBauPolicy",
    licenceDecision: "urn:usf:predicate:recoveryLicenceDecision",
    layerDecision: "urn:usf:predicate:recoveryLayerDecision",
    allowedReview: "urn:usf:predicate:allowedRecoveryReview",
    acceptedNewRootException: "urn:usf:predicate:acceptedNewRootException",
    recoveryStatus: "urn:usf:predicate:recoveryStatus",
    target: "urn:usf:predicate:target",
    relationType: "urn:usf:predicate:relationType",
    source: "urn:usf:predicate:source",
    dimension: "urn:usf:predicate:dimension",
    maximumCeiling: "urn:usf:predicate:maximumCeiling",
    unit: "urn:usf:predicate:unit",
    decisionStatus: "urn:usf:predicate:decisionStatus",
    targetLayer: "urn:usf:predicate:targetLayer",
    productProfile: "urn:usf:predicate:productProfile",
    isolationStatus: "urn:usf:predicate:isolationStatus",
  },
  type: {
    authority: "urn:usf:type:RecoveryAuthority",
    profile: "urn:usf:type:RealisationProfile",
    contract: "urn:usf:type:SemanticContract",
    requirement: "urn:usf:type:Requirement",
    consumer: "urn:usf:type:RecoveryConsumer",
    connection: "urn:usf:type:RecoveryConnection",
    validationObligation: "urn:usf:type:RecoveryValidationObligation",
    testObligation: "urn:usf:type:TestObligation",
    adverseLesson: "urn:usf:type:AdverseLesson",
    retirement: "urn:usf:type:Retirement",
    supersession: "urn:usf:type:Supersession",
    defect: "urn:usf:type:Defect",
    operationalFailure: "urn:usf:type:OperationalFailure",
    bauPolicy: "urn:usf:type:RecoveryBauPolicy",
    licenceDecision: "urn:usf:type:RecoveryLicenceDecision",
    layerDecision: "urn:usf:type:RecoveryLayerDecision",
    review: "urn:usf:type:RecoveryReview",
    newRootException: "urn:usf:type:RecoveryNewRootException",
  },
} as const);

const authenticatedRecoveryAuthorities = new WeakSet<object>();

export interface ReadinessEvaluation {
  readonly status: "ready" | "defer" | "unresolved";
  readonly disposition: "re-express-ready" | "defer" | "unresolved";
  readonly reasons: readonly string[];
  readonly readinessDigest: string | null;
}

export interface SemanticCoverageReport {
  readonly schema: "urn:usf:semantic-coverage-report:1";
  readonly status: "complete";
  readonly sourceSetDigest: string;
  readonly inventoryDigest: string;
  readonly recoveryDigest: string;
  readonly historicalReextraction: "not-independently-re-extracted";
  readonly totals: {
    readonly sources: number;
    readonly trackedFiles: number;
    readonly graphSelections: number;
    readonly structuredRecords: number;
    readonly candidates: number;
    readonly resolved: number;
    readonly byCandidateKind: Readonly<Record<RecoveryCandidateKind, number>>;
    readonly byGraphSelectionKind: Readonly<Record<LegacyManifestEntry["kind"], number>>;
    readonly byDisposition: Readonly<Record<RecoveryDisposition, number>>;
  };
  readonly candidates: readonly CompiledCandidateDisposition[];
  readonly nonclaims: readonly string[];
}

export interface CompiledCandidateDisposition {
  readonly candidateId: string;
  readonly requestedDisposition: RecoveryDisposition;
  readonly disposition: RecoveryDisposition;
  readonly provenanceKind: "exact" | "rule";
  readonly provenanceId: string;
  readonly provenanceDigest: string;
  readonly rationale: string;
  readonly targetV3Iri: string | null;
  readonly definitionCoverageState: DispositionResolution["definitionCoverageState"];
  readonly operationalImplementationState: DispositionResolution["operationalImplementationState"];
  readonly readiness: ReadinessEvaluation;
}

function refuse(reasonCode: string, details?: Readonly<Record<string, unknown>>): never {
  throw new SemanticRecoveryError(reasonCode, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
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

function assertCount(value: unknown, reason: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) refuse(reason);
}

function assertRelativePath(value: unknown, reason: string): asserts value is string {
  assertNonEmpty(value, reason);
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0") || value.split("/").some((part) => part === "" || part === "." || part === "..")) refuse(reason);
}

function checkedLimits(overrides: Partial<RecoveryLimits>): RecoveryLimits {
  const known = new Set(Object.keys(defaultRecoveryLimits));
  if (Object.keys(overrides).some((key) => !known.has(key))) refuse("RECOVERY_LIMIT_INVALID");
  const limits = { ...defaultRecoveryLimits, ...overrides };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) refuse("RECOVERY_LIMIT_INVALID");
  return limits;
}

function recoveryDeadline(limits: RecoveryLimits): () => void {
  const startedAt = monotonicNow();
  return (): void => {
    const elapsed = monotonicNow() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > limits.maxElapsedMilliseconds) refuse("RECOVERY_DEADLINE_EXCEEDED");
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === "boolean" || typeof input === "string") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input) || Object.is(input, -0)) refuse("RECOVERY_CANONICAL_VALUE_INVALID");
      return input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    if (!isRecord(input)) refuse("RECOVERY_CANONICAL_VALUE_INVALID");
    return Object.fromEntries(Object.keys(input).sort(compareText).filter((key) => input[key] !== undefined).map((key) => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value));
}

function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** UTF-8 byte order for valid Unicode scalars, without per-comparison allocation. */
function compareUtf8(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) as number;
    const rightPoint = right.codePointAt(rightIndex) as number;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return (left.length - leftIndex) - (right.length - rightIndex);
}

function sortedUnique(values: readonly string[], reason: string): string[] {
  const result = [...values].sort(compareText);
  if (result.some((value, index) => index > 0 && value === result[index - 1])) refuse(reason, { value: result.find((value, index) => index > 0 && value === result[index - 1]) });
  return result;
}

function withoutDigest<T extends Record<string, unknown>>(value: T, field: keyof T): Omit<T, keyof T> {
  const copy = { ...value };
  delete copy[field];
  return copy as Omit<T, keyof T>;
}

export function computeSourceSetDigest(contract: Omit<RecoverySourceSetContract, "sourceSetDigest"> | RecoverySourceSetContract): string {
  const basis = "sourceSetDigest" in contract ? withoutDigest(contract as unknown as Record<string, unknown>, "sourceSetDigest") : contract;
  return canonicalDigest(basis);
}

export function computeInventoryDigest(inventory: Omit<LegacyGraphInventory, "inventoryDigest"> | LegacyGraphInventory): string {
  const basis = "inventoryDigest" in inventory ? withoutDigest(inventory as unknown as Record<string, unknown>, "inventoryDigest") : inventory;
  return canonicalDigest(basis);
}

export function computeReadinessDigest(record: Omit<AdoptionReadinessRecord, "readinessDigest"> | AdoptionReadinessRecord): string {
  const basis = "readinessDigest" in record ? withoutDigest(record as unknown as Record<string, unknown>, "readinessDigest") : record;
  return canonicalDigest(basis);
}

export function computeRecoveryDigest(config: Omit<RecoveryConfig, "recoveryDigest"> | RecoveryConfig): string {
  const basis = "recoveryDigest" in config ? withoutDigest(config as unknown as Record<string, unknown>, "recoveryDigest") : config;
  return canonicalDigest(basis);
}

/** Recompute receipt metadata integrity only; this never proves re-extraction. */
export function computeExtractionReceiptDigest(receipt: Omit<LegacyExtractionReceipt, "receiptDigest"> | LegacyExtractionReceipt): string {
  const basis = "receiptDigest" in receipt ? withoutDigest(receipt as unknown as Record<string, unknown>, "receiptDigest") : receipt;
  return canonicalDigest(basis);
}

function validateSourceContract(value: unknown): asserts value is RecoverySourceContract {
  if (!isRecord(value) || !exactKeys(value, ["id", "kind", "revision", "tree", "selection", "licence"], ["graphManifest"])) refuse("SOURCE_SET_SOURCE_INVALID");
  assertIri(value.id, "SOURCE_SET_SOURCE_INVALID");
  assertNonEmpty(value.kind, "SOURCE_SET_SOURCE_INVALID");
  if (typeof value.revision !== "string" || !revisionPattern.test(value.revision) || typeof value.tree !== "string" || !revisionPattern.test(value.tree)) refuse("SOURCE_SET_SOURCE_INVALID");
  if (!isRecord(value.selection) || !exactKeys(value.selection, ["mode", "trackedFileCount", "trackedByteCount", "filters"]) || value.selection.mode !== "full-tracked-tree-closure" || !Array.isArray(value.selection.filters)) refuse("SOURCE_SET_SELECTION_INVALID");
  assertCount(value.selection.trackedFileCount, "SOURCE_SET_SELECTION_INVALID");
  assertCount(value.selection.trackedByteCount, "SOURCE_SET_SELECTION_INVALID");
  if (value.selection.filters.length !== 0) refuse("SOURCE_SET_FILTERS_FORBIDDEN");
  if (value.graphManifest !== undefined) {
    if (!isRecord(value.graphManifest) || !exactKeys(value.graphManifest, ["path", "digest", "selectionMode"]) || value.graphManifest.selectionMode !== "full-declared-closure") refuse("SOURCE_SET_MANIFEST_INVALID");
    assertRelativePath(value.graphManifest.path, "SOURCE_SET_MANIFEST_INVALID");
    assertDigest(value.graphManifest.digest, "SOURCE_SET_MANIFEST_INVALID");
  }
  if (!isRecord(value.licence) || !exactKeys(value.licence, ["status", "reuseBoundary"], ["identifier", "evidencePath", "evidenceDigest"]) || !["declared", "undetermined", "restricted"].includes(String(value.licence.status))) refuse("SOURCE_SET_LICENCE_INVALID");
  assertNonEmpty(value.licence.reuseBoundary, "SOURCE_SET_LICENCE_INVALID");
  if (value.licence.identifier !== undefined) assertNonEmpty(value.licence.identifier, "SOURCE_SET_LICENCE_INVALID");
  if (value.licence.evidencePath !== undefined) assertRelativePath(value.licence.evidencePath, "SOURCE_SET_LICENCE_INVALID");
  if (value.licence.evidenceDigest !== undefined) assertDigest(value.licence.evidenceDigest, "SOURCE_SET_LICENCE_INVALID");
}

function validateSourceSet(value: unknown, limits: RecoveryLimits): asserts value is RecoverySourceSetContract {
  if (!isRecord(value) || !exactKeys(value, ["schema", "version", "sourceSetDigest", "sources"]) || value.schema !== "urn:usf:semantic-recovery-source-set:1" || value.version !== 1 || !Array.isArray(value.sources)) refuse("SOURCE_SET_INVALID");
  assertDigest(value.sourceSetDigest, "SOURCE_SET_DIGEST_INVALID");
  if (value.sources.length === 0 || value.sources.length > limits.maxSources) refuse("SOURCE_SET_SOURCE_LIMIT_EXCEEDED");
  for (const source of value.sources) validateSourceContract(source);
  sortedUnique(value.sources.map((source) => source.id), "SOURCE_SET_DUPLICATE_SOURCE");
  if (computeSourceSetDigest(value as unknown as RecoverySourceSetContract) !== value.sourceSetDigest) refuse("SOURCE_SET_DIGEST_MISMATCH");
}

type LegacyInventoryFileMetadata = Pick<LegacyTrackedFile, "path" | "digest" | "bytes" | "roles">;

function pathClass(file: LegacyInventoryFileMetadata): string {
  const roles = new Set(file.roles);
  if (roles.has("test-obligation")) return "test";
  if (roles.has("semantic-document")) return "semantic-document";
  if (/\.schema\.json$/u.test(file.path) || /(?:^|\/)schemas?\//u.test(file.path)) return "schema";
  if (/(?:^|\/)(?:registr(?:y|ies)|taxonom(?:y|ies)|vocabular(?:y|ies))(?:\/|\.)/u.test(file.path)) return "registry";
  if (/\.(?:nq|nt|ttl|rdf|owl|jsonld)$/u.test(file.path)) return "rdf";
  if (/(?:^|\/)(?:test|tests|spec)(?:\/|\.)/u.test(file.path)) return "test";
  if (/\.(?:md|adoc|rst)$/u.test(file.path)) return "document";
  if (/\.(?:json|ya?ml|toml|env)$/u.test(file.path)) return "configuration";
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|sh)$/u.test(file.path)) return "source";
  if (/(?:^|\/)(?:reports?|evidence|proofs?)(?:\/|\.)/u.test(file.path)) return "report";
  if (/(?:^|\/)(?:data|migrations?)(?:\/|\.)/u.test(file.path)) return "data";
  return "other";
}

function candidate(
  sourceSetDigest: string,
  source: RecoverySourceContract,
  selectedId: string,
  kind: RecoveryCandidateKind,
  key: string,
  discriminator: string,
  evidenceLocation: string,
  sourceDigest: string,
  candidatePathClass: string,
  graphIri: string | null = null,
  typeIris: readonly string[] = [],
  predicate: string | null = null,
): RecoveryCandidate {
  const identity: RecoveryCandidateIdentity = {
    sourceSetDigest,
    logicalSourceId: source.id,
    pinnedSourceRevision: source.revision,
    selectedFileGraphOrRegistryId: selectedId,
    candidateKind: kind,
    candidateIriPathOrRegistryKey: key,
    discriminator,
  };
  return {
    candidateId: canonicalDigest(identity),
    identity,
    evidenceLocation,
    sourceDigest,
    pathClass: candidatePathClass,
    graphIri,
    typeIris: [...typeIris].sort(compareText),
    predicate,
  };
}

function addCandidate(target: Map<string, RecoveryCandidate>, value: RecoveryCandidate, limit: number): void {
  const prior = target.get(value.candidateId);
  if (prior) {
    if (canonicalDigest(prior) !== canonicalDigest(value)) refuse("RECOVERY_CANDIDATE_IDENTITY_COLLISION", { candidateId: value.candidateId });
    return;
  }
  if (target.size >= limit) refuse("RECOVERY_CANDIDATE_LIMIT_EXCEEDED");
  target.set(value.candidateId, value);
}

/**
 * Compile one module-authenticated exact-byte extraction result into a bounded
 * metadata inventory. This function never opens historical paths and retains
 * no source payload bytes.
 */
export function createLegacyGraphInventory(
  sourceSetValue: RecoverySourceSetContract,
  extractionResultValue: LegacyExtractionResult,
  limitOverrides: Partial<RecoveryLimits> = {},
): LegacyGraphInventory {
  const limits = checkedLimits(limitOverrides);
  const checkDeadline = recoveryDeadline(limits);
  validateSourceSet(sourceSetValue, limits);
  const extractionResult = verifyLegacyExtractionResult(extractionResultValue, {
    sourceSetDigest: sourceSetValue.sourceSetDigest,
    sources: sourceSetValue.sources.map((source) => ({
      id: source.id,
      revision: source.revision,
      tree: source.tree,
      trackedFileCount: source.selection.trackedFileCount,
      trackedByteCount: source.selection.trackedByteCount,
      ...(source.graphManifest ? { graphManifest: { path: source.graphManifest.path, digest: source.graphManifest.digest } } : {}),
    })),
  });

  const closureById = new Map<string, LegacySourceClosure>();
  for (const rawSource of extractionResult.sources) {
    if (!isRecord(rawSource) || !exactKeys(rawSource, ["id", "revision", "tree", "trackedFiles", "manifestRoots", "manifests", "registries", "extraction"]) || !Array.isArray(rawSource.trackedFiles) || !Array.isArray(rawSource.manifestRoots) || !Array.isArray(rawSource.manifests) || !Array.isArray(rawSource.registries) || !isRecord(rawSource.extraction)) refuse("LEGACY_SOURCE_CLOSURE_INVALID");
    assertIri(rawSource.id, "LEGACY_SOURCE_CLOSURE_INVALID");
    if (closureById.has(rawSource.id)) refuse("LEGACY_CLOSURE_DUPLICATE_SOURCE");
    closureById.set(rawSource.id, rawSource as unknown as LegacySourceClosure);
  }

  const trackedFiles: LegacyInventoryTrackedFile[] = [];
  const graphSelections: LegacyInventoryGraphSelection[] = [];
  const semanticRecords: LegacyInventorySemanticRecord[] = [];
  const structuredRecords: LegacyInventoryStructuredRecord[] = [];
  const candidates = new Map<string, RecoveryCandidate>();
  const sourceCandidateCounts = new Map<string, number>();
  let totalTrackedBytes = 0;
  let totalManifests = 0;
  let totalManifestImports = 0;
  let totalManifestEntries = 0;
  let totalQuads = 0;
  let totalRegistries = 0;
  let totalRegistryRecords = 0;

  for (const source of sourceSetValue.sources) {
    checkDeadline();
    const closure = closureById.get(source.id);
    if (!closure) refuse("LEGACY_CLOSURE_SOURCE_MISSING", { sourceId: source.id });
    if (closure.revision !== source.revision || closure.tree !== source.tree) refuse("LEGACY_CLOSURE_SOURCE_IDENTITY_MISMATCH", { sourceId: source.id });
    const extraction = closure.extraction;
    if (!exactKeys(extraction as unknown as Record<string, unknown>, ["schema", "status", "extractorDigest", "sourceSetDigest", "sourceId", "revision", "tree", "gitVerification", "observationsDigest", "counts", "receiptDigest"]) || extraction.schema !== "urn:usf:legacy-extraction-receipt:1" || extraction.status !== "independently-extracted" || !isRecord(extraction.gitVerification) || !isRecord(extraction.counts)) refuse("LEGACY_EXTRACTION_RECEIPT_INVALID");
    if (!exactKeys(extraction.gitVerification as unknown as Record<string, unknown>, ["objectFormat", "pathEncoding", "blobMethod", "treeMethod", "commitMethod", "commitBytes", "commitContentDigest", "commitObjectOid", "treeEntriesDigest", "treeObjectOid"])
      || extraction.gitVerification.objectFormat !== "sha1"
      || extraction.gitVerification.pathEncoding !== "utf-8"
      || extraction.gitVerification.blobMethod !== "git-blob-object-sha1"
      || extraction.gitVerification.treeMethod !== "recursive-git-tree-object-sha1"
      || extraction.gitVerification.commitMethod !== "git-commit-object-sha1-with-unique-tree-header") refuse("LEGACY_EXTRACTION_RECEIPT_INVALID");
    assertCount(extraction.gitVerification.commitBytes, "LEGACY_EXTRACTION_RECEIPT_INVALID");
    for (const digest of [extraction.gitVerification.commitContentDigest, extraction.gitVerification.treeEntriesDigest]) assertDigest(digest, "LEGACY_EXTRACTION_RECEIPT_INVALID");
    for (const oid of [extraction.gitVerification.commitObjectOid, extraction.gitVerification.treeObjectOid]) if (!revisionPattern.test(oid)) refuse("LEGACY_EXTRACTION_RECEIPT_INVALID");
    if (extraction.gitVerification.commitObjectOid !== source.revision || extraction.gitVerification.treeObjectOid !== source.tree) refuse("LEGACY_EXTRACTION_SOURCE_BINDING_MISMATCH");
    for (const digest of [extraction.extractorDigest, extraction.sourceSetDigest, extraction.observationsDigest, extraction.receiptDigest]) assertDigest(digest, "LEGACY_EXTRACTION_RECEIPT_INVALID");
    if (extraction.sourceSetDigest !== sourceSetValue.sourceSetDigest || extraction.sourceId !== source.id || extraction.revision !== source.revision || extraction.tree !== source.tree) refuse("LEGACY_EXTRACTION_SOURCE_BINDING_MISMATCH");
    if (extraction.extractorDigest !== legacyExtractorDigest || extraction.extractorDigest !== extractionResult.extractorDigest || computeExtractionReceiptDigest(extraction) !== extraction.receiptDigest) refuse("LEGACY_EXTRACTION_DIGEST_MISMATCH");
    if (!exactKeys(extraction.counts as unknown as Record<string, unknown>, ["trackedFiles", "trackedBytes", "manifests", "manifestEntries", "quads", "registries", "registryRecords", "roleAssertions", "parserNodes"])) refuse("LEGACY_EXTRACTION_RECEIPT_INVALID");
    for (const count of [extraction.counts.trackedFiles, extraction.counts.trackedBytes, extraction.counts.manifests, extraction.counts.manifestEntries, extraction.counts.quads, extraction.counts.registries, extraction.counts.registryRecords, extraction.counts.roleAssertions, extraction.counts.parserNodes]) assertCount(count, "LEGACY_EXTRACTION_RECEIPT_INVALID");
    const observedCounts = {
      trackedFiles: closure.trackedFiles.length,
      trackedBytes: closure.trackedFiles.reduce((sum, file) => sum + file.bytes, 0),
      manifests: closure.manifests.length,
      manifestEntries: closure.manifests.reduce((sum, manifest) => sum + manifest.entries.length, 0),
      quads: closure.trackedFiles.reduce((sum, file) => sum + file.parserOutcomes.reduce((outcomeSum, outcome) => outcomeSum + ((outcome.format === "turtle" || outcome.format === "trig") ? outcome.quadCount : 0), 0), 0),
      registries: closure.registries.length,
      registryRecords: closure.registries.reduce((sum, registry) => sum + registry.records.length, 0),
      roleAssertions: closure.trackedFiles.reduce((sum, file) => sum + file.roles.length, 0),
    };
    for (const [key, count] of Object.entries(observedCounts)) if (extraction.counts[key as keyof typeof observedCounts] !== count) refuse("LEGACY_EXTRACTION_COUNT_MISMATCH", { sourceId: source.id, count: key });
    if (closure.trackedFiles.length !== source.selection.trackedFileCount) refuse("LEGACY_TRACKED_FILE_COUNT_MISMATCH", { sourceId: source.id });
    if (trackedFiles.length + closure.trackedFiles.length > limits.maxTrackedFiles) refuse("LEGACY_TRACKED_FILE_LIMIT_EXCEEDED", { sourceId: source.id });

    const files = new Map<string, LegacyInventoryFileMetadata>();
    let sourceBytes = 0;
    for (const rawFile of closure.trackedFiles) {
      checkDeadline();
      if (!isRecord(rawFile) || !exactKeys(rawFile, ["path", "mode", "blobOid", "digest", "bytes", "roles", "parserOutcomes"]) || !Array.isArray(rawFile.roles) || !Array.isArray(rawFile.parserOutcomes)) refuse("LEGACY_TRACKED_FILE_INVALID");
      assertRelativePath(rawFile.path, "LEGACY_PATH_ESCAPE");
      if (!["100644", "100755", "120000"].includes(String(rawFile.mode)) || typeof rawFile.blobOid !== "string" || !revisionPattern.test(rawFile.blobOid)) refuse("LEGACY_TRACKED_FILE_INVALID");
      assertDigest(rawFile.digest, "LEGACY_TRACKED_FILE_INVALID");
      assertCount(rawFile.bytes, "LEGACY_TRACKED_FILE_INVALID");
      if (rawFile.roles.length > limits.maxRolesPerFile) refuse("LEGACY_TRACKED_FILE_ROLE_LIMIT_EXCEEDED");
      const roles = rawFile.roles.map((role) => { assertNonEmpty(role, "LEGACY_TRACKED_FILE_INVALID"); return role; });
      sortedUnique(roles, "LEGACY_TRACKED_FILE_ROLE_DUPLICATE");
      if (files.has(rawFile.path)) refuse("LEGACY_TRACKED_FILE_DUPLICATE", { sourceId: source.id, path: rawFile.path });
      const file: LegacyInventoryFileMetadata = { path: rawFile.path, digest: rawFile.digest, bytes: rawFile.bytes, roles: [...roles].sort(compareText) };
      files.set(file.path, file);
      sourceBytes += file.bytes;
      if (!Number.isSafeInteger(sourceBytes) || sourceBytes > source.selection.trackedByteCount || totalTrackedBytes + sourceBytes > limits.maxTrackedBytes) refuse("LEGACY_TRACKED_BYTE_LIMIT_EXCEEDED");
      trackedFiles.push({ sourceId: source.id, mode: rawFile.mode, blobOid: rawFile.blobOid, ...file, parserOutcomes: structuredClone(rawFile.parserOutcomes) });
      const fileClass = pathClass(file);
      addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, file.path, "tracked-source-artifact", file.path, "tracked", file.path, file.digest, fileClass), limits.maxCandidates);
      if (file.roles.includes("test-obligation")) addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, file.path, "test-obligation", file.path, "file-role", file.path, file.digest, "test"), limits.maxCandidates);
      if (file.roles.includes("semantic-document")) addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, file.path, "semantic-document", file.path, "file-role", file.path, file.digest, "semantic-document"), limits.maxCandidates);
    }
    if (sourceBytes !== source.selection.trackedByteCount) refuse("LEGACY_TRACKED_BYTE_COUNT_MISMATCH", { sourceId: source.id, expected: source.selection.trackedByteCount, actual: sourceBytes });
    totalTrackedBytes += sourceBytes;

    const manifests = new Map<string, LegacyManifest>();
    totalManifests += closure.manifests.length;
    if (totalManifests > limits.maxManifests) refuse("LEGACY_MANIFEST_LIMIT_EXCEEDED");
    for (const rawManifest of closure.manifests) {
      checkDeadline();
      if (!isRecord(rawManifest) || !exactKeys(rawManifest, ["path", "digest", "imports", "declaredEntryCount", "entries"]) || !Array.isArray(rawManifest.imports) || !Array.isArray(rawManifest.entries)) refuse("LEGACY_MANIFEST_INVALID");
      assertRelativePath(rawManifest.path, "LEGACY_PATH_ESCAPE");
      assertDigest(rawManifest.digest, "LEGACY_MANIFEST_INVALID");
      assertCount(rawManifest.declaredEntryCount, "LEGACY_MANIFEST_INVALID");
      totalManifestImports += rawManifest.imports.length;
      if (totalManifestImports > limits.maxManifestImports) refuse("LEGACY_MANIFEST_IMPORT_LIMIT_EXCEEDED");
      if (rawManifest.declaredEntryCount !== rawManifest.entries.length) refuse("LEGACY_MANIFEST_ENTRY_COUNT_MISMATCH", { path: rawManifest.path });
      const manifestFile = files.get(rawManifest.path);
      if (!manifestFile || manifestFile.digest !== rawManifest.digest) refuse("LEGACY_MANIFEST_TRACKED_PARITY_GAP", { path: rawManifest.path });
      if (manifests.has(rawManifest.path)) refuse("LEGACY_MANIFEST_DUPLICATE", { path: rawManifest.path });
      manifests.set(rawManifest.path, rawManifest as unknown as LegacyManifest);
    }

    const roots = closure.manifestRoots.map((root) => { assertRelativePath(root, "LEGACY_PATH_ESCAPE"); return root; });
    sortedUnique(roots, "LEGACY_MANIFEST_ROOT_DUPLICATE");
    if (source.graphManifest) {
      if (!roots.includes(source.graphManifest.path)) refuse("LEGACY_MANIFEST_ROOT_MISSING", { sourceId: source.id });
      const configured = manifests.get(source.graphManifest.path);
      if (!configured || configured.digest !== source.graphManifest.digest) refuse("LEGACY_MANIFEST_DIGEST_MISMATCH", { sourceId: source.id });
    }
    if (manifests.size > 0 && roots.length === 0) refuse("LEGACY_MANIFEST_ROOT_MISSING", { sourceId: source.id });

    const reached = new Set<string>();
    const active = new Set<string>();
    const visit = (manifestPath: string, depth: number): void => {
      checkDeadline();
      if (depth > limits.maxManifestDepth) refuse("LEGACY_MANIFEST_DEPTH_EXCEEDED");
      if (active.has(manifestPath)) refuse("LEGACY_MANIFEST_CYCLE", { path: manifestPath });
      if (reached.has(manifestPath)) return;
      const manifest = manifests.get(manifestPath);
      if (!manifest) refuse("LEGACY_MANIFEST_IMPORT_MISSING", { path: manifestPath });
      active.add(manifestPath);
      for (const imported of manifest.imports) {
        assertRelativePath(imported, "LEGACY_PATH_ESCAPE");
        visit(imported, depth + 1);
      }
      active.delete(manifestPath);
      reached.add(manifestPath);
    };
    for (const root of roots) visit(root, 1);
    if (reached.size !== manifests.size) refuse("LEGACY_MANIFEST_UNREACHABLE", { sourceId: source.id });

    const currentPaths = new Set<string>();
    const inactivePaths = new Set<string>();
    const currentGraphs = new Set<string>();
    const retiredGraphs = new Set<string>();
    const canonicalEntries = new Set<string>();
    for (const manifestPath of [...reached].sort(compareText)) {
      const manifest = manifests.get(manifestPath) as LegacyManifest;
      const ids = new Set<string>();
      for (const rawEntry of manifest.entries) {
        checkDeadline();
        if (!isRecord(rawEntry) || typeof rawEntry.kind !== "string") refuse("LEGACY_MANIFEST_ENTRY_INVALID");
        assertNonEmpty(rawEntry.id, "LEGACY_MANIFEST_ENTRY_INVALID");
        if (ids.has(rawEntry.id)) refuse("LEGACY_MANIFEST_ENTRY_ID_DUPLICATE", { manifestPath, id: rawEntry.id });
        ids.add(rawEntry.id);
        const { id: _entryId, ...entryIdentity } = rawEntry;
        const entryIdentityDigest = canonicalDigest(entryIdentity);
        if (canonicalEntries.has(entryIdentityDigest)) refuse("LEGACY_MANIFEST_DUPLICATE_ENTRY", { manifestPath });
        canonicalEntries.add(entryIdentityDigest);
        totalManifestEntries += 1;
        if (totalManifestEntries > limits.maxManifestEntries) refuse("LEGACY_MANIFEST_ENTRY_LIMIT_EXCEEDED");

        const selectionId = `${manifest.path}#${rawEntry.id}`;
        let selection: LegacyInventoryGraphSelection;
        let selectionKey: string;
        let selectionDigest: string;
        let selectionPathClass = "other";
        let rdfEntry: LegacyRdfManifestEntry | null = null;
        const entry = rawEntry as unknown as LegacyManifestEntry;
        if (["definition-graph", "authored-graph", "observed-graph", "shape-graph", "derived-graph"].includes(entry.kind)) {
          rdfEntry = entry as LegacyRdfManifestEntry;
          assertRelativePath(rdfEntry.path, "LEGACY_PATH_ESCAPE");
          assertDigest(rdfEntry.digest, "LEGACY_MANIFEST_ENTRY_INVALID");
          assertIri(rdfEntry.graphIri, "LEGACY_MANIFEST_ENTRY_INVALID");
          assertCount(rdfEntry.loadOrder, "LEGACY_MANIFEST_ENTRY_INVALID");
          assertCount(rdfEntry.validationOrder, "LEGACY_MANIFEST_ENTRY_INVALID");
          if (!Array.isArray(rdfEntry.quads) || !Array.isArray(rdfEntry.resourceDefinitions) || !Array.isArray(rdfEntry.blankNodeComponents)) refuse("LEGACY_MANIFEST_ENTRY_INVALID");
          const entryFile = files.get(rdfEntry.path);
          if (!entryFile || entryFile.digest !== rdfEntry.digest) refuse("LEGACY_MANIFEST_TRACKED_PARITY_GAP", { path: rdfEntry.path });
          if (retiredGraphs.has(rdfEntry.graphIri) || inactivePaths.has(rdfEntry.path)) refuse("LEGACY_MANIFEST_RETIRED_CURRENT_OVERLAP", { path: rdfEntry.path, graphIri: rdfEntry.graphIri });
          currentGraphs.add(rdfEntry.graphIri);
          currentPaths.add(rdfEntry.path);
          selection = { sourceId: source.id, manifestPath: manifest.path, entryId: entry.id, kind: rdfEntry.kind, filePath: rdfEntry.path, digest: rdfEntry.digest, graphIri: rdfEntry.graphIri, loadOrder: rdfEntry.loadOrder, validationOrder: rdfEntry.validationOrder, role: rdfEntry.role, section: rdfEntry.section, outputGraphIri: null, classification: rdfEntry.classification };
          selectionKey = rdfEntry.graphIri;
          selectionDigest = rdfEntry.digest;
          selectionPathClass = "rdf";
        } else if (entry.kind === "rule") {
          assertRelativePath(entry.path, "LEGACY_PATH_ESCAPE");
          assertDigest(entry.digest, "LEGACY_MANIFEST_ENTRY_INVALID");
          if (entry.outputGraphIri !== null) assertIri(entry.outputGraphIri, "LEGACY_MANIFEST_ENTRY_INVALID");
          const entryFile = files.get(entry.path);
          if (!entryFile || entryFile.digest !== entry.digest) refuse("LEGACY_MANIFEST_TRACKED_PARITY_GAP", { path: entry.path });
          if (inactivePaths.has(entry.path) || (entry.outputGraphIri !== null && retiredGraphs.has(entry.outputGraphIri))) refuse("LEGACY_MANIFEST_RETIRED_CURRENT_OVERLAP", { path: entry.path, graphIri: entry.outputGraphIri });
          currentPaths.add(entry.path);
          if (entry.outputGraphIri !== null) currentGraphs.add(entry.outputGraphIri);
          selection = { sourceId: source.id, manifestPath: manifest.path, entryId: entry.id, kind: entry.kind, filePath: entry.path, digest: entry.digest, graphIri: entry.outputGraphIri, loadOrder: null, validationOrder: null, role: entry.role, section: entry.section, outputGraphIri: entry.outputGraphIri, classification: entry.classification };
          selectionKey = entry.outputGraphIri ?? entry.path;
          selectionDigest = entry.digest;
          selectionPathClass = "source";
        } else if (entry.kind === "retired-graph") {
          assertIri(entry.graphIri, "LEGACY_MANIFEST_ENTRY_INVALID");
          assertIri(entry.supersededByIri, "LEGACY_MANIFEST_ENTRY_INVALID");
          if (currentGraphs.has(entry.graphIri)) refuse("LEGACY_MANIFEST_RETIRED_CURRENT_OVERLAP", { graphIri: entry.graphIri });
          retiredGraphs.add(entry.graphIri);
          selection = { sourceId: source.id, manifestPath: manifest.path, entryId: entry.id, kind: entry.kind, filePath: null, digest: manifest.digest, graphIri: entry.graphIri, loadOrder: null, validationOrder: null, role: entry.role, section: entry.section, outputGraphIri: null, classification: entry.classification };
          selectionKey = entry.graphIri;
          selectionDigest = manifest.digest;
          selectionPathClass = "rdf";
        } else if (entry.kind === "inactive-source") {
          assertRelativePath(entry.path, "LEGACY_PATH_ESCAPE");
          assertDigest(entry.digest, "LEGACY_MANIFEST_ENTRY_INVALID");
          assertNonEmpty(entry.disposition, "LEGACY_MANIFEST_ENTRY_INVALID");
          const entryFile = files.get(entry.path);
          if (!entryFile || entryFile.digest !== entry.digest) refuse("LEGACY_MANIFEST_TRACKED_PARITY_GAP", { path: entry.path });
          if (currentPaths.has(entry.path)) refuse("LEGACY_MANIFEST_RETIRED_CURRENT_OVERLAP", { path: entry.path });
          inactivePaths.add(entry.path);
          selection = { sourceId: source.id, manifestPath: manifest.path, entryId: entry.id, kind: entry.kind, filePath: entry.path, digest: entry.digest, graphIri: null, loadOrder: null, validationOrder: null, role: entry.role, section: entry.section, outputGraphIri: null, classification: entry.classification };
          selectionKey = entry.path;
          selectionDigest = entry.digest;
        } else if (entry.kind === "fixture-root") {
          assertRelativePath(entry.path, "LEGACY_PATH_ESCAPE");
          assertCount(entry.declaredFileCount, "LEGACY_MANIFEST_ENTRY_INVALID");
          assertDigest(entry.fixtureDigest, "LEGACY_MANIFEST_ENTRY_INVALID");
          const observed = [...files.keys()].filter((path) => path === entry.path || path.startsWith(`${entry.path}/`)).length;
          if (observed !== entry.declaredFileCount) refuse("LEGACY_FIXTURE_FILE_COUNT_MISMATCH", { path: entry.path, expected: entry.declaredFileCount, actual: observed });
          selection = { sourceId: source.id, manifestPath: manifest.path, entryId: entry.id, kind: entry.kind, filePath: entry.path, digest: entry.fixtureDigest, graphIri: null, loadOrder: null, validationOrder: null, role: entry.role, section: entry.section, outputGraphIri: null, classification: entry.classification };
          selectionKey = entry.path;
          selectionDigest = entry.fixtureDigest;
          selectionPathClass = "test";
        } else refuse("LEGACY_MANIFEST_ENTRY_KIND_UNSUPPORTED");

        graphSelections.push(selection);
        addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, selectionId, "graph-selection", selectionKey, `${selection.kind}:${selection.classification}`, `${manifest.path}#${rawEntry.id}`, selectionDigest, selectionPathClass, selection.graphIri), limits.maxCandidates);

        if (rdfEntry === null) continue;

        const quadKeys = new Set<string>();
        const typesBySubject = new Map<string, Set<string>>();
        for (const rawQuad of rdfEntry.quads) {
          checkDeadline();
          if (!isRecord(rawQuad) || !exactKeys(rawQuad, ["subject", "subjectKind", "predicate", "object", "objectKind", "graph", "graphKind", "statementDigest"])) refuse("LEGACY_QUAD_INVALID");
          const quad = rawQuad as unknown as LegacyQuadObservation;
          if (quad.subjectKind === "iri") assertIri(quad.subject, "LEGACY_QUAD_INVALID"); else if (quad.subjectKind !== "blank-node") refuse("LEGACY_QUAD_INVALID");
          assertIri(quad.predicate, "LEGACY_QUAD_INVALID");
          if (quad.objectKind === "iri") assertIri(quad.object, "LEGACY_QUAD_INVALID"); else if (quad.objectKind !== "blank-node" && quad.objectKind !== "literal-digest") refuse("LEGACY_QUAD_INVALID");
          assertDigest(quad.statementDigest, "LEGACY_QUAD_INVALID");
          const quadKey = quad.statementDigest;
          if (quadKeys.has(quadKey)) refuse("LEGACY_QUAD_DUPLICATE", { selectionId });
          quadKeys.add(quadKey);
          totalQuads += 1;
          if (totalQuads > limits.maxQuads) refuse("LEGACY_QUAD_LIMIT_EXCEEDED");
          if ((quad.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" || quad.predicate === "urn:usf:predicate:type") && quad.objectKind === "iri") {
            const types = typesBySubject.get(quad.subject) ?? new Set<string>();
            types.add(quad.object);
            typesBySubject.set(quad.subject, types);
          }
          semanticRecords.push({
            sourceId: source.id,
            selectionId,
            filePath: rdfEntry.path,
            sourceDigest: rdfEntry.digest,
            graphIri: rdfEntry.graphIri,
            subject: quad.subject,
            subjectKind: quad.subjectKind,
            predicate: quad.predicate,
            object: quad.object,
            objectKind: quad.objectKind,
            graph: quad.graph,
            graphKind: quad.graphKind,
            statementDigest: quad.statementDigest,
          });
        }
        for (const definition of rdfEntry.resourceDefinitions) {
          assertIri(definition.iri, "LEGACY_RESOURCE_DEFINITION_INVALID");
          assertCount(definition.quadCount, "LEGACY_RESOURCE_DEFINITION_INVALID");
          assertDigest(definition.definitionDigest, "LEGACY_RESOURCE_DEFINITION_INVALID");
          const subjectTypes = [...(typesBySubject.get(definition.iri) ?? [])];
          if (subjectTypes.length > limits.maxTypesPerCandidate) refuse("RECOVERY_CANDIDATE_TYPE_LIMIT_EXCEEDED");
          addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, selectionId, "named-semantic-resource", definition.iri, `definition:${definition.definitionDigest}`, `${rdfEntry.path}#${definition.iri}`, rdfEntry.digest, "rdf", rdfEntry.graphIri, subjectTypes), limits.maxCandidates);
        }
        for (const component of rdfEntry.blankNodeComponents) {
          assertDigest(component.componentId, "LEGACY_BLANK_NODE_COMPONENT_INVALID");
          assertDigest(component.componentDigest, "LEGACY_BLANK_NODE_COMPONENT_INVALID");
          assertCount(component.quadCount, "LEGACY_BLANK_NODE_COMPONENT_INVALID");
          addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, selectionId, "named-semantic-resource", component.componentId, `blank-node-component:${component.componentDigest}`, `${rdfEntry.path}#${component.componentId}`, rdfEntry.digest, "rdf", rdfEntry.graphIri), limits.maxCandidates);
        }
        for (const quad of rdfEntry.quads) {
          if ((quad.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" || quad.predicate === "urn:usf:predicate:type") && quad.objectKind === "iri") {
            addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, selectionId, "rdf-type-assertion", quad.subject, quad.object, `${rdfEntry.path}#${quad.subject}`, rdfEntry.digest, "rdf", rdfEntry.graphIri, [quad.object], quad.predicate), limits.maxCandidates);
          }
          addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, selectionId, "predicate-vocabulary", quad.predicate, "predicate", `${rdfEntry.path}#${quad.predicate}`, rdfEntry.digest, "rdf", rdfEntry.graphIri, [], quad.predicate), limits.maxCandidates);
          if (quad.objectKind === "iri") addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, selectionId, "referenced-iri", quad.object, quad.predicate, `${rdfEntry.path}#${quad.object}`, rdfEntry.digest, "rdf", rdfEntry.graphIri, [], quad.predicate), limits.maxCandidates);
        }
      }
    }

    totalRegistries += closure.registries.length;
    if (totalRegistries > limits.maxRegistries) refuse("LEGACY_REGISTRY_LIMIT_EXCEEDED");
    const registryIds = new Set<string>();
    const registryPaths = new Set<string>();
    for (const rawRegistry of closure.registries) {
      checkDeadline();
      if (!isRecord(rawRegistry) || !exactKeys(rawRegistry, ["id", "path", "digest", "format", "declaredRecordCount", "records"]) || !Array.isArray(rawRegistry.records) || !["yaml-1.2", "json"].includes(String(rawRegistry.format))) refuse("LEGACY_REGISTRY_INVALID");
      assertNonEmpty(rawRegistry.id, "LEGACY_REGISTRY_INVALID");
      assertRelativePath(rawRegistry.path, "LEGACY_PATH_ESCAPE");
      assertDigest(rawRegistry.digest, "LEGACY_REGISTRY_INVALID");
      assertCount(rawRegistry.declaredRecordCount, "LEGACY_REGISTRY_INVALID");
      if (registryIds.has(rawRegistry.id) || registryPaths.has(rawRegistry.path)) refuse("LEGACY_REGISTRY_DUPLICATE");
      registryIds.add(rawRegistry.id);
      registryPaths.add(rawRegistry.path);
      const registryFile = files.get(rawRegistry.path);
      if (!registryFile || registryFile.digest !== rawRegistry.digest) refuse("LEGACY_REGISTRY_TRACKED_PARITY_GAP", { path: rawRegistry.path });
      if (rawRegistry.records.length !== rawRegistry.declaredRecordCount) refuse("LEGACY_REGISTRY_RECORD_COUNT_MISMATCH", { registryId: rawRegistry.id });
      const recordKeys = new Set<string>();
      for (const rawRecord of rawRegistry.records) {
        checkDeadline();
        if (!isRecord(rawRecord) || !exactKeys(rawRecord, ["key", "recordKind", "digest"])) refuse("LEGACY_REGISTRY_RECORD_INVALID");
        assertNonEmpty(rawRecord.key, "LEGACY_REGISTRY_RECORD_INVALID");
        assertNonEmpty(rawRecord.recordKind, "LEGACY_REGISTRY_RECORD_INVALID");
        assertDigest(rawRecord.digest, "LEGACY_REGISTRY_RECORD_INVALID");
        if (recordKeys.has(rawRecord.key)) refuse("LEGACY_REGISTRY_RECORD_DUPLICATE", { registryId: rawRegistry.id, key: rawRecord.key });
        recordKeys.add(rawRecord.key);
        totalRegistryRecords += 1;
        if (totalRegistryRecords > limits.maxRegistryRecords) refuse("LEGACY_REGISTRY_RECORD_LIMIT_EXCEEDED");
        structuredRecords.push({ sourceId: source.id, registryId: rawRegistry.id, registryPath: rawRegistry.path, key: rawRecord.key, recordKind: rawRecord.recordKind, digest: rawRecord.digest });
        addCandidate(candidates, candidate(sourceSetValue.sourceSetDigest, source, rawRegistry.id, "structured-schema-or-registry-record", rawRecord.key, rawRecord.recordKind, `${rawRegistry.path}#${rawRecord.key}`, rawRecord.digest, "registry"), limits.maxCandidates);
      }
    }
  }

  const candidateSummaries = new Map<string, { total: number; kinds: Record<RecoveryCandidateKind, number> }>();
  for (const item of candidates.values()) {
    const summary = candidateSummaries.get(item.identity.logicalSourceId) ?? { total: 0, kinds: Object.fromEntries(recoveryCandidateKinds.map((kind) => [kind, 0])) as Record<RecoveryCandidateKind, number> };
    summary.total += 1;
    summary.kinds[item.identity.candidateKind] += 1;
    candidateSummaries.set(item.identity.logicalSourceId, summary);
  }
  for (const source of sourceSetValue.sources) {
    const summary = candidateSummaries.get(source.id) ?? { total: 0, kinds: Object.fromEntries(recoveryCandidateKinds.map((kind) => [kind, 0])) as Record<RecoveryCandidateKind, number> };
    sourceCandidateCounts.set(source.id, summary.total);
  }

  const sortedCandidates = [...candidates.values()].sort((left, right) => compareText(left.candidateId, right.candidateId));
  const inventoryWithoutDigest = {
    schema: "urn:usf:legacy-graph-inventory:1" as const,
    version: 1 as const,
    sourceSetDigest: sourceSetValue.sourceSetDigest,
    sources: sourceSetValue.sources.map((source) => ({
      sourceId: source.id,
      revision: source.revision,
      tree: source.tree,
      sourceContractDigest: canonicalDigest(source),
      licenceStatus: source.licence.status,
      licenceIdentifier: source.licence.identifier ?? null,
      reuseBoundary: source.licence.reuseBoundary,
      extractionReceipt: structuredClone((closureById.get(source.id) as LegacySourceClosure).extraction),
      trackedFileCount: trackedFiles.filter((item) => item.sourceId === source.id).length,
      trackedByteCount: trackedFiles.filter((item) => item.sourceId === source.id).reduce((sum, item) => sum + item.bytes, 0),
      manifestCount: (closureById.get(source.id) as LegacySourceClosure).manifests.length,
      graphSelectionCount: graphSelections.filter((item) => item.sourceId === source.id).length,
      quadObservationCount: (closureById.get(source.id) as LegacySourceClosure).extraction.counts.quads,
      registryCount: (closureById.get(source.id) as LegacySourceClosure).registries.length,
      structuredRecordCount: structuredRecords.filter((item) => item.sourceId === source.id).length,
      roleAssertionCount: trackedFiles.filter((item) => item.sourceId === source.id).reduce((sum, item) => sum + item.roles.length, 0),
      candidateCount: sourceCandidateCounts.get(source.id) ?? 0,
    })).sort((left, right) => compareText(left.sourceId, right.sourceId)),
    trackedFiles: trackedFiles.sort((left, right) => compareText(left.sourceId, right.sourceId) || compareText(left.path, right.path)),
    graphSelections: graphSelections.sort((left, right) => compareText(left.sourceId, right.sourceId) || compareText(left.manifestPath, right.manifestPath) || (left.loadOrder ?? Number.MAX_SAFE_INTEGER) - (right.loadOrder ?? Number.MAX_SAFE_INTEGER) || (left.validationOrder ?? Number.MAX_SAFE_INTEGER) - (right.validationOrder ?? Number.MAX_SAFE_INTEGER) || compareText(left.entryId, right.entryId)),
    semanticRecords: semanticRecords.sort((left, right) => compareText(left.sourceId, right.sourceId) || compareText(left.selectionId, right.selectionId) || compareText(left.statementDigest, right.statementDigest)),
    structuredRecords: structuredRecords.sort((left, right) => compareText(left.sourceId, right.sourceId) || compareText(left.registryId, right.registryId) || compareText(left.key, right.key)),
    candidates: sortedCandidates,
  };
  return deepFreeze({ ...inventoryWithoutDigest, inventoryDigest: computeInventoryDigest(inventoryWithoutDigest) });
}

function candidatesFromInventoryMetadata(
  inventory: LegacyGraphInventory,
  sourceSet: RecoverySourceSetContract,
  limits: RecoveryLimits,
  checkDeadline: () => void,
): Map<string, RecoveryCandidate> {
  const expected = new Map<string, RecoveryCandidate>();
  const sources = new Map(sourceSet.sources.map((source) => [source.id, source]));
  for (const file of inventory.trackedFiles) {
    checkDeadline();
    const source = sources.get(file.sourceId) as RecoverySourceContract;
    const fileClass = pathClass(file);
    addCandidate(expected, candidate(inventory.sourceSetDigest, source, file.path, "tracked-source-artifact", file.path, "tracked", file.path, file.digest, fileClass), limits.maxCandidates);
    if (file.roles.includes("test-obligation")) addCandidate(expected, candidate(inventory.sourceSetDigest, source, file.path, "test-obligation", file.path, "file-role", file.path, file.digest, "test"), limits.maxCandidates);
    if (file.roles.includes("semantic-document")) addCandidate(expected, candidate(inventory.sourceSetDigest, source, file.path, "semantic-document", file.path, "file-role", file.path, file.digest, "semantic-document"), limits.maxCandidates);
  }
  for (const selection of inventory.graphSelections) {
    checkDeadline();
    const source = sources.get(selection.sourceId) as RecoverySourceContract;
    const selectionId = `${selection.manifestPath}#${selection.entryId}`;
    let key: string;
    let selectedPathClass = "other";
    if (["definition-graph", "authored-graph", "observed-graph", "shape-graph", "derived-graph", "retired-graph"].includes(selection.kind)) {
      key = selection.graphIri as string;
      selectedPathClass = "rdf";
    } else if (selection.kind === "rule") {
      key = selection.outputGraphIri ?? (selection.filePath as string);
      selectedPathClass = "source";
    } else {
      key = selection.filePath as string;
      if (selection.kind === "fixture-root") selectedPathClass = "test";
    }
    addCandidate(expected, candidate(inventory.sourceSetDigest, source, selectionId, "graph-selection", key, `${selection.kind}:${selection.classification}`, selectionId, selection.digest, selectedPathClass, selection.graphIri), limits.maxCandidates);
  }
  for (const record of inventory.structuredRecords) {
    checkDeadline();
    const source = sources.get(record.sourceId) as RecoverySourceContract;
    addCandidate(expected, candidate(inventory.sourceSetDigest, source, record.registryId, "structured-schema-or-registry-record", record.key, record.recordKind, `${record.registryPath}#${record.key}`, record.digest, "registry"), limits.maxCandidates);
  }

  const semanticGroups = new Map<string, LegacyInventorySemanticRecord[]>();
  for (const record of inventory.semanticRecords) {
    checkDeadline();
    const groupKey = `${record.sourceId}|${record.selectionId}`;
    const group = semanticGroups.get(groupKey) ?? [];
    group.push(record);
    semanticGroups.set(groupKey, group);
  }
  for (const records of semanticGroups.values()) {
    checkDeadline();
    const first = records[0] as LegacyInventorySemanticRecord;
    const source = sources.get(first.sourceId) as RecoverySourceContract;
    const typesBySubject = new Map<string, Set<string>>();
    const definitionStatements = new Map<string, string[]>();
    const blankParents = new Map<string, string>();
    const componentStatements = new Map<string, Set<string>>();
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

    for (const record of records) {
      checkDeadline();
      if (record.subjectKind === "iri") {
        const statements = definitionStatements.get(record.subject) ?? [];
        statements.push(record.statementDigest);
        definitionStatements.set(record.subject, statements);
      }
      if ((record.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" || record.predicate === "urn:usf:predicate:type") && record.objectKind === "iri") {
        const types = typesBySubject.get(record.subject) ?? new Set<string>();
        types.add(record.object);
        typesBySubject.set(record.subject, types);
      }
      const blanks = [record.subjectKind === "blank-node" ? record.subject : null, record.objectKind === "blank-node" ? record.object : null, record.graphKind === "blank-node" ? record.graph : null].filter((value): value is string => value !== null);
      for (const blank of blanks) find(blank);
      for (let index = 1; index < blanks.length; index += 1) union(blanks[0] as string, blanks[index] as string);
    }
    for (const record of records) {
      checkDeadline();
      const blanks = [record.subjectKind === "blank-node" ? record.subject : null, record.objectKind === "blank-node" ? record.object : null, record.graphKind === "blank-node" ? record.graph : null].filter((value): value is string => value !== null);
      if (blanks.length === 0) continue;
      const root = find(blanks[0] as string);
      const statements = componentStatements.get(root) ?? new Set<string>();
      statements.add(record.statementDigest);
      componentStatements.set(root, statements);
    }
    for (const [iri, statements] of definitionStatements) {
      checkDeadline();
      const definitionDigest = canonicalDigest([...statements].sort(compareText));
      const subjectTypes = [...(typesBySubject.get(iri) ?? [])];
      if (subjectTypes.length > limits.maxTypesPerCandidate) refuse("RECOVERY_CANDIDATE_TYPE_LIMIT_EXCEEDED");
      addCandidate(expected, candidate(inventory.sourceSetDigest, source, first.selectionId, "named-semantic-resource", iri, `definition:${definitionDigest}`, `${first.filePath}#${iri}`, first.sourceDigest, "rdf", first.graphIri, subjectTypes), limits.maxCandidates);
    }
    const componentMembers = new Map<string, Set<string>>();
    for (const blank of blankParents.keys()) {
      const root = find(blank);
      const members = componentMembers.get(root) ?? new Set<string>();
      members.add(blank);
      componentMembers.set(root, members);
    }
    for (const [root, members] of componentMembers) {
      checkDeadline();
      const componentId = canonicalDigest([...members].sort(compareText));
      const componentDigest = canonicalDigest([...(componentStatements.get(root) ?? [])].sort(compareText));
      addCandidate(expected, candidate(inventory.sourceSetDigest, source, first.selectionId, "named-semantic-resource", componentId, `blank-node-component:${componentDigest}`, `${first.filePath}#${componentId}`, first.sourceDigest, "rdf", first.graphIri), limits.maxCandidates);
    }
    for (const record of records) {
      checkDeadline();
      if ((record.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" || record.predicate === "urn:usf:predicate:type") && record.objectKind === "iri") {
        addCandidate(expected, candidate(inventory.sourceSetDigest, source, first.selectionId, "rdf-type-assertion", record.subject, record.object, `${first.filePath}#${record.subject}`, first.sourceDigest, "rdf", first.graphIri, [record.object], record.predicate), limits.maxCandidates);
      }
      addCandidate(expected, candidate(inventory.sourceSetDigest, source, first.selectionId, "predicate-vocabulary", record.predicate, "predicate", `${first.filePath}#${record.predicate}`, first.sourceDigest, "rdf", first.graphIri, [], record.predicate), limits.maxCandidates);
      if (record.objectKind === "iri") addCandidate(expected, candidate(inventory.sourceSetDigest, source, first.selectionId, "referenced-iri", record.object, record.predicate, `${first.filePath}#${record.object}`, first.sourceDigest, "rdf", first.graphIri, [], record.predicate), limits.maxCandidates);
    }
  }
  return expected;
}

function verifyLegacyGraphInventoryWithin(
  inventory: LegacyGraphInventory,
  sourceSet: RecoverySourceSetContract,
  limits: RecoveryLimits,
  checkDeadline: () => void,
): void {
  checkDeadline();
  validateSourceSet(sourceSet, limits);
  if (!isRecord(inventory) || !exactKeys(inventory, ["schema", "version", "sourceSetDigest", "sources", "trackedFiles", "graphSelections", "semanticRecords", "structuredRecords", "candidates", "inventoryDigest"]) || inventory.schema !== "urn:usf:legacy-graph-inventory:1" || inventory.version !== 1) refuse("LEGACY_INVENTORY_INVALID");
  assertDigest(inventory.sourceSetDigest, "LEGACY_INVENTORY_INVALID");
  assertDigest(inventory.inventoryDigest, "LEGACY_INVENTORY_INVALID");
  if (!Array.isArray(inventory.sources) || !Array.isArray(inventory.trackedFiles) || !Array.isArray(inventory.graphSelections) || !Array.isArray(inventory.semanticRecords) || !Array.isArray(inventory.structuredRecords) || !Array.isArray(inventory.candidates)) refuse("LEGACY_INVENTORY_INVALID");
  if (inventory.sourceSetDigest !== sourceSet.sourceSetDigest || inventory.sources.length !== sourceSet.sources.length) refuse("LEGACY_INVENTORY_SOURCE_SET_MISMATCH");
  if (inventory.trackedFiles.length > limits.maxTrackedFiles || inventory.graphSelections.length > limits.maxManifestEntries || inventory.semanticRecords.length > limits.maxQuads || inventory.structuredRecords.length > limits.maxRegistryRecords || inventory.candidates.length > limits.maxCandidates) refuse("LEGACY_INVENTORY_LIMIT_EXCEEDED");
  const allowedSourceIds = new Set(sourceSet.sources.map((source) => source.id));
  const sourceRows = new Map<string, LegacyInventorySource>();
  for (const row of inventory.sources) {
    checkDeadline();
    if (!isRecord(row) || !exactKeys(row, ["sourceId", "revision", "tree", "sourceContractDigest", "licenceStatus", "licenceIdentifier", "reuseBoundary", "extractionReceipt", "trackedFileCount", "trackedByteCount", "manifestCount", "graphSelectionCount", "quadObservationCount", "registryCount", "structuredRecordCount", "roleAssertionCount", "candidateCount"]) || !isRecord(row.extractionReceipt)) refuse("LEGACY_INVENTORY_SOURCE_INVALID");
    assertIri(row.sourceId, "LEGACY_INVENTORY_SOURCE_INVALID");
    if (!allowedSourceIds.has(row.sourceId)) refuse("LEGACY_INVENTORY_SOURCE_UNKNOWN");
    if (typeof row.revision !== "string" || !revisionPattern.test(row.revision) || typeof row.tree !== "string" || !revisionPattern.test(row.tree)) refuse("LEGACY_INVENTORY_SOURCE_INVALID");
    assertDigest(row.sourceContractDigest, "LEGACY_INVENTORY_SOURCE_INVALID");
    if (!["declared", "undetermined", "restricted"].includes(String(row.licenceStatus))) refuse("LEGACY_INVENTORY_SOURCE_INVALID");
    if (row.licenceIdentifier !== null) assertNonEmpty(row.licenceIdentifier, "LEGACY_INVENTORY_SOURCE_INVALID");
    assertNonEmpty(row.reuseBoundary, "LEGACY_INVENTORY_SOURCE_INVALID");
    for (const count of [row.trackedFileCount, row.trackedByteCount, row.manifestCount, row.graphSelectionCount, row.quadObservationCount, row.registryCount, row.structuredRecordCount, row.roleAssertionCount, row.candidateCount]) assertCount(count, "LEGACY_INVENTORY_SOURCE_INVALID");
    const receipt = row.extractionReceipt;
    if (!exactKeys(receipt, ["schema", "status", "extractorDigest", "sourceSetDigest", "sourceId", "revision", "tree", "gitVerification", "observationsDigest", "counts", "receiptDigest"]) || receipt.schema !== "urn:usf:legacy-extraction-receipt:1" || receipt.status !== "independently-extracted" || !isRecord(receipt.gitVerification) || !isRecord(receipt.counts) || !exactKeys(receipt.counts, ["trackedFiles", "trackedBytes", "manifests", "manifestEntries", "quads", "registries", "registryRecords", "roleAssertions", "parserNodes"])) refuse("LEGACY_INVENTORY_SOURCE_INVALID");
    if (!exactKeys(receipt.gitVerification, ["objectFormat", "pathEncoding", "blobMethod", "treeMethod", "commitMethod", "commitBytes", "commitContentDigest", "commitObjectOid", "treeEntriesDigest", "treeObjectOid"])
      || receipt.gitVerification.objectFormat !== "sha1"
      || receipt.gitVerification.pathEncoding !== "utf-8"
      || receipt.gitVerification.blobMethod !== "git-blob-object-sha1"
      || receipt.gitVerification.treeMethod !== "recursive-git-tree-object-sha1"
      || receipt.gitVerification.commitMethod !== "git-commit-object-sha1-with-unique-tree-header") refuse("LEGACY_INVENTORY_SOURCE_INVALID");
    assertCount(receipt.gitVerification.commitBytes, "LEGACY_INVENTORY_SOURCE_INVALID");
    for (const digest of [receipt.gitVerification.commitContentDigest, receipt.gitVerification.treeEntriesDigest]) assertDigest(digest, "LEGACY_INVENTORY_SOURCE_INVALID");
    for (const oid of [receipt.gitVerification.commitObjectOid, receipt.gitVerification.treeObjectOid]) if (typeof oid !== "string" || !revisionPattern.test(oid)) refuse("LEGACY_INVENTORY_SOURCE_INVALID");
    if (receipt.gitVerification.commitObjectOid !== row.revision || receipt.gitVerification.treeObjectOid !== row.tree) refuse("LEGACY_INVENTORY_EXTRACTION_BINDING_MISMATCH");
    for (const digest of [receipt.extractorDigest, receipt.sourceSetDigest, receipt.observationsDigest, receipt.receiptDigest]) assertDigest(digest, "LEGACY_INVENTORY_SOURCE_INVALID");
    if (receipt.extractorDigest !== legacyExtractorDigest) refuse("LEGACY_INVENTORY_EXTRACTOR_PROFILE_MISMATCH");
    assertIri(receipt.sourceId, "LEGACY_INVENTORY_SOURCE_INVALID");
    if (typeof receipt.revision !== "string" || !revisionPattern.test(receipt.revision) || typeof receipt.tree !== "string" || !revisionPattern.test(receipt.tree)) refuse("LEGACY_INVENTORY_SOURCE_INVALID");
    for (const count of [receipt.counts.trackedFiles, receipt.counts.trackedBytes, receipt.counts.manifests, receipt.counts.manifestEntries, receipt.counts.quads, receipt.counts.registries, receipt.counts.registryRecords, receipt.counts.roleAssertions, receipt.counts.parserNodes]) assertCount(count, "LEGACY_INVENTORY_SOURCE_INVALID");
    if (sourceRows.has(row.sourceId)) refuse("LEGACY_INVENTORY_SOURCE_DUPLICATE");
    sourceRows.set(row.sourceId, row as unknown as LegacyInventorySource);
  }
  const trackedKeys = new Set<string>();
  for (const file of inventory.trackedFiles) {
    checkDeadline();
    if (!isRecord(file) || !exactKeys(file, ["sourceId", "path", "mode", "blobOid", "digest", "bytes", "roles", "parserOutcomes"]) || !Array.isArray(file.roles) || !Array.isArray(file.parserOutcomes)) refuse("LEGACY_INVENTORY_TRACKED_INVALID");
    assertIri(file.sourceId, "LEGACY_INVENTORY_TRACKED_INVALID");
    if (!allowedSourceIds.has(file.sourceId)) refuse("LEGACY_INVENTORY_SOURCE_UNKNOWN");
    assertRelativePath(file.path, "LEGACY_INVENTORY_TRACKED_INVALID");
    if (!["100644", "100755", "120000"].includes(String(file.mode)) || typeof file.blobOid !== "string" || !revisionPattern.test(file.blobOid)) refuse("LEGACY_INVENTORY_TRACKED_INVALID");
    assertDigest(file.digest, "LEGACY_INVENTORY_TRACKED_INVALID");
    assertCount(file.bytes, "LEGACY_INVENTORY_TRACKED_INVALID");
    if (file.roles.length > limits.maxRolesPerFile) refuse("LEGACY_INVENTORY_TRACKED_ROLE_LIMIT_EXCEEDED");
    for (const role of file.roles) assertNonEmpty(role, "LEGACY_INVENTORY_TRACKED_INVALID");
    sortedUnique(file.roles, "LEGACY_INVENTORY_TRACKED_ROLE_DUPLICATE");
    for (const outcome of file.parserOutcomes) {
      checkDeadline();
      if (!isRecord(outcome) || !exactKeys(outcome, ["format", "status", "sourceDigest", "semanticDigest", "nodeCount", "recordCount", "quadCount", "operationKind"]) || !["yaml-1.2", "json", "turtle", "trig", "sparql-1.1"].includes(String(outcome.format)) || outcome.status !== "parsed") refuse("LEGACY_INVENTORY_PARSER_OUTCOME_INVALID");
      if (outcome.sourceDigest !== file.digest) refuse("LEGACY_INVENTORY_PARSER_OUTCOME_BINDING_MISMATCH");
      assertDigest(outcome.semanticDigest, "LEGACY_INVENTORY_PARSER_OUTCOME_INVALID");
      for (const count of [outcome.nodeCount, outcome.recordCount, outcome.quadCount]) assertCount(count, "LEGACY_INVENTORY_PARSER_OUTCOME_INVALID");
      if (outcome.operationKind !== null) assertNonEmpty(outcome.operationKind, "LEGACY_INVENTORY_PARSER_OUTCOME_INVALID");
    }
    sortedUnique(file.parserOutcomes.map((outcome) => canonicalDigest(outcome)), "LEGACY_INVENTORY_PARSER_OUTCOME_DUPLICATE");
    const key = `${file.sourceId}|${file.path}`;
    if (trackedKeys.has(key)) refuse("LEGACY_INVENTORY_TRACKED_DUPLICATE");
    trackedKeys.add(key);
  }
  const selectionKeys = new Set<string>();
  for (const selection of inventory.graphSelections) {
    checkDeadline();
    if (!isRecord(selection) || !exactKeys(selection, ["sourceId", "manifestPath", "entryId", "kind", "filePath", "digest", "graphIri", "loadOrder", "validationOrder", "role", "section", "outputGraphIri", "classification"])) refuse("LEGACY_INVENTORY_SELECTION_INVALID");
    assertRelativePath(selection.manifestPath, "LEGACY_INVENTORY_SELECTION_INVALID");
    assertIri(selection.sourceId, "LEGACY_INVENTORY_SELECTION_INVALID");
    if (!allowedSourceIds.has(selection.sourceId)) refuse("LEGACY_INVENTORY_SOURCE_UNKNOWN");
    assertNonEmpty(selection.entryId, "LEGACY_INVENTORY_SELECTION_INVALID");
    assertDigest(selection.digest, "LEGACY_INVENTORY_SELECTION_INVALID");
    if (selection.filePath !== null) assertRelativePath(selection.filePath, "LEGACY_INVENTORY_SELECTION_INVALID");
    if (selection.graphIri !== null) assertIri(selection.graphIri, "LEGACY_INVENTORY_SELECTION_INVALID");
    if (selection.loadOrder !== null) assertCount(selection.loadOrder, "LEGACY_INVENTORY_SELECTION_INVALID");
    if (selection.validationOrder !== null) assertCount(selection.validationOrder, "LEGACY_INVENTORY_SELECTION_INVALID");
    assertNonEmpty(selection.role, "LEGACY_INVENTORY_SELECTION_INVALID");
    assertNonEmpty(selection.section, "LEGACY_INVENTORY_SELECTION_INVALID");
    if (selection.outputGraphIri !== null) assertIri(selection.outputGraphIri, "LEGACY_INVENTORY_SELECTION_INVALID");
    if (["definition-graph", "authored-graph", "observed-graph", "shape-graph"].includes(String(selection.kind))) {
      if (selection.classification !== "selected" || selection.filePath === null || selection.graphIri === null || selection.loadOrder === null || selection.validationOrder === null || selection.outputGraphIri !== null) refuse("LEGACY_INVENTORY_SELECTION_KIND_MISMATCH");
    } else if (selection.kind === "derived-graph") {
      if (selection.classification !== "derived" || selection.filePath === null || selection.graphIri === null || selection.loadOrder === null || selection.validationOrder === null || selection.outputGraphIri !== null) refuse("LEGACY_INVENTORY_SELECTION_KIND_MISMATCH");
    } else if (selection.kind === "rule") {
      if (selection.classification !== "selected" || selection.filePath === null || selection.loadOrder !== null || selection.validationOrder !== null || selection.graphIri !== selection.outputGraphIri) refuse("LEGACY_INVENTORY_SELECTION_KIND_MISMATCH");
    } else if (selection.kind === "retired-graph") {
      if (selection.classification !== "retired" || selection.filePath !== null || selection.graphIri === null || selection.loadOrder !== null || selection.validationOrder !== null || selection.outputGraphIri !== null) refuse("LEGACY_INVENTORY_SELECTION_KIND_MISMATCH");
    } else if (selection.kind === "inactive-source") {
      if (selection.classification !== "inactive" || selection.filePath === null || selection.graphIri !== null || selection.loadOrder !== null || selection.validationOrder !== null || selection.outputGraphIri !== null) refuse("LEGACY_INVENTORY_SELECTION_KIND_MISMATCH");
    } else if (selection.kind === "fixture-root") {
      if (selection.classification !== "fixture" || selection.filePath === null || selection.graphIri !== null || selection.loadOrder !== null || selection.validationOrder !== null || selection.outputGraphIri !== null) refuse("LEGACY_INVENTORY_SELECTION_KIND_MISMATCH");
    } else refuse("LEGACY_INVENTORY_SELECTION_KIND_MISMATCH");
    const key = `${selection.sourceId}|${selection.manifestPath}#${selection.entryId}`;
    if (selectionKeys.has(key)) refuse("LEGACY_INVENTORY_SELECTION_DUPLICATE");
    selectionKeys.add(key);
  }
  const recordKeys = new Set<string>();
  const semanticKeys = new Set<string>();
  const selectionById = new Map(inventory.graphSelections.map((selection) => [`${selection.sourceId}|${selection.manifestPath}#${selection.entryId}`, selection]));
  for (const record of inventory.semanticRecords) {
    checkDeadline();
    if (!isRecord(record) || !exactKeys(record, ["sourceId", "selectionId", "filePath", "sourceDigest", "graphIri", "subject", "subjectKind", "predicate", "object", "objectKind", "graph", "graphKind", "statementDigest"])) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    const typedRecord = record as unknown as LegacyInventorySemanticRecord;
    assertIri(typedRecord.sourceId, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    if (!allowedSourceIds.has(typedRecord.sourceId)) refuse("LEGACY_INVENTORY_SOURCE_UNKNOWN");
    assertNonEmpty(typedRecord.selectionId, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    assertRelativePath(typedRecord.filePath, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    assertDigest(typedRecord.sourceDigest, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    assertIri(typedRecord.graphIri, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    if (typedRecord.subjectKind === "iri") assertIri(typedRecord.subject, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    else if (typedRecord.subjectKind !== "blank-node" || !typedRecord.subject.startsWith("_:")) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    assertIri(typedRecord.predicate, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    if (typedRecord.objectKind === "iri") assertIri(typedRecord.object, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    else if (typedRecord.objectKind === "blank-node") {
      if (!typedRecord.object.startsWith("_:")) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    } else if (typedRecord.objectKind === "literal-digest") assertDigest(typedRecord.object, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    else refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    if (typedRecord.graphKind === "iri") {
      if (typedRecord.graph === null) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
      assertIri(typedRecord.graph, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    } else if (typedRecord.graphKind === "blank-node") {
      if (typedRecord.graph === null || !typedRecord.graph.startsWith("_:")) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    } else if (typedRecord.graphKind !== "default" || typedRecord.graph !== null) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    assertDigest(typedRecord.statementDigest, "LEGACY_INVENTORY_SEMANTIC_RECORD_INVALID");
    const statementBasis = { subject: typedRecord.subject, subjectKind: typedRecord.subjectKind, predicate: typedRecord.predicate, object: typedRecord.object, objectKind: typedRecord.objectKind, graph: typedRecord.graph, graphKind: typedRecord.graphKind };
    if (canonicalDigest(statementBasis) !== typedRecord.statementDigest) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_DIGEST_MISMATCH");
    const selection = selectionById.get(`${typedRecord.sourceId}|${typedRecord.selectionId}`);
    if (!selection || !["definition-graph", "authored-graph", "observed-graph", "shape-graph", "derived-graph"].includes(selection.kind) || selection.filePath !== typedRecord.filePath || selection.digest !== typedRecord.sourceDigest || selection.graphIri !== typedRecord.graphIri) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_BINDING_MISMATCH");
    const key = `${typedRecord.sourceId}|${typedRecord.selectionId}|${typedRecord.statementDigest}`;
    if (semanticKeys.has(key)) refuse("LEGACY_INVENTORY_SEMANTIC_RECORD_DUPLICATE");
    semanticKeys.add(key);
  }
  for (const record of inventory.structuredRecords) {
    checkDeadline();
    if (!isRecord(record) || !exactKeys(record, ["sourceId", "registryId", "registryPath", "key", "recordKind", "digest"])) refuse("LEGACY_INVENTORY_RECORD_INVALID");
    assertIri(record.sourceId, "LEGACY_INVENTORY_RECORD_INVALID");
    if (!allowedSourceIds.has(record.sourceId)) refuse("LEGACY_INVENTORY_SOURCE_UNKNOWN");
    assertNonEmpty(record.registryId, "LEGACY_INVENTORY_RECORD_INVALID");
    assertRelativePath(record.registryPath, "LEGACY_INVENTORY_RECORD_INVALID");
    assertNonEmpty(record.key, "LEGACY_INVENTORY_RECORD_INVALID");
    assertNonEmpty(record.recordKind, "LEGACY_INVENTORY_RECORD_INVALID");
    assertDigest(record.digest, "LEGACY_INVENTORY_RECORD_INVALID");
    const key = `${record.sourceId}|${record.registryId}|${record.key}`;
    if (recordKeys.has(key)) refuse("LEGACY_INVENTORY_RECORD_DUPLICATE");
    recordKeys.add(key);
  }
  const trackedEvidence = new Map(inventory.trackedFiles.map((item) => [`${item.sourceId}|${item.path}`, item.digest]));
  const selectionEvidence = new Map(inventory.graphSelections.map((item) => [`${item.sourceId}|${item.manifestPath}#${item.entryId}`, item.digest]));
  const recordEvidence = new Map(inventory.structuredRecords.map((item) => [`${item.sourceId}|${item.registryId}|${item.key}`, item.digest]));
  for (const item of inventory.candidates) {
    checkDeadline();
    const rawItem: unknown = item;
    if (!isRecord(rawItem) || !exactKeys(rawItem, ["candidateId", "identity", "evidenceLocation", "sourceDigest", "pathClass", "graphIri", "typeIris", "predicate"]) || !isRecord(rawItem.identity) || !exactKeys(rawItem.identity, ["sourceSetDigest", "logicalSourceId", "pinnedSourceRevision", "selectedFileGraphOrRegistryId", "candidateKind", "candidateIriPathOrRegistryKey", "discriminator"]) || !Array.isArray(rawItem.typeIris)) refuse("LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertDigest(item.candidateId, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertDigest(item.identity.sourceSetDigest, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertIri(item.identity.logicalSourceId, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    if (!revisionPattern.test(item.identity.pinnedSourceRevision)) refuse("LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertNonEmpty(item.identity.selectedFileGraphOrRegistryId, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    if (!(recoveryCandidateKinds as readonly string[]).includes(item.identity.candidateKind)) refuse("LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertNonEmpty(item.identity.candidateIriPathOrRegistryKey, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertNonEmpty(item.identity.discriminator, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertNonEmpty(item.evidenceLocation, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    assertNonEmpty(item.pathClass, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    if (item.graphIri !== null) assertIri(item.graphIri, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    if (item.predicate !== null) assertIri(item.predicate, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    if (item.typeIris.length > limits.maxTypesPerCandidate) refuse("LEGACY_INVENTORY_CANDIDATE_TYPE_LIMIT_EXCEEDED");
    for (const typeIri of item.typeIris) assertIri(typeIri, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    sortedUnique(item.typeIris, "LEGACY_INVENTORY_CANDIDATE_TYPE_DUPLICATE");
    if (canonicalDigest(item.identity) !== item.candidateId) refuse("LEGACY_INVENTORY_CANDIDATE_ID_MISMATCH", { candidateId: item.candidateId });
    if (item.identity.sourceSetDigest !== inventory.sourceSetDigest) refuse("LEGACY_INVENTORY_CANDIDATE_SOURCE_SET_MISMATCH");
    const source = sourceSet.sources.find((candidateSource) => candidateSource.id === item.identity.logicalSourceId);
    if (!source || item.identity.pinnedSourceRevision !== source.revision) refuse("LEGACY_INVENTORY_CANDIDATE_SOURCE_MISMATCH");
    assertDigest(item.sourceDigest, "LEGACY_INVENTORY_CANDIDATE_INVALID");
    if ((item.identity.candidateKind === "tracked-source-artifact" || item.identity.candidateKind === "test-obligation" || item.identity.candidateKind === "semantic-document")) {
      if (trackedEvidence.get(`${source.id}|${item.identity.selectedFileGraphOrRegistryId}`) !== item.sourceDigest) refuse("LEGACY_INVENTORY_CANDIDATE_EVIDENCE_MISMATCH");
    } else if (item.identity.candidateKind === "structured-schema-or-registry-record") {
      if (recordEvidence.get(`${source.id}|${item.identity.selectedFileGraphOrRegistryId}|${item.identity.candidateIriPathOrRegistryKey}`) !== item.sourceDigest) refuse("LEGACY_INVENTORY_CANDIDATE_EVIDENCE_MISMATCH");
    } else {
      if (selectionEvidence.get(`${source.id}|${item.identity.selectedFileGraphOrRegistryId}`) !== item.sourceDigest) refuse("LEGACY_INVENTORY_CANDIDATE_EVIDENCE_MISMATCH");
    }
  }
  const candidateIds = sortedUnique(inventory.candidates.map((item) => item.candidateId), "LEGACY_INVENTORY_DUPLICATE_CANDIDATE");
  checkDeadline();
  const expectedCandidates = candidatesFromInventoryMetadata(inventory, sourceSet, limits, checkDeadline);
  if (expectedCandidates.size !== inventory.candidates.length) refuse("LEGACY_INVENTORY_CANDIDATE_COVERAGE_GAP", { expected: expectedCandidates.size, actual: inventory.candidates.length });
  for (const item of inventory.candidates) {
    checkDeadline();
    const expected = expectedCandidates.get(item.candidateId);
    if (!expected || canonicalDigest(expected) !== canonicalDigest(item)) refuse("LEGACY_INVENTORY_CANDIDATE_PARITY_MISMATCH", { candidateId: item.candidateId });
  }
  if (computeInventoryDigest(inventory) !== inventory.inventoryDigest) refuse("LEGACY_INVENTORY_DIGEST_MISMATCH");
  checkDeadline();
  if (candidateIds.length !== inventory.candidates.length) refuse("LEGACY_INVENTORY_DUPLICATE_CANDIDATE");
  const fileSummary = new Map<string, { count: number; bytes: number; roles: number; parserNodes: number }>();
  const treeEntries = new Map<string, Array<readonly [string, LegacyTrackedFile["mode"], string]>>();
  for (const file of inventory.trackedFiles) {
    checkDeadline();
    const summary = fileSummary.get(file.sourceId) ?? { count: 0, bytes: 0, roles: 0, parserNodes: 0 };
    summary.count += 1;
    summary.bytes += file.bytes;
    summary.roles += file.roles.length;
    summary.parserNodes += (file.parserOutcomes as LegacyTrackedFile["parserOutcomes"]).reduce((sum: number, outcome) => sum + outcome.nodeCount, 0);
    fileSummary.set(file.sourceId, summary);
    const entries = treeEntries.get(file.sourceId) ?? [];
    entries.push([file.path, file.mode, file.blobOid]);
    treeEntries.set(file.sourceId, entries);
  }
  const selectionCounts = new Map<string, number>();
  for (const selection of inventory.graphSelections) { checkDeadline(); selectionCounts.set(selection.sourceId, (selectionCounts.get(selection.sourceId) ?? 0) + 1); }
  const semanticCounts = new Map<string, number>();
  for (const record of inventory.semanticRecords) { checkDeadline(); semanticCounts.set(record.sourceId, (semanticCounts.get(record.sourceId) ?? 0) + 1); }
  const recordCounts = new Map<string, number>();
  for (const record of inventory.structuredRecords) { checkDeadline(); recordCounts.set(record.sourceId, (recordCounts.get(record.sourceId) ?? 0) + 1); }
  const candidateSummaries = new Map<string, { total: number; kinds: Record<RecoveryCandidateKind, number> }>();
  for (const item of inventory.candidates) {
    checkDeadline();
    const summary = candidateSummaries.get(item.identity.logicalSourceId) ?? { total: 0, kinds: Object.fromEntries(recoveryCandidateKinds.map((kind) => [kind, 0])) as Record<RecoveryCandidateKind, number> };
    summary.total += 1;
    summary.kinds[item.identity.candidateKind as RecoveryCandidateKind] += 1;
    candidateSummaries.set(item.identity.logicalSourceId, summary);
  }
  for (const source of sourceSet.sources) {
    checkDeadline();
    const row = sourceRows.get(source.id);
    if (!row || row.revision !== source.revision || row.tree !== source.tree || row.sourceContractDigest !== canonicalDigest(source) || row.licenceStatus !== source.licence.status || row.licenceIdentifier !== (source.licence.identifier ?? null) || row.reuseBoundary !== source.licence.reuseBoundary) refuse("LEGACY_INVENTORY_SOURCE_BINDING_MISMATCH", { sourceId: source.id });
    const files = fileSummary.get(source.id) ?? { count: 0, bytes: 0, roles: 0, parserNodes: 0 };
    const selectionCount = selectionCounts.get(source.id) ?? 0;
    const semanticCount = semanticCounts.get(source.id) ?? 0;
    const recordCount = recordCounts.get(source.id) ?? 0;
    const sourceCandidates = candidateSummaries.get(source.id) ?? { total: 0, kinds: Object.fromEntries(recoveryCandidateKinds.map((kind) => [kind, 0])) as Record<RecoveryCandidateKind, number> };
    if (files.count !== source.selection.trackedFileCount || files.count !== row.trackedFileCount || files.bytes !== source.selection.trackedByteCount || row.trackedByteCount !== source.selection.trackedByteCount || selectionCount !== row.graphSelectionCount || recordCount !== row.structuredRecordCount || sourceCandidates.total !== row.candidateCount) refuse("LEGACY_INVENTORY_SOURCE_DENOMINATOR_MISMATCH", { sourceId: source.id });
    const receipt = row.extractionReceipt;
    if (receipt.sourceSetDigest !== sourceSet.sourceSetDigest || receipt.sourceId !== source.id || receipt.revision !== source.revision || receipt.tree !== source.tree || computeExtractionReceiptDigest(receipt) !== receipt.receiptDigest) refuse("LEGACY_INVENTORY_EXTRACTION_BINDING_MISMATCH", { sourceId: source.id });
    const retainedTreeEntriesDigest = canonicalDigest((treeEntries.get(source.id) ?? []).sort((left, right) => compareUtf8(left[0], right[0])));
    checkDeadline();
    if (receipt.gitVerification.treeEntriesDigest !== retainedTreeEntriesDigest) refuse("LEGACY_INVENTORY_GIT_TREE_METADATA_MISMATCH", { sourceId: source.id });
    if (receipt.counts.trackedFiles !== files.count || receipt.counts.trackedBytes !== row.trackedByteCount || receipt.counts.manifests !== row.manifestCount || receipt.counts.manifestEntries !== selectionCount || receipt.counts.quads !== row.quadObservationCount || semanticCount !== row.quadObservationCount || receipt.counts.registries !== row.registryCount || receipt.counts.registryRecords !== recordCount || receipt.counts.roleAssertions !== row.roleAssertionCount || files.roles !== row.roleAssertionCount || receipt.counts.parserNodes !== files.parserNodes) refuse("LEGACY_INVENTORY_EXTRACTION_COUNT_MISMATCH", { sourceId: source.id });
  }
}

export function verifyLegacyGraphInventory(
  inventory: LegacyGraphInventory,
  sourceSet: RecoverySourceSetContract,
  limitOverrides: Partial<RecoveryLimits> = {},
): void {
  const limits = checkedLimits(limitOverrides);
  verifyLegacyGraphInventoryWithin(inventory, sourceSet, limits, recoveryDeadline(limits));
}

function validateDispositionResolution(value: unknown): asserts value is DispositionResolution {
  if (!isRecord(value) || !exactKeys(value, ["disposition", "rationale", "targetV3Iri", "definitionCoverageState", "operationalImplementationState", "readinessRecordDigest"])) refuse("RECOVERY_DISPOSITION_INVALID");
  if (!["re-express-ready", "metadata-only", "defer", "not-claimed", "historical-only", "reject", "unresolved"].includes(String(value.disposition))) refuse("RECOVERY_DISPOSITION_INVALID");
  assertNonEmpty(value.rationale, "RECOVERY_DISPOSITION_INVALID");
  if (value.targetV3Iri !== null) assertIri(value.targetV3Iri, "RECOVERY_DISPOSITION_INVALID");
  if (!["covered", "partial", "absent", "unknown"].includes(String(value.definitionCoverageState)) || !["implemented", "partial", "not-implemented", "not-applicable", "unknown"].includes(String(value.operationalImplementationState))) refuse("RECOVERY_DISPOSITION_INVALID");
  if (value.readinessRecordDigest !== null) assertDigest(value.readinessRecordDigest, "RECOVERY_DISPOSITION_INVALID");
  if (value.disposition === "re-express-ready" && value.targetV3Iri === null) refuse("RECOVERY_READY_TARGET_REQUIRED");
  if (value.disposition !== "re-express-ready" && value.readinessRecordDigest !== null) refuse("RECOVERY_READINESS_BINDING_UNEXPECTED");
}

function validateProvenance(value: unknown): asserts value is ReviewProvenance {
  if (!isRecord(value) || !exactKeys(value, ["reviewId", "reviewDigest"])) refuse("RECOVERY_PROVENANCE_INVALID");
  assertNonEmpty(value.reviewId, "RECOVERY_PROVENANCE_INVALID");
  assertDigest(value.reviewDigest, "RECOVERY_PROVENANCE_INVALID");
}

function validateReadinessRecordShape(value: unknown, limits: RecoveryLimits): asserts value is AdoptionReadinessRecord {
  if (!isRecord(value) || !exactKeys(value, ["schema", "candidateId", "sourceDigest", "reviewed", "reviewDigest", "relevance", "connectivity", "licence", "layer", "mitigations", "currentness", "bauCeilings", "lifecycle", "readinessDigest"]) || !isRecord(value.relevance) || !isRecord(value.connectivity) || !isRecord(value.licence) || !isRecord(value.layer) || !isRecord(value.currentness) || !isRecord(value.lifecycle) || !Array.isArray(value.mitigations) || !Array.isArray(value.bauCeilings)) refuse("RECOVERY_READINESS_RECORD_INVALID");
  if (value.schema !== "urn:usf:semantic-adoption-readiness:1" || typeof value.reviewed !== "boolean") refuse("RECOVERY_READINESS_RECORD_INVALID");
  for (const candidateDigest of [value.candidateId, value.sourceDigest, value.reviewDigest, value.readinessDigest]) assertDigest(candidateDigest, "RECOVERY_READINESS_RECORD_INVALID");
  if (!exactKeys(value.relevance, ["consumerIri", "consumerKind", "consumerDigest", "unsatisfied", "duplicate"]) || typeof value.relevance.unsatisfied !== "boolean" || typeof value.relevance.duplicate !== "boolean") refuse("RECOVERY_READINESS_RECORD_INVALID");
  assertIri(value.relevance.consumerIri, "RECOVERY_READINESS_RECORD_INVALID");
  assertDigest(value.relevance.consumerDigest, "RECOVERY_READINESS_RECORD_INVALID");
  if (!["contract", "requirement", "consumer"].includes(String(value.relevance.consumerKind))) refuse("RECOVERY_READINESS_RECORD_INVALID");
  if (!exactKeys(value.connectivity, ["status", "selectedProfileIri", "selectedProfileVersion", "closureDigest", "targetIri", "relationType", "intendedConsumers", "newRootExceptionDigest"]) || !Array.isArray(value.connectivity.intendedConsumers) || value.connectivity.intendedConsumers.length > limits.maxConsumers) refuse("RECOVERY_READINESS_RECORD_INVALID");
  if (!["connected", "accepted-new-root", "disconnected", "unknown"].includes(String(value.connectivity.status))) refuse("RECOVERY_READINESS_RECORD_INVALID");
  assertIri(value.connectivity.selectedProfileIri, "RECOVERY_READINESS_RECORD_INVALID");
  assertNonEmpty(value.connectivity.selectedProfileVersion, "RECOVERY_READINESS_RECORD_INVALID");
  assertDigest(value.connectivity.closureDigest, "RECOVERY_READINESS_RECORD_INVALID");
  assertIri(value.connectivity.targetIri, "RECOVERY_READINESS_RECORD_INVALID");
  assertNonEmpty(value.connectivity.relationType, "RECOVERY_READINESS_RECORD_INVALID");
  for (const consumer of value.connectivity.intendedConsumers) assertIri(consumer, "RECOVERY_READINESS_RECORD_INVALID");
  sortedUnique(value.connectivity.intendedConsumers, "RECOVERY_READINESS_RECORD_INVALID");
  if (value.connectivity.newRootExceptionDigest !== null) assertDigest(value.connectivity.newRootExceptionDigest, "RECOVERY_READINESS_RECORD_INVALID");
  if (!exactKeys(value.licence, ["status", "decisionDigest"]) || !["cleared", "restricted", "unknown"].includes(String(value.licence.status))) refuse("RECOVERY_READINESS_RECORD_INVALID");
  assertDigest(value.licence.decisionDigest, "RECOVERY_READINESS_RECORD_INVALID");
  if (!exactKeys(value.layer, ["targetLayer", "productProfileIri", "productProfileVersion", "isolationStatus", "decisionDigest"]) || !["core", "product"].includes(String(value.layer.targetLayer)) || !["cleared", "violated", "unknown"].includes(String(value.layer.isolationStatus))) refuse("RECOVERY_READINESS_RECORD_INVALID");
  if (value.layer.productProfileIri !== null) assertIri(value.layer.productProfileIri, "RECOVERY_READINESS_RECORD_INVALID");
  if (value.layer.productProfileVersion !== null) assertNonEmpty(value.layer.productProfileVersion, "RECOVERY_READINESS_RECORD_INVALID");
  assertDigest(value.layer.decisionDigest, "RECOVERY_READINESS_RECORD_INVALID");
  if (value.mitigations.length > limits.maxMitigationsPerRecord || value.bauCeilings.length > requiredBauDimensions.length) refuse("RECOVERY_READINESS_LIMIT_EXCEEDED");
  for (const mitigation of value.mitigations) {
    if (!isRecord(mitigation) || !exactKeys(mitigation, ["lessonId", "mitigation", "verificationDigest"])) refuse("RECOVERY_READINESS_RECORD_INVALID");
    assertNonEmpty(mitigation.lessonId, "RECOVERY_READINESS_RECORD_INVALID");
    assertNonEmpty(mitigation.mitigation, "RECOVERY_READINESS_RECORD_INVALID");
    assertDigest(mitigation.verificationDigest, "RECOVERY_READINESS_RECORD_INVALID");
  }
  if (!exactKeys(value.currentness, ["sourceSetDigest", "inventoryDigest", "selectedProfileIri", "selectedProfileVersion", "semanticDigest", "closureDigest", "validationObligationDigest", "testObligationDigest"])) refuse("RECOVERY_READINESS_RECORD_INVALID");
  for (const currentDigest of [value.currentness.sourceSetDigest, value.currentness.inventoryDigest, value.currentness.semanticDigest, value.currentness.closureDigest, value.currentness.validationObligationDigest, value.currentness.testObligationDigest]) assertDigest(currentDigest, "RECOVERY_READINESS_RECORD_INVALID");
  assertIri(value.currentness.selectedProfileIri, "RECOVERY_READINESS_RECORD_INVALID");
  assertNonEmpty(value.currentness.selectedProfileVersion, "RECOVERY_READINESS_RECORD_INVALID");
  for (const assessment of value.bauCeilings) {
    if (!isRecord(assessment) || !exactKeys(assessment, ["dimension", "ceiling", "observed", "unit", "status"]) || !(requiredBauDimensions as readonly unknown[]).includes(assessment.dimension) || typeof assessment.ceiling !== "number" || !Number.isFinite(assessment.ceiling) || assessment.ceiling < 0 || typeof assessment.observed !== "number" || !Number.isFinite(assessment.observed) || assessment.observed < 0 || !["within", "over", "unknown"].includes(String(assessment.status))) refuse("RECOVERY_READINESS_RECORD_INVALID");
    assertNonEmpty(assessment.unit, "RECOVERY_READINESS_RECORD_INVALID");
  }
  assertNonEmpty(value.lifecycle.rationale, "RECOVERY_READINESS_RECORD_INVALID");
  if (value.lifecycle.applicability === "applicable") {
    if (!exactKeys(value.lifecycle, ["applicability", "rationale", "commands", "retryBound", "drainMilliseconds", "restartBound", "noPartialAuthorityMutation"]) || !isRecord(value.lifecycle.commands) || !exactKeys(value.lifecycle.commands, ["start", "status", "stop"]) || typeof value.lifecycle.commands.start !== "boolean" || typeof value.lifecycle.commands.status !== "boolean" || typeof value.lifecycle.commands.stop !== "boolean" || typeof value.lifecycle.noPartialAuthorityMutation !== "boolean") refuse("RECOVERY_READINESS_RECORD_INVALID");
    for (const count of [value.lifecycle.retryBound, value.lifecycle.drainMilliseconds, value.lifecycle.restartBound]) assertCount(count, "RECOVERY_READINESS_RECORD_INVALID");
  } else if (value.lifecycle.applicability === "not-applicable" || value.lifecycle.applicability === "unknown") {
    if (!exactKeys(value.lifecycle, ["applicability", "rationale"])) refuse("RECOVERY_READINESS_RECORD_INVALID");
  } else refuse("RECOVERY_READINESS_RECORD_INVALID");
}

function validateConfigShape(value: unknown, limits: RecoveryLimits): asserts value is RecoveryConfig {
  if (!isRecord(value) || !exactKeys(value, ["schema", "version", "sourceSetDigest", "inventoryDigest", "exactDispositions", "rules", "readinessRecords", "reviewedMappings", "recoveryDigest"]) || value.schema !== "urn:usf:semantic-recovery:1" || value.version !== 1) refuse("RECOVERY_CONFIG_INVALID");
  assertDigest(value.sourceSetDigest, "RECOVERY_CONFIG_INVALID");
  assertDigest(value.inventoryDigest, "RECOVERY_CONFIG_INVALID");
  assertDigest(value.recoveryDigest, "RECOVERY_CONFIG_INVALID");
  if (!Array.isArray(value.exactDispositions) || !Array.isArray(value.rules) || !Array.isArray(value.readinessRecords) || !Array.isArray(value.reviewedMappings)) refuse("RECOVERY_CONFIG_INVALID");
  if (value.exactDispositions.length > limits.maxExactDispositions || value.rules.length > limits.maxRules || value.readinessRecords.length > limits.maxReadinessRecords || value.reviewedMappings.length > limits.maxReviewedMappings) refuse("RECOVERY_CONFIG_LIMIT_EXCEEDED");
  for (const row of value.exactDispositions) {
    if (!isRecord(row) || !exactKeys(row, ["candidateId", "resolution", "provenance"])) refuse("RECOVERY_EXACT_DISPOSITION_INVALID");
    assertDigest(row.candidateId, "RECOVERY_EXACT_DISPOSITION_INVALID");
    validateDispositionResolution(row.resolution);
    validateProvenance(row.provenance);
  }
  for (const rule of value.rules) {
    if (!isRecord(rule) || !exactKeys(rule, ["id", "match", "resolution", "provenance"]) || !isRecord(rule.match) || !exactKeys(rule.match, ["sourceId", "candidateKind"], ["exactType", "predicate", "pathClass"])) refuse("RECOVERY_RULE_INVALID");
    assertNonEmpty(rule.id, "RECOVERY_RULE_INVALID");
    if ([rule.match.exactType, rule.match.predicate, rule.match.pathClass].filter((field) => field !== undefined).length > 1) refuse("RECOVERY_RULE_DISCRIMINATOR_INVALID");
    assertIri(rule.match.sourceId, "RECOVERY_RULE_INVALID");
    if (!(recoveryCandidateKinds as readonly string[]).includes(String(rule.match.candidateKind))) refuse("RECOVERY_RULE_INVALID");
    if (rule.match.pathClass !== undefined) assertNonEmpty(rule.match.pathClass, "RECOVERY_RULE_INVALID");
    for (const field of [rule.match.exactType, rule.match.predicate]) if (field !== undefined) assertIri(field, "RECOVERY_RULE_INVALID");
    validateDispositionResolution(rule.resolution);
    validateProvenance(rule.provenance);
  }
  for (const record of value.readinessRecords) validateReadinessRecordShape(record, limits);
  for (const mapping of value.reviewedMappings) {
    if (!isRecord(mapping) || !exactKeys(mapping, ["id", "kind", "sourceCandidateIds", "targetV3Iris", "reviewDigest"]) || !Array.isArray(mapping.sourceCandidateIds) || !Array.isArray(mapping.targetV3Iris) || mapping.sourceCandidateIds.length > limits.maxMappingItems || mapping.targetV3Iris.length > limits.maxMappingItems) refuse("RECOVERY_MAPPING_INVALID");
    assertNonEmpty(mapping.id, "RECOVERY_MAPPING_INVALID");
    assertDigest(mapping.reviewDigest, "RECOVERY_MAPPING_INVALID");
    for (const candidateId of mapping.sourceCandidateIds) assertDigest(candidateId, "RECOVERY_MAPPING_INVALID");
    for (const target of mapping.targetV3Iris) assertIri(target, "RECOVERY_MAPPING_INVALID");
  }
  if (computeRecoveryDigest(value as unknown as RecoveryConfig) !== value.recoveryDigest) refuse("RECOVERY_CONFIG_DIGEST_MISMATCH");
}

const deferredReadinessReasons = new Set([
  "READINESS_DUPLICATE_V3_MEANING",
  "READINESS_CONSUMER_ALREADY_SATISFIED",
  "READINESS_DISCONNECTED",
  "READINESS_LICENCE_NOT_CLEARED",
  "READINESS_LAYER_NOT_ISOLATED",
  "READINESS_ADVERSE_LESSON_UNMITIGATED",
  "READINESS_BAU_OVER_CEILING",
  "READINESS_LIFECYCLE_UNSAFE",
]);

/** Evaluate a candidate readiness record without granting graph authority. */
export function evaluateAdoptionReadiness(
  candidateItem: RecoveryCandidate,
  record: AdoptionReadinessRecord | undefined,
  config: RecoveryConfig,
  authority: RecoveryAuthorityContext,
  requestedTargetV3Iri: string | null,
  limitOverrides: Partial<RecoveryLimits> = {},
): ReadinessEvaluation {
  if (!isRecord(authority) || !authenticatedRecoveryAuthorities.has(authority)) refuse("RECOVERY_AUTHORITY_UNAUTHENTIC");
  if (config.recoveryDigest !== authority.acceptedRecoveryDigest || config.inventoryDigest !== authority.acceptedInventoryDigest || config.sourceSetDigest !== authority.sourceSet.sourceSetDigest) refuse("RECOVERY_AUTHORITY_CURRENTNESS_MISMATCH");
  if (!record) return deepFreeze({ status: "unresolved", disposition: "unresolved", reasons: ["READINESS_RECORD_MISSING"], readinessDigest: null });
  const limits = checkedLimits(limitOverrides);
  validateReadinessRecordShape(record, limits);
  const reasons: string[] = [];
  if (record.schema !== "urn:usf:semantic-adoption-readiness:1" || record.reviewed !== true) reasons.push("READINESS_RECORD_UNREVIEWED");
  if (!authority.allowedReviewDigests.includes(record.reviewDigest)) reasons.push("READINESS_REVIEW_UNAUTHORIZED");
  if (record.candidateId !== candidateItem.candidateId || record.sourceDigest !== candidateItem.sourceDigest) reasons.push("READINESS_SOURCE_BINDING_MISMATCH");
  if (!digestPattern.test(record.readinessDigest) || computeReadinessDigest(record) !== record.readinessDigest) reasons.push("READINESS_DIGEST_MISMATCH");

  const consumer = authority.v3Selection.consumers.find((item) => item.iri === record.relevance?.consumerIri);
  if (!consumer || consumer.kind !== record.relevance?.consumerKind || consumer.digest !== record.relevance?.consumerDigest || record.relevance?.unsatisfied !== true) reasons.push("READINESS_V3_RELEVANCE_MISSING");
  else if (consumer.status !== "unsatisfied") reasons.push(consumer.status === "satisfied" ? "READINESS_CONSUMER_ALREADY_SATISFIED" : "READINESS_V3_RELEVANCE_UNKNOWN");
  if (record.relevance?.duplicate !== false) reasons.push("READINESS_DUPLICATE_V3_MEANING");

  const connectivity = record.connectivity;
  if (!connectivity || connectivity.selectedProfileIri !== authority.v3Selection.profileIri || connectivity.selectedProfileVersion !== authority.v3Selection.profileVersion || connectivity.closureDigest !== authority.v3Selection.closureDigest) reasons.push("READINESS_CONNECTIVITY_STALE");
  else if (connectivity.status === "disconnected") reasons.push("READINESS_DISCONNECTED");
  else if (connectivity.status === "unknown") reasons.push("READINESS_CONNECTIVITY_UNKNOWN");
  else if (connectivity.status === "accepted-new-root" && (connectivity.newRootExceptionDigest === null || !authority.acceptedNewRootExceptionDigests.includes(connectivity.newRootExceptionDigest) || connectivity.intendedConsumers.length === 0)) reasons.push("READINESS_NEW_ROOT_EXCEPTION_MISSING");
  else if (connectivity.status === "connected" && connectivity.newRootExceptionDigest !== null) reasons.push("READINESS_NEW_ROOT_EXCEPTION_UNEXPECTED");
  if (connectivity?.status === "connected" && !authority.v3Selection.connections.some((connection) => connection.targetIri === connectivity.targetIri && connection.relationType === connectivity.relationType)) reasons.push("READINESS_TYPED_CONNECTION_MISSING");
  if (requestedTargetV3Iri === null || connectivity?.targetIri !== requestedTargetV3Iri) reasons.push("READINESS_TARGET_MISMATCH");

  const licenceDecision = authority.licenceDecisions.find((decision) => decision.sourceId === candidateItem.identity.logicalSourceId);
  const sourceContract = authority.sourceSet.sources.find((source) => source.id === candidateItem.identity.logicalSourceId);
  const boundaryPermitsReexpression = sourceContract?.licence.status !== "restricted" || sourceContract.licence.reuseBoundary.includes("reexpression");
  if (!licenceDecision || licenceDecision.status !== "cleared-for-original-v3-reexpression" || !boundaryPermitsReexpression || record.licence?.status !== "cleared" || record.licence?.decisionDigest !== licenceDecision.decisionDigest) reasons.push(record.licence?.status === "unknown" || licenceDecision?.status === "unresolved" ? "READINESS_LICENCE_UNKNOWN" : "READINESS_LICENCE_NOT_CLEARED");
  const layerDecision = authority.layerDecisions.find((decision) => decision.targetIri === requestedTargetV3Iri && decision.targetLayer === record.layer?.targetLayer);
  if (!layerDecision || layerDecision.isolationStatus !== "cleared" || record.layer?.isolationStatus !== "cleared" || record.layer?.decisionDigest !== layerDecision.decisionDigest || record.layer.productProfileIri !== layerDecision.productProfileIri || record.layer.productProfileVersion !== layerDecision.productProfileVersion) reasons.push(record.layer?.isolationStatus === "unknown" || !layerDecision ? "READINESS_LAYER_UNKNOWN" : "READINESS_LAYER_NOT_ISOLATED");
  if (record.layer?.targetLayer === "product" && (!record.layer.productProfileIri || !record.layer.productProfileVersion)) reasons.push("READINESS_PRODUCT_PROFILE_MISSING");
  if (record.layer?.targetLayer === "core" && (record.layer.productProfileIri !== null || record.layer.productProfileVersion !== null)) reasons.push("READINESS_PRODUCT_PROFILE_UNEXPECTED");

  const applicableLessons = authority.adverseLessons.filter((lesson) => lesson.sourceIds.includes(candidateItem.identity.logicalSourceId)).map((lesson) => lesson.id).sort(compareText);
  if (applicableLessons.length === 0) reasons.push("READINESS_ADVERSE_LESSON_DENOMINATOR_MISSING");
  const mitigationIds = (record.mitigations ?? []).map((item) => item.lessonId).sort(compareText);
  if (new Set(mitigationIds).size !== mitigationIds.length || applicableLessons.length !== mitigationIds.length || applicableLessons.some((id, index) => id !== mitigationIds[index])) reasons.push("READINESS_ADVERSE_LESSON_UNMITIGATED");
  for (const mitigation of record.mitigations ?? []) if (!mitigation.mitigation || !digestPattern.test(mitigation.verificationDigest)) reasons.push("READINESS_ADVERSE_LESSON_UNMITIGATED");

  const currentness = record.currentness;
  if (!currentness || currentness.sourceSetDigest !== authority.sourceSet.sourceSetDigest || currentness.inventoryDigest !== config.inventoryDigest || currentness.selectedProfileIri !== authority.v3Selection.profileIri || currentness.selectedProfileVersion !== authority.v3Selection.profileVersion || currentness.semanticDigest !== authority.v3Selection.semanticDigest || currentness.closureDigest !== authority.v3Selection.closureDigest) reasons.push("READINESS_CURRENTNESS_STALE");
  if (!currentness || !authority.v3Selection.validationObligationDigests.includes(currentness.validationObligationDigest)) reasons.push("READINESS_VALIDATION_BINDING_MISSING");
  if (!currentness || !authority.v3Selection.testObligationDigests.includes(currentness.testObligationDigest)) reasons.push("READINESS_TEST_BINDING_MISSING");

  const dimensions = new Map<BauDimension, BauCeilingAssessment>();
  for (const assessment of record.bauCeilings ?? []) {
    if (dimensions.has(assessment.dimension)) reasons.push("READINESS_BAU_DUPLICATE_DIMENSION");
    dimensions.set(assessment.dimension, assessment);
  }
  for (const dimension of requiredBauDimensions) {
    const assessment = dimensions.get(dimension);
    const policy = authority.bauPolicy.find((entry) => entry.dimension === dimension);
    if (!assessment) reasons.push("READINESS_BAU_DIMENSION_MISSING");
    else if (assessment.status === "unknown") reasons.push("READINESS_BAU_UNKNOWN");
    else if (!policy || assessment.unit !== policy.unit || !Number.isFinite(assessment.ceiling) || assessment.ceiling < 0 || assessment.ceiling > policy.maximumCeiling || !Number.isFinite(assessment.observed) || assessment.observed < 0 || assessment.status === "over" || assessment.observed > assessment.ceiling) reasons.push("READINESS_BAU_OVER_CEILING");
  }
  if (dimensions.size !== requiredBauDimensions.length) reasons.push("READINESS_BAU_DIMENSION_SET_INVALID");

  const lifecycle = record.lifecycle;
  if (!lifecycle || lifecycle.applicability === "unknown") reasons.push("READINESS_LIFECYCLE_UNKNOWN");
  else if (lifecycle.applicability === "not-applicable") {
    if (!lifecycle.rationale) reasons.push("READINESS_LIFECYCLE_UNKNOWN");
  } else if (!lifecycle.rationale || lifecycle.commands.start !== true || lifecycle.commands.status !== true || lifecycle.commands.stop !== true || !Number.isSafeInteger(lifecycle.retryBound) || lifecycle.retryBound < 1 || !Number.isSafeInteger(lifecycle.drainMilliseconds) || lifecycle.drainMilliseconds < 1 || !Number.isSafeInteger(lifecycle.restartBound) || lifecycle.restartBound < 1 || lifecycle.noPartialAuthorityMutation !== true) reasons.push("READINESS_LIFECYCLE_UNSAFE");

  const distinct = [...new Set(reasons)].sort(compareText);
  if (distinct.length === 0) return deepFreeze({ status: "ready", disposition: "re-express-ready", reasons: [], readinessDigest: record.readinessDigest });
  const status = distinct.some((reason) => deferredReadinessReasons.has(reason)) ? "defer" : "unresolved";
  return deepFreeze({ status, disposition: status, reasons: distinct, readinessDigest: record.readinessDigest });
}

function ruleSpecificity(match: CompactRuleMatch): number {
  return Object.values(match).filter((value) => value !== undefined).length;
}

function extendsRule(left: CompactRuleMatch, right: CompactRuleMatch): boolean {
  const fields = ["sourceId", "candidateKind", "exactType", "predicate", "pathClass"] as const;
  return fields.every((field) => right[field] === undefined || left[field] === right[field]);
}

function ruleMatches(candidateItem: RecoveryCandidate, match: CompactRuleMatch): boolean {
  return (match.sourceId === undefined || match.sourceId === candidateItem.identity.logicalSourceId)
    && (match.candidateKind === undefined || match.candidateKind === candidateItem.identity.candidateKind)
    && (match.exactType === undefined || candidateItem.typeIris.includes(match.exactType))
    && (match.predicate === undefined || match.predicate === candidateItem.predicate)
    && (match.pathClass === undefined || match.pathClass === candidateItem.pathClass);
}

function authorityHasType(graph: LoadedSemanticGraph, resource: string, typeIri: string): boolean {
  return objectsFor(graph, resource, recoveryAuthorityVocabulary.predicate.type).some((quad) => quad.objectKind === "iri" && quad.object === typeIri);
}

function requireAuthorityType(graph: LoadedSemanticGraph, resource: string, typeIri: string, reason: string): void {
  assertIri(resource, reason);
  if (!authorityHasType(graph, resource, typeIri)) refuse(reason, { resource, typeIri });
}

function exactAuthorityValue(graph: LoadedSemanticGraph, subject: string, predicate: string, kind: "iri" | "literal", reason: string): string {
  const quads = objectsFor(graph, subject, predicate);
  if (quads.length !== 1 || quads[0]?.objectKind !== kind) refuse(reason, { subject, predicate, count: quads.length });
  return quads[0].object;
}

function optionalAuthorityValue(graph: LoadedSemanticGraph, subject: string, predicate: string, kind: "iri" | "literal", reason: string): string | null {
  const quads = objectsFor(graph, subject, predicate);
  if (quads.length === 0) return null;
  if (quads.length !== 1 || quads[0]?.objectKind !== kind) refuse(reason, { subject, predicate, count: quads.length });
  return quads[0].object;
}

function authorityLinks(graph: LoadedSemanticGraph, subject: string, predicate: string, reason: string, required = false): string[] {
  const quads = objectsFor(graph, subject, predicate);
  if (required && quads.length === 0) refuse(reason, { subject, predicate });
  if (quads.some((quad) => quad.objectKind !== "iri")) refuse(reason, { subject, predicate });
  return sortedUnique(quads.map((quad) => quad.object), reason);
}

function authorityResourceDigests(graph: LoadedSemanticGraph, resources: readonly string[], typeIri: string, reason: string, checkDeadline: () => void): string[] {
  return resources.map((resource) => {
    checkDeadline();
    requireAuthorityType(graph, resource, typeIri, reason);
    return resourceDigest(graph, resource);
  }).sort(compareText);
}

/**
 * Load a selected unified V3 graph and derive an unforgeable recovery authority
 * context from one explicitly typed authority resource and exact versioned profile.
 */
export function deriveRecoveryAuthorityContext(repositoryRoot: string, options: DeriveRecoveryAuthorityOptions): RecoveryAuthorityContext {
  if (!isRecord(options) || !exactKeys(options, ["manifestPath", "authorityIri", "profileIri", "sourceSet", "inventory", "config"], ["recoveryLimits", "graphLoadLimits"])) refuse("RECOVERY_AUTHORITY_OPTIONS_INVALID");
  const limits = checkedLimits(options.recoveryLimits ?? {});
  const checkDeadline = recoveryDeadline(limits);
  assertNonEmpty(options.manifestPath, "RECOVERY_AUTHORITY_MANIFEST_INVALID");
  assertIri(options.authorityIri, "RECOVERY_AUTHORITY_RESOURCE_INVALID");
  assertIri(options.profileIri, "RECOVERY_AUTHORITY_PROFILE_INVALID");
  validateSourceSet(options.sourceSet, limits);
  verifyLegacyGraphInventoryWithin(options.inventory, options.sourceSet, limits, checkDeadline);
  checkDeadline();
  validateConfigShape(options.config, limits);
  if (options.inventory.inventoryDigest !== options.config.inventoryDigest || options.inventory.sourceSetDigest !== options.config.sourceSetDigest || options.sourceSet.sourceSetDigest !== options.config.sourceSetDigest) refuse("RECOVERY_AUTHORITY_ARTIFACT_CURRENTNESS_MISMATCH");

  let graph: LoadedSemanticGraph;
  try { graph = loadSemanticGraph(repositoryRoot, options.manifestPath, options.graphLoadLimits ?? {}); }
  catch (error) {
    const cause = error instanceof Error && "reasonCode" in error ? String((error as { reasonCode: unknown }).reasonCode) : error instanceof Error ? error.message : "unknown";
    return refuse("RECOVERY_AUTHORITY_GRAPH_LOAD_FAILED", { cause });
  }
  checkDeadline();
  const { predicate, type } = recoveryAuthorityVocabulary;
  requireAuthorityType(graph, options.authorityIri, type.authority, "RECOVERY_AUTHORITY_RESOURCE_INVALID");
  requireAuthorityType(graph, options.profileIri, type.profile, "RECOVERY_AUTHORITY_PROFILE_INVALID");
  if (exactAuthorityValue(graph, options.authorityIri, predicate.profile, "iri", "RECOVERY_AUTHORITY_PROFILE_AMBIGUOUS") !== options.profileIri) refuse("RECOVERY_AUTHORITY_PROFILE_MISMATCH");
  const profileVersion = exactAuthorityValue(graph, options.profileIri, predicate.version, "literal", "RECOVERY_AUTHORITY_PROFILE_VERSION_INVALID");
  assertNonEmpty(profileVersion, "RECOVERY_AUTHORITY_PROFILE_VERSION_INVALID");
  const assertedSourceSetDigest = exactAuthorityValue(graph, options.authorityIri, predicate.acceptedSourceSetDigest, "literal", "RECOVERY_AUTHORITY_ARTIFACT_BINDING_INVALID");
  assertDigest(assertedSourceSetDigest, "RECOVERY_AUTHORITY_ARTIFACT_BINDING_INVALID");
  if (assertedSourceSetDigest !== options.sourceSet.sourceSetDigest) refuse("RECOVERY_AUTHORITY_ARTIFACT_BINDING_MISMATCH");

  const consumerTypeMap = new Map<string, V3Consumer["kind"]>([[type.contract, "contract"], [type.requirement, "requirement"], [type.consumer, "consumer"]]);
  const consumers = authorityLinks(graph, options.authorityIri, predicate.consumer, "RECOVERY_AUTHORITY_CONSUMER_INVALID", true).map((iri): V3Consumer => {
    checkDeadline();
    const kinds = [...consumerTypeMap].filter(([typeIri]) => authorityHasType(graph, iri, typeIri));
    if (kinds.length !== 1) refuse("RECOVERY_AUTHORITY_CONSUMER_INVALID", { iri });
    const status = exactAuthorityValue(graph, iri, predicate.recoveryStatus, "literal", "RECOVERY_AUTHORITY_CONSUMER_INVALID");
    if (!["unsatisfied", "satisfied", "unknown"].includes(status)) refuse("RECOVERY_AUTHORITY_CONSUMER_INVALID", { iri, status });
    return { iri, kind: kinds[0]?.[1] as V3Consumer["kind"], digest: resourceDigest(graph, iri), status: status as V3Consumer["status"] };
  });
  const connections = authorityLinks(graph, options.authorityIri, predicate.connection, "RECOVERY_AUTHORITY_CONNECTION_INVALID").map((iri) => {
    checkDeadline();
    requireAuthorityType(graph, iri, type.connection, "RECOVERY_AUTHORITY_CONNECTION_INVALID");
    const targetIri = exactAuthorityValue(graph, iri, predicate.target, "iri", "RECOVERY_AUTHORITY_CONNECTION_INVALID");
    const relationType = exactAuthorityValue(graph, iri, predicate.relationType, "literal", "RECOVERY_AUTHORITY_CONNECTION_INVALID");
    assertIri(targetIri, "RECOVERY_AUTHORITY_CONNECTION_INVALID");
    if (!resourceExists(graph, targetIri)) refuse("RECOVERY_AUTHORITY_CONNECTION_TARGET_UNRESOLVED", { iri, targetIri });
    assertNonEmpty(relationType, "RECOVERY_AUTHORITY_CONNECTION_INVALID");
    return { targetIri, relationType, digest: resourceDigest(graph, iri) };
  });
  const validationObligationDigests = authorityResourceDigests(graph, authorityLinks(graph, options.authorityIri, predicate.validationObligation, "RECOVERY_AUTHORITY_VALIDATION_OBLIGATION_INVALID", true), type.validationObligation, "RECOVERY_AUTHORITY_VALIDATION_OBLIGATION_INVALID", checkDeadline);
  const testObligationDigests = authorityResourceDigests(graph, authorityLinks(graph, options.authorityIri, predicate.testObligation, "RECOVERY_AUTHORITY_TEST_OBLIGATION_INVALID", true), type.testObligation, "RECOVERY_AUTHORITY_TEST_OBLIGATION_INVALID", checkDeadline);

  const lessonTypes = new Map<string, AdverseLesson["kind"]>([[type.adverseLesson, "adverse-lesson"], [type.retirement, "retirement"], [type.supersession, "supersession"], [type.defect, "defect"], [type.operationalFailure, "operational-failure"]]);
  const adverseLessons = authorityLinks(graph, options.authorityIri, predicate.adverseLesson, "RECOVERY_AUTHORITY_LESSON_INVALID", true).map((id): AdverseLesson => {
    checkDeadline();
    const kinds = [...lessonTypes].filter(([typeIri]) => authorityHasType(graph, id, typeIri));
    if (kinds.length !== 1) refuse("RECOVERY_AUTHORITY_LESSON_INVALID", { id });
    const sourceIds = authorityLinks(graph, id, predicate.source, "RECOVERY_AUTHORITY_LESSON_INVALID", true);
    return { id, kind: kinds[0]?.[1] as AdverseLesson["kind"], sourceIds, evidenceDigest: resourceDigest(graph, id) };
  });
  const bauPolicy = authorityLinks(graph, options.authorityIri, predicate.bauPolicy, "RECOVERY_AUTHORITY_BAU_POLICY_INVALID", true).map((iri) => {
    checkDeadline();
    requireAuthorityType(graph, iri, type.bauPolicy, "RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    const dimension = exactAuthorityValue(graph, iri, predicate.dimension, "literal", "RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    const rawMaximum = exactAuthorityValue(graph, iri, predicate.maximumCeiling, "literal", "RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    const unit = exactAuthorityValue(graph, iri, predicate.unit, "literal", "RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    if (!(requiredBauDimensions as readonly string[]).includes(dimension) || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(rawMaximum)) refuse("RECOVERY_AUTHORITY_BAU_POLICY_INVALID", { iri });
    const maximumCeiling = Number(rawMaximum);
    if (!Number.isFinite(maximumCeiling)) refuse("RECOVERY_AUTHORITY_BAU_POLICY_INVALID", { iri });
    assertNonEmpty(unit, "RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    return { dimension: dimension as BauDimension, maximumCeiling, unit };
  });
  const licenceDecisions = authorityLinks(graph, options.authorityIri, predicate.licenceDecision, "RECOVERY_AUTHORITY_LICENCE_INVALID", true).map((iri) => {
    checkDeadline();
    requireAuthorityType(graph, iri, type.licenceDecision, "RECOVERY_AUTHORITY_LICENCE_INVALID");
    const sourceId = exactAuthorityValue(graph, iri, predicate.source, "iri", "RECOVERY_AUTHORITY_LICENCE_INVALID");
    const status = exactAuthorityValue(graph, iri, predicate.decisionStatus, "literal", "RECOVERY_AUTHORITY_LICENCE_INVALID");
    if (!["cleared-for-original-v3-reexpression", "metadata-only", "unresolved"].includes(status)) refuse("RECOVERY_AUTHORITY_LICENCE_INVALID", { iri });
    return { sourceId, status: status as RecoveryAuthorityContext["licenceDecisions"][number]["status"], decisionDigest: resourceDigest(graph, iri) };
  });
  const layerDecisions = authorityLinks(graph, options.authorityIri, predicate.layerDecision, "RECOVERY_AUTHORITY_LAYER_INVALID", true).map((iri) => {
    checkDeadline();
    requireAuthorityType(graph, iri, type.layerDecision, "RECOVERY_AUTHORITY_LAYER_INVALID");
    const targetIri = exactAuthorityValue(graph, iri, predicate.target, "iri", "RECOVERY_AUTHORITY_LAYER_INVALID");
    if (!resourceExists(graph, targetIri)) refuse("RECOVERY_AUTHORITY_LAYER_TARGET_UNRESOLVED", { iri, targetIri });
    const targetLayer = exactAuthorityValue(graph, iri, predicate.targetLayer, "literal", "RECOVERY_AUTHORITY_LAYER_INVALID");
    const productProfileIri = optionalAuthorityValue(graph, iri, predicate.productProfile, "iri", "RECOVERY_AUTHORITY_LAYER_INVALID");
    if (productProfileIri !== null) requireAuthorityType(graph, productProfileIri, type.profile, "RECOVERY_AUTHORITY_LAYER_INVALID");
    const productProfileVersion = productProfileIri === null ? null : exactAuthorityValue(graph, productProfileIri, predicate.version, "literal", "RECOVERY_AUTHORITY_LAYER_INVALID");
    const isolationStatus = exactAuthorityValue(graph, iri, predicate.isolationStatus, "literal", "RECOVERY_AUTHORITY_LAYER_INVALID");
    if (!["core", "product"].includes(targetLayer) || !["cleared", "violated"].includes(isolationStatus) || (targetLayer === "core" && productProfileIri !== null) || (targetLayer === "product" && productProfileIri === null)) refuse("RECOVERY_AUTHORITY_LAYER_INVALID", { iri });
    return { targetIri, targetLayer: targetLayer as "core" | "product", productProfileIri, productProfileVersion, isolationStatus: isolationStatus as "cleared" | "violated", decisionDigest: resourceDigest(graph, iri) };
  });
  const allowedReviewDigests = authorityResourceDigests(graph, authorityLinks(graph, options.authorityIri, predicate.allowedReview, "RECOVERY_AUTHORITY_REVIEW_INVALID", true), type.review, "RECOVERY_AUTHORITY_REVIEW_INVALID", checkDeadline);
  const acceptedNewRootExceptionDigests = authorityResourceDigests(graph, authorityLinks(graph, options.authorityIri, predicate.acceptedNewRootException, "RECOVERY_AUTHORITY_NEW_ROOT_EXCEPTION_INVALID"), type.newRootException, "RECOVERY_AUTHORITY_NEW_ROOT_EXCEPTION_INVALID", checkDeadline);
  let closureDigest: string;
  try {
    const closure = transitiveResourceIris(graph, [options.authorityIri, options.profileIri], limits.maxConnections + limits.maxConsumers + limits.maxAdverseLessons + limits.maxReviewDigests + requiredBauDimensions.length + limits.maxSources);
    closureDigest = canonicalDigest(closure.map((iri) => ({ iri, digest: resourceDigest(graph, iri) })));
  } catch (error) {
    return refuse("RECOVERY_AUTHORITY_CLOSURE_INVALID", { cause: error instanceof Error ? error.message : "unknown" });
  }
  const authority: RecoveryAuthorityContext = deepFreeze({
    sourceSet: structuredClone(options.sourceSet),
    acceptedInventoryDigest: options.inventory.inventoryDigest,
    acceptedRecoveryDigest: options.config.recoveryDigest,
    v3Selection: {
      profileIri: options.profileIri,
      profileVersion,
      semanticDigest: graph.semanticDigest,
      closureDigest,
      consumers: consumers.sort((left, right) => compareText(left.iri, right.iri)),
      connections: connections.sort((left, right) => compareText(left.digest, right.digest)),
      validationObligationDigests,
      testObligationDigests,
    },
    adverseLessons: adverseLessons.sort((left, right) => compareText(left.id, right.id)),
    bauPolicy: bauPolicy.sort((left, right) => compareText(left.dimension, right.dimension)),
    licenceDecisions: licenceDecisions.sort((left, right) => compareText(left.sourceId, right.sourceId)),
    layerDecisions: layerDecisions.sort((left, right) => compareText(left.targetIri, right.targetIri) || compareText(left.targetLayer, right.targetLayer)),
    allowedReviewDigests,
    acceptedNewRootExceptionDigests,
  });
  authenticatedRecoveryAuthorities.add(authority);
  try { validateRecoveryAuthority(authority, options.config, limits); }
  catch (error) { authenticatedRecoveryAuthorities.delete(authority); throw error; }
  return authority;
}

function validateV3Selection(value: V3RecoverySelection, limits: RecoveryLimits): void {
  if (!isRecord(value) || !exactKeys(value, ["profileIri", "profileVersion", "semanticDigest", "closureDigest", "consumers", "connections", "validationObligationDigests", "testObligationDigests"]) || !Array.isArray(value.consumers) || !Array.isArray(value.connections) || !Array.isArray(value.validationObligationDigests) || !Array.isArray(value.testObligationDigests)) refuse("RECOVERY_V3_SELECTION_INVALID");
  assertIri(value.profileIri, "RECOVERY_V3_SELECTION_INVALID");
  assertNonEmpty(value.profileVersion, "RECOVERY_V3_SELECTION_INVALID");
  assertDigest(value.semanticDigest, "RECOVERY_V3_SELECTION_INVALID");
  assertDigest(value.closureDigest, "RECOVERY_V3_SELECTION_INVALID");
  if (value.consumers.length > limits.maxConsumers || value.connections.length > limits.maxConnections || value.validationObligationDigests.length > limits.maxReviewDigests || value.testObligationDigests.length > limits.maxReviewDigests) refuse("RECOVERY_V3_SELECTION_LIMIT_EXCEEDED");
  for (const digest of [...value.validationObligationDigests, ...value.testObligationDigests]) assertDigest(digest, "RECOVERY_V3_SELECTION_INVALID");
  sortedUnique(value.validationObligationDigests, "RECOVERY_V3_SELECTION_DUPLICATE");
  sortedUnique(value.testObligationDigests, "RECOVERY_V3_SELECTION_DUPLICATE");
  for (const consumer of value.consumers) {
    if (!isRecord(consumer) || !exactKeys(consumer, ["iri", "kind", "digest", "status"])) refuse("RECOVERY_V3_CONSUMER_INVALID");
    assertIri(consumer.iri, "RECOVERY_V3_CONSUMER_INVALID");
    assertDigest(consumer.digest, "RECOVERY_V3_CONSUMER_INVALID");
    if (!["contract", "requirement", "consumer"].includes(String(consumer.kind)) || !["unsatisfied", "satisfied", "unknown"].includes(String(consumer.status))) refuse("RECOVERY_V3_CONSUMER_INVALID");
  }
  sortedUnique(value.consumers.map((item) => item.iri), "RECOVERY_V3_CONSUMER_DUPLICATE");
  for (const connection of value.connections) {
    if (!isRecord(connection) || !exactKeys(connection, ["targetIri", "relationType", "digest"])) refuse("RECOVERY_V3_CONNECTION_INVALID");
    assertIri(connection.targetIri, "RECOVERY_V3_CONNECTION_INVALID");
    assertNonEmpty(connection.relationType, "RECOVERY_V3_CONNECTION_INVALID");
    assertDigest(connection.digest, "RECOVERY_V3_CONNECTION_INVALID");
  }
  sortedUnique(value.connections.map((item) => item.digest), "RECOVERY_V3_CONNECTION_DUPLICATE");
}

function validateRecoveryAuthority(authority: RecoveryAuthorityContext, config: RecoveryConfig, limits: RecoveryLimits): void {
  if (!isRecord(authority) || !authenticatedRecoveryAuthorities.has(authority)) refuse("RECOVERY_AUTHORITY_UNAUTHENTIC");
  if (!isRecord(authority) || !exactKeys(authority, ["sourceSet", "acceptedInventoryDigest", "acceptedRecoveryDigest", "v3Selection", "adverseLessons", "bauPolicy", "licenceDecisions", "layerDecisions", "allowedReviewDigests", "acceptedNewRootExceptionDigests"]) || !Array.isArray(authority.adverseLessons) || !Array.isArray(authority.bauPolicy) || !Array.isArray(authority.licenceDecisions) || !Array.isArray(authority.layerDecisions) || !Array.isArray(authority.allowedReviewDigests) || !Array.isArray(authority.acceptedNewRootExceptionDigests)) refuse("RECOVERY_AUTHORITY_INVALID");
  validateSourceSet(authority.sourceSet, limits);
  if (authority.sourceSet.sourceSetDigest !== config.sourceSetDigest) refuse("RECOVERY_AUTHORITY_SOURCE_SET_MISMATCH");
  assertDigest(authority.acceptedInventoryDigest, "RECOVERY_AUTHORITY_CURRENTNESS_INVALID");
  assertDigest(authority.acceptedRecoveryDigest, "RECOVERY_AUTHORITY_CURRENTNESS_INVALID");
  if (authority.acceptedInventoryDigest !== config.inventoryDigest || authority.acceptedRecoveryDigest !== config.recoveryDigest) refuse("RECOVERY_AUTHORITY_CURRENTNESS_MISMATCH");
  validateV3Selection(authority.v3Selection, limits);
  if (authority.adverseLessons.length > limits.maxAdverseLessons || authority.bauPolicy.length > requiredBauDimensions.length || authority.licenceDecisions.length > limits.maxSources || authority.layerDecisions.length > limits.maxConnections || authority.allowedReviewDigests.length > limits.maxReviewDigests || authority.acceptedNewRootExceptionDigests.length > limits.maxReviewDigests) refuse("RECOVERY_AUTHORITY_LIMIT_EXCEEDED");
  if (authority.adverseLessons.length === 0) refuse("RECOVERY_AUTHORITY_LESSON_DENOMINATOR_MISMATCH");
  const sourceIds = new Set(authority.sourceSet.sources.map((source) => source.id));
  const lessonIds = new Set<string>();
  for (const lesson of authority.adverseLessons) {
    if (!isRecord(lesson) || !exactKeys(lesson, ["id", "kind", "sourceIds", "evidenceDigest"]) || !Array.isArray(lesson.sourceIds) || lesson.sourceIds.length === 0) refuse("RECOVERY_AUTHORITY_LESSON_INVALID");
    if (lesson.sourceIds.length > limits.maxSources) refuse("RECOVERY_AUTHORITY_LESSON_INVALID");
    assertNonEmpty(lesson.id, "RECOVERY_AUTHORITY_LESSON_INVALID");
    assertDigest(lesson.evidenceDigest, "RECOVERY_AUTHORITY_LESSON_INVALID");
    if (lesson.sourceIds.some((id) => !sourceIds.has(id)) || lessonIds.has(lesson.id)) refuse("RECOVERY_AUTHORITY_LESSON_INVALID");
    lessonIds.add(lesson.id);
  }
  for (const sourceId of sourceIds) if (!authority.adverseLessons.some((lesson) => lesson.sourceIds.includes(sourceId))) refuse("RECOVERY_AUTHORITY_LESSON_DENOMINATOR_MISSING", { sourceId });
  const policies = new Map<BauDimension, RecoveryAuthorityContext["bauPolicy"][number]>();
  for (const policy of authority.bauPolicy) {
    if (!isRecord(policy) || !exactKeys(policy, ["dimension", "maximumCeiling", "unit"]) || typeof policy.dimension !== "string" || !(requiredBauDimensions as readonly string[]).includes(policy.dimension) || typeof policy.maximumCeiling !== "number" || !Number.isFinite(policy.maximumCeiling) || policy.maximumCeiling < 0) refuse("RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    assertNonEmpty(policy.unit, "RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    const typedPolicy = policy as unknown as RecoveryAuthorityContext["bauPolicy"][number];
    if (policies.has(typedPolicy.dimension)) refuse("RECOVERY_AUTHORITY_BAU_POLICY_INVALID");
    policies.set(typedPolicy.dimension, typedPolicy);
  }
  if (policies.size !== requiredBauDimensions.length) refuse("RECOVERY_AUTHORITY_BAU_POLICY_INCOMPLETE");
  const decisions = new Set<string>();
  for (const decision of authority.licenceDecisions) {
    if (!isRecord(decision) || !exactKeys(decision, ["sourceId", "status", "decisionDigest"])) refuse("RECOVERY_AUTHORITY_LICENCE_INVALID");
    assertIri(decision.sourceId, "RECOVERY_AUTHORITY_LICENCE_INVALID");
    assertNonEmpty(decision.status, "RECOVERY_AUTHORITY_LICENCE_INVALID");
    if (!sourceIds.has(decision.sourceId) || !["cleared-for-original-v3-reexpression", "metadata-only", "unresolved"].includes(decision.status)) refuse("RECOVERY_AUTHORITY_LICENCE_INVALID");
    assertDigest(decision.decisionDigest, "RECOVERY_AUTHORITY_LICENCE_INVALID");
    if (decisions.has(decision.sourceId)) refuse("RECOVERY_AUTHORITY_LICENCE_INVALID");
    decisions.add(decision.sourceId);
  }
  if (decisions.size !== sourceIds.size) refuse("RECOVERY_AUTHORITY_LICENCE_INCOMPLETE");
  const layerKeys = new Set<string>();
  for (const decision of authority.layerDecisions) {
    if (!isRecord(decision) || !exactKeys(decision, ["targetIri", "targetLayer", "productProfileIri", "productProfileVersion", "isolationStatus", "decisionDigest"]) || !["core", "product"].includes(String(decision.targetLayer)) || !["cleared", "violated"].includes(String(decision.isolationStatus))) refuse("RECOVERY_AUTHORITY_LAYER_INVALID");
    assertIri(decision.targetIri, "RECOVERY_AUTHORITY_LAYER_INVALID");
    if (decision.productProfileIri !== null) assertIri(decision.productProfileIri, "RECOVERY_AUTHORITY_LAYER_INVALID");
    if (decision.productProfileVersion !== null) assertNonEmpty(decision.productProfileVersion, "RECOVERY_AUTHORITY_LAYER_INVALID");
    assertDigest(decision.decisionDigest, "RECOVERY_AUTHORITY_LAYER_INVALID");
    if ((decision.targetLayer === "core" && (decision.productProfileIri !== null || decision.productProfileVersion !== null)) || (decision.targetLayer === "product" && (decision.productProfileIri === null || decision.productProfileVersion === null))) refuse("RECOVERY_AUTHORITY_LAYER_INVALID");
    const key = `${decision.targetIri}|${decision.targetLayer}`;
    if (layerKeys.has(key)) refuse("RECOVERY_AUTHORITY_LAYER_INVALID");
    layerKeys.add(key);
  }
  if (authority.layerDecisions.length === 0) refuse("RECOVERY_AUTHORITY_LAYER_INCOMPLETE");
  if (authority.allowedReviewDigests.length === 0) refuse("RECOVERY_AUTHORITY_REVIEW_INVALID");
  for (const digest of [...authority.allowedReviewDigests, ...authority.acceptedNewRootExceptionDigests]) assertDigest(digest, "RECOVERY_AUTHORITY_REVIEW_INVALID");
  sortedUnique(authority.allowedReviewDigests, "RECOVERY_AUTHORITY_REVIEW_INVALID");
  sortedUnique(authority.acceptedNewRootExceptionDigests, "RECOVERY_AUTHORITY_REVIEW_INVALID");
}

function candidateRuleKeys(candidateItem: RecoveryCandidate): string[] {
  const base = { sourceId: candidateItem.identity.logicalSourceId, candidateKind: candidateItem.identity.candidateKind };
  const values = [canonicalDigest(base)];
  for (const exactType of candidateItem.typeIris) values.push(canonicalDigest({ ...base, exactType }));
  if (candidateItem.predicate !== null) values.push(canonicalDigest({ ...base, predicate: candidateItem.predicate }));
  values.push(canonicalDigest({ ...base, pathClass: candidateItem.pathClass }));
  return [...new Set(values)];
}

/** Resolve every canonical candidate through one exact row or one most-specific compact rule. */
export function compileSemanticRecovery(
  inventory: LegacyGraphInventory,
  configValue: RecoveryConfig,
  authority: RecoveryAuthorityContext,
  limitOverrides: Partial<RecoveryLimits> = {},
): SemanticCoverageReport {
  const limits = checkedLimits(limitOverrides);
  const checkDeadline = recoveryDeadline(limits);
  validateConfigShape(configValue, limits);
  validateRecoveryAuthority(authority, configValue, limits);
  verifyLegacyGraphInventoryWithin(inventory, authority.sourceSet, limits, checkDeadline);
  if (configValue.sourceSetDigest !== inventory.sourceSetDigest || configValue.inventoryDigest !== inventory.inventoryDigest) refuse("RECOVERY_CONFIG_CURRENTNESS_MISMATCH");
  const sourceIds = new Set(inventory.sources.map((source) => source.sourceId));
  const candidateById = new Map(inventory.candidates.map((item) => [item.candidateId, item]));

  const lessons = new Set<string>();
  for (const lesson of authority.adverseLessons) {
    if (!isRecord(lesson) || !exactKeys(lesson, ["id", "kind", "sourceIds", "evidenceDigest"]) || !Array.isArray(lesson.sourceIds)) refuse("RECOVERY_ADVERSE_LESSON_INVALID");
    assertNonEmpty(lesson.id, "RECOVERY_ADVERSE_LESSON_INVALID");
    assertDigest(lesson.evidenceDigest, "RECOVERY_ADVERSE_LESSON_INVALID");
    if (!["adverse-lesson", "retirement", "supersession", "defect", "operational-failure"].includes(lesson.kind) || lesson.sourceIds.length === 0 || lesson.sourceIds.some((id) => !sourceIds.has(id))) refuse("RECOVERY_ADVERSE_LESSON_INVALID");
    if (lessons.has(lesson.id)) refuse("RECOVERY_ADVERSE_LESSON_DUPLICATE");
    lessons.add(lesson.id);
  }

  const exact = new Map<string, ExactDisposition>();
  for (const row of configValue.exactDispositions) {
    if (!isRecord(row) || !exactKeys(row, ["candidateId", "resolution", "provenance"])) refuse("RECOVERY_EXACT_DISPOSITION_INVALID");
    assertDigest(row.candidateId, "RECOVERY_EXACT_DISPOSITION_INVALID");
    validateDispositionResolution(row.resolution);
    validateProvenance(row.provenance);
    if (!authority.allowedReviewDigests.includes(row.provenance.reviewDigest)) refuse("RECOVERY_PROVENANCE_UNAUTHORIZED");
    if (!candidateById.has(row.candidateId)) refuse("RECOVERY_EXACT_CANDIDATE_UNKNOWN", { candidateId: row.candidateId });
    if (exact.has(row.candidateId)) refuse("RECOVERY_EXACT_DISPOSITION_DUPLICATE", { candidateId: row.candidateId });
    exact.set(row.candidateId, row);
  }

  const ruleIds = new Set<string>();
  const ruleMatchesSeen = new Set<string>();
  const rulesByMatch = new Map<string, CompactDispositionRule>();
  const ruleUseCounts = new Map<string, number>();
  for (const rule of configValue.rules) {
    checkDeadline();
    if (!isRecord(rule) || !exactKeys(rule, ["id", "match", "resolution", "provenance"]) || !isRecord(rule.match) || !exactKeys(rule.match, ["sourceId", "candidateKind"], ["exactType", "predicate", "pathClass"]) || ruleSpecificity(rule.match) < 2) refuse("RECOVERY_RULE_INVALID");
    assertNonEmpty(rule.id, "RECOVERY_RULE_INVALID");
    assertIri(rule.match.sourceId, "RECOVERY_RULE_INVALID");
    if (!sourceIds.has(rule.match.sourceId)) refuse("RECOVERY_RULE_SOURCE_UNKNOWN");
    if (rule.match.exactType !== undefined) assertIri(rule.match.exactType, "RECOVERY_RULE_INVALID");
    if (rule.match.predicate !== undefined) assertIri(rule.match.predicate, "RECOVERY_RULE_INVALID");
    if (rule.match.pathClass !== undefined) assertNonEmpty(rule.match.pathClass, "RECOVERY_RULE_INVALID");
    if ([rule.match.exactType, rule.match.predicate, rule.match.pathClass].filter((field) => field !== undefined).length > 1) refuse("RECOVERY_RULE_DISCRIMINATOR_INVALID");
    assertNonEmpty(rule.match.candidateKind, "RECOVERY_RULE_INVALID");
    if (!(recoveryCandidateKinds as readonly string[]).includes(rule.match.candidateKind)) refuse("RECOVERY_RULE_INVALID");
    validateDispositionResolution(rule.resolution);
    if (rule.resolution.disposition === "re-express-ready") refuse("RECOVERY_RULE_READY_FORBIDDEN");
    validateProvenance(rule.provenance);
    if (!authority.allowedReviewDigests.includes(rule.provenance.reviewDigest)) refuse("RECOVERY_PROVENANCE_UNAUTHORIZED");
    if (ruleIds.has(rule.id)) refuse("RECOVERY_RULE_DUPLICATE");
    const matchDigest = canonicalDigest(rule.match);
    if (ruleMatchesSeen.has(matchDigest)) refuse("RECOVERY_RULE_DUPLICATE_MATCH");
    ruleIds.add(rule.id);
    ruleMatchesSeen.add(matchDigest);
    rulesByMatch.set(matchDigest, rule);
    ruleUseCounts.set(rule.id, 0);
  }

  const readinessByDigest = new Map<string, AdoptionReadinessRecord>();
  const readinessByCandidate = new Set<string>();
  for (const record of configValue.readinessRecords) {
    checkDeadline();
    if (!isRecord(record)) refuse("RECOVERY_READINESS_RECORD_INVALID");
    assertDigest(record.readinessDigest, "RECOVERY_READINESS_RECORD_INVALID");
    assertDigest(record.reviewDigest, "RECOVERY_READINESS_RECORD_INVALID");
    if (!authority.allowedReviewDigests.includes(record.reviewDigest)) refuse("RECOVERY_READINESS_REVIEW_UNAUTHORIZED");
    if (readinessByDigest.has(record.readinessDigest)) refuse("RECOVERY_READINESS_RECORD_DUPLICATE");
    if (typeof record.candidateId !== "string" || readinessByCandidate.has(record.candidateId)) refuse("RECOVERY_READINESS_CANDIDATE_DUPLICATE");
    readinessByDigest.set(record.readinessDigest, record as unknown as AdoptionReadinessRecord);
    readinessByCandidate.add(record.candidateId);
  }

  const mappingIds = new Set<string>();
  for (const mapping of configValue.reviewedMappings) {
    checkDeadline();
    if (!isRecord(mapping) || !exactKeys(mapping, ["id", "kind", "sourceCandidateIds", "targetV3Iris", "reviewDigest"]) || !Array.isArray(mapping.sourceCandidateIds) || !Array.isArray(mapping.targetV3Iris) || mapping.sourceCandidateIds.length === 0 || mapping.targetV3Iris.length === 0) refuse("RECOVERY_MAPPING_INVALID");
    assertNonEmpty(mapping.id, "RECOVERY_MAPPING_INVALID");
    assertDigest(mapping.reviewDigest, "RECOVERY_MAPPING_INVALID");
    if (mapping.sourceCandidateIds.length > limits.maxMappingItems || mapping.targetV3Iris.length > limits.maxMappingItems) refuse("RECOVERY_MAPPING_LIMIT_EXCEEDED");
    if (!authority.allowedReviewDigests.includes(mapping.reviewDigest)) refuse("RECOVERY_MAPPING_REVIEW_UNAUTHORIZED");
    if (!["split", "merge", "equivalent", "replacement"].includes(mapping.kind) || mapping.sourceCandidateIds.some((id) => !candidateById.has(id))) refuse("RECOVERY_MAPPING_INVALID");
    sortedUnique(mapping.sourceCandidateIds, "RECOVERY_MAPPING_SOURCE_DUPLICATE");
    for (const iri of mapping.targetV3Iris) assertIri(iri, "RECOVERY_MAPPING_INVALID");
    sortedUnique(mapping.targetV3Iris, "RECOVERY_MAPPING_TARGET_DUPLICATE");
    if (mappingIds.has(mapping.id)) refuse("RECOVERY_MAPPING_DUPLICATE");
    mappingIds.add(mapping.id);
  }

  const compiled: CompiledCandidateDisposition[] = [];
  const usedReadinessDigests = new Set<string>();
  const counts: Record<RecoveryDisposition, number> = { "re-express-ready": 0, "metadata-only": 0, defer: 0, "not-claimed": 0, "historical-only": 0, reject: 0, unresolved: 0 };
  for (const candidateItem of inventory.candidates) {
    checkDeadline();
    const exactRow = exact.get(candidateItem.candidateId);
    let resolution: DispositionResolution;
    let provenanceKind: "exact" | "rule";
    let provenanceId: string;
    let provenanceDigest: string;
    if (exactRow) {
      resolution = exactRow.resolution;
      provenanceKind = "exact";
      provenanceId = exactRow.provenance.reviewId;
      provenanceDigest = exactRow.provenance.reviewDigest;
    } else {
      const matching = candidateRuleKeys(candidateItem).map((key) => rulesByMatch.get(key)).filter((rule): rule is CompactDispositionRule => rule !== undefined && ruleMatches(candidateItem, rule.match));
      if (matching.length === 0) refuse("RECOVERY_COVERAGE_UNMATCHED", { candidateId: candidateItem.candidateId });
      for (const rule of matching) ruleUseCounts.set(rule.id, (ruleUseCounts.get(rule.id) ?? 0) + 1);
      const mostSpecific = matching.filter((rule) => matching.every((other) => rule === other || (ruleSpecificity(rule.match) > ruleSpecificity(other.match) && extendsRule(rule.match, other.match))));
      if (mostSpecific.length !== 1) refuse("RECOVERY_COVERAGE_AMBIGUOUS", { candidateId: candidateItem.candidateId, ruleIds: mostSpecific.map((rule) => rule.id).sort(compareText) });
      const rule = mostSpecific[0] as CompactDispositionRule;
      resolution = rule.resolution;
      provenanceKind = "rule";
      provenanceId = rule.id;
      provenanceDigest = rule.provenance.reviewDigest;
    }

    const readinessRecord = resolution.readinessRecordDigest === null ? undefined : readinessByDigest.get(resolution.readinessRecordDigest);
    if (resolution.readinessRecordDigest !== null) usedReadinessDigests.add(resolution.readinessRecordDigest);
    const readiness = resolution.disposition === "re-express-ready"
      ? evaluateAdoptionReadiness(candidateItem, readinessRecord, configValue, authority, resolution.targetV3Iri, limits)
      : deepFreeze({ status: "unresolved" as const, disposition: "unresolved" as const, reasons: ["READINESS_NOT_REQUESTED"], readinessDigest: null });
    const effective = resolution.disposition === "re-express-ready" ? readiness.disposition : resolution.disposition;
    counts[effective] += 1;
    compiled.push({
      candidateId: candidateItem.candidateId,
      requestedDisposition: resolution.disposition,
      disposition: effective,
      provenanceKind,
      provenanceId,
      provenanceDigest,
      rationale: resolution.rationale,
      targetV3Iri: resolution.targetV3Iri,
      definitionCoverageState: resolution.definitionCoverageState,
      operationalImplementationState: resolution.operationalImplementationState,
      readiness,
    });
  }
  if (compiled.length !== inventory.candidates.length) refuse("RECOVERY_COVERAGE_INCOMPLETE");
  const staleRules = [...ruleUseCounts].filter(([, count]) => count === 0).map(([ruleId]) => ruleId).sort(compareText);
  if (staleRules.length > 0) refuse("RECOVERY_RULE_ZERO_MATCH", { ruleIds: staleRules });
  const staleReadiness = [...readinessByDigest.keys()].filter((digest) => !usedReadinessDigests.has(digest)).sort(compareText);
  if (staleReadiness.length > 0) refuse("RECOVERY_READINESS_RECORD_ZERO_USE", { readinessDigests: staleReadiness });
  const byCandidateKind = Object.fromEntries(recoveryCandidateKinds.map((kind) => [kind, 0])) as Record<RecoveryCandidateKind, number>;
  for (const candidateItem of inventory.candidates) byCandidateKind[candidateItem.identity.candidateKind] += 1;
  const byGraphSelectionKind = Object.fromEntries(legacyGraphSelectionKinds.map((kind) => [kind, 0])) as Record<LegacyManifestEntry["kind"], number>;
  for (const selection of inventory.graphSelections) byGraphSelectionKind[selection.kind] += 1;

  return deepFreeze({
    schema: "urn:usf:semantic-coverage-report:1",
    status: "complete",
    sourceSetDigest: inventory.sourceSetDigest,
    inventoryDigest: inventory.inventoryDigest,
    recoveryDigest: configValue.recoveryDigest,
    historicalReextraction: "not-independently-re-extracted",
    totals: {
      sources: inventory.sources.length,
      trackedFiles: inventory.trackedFiles.length,
      graphSelections: inventory.graphSelections.length,
      structuredRecords: inventory.structuredRecords.length,
      candidates: inventory.candidates.length,
      resolved: compiled.length,
      byCandidateKind,
      byGraphSelectionKind,
      byDisposition: counts,
    },
    candidates: compiled,
    nonclaims: [
      "Historical discovery and disposition do not create V3 semantic authority.",
      "A re-express-ready record still requires a later graph-defined V3-authored slice binding its readiness digest.",
      "The inventory contains metadata only and does not retain historical payload bytes.",
    ],
  });
}
