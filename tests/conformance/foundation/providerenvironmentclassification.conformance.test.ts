import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/foundation/providerenvironmentclassification.ts";

test("providerenvironmentclassificationauditmodel", () => {
  const recorded: capability.ClassificationAuditEvent[] = [];
  const auditFn = (event: capability.ClassificationAuditEvent): capability.ClassificationError | null => {
    recorded.push(event);
    return null;
  };

  const auditResult = capability.auditClassificationChange(
    "audit-test",
    "hermetic-mock",
    "test",
    null,
    null,
    auditFn,
  );
  assert.strictEqual(auditResult, null);
  assert.strictEqual(recorded.length, 1);
  const recordedEvent = recorded[0]!;
  assert.strictEqual(recordedEvent.kind, "CLASSIFICATION_CHANGE");
  assert.strictEqual(recordedEvent.provider, "audit-test");
  assert.strictEqual(recordedEvent.mode, "hermetic-mock");
  assert.strictEqual(recordedEvent.environment, "test");
  assert.ok(recordedEvent.timestamp.length > 0);
  assert.strictEqual(recordedEvent.previousMode, null);
  assert.strictEqual(recordedEvent.previousEnvironment, null);

  const throwingAuditFn = (): capability.ClassificationError | null => {
    throw new Error("audit boom");
  };
  const throwingResult = capability.auditClassificationChange(
    "audit-throw",
    "production-live",
    "live",
    "hermetic-mock",
    "test",
    throwingAuditFn,
  );
  assert.notStrictEqual(throwingResult, null);
  if (throwingResult !== null) {
    assert.strictEqual(throwingResult.kind, "DEGRADED");
    assert.ok(throwingResult.message.includes("audit boom"));
  }

  const badKindAuditFn = (
    _event: capability.ClassificationAuditEvent,
  ): capability.ClassificationError | null => {
    return {
      kind: "NOT_A_REAL_KIND" as unknown as capability.ClassificationErrorKind,
      message: "bad",
    };
  };
  const badKindResult = capability.auditClassificationChange(
    "audit-badkind",
    "production-live",
    "live",
    null,
    null,
    badKindAuditFn,
  );
  assert.notStrictEqual(badKindResult, null);
  if (badKindResult !== null) {
    assert.strictEqual(badKindResult.kind, "DEGRADED");
  }

  const degradedState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "pX", mode: "hermetic-mock", environment: "live" },
    ],
    lastError: null,
    readiness: "DEGRADED",
    proofStatus: "PENDING",
    auditLog: [],
  };

  const readinessCheck = capability.checkReadiness(degradedState);
  assert.strictEqual(readinessCheck.readiness, "DEGRADED");
  assert.notStrictEqual(readinessCheck.error, null);
  if (readinessCheck.error !== null) {
    assert.ok(
      readinessCheck.error.kind === "VALIDATION_FAILED" ||
        readinessCheck.error.kind === "PROOF_INVALID",
    );
  }
  // Read-only audit is still visible while degraded.
  assert.strictEqual(capability.listAuditLog(degradedState).length, 0);
  assert.notStrictEqual(capability.listAuditLog(degradedState), null);
});

test("providerenvironmentclassificationcontracts", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" },
      { provider: "p2", mode: "production-shaped", environment: "external" },
    ],
    lastError: null,
    readiness: "READY",
    proofStatus: "VALID",
    auditLog: [],
  };

  const result = capability.getEnvironmentClassificationMatrix(state);
  assert.strictEqual(result.error, null);
  assert.deepStrictEqual(result.matrix["p1"], { mode: "production-live", environment: "live" });
  assert.deepStrictEqual(result.matrix["p2"], { mode: "production-shaped", environment: "external" });

  const emptyState: capability.ProviderClassificationState = capability.initialState;
  const emptyResult = capability.getEnvironmentClassificationMatrix(emptyState);
  assert.notStrictEqual(emptyResult.error, null);
  if (emptyResult.error !== null) {
    assert.strictEqual(emptyResult.error.kind, "CONFIG_MISSING");
  }
  assert.deepStrictEqual(emptyResult.matrix, {});

  const inconsistentState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "bad", mode: "hermetic-mock", environment: "live" },
    ],
    lastError: null,
    readiness: "DEGRADED",
    proofStatus: "PENDING",
    auditLog: [],
  };
  const inconsistentResult = capability.getEnvironmentClassificationMatrix(inconsistentState);
  assert.notStrictEqual(inconsistentResult.error, null);
  assert.deepStrictEqual(inconsistentResult.matrix, {});

  // Missing or invalid configuration source fails closed without inventing defaults.
  const missingSource = capability.loadFromConfiguration(undefined);
  assert.strictEqual(missingSource.ok, false);
  if (missingSource.ok === false) {
    assert.strictEqual(missingSource.error.kind, "CONFIG_MISSING");
  }

  const badSource = capability.loadFromConfiguration({ providers: "not-an-array" });
  assert.strictEqual(badSource.ok, false);
  if (badSource.ok === false) {
    assert.strictEqual(badSource.error.kind, "CONFIG_MISSING");
  }

  const validSource = capability.loadFromConfiguration({
    providers: [
      { provider: "only", mode: "production-live", environment: "live" },
    ],
  });
  assert.strictEqual(validSource.ok, true);
  if (validSource.ok === true) {
    assert.strictEqual(validSource.state.readiness, "READY");
  }
});

test("providerenvironmentclassificationerrormodel", () => {
  const invalidState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "bad", mode: "hermetic-mock", environment: "live" },
    ],
    lastError: null,
    readiness: "DEGRADED",
    proofStatus: "PENDING",
    auditLog: [],
  };

  const readinessCheck = capability.checkReadiness(invalidState);
  assert.strictEqual(readinessCheck.readiness, "DEGRADED");
  assert.notStrictEqual(readinessCheck.error, null);
  if (readinessCheck.error !== null) {
    assert.ok(
      readinessCheck.error.kind === "VALIDATION_FAILED" ||
        readinessCheck.error.kind === "PROOF_INVALID",
    );
  }

  const missingState: capability.ProviderClassificationState = capability.initialState;
  const missingCheck = capability.checkReadiness(missingState);
  assert.strictEqual(missingCheck.readiness, "NOT_READY");
  assert.notStrictEqual(missingCheck.error, null);
  if (missingCheck.error !== null) {
    assert.strictEqual(missingCheck.error.kind, "CONFIG_MISSING");
  }

  const blockedEntry: capability.ProviderClassification = {
    provider: "blocked",
    mode: "hermetic-mock",
    environment: "live",
  };
  const setResult = capability.setProviderClassification(
    capability.initialState,
    "blocked",
    "hermetic-mock",
    "live",
    () => null,
  );
  assert.strictEqual(setResult.ok, false);
  if (setResult.ok === false) {
    assert.strictEqual(setResult.error.kind, "VALIDATION_FAILED");
  }
  const blockedValidate = capability.validateClassificationEntry(blockedEntry);
  assert.notStrictEqual(blockedValidate, null);
  if (blockedValidate !== null) {
    assert.strictEqual(blockedValidate.kind, "VALIDATION_FAILED");
  }

  // Error model: every declared error kind is alertable; nothing escapes silently.
  assert.strictEqual(capability.isAlertable({ kind: "DEGRADED", message: "x" }), true);
  assert.strictEqual(capability.isAlertable({ kind: "VALIDATION_FAILED", message: "x" }), true);
  assert.strictEqual(capability.isAlertable({ kind: "PROOF_PENDING", message: "x" }), true);
  assert.strictEqual(capability.isAlertable({ kind: "PROOF_INVALID", message: "x" }), true);
  assert.strictEqual(capability.isAlertable({ kind: "CONFIG_MISSING", message: "x" }), true);
  assert.strictEqual(capability.isAlertable({ kind: "CONFIG_INVALID", message: "x" }), true);

  const degraded = capability.degradedError("something failed");
  assert.strictEqual(degraded.kind, "DEGRADED");
  assert.strictEqual(capability.isAlertable(degraded), true);

  // Typed error factories produce the kind they advertise.
  assert.strictEqual(capability.configMissingError("m").kind, "CONFIG_MISSING");
  assert.strictEqual(capability.configInvalidError("m").kind, "CONFIG_INVALID");
  assert.strictEqual(capability.validationFailedError("m").kind, "VALIDATION_FAILED");
  assert.strictEqual(capability.proofPendingError("m").kind, "PROOF_PENDING");
  assert.strictEqual(capability.proofInvalidError("m").kind, "PROOF_INVALID");
});

test("providerenvironmentclassificationpermissions", () => {
  // No tenant mutators are exposed: only read-only inspection surfaces.
  const surfaces = capability.capabilitySurfaces();
  for (const surface of surfaces) {
    assert.ok(surface.startsWith("read:"));
  }
  assert.ok(surfaces.includes("read:classifications"));
  assert.ok(surfaces.includes("read:posture-labels"));
  assert.ok(surfaces.includes("read:readiness"));
  assert.ok(surfaces.includes("read:proof"));
  assert.ok(surfaces.includes("read:audit-log"));

  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "hermeticProvider", mode: "hermetic-mock", environment: "test" },
      { provider: "stagingProvider", mode: "production-shaped", environment: "external" },
      { provider: "liveProvider", mode: "production-live", environment: "live" },
    ],
    lastError: null,
    readiness: "READY",
    proofStatus: "VALID",
    auditLog: [],
  };

  const matrix = capability.getEnvironmentClassificationMatrix(state);
  assert.strictEqual(matrix.error, null);
  assert.strictEqual(matrix.matrix["hermeticProvider"]?.mode, "hermetic-mock");
  assert.strictEqual(matrix.matrix["hermeticProvider"]?.environment, "test");
  assert.strictEqual(matrix.matrix["stagingProvider"]?.mode, "production-shaped");
  assert.strictEqual(matrix.matrix["stagingProvider"]?.environment, "external");
  assert.strictEqual(matrix.matrix["liveProvider"]?.mode, "production-live");
  assert.strictEqual(matrix.matrix["liveProvider"]?.environment, "live");

  // Posture labelling is the indirect tenant impact: a hermetic/sandbox provider
  // must not be reported as production-live.
  assert.strictEqual(capability.canBeReportedAsLive(state, "hermeticProvider"), false);
  assert.strictEqual(capability.canBeReportedAsSandbox(state, "hermeticProvider"), true);
  assert.strictEqual(capability.canBeReportedAsLive(state, "stagingProvider"), false);
  assert.strictEqual(capability.canBeReportedAsLive(state, "liveProvider"), true);
  assert.strictEqual(capability.canBeReportedAsSandbox(state, "liveProvider"), false);

  // Unknown providers cannot be reported as production-live (fail closed).
  assert.strictEqual(capability.canBeReportedAsLive(state, "unconfigured"), false);
  assert.strictEqual(capability.canBeReportedAsSandbox(state, "unconfigured"), false);

  // Implicit posture upgrades are rejected at the boundary.
  const upgradeAttempt: capability.ProviderClassification = {
    provider: "p1",
    mode: "hermetic-mock",
    environment: "live",
  };
  const upgradeError = capability.validateClassificationEntry(upgradeAttempt);
  assert.notStrictEqual(upgradeError, null);
  if (upgradeError !== null) {
    assert.strictEqual(upgradeError.kind, "VALIDATION_FAILED");
  }
});

test("providerenvironmentclassificationproof", () => {
  const goodState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "good", mode: "production-live", environment: "live" },
    ],
    lastError: null,
    readiness: "READY",
    proofStatus: "PENDING",
    auditLog: [],
  };
  const goodProof = capability.runProof(goodState);
  assert.strictEqual(goodProof.proofId, capability.PROOF_ID);
  assert.strictEqual(goodProof.status, "PENDING");
  assert.ok(goodProof.details.includes("hermetic/runtime lineage"));
  assert.ok(goodProof.details.includes("independent"));
  assert.strictEqual(goodProof.lineage.length, 1);

  const emptyState: capability.ProviderClassificationState = capability.initialState;
  const pendingProof = capability.runProof(emptyState);
  assert.strictEqual(pendingProof.proofId, capability.PROOF_ID);
  assert.strictEqual(pendingProof.status, "PENDING");
  assert.strictEqual(pendingProof.lineage.length, 0);

  const badState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "bad", mode: "hermetic-mock", environment: "live" },
    ],
    lastError: null,
    readiness: "DEGRADED",
    proofStatus: "INVALID",
    auditLog: [],
  };
  const invalidProof = capability.runProof(badState);
  assert.strictEqual(invalidProof.proofId, capability.PROOF_ID);
  assert.strictEqual(invalidProof.status, "INVALID");
  assert.notStrictEqual(invalidProof.details, "");

  const generated = capability.generateProof(goodState);
  assert.strictEqual(generated.proofId, capability.PROOF_ID);
  assert.strictEqual(generated.status, "PENDING");
  assert.strictEqual(generated.lineage.length, 1);

  const prodShapedLiveState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "ps", mode: "production-shaped", environment: "live" },
    ],
    lastError: null,
    readiness: "DEGRADED",
    proofStatus: "INVALID",
    auditLog: [],
  };
  const psProof = capability.runProof(prodShapedLiveState);
  assert.strictEqual(psProof.status, "INVALID");

  // Fresh proof remains pending; VALID is not produced by this capability.
  assert.ok(goodProof.proofRunAt.length > 0);
  assert.ok(generated.proofRunAt.length > 0);
});

test("providerenvironmentclassificationreadinessmodel", () => {
  const readyState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "ready", mode: "production-live", environment: "live" },
    ],
    lastError: null,
    readiness: "READY",
    proofStatus: "VALID",
    auditLog: [],
  };
  const ready = capability.checkReadiness(readyState);
  assert.strictEqual(ready.readiness, "READY");
  assert.strictEqual(ready.error, null);

  const missingState: capability.ProviderClassificationState = capability.initialState;
  const missing = capability.checkReadiness(missingState);
  assert.strictEqual(missing.readiness, "NOT_READY");
  assert.notStrictEqual(missing.error, null);
  if (missing.error !== null) {
    assert.strictEqual(missing.error.kind, "CONFIG_MISSING");
  }

  const inconsistentState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "stale", mode: "hermetic-mock", environment: "live" },
    ],
    lastError: null,
    readiness: "DEGRADED",
    proofStatus: "PENDING",
    auditLog: [],
  };
  const inconsistent = capability.checkReadiness(inconsistentState);
  assert.strictEqual(inconsistent.readiness, "DEGRADED");
  assert.notStrictEqual(inconsistent.error, null);
  if (inconsistent.error !== null) {
    assert.ok(
      inconsistent.error.kind === "VALIDATION_FAILED" ||
        inconsistent.error.kind === "PROOF_INVALID",
    );
  }

  // Readiness is shown by re-running proof, not by the cached proofStatus.
  const stampedButBad: capability.ProviderClassificationState = {
    classifications: [
      { provider: "stale2", mode: "hermetic-mock", environment: "live" },
    ],
    lastError: null,
    readiness: "READY",
    proofStatus: "VALID",
    auditLog: [],
  };
  const recheck = capability.checkReadiness(stampedButBad);
  assert.strictEqual(recheck.readiness, "DEGRADED");
  assert.notStrictEqual(recheck.error, null);

  assert.strictEqual(capability.isReady(readyState), true);
  assert.strictEqual(capability.isReady(missingState), false);
  assert.strictEqual(capability.isReady(inconsistentState), false);
  assert.strictEqual(capability.isReady(stampedButBad), false);
  assert.strictEqual(capability.isDegraded(inconsistentState), true);
  assert.strictEqual(capability.isDegraded(readyState), false);

  // Stale or unknown classifications do not count as ready.
  const unknownOnlyState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "x", mode: "hermetic-mock", environment: "live" },
    ],
    lastError: null,
    readiness: "NOT_READY",
    proofStatus: "PENDING",
    auditLog: [],
  };
  assert.strictEqual(capability.isReady(unknownOnlyState), false);

  const validState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "ok", mode: "production-live", environment: "live" },
    ],
    lastError: null,
    readiness: "READY",
    proofStatus: "VALID",
    auditLog: [],
  };
  assert.strictEqual(capability.hasValidClassifications(validState), true);
  assert.strictEqual(capability.hasValidClassifications(missingState), false);
  assert.strictEqual(capability.hasValidClassifications(inconsistentState), false);
});

test("providerenvironmentclassificationvalidation", () => {
  const validEntry: capability.ProviderClassification = {
    provider: "ok",
    mode: "production-live",
    environment: "live",
  };
  const validError = capability.validateClassificationEntry(validEntry);
  assert.strictEqual(validError, null);

  const hermeticLiveEntry: capability.ProviderClassification = {
    provider: "ok",
    mode: "hermetic-mock",
    environment: "live",
  };
  const hermeticLiveError = capability.validateClassificationEntry(hermeticLiveEntry);
  assert.notStrictEqual(hermeticLiveError, null);
  if (hermeticLiveError !== null) {
    assert.strictEqual(hermeticLiveError.kind, "VALIDATION_FAILED");
  }

  const prodShapedLiveEntry: capability.ProviderClassification = {
    provider: "ok2",
    mode: "production-shaped",
    environment: "live",
  };
  const prodShapedLiveError = capability.validateClassificationEntry(prodShapedLiveEntry);
  assert.notStrictEqual(prodShapedLiveError, null);
  if (prodShapedLiveError !== null) {
    assert.strictEqual(prodShapedLiveError.kind, "VALIDATION_FAILED");
  }

  const dupEntries: readonly capability.ProviderClassification[] = [
    { provider: "dup", mode: "production-live", environment: "live" },
    { provider: "dup", mode: "production-shaped", environment: "external" },
  ];
  const dupError = capability.validateClassificationMatrix(dupEntries);
  assert.notStrictEqual(dupError, null);
  if (dupError !== null) {
    assert.strictEqual(dupError.kind, "VALIDATION_FAILED");
  }

  const consistentEntries: readonly capability.ProviderClassification[] = [
    { provider: "a", mode: "hermetic-mock", environment: "test" },
    { provider: "b", mode: "production-shaped", environment: "external" },
    { provider: "c", mode: "production-live", environment: "live" },
  ];
  const consistentError = capability.validateClassificationMatrix(consistentEntries);
  assert.strictEqual(consistentError, null);

  const invalidModeEntry: capability.ProviderClassification = {
    provider: "badmode",
    mode: "not-a-mode" as unknown as capability.ProviderMode,
    environment: "test",
  };
  const invalidModeError = capability.validateClassificationEntry(invalidModeEntry);
  assert.notStrictEqual(invalidModeError, null);
  if (invalidModeError !== null) {
    assert.strictEqual(invalidModeError.kind, "CONFIG_INVALID");
  }

  // Type guards round-trip the declared literals.
  assert.strictEqual(capability.isProviderMode("hermetic-mock"), true);
  assert.strictEqual(capability.isProviderMode("nope"), false);
  assert.strictEqual(capability.isEnvironment("live"), true);
  assert.strictEqual(capability.isEnvironment("nope"), false);

  assert.strictEqual(capability.isModeEnvironmentCompatible("hermetic-mock", "test"), true);
  assert.strictEqual(capability.isModeEnvironmentCompatible("hermetic-mock", "live"), false);
  assert.strictEqual(capability.isModeEnvironmentCompatible("production-shaped", "live"), false);
  assert.strictEqual(capability.isModeEnvironmentCompatible("production-live", "live"), true);
  assert.strictEqual(capability.isModeEnvironmentCompatible("production-shaped", "external"), true);

  // Empty matrix is CONFIG_MISSING.
  const emptyMatrixError = capability.validateClassificationMatrix([]);
  assert.notStrictEqual(emptyMatrixError, null);
  if (emptyMatrixError !== null) {
    assert.strictEqual(emptyMatrixError.kind, "CONFIG_MISSING");
  }
});