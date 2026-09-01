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

export function validateDecision(
  decision: unknown,
): DecisionRecord | BuildVersusComposeError {
  if (
    decision === null ||
    typeof decision !== 'object' ||
    !('capabilityId' in decision) ||
    !('decision' in decision) ||
    !('justification' in decision) ||
    !('version' in decision) ||
    !('supersededBy' in decision)
  ) {
    return { kind: 'DECISION_INCOMPLETE', message: 'Decision record is missing required fields' };
  }

  const d = decision as Record<string, unknown>;
  if (
    typeof d.capabilityId !== 'string' ||
    !BuildVersusComposeDecision.includes(d.decision as BuildVersusComposeDecision) ||
    typeof d.justification !== 'object' ||
    d.justification === null ||
    typeof d.version !== 'number' ||
    (d.supersededBy !== null && typeof d.supersededBy !== 'string')
  ) {
    return { kind: 'DECISION_INCOMPLETE', message: 'Decision record has invalid field types' };
  }

  const justification = d.justification as Record<string, unknown>;
  if (
    typeof justification.rationale !== 'string' ||
    typeof justification.criteria !== 'object' ||
    justification.criteria === null
  ) {
    return { kind: 'JUSTIFICATION_MISSING', message: 'Decision justification is incomplete or invalid' };
  }

  const criteria = justification.criteria as Record<string, unknown>;
  for (const c of BuildVersusComposeCriteria) {
    if (!(c in criteria) || typeof criteria[c] !== 'string') {
      return { kind: 'JUSTIFICATION_MISSING', message: `Missing or invalid justification for criterion: ${c}` };
    }
  }

  return {
    capabilityId: d.capabilityId,
    decision: d.decision as BuildVersusComposeDecision,
    justification: {
      criteria: {
        COST: criteria.COST as string,
        CONTROL: criteria.CONTROL as string,
        READINESS: criteria.READINESS as string,
      },
      rationale: justification.rationale,
    },
    version: d.version,
    supersededBy: d.supersededBy as string | null,
  };
}

export function validateProofDocument(
  proofDocument: unknown,
  authorityOrder: readonly string[],
): ProofDocument | BuildVersusComposeError {
  if (
    proofDocument === null ||
    typeof proofDocument !== 'object' ||
    !('decisionRecords' in proofDocument) ||
    !('consistencyCheck' in proofDocument) ||
    !('authorityOrder' in proofDocument)
  ) {
    return { kind: 'PROOF_INCONSISTENT', message: 'Proof document is missing required fields' };
  }

  const p = proofDocument as Record<string, unknown>;
  if (
    !Array.isArray(p.decisionRecords) ||
    typeof p.consistencyCheck !== 'boolean' ||
    !Array.isArray(p.authorityOrder)
  ) {
    return { kind: 'PROOF_INCONSISTENT', message: 'Proof document has invalid field types' };
  }

  const decisionRecords: DecisionRecord[] = [];
  for (const record of p.decisionRecords) {
    const validatedRecord = validateDecision(record);
    if ('kind' in validatedRecord) {
      return validatedRecord;
    }
    decisionRecords.push(validatedRecord);
  }

  const authorityOrderSet = new Set(authorityOrder);
  for (const record of decisionRecords) {
    if (!authorityOrderSet.has(record.capabilityId)) {
      return { kind: 'AUTHORITY_VIOLATION', message: `Capability ${record.capabilityId} not in authority order` };
    }
  }

  return {
    decisionRecords,
    consistencyCheck: p.consistencyCheck as boolean,
    authorityOrder: p.authorityOrder as readonly string[],
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
): ProofDocument | BuildVersusComposeError {
  if (currentProof === null) {
    const newProof: ProofDocument = {
      decisionRecords: [newRecord],
      consistencyCheck: true,
      authorityOrder: [newRecord.capabilityId],
    };
    return newProof;
  }

  const validatedNewRecord = validateDecision(newRecord);
  if ('kind' in validatedNewRecord) {
    return validatedNewRecord;
  }

  const existingRecordIndex = currentProof.decisionRecords.findIndex(
    (r) => r.capabilityId === newRecord.capabilityId,
  );
  if (existingRecordIndex !== -1) {
    const existingRecord = currentProof.decisionRecords[existingRecordIndex];
    if (newRecord.version <= existingRecord.version) {
      return {
        kind: 'PROOF_INCONSISTENT',
        message: `New decision version ${newRecord.version} must be greater than existing version ${existingRecord.version}`,
      };
    }
  }

  const updatedRecords = existingRecordIndex === -1
    ? [...currentProof.decisionRecords, newRecord]
    : currentProof.decisionRecords.map((r, i) =>
        i === existingRecordIndex ? newRecord : r,
      );

  const newProof: ProofDocument = {
    decisionRecords: updatedRecords,
    consistencyCheck: checkConsistency({ ...currentProof, decisionRecords: updatedRecords }),
    authorityOrder: currentProof.authorityOrder,
  };

  return newProof;
}

export function reviseDecision(
  currentProof: ProofDocument,
  capabilityId: string,
  newDecision: BuildVersusComposeDecision,
  newJustification: DecisionJustification,
): ProofDocument | BuildVersusComposeError {
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

  return authorDecision(currentProof, newRecord);
}

export function supersedeDecision(
  currentProof: ProofDocument,
  capabilityId: string,
  newRecord: DecisionRecord,
): ProofDocument | BuildVersusComposeError {
  const existingRecord = currentProof.decisionRecords.find(
    (r) => r.capabilityId === capabilityId,
  );
  if (existingRecord === undefined) {
    return { kind: 'DECISION_INCOMPLETE', message: `No existing decision for capability ${capabilityId}` };
  }

  if (newRecord.version <= existingRecord.version) {
    return {
      kind: 'PROOF_INCONSISTENT',
      message: `New decision version ${newRecord.version} must be greater than existing version ${existingRecord.version}`,
    };
  }

  const updatedRecords = currentProof.decisionRecords.map((r) =>
    r.capabilityId === capabilityId ? { ...r, supersededBy: newRecord.capabilityId } : r,
  );

  const newProof: ProofDocument = {
    decisionRecords: [...updatedRecords, newRecord],
    consistencyCheck: checkConsistency({
      ...currentProof,
      decisionRecords: [...updatedRecords, newRecord],
    }),
    authorityOrder: currentProof.authorityOrder,
  };

  return newProof;
}

export function rollbackDecision(
  currentProof: ProofDocument,
  capabilityId: string,
): ProofDocument | BuildVersusComposeError {
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
    state.lastError === null
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
  },
): BuildVersusComposeState {
  if (state.proofDocument === null && action.type !== 'AUTHOR') {
    return {
      ...state,
      lastError: {
        kind: 'DEPENDENCY_UNAVAILABLE',
        message: 'No proof document available for mutation',
      },
    };
  }

  let newProof: ProofDocument | null = state.proofDocument;
  let newError: BuildVersusComposeError | null = null;

  switch (action.type) {
    case 'AUTHOR':
      if (action.newRecord === undefined) {
        newError = { kind: 'DECISION_INCOMPLETE', message: 'New record is required for AUTHOR action' };
        break;
      }
      const authorResult = authorDecision(state.proofDocument, action.newRecord);
      if ('kind' in authorResult) {
        newError = authorResult;
      } else {
        newProof = authorResult;
      }
      break;
    case 'REVISE':
      if (action.decision === undefined || action.justification === undefined) {
        newError = { kind: 'DECISION_INCOMPLETE', message: 'Decision and justification are required for REVISE action' };
        break;
      }
      const reviseResult = reviseDecision(state.proofDocument, action.capabilityId, action.decision, action.justification);
      if ('kind' in reviseResult) {
        newError = reviseResult;
      } else {
        newProof = reviseResult;
      }
      break;
    case 'SUPERSEDE':
      if (action.newRecord === undefined) {
        newError = { kind: 'DECISION_INCOMPLETE', message: 'New record is required for SUPERSEDE action' };
        break;
      }
      const supersedeResult = supersedeDecision(state.proofDocument, action.capabilityId, action.newRecord);
      if ('kind' in supersedeResult) {
        newError = supersedeResult;
      } else {
        newProof = supersedeResult;
      }
      break;
    case 'ROLLBACK':
      const rollbackResult = rollbackDecision(state.proofDocument, action.capabilityId);
      if ('kind' in rollbackResult) {
        newError = rollbackResult;
      } else {
        newProof = rollbackResult;
      }
      break;
    default:
      newError = { kind: 'PROOF_INCONSISTENT', message: `Unknown action type: ${(action as { type: string }).type}` };
  }

  return {
    ...state,
    proofDocument: newProof,
    lastError: newError,
    readiness: computeReadiness({ ...state, proofDocument: newProof, lastError: newError }),
  };
}