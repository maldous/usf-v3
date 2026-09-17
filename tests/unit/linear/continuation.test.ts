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
  file: "construction-authority" | "work-completion",
  names: readonly string[],
  bindings: Record<string, unknown>,
): Promise<Record<string, (...args: unknown[]) => Promise<unknown>>> {
  const { readFile } = await import("node:fs/promises");
  const { stripTypeScriptTypes } = await import("node:module");
  const { runInNewContext } = await import("node:vm");
  const source = await readFile(new URL("../../../src/commands/" + file + ".ts", import.meta.url), "utf8");
  const functions = names.map((name) => {
    const matches = [...source.matchAll(new RegExp("^(?:async )?function " + name + "\\([\\s\\S]*?^\\}", "gm"))];
    assert.equal(matches.length, 1, "exactly one production function must be evaluated: " + name);
    return matches[0]![0];
  });
  const executable = stripTypeScriptTypes(functions.join("\n\n") + "\n({" + names.join(",") + "});");
  return runInNewContext(executable, { Buffer, ...bindings }) as Record<string, (...args: unknown[]) => Promise<unknown>>;
}

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
