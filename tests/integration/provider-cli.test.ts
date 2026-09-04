import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import { normalizeModelsDevCatalogue } from "../../src/providers/catalogue.ts";
import {
  answerDigest, createQualificationPolicy, createQualificationSuite,
  promptDigest, sealQualificationObservation,
} from "../../src/providers/qualification.ts";
import { createRoutingSemanticBinding } from "../../src/providers/routing.ts";
import { observeInstalledAdapter } from "../../src/commands/models.ts";
import { proposalBasis } from "../fixtures/proposal-packet.ts";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const usf = resolve(repositoryRoot, "bin/usf");
const digest = (character: string) => `sha256:${character.repeat(64)}`;

/**
 * Every case in this file drives the repository CLI through a real subprocess.
 * The hermetic validation cage runs Node with `--permission` and grants no
 * child-process capability, which
 * urn:usf:environment:bootstrap-carrier-no-network and the invocation-boundary
 * admission policy both state deliberately: the cage proves in-process
 * boundaries and the outer authoritative lane separately exercises the scrubbed
 * child process. Skipping in the cage keeps that separation explicit instead of
 * widening the sandbox to reach a subprocess.
 */
function childProcessUnavailable(context: TestContext): boolean {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission === undefined || permission.has("child_process")) return false;
  context.skip("the repository CLI subprocess boundary runs in the direct outer authoritative validation");
  return true;
}
const trackedQualificationConfig = JSON.parse(
  readFileSync(resolve(repositoryRoot, "config/qualification.json"), "utf8"),
) as { suite: Parameters<typeof createQualificationSuite>[0]; policy: Parameters<typeof createQualificationPolicy>[0] };
const trackedQualificationAuthority = Object.freeze({
  suite: createQualificationSuite(trackedQualificationConfig.suite),
  policy: createQualificationPolicy(trackedQualificationConfig.policy),
});

/**
 * A hang guard, not a performance budget.
 *
 * Five seconds was sized when the loaded corpus was about 33 000 quads. It is
 * now about 41 700, a profile-bound census measures 2.9 to 3.1 seconds on its
 * own, and under parallel test load that intermittently crossed five. The
 * failure was real and its cause was headroom, so the guard moves rather than
 * the measurement being explained away. Nothing here asserts speed; if a
 * command genuinely hangs, twenty seconds still catches it.
 */
const COMMAND_HANG_GUARD_MS = 20_000;

function invoke(args: readonly string[], input?: string, extraEnvironment: NodeJS.ProcessEnv = {}, cwd = repositoryRoot): Record<string, unknown> {
  const result = spawnSync(usf, args, { cwd, encoding: "utf8", input, timeout: COMMAND_HANG_GUARD_MS, env: { ...process.env, ...extraEnvironment, GIT_TERMINAL_PROMPT: "0" } });
  assert.equal(result.error, undefined, `command timed out: ${args.join(" ")}`);
  assert.equal(result.stderr, "", `command wrote stderr: ${result.stderr}`);
  assert.equal(result.status, 0, `command failed: ${result.stdout}`);
  return JSON.parse(String(result.stdout).trim()) as Record<string, unknown>;
}

function withProviderCliFixture(run: (fixtureRoot: string) => void): void {
  const temporaryRoot = resolve(repositoryRoot, ".usf/tmp");
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  chmodSync(temporaryRoot, 0o700);
  const fixtureRoot = mkdtempSync(resolve(temporaryRoot, "provider-cli-repository-"));
  try {
    for (const directory of ["bin", "config", "docs", "evidence", "graph", "recipes", "schemas", "scripts", "src", "tests"]) {
      cpSync(resolve(repositoryRoot, directory), resolve(fixtureRoot, directory), { recursive: true });
    }
    for (const path of ["GOAL.md", "package.json", "pnpm-lock.yaml"]) {
      cpSync(resolve(repositoryRoot, path), resolve(fixtureRoot, path));
    }
    mkdirSync(resolve(fixtureRoot, ".usf/catalog"), { recursive: true, mode: 0o700 });
    chmodSync(resolve(fixtureRoot, ".usf"), 0o700);
    chmodSync(resolve(fixtureRoot, ".usf/catalog"), 0o700);
    const raw = readFileSync(resolve(repositoryRoot, "tests/fixtures/providers/models-dev.json"));
    const normalized = normalizeModelsDevCatalogue(raw);
    writeFileSync(resolve(fixtureRoot, ".usf/catalog/models-dev.raw.json"), raw, { mode: 0o600 });
    writeFileSync(resolve(fixtureRoot, ".usf/catalog/models-dev.normalized.json"), canonicalJson(normalized), { mode: 0o600 });
    spawnSync("git", ["init", "-q"], { cwd: fixtureRoot, encoding: "utf8" });
    run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const route = {
  id: "fixture-primary", family: "fixture", provider: "fixture", adapterPackage: "@ai-sdk/fixture", credentialName: "FIXTURE_API_KEY",
  model: "fixture/model-v1", capabilities: ["typescript"], privacy: ["public"], cost: "free-quota", entitlement: "free-quota",
  paidFallback: false, concurrency: 2, probeFreshnessSeconds: 900,
};
const routeDigest = canonicalDigest(route, { rejectAbsolutePaths: true });
const probeWithoutDigest = {
  schema: "urn:usf:probe-result:1", status: "ok", routeId: route.id,
  endpointOrigin: "https://api.groq.com", serviceTier: "on_demand",
  requested: { family: route.family, provider: route.provider, model: route.model },
  actual: { family: route.family, provider: route.provider, model: route.model, sdkProvider: "fixture.chat" },
  inputs: { routeDigest, adapterPackage: route.adapterPackage, adapterVersion: "1.0.0", adapterLockDigest: digest("0"), catalogueRawDigest: digest("a"), catalogueNormalizedDigest: digest("b"), policyDigest: digest("c"), entitlementEvidenceDigest: digest("d"), probePromptDigest: digest("e") },
  observedAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-30T00:15:00.000Z",
  capabilityEvaluations: [{ capability: "text-generation", status: "available", reasonCode: null }], quota: "available", health: "available",
  cost: { observedCost: null, currency: null, evidence: "entitlement" }, usage: { inputTokens: 2, outputTokens: 1 }, latencyMs: 1,
  limits: { timeoutMs: 500, maxRetries: 0, maxOutputTokens: 8 }, externalContact: true, authorityEffect: "none", nonclaims: ["fixture"],
};
const probe = { ...probeWithoutDigest, resultDigest: canonicalDigest(probeWithoutDigest, { rejectAbsolutePaths: true }) };

test("adapter observation binds the exact installed version to its pnpm integrity", async (t: TestContext) => {
  if (childProcessUnavailable(t)) return;
  const first = await observeInstalledAdapter(repositoryRoot, "@ai-sdk/groq");
  const second = await observeInstalledAdapter(repositoryRoot, "@ai-sdk/groq");
  assert.deepEqual(first, second);
  assert.equal(first?.package, "@ai-sdk/groq");
  assert.equal(first?.version, "4.0.34");
  assert.match(first?.lockDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
});

test("registered provider census exposes profile-bound routes and distinct host transports without contact", (t: TestContext) => {
  if (childProcessUnavailable(t)) return;
  withProviderCliFixture((fixtureRoot) => {
    const census = invoke([
      "providers", "census", "--max-items", "12",
      "--profile", "urn:usf:profile:v3-self-host:3",
      "--manifest", "graph/manifests/self-host-provider-v3.json",
    ], undefined, {}, fixtureRoot);
    assert.equal(census.schema, "urn:usf:provider-census-result:1");
    assert.equal(census.status, "ok");
    assert.equal(census.operation, "census");
    assert.equal(census.externalContact, false);
    assert.equal(census.authorityEffect, "none");
    assert.deepEqual(census.semanticScope, {
      status: "selected",
      profile: "urn:usf:profile:v3-self-host:3",
      profileVersion: "3",
      product: "urn:usf:product:v3",
      foundation: "urn:usf:foundation:v3",
      manifest: "graph/manifests/self-host-provider-v3.json",
      semanticDigest: (census.semanticScope as Record<string, unknown>).semanticDigest,
      work: "urn:usf:work:provider-census",
      contract: "urn:usf:contract:provider-census:1",
      scopedDependencyDigest: (census.semanticScope as Record<string, unknown>).scopedDependencyDigest,
    });
    assert.match(String((census.semanticScope as Record<string, unknown>).semanticDigest), /^sha256:[0-9a-f]{64}$/u);
    assert.match(String((census.semanticScope as Record<string, unknown>).scopedDependencyDigest), /^sha256:[0-9a-f]{64}$/u);
    const denominators = census.denominators as Record<string, number>;
    assert.equal(denominators.configuredRoutes, 2);
    assert.equal(denominators.reviewedLegacyProviderObservations, 7);
    assert.equal(denominators.hostTransports, 3);
    assert.equal(denominators.matchedItems, 12);
    const items = census.items as Array<Record<string, unknown>>;
    assert.deepEqual(items.filter((item) => item.kind === "configured-route").map((item) => item.id), ["cerebras-gpt-oss-120b", "groq-qwen3.6-27b"]);
    assert.deepEqual(items.filter((item) => item.kind === "host-transport").map((item) => item.id), ["antigravity-cli", "claude-cli", "codex-cli"]);
    assert.deepEqual(items.filter((item) => item.kind === "legacy-provider-observation").map((item) => item.id), [
      "antigravity-cli:claude-opus-4.6",
      "minimax-oauth:MiniMax-M3",
      "nous:openai/gpt-5.6-sol",
      "openai-api:gpt-5.5",
      "openai-codex:gpt-5.5",
      "openai-codex:gpt-5.6-sol",
      "openrouter:anthropic/claude-sonnet-4.6",
    ]);
    assert.equal(items.every((item) => item.qualification === "UNQUALIFIED"), true);
    assert.equal(items.filter((item) => item.kind === "host-transport").every((item) => item.actualModel === null), true);

    const aliasesHelp = invoke(["help", "providers", "aliases", "--json"], undefined, {}, fixtureRoot);
    const command = aliasesHelp.command as Record<string, unknown>;
    assert.equal(command.availability, "implemented");
    assert.equal(command.externalContact, "none");
  });
});

test("registered provider CLI evaluates semantic inputs and routes fixture facts without contact", (t: TestContext) => {
  if (childProcessUnavailable(t)) return;
  const suite = createQualificationSuite({
    suiteId: "fixture-suite", suiteVersion: "1", corpusId: "fixture-corpus", corpusVersion: "1",
    cases: [{ caseId: "typescript-case", taskClass: "typescript", dimension: "implementation", prompt: "Select the bounded patch.", grader: { kind: "exact", value: "bounded patch" }, holdout: false, weight: 1 }],
  });
  const policy = createQualificationPolicy({
    policyId: "fixture-policy", policyVersion: "1", defaultRole: "UNQUALIFIED", validitySeconds: 900,
    thresholds: [{ taskClass: "typescript", role: "PATCH_PRODUCER", minimumScores: [{ dimension: "implementation", minimum: 1 }] }],
  });
  const semantic = invoke(["probe", "semantic", "--input", "-"], JSON.stringify({
    profile: { schema: "urn:usf:agent-profile:1", provider: route.provider, requestedModel: route.model, adapter: route.adapterPackage, adapterVersion: "1.0.0", adapterLockDigest: digest("0"), authMode: "api_token", toolProfile: "fixture-tools-v1", toolProfileDigest: digest("3"), promptVersion: "fixture-prompt-v1", promptDigest: digest("4"), contextConfig: "fixture-context-v1", contextConfigDigest: digest("5"), outputConfig: "fixture-output-v1", outputConfigDigest: digest("6") },
    taskClass: "typescript", suite, policy, effectivePolicyDigest: digest("c"),
    // One observation standing for one real invocation. There is no answers
    // array and no probe result: an answer reaches the grader only by being
    // carried on the record of the call that produced it.
    observations: [sealQualificationObservation({
      schema: "urn:usf:qualification-observation:1",
      provider: route.provider, requestedModel: route.model, actualModel: route.model,
      transport: "vercel-ai-sdk", adapterPackage: route.adapterPackage,
      adapterVersion: "1.0.0", adapterLockDigest: digest("0"),
      caseId: "typescript-case", promptDigest: promptDigest("Select the bounded patch."),
      answer: "bounded patch", answerDigest: answerDigest("bounded patch"),
      executionEvidenceDigest: digest("7"),
      observedAt: "2026-08-30T00:00:00.000Z", latencyMs: 20,
      usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
    })],
    evaluatedAt: "2026-08-30T00:00:01.000Z",
  }));
  assert.equal(semantic.schema, "urn:usf:semantic-qualification-result:1");
  assert.equal(semantic.status, "qualified");
  assert.equal(semantic.externalContact, false);

  const effectivePolicy = { maximumPaidCost: 0, paidFallback: "prohibited", unknownPrice: "ineligible", acceptedCostClasses: ["local", "zero-price", "free-quota"], effectivePrivacy: { workClassification: "public", allowedRouteDeclarations: ["public"] } } as const;
  const policyDigest = canonicalDigest(effectivePolicy, { rejectAbsolutePaths: true });
  const mechanicalProbeWithoutDigest = { ...probeWithoutDigest, inputs: { ...probeWithoutDigest.inputs, policyDigest }, resultDigest: undefined };
  const { resultDigest: _ignored, ...mechanicalBasis } = mechanicalProbeWithoutDigest;
  const mechanicalProbe = { ...mechanicalBasis, resultDigest: canonicalDigest(mechanicalBasis, { rejectAbsolutePaths: true }) };
  const binding = createRoutingSemanticBinding(
    { profile: "urn:usf:profile:v3-self-host:2", version: "2", profileDigest: digest("1") },
    { applicability: "not-applicable", profile: "not-applicable", version: "not-applicable", profileDigest: "not-applicable" },
  );
  const basis = proposalBasis("urn:usf:work:fixture", digest("2"), {
    selection: {
      profile: binding.core.profile,
      profileVersion: binding.core.version,
      profileDigest: binding.core.profileDigest,
      product: binding.product.profile,
      productVersion: binding.product.version,
      coreToProductDigest: binding.directional.coreToProductDigest,
      productToCoreDigest: binding.directional.productToCoreDigest,
      compositeDigest: binding.compositeDigest,
    },
  });
  const temporaryRoot = resolve(repositoryRoot, ".usf/tmp");
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  const shimRoot = mkdtempSync(resolve(temporaryRoot, "route-git-shim-"));
  const markerPath = resolve(shimRoot, "called");
  const shimPath = resolve(shimRoot, "git");
  writeFileSync(shimPath, `#!/bin/sh\nprintf called > '${markerPath}'\nexit 97\n`, { mode: 0o700 });
  chmodSync(shimPath, 0o700);
  const routeInput = JSON.stringify({
    basis,
    work: { id: "urn:usf:work:fixture", digest: digest("2"), semanticBinding: binding, capabilities: ["text-generation"], semanticRequirements: [], privacy: "public" },
    routes: [{ id: route.id, configDigest: routeDigest, family: route.family, provider: route.provider, model: route.model, underlyingModelFamily: "fixture", underlyingModel: "fixture/model-v1", adapter: route.adapterPackage, credential: route.credentialName, capabilities: ["text-generation"], privacy: ["public"], costClass: "free-quota", paidFallback: false, entitlement: "verified", concurrency: 2 }],
    catalogue: [{ provider: route.provider, model: route.model, underlyingModelFamily: "fixture", underlyingModel: "fixture/model-v1", capabilities: [], prices: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, inputAudio: 0, outputAudio: 0 } }],
    probes: [mechanicalProbe], semanticQualificationAuthority: {
      suiteDigest: trackedQualificationAuthority.suite.suiteDigest,
      corpusDigest: trackedQualificationAuthority.suite.corpusDigest,
      qualificationPolicyDigest: trackedQualificationAuthority.policy.policyDigest,
    }, semanticQualificationProfiles: [], semanticQualifications: [],
    semanticQualificationReplay: { sources: [] },
    installedAdapters: [route.adapterPackage], credentialNamesPresent: [route.credentialName], catalogueRawDigest: digest("a"), catalogueNormalizedDigest: digest("b"), policyDigest, providerConfigDigest: digest("f"), policy: effectivePolicy,
    now: "2026-08-30T00:00:02.000Z", strategy: "all-eligible", hostConcurrency: 4, maxAssignments: 4,
  });
  let routed: Record<string, unknown>;
  try {
    routed = invoke(["route", "--input", "-"], routeInput, {
      PATH: `${shimRoot}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      GIT_DIR: "/definitely/not/a/repository",
      USF_ROUTE_SECRET_CANARY: "route-secret-canary-value",
    });
    assert.equal(existsSync(markerPath), false);
    assert.equal(JSON.stringify(routed).includes("route-secret-canary-value"), false);
  } finally {
    rmSync(shimRoot, { recursive: true, force: true });
  }
  assert.equal(routed.schema, "urn:usf:route-result:1");
  assert.equal(routed.status, "ok");
  assert.equal(routed.externalContact, false);
  assert.equal((routed.assignments as unknown[]).length, 1);
});

test("availability requires explicit zero-paid contact controls and help describes the subcommands", (t: TestContext) => {
  if (childProcessUnavailable(t)) return;
  const result = spawnSync(usf, ["probe", "availability"], { cwd: repositoryRoot, encoding: "utf8", timeout: COMMAND_HANG_GUARD_MS });
  assert.equal(result.status, 2);
  const refusal = JSON.parse(String(result.stderr).trim()) as Record<string, unknown>;
  assert.equal(refusal.reasonCode, "PROBE_ARGUMENTS_INVALID");
  const help = invoke(["help", "probe", "semantic", "--json"]);
  const command = help.command as Record<string, unknown>;
  assert.equal(command.availability, "implemented");
  assert.equal(command.externalContact, "none");

  const receiptHelp = invoke(["help", "providers", "receipt", "--json"]).command as Record<string, unknown>;
  assert.equal(receiptHelp.availability, "registered");
  assert.equal(receiptHelp.externalContact, "possible");
  const acquireHelp = invoke(["help", "providers", "receipt", "acquire", "--json"]).command as Record<string, unknown>;
  assert.equal(acquireHelp.availability, "registered");
  assert.equal(acquireHelp.externalContact, "explicit");
  const verifyHelp = invoke(["help", "providers", "receipt", "verify", "--json"]).command as Record<string, unknown>;
  assert.equal(verifyHelp.availability, "registered");
  assert.equal(verifyHelp.externalContact, "none");

  const registeredRefusal = spawnSync(usf, [
    "providers", "receipt", "acquire",
    "--route", "openrouter-candidate",
    "--profile", "urn:usf:profile:v3-self-host:3",
    "--manifest", "graph/manifests/self-host-provider-v3.json",
  ], { cwd: repositoryRoot, encoding: "utf8", timeout: 35_000 });
  assert.equal(registeredRefusal.error, undefined);
  assert.equal(registeredRefusal.status, 1);
  assert.equal(registeredRefusal.stdout, "");
  const registeredError = JSON.parse(String(registeredRefusal.stderr).trim()) as Record<string, unknown>;
  assert.equal(registeredError.reasonCode, "PROVIDERS_RECEIPT_PROOFBLOCKED");
});

test("availability rejects self-authored account evidence under a sanitized Git environment before contact", (t: TestContext) => {
  if (childProcessUnavailable(t)) return;
  const plantedCredential = "must-not-appear-in-output";
  const result = spawnSync(usf, [
    "probe", "availability",
    "--route", "groq-qwen3.6-27b",
    "--env-file", ".env.example",
    "--economics", "-",
    "--allow-inference",
    "--max-cost-usd", "0",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: COMMAND_HANG_GUARD_MS,
    input: JSON.stringify({
      providerId: "groq",
      requestedModelId: "qwen/qwen3.6-27b",
      accountReferenceDigest: digest("7"),
      evidence: { source: "self-authored", sourceDigest: digest("8"), tierName: "Free", paidUsageEnabled: false },
    }),
    env: {
      ...process.env,
      GROQ_API_KEY: plantedCredential,
      GIT_DIR: "/definitely/not/a/repository",
      GIT_WORK_TREE: "/tmp/hostile-work-tree",
      GIT_INDEX_FILE: "/tmp/hostile-index",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "!false",
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 4);
  assert.equal(result.stdout, "");
  const refusal = JSON.parse(String(result.stderr).trim()) as Record<string, unknown>;
  assert.equal(refusal.reasonCode, "PROBE_ACCOUNT_TIER_UNVERIFIABLE");
  assert.equal(JSON.stringify(refusal).includes(plantedCredential), false);
});

test("availability containment refusals retain exit 5 before any provider contact", (t: TestContext) => {
  if (childProcessUnavailable(t)) return;
  const result = spawnSync(usf, [
    "probe", "availability",
    "--route", "groq-qwen3.6-27b",
    "--env-file", ".env.example",
    "--economics", "outside.json",
    "--allow-inference",
    "--max-cost-usd", "0",
  ], { cwd: repositoryRoot, encoding: "utf8", timeout: COMMAND_HANG_GUARD_MS });
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "");
  const refusal = JSON.parse(String(result.stderr).trim()) as Record<string, unknown>;
  assert.equal(refusal.reasonCode, "PROBE_INPUT_REFUSED");
});

test("the shell launcher passes --env-file to USF instead of Node", (t: TestContext) => {
  if (childProcessUnavailable(t)) return;
  const result = spawnSync(usf, ["help", "--env-file", "/definitely/not/a/usf-env-file"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: COMMAND_HANG_GUARD_MS,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  const refusal = JSON.parse(String(result.stderr).trim()) as Record<string, unknown>;
  assert.equal(refusal.reasonCode, "HELP_ARGUMENTS_INVALID");
});
