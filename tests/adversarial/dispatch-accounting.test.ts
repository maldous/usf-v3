import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  assertHermesDispatchAccounting,
  deriveDispatchLineage,
  deriveGraphDispatchAccounting,
  deriveHermesDispatchAccounting,
  DispatchAccountingRefusal,
  type DispatchAttemptObservation,
  type GraphDispatchUnitObservation,
} from "../../src/providers/dispatch-accounting.ts";
import { applyRouteOutcomes, deferralDurationMs } from "../../src/providers/route-deferral.ts";
import {
  graphExecuteCommand, projectGraphDispatchAccounting, sdkPreflightRefusal,
  type GraphExecutionDependencies,
} from "../../src/commands/graph-execute.ts";
import {
  projectHermesDispatchAccounting, readRepairRounds, writeRepairRounds,
} from "../../src/commands/hermes-implement.ts";
import { projectImplementationDispatchAccounting } from "../../src/commands/hermes-lifecycle.ts";
import { canonicalJson } from "../../src/core/canonical.ts";
import { normalizeModelsDevCatalogue } from "../../src/providers/catalogue.ts";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const preflight = Object.freeze({ phase: "preflight", contacted: false, outcome: "refused" }) as DispatchAttemptObservation;
const contactedRefusal = Object.freeze({ phase: "invocation", contacted: true, outcome: "refused" }) as DispatchAttemptObservation;
const contactedSuccess = Object.freeze({ phase: "invocation", contacted: true, outcome: "ok" }) as DispatchAttemptObservation;
const repositoryRoot = resolve(import.meta.dirname, "../..");

async function graphCommandFixture(selectedAntigravityModels: number): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "usf-dispatch-command-"));
  for (const directory of ["config", "evidence", "graph"]) {
    await cp(resolve(repositoryRoot, directory), resolve(root, directory), { recursive: true });
  }
  for (const path of ["package.json", "pnpm-lock.yaml"]) {
    await cp(resolve(repositoryRoot, path), resolve(root, path));
  }
  const executionPath = resolve(root, "graph/v3-execution.nq");
  const execution = await readFile(executionPath, "utf8");
  let retained = 0;
  const selectedModelPredicate = "<urn:usf:execution-transport:antigravity-cli> <urn:usf:predicate:selectedModel>";
  const bounded = execution.split("\n").filter((line) => {
    if (!line.startsWith(selectedModelPredicate)) return true;
    retained += 1;
    return retained <= selectedAntigravityModels;
  }).join("\n");
  await writeFile(executionPath, bounded, { mode: 0o600 });

  await mkdir(resolve(root, ".usf/catalog"), { recursive: true, mode: 0o700 });
  await mkdir(resolve(root, ".usf/provider-home"), { mode: 0o700 });
  await chmod(resolve(root, ".usf"), 0o700);
  const raw = await readFile(resolve(repositoryRoot, "tests/fixtures/providers/models-dev.json"));
  await writeFile(resolve(root, ".usf/catalog/models-dev.raw.json"), raw, { mode: 0o600 });
  await writeFile(resolve(root, ".usf/catalog/models-dev.normalized.json"),
    canonicalJson(normalizeModelsDevCatalogue(raw)), { mode: 0o600 });
  await writeFile(resolve(root, ".usf/empty.env"), "", { mode: 0o600 });
  const workGraph = "urn:usf:graph:dispatch-accounting-fixture";
  await writeFile(resolve(root, ".usf/work.nq"), [
    `<urn:usf:unit:dispatch-accounting-fixture> <urn:usf:predicate:type> <urn:usf:type:SemanticWorkUnit> <${workGraph}> .`,
    `<urn:usf:unit:dispatch-accounting-fixture> <urn:usf:predicate:prompt> "offline fixture" <${workGraph}> .`,
    `<urn:usf:unit:dispatch-accounting-fixture> <urn:usf:predicate:maximumOutputTokens> "64" <${workGraph}> .`,
    "",
  ].join("\n"), { mode: 0o600 });
  execFileSync("/usr/bin/git", ["init", "-q", root]);
  execFileSync("/usr/bin/git", ["-C", root, "add", "--", "config/execution-economics.json"]);
  return root;
}

function localCapability(usable: boolean, observedAt: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: "urn:usf:authenticated-transport-capability:1",
    transport: "antigravity-cli",
    authenticationKind: "local-agent-session",
    usable,
    reason: usable ? null : "SESSION_MATERIAL_ABSENT",
    credentialName: null,
    executablePath: usable ? "/fixture/agy" : null,
    executableVersion: usable ? "fixture" : null,
    observedAt,
    nonClaims: Object.freeze(["offline fixture observation"]),
  });
}

function unit(
  id: string,
  eligible: boolean,
  attempts: readonly DispatchAttemptObservation[],
  status: "ok" | "refused",
  reasonCode: string,
): GraphDispatchUnitObservation {
  return Object.freeze({
    unit: id, eligible, attempts, status, reasonCode,
    resultText: status === "ok" ? `result:${id}` : null,
  });
}

test("no-route and no-credential preflight observations are attempts without contact", () => {
  assert.equal(sdkPreflightRefusal({ adapterPackage: null, model: "model", credential: "credential" }), "ADAPTER_PACKAGE_ABSENT");
  assert.equal(sdkPreflightRefusal({ adapterPackage: "adapter", model: null, credential: "credential" }), "MODEL_IDENTITY_REQUIRED");
  assert.equal(sdkPreflightRefusal({ adapterPackage: "adapter", model: "model", credential: undefined }), "CREDENTIAL_ABSENT");
  assert.equal(sdkPreflightRefusal({ adapterPackage: "adapter", model: "model", credential: "credential" }), null);
  const noRoute = unit("no-route", false, Object.freeze([]), "refused", "NO_ELIGIBLE_ROUTE");
  const noCredential = unit("no-credential", true, Object.freeze([preflight]), "refused", "CREDENTIAL_ABSENT");
  const noModel = unit("no-model", true, Object.freeze([preflight]), "refused", "TRANSPORT_MODEL_IDENTITY_REQUIRED");
  assert.deepEqual(projectGraphDispatchAccounting([noRoute, noCredential, noModel]), {
    plannedUnits: 3,
    eligibleUnits: 2,
    attemptedUnits: 2,
    contactedUnits: 0,
    contactedAttempts: 0,
    successfulUnits: 0,
    refusedUnits: 3,
  });
});

test("a contacted refusal counts the invocation while remaining unsuccessful", () => {
  assert.deepEqual(projectGraphDispatchAccounting([
    unit("provider-refusal", true, Object.freeze([contactedRefusal]), "refused", "PROVIDER_RATE_LIMITED"),
  ]), {
    plannedUnits: 1,
    eligibleUnits: 1,
    attemptedUnits: 1,
    contactedUnits: 1,
    contactedAttempts: 1,
    successfulUnits: 0,
    refusedUnits: 1,
  });
});

test("partial waves conserve every Hermes counter and compatibility alias", () => {
  const graphUnits = Object.freeze([
    unit("no-route", false, Object.freeze([]), "refused", "NO_ELIGIBLE_ROUTE"),
    unit("no-credential", true, Object.freeze([preflight]), "refused", "CREDENTIAL_ABSENT"),
    unit("provider-refusal", true, Object.freeze([contactedRefusal]), "refused", "PROVIDER_RATE_LIMITED"),
    unit("accepted", true, Object.freeze([contactedSuccess]), "ok", "INVOCATION_OK"),
    unit("structural-rejection", true, Object.freeze([contactedSuccess]), "ok", "INVOCATION_OK"),
  ]);
  const accounting = projectHermesDispatchAccounting({
    plannedUnits: Object.freeze([...graphUnits.map((entry) => entry.unit), "cache-reuse"]),
    graphRecords: graphUnits.map((entry) => Object.freeze({ ...entry })),
    terminalOutcomes: Object.freeze([
      { unit: "no-route", outcome: "refused" },
      { unit: "no-credential", outcome: "refused" },
      { unit: "provider-refusal", outcome: "refused" },
      { unit: "accepted", outcome: "accepted" },
      { unit: "structural-rejection", outcome: "output-refused" },
      { unit: "cache-reuse", outcome: "reused" },
    ]),
  });
  assert.deepEqual(accounting, {
    plannedUnits: 6,
    eligibleUnits: 4,
    attemptedUnits: 4,
    contactedUnits: 3,
    contactedAttempts: 3,
    successfulUnits: 2,
    refusedUnits: 4,
    structurallyAcceptedUnits: 1,
    reusedUnits: 1,
    dispatchedUnits: 3,
    modelInvocations: 3,
    cacheHits: 1,
    acceptedResults: 2,
  });
  assert.deepEqual(projectImplementationDispatchAccounting(Object.freeze({ ...accounting, accounting })), {
    ...accounting,
    accounting,
  });
  assert.throws(() => projectImplementationDispatchAccounting(Object.freeze({
    ...accounting, accounting, modelInvocations: 99,
  })), (error: unknown) => (error as { code?: unknown }).code === "HERMES_CYCLE_ACCOUNTING_INVALID");
});

test("accounting rejects missing, negative, contradictory and impossible records", () => {
  const valid = deriveHermesDispatchAccounting({
    plannedUnits: ["accepted"],
    graphUnits: [unit("accepted", true, [contactedSuccess], "ok", "INVOCATION_OK")],
    terminalOutcomes: [{ unit: "accepted", outcome: "accepted" }],
  });
  const rejects = (action: () => unknown): void => assert.throws(action,
    (error: unknown) => error instanceof DispatchAccountingRefusal);
  const { contactedAttempts: _omitted, ...missing } = valid;
  rejects(() => assertHermesDispatchAccounting(missing));
  rejects(() => assertHermesDispatchAccounting({ ...valid, contactedUnits: -1 }));
  rejects(() => assertHermesDispatchAccounting({ ...valid, dispatchedUnits: 0 }));
  rejects(() => assertHermesDispatchAccounting({ ...valid, structurallyAcceptedUnits: 0, refusedUnits: 0 }));
  rejects(() => deriveGraphDispatchAccounting([
    unit("forged-contact", true, [{ phase: "preflight", contacted: true, outcome: "refused" }], "refused", "REFUSED"),
  ]));
  rejects(() => deriveGraphDispatchAccounting([
    unit("forged-no-route", true, [], "refused", "NO_ELIGIBLE_ROUTE"),
  ]));
  rejects(() => deriveHermesDispatchAccounting({
    plannedUnits: ["reused"],
    graphUnits: [unit("reused", true, [contactedSuccess], "ok", "INVOCATION_OK")],
    terminalOutcomes: [{ unit: "reused", outcome: "reused" }],
  }));
});

test("persisted repair lineage retains exact successors and marks legacy parent absence", async () => {
  assert.deepEqual(deriveDispatchLineage({
    workIdentityDigest: digest("1"), executionEvidenceDigest: digest("2"), cacheEvidenceDigests: [],
    repairRound: 2, repairBasisDigest: digest("3"),
    parentWorkIdentityDigest: digest("4"), parentExecutionEvidenceDigest: digest("5"),
  }), {
    workIdentityDigest: digest("1"), executionEvidenceDigest: digest("2"), cacheEvidenceDigests: [],
    repairRound: 2, repairBasisDigest: digest("3"),
    parentWorkIdentityDigest: digest("4"), parentExecutionEvidenceDigest: digest("5"),
    parentLineageDisposition: "recorded",
  });
  assert.equal(deriveDispatchLineage({
    workIdentityDigest: digest("6"), executionEvidenceDigest: null,
    repairRound: 1, repairBasisDigest: digest("7"),
  }).parentLineageDisposition, "legacy-no-parent");
  assert.equal(deriveDispatchLineage({
    workIdentityDigest: digest("8"), executionEvidenceDigest: null,
    repairRound: 1, repairBasisDigest: digest("9"), parentWorkIdentityDigest: digest("a"),
  }).parentLineageDisposition, "prior-work-only");
  assert.equal(deriveDispatchLineage({
    workIdentityDigest: digest("b"), executionEvidenceDigest: null,
    cacheEvidenceDigests: [digest("d"), digest("c"), digest("d")],
    repairRound: 0, repairBasisDigest: null,
  }).cacheEvidenceDigests.join(","), `${digest("c")},${digest("d")}`);

  const root = await mkdtemp(resolve(tmpdir(), "usf-dispatch-accounting-"));
  try {
    await mkdir(resolve(root, ".usf/hermes"), { recursive: true, mode: 0o700 });
    await writeFile(resolve(root, ".usf/hermes/repair-rounds.json"), JSON.stringify({
      schema: "urn:usf:hermes-repair-rounds:1", version: 1,
      rounds: { legacy: { round: 1, basis: digest("e") }, retired: 4 },
    }), { mode: 0o600 });
    const legacy = await readRepairRounds(root);
    assert.deepEqual(legacy.legacy, {
      round: 1, basis: digest("e"), priorWorkIdentityDigest: null, priorExecutionEvidenceDigest: null,
    });
    assert.equal(legacy.retired?.basis, null);

    await writeRepairRounds(root, {
      successor: Object.freeze({
        round: 2, basis: digest("f"),
        priorWorkIdentityDigest: digest("1"), priorExecutionEvidenceDigest: digest("2"),
      }),
    });
    const persisted = JSON.parse(await readFile(resolve(root, ".usf/hermes/repair-rounds.json"), "utf8")) as {
      schema: string; version: number;
    };
    assert.deepEqual(persisted, {
      schema: "urn:usf:hermes-repair-rounds:2", version: 2,
      rounds: {
        successor: {
          round: 2, basis: digest("f"),
          priorWorkIdentityDigest: digest("1"), priorExecutionEvidenceDigest: digest("2"),
        },
      },
    });
    const successor = (await readRepairRounds(root)).successor!;
    assert.equal(deriveDispatchLineage({
      workIdentityDigest: digest("3"), executionEvidenceDigest: digest("4"),
      repairRound: successor.round, repairBasisDigest: successor.basis,
      parentWorkIdentityDigest: successor.priorWorkIdentityDigest,
      parentExecutionEvidenceDigest: successor.priorExecutionEvidenceDigest,
    }).parentLineageDisposition, "recorded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("timeout classes share bounded backoff while generic failures and success clearing stay stable", () => {
  for (const failures of [1, 2, 4, 9]) {
    assert.equal(deferralDurationMs("TRANSPORT_TIMEOUT", failures),
      deferralDurationMs("PROVIDER_TIMEOUT", failures));
  }
  assert.equal(deferralDurationMs("TRANSPORT_TIMEOUT", 1), 15 * 60_000);
  assert.equal(deferralDurationMs("TRANSPORT_TIMEOUT", 2), 30 * 60_000);
  assert.equal(deferralDurationMs("TRANSPORT_TIMEOUT", 9), 2 * 60 * 60_000);
  assert.equal(deferralDurationMs("PROVIDER_INVOCATION_FAILED", 1), 2 * 60_000);

  const cleared = applyRouteOutcomes({
    route: Object.freeze({
      candidateId: "route", reasonCode: "TRANSPORT_TIMEOUT", consecutiveFailures: 2,
      observedAtMs: 1, deferUntilMs: 999_999, attempts: 2, successes: 0, meanLatencyMs: 10,
    }),
  }, [{ candidateId: "route", outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 20 }], 100);
  assert.equal(cleared.route?.reasonCode, "INVOCATION_OK");
  assert.equal(cleared.route?.consecutiveFailures, 0);
  assert.equal(cleared.route?.deferUntilMs, 0);
});

test("the graph command emits no-route, preflight and contacted-refusal accounting without provider contact", async () => {
  const originalFetch = globalThis.fetch;
  const originalProviderHome = process.env.USF_PROVIDER_HOME;
  let fetchContacts = 0;
  globalThis.fetch = (() => {
    fetchContacts += 1;
    throw new Error("fixture attempted network contact");
  }) as typeof fetch;
  const roots: string[] = [];
  try {
    const execute = async (selectedModels: number, usable: boolean) => {
      const root = await graphCommandFixture(selectedModels);
      roots.push(root);
      process.env.USF_PROVIDER_HOME = resolve(root, ".usf/provider-home");
      let nativeInvocations = 0;
      const dependencies: GraphExecutionDependencies = Object.freeze({
        observeLocalAgentCapabilities: async (
          { observedAt, suppliedCredentialNames }:
          Parameters<GraphExecutionDependencies["observeLocalAgentCapabilities"]>[0],
        ) => {
          assert.deepEqual(suppliedCredentialNames, []);
          return usable ? [localCapability(true, observedAt) as never] : [];
        },
        invokeCli: async (
          { candidate }: Parameters<GraphExecutionDependencies["invokeCli"]>[0],
        ) => {
          nativeInvocations += 1;
          return Object.freeze({
            transport: candidate.transport,
            outcome: "refused" as const,
            reasonCode: "TRANSPORT_TIMEOUT",
            text: null,
            actualModel: "fixture-observed-model",
            invocationIdentity: "fixture-invocation",
            inputTokens: 7,
            outputTokens: 3,
            totalTokens: 10,
            cacheReadTokens: 2,
            cacheWriteTokens: 1,
            transportReportedCostUsd: 0.001,
            latencyMsReported: 12,
            retryAfter: null,
            refusalDetail: "offline fixture refusal",
          });
        },
      });
      const result = await graphExecuteCommand(root, [
        "--input", ".usf/work.nq",
        "--graph", "urn:usf:graph:dispatch-accounting-fixture",
        "--env-file", ".usf/empty.env",
        "--concurrency", "1",
      ], dependencies);
      return { root, nativeInvocations, output: result.output as Record<string, unknown> };
    };

    const noRoute = await execute(0, false);
    assert.equal(noRoute.nativeInvocations, 0);
    assert.deepEqual(noRoute.output.accounting, {
      plannedUnits: 1, eligibleUnits: 0, attemptedUnits: 0, contactedUnits: 0,
      contactedAttempts: 0, successfulUnits: 0, refusedUnits: 1,
    });
    const noRouteUnit = (noRoute.output.units as Record<string, unknown>[])[0]!;
    assert.equal(noRouteUnit.reasonCode, "NO_ELIGIBLE_ROUTE");
    assert.deepEqual(noRouteUnit.attempts, []);

    const missingModel = await execute(0, true);
    assert.equal(missingModel.nativeInvocations, 0);
    const missingModelUnit = (missingModel.output.units as Record<string, unknown>[])[0]!;
    const missingModelAttempt = (missingModelUnit.attempts as Record<string, unknown>[])[0]!;
    assert.equal(missingModelAttempt.reasonCode, "TRANSPORT_MODEL_IDENTITY_REQUIRED");
    assert.equal(missingModelAttempt.phase, "preflight");
    assert.equal(missingModelAttempt.contacted, false);

    const refused = await execute(1, true);
    assert.equal(refused.nativeInvocations, 1);
    assert.deepEqual(refused.output.accounting, {
      plannedUnits: 1, eligibleUnits: 1, attemptedUnits: 1, contactedUnits: 1,
      contactedAttempts: 1, successfulUnits: 0, refusedUnits: 1,
    });
    const refusedUnit = (refused.output.units as Record<string, unknown>[])[0]!;
    const refusedAttempt = (refusedUnit.attempts as Record<string, unknown>[])[0]!;
    assert.equal(refusedAttempt.phase, "invocation");
    assert.equal(refusedAttempt.contacted, true);
    assert.equal(refusedAttempt.requestedModel, "gemini-3.1-pro-low");
    assert.equal(refusedAttempt.actualModel, "fixture-observed-model");
    assert.deepEqual(refusedAttempt.usage, {
      inputTokens: 7, outputTokens: 3, totalTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1,
    });
    assert.equal(refusedAttempt.transportReportedCostUsd, 0.001);
    assert.deepEqual(refusedUnit.usage, refusedAttempt.usage);
    assert.equal(refusedUnit.transportReportedCostUsd, 0.001);
    const evidenceDigest = refused.output.evidenceDigest as string;
    const persisted = JSON.parse(await readFile(resolve(
      refused.root, ".usf/graph-executions", `${evidenceDigest.slice("sha256:".length)}.json`,
    ), "utf8")) as Record<string, unknown>;
    assert.deepEqual(persisted.accounting, refused.output.accounting);

    const emittedUnit = refusedUnit.unit as string;
    const hermesAccounting = projectHermesDispatchAccounting({
      plannedUnits: [emittedUnit],
      graphRecords: refused.output.units as Record<string, unknown>[],
      terminalOutcomes: [Object.freeze({ unit: emittedUnit, outcome: "refused" })],
    });
    assert.deepEqual(hermesAccounting, {
      plannedUnits: 1, eligibleUnits: 1, attemptedUnits: 1, contactedUnits: 1,
      contactedAttempts: 1, successfulUnits: 0, structurallyAcceptedUnits: 0,
      refusedUnits: 1, reusedUnits: 0, dispatchedUnits: 1, modelInvocations: 1,
      cacheHits: 0, acceptedResults: 0,
    });
    assert.deepEqual(projectImplementationDispatchAccounting(Object.freeze({
      accounting: hermesAccounting,
      ...hermesAccounting,
    })), Object.freeze({ accounting: hermesAccounting, ...hermesAccounting }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProviderHome === undefined) delete process.env.USF_PROVIDER_HOME;
    else process.env.USF_PROVIDER_HOME = originalProviderHome;
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
  assert.equal(fetchContacts, 0);
});
