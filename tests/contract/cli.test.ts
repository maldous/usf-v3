import assert from "node:assert/strict";
import test from "node:test";
import { commandRegistry, findHelpTopic, helpCommandResult } from "../../src/commands/help.ts";
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
  const required = ["init", "doctor", "status", "query", "observe", "metrics", "work", "models", "probe", "route", "call", "review", "resolve", "apply", "check", "integrate", "evidence", "prove", "drift", "publish", "start", "stop", "watch", "help"];
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
