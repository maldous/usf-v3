import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import test, { type TestContext } from "node:test";

import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import { normalizeModelsDevCatalogue } from "../../src/providers/catalogue.ts";
import {
  answerDigest, createQualificationPolicy, createQualificationSuite,
  promptDigest, qualifySemanticProfile, sealQualificationObservation,
  type QualificationObservation, type SemanticQualificationResult,
} from "../../src/providers/qualification.ts";
import { createRoutingSemanticBinding } from "../../src/providers/routing.ts";
import { observeInstalledAdapter } from "../../src/commands/models.ts";
import { CredentialEnvironment } from "../../src/providers/config.ts";
import { observeQualifiedTaskClasses } from "../../src/providers/capabilities.ts";
import {
  probeCommandHandler, type ProbeQualificationDependencies,
} from "../../src/commands/probe.ts";
import type { CliInvocationResult } from "../../src/providers/cli-transports.ts";
import type { AuthenticatedTransportCapability } from "../../src/providers/transports.ts";
import { createJsonSchemaValidator } from "../../src/schema/index.ts";
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
  const nativeFixtureProcess = process.env.USF_BWRAP_NETWORK === "isolated"
    && process.env.USF_REPOSITORY_ROOT === repositoryRoot;
  if (!nativeFixtureProcess && (permission === undefined || permission.has("child_process"))) return false;
  context.skip("the repository CLI subprocess boundary runs in the direct outer authoritative validation");
  return true;
}

function testTemporaryRoot(): string {
  const nativeFixtureProcess = process.env.USF_BWRAP_NETWORK === "isolated"
    && process.env.USF_REPOSITORY_ROOT === repositoryRoot;
  if (!nativeFixtureProcess) return resolve(repositoryRoot, ".usf/tmp");
  const supplied = process.env.TMPDIR;
  if (supplied === undefined) throw new Error("The confined fixture process did not supply TMPDIR.");
  const temporaryRoot = resolve(supplied);
  const relation = relative(repositoryRoot, temporaryRoot);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error("The confined fixture TMPDIR is outside the authenticated repository view.");
  }
  return temporaryRoot;
}
const trackedQualificationConfig = JSON.parse(
  readFileSync(resolve(repositoryRoot, "config/qualification.json"), "utf8"),
) as { suite: Parameters<typeof createQualificationSuite>[0]; policy: Parameters<typeof createQualificationPolicy>[0] };
const trackedQualificationAuthority = Object.freeze({
  suite: createQualificationSuite(trackedQualificationConfig.suite),
  policy: createQualificationPolicy(trackedQualificationConfig.policy),
});
const qualificationResultValidator = createJsonSchemaValidator(JSON.parse(
  readFileSync(resolve(repositoryRoot, "schemas/semantic-qualification-result.schema.json"), "utf8"),
));

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
  const temporaryRoot = testTemporaryRoot();
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

const qualificationModel = "claude-haiku-4-5-20251001";
const qualificationAnswers = Object.freeze([
  "intent",
  "foreground",
  '{"command":"usf","arguments":["help"]}',
  "registered command, no ad hoc script",
]);

async function withQualificationHandlerFixture(
  run: (fixtureRoot: string) => Promise<void>,
): Promise<void> {
  const temporaryRoot = testTemporaryRoot();
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  chmodSync(temporaryRoot, 0o700);
  const fixtureRoot = mkdtempSync(resolve(temporaryRoot, "provider-cli-qualification-"));
  try {
    cpSync(resolve(repositoryRoot, "config"), resolve(fixtureRoot, "config"), { recursive: true });
    cpSync(resolve(repositoryRoot, "graph"), resolve(fixtureRoot, "graph"), { recursive: true });
    cpSync(resolve(repositoryRoot, "package.json"), resolve(fixtureRoot, "package.json"));
    cpSync(resolve(repositoryRoot, "pnpm-lock.yaml"), resolve(fixtureRoot, "pnpm-lock.yaml"));
    mkdirSync(resolve(fixtureRoot, ".usf/catalog"), { recursive: true, mode: 0o700 });
    chmodSync(resolve(fixtureRoot, ".usf"), 0o700);
    chmodSync(resolve(fixtureRoot, ".usf/catalog"), 0o700);
    const raw = Buffer.from(JSON.stringify({
      groq: {
        id: "groq",
        name: "Groq",
        npm: "@ai-sdk/groq",
        env: ["GROQ_API_KEY"],
        models: {
          "qwen/qwen3.6-27b": {
            id: "qwen/qwen3.6-27b",
            name: "Qwen 3.6 27B",
            family: "qwen",
            reasoning: true,
            structured_output: true,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            cost: { input: 0, output: 0 },
            limit: { context: 131072, output: 8192 },
          },
        },
      },
    }), "utf8");
    const normalized = normalizeModelsDevCatalogue(raw, {
      installedAdapters: { "@ai-sdk/groq": "4.0.34" },
    });
    writeFileSync(resolve(fixtureRoot, ".usf/catalog/models-dev.raw.json"), raw, { mode: 0o600 });
    writeFileSync(
      resolve(fixtureRoot, ".usf/catalog/models-dev.normalized.json"),
      canonicalJson(normalized),
      { mode: 0o600 },
    );
    await run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function qualificationDependencies(
  cliInvoke: ProbeQualificationDependencies["invokeClaudeCli"],
  apiPrepare: ProbeQualificationDependencies["prepareApi"] = async () => async () => ({
      outcome: "refused" as const,
      reasonCode: "FIXTURE_API_NOT_SELECTED",
      text: null,
      actualModel: null,
      invocationIdentity: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }),
): ProbeQualificationDependencies {
  const capability: AuthenticatedTransportCapability = Object.freeze({
    schema: "urn:usf:authenticated-transport-capability:1",
    transport: "claude-cli",
    authenticationKind: "local-agent-session",
    usable: true,
    reason: null,
    credentialName: null,
    executablePath: "/fixture/bin/claude",
    executableVersion: "fixture",
    observedAt: "2026-09-06T00:00:00.000Z",
    nonClaims: Object.freeze(["fixture capability only"]),
  });
  return Object.freeze({
    readTrackedJson: async (root: string, path: string) =>
      JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown,
    loadCredentialEnvFile: async (_path: string, allowlist: readonly string[]) =>
      new CredentialEnvironment(allowlist, new Map([["GROQ_API_KEY", "fixture-only"]])),
    observeInstalledAdapter: async (_root: string, packageName: string) =>
      packageName === "@ai-sdk/groq" ? Object.freeze({
        package: packageName,
        version: "4.0.34",
        lockDigest: digest("0") as `sha256:${string}`,
      }) : undefined,
    observeTransportCapability: async () => capability,
    invokeClaudeCli: cliInvoke,
    prepareApi: apiPrepare,
    homeDirectory: () => "/fixture/home",
  });
}

function successfulCliInvocation(
  index: number,
  actualModel: string | null = qualificationModel,
): CliInvocationResult {
  return Object.freeze({
    transport: "claude-cli",
    outcome: "ok",
    reasonCode: "INVOCATION_OK",
    text: qualificationAnswers[index] ?? null,
    actualModel,
    invocationIdentity: index === 1 ? null : `fixture-session-${index}`,
    inputTokens: index === 0 ? null : 10 + index,
    outputTokens: 2 + index,
    totalTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    transportReportedCostUsd: null,
    latencyMsReported: null,
    retryAfter: null,
    refusalDetail: null,
  });
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
    cases: [{ caseId: "typescript-case", taskClass: "typescript", dimension: "implementation", prompt: "Select the change: a bounded patch or a repository rewrite.", grader: { kind: "contains", all: ["bounded patch"] }, holdout: false, weight: 1 }],
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
  const temporaryRoot = testTemporaryRoot();
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

test("probe qualify drives the CLI branch and durable reader without real contact", async () => {
  await withQualificationHandlerFixture(async (fixtureRoot) => {
    let invocationCount = 0;
    const dependencies = qualificationDependencies(async (prompt, timeoutMs, model, executable) => {
      assert.equal(prompt.length > 0, true);
      assert.equal(timeoutMs, 30_000);
      assert.equal(model, qualificationModel);
      assert.equal(executable, "/fixture/bin/claude");
      return successfulCliInvocation(invocationCount++);
    });
    const handled = await probeCommandHandler({
      command: "probe",
      repositoryRoot: fixtureRoot,
      args: [
        "qualify", "--provider", "claude-cli", "--model", qualificationModel,
        "--task-class", "cli-design", "--env-file", ".usf/credentials/not-read.env",
      ],
    }, dependencies);
    const output = handled.output as Record<string, unknown>;
    assert.equal(handled.exitCode, 0);
    assert.equal(output.status, "qualified");
    assert.equal(output.externalContact, true);
    assert.equal(output.invocations, 4);
    assert.deepEqual(output.derivedRoles, ["PATCH_PRODUCER"]);
    assert.equal(invocationCount, 4);

    const record = JSON.parse(readFileSync(resolve(fixtureRoot, String(output.recordPath)), "utf8")) as {
      observations: Array<{ executionEvidenceDigest: string; usage: Record<string, unknown> }>;
      qualification: { externalContact: unknown };
    };
    assert.equal(record.qualification.externalContact, false);
    assert.equal(record.observations[0]!.usage.inputTokens, null);
    assert.equal(record.observations[0]!.usage.outputTokens, 2);
    const evidencePath = resolve(
      fixtureRoot, ".usf/qualification-invocations",
      `${record.observations[0]!.executionEvidenceDigest.slice(7)}.json`,
    );
    const evidenceText = readFileSync(evidencePath, "utf8");
    const evidence = JSON.parse(evidenceText) as Record<string, unknown>;
    assert.equal(evidence.invocationIdentity, "fixture-session-0");
    assert.deepEqual(evidence.usage, { inputTokens: null, outputTokens: 2, totalTokens: null });
    const nullableIdentityEvidence = JSON.parse(readFileSync(resolve(
      fixtureRoot, ".usf/qualification-invocations",
      `${record.observations[1]!.executionEvidenceDigest.slice(7)}.json`,
    ), "utf8")) as Record<string, unknown>;
    assert.equal(nullableIdentityEvidence.invocationIdentity, null);

    const qualified = await observeQualifiedTaskClasses(fixtureRoot);
    assert.deepEqual(qualified.byRoute.get(`claude-cli:${qualificationModel}`), ["cli-design"]);

    writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, invocationIdentity: "tampered" }, null, 2)}\n`, { mode: 0o600 });
    assert.equal((await observeQualifiedTaskClasses(fixtureRoot)).byRoute.size, 0);
    writeFileSync(evidencePath, evidenceText, { mode: 0o600 });
    assert.deepEqual(
      (await observeQualifiedTaskClasses(fixtureRoot)).byRoute.get(`claude-cli:${qualificationModel}`),
      ["cli-design"],
    );
    const qualificationConfigPath = resolve(fixtureRoot, "config/qualification.json");
    const qualificationConfigText = readFileSync(qualificationConfigPath, "utf8");
    const changedQualificationConfig = JSON.parse(qualificationConfigText) as {
      policy: { policyVersion: string };
    };
    changedQualificationConfig.policy.policyVersion = "1.1.0-stale-fixture";
    writeFileSync(qualificationConfigPath, `${JSON.stringify(changedQualificationConfig, null, 2)}\n`);
    assert.equal((await observeQualifiedTaskClasses(fixtureRoot)).byRoute.size, 0);
    writeFileSync(qualificationConfigPath, qualificationConfigText);
    const { invocationIdentity: _invocationIdentity, ...missingIdentity } = evidence;
    writeFileSync(evidencePath, `${JSON.stringify(missingIdentity, null, 2)}\n`, { mode: 0o600 });
    assert.equal((await observeQualifiedTaskClasses(fixtureRoot)).byRoute.size, 0);
  });
});

test("successful CLI text with an unknown or mismatched returned model grants no task class", async () => {
  await withQualificationHandlerFixture(async (fixtureRoot) => {
    let invocationCount = 0;
    const unknown = await probeCommandHandler({
      command: "probe",
      repositoryRoot: fixtureRoot,
      args: [
        "qualify", "--provider", "claude-cli", "--model", qualificationModel,
        "--task-class", "cli-design", "--env-file", ".usf/credentials/not-read.env",
      ],
    }, qualificationDependencies(async () => successfulCliInvocation(invocationCount++, null)));
    const unknownOutput = unknown.output as Record<string, unknown>;
    assert.equal(unknown.exitCode, 6);
    assert.equal(unknownOutput.status, "unqualified");
    assert.deepEqual(unknownOutput.derivedRoles, ["UNQUALIFIED"]);
    assert.equal(invocationCount, 4);
    assert.equal((await observeQualifiedTaskClasses(fixtureRoot)).byRoute.size, 0);
    const unknownRecord = JSON.parse(
      readFileSync(resolve(fixtureRoot, String(unknownOutput.recordPath)), "utf8"),
    ) as { qualification: { profile: { actual: { model: unknown } } }; observations: Array<{ actualModel: unknown }> };
    assert.equal(unknownRecord.qualification.profile.actual.model, null);
    assert.equal(unknownRecord.observations.every((item) => item.actualModel === null), true);
    assert.equal(qualificationResultValidator.validate(unknownRecord.qualification).valid, true);
  });

  await withQualificationHandlerFixture(async (fixtureRoot) => {
    let invocationCount = 0;
    await assert.rejects(
      probeCommandHandler({
        command: "probe",
        repositoryRoot: fixtureRoot,
        args: [
          "qualify", "--provider", "claude-cli", "--model", qualificationModel,
          "--task-class", "cli-design", "--env-file", ".usf/credentials/not-read.env",
        ],
      }, qualificationDependencies(async () =>
        successfulCliInvocation(invocationCount++, "claude-other-model"))),
      (error: unknown) => (error as { code?: string }).code === "PROBE_QUALIFY_OBSERVATION_REFUSED",
    );
    assert.equal(invocationCount, 4);
    assert.equal(existsSync(resolve(fixtureRoot, ".usf/qualifications")), false);
    assert.equal((await observeQualifiedTaskClasses(fixtureRoot)).byRoute.size, 0);
  });
});

test("CLI preflight and invocation refusals stay offline and cannot create a task-class grant", async () => {
  await withQualificationHandlerFixture(async (fixtureRoot) => {
    let invocationCount = 0;
    const unavailable = qualificationDependencies(async () => {
      invocationCount += 1;
      return successfulCliInvocation(0);
    });
    await assert.rejects(
      probeCommandHandler({
        command: "probe",
        repositoryRoot: fixtureRoot,
        args: [
          "qualify", "--provider", "claude-cli", "--model", qualificationModel,
          "--task-class", "cli-design", "--env-file", ".usf/credentials/not-read.env",
        ],
      }, {
        ...unavailable,
        observeTransportCapability: async () => Object.freeze({
          schema: "urn:usf:authenticated-transport-capability:1" as const,
          transport: "claude-cli" as const,
          authenticationKind: "local-agent-session" as const,
          usable: false,
          reason: "SESSION_MATERIAL_ABSENT" as const,
          credentialName: null,
          executablePath: null,
          executableVersion: null,
          observedAt: "2026-09-06T00:00:00.000Z",
          nonClaims: Object.freeze(["fixture capability only"]),
        }),
      }),
      (error: unknown) => (error as { code?: string }).code === "PROBE_QUALIFY_ROUTE_NOT_SELECTABLE",
    );
    assert.equal(invocationCount, 0);
    assert.equal((await observeQualifiedTaskClasses(fixtureRoot)).byRoute.size, 0);

    await assert.rejects(
      probeCommandHandler({
        command: "probe",
        repositoryRoot: fixtureRoot,
        args: [
          "qualify", "--provider", "claude-cli", "--model", "not-graph-selected",
          "--task-class", "cli-design", "--env-file", ".usf/credentials/not-read.env",
        ],
      }, unavailable),
      (error: unknown) => (error as { code?: string }).code === "PROBE_QUALIFY_ROUTE_NOT_SELECTABLE",
    );
    assert.equal(invocationCount, 0);
  });

  await withQualificationHandlerFixture(async (fixtureRoot) => {
    let invocationCount = 0;
    const refused = await probeCommandHandler({
      command: "probe",
      repositoryRoot: fixtureRoot,
      args: [
        "qualify", "--provider", "claude-cli", "--model", qualificationModel,
        "--task-class", "cli-design", "--env-file", ".usf/credentials/not-read.env",
      ],
    }, qualificationDependencies(async () => {
      const index = invocationCount++;
      return index === 3 ? Object.freeze({
        ...successfulCliInvocation(index),
        outcome: "refused" as const,
        reasonCode: "TRANSPORT_TIMEOUT",
        text: null,
        actualModel: null,
        invocationIdentity: null,
      }) : successfulCliInvocation(index);
    }));
    assert.equal(refused.exitCode, 6);
    assert.deepEqual((refused.output as Record<string, unknown>).derivedRoles, ["UNQUALIFIED"]);
    assert.equal(invocationCount, 4);
    assert.equal((await observeQualifiedTaskClasses(fixtureRoot)).byRoute.size, 0);
  });
});

test("API handler behavior and legacy durable evidence remain compatible", async () => {
  await withQualificationHandlerFixture(async (fixtureRoot) => {
    let apiCount = 0;
    let prepareCount = 0;
    const handled = await probeCommandHandler({
      command: "probe",
      repositoryRoot: fixtureRoot,
      args: [
        "qualify", "--provider", "groq", "--model", "qwen/qwen3.6-27b",
        "--task-class", "cli-design", "--env-file", ".usf/credentials/not-read.env",
      ],
    }, qualificationDependencies(
      async () => { throw new Error("CLI transport must not run for an API route"); },
      async (routeInput) => {
        prepareCount += 1;
        assert.equal(routeInput.adapterPackage, "@ai-sdk/groq");
        assert.equal(routeInput.model, "qwen/qwen3.6-27b");
        return async () => Object.freeze({
            outcome: "ok" as const,
            reasonCode: "INVOCATION_OK",
            text: qualificationAnswers[apiCount],
            actualModel: routeInput.model,
            invocationIdentity: `api-invocation-${apiCount}`,
            inputTokens: 20 + apiCount,
            outputTokens: 4 + apiCount,
            totalTokens: 24 + apiCount++,
          });
      },
    ));
    const output = handled.output as Record<string, unknown>;
    assert.equal(handled.exitCode, 0);
    assert.equal(prepareCount, 1);
    assert.equal(apiCount, 4);
    assert.deepEqual(
      (await observeQualifiedTaskClasses(fixtureRoot)).byRoute.get("groq:qwen/qwen3.6-27b"),
      ["cli-design"],
    );

    const recordPath = resolve(fixtureRoot, String(output.recordPath));
    const current = JSON.parse(readFileSync(recordPath, "utf8")) as {
      observations: QualificationObservation[];
      qualification: SemanticQualificationResult;
    };
    const legacyObservations = current.observations.map((observation) => {
      const evidencePath = resolve(
        fixtureRoot, ".usf/qualification-invocations",
        `${String(observation.executionEvidenceDigest).slice(7)}.json`,
      );
      const evidenceRecord = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
      const { evidenceDigest: _oldDigest, invocationIdentity: _identity, ...legacyEvidence } = evidenceRecord;
      const legacyDigest = canonicalDigest(legacyEvidence, { rejectAbsolutePaths: true });
      writeFileSync(
        resolve(fixtureRoot, ".usf/qualification-invocations", `${legacyDigest.slice(7)}.json`),
        `${JSON.stringify({ ...legacyEvidence, evidenceDigest: legacyDigest }, null, 2)}\n`,
        { mode: 0o600 },
      );
      const { observationDigest: _observationDigest, ...observationWithoutDigest } = observation;
      return sealQualificationObservation({
        ...observationWithoutDigest,
        executionEvidenceDigest: legacyDigest,
      });
    });
    const requested = current.qualification.profile.requested;
    const legacyQualification = qualifySemanticProfile({
      profile: {
        schema: "urn:usf:agent-profile:1",
        provider: requested.provider,
        requestedModel: requested.model,
        adapter: requested.adapter,
        adapterVersion: requested.adapterVersion,
        adapterLockDigest: requested.adapterLockDigest,
        authMode: requested.authMode,
        toolProfile: requested.toolProfile,
        toolProfileDigest: requested.toolProfileDigest,
        promptVersion: requested.promptVersion,
        promptDigest: requested.promptDigest,
        contextConfig: requested.contextConfig,
        contextConfigDigest: requested.contextConfigDigest,
        outputConfig: requested.outputConfig,
        outputConfigDigest: requested.outputConfigDigest,
      },
      taskClass: "cli-design",
      suite: trackedQualificationAuthority.suite,
      policy: trackedQualificationAuthority.policy,
      effectivePolicyDigest: current.qualification.inputs.effectivePolicyDigest,
      observations: legacyObservations,
      evaluatedAt: current.qualification.evaluatedAt,
    });
    unlinkSync(recordPath);
    const legacyRecord = {
      schema: "urn:usf:qualification-record:1",
      status: "ok",
      role: legacyQualification.derivedRoles[0],
      taskClass: legacyQualification.taskClass,
      route: { provider: requested.provider, model: requested.model },
      qualificationDigest: legacyQualification.qualificationDigest,
      observationSetDigest: legacyQualification.inputs.observationSetDigest,
      observations: legacyObservations,
      qualification: legacyQualification,
    };
    writeFileSync(
      resolve(fixtureRoot, ".usf/qualifications", `${legacyQualification.qualificationDigest.slice(7)}.json`),
      `${JSON.stringify(legacyRecord, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.deepEqual(
      (await observeQualifiedTaskClasses(fixtureRoot)).byRoute.get("groq:qwen/qwen3.6-27b"),
      ["cli-design"],
    );
    assert.equal(legacyObservations[0]!.usage.inputTokens, 20);
  });
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
