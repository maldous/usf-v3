import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { canonicalDigest } from "../../../src/core/canonical.ts";
import type { ProviderRouteConfig } from "../../../src/providers/config.ts";
import type { ProviderProbeResult } from "../../../src/providers/probe.ts";
import {
  createQualificationPolicy,
  createQualificationSuite,
  qualifySemanticProfile,
  type SemanticQualificationResult,
} from "../../../src/providers/qualification.ts";
import {
  createRoutingSemanticBinding,
  routeWork as routeWorkCore,
  type ConfiguredRouteForRouting,
  type EffectiveRoutingPolicy,
  type ProbeForRouting,
  type RoutingInput,
  type RoutingSemanticBinding,
  type SemanticQualificationForRouting,
  type SemanticQualificationReplaySourceForRouting,
  type TrustedSemanticQualificationAuthorityForRouting,
} from "../../../src/providers/routing.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";
import { proposalBasis } from "../../fixtures/proposal-packet.ts";
import { createRealisationBasis } from "../../../src/realisation/basis.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const exactDigest = (value: unknown) => canonicalDigest(value, { rejectAbsolutePaths: true });
const schemaPath = fileURLToPath(new URL("../../../schemas/route-result.schema.json", import.meta.url));
const resultValidator = createJsonSchemaValidator(JSON.parse(readFileSync(schemaPath, "utf8")));
const zeroPrices = Object.freeze({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, inputAudio: 0, outputAudio: 0 });
const semanticTaskClass = "typescript-implementation";

const qualificationSuite = createQualificationSuite({
  suiteId: "usf-semantic-qualification", suiteVersion: "v1", corpusId: "usf-semantic-fixtures", corpusVersion: "2026-08-30",
  cases: [{
    caseId: "typescript-safe-change", taskClass: semanticTaskClass, dimension: "implementation",
    prompt: "Select the bounded implementation.", grader: { kind: "exact", value: "scoped patch" }, holdout: false, weight: 1,
  }],
});

const qualificationPolicy = createQualificationPolicy({
  policyId: "usf-task-trust", policyVersion: "v1", defaultRole: "UNQUALIFIED", validitySeconds: 86_400,
  thresholds: [{ taskClass: semanticTaskClass, role: "PATCH_PRODUCER", minimumScores: [{ dimension: "implementation", minimum: 1 }] }],
});

const trustedQualificationAuthority: TrustedSemanticQualificationAuthorityForRouting = Object.freeze({
  suite: qualificationSuite,
  policy: qualificationPolicy,
});

function routeWork(value: RoutingInput) {
  return routeWorkCore(value, trustedQualificationAuthority);
}

const semanticBinding = (): RoutingSemanticBinding => createRoutingSemanticBinding(
  { profile: "urn:usf:profile:v3-self-host:2", version: "2", profileDigest: digest("1") },
  { applicability: "applicable", profile: "urn:anqr:profile:decoded-payload-bootstrap:1", version: "1", profileDigest: digest("2") },
);

const route = (id: string, family: string, model: string, underlyingFamily: string): ConfiguredRouteForRouting => {
  const config = {
    id, family, provider: family, adapterPackage: `@ai-sdk/${family}`, credentialName: `${family.toUpperCase()}_API_KEY`,
    model, capabilities: ["typescript"], privacy: ["public"], cost: "free-quota", entitlement: "free-quota",
    paidFallback: false, concurrency: 2, probeFreshnessSeconds: 900,
  };
  return {
    id, configDigest: exactDigest(config), family, provider: family, model, underlyingModelFamily: underlyingFamily,
    adapter: config.adapterPackage, credential: config.credentialName, capabilities: config.capabilities, privacy: config.privacy,
    costClass: "free-quota", paidFallback: false, entitlement: "verified", concurrency: 2,
  };
};

const policy = (): EffectiveRoutingPolicy => ({
  maximumPaidCost: 0, paidFallback: "prohibited", unknownPrice: "ineligible",
  acceptedCostClasses: ["local", "zero-price", "free-quota"],
  effectivePrivacy: { workClassification: "public", allowedRouteDeclarations: ["public"] },
});

function bindProbe(value: Omit<ProbeForRouting, "resultDigest">): ProbeForRouting {
  return Object.freeze({ ...value, resultDigest: exactDigest(value) });
}

function probesFor(routes: readonly ConfiguredRouteForRouting[], catalogueRawDigest: string, catalogueNormalizedDigest: string, policyDigest: string): ProbeForRouting[] {
  return routes.map((item, index) => bindProbe({
    schema: "urn:usf:probe-result:1", status: "ok", routeId: item.id,
    endpointOrigin: item.provider === "groq" ? "https://api.groq.com" : item.provider === "cerebras" ? "https://api.cerebras.ai" : null,
    serviceTier: item.provider === "groq" ? "on_demand" : item.provider === "cerebras" ? "default" : null,
    requested: { family: item.family, provider: item.provider, model: item.model },
    actual: { family: item.family, provider: item.provider, model: item.model, sdkProvider: `${item.provider}.chat` },
    inputs: {
      routeDigest: item.configDigest, catalogueRawDigest, catalogueNormalizedDigest, policyDigest,
      entitlementEvidenceDigest: digest(index === 0 ? "8" : "9"), probePromptDigest: digest("5"),
      adapterPackage: item.adapter, adapterVersion: "1.0.0",
      adapterLockDigest: exactDigest({ adapter: item.adapter, version: "1.0.0" }),
    },
    observedAt: "2026-08-30T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z",
    capabilityEvaluations: [{ capability: "text-generation", status: "available", reasonCode: null }],
    quota: "available", health: "available", cost: { observedCost: null, currency: null, evidence: "entitlement" },
    usage: { inputTokens: 8, outputTokens: 4 }, latencyMs: 20.25 - index,
    limits: { timeoutMs: 500, maxRetries: 0, maxOutputTokens: 8 }, externalContact: true, authorityEffect: "none",
    nonclaims: ["operational observation only"],
  }));
}

function providerRoute(item: ConfiguredRouteForRouting): ProviderRouteConfig {
  return {
    id: item.id, family: item.family, provider: item.provider, adapterPackage: item.adapter, credentialName: item.credential,
    model: item.model, capabilities: item.capabilities, privacy: item.privacy as ProviderRouteConfig["privacy"],
    cost: item.costClass, entitlement: item.costClass === "local" ? "local" : item.costClass === "zero-price" ? "zero-price" : "free-quota",
    paidFallback: item.paidFallback, concurrency: item.concurrency, probeFreshnessSeconds: 900,
  };
}

function qualificationReplaySourceFor(
  value: RoutingInput,
  item: ConfiguredRouteForRouting,
  qualified = true,
): SemanticQualificationReplaySourceForRouting {
  return {
    routeId: item.id,
    taskClass: semanticTaskClass,
    route: providerRoute(item),
    profile: {
      schema: "urn:usf:agent-profile:1", provider: item.provider, requestedModel: item.model, adapter: item.adapter,
      adapterVersion: "1.0.0", adapterLockDigest: exactDigest({ adapter: item.adapter, version: "1.0.0" }),
      authMode: "api_token", toolProfile: "scope-checked-tools-v1", promptVersion: "semantic-eval-v1",
      contextConfig: "bounded-context-v1", outputConfig: "json-output-v1",
      toolProfileDigest: exactDigest({ profile: "scope-checked-tools-v1", routeId: item.id }),
      promptDigest: exactDigest({ prompt: "semantic-eval-v1" }),
      contextConfigDigest: exactDigest({ context: "bounded-context-v1" }),
      outputConfigDigest: exactDigest({ output: "json-output-v1" }),
    },
    answers: [{ caseId: "typescript-safe-change", answer: qualified ? "scoped patch" : "unbounded rewrite" }],
    evaluatedAt: value.now,
  };
}

function qualificationFor(
  value: RoutingInput,
  item: ConfiguredRouteForRouting,
  source: SemanticQualificationReplaySourceForRouting,
): SemanticQualificationResult {
  const selectedProbe = value.probes.find((probe) => probe.routeId === item.id)!;
  return qualifySemanticProfile({
    profile: source.profile, taskClass: source.taskClass,
    suite: qualificationSuite, policy: qualificationPolicy, route: source.route,
    providerConfigDigest: value.providerConfigDigest, effectivePolicyDigest: value.policyDigest,
    probe: selectedProbe as ProviderProbeResult, answers: source.answers, evaluatedAt: source.evaluatedAt,
  });
}

function requalify(value: RoutingInput, qualified = true): RoutingInput {
  if (value.work.semanticRequirements.length === 0) {
    return {
      ...value,
      semanticQualificationProfiles: [], semanticQualifications: [],
      semanticQualificationReplay: { sources: [] },
    };
  }
  const sources = value.routes.map((item) => qualificationReplaySourceFor(value, item, qualified));
  const semanticQualifications = value.routes.map((item, index) => qualificationFor(value, item, sources[index]!));
  return {
    ...value,
    semanticQualificationProfiles: value.routes.map((item, index) => ({ routeId: item.id, profileDigest: semanticQualifications[index]!.profile.profileDigest })),
    semanticQualifications,
    semanticQualificationReplay: { sources },
  };
}

function rehashQualification(value: Omit<SemanticQualificationForRouting, "qualificationDigest">): SemanticQualificationForRouting {
  return { ...value, qualificationDigest: exactDigest(value) };
}

function mutateProbe(probe: ProbeForRouting, mutation: (basis: Omit<ProbeForRouting, "resultDigest">) => Omit<ProbeForRouting, "resultDigest">): ProbeForRouting {
  const { resultDigest: _digest, ...basis } = probe;
  return bindProbe(mutation(basis));
}

function input(): RoutingInput {
  const routes = [
    route("cerebras-primary", "cerebras", "meta/llama+fast~free", "llama"),
    route("groq-primary", "groq", "qwen/coder+fast~free", "qwen"),
  ];
  const effectivePolicy = policy();
  const policyDigest = exactDigest(effectivePolicy);
  const catalogueRawDigest = digest("0");
  const catalogueNormalizedDigest = digest("b");
  const binding = semanticBinding();
  const baseBasis = proposalBasis("urn:usf:work:test", digest("a"));
  const { basisDigest: _baseDigest, ...baseDraft } = baseBasis;
  const basis = createRealisationBasis({ ...baseDraft, selection: {
    ...baseBasis.selection, profile: binding.core.profile, profileVersion: binding.core.version, profileDigest: binding.core.profileDigest,
    product: binding.product.profile, productVersion: binding.product.version, productDigest: binding.product.profileDigest,
    coreToProductDigest: binding.directional.coreToProductDigest, productToCoreDigest: binding.directional.productToCoreDigest, compositeDigest: binding.compositeDigest,
  } });
  return requalify({
    basis,
    work: {
      id: "urn:usf:work:test", digest: digest("a"), semanticBinding: binding, capabilities: ["typescript"],
      semanticRequirements: [{ capability: "typescript", taskClass: semanticTaskClass }], privacy: "public",
    },
    routes,
    catalogue: routes.map((item) => ({
      provider: item.provider, model: item.model, underlyingModelFamily: item.underlyingModelFamily!,
      underlyingModel: `${item.underlyingModelFamily}/base+model~v1`, capabilities: ["tool-call"], prices: zeroPrices,
    })),
    probes: probesFor(routes, catalogueRawDigest, catalogueNormalizedDigest, policyDigest),
    semanticQualificationAuthority: {
      suiteDigest: qualificationSuite.suiteDigest, corpusDigest: qualificationSuite.corpusDigest,
      qualificationPolicyDigest: qualificationPolicy.policyDigest,
    },
    semanticQualificationProfiles: [], semanticQualifications: [], providerConfigDigest: digest("d"),
    semanticQualificationReplay: { sources: [] },
    installedAdapters: new Set(routes.map((item) => item.adapter)), credentialNamesPresent: new Set(routes.map((item) => item.credential)),
    catalogueRawDigest, catalogueNormalizedDigest, policyDigest, policy: effectivePolicy,
    now: "2026-08-30T00:00:30.000Z", strategy: "review-diverse", hostConcurrency: 8, maxAssignments: 8,
  });
}

function withRoutes(value: RoutingInput, routes: readonly ConfiguredRouteForRouting[]): RoutingInput {
  const reboundRoutes = routes.map((item) => ({ ...item, configDigest: exactDigest(providerRoute(item)) }));
  return requalify({
    ...value, routes: reboundRoutes, probes: probesFor(reboundRoutes, value.catalogueRawDigest, value.catalogueNormalizedDigest, value.policyDigest),
    semanticQualificationProfiles: [], semanticQualifications: [],
  });
}

function withSemanticBinding(value: RoutingInput, binding: RoutingSemanticBinding): RoutingInput {
  const { basisDigest: _basisDigest, ...basisDraft } = value.basis;
  const basis = createRealisationBasis({ ...basisDraft, selection: {
    ...value.basis.selection, profile: binding.core.profile, profileVersion: binding.core.version, profileDigest: binding.core.profileDigest,
    product: binding.product.profile, productVersion: binding.product.version,
    productDigest: binding.product.profileDigest === "not-applicable" ? value.basis.selection.productDigest : binding.product.profileDigest,
    coreToProductDigest: binding.directional.coreToProductDigest, productToCoreDigest: binding.directional.productToCoreDigest, compositeDigest: binding.compositeDigest,
  } });
  return { ...value, basis, work: { ...value.work, semanticBinding: binding } };
}

function withPolicy(value: RoutingInput, nextPolicy: EffectiveRoutingPolicy): RoutingInput {
  const policyDigest = exactDigest(nextPolicy);
  return requalify({
    ...value, policy: nextPolicy, policyDigest,
    probes: probesFor(value.routes, value.catalogueRawDigest, value.catalogueNormalizedDigest, policyDigest),
    semanticQualificationProfiles: [], semanticQualifications: [],
  });
}

test("routing validates, partitions and binds exact qualification plus both semantic axes", () => {
  const first = routeWork(input());
  assert.deepEqual(routeWork(input()), first);
  assert.equal(resultValidator.validate(first).valid, true, JSON.stringify(resultValidator.validate(first).errors));
  assert.equal(first.status, "ok");
  assert.deepEqual(first.denominators, {
    configuredRoutes: 2, assessedRoutes: 2, eligibleRoutes: 2, excludedRoutes: 0,
    eligibleUnassignedRoutes: 0, eligibleProviderFamilies: 2, assignedRoutes: 2,
  });
  assert.equal(first.assessments.every((row) => row.semanticCapabilities[0] === "typescript"
    && row.semanticTaskClasses[0] === semanticTaskClass), true);
  for (const assignment of first.assignments) {
    assert.deepEqual(assignment.semanticBinding, semanticBinding());
    assert.equal(assignment.qualification.semanticQualification.applicability, "required");
    if (assignment.qualification.semanticQualification.applicability === "required") {
      assert.deepEqual(assignment.qualification.semanticQualification.requiredTaskClasses, [semanticTaskClass]);
      const [qualificationDigest] = assignment.qualification.semanticQualification.qualificationDigests;
      const reference = first.semanticQualifications.find((item) => item.qualificationDigest === qualificationDigest)!;
      assert.equal(reference.taskClass, semanticTaskClass);
      assert.equal(reference.suiteDigest, qualificationSuite.suiteDigest);
      assert.equal(reference.corpusDigest, qualificationSuite.corpusDigest);
      assert.equal(reference.probeResultDigest, assignment.qualification.probeDigest);
    }
    assert.equal(assignment.qualification.validAt, input().now);
  }
});

test("replay evidence cannot self-authorize without the separate tracked qualification authority", () => {
  const value = input();
  const withoutAuthority = routeWorkCore as unknown as (input: RoutingInput) => unknown;
  assert.throws(() => withoutAuthority(value), /ROUTE_SEMANTIC_QUALIFICATION_INVALID/);
  assert.throws(() => routeWorkCore(value, {
    suite: qualificationSuite,
    policy: { ...qualificationPolicy, policyDigest: digest("f") },
  }), /ROUTE_SEMANTIC_QUALIFICATION_INVALID/);

  const selfDefinedEnvelope = {
    ...value,
    semanticQualificationAuthority: {
      suiteDigest: digest("e"), corpusDigest: digest("f"), qualificationPolicyDigest: digest("9"),
    },
  };
  assert.throws(() => routeWorkCore(selfDefinedEnvelope, trustedQualificationAuthority), /ROUTE_SEMANTIC_QUALIFICATION_INVALID/);
});

test("configured declarations cannot admit semantic work; text-generation remains explicitly mechanical", () => {
  const declaredOnly = input();
  const refused = routeWork({ ...declaredOnly, semanticQualifications: [] });
  assert.equal(refused.assessments.every((row) => row.exclusionReason === "SEMANTIC_QUALIFICATION_MISSING"), true);

  const mechanicalRoutes = declaredOnly.routes.map((item) => ({ ...item, capabilities: ["text-generation"] }));
  const mechanical = routeWork(requalify({
    ...withRoutes(declaredOnly, mechanicalRoutes),
    work: { ...declaredOnly.work, capabilities: ["text-generation"], semanticRequirements: [] }, semanticQualificationProfiles: [], semanticQualifications: [],
  }));
  assert.equal(mechanical.status, "ok");
  assert.equal(mechanical.assessments.every((row) => row.mechanicalCapabilities.includes("text-generation") && row.semanticCapabilities.length === 0), true);
  assert.equal(mechanical.assignments.every((assignment) => assignment.qualification.semanticQualification.applicability === "not-required"), true);
});

test("semantic qualification exclusions are exact, current and capability scoped", () => {
  const cases: Array<[string, (value: RoutingInput) => RoutingInput]> = [
    ["SEMANTIC_QUALIFICATION_MISSING", (value) => ({ ...value, semanticQualifications: [] })],
    ["SEMANTIC_QUALIFICATION_MISMATCH", (value) => ({
      ...value,
      semanticQualifications: value.semanticQualifications.map((record) => {
        const { qualificationDigest: _old, ...basis } = record;
        return rehashQualification({
          ...basis,
          profile: { ...basis.profile, requested: { ...basis.profile.requested, toolProfileDigest: digest("f") } },
        });
      }),
    })],
    ["SEMANTIC_QUALIFICATION_STALE", (value) => ({
      ...value, now: "2026-09-01T00:00:30.000Z",
    })],
    ["SEMANTIC_CAPABILITY_UNQUALIFIED", (value) => requalify({ ...value, semanticQualificationProfiles: [], semanticQualifications: [] }, false)],
  ];
  for (const [reason, mutate] of cases) {
    const result = routeWork(mutate(input()));
    assert.equal(result.status, "refused", reason);
    assert.equal(result.assessments.every((row) => row.exclusionReason === reason && row.disposition === "excluded"), true, reason);
  }
  assert.equal(routeWork(input()).status, "ok");
});

test("qualification tampering and authority invalidation change bound digests and refuse", () => {
  const base = input();
  const admitted = routeWork(base);
  const tampered = { ...base, semanticQualifications: base.semanticQualifications.map((record) => ({ ...record, taskScore: 0 })) };
  const tamperedResult = routeWork(tampered);
  assert.equal(tamperedResult.assessments.every((row) => row.exclusionReason === "SEMANTIC_QUALIFICATION_MISMATCH"), true);
  assert.notEqual(tamperedResult.inputs.semanticQualificationSetDigest, admitted.inputs.semanticQualificationSetDigest);
  assert.notEqual(tamperedResult.resultDigest, admitted.resultDigest);

  const invalidated = { ...base, semanticQualificationAuthority: { ...base.semanticQualificationAuthority, corpusDigest: digest("f") } };
  assert.throws(() => routeWork(invalidated), /ROUTE_SEMANTIC_QUALIFICATION_INVALID/);
});

test("route-time replay rejects a rehashed forged qualified score and role derivation", () => {
  const unqualified = requalify({ ...input(), semanticQualificationProfiles: [], semanticQualifications: [] }, false);
  const semanticQualifications = unqualified.semanticQualifications.map((record) => {
    const { qualificationDigest: _old, ...basis } = record;
    return rehashQualification({
      ...basis,
      status: "qualified",
      taskScore: 1,
      casesPassed: basis.casesTotal,
      derivedRoles: ["PATCH_PRODUCER"],
      caseEvaluations: basis.caseEvaluations.map((item) => ({ ...item, score: 1, passed: true })),
      dimensionEvaluations: basis.dimensionEvaluations.map((item) => ({ ...item, score: 1, passed: item.total })),
    });
  });
  const result = routeWork({ ...unqualified, semanticQualifications });
  assert.equal(result.status, "refused");
  assert.equal(result.assessments.every((row) => row.exclusionReason === "SEMANTIC_QUALIFICATION_MISMATCH"), true);
});

test("routing rejects qualification enum values that the qualification verifier rejects", () => {
  type QualificationBasis = Omit<SemanticQualificationForRouting, "qualificationDigest">;
  const cases: Array<[string, (basis: QualificationBasis) => unknown]> = [
    ["invented role", (basis) => ({ ...basis, derivedRoles: ["invented-role"] })],
    ["UNQUALIFIED mixed into qualified roles", (basis) => ({ ...basis, derivedRoles: ["UNQUALIFIED", "PATCH_PRODUCER"] })],
    ["unknown auth mode", (basis) => ({
      ...basis, profile: { ...basis.profile, requested: { ...basis.profile.requested, authMode: "invented-auth" } },
    })],
    ["unknown case dimension", (basis) => ({
      ...basis, caseEvaluations: basis.caseEvaluations.map((item, index) => index === 0 ? { ...item, dimension: "invented-dimension" } : item),
    })],
    ["unknown aggregate dimension", (basis) => ({
      ...basis, dimensionEvaluations: basis.dimensionEvaluations.map((item, index) => index === 0 ? { ...item, dimension: "invented-dimension" } : item),
    })],
  ];
  for (const [name, mutate] of cases) {
    const value = input();
    const semanticQualifications = value.semanticQualifications.map((record, index) => {
      if (index !== 0) return record;
      const { qualificationDigest: _old, ...basis } = record;
      return rehashQualification(mutate(basis) as QualificationBasis);
    });
    assert.throws(() => routeWork({ ...value, semanticQualifications }), /ROUTE_SEMANTIC_QUALIFICATION_INVALID/, name);
  }
});

test("same-model routes select only their exact route and profile qualification", () => {
  const base = input();
  const first = base.routes[0]!;
  const second = route("cerebras-secondary", first.family, first.model, first.underlyingModelFamily!);
  const value = withRoutes(base, [first, second]);
  assert.equal(new Set(value.routes.map((item) => item.configDigest)).size, 2);
  assert.equal(new Set(value.semanticQualifications.map((item) => item.profile.profileDigest)).size, 2);

  const result = routeWork(value);
  assert.equal(result.status, "ok");
  assert.equal(result.denominators.eligibleRoutes, 2);
  assert.equal(result.assignments.length, 2);
  for (const assignment of result.assignments) {
    assert.equal(assignment.qualification.providerRouteConfigDigest,
      value.semanticQualifications.find((item) => item.qualificationDigest
        === (assignment.qualification.semanticQualification.applicability === "required"
          ? assignment.qualification.semanticQualification.qualificationDigests[0]
          : null))!.inputs.routeDigest);
  }
});

test("assignment digests change with scoped operational and semantic bindings", () => {
  const base = input();
  const baseDigest = routeWork(base).assignments[0]!.assignmentDigest;
  const changedProviderConfig = requalify({ ...base, providerConfigDigest: digest("e"), semanticQualificationProfiles: [], semanticQualifications: [] });
  const changedProbe = requalify({
    ...base, probes: base.probes.map((probe) => mutateProbe(probe, (basis) => ({ ...basis, latencyMs: (basis.latencyMs ?? 0) + 0.125 }))),
    semanticQualificationProfiles: [], semanticQualifications: [],
  });
  const cases: RoutingInput[] = [
    changedProviderConfig,
    changedProbe,
    withPolicy(base, { ...base.policy, acceptedCostClasses: ["free-quota"] }),
    withSemanticBinding(base, createRoutingSemanticBinding({ ...base.work.semanticBinding.core, profileDigest: digest("e") }, base.work.semanticBinding.product)),
  ];
  for (const value of cases) assert.notEqual(routeWork(value).assignments[0]!.assignmentDigest, baseDigest);
  assert.notEqual(routeWork(changedProbe).inputs.probeSetDigest, routeWork(base).inputs.probeSetDigest);
});

test("product non-applicability is explicit and directional claims are constructed", () => {
  const value = input();
  const notApplicable = createRoutingSemanticBinding(
    value.work.semanticBinding.core,
    { applicability: "not-applicable", profile: "not-applicable", version: "not-applicable", profileDigest: "not-applicable" },
  );
  const result = routeWork(withSemanticBinding(value, notApplicable));
  assert.equal(result.assignments[0]!.semanticBinding.product.applicability, "not-applicable");
  assert.throws(() => routeWork({
    ...value,
    work: { ...value.work, semanticBinding: { ...notApplicable, directional: { ...notApplicable.directional, coreToProductDigest: digest("3") } } },
  }), /ROUTE_SEMANTIC_BINDING_INVALID/);
});

test("route dispositions remain a complete partition under caps and exclusions", () => {
  const capped = routeWork({ ...input(), maxAssignments: 1 });
  assert.deepEqual(capped.assessments.map((row) => row.disposition).sort(), ["assigned", "eligible-unassigned"]);
  assert.equal(capped.denominators.assignedRoutes + capped.denominators.excludedRoutes + capped.denominators.eligibleUnassignedRoutes, capped.denominators.configuredRoutes);
  const value = input();
  const result = routeWork(withRoutes(value, value.routes.map((item, index) => index === 0 ? { ...item, paidFallback: true } : item)));
  assert.deepEqual(result.assessments.map((row) => row.disposition).sort(), ["assigned", "excluded"]);
});

test("catalogue identity, privacy and every zero-price dimension fail closed", () => {
  const value = input();
  const mismatch = { ...value, routes: value.routes.map((item) => ({ ...item, underlyingModelFamily: "fabricated" })) };
  assert.equal(routeWork(mismatch).assessments.every((row) => row.exclusionReason === "CATALOGUE_UNDERLYING_IDENTITY_MISMATCH"), true);
  const restricted = withPolicy(value, { ...value.policy, effectivePrivacy: { workClassification: "public", allowedRouteDeclarations: ["restricted"] } });
  assert.equal(routeWork(restricted).assessments.every((row) => row.exclusionReason === "PRIVACY_INELIGIBLE"), true);

  const zeroBase = withRoutes(value, value.routes.map((item) => ({ ...item, costClass: "zero-price" as const })));
  assert.equal(routeWork(zeroBase).status, "ok");
  for (const dimension of Object.keys(zeroPrices) as Array<keyof typeof zeroPrices>) {
    const unknown = { ...zeroBase, catalogue: zeroBase.catalogue.map((fact) => ({ ...fact, prices: { ...fact.prices, [dimension]: null } })) };
    assert.equal(routeWork(unknown).assessments.every((row) => row.exclusionReason === "CATALOGUE_PRICE_UNKNOWN"), true, dimension);
    const nonzero = { ...zeroBase, catalogue: zeroBase.catalogue.map((fact) => ({ ...fact, prices: { ...fact.prices, [dimension]: 0.0001 } })) };
    assert.equal(routeWork(nonzero).assessments.every((row) => row.exclusionReason === "CATALOGUE_PRICE_NONZERO"), true, dimension);
  }
});

test("exact probe results are recomputed and operational exclusions precede semantic admission", () => {
  const cases: Array<[string, (probe: ProbeForRouting) => ProbeForRouting]> = [
    ["PROBE_INPUT_MISMATCH", (probe) => ({ ...probe, resultDigest: digest("f") })],
    ["PROBE_STALE", (probe) => mutateProbe(probe, (basis) => ({ ...basis, expiresAt: "2020-01-01T00:00:00.000Z" }))],
    ["PROBE_QUOTA_UNKNOWN", (probe) => mutateProbe(probe, (basis) => ({ ...basis, quota: "unknown" }))],
    ["PROBE_ACTUAL_IDENTITY_MISMATCH", (probe) => mutateProbe(probe, (basis) => ({ ...basis, actual: { ...basis.actual!, provider: "hidden-router" } }))],
    ["PROBE_COST_NONZERO", (probe) => mutateProbe(probe, (basis) => ({ ...basis, cost: { observedCost: 0.01, currency: "USD", evidence: "provider-reported" } }))],
    ["ENTITLEMENT_UNVERIFIED", (probe) => mutateProbe(probe, (basis) => ({ ...basis, inputs: { ...basis.inputs, entitlementEvidenceDigest: null } }))],
  ];
  for (const [reason, mutate] of cases) {
    const value = input();
    const result = routeWork({ ...value, probes: value.probes.map(mutate) });
    assert.equal(result.assessments.every((row) => row.exclusionReason === reason), true, reason);
  }
});

test("routing validates strategy and runtime numeric fields before selection", () => {
  for (const cap of [Number.NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => routeWork({ ...input(), hostConcurrency: cap }), /ROUTE_CAP_INVALID/);
  }
  assert.throws(() => routeWork({ ...input(), strategy: "invented" as RoutingInput["strategy"] }), /ROUTE_STRATEGY_INVALID/);
  const value = input();
  assert.throws(() => routeWork({ ...value, work: { ...value.work, semanticRequirements: [] } }), /ROUTE_WORK_IDENTITY_INVALID/);
  assert.throws(() => routeWork({ ...value, probes: value.probes.map((probe) => ({ ...probe, latencyMs: Number.NaN })) }), /ROUTE_PROBE_INVALID/);
  assert.throws(() => routeWork({ ...value, routes: value.routes.map((item) => ({ ...item, concurrency: Infinity })) }), /ROUTE_CONFIG_INVALID/);
  assert.throws(() => routeWork({ ...value, catalogue: value.catalogue.map((fact) => ({ ...fact, prices: { ...fact.prices, input: -1 } })) }), /ROUTE_CATALOGUE_INVALID/);
});
