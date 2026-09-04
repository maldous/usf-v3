import { canonicalDigest } from "../core/canonical.ts";
import {
  observationSetDigest, type QualificationObservation,
  qualifySemanticProfile,
  qualificationDimensions,
  qualificationRoles,
  type QualificationAgentProfile,
  type QualificationAnswer,
  type QualificationAuthMode,
  type QualificationDimension,
  type QualificationPolicySnapshot,
  type QualificationRole,
  type QualificationSuiteSnapshot,
  type QualifiedRole,
} from "./qualification.ts";
import type { ProviderRouteConfig } from "./config.ts";
import { assertRealisationBasis, type RealisationBasis } from "../realisation/basis.ts";

export type RoutingStrategy = "all-eligible" | "diverse" | "fastest" | "review-diverse" | "deterministic-fixture";
export type RouteDisposition = "assigned" | "excluded" | "eligible-unassigned";
export type RouteExclusionReason =
  | "ADAPTER_UNAVAILABLE" | "CREDENTIAL_MISSING" | "CATALOGUE_ROUTE_MISSING"
  | "CATALOGUE_UNDERLYING_IDENTITY_MISMATCH" | "CAPABILITY_MISMATCH" | "PRIVACY_INELIGIBLE"
  | "COST_CLASS_INELIGIBLE" | "CATALOGUE_PRICE_UNKNOWN" | "CATALOGUE_PRICE_NONZERO"
  | "ENTITLEMENT_UNVERIFIED" | "ENTITLEMENT_ROUTE_MISMATCH" | "ENTITLEMENT_STALE"
  | "ENTITLEMENT_QUOTA_UNKNOWN" | "ENTITLEMENT_QUOTA_EXHAUSTED" | "FREE_QUOTA_UNAVAILABLE"
  | "PAID_FALLBACK_PROHIBITED" | "PROBE_MISSING" | "PROBE_INPUT_MISMATCH" | "PROBE_STALE"
  | "PROBE_FAILED" | "PROBE_QUOTA_UNKNOWN" | "PROBE_QUOTA_EXHAUSTED" | "PROBE_HEALTH_UNAVAILABLE"
  | "PROBE_ACTUAL_IDENTITY_MISSING" | "PROBE_ACTUAL_IDENTITY_MISMATCH" | "PROBE_COST_NONZERO"
  | "PROBE_COST_BASIS_UNKNOWN" | "SEMANTIC_QUALIFICATION_MISSING"
  | "SEMANTIC_QUALIFICATION_MISMATCH" | "SEMANTIC_QUALIFICATION_STALE"
  | "SEMANTIC_CAPABILITY_UNQUALIFIED";

export interface CoreSemanticBinding {
  readonly profile: string;
  readonly version: string;
  readonly profileDigest: string;
}

export type ProductSemanticBinding = Readonly<{
  applicability: "applicable";
  profile: string;
  version: string;
  profileDigest: string;
}> | Readonly<{
  applicability: "not-applicable";
  profile: "not-applicable";
  version: "not-applicable";
  profileDigest: "not-applicable";
}>;

export interface RoutingSemanticBinding {
  readonly core: Readonly<CoreSemanticBinding>;
  readonly product: ProductSemanticBinding;
  readonly directional: Readonly<{
    coreToProductDigest: string;
    productToCoreDigest: string;
  }>;
  readonly compositeDigest: string;
}

export interface EffectiveRoutingPolicy {
  readonly maximumPaidCost: 0;
  readonly paidFallback: "prohibited";
  readonly unknownPrice: "ineligible";
  readonly acceptedCostClasses: readonly ("local" | "zero-price" | "free-quota")[];
  readonly effectivePrivacy: Readonly<{
    workClassification: string;
    allowedRouteDeclarations: readonly string[];
  }>;
}

export interface ConfiguredRouteForRouting {
  readonly id: string;
  /** Digest of the exact ProviderRouteConfig before projection into routing fields. */
  readonly configDigest: string;
  readonly family: string;
  readonly provider: string;
  readonly model: string;
  /** Optional declarations are cross-checked, never used as catalogue authority. */
  readonly underlyingModelFamily?: string | null;
  readonly underlyingModel?: string | null;
  readonly adapter: string;
  readonly credential: string;
  readonly capabilities: readonly string[];
  readonly privacy: readonly string[];
  readonly costClass: "local" | "zero-price" | "free-quota" | "subscription" | "paid" | "unknown";
  readonly paidFallback: boolean;
  readonly entitlement: "verified" | "unknown" | "not-applicable";
  readonly concurrency: number;
}

export interface CataloguePricesForRouting {
  readonly input: number | null;
  readonly output: number | null;
  readonly reasoning: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
  readonly inputAudio: number | null;
  readonly outputAudio: number | null;
}

export interface CatalogueFactForRouting {
  readonly provider: string;
  readonly model: string;
  readonly underlyingModelFamily: string | null;
  readonly underlyingModel: string;
  /** Technical catalogue capabilities are retained but do not prove semantic task capabilities. */
  readonly capabilities: readonly string[];
  readonly prices: Readonly<CataloguePricesForRouting>;
}

/** Structural view of probe.ts output; the exact result digest is recomputed by routing. */
export interface ProbeForRouting {
  readonly schema: "urn:usf:probe-result:1";
  readonly status: "ok" | "failed";
  readonly reasonCode?: string;
  readonly routeId: string;
  readonly endpointOrigin: string | null;
  readonly serviceTier: "on_demand" | "default" | null;
  readonly requested: Readonly<{ family: string; provider: string; model: string }>;
  readonly actual?: Readonly<{ family: string; provider: string; model: string; sdkProvider: string | null }>;
  readonly inputs: Readonly<{
    routeDigest: string; catalogueRawDigest: string; catalogueNormalizedDigest: string; policyDigest: string;
    entitlementEvidenceDigest: string | null; probePromptDigest: string;
    adapterPackage: string; adapterVersion: string; adapterLockDigest: string;
  }>;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly capabilityEvaluations: readonly Readonly<{
    capability: "text-generation"; status: "available" | "unavailable" | "unknown"; reasonCode: string | null;
  }>[];
  readonly quota: "available" | "exhausted" | "unknown";
  readonly health: "available" | "unavailable" | "unknown";
  readonly cost: Readonly<{ observedCost: number | null; currency: "USD" | null; evidence: "provider-reported" | "entitlement" | "unavailable" }>;
  readonly usage: Readonly<{ inputTokens: number | null; outputTokens: number | null }>;
  readonly latencyMs: number | null;
  readonly limits: Readonly<{ timeoutMs: number; maxRetries: 0; maxOutputTokens: 8 }>;
  readonly externalContact: boolean;
  readonly authorityEffect: "none";
  readonly nonclaims: readonly string[];
  readonly resultDigest: string;
}

export interface SemanticQualificationAuthorityForRouting {
  readonly suiteDigest: string;
  readonly corpusDigest: string;
  readonly qualificationPolicyDigest: string;
}

export interface SemanticQualificationProfileForRouting {
  readonly routeId: string;
  readonly profileDigest: string;
}

export interface SemanticQualificationReplaySourceForRouting {
  readonly routeId: string;
  readonly taskClass: string;
  readonly profile: QualificationAgentProfile;
  /**
   * The observations the qualification was earned from. Replay regrades the
   * same invocations rather than the same asserted answers, so a receipt whose
   * evidence has been altered no longer reproduces its own digest.
   */
  readonly observations: readonly QualificationObservation[];
  readonly evaluatedAt: string;
}

export interface SemanticQualificationReplayForRouting {
  readonly sources: readonly SemanticQualificationReplaySourceForRouting[];
}

/** Supplied separately by the tracked Graph/file authority boundary, never by the replay envelope. */
export interface TrustedSemanticQualificationAuthorityForRouting {
  readonly suite: QualificationSuiteSnapshot;
  readonly policy: QualificationPolicySnapshot;
}

/** Structural view of qualification.ts output; routing deliberately owns no evaluation engine. */
export interface SemanticQualificationForRouting {
  readonly schema: "urn:usf:semantic-qualification-result:1";
  readonly status: "qualified" | "unqualified";
  /** One qualification task class authorizes at most the same named semantic capability. */
  readonly taskClass: string;
  readonly profile: Readonly<{
    profileDigest: string;
    requested: Readonly<{
      provider: string; model: string; adapter: string; adapterVersion: string; adapterLockDigest: string; authMode: QualificationAuthMode;
      toolProfile: string; promptVersion: string; contextConfig: string; outputConfig: string;
      toolProfileDigest: string; promptDigest: string; contextConfigDigest: string; outputConfigDigest: string;
    }>;
    actual: Readonly<{ provider: string; model: string; transport: string }>;
  }>;
  readonly inputs: Readonly<{
    suiteDigest: string; corpusDigest: string; qualificationPolicyDigest: string; effectivePolicyDigest: string;
    observationSetDigest: string;
  }>;
  readonly caseEvaluations: readonly Readonly<{
    caseId: string; taskClass: string; dimension: QualificationDimension; answerPresent: boolean; score: number; weight: number; passed: boolean;
  }>[];
  readonly dimensionEvaluations: readonly Readonly<{
    taskClass: string; dimension: QualificationDimension; score: number; answered: number; passed: number; total: number;
  }>[];
  readonly taskScore: number;
  readonly casesAnswered: number;
  readonly casesPassed: number;
  readonly casesTotal: number;
  readonly derivedRoles: readonly QualificationRole[];
  readonly observedAt: string;
  readonly evaluatedAt: string;
  readonly validUntil: string;
  readonly externalContact: false;
  readonly authorityEffect: "none";
  readonly nonclaims: readonly string[];
  readonly qualificationDigest: string;
}

export interface RoutingWork {
  readonly id: string;
  readonly digest: string;
  readonly semanticBinding: Readonly<RoutingSemanticBinding>;
  readonly capabilities: readonly string[];
  /** Graph-defined mapping; routing never infers qualification task classes from capability labels. */
  readonly semanticRequirements: readonly Readonly<{ capability: string; taskClass: string }>[];
  readonly privacy: string;
}

export interface RoutingInput {
  readonly basis: RealisationBasis;
  readonly work: RoutingWork;
  readonly routes: readonly ConfiguredRouteForRouting[];
  readonly catalogue: readonly CatalogueFactForRouting[];
  readonly probes: readonly ProbeForRouting[];
  readonly semanticQualificationAuthority: Readonly<SemanticQualificationAuthorityForRouting>;
  readonly semanticQualificationProfiles: readonly SemanticQualificationProfileForRouting[];
  readonly semanticQualifications: readonly SemanticQualificationForRouting[];
  readonly semanticQualificationReplay: Readonly<SemanticQualificationReplayForRouting>;
  readonly installedAdapters: ReadonlySet<string>;
  readonly credentialNamesPresent: ReadonlySet<string>;
  readonly catalogueRawDigest: string;
  readonly catalogueNormalizedDigest: string;
  readonly policyDigest: string;
  readonly providerConfigDigest: string;
  /** Exact effective cost/privacy policy. Its canonical digest must equal policyDigest. */
  readonly policy: Readonly<EffectiveRoutingPolicy>;
  readonly now: string;
  readonly strategy: RoutingStrategy;
  readonly hostConcurrency: number;
  readonly maxAssignments: number;
}

export interface RouteAssessment {
  readonly routeId: string;
  readonly family: string;
  readonly provider: string;
  readonly model: string;
  readonly underlyingModelFamily: string | null;
  readonly underlyingModel: string | null;
  readonly eligible: boolean;
  readonly disposition: RouteDisposition;
  readonly exclusionReason: RouteExclusionReason | null;
  readonly concurrency: number;
  readonly latencyMs: number | null;
  /** A successful text-generation probe is mechanical; all other entries require semantic qualification. */
  readonly mechanicalCapabilities: readonly string[];
  readonly semanticCapabilities: readonly string[];
  readonly semanticTaskClasses: readonly string[];
  readonly semanticQualificationDigest: string | null;
  readonly semanticQualificationInputDigest: string | null;
  readonly semanticQualificationValidUntil: string | null;
  readonly qualificationDigest: string | null;
  readonly qualificationValidUntil: string | null;
}

export type SemanticQualificationBindingForRouting = Readonly<{
  applicability: "required";
  requiredCapabilities: readonly string[];
  requiredTaskClasses: readonly string[];
  qualificationDigests: readonly string[];
  validityDigest: string;
}> | Readonly<{
  applicability: "not-required";
  requiredCapabilities: readonly [];
  requiredTaskClasses: readonly [];
  reason: "no-semantic-capabilities-required";
  validityDigest: "not-applicable";
}>;

export interface SemanticQualificationReferenceForRouting {
  readonly taskClass: string;
  readonly status: "qualified" | "unqualified";
  readonly qualificationDigest: string;
  readonly profileDigest: string;
  readonly suiteDigest: string;
  readonly corpusDigest: string;
  readonly qualificationPolicyDigest: string;
  readonly effectivePolicyDigest: string;
  readonly observationSetDigest: string;
  readonly actualIdentityDigest: string;
  readonly validityDigest: string;
  readonly validUntil: string;
}

export interface RouteQualificationBinding {
  readonly routeDigest: string;
  readonly providerRouteConfigDigest: string;
  readonly catalogueFactDigest: string;
  readonly probeDigest: string;
  readonly catalogueRawDigest: string;
  readonly catalogueNormalizedDigest: string;
  readonly probeSetDigest: string;
  readonly policyDigest: string;
  readonly entitlementEvidenceDigest: string | "not-applicable";
  readonly probeObservedAt: string;
  readonly probeExpiresAt: string;
  readonly latencyMs: number | null;
  readonly mechanicalCapabilities: readonly string[];
  readonly semanticQualification: SemanticQualificationBindingForRouting;
  readonly validAt: string;
  readonly validUntil: string;
  readonly qualificationDigest: string;
}

export interface RouteAssignment {
  readonly routeId: string;
  readonly requested: Readonly<{ family: string; provider: string; model: string }>;
  readonly actual: Readonly<{ family: string; provider: string; model: string }>;
  readonly underlying: Readonly<{ family: string | null; model: string }>;
  readonly workId: string;
  readonly basisDigest: string;
  readonly workDigest: string;
  readonly semanticBinding: Readonly<RoutingSemanticBinding>;
  readonly qualification: Readonly<RouteQualificationBinding>;
  readonly concurrency: number;
  readonly assignmentDigest: string;
}

export interface RouteResult {
  readonly schema: "urn:usf:route-result:1";
  readonly basis: RealisationBasis;
  readonly status: "ok" | "refused";
  readonly reasonCode?: "NO_ELIGIBLE_ROUTE";
  readonly strategy: RoutingStrategy;
  readonly inputs: Readonly<{
    workDigest: string;
    semanticBindingDigest: string;
    catalogueRawDigest: string;
    catalogueNormalizedDigest: string;
    probeSetDigest: string;
    policyDigest: string;
    semanticQualificationSuiteDigest: string;
    semanticQualificationCorpusDigest: string;
    semanticQualificationPolicyDigest: string;
    semanticQualificationSetDigest: string;
    providerConfigDigest: string;
    qualificationAt: string;
  }>;
  readonly denominators: Readonly<{
    configuredRoutes: number;
    assessedRoutes: number;
    eligibleRoutes: number;
    excludedRoutes: number;
    eligibleUnassignedRoutes: number;
    eligibleProviderFamilies: number;
    assignedRoutes: number;
  }>;
  readonly caps: Readonly<{ hostConcurrency: number; maxAssignments: number }>;
  readonly assessments: readonly RouteAssessment[];
  readonly semanticQualifications: readonly SemanticQualificationReferenceForRouting[];
  readonly assignments: readonly RouteAssignment[];
  readonly resultDigest: string;
  readonly externalContact: false;
  readonly authorityEffect: "none";
  readonly nonclaims: readonly string[];
}

const routingStrategies = new Set<RoutingStrategy>(["all-eligible", "diverse", "fastest", "review-diverse", "deterministic-fixture"]);
const safeCostClasses = new Set(["local", "zero-price", "free-quota"]);
const allCostClasses = new Set(["local", "zero-price", "free-quota", "subscription", "paid", "unknown"]);
const entitlementDeclarations = new Set(["verified", "unknown", "not-applicable"]);
const privacyClassifications = new Set(["public", "private-metadata", "private-source", "restricted", "local"]);
const mechanicalCapabilities = new Set(["text-generation"]);
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const labelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,191}$/;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+~-]{0,191}$/;
const capabilityPattern = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const adapterPattern = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,95}$/;
const credentialPattern = /^[A-Z_][A-Z0-9_]{0,127}$/;
const canonicalInstant = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const maximumRoutes = 100_000;
const maximumCap = 10_000;
const maximumLatencyMs = 9_000_000;
const priceDimensions = ["input", "output", "reasoning", "cacheRead", "cacheWrite", "inputAudio", "outputAudio"] as const;
const qualificationAuthModes = new Set<QualificationAuthMode>(["api_token", "oidc_cli", "local", "none"]);
const qualificationDimensionSet = new Set<QualificationDimension>(qualificationDimensions);
const qualificationRoleSet = new Set<QualificationRole>(qualificationRoles);

function exactDigest(value: unknown): string { return canonicalDigest(value, { rejectAbsolutePaths: true }); }
function validInstant(value: unknown): value is string {
  return typeof value === "string" && canonicalInstant.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function validPositiveInteger(value: unknown, maximum = maximumCap): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function validNonnegativeNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}
function validStrings(values: unknown, pattern: RegExp, maximum = 128): values is readonly string[] {
  return Array.isArray(values) && values.length <= maximum && values.every((value) => typeof value === "string" && pattern.test(value)) && new Set(values).size === values.length;
}
function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function includesAll(have: readonly string[], required: readonly string[]): boolean {
  const values = new Set(have); return required.every((value) => values.has(value));
}
function catalogueKey(provider: string, model: string): string { return `${provider}\u0000${model}`; }
/**
 * Qualifications are found by route identity rather than by a digest of the
 * route configuration. The configuration carries the declared cost and
 * entitlement, so keying on it made an economics edit silently orphan every
 * qualification for that route -- they would not be refused, they would simply
 * stop being found, and the route would report SEMANTIC_QUALIFICATION_MISSING
 * as if it had never been assessed.
 */
function routeIdentityKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}
function qualificationKey(routeIdentity: string, profileDigest: string, taskClass: string): string {
  return `${routeIdentity}\u0000${profileDigest}\u0000${taskClass}`;
}

function replaySourceKey(source: SemanticQualificationReplaySourceForRouting): string {
  const first = source.observations[0]!;
  return qualificationKey(
    routeIdentityKey(first.provider, first.requestedModel),
    exactDigest(source.profile),
    source.taskClass,
  );
}

function derivedSemanticDigests(core: Readonly<CoreSemanticBinding>, product: ProductSemanticBinding): Readonly<{
  directional: Readonly<{ coreToProductDigest: string; productToCoreDigest: string }>;
  compositeDigest: string;
}> {
  const coreToProductDigest = exactDigest({ direction: "core-to-product", core, product });
  const productToCoreDigest = exactDigest({ direction: "product-to-core", product, core });
  const directional = Object.freeze({ coreToProductDigest, productToCoreDigest });
  return Object.freeze({ directional, compositeDigest: exactDigest({ core, product, directional }) });
}

/** Construct, rather than self-attest, all semantic relation digests. */
export function createRoutingSemanticBinding(core: Readonly<CoreSemanticBinding>, product: ProductSemanticBinding): RoutingSemanticBinding {
  const safeCore = Object.freeze({ profile: core.profile, version: core.version, profileDigest: core.profileDigest });
  const safeProduct: ProductSemanticBinding = product.applicability === "applicable"
    ? Object.freeze({ applicability: product.applicability, profile: product.profile, version: product.version, profileDigest: product.profileDigest })
    : Object.freeze({ applicability: "not-applicable", profile: "not-applicable", version: "not-applicable", profileDigest: "not-applicable" });
  return Object.freeze({ core: safeCore, product: safeProduct, ...derivedSemanticDigests(safeCore, safeProduct) });
}

function validateSemanticBinding(binding: RoutingSemanticBinding): void {
  if (typeof binding !== "object" || binding === null || typeof binding.core !== "object" || binding.core === null
    || typeof binding.product !== "object" || binding.product === null || typeof binding.directional !== "object" || binding.directional === null
    || !exactKeys(binding, ["core", "product", "directional", "compositeDigest"])
    || !exactKeys(binding.core, ["profile", "version", "profileDigest"])
    || !exactKeys(binding.product, ["applicability", "profile", "version", "profileDigest"])
    || !exactKeys(binding.directional, ["coreToProductDigest", "productToCoreDigest"])
    || !labelPattern.test(binding.core.profile) || !labelPattern.test(binding.core.version) || !digestPattern.test(binding.core.profileDigest)
    || !digestPattern.test(binding.compositeDigest)) throw new Error("ROUTE_SEMANTIC_BINDING_INVALID");
  if (binding.product.applicability === "applicable") {
    if (!labelPattern.test(binding.product.profile) || !labelPattern.test(binding.product.version) || !digestPattern.test(binding.product.profileDigest)
      || !digestPattern.test(binding.directional.coreToProductDigest) || !digestPattern.test(binding.directional.productToCoreDigest)) throw new Error("ROUTE_SEMANTIC_BINDING_INVALID");
  } else if (binding.product.applicability !== "not-applicable" || binding.product.profile !== "not-applicable"
    || binding.product.version !== "not-applicable" || binding.product.profileDigest !== "not-applicable") {
    throw new Error("ROUTE_SEMANTIC_BINDING_INVALID");
  }
  const expected = derivedSemanticDigests(binding.core, binding.product);
  if (binding.directional.coreToProductDigest !== expected.directional.coreToProductDigest
    || binding.directional.productToCoreDigest !== expected.directional.productToCoreDigest
    || binding.compositeDigest !== expected.compositeDigest) throw new Error("ROUTE_SEMANTIC_BINDING_INVALID");
}

function validatePolicy(input: RoutingInput): void {
  const policy = input.policy;
  if (typeof policy !== "object" || policy === null || policy.maximumPaidCost !== 0 || policy.paidFallback !== "prohibited" || policy.unknownPrice !== "ineligible"
    || !exactKeys(policy, ["maximumPaidCost", "paidFallback", "unknownPrice", "acceptedCostClasses", "effectivePrivacy"])
    || !Array.isArray(policy.acceptedCostClasses) || policy.acceptedCostClasses.length === 0 || new Set(policy.acceptedCostClasses).size !== policy.acceptedCostClasses.length
    || policy.acceptedCostClasses.some((value) => !safeCostClasses.has(value)) || typeof policy.effectivePrivacy !== "object" || policy.effectivePrivacy === null
    || !exactKeys(policy.effectivePrivacy, ["workClassification", "allowedRouteDeclarations"])
    || !privacyClassifications.has(policy.effectivePrivacy.workClassification) || !validStrings(policy.effectivePrivacy.allowedRouteDeclarations, labelPattern)
    || policy.effectivePrivacy.allowedRouteDeclarations.some((value) => !privacyClassifications.has(value))
    || policy.effectivePrivacy.workClassification !== input.work.privacy || exactDigest(policy) !== input.policyDigest) throw new Error("ROUTE_POLICY_INVALID");
}

function validateRoute(route: ConfiguredRouteForRouting): void {
  if (typeof route !== "object" || route === null || !labelPattern.test(route.id) || !labelPattern.test(route.family) || !labelPattern.test(route.provider) || !modelPattern.test(route.model)
    || !digestPattern.test(route.configDigest)
    || (route.underlyingModelFamily !== undefined && route.underlyingModelFamily !== null && !labelPattern.test(route.underlyingModelFamily))
    || (route.underlyingModel !== undefined && route.underlyingModel !== null && !modelPattern.test(route.underlyingModel))
    || !adapterPattern.test(route.adapter) || !credentialPattern.test(route.credential) || !validStrings(route.capabilities, capabilityPattern)
    || !validStrings(route.privacy, labelPattern) || route.privacy.some((value) => !privacyClassifications.has(value))
    || !allCostClasses.has(route.costClass) || typeof route.paidFallback !== "boolean" || !entitlementDeclarations.has(route.entitlement)
    || !validPositiveInteger(route.concurrency)) throw new Error("ROUTE_CONFIG_INVALID");
}

function validateCatalogueFact(fact: CatalogueFactForRouting): void {
  if (typeof fact !== "object" || fact === null || !labelPattern.test(fact.provider) || !modelPattern.test(fact.model)
    || (fact.underlyingModelFamily !== null && !labelPattern.test(fact.underlyingModelFamily)) || !modelPattern.test(fact.underlyingModel)
    || !validStrings(fact.capabilities, capabilityPattern) || typeof fact.prices !== "object" || fact.prices === null
    || priceDimensions.some((dimension) => fact.prices[dimension] !== null && !validNonnegativeNumber(fact.prices[dimension]))) throw new Error("ROUTE_CATALOGUE_INVALID");
}

function validateProbe(probe: ProbeForRouting): void {
  const keys = ["schema", "status", ...(probe.reasonCode === undefined ? [] : ["reasonCode"]), "routeId", "requested",
    "endpointOrigin", "serviceTier", ...(probe.actual === undefined ? [] : ["actual"]), "inputs", "observedAt", "expiresAt", "capabilityEvaluations", "quota", "health",
    "cost", "usage", "latencyMs", "limits", "externalContact", "authorityEffect", "nonclaims", "resultDigest"];
  if (typeof probe !== "object" || probe === null || !exactKeys(probe, keys) || probe.schema !== "urn:usf:probe-result:1"
    || !["ok", "failed"].includes(probe.status) || (probe.reasonCode !== undefined && !labelPattern.test(probe.reasonCode))
    || !labelPattern.test(probe.routeId) || !validInstant(probe.observedAt) || !validInstant(probe.expiresAt)
    || (probe.endpointOrigin !== null && (typeof probe.endpointOrigin !== "string" || !labelPattern.test(probe.endpointOrigin)))
    || !["on_demand", "default", null].includes(probe.serviceTier)
    || typeof probe.requested !== "object" || probe.requested === null || !exactKeys(probe.requested, ["family", "provider", "model"])
    || !labelPattern.test(probe.requested.family) || !labelPattern.test(probe.requested.provider) || !modelPattern.test(probe.requested.model)
    || (probe.actual !== undefined && (typeof probe.actual !== "object" || probe.actual === null || !exactKeys(probe.actual, ["family", "provider", "model", "sdkProvider"])
      || !labelPattern.test(probe.actual.family) || !labelPattern.test(probe.actual.provider) || !modelPattern.test(probe.actual.model)
      || (probe.actual.sdkProvider !== null && !labelPattern.test(probe.actual.sdkProvider))))
    || typeof probe.inputs !== "object" || probe.inputs === null
    || !exactKeys(probe.inputs, ["routeDigest", "catalogueRawDigest", "catalogueNormalizedDigest", "policyDigest", "entitlementEvidenceDigest", "probePromptDigest", "adapterPackage", "adapterVersion", "adapterLockDigest"])
    || !digestPattern.test(probe.inputs.routeDigest) || !digestPattern.test(probe.inputs.catalogueRawDigest)
    || !digestPattern.test(probe.inputs.catalogueNormalizedDigest) || !digestPattern.test(probe.inputs.policyDigest)
    || (probe.inputs.entitlementEvidenceDigest !== null && !digestPattern.test(probe.inputs.entitlementEvidenceDigest))
    || !digestPattern.test(probe.inputs.probePromptDigest) || !adapterPattern.test(probe.inputs.adapterPackage)
    || !labelPattern.test(probe.inputs.adapterVersion) || !digestPattern.test(probe.inputs.adapterLockDigest)
    || !Array.isArray(probe.capabilityEvaluations) || probe.capabilityEvaluations.length > 8
    || !["available", "exhausted", "unknown"].includes(probe.quota) || !["available", "unavailable", "unknown"].includes(probe.health)
    || typeof probe.cost !== "object" || probe.cost === null || !exactKeys(probe.cost, ["observedCost", "currency", "evidence"])
    || (probe.cost.observedCost !== null && !validNonnegativeNumber(probe.cost.observedCost)) || !["USD", null].includes(probe.cost.currency)
    || !["provider-reported", "entitlement", "unavailable"].includes(probe.cost.evidence)
    || typeof probe.usage !== "object" || probe.usage === null || !exactKeys(probe.usage, ["inputTokens", "outputTokens"])
    || [probe.usage.inputTokens, probe.usage.outputTokens].some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))
    || (probe.latencyMs !== null && !validNonnegativeNumber(probe.latencyMs, maximumLatencyMs))
    || typeof probe.limits !== "object" || probe.limits === null || !exactKeys(probe.limits, ["timeoutMs", "maxRetries", "maxOutputTokens"])
    || !validPositiveInteger(probe.limits.timeoutMs, 30_000) || probe.limits.maxRetries !== 0 || probe.limits.maxOutputTokens !== 8
    || typeof probe.externalContact !== "boolean" || probe.authorityEffect !== "none" || !Array.isArray(probe.nonclaims)
    || probe.nonclaims.length > 128 || probe.nonclaims.some((value) => typeof value !== "string" || value.length > 2_000)
    || !digestPattern.test(probe.resultDigest)) throw new Error("ROUTE_PROBE_INVALID");
  const capabilities = new Set<string>();
  for (const evaluation of probe.capabilityEvaluations) {
    if (typeof evaluation !== "object" || evaluation === null || !exactKeys(evaluation, ["capability", "status", "reasonCode"])
      || evaluation.capability !== "text-generation" || !["available", "unavailable", "unknown"].includes(evaluation.status)
      || (evaluation.reasonCode !== null && !labelPattern.test(evaluation.reasonCode)) || capabilities.has(evaluation.capability)) throw new Error("ROUTE_PROBE_INVALID");
    capabilities.add(evaluation.capability);
  }
}

function validateSemanticQualificationAuthority(authority: SemanticQualificationAuthorityForRouting): void {
  if (typeof authority !== "object" || authority === null || !exactKeys(authority, ["suiteDigest", "corpusDigest", "qualificationPolicyDigest"])
    || !digestPattern.test(authority.suiteDigest) || !digestPattern.test(authority.corpusDigest)
    || !digestPattern.test(authority.qualificationPolicyDigest)) throw new Error("ROUTE_SEMANTIC_QUALIFICATION_INVALID");
}

function semanticQualificationBasis(record: SemanticQualificationForRouting): Omit<SemanticQualificationForRouting, "qualificationDigest"> {
  const { qualificationDigest: _qualificationDigest, ...basis } = record;
  return basis;
}

function replayedQualificationMatches(
  record: SemanticQualificationForRouting,
  source: SemanticQualificationReplaySourceForRouting,
  suite: QualificationSuiteSnapshot,
  policy: QualificationPolicySnapshot,
  effectivePolicyDigest: string,
): boolean {
  try {
    const replayed = qualifySemanticProfile({
      profile: source.profile,
      taskClass: source.taskClass,
      suite,
      policy,
      effectivePolicyDigest,
      observations: source.observations,
      evaluatedAt: source.evaluatedAt,
    });
    return replayed.qualificationDigest === record.qualificationDigest && exactDigest(replayed) === exactDigest(record);
  } catch {
    return false;
  }
}

function validateSemanticQualification(record: SemanticQualificationForRouting): void {
  if (typeof record !== "object" || record === null || record.schema !== "urn:usf:semantic-qualification-result:1"
    || !exactKeys(record, ["schema", "status", "taskClass", "profile", "inputs", "caseEvaluations", "dimensionEvaluations", "taskScore", "casesAnswered", "casesPassed", "casesTotal", "derivedRoles", "observedAt", "evaluatedAt", "validUntil", "externalContact", "authorityEffect", "nonclaims", "qualificationDigest"])
    || !["qualified", "unqualified"].includes(record.status) || !capabilityPattern.test(record.taskClass)
    || typeof record.profile !== "object" || record.profile === null || !exactKeys(record.profile, ["profileDigest", "requested", "actual"])
    || !digestPattern.test(record.profile.profileDigest) || typeof record.profile.requested !== "object" || record.profile.requested === null
    || !exactKeys(record.profile.requested, ["provider", "model", "adapter", "adapterVersion", "adapterLockDigest", "authMode", "toolProfile", "toolProfileDigest", "promptVersion", "promptDigest", "contextConfig", "contextConfigDigest", "outputConfig", "outputConfigDigest"])
    || !labelPattern.test(record.profile.requested.provider)
    || !modelPattern.test(record.profile.requested.model) || !adapterPattern.test(record.profile.requested.adapter)
    || !labelPattern.test(record.profile.requested.adapterVersion) || !digestPattern.test(record.profile.requested.adapterLockDigest)
    || !qualificationAuthModes.has(record.profile.requested.authMode) || !labelPattern.test(record.profile.requested.toolProfile)
    || !labelPattern.test(record.profile.requested.promptVersion) || !labelPattern.test(record.profile.requested.contextConfig)
    || !labelPattern.test(record.profile.requested.outputConfig) || !digestPattern.test(record.profile.requested.toolProfileDigest)
    || !digestPattern.test(record.profile.requested.promptDigest) || !digestPattern.test(record.profile.requested.contextConfigDigest)
    || !digestPattern.test(record.profile.requested.outputConfigDigest) || typeof record.profile.actual !== "object" || record.profile.actual === null
    || !exactKeys(record.profile.actual, ["provider", "model", "transport"])
    || !labelPattern.test(record.profile.actual.provider) || !modelPattern.test(record.profile.actual.model)
    || !labelPattern.test(record.profile.actual.transport)
    || typeof record.inputs !== "object" || record.inputs === null
    || !exactKeys(record.inputs, ["suiteDigest", "corpusDigest", "qualificationPolicyDigest", "effectivePolicyDigest", "observationSetDigest"])
    || Object.values(record.inputs).some((value) => typeof value !== "string" || !digestPattern.test(value))
    || !Array.isArray(record.caseEvaluations) || record.caseEvaluations.length > 10_000
    || !Array.isArray(record.dimensionEvaluations) || record.dimensionEvaluations.length > 128
    || !validNonnegativeNumber(record.taskScore, 1) || !Number.isSafeInteger(record.casesAnswered) || record.casesAnswered < 0
    || !Number.isSafeInteger(record.casesPassed) || record.casesPassed < 0 || !Number.isSafeInteger(record.casesTotal) || record.casesTotal < 0
    || record.casesAnswered > record.casesTotal || record.casesPassed > record.casesTotal
    || !Array.isArray(record.derivedRoles) || record.derivedRoles.length === 0 || record.derivedRoles.length > qualificationRoles.length
    || record.derivedRoles.some((role) => !qualificationRoleSet.has(role)) || new Set(record.derivedRoles).size !== record.derivedRoles.length
    || (record.status === "qualified" && record.derivedRoles.includes("UNQUALIFIED"))
    || (record.status === "unqualified" && (record.derivedRoles.length !== 1 || record.derivedRoles[0] !== "UNQUALIFIED"))
    || !validInstant(record.observedAt) || !validInstant(record.evaluatedAt) || !validInstant(record.validUntil)
    || record.externalContact !== false || record.authorityEffect !== "none" || !Array.isArray(record.nonclaims)
    || record.nonclaims.length > 128 || record.nonclaims.some((value) => typeof value !== "string" || value.length > 2_000)
    || !digestPattern.test(record.qualificationDigest)) {
    throw new Error("ROUTE_SEMANTIC_QUALIFICATION_INVALID");
  }
  for (const evaluation of record.caseEvaluations) {
    if (typeof evaluation !== "object" || evaluation === null || !exactKeys(evaluation, ["caseId", "taskClass", "dimension", "answerPresent", "score", "weight", "passed"])
      || !labelPattern.test(evaluation.caseId) || !capabilityPattern.test(evaluation.taskClass) || !qualificationDimensionSet.has(evaluation.dimension)
      || typeof evaluation.answerPresent !== "boolean" || !validNonnegativeNumber(evaluation.score, 1)
      || !validNonnegativeNumber(evaluation.weight) || evaluation.weight === 0 || typeof evaluation.passed !== "boolean") {
      throw new Error("ROUTE_SEMANTIC_QUALIFICATION_INVALID");
    }
  }
  for (const evaluation of record.dimensionEvaluations) {
    if (typeof evaluation !== "object" || evaluation === null || !exactKeys(evaluation, ["taskClass", "dimension", "score", "answered", "passed", "total"])
      || !capabilityPattern.test(evaluation.taskClass) || !qualificationDimensionSet.has(evaluation.dimension) || !validNonnegativeNumber(evaluation.score, 1)
      || !Number.isSafeInteger(evaluation.answered) || evaluation.answered < 0 || !Number.isSafeInteger(evaluation.passed) || evaluation.passed < 0
      || !Number.isSafeInteger(evaluation.total) || evaluation.total < 0 || evaluation.answered > evaluation.total || evaluation.passed > evaluation.total) {
      throw new Error("ROUTE_SEMANTIC_QUALIFICATION_INVALID");
    }
  }
}

function sameIdentity(left: Readonly<{ family: string; provider: string; model: string }>, right: Readonly<{ family: string; provider: string; model: string }>): boolean {
  return left.family === right.family && left.provider === right.provider && left.model === right.model;
}

function validateInput(input: RoutingInput, trustedAuthority: TrustedSemanticQualificationAuthorityForRouting | undefined): number {
  if (typeof input !== "object" || input === null || typeof input.work !== "object" || input.work === null
    || !digestPattern.test(input.work.digest) || !digestPattern.test(input.catalogueRawDigest) || !digestPattern.test(input.catalogueNormalizedDigest)
    || !digestPattern.test(input.policyDigest)
    || !digestPattern.test(input.providerConfigDigest)) throw new Error("ROUTE_DIGEST_INVALID");
  if (!labelPattern.test(input.work.id) || !validStrings(input.work.capabilities, capabilityPattern)
    || !Array.isArray(input.work.semanticRequirements) || input.work.semanticRequirements.length > 128
    || !privacyClassifications.has(input.work.privacy)) throw new Error("ROUTE_WORK_IDENTITY_INVALID");
  const semanticCapabilities = input.work.capabilities.filter((capability) => !mechanicalCapabilities.has(capability));
  const mappedCapabilities = new Set<string>();
  const mappedTaskClasses = new Set<string>();
  for (const requirement of input.work.semanticRequirements) {
    if (typeof requirement !== "object" || requirement === null || !exactKeys(requirement, ["capability", "taskClass"])
      || !capabilityPattern.test(requirement.capability) || !capabilityPattern.test(requirement.taskClass)
      || mechanicalCapabilities.has(requirement.capability) || !semanticCapabilities.includes(requirement.capability)
      || mappedCapabilities.has(requirement.capability) || mappedTaskClasses.has(requirement.taskClass)) throw new Error("ROUTE_WORK_IDENTITY_INVALID");
    mappedCapabilities.add(requirement.capability);
    mappedTaskClasses.add(requirement.taskClass);
  }
  if (mappedCapabilities.size !== semanticCapabilities.length || semanticCapabilities.some((capability) => !mappedCapabilities.has(capability))) {
    throw new Error("ROUTE_WORK_IDENTITY_INVALID");
  }
  validateSemanticBinding(input.work.semanticBinding);
  if (!validInstant(input.now)) throw new Error("ROUTE_NOW_INVALID");
  if (!routingStrategies.has(input.strategy)) throw new Error("ROUTE_STRATEGY_INVALID");
  if (!validPositiveInteger(input.hostConcurrency) || !validPositiveInteger(input.maxAssignments)) throw new Error("ROUTE_CAP_INVALID");
  if (!Array.isArray(input.routes) || !Array.isArray(input.catalogue) || !Array.isArray(input.probes)
    || !Array.isArray(input.semanticQualificationProfiles) || !Array.isArray(input.semanticQualifications)
    || typeof input.semanticQualificationReplay !== "object" || input.semanticQualificationReplay === null
    || !exactKeys(input.semanticQualificationReplay, ["sources"])
    || !Array.isArray(input.semanticQualificationReplay.sources)
    || input.routes.length > maximumRoutes || input.catalogue.length > maximumRoutes || input.probes.length > maximumRoutes
    || input.semanticQualificationProfiles.length > maximumRoutes || input.semanticQualifications.length > maximumRoutes
    || input.semanticQualificationReplay.sources.length > maximumRoutes || !(input.installedAdapters instanceof Set)
    || !(input.credentialNamesPresent instanceof Set) || !validStrings([...input.installedAdapters], adapterPattern, maximumRoutes)
    || !validStrings([...input.credentialNamesPresent], credentialPattern, maximumRoutes)) throw new Error("ROUTE_INPUT_INVALID");
  validateSemanticQualificationAuthority(input.semanticQualificationAuthority);
  if (typeof trustedAuthority !== "object" || trustedAuthority === null || !exactKeys(trustedAuthority, ["suite", "policy"])
    || typeof trustedAuthority.suite !== "object" || trustedAuthority.suite === null
    || typeof trustedAuthority.policy !== "object" || trustedAuthority.policy === null
    || trustedAuthority.suite.suiteDigest !== input.semanticQualificationAuthority.suiteDigest
    || trustedAuthority.suite.corpusDigest !== input.semanticQualificationAuthority.corpusDigest
    || trustedAuthority.policy.policyDigest !== input.semanticQualificationAuthority.qualificationPolicyDigest) {
    throw new Error("ROUTE_SEMANTIC_QUALIFICATION_INVALID");
  }
  validatePolicy(input);
  const routeIds = new Set<string>();
  for (const route of input.routes) { validateRoute(route); if (routeIds.has(route.id)) throw new Error("ROUTE_INPUT_DUPLICATE"); routeIds.add(route.id); }
  const catalogueKeys = new Set<string>();
  for (const fact of input.catalogue) {
    validateCatalogueFact(fact); const key = catalogueKey(fact.provider, fact.model);
    if (catalogueKeys.has(key)) throw new Error("ROUTE_INPUT_DUPLICATE"); catalogueKeys.add(key);
  }
  const probeRouteIds = new Set<string>();
  for (const probe of input.probes) {
    validateProbe(probe);
    if (probeRouteIds.has(probe.routeId) || !routeIds.has(probe.routeId)) throw new Error("ROUTE_INPUT_DUPLICATE"); probeRouteIds.add(probe.routeId);
  }
  const qualificationProfileRouteIds = new Set<string>();
  for (const profile of input.semanticQualificationProfiles) {
    if (typeof profile !== "object" || profile === null || !exactKeys(profile, ["routeId", "profileDigest"])
      || !labelPattern.test(profile.routeId) || !digestPattern.test(profile.profileDigest)
      || qualificationProfileRouteIds.has(profile.routeId) || !routeIds.has(profile.routeId)) throw new Error("ROUTE_INPUT_DUPLICATE");
    qualificationProfileRouteIds.add(profile.routeId);
  }
  const qualificationKeys = new Set<string>();
  for (const qualification of input.semanticQualifications) {
    validateSemanticQualification(qualification);
    const key = qualificationKey(
      routeIdentityKey(qualification.profile.requested.provider, qualification.profile.requested.model),
      qualification.profile.profileDigest, qualification.taskClass);
    if (qualificationKeys.has(key)) throw new Error("ROUTE_INPUT_DUPLICATE");
    qualificationKeys.add(key);
  }
  const replayKeys = new Set<string>();
  for (const source of input.semanticQualificationReplay.sources) {
    if (typeof source !== "object" || source === null || !exactKeys(source, ["routeId", "taskClass", "profile", "observations", "evaluatedAt"])
      || !labelPattern.test(source.routeId) || !routeIds.has(source.routeId) || !capabilityPattern.test(source.taskClass)
      || !mappedTaskClasses.has(source.taskClass)
      || typeof source.profile !== "object" || source.profile === null
      || !Array.isArray(source.observations) || source.observations.length === 0 || source.observations.length > 10_000
      || !validInstant(source.evaluatedAt)) throw new Error("ROUTE_SEMANTIC_QUALIFICATION_INVALID");
    const key = replaySourceKey(source);
    if (replayKeys.has(key)) throw new Error("ROUTE_INPUT_DUPLICATE");
    replayKeys.add(key);
  }
  return Date.parse(input.now);
}

interface AssessmentBuild extends RouteAssessment {
  readonly routeDigest: string;
  readonly catalogueFactDigest: string | null;
  readonly probeDigest: string | null;
  readonly entitlementEvidenceDigest: string | "not-applicable" | null;
  readonly semanticQualification: SemanticQualificationBindingForRouting | null;
}

function probeResultBasis(probe: ProbeForRouting): Omit<ProbeForRouting, "resultDigest"> {
  const { resultDigest: _resultDigest, ...basis } = probe;
  return basis;
}

function assess(
  route: ConfiguredRouteForRouting,
  input: RoutingInput,
  catalogue: ReadonlyMap<string, CatalogueFactForRouting>,
  probes: ReadonlyMap<string, ProbeForRouting>,
  qualificationProfiles: ReadonlyMap<string, SemanticQualificationProfileForRouting>,
  semanticQualifications: ReadonlyMap<string, SemanticQualificationForRouting>,
  replaySources: ReadonlyMap<string, SemanticQualificationReplaySourceForRouting>,
  trustedAuthority: TrustedSemanticQualificationAuthorityForRouting,
  probeSetDigest: string,
  now: number,
): AssessmentBuild {
  const fact = catalogue.get(catalogueKey(route.provider, route.model));
  const probe = probes.get(route.id);
  const routeDigest = exactDigest(route);
  const remoteRoute = route.costClass !== "local";
  const prices = fact === undefined ? [] : priceDimensions.map((dimension) => fact.prices[dimension]);
  const requiredMechanicalCapabilities = Object.freeze(input.work.capabilities.filter((capability) => mechanicalCapabilities.has(capability)));
  const semanticRequirements = [...input.work.semanticRequirements].sort((left, right) => left.capability.localeCompare(right.capability));
  const requiredSemanticCapabilities = Object.freeze(semanticRequirements.map((requirement) => requirement.capability));
  const requiredSemanticTaskClasses = Object.freeze(semanticRequirements.map((requirement) => requirement.taskClass));
  const expectedQualificationProfile = qualificationProfiles.get(route.id);
  const orderedQualificationRecords = Object.freeze(expectedQualificationProfile === undefined ? [] : requiredSemanticTaskClasses
    .map((taskClass) => semanticQualifications.get(qualificationKey(routeIdentityKey(route.provider, route.model), expectedQualificationProfile.profileDigest, taskClass)))
    .filter((record): record is SemanticQualificationForRouting => record !== undefined));
  const orderedReplaySources = Object.freeze(expectedQualificationProfile === undefined ? [] : requiredSemanticTaskClasses
    .map((taskClass) => replaySources.get(qualificationKey(routeIdentityKey(route.provider, route.model), expectedQualificationProfile.profileDigest, taskClass)))
    .filter((source): source is SemanticQualificationReplaySourceForRouting => source !== undefined));
  let exclusionReason: RouteExclusionReason | null = null;

  if (!input.installedAdapters.has(route.adapter)) exclusionReason = "ADAPTER_UNAVAILABLE";
  else if (!input.credentialNamesPresent.has(route.credential)) exclusionReason = "CREDENTIAL_MISSING";
  else if (fact === undefined) exclusionReason = "CATALOGUE_ROUTE_MISSING";
  else if ((route.underlyingModelFamily !== undefined && route.underlyingModelFamily !== fact.underlyingModelFamily)
    || (route.underlyingModel !== undefined && route.underlyingModel !== fact.underlyingModel)) exclusionReason = "CATALOGUE_UNDERLYING_IDENTITY_MISMATCH";
  else if (!includesAll(route.capabilities, input.work.capabilities)) exclusionReason = "CAPABILITY_MISMATCH";
  else if (!route.privacy.includes(input.work.privacy) || !route.privacy.some((value) => input.policy.effectivePrivacy.allowedRouteDeclarations.includes(value))) exclusionReason = "PRIVACY_INELIGIBLE";
  else if (!input.policy.acceptedCostClasses.includes(route.costClass as "local" | "zero-price" | "free-quota")) exclusionReason = "COST_CLASS_INELIGIBLE";
  else if (route.paidFallback) exclusionReason = "PAID_FALLBACK_PROHIBITED";
  else if (route.costClass === "zero-price" && prices.some((value) => value === null)) exclusionReason = "CATALOGUE_PRICE_UNKNOWN";
  else if (route.costClass === "zero-price" && prices.some((value) => value !== 0)) exclusionReason = "CATALOGUE_PRICE_NONZERO";
  else if (remoteRoute && route.entitlement !== "verified") exclusionReason = "ENTITLEMENT_UNVERIFIED";
  else if (probe === undefined) exclusionReason = "PROBE_MISSING";
  else if (probe.resultDigest !== exactDigest(probeResultBasis(probe)) || probe.inputs.routeDigest !== route.configDigest
    || probe.inputs.catalogueRawDigest !== input.catalogueRawDigest || probe.inputs.catalogueNormalizedDigest !== input.catalogueNormalizedDigest
    || probe.inputs.policyDigest !== input.policyDigest || !sameIdentity(probe.requested, { family: route.family, provider: route.provider, model: route.model })
    || (remoteRoute && !probe.externalContact)) exclusionReason = "PROBE_INPUT_MISMATCH";
  else if (Date.parse(probe.observedAt) > now || Date.parse(probe.expiresAt) <= now) exclusionReason = "PROBE_STALE";
  else if (probe.status !== "ok") exclusionReason = "PROBE_FAILED";
  else if (remoteRoute && probe.inputs.entitlementEvidenceDigest === null) exclusionReason = "ENTITLEMENT_UNVERIFIED";
  else if (probe.quota === "unknown") exclusionReason = "PROBE_QUOTA_UNKNOWN";
  else if (probe.quota === "exhausted") exclusionReason = route.costClass === "free-quota" ? "FREE_QUOTA_UNAVAILABLE" : "PROBE_QUOTA_EXHAUSTED";
  else if (probe.health !== "available") exclusionReason = "PROBE_HEALTH_UNAVAILABLE";
  else if (probe.capabilityEvaluations.find((evaluation) => evaluation.capability === "text-generation")?.status !== "available") exclusionReason = "PROBE_FAILED";
  else if (probe.actual === undefined) exclusionReason = "PROBE_ACTUAL_IDENTITY_MISSING";
  else if (probe.actual.family !== route.family || probe.actual.provider !== route.provider || probe.actual.model !== route.model) exclusionReason = "PROBE_ACTUAL_IDENTITY_MISMATCH";
  else if (probe.cost.observedCost !== null && probe.cost.observedCost !== 0) exclusionReason = "PROBE_COST_NONZERO";
  else if (probe.cost.observedCost === null && probe.cost.evidence !== "entitlement") exclusionReason = "PROBE_COST_BASIS_UNKNOWN";
  else if (requiredSemanticCapabilities.length > 0 && requiredSemanticTaskClasses.some((taskClass) =>
    orderedQualificationRecords.filter((record) => record.taskClass === taskClass).length === 0
    || orderedReplaySources.filter((source) => source.taskClass === taskClass).length === 0)) exclusionReason = "SEMANTIC_QUALIFICATION_MISSING";
  else if (requiredSemanticCapabilities.length > 0 && (expectedQualificationProfile === undefined
    || requiredSemanticTaskClasses.some((taskClass) => orderedQualificationRecords.filter((record) => record.taskClass === taskClass).length !== 1)
    || orderedQualificationRecords.some((record) => record.qualificationDigest !== exactDigest(semanticQualificationBasis(record))
      || record.profile.profileDigest !== expectedQualificationProfile.profileDigest
      || record.profile.profileDigest !== exactDigest({
        schema: "urn:usf:agent-profile:1", provider: record.profile.requested.provider,
        requestedModel: record.profile.requested.model, adapter: record.profile.requested.adapter,
        adapterVersion: record.profile.requested.adapterVersion, adapterLockDigest: record.profile.requested.adapterLockDigest,
        authMode: record.profile.requested.authMode, toolProfile: record.profile.requested.toolProfile,
        toolProfileDigest: record.profile.requested.toolProfileDigest, promptVersion: record.profile.requested.promptVersion,
        promptDigest: record.profile.requested.promptDigest, contextConfig: record.profile.requested.contextConfig,
        contextConfigDigest: record.profile.requested.contextConfigDigest, outputConfig: record.profile.requested.outputConfig,
        outputConfigDigest: record.profile.requested.outputConfigDigest,
      })
      || record.inputs.suiteDigest !== input.semanticQualificationAuthority.suiteDigest
      || record.inputs.corpusDigest !== input.semanticQualificationAuthority.corpusDigest
      || record.inputs.qualificationPolicyDigest !== input.semanticQualificationAuthority.qualificationPolicyDigest
      || record.inputs.effectivePolicyDigest !== input.policyDigest
      || record.profile.requested.provider !== route.provider || record.profile.requested.model !== route.model
      || record.profile.actual.provider !== route.provider || record.profile.actual.model !== route.model
      || Date.parse(record.evaluatedAt) < Date.parse(record.observedAt)
      || (record.status === "unqualified") !== (record.derivedRoles.length === 1 && record.derivedRoles[0] === "UNQUALIFIED"))
    || orderedReplaySources.some((source, index) => source.routeId !== route.id || source.taskClass !== orderedQualificationRecords[index]?.taskClass
      || !replayedQualificationMatches(orderedQualificationRecords[index]!, source, trustedAuthority.suite,
        trustedAuthority.policy, input.policyDigest)))) {
    exclusionReason = "SEMANTIC_QUALIFICATION_MISMATCH";
  } else if (requiredSemanticCapabilities.length > 0 && orderedQualificationRecords.some((record) => Date.parse(record.evaluatedAt) > now
    || Date.parse(record.validUntil) <= now || Date.parse(record.validUntil) <= Date.parse(record.evaluatedAt))) exclusionReason = "SEMANTIC_QUALIFICATION_STALE";
  else if (requiredSemanticCapabilities.length > 0 && orderedQualificationRecords.some((record) => record.status !== "qualified")) exclusionReason = "SEMANTIC_CAPABILITY_UNQUALIFIED";

  const entitlementEvidenceDigest = probe === undefined ? null
    : probe.inputs.entitlementEvidenceDigest ?? (remoteRoute ? null : "not-applicable" as const);
  const semanticQualification = exclusionReason === null && requiredSemanticCapabilities.length === 0
    ? Object.freeze({ applicability: "not-required" as const, requiredCapabilities: Object.freeze([]) as readonly [], requiredTaskClasses: Object.freeze([]) as readonly [], reason: "no-semantic-capabilities-required" as const, validityDigest: "not-applicable" as const })
    : exclusionReason === null
      ? Object.freeze({
        applicability: "required" as const, requiredCapabilities: requiredSemanticCapabilities, requiredTaskClasses: requiredSemanticTaskClasses,
        qualificationDigests: Object.freeze(orderedQualificationRecords.map((record) => record.qualificationDigest)),
        validityDigest: exactDigest(orderedQualificationRecords.map((record) => ({
          taskClass: record.taskClass, observedAt: record.observedAt, evaluatedAt: record.evaluatedAt,
          validUntil: record.validUntil, qualificationDigest: record.qualificationDigest,
        }))),
      })
      : null;
  const qualificationValidUntil = exclusionReason === null && probe !== undefined && semanticQualification !== null
    ? new Date(Math.min(
      Date.parse(probe.expiresAt),
      semanticQualification.applicability === "required" ? Math.min(...orderedQualificationRecords.map((record) => Date.parse(record.validUntil))) : Number.POSITIVE_INFINITY,
    )).toISOString() : null;
  const catalogueFactDigest = fact === undefined ? null : exactDigest(fact);
  const qualificationDigest = exclusionReason === null && probe !== undefined && catalogueFactDigest !== null && entitlementEvidenceDigest !== null
    && qualificationValidUntil !== null
    ? exactDigest({
      routeDigest, providerRouteConfigDigest: route.configDigest, catalogueFactDigest, probeDigest: probe.resultDigest, catalogueRawDigest: input.catalogueRawDigest,
      catalogueNormalizedDigest: input.catalogueNormalizedDigest, probeSetDigest, policyDigest: input.policyDigest,
      entitlementEvidenceDigest,
      probeObservedAt: probe.observedAt, probeExpiresAt: probe.expiresAt, latencyMs: probe.latencyMs,
      mechanicalCapabilities: requiredMechanicalCapabilities, semanticQualification,
      validAt: input.now, validUntil: qualificationValidUntil,
      semanticBinding: input.work.semanticBinding,
    }) : null;
  return Object.freeze({
    routeId: route.id, family: route.family, provider: route.provider, model: route.model,
    underlyingModelFamily: fact?.underlyingModelFamily ?? null, underlyingModel: fact?.underlyingModel ?? null,
    eligible: exclusionReason === null, disposition: exclusionReason === null ? "eligible-unassigned" : "excluded", exclusionReason,
    concurrency: route.concurrency, latencyMs: probe?.latencyMs ?? null,
    mechanicalCapabilities: requiredMechanicalCapabilities, semanticCapabilities: requiredSemanticCapabilities, semanticTaskClasses: requiredSemanticTaskClasses,
    semanticQualificationDigest: orderedQualificationRecords.length === 0 ? null
      : exactDigest(orderedQualificationRecords.map((record) => ({ taskClass: record.taskClass, qualificationDigest: record.qualificationDigest }))),
    semanticQualificationInputDigest: orderedQualificationRecords.length === 0 ? null : exactDigest(orderedQualificationRecords),
    semanticQualificationValidUntil: orderedQualificationRecords.length === 0 ? null
      : new Date(Math.min(...orderedQualificationRecords.map((record) => Date.parse(record.validUntil)))).toISOString(),
    qualificationDigest, qualificationValidUntil,
    routeDigest, catalogueFactDigest, probeDigest: probe?.resultDigest ?? null, entitlementEvidenceDigest,
    semanticQualification,
  });
}

function orderEligible(rows: readonly AssessmentBuild[], strategy: RoutingStrategy): AssessmentBuild[] {
  const stable = [...rows].sort((left, right) => left.routeId.localeCompare(right.routeId));
  if (strategy === "fastest") return stable.sort((left, right) => (left.latencyMs ?? Infinity) - (right.latencyMs ?? Infinity) || left.routeId.localeCompare(right.routeId));
  if (strategy === "all-eligible" || strategy === "deterministic-fixture") return stable;
  const selected: AssessmentBuild[] = [];
  const remaining = [...stable];
  const seenFamilies = new Set<string>();
  const seenModels = new Set<string | null>();
  while (remaining.length > 0) {
    const index = remaining.findIndex((row) => !seenFamilies.has(row.family) && (strategy !== "review-diverse" || !seenModels.has(row.underlyingModelFamily)));
    const next = remaining.splice(index < 0 ? 0 : index, 1)[0]!;
    selected.push(next); seenFamilies.add(next.family); seenModels.add(next.underlyingModelFamily);
  }
  return selected;
}

function copySemanticBinding(binding: RoutingSemanticBinding): RoutingSemanticBinding {
  return Object.freeze({ core: Object.freeze({ ...binding.core }), product: Object.freeze({ ...binding.product }), directional: Object.freeze({ ...binding.directional }), compositeDigest: binding.compositeDigest });
}

export function routeWork(input: RoutingInput, trustedAuthority: TrustedSemanticQualificationAuthorityForRouting): RouteResult {
  assertRealisationBasis(input.basis);
  validateSemanticBinding(input.work.semanticBinding);
  const productBinding = input.work.semanticBinding.product;
  const productMatches = productBinding.applicability === "not-applicable"
    ? input.basis.selection.product === "not-applicable" && input.basis.selection.productVersion === "not-applicable"
    : input.basis.selection.product === productBinding.profile && input.basis.selection.productVersion === productBinding.version && input.basis.selection.productDigest === productBinding.profileDigest;
  if (input.basis.work.id !== input.work.id || input.basis.work.packetCoreDigest !== input.work.digest
    || input.work.semanticBinding.core.profile !== input.basis.selection.profile
    || input.work.semanticBinding.core.version !== input.basis.selection.profileVersion
    || input.work.semanticBinding.core.profileDigest !== input.basis.selection.profileDigest
    || !productMatches
    || input.basis.selection.coreToProductDigest !== input.work.semanticBinding.directional.coreToProductDigest
    || input.basis.selection.productToCoreDigest !== input.work.semanticBinding.directional.productToCoreDigest
    || input.basis.selection.compositeDigest !== input.work.semanticBinding.compositeDigest) throw new Error("ROUTE_BASIS_BINDING_MISMATCH");
  const now = validateInput(input, trustedAuthority);
  const catalogue = new Map(input.catalogue.map((fact) => [catalogueKey(fact.provider, fact.model), fact]));
  const probes = new Map(input.probes.map((probe) => [probe.routeId, probe]));
  const qualificationProfiles = new Map(input.semanticQualificationProfiles.map((profile) => [profile.routeId, profile]));
  const orderedProbes = [...input.probes].sort((left, right) => left.routeId.localeCompare(right.routeId));
  const probeSetDigest = exactDigest(orderedProbes);
  const orderedSemanticQualifications = [...input.semanticQualifications].sort((left, right) => left.profile.profileDigest.localeCompare(right.profile.profileDigest)
    || left.taskClass.localeCompare(right.taskClass));
  const qualificationGroups = new Map<string, SemanticQualificationForRouting>();
  for (const record of orderedSemanticQualifications) {
    qualificationGroups.set(qualificationKey(
      routeIdentityKey(record.profile.requested.provider, record.profile.requested.model),
      record.profile.profileDigest, record.taskClass), record);
  }
  const replaySources = new Map<string, SemanticQualificationReplaySourceForRouting>();
  for (const source of input.semanticQualificationReplay.sources) replaySources.set(replaySourceKey(source), source);
  const semanticQualificationSetDigest = exactDigest(orderedSemanticQualifications);
  const semanticQualificationReferences = Object.freeze(orderedSemanticQualifications.map((record): SemanticQualificationReferenceForRouting => Object.freeze({
    taskClass: record.taskClass, status: record.status, qualificationDigest: record.qualificationDigest,
    profileDigest: record.profile.profileDigest, suiteDigest: record.inputs.suiteDigest, corpusDigest: record.inputs.corpusDigest,
    qualificationPolicyDigest: record.inputs.qualificationPolicyDigest, effectivePolicyDigest: record.inputs.effectivePolicyDigest,
    observationSetDigest: record.inputs.observationSetDigest,
    actualIdentityDigest: exactDigest(record.profile.actual),
    validityDigest: exactDigest({ observedAt: record.observedAt, evaluatedAt: record.evaluatedAt, validUntil: record.validUntil }),
    validUntil: record.validUntil,
  })));
  const builtAssessments = [...input.routes].sort((left, right) => left.id.localeCompare(right.id))
    .map((route) => assess(route, input, catalogue, probes, qualificationProfiles, qualificationGroups, replaySources, trustedAuthority, probeSetDigest, now));
  const eligible = builtAssessments.filter((row) => row.eligible);
  const ordered = orderEligible(eligible, input.strategy).slice(0, Math.min(input.maxAssignments, input.hostConcurrency));
  const selectedIds = new Set(ordered.map((row) => row.routeId));
  const routeById = new Map(input.routes.map((route) => [route.id, route]));
  const probeById = new Map(input.probes.map((probe) => [probe.routeId, probe]));
  const factByRoute = new Map(input.routes.map((route) => [route.id, catalogue.get(catalogueKey(route.provider, route.model))]));
  const semanticBinding = copySemanticBinding(input.work.semanticBinding);
  const assignments = Object.freeze(ordered.map((row) => {
    const route = routeById.get(row.routeId)!;
    const probe = probeById.get(row.routeId)!;
    const fact = factByRoute.get(row.routeId)!;
    const actual = probe.actual!;
    const qualification = Object.freeze({
      routeDigest: row.routeDigest, providerRouteConfigDigest: route.configDigest, catalogueFactDigest: row.catalogueFactDigest!, probeDigest: row.probeDigest!, catalogueRawDigest: input.catalogueRawDigest,
      catalogueNormalizedDigest: input.catalogueNormalizedDigest, probeSetDigest, policyDigest: input.policyDigest,
      entitlementEvidenceDigest: row.entitlementEvidenceDigest!,
      probeObservedAt: probe.observedAt, probeExpiresAt: probe.expiresAt, latencyMs: probe.latencyMs,
      mechanicalCapabilities: row.mechanicalCapabilities, semanticQualification: row.semanticQualification!,
      validAt: input.now, validUntil: row.qualificationValidUntil!, qualificationDigest: row.qualificationDigest!,
    });
    const basis = {
      routeId: route.id, requested: Object.freeze({ family: route.family, provider: route.provider, model: route.model }),
      actual: Object.freeze({ family: actual.family, provider: actual.provider, model: actual.model }),
      underlying: Object.freeze({ family: fact!.underlyingModelFamily, model: fact!.underlyingModel }),
      workId: input.work.id, basisDigest: input.basis.basisDigest, workDigest: input.work.digest, semanticBinding, qualification,
      concurrency: Math.min(route.concurrency, input.hostConcurrency),
    };
    return Object.freeze({ ...basis, assignmentDigest: exactDigest(basis) });
  }));
  const assessments = Object.freeze(builtAssessments.map((row): RouteAssessment => Object.freeze({
    routeId: row.routeId, family: row.family, provider: row.provider, model: row.model,
    underlyingModelFamily: row.underlyingModelFamily, underlyingModel: row.underlyingModel,
    eligible: row.eligible, disposition: selectedIds.has(row.routeId) ? "assigned" : row.disposition,
    exclusionReason: row.exclusionReason, concurrency: row.concurrency, latencyMs: row.latencyMs,
    mechanicalCapabilities: row.mechanicalCapabilities, semanticCapabilities: row.semanticCapabilities, semanticTaskClasses: row.semanticTaskClasses,
    semanticQualificationDigest: row.semanticQualificationDigest, semanticQualificationInputDigest: row.semanticQualificationInputDigest,
    semanticQualificationValidUntil: row.semanticQualificationValidUntil,
    qualificationDigest: row.qualificationDigest, qualificationValidUntil: row.qualificationValidUntil,
  })));
  const eligibleUnassignedRoutes = assessments.filter((row) => row.disposition === "eligible-unassigned").length;
  const denominators = Object.freeze({
    configuredRoutes: input.routes.length, assessedRoutes: assessments.length, eligibleRoutes: eligible.length,
    excludedRoutes: assessments.length - eligible.length, eligibleUnassignedRoutes,
    eligibleProviderFamilies: new Set(eligible.map((row) => row.family)).size, assignedRoutes: assignments.length,
  });
  const basis = {
    schema: "urn:usf:route-result:1" as const, basis: input.basis, status: assignments.length > 0 ? "ok" as const : "refused" as const,
    ...(assignments.length > 0 ? {} : { reasonCode: "NO_ELIGIBLE_ROUTE" as const }), strategy: input.strategy,
    inputs: Object.freeze({
      workDigest: input.work.digest, semanticBindingDigest: exactDigest(input.work.semanticBinding), catalogueRawDigest: input.catalogueRawDigest,
      catalogueNormalizedDigest: input.catalogueNormalizedDigest, probeSetDigest, policyDigest: input.policyDigest,
      semanticQualificationSuiteDigest: input.semanticQualificationAuthority.suiteDigest,
      semanticQualificationCorpusDigest: input.semanticQualificationAuthority.corpusDigest,
      semanticQualificationPolicyDigest: input.semanticQualificationAuthority.qualificationPolicyDigest,
      semanticQualificationSetDigest, providerConfigDigest: input.providerConfigDigest,
      qualificationAt: input.now,
    }),
    denominators, caps: Object.freeze({ hostConcurrency: input.hostConcurrency, maxAssignments: input.maxAssignments }),
    assessments, semanticQualifications: semanticQualificationReferences, assignments,
    externalContact: false as const, authorityEffect: "none" as const,
    nonclaims: Object.freeze(["routing-consumes-semantic-qualification-it-does-not-create-semantic-authority", "text-generation-is-mechanical-probe-capability", "eligible-route-is-time-scoped-not-future-availability", "assignment-is-not-provider-contact-contribution-acceptance-or-proof"]),
  };
  return Object.freeze({ ...basis, resultDigest: exactDigest(basis) });
}

// ---------------------------------------------------------------------------
// Route-member qualification receipts, lazy fair cohorts and aggregate
// workload readiness. urn:usf:provider-stage:route-qualification:1 keeps
// currentness model-local: a stale predecessor digest, a substituted actual
// identity or a passed expiry makes exactly one route member UNQUALIFIED and
// never poisons a sibling. urn:usf:provider-operation:workload-readiness:1
// derives its family set per workload and retains no permanent roster.
// ---------------------------------------------------------------------------

export type RouteQualificationDisposition = "QUALIFIED" | "UNQUALIFIED" | "DEFERRED";

export interface RouteQualificationIdentity {
  readonly family: string;
  readonly provider: string;
  readonly model: string;
}

export interface RouteQualificationActualIdentity extends RouteQualificationIdentity {
  readonly sdkProvider: string;
}

export interface RouteQualificationReceipt {
  readonly schema: "urn:usf:route-qualification-receipt:1";
  readonly version: 1;
  readonly routeMemberDigest: string;
  readonly candidateMemberDigest: string;
  readonly taskProfileDigest: string;
  readonly accountObservationDigest: string;
  readonly routeModelEconomicsBindingDigest: string;
  readonly adapterPreflightDigest: string;
  readonly providerAnswerDigest: string;
  readonly hiddenEvaluationDigest: string;
  readonly requestedIdentity: Readonly<RouteQualificationIdentity>;
  readonly actualIdentity: Readonly<RouteQualificationActualIdentity>;
  readonly roles: readonly QualifiedRole[];
  readonly disposition: RouteQualificationDisposition;
  readonly reasonCodes: readonly string[];
  readonly qualifiedAt: string;
  readonly expiresAt: string;
}

/** The exact predecessor bases a receipt must still match to stay current. */
export interface RouteQualificationExpectedBases {
  readonly routeMemberDigest: string;
  readonly candidateMemberDigest: string;
  readonly taskProfileDigest: string;
  readonly accountObservationDigest: string;
  readonly routeModelEconomicsBindingDigest: string;
  readonly adapterPreflightDigest: string;
  readonly providerAnswerDigest: string;
  readonly hiddenEvaluationDigest: string;
  readonly requestedIdentity: Readonly<RouteQualificationIdentity>;
}

export interface RouteMemberCurrentness {
  readonly routeMemberDigest: string;
  readonly disposition: RouteQualificationDisposition;
  readonly roles: readonly QualifiedRole[];
  readonly reasonCodes: readonly string[];
}

const routeQualificationDigestPattern = /^sha256:[0-9a-f]{64}$/u;
const routeQualificationIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,191}$/u;
const routeQualificationRolePattern = /^[A-Z][A-Z0-9_]{1,63}$/u;
const routeQualificationReasonPattern = /^[A-Z][A-Z0-9_]{1,95}(?::[^\s]{1,192})?$/u;
const routeQualificationInstantPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const routeQualificationDispositions = new Set<string>(["QUALIFIED", "UNQUALIFIED", "DEFERRED"]);
const routeQualificationQualifiedRoles = new Set<string>(qualificationRoles.slice(1));

const routeQualificationReceiptKeys = Object.freeze([
  "schema", "version", "routeMemberDigest", "candidateMemberDigest", "taskProfileDigest",
  "accountObservationDigest", "routeModelEconomicsBindingDigest", "adapterPreflightDigest",
  "providerAnswerDigest", "hiddenEvaluationDigest", "requestedIdentity", "actualIdentity",
  "roles", "disposition", "reasonCodes", "qualifiedAt", "expiresAt",
]);

export class RouteQualificationError extends Error {
  readonly reasonCode: "ROUTE_QUALIFICATION_RECORD_INVALID";
  constructor(reasonCode: "ROUTE_QUALIFICATION_RECORD_INVALID") {
    super(reasonCode);
    this.name = "RouteQualificationError";
    this.reasonCode = reasonCode;
  }
}

function routeQualificationInvalid(): never {
  throw new RouteQualificationError("ROUTE_QUALIFICATION_RECORD_INVALID");
}

function routeQualificationRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) routeQualificationInvalid();
  return value as Record<string, unknown>;
}

function routeQualificationExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) routeQualificationInvalid();
}

function routeQualificationDigestValue(value: unknown): string {
  if (typeof value !== "string" || !routeQualificationDigestPattern.test(value)) routeQualificationInvalid();
  return value;
}

function routeQualificationIdentifier(value: unknown): string {
  if (typeof value !== "string" || !routeQualificationIdentifierPattern.test(value)) routeQualificationInvalid();
  return value;
}

function routeQualificationInstant(value: unknown): string {
  if (typeof value !== "string" || !routeQualificationInstantPattern.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    routeQualificationInvalid();
  }
  return value;
}

function routeQualificationIdentity(value: unknown): Readonly<RouteQualificationIdentity> {
  const identity = routeQualificationRecord(value);
  routeQualificationExactKeys(identity, ["family", "provider", "model"]);
  return Object.freeze({
    family: routeQualificationIdentifier(identity.family),
    provider: routeQualificationIdentifier(identity.provider),
    model: routeQualificationIdentifier(identity.model),
  });
}

function routeQualificationActualIdentity(value: unknown): Readonly<RouteQualificationActualIdentity> {
  const identity = routeQualificationRecord(value);
  routeQualificationExactKeys(identity, ["family", "provider", "model", "sdkProvider"]);
  return Object.freeze({
    family: routeQualificationIdentifier(identity.family),
    provider: routeQualificationIdentifier(identity.provider),
    model: routeQualificationIdentifier(identity.model),
    sdkProvider: routeQualificationIdentifier(identity.sdkProvider),
  });
}

/**
 * Parse one closed route-qualification receipt. UNQUALIFIED and DEFERRED must
 * carry at least one reason code and QUALIFIED must carry none, so a receipt
 * can never assert a refusal without saying why or a pass with a stale excuse.
 */
export function parseRouteQualificationReceipt(value: unknown): RouteQualificationReceipt {
  const receipt = routeQualificationRecord(value);
  routeQualificationExactKeys(receipt, routeQualificationReceiptKeys);
  if (receipt.schema !== "urn:usf:route-qualification-receipt:1" || receipt.version !== 1) routeQualificationInvalid();

  if (typeof receipt.disposition !== "string" || !routeQualificationDispositions.has(receipt.disposition)) routeQualificationInvalid();
  const disposition = receipt.disposition as RouteQualificationDisposition;

  if (!Array.isArray(receipt.roles) || receipt.roles.length < 1 || receipt.roles.length > 64) routeQualificationInvalid();
  const roles: string[] = [];
  for (const role of receipt.roles) {
    if (typeof role !== "string" || !routeQualificationRolePattern.test(role)
      || !routeQualificationQualifiedRoles.has(role) || roles.includes(role)) routeQualificationInvalid();
    roles.push(role);
  }
  if (roles.some((role, index) => index > 0 && role <= roles[index - 1]!)) routeQualificationInvalid();

  if (!Array.isArray(receipt.reasonCodes) || receipt.reasonCodes.length > 64) routeQualificationInvalid();
  const reasonCodes: string[] = [];
  for (const reason of receipt.reasonCodes) {
    if (typeof reason !== "string" || !routeQualificationReasonPattern.test(reason) || reasonCodes.includes(reason)) routeQualificationInvalid();
    reasonCodes.push(reason);
  }
  if (reasonCodes.some((reason, index) => index > 0 && reason <= reasonCodes[index - 1]!)) routeQualificationInvalid();
  if ((disposition === "QUALIFIED") !== (reasonCodes.length === 0)) routeQualificationInvalid();

  const qualifiedAt = routeQualificationInstant(receipt.qualifiedAt);
  const expiresAt = routeQualificationInstant(receipt.expiresAt);
  if (Date.parse(qualifiedAt) >= Date.parse(expiresAt)) routeQualificationInvalid();

  return Object.freeze({
    schema: "urn:usf:route-qualification-receipt:1",
    version: 1,
    routeMemberDigest: routeQualificationDigestValue(receipt.routeMemberDigest),
    candidateMemberDigest: routeQualificationDigestValue(receipt.candidateMemberDigest),
    taskProfileDigest: routeQualificationDigestValue(receipt.taskProfileDigest),
    accountObservationDigest: routeQualificationDigestValue(receipt.accountObservationDigest),
    routeModelEconomicsBindingDigest: routeQualificationDigestValue(receipt.routeModelEconomicsBindingDigest),
    adapterPreflightDigest: routeQualificationDigestValue(receipt.adapterPreflightDigest),
    providerAnswerDigest: routeQualificationDigestValue(receipt.providerAnswerDigest),
    hiddenEvaluationDigest: routeQualificationDigestValue(receipt.hiddenEvaluationDigest),
    requestedIdentity: routeQualificationIdentity(receipt.requestedIdentity),
    actualIdentity: routeQualificationActualIdentity(receipt.actualIdentity),
    roles: Object.freeze(roles as QualifiedRole[]),
    disposition,
    reasonCodes: Object.freeze(reasonCodes),
    qualifiedAt,
    expiresAt,
  });
}

export function routeQualificationReceiptDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseRouteQualificationReceipt(value), { rejectAbsolutePaths: true });
}

/**
 * Re-evaluate one route member against the exact current predecessor bases.
 * Every mismatch is reported rather than short-circuited, so an operator sees
 * the complete reason set for that member; the result is scoped to this member
 * alone and carries no sibling effect.
 */
export function evaluateRouteMemberCurrentness(
  value: unknown,
  expected: RouteQualificationExpectedBases,
  at: string,
): RouteMemberCurrentness {
  const receipt = parseRouteQualificationReceipt(value);
  const observedAt = routeQualificationInstant(at);
  const reasonCodes = new Set<string>(receipt.reasonCodes);

  const compare: readonly (readonly [keyof RouteQualificationExpectedBases, string])[] = [
    ["routeMemberDigest", "ROUTE_QUALIFICATION_ROUTE_MEMBER_MISMATCH"],
    ["candidateMemberDigest", "ROUTE_QUALIFICATION_CANDIDATE_MEMBER_MISMATCH"],
    ["taskProfileDigest", "ROUTE_QUALIFICATION_TASK_PROFILE_MISMATCH"],
    ["accountObservationDigest", "ROUTE_QUALIFICATION_ACCOUNT_OBSERVATION_MISMATCH"],
    ["routeModelEconomicsBindingDigest", "ROUTE_QUALIFICATION_ECONOMICS_BINDING_MISMATCH"],
    ["adapterPreflightDigest", "ROUTE_QUALIFICATION_ADAPTER_PREFLIGHT_MISMATCH"],
    ["providerAnswerDigest", "ROUTE_QUALIFICATION_PROVIDER_ANSWER_MISMATCH"],
    ["hiddenEvaluationDigest", "ROUTE_QUALIFICATION_HIDDEN_EVALUATION_MISMATCH"],
  ];
  for (const [field, reason] of compare) {
    if (receipt[field] !== routeQualificationDigestValue(expected[field])) reasonCodes.add(reason);
  }

  const expectedRequested = routeQualificationIdentity(expected.requestedIdentity);
  if (receipt.requestedIdentity.family !== expectedRequested.family
    || receipt.requestedIdentity.provider !== expectedRequested.provider
    || receipt.requestedIdentity.model !== expectedRequested.model) {
    reasonCodes.add("ROUTE_QUALIFICATION_REQUESTED_IDENTITY_MISMATCH");
  }
  // A substituted actual identity stops the route; it never falls back to the
  // requested identity.
  if (receipt.actualIdentity.family !== receipt.requestedIdentity.family
    || receipt.actualIdentity.provider !== receipt.requestedIdentity.provider
    || receipt.actualIdentity.model !== receipt.requestedIdentity.model) {
    reasonCodes.add("ROUTE_QUALIFICATION_ACTUAL_IDENTITY_SUBSTITUTED");
  }

  if (Date.parse(observedAt) >= Date.parse(receipt.expiresAt)) reasonCodes.add("ROUTE_QUALIFICATION_EXPIRED");
  if (Date.parse(observedAt) < Date.parse(receipt.qualifiedAt)) reasonCodes.add("ROUTE_QUALIFICATION_NOT_YET_VALID");

  const failed = reasonCodes.size > 0;
  const disposition: RouteQualificationDisposition = failed
    ? (receipt.disposition === "DEFERRED" ? "DEFERRED" : "UNQUALIFIED")
    : "QUALIFIED";

  return Object.freeze({
    routeMemberDigest: receipt.routeMemberDigest,
    disposition,
    roles: disposition === "QUALIFIED" ? receipt.roles : Object.freeze([] as QualifiedRole[]),
    reasonCodes: Object.freeze([...reasonCodes].sort()),
  });
}

export type QualificationCohortDisposition = "selected" | "deferred" | "excluded";

export interface QualificationCandidateForCohort {
  readonly candidateMemberDigest: string;
  readonly provider: string;
  readonly identity: Readonly<RouteQualificationIdentity>;
  /** Roles this candidate could cover if it were qualified. */
  readonly offeredRoles: readonly QualifiedRole[];
  /** Canonical decimal string, or null when the catalogue price is unknown. */
  readonly costPerMillion: string | null;
  readonly eligible: boolean;
  readonly ineligibleReason: string | null;
}

export interface QualificationCohortInput {
  readonly requiredRoles: readonly QualifiedRole[];
  /** Roles already covered by a current qualification; never re-qualified. */
  readonly coveredRoles: readonly QualifiedRole[];
  readonly candidates: readonly QualificationCandidateForCohort[];
  readonly maximumCohortSize: number;
  /** Exact model identities already counted against this authorization. */
  readonly countedModelDigests: readonly string[];
  /** Provider drained last, so repeated bounded runs rotate fairly. */
  readonly drainCursor: string | null;
}

export interface QualificationCohortMember {
  readonly candidateMemberDigest: string;
  readonly provider: string;
  readonly identity: Readonly<RouteQualificationIdentity>;
  readonly modelIdentityDigest: string;
  /** Only the still-uncovered roles this member is being qualified for. */
  readonly coveringRoles: readonly QualifiedRole[];
}

export interface QualificationCandidateDisposition {
  readonly candidateMemberDigest: string;
  readonly disposition: QualificationCohortDisposition;
  readonly reasonCodes: readonly string[];
}

export interface QualificationCohortPlan {
  readonly uncoveredRoles: readonly QualifiedRole[];
  readonly cohort: readonly QualificationCohortMember[];
  /** One terminal disposition for every configured candidate identity. */
  readonly dispositions: readonly QualificationCandidateDisposition[];
  readonly nextDrainCursor: string | null;
  readonly rolesFullyCovered: boolean;
  readonly planDigest: string;
}

function cohortModelIdentityDigest(identity: Readonly<RouteQualificationIdentity>): `sha256:${string}` {
  return canonicalDigest({
    family: identity.family, provider: identity.provider, model: identity.model,
  }, { rejectAbsolutePaths: true });
}

/** Compare canonical non-negative decimal strings without floating point. */
function compareDecimalStrings(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const leftTrimmed = leftWhole!.replace(/^0+(?=\d)/u, "");
  const rightTrimmed = rightWhole!.replace(/^0+(?=\d)/u, "");
  if (leftTrimmed.length !== rightTrimmed.length) return leftTrimmed.length - rightTrimmed.length;
  if (leftTrimmed !== rightTrimmed) return leftTrimmed < rightTrimmed ? -1 : 1;
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftPadded = leftFraction.padEnd(width, "0");
  const rightPadded = rightFraction.padEnd(width, "0");
  if (leftPadded === rightPadded) return 0;
  return leftPadded < rightPadded ? -1 : 1;
}

const cohortDecimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

/**
 * Derive one bounded deterministic cheapest-first qualification cohort.
 *
 * Only currently uncovered roles are qualified, each exact model identity is
 * counted at most once per authorization, and every configured candidate keeps
 * an explicit terminal disposition. Unknown catalogue cost defers rather than
 * excludes and never becomes free. Providers are rotated from `drainCursor` so
 * repeated bounded runs drain eligible provider queues fairly instead of
 * starving the tail of a stable sort.
 */
export function deriveQualificationCohort(input: QualificationCohortInput): QualificationCohortPlan {
  if (!Number.isSafeInteger(input.maximumCohortSize) || input.maximumCohortSize < 1 || input.maximumCohortSize > 64) {
    routeQualificationInvalid();
  }
  for (const candidate of input.candidates) {
    if (candidate.costPerMillion !== null && !cohortDecimalPattern.test(candidate.costPerMillion)) routeQualificationInvalid();
  }

  const covered = new Set<string>(input.coveredRoles);
  const uncovered = [...new Set(input.requiredRoles)].filter((role) => !covered.has(role)).sort();
  const counted = new Set<string>(input.countedModelDigests);

  const dispositions: QualificationCandidateDisposition[] = [];
  const eligible: (QualificationCandidateForCohort & { readonly modelIdentityDigest: string; readonly coveringRoles: readonly QualifiedRole[] })[] = [];

  for (const candidate of input.candidates) {
    const reasons = new Set<string>();
    const modelIdentityDigest = cohortModelIdentityDigest(candidate.identity);
    const coveringRoles = [...new Set(candidate.offeredRoles)].filter((role) => uncovered.includes(role)).sort();

    if (!candidate.eligible) reasons.add(candidate.ineligibleReason ?? "COHORT_CANDIDATE_INELIGIBLE");
    if (coveringRoles.length === 0) reasons.add("COHORT_NO_UNCOVERED_ROLE");
    if (counted.has(modelIdentityDigest)) reasons.add("COHORT_MODEL_IDENTITY_ALREADY_COUNTED");

    if (reasons.size > 0) {
      dispositions.push(Object.freeze({
        candidateMemberDigest: candidate.candidateMemberDigest,
        disposition: "excluded" as const,
        reasonCodes: Object.freeze([...reasons].sort()),
      }));
      continue;
    }
    if (candidate.costPerMillion === null) {
      dispositions.push(Object.freeze({
        candidateMemberDigest: candidate.candidateMemberDigest,
        disposition: "deferred" as const,
        reasonCodes: Object.freeze(["COHORT_CATALOGUE_COST_UNKNOWN"]),
      }));
      continue;
    }
    eligible.push({ ...candidate, modelIdentityDigest, coveringRoles });
  }

  // Cheapest first, then a stable identity order so the plan is deterministic.
  eligible.sort((left, right) => compareDecimalStrings(left.costPerMillion!, right.costPerMillion!)
    || (left.provider < right.provider ? -1 : left.provider > right.provider ? 1 : 0)
    || (left.identity.model < right.identity.model ? -1 : left.identity.model > right.identity.model ? 1 : 0)
    || (left.candidateMemberDigest < right.candidateMemberDigest ? -1 : left.candidateMemberDigest > right.candidateMemberDigest ? 1 : 0));

  // Fair draining: rotate the provider order so the provider after the cursor
  // is offered its cheapest candidate first on this run.
  const providerOrder = [...new Set(eligible.map((candidate) => candidate.provider))];
  if (input.drainCursor !== null) {
    const cursorIndex = providerOrder.indexOf(input.drainCursor);
    if (cursorIndex >= 0) providerOrder.push(...providerOrder.splice(0, cursorIndex + 1));
  }

  const queues = new Map<string, typeof eligible>();
  for (const provider of providerOrder) queues.set(provider, eligible.filter((candidate) => candidate.provider === provider));

  const cohort: QualificationCohortMember[] = [];
  const remaining = new Set<string>(uncovered);
  const selected = new Set<string>();
  const cohortCounted = new Set<string>(counted);

  let progressed = true;
  while (progressed && cohort.length < input.maximumCohortSize && remaining.size > 0) {
    progressed = false;
    for (const provider of providerOrder) {
      if (cohort.length >= input.maximumCohortSize || remaining.size === 0) break;
      const queue = queues.get(provider)!;
      while (queue.length > 0) {
        const candidate = queue.shift()!;
        if (cohortCounted.has(candidate.modelIdentityDigest)) continue;
        const covering = candidate.coveringRoles.filter((role) => remaining.has(role));
        if (covering.length === 0) continue;
        cohort.push(Object.freeze({
          candidateMemberDigest: candidate.candidateMemberDigest,
          provider: candidate.provider,
          identity: candidate.identity,
          modelIdentityDigest: candidate.modelIdentityDigest,
          coveringRoles: Object.freeze(covering),
        }));
        cohortCounted.add(candidate.modelIdentityDigest);
        selected.add(candidate.candidateMemberDigest);
        for (const role of covering) remaining.delete(role);
        progressed = true;
        break;
      }
    }
  }

  for (const candidate of eligible) {
    if (selected.has(candidate.candidateMemberDigest)) {
      dispositions.push(Object.freeze({
        candidateMemberDigest: candidate.candidateMemberDigest,
        disposition: "selected" as const,
        reasonCodes: Object.freeze([] as string[]),
      }));
      continue;
    }
    dispositions.push(Object.freeze({
      candidateMemberDigest: candidate.candidateMemberDigest,
      disposition: "deferred" as const,
      reasonCodes: Object.freeze([
        cohortCounted.has(candidate.modelIdentityDigest) && !selected.has(candidate.candidateMemberDigest)
          ? "COHORT_MODEL_IDENTITY_ALREADY_COUNTED"
          : "COHORT_BOUND_REACHED",
      ]),
    }));
  }
  dispositions.sort((left, right) => left.candidateMemberDigest < right.candidateMemberDigest ? -1
    : left.candidateMemberDigest > right.candidateMemberDigest ? 1 : 0);

  const plan = {
    uncoveredRoles: Object.freeze(uncovered),
    cohort: Object.freeze(cohort),
    dispositions: Object.freeze(dispositions),
    nextDrainCursor: cohort.length > 0 ? cohort[cohort.length - 1]!.provider : input.drainCursor,
    rolesFullyCovered: remaining.size === 0,
  };
  return Object.freeze({ ...plan, planDigest: canonicalDigest(plan, { rejectAbsolutePaths: true }) });
}

export interface WorkloadFamilyReadiness {
  readonly family: string;
  readonly disposition: "READY" | "NOT_READY";
  readonly qualifyingRouteMemberDigests: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface WorkloadReadinessInput {
  /**
   * The exact graph-required provider families of the selected workload and
   * profile. Derived per workload; no permanent roster is retained.
   */
  readonly requiredFamilies: readonly string[];
  readonly requiredRoles: readonly QualifiedRole[];
  readonly members: readonly RouteMemberCurrentness[];
  /** Family of each evaluated route member, keyed by route-member digest. */
  readonly memberFamilies: readonly Readonly<{ routeMemberDigest: string; family: string }>[];
}

export interface WorkloadReadinessResult {
  readonly schema: "urn:usf:workload-readiness:1";
  readonly disposition: "READY" | "NOT_READY";
  readonly rosterPolicy: "derive-per-workload-no-permanent-roster";
  readonly families: readonly WorkloadFamilyReadiness[];
  readonly reasonCodes: readonly string[];
  readonly readinessDigest: string;
}

/**
 * Aggregate per urn:usf:provider-operation:workload-readiness:1: every
 * graph-required family needs at least one exact current route qualification
 * covering every required role. Missing evidence is NOT_READY, and an empty
 * required-family set denies rather than vacuously passing.
 */
export function evaluateWorkloadReadiness(input: WorkloadReadinessInput): WorkloadReadinessResult {
  const familyByMember = new Map<string, string>();
  for (const entry of input.memberFamilies) {
    if (familyByMember.has(entry.routeMemberDigest) && familyByMember.get(entry.routeMemberDigest) !== entry.family) {
      routeQualificationInvalid();
    }
    familyByMember.set(entry.routeMemberDigest, entry.family);
  }

  const requiredRoles = [...new Set(input.requiredRoles)].sort();
  const reasonCodes = new Set<string>();
  const requiredFamilies = [...new Set(input.requiredFamilies)].sort();
  if (requiredFamilies.length === 0) reasonCodes.add("WORKLOAD_REQUIRED_FAMILY_SET_EMPTY");
  if (requiredRoles.length === 0) reasonCodes.add("WORKLOAD_REQUIRED_ROLE_SET_EMPTY");

  const families: WorkloadFamilyReadiness[] = [];
  for (const family of requiredFamilies) {
    const qualifying = input.members
      .filter((member) => member.disposition === "QUALIFIED"
        && familyByMember.get(member.routeMemberDigest) === family
        && requiredRoles.every((role) => member.roles.includes(role)))
      .map((member) => member.routeMemberDigest)
      .sort();
    const familyReasons = new Set<string>();
    if (requiredRoles.length === 0) familyReasons.add("WORKLOAD_REQUIRED_ROLE_SET_EMPTY");
    if (qualifying.length === 0) {
      familyReasons.add(input.members.some((member) => familyByMember.get(member.routeMemberDigest) === family)
        ? "WORKLOAD_FAMILY_NO_CURRENT_QUALIFICATION"
        : "WORKLOAD_FAMILY_EVIDENCE_MISSING");
    }
    const ready = familyReasons.size === 0;
    if (!ready) reasonCodes.add(`WORKLOAD_FAMILY_NOT_READY:${family}`);
    families.push(Object.freeze({
      family,
      disposition: ready ? "READY" as const : "NOT_READY" as const,
      qualifyingRouteMemberDigests: Object.freeze(qualifying),
      reasonCodes: Object.freeze([...familyReasons].sort()),
    }));
  }

  const result = {
    schema: "urn:usf:workload-readiness:1" as const,
    disposition: reasonCodes.size === 0 ? "READY" as const : "NOT_READY" as const,
    rosterPolicy: "derive-per-workload-no-permanent-roster" as const,
    families: Object.freeze(families),
    reasonCodes: Object.freeze([...reasonCodes].sort()),
  };
  return Object.freeze({ ...result, readinessDigest: canonicalDigest(result, { rejectAbsolutePaths: true }) });
}
