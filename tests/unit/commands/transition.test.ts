import assert from "node:assert/strict";
import test from "node:test";
import { observationCommandHandler, parseTransitionInterrogation } from "../../../src/commands/transition.ts";
import { findHelpTopic, transitionInterrogationContract } from "../../../src/commands/help.ts";

test("observation adapter refuses unknown commands and transport overrides before graph access", async () => {
  const request = { command: "resolve" as const, repositoryRoot: "/unavailable", args: [] as string[] };
  await assert.rejects(observationCommandHandler(request, "invented execute"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  for (const args of [["{}"], ["--profile", "urn:test:profile"], ["--input", "-", "--apply"], []]) {
    await assert.rejects(observationCommandHandler({ ...request, args }, "resolve prepare-local"), { code: "RESOLVE_ARGUMENTS_INVALID" });
  }
  const help = findHelpTopic(["resolve", "prepare-local"]);
  assert.equal(help?.outputSchema, "urn:usf:local-contribution:1");
  assert.equal(help?.externalContact, "none");
});

test("interrogation parser and help share the same external input contract", () => {
  const topic = findHelpTopic(transitionInterrogationContract.path)!;
  assert.deepEqual(topic.options.map((input) => input.syntax), transitionInterrogationContract.inputs.map((input) => `${input.flag} ${input.valueName}`));
  assert.deepEqual(parseTransitionInterrogation(["inspect", "--root", "urn:usf:work:example"]), {
    rootIdentity: "urn:usf:work:example", manifestPath: "graph/manifest.json",
  });
  assert.deepEqual(parseTransitionInterrogation(["inspect", "--manifest", "graph/manifests/example.json", "--root", "USF-1192"]), {
    rootIdentity: "USF-1192", manifestPath: "graph/manifests/example.json",
  });
});

test("derived overrides and guessed effectful operations refuse before graph loading", () => {
  for (const flag of ["--profile", "--work", "--binding", "--basis", "--candidate", "--apply", "--check-mode"]) {
    assert.throws(() => parseTransitionInterrogation(["inspect", "--root", "urn:test:work", flag, "value"]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
  }
  assert.throws(() => parseTransitionInterrogation(["execute", "--root", "urn:test:work"]), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  assert.throws(() => parseTransitionInterrogation(["inspect"]), { code: "CLI_TRANSITION_INPUT_REQUIRED" });
  assert.throws(() => parseTransitionInterrogation(["inspect", "--root", "urn:test:work", "--root", "urn:test:other"]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
});

test("every declared selector bound is enforced without hidden coercion", () => {
  for (const field of transitionInterrogationContract.inputs) {
    assert.throws(() => parseTransitionInterrogation(["inspect", field.flag, "x".repeat(field.maximumLength + 1)]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
  }
  for (const value of ["", "--manifest", "urn:invalid identity", "USF-0"]) {
    assert.throws(() => parseTransitionInterrogation(["inspect", "--root", value]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
  }
});
