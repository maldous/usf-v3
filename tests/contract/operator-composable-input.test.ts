import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { callCommandHandler } from "../../src/commands/call.ts";
import { maximumCommandInputBytes, parseCommandInput, readCommandInput } from "../../src/commands/command-input.ts";
import { createGraphLeafDispatcher, type GraphLeafAuthorization } from "../../src/commands/graph-leaf-dispatch.ts";
import type { FreshLeafChildEntryAuthority } from "../../src/commands/provider-leaf-dispatch.ts";
import { helpCommandResult } from "../../src/commands/help.ts";
import { resolveCommandHandler } from "../../src/commands/resolve.ts";
import { canonicalDigest } from "../../src/core/canonical.ts";
import { fakeProviderRoutes } from "../../src/providers/fake.ts";
import type { CallAssignment, CallBatchResult } from "../../src/providers/types.ts";
import { proposalBasis, proposalPacket } from "../fixtures/proposal-packet.ts";

const codeIs = (code: string) => (error: unknown): boolean => error instanceof Error && (error as Error & { code?: string }).code === code;

test("call and resolve accept only one bounded inline, stdin or owner-private file input", async (context) => {
  for (const command of ["CALL", "RESOLVE"] as const) {
    assert.deepEqual(parseCommandInput(["--input", "-"], command), { mode: "source", source: "-" });
    assert.deepEqual(parseCommandInput(["--input", ".usf/inputs/work.json"], command), { mode: "source", source: ".usf/inputs/work.json" });
    assert.deepEqual(parseCommandInput(["{}"], command), { mode: "inline", json: "{}" });
    for (const args of [[], ["--input"], ["--input", ""], ["--input", "-", "extra"], ["--unknown", "x"], ["--input", "-", "--input", "-"]]) {
      assert.throws(() => parseCommandInput(args, command), { code: `${command}_ARGUMENTS_INVALID`, exitCode: 2 });
    }
    assert.throws(() => parseCommandInput(["x".repeat(maximumCommandInputBytes + 1)], command), { code: `${command}_INPUT_REFUSED`, exitCode: 5 });
  }

  const root = await mkdtemp(join(tmpdir(), "usf-command-input-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const inputDirectory = join(root, ".usf", "inputs");
  await mkdir(inputDirectory, { recursive: true });
  const valid = join(inputDirectory, "valid.json");
  await writeFile(valid, "{\"status\":\"ok\"}", { mode: 0o600 });
  assert.deepEqual(await readCommandInput(root, { mode: "source", source: ".usf/inputs/valid.json" }, "CALL"), { status: "ok" });

  await chmod(valid, 0o640);
  await assert.rejects(async () => await readCommandInput(root, { mode: "source", source: ".usf/inputs/valid.json" }, "CALL"), codeIs("CALL_INPUT_REFUSED"));
  await chmod(valid, 0o600);
  await writeFile(join(inputDirectory, "bytes.json"), Buffer.from([0xff]), { mode: 0o600 });
  await assert.rejects(async () => await readCommandInput(root, { mode: "source", source: ".usf/inputs/bytes.json" }, "RESOLVE"), codeIs("RESOLVE_INPUT_INVALID"));

  const genericCall = (helpCommandResult(["call", "--json"]).output as { command: { externalContact: string; outputSchema: string } }).command;
  const parallel = (helpCommandResult(["call", "parallel", "--json"]).output as { command: { availability: string; externalContact: string; outputSchema: string } }).command;
  const compare = (helpCommandResult(["call", "compare", "--json"]).output as { command: { availability: string; externalContact: string; outputSchema: string } }).command;
  assert.equal(genericCall.externalContact, "none");
  assert.equal(genericCall.outputSchema, "urn:usf:call-result:1");
  assert.equal(parallel.availability, "registered");
  assert.equal(parallel.externalContact, "explicit");
  assert.equal(parallel.outputSchema, "urn:usf:parallel-provider-run:1");
  assert.equal(compare.availability, "registered");
  assert.equal(compare.externalContact, "explicit");
  assert.equal(compare.outputSchema, "urn:usf:semantic-token-comparison:1");
});

test("ordinary exact carrier refuses symlink and hardlink command inputs", async (context) => {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission !== undefined && (!permission.has("fs.read") || !permission.has("fs.write"))) {
    context.skip("confined link-creation-unavailable");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "usf-command-input-links-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const inputDirectory = join(root, ".usf", "inputs");
  await mkdir(inputDirectory, { recursive: true });
  const valid = join(inputDirectory, "valid.json");
  await writeFile(valid, "{\"status\":\"ok\"}", { mode: 0o600 });
  await symlink("valid.json", join(inputDirectory, "alias.json"));
  await assert.rejects(async () => await readCommandInput(root, { mode: "source", source: ".usf/inputs/alias.json" }, "CALL"), codeIs("CALL_INPUT_REFUSED"));
  await link(valid, join(inputDirectory, "linked.json"));
  await assert.rejects(async () => await readCommandInput(root, { mode: "source", source: ".usf/inputs/linked.json" }, "CALL"), codeIs("CALL_INPUT_REFUSED"));
});

test("registered no-contact call and resolve preserve exact model identity and one immutable basis", async () => {
  const basis = proposalBasis();
  const baseRoute = fakeProviderRoutes()[0]!;
  const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
  const assignments: CallAssignment[] = ["model-a", "model-b"].map((model, index) => ({
    route: {
      ...baseRoute,
      requested: { ...baseRoute.requested, model },
      actual: { ...baseRoute.actual, model: `actual-${model}` },
    },
    basis,
    workPacketDigest: basis.work.packetCoreDigest,
    promptTemplateDigest: basis.inputs.policyDigest,
    scopedDependencyDigest: basis.work.scopedDependencyDigest,
    limits,
    packet: proposalPacket(basis.work.id, "bounded no-contact composition", [`src/model-${index}.ts`], [{ kind: "write", path: `src/model-${index}.ts`, content: "export {};\n" }]),
  }));
  const called = await callCommandHandler({ command: "call", args: [JSON.stringify({ assignments, hostConcurrency: 2 })], repositoryRoot: process.cwd() });
  const output = called.output as CallBatchResult;
  assert.equal(output.status, "ok");
  assert.deepEqual(output.contributions.map((entry) => entry.requested.model).sort(), ["model-a", "model-b"]);
  assert.deepEqual(output.contributions.map((entry) => entry.actual.model).sort(), ["actual-model-a", "actual-model-b"]);
  assert.equal(Object.isFrozen(output.metrics), true);
  assert.equal(Object.isFrozen(output.contributions[0]!.basis), true);

  const resolved = await resolveCommandHandler({ command: "resolve", args: [JSON.stringify(output)], repositoryRoot: process.cwd() });
  const resolution = resolved.output as { status: string; candidate: { payload: { operations: unknown[] } } | null };
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.candidate?.payload.operations.length, 2);
});

test("resolve refuses incomplete batches and malformed or mixed manual contributions with stable codes", async () => {
  await assert.rejects(
    async () => await resolveCommandHandler({ command: "resolve", args: [JSON.stringify({ schema: "urn:usf:call-result:1", status: "partial", contributions: [], failures: [], metrics: {} })], repositoryRoot: process.cwd() }),
    codeIs("RESOLVE_CALL_RESULT_INCOMPLETE"),
  );
  const basis = proposalBasis();
  const baseRoute = fakeProviderRoutes()[0]!;
  const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
  const assignment: CallAssignment = { route: baseRoute, basis, limits, workPacketDigest: basis.work.packetCoreDigest, promptTemplateDigest: basis.inputs.policyDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest, packet: proposalPacket(basis.work.id, "manual", ["src/manual.ts"], [{ kind: "write", path: "src/manual.ts", content: "export {};\n" }]) };
  const called = await callCommandHandler({ command: "call", args: [JSON.stringify({ assignments: [assignment] })], repositoryRoot: process.cwd() });
  const contribution = (called.output as CallBatchResult).contributions[0]!;
  await assert.rejects(
    async () => await resolveCommandHandler({ command: "resolve", args: [JSON.stringify([{ ...contribution, identity: { ...contribution.identity, artifactDigest: "bad" } }])], repositoryRoot: process.cwd() }),
    codeIs("RESOLVE_INPUT_INVALID"),
  );
  await assert.rejects(
    async () => await resolveCommandHandler({ command: "resolve", args: [JSON.stringify([contribution, { ...contribution, basis: proposalBasis("urn:fixture:work:other") }])], repositoryRoot: process.cwd() }),
    codeIs("RESOLVE_BASIS_INVALID"),
  );
});

test("reserved graph leaves use the same injected fresh-child ordering without consuming input early", async () => {
  const order: string[] = [];
  const digest = `sha256:${"a".repeat(64)}`;
  const ticket = (leaf: "parallel" | "compare"): GraphLeafAuthorization => {
    const repositoryDependencies = Object.freeze([{ path: "src/commands/provider-parallel.ts", digest, roles: Object.freeze(["file"] as const) }]);
    return Object.freeze({
      leaf,
      work: "urn:usf:work:provider-parallel-execution",
      contract: "urn:usf:contract:provider-parallel-execution:1",
      profile: "urn:usf:profile:v3-self-host:3",
      manifest: "graph/manifests/self-host-provider-v3.json",
      repositoryRoot: process.cwd(),
      basisDigest: digest,
      scopedDependencyDigest: digest,
      modulePath: "src/commands/provider-parallel.ts",
      moduleDigest: digest,
      repositoryDependencies,
      repositoryClosureDigest: canonicalDigest(repositoryDependencies),
    });
  };
  const childEntry: FreshLeafChildEntryAuthority = Object.freeze({
    work: "urn:usf:work:operator-observability",
    contract: "urn:usf:contract:operator-observability:1",
    basisDigest: digest,
    scopedDependencyDigest: digest,
    path: "src/commands/graph-leaf-dispatch.ts",
    digest,
    dependency: Object.freeze({ path: "src/commands/graph-leaf-dispatch.ts", digest, roles: Object.freeze(["file"] as const) }),
  });
  const dispatch = createGraphLeafDispatcher({
    authorize: ({ leaf }) => { order.push("authorize"); return ticket(leaf); },
    authenticate: async (_root, dependencies) => { order.push(`authenticate:${dependencies.length}`); },
    authorizeChildEntry: async () => { order.push("entry:authorize"); return childEntry; },
    authenticateChildEntry: async () => { order.push("entry:authenticate"); },
    launcherLock: async () => ({
      validate: async () => { order.push("parent-lock:validate"); },
      release: async () => { order.push("parent-lock:release"); },
    }),
    withImportLock: async (_root, action) => { order.push("child-lock:enter"); try { return await action(); } finally { order.push("child-lock:release"); } },
    load: async () => {
      order.push("load");
      const handler = () => { order.push("handler"); return { output: { status: "delegated" } }; };
      return { parallelCommandHandler: handler, compareCommandHandler: handler };
    },
    runChild: async ({ request, prepareChild, validateParentLock, releaseParentLock }) => {
      const handler = await prepareChild();
      order.push("prepared");
      await validateParentLock();
      await releaseParentLock();
      order.push("acknowledged");
      return handler({ command: "call", args: request.args, repositoryRoot: request.repositoryRoot });
    },
  });
  const args = ["parallel", "--profile", "urn:usf:profile:v3-self-host:3", "--manifest", "graph/manifests/self-host-provider-v3.json", "--input", "-"] as const;
  assert.equal(await dispatch(["not-a-leaf"], process.cwd()), null);
  assert.deepEqual(await dispatch(args, process.cwd()), { output: { status: "delegated" } });
  assert.ok(order.indexOf("child-lock:release") < order.indexOf("prepared"));
  assert.ok(order.indexOf("prepared") < order.indexOf("parent-lock:release"));
  assert.ok(order.indexOf("parent-lock:release") < order.indexOf("acknowledged"));
  assert.ok(order.indexOf("acknowledged") < order.indexOf("handler"));
  assert.equal(order.filter((entry) => entry === "authorize").length, 2);
  assert.equal(order.filter((entry) => entry === "entry:authorize").length, 2);
});
