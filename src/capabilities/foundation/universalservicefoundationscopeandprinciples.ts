export const UniversalServiceFoundationScopeAndPrinciplesReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type UniversalServiceFoundationScopeAndPrinciplesReadiness = typeof UniversalServiceFoundationScopeAndPrinciplesReadiness[number];

export const UniversalServiceFoundationScopeAndPrinciplesErrorKind = [
  'CONFIGURATION_MISSING',
  'CONFIGURATION_INVALID',
  'PROOF_INCOMPLETE',
  'READINESS_BLOCKED',
  'SEMANTIC_DRIFT_DETECTED',
  'AUTHORITY_ORDER_VIOLATION',
  'VALIDATION_FAILED',
] as const;
export type UniversalServiceFoundationScopeAndPrinciplesErrorKind = typeof UniversalServiceFoundationScopeAndPrinciplesErrorKind[number];

export const UniversalServiceFoundationScopeAndPrinciplesAuditEventKind = [
  'GOVERNANCE_RECORD_CHANGE',
  'PROOF_INVENTORY_UPDATE',
  'MATRIX_VALIDATION',
] as const;
export type UniversalServiceFoundationScopeAndPrinciplesAuditEventKind = typeof UniversalServiceFoundationScopeAndPrinciplesAuditEventKind[number];

export const UniversalServiceFoundationScopeAndPrinciplesProofStatus = [
  'HERMETIC_PENDING',
  'HERMETIC_PROVEN',
  'STALE',
  'UNKNOWN',
] as const;
export type UniversalServiceFoundationScopeAndPrinciplesProofStatus = typeof UniversalServiceFoundationScopeAndPrinciplesProofStatus[number];

export interface UniversalServiceFoundationScopeAndPrinciplesAuditEvent {
  readonly kind: UniversalServiceFoundationScopeAndPrinciplesAuditEventKind;
  readonly description: string;
  readonly timestamp: string;
}

export interface UniversalServiceFoundationScopeAndPrinciplesError {
  readonly kind: UniversalServiceFoundationScopeAndPrinciplesErrorKind;
  readonly message: string;
}

export interface UniversalServiceFoundationScopeAndPrinciplesProofInventory {
  readonly capabilityId: string;
  readonly proofStatus: UniversalServiceFoundationScopeAndPrinciplesProofStatus;
  readonly evidenceHash: string;
}

export interface UniversalServiceFoundationScopeAndPrinciplesAssetGraph {
  readonly capabilityInventory: readonly string[];
  readonly statusVocabulary: readonly string[];
  readonly v2Targets: readonly string[];
  readonly completionActions: readonly string[];
  readonly pathMap: Record<string, readonly string[]>;
  readonly proofInventory: readonly UniversalServiceFoundationScopeAndPrinciplesProofInventory[];
  readonly migrationChain: readonly string[];
  readonly packageStatus: Record<string, string>;
  readonly serviceMatrix: Record<string, Record<string, string>>;
  readonly validatorFindings: readonly string[];
}

export interface UniversalServiceFoundationScopeAndPrinciplesState {
  readonly assetGraph: UniversalServiceFoundationScopeAndPrinciplesAssetGraph;
  readonly readiness: UniversalServiceFoundationScopeAndPrinciplesReadiness;
  readonly lastError: UniversalServiceFoundationScopeAndPrinciplesError | null;
  readonly auditTrail: readonly UniversalServiceFoundationScopeAndPrinciplesAuditEvent[];
}

export const initialState: UniversalServiceFoundationScopeAndPrinciplesState = {
  assetGraph: {
    capabilityInventory: [],
    statusVocabulary: [],
    v2Targets: [],
    completionActions: [],
    pathMap: {},
    proofInventory: [],
    migrationChain: [],
    packageStatus: {},
    serviceMatrix: {},
    validatorFindings: [],
  },
  readiness: 'NOT_READY',
  lastError: null,
  auditTrail: [],
};

export function validateAuthorityOrder(
  capabilityId: string,
  action: string,
  authorityOrder: readonly string[],
): UniversalServiceFoundationScopeAndPrinciplesError | null {
  if (!authorityOrder.includes(capabilityId)) {
    return {
      kind: 'AUTHORITY_ORDER_VIOLATION',
      message: `Capability ${capabilityId} not in authority order for action ${action}`,
    };
  }
  return null;
}

export function validateSemanticCompleteness(
  state: UniversalServiceFoundationScopeAndPrinciplesState,
): UniversalServiceFoundationScopeAndPrinciplesError | null {
  const { assetGraph } = state;
  if (assetGraph.capabilityInventory.length === 0) {
    return {
      kind: 'SEMANTIC_DRIFT_DETECTED',
      message: 'Capability inventory is empty',
    };
  }
  if (assetGraph.proofInventory.length !== assetGraph.capabilityInventory.length) {
    return {
      kind: 'PROOF_INCOMPLETE',
      message: 'Proof inventory does not match capability inventory',
    };
  }
  return null;
}

export function validateConfiguration(
  config: unknown,
): UniversalServiceFoundationScopeAndPrinciplesError | null {
  if (config === null || typeof config !== 'object') {
    return {
      kind: 'CONFIGURATION_MISSING',
      message: 'Configuration is missing or not an object',
    };
  }
  const configObj = config as Record<string, unknown>;
  if (!('authorityOrder' in configObj) || !Array.isArray(configObj.authorityOrder)) {
    return {
      kind: 'CONFIGURATION_INVALID',
      message: 'Authority order is missing or invalid',
    };
  }
  return null;
}

export function auditGovernanceRecord(
  event: UniversalServiceFoundationScopeAndPrinciplesAuditEvent,
  auditFn: (event: UniversalServiceFoundationScopeAndPrinciplesAuditEvent) => UniversalServiceFoundationScopeAndPrinciplesError | null,
): UniversalServiceFoundationScopeAndPrinciplesError | null {
  return auditFn(event);
}

export function updateProofInventory(
  state: UniversalServiceFoundationScopeAndPrinciplesState,
  capabilityId: string,
  proofStatus: UniversalServiceFoundationScopeAndPrinciplesProofStatus,
  evidenceHash: string,
  auditFn: (event: UniversalServiceFoundationScopeAndPrinciplesAuditEvent) => UniversalServiceFoundationScopeAndPrinciplesError | null,
): UniversalServiceFoundationScopeAndPrinciplesState | UniversalServiceFoundationScopeAndPrinciplesError {
  const validationError = validateAuthorityOrder(capabilityId, 'updateProofInventory', state.assetGraph.capabilityInventory);
  if (validationError !== null) {
    return validationError;
  }

  const auditEvent: UniversalServiceFoundationScopeAndPrinciplesAuditEvent = {
    kind: 'PROOF_INVENTORY_UPDATE',
    description: `Updated proof for ${capabilityId} to ${proofStatus}`,
    timestamp: new Date().toISOString(),
  };
  const auditError = auditGovernanceRecord(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const existingIndex = state.assetGraph.proofInventory.findIndex(
    (pi) => pi.capabilityId === capabilityId,
  );
  const newProofInventory = [...state.assetGraph.proofInventory];
  if (existingIndex >= 0) {
    newProofInventory[existingIndex] = { capabilityId, proofStatus, evidenceHash };
  } else {
    newProofInventory.push({ capabilityId, proofStatus, evidenceHash });
  }

  const semanticError = validateSemanticCompleteness({
    ...state,
    assetGraph: { ...state.assetGraph, proofInventory: newProofInventory },
  });
  if (semanticError !== null) {
    return semanticError;
  }

  return {
    ...state,
    assetGraph: { ...state.assetGraph, proofInventory: newProofInventory },
    lastError: null,
    auditTrail: [...state.auditTrail, auditEvent],
  };
}

export function validateFoundationMatrix(
  state: UniversalServiceFoundationScopeAndPrinciplesState,
): UniversalServiceFoundationScopeAndPrinciplesError | null {
  const { assetGraph } = state;
  if (assetGraph.validatorFindings.some((f) => f.includes('FAIL'))) {
    return {
      kind: 'VALIDATION_FAILED',
      message: 'Validator findings contain failures',
    };
  }
  if (assetGraph.proofInventory.some((pi) => pi.proofStatus === 'STALE' || pi.proofStatus === 'UNKNOWN')) {
    return {
      kind: 'PROOF_INCOMPLETE',
      message: 'Proof inventory contains stale or unknown entries',
    };
  }
  return null;
}

export function checkReadiness(
  state: UniversalServiceFoundationScopeAndPrinciplesState,
): UniversalServiceFoundationScopeAndPrinciplesReadiness {
  const validationError = validateFoundationMatrix(state);
  if (validationError !== null) {
    return 'NOT_READY';
  }
  const semanticError = validateSemanticCompleteness(state);
  if (semanticError !== null) {
    return 'NOT_READY';
  }
  if (state.lastError !== null) {
    return 'DEGRADED';
  }
  return 'READY';
}

export function promoteCapability(
  state: UniversalServiceFoundationScopeAndPrinciplesState,
  capabilityId: string,
  auditFn: (event: UniversalServiceFoundationScopeAndPrinciplesAuditEvent) => UniversalServiceFoundationScopeAndPrinciplesError | null,
): UniversalServiceFoundationScopeAndPrinciplesState | UniversalServiceFoundationScopeAndPrinciplesError {
  const validationError = validateAuthorityOrder(capabilityId, 'promoteCapability', state.assetGraph.capabilityInventory);
  if (validationError !== null) {
    return validationError;
  }

  const matrixError = validateFoundationMatrix(state);
  if (matrixError !== null) {
    return matrixError;
  }

  const auditEvent: UniversalServiceFoundationScopeAndPrinciplesAuditEvent = {
    kind: 'MATRIX_VALIDATION',
    description: `Promoting capability ${capabilityId} after matrix validation`,
    timestamp: new Date().toISOString(),
  };
  const auditError = auditGovernanceRecord(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newV2Targets = [...state.assetGraph.v2Targets, capabilityId];
  return {
    ...state,
    assetGraph: { ...state.assetGraph, v2Targets: newV2Targets },
    readiness: checkReadiness({ ...state, auditTrail: [...state.auditTrail, auditEvent] }),
    lastError: null,
    auditTrail: [...state.auditTrail, auditEvent],
  };
}

export function getFoundationReadiness(
  state: UniversalServiceFoundationScopeAndPrinciplesState,
): {
  readonly readiness: UniversalServiceFoundationScopeAndPrinciplesReadiness;
  readonly errors: readonly UniversalServiceFoundationScopeAndPrinciplesError[];
} {
  const errors: UniversalServiceFoundationScopeAndPrinciplesError[] = [];
  const semanticError = validateSemanticCompleteness(state);
  if (semanticError !== null) {
    errors.push(semanticError);
  }
  const matrixError = validateFoundationMatrix(state);
  if (matrixError !== null) {
    errors.push(matrixError);
  }
  if (state.lastError !== null) {
    errors.push(state.lastError);
  }

  return {
    readiness: checkReadiness(state),
    errors,
  };
}