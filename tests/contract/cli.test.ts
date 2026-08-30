import assert from "node:assert/strict";
import test from "node:test";
import { commandRegistry, findHelpTopic, helpCommandResult } from "../../src/commands/help.ts";
import { dispatchCommand, parseCommand } from "../../src/commands/dispatcher.ts";

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
  const output = machine.output as { schema: string; status: string; topic: string[]; command: { outputSchema: string; externalContact: string; historyScan: string; availability: string } };
  assert.equal(output.schema, "urn:usf:cli-help:1");
  assert.equal(output.status, "ok");
  assert.deepEqual(output.topic, ["metrics", "tokens"]);
  assert.equal(output.command.outputSchema, "urn:usf:metrics-report:1");
  assert.equal(output.command.externalContact, "none");
  assert.equal(output.command.historyScan, "bounded");
  assert.equal(output.command.availability, "implemented");
});
