import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { buildLinearBindingPrompt } from "../../../src/commands/linear-binding.ts";
import { deriveLinearBindingDeclaration, LinearBindingError, type LinearBindingAuthority } from "../../../src/graph/linear-binding.ts";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import type { WorkPacket } from "../../../src/graph/work.ts";
import type { Quad } from "../../../src/graph/nquads.ts";

const selection = { path: "src/source.ts", start: "BEGIN\n", end: "\nEND", maximumBytes: 4096 };
const before = Buffer.from('prefix \u03bb\nBEGIN\nconst chosen = "before";\nEND\nunrelated suffix\n');
const roots = new Set<string>();
const digest = (bytes: Buffer): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const reason = (expected: string) => (error: unknown): boolean =>
  error instanceof LinearBindingError && error.reasonCode === expected;

test.afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.clear();
});

function declaration(context?: unknown, disposition?: string): LinearBindingAuthority {
  const id = "urn:usf:linear-binding:source-context-fixture:1";
  const fields: Array<[string, string, "literal" | "iri"]> = [
    ["type", "urn:usf:type:LinearIssueWorkBinding", "iri"],
    ["issueWorkspace", "maldous", "literal"],
    ["issueUuid", "8f4b0f2e-6c41-4fb5-9eb6-60b2b99f6c73", "literal"],
    ["owningModel", "USF", "literal"], ["maximumPromptTokens", "12000", "literal"],
    ["selectedProfile", "urn:usf:profile:source-context:1", "iri"],
    ["targetManifest", "graph/manifests/source-context.json", "literal"],
    ["workIri", "urn:usf:work:source-context", "iri"],
    ["fixedPrompt", "Repair only the selected literal using the authenticated source excerpt.", "literal"],
  ];
  if (context !== undefined) fields.push(["sourceContext", JSON.stringify(context), "literal"]);
  if (disposition !== undefined) fields.push(["realisationDisposition", disposition, "literal"]);
  const quads: Quad[] = fields.map(([predicate, object, objectKind]) => ({
    subject: id, predicate: "urn:usf:predicate:" + predicate, object, objectKind,
    graph: "urn:usf:graph:source-context-fixture", canonical: "",
  }));
  return deriveLinearBindingDeclaration({ quads } as SemanticGraph, id);
}

function packet(bytes: Buffer = before): WorkPacket {
  return {
    id: "urn:usf:work:source-context", objective: "Repair one literal.",
    requirements: [], readSet: [], writeSet: ["src/source.ts"],
    validationPlan: [], proofObligations: [], constraints: [],
    realisationBasis: { scope: {
      readSet: [], writeSet: ["src/source.ts"], preimages: { "src/source.ts": digest(bytes) },
    } },
  } as unknown as WorkPacket;
}

async function fixture(bytes: Buffer = before): Promise<string> {
  const root = await mkdtemp(resolve(process.env.TMPDIR ?? tmpdir(), "usf-source-context-"));
  roots.add(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, selection.path), bytes);
  return root;
}

test("source context is an explicit immutable graph contract", () => {
  const authority = declaration([selection]);
  assert.deepEqual(authority.sourceContext, [selection]);
  assert.equal(Object.isFrozen(authority.sourceContext), true);
  assert.equal(Object.isFrozen(authority.sourceContext![0]), true);
  assert.equal(Object.hasOwn(declaration(), "sourceContext"), false);
  assert.equal(Object.hasOwn(declaration(undefined, "no-change"), "sourceContext"), false);
  assert.throws(() => declaration([selection], "no-change"), reason("LINEAR_BINDING_SOURCE_CONTEXT_INVALID"));
});

test("malformed source context is rejected before any source access", async t => {
  const invalid: unknown[] = [
    null, {}, [], [selection, selection], [{ ...selection, extra: true }],
    [{ ...selection, path: "../outside" }], [{ ...selection, path: "/outside" }],
    [{ ...selection, path: "src\\source.ts" }], [{ ...selection, path: "src//source.ts" }],
    [{ ...selection, path: "./src/source.ts" }], [{ ...selection, path: "src/\u0000.ts" }],
    [{ ...selection, start: "" }], [{ ...selection, end: "" }],
    [{ ...selection, start: "a".repeat(1025) }],
    [{ ...selection, maximumBytes: 0 }], [{ ...selection, maximumBytes: 1.5 }],
    [{ ...selection, maximumBytes: 16385 }],
    Array.from({ length: 17 }, (_, i) => ({ ...selection, path: "src/" + i + ".ts" })),
    Array.from({ length: 5 }, (_, i) => ({ ...selection, path: "src/" + i + ".ts", maximumBytes: 16384 })),
  ];
  for (const [i, value] of invalid.entries()) {
    await t.test("invalid declaration " + i, () =>
      assert.throws(() => declaration(value), reason("LINEAR_BINDING_SOURCE_CONTEXT_INVALID")));
  }
});

test("small and large budgets both carry the same digest-bound exact excerpt, not the full file", async () => {
  const root = await fixture();
  const authority = declaration([selection]);
  const prompt = await buildLinearBindingPrompt(root, packet(), authority);
  const result = JSON.parse(prompt);
  const content = 'BEGIN\nconst chosen = "before";';
  const startByte = Buffer.byteLength("prefix \u03bb\n");
  assert.deepEqual(result.sourceContext, [{
    path: selection.path, preimageDigest: digest(before), excerptDigest: digest(Buffer.from(content)),
    startByte, endByte: startByte + Buffer.byteLength(content), content,
  }]);
  assert.match(result.sourceContextResponseContract, /operations only/);
  assert.match(result.sourceContextResponseContract, /no file-reading tools/);
  assert.deepEqual(result.writeSet, [selection.path]);
  assert.equal(Object.hasOwn(result, "writeSetContext"), false);
  assert.equal(prompt.includes("unrelated suffix"), false);
  assert.ok(Buffer.byteLength(prompt) <= 12000);
  const large = JSON.parse(await buildLinearBindingPrompt(root, packet(), { ...authority, maximumPromptTokens: 180000 }));
  assert.deepEqual(large, result);
});

test("legacy metadata, legacy whole-file and native no-change prompt shapes remain distinct", async () => {
  const root = await fixture();
  const legacy = JSON.parse(await buildLinearBindingPrompt(root, packet(), declaration()));
  assert.equal(Object.hasOwn(legacy, "sourceContext"), false);
  assert.equal(Object.hasOwn(legacy, "writeSetContext"), false);
  const wholeFile = JSON.parse(await buildLinearBindingPrompt(root, packet(), { ...declaration(), maximumPromptTokens: 180000 }));
  assert.deepEqual(wholeFile.writeSetContext, [{ path: selection.path, encoding: "utf8", content: before.toString("utf8") }]);
  assert.equal(Object.hasOwn(wholeFile, "sourceContext"), false);
  const native = JSON.parse(await buildLinearBindingPrompt(root, packet(), {
    ...declaration(undefined, "no-change"), maximumPromptTokens: 180000,
  }));
  assert.equal(native.realisationDisposition, "no-change");
  assert.equal(Object.hasOwn(native, "writeSetContext"), false);
  assert.equal(Object.hasOwn(native, "sourceContext"), false);
});

test("context never turns a basis preimage into additional read or write authority", async () => {
  const root = await fixture();
  const allowed = declaration([selection]);
  const unauthorized = packet();
  (unauthorized.realisationBasis!.scope.writeSet as string[]).length = 0;
  await assert.rejects(buildLinearBindingPrompt(root, unauthorized, allowed), reason("LINEAR_BINDING_SOURCE_CONTEXT_SCOPE_REFUSED"));
  const missing = packet();
  delete (missing.realisationBasis!.scope.preimages as Record<string, string>)[selection.path];
  await assert.rejects(buildLinearBindingPrompt(root, missing, allowed), reason("LINEAR_BINDING_SOURCE_CONTEXT_SCOPE_REFUSED"));
});

test("changed preimages are refused instead of supplied as current source", async () => {
  const root = await fixture();
  await writeFile(resolve(root, selection.path), before.toString("utf8").replace("before", "after!"));
  await assert.rejects(buildLinearBindingPrompt(root, packet(), declaration([selection])), reason("LINEAR_BINDING_BASIS_NONCURRENT"));
});

test("missing and nonunique anchors are refused rather than guessed", async t => {
  const cases = [
    Buffer.from("no markers"), Buffer.from(before.toString("utf8") + "BEGIN\n"),
    Buffer.from(before.toString("utf8") + "\nEND"), Buffer.from("\nEND\nBEGIN\nreversed"),
  ];
  for (const [i, bytes] of cases.entries()) {
    await t.test("ambiguous or missing anchor " + i, async () => {
      const root = await fixture(bytes);
      await assert.rejects(buildLinearBindingPrompt(root, packet(bytes), declaration([selection])),
        reason("LINEAR_BINDING_SOURCE_CONTEXT_ANCHOR_INVALID"));
    });
  }
});

test("excerpt and complete canonical prompt have independent hard bounds", async () => {
  const root = await fixture();
  await assert.rejects(buildLinearBindingPrompt(root, packet(), declaration([{ ...selection, maximumBytes: 1 }])),
    reason("LINEAR_BINDING_SOURCE_CONTEXT_LIMIT"));
  await assert.rejects(buildLinearBindingPrompt(root, packet(), { ...declaration([selection]), maximumPromptTokens: 100 }),
    reason("LINEAR_BINDING_PROMPT_POLICY_INVALID"));
});

test("non-UTF8 and oversized source files fail closed", async () => {
  const invalid = Buffer.concat([Buffer.from([255]), before]);
  const root = await fixture(invalid);
  await assert.rejects(buildLinearBindingPrompt(root, packet(invalid), declaration([selection])),
    reason("LINEAR_BINDING_SOURCE_CONTEXT_ENCODING_INVALID"));
  const large = Buffer.alloc(4 * 1024 * 1024 + 1, 65);
  const largeRoot = await fixture(large);
  await assert.rejects(buildLinearBindingPrompt(largeRoot, packet(large), declaration([selection])),
    reason("LINEAR_BINDING_SOURCE_CONTEXT_UNSAFE"));
});

test("symlinks, linked files, directories and linked ancestors are not source context", async t => {
  for (const kind of ["symlink", "hardlink", "directory", "ancestor"] as const) {
    await t.test(kind, async () => {
      const root = await fixture();
      const path = resolve(root, selection.path);
      if (kind === "symlink") {
        await rename(path, resolve(root, "held.ts"));
        await symlink(resolve(root, "held.ts"), path);
      } else if (kind === "hardlink") {
        await link(path, resolve(root, "linked.ts"));
      } else if (kind === "directory") {
        await rm(path);
        await mkdir(path);
      } else {
        await rename(resolve(root, "src"), resolve(root, "held"));
        await symlink(resolve(root, "held"), resolve(root, "src"));
      }
      await assert.rejects(buildLinearBindingPrompt(root, packet(), declaration([selection])),
        reason(kind === "ancestor" ? "LINEAR_BINDING_RUNTIME_UNSAFE" : "LINEAR_BINDING_SOURCE_CONTEXT_UNSAFE"));
    });
  }
});
