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
  | "ECONOMICS_AUTHORIZATION_ABSENT"
  | "ECONOMICS_COST_CLASS_NOT_PERMITTED"
  | "ECONOMICS_PAID_SPEND_REFUSED"
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
  /**
   * What kind of account this is: a subscription, a prepaid balance, a trial,
   * or a standing free tier. Authorization is about permission to use an
   * account, which is why it is stated rather than derived from what a model
   * happens to cost.
   */
  readonly accountBasis: string;
  /**
   * The catalogue cost classes this account may be used for. Empty permits
   * nothing: a class absent from this list is refused, so widening what an
   * account may reach is always an explicit declaration.
   */
  readonly permittedCostClasses: readonly string[];
  /**
   * Whether this account may execute anything that could incur a charge. False
   * refuses an unknown-price model outright, because an unknown price may be a
   * paid one, and it is what keeps a trial from walking silently onto paid usage
   * when the trial ends.
   */
  readonly paidSpendPermitted: boolean;
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
  /**
   * The cost class the catalogue states for this exact model. It is a property
   * of the model and never an admission mechanism: it is checked against what
   * the account is permitted to reach, and on its own it authorizes nothing.
   */
  readonly catalogueCostClass: string;
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
  "A catalogue cost class is a property of a model and authorizes nothing. Eligibility requires one declared authorization for the exact transport and provider pair, and that authorization must permit this model's cost class.",
  "A permitted cost class is not an observation that the account still has entitlement. When a trial ends the provider refuses; the authorization does not notice, and narrowing it remains an operator decision.",
]);

function decision(
  input: EconomicEligibilityInput,
  code: EconomicEligibilityCode,
  authorization?: ExecutionEconomicAuthorization,
): EconomicEligibilityDecision {
  return Object.freeze({
    eligible: code === "ECONOMICS_AUTHORIZED",
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

/**
 * What the retired authorization shape permitted, read from its entitlement.
 *
 * The retired shape carried no spend axis, and the runtime treated an authorized
 * provider's every model as free-quota regardless of catalogue price. This
 * reproduces that reach for the priced and zero-price classes.
 *
 * It deliberately does not reproduce it for an unknown price. `unknown` is
 * listed here, and the spend check refuses it first, because an unknown price
 * may be a paid one and the retired shape permits no spend. Measured, that
 * narrows one provider from fourteen candidates to ten: four groq models the old
 * reading admitted with no price known at all. The narrowing is the point, so it
 * is stated rather than described as a no-op.
 */
function retiredShapePermittedClasses(entitlement: string): readonly string[] {
  if (entitlement === "subscription-included") return Object.freeze(["subscription-included"]);
  if (entitlement === "free-quota" || entitlement === "local") return Object.freeze(["priced", "unknown", "zero-price"]);
  return Object.freeze([]);
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
    const accountBasis = record.accountBasis;
    const permittedCostClasses = record.permittedCostClasses;
    const paidSpendPermitted = record.paidSpendPermitted;
    if (typeof transport !== "string" || typeof provider !== "string" || typeof entitlement !== "string"
      || typeof basis !== "string" || typeof evidence !== "string" || typeof sourceDocumentation !== "string"
      || typeof maximumPaidCostUsd !== "number" || !Number.isFinite(maximumPaidCostUsd)) continue;
    // The spend axis, with one declared transitional acceptance.
    //
    // A half-declared axis is an error rather than a legacy shape: an
    // authorization that names an account basis and no permitted class, or a
    // permitted class and no spend flag, is refused. Defaulting there would let
    // a declaration stop meaning anything.
    //
    // An authorization carrying none of the three is the retired shape, and is
    // read under the transitional default below. This is the aliasing route
    // naming.md prescribes for a reader whose graph has not moved yet: the
    // reader learns the canonical form first and accepts the retired one, so
    // there is no commit where the reader and the graph disagree. It is
    // removable once no authorization in any graph omits the axis, and removing
    // it is a one-line change to this branch.
    const axisPresent = [accountBasis, permittedCostClasses, paidSpendPermitted].filter((entry) => entry !== undefined).length;
    if (axisPresent !== 0 && axisPresent !== 3) continue;
    const legacy = axisPresent === 0;
    const effectiveAccountBasis = legacy ? "undeclared-retained" : accountBasis;
    const effectivePaidSpend = legacy ? false : paidSpendPermitted;
    const effectivePermitted = legacy ? retiredShapePermittedClasses(entitlement) : permittedCostClasses;
    if (typeof effectiveAccountBasis !== "string" || effectiveAccountBasis.length === 0
      || typeof effectivePaidSpend !== "boolean"
      || !Array.isArray(effectivePermitted)
      || !effectivePermitted.every((entry): entry is string => typeof entry === "string")) continue;
    // Derived from the transport type rather than restated here. A hardcoded
    // list silently dropped every antigravity-cli authorization from the moment
    // that transport was added: the type union gained it, this line did not, and
    // the result was an admitted, authenticated, economically authorised
    // transport that never produced a single attempt.
    if (!executionTransportIds.includes(transport as ExecutionTransportId)) continue;
    parsed.push(Object.freeze({
      transport: transport as ExecutionTransportId,
      provider, entitlement, basis, maximumPaidCostUsd, evidence, sourceDocumentation,
      accountBasis: effectiveAccountBasis,
      permittedCostClasses: Object.freeze([...new Set(effectivePermitted)].sort()),
      paidSpendPermitted: effectivePaidSpend,
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
  // Every candidate needs an authorization, with no exception for a zero price.
  // A catalogue-declared zero price used to admit a provider on its own, on the
  // reasoning that there is no cost to authorize. That reasoning answers the
  // wrong question: authorization is permission to use an account at all, not a
  // statement about a model's price, and a free model still needs an account, a
  // credential and terms. Measured before this was closed, 21 of 45 routable
  // candidates entered this way across three providers that no commit had ever
  // authorized -- which is also how a catalogue refresh could silently widen
  // what Hermes may do.
  const matches = input.authorizations.filter(
    (entry) => entry.transport === input.transport && entry.provider === input.provider,
  );
  if (matches.length !== 1) return decision(input, "ECONOMICS_AUTHORIZATION_ABSENT");
  const authorization = matches[0]!;
  if (authorization.maximumPaidCostUsd !== 0) return decision(input, "ECONOMICS_BUDGET_NON_ZERO", authorization);
  // An unknown price may be a paid one, so an account that may not spend may not
  // reach it. This is separate from the class check below because it is the
  // account's own spend posture rather than a statement about this model.
  if (input.catalogueCostClass === "unknown" && !authorization.paidSpendPermitted) {
    return decision(input, "ECONOMICS_PAID_SPEND_REFUSED", authorization);
  }
  if (!authorization.permittedCostClasses.includes(input.catalogueCostClass)) {
    return decision(input, "ECONOMICS_COST_CLASS_NOT_PERMITTED", authorization);
  }
  if (authorization.entitlement !== input.routeEntitlement) {
    return decision(input, "ECONOMICS_ENTITLEMENT_MISMATCH", authorization);
  }
  return decision(input, "ECONOMICS_AUTHORIZED", authorization);
}
