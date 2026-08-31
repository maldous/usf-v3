import assert from "node:assert/strict";
import test from "node:test";
import { exitCodeForReason, integrateCommandHandler, parseApplyArguments, parseCheckArguments, parseIntegrateArguments } from "../../src/commands/apply.ts";
import { parseBootstrapCarrierArguments } from "../../src/commands/bootstrap-carrier.ts";
import { dispatchCommand } from "../../src/commands/dispatcher.ts";
import { parsePublishArguments } from "../../src/commands/publish.ts";

test("apply, check and integrate refusals share the GOAL-defined exit taxonomy", () => {
  const cases = [
    [1, ["CHECK_FAILED", "CHECK_TIMEOUT", "INTEGRATION_VALIDATION_FAILED", "INTEGRATION_GIT_FAILED"]],
    [2, ["APPLY_CANDIDATE_INVALID", "CHECK_ARGUMENTS_INVALID", "INTEGRATION_CANDIDATE_COUNT_INVALID"]],
    [3, ["CHECK_CONFINEMENT_UNAVAILABLE", "INTEGRATION_GIT_UNAVAILABLE"]],
    [4, ["CANDIDATE_BASIS_MISMATCH", "CHECK_RECEIPT_INVALID", "INTEGRATION_VALIDATION_INVALID", "INTEGRATION_CHECK_RECEIPT_MISSING", "INTEGRATION_TEMP_REF_INVALID"]],
    [5, ["APPLY_INPUT_REFUSED", "CHECK_NOT_ALLOWLISTED", "SYMLINK_ESCAPE", "INTEGRATION_FILTER_ATTRIBUTE", "INTEGRATION_DRY_RUN_PRIMARY_MUTATED"]],
    [6, ["NO_ELIGIBLE_ZERO_PAID_COST_ROUTE"]],
    [7, ["CANDIDATE_BUSY", "CHECK_RECEIPT_CONFLICT", "INTEGRATION_EMPTY_DELTA", "INTEGRATION_PROFILE_MISMATCH"]],
  ] as const;
  for (const [expected, reasons] of cases) for (const reason of reasons) assert.equal(exitCodeForReason(reason), expected, reason);
  assert.equal(exitCodeForReason("UNRECOGNIZED_DOMAIN_REFUSAL"), 1);
});

test("apply, graph-derived check and integration cohort inputs are explicit and bounded", () => {
  const digestA = `sha256:${"a".repeat(64)}`;
  const digestB = `sha256:${"b".repeat(64)}`;
  assert.deepEqual(parseApplyArguments(["--input", "-"]), { mode: "input", source: "-" });
  assert.deepEqual(parseApplyArguments(["{\"candidate\":{}}"]), { mode: "legacy-inline", json: "{\"candidate\":{}}" });
  assert.throws(() => parseApplyArguments(["--input", "-", "extra"]), { code: "APPLY_ARGUMENTS_INVALID", exitCode: 2 });

  assert.deepEqual(parseCheckArguments(["--validation", "urn:usf:validation:focused:1", "--candidate", digestA]), {
    mode: "graph-derived",
    candidateDigest: digestA,
    validationId: "urn:usf:validation:focused:1",
  });
  assert.throws(() => parseCheckArguments(["--candidate", digestA, "--candidate", digestB]), { code: "CHECK_ARGUMENTS_INVALID", exitCode: 2 });

  assert.deepEqual(parseIntegrateArguments(["--candidate", digestA, "--dry-run", "--candidate", digestB]), {
    candidateDigests: [digestA, digestB],
    dryRun: true,
  });
  assert.throws(() => parseIntegrateArguments(["--candidate", digestA, "--candidate", digestA]), { code: "INTEGRATE_COHORT_INVALID", exitCode: 2 });
  assert.throws(() => parseIntegrateArguments(["--dry-run"]), { code: "INTEGRATE_COHORT_INVALID", exitCode: 2 });
  assert.throws(() => parseIntegrateArguments(Array.from({ length: 33 }, (_, index) => ["--candidate", `sha256:${index.toString(16).padStart(64, "0")}`]).flat()), { code: "INTEGRATE_COHORT_INVALID", exitCode: 2 });
});

test("bootstrap-carrier parsing admits only one exact graph-selected operation", () => {
  const valid = ["verify", "--adoption", "urn:usf:carrier-adoption:repository-path-scope:1", "--profile", "urn:usf:profile:v3-self-host:1", "--manifest", "graph/manifests/integration.json"];
  assert.deepEqual(parseBootstrapCarrierArguments(valid), {
    mode: "verify",
    adoptionIri: "urn:usf:carrier-adoption:repository-path-scope:1",
    profileIri: "urn:usf:profile:v3-self-host:1",
    manifestPath: "graph/manifests/integration.json",
  });
  assert.equal(parseBootstrapCarrierArguments(valid.with(0, "adopt")).mode, "adopt");
  for (const invalid of [valid.slice(1), [...valid, "extra"], valid.with(4, "urn:usf:profile:v3-self-host"), valid.with(6, "graph/manifest.json"), [...valid, "--adoption", valid[2]!]]) {
    assert.throws(() => parseBootstrapCarrierArguments(invalid), { code: "BOOTSTRAP_CARRIER_ARGUMENTS_INVALID", exitCode: 2 });
  }
});

test("registered integration adapter returns a stable refusal without fabricating an observation", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const result = await dispatchCommand(["integrate", "--candidate", digest, "--dry-run"], "/repo", { integrate: integrateCommandHandler });
  assert.equal(result.exitCode, 4);
  assert.deepEqual(result.output, {
    schema: "urn:usf:integrate-result:1",
    status: "refused",
    reasonCode: "INTEGRATION_VALIDATION_INVALID",
    candidateDigests: [digest],
    dryRun: true,
    nonClaims: [
      "no-integration-observation-created",
      "no-evidence-proof-publication-or-completion-effect",
      "no-github-push-provider-runtime-staging-or-production-effect",
    ],
  });
});

test("bootstrap transition publish parsing is one compact exact success/refusal table", () => {
  const valid = ["bootstrap-transition", "--profile", "urn:usf:profile:v3-semantic-first:1", "--manifest", "graph/manifests/self-host.json", "--receipt", "evidence/semantic-first-bootstrap-admission.json", "--verify"];
  assert.deepEqual(parsePublishArguments(valid), {
    operation: "bootstrap-transition",
    profile: "urn:usf:profile:v3-semantic-first:1",
    manifestPath: "graph/manifests/self-host.json",
    receiptPath: "evidence/semantic-first-bootstrap-admission.json",
    mode: "verify",
  });
  assert.equal(parsePublishArguments(valid.with(-1, "--apply")).mode, "apply");

  const refusals = [
    valid.slice(1),
    [...valid, "--apply"],
    valid.with(2, "profile-without-versioned-iri"),
    valid.with(4, "../graph/manifests/self-host.json"),
    valid.with(6, "/tmp/receipt.json"),
    [...valid, "--unknown"],
    [...valid.slice(0, -1), "--verify", "--verify"],
  ];
  for (const args of refusals) assert.throws(() => parsePublishArguments(args), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match((error as Error & { code?: string }).code ?? "", /^PUBLISH_/u);
    return true;
  });
});
