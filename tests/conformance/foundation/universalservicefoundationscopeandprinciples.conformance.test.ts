import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/foundation/universalservicefoundationscopeandprinciples.ts";

test("universalservicefoundationscopeandprinciplesauditmodel", () => {
  const auditEvent: capability.UniversalServiceFoundationScopeAndPrinciplesAuditEvent = {
    kind: "GOVERNANCE_RECORD_CHANGE",
    description: "ADR-001 foundation lineage update",
    timestamp: "2026-09-02T00:00:00.000Z",
  };

  const auditError = capability.auditGovernanceRecord(auditEvent, (evt) => {
    assert.equal(evt.kind, "GOVERNANCE_RECORD_CHANGE");
    return null;
  });
  assert.equal(auditError, null);

  const degradedState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    assetGraph: {
      capabilityInventory: ["cap-foundation"],
      statusVocabulary: ["READY", "DEGRADED", "NOT_READY"],
      v2Targets: [],
      completionActions: [],
      pathMap: {},
      proofInventory: [
        {
          capabilityId: "cap-foundation",
          proofStatus: "HERMETIC_PROVEN",
          evidenceHash: "sha256-evidence",
        },
      ],
      migrationChain: [],
      packageStatus: {},
      serviceMatrix: {},
      validatorFindings: [],
    },
    readiness: "DEGRADED",
    lastError: {
      kind: "SEMANTIC_DRIFT_DETECTED",
      message: "Non-fatal governance divergence",
    },
    auditTrail: [auditEvent],
  };

  const readinessReport = capability.getFoundationReadiness(degradedState);
  assert.equal(readinessReport.readiness, "DEGRADED");
  assert.equal(readinessReport.errors.length, 1);
  assert.equal(readinessReport.errors[0]?.kind, "SEMANTIC_DRIFT_DETECTED");
  assert.equal(degradedState.auditTrail.length, 1);
});

test("universalservicefoundationscopeandprinciplescontracts", () => {
  const missingConfigError = capability.validateConfiguration(null);
  assert.notEqual(missingConfigError, null);
  assert.equal(missingConfigError?.kind, "CONFIGURATION_MISSING");

  const invalidConfigError = capability.validateConfiguration({ invalidKey: true });
  assert.notEqual(invalidConfigError, null);
  assert.equal(invalidConfigError?.kind, "CONFIGURATION_INVALID");

  const validConfigError = capability.validateConfiguration({
    authorityOrder: ["cap-foundation"],
  });
  assert.equal(validConfigError, null);
});

test("universalservicefoundationscopeandprincipleserrormodel", () => {
  const state: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    ...capability.initialState,
    assetGraph: {
      ...capability.initialState.assetGraph,
      capabilityInventory: ["cap-allowed"],
      validatorFindings: ["FAIL: authority check failed"],
    },
  };

  const promoteUnauthorized = capability.promoteCapability(
    state,
    "cap-unauthorized",
    () => null,
  );
  assert.ok("kind" in promoteUnauthorized);
  assert.equal(promoteUnauthorized.kind, "AUTHORITY_ORDER_VIOLATION");

  const promoteFailingMatrix = capability.promoteCapability(
    state,
    "cap-allowed",
    () => null,
  );
  assert.ok("kind" in promoteFailingMatrix);
  assert.equal(promoteFailingMatrix.kind, "VALIDATION_FAILED");

  const readiness = capability.getFoundationReadiness(state);
  assert.equal(readiness.readiness, "NOT_READY");
  assert.ok(readiness.errors.some((e) => e.kind === "VALIDATION_FAILED"));
});

test("universalservicefoundationscopeandprincipleslifecycle", () => {
  const validState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    assetGraph: {
      capabilityInventory: ["cap-v2"],
      statusVocabulary: ["READY"],
      v2Targets: [],
      completionActions: [],
      pathMap: {},
      proofInventory: [
        {
          capabilityId: "cap-v2",
          proofStatus: "HERMETIC_PROVEN",
          evidenceHash: "hash-001",
        },
      ],
      migrationChain: [],
      packageStatus: {},
      serviceMatrix: {},
      validatorFindings: [],
    },
    readiness: "NOT_READY",
    lastError: null,
    auditTrail: [],
  };

  const promoted = capability.promoteCapability(
    validState,
    "cap-v2",
    () => null,
  );

  assert.ok(!("kind" in promoted));
  assert.deepEqual(promoted.assetGraph.v2Targets, ["cap-v2"]);
  assert.equal(promoted.readiness, "READY");
  assert.equal(promoted.auditTrail.length, 1);
  assert.equal(promoted.auditTrail[0]?.kind, "MATRIX_VALIDATION");

  const blocked = capability.promoteCapability(
    validState,
    "cap-unlisted",
    () => null,
  );
  assert.ok("kind" in blocked);
  assert.equal(blocked.kind, "AUTHORITY_ORDER_VIOLATION");
});

test("universalservicefoundationscopeandprinciplespermissions", () => {
  const authorityOrder: readonly string[] = ["cap-platform-core", "cap-identity"];

  const denied = capability.validateAuthorityOrder(
    "tenant-user-mutation",
    "applyPolicy",
    authorityOrder,
  );
  assert.notEqual(denied, null);
  assert.equal(denied?.kind, "AUTHORITY_ORDER_VIOLATION");

  const allowed = capability.validateAuthorityOrder(
    "cap-platform-core",
    "applyPolicy",
    authorityOrder,
  );
  assert.equal(allowed, null);
});

test("universalservicefoundationscopeandprinciplesproof", () => {
  const baseState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    ...capability.initialState,
    assetGraph: {
      ...capability.initialState.assetGraph,
      capabilityInventory: ["cap-hermetic"],
    },
  };

  const proofUpdated = capability.updateProofInventory(
    baseState,
    "cap-hermetic",
    "HERMETIC_PROVEN",
    "evidence-sha256",
    () => null,
  );

  assert.ok(!("kind" in proofUpdated));
  assert.equal(proofUpdated.assetGraph.proofInventory.length, 1);
  assert.equal(proofUpdated.assetGraph.proofInventory[0]?.proofStatus, "HERMETIC_PROVEN");
  assert.equal(proofUpdated.auditTrail[0]?.kind, "PROOF_INVENTORY_UPDATE");

  const deniedProof = capability.updateProofInventory(
    baseState,
    "unauthorized-cap",
    "HERMETIC_PROVEN",
    "evidence-sha256",
    () => null,
  );
  assert.ok("kind" in deniedProof);
  assert.equal(deniedProof.kind, "AUTHORITY_ORDER_VIOLATION");
});

test("universalservicefoundationscopeandprinciplesreadinessmodel", () => {
  const emptyState = capability.initialState;
  const emptyReadiness = capability.getFoundationReadiness(emptyState);
  assert.equal(emptyReadiness.readiness, "NOT_READY");
  assert.ok(emptyReadiness.errors.some((e) => e.kind === "SEMANTIC_DRIFT_DETECTED"));

  const staleProofState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    assetGraph: {
      capabilityInventory: ["cap-a"],
      statusVocabulary: [],
      v2Targets: [],
      completionActions: [],
      pathMap: {},
      proofInventory: [
        {
          capabilityId: "cap-a",
          proofStatus: "STALE",
          evidenceHash: "hash-stale",
        },
      ],
      migrationChain: [],
      packageStatus: {},
      serviceMatrix: {},
      validatorFindings: [],
    },
    readiness: "NOT_READY",
    lastError: null,
    auditTrail: [],
  };

  const staleReadiness = capability.getFoundationReadiness(staleProofState);
  assert.equal(staleReadiness.readiness, "NOT_READY");
  assert.ok(staleReadiness.errors.some((e) => e.kind === "PROOF_INCOMPLETE"));

  const validState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    assetGraph: {
      ...staleProofState.assetGraph,
      proofInventory: [
        {
          capabilityId: "cap-a",
          proofStatus: "HERMETIC_PROVEN",
          evidenceHash: "hash-fresh",
        },
      ],
    },
    readiness: "NOT_READY",
    lastError: null,
    auditTrail: [],
  };

  assert.equal(capability.checkReadiness(validState), "READY");
});

test("universalservicefoundationscopeandprinciplesstatemodel", () => {
  assert.deepEqual(capability.initialState.assetGraph.capabilityInventory, []);
  assert.deepEqual(capability.initialState.assetGraph.proofInventory, []);
  assert.deepEqual(capability.initialState.assetGraph.v2Targets, []);
  assert.equal(capability.initialState.readiness, "NOT_READY");
  assert.equal(capability.initialState.lastError, null);
  assert.deepEqual(capability.initialState.auditTrail, []);

  const stateWithCap: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    ...capability.initialState,
    assetGraph: {
      ...capability.initialState.assetGraph,
      capabilityInventory: ["cap-graph"],
    },
  };

  const nextState = capability.updateProofInventory(
    stateWithCap,
    "cap-graph",
    "HERMETIC_PROVEN",
    "hash-proof",
    () => null,
  );

  assert.ok(!("kind" in nextState));
  assert.notEqual(nextState, stateWithCap);
  assert.equal(nextState.assetGraph.proofInventory[0]?.capabilityId, "cap-graph");
  assert.equal(capability.initialState.assetGraph.proofInventory.length, 0);
});

test("universalservicefoundationscopeandprinciplesvalidation", () => {
  const failingState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    assetGraph: {
      capabilityInventory: ["cap-val"],
      statusVocabulary: [],
      v2Targets: [],
      completionActions: [],
      pathMap: {},
      proofInventory: [
        {
          capabilityId: "cap-val",
          proofStatus: "HERMETIC_PROVEN",
          evidenceHash: "hash",
        },
      ],
      migrationChain: [],
      packageStatus: {},
      serviceMatrix: {},
      validatorFindings: ["FAIL: matrix invariant violation"],
    },
    readiness: "NOT_READY",
    lastError: null,
    auditTrail: [],
  };

  const matrixError = capability.validateFoundationMatrix(failingState);
  assert.notEqual(matrixError, null);
  assert.equal(matrixError?.kind, "VALIDATION_FAILED");

  const unknownProofState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    ...failingState,
    assetGraph: {
      ...failingState.assetGraph,
      validatorFindings: [],
      proofInventory: [
        {
          capabilityId: "cap-val",
          proofStatus: "UNKNOWN",
          evidenceHash: "hash",
        },
      ],
    },
  };

  const unknownProofError = capability.validateFoundationMatrix(unknownProofState);
  assert.notEqual(unknownProofError, null);
  assert.equal(unknownProofError?.kind, "PROOF_INCOMPLETE");

  const cleanState: capability.UniversalServiceFoundationScopeAndPrinciplesState = {
    ...unknownProofState,
    assetGraph: {
      ...unknownProofState.assetGraph,
      proofInventory: [
        {
          capabilityId: "cap-val",
          proofStatus: "HERMETIC_PROVEN",
          evidenceHash: "hash",
        },
      ],
    },
  };

  assert.equal(capability.validateFoundationMatrix(cleanState), null);
  assert.equal(capability.validateSemanticCompleteness(cleanState), null);
});