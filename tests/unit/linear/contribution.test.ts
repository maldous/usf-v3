import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { canonicalDigest } from "../../../src/core/canonical.ts";
import { contributionFromGraphExecution, LinearContributionError } from "../../../src/commands/linear-contribution.ts";
import { proposalBasis } from "../../fixtures/proposal-packet.ts";
import { createRealisationBasis } from "../../../src/realisation/basis.ts";
import { containedProviderEnvironment, sdkInvocationLimits } from "../../../src/commands/graph-execute.ts";
import { resolveCommand } from "../../../src/commands/resolve.ts";
import { invokeCodexCli } from "../../../src/providers/cli-transports.ts";

const digest = (value: string) => canonicalDigest(value);
const fixtureBasis = proposalBasis("urn:test:work", digest("packet"));
const { basisDigest: _ignored, ...draft } = fixtureBasis;
const basis = createRealisationBasis({ ...draft, scope: { ...draft.scope, writeSet: ["src/owned.ts"] } });
const prepared = Object.freeze({ basis, unit: Object.freeze({ unitIri: "urn:test:unit", workIri: "urn:test:work", basisDigest: basis.basisDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest, prompt: "fixed prompt", modelCapabilities: ["typescript"] }) });

function persisted(overrides: Record<string, unknown> = {}): { evidence: unknown; evidenceDigest: string } {
  const resultText = JSON.stringify({ operations: [{ kind: "write", path: "src/owned.ts", content: "export {};" }] });
  const receipt = { taskClass: "typescript", role: "PATCH_PRODUCER", qualificationDigest: digest("qualification"), observationSetDigest: digest("observations") };
  const evidence = { schema: "urn:usf:graph-execution-evidence:1", status: "ok", qualificationSnapshot: { routes: [{ routeId: "other-provider:requested-model", taskClasses: ["typescript"], receipts: [receipt] }] }, units: [{ unit: "urn:test:unit", sourceAssertionDigest: digest("source"), promptDigest: canonicalDigest("fixed prompt"), status: "ok", transport: "other-cli", provider: "other-provider", requestedModel: "requested-model", actualModel: "actual-model", usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 }, toolCalls: 2, limits: { maxTurns: 3, maxWallTimeMs: 1000, maxInputTokens: 100, maxOutputTokens: 50, maxToolCalls: 2, maxRetries: 2 }, resultDigest: canonicalDigest(resultText), resultText, attempts: [], costClass: "free-quota" }], ...overrides };
  return { evidence, evidenceDigest: canonicalDigest(evidence) };
}
function refuses(code: string): (error: unknown) => boolean { return (error) => error instanceof LinearContributionError && error.reasonCode === code; }

test("adapts a qualified non-named route with retained receipts", () => {
  const contribution = contributionFromGraphExecution(prepared, persisted(), digest("source"));
  assert.equal(contribution.actual.provider, "other-provider");
  assert.equal(contribution.actual.model, "actual-model");
  assert.equal(contribution.payload.operations[0]?.path, "src/owned.ts");
  assert.equal(contribution.assignment.promptTemplateDigest, basis.inputs.policyDigest);
  assert.equal(contribution.usage.toolCalls, 2);
  assert.equal(contribution.claims.includes(`invocation-prompt-digest:${canonicalDigest("fixed prompt")}`), true);
  assert.equal(resolveCommand([contribution]).status, "resolved");
});

test("derives the prompt identity for legacy graph evidence without weakening present-digest checks", () => {
  const legacy = persisted();
  delete (legacy.evidence as { units: Array<Record<string, unknown>> }).units[0]!.promptDigest;
  const contribution = contributionFromGraphExecution(prepared, { evidence: legacy.evidence, evidenceDigest: canonicalDigest(legacy.evidence) }, digest("source"));
  assert.equal(contribution.claims.includes(`invocation-prompt-digest:${canonicalDigest("fixed prompt")}`), true);
  const malformed = persisted();
  (malformed.evidence as { units: Array<Record<string, unknown>> }).units[0]!.promptDigest = null;
  assert.throws(() => contributionFromGraphExecution(prepared, { evidence: malformed.evidence, evidenceDigest: canonicalDigest(malformed.evidence) }, digest("source")), refuses("LINEAR_CONTRIBUTION_RESULT_MISMATCH"));
});

test("SDK retention records enforced no-tools bounds and rejects an unknown context ceiling", () => {
  assert.deepEqual(sdkInvocationLimits({ contextLimit: 1024 }, { prompt: "bounded", maximumOutputTokens: 128 }, 150_000), {
    maxTurns: 1, maxWallTimeMs: 150_000, maxInputTokens: 896, maxOutputTokens: 128, maxToolCalls: 0, maxRetries: 0,
  });
  assert.equal(sdkInvocationLimits({ contextLimit: null }, { prompt: "bounded", maximumOutputTokens: 128 }, 150_000), null);
});

test("contained provider environment keeps child and parent scratch files private", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-contained-provider-"));
  const spawn = childProcess.spawn;
  try {
    const home = resolve(root, ".usf", "provider-home");
    await mkdir(home, { recursive: true, mode: 0o700 });
    const contained = await containedProviderEnvironment(root, { PATH: "/usr/bin" });
    assert.deepEqual(contained.environment, {
      HOME: home,
      USF_PROVIDER_HOME: home,
      PATH: "/usr/bin",
      TMPDIR: resolve(root, ".usf", "tmp"),
    });
    assert.equal((await stat(contained.temporaryDirectory)).mode & 0o077, 0);
    let scratch = "";
    // Only the fixture executable is substituted; real Node performs the child IO.
    childProcess.spawn = ((executable: string, args: readonly string[], options: childProcess.SpawnOptions) => {
      assert.equal(executable, "fixture-only-codex");
      assert.deepEqual(options.env, contained.environment);
      const output = args[args.indexOf("-o") + 1]!;
      scratch = resolve(output, "..");
      const script = `const fs=require('node:fs');
        if(process.env.HOME!==${JSON.stringify(home)}||process.env.TMPDIR!==${JSON.stringify(contained.temporaryDirectory)})process.exit(2);
        fs.writeFileSync(${JSON.stringify(output)},'fixture output');
        console.log(JSON.stringify({type:'thread.started',thread_id:'fixture'}));
        console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));`;
      return spawn(process.execPath, ["-e", script], options);
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();
    const produced = await invokeCodexCli("fixture prompt", 5_000, null, "fixture-only-codex", contained.environment);
    assert.equal(produced.outcome, "ok");
    assert.equal(resolve(scratch, ".."), contained.temporaryDirectory);
    assert.equal(await stat(scratch).then(() => true, () => false), false);
  } finally {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses absent provenance, usage, qualification, scope and mismatches", () => {
  assert.throws(() => contributionFromGraphExecution(prepared, { evidence: {}, evidenceDigest: digest("none") }, digest("source")), refuses("LINEAR_CONTRIBUTION_RESULT_UNPROVEN"));
  const missingUsage = persisted(); (missingUsage.evidence as { units: Array<Record<string, unknown>> }).units[0]!.usage = null;
  assert.throws(() => contributionFromGraphExecution(prepared, { evidence: missingUsage.evidence, evidenceDigest: canonicalDigest(missingUsage.evidence) }, digest("source")), refuses("LINEAR_CONTRIBUTION_USAGE_UNKNOWN"));
  const missingQualification = persisted(); (missingQualification.evidence as { qualificationSnapshot: unknown }).qualificationSnapshot = {};
  assert.throws(() => contributionFromGraphExecution(prepared, { evidence: missingQualification.evidence, evidenceDigest: canonicalDigest(missingQualification.evidence) }, digest("source")), refuses("LINEAR_CONTRIBUTION_QUALIFICATION_UNKNOWN"));
  const outsideScope = persisted(); ((outsideScope.evidence as { units: Array<Record<string, unknown>> }).units[0]!).resultText = JSON.stringify({ operations: [{ kind: "write", path: "src/outside.ts", content: "x" }] });
  const unit = (outsideScope.evidence as { units: Array<Record<string, unknown>> }).units[0]!; unit.resultDigest = canonicalDigest(unit.resultText);
  assert.throws(() => contributionFromGraphExecution(prepared, { evidence: outsideScope.evidence, evidenceDigest: canonicalDigest(outsideScope.evidence) }, digest("source")), refuses("LINEAR_CONTRIBUTION_SCOPE_REFUSED"));
  const missingLimits = persisted(); (missingLimits.evidence as { units: Array<Record<string, unknown>> }).units[0]!.toolCalls = null;
  assert.throws(() => contributionFromGraphExecution(prepared, { evidence: missingLimits.evidence, evidenceDigest: canonicalDigest(missingLimits.evidence) }, digest("source")), refuses("LINEAR_CONTRIBUTION_LIMITS_UNKNOWN"));
  const mismatchedPrompt = persisted(); (mismatchedPrompt.evidence as { units: Array<Record<string, unknown>> }).units[0]!.promptDigest = digest("other-prompt");
  assert.throws(() => contributionFromGraphExecution(prepared, { evidence: mismatchedPrompt.evidence, evidenceDigest: canonicalDigest(mismatchedPrompt.evidence) }, digest("source")), refuses("LINEAR_CONTRIBUTION_RESULT_MISMATCH"));
  const emptyRequirements = Object.freeze({ ...prepared, unit: Object.freeze({ ...prepared.unit, modelCapabilities: [] }) });
  const ordinaryNoQualification = persisted();
  (ordinaryNoQualification.evidence as { qualificationSnapshot: { routes: unknown[] } }).qualificationSnapshot.routes = [];
  assert.doesNotThrow(() => contributionFromGraphExecution(emptyRequirements, {
    evidence: ordinaryNoQualification.evidence,
    evidenceDigest: canonicalDigest(ordinaryNoQualification.evidence),
  }, digest("source")));
  assert.throws(() => contributionFromGraphExecution(Object.freeze({ ...prepared, unit: Object.freeze({ ...prepared.unit, basisDigest: digest("wrong") }) }), persisted(), digest("source")), refuses("LINEAR_CONTRIBUTION_BINDING_MISMATCH"));
});
