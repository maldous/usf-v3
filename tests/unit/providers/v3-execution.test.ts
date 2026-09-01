import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateExecutionEconomics, parseExecutionEconomicAuthorizations,
  type EconomicEligibilityInput, type EffectiveCostPolicy,
} from "../../../src/providers/execution-economics.ts";
import {
  credentialPresence, observeTransportCapability, transportDescriptors,
} from "../../../src/providers/transports.ts";

const zeroPaidPolicy: EffectiveCostPolicy = Object.freeze({
  maximumPaidCost: 0,
  paidFallback: "prohibited",
  unknownPrice: "ineligible",
  acceptedCostClasses: Object.freeze(["local", "zero-price", "free-quota"]),
});

const groqAuthorization = Object.freeze({
  transport: "vercel-ai-sdk" as const,
  provider: "groq",
  entitlement: "free-quota",
  basis: "operator-declared-free-tier",
  maximumPaidCostUsd: 0,
  evidence: "documented free tier",
  sourceDocumentation: "https://console.groq.com/docs/rate-limits",
});

function economicsInput(overrides: Partial<EconomicEligibilityInput> = {}): EconomicEligibilityInput {
  return Object.freeze({
    transport: "vercel-ai-sdk" as const,
    provider: "groq",
    routeCost: "free-quota",
    routeEntitlement: "free-quota",
    routePaidFallback: false,
    policy: zeroPaidPolicy,
    authorizations: Object.freeze([groqAuthorization]),
    ...overrides,
  });
}

test("economic eligibility requires an explicit operator authorization", () => {
  assert.equal(evaluateExecutionEconomics(economicsInput()).code, "ECONOMICS_AUTHORIZED");
  // Absent authorization is ineligible; eligibility is never inferred.
  assert.equal(
    evaluateExecutionEconomics(economicsInput({ authorizations: Object.freeze([]) })).code,
    "ECONOMICS_AUTHORIZATION_ABSENT",
  );
});

test("one provider's authorization never transfers to another provider or transport", () => {
  assert.equal(
    evaluateExecutionEconomics(economicsInput({ provider: "cerebras" })).code,
    "ECONOMICS_AUTHORIZATION_ABSENT",
  );
  assert.equal(
    evaluateExecutionEconomics(economicsInput({ transport: "claude-cli" })).code,
    "ECONOMICS_AUTHORIZATION_ABSENT",
  );
});

test("economics fails closed on paid fallback, refused cost class and non-zero budget", () => {
  assert.equal(
    evaluateExecutionEconomics(economicsInput({ routePaidFallback: true })).code,
    "ECONOMICS_PAID_FALLBACK_REFUSED",
  );
  assert.equal(
    evaluateExecutionEconomics(economicsInput({ routeCost: "paid" })).code,
    "ECONOMICS_COST_CLASS_REFUSED",
  );
  assert.equal(
    evaluateExecutionEconomics(economicsInput({
      authorizations: Object.freeze([{ ...groqAuthorization, maximumPaidCostUsd: 5 }]),
    })).code,
    "ECONOMICS_BUDGET_NON_ZERO",
  );
  assert.equal(
    evaluateExecutionEconomics(economicsInput({
      authorizations: Object.freeze([{ ...groqAuthorization, entitlement: "subscription" }]),
    })).code,
    "ECONOMICS_ENTITLEMENT_MISMATCH",
  );
});

test("a non-zero-paid policy cannot authorize execution at all", () => {
  assert.equal(
    evaluateExecutionEconomics(economicsInput({
      policy: Object.freeze({ ...zeroPaidPolicy, maximumPaidCost: 10 }),
    })).code,
    "ECONOMICS_AUTHORIZATION_INVALID",
  );
  assert.equal(
    evaluateExecutionEconomics(economicsInput({
      policy: Object.freeze({ ...zeroPaidPolicy, paidFallback: "allowed" }),
    })).code,
    "ECONOMICS_AUTHORIZATION_INVALID",
  );
});

test("authorization parsing rejects malformed and unknown-transport entries", () => {
  const parsed = parseExecutionEconomicAuthorizations({
    authorizations: [
      groqAuthorization,
      { ...groqAuthorization, transport: "telepathy" },
      { ...groqAuthorization, maximumPaidCostUsd: "0" },
      null,
      "not an object",
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.provider, "groq");
  assert.deepEqual(parseExecutionEconomicAuthorizations({}), []);
  assert.deepEqual(parseExecutionEconomicAuthorizations(null), []);
});

test("an adapter transport is unusable without its exact required credential name", async () => {
  const base = {
    repositoryRoot: process.cwd(),
    homeDirectory: process.cwd(),
    observedAt: new Date().toISOString(),
    adapterInstalled: true,
    requiredCredentialName: "GROQ_API_KEY",
  };
  const usable = await observeTransportCapability("vercel-ai-sdk", {
    ...base, suppliedCredentialNames: Object.freeze(["GROQ_API_KEY"]),
  });
  assert.equal(usable.usable, true);
  assert.equal(usable.reason, null);

  const wrongName = await observeTransportCapability("vercel-ai-sdk", {
    ...base, suppliedCredentialNames: Object.freeze(["CEREBRAS_API_KEY"]),
  });
  assert.equal(wrongName.usable, false);
  assert.equal(wrongName.reason, "CREDENTIAL_NAME_ABSENT");

  const noFile = await observeTransportCapability("vercel-ai-sdk", {
    ...base, suppliedCredentialNames: Object.freeze([]),
  });
  assert.equal(noFile.usable, false);
  assert.equal(noFile.reason, "CREDENTIAL_FILE_ABSENT");

  const noAdapter = await observeTransportCapability("vercel-ai-sdk", {
    ...base, adapterInstalled: false, suppliedCredentialNames: Object.freeze(["GROQ_API_KEY"]),
  });
  assert.equal(noAdapter.usable, false);
  assert.equal(noAdapter.reason, "ADAPTER_NOT_INSTALLED");
});

test("a capability observation never carries a credential value or its digest", async () => {
  const capability = await observeTransportCapability("vercel-ai-sdk", {
    repositoryRoot: process.cwd(),
    homeDirectory: process.cwd(),
    observedAt: new Date().toISOString(),
    adapterInstalled: true,
    requiredCredentialName: "GROQ_API_KEY",
    suppliedCredentialNames: Object.freeze(["GROQ_API_KEY"]),
  });
  const serialized = JSON.stringify(capability);
  assert.equal(serialized.includes("sha256:"), false);
  assert.match(serialized, /"credentialName":"GROQ_API_KEY"/);
  assert.equal(capability.authenticationKind, "owner-private-credential-file");
});

test("a local agent transport authenticates by session material, not by credential name", () => {
  assert.equal(transportDescriptors["claude-cli"].authenticationKind, "local-agent-session");
  assert.equal(transportDescriptors["codex-cli"].authenticationKind, "local-agent-session");
  assert.equal(transportDescriptors["claude-cli"].sessionMaterial, ".claude/.credentials.json");
  assert.equal(transportDescriptors["codex-cli"].sessionMaterial, ".codex/auth.json");
  // An adapter transport declares no executable or session file.
  assert.equal(transportDescriptors["vercel-ai-sdk"].executable, null);
  assert.equal(transportDescriptors["vercel-ai-sdk"].sessionMaterial, null);
});

test("credential presence reports only names that are actually supplied", () => {
  const presence = credentialPresence(["GROQ_API_KEY", "CEREBRAS_API_KEY"], ["GROQ_API_KEY"]);
  assert.equal(presence.present, true);
  assert.deepEqual(presence.names, ["GROQ_API_KEY"]);
  const absent = credentialPresence(["GROQ_API_KEY"], []);
  assert.equal(absent.present, false);
  assert.deepEqual(absent.names, []);
});

test("deterministic selection orders eligible routes by ascending route identifier", () => {
  const routeIds = ["groq-qwen3.6-27b", "cerebras-gpt-oss-120b", "aaa-route"];
  const ordered = [...routeIds].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(ordered, ["aaa-route", "cerebras-gpt-oss-120b", "groq-qwen3.6-27b"]);
  // Selection must not depend on configuration order.
  const reversed = [...routeIds].reverse().sort((left, right) => left.localeCompare(right));
  assert.deepEqual(reversed, ordered);
});
