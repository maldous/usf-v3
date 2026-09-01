import { canonicalDigest } from "../core/canonical.ts";
import { executionTransportIds, type ExecutionTransportId } from "./transports.ts";

/**
 * V3 evaluates economics per execution transport. A transport and provider pair
 * is eligible only when the operator has explicitly authorized it and the
 * declared route entitlement matches an accepted cost class. Nothing is
 * inferred: an unauthorized pair is ineligible, and one provider's paid-credit
 * semantics never transfer to another provider.
 */
export type EconomicEligibilityCode =
  | "ECONOMICS_AUTHORIZED"
  | "ECONOMICS_ZERO_PRICE_ELIGIBLE"
  | "ECONOMICS_AUTHORIZATION_ABSENT"
  | "ECONOMICS_ENTITLEMENT_MISMATCH"
  | "ECONOMICS_COST_CLASS_REFUSED"
  | "ECONOMICS_PAID_FALLBACK_REFUSED"
  | "ECONOMICS_BUDGET_NON_ZERO"
  | "ECONOMICS_AUTHORIZATION_INVALID";

export interface ExecutionEconomicAuthorization {
  readonly transport: ExecutionTransportId;
  readonly provider: string;
  readonly entitlement: string;
  readonly basis: string;
  readonly maximumPaidCostUsd: number;
  readonly evidence: string;
  readonly sourceDocumentation: string;
}

export interface EffectiveCostPolicy {
  readonly maximumPaidCost: number;
  readonly paidFallback: string;
  readonly unknownPrice: string;
  readonly acceptedCostClasses: readonly string[];
}

export interface EconomicEligibilityInput {
  readonly transport: ExecutionTransportId;
  readonly provider: string;
  /** Declared cost class of the configured route, e.g. "free-quota". */
  readonly routeCost: string;
  /** Declared entitlement of the configured route. */
  readonly routeEntitlement: string;
  readonly routePaidFallback: boolean;
  readonly policy: EffectiveCostPolicy;
  readonly authorizations: readonly ExecutionEconomicAuthorization[];
}

export interface EconomicEligibilityDecision {
  readonly eligible: boolean;
  readonly code: EconomicEligibilityCode;
  readonly transport: ExecutionTransportId;
  readonly provider: string;
  readonly authorizationDigest: string | null;
  readonly basis: string | null;
  readonly nonClaims: readonly string[];
}

const economicsNonClaims = Object.freeze([
  "Eligibility means the operator explicitly authorized this transport and provider pair under a zero paid-cost policy. It is not an observed account tier, balance or subscription state.",
  "No provider-returned account evidence is asserted. Catalogue list prices describe paid-tier rates and are not evidence that this execution incurs cost.",
]);

function decision(
  input: EconomicEligibilityInput,
  code: EconomicEligibilityCode,
  authorization?: ExecutionEconomicAuthorization,
): EconomicEligibilityDecision {
  return Object.freeze({
    eligible: code === "ECONOMICS_AUTHORIZED" || code === "ECONOMICS_ZERO_PRICE_ELIGIBLE",
    code,
    transport: input.transport,
    provider: input.provider,
    authorizationDigest: authorization === undefined ? null : canonicalDigest(authorization),
    basis: authorization?.basis ?? null,
    nonClaims: economicsNonClaims,
  });
}

/**
 * Cost classes V3 accepts in addition to those the base policy names. V3 owns
 * its own economic vocabulary; the legacy probe policy stays untouched.
 */
export function parseAdditionalAcceptedCostClasses(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return Object.freeze([]);
  const list = (value as { additionalAcceptedCostClasses?: unknown }).additionalAcceptedCostClasses;
  if (!Array.isArray(list)) return Object.freeze([]);
  return Object.freeze([...new Set(list.filter((entry): entry is string => typeof entry === "string"))].sort());
}

export function parseExecutionEconomicAuthorizations(value: unknown): readonly ExecutionEconomicAuthorization[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return Object.freeze([]);
  const list = (value as { authorizations?: unknown }).authorizations;
  if (!Array.isArray(list)) return Object.freeze([]);
  const parsed: ExecutionEconomicAuthorization[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const transport = record.transport;
    const provider = record.provider;
    const entitlement = record.entitlement;
    const basis = record.basis;
    const maximumPaidCostUsd = record.maximumPaidCostUsd;
    const evidence = record.evidence;
    const sourceDocumentation = record.sourceDocumentation;
    if (typeof transport !== "string" || typeof provider !== "string" || typeof entitlement !== "string"
      || typeof basis !== "string" || typeof evidence !== "string" || typeof sourceDocumentation !== "string"
      || typeof maximumPaidCostUsd !== "number" || !Number.isFinite(maximumPaidCostUsd)) continue;
    // Derived from the transport type rather than restated here. A hardcoded
    // list silently dropped every antigravity-cli authorization from the moment
    // that transport was added: the type union gained it, this line did not, and
    // the result was an admitted, authenticated, economically authorised
    // transport that never produced a single attempt.
    if (!executionTransportIds.includes(transport as ExecutionTransportId)) continue;
    parsed.push(Object.freeze({
      transport: transport as ExecutionTransportId,
      provider, entitlement, basis, maximumPaidCostUsd, evidence, sourceDocumentation,
    }));
  }
  return Object.freeze(parsed);
}

export function evaluateExecutionEconomics(input: EconomicEligibilityInput): EconomicEligibilityDecision {
  if (input.policy.maximumPaidCost !== 0 || input.policy.paidFallback !== "prohibited") {
    return decision(input, "ECONOMICS_AUTHORIZATION_INVALID");
  }
  if (input.routePaidFallback) return decision(input, "ECONOMICS_PAID_FALLBACK_REFUSED");
  if (!input.policy.acceptedCostClasses.includes(input.routeCost)) {
    return decision(input, "ECONOMICS_COST_CLASS_REFUSED");
  }
  // A catalogue-declared zero price needs no operator authorization: there is no
  // cost to authorize. A free *quota* is different -- a quota-backed credential
  // could sit on a paid tier -- so it still requires an explicit authorization.
  if (input.routeCost === "zero-price" && input.routeEntitlement === "zero-price") {
    return Object.freeze({
      eligible: true,
      code: "ECONOMICS_ZERO_PRICE_ELIGIBLE" as const,
      transport: input.transport,
      provider: input.provider,
      authorizationDigest: null,
      basis: "catalogue-declared-zero-price",
      nonClaims: economicsNonClaims,
    });
  }
  const matches = input.authorizations.filter(
    (entry) => entry.transport === input.transport && entry.provider === input.provider,
  );
  if (matches.length !== 1) return decision(input, "ECONOMICS_AUTHORIZATION_ABSENT");
  const authorization = matches[0]!;
  if (authorization.maximumPaidCostUsd !== 0) return decision(input, "ECONOMICS_BUDGET_NON_ZERO", authorization);
  if (authorization.entitlement !== input.routeEntitlement) {
    return decision(input, "ECONOMICS_ENTITLEMENT_MISMATCH", authorization);
  }
  return decision(input, "ECONOMICS_AUTHORIZED", authorization);
}
