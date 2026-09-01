export const BuildVersusComposeDecision = ['BUILD', 'COMPOSE', 'ADAPTER', 'DEFER', 'REJECT'] as const;
export type BuildVersusComposeDecision = typeof BuildVersusComposeDecision[number];

export const BuildVersusComposeCriteria = ['COST', 'CONTROL', 'READINESS'] as const;
export type BuildVersusComposeCriteria = typeof BuildVersusComposeCriteria[number];

export const BuildVersusComposeErrorKind = [
  'DECISION_INCOMPLETE',
  'JUSTIFICATION_MISSING',
  'CONTRADICTION_DETECTED',
  'AUTHORITY_VIOLATION',
  'PROOF_INCONSISTENT',
  'DEPENDENCY_UNAVAILABLE',
  'CONFIGURATION_LOSS',
  'SEMANTIC_DRIFT',
] as const;
export type BuildVersusComposeErrorKind = typeof BuildVersusComposeErrorKind[number];

export interface BuildVersusComposeError {
  readonly kind: BuildVersusComposeErrorKind;
  readonly message: string;
}

export interface DecisionJustification {
  readonly criteria: Readonly<Record<BuildVersusComposeCriteria, string>>;
  readonly rationale: string;
}

export interface DecisionRecord {
  readonly capabilityId: string;
  readonly decision: BuildVersusComposeDecision;
  readonly justification: DecisionJustification;
  readonly version: number;
  readonly supersededBy: string | null;
}

export interface ProofDocument {
  readonly decisionRecords: readonly DecisionRecord[];
  readonly consistencyCheck: boolean;
  readonly authorityOrder: readonly string[];
}

export const BuildVersusComposeReadiness = ['READY', 'NOT_READY'] as const;
export type BuildVersusComposeReadiness = typeof BuildVersusComposeReadiness[number];

export type BuildVersusComposeState = Readonly<{
  readonly readiness: BuildVersusComposeReadiness;
  readonly proofDocument: ProofDocument | null;
  readonly lastError: BuildVersusComposeError | null;
}>;

export const initialState: BuildVersusComposeState = {
  readiness: 'NOT_READY',
  proofDocument: null,
  lastError: null,
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

export function validateDecision(
  decision: unknown,
  authorityOrder: readonly string[],
): DecisionRecord | BuildVersusComposeError {
  if (!isObject(decision)) {
    return { kind: 'DECISION_INCOMPLETE', message: 'Decision record is missing required fields' };
  }

  if (
    !('capabilityId' in decision) ||
    !('decision' in decision) ||
    !('justification' in decision) ||
    !('version' in decision) ||
    !('supersededBy' in decision)
  ) {
    return { kind: 'DECISION_INCOMPLETE', message: 'Decision record is missing required fields' };
  }

  const d = decision as Record<string, unknown>;
  const capabilityId = d.capabilityId;
  const decisionValue = d.decision;
  const justification = d.justification;
  const version = d.version;
  const supersededBy = d.supersededBy;

  if (
    typeof capabilityId !== 'string' ||
    typeof decisionValue !== 'string' ||
    !BuildVersusComposeDecision.includes(decisionValue as BuildVersusComposeDecision) ||
    !isObject(justification) ||
    typeof version !== 'number' ||
    (supersededBy !== null && typeof supersededBy !== 'string')
  ) {
    return { kind: 'DECISION_INCOMPLETE', message: 'Decision record has invalid field types' };
  }

  if (!authorityOrder.includes(capabilityId)) {
    return { kind: 'AUTHORITY_VIOLATION', message: `Capability ${capabilityId} not in authority order` };
  }

  if (!('rationale' in justification) || !('criteria' in justification)) {
    return { kind: 'JUSTIFICATION_MISSING', message: 'Decision justification is incomplete or invalid' };
  }

  const rationale = justification.rationale;
  const criteria = justification.criteria;

  if (typeof rationale !== 'string' || !isObject(criteria)) {
    return { kind: 'JUSTIFICATION_MISSING', message: 'Decision justification is incomplete or invalid' };
  }

  const criteriaRecord: Record<string, string> = {};
  for (const c of BuildVersusComposeCriteria) {
    const criterionValue = criteria[c];
    if (typeof criterionValue !== 'string') {
      return { kind: 'JUSTIFICATION_MISSING', message: `Missing or invalid justification for criterion: ${c}` };
    }
    criteriaRecord[c] = criterionValue;
  }

  return {
    capabilityId,
    decision: decisionValue as BuildVersusComposeDecision,
    justification: {
      criteria: {
        COST: criteriaRecord.COST,
        CONTROL: criteriaRecord.CONTROL,
        READINESS: criteriaRecord.READINESS,
      },
      rationale,
    },
    version,
    supersededBy: supersededBy as string | null,
  };
}

export function validateProofDocument(
  proofDocument: unknown,
  authorityOrder: readonly string[],
): ProofDocument | BuildVersusComposeError {
  if (!isObject(proofDocument)) {
    return { kind: 'PROOF_INCONSISTENT', message: 'Proof document is missing required fields' };
  }

  if (
    !('decisionRecords' in proofDocument) ||
    !('consistencyCheck' in proofDocument) ||
    !('authorityOrder' in proofDocument)
  ) {
    return { kind: 'PROOF_INCONSISTENT', message: 'Proof document is missing required fields' };
  }

  const p = proofDocument as Record<string, unknown>;
  const decisionRecords = p.decisionRecords;
  const consistencyCheck = p.consistencyCheck;
  const proofAuthorityOrder = p.authorityOrder;

  if (
    !Array.isArray(decisionRecords) ||
    typeof consistencyCheck !== 'boolean' ||
    !Array.isArray(proofAuthorityOrder)
  ) {
    return { kind: 'PROOF_INCONSISTENT', message: 'Proof document has invalid field types' };
  }

  const validatedRecords: DecisionRecord[] = [];
  for (const record of decisionRecords) {
    const validatedRecord = validateDecision(record, authorityOrder);
    if ('kind' in validatedRecord) {
      return validatedRecord;
    }
    validatedRecords.push(validatedRecord);
  }

  const authorityOrderSet = new Set(authorityOrder);
  for (const record of validatedRecords) {
    if (!authorityOrderSet.has(record.capabilityId)) {
      return { kind: 'AUTHORITY_VIOLATION', message: `Capability ${record.capabilityId} not in authority order` };
    }
  }

  return {
    decisionRecords: validatedRecords,
    consistencyCheck: consistencyCheck as boolean,
    authorityOrder: proofAuthorityOrder as readonly string[],
  };
}

export function checkConsistency(
  proofDocument: ProofDocument,
): boolean {
  const capabilityDecisions = new Map<string, DecisionRecord>();
  for (const record of proofDocument.decisionRecords) {
    if (capabilityDecisions.has(record.capabilityId)) {
      return false;
    }
    capabilityDecisions.set(record.capabilityId, record);
  }
  return true;
}

export function checkDownstreamContracts(
  proofDocument: ProofDocument,
  downstreamContracts: Readonly<Record<string, Readonly<Record<string, string>>>,
): boolean {
  for (const record of proofDocument.decisionRecords) {
    const contract = downstreamContracts[record.capabilityId];
    if (contract !== undefined) {
      if (record.decision === 'COMPOSE' && contract.proofPosture === 'HIGH') {
        return false;
      }
    }
  }
  return true;
}

export function createDecisionRecord(
  capabilityId: string,
  decision: BuildVersusComposeDecision,
  justification: DecisionJustification,
  version: number,
  supersededBy: string | null = null,
): DecisionRecord {
  return {
    capabilityId,
    decision,
    justification,
    version,
    supersededBy,
  };
}

export function authorDecision(
  currentProof: ProofDocument | null,
  newRecord: DecisionRecord,
  authorityOrder: readonly string[],
): ProofDocument | BuildVersusComposeError {
  const validatedNewRecord = validateDecision(newRecord, authorityOrder);
  if ('kind' in validatedNewRecord) {
    return validatedNewRecord;
  }

  if (currentProof === null) {
    const newProof: ProofDocument = {
      decisionRecords: [validatedNewRecord],
      consistencyCheck: true,
      authorityOrder,
    };
    return newProof;
  }

  const existingRecordIndex = currentProof.decisionRecords.findIndex(
    (r) => r.capabilityId === validatedNewRecord.capabilityId,
  );
  if (existingRecordIndex !== -1) {
    const existingRecord = currentProof.decisionRecords[existingRecordIndex];
    if (validatedNewRecord.version <= existingRecord.version) {
      return {
        kind: 'PROOF_INCONSISTENT',
        message: `New decision version ${validatedNewRecord.version} must be greater than existing version ${existingRecord.version}`,
      };
    }
  }

  const updatedRecords = existingRecordIndex === -1
    ? [...currentProof.decisionRecords, validatedNewRecord]
    : currentProof.decisionRecords.map((r, i) =>
        i === existingRecordIndex ? validatedNewRecord : r,
      );

  const newProof: ProofDocument = {
    decisionRecords: updatedRecords,
    consistencyCheck: checkConsistency({ ...currentProof, decisionRecords: updatedRecords }),
    authorityOrder,
  };

  return newProof;
}

export function reviseDecision(
  currentProof: ProofDocument | null,
  capabilityId: string,
  newDecision: BuildVersusComposeDecision,
  newJustification: DecisionJustification,
  authorityOrder: readonly string[],
): ProofDocument | BuildVersusComposeError {
  if (currentProof === null) {
    return { kind: 'DEPENDENCY_UNAVAILABLE', message: 'No proof document available for revision' };
  }

  const existingRecord = currentProof.decisionRecords.find(
    (r) => r.capabilityId === capabilityId,
  );
  if (existingRecord === undefined) {
    return { kind: 'DECISION_INCOMPLETE', message: `No existing decision for capability ${capabilityId}` };
  }

  const newRecord: DecisionRecord = {
    ...existingRecord,
    decision: newDecision,
    justification: newJustification,
    version: existingRecord.version + 1,
    supersededBy: null,
  };

  return authorDecision(currentProof, newRecord, authorityOrder);
}

export function supersedeDecision(
  currentProof: ProofDocument | null,
  capabilityId: string,
  newRecord: DecisionRecord,
  authorityOrder: readonly string[],
): ProofDocument | BuildVersusComposeError {
  if (currentProof === null) {
    return { kind: 'DEPENDENCY_UNAVAILABLE', message: 'No proof document available for superseding' };
  }

  const existingRecord = currentProof.decisionRecords.find(
    (r) => r.capabilityId === capabilityId,
  );
  if (existingRecord === undefined) {
    return { kind: 'DECISION_INCOMPLETE', message: `No existing decision for capability ${capabilityId}` };
  }

  const validatedNewRecord = validateDecision(newRecord, authorityOrder);
  if ('kind' in validatedNewRecord) {
    return validatedNewRecord;
  }

  if (validatedNewRecord.version <= existingRecord.version) {
    return {
      kind: 'PROOF_INCONSISTENT',
      message: `New decision version ${validatedNewRecord.version} must be greater than existing version ${existingRecord.version}`,
    };
  }

  const updatedRecords = currentProof.decisionRecords.map((r) =>
    r.capabilityId === capabilityId ? { ...r, supersededBy: validatedNewRecord.capabilityId } : r,
  );

  const newProof: ProofDocument = {
    decisionRecords: [...updatedRecords, validatedNewRecord],
    consistencyCheck: checkConsistency({
      ...currentProof,
      decisionRecords: [...updatedRecords, validatedNewRecord],
    }),
    authorityOrder,
  };

  return newProof;
}

export function rollbackDecision(
  currentProof: ProofDocument | null,
  capabilityId: string,
): ProofDocument | BuildVersusComposeError {
  if (currentProof === null) {
    return { kind: 'DEPENDENCY_UNAVAILABLE', message: 'No proof document available for rollback' };
  }

  const existingRecord = currentProof.decisionRecords.find(
    (r) => r.capabilityId === capabilityId,
  );
  if (existingRecord === undefined) {
    return { kind: 'DECISION_INCOMPLETE', message: `No existing decision for capability ${capabilityId}` };
  }

  if (existingRecord.supersededBy === null) {
    return { kind: 'PROOF_INCONSISTENT', message: `No previous decision to rollback for capability ${capabilityId}` };
  }

  const previousRecord = currentProof.decisionRecords.find(
    (r) => r.capabilityId === existingRecord.supersededBy,
  );
  if (previousRecord === undefined) {
    return { kind: 'PROOF_INCONSISTENT', message: `Previous decision for capability ${capabilityId} not found` };
  }

  const updatedRecords = currentProof.decisionRecords
    .filter((r) => r.capabilityId !== capabilityId)
    .map((r) =>
      r.capabilityId === previousRecord.capabilityId
        ? { ...r, supersededBy: null }
        : r,
    );

  const newProof: ProofDocument = {
    decisionRecords: updatedRecords,
    consistencyCheck: checkConsistency({ ...currentProof, decisionRecords: updatedRecords }),
    authorityOrder: currentProof.authorityOrder,
  };

  return newProof;
}

export function computeReadiness(
  state: BuildVersusComposeState,
): BuildVersusComposeReadiness {
  if (
    state.proofDocument !== null &&
    state.proofDocument.consistencyCheck &&
    state.lastError === null &&
    state.proofDocument.decisionRecords.length > 0
  ) {
    return 'READY';
  }
  return 'NOT_READY';
}

export function runBuildVersusComposeFramework(
  state: BuildVersusComposeState,
  action: {
    readonly type: 'AUTHOR' | 'REVISE' | 'SUPERSEDE' | 'ROLLBACK';
    readonly capabilityId: string;
    readonly decision?: BuildVersusComposeDecision;
    readonly justification?: DecisionJustification;
    readonly newRecord?: DecisionRecord;
    readonly authorityOrder?: readonly string[];
  },
  auditFn: (record: DecisionRecord) => BuildVersusComposeError | null,
  downstreamContracts?: Readonly<Record<string, Readonly<Record<string, string>>>,
): BuildVersusComposeState {
  const authorityOrder = action.authorityOrder ?? state.proofDocument?.authorityOrder ?? [];

  if (state.proofDocument === null && action.type !== 'AUTHOR') {
    return {
      ...state,
      lastError: {
        kind: 'DEPENDENCY_UNAVAILABLE',
        message: 'No proof document available for mutation',
      },
      readiness: 'NOT_READY',
    };
  }

  if (action.type === 'AUTHOR' && action.newRecord === undefined) {
    return {
      ...state,
      lastError: { kind: 'DECISION_INCOMPLETE', message: 'New record is required for AUTHOR action' },
      readiness: 'NOT_READY',
    };
  }

  if (action.type === 'REVISE' && (action.decision === undefined || action.justification === undefined)) {
    return {
      ...state,
      lastError: { kind: 'DECISION_INCOMPLETE', message: 'Decision and justification are required for REVISE action' },
      readiness: 'NOT_READY',
    };
  }

  if (action.type === 'SUPERSEDE' && action.newRecord === undefined) {
    return {
      ...state,
      lastError: { kind: 'DECISION_INCOMPLETE', message: 'New record is required for SUPERSEDE action' },
      readiness: 'NOT_READY',
    };
  }

  let newProof: ProofDocument | null = state.proofDocument;
  let newError: BuildVersusComposeError | null = null;

  switch (action.type) {
    case 'AUTHOR': {
      const newRecord = action.newRecord as DecisionRecord;
      const auditError = auditFn(newRecord);
      if (auditError !== null) {
        return { ...state, lastError: auditError, readiness: 'NOT_READY' };
      }
      const authorResult = authorDecision(state.proofDocument, newRecord, authorityOrder);
      if ('kind' in authorResult) {
        newError = authorResult;
      } else {
        newProof = authorResult;
      }
      break;
    }
    case 'REVISE': {
      const reviseResult = reviseDecision(
        state.proofDocument,
        action.capabilityId,
        action.decision as BuildVersusComposeDecision,
        action.justification as DecisionJustification,
        authorityOrder,
      );
      if ('kind' in reviseResult) {
        newError = reviseResult;
      } else {
        newProof = reviseResult;
      }
      break;
    }
    case 'SUPERSEDE': {
      const newRecord = action.newRecord as DecisionRecord;
      const auditError = auditFn(newRecord);
      if (auditError !== null) {
        return { ...state, lastError: auditError, readiness: 'NOT_READY' };
      }
      const supersedeResult = supersedeDecision(state.proofDocument, action.capabilityId, newRecord, authorityOrder);
      if ('kind' in supersedeResult) {
        newError = supersedeResult;
      } else {
        newProof = supersedeResult;
      }
      break;
    }
    case 'ROLLBACK': {
      const rollbackResult = rollbackDecision(state.proofDocument, action.capabilityId);
      if ('kind' in rollbackResult) {
        newError = rollbackResult;
      } else {
        newProof = rollbackResult;
      }
      break;
    }
  }

  if (newProof !== null && downstreamContracts !== undefined) {
    if (!checkDownstreamContracts(newProof, downstreamContracts)) {
      newError = { kind: 'CONTRADICTION_DETECTED', message: 'Decision contradicts downstream semantic contracts' };
      newProof = state.proofDocument;
    }
  }

  return {
    ...state,
    proofDocument: newProof,
    lastError: newError,
    readiness: computeReadiness({ ...state, proofDocument: newProof, lastError: newError }),
  };
}