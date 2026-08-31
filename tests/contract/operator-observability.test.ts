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
  const required = ["init", "doctor", "status", "query", "observe", "metrics", "work", "models", "probe", "route", "call", "review", "resolve", "realise", "apply", "check", "integrate", "bootstrap-carrier", "evidence", "prove", "drift", "publish", "start", "stop", "watch", "help"];
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

  const realiseHelp = helpCommandResult(["realise", "no-change", "--json"]);
  const realise = (realiseHelp.output as { command: { availability: string; externalContact: string; historyScan: string; outputSchema: string; authorityEffect: string } }).command;
  assert.equal(realise.availability, "implemented");
  assert.equal(realise.externalContact, "none");
  assert.equal(realise.historyScan, "none");
  assert.equal(realise.outputSchema, "urn:usf:no-change-realisation-result:1");
  assert.match(realise.authorityEffect, /no primary bytes or semantic authority change/u);

  const completionEvidenceHelp = helpCommandResult(["evidence", "completion", "--json"]);
  assert.equal((completionEvidenceHelp.output as { command: { outputSchema: string } }).command.outputSchema, "urn:usf:completion-evidence-candidate:1");
  const completionProofHelp = helpCommandResult(["prove", "completion", "--json"]);
  assert.equal((completionProofHelp.output as { command: { outputSchema: string } }).command.outputSchema, "urn:usf:completion-proof-bundle:1");

  const constructionPublishHelp = helpCommandResult(["publish", "construction-authority", "--json"]);
  const constructionPublish = (constructionPublishHelp.output as { command: { availability: string; authorityEffect: string; externalContact: string; historyScan: string; outputSchema: string; options: Array<{ syntax: string }> } }).command;
  assert.equal(constructionPublish.availability, "implemented");
  assert.equal(constructionPublish.externalContact, "none");
  assert.equal(constructionPublish.historyScan, "none");
  assert.equal(constructionPublish.outputSchema, "urn:usf:construction-authority-publication-result:1");
  assert.ok(constructionPublish.options.some((option) => option.syntax === "--bundle PATH|-"));
  assert.match(constructionPublish.authorityEffect, /never rewrites permission resources/u);

  const completionPublishHelp = helpCommandResult(["publish", "work-completion", "--json"]);
  const completionPublish = (completionPublishHelp.output as { command: { availability: string; externalContact: string; historyScan: string; outputSchema: string; options: Array<{ syntax: string }> } }).command;
  assert.equal(completionPublish.availability, "implemented");
  assert.equal(completionPublish.externalContact, "none");
  assert.equal(completionPublish.historyScan, "none");
  assert.equal(completionPublish.outputSchema, "urn:usf:work-completion-publication-result:1");
  assert.ok(completionPublish.options.some((option) => option.syntax === "--bundle PATH|-"));
});
