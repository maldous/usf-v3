import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { canonicalDigest } from "../../src/core/canonical.ts";
import {
  adapterPreflightReceiptDigest,
  buildProviderChildEnvironment,
  buildProviderChildLaunch,
  createBoundedProviderFetch,
  parseAdapterPreflightReceipt,
  parseProviderAnswerObservation,
  parseRunAuthorization,
  providerAnswerObservationDigest,
  providerChildProtocolDigest,
  providerRawResponseDigest,
  runAuthorizationDigest,
  verifyRunAuthorization,
} from "../../src/providers/probe.ts";

const digest = (value: unknown) => canonicalDigest(value, { rejectAbsolutePaths: true });
const instant = (minute: number) => `2026-08-31T00:${String(minute).padStart(2, "0")}:00.000Z`;
const routeMemberDigest = digest({ route: "direct:groq", model: "qwen/qwen3.6-27b" });
const candidateMemberDigest = digest({ candidate: "catalogue:groq/qwen3.6-27b" });
const accountSourceUseAuthorizationDigest = digest({ use: "groq-free", profile: "v3-self-host:3" });
const accountObservationDigest = digest({ account: "groq-free", tier: "free" });
const routeModelEconomicsBindingDigest = digest({ economics: "groq-free-zero-paid" });
const credentialSourceIdentityDigest = digest({ credentialSource: "env-file-identity" });
const requestedIdentity = Object.freeze({ family: "qwen", provider: "groq", model: "qwen/qwen3.6-27b" });

const preflight = Object.freeze({
  schema: "urn:usf:adapter-preflight-receipt:1" as const,
  version: 1 as const,
  routeMemberDigest,
  adapterPackage: "@ai-sdk/groq",
  adapterVersion: "4.0.34",
  adapterIntegrity: "pnpm-lock-integrity-bound" as const,
  adapterArtifactDigest: digest({ package: "@ai-sdk/groq", version: "4.0.34", closure: "fixture" }),
  childProtocolDigest: providerChildProtocolDigest,
  fixedOriginDigest: digest({ origin: "api.groq.com", routePrefix: "openai-v1" }),
  selectedCredentialName: "GROQ_API_KEY",
  observedAt: instant(0),
  expiresAt: instant(10),
  status: "available" as const,
  failureCode: null,
});

const authorization = Object.freeze({
  schema: "urn:usf:run-authorization:1" as const,
  version: 1 as const,
  routeMemberDigest,
  candidateMemberDigest,
  requestedModelIdentity: requestedIdentity,
  accountSourceUseAuthorizationDigest,
  accountObservationDigest,
  routeModelEconomicsBindingDigest,
  credentialSourceIdentityDigest,
  adapterPreflightDigest: adapterPreflightReceiptDigest(preflight),
  profileDigest: digest({ profile: "v3-self-host:3" }),
  effectivePolicyDigest: digest({ maximumPaidCost: 0, fallback: "prohibited" }),
  privacyProjectionDigest: digest({ classification: "public" }),
  taskDigest: digest({ task: "semantic-qualification" }),
  promptOnlyProjectionDigest: digest({ prompt: "public fixture" }),
  maximumInputBytes: 4096,
  maximumOutputTokens: 256,
  timeoutMilliseconds: 10_000,
  issuedAt: instant(1),
  expiresAt: instant(9),
  fallbackProhibited: true as const,
  paidCostCeiling: "0" as const,
  authorizationDisposition: "authorized" as const,
});

const rawBytes = new TextEncoder().encode('{"id":"fixture","model":"qwen/qwen3.6-27b"}');
const answer = Object.freeze({
  schema: "urn:usf:provider-answer-observation:1" as const,
  version: 1 as const,
  routeMemberDigest,
  candidateMemberDigest,
  requestedIdentity,
  actualIdentity: Object.freeze({ ...requestedIdentity, sdkProvider: "groq.chat" }),
  accountObservationDigest,
  routeModelEconomicsBindingDigest,
  credentialSourceIdentityDigest,
  adapterPreflightDigest: authorization.adapterPreflightDigest,
  runAuthorizationDigest: runAuthorizationDigest(authorization),
  promptOnlyProjectionDigest: authorization.promptOnlyProjectionDigest,
  rawProviderResponseDigest: providerRawResponseDigest(rawBytes),
  sanitizedAnswer: "A bounded semantic answer.",
  usage: Object.freeze({ inputTokens: 12, outputTokens: 5, totalTokens: 17 }),
  economics: Object.freeze({ costDisposition: "zero-paid" as const, observedCostUsd: "0" as const, quota: "available" as const }),
  latency: Object.freeze({ milliseconds: 12.5 }),
  acquiredAt: instant(2),
  expiresAt: instant(8),
  failureCode: null,
});

// The graph-declared ValidationRuntimeClosure for this validation supplies only
// canonical, errors and economics, so the confined lane must reach nothing else.
// `src/schema/index.ts` is deliberately absent from it; the narrow-validator
// assertions therefore run in the ordinary outer carrier lane behind the same
// child-process guard the observability lane uses, through a dynamic import.
function childProcessUnavailable(context: TestContext): boolean {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission === undefined || permission.has("child_process")) return false;
  context.skip("the narrow schema validator is outside this validation's declared confined closure");
  return true;
}

function schemaDocument(name: string): { readonly required: readonly string[] } {
  return JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), "utf8")) as { required: readonly string[] };
}

test("invocation records are closed, current, and content-bound", () => {
  assert.deepEqual(parseAdapterPreflightReceipt(preflight), preflight);
  assert.deepEqual(parseRunAuthorization(authorization), authorization);
  assert.deepEqual(parseProviderAnswerObservation(answer), answer);

  const bindings = {
    routeMemberDigest,
    candidateMemberDigest,
    requestedModelIdentity: requestedIdentity,
    accountSourceUseAuthorizationDigest,
    accountObservationDigest,
    routeModelEconomicsBindingDigest,
    credentialSourceIdentityDigest,
    adapterPreflightDigest: authorization.adapterPreflightDigest,
    profileDigest: authorization.profileDigest,
    effectivePolicyDigest: authorization.effectivePolicyDigest,
    privacyProjectionDigest: authorization.privacyProjectionDigest,
    taskDigest: authorization.taskDigest,
    promptOnlyProjectionDigest: authorization.promptOnlyProjectionDigest,
    maximumInputBytes: authorization.maximumInputBytes,
    maximumOutputTokens: authorization.maximumOutputTokens,
    timeoutMilliseconds: authorization.timeoutMilliseconds,
  };
  assert.deepEqual(verifyRunAuthorization(authorization, bindings, instant(2)), authorization);
  assert.throws(() => verifyRunAuthorization(authorization, { ...bindings, taskDigest: digest({ task: "other" }) }, instant(2)), /RUN_AUTHORIZATION_BINDING_MISMATCH/u);
  assert.throws(() => verifyRunAuthorization(authorization, bindings, instant(9)), /RUN_AUTHORIZATION_STALE/u);
  assert.notEqual(providerAnswerObservationDigest(answer), providerAnswerObservationDigest({ ...answer, sanitizedAnswer: "A different answer." }));
  assert.notEqual(answer.rawProviderResponseDigest, providerRawResponseDigest(new TextEncoder().encode('{"id":"changed"}')));
  assert.throws(() => parseProviderAnswerObservation({ ...answer, unexpected: true }), /PROVIDER_RECORD_INVALID/u);
});

test("provider transport and child environment are bounded without alternate credentials", async () => {
  let captured: unknown;
  const bounded = createBoundedProviderFetch(
    new URL("https://api.groq.com/openai/v1/"),
    async () => new Response(rawBytes, { status: 200, headers: { "content-length": String(rawBytes.byteLength) } }),
    1024,
    (value) => { captured = value; },
  );
  const response = await bounded("https://api.groq.com/openai/v1/chat/completions", { method: "POST" });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), rawBytes);
  assert.deepEqual(captured, { digest: providerRawResponseDigest(rawBytes), byteLength: rawBytes.byteLength, status: 200 });
  await assert.rejects(() => bounded("https://example.invalid/openai/v1/chat/completions"), /PROBE_TRANSPORT_ORIGIN_REFUSED/u);

  const environmentInput = {
    credentialName: "GROQ_API_KEY",
    credentialValue: "fixture-secret",
    fixedOrigin: "https://api.groq.com/",
    home: "/child/home",
    temporary: "/child/tmp",
    maximumInputBytes: 4096,
    maximumOutputTokens: 256,
    timeoutMilliseconds: 10_000,
  };
  const environment = buildProviderChildEnvironment(environmentInput);
  assert.deepEqual(Object.keys(environment).sort(), [
    "GROQ_API_KEY", "HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "USF_PROVIDER_CHILD",
    "USF_PROVIDER_FIXED_ORIGIN", "USF_PROVIDER_MAXIMUM_INPUT_BYTES", "USF_PROVIDER_MAXIMUM_OUTPUT_TOKENS",
    "USF_PROVIDER_PAID_COST_CEILING", "USF_PROVIDER_TIMEOUT_MILLISECONDS",
  ].sort());
  assert.equal("OPENAI_API_KEY" in environment || "HTTPS_PROXY" in environment || "GIT_SSH_COMMAND" in environment, false);
  assert.throws(() => buildProviderChildEnvironment({ ...environmentInput, credentialName: "HOME" }), /PROVIDER_CHILD_INPUT_INVALID/u);

  const launch = buildProviderChildLaunch("/usr/bin/node", "/workspace/src/providers/probe.ts", environmentInput);
  assert.equal(launch.executable, "/usr/bin/node");
  assert.equal(launch.arguments.includes("--usf-provider-child-v1"), true);
  assert.equal(JSON.stringify(launch.arguments).includes("fixture-secret"), false);
});

const contracts = [
  { file: "adapter-preflight-receipt.schema.json", parse: parseAdapterPreflightReceipt, record: preflight },
  { file: "run-authorization.schema.json", parse: parseRunAuthorization, record: authorization },
  { file: "provider-answer-observation.schema.json", parse: parseProviderAnswerObservation, record: answer },
] as const;

// The preserved drafts for these three records silently disagreed with their
// graph-declared requiredFieldSet: two carried a single `accountReceiptDigest`
// where the graph separates candidate, account-observation, use-authorization,
// economics-binding and credential-source identity. Schema document, strict
// parser and fixture are pinned to one another here, with every declared member
// planted as absent, so that drift cannot pass again.
test("each record contract admits exactly its declared field set", () => {
  for (const contract of contracts) {
    const declared = schemaDocument(contract.file).required;
    assert.deepEqual([...declared].sort(), Object.keys(contract.record).sort(), contract.file);
    assert.deepEqual(contract.parse(contract.record), contract.record, contract.file);

    for (const field of declared) {
      const { [field]: removed, ...incomplete } = contract.record as Record<string, unknown>;
      assert.throws(() => contract.parse(incomplete), /PROVIDER_RECORD_INVALID/u, `${contract.file}:${field}`);
    }
  }
});

test("record schemas compile through the narrow profile and accept only complete records", async (t) => {
  if (childProcessUnavailable(t)) return;
  const { createJsonSchemaValidator } = await import("../../src/schema/index.ts");

  for (const contract of contracts) {
    const document = JSON.parse(readFileSync(new URL(`../../schemas/${contract.file}`, import.meta.url), "utf8"));
    const compiled = createJsonSchemaValidator(document);
    assert.equal(compiled.schemaId, (document as { $id: string }).$id, contract.file);
    assert.equal(compiled.validate(contract.record).valid, true, contract.file);

    for (const field of schemaDocument(contract.file).required) {
      const { [field]: removed, ...incomplete } = contract.record as Record<string, unknown>;
      assert.equal(compiled.validate(incomplete).valid, false, `${contract.file}:${field}`);
    }
  }
});
