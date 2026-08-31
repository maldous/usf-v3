import assert from "node:assert/strict";
import test from "node:test";
import { commandRegistry, findHelpTopic, helpCommandResult } from "../../src/commands/help.ts";
import { exitCodeForReason, integrateCommandHandler, parseApplyArguments, parseCheckArguments, parseIntegrateArguments } from "../../src/commands/apply.ts";
import { parseBootstrapCarrierArguments } from "../../src/commands/bootstrap-carrier.ts";
import { dispatchCommand, parseCommand } from "../../src/commands/dispatcher.ts";
import { parsePublishArguments } from "../../src/commands/publish.ts";

test("CLI command parsing returns stable invalid-input codes", () => {
  assert.throws(() => parseCommand(["unknown"]), { code: "COMMAND_UNKNOWN", exitCode: 2 });
  assert.throws(() => parseCommand([]), { code: "COMMAND_REQUIRED", exitCode: 2 });
});

test("dispatcher calls a typed handler without hidden lifecycle state", async () => {
  const result = await dispatchCommand(["query", "--selector", "urn:usf:test"], "/repo", {
    query: (request) => ({ output: { command: request.command, args: request.args, root: request.repositoryRoot } }),
  });
  assert.deepEqual(result.output, { command: "query", args: ["--selector", "urn:usf:test"], root: "/repo" });
});

test("one static registry covers parsing and every self-describing help topic", () => {
  const required = ["init", "doctor", "status", "query", "observe", "metrics", "work", "models", "probe", "route", "call", "review", "resolve", "apply", "check", "integrate", "bootstrap-carrier", "evidence", "prove", "drift", "publish", "start", "stop", "watch", "help"];
  assert.deepEqual(commandRegistry.map((entry) => entry.name), required);
  for (const entry of commandRegistry) {
    assert.deepEqual(parseCommand([entry.name]), { command: entry.name, args: [] });
    const topics = "topics" in entry ? entry.topics ?? [] : [];
    for (const subject of [entry, ...topics]) {
      assert.ok(subject.purpose.length > 0);
      assert.ok(subject.synopsis.length > 0);
      assert.ok(subject.outputSchema.startsWith("urn:usf:"));
      assert.ok(subject.exitCodes.length > 0);
      assert.ok(subject.authorityEffect.length > 0);
      assert.ok(["none", "explicit", "possible"].includes(subject.externalContact));
      assert.ok(["none", "bounded"].includes(subject.historyScan));
      assert.ok(["implemented", "planned"].includes(subject.availability));
      assert.equal(findHelpTopic(subject.path), subject);
    }
  }
  assert.deepEqual(parseCommand(["--help"]), { command: "help", args: [] });
  assert.deepEqual(parseCommand(["--help", "--json"]), { command: "help", args: ["--json"] });
  assert.deepEqual(parseCommand(["metrics", "tokens", "--help", "--json"]), { command: "help", args: ["metrics", "tokens", "--json"] });
  const machine = helpCommandResult(["metrics", "tokens", "--json"]);
  assert.equal(machine.outputMode, "json");
  const output = machine.output as { schema: string; status: string; topic: string[]; command: { outputSchema: string; externalContact: string; historyScan: string; availability: string; exitCodeMeanings: Array<{ code: number; meaning: string }> } };
  assert.equal(output.schema, "urn:usf:cli-help:1");
  assert.equal(output.status, "ok");
  assert.deepEqual(output.topic, ["metrics", "tokens"]);
  assert.equal(output.command.outputSchema, "urn:usf:metrics-report:1");
  assert.equal(output.command.externalContact, "none");
  assert.equal(output.command.historyScan, "bounded");
  assert.equal(output.command.availability, "implemented");
  assert.deepEqual(output.command.exitCodeMeanings[0], { code: 0, meaning: "success" });

  const queryHelp = helpCommandResult(["query", "--json"]);
  const queryOptions = (queryHelp.output as { command: { options: Array<{ syntax: string }> } }).command.options.map((option) => option.syntax);
  assert.ok(queryOptions.includes("--selector IRI | --iri IRI | --contract IRI"));

  const workHelp = helpCommandResult(["work", "--json"]);
  const workOptions = (workHelp.output as { command: { options: Array<{ syntax: string }> } }).command.options.map((option) => option.syntax);
  assert.ok(workOptions.includes("--ready"));
  assert.ok(workOptions.includes("--stream"));
  assert.ok(workOptions.includes("--shard ID"));

  const availabilityHelp = helpCommandResult(["probe", "availability", "--json"]);
  const availability = (availabilityHelp.output as { command: { externalContact: string; exitCodes: number[] } }).command;
  assert.equal(availability.externalContact, "none");
  assert.deepEqual(availability.exitCodes, [2, 4, 5]);

  const routeHelp = helpCommandResult(["route", "--json"]);
  const route = (routeHelp.output as { command: { externalContact: string; exitCodes: number[]; options: Array<{ description: string }> } }).command;
  assert.equal(route.externalContact, "none");
  assert.ok(route.exitCodes.includes(4));
  assert.match(route.options[0]!.description, /config\/qualification\.json/u);

  const publishHelp = helpCommandResult(["publish", "bootstrap-transition", "--json"]);
  const publish = (publishHelp.output as { command: { availability: string; authorityEffect: string; externalContact: string; historyScan: string; synopsis: string[]; options: Array<{ description: string }> } }).command;
  assert.equal(publish.availability, "implemented");
  assert.equal(publish.externalContact, "none");
  assert.equal(publish.historyScan, "none");
  assert.match(publish.synopsis[0]!, /--profile urn:usf:profile:v3-semantic-first:1/u);
  assert.match(publish.options[0]!.description, /isolated core authority profile/u);
  assert.match(publish.authorityEffect, /No Git, signature, provider, runtime or historical-repository effect/u);

  const applyHelp = helpCommandResult(["apply", "--json"]);
  const apply = (applyHelp.output as { command: { synopsis: string[]; options: Array<{ syntax: string }>; exitCodes: number[] } }).command;
  assert.ok(apply.synopsis.some((entry) => entry.includes("usf apply --input -")));
  assert.ok(apply.options.some((option) => option.syntax === "--input PATH|-"));
  assert.deepEqual(apply.exitCodes, [0, 2, 4, 5, 7]);

  const checkHelp = helpCommandResult(["check", "--json"]);
  const check = (checkHelp.output as { command: { exitCodes: number[]; exitCodeMeanings: Array<{ code: number; meaning: string }>; options: Array<{ description: string }> } }).command;
  assert.deepEqual(check.exitCodes, [0, 1, 2, 3, 4, 5, 7]);
  assert.match(check.exitCodeMeanings.find((entry) => entry.code === 1)!.meaning, /validation failure/u);
  assert.match(check.options[1]!.description, /120000 millisecond wall-time limit/u);

  const integrateHelp = helpCommandResult(["integrate", "--json"]);
  const integrate = (integrateHelp.output as { command: { availability: string; authorityEffect: string; options: Array<{ syntax: string; description: string }>; exitCodes: number[] } }).command;
  assert.equal(integrate.availability, "implemented");
  assert.ok(integrate.options.some((option) => option.syntax === "--dry-run"));
  assert.match(integrate.options.find((option) => option.syntax === "--dry-run")!.description, /5000 millisecond termination grace/u);
  assert.deepEqual(integrate.exitCodes, [0, 1, 2, 3, 4, 5, 7]);
  assert.match(integrate.authorityEffect, /observation-only/u);
  assert.match(integrate.authorityEffect, /Neither mode contacts GitHub/u);

  const carrierHelp = helpCommandResult(["bootstrap-carrier", "adopt", "--json"]);
  const carrier = (carrierHelp.output as { command: { availability: string; externalContact: string; historyScan: string; authorityEffect: string; exitCodes: number[] } }).command;
  assert.equal(carrier.availability, "implemented");
  assert.equal(carrier.externalContact, "none");
  assert.equal(carrier.historyScan, "bounded");
  assert.deepEqual(carrier.exitCodes, [0, 1, 2, 3, 4, 5, 7]);
  assert.match(carrier.authorityEffect, /no replacement/u);

  const evidenceHelp = helpCommandResult(["evidence", "construction", "--json"]);
  const evidence = (evidenceHelp.output as { command: { availability: string; externalContact: string; historyScan: string; outputSchema: string; synopsis: string[] } }).command;
  assert.equal(evidence.availability, "implemented");
  assert.equal(evidence.externalContact, "none");
  assert.equal(evidence.historyScan, "none");
  assert.equal(evidence.outputSchema, "urn:usf:construction-evidence-candidate:1");
  assert.match(evidence.synopsis[0]!, /--work IRI --profile VERSIONED_IRI/u);

  const constructionPublishHelp = helpCommandResult(["publish", "construction-authority", "--json"]);
  const constructionPublish = (constructionPublishHelp.output as { command: { availability: string; authorityEffect: string; externalContact: string; historyScan: string; outputSchema: string; options: Array<{ syntax: string }> } }).command;
  assert.equal(constructionPublish.availability, "implemented");
  assert.equal(constructionPublish.externalContact, "none");
  assert.equal(constructionPublish.historyScan, "none");
  assert.equal(constructionPublish.outputSchema, "urn:usf:construction-authority-publication-result:1");
  assert.ok(constructionPublish.options.some((option) => option.syntax === "--bundle PATH|-"));
  assert.match(constructionPublish.authorityEffect, /never rewrites permission resources/u);
});

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
