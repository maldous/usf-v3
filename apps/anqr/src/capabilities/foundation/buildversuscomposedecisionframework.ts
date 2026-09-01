```typescript
// BuildVersusComposeDecision - classification of capabilities in the framework
export const BuildVersusComposeDecision = ['BUILD', 'COMPOSE', 'ADAPTER', 'DEFER', 'REJECT'] as const;
export type BuildVersusComposeDecision = typeof BuildVersusComposeDecision[number];

// BuildVersusComposeCriteria - criteria used for decision classification
export const BuildVersusComposeCriteria = ['COST', 'CONTROL', 'READINESS'] as const;
export type BuildVersusComposeCriteria = typeof BuildVersusComposeCriteria[number];

// Error kinds for the error model (fail-closed, typed platform errors)
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

// Decision justification containing criteria mapping and human-readable rationale
export interface DecisionJustification {
  readonly criteria: Readonly<Record<BuildVersusComposeCriteria, string>>;
  readonly rationale: string;
}

// Decision record representing a single decision entity
export interface DecisionRecord {
  readonly capabilityId: string;
  readonly decision: BuildVersusComposeDecision;
  readonly justification: DecisionJustification;
  readonly version: number;
  readonly supersededBy: string | null;
}

// Proof document containing all decision records and their verification metadata
export interface ProofDocument {
  readonly decisionRecords: readonly DecisionRecord[];
  readonly consistencyCheck: boolean;
  readonly authorityOrder: readonly string[];
}

// Readiness states indicating whether the framework is operationally ready
export const BuildVersusComposeReadiness = ['READY', 'NOT_READY'] as const;
export type BuildVersusComposeReadiness = typeof BuildVersusComposeReadiness[number];

// Complete state held during framework execution
export interface BuildVersusComposeState {
  readonly readiness: BuildVersusComposeReadiness;
  readonly proofDocument: ProofDocument | null;
  readonly lastError: BuildVersusComposeError | null;
}

// Initial state with default readiness and empty proof
export const initialState: BuildVersusComposeState = {
  readiness: 'NOT_READY',
  proofDocument: null,
  lastError: null,
};

// Helper to safely check if a value is an object (excluding null)
const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

/**
 * Validates a decision record against the defined