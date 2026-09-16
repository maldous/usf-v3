import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const production = await import("../../../src/realisation/work-completion.ts") as unknown as Record<string, unknown>;

type RecoveryExercise = (input: {
  boundary: string;
  publish: (mode: "apply" | "verify") => Promise<Readonly<Record<string, unknown>>>;
  observe: (result: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
}) => Promise<void>;

let recoverySource: Promise<string> | undefined;

async function recoveryExercise(): Promise<RecoveryExercise> {
  const source = await (recoverySource ??= readFile(
    new URL("../../integration/work-completion.test.ts", import.meta.url), "utf8",
  ));
  const helper = source.match(
    /const exerciseCanonicalPublicationRecovery: CanonicalPublicationRecoveryExercise = (async [\s\S]*?^\});/mu,
  );
  if (helper !== null) {
    return new Function("assert", "return (" + helper[1] + ");")(assert) as RecoveryExercise;
  }

  // RED-only baseline support: execute the existing three native call
  // expressions with deterministic doubles, not the integration test module.
  // The existing receipt/filesystem assertions occur after these calls.
  // This models that observation order; it is not native acceptance.
  const legacy = source.match(
    /const resumed = await native\.runCanonicalCompletionPublication[^\n]*\n\s*const replay = await native\.runCanonicalCompletionPublication[^\n]*\n\s*const verified = await native\.runCanonicalCompletionPublication[^\n]*/u,
  );
  assert.ok(legacy, "expected the actual recovery helper or retained native call sequence");
  return new Function("assert", `
    return async ({ publish, observe }) => {
      const isolated = { root: "deterministic-double-only" };
      const request = {};
      const native = {
        runCanonicalCompletionPublication: (_root, selected) => publish(selected.mode),
      };
      ${legacy[0]}
      assert.equal(resumed.memberCount, 1);
      assert.equal(replay.publicationState, "matching");
      assert.equal(verified.publicationState, "matching");
      await observe(resumed);
    };
  `)(assert) as RecoveryExercise;
}

function recoveryResult(mode: "apply" | "verify", ordinal: number): Record<string, unknown> {
  return {
    schema: "urn:test:publication-result",
    status: "verified",
    mode,
    publicationState: ordinal === 1 ? "created" : "matching",
    profileIri: "urn:test:profile",
    manifestPath: "graph/manifests/test.json",
    memberCount: 1,
    works: ["urn:test:work"],
    publicationIntentDigest: "sha256:" + "1".repeat(64),
    publicationReceiptPath: "evidence/work-completion/test.json",
    receiptDigest: "sha256:" + "2".repeat(64),
    resultingSemanticDigest: "sha256:" + "3".repeat(64),
  };
}

test("recovery orchestration retains five resumes and five replays with exactly one native verify", async () => {
  const exercise = await recoveryExercise();
  const boundaries = [
    "before-source", "source-before-receipt", "receipt-pending-before-link",
    "receipt-linked-before-cleanup", "receipt-before-ack",
  ];
  const observed: { boundary: string; calls: string[]; observations: number }[] = [];
  for (const boundary of boundaries) {
    const row = { boundary, calls: [] as string[], observations: 0 };
    await exercise({
      boundary,
      publish: async mode => {
        row.calls.push(mode);
        return recoveryResult(mode, row.calls.length);
      },
      observe: async () => {
        row.observations++;
        return { sourceBytes: "postimage", receiptBytes: "receipt", receiptInode: 41 };
      },
    });
    observed.push(row);
  }
  assert.equal(observed.reduce((count, row) => count + row.calls.length, 0), 11);
  for (const row of observed) {
    const expected = row.boundary === "receipt-linked-before-cleanup"
      ? ["apply", "apply", "verify"] : ["apply", "apply"];
    assert.deepEqual(row.calls, expected, row.boundary);
    assert.equal(row.observations, expected.length, row.boundary);
  }
});

test("recovery orchestration rejects unfinished resume before replay can repair it", async () => {
  const exercise = await recoveryExercise();
  for (const pending of ["source.pending", "receipt.pending"]) {
    let calls = 0;
    let unfinished = true;
    await assert.rejects(() => exercise({
      boundary: "receipt-linked-before-cleanup",
      publish: async mode => {
        calls++;
        if (calls > 1) unfinished = false;
        return recoveryResult(mode, calls);
      },
      observe: async () => {
        assert.equal(unfinished, false, "unfinished resume: " + pending);
        return { pendingAbsent: true };
      },
    }), /unfinished resume/u);
    assert.equal(calls, 1, "no replay or verify may repair the failed observation");
  }
});

test("recovery orchestration rejects changed immutable replay identity before observing it", async () => {
  const exercise = await recoveryExercise();
  for (const field of [
    "schema", "profileIri", "manifestPath", "works", "publicationIntentDigest",
    "publicationReceiptPath", "receiptDigest", "resultingSemanticDigest",
  ]) {
    let calls = 0;
    let observations = 0;
    await assert.rejects(() => exercise({
      boundary: "before-source",
      publish: async mode => {
        const result = recoveryResult(mode, ++calls);
        if (calls === 2) result[field] = field === "works" ? ["urn:test:other"] : "changed";
        return result;
      },
      observe: async () => {
        observations++;
        return { sourceBytes: "postimage", receiptBytes: "receipt" };
      },
    }), assert.AssertionError);
    assert.equal(calls, 2);
    assert.equal(observations, 1, "changed replay identity must fail before terminal observation");
  }
});

test("recovery orchestration rejects non-verified native results before observing them", async () => {
  const exercise = await recoveryExercise();
  for (const failedCall of [1, 2, 3]) {
    let calls = 0;
    let observations = 0;
    await assert.rejects(() => exercise({
      boundary: "receipt-linked-before-cleanup",
      publish: async mode => {
        const result = recoveryResult(mode, ++calls);
        if (calls === failedCall) result.status = "failed";
        return result;
      },
      observe: async () => {
        observations++;
        return { sourceBytes: "postimage", receiptBytes: "receipt" };
      },
    }), assert.AssertionError);
    assert.equal(calls, failedCall);
    assert.equal(observations, failedCall - 1);
  }
});

test("recovery orchestration rejects representative verify filesystem mutation", async () => {
  const exercise = await recoveryExercise();
  let calls = 0;
  let observations = 0;
  const sharedObservation = { sourceBytes: "postimage", receiptBytes: "receipt", receiptInode: 41 };
  await assert.rejects(() => exercise({
    boundary: "receipt-linked-before-cleanup",
    publish: async mode => {
      calls++;
      if (mode === "verify") sharedObservation.receiptInode = 42;
      return recoveryResult(mode, calls);
    },
    observe: async () => {
      observations++;
      return sharedObservation;
    },
  }), assert.AssertionError);
  assert.equal(calls, 3);
  assert.equal(observations, 3);
});

type PublicationInput = {
  mode: "apply" | "verify";
  source: "preimage" | "postimage" | "other";
  sourceModeMatches: boolean;
  receiptPending: "absent" | "pending" | "linked";
  receiptExists: boolean;
  sourcePendingExists: boolean;
};
type PublicationDecision =
  | { action: "refuse"; reasonCode: "WORK_COMPLETION_PUBLICATION_PARTIAL_STATE" | "WORK_COMPLETION_PUBLICATION_RECONCILIATION_REQUIRED" }
  | { action: "verify-absent" | "verify-current" | "apply-source" | "apply-receipt" };
type EvaluatorInput = {
  digest: string;
  algorithms: readonly string[];
  policies: readonly string[];
  expectedAlgorithm: string;
  expectedPolicy: string;
};
type ArtifactInput = {
  digest: string;
  declarations: readonly string[];
  values: Readonly<Record<string, readonly string[]>>;
  expected: Readonly<Record<string, string>>;
  producerArtifacts: readonly string[];
};

function api<Input, Output>(name: string): (input: Input) => Output {
  assert.equal(typeof production[name], "function", "API_UNAVAILABLE: " + name + " is not exported; this is not a behavioral counterexample");
  return production[name] as (input: Input) => Output;
}

function freezeInput<T>(input: T): T {
  if (input !== null && typeof input === "object") {
    for (const value of Object.values(input)) freezeInput(value);
    Object.freeze(input);
  }
  return input;
}

const partial: PublicationDecision = Object.freeze({ action: "refuse", reasonCode: "WORK_COMPLETION_PUBLICATION_PARTIAL_STATE" });
const reconcile: PublicationDecision = Object.freeze({ action: "refuse", reasonCode: "WORK_COMPLETION_PUBLICATION_RECONCILIATION_REQUIRED" });
const publicationBase: PublicationInput = Object.freeze({
  mode: "apply", source: "preimage", sourceModeMatches: true,
  receiptPending: "absent", receiptExists: false, sourcePendingExists: false,
});

function expectPublication(input: PublicationInput, expected: PublicationDecision): void {
  const assess = api<PublicationInput, PublicationDecision>("assessCompletionPublicationStart");
  const frozen = freezeInput(input);
  const before = JSON.stringify(frozen);
  const actual = assess(frozen);
  assert.deepEqual(actual, expected);
  assert.equal(Object.isFrozen(actual), true, "publication decisions must be frozen, not authority-bearing mutable state");
  assert.equal(JSON.stringify(frozen), before, "publication assessment must not mutate its input");
}

test("completion decisions expose all three pure production APIs", () => {
  for (const name of ["assessCompletionPublicationStart", "completionTerminalEvaluatorMatches", "completionTerminalArtifactMatches"]) {
    api<unknown, unknown>(name);
  }
});

// Explicit abstract states from the decision contract. These rows do not
// simulate process death, filesystem durability, or native authentication.
const crashStates: readonly {
  name: string;
  state: Partial<PublicationInput>;
  apply: PublicationDecision;
  verify: PublicationDecision;
}[] = [
  { name: "before-source", state: {}, apply: { action: "apply-source" }, verify: { action: "verify-absent" } },
  { name: "source-before-receipt", state: { source: "postimage" }, apply: { action: "apply-receipt" }, verify: reconcile },
  { name: "receipt-pending-before-link", state: { source: "postimage", receiptPending: "pending" }, apply: { action: "apply-receipt" }, verify: reconcile },
  { name: "receipt-linked-before-cleanup", state: { source: "postimage", receiptPending: "linked", receiptExists: true }, apply: { action: "apply-receipt" }, verify: reconcile },
  { name: "receipt-before-ack", state: { source: "postimage", receiptExists: true }, apply: { action: "apply-receipt" }, verify: { action: "verify-current" } },
];

for (const row of crashStates) {
  for (const mode of ["apply", "verify"] as const) {
    test("completion publication " + row.name + " " + mode + " has an exact pure decision", () => {
      expectPublication({ ...publicationBase, ...row.state, mode }, row[mode]);
    });
  }
}

test("completion publication refuses unknown source or source mode mismatch before all other states", () => {
  api<PublicationInput, PublicationDecision>("assessCompletionPublicationStart");
  for (const mode of ["apply", "verify"] as const) {
    for (const source of ["preimage", "postimage", "other"] as const) {
      for (const sourceModeMatches of [false, true]) {
        if (source !== "other" && sourceModeMatches) continue;
        for (const receiptPending of ["absent", "pending", "linked"] as const) {
          for (const receiptExists of [false, true]) {
            for (const sourcePendingExists of [false, true]) {
              expectPublication({ mode, source, sourceModeMatches, receiptPending, receiptExists, sourcePendingExists }, partial);
            }
          }
        }
      }
    }
  }
});

test("completion publication refuses every preimage receipt conflict in either mode", () => {
  api<PublicationInput, PublicationDecision>("assessCompletionPublicationStart");
  for (const mode of ["apply", "verify"] as const) {
    for (const receiptPending of ["absent", "pending", "linked"] as const) {
      for (const receiptExists of [false, true]) {
        if (receiptPending === "absent" && !receiptExists) continue;
        for (const sourcePendingExists of [false, true]) {
          expectPublication({ ...publicationBase, mode, receiptPending, receiptExists, sourcePendingExists }, partial);
        }
      }
    }
  }
});

test("completion publication source pending distinguishes apply recovery from verify reconciliation", () => {
  expectPublication({ ...publicationBase, sourcePendingExists: true }, { action: "apply-source" });
  expectPublication({ ...publicationBase, mode: "verify", sourcePendingExists: true }, reconcile);
  for (const receiptPending of ["absent", "pending", "linked"] as const) {
    for (const receiptExists of [false, true]) {
      expectPublication({ ...publicationBase, source: "postimage", receiptPending, receiptExists, sourcePendingExists: true }, partial);
      expectPublication({ ...publicationBase, mode: "verify", source: "postimage", receiptPending, receiptExists, sourcePendingExists: true }, reconcile);
    }
  }
});

test("completion publication postimage receipt table preserves verification and application distinctions", () => {
  const rows: readonly { receiptPending: PublicationInput["receiptPending"]; receiptExists: boolean; verify: PublicationDecision }[] = [
    { receiptPending: "absent", receiptExists: false, verify: reconcile },
    { receiptPending: "absent", receiptExists: true, verify: { action: "verify-current" } },
    { receiptPending: "pending", receiptExists: false, verify: reconcile },
    { receiptPending: "pending", receiptExists: true, verify: reconcile },
    { receiptPending: "linked", receiptExists: false, verify: reconcile },
    { receiptPending: "linked", receiptExists: true, verify: reconcile },
  ];
  for (const row of rows) {
    const state: PublicationInput = { ...publicationBase, source: "postimage", receiptPending: row.receiptPending, receiptExists: row.receiptExists };
    expectPublication(state, { action: "apply-receipt" });
    expectPublication({ ...state, mode: "verify" }, row.verify);
  }
});

test("completion publication exhausts all 144 initial states against declarative decision rows", () => {
  const applySource: PublicationDecision = { action: "apply-source" };
  const applyReceipt: PublicationDecision = { action: "apply-receipt" };
  const absent: PublicationDecision = { action: "verify-absent" };
  const current: PublicationDecision = { action: "verify-current" };
  type Row = readonly [
    PublicationInput["receiptPending"], boolean, boolean,
    PublicationDecision, PublicationDecision, PublicationDecision, PublicationDecision,
  ];
  // Columns: receipt pending, final receipt, source pending, then
  // preimage apply/verify and postimage apply/verify. Invalid source identity
  // or source mode always takes precedence over these receipt-state rows.
  const rows: readonly Row[] = [
    ["absent", false, false, applySource, absent, applyReceipt, reconcile],
    ["absent", false, true, applySource, reconcile, partial, reconcile],
    ["absent", true, false, partial, partial, applyReceipt, current],
    ["absent", true, true, partial, partial, partial, reconcile],
    ["pending", false, false, partial, partial, applyReceipt, reconcile],
    ["pending", false, true, partial, partial, partial, reconcile],
    ["pending", true, false, partial, partial, applyReceipt, reconcile],
    ["pending", true, true, partial, partial, partial, reconcile],
    ["linked", false, false, partial, partial, applyReceipt, reconcile],
    ["linked", false, true, partial, partial, partial, reconcile],
    ["linked", true, false, partial, partial, applyReceipt, reconcile],
    ["linked", true, true, partial, partial, partial, reconcile],
  ];
  const matrix: { input: PublicationInput; expected: PublicationDecision }[] = [];
  for (const mode of ["apply", "verify"] as const) {
    for (const source of ["preimage", "postimage", "other"] as const) {
      for (const sourceModeMatches of [false, true]) {
        for (const [receiptPending, receiptExists, sourcePendingExists, preApply, preVerify, postApply, postVerify] of rows) {
          const outcomes = {
            preimage: { apply: preApply, verify: preVerify },
            postimage: { apply: postApply, verify: postVerify },
            other: { apply: partial, verify: partial },
          };
          matrix.push({
            input: { mode, source, sourceModeMatches, receiptPending, receiptExists, sourcePendingExists },
            expected: outcomes[sourceModeMatches ? source : "other"][mode],
          });
        }
      }
    }
  }
  assert.equal(matrix.length, 144);
  assert.equal(new Set(matrix.map(row => JSON.stringify(row.input))).size, 144);
  api<PublicationInput, PublicationDecision>("assessCompletionPublicationStart");
  for (const row of matrix) expectPublication(row.input, row.expected);
});

const evaluatorDigest = "sha256:b9c8fd3a8e648ecb1ddb6e1bbdca0d4e536ebfeffdfd8f204a38287370b0ea3d";
const artifactDigest = "sha256:d09e7915796bd640dda4332327d2f26710358a0088fa742b085c4314786f5981";
const evaluatorBase: EvaluatorInput = freezeInput({
  digest: evaluatorDigest,
  algorithms: ["urn:test:completion-algorithm"], policies: ["urn:test:completion-policy"],
  expectedAlgorithm: "urn:test:completion-algorithm", expectedPolicy: "urn:test:completion-policy",
});

function expectEvaluator(input: EvaluatorInput, expected: boolean): void {
  const matches = api<EvaluatorInput, boolean>("completionTerminalEvaluatorMatches");
  const frozen = freezeInput(input);
  const before = JSON.stringify(frozen);
  assert.equal(matches(frozen), expected);
  assert.equal(JSON.stringify(frozen), before);
}

test("completion evaluator accepts only its exact compiled digest and singleton selectors", () => {
  expectEvaluator(evaluatorBase, true);
  for (const digest of ["", artifactDigest, "sha256:" + "0".repeat(64), evaluatorDigest + "changed"]) {
    expectEvaluator({ ...evaluatorBase, digest }, false);
  }
});

test("completion evaluator rejects missing duplicated or mutated algorithms and policies", () => {
  for (const key of ["algorithms", "policies"] as const) {
    const valid = evaluatorBase[key][0]!;
    for (const values of [[], ["urn:test:wrong"], [valid, valid], [valid, "urn:test:wrong"], ["urn:test:wrong", valid]]) {
      expectEvaluator({ ...evaluatorBase, [key]: values }, false);
    }
  }
  expectEvaluator({ ...evaluatorBase, expectedAlgorithm: "urn:test:different-algorithm" }, false);
  expectEvaluator({ ...evaluatorBase, expectedPolicy: "urn:test:different-policy" }, false);
});

const lineageKeys = ["type", "producer", "schema", "work", "profile", "proofObligation"] as const;
const declaration = "urn:test:completion-artifact";
const expectedLineage: Readonly<Record<string, string>> = Object.freeze({
  type: "urn:test:completion-artifact-type", producer: "urn:test:completion-producer",
  schema: "urn:test:completion-schema", work: "urn:test:completion-work",
  profile: "urn:test:completion-profile", proofObligation: "urn:test:completion-proof",
});
const artifactBase: ArtifactInput = freezeInput({
  digest: artifactDigest, declarations: [declaration], expected: expectedLineage,
  values: Object.fromEntries(lineageKeys.map(key => [key, [expectedLineage[key]!]])),
  producerArtifacts: [declaration],
});

function expectArtifact(input: ArtifactInput, expected: boolean): void {
  const matches = api<ArtifactInput, boolean>("completionTerminalArtifactMatches");
  const frozen = freezeInput(input);
  const before = JSON.stringify(frozen);
  assert.equal(matches(frozen), expected);
  assert.equal(JSON.stringify(frozen), before);
}

test("completion artifact accepts the exact compiled digest and complete singleton lineage", () => {
  expectArtifact(artifactBase, true);
  for (const digest of ["", evaluatorDigest, "sha256:" + "0".repeat(64), artifactDigest + "changed"]) {
    expectArtifact({ ...artifactBase, digest }, false);
  }
});

for (const key of lineageKeys) {
  test("completion artifact rejects altered missing or duplicate " + key + " lineage", () => {
    const valid = expectedLineage[key]!;
    for (const values of [[], ["urn:test:wrong"], [valid, valid], [valid, "urn:test:wrong"], ["urn:test:wrong", valid]]) {
      expectArtifact({ ...artifactBase, values: { ...artifactBase.values, [key]: values } }, false);
    }
    const missing = { ...artifactBase.values };
    delete missing[key];
    expectArtifact({ ...artifactBase, values: missing }, false);
    expectArtifact({ ...artifactBase, expected: { ...expectedLineage, [key]: "urn:test:wrong" } }, false);
  });
}

test("completion artifact rejects missing duplicate or unrelated declarations and producer artifacts", () => {
  for (const declarations of [[], [declaration, declaration], [declaration, "urn:test:other"], ["urn:test:other"]]) {
    expectArtifact({ ...artifactBase, declarations }, false);
  }
  for (const producerArtifacts of [[], [declaration, declaration], [declaration, "urn:test:other"], ["urn:test:other"]]) {
    expectArtifact({ ...artifactBase, producerArtifacts }, false);
  }
});

test("completion artifact rejects vacuous incomplete or extra expected-key contracts", () => {
  expectArtifact({ ...artifactBase, expected: {} }, false);
  expectArtifact({ ...artifactBase, expected: {}, values: {} }, false);
  for (const key of lineageKeys) {
    const expected = { ...expectedLineage };
    delete expected[key];
    expectArtifact({ ...artifactBase, expected }, false);
  }
  expectArtifact({
    ...artifactBase,
    expected: { ...expectedLineage, unrelated: "urn:test:extra" },
    values: { ...artifactBase.values, unrelated: ["urn:test:extra"] },
  }, false);
});
