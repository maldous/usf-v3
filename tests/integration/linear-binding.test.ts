import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dispatchCliCommand } from "../../src/cli.ts";
import { errorOutput, UsfError } from "../../src/core/errors.ts";

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "usf-linear-binding-cli-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".usf"), { mode: 0o700 });
  await mkdir(join(root, "graph/manifests"), { recursive: true });
  const binding = "urn:test:binding:cli";
  const graph = "urn:usf:graph:linear-issue-bindings";
  const quad = (predicate: string, object: string, iri = false): string =>
    `<${binding}> <urn:usf:predicate:${predicate}> ${iri ? `<${object}>` : JSON.stringify(object)} <${graph}> .`;
  await writeFile(join(root, "graph/linear-issue-bindings.nq"), [
    quad("type", "urn:usf:type:LinearIssueWorkBinding", true),
    quad("issueWorkspace", "workspace-main"),
    quad("issueUuid", "123e4567-e89b-42d3-a456-426614174000"),
    quad("canonicalIssueLocator", "workspace-main:123e4567-e89b-42d3-a456-426614174000"),
    quad("owningModel", "USF"),
    quad("selectedProfile", "urn:usf:profile:linear-work-binding:1", true),
    quad("targetManifest", "graph/manifests/linear-work-binding.json"),
    quad("workIri", "urn:usf:work:linear-work-binding", true),
    quad("fixedPrompt", "Synthetic CLI fixture; do not contact a provider."),
    quad("maximumPromptTokens", "12000"),
    "",
  ].join("\n"));
  await writeFile(join(root, "graph/manifests/linear-issue-bindings.json"), `${JSON.stringify({
    schema: "urn:usf:graph-manifest:2",
    version: 2,
    imports: [],
    sources: [{
      path: "graph/linear-issue-bindings.nq",
      format: "application/n-quads",
      graph,
      role: "contract",
      validationProfile: "bootstrap-nquads-v1",
    }],
  })}\n`);
  return root;
}

async function invoke(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await dispatchCliCommand(args, root);
    return {
      code: result.exitCode ?? 0,
      stdout: result.outputMode === "text" ? String(result.output) : JSON.stringify(result.output) ?? "",
      stderr: "",
    };
  } catch (error) {
    return {
      code: error instanceof UsfError ? error.exitCode : 1,
      stdout: "",
      stderr: JSON.stringify(errorOutput(error)),
    };
  }
}

function parsed(result: { stdout: string; stderr: string }): any {
  return JSON.parse((result.stdout || result.stderr).trim());
}

test("CLI help advertises the exact linear-binding boundary", async t => {
  const root = await fixture(t);
  const result = await invoke(root, ["help", "linear-binding"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /usf linear-binding prepare --manifest PATH --binding IRI/);
  assert.match(result.stdout, /usf linear-binding status --manifest PATH --binding IRI/);
  assert.match(result.stdout, /usf linear-binding settle --manifest PATH --binding IRI --evidence sha256:<64hex>/);
});

test("CLI refuses malformed, missing, and duplicate linear-binding options", async t => {
  const root = await fixture(t);
  for (const args of [
    ["linear-binding", "unknown", "--manifest", "x", "--binding", "urn:test:x"],
    ["linear-binding", "prepare", "--manifest", "x"],
    ["linear-binding", "prepare", "--manifest", "x", "--manifest", "y", "--binding", "urn:test:x"],
    ["linear-binding", "status", "--manifest", "--binding", "urn:test:x"],
    ["linear-binding", "settle", "--manifest", "x", "--binding", "urn:test:x"],
    ["linear-binding", "settle", "--manifest", "x", "--binding", "urn:test:x", "--evidence", "not-a-digest"],
    ["linear-binding", "settle", "--manifest", "x", "--binding", "urn:test:x", "--evidence", `sha256:${"a".repeat(64)}`, "--evidence", `sha256:${"b".repeat(64)}`],
    ["linear-binding", "prepare", "--manifest", "x", "--binding", "urn:test:x", "--evidence", `sha256:${"a".repeat(64)}`],
    ["linear-binding", "status", "--manifest", "x", "--binding", "urn:test:x", "--evidence", `sha256:${"a".repeat(64)}`],
  ]) {
    const result = await invoke(root, args);
    assert.notEqual(result.code, 0);
    assert.match(parsed(result).reasonCode, /^LINEAR_BINDING_(?:OPERATION_UNKNOWN|ARGUMENTS_INVALID)$/u);
  }
});

test("CLI settle requires the existing stewardship claim before target work", async t => {
  const root = await fixture(t);
  const result = await invoke(root, [
    "linear-binding",
    "settle",
    "--manifest",
    "graph/manifests/linear-issue-bindings.json",
    "--binding",
    "urn:test:binding:cli",
    "--evidence",
    `sha256:${"a".repeat(64)}`,
  ]);
  assert.equal(result.code, 4);
  assert.equal(parsed(result).reasonCode, "STEWARD_CLAIM_STALE");
});
