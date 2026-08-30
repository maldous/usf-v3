import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalDigest } from "../../../src/core/canonical.ts";
import type { ProviderRouteConfig } from "../../../src/providers/config.ts";
import type { ProviderProbeResult } from "../../../src/providers/probe.ts";
import {
  createQualificationPolicy,
  createQualificationSuite,
  qualifySemanticProfile,
  type QualificationPolicyDefinition,
  type QualificationSuiteDefinition,
} from "../../../src/providers/qualification.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";

interface QualificationConfigAsset {
  readonly $schema: "urn:usf:qualification-config:1";
  readonly suite: QualificationSuiteDefinition;
  readonly policy: QualificationPolicyDefinition;
}

const config = JSON.parse(readFileSync(new URL("../../../config/qualification.json", import.meta.url), "utf8")) as QualificationConfigAsset;
const resultSchema = JSON.parse(readFileSync(new URL("../../../schemas/semantic-qualification-result.schema.json", import.meta.url), "utf8")) as unknown;
const exactDigest = (value: unknown) => canonicalDigest(value, { rejectAbsolutePaths: true });
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const route: ProviderRouteConfig = Object.freeze({
  id: "fixture-typescript",
  family: "groq",
  provider: "groq",
  adapterPackage: "@ai-sdk/groq",
  credentialName: "GROQ_API_KEY",
  model: "qwen/qwen3.6-27b",
  capabilities: Object.freeze(["typescript"]),
  privacy: Object.freeze(["public"] as const),
  cost: "free-quota",
  entitlement: "free-quota",
  paidFallback: false,
  concurrency: 1,
  probeFreshnessSeconds: 900,
});

function probe(): ProviderProbeResult {
  const withoutDigest = {
    schema: "urn:usf:probe-result:1" as const,
    status: "ok" as const,
    routeId: route.id,
    endpointOrigin: "https://api.groq.com",
    serviceTier: "on_demand" as const,
    requested: { family: route.family, provider: route.provider, model: route.model },
    actual: { family: route.family, provider: route.provider, model: route.model, sdkProvider: "groq.chat" },
    inputs: {
      routeDigest: exactDigest(route),
      adapterPackage: route.adapterPackage,
      adapterVersion: "4.0.34",
      adapterLockDigest: digest("0"),
      catalogueRawDigest: digest("a"),
      catalogueNormalizedDigest: digest("b"),
      policyDigest: digest("c"),
      entitlementEvidenceDigest: digest("d"),
      probePromptDigest: digest("e"),
    },
    observedAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2026-08-30T00:15:00.000Z",
    capabilityEvaluations: [{ capability: "text-generation" as const, status: "available" as const, reasonCode: null }],
    quota: "available" as const,
    health: "available" as const,
    cost: { observedCost: null, currency: null, evidence: "entitlement" as const },
    usage: { inputTokens: 4, outputTokens: 2 },
    latencyMs: 10,
    limits: { timeoutMs: 500, maxRetries: 0 as const, maxOutputTokens: 8 as const },
    externalContact: true,
    authorityEffect: "none" as const,
    nonclaims: ["fixture observation only"],
  };
  return Object.freeze({ ...withoutDigest, resultDigest: exactDigest(withoutDigest) });
}

test("the V3 qualification config is versioned, deterministic, complete for declared task classes, and ceremony-free", () => {
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "policy", "suite"]);
  assert.equal(config.$schema, "urn:usf:qualification-config:1");
  assert.equal(config.suite.suiteVersion, "1.0.0");
  assert.equal(config.suite.corpusVersion, "1.0.0");
  assert.equal(config.policy.policyVersion, "1.0.0");
  assert.equal(config.policy.defaultRole, "UNQUALIFIED");

  const suite = createQualificationSuite(config.suite);
  const policy = createQualificationPolicy(config.policy);
  assert.deepEqual(createQualificationSuite(config.suite), suite);
  assert.deepEqual(createQualificationPolicy(config.policy), policy);
  assert.equal(Object.isFrozen(suite.corpus.cases), true);
  assert.equal(Object.isFrozen(policy.thresholds), true);

  const taskClasses = [...new Set(config.suite.cases.map((item) => item.taskClass))].sort();
  assert.deepEqual(taskClasses, ["cli-design", "node-test", "provider-routing", "typescript"]);
  assert.deepEqual([...new Set(config.policy.thresholds.map((item) => item.taskClass))].sort(), taskClasses);
  for (const threshold of config.policy.thresholds) {
    const dimensions = new Set(config.suite.cases
      .filter((item) => item.taskClass === threshold.taskClass)
      .map((item) => item.dimension));
    assert.equal(threshold.minimumScores.every((minimum) => dimensions.has(minimum.dimension)), true, threshold.taskClass);
  }

  const serialized = JSON.stringify(config).toLowerCase();
  for (const forbidden of ["signature", "cas:", "roster", "lease", "fence"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("missing answers remain zero/default UNQUALIFIED and the closed result schema accepts the exact V3 output", () => {
  const suite = createQualificationSuite(config.suite);
  const policy = createQualificationPolicy(config.policy);
  const result = qualifySemanticProfile({
    profile: {
      schema: "urn:usf:agent-profile:1",
      provider: route.provider,
      requestedModel: route.model,
      adapter: route.adapterPackage,
      adapterVersion: "4.0.34",
      adapterLockDigest: digest("0"),
      authMode: "api_token",
      toolProfile: "scope-checked-tools-v1",
      toolProfileDigest: digest("1"),
      promptVersion: "provider-semantic-v1",
      promptDigest: digest("2"),
      contextConfig: "bounded-context-v1",
      contextConfigDigest: digest("3"),
      outputConfig: "json-output-v1",
      outputConfigDigest: digest("4"),
    },
    taskClass: "typescript",
    suite,
    policy,
    route,
    providerConfigDigest: digest("f"),
    effectivePolicyDigest: digest("c"),
    probe: probe(),
    answers: [],
    evaluatedAt: "2026-08-30T00:00:30.000Z",
  });

  assert.equal(result.status, "unqualified");
  assert.deepEqual(result.derivedRoles, ["UNQUALIFIED"]);
  assert.equal(result.casesAnswered, 0);
  assert.equal(result.taskScore, 0);
  assert.deepEqual(result.caseEvaluations.map((item) => item.score), [0, 0, 0, 0]);

  const validator = createJsonSchemaValidator(resultSchema);
  assert.equal(validator.schemaId, "urn:usf:semantic-qualification-result:1");
  assert.equal(validator.validate(result).valid, true);
  assert.equal(validator.validate({ ...result, signature: digest("0") }).valid, false);
  assert.equal(validator.validate({ ...result, qualificationDigest: "sha256:invalid" }).valid, false);
  assert.equal(validator.validate({ ...result, derivedRoles: ["MODEL_APPROVED"] }).valid, false);
});
