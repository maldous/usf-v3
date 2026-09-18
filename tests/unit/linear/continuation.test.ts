import assert from "node:assert/strict";
import test from "node:test";

const expectedProbeQualifyAcceptanceDigest = `sha256:${"b".repeat(64)}`;

const probeQualifyPrefix = `import { topic } from "./registry.ts";

const envFileOption = { syntax: "--env-file PATH", description: "Read one owner-private credential file." } as const;

`;
const probeQualifySuffix = `

export function parseHelpArguments(args: readonly string[]) {
  const json = args.includes("--json");
  return { json };
}
`;
const probeQualifyBefore = `${probeQualifyPrefix}const probeQualifyTopic = topic(["probe", "qualify"], {
  purpose: "Qualify one exact authorized route by observed invocation.",
  synopsis: ["usf probe qualify [options]"],
  options: [{ syntax: "--route ID | --model ID", description: "Select the exact authorized route to qualify." }, envFileOption],
  outputSchema: "urn:usf:qualification-run-result:1",
  exitCodes: Object.freeze([0, 1, 2, 3, 4, 5, 6]),
  externalContact: "explicit",
  historyScan: "bounded",
  authorityEffect: "Contacts one exact authorized route and writes an ignored qualification record. It creates no economic, routing, Git or semantic authority.",
  availability: "implemented"
});${probeQualifySuffix}`;
const probeQualifyAfter = `${probeQualifyPrefix}const probeQualifyTopic = topic(["probe", "qualify"], {
  purpose: "Qualify one exact authorized provider and model for one task class from observed invocation evidence.",
  synopsis: ["usf probe qualify --provider ID --model ID --task-class NAME --env-file PATH", "usf probe qualify --provider ID --model ID --task-class NAME --env-file PATH --max-output-tokens N"],
  options: [{ syntax: "--provider ID", description: "Select the exact authorized provider." }, { syntax: "--model ID", description: "Select the exact authorized model." }, { syntax: "--task-class NAME", description: "Select the exact qualification task class." }, envFileOption, { syntax: "--max-output-tokens N", description: "Bound provider output for this qualification run." }],
  outputSchema: "urn:usf:qualification-run-result:1",
  exitCodes: Object.freeze([0, 1, 2, 3, 4, 5, 6]),
  externalContact: "explicit",
  historyScan: "bounded",
  authorityEffect: "Contacts one exact authorized route and writes an ignored qualification record. It creates no economic, routing, Git or semantic authority.",
  availability: "implemented"
});${probeQualifySuffix}`;

function replaceExactly(source: string, from: string, to: string): string {
  const first = source.indexOf(from);
  assert.notEqual(first, -1, `missing source fragment: ${from}`);
  assert.equal(source.indexOf(from, first + from.length), -1, `repeated source fragment: ${from}`);
  return `${source.slice(0, first)}${to}${source.slice(first + from.length)}`;
}

function classifierInput(before: string, after: string) {
  const encoder = new TextEncoder();
  return {
    path: "src/commands/help.ts" as const,
    beforeBytes: encoder.encode(before),
    afterBytes: encoder.encode(after),
    beforeMode: "100644",
    afterMode: "100644",
    expectedAcceptanceDigest: expectedProbeQualifyAcceptanceDigest,
  };
}

test("probe qualify metadata classifier binds a literal-only provider qualification help repair", async () => {
  const { classifyProbeQualifyMetadataDeltaForTest } = await import("../../../src/commands/linear-continuation.ts");
  assert.ok(probeQualifyBefore.startsWith(probeQualifyPrefix));
  assert.ok(probeQualifyAfter.startsWith(probeQualifyPrefix));
  assert.ok(probeQualifyBefore.endsWith(probeQualifySuffix));
  assert.ok(probeQualifyAfter.endsWith(probeQualifySuffix));

  const classification = classifyProbeQualifyMetadataDeltaForTest(
    classifierInput(probeQualifyBefore, probeQualifyAfter),
  );
  assert.equal(classification.schema, "urn:usf:probe-qualify-help-metadata-delta:1");
  assert.match(classification.beforeImageDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(classification.afterImageDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(classification.beforeImageDigest, classification.afterImageDigest);
  assert.equal(classification.postimageDigest, classification.afterImageDigest);
  assert.match(classification.deltaDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(classification.immutableRegionDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(classification.mutableFieldSetDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(classification.acceptanceDigest, expectedProbeQualifyAcceptanceDigest);
});

test("probe qualify metadata classifier refuses nonliteral, ambiguous, protected, or out-of-topic changes", async () => {
  const { classifyProbeQualifyMetadataDeltaForTest } = await import("../../../src/commands/linear-continuation.ts");
  const purpose = 'purpose: "Qualify one exact authorized route by observed invocation."';
  const base = classifierInput(probeQualifyBefore, probeQualifyAfter);
  const cases = [
    ["wrong path", { ...base, path: "src/commands/query.ts" as typeof base.path }],
    ["mode change", { ...base, afterMode: "100755" }],
    ["code expression", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      purpose,
      'purpose: "Qualify one exact route " + "by observed invocation."',
    ))],
    ["call", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      purpose,
      'purpose: String("Qualify one exact authorized route.")',
    ))],
    ["getter", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      purpose,
      'get purpose() { return "Qualify one exact authorized route."; }',
    ))],
    ["duplicate key", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      purpose,
      `${purpose}, purpose: "Duplicate metadata"`,
    ))],
    ["environment reference removed", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      'options: [{ syntax: "--route ID | --model ID", description: "Select the exact authorized route to qualify." }, envFileOption]',
      'options: [{ syntax: "--route ID | --model ID", description: "Select the exact authorized route to qualify." }, { syntax: "--env-file PATH", description: "Inline replacement is not the authenticated reference." }]',
    ))],
    ["control field", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      'outputSchema: "urn:usf:qualification-run-result:1"',
      'outputSchema: "urn:usf:qualification-run-result:2"',
    ))],
    ["authority effect", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      'authorityEffect: "Contacts one exact authorized route and writes an ignored qualification record. It creates no economic, routing, Git or semantic authority."',
      'authorityEffect: "Contacts every configured route and grants routing authority."',
    ))],
    ["parser", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      '  const json = args.includes("--json");',
      '  const json = args.some((argument) => argument === "--json");',
    ))],
    ["outside topic", classifierInput(probeQualifyBefore, replaceExactly(
      probeQualifyBefore,
      'const envFileOption = { syntax: "--env-file PATH", description: "Read one owner-private credential file." } as const;',
      'const envFileOption = { syntax: "--env-file PATH", description: "Changed outside the selected topic." } as const;',
    ))],
    ["newline outside topic", classifierInput(probeQualifyBefore, `\n${probeQualifyBefore}`)],
  ] as const;

  for (const [name, input] of cases) {
    assert.throws(
      () => classifyProbeQualifyMetadataDeltaForTest(input),
      (error: unknown) => {
        assert.ok(error instanceof Error, `${name} must throw a refusal`);
        assert.match(error.message, /^LINEAR_CONTINUATION_[A-Z_]+$/u, `${name} refusal must be stable`);
        return true;
      },
      name,
    );
  }
});

test("continuation publication boundary is deterministic and fail-closed without a recovery environment", async () => {
  const { classifyContinuationPublication } = await import("../../../src/commands/linear-continuation.ts");
  const before = "sha256:" + "1".repeat(64), after = "sha256:" + "2".repeat(64);
  const receiptDigest = "sha256:" + "3".repeat(64), foreign = "sha256:" + "4".repeat(64);
  const effect = {
    kind: "construction" as const, workIris: ["urn:test:work"],
    sourcePath: "graph/test-grants.nq", beforeDigest: before, afterDigest: after,
    receiptPath: "evidence/construction-authority/" + "5".repeat(64) + ".json",
    receiptFileDigest: receiptDigest, receiptDigest: foreign,
  };
  const expected = { path: effect.sourcePath, digest: before, mode: 0o644 };
  const absentReceipt = { path: effect.receiptPath, digest: null, mode: null };
  const exactReceipt = { ...absentReceipt, digest: receiptDigest, mode: 0o644 };
  const postimage = { ...expected, digest: after };
  assert.equal(classifyContinuationPublication(expected, effect, expected, absentReceipt), "unapplied");
  assert.equal(classifyContinuationPublication(expected, effect, postimage, absentReceipt), "receipt-pending");
  assert.equal(classifyContinuationPublication(expected, effect, postimage, exactReceipt), "applied");
  const cases = [
    [expected, exactReceipt],
    [{ ...postimage, digest: foreign }, exactReceipt],
    [{ ...postimage, mode: 0o755 }, exactReceipt],
    [{ ...postimage, path: "graph/other.nq" }, exactReceipt],
    [postimage, { ...exactReceipt, digest: foreign }],
    [postimage, { ...exactReceipt, mode: 0o600 }],
    [postimage, { ...exactReceipt, path: "evidence/other.json" }],
    [postimage, { ...absentReceipt, mode: 0o644 }],
  ] as const;
  for (const [source, receipt] of cases) assert.throws(
    () => classifyContinuationPublication(expected, effect, source, receipt),
    /LINEAR_CONTINUATION_PUBLICATION_CONFLICT/u,
  );
  assert.throws(() => classifyContinuationPublication(expected, { ...effect, beforeDigest: foreign }, postimage, exactReceipt), /PUBLICATION_CONFLICT/u);
  assert.throws(() => classifyContinuationPublication(expected, { ...effect, afterDigest: before }, postimage, exactReceipt), /PUBLICATION_CONFLICT/u);
});


test("operational continuation artifacts do not widen contribution scope", async () => {
  const { isContinuationInputPath } = await import("../../../src/commands/linear-continuation.ts");
  const { parseRepositoryPath } = await import("../../../src/core/scope.ts");
  const hex = "a".repeat(64);
  const artifacts = [
    ".usf/work/" + hex + ".nq",
    ".usf/work/linear/" + hex + "/" + hex + ".json",
    ".usf/receipts/check/" + hex + "/" + hex + ".json",
    ".usf/receipts/integration/" + hex + ".json",
    ".usf/receipts/integration/intents/" + hex + ".json",
    ".usf/candidates/construction-authority/" + hex + ".proof.json",
    ".usf/candidates/work-completion/" + hex + ".proof.json",
  ];
  for (const path of artifacts) {
    assert.equal(parseRepositoryPath(path, "file"), null, "operational artifacts must remain outside contribution scope");
    assert.equal(isContinuationInputPath(path), true, path);
  }
  for (const path of ["src/commands/help.ts", "graph/test-grants.nq"]) {
    assert.equal(isContinuationInputPath(path), true);
  }
  const forbidden: unknown[] = [
    ".usf/credentials/linear.env", ".usf/credentials/private.json",
    ".usf/linear/attempt.json", ".usf/retained-integration/" + hex + ".json",
    ".usf/work/../credentials/private.json", ".usf/work/./attempt.json",
    ".usf/work//attempt.json", ".usf/work/.hidden/attempt.json",
    ".usf/work/attempt.ts", ".usf/work/attempt.json/child",
    ".usf/work/attempt.json\u0000", ".usf\\work\\attempt.json",
    "/tmp/.usf/work/attempt.json", 1, null, undefined,
    ".usf/work/" + "a".repeat(4096) + ".json",
  ];
  for (const path of forbidden) assert.equal(isContinuationInputPath(path), false, String(path));
});


async function publisherBoundaryFunctions(
  file: "construction-authority" | "work-completion" | "linear-continuation" | "linear-state",
  names: readonly string[],
  bindings: Record<string, unknown>,
): Promise<Record<string, (...args: unknown[]) => Promise<unknown>>> {
  const { readFile } = await import("node:fs/promises");
  const { stripTypeScriptTypes } = await import("node:module");
  const { runInNewContext } = await import("node:vm");
  const source = await readFile(new URL("../../../src/commands/" + file + ".ts", import.meta.url), "utf8");
  const functions = names.map((name) => {
    const matches = [...source.matchAll(new RegExp("^(?:async )?function " + name + "(?:<[^\\n]+>)?\\([\\s\\S]*?^\\}", "gm"))];
    assert.equal(matches.length, 1, "exactly one production function must be evaluated: " + name);
    return matches[0]![0];
  });
  const executable = stripTypeScriptTypes(functions.join("\n\n") + "\n({" + names.join(",") + "});");
  return runInNewContext(executable, { Buffer, ...bindings }) as Record<string, (...args: unknown[]) => Promise<unknown>>;
}

test("continuation authenticates cohort workspace identity without accepting scalar or cross-basis receipts", async () => {
  const { canonicalDigest, canonicalJson, sha256 } = await import("../../../src/core/canonical.ts");
  const individual = canonicalDigest({ member: "workspace" });
  const intent = { candidateDigest: canonicalDigest({ candidate: 1 }), repositoryCommit: "a".repeat(40), workspaceIdentityDigest: individual,
    basisDigest: "basis", classification: { beforeImageDigest: "before", afterImageDigest: "after" }, checkReceiptPaths: ["check.json"] };
  const check = { candidate: intent.candidateDigest };
  const success = { schema: "urn:usf:integration-observation:2", outcome: "urn:usf:outcome:integration-success",
    observationDigest: canonicalDigest({ observation: 1 }), startingCarrierCommit: intent.repositoryCommit,
    observedCarrierCommit: "b".repeat(40), workspaceIdentityDigest: canonicalDigest([individual]),
    originalConstructionBases: [{ basisDigest: "basis", work: { id: "work" } }],
    authoritativeGitDiff: [{ path: "help", beforeDigest: "before", afterDigest: "after" }], checkedCandidateReceipts: [check] };
  const observationPath = ".usf/receipts/integration/" + "c".repeat(64) + ".json";
  const state = { observation: structuredClone(success), recovery: "primary-advanced" };
  const functions = await publisherBoundaryFunctions("linear-continuation", ["authenticatedIntegration"], {
    canonicalDigest, canonicalJson, selectedWork: "work", changedPath: "help",
    refuse: (reasonCode: string) => { throw Object.assign(new Error(reasonCode), { reasonCode }); },
    same: (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b),
    inspectCandidateIntegrationRecovery: async () => ({ state: state.recovery, observation: state.observation, prepared: { intentPath: "intent.json" } }),
    readFileFact: (_root: string, path: string) => {
      const value = path === "check.json" ? check : path === "intent.json" ? { observationPath } : state.observation;
      const bytes = Buffer.from(canonicalJson(value) + "\n");
      return { bytes, fact: { path, digest: sha256(bytes), mode: 0o600 } };
    },
  });
  const authenticate = () => functions.authenticatedIntegration!("/fixture", intent);
  assert.equal((await authenticate() as { observationDigest: string }).observationDigest, success.observationDigest);
  for (const mutate of [
    () => { state.observation.workspaceIdentityDigest = individual; },
    () => { state.observation.workspaceIdentityDigest = canonicalDigest([individual, individual]); },
    () => { state.observation.originalConstructionBases[0]!.basisDigest = "other"; },
    () => { state.recovery = "prepared-commit"; },
  ]) {
    state.observation = structuredClone(success); state.recovery = "primary-advanced"; mutate();
    await assert.rejects(authenticate(), { reasonCode: "LINEAR_CONTINUATION_INTEGRATION_UNAUTHENTICATED" });
  }
});

test("repair handoff admits exactly one named untouched predecessor and exact reversible append", async () => {
  const { canonicalDigest, canonicalJson, sha256 } = await import("../../../src/core/canonical.ts");
  const functions = await publisherBoundaryFunctions("linear-continuation", ["assertRepairBoundary", "reverseRepairAppendBytes", "reverseRepairAppend"], {
    canonicalDigest, sha256, same: (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b),
    refuse: (reasonCode: string) => { throw Object.assign(new Error(reasonCode), { reasonCode }); },
  });
  const intent = { beforeFiles: [] }, intentDigest = canonicalDigest(intent);
  const state = { intentDigest, nextStep: 0, integration: null, pending: null, terminal: false, completedEffects: [] };
  functions.assertRepairBoundary!(intent, state, intentDigest, canonicalDigest(state));
  for (const change of [{ nextStep: 1 }, { integration: {} }, { pending: {} }, { terminal: true }, { completedEffects: [{}] }]) {
    const changed = { ...state, ...change };
    assert.throws(() => functions.assertRepairBoundary!(intent, changed, intentDigest, canonicalDigest(changed)), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_BOUNDARY_INVALID" });
  }
  const handed = { ...intent, repairHandoff: {} };
  assert.throws(() => functions.assertRepairBoundary!(handed, state, canonicalDigest(handed), canonicalDigest(state)), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_BOUNDARY_INVALID" });
  assert.throws(() => functions.assertRepairBoundary!(intent, state, intentDigest, canonicalDigest({ other: 1 })), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_BOUNDARY_INVALID" });
  const before = "original\n", rows = ["typed-row-a", "typed-row-b"];
  functions.reverseRepairAppend!(Buffer.from(before + rows.join("\n") + "\n"), rows, sha256(before));
  functions.reverseRepairAppend!(Buffer.from("original-a\ntyped-row-a\noriginal-b\ntyped-row-b\n"), rows, sha256("original-a\noriginal-b\n"));
  for (const bytes of ["changed\ntyped-row-a\ntyped-row-b\n", before + "unrelated\n" + rows.join("\n") + "\n", before + rows.join("\n"), before + "typed-row-a\ntyped-row-a\n"]) {
    assert.throws(() => functions.reverseRepairAppend!(Buffer.from(bytes), rows, sha256(before)), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_DELTA_INVALID" });
  }
});

test("repair preimages preserve captured modes and authenticate uncaptured Git content without claiming historic group bits", async () => {
  const { canonicalJson, sha256 } = await import("../../../src/core/canonical.ts");
  const bytes = Buffer.from("old fixture\n"), expected = { path: "tests/existing.test.ts", digest: sha256(bytes), mode: 0o664 };
  let reads = 0;
  const functions = await publisherBoundaryFunctions("linear-continuation", ["authenticateRepairPreimage"], {
    sha256, same: (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b),
    refuse: (reasonCode: string) => { throw Object.assign(new Error(reasonCode), { reasonCode }); },
    gitText: () => { reads++; return "100644 blob " + "a".repeat(40) + "\t" + expected.path + "\0"; },
    execFileSync: () => bytes,
  });
  const captured = { beforeFiles: [expected], repositoryDirtyFiles: [], repositoryCommit: "b".repeat(40) };
  functions.authenticateRepairPreimage!("/fixture", captured, expected);
  assert.equal(reads, 0);
  assert.throws(() => functions.authenticateRepairPreimage!("/fixture", captured, { ...expected, mode: 0o644 }), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_PREIMAGE_INVALID" });
  const uncaptured = { ...captured, beforeFiles: [] };
  functions.authenticateRepairPreimage!("/fixture", uncaptured, expected);
  assert.equal(reads, 1);
  assert.throws(() => functions.authenticateRepairPreimage!("/fixture", uncaptured, { ...expected, digest: sha256("wrong") }), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_PREIMAGE_INVALID" });
  assert.throws(() => functions.authenticateRepairPreimage!("/fixture", uncaptured, { ...expected, mode: 0o755 }), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_PREIMAGE_INVALID" });
});

test("repair handoff persists explicit lineage under issue and mutation exclusion, with post-await CAS and authority checks", async (t) => {
  const { canonicalDigest, canonicalJson } = await import("../../../src/core/canonical.ts");
  const { isContinuationInputPath } = await import("../../../src/commands/linear-continuation.ts");
  async function fixture(fault: "none" | "pointer" | "authority" | "unknown" | "sent" | "prepared" | "confirmed" | "refused"
    | "current-source" | "current-mode" | "current-authority" | "current-receipt" = "none",
    scope: "selected" | "different" | "different-workspace" | "predecessor" | "successor" | "missing" | "ambiguous" = "selected",
    currentOnly = false) {
    const blobs = new Map<string, unknown>();
    const selectedBinding = { bindingIri: "binding", locator: "workspace-a:issue", workIri: "work" };
    const remoteBindingIri = scope === "selected" ? "binding" : "historical-binding:" + scope;
    const remoteIntents = ["unknown", "sent", "prepared", "confirmed", "refused"].includes(fault)
      ? [{ state: fault, identity: { bindingIri: remoteBindingIri, operation: "create-comment",
        remoteOperationId: "11111111-1111-4111-8111-111111111111" } }] : [];
    const remoteBefore = canonicalJson(remoteIntents);
    const original = { schema: "urn:usf:linear-construction-continuation-intent:1", bindingIri: "binding",
      bindingManifest: "manifest", bindingDigest: canonicalDigest(selectedBinding), candidateDigest: "candidate",
      beforeFiles: [], repositoryDirtyFiles: [], controllerBasisDigest: "old" };
    const originalDigest = canonicalDigest(original);
    const state = { intentDigest: originalDigest, integration: null, nextStep: 0, completedEffects: [], pending: null, terminal: false };
    const stateDigest = canonicalDigest(state);
    blobs.set(originalDigest, original); blobs.set(stateDigest, state);
    const admission = { predecessorIntentDigest: originalDigest, predecessorStateDigest: stateDigest, digest: canonicalDigest({ policy: 1 }) };
    const oldPointer = { schema: "urn:usf:linear-continuation-pointer:1", intentDigest: originalDigest, stateDigest };
    let pointer: unknown = oldPointer, writes = 0, blobWrites = 0, releases = 0, inspections = 0, locked = false, issueOwned = false;
    const publicationReceipts: unknown[] = [];
    const currentInput: CurrentAuthorityUnitInput = {
      disposition: "current-authority-only", historicalEquivalence: "not-claimed",
      source: { path: "graph/linear-work-binding-grants.nq", digest: canonicalDigest({ source: 1 }), mode: 0o600 },
      publicationReceipt: { path: "evidence/construction-authority/" + "d".repeat(64) + ".json",
        digest: canonicalDigest({ receipt: 1 }), mode: 0o644 },
      publicationIntentDigest: canonicalDigest({ publication: 1 }), publicationReceiptDigest: canonicalDigest({ receiptBody: 1 }),
      authorityBasisDigest: canonicalDigest({ authority: 1 }), selectedDependencyIndependenceDigest: canonicalDigest({ independence: 1 }),
    };
    const snapshot = { beforeFiles: currentOnly ? [currentInput.source, currentInput.publicationReceipt] : [],
      repositoryDirtyFiles: [], controllerBasisDigest: "new", publicationReceipts,
      currentAuthorityInputs: currentOnly ? [currentInput] : [] };
    const bindings = {
      canonicalDigest, same: (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b),
      digest: (value: unknown) => { assert.match(String(value), /^sha256:[a-f0-9]{64}$/u); return value; },
      maximumFiles: 1024, pointerKey: "pointer", isContinuationInputPath,
      currentAuthorityPublicationSource: "graph/linear-work-binding-grants.nq", digestPattern: /^sha256:[a-f0-9]{64}$/u,
      refuse: (reasonCode: string) => { throw Object.assign(new Error(reasonCode), { reasonCode }); },
      loadSemanticGraph: () => ({}), deriveLinearBindingDeclaration: (_graph: unknown, bindingIri: string) => {
        if (bindingIri === "binding") return selectedBinding;
        assert.equal(bindingIri, remoteBindingIri);
        if (scope === "missing" || scope === "ambiguous") throw new Error("FIXTURE_BINDING_" + scope.toUpperCase());
        return { bindingIri, workIri: "work", locator: scope === "different" ? "workspace-a:another-issue"
          : scope === "different-workspace" ? "workspace-b:issue" : selectedBinding.locator };
      },
      withCandidateLock: async (_root: string, key: string, operation: () => Promise<unknown>) => {
        assert.equal(key, canonicalDigest({ purpose: "linear-binding-issue-execution", locator: selectedBinding.locator }));
        issueOwned = true; try { return await operation(); } finally { issueOwned = false; }
      },
      acquirePrimaryMutationLock: async () => {
        assert.equal(issueOwned, true); locked = true;
        return { handle: { close: async () => { releases++; locked = false; } } };
      },
      LinearStateStore: { open: async () => ({ intents: () => remoteIntents }) },
      authenticatedIntegration: async () => { inspections++; return { observationDigest: "observation", commit: "commit", files: [] }; },
      repairSnapshot: () => {
        const value = structuredClone(snapshot);
        if (blobWrites > 0) {
          if (fault === "authority") value.controllerBasisDigest = "changed";
          const input = value.currentAuthorityInputs[0];
          if (input && fault === "current-source") input.source.digest = canonicalDigest({ changedSource: 1 });
          if (input && fault === "current-mode") input.source.mode = 0o640;
          if (input && fault === "current-authority") input.authorityBasisDigest = canonicalDigest({ changedAuthority: 1 });
          if (input && fault === "current-receipt") input.publicationReceipt.digest = canonicalDigest({ changedReceipt: 1 });
        }
        return value;
      },
      authenticateRetained: () => { assert.equal(locked, true); },
      readLinearRecord: async () => pointer,
      writeLinearRecord: async (_root: string, _key: string, next: unknown) => {
        assert.equal(locked, true); assert.equal(issueOwned, true); writes++; pointer = next;
      },
      readBlob: async (_root: string, key: string) => blobs.get(key),
      writeBlob: async (_root: string, value: unknown) => {
        assert.equal(locked, true); const key = canonicalDigest(value); blobs.set(key, value); blobWrites++;
        if (fault === "pointer") pointer = { ...oldPointer, stateDigest: canonicalDigest({ other: 1 }) };
        await Promise.resolve(); return key;
      },
    };
    const functions = await publisherBoundaryFunctions("linear-continuation",
      ["admitRepairHandoff", "assertRepairBoundary", "assertCurrentAuthorityInputLineage", "retained"], bindings);
    return { original, state, admission, blobs, oldPointer, functions, remoteIntents, remoteBefore, currentInput,
      run: () => functions.admitRepairHandoff!("/fixture", original, state, admission),
      read: () => functions.retained!("/fixture"),
      stats: () => ({ pointer, writes, blobWrites, releases, inspections, locked, issueOwned }) };
  }
  await t.test("admission preserves predecessors and authenticates durable successor readback", async () => {
    const f = await fixture();
    const next = await f.run();
    assert.deepEqual(await f.read(), next);
    assert.equal(f.stats().writes, 1);
    assert.equal(f.stats().releases, 1);
    assert.equal(f.stats().locked, false);
    assert.equal(f.stats().issueOwned, false);
    assert.equal(f.blobs.get(canonicalDigest(f.original)), f.original);
    assert.equal(f.blobs.get(canonicalDigest(f.state)), f.state);
    await assert.rejects(f.run(), { reasonCode: "LINEAR_CONTINUATION_POINTER_CONFLICT" });
    assert.equal(f.stats().writes, 1, "the same predecessor cannot be handed off twice");
  });
  await t.test("current-authority-only identity persists in both successor and receipt without historical equivalence or replay", async () => {
    const f = await fixture("none", "selected", true);
    const originalBytes = canonicalJson([f.original, f.state]);
    const result = await f.run() as { intent: { repairHandoff: { currentAuthorityInputs: unknown[] } } };
    assert.equal(canonicalJson(result.intent.repairHandoff.currentAuthorityInputs), canonicalJson([f.currentInput]));
    const pointer = f.stats().pointer as { handoffReceiptDigest: string };
    const receipt = f.blobs.get(pointer.handoffReceiptDigest) as { currentAuthorityInputs: unknown[] };
    assert.equal(canonicalJson(receipt.currentAuthorityInputs), canonicalJson([f.currentInput]));
    assert.deepEqual(await f.read(), result);
    assert.equal(canonicalJson([f.original, f.state]), originalBytes);
    assert.equal(f.stats().inspections, 1);
    assert.equal(f.stats().blobWrites, 3);
    assert.equal(f.stats().writes, 1);
    await assert.rejects(f.run(), { reasonCode: "LINEAR_CONTINUATION_POINTER_CONFLICT" });
    assert.equal(f.stats().inspections, 1, "authenticate once; never replay the existing integration");
    assert.equal(f.stats().blobWrites, 3);
    receipt.currentAuthorityInputs = [{ ...f.currentInput, historicalEquivalence: "claimed" }];
    await assert.rejects(f.read(), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_LINEAGE_INVALID" });
  });
  for (const fault of ["current-source", "current-mode", "current-authority", "current-receipt"] as const) {
    await t.test("post-await " + fault + " drift cannot replace the legacy pointer", async () => {
      const f = await fixture(fault, "selected", true);
      await assert.rejects(f.run(), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED" });
      assert.equal(f.stats().pointer, f.oldPointer);
      assert.equal(f.stats().writes, 0);
      assert.equal(f.stats().inspections, 1);
      assert.equal(f.stats().releases, 1);
      assert.equal(f.stats().locked, false);
      assert.equal(f.blobs.get(canonicalDigest(f.original)), f.original);
    });
  }
  for (const fault of ["pointer", "authority", "unknown", "sent", "prepared"] as const) {
    await t.test("refuses " + fault + " before pointer replacement", async () => {
      const f = await fixture(fault);
      await assert.rejects(f.run(), { reasonCode: fault === "pointer" ? "LINEAR_CONTINUATION_POINTER_CONFLICT"
        : fault === "authority" ? "LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED" : "LINEAR_CONTINUATION_HANDOFF_REMOTE_INTENT_PENDING" });
      assert.equal(f.stats().writes, 0);
      assert.equal(f.stats().releases, 1);
      assert.equal(f.stats().locked, false);
    });
  }
  for (const state of ["prepared", "sent", "unknown"] as const) {
    for (const scope of ["different", "different-workspace"] as const) {
      await t.test("preserves unrelated historical " + state + " for " + scope + " without blocking handoff", async () => {
        const f = await fixture(state, scope);
        const next = await f.run();
        assert.deepEqual(await f.read(), next);
        assert.equal(canonicalJson(f.remoteIntents), f.remoteBefore, "historical intent must not be sent, reconciled, reset or discarded");
        assert.equal(f.stats().inspections, 1, "only authenticate the existing integration");
        assert.equal(f.stats().blobWrites, 3, "only successor intent, initial state and handoff receipt are created");
        assert.equal(f.stats().writes, 1, "only the operational pointer is replaced");
        await assert.rejects(f.run(), { reasonCode: "LINEAR_CONTINUATION_POINTER_CONFLICT" });
        assert.equal(f.stats().inspections, 1, "a repeated admission cannot replay the integration path");
        assert.equal(f.stats().writes, 1);
      });
    }
    for (const scope of ["predecessor", "successor", "missing", "ambiguous"] as const) {
      await t.test("refuses " + state + " under " + scope + " binding before any handoff effect", async () => {
        const f = await fixture(state, scope);
        await assert.rejects(f.run(), { reasonCode: scope === "missing" || scope === "ambiguous"
          ? "LINEAR_CONTINUATION_HANDOFF_REMOTE_INTENT_TARGET_UNRESOLVED" : "LINEAR_CONTINUATION_HANDOFF_REMOTE_INTENT_PENDING" });
        assert.equal(canonicalJson(f.remoteIntents), f.remoteBefore);
        assert.equal(f.stats().inspections, 0);
        assert.equal(f.stats().blobWrites, 0);
        assert.equal(f.stats().writes, 0);
        assert.equal(f.stats().releases, 1);
      });
    }
  }
  for (const state of ["confirmed", "refused"] as const) {
    await t.test("terminal " + state + " history needs no target reclassification", async () => {
      const f = await fixture(state, "missing");
      await f.run();
      assert.equal(f.stats().writes, 1);
      assert.equal(canonicalJson(f.remoteIntents), f.remoteBefore);
    });
  }
});



type ContinuationBlobUnitRecord = {
  schema?: string; digest: string; offset: number; count: number; chunks: string[];
};

async function continuationBlobUnitBoundary() {
  const { canonicalDigest, canonicalJson } = await import("../../../src/core/canonical.ts");
  const records = new Map<string, unknown>(), writes: string[] = [], reads: string[] = [];
  let locked = false;
  const prefix = (version: 1 | 2, hash: string) => "continuation-blob-" + (version === 2 ? "v2-" : "") + hash.slice(7) + "-";
  const key = (version: 1 | 2, hash: string, index = 0) => prefix(version, hash) + index;
  const refusal = (reasonCode: string): never => { throw Object.assign(new Error(reasonCode), { reasonCode }); };
  const functions = await publisherBoundaryFunctions("linear-continuation", ["continuationBlobKey", "readContinuationBlobRecords", "decodeContinuationBlob", "continuationBlobRecords", "writeBlob", "readBlob"], {
    canonicalDigest, canonicalJson, digestPattern: /^sha256:[a-f0-9]{64}$/u,
    same: (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b),
    digest: (value: unknown) => {
      if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) refusal("LINEAR_CONTINUATION_DIGEST_INVALID");
      return value;
    },
    refuse: refusal,
    withCandidateLock: async (root: string, recordKey: string, operation: () => Promise<unknown>) => {
      assert.equal(root, "/fixture"); assert.match(recordKey, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(locked, false); locked = true;
      try { return await operation(); } finally { locked = false; }
    },
    readLinearRecord: async (_root: string, recordKey: string) => {
      reads.push(recordKey);
      const value = records.get(recordKey); return value === undefined ? null : structuredClone(value);
    },
    writeLinearRecord: async (_root: string, recordKey: string, value: unknown) => {
      // Keep the real generic-record canonical containment rule at this boundary.
      canonicalJson(value, { rejectAbsolutePaths: true });
      assert.equal(locked, true, "record creation requires the digest-scoped lock");
      assert.equal(records.has(recordKey), false, "an immutable blob record must never be overwritten");
      writes.push(recordKey); records.set(recordKey, structuredClone(value));
      await Promise.resolve();
    },
  });
  function seed(value: unknown, version: 1 | 2) {
    const source = canonicalJson(value), hash = canonicalDigest(value), chunks: string[] = [];
    for (let offset = 0; offset < source.length; offset += 400) {
      const fragment = source.slice(offset, offset + 400);
      chunks.push(version === 2 ? "usf2:" + fragment.length + ":" + fragment : fragment);
    }
    for (let offset = 0; offset < chunks.length; offset += 128) records.set(key(version, hash, offset / 128), {
      ...(version === 2 ? { schema: "urn:usf:linear-continuation-blob:2" } : {}),
      digest: hash, offset, count: chunks.length, chunks: chunks.slice(offset, offset + 128),
    });
    return { source, hash };
  }
  const record = (version: 1 | 2, hash: string, index = 0) => records.get(key(version, hash, index)) as ContinuationBlobUnitRecord;
  return { records, writes, reads, key, seed, record, canonicalDigest, canonicalJson,
    write: (value: unknown) => functions.writeBlob!("/fixture", value) as Promise<string>,
    read: (hash: string) => functions.readBlob!("/fixture", hash),
  };
}

test("continuation blob v2 preserves opaque pathlike fragments and UTF16 boundaries without weakening domain containment", async (t) => {
  const f = await continuationBlobUnitBoundary(), empty = f.canonicalJson({ text: "" });
  const start = empty.indexOf('""') + 1;
  for (const fragment of ["/relative-tail", "~/relative-tail", "C:/relative-tail", "C:\\relative-tail"]) {
    for (const offset of [400, 21_600]) await t.test(JSON.stringify(fragment) + " at " + offset, async () => {
      const b = await continuationBlobUnitBoundary();
      const payload = { text: "x".repeat(offset - start) + fragment + "suffix" };
      const source = b.canonicalJson(payload);
      assert.equal(source.slice(offset, offset + 2), fragment.slice(0, 2));
      const hash = await b.write(payload);
      assert.equal(hash, b.canonicalDigest(payload));
      assert.equal(b.canonicalJson(await b.read(hash)), source);
      const encoded = b.record(2, hash).chunks[offset / 400]!;
      const decodedFragment = source.slice(offset, offset + 400);
      assert.equal(encoded, "usf2:" + decodedFragment.length + ":" + decodedFragment);
      assert.ok(encoded.length <= 409 && encoded.length < 512);
      assert.equal(b.records.has(b.key(1, hash)), false);
      const firstWrites = [...b.writes]; await b.write(payload);
      assert.deepEqual(b.writes, firstWrites, "same immutable v2 records are reused without overwrite");
    });
  }
  for (const offset of [399, 400, 51_199]) await t.test("surrogate pair at UTF16 offset " + offset, async () => {
    const b = await continuationBlobUnitBoundary();
    const payload = { text: "x".repeat(offset - start) + "\ud83d\ude00" + "suffix" };
    const source = b.canonicalJson(payload);
    assert.equal(source.charCodeAt(offset), 0xd83d);
    const hash = await b.write(payload);
    assert.equal(hash, b.canonicalDigest(payload));
    assert.equal(b.canonicalJson(await b.read(hash)), source, "join UTF16 fragments before hashing or decoding the payload");
  });
  for (const path of ["/private/file", "~/private/file", "C:/private/file", "C:\\private\\file"]) {
    await t.test("absolute domain path " + JSON.stringify(path) + " remains forbidden", async () => {
      const b = await continuationBlobUnitBoundary();
      await assert.rejects(b.write({ path }), { code: "ABSOLUTE_PATH_FORBIDDEN" });
      assert.deepEqual(b.writes, []);
    });
  }
});

test("continuation blob codec enforces decoded and framed bounds", async () => {
  const b = await continuationBlobUnitBoundary(), limit = 512 * 1024;
  const overhead = b.canonicalJson({ text: "" }).length;
  const payload = { text: "x".repeat(limit - overhead) };
  const hash = await b.write(payload);
  assert.equal(b.record(2, hash).count, 1311);
  assert.equal(b.writes.length, 11);
  for (let index = 0; index < 11; index++) {
    const record = b.record(2, hash, index);
    assert.equal(record.offset, index * 128);
    assert.equal(record.chunks.length, Math.min(128, 1311 - index * 128));
    for (const chunk of record.chunks) {
      assert.ok(chunk.length <= 409);
      const match = /^usf2:([1-9][0-9]{0,2}):([\s\S]*)$/u.exec(chunk);
      assert.ok(match); assert.equal(Number(match[1]), match[2]!.length);
      assert.ok(match[2]!.length <= 400);
    }
  }
  assert.equal(b.canonicalJson(await b.read(hash)), b.canonicalJson(payload));
  const before = [...b.writes];
  await assert.rejects(b.write({ text: payload.text + "x" }), { reasonCode: "LINEAR_CONTINUATION_RECORD_BOUNDS" });
  assert.deepEqual(b.writes, before);
  const oversized = await continuationBlobUnitBoundary();
  const seeded = oversized.seed({ text: payload.text + "x" }, 2);
  await assert.rejects(oversized.read(seeded.hash), { reasonCode: "LINEAR_CONTINUATION_RECORD_INVALID" });
});

test("continuation blob readers refuse malformed framing, namespace mixtures, truncation and digest tampering", async (t) => {
  type Fixture = Awaited<ReturnType<typeof continuationBlobUnitBoundary>>;
  const cases: [string, (b: Fixture, hash: string) => void][] = [
    ["schema", (b, hash) => { b.record(2, hash).schema = "urn:usf:linear-continuation-blob:3"; }],
    ["missing schema", (b, hash) => { delete b.record(2, hash).schema; }],
    ["extra field", (b, hash) => { Object.assign(b.record(2, hash), { extra: true }); }],
    ["digest", (b, hash) => { b.record(2, hash).digest = b.canonicalDigest({ wrong: 1 }); }],
    ["offset", (b, hash) => { b.record(2, hash).offset = 128; }],
    ["zero count", (b, hash) => { b.record(2, hash).count = 0; }],
    ["fractional count", (b, hash) => { b.record(2, hash).count = 1.5; }],
    ["excess count", (b, hash) => { b.record(2, hash).count = 1312; }],
    ["missing chunk", (b, hash) => { b.record(2, hash).chunks.pop(); }],
    ["missing record", (b, hash) => { b.records.delete(b.key(2, hash, 1)); }],
    ["missing head with orphan", (b, hash) => { b.records.delete(b.key(2, hash)); }],
    ["trailing orphan record", (b, hash) => { b.records.set(b.key(2, hash, 10), structuredClone(b.record(2, hash, 1))); }],
    ["inconsistent later count", (b, hash) => { b.record(2, hash, 1).count++; }],
    ["raw/v2 mixture", (b, hash) => { b.record(2, hash).chunks[1] = "x".repeat(400); }],
    ["wrong frame version", (b, hash) => { b.record(2, hash).chunks[1] = "usf1:400:" + "x".repeat(400); }],
    ["noncanonical frame length", (b, hash) => { b.record(2, hash).chunks[1] = "usf2:0400:" + "x".repeat(400); }],
    ["negative frame length", (b, hash) => { b.record(2, hash).chunks[1] = "usf2:-1:x"; }],
    ["mismatched frame length", (b, hash) => { b.record(2, hash).chunks[1] = "usf2:399:" + "x".repeat(400); }],
    ["decoded fragment too large", (b, hash) => { b.record(2, hash).chunks[1] = "usf2:401:" + "x".repeat(401); }],
    ["same-size payload tamper", (b, hash) => { b.record(2, hash).chunks[1] = "usf2:400:y" + "x".repeat(399); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const b = await continuationBlobUnitBoundary();
    const { hash } = b.seed({ text: "x".repeat(52_000) }, 2);
    mutate(b, hash);
    const before = b.canonicalJson([...b.records]);
    await assert.rejects(b.read(hash), { reasonCode: "LINEAR_CONTINUATION_RECORD_INVALID" });
    assert.equal(b.canonicalJson([...b.records]), before);
    assert.deepEqual(b.writes, []);
  });
  const absolute = await continuationBlobUnitBoundary();
  const { hash } = absolute.seed({ path: "/private/file" }, 2);
  await assert.rejects(absolute.read(hash), { code: "ABSOLUTE_PATH_FORBIDDEN" });
  assert.deepEqual(absolute.writes, []);
});

test("continuation blob namespaces preserve authenticated legacy bytes and resume only exact v2 records", async (t) => {
  const payload = { text: "x".repeat(52_000) };
  await t.test("legacy read and write reuse are immutable", async () => {
    const b = await continuationBlobUnitBoundary(), { hash, source } = b.seed(payload, 1);
    const before = b.canonicalJson([...b.records]);
    assert.equal(b.canonicalJson(await b.read(hash)), source);
    for (const version of [1, 2] as const) for (let index = 0; index < 11; index++) {
      assert.ok(b.reads.includes(b.key(version, hash, index)), "all bounded namespace slots must be inspected");
    }
    assert.equal(await b.write(payload), hash);
    assert.equal(b.canonicalJson([...b.records]), before);
    assert.deepEqual(b.writes, []);
    assert.equal(b.records.has(b.key(2, hash)), false);
  });
  await t.test("both valid namespaces authenticate the same original payload", async () => {
    const b = await continuationBlobUnitBoundary(), { hash, source } = b.seed(payload, 1);
    b.seed(payload, 2);
    const before = b.canonicalJson([...b.records]);
    assert.equal(b.canonicalJson(await b.read(hash)), source);
    assert.equal(await b.write(payload), hash);
    assert.equal(b.canonicalJson([...b.records]), before);
    assert.deepEqual(b.writes, []);
  });
  for (const legacyFault of ["tampered", "truncated"] as const) await t.test("valid v2 never masks " + legacyFault + " legacy", async () => {
    const b = await continuationBlobUnitBoundary(), { hash } = b.seed(payload, 1);
    b.seed(payload, 2);
    if (legacyFault === "tampered") b.record(1, hash).chunks[1] = "y".repeat(400);
    else b.records.delete(b.key(1, hash, 1));
    await assert.rejects(b.read(hash), { reasonCode: "LINEAR_CONTINUATION_RECORD_INVALID" });
    await assert.rejects(b.write(payload), { reasonCode: "LINEAR_CONTINUATION_RECORD_INVALID" });
    assert.deepEqual(b.writes, []);
  });
  await t.test("valid legacy never masks corrupt v2", async () => {
    const b = await continuationBlobUnitBoundary(), { hash } = b.seed(payload, 1);
    b.seed(payload, 2); b.record(2, hash).chunks[1] = "usf2:400:y" + "x".repeat(399);
    await assert.rejects(b.read(hash), { reasonCode: "LINEAR_CONTINUATION_RECORD_INVALID" });
    await assert.rejects(b.write(payload), { reasonCode: "LINEAR_CONTINUATION_RECORD_INVALID" });
    assert.deepEqual(b.writes, []);
  });
  await t.test("partial exact v2 resumes missing records once", async () => {
    const b = await continuationBlobUnitBoundary(), { hash } = b.seed(payload, 2);
    const first = b.canonicalJson(b.record(2, hash));
    b.records.delete(b.key(2, hash, 1));
    await assert.rejects(b.read(hash), { reasonCode: "LINEAR_CONTINUATION_RECORD_INVALID" });
    assert.equal(await b.write(payload), hash);
    assert.equal(b.canonicalJson(b.record(2, hash)), first);
    assert.deepEqual(b.writes, [b.key(2, hash, 1)]);
    assert.equal(b.canonicalJson(await b.read(hash)), b.canonicalJson(payload));
    await b.write(payload);
    assert.deepEqual(b.writes, [b.key(2, hash, 1)]);
  });
  await t.test("partial conflicting v2 refuses without overwriting", async () => {
    const b = await continuationBlobUnitBoundary(), { hash } = b.seed(payload, 2);
    b.records.delete(b.key(2, hash, 1)); b.record(2, hash).chunks[1] = "usf2:400:y" + "x".repeat(399);
    const before = b.canonicalJson([...b.records]);
    await assert.rejects(b.write(payload), { reasonCode: "LINEAR_CONTINUATION_RECORD_CONFLICT" });
    assert.equal(b.canonicalJson([...b.records]), before);
    assert.deepEqual(b.writes, []);
  });
});

test("native generic record writer still rejects unframed absolute strings", async () => {
  const { canonicalJson } = await import("../../../src/core/canonical.ts");
  const { dirname } = await import("node:path");
  let opens = 0;
  const functions = await publisherBoundaryFunctions("linear-state", ["writePrivateJson"], {
    dirname, canonicalJson, securePrivateDirectory: async () => undefined,
    open: async () => { opens++; assert.fail("absolute generic values must refuse before any file write"); },
  });
  for (const value of ["/private/file", "~/private/file", "C:/private/file", "C:\\private\\file"]) {
    await assert.rejects(functions.writePrivateJson!("/fixture", "/fixture/record.json", { chunks: [value] }, "OVERSIZED"),
      { code: "ABSOLUTE_PATH_FORBIDDEN" });
  }
  assert.equal(opens, 0);
});


type CurrentAuthorityUnitFact = { path: string; digest: `sha256:${string}` | null; mode: number | null };
type CurrentAuthorityUnitInput = {
  disposition: string; historicalEquivalence: string;
  source: CurrentAuthorityUnitFact; publicationReceipt: CurrentAuthorityUnitFact;
  publicationIntentDigest: string; publicationReceiptDigest: string;
  authorityBasisDigest: string; selectedDependencyIndependenceDigest: string;
};

// Evaluate the production decision functions with only storage/graph/authority
// boundaries supplied in memory. The genuine integration fixture covers publication.
async function currentAuthorityUnitBoundary() {
  const { canonicalDigest, canonicalJson, sha256 } = await import("../../../src/core/canonical.ts");
  const { parseRepositoryPath } = await import("../../../src/core/scope.ts");
  const { isContinuationInputPath } = await import("../../../src/commands/linear-continuation.ts");
  type Row = { subject: string; predicate: string; object: string; objectKind: "iri" | "literal"; graph: string };
  const sourcePath = "graph/linear-work-binding-grants.nq";
  const policyPath = "graph/linear-issue-bindings.nq";
  const manifestPath = "graph/manifests/linear-work-binding.json";
  const policyManifest = "graph/manifests/linear-issue-bindings.json";
  const outerManifest = "graph/manifests/selected.json";
  const policyIri = "urn:usf:policy:linear-continuation-repair-handoff:1";
  const contract = "urn:usf:contract:hermes-linear-autonomy:1";
  const sourceGraph = "urn:usf:graph:linear-work-binding-grants";
  const grant = "urn:usf:grant:binding-unit:1", seed = "urn:usf:grant:binding-seed:1";
  const selection = { workIri: "urn:usf:work:linear-work-binding", profile: "urn:usf:profile:linear-work-binding:1", manifestPath };
  const predicate = (name: string) => "urn:usf:predicate:" + name;
  const row = (subject: string, name: string, object: string, objectKind: Row["objectKind"] = "literal",
    graph = sourceGraph): Row => ({ subject, predicate: predicate(name), object, objectKind, graph });
  const line = (value: Row) => "<" + value.subject + "> <" + value.predicate + "> "
    + (value.objectKind === "iri" ? "<" + value.object + ">" : JSON.stringify(value.object)) + " <" + value.graph + "> .";
  const publicationIntentDigest = canonicalDigest({ publication: "binding" });
  const receiptPath = "evidence/construction-authority/" + publicationIntentDigest.slice(7) + ".json";
  const seedRow = row(seed, "type", "urn:usf:type:ConstructionGrant", "iri");
  const publicationRow = row(grant, "publicationIntentDigest", publicationIntentDigest);
  const prefix = line(seedRow) + "\n", tail = line(publicationRow) + "\n";
  const files = new Map<string, { bytes: Buffer; mode: number }>();
  const put = (path: string, bytes: string | Buffer, mode = 0o644) => files.set(path, { bytes: Buffer.from(bytes), mode });
  const fact = (path: string): CurrentAuthorityUnitFact => {
    const file = files.get(path);
    return { path, digest: file ? sha256(file.bytes) : null, mode: file?.mode ?? null };
  };
  put(sourcePath, prefix + tail, 0o600);
  const current = {
    id: selection.workIri, contract,
    realisationAuthority: { permission: { id: "urn:usf:permission:linear-work-binding", activationState: "urn:usf:contract-state:active" } },
    eligibility: { construction: { eligible: true, authority: "active-permission" }, activation: { eligible: true },
      authorityBasisDigest: canonicalDigest({ bindingAuthority: 1 }) },
    realisationBasis: { basisDigest: canonicalDigest({ bindingBasis: 1 }), work: { dependencies: [
      { kind: "file", key: "src/binding-dependency.ts" }, { kind: "manifest", key: "graph/manifests/binding-parent.json" },
      { kind: "semantic-resource", key: "urn:usf:resource:not-a-file" },
    ] } },
    readSet: ["src/binding-read.ts"], writeSet: ["src/binding-write.ts"],
  };
  const graph = { sources: [{ path: sourcePath, graph: sourceGraph }],
    manifests: [{ path: manifestPath }], quads: [seedRow, publicationRow] };
  const policyGraph = { sources: [{ path: policyPath, graph: "urn:usf:graph:linear-issue-bindings" }],
    manifests: [{ path: policyManifest }], quads: [] as Row[] };
  const outerGraph = { sources: [{ path: "graph/selected.nq", graph: "urn:usf:graph:selected" }],
    manifests: [{ path: outerManifest }], quads: [] as Row[] };
  const receipt = {
    status: "verified", publicationIntentDigest, publicationReceiptPath: receiptPath, semanticSourcePath: sourcePath,
    profileIri: selection.profile, manifestPath, baseSourceDigest: sha256(prefix), resultingSourceDigest: sha256(prefix + tail),
    members: [{ grantIri: grant, workIri: selection.workIri, authorityBasisDigest: current.eligibility.authorityBasisDigest }],
    operations: [{ kind: "add", sourcePath, line: line(publicationRow) }], receiptDigest: "",
  };
  const refreshReceipt = () => {
    const { receiptDigest: _ignored, ...body } = receipt;
    receipt.receiptDigest = canonicalDigest(body, { rejectAbsolutePaths: true });
    put(receiptPath, canonicalJson(receipt, { rejectAbsolutePaths: true }) + "\n");
  };
  refreshReceipt();
  for (const path of [manifestPath, outerManifest, "graph/selected.nq", "src/selected.ts", "src/extra.ts",
    "src/binding-read.ts", "src/binding-write.ts", "src/binding-dependency.ts", "graph/manifests/binding-parent.json"]) put(path, path + "\n");
  const observationDigest = canonicalDigest({ integration: 1 });
  const observationPath = ".usf/receipts/integration/" + observationDigest.slice(7) + ".json";
  const checkPath = ".usf/receipts/check/" + "a".repeat(64) + "/" + "b".repeat(64) + ".json";
  put(observationPath, canonicalJson({ observationDigest, selected: { dependency: "src/selected.ts" } }) + "\n", 0o600);
  put(checkPath, canonicalJson({ candidate: "selected", inputs: ["src/selected.ts"] }) + "\n", 0o600);
  const intent = {
    bindingManifest: policyManifest, candidateDigest: canonicalDigest({ candidate: 1 }),
    basisDigest: canonicalDigest({ selectedBasis: 1 }), workspaceIdentityDigest: canonicalDigest({ workspace: 1 }),
    beforeFiles: [fact(checkPath)], repositoryDirtyFiles: [] as CurrentAuthorityUnitFact[], checkReceiptPaths: [checkPath],
  };
  const state = { intentDigest: canonicalDigest(intent), nextStep: 0, integration: null, pending: null, terminal: false, completedEffects: [] };
  const integration = { observationDigest, files: [fact(observationPath)] };
  const inputSubject = "urn:usf:repair-input:binding-unit:1";
  const policyFields: [string, string, Row["objectKind"]][] = [
    ["type", "urn:usf:type:ConstructionContinuationRepairAdmission", "iri"], ["version", "1", "literal"],
    ["forContract", contract, "iri"], ["forPolicy", "urn:usf:policy:linear-construction-continuation:1", "iri"],
    ["failureClass", "WORKSPACE_IDENTITY_MEMBER_COHORT_MISMATCH", "literal"],
    ["predecessorIntentDigest", state.intentDigest, "literal"], ["predecessorStateDigest", canonicalDigest(state), "literal"],
    ["integrationObservationDigest", observationDigest, "literal"], ["approvedRepairInput", inputSubject, "iri"],
    ["currentAuthorityOnlyPublicationSource", sourcePath, "literal"],
  ];
  for (const [name, value, kind] of policyFields) policyGraph.quads.push(row(policyIri, name, value, kind, policyGraph.sources[0]!.graph));
  for (const [name, value, kind] of [
    ["type", "urn:usf:type:ConstructionContinuationRepairInput", "iri"],
    ["repositoryPath", policyPath, "literal"], ["preimageDigest", canonicalDigest({ oldPolicy: 1 }), "literal"],
    ["preimageMode", "384", "literal"], ["postimageMode", "384", "literal"],
  ] as const) policyGraph.quads.push(row(inputSubject, name, value, kind, policyGraph.sources[0]!.graph));
  const control = { missingEligibility: false, shapeValid: true, driftOnClosure: false, captureSourceReads: 0 };
  const extracted = await publisherBoundaryFunctions("linear-continuation",
    ["repairAdmission", "assertRepairBoundary", "currentRepairPublication", "authenticateCurrentPublicationSource",
      "reverseRepairAppendBytes", "reverseRepairAppend", "currentAuthorityInput", "bindingPublicationCapture", "protectedFiles", "assertCurrentAuthorityInputLineage"], {
      canonicalDigest, canonicalJson, sha256, parseRepositoryPath, isContinuationInputPath, predicate,
      same: (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b), canonicalQuadLine: line,
      digestPattern: /^sha256:[a-f0-9]{64}$/u,
      digest: (value: unknown) => { assert.match(String(value), /^sha256:[a-f0-9]{64}$/u); return value; },
      refuse: (reasonCode: string) => { throw Object.assign(new Error(reasonCode), { reasonCode }); },
      currentAuthorityPublicationSource: sourcePath, bindingPublicationSelection: selection,
      repairPolicyIri: policyIri, repairPolicySource: policyPath, controllerContract: contract,
      controllerWork: "urn:usf:work:hermes-linear-autonomy", policyIri: "urn:usf:policy:linear-construction-continuation:1",
      changedPath: "src/commands/help.ts", acceptancePath: "tests/fixtures/cli-provider-qualification-help.acceptance.ts", maximumFiles: 1024,
      loadSemanticGraph: (_root: string, manifest: string) => manifest === policyManifest ? policyGraph : manifest === manifestPath ? graph : outerGraph,
      packet: () => control.missingEligibility ? { ...current, eligibility: undefined } : current,
      deriveConstructionAuthority: () => ({ sourcePath }), constructionGrantIri: () => grant,
      constructionReceiptPath: () => receiptPath, validateConstructionReceiptShape: () => control.shapeValid,
      objectValues: (value: { quads: Row[] }, subject: string, name: string) =>
        value.quads.filter(entry => entry.subject === subject && entry.predicate === name).map(entry => entry.object),
      readFileFact: (_root: string, path: string) => {
        if (path === sourcePath && control.driftOnClosure && ++control.captureSourceReads === 2) files.get(path)!.mode = 0o640;
        return { bytes: files.get(path)?.bytes ?? null, fact: fact(path) };
      },
    });
  const functions = extracted as unknown as Record<string, (...args: unknown[]) => unknown>;
  type Admission = { predecessorIntentDigest: string; predecessorStateDigest: string; currentAuthorityOnlyPublicationSource?: string };
  const admission = () => functions.repairAdmission!("/fixture", intent) as Admission;
  const publication = () => functions.currentRepairPublication!("/fixture", selection);
  const input = () => functions.currentAuthorityInput!("/fixture", intent, admission(), integration, publication()) as CurrentAuthorityUnitInput;
  const capture = () => functions.bindingPublicationCapture!("/fixture", [{ manifestPath: outerManifest,
    packet: { readSet: ["src/selected.ts"], writeSet: [], realisationBasis: { work: { dependencies: [] } } } }], ["src/extra.ts"]) as {
      files: CurrentAuthorityUnitFact[]; source: CurrentAuthorityUnitFact; receipt: CurrentAuthorityUnitFact;
    };
  return { functions, files, put, fact, current, graph, policyGraph, policyIri, predicate, sourcePath, receiptPath, manifestPath,
    outerManifest, sourceGraph, seed, grant, prefix, tail, receipt, refreshReceipt, intent, state, integration, observationPath,
    checkPath, control, admission, publication, input, capture, canonicalDigest, canonicalJson };
}

test("future continuation capture includes the complete active binding publication closure", async (t) => {
  const f = await currentAuthorityUnitBoundary(), captured = f.capture();
  for (const path of [f.manifestPath, f.outerManifest, "graph/manifests/binding-parent.json", "graph/selected.nq",
    "src/selected.ts", "src/extra.ts", "src/binding-read.ts", "src/binding-write.ts", "src/binding-dependency.ts",
    f.sourcePath, f.receiptPath]) {
    assert.equal(f.canonicalJson(captured.files.find(file => file.path === path)), f.canonicalJson(f.fact(path)), path);
  }
  assert.equal(f.canonicalJson(captured.source), f.canonicalJson(f.fact(f.sourcePath)));
  assert.equal(f.canonicalJson(captured.receipt), f.canonicalJson(f.fact(f.receiptPath)));
  assert.equal(captured.files.some(file => file.path.startsWith("urn:")), false);
  for (const absent of ["eligibility", "grant", "receipt", "shape", "drift"] as const) await t.test(absent + " refuses capture", async () => {
    const b = await currentAuthorityUnitBoundary();
    if (absent === "eligibility") b.control.missingEligibility = true;
    if (absent === "grant") b.graph.quads = [];
    if (absent === "receipt") b.files.delete(b.receiptPath);
    if (absent === "shape") b.control.shapeValid = false;
    if (absent === "drift") b.control.driftOnClosure = true;
    assert.throws(b.capture, { reasonCode: absent === "eligibility" || absent === "grant"
      ? "LINEAR_CONTINUATION_HANDOFF_AUTHORITY_INACTIVE" : absent === "drift"
        ? "LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED" : "LINEAR_CONTINUATION_HANDOFF_PUBLICATION_INVALID" });
  });
});

test("legacy current-authority admission is an exact optional graph singleton bound to the untouched predecessor", async (t) => {
  const f = await currentAuthorityUnitBoundary(), admitted = f.admission();
  assert.equal(admitted.currentAuthorityOnlyPublicationSource, f.sourcePath);
  f.functions.assertRepairBoundary!(f.intent, f.state, admitted.predecessorIntentDigest, admitted.predecessorStateDigest);
  for (const mutation of ["absent", "wrong-path", "iri-kind", "duplicate", "predecessor-intent", "predecessor-state"] as const) {
    await t.test(mutation, async () => {
      const b = await currentAuthorityUnitBoundary();
      const field = b.policyGraph.quads.find(row => row.predicate === b.predicate("currentAuthorityOnlyPublicationSource"))!;
      if (mutation === "absent") {
        b.policyGraph.quads = b.policyGraph.quads.filter(row => row !== field);
        assert.equal(b.admission().currentAuthorityOnlyPublicationSource, undefined);
        assert.throws(b.input, { reasonCode: "LINEAR_CONTINUATION_HANDOFF_CURRENT_AUTHORITY_SCOPE_INVALID" });
      } else if (mutation.startsWith("predecessor")) {
        const name = mutation === "predecessor-intent" ? "predecessorIntentDigest" : "predecessorStateDigest";
        b.policyGraph.quads.find(row => row.predicate === b.predicate(name))!.object = b.canonicalDigest({ different: name });
        const policy = b.admission();
        assert.throws(() => b.functions.assertRepairBoundary!(b.intent, b.state, policy.predecessorIntentDigest, policy.predecessorStateDigest),
          { reasonCode: "LINEAR_CONTINUATION_HANDOFF_BOUNDARY_INVALID" });
      } else {
        if (mutation === "wrong-path") field.object = "graph/other-grants.nq";
        if (mutation === "iri-kind") field.objectKind = "iri";
        if (mutation === "duplicate") b.policyGraph.quads.push({ ...field });
        assert.throws(b.admission, { reasonCode: "LINEAR_CONTINUATION_HANDOFF_POLICY_INVALID" });
      }
    });
  }
  f.policyGraph.quads = [];
  assert.equal(f.admission(), null, "absence of the entire policy grants no fallback admission");
});

test("legacy current-authority input authenticates the whole source and selected-dependency independence", async (t) => {
  const f = await currentAuthorityUnitBoundary(), old = f.canonicalJson(f.intent), input = f.input();
  const expected = {
    disposition: "current-authority-only", historicalEquivalence: "not-claimed",
    source: f.fact(f.sourcePath), publicationReceipt: f.fact(f.receiptPath),
    publicationIntentDigest: f.receipt.publicationIntentDigest, publicationReceiptDigest: f.receipt.receiptDigest,
    authorityBasisDigest: f.current.eligibility.authorityBasisDigest,
    selectedDependencyIndependenceDigest: f.canonicalDigest({
      candidateDigest: f.intent.candidateDigest, basisDigest: f.intent.basisDigest, workspaceIdentityDigest: f.intent.workspaceIdentityDigest,
      sourcePath: f.sourcePath, sourceGraph: f.sourceGraph, subjects: [f.seed, f.grant].sort(),
      observation: f.fact(f.observationPath), checks: [f.fact(f.checkPath)],
    }),
  };
  assert.equal(f.canonicalJson(input), f.canonicalJson(expected));
  assert.equal(f.canonicalJson(f.intent), old, "legacy facts are neither manufactured nor retroactively extended");
  const cases: [string, string, (b: Awaited<ReturnType<typeof currentAuthorityUnitBoundary>>) => void][] = [
    ["captured override", "CURRENT_AUTHORITY_SCOPE_INVALID", b => { b.intent.beforeFiles.push(b.fact(b.sourcePath)); }],
    ["dirty override", "CURRENT_AUTHORITY_SCOPE_INVALID", b => { b.intent.repositoryDirtyFiles.push(b.fact(b.sourcePath)); }],
    ["whole-source tamper", "PUBLICATION_INVALID", b => { b.files.get(b.sourcePath)!.bytes = Buffer.from("tampered\n" + b.prefix + b.tail); }],
    ["receipt-linked extra row", "DELTA_INVALID", b => {
      b.put(b.sourcePath, b.prefix + "unreceipted-row\n" + b.tail, 0o600);
      b.receipt.resultingSourceDigest = b.fact(b.sourcePath).digest!; b.refreshReceipt();
    }],
    ["missing historical prefix", "DELTA_INVALID", b => {
      b.put(b.sourcePath, b.tail, 0o600); b.receipt.resultingSourceDigest = b.fact(b.sourcePath).digest!; b.refreshReceipt();
    }],
    ["executable source", "PUBLICATION_INVALID", b => { b.files.get(b.sourcePath)!.mode = 0o700; }],
    ["other-writable source", "PUBLICATION_INVALID", b => { b.files.get(b.sourcePath)!.mode = 0o602; }],
    ["wrong receipt digest", "PUBLICATION_INVALID", b => {
      b.put(b.receiptPath, b.canonicalJson({ ...b.receipt, receiptDigest: b.canonicalDigest({ wrong: 1 }) }) + "\n");
    }],
    ["noncanonical receipt serialization", "PUBLICATION_INVALID", b => { b.put(b.receiptPath, JSON.stringify(b.receipt, null, 2) + "\n"); }],
    ["wrong receipt membership", "PUBLICATION_INVALID", b => { b.receipt.members[0]!.workIri = "urn:usf:work:other"; b.refreshReceipt(); }],
    ["changed observation", "INDEPENDENCE_UNPROVEN", b => { b.put(b.observationPath, "{}\n", 0o600); }],
    ["changed check", "INDEPENDENCE_UNPROVEN", b => { b.put(b.checkPath, "{}\n", 0o600); }],
    ["changed check mode", "INDEPENDENCE_UNPROVEN", b => { b.files.get(b.checkPath)!.mode = 0o640; }],
  ];
  for (const [name, reason, mutate] of cases) await t.test(name, async () => {
    const b = await currentAuthorityUnitBoundary(); mutate(b);
    assert.throws(b.input, { reasonCode: "LINEAR_CONTINUATION_HANDOFF_" + reason });
  });
  for (const target of ["source", "receipt", "graph", "subject"] as const) {
    for (const carrier of ["observation", "check-key"] as const) await t.test(target + " intersection in " + carrier, async () => {
      const b = await currentAuthorityUnitBoundary();
      const forbidden = { source: b.sourcePath, receipt: b.receiptPath, graph: b.sourceGraph, subject: b.grant }[target];
      if (carrier === "observation") {
        b.put(b.observationPath, b.canonicalJson({ observationDigest: b.integration.observationDigest, nested: [forbidden] }) + "\n", 0o600);
        b.integration.files = [b.fact(b.observationPath)];
      } else {
        b.put(b.checkPath, b.canonicalJson({ nested: { [forbidden]: true } }) + "\n", 0o600);
        b.intent.beforeFiles = [b.fact(b.checkPath)];
      }
      assert.throws(b.input, { reasonCode: "LINEAR_CONTINUATION_HANDOFF_SELECTED_DEPENDENCY_INTERSECTION" });
    });
  }
});

test("current-authority lineage requires exact singleton identities and never claims historical equivalence", async () => {
  const f = await currentAuthorityUnitBoundary(), input = f.input();
  const intent = { beforeFiles: [input.source, input.publicationReceipt] };
  const check = (value: unknown, successor: unknown = intent) => f.functions.assertCurrentAuthorityInputLineage!(value, successor);
  check(undefined); check([input]);
  for (const bad of [[], [input, input], [{ ...input, historicalEquivalence: "equivalent" }],
    [{ ...input, disposition: "restored" }], [{ ...input, source: { ...input.source, path: "graph/other.nq" } }],
    [{ ...input, publicationIntentDigest: "not-a-digest" }], [{ ...input, selectedDependencyIndependenceDigest: null }]]) {
    assert.throws(() => check(bad), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_LINEAGE_INVALID" });
  }
  assert.throws(() => check([input], { beforeFiles: [input.source] }), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_LINEAGE_INVALID" });
  for (const mode of [0o700, 0o602, 0o1000, 384.5]) {
    const source = { ...input.source, mode }, changed = { ...input, source };
    assert.throws(() => check([changed], { beforeFiles: [source, input.publicationReceipt] }),
      { reasonCode: "LINEAR_CONTINUATION_HANDOFF_LINEAGE_INVALID" });
  }
});

test("continuation state guards run after every persistence await before replacing a pointer", async (t) => {
  for (const version of [1, 2]) for (const drift of ["none", "blob", "pointer"] as const) {
    await t.test("pointer v" + version + " / " + drift, async () => {
      const { canonicalDigest } = await import("../../../src/core/canonical.ts");
      const intentDigest = canonicalDigest({ intent: 1 }), state = { intentDigest, nextStep: 0 };
      const previous = { schema: "urn:usf:linear-continuation-pointer:" + version, intentDigest,
        stateDigest: canonicalDigest({ old: 1 }), ...(version === 2 ? { handoffReceiptDigest: canonicalDigest({ handoff: 1 }) } : {}) };
      const effects: string[] = [];
      let changed = false, written: unknown;
      const functions = await publisherBoundaryFunctions("linear-continuation", ["saveState"], {
        pointerKey: "pointer", refuse: (reasonCode: string) => { throw Object.assign(new Error(reasonCode), { reasonCode }); },
        writeBlob: async () => { await Promise.resolve(); effects.push("blob"); if (drift === "blob") changed = true; return canonicalDigest(state); },
        readLinearRecord: async () => { await Promise.resolve(); effects.push("read"); if (drift === "pointer") changed = true; return previous; },
        writeLinearRecord: async (_root: string, _key: string, value: unknown) => { effects.push("pointer"); written = value; },
      });
      const save = () => functions.saveState!("/fixture", state, () => {
        effects.push("guard");
        if (changed) throw Object.assign(new Error("changed"), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED" });
      });
      if (drift === "none") {
        await save();
        assert.deepEqual(effects, ["blob", "read", "guard", "pointer"]);
        assert.deepEqual(JSON.parse(JSON.stringify(written)), { ...previous, stateDigest: canonicalDigest(state) });
      } else {
        await assert.rejects(save(), { reasonCode: "LINEAR_CONTINUATION_HANDOFF_AUTHORITY_CHANGED" });
        assert.deepEqual(effects, ["blob", "read", "guard"]);
        assert.equal(written, undefined);
      }
    });
  }
});

async function ordinaryPublisherBoundary(kind: "construction" | "completion") {
  const { resolve, dirname } = await import("node:path");
  const root = "/publication-boundary-fixture";
  const sourcePath = "graph/grants.nq";
  const receiptPath = "evidence/publication.json";
  const workIri = "urn:usf:work:boundary";
  const state = {
    graph: {
      manifestPath: "graph/manifests/boundary.json",
      manifests: [{ path: "graph/manifests/boundary.json", digest: "manifest-before" }],
      sources: ["graph/grants.nq"],
      semanticDigest: "semantic-before",
      graphDigests: { graph: "graph-before" },
      sourceDigests: { source: "source-before" },
    },
    authority: { sourcePath },
    basisDigest: "basis-before",
    source: "before\n",
    sourceMode: 0o644,
    receipt: undefined as string | undefined,
    effects: [] as string[],
    operations: [] as string[],
    checkpointOperationCount: 0,
    checkpointCalls: 0,
    lockReleases: 0,
    afterAuthentication: undefined as (() => void) | undefined,
  };
  const receipt = {
    semanticSourcePath: sourcePath,
    publicationReceiptPath: receiptPath,
    receiptDigest: "receipt-digest",
  };
  const locked = {
    graph: structuredClone(state.graph),
    authority: { ...state.authority },
    receipt,
    receiptBytes: "receipt\n",
    sourceBefore: "before\n",
    sourceAfter: "after\n",
    sourceMode: 0o644,
    recordLines: [],
    state: "absent",
    affectedWorks: [workIri],
    workBasisDigests: { [workIri]: "basis-before" },
  };
  const bundles = [{ evidence: { workIri } }];
  const packet = () => ({ id: workIri, realisationBasis: { basisDigest: state.basisDigest } });
  const prepare = () => ({
    ...locked,
    state: state.source === locked.sourceAfter && state.receipt === locked.receiptBytes ? "matching" : "absent",
  });
  const bindings = {
    resolve, dirname,
    canonicalJson: JSON.stringify,
    exitCodes: { CURRENTNESS_FAILURE: 4, INTEGRATION_CONFLICT: 5 },
    refuse: (code: string) => { throw Object.assign(new Error(code), { code }); },
    loadSemanticGraph: () => structuredClone(state.graph),
    authenticateBundle: () => {
      const authenticated = { bundle: bundles[0], packet: packet(), authority: { ...state.authority } };
      if (kind === "construction") return authenticated;
      return Promise.resolve().then(() => {
        state.afterAuthentication?.();
        return authenticated;
      });
    },
    exactPacket: packet,
    deriveNoChangeCompletionAuthority: () => ({ ...state.authority }),
    preparePublication: prepare,
    validateCompletionBundleShape: () => undefined,
    publicationSnapshotBinding: () => null,
    acquirePrimaryMutationLock: async () => ({ handle: { close: async () => { state.lockReleases += 1; } } }),
    publicationReceiptPath: () => resolve(root, receiptPath),
    readFileSync: () => state.source,
    statSync: () => ({ mode: state.sourceMode }),
    existsSync: (path: string) => path === resolve(root, receiptPath) && state.receipt !== undefined,
    atomicWrite: (_path: string, bytes: string, mode: number) => {
      state.operations.push("write-source");
      state.effects.push("source");
      state.source = bytes;
      state.sourceMode = mode;
    },
    atomicCreate: (_path: string, bytes: string) => {
      state.operations.push("create-receipt");
      state.effects.push("receipt");
      state.receipt = bytes;
    },
    unlinkSync: () => { state.operations.push("unlink"); state.effects.push("unlink"); state.receipt = undefined; },
    fsyncDirectory: () => { state.operations.push("sync-directory"); },
    publicationResult: (...args: unknown[]) => ({ publicationState: args.find((value) => value === "created" || value === "matching" || value === "verified-without-publication") }),
    constructionPublicationEffect: () => ({ kind: "construction" }),
    completionPublicationEffect: () => ({ kind: "completion" }),
    utf8Compare: (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0,
  };
  const prefix = kind === "construction" ? "construction" : "completion";
  const publisherName = kind === "construction" ? "publishConstruction" : "publishCompletion";
  const assertionName = kind === "construction"
    ? "assertConstructionPublicationCurrentAfterCheckpoint"
    : "assertCompletionPublicationCurrentAfterCheckpoint";
  const functions = await publisherBoundaryFunctions(
    kind === "construction" ? "construction-authority" : "work-completion",
    [publisherName, assertionName, prefix + "WorkBasisDigests", prefix + "GraphCurrentness",
      ...(kind === "completion" ? ["authenticateCompletionPublicationAfterCheckpoint"] : [])],
    bindings,
  );
  return {
    state,
    async publish(checkpoint: () => void, mode = "apply") {
      return functions[publisherName]!(root, { mode, manifestPath: state.graph.manifestPath, profile: "urn:usf:profile:boundary" }, bundles, async () => {
        state.checkpointCalls += 1;
        state.checkpointOperationCount = state.operations.length;
        await Promise.resolve();
        checkpoint();
      });
    },
  };
}

test("canonical publishers reauthenticate after checkpoints before any canonical effect", async (t) => {
  type State = Awaited<ReturnType<typeof ordinaryPublisherBoundary>>["state"];
  const mutations: readonly [string, (state: State) => void][] = [
    ["source bytes", (state) => { state.source = "external source\n"; }],
    ["source mode", (state) => { state.sourceMode = 0o600; }],
    ["graph identity", (state) => { state.graph.semanticDigest = "semantic-after"; }],
    ["manifest bytes", (state) => { state.graph.manifests[0]!.digest = "manifest-after"; }],
    ["scoped basis", (state) => { state.basisDigest = "basis-after"; }],
    ["authority", (state) => { state.authority.sourcePath = "graph/other.nq"; }],
    ["receipt destination", (state) => { state.receipt = "external receipt\n"; }],
  ];
  for (const kind of ["construction", "completion"] as const) {
    await t.test(kind + " accepts unchanged inputs", async () => {
      const fixture = await ordinaryPublisherBoundary(kind);
      assert.deepEqual(await fixture.publish(() => undefined), { publicationState: "created" });
      assert.deepEqual(fixture.state.effects, ["source", "receipt"]);
      assert.equal(fixture.state.checkpointCalls, 1);
      assert.equal(fixture.state.lockReleases, 1);
    });
    await t.test(kind + " matching publication does not call a checkpoint", async () => {
      const fixture = await ordinaryPublisherBoundary(kind);
      fixture.state.source = "after\n";
      fixture.state.receipt = "receipt\n";
      const result = await fixture.publish(() => { throw new Error("matching publication must not call a checkpoint"); });
      assert.deepEqual(result, { publicationState: "matching" });
      assert.deepEqual(fixture.state.effects, []);
      assert.equal(fixture.state.checkpointCalls, 0);
    });
    for (const [label, mutate] of mutations) {
      await t.test(kind + " refuses changed " + label, async () => {
        const fixture = await ordinaryPublisherBoundary(kind);
        await assert.rejects(fixture.publish(() => mutate(fixture.state)), (error: unknown) =>
          error instanceof Error && /PUBLICATION_(?:CURRENTNESS|PREIMAGE)_CHANGED/u.test((error as Error & { code: string }).code));
        assert.deepEqual(fixture.state.effects, [], "refusal must happen before any write, including rollback");
        assert.deepEqual(fixture.state.operations.slice(fixture.state.checkpointOperationCount), [],
          "publication must not write, unlink or sync after checkpoint drift");
        assert.equal(fixture.state.checkpointCalls, 1);
        assert.equal(fixture.state.lockReleases, 1);
      });
    }
  }
  await t.test("completion also rechecks inputs changed during asynchronous authentication", async () => {
    const fixture = await ordinaryPublisherBoundary("completion");
    fixture.state.afterAuthentication = () => {
      fixture.state.graph.manifests[0]!.digest = "changed-during-authentication";
      fixture.state.basisDigest = "changed-during-authentication";
    };
    await assert.rejects(fixture.publish(() => undefined), { code: "WORK_COMPLETION_PUBLICATION_CURRENTNESS_CHANGED" });
    assert.deepEqual(fixture.state.effects, []);
    assert.deepEqual(fixture.state.operations.slice(fixture.state.checkpointOperationCount), []);
  });
});

async function retainedPublisherBoundary(sourcePublished: boolean, pendingReceiptPresent = false) {
  const { resolve, dirname } = await import("node:path");
  const root = "/retained-publication-boundary-fixture";
  const directory = ".usf/snapshots/publication";
  const sourcePath = "graph/grants.nq";
  const receiptPath = "evidence/publication.json";
  const authorityPath = "src/protected.ts";
  const files = new Map<string, { bytes: Buffer; mode: number }>();
  const put = (path: string, bytes: string | Buffer, mode = 0o644) => {
    files.set(resolve(root, path), { bytes: Buffer.from(bytes), mode });
  };
  const setMode = (path: string, mode: number) => {
    const file = files.get(resolve(root, path));
    assert.ok(file, "required mode-only fixture file: " + path);
    file.mode = mode;
  };
  put(sourcePath, sourcePublished ? "after\n" : "before\n");
  put(authorityPath, "protected\n");
  if (pendingReceiptPresent) put(directory + "/receipt.pending", "receipt\n");
  const metadata = {
    members: [{ work: "urn:usf:work:boundary" }],
    files: [
      { role: "source-preimage", path: "source.before", sourcePath, sourceMode: 0o644 },
      { role: "authority-input", path: "authority", sourcePath: authorityPath, sourceMode: 0o644 },
    ],
  };
  const retained = { metadata, bytes: new Map([["authority", Buffer.from("protected\n")]]) };
  const state = {
    files, put, setMode,
    metadata: structuredClone(metadata),
    snapshotBytes: new Map([...retained.bytes].map(([path, bytes]) => [path, Buffer.from(bytes)])),
    effects: [] as string[],
    operations: [] as string[],
    checkpointOperationCount: 0,
    checkpointCalls: 0,
  };
  const authority = { sourcePath };
  const prepared = {
    authority,
    sourceBefore: "before\n",
    sourceAfter: "after\n",
    receiptBytes: "receipt\n",
    receipt: { semanticSourcePath: sourcePath, publicationReceiptPath: receiptPath, receiptDigest: "receipt-digest" },
    state: "absent",
  };
  const read = (_root: string, path: string) => {
    const file = files.get(resolve(root, path));
    assert.ok(file, "required fixture file: " + path);
    return { bytes: Buffer.from(file.bytes), mode: file.mode };
  };
  const pending = () => {
    const pendingFile = files.get(resolve(root, directory, "receipt.pending"));
    const finalFile = files.get(resolve(root, receiptPath));
    if (pendingFile && (!pendingFile.bytes.equals(Buffer.from("receipt\n")) || pendingFile.mode !== 0o644)) {
      throw Object.assign(new Error("pending receipt changed"), { code: "WORK_COMPLETION_RECEIPT_PENDING_CONFLICT" });
    }
    return pendingFile ? finalFile ? "linked" : "pending" : "absent";
  };
  const functions = await publisherBoundaryFunctions("work-completion",
    ["applyPublicationSnapshot", "assertRetainedPublicationSnapshotCurrent"], {
      resolve, dirname,
      canonicalJson: JSON.stringify,
      exitCodes: { CURRENTNESS_FAILURE: 4, INTEGRATION_CONFLICT: 5 },
      refuse: (code: string) => { throw Object.assign(new Error(code), { code }); },
      loadSemanticGraph: () => ({}),
      deriveNoChangeCompletionAuthority: () => authority,
      reauthenticatePublicationSnapshot: async () => ({ prepared, bundles: [] }),
      readPublicationSnapshot: () => ({ metadata: state.metadata, bytes: state.snapshotBytes }),
      readPublicationFile: read,
      authenticateReceiptPending: pending,
      publicationReceiptPath: () => resolve(root, receiptPath),
      existsSync: (path: string) => files.has(path),
      assessCompletionPublicationStart: () => ({ action: sourcePublished ? "resume-receipt" : "apply-source" }),
      writePublicationPending: (path: string, bytes: Buffer, mode: number) => {
        state.operations.push("write-pending");
        put(path, bytes, mode);
      },
      completionPublicationEffect: () => ({ kind: "completion" }),
      renameSync: (from: string, to: string) => {
        state.operations.push("rename-source");
        state.effects.push("source");
        const file = files.get(from);
        assert.ok(file);
        files.set(to, file);
        files.delete(from);
      },
      linkSync: (from: string, to: string) => {
        state.operations.push("link-receipt");
        state.effects.push("receipt");
        const file = files.get(from);
        assert.ok(file);
        files.set(to, file);
      },
      unlinkSync: (path: string) => { state.operations.push("unlink"); files.delete(path); },
      fsyncDirectory: () => { state.operations.push("sync-directory"); },
      preparePublication: async () => ({ ...prepared, state: "matching" }),
      publicationResult: (_root: string, _mode: string, publicationState: string) => ({ publicationState }),
    });
  return {
    state,
    async publish(checkpoint: () => void) {
      return functions.applyPublicationSnapshot!(root, { mode: "apply", manifestPath: "graph/manifests/boundary.json" },
        { root: ".usf/snapshots" }, directory, retained, async () => {
          state.checkpointCalls += 1;
          state.checkpointOperationCount = state.operations.length;
          await Promise.resolve();
          checkpoint();
        });
    },
  };
}

test("retained publication rechecks exact source and receipt states after checkpoints", async (t) => {
  type State = Awaited<ReturnType<typeof retainedPublisherBoundary>>["state"];
  const mutations: readonly [string, (state: State) => void][] = [
    ["authority bytes", (state) => state.put("src/protected.ts", "changed\n")],
    ["authority mode", (state) => state.setMode("src/protected.ts", 0o600)],
    ["source bytes", (state) => state.put("graph/grants.nq", "changed\n")],
    ["source mode", (state) => state.setMode("graph/grants.nq", 0o600)],
    ["snapshot metadata", (state) => { state.metadata.members[0]!.work = "urn:usf:work:changed"; }],
    ["snapshot payload", (state) => { state.snapshotBytes.set("authority", Buffer.from("changed\n")); }],
    ["receipt destination", (state) => state.put("evidence/publication.json", "external\n")],
  ];
  for (const sourcePublished of [false, true]) {
    const prefix = sourcePublished ? "receipt-only resume" : "initial source publication";
    await t.test(prefix + " succeeds with an initially absent pending receipt", async () => {
      const fixture = await retainedPublisherBoundary(sourcePublished);
      assert.deepEqual(await fixture.publish(() => undefined), { publicationState: "created" });
      assert.deepEqual(fixture.state.effects, sourcePublished ? ["receipt"] : ["source", "receipt"]);
      assert.equal(fixture.state.checkpointCalls, 1);
    });
    for (const [label, mutate] of mutations) {
      await t.test(prefix + " refuses changed " + label, async () => {
        const fixture = await retainedPublisherBoundary(sourcePublished);
        await assert.rejects(fixture.publish(() => mutate(fixture.state)), (error: unknown) =>
          error instanceof Error && /^WORK_COMPLETION_/u.test((error as Error & { code: string }).code));
        assert.deepEqual(fixture.state.effects, [], "no canonical write is allowed after callback drift");
        assert.deepEqual(fixture.state.operations.slice(fixture.state.checkpointOperationCount), [],
          "pre-checkpoint staging is allowed, but no publication operation may follow drift");
        assert.equal(fixture.state.checkpointCalls, 1);
      });
    }
  }
  await t.test("initial source publication accepts an unchanged existing pending receipt", async () => {
    const fixture = await retainedPublisherBoundary(false, true);
    assert.deepEqual(await fixture.publish(() => undefined), { publicationState: "created" });
    assert.deepEqual(fixture.state.effects, ["source", "receipt"]);
    assert.equal(fixture.state.checkpointCalls, 1);
  });
  await t.test("initial source publication refuses a newly appearing pending receipt", async () => {
    const fixture = await retainedPublisherBoundary(false);
    await assert.rejects(fixture.publish(() => fixture.state.put(".usf/snapshots/publication/receipt.pending", "receipt\n")),
      { code: "WORK_COMPLETION_PUBLICATION_CURRENTNESS_CHANGED" });
    assert.deepEqual(fixture.state.effects, []);
    assert.deepEqual(fixture.state.operations.slice(fixture.state.checkpointOperationCount), []);
  });
  for (const change of ["bytes", "mode"] as const) {
    await t.test("initial source publication refuses pending source " + change + " drift", async () => {
      const fixture = await retainedPublisherBoundary(false);
      await assert.rejects(fixture.publish(() => {
        if (change === "mode") fixture.state.setMode(".usf/snapshots/publication/source.pending", 0o600);
        else fixture.state.put(".usf/snapshots/publication/source.pending", "changed\n");
      }), { code: "WORK_COMPLETION_PUBLICATION_CURRENTNESS_CHANGED" });
      assert.deepEqual(fixture.state.effects, []);
      assert.deepEqual(fixture.state.operations.slice(fixture.state.checkpointOperationCount), []);
    });
    await t.test("receipt-only resume refuses pending receipt " + change + " drift", async () => {
      const fixture = await retainedPublisherBoundary(true);
      await assert.rejects(fixture.publish(() => {
        if (change === "mode") fixture.state.setMode(".usf/snapshots/publication/receipt.pending", 0o600);
        else fixture.state.put(".usf/snapshots/publication/receipt.pending", "changed\n");
      }), { code: "WORK_COMPLETION_RECEIPT_PENDING_CONFLICT" });
      assert.deepEqual(fixture.state.effects, []);
      assert.deepEqual(fixture.state.operations.slice(fixture.state.checkpointOperationCount), []);
    });
  }
});
