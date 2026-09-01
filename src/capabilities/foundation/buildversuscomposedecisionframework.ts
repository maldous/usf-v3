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

export const BuildVersusComposeAuditEventKind = ['DECISION_CREATED', 'DECISION_REVISED', 'DECISION_SUPERSEDED', 'DECISION_ROLLED_BACK'] as const;
export type BuildVersusComposeAuditEventKind = typeof BuildVersusComposeAuditEventKind[number];

export const BuildVersusComposeReadiness = ['READY', 'NOT_READY'] as const;
export type BuildVersusComposeReadiness = typeof BuildVersusComposeReadiness[number];

export interface BuildVersusComposeError {
  readonly kind: BuildVersusComposeErrorKind;
  readonly message: string;
}

export interface DecisionJustification {
  readonly criteria: Readonly<Record<BuildVersusComposeCriteria, string>>;
  readonly rationale: string;
}

export interface DecisionRecord {
  readonly id: string;
  readonly capabilityId: string;
  readonly decision: BuildVersusComposeDecision;
  readonly justification: DecisionJustification;
  readonly version: number;
  readonly authority: string;
  readonly supersededBy: string | null;
}

export interface BuildVersusComposeAuditEvent {
  readonly kind: BuildVersusComposeAuditEventKind;
  readonly decisionId: string;
  readonly capabilityId: string;
  readonly version: number;
  readonly authority: string;
  readonly timestamp: string;
}

export interface ProofDocument {
  readonly decisionRecords: readonly DecisionRecord[];
  readonly consistencyCheck: boolean;
  readonly authorityOrder: readonly string[];
  readonly proofRun: boolean;
}

export interface BuildVersusComposeState {
  readonly inScopeCapabilities: readonly string[];
  readonly decisionRecords: readonly DecisionRecord[];
  readonly authorityOrder: readonly string[];
  readonly readiness: BuildVersusComposeReadiness;
  readonly proofDocument: ProofDocument | null;
  readonly lastError: BuildVersusComposeError | null;
  readonly auditTrail: readonly BuildVersusComposeAuditEvent[];
}

export const initialState: BuildVersusComposeState = {
  inScopeCapabilities: [],
  decisionRecords: [],
  authorityOrder: [],
  readiness: 'NOT_READY',
  proofDocument: null,
  lastError: null,
  auditTrail: [],
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

function createError(kind: BuildVersusComposeErrorKind, message: string): BuildVersusComposeError {
  return { kind, message };
}

function validateDecisionRecord(record: unknown): record is DecisionRecord {
  if (!isObject(record)) return false;
  return (
    typeof record.id === 'string' &&
    typeof record.capabilityId === 'string' &&
    BuildVersusComposeDecision.includes(record.decision as BuildVersusComposeDecision) &&
    isObject(record.justification) &&
    typeof record.version === 'number' &&
    typeof record.authority === 'string' &&
    (record.supersededBy === null || typeof record.supersededBy === 'string')
  );
}

function validateJustification(justification: unknown): justification is DecisionJustification {
  if (!isObject(justification)) return false;
  const criteria = justification.criteria;
  if (!isObject(criteria)) return false;
  return (
    typeof justification.rationale === 'string' &&
    BuildVersusComposeCriteria.every((c) => typeof criteria[c] === 'string' && criteria[c] !== '')
  );
}

function validateAuthority(authority: string, authorityOrder: readonly string[]): boolean {
  return authorityOrder.includes(authority);
}

function validateDecisionCompleteness(record: DecisionRecord): BuildVersusComposeError | null {
  if (!record.decision) {
    return createError('DECISION_INCOMPLETE', `Decision incomplete for capability ${record.capabilityId}`);
  }
  if (!validateJustification(record.justification)) {
    return createError('JUSTIFICATION_MISSING', `Justification missing for capability ${record.capabilityId}`);
  }
  return null;
}

function validateDecisionConsistency(records: readonly DecisionRecord[]): BuildVersusComposeError | null {
  const capabilities = new Set<string>();
  for (const record of records) {
    if (record.supersededBy !== null) continue;
    if (capabilities.has(record.capabilityId)) {
      return createError('CONTRADICTION_DETECTED', `Multiple active decisions for capability ${record.capabilityId}`);
    }
    capabilities.add(record.capabilityId);
  }
  return null;
}

function validateAuthorityOrder(records: readonly DecisionRecord[], authorityOrder: readonly string[]): BuildVersusComposeError | null {
  for (const record of records) {
    if (record.supersededBy !== null) continue;
    if (!validateAuthority(record.authority, authorityOrder)) {
      return createError('AUTHORITY_VIOLATION', `Authority ${record.authority} not in authority order`);
    }
  }
  return null;
}

function validateProofDocument(proof: ProofDocument): BuildVersusComposeError | null {
  if (!proof.consistencyCheck) {
    return createError('PROOF_INCONSISTENT', 'Proof document consistency check failed');
  }
  const consistencyError = validateDecisionConsistency(proof.decisionRecords);
  if (consistencyError) return consistencyError;
  const authorityError = validateAuthorityOrder(proof.decisionRecords, proof.authorityOrder);
  if (authorityError) return authorityError;
  for (const record of proof.decisionRecords) {
    const completenessError = validateDecisionCompleteness(record);
    if (completenessError) return completenessError;
  }
  return null;
}

function computeReadiness(state: BuildVersusComposeState): BuildVersusComposeReadiness {
  if (state.proofDocument === null) return 'NOT_READY';
  if (!state.proofDocument.consistencyCheck) return 'NOT_READY';
  const activeCapabilities = new Set(
    state.proofDocument.decisionRecords
      .filter(r => r.supersededBy === null)
      .map(r => r.capabilityId)
  );
  for (const cap of state.inScopeCapabilities) {
    if (!activeCapabilities.has(cap)) return 'NOT_READY';
  }
  return 'READY';
}

function runProof(state: BuildVersusComposeState): BuildVersusComposeState {
  const activeRecords = state.decisionRecords.filter(r => r.supersededBy === null);
  const consistencyError = validateDecisionConsistency(activeRecords);
  const authorityError = validateAuthorityOrder(activeRecords, state.authorityOrder);
  const consistencyCheck = consistencyError === null && authorityError === null;

  const proofDocument: ProofDocument = {
    decisionRecords: state.decisionRecords,
    consistencyCheck,
    authorityOrder: state.authorityOrder,
    proofRun: true,
  };

  const proofError = validateProofDocument(proofDocument);
  const readiness = proofError === null ? computeReadiness({ ...state, proofDocument }) : 'NOT_READY';

  return {
    ...state,
    proofDocument,
    readiness,
    lastError: proofError,
  };
}

function auditDecisionChange(
  kind: BuildVersusComposeAuditEventKind,
  decisionId: string,
  capabilityId: string,
  version: number,
  authority: string,
  timestamp: string
): BuildVersusComposeAuditEvent {
  return {
    kind,
    decisionId,
    capabilityId,
    version,
    authority,
    timestamp,
  };
}

function generateDecisionId(capabilityId: string, version: number): string {
  return `${capabilityId}@${version}`;
}

function getNextVersion(records: readonly DecisionRecord[], capabilityId: string): number {
  const versions = records.filter(r => r.capabilityId === capabilityId).map(r => r.version);
  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

function createAuditFn(
  state: BuildVersusComposeState
): (event: BuildVersusComposeAuditEvent) => BuildVersusComposeError | null {
  return (event: BuildVersusComposeAuditEvent): BuildVersusComposeError | null => {
    return null;
  };
}

export function createDecision(
  state: BuildVersusComposeState,
  capabilityId: string,
  decision: BuildVersusComposeDecision,
  justification: DecisionJustification,
  authority: string,
  auditFn: (event: BuildVersusComposeAuditEvent) => BuildVersusComposeError | null,
  timestamp: string
): { readonly kind: 'SUCCESS'; readonly state: BuildVersusComposeState } | BuildVersusComposeError {
  if (state.decisionRecords.some(r => r.capabilityId === capabilityId && r.supersededBy === null)) {
    return createError('CONTRADICTION_DETECTED', `Capability ${capabilityId} already has active decision`);
  }
  if (!validateJustification(justification)) {
    return createError('JUSTIFICATION_MISSING', 'Invalid justification');
  }
  if (!validateAuthority(authority, state.authorityOrder)) {
    return createError('AUTHORITY_VIOLATION', `Authority ${authority} not authorized`);
  }

  const version = getNextVersion(state.decisionRecords, capabilityId);
  const id = generateDecisionId(capabilityId, version);
  const record: DecisionRecord = { id, capabilityId, decision, justification, version, authority, supersededBy: null };
  const event = auditDecisionChange('DECISION_CREATED', id, capabilityId, version, authority, timestamp);

  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }

  const newState: BuildVersusComposeState = {
    ...state,
    decisionRecords: [...state.decisionRecords, record],
    lastError: null,
    auditTrail: [...state.auditTrail, event],
  };

  return { kind: 'SUCCESS', state: runProof(newState) };
}

export function reviseDecision(
  state: BuildVersusComposeState,
  capabilityId: string,
  decision: BuildVersusComposeDecision,
  justification: DecisionJustification,
  authority: string,
  auditFn: (event: BuildVersusComposeAuditEvent) => BuildVersusComposeError | null,
  timestamp: string
): { readonly kind: 'SUCCESS'; readonly state: BuildVersusComposeState } | BuildVersusComposeError {
  const activeRecord = state.decisionRecords.find(r => r.capabilityId === capabilityId && r.supersededBy === null);
  if (!activeRecord) {
    return createError('CONFIGURATION_LOSS', `No active decision found for capability ${capabilityId}`);
  }
  if (!validateJustification(justification)) {
    return createError('JUSTIFICATION_MISSING', 'Invalid justification');
  }
  if (!validateAuthority(authority, state.authorityOrder)) {
    return createError('AUTHORITY_VIOLATION', `Authority ${authority} not authorized`);
  }

  const newVersion = activeRecord.version + 1;
  const newId = generateDecisionId(capabilityId, newVersion);
  const newRecord: DecisionRecord = {
    id: newId,
    capabilityId,
    decision,
    justification,
    version: newVersion,
    authority,
    supersededBy: activeRecord.id
  };
  const event = auditDecisionChange('DECISION_REVISED', newId, capabilityId, newVersion, authority, timestamp);

  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }

  const newState: BuildVersusComposeState = {
    ...state,
    decisionRecords: [
      ...state.decisionRecords.filter(r => r.id !== activeRecord.id),
      newRecord
    ],
    lastError: null,
    auditTrail: [...state.auditTrail, event],
  };

  return { kind: 'SUCCESS', state: runProof(newState) };
}

export function supersedeDecision(
  state: BuildVersusComposeState,
  capabilityId: string,
  authority: string,
  auditFn: (event: BuildVersusComposeAuditEvent) => BuildVersusComposeError | null,
  timestamp: string
): { readonly kind: 'SUCCESS'; readonly state: BuildVersusComposeState } | BuildVersusComposeError {
  const activeRecord = state.decisionRecords.find(r => r.capabilityId === capabilityId && r.supersededBy === null);
  if (!activeRecord) {
    return createError('CONFIGURATION_LOSS', `No active decision found for capability ${capabilityId}`);
  }
  if (!validateAuthority(authority, state.authorityOrder)) {
    return createError('AUTHORITY_VIOLATION', `Authority ${authority} not authorized`);
  }

  const newVersion = activeRecord.version + 1;
  const newId = generateDecisionId(capabilityId, newVersion);
  const newRecord: DecisionRecord = {
    id: newId,
    capabilityId,
    decision: activeRecord.decision,
    justification: activeRecord.justification,
    version: newVersion,
    authority,
    supersededBy: activeRecord.id
  };
  const event = auditDecisionChange('DECISION_SUPERSEDED', newId, capabilityId, newVersion, authority, timestamp);

  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }

  const newState: BuildVersusComposeState = {
    ...state,
    decisionRecords: [
      ...state.decisionRecords.filter(r => r.id !== activeRecord.id),
      newRecord
    ],
    lastError: null,
    auditTrail: [...state.auditTrail, event],
  };

  return { kind: 'SUCCESS', state: runProof(newState) };
}

export function rollbackDecision(
  state: BuildVersusComposeState,
  capabilityId: string,
  authority: string,
  auditFn: (event: BuildVersusComposeAuditEvent) => BuildVersusComposeError | null,
  timestamp: string
): { readonly kind: 'SUCCESS'; readonly state: BuildVersusComposeState } | BuildVersusComposeError {
  const activeRecord = state.decisionRecords.find(r => r.capabilityId === capabilityId && r.supersededBy === null);
  if (!activeRecord) {
    return createError('CONFIGURATION_LOSS', `No active decision found for capability ${capabilityId}`);
  }
  const supersededRecords = state.decisionRecords.filter(r => r.capabilityId === capabilityId && r.supersededBy !== null);
  if (supersededRecords.length === 0) {
    return createError('CONFIGURATION_LOSS', `No superseded decision found for capability ${capabilityId}`);
  }
  const previousRecord = supersededRecords.reduce((prev, current) =>
    current.version > prev.version ? current : prev
  );
  const targetRecord = state.decisionRecords.find(r => r.id === previousRecord.supersededBy);
  if (!targetRecord) {
    return createError('CONFIGURATION_LOSS', `Previous decision for capability ${capabilityId} not found`);
  }
  if (!validateAuthority(authority, state.authorityOrder)) {
    return createError('AUTHORITY_VIOLATION', `Authority ${authority} not authorized`);
  }

  const event = auditDecisionChange('DECISION_ROLLED_BACK', targetRecord.id, capabilityId, targetRecord.version, authority, timestamp);

  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }

  const newState: BuildVersusComposeState = {
    ...state,
    decisionRecords: state.decisionRecords.map(r =>
      r.id === activeRecord.id ? { ...activeRecord, supersededBy: targetRecord.id } : r
    ),
    lastError: null,
    auditTrail: [...state.auditTrail, event],
  };

  return { kind: 'SUCCESS', state: runProof(newState) };
}

export function initializeFramework(
  state: BuildVersusComposeState,
  inScopeCapabilities: readonly string[],
  authorityOrder: readonly string[],
  auditFn: (event: BuildVersusComposeAuditEvent) => BuildVersusComposeError | null,
  timestamp: string
): { readonly kind: 'SUCCESS'; readonly state: BuildVersusComposeState } | BuildVersusComposeError {
  const event = auditDecisionChange('DECISION_CREATED', 'framework-init', 'framework', 1, 'platform', timestamp);

  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }

  const newState: BuildVersusComposeState = {
    ...state,
    inScopeCapabilities,
    authorityOrder,
    lastError: null,
    auditTrail: [...state.auditTrail, event],
  };

  return { kind: 'SUCCESS', state: runProof(newState) };
}

export function validateFramework(
  state: BuildVersusComposeState
): BuildVersusComposeError | null {
  if (state.proofDocument === null) {
    return createError('PROOF_INCONSISTENT', 'No proof document available');
  }

  const validationError = validateProofDocument(state.proofDocument);
  if (validationError) {
    return validationError;
  }

  const activeCapabilities = new Set(
    state.proofDocument.decisionRecords
      .filter(r => r.supersededBy === null)
      .map(r => r.capabilityId)
  );

  for (const cap of state.inScopeCapabilities) {
    if (!activeCapabilities.has(cap)) {
      return createError('SEMANTIC_DRIFT', `Capability ${cap} is in scope but has no active decision`);
    }
  }

  return null;
}

export function getReadiness(
  state: BuildVersusComposeState
): BuildVersusComposeReadiness {
  return state.readiness;
}

export function getProofDocument(
  state: BuildVersusComposeState
): ProofDocument | null {
  return state.proofDocument;
}

export function getAuditTrail(
  state: BuildVersusComposeState
): readonly BuildVersusComposeAuditEvent[] {
  return state.auditTrail;
}