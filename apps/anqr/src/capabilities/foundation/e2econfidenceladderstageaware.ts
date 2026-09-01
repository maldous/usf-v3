export const E2eConfidenceLadderStage = [
  'HERMETIC',
  'INTEGRATION',
  'STAGING',
  'PRODUCTION',
] as const;
export type E2eConfidenceLadderStage = typeof E2eConfidenceLadderStage[number];

export const E2eConfidenceLadderVerdict = [
  'PASSED',
  'FAILED',
  'DEGRADED',
  'UNKNOWN',
] as const;
export type E2eConfidenceLadderVerdict = typeof E2eConfidenceLadderVerdict[number];

export const E2eConfidenceLadderErrorKind = [
  'MISSING_STAGE_EVIDENCE',
  'STALE_STAGE_EVIDENCE',
  'INVALID_CONFIGURATION',
  'AGGREGATION_ERROR',
  'VERIFICATION_ERROR',
] as const;
export type E2eConfidenceLadderErrorKind = typeof E2eConfidenceLadderErrorKind[number];

export interface E2eConfidenceLadderStageResult {
  readonly stage: E2eConfidenceLadderStage;
  readonly verdict: E2eConfidenceLadderVerdict;
  readonly timestamp: string;
}

export interface E2eConfidenceLadderAuditRecord {
  readonly stage: E2eConfidenceLadderStage;
  readonly verdict: E2eConfidenceLadderVerdict;
  readonly aggregatedVerdict: E2eConfidenceLadderVerdict;
  readonly timestamp: string;
}

export interface E2eConfidenceLadderError {
  readonly kind: E2eConfidenceLadderErrorKind;
  readonly message: string;
  readonly stage?: E2eConfidenceLadderStage;
}

export interface E2eConfidenceLadderConfig {
  readonly stages: readonly {
    readonly name: E2eConfidenceLadderStage;
    readonly confidenceThreshold: number;
  }[];
}

export interface E2eConfidenceLadderState {
  readonly config: E2eConfidenceLadderConfig | null;
  readonly stageResults: readonly E2eConfidenceLadderStageResult[];
  readonly aggregatedVerdict: E2eConfidenceLadderVerdict | null;
  readonly lastError: E2eConfidenceLadderError | null;
  readonly auditRecords: readonly E2eConfidenceLadderAuditRecord[];
}

export const initialState: E2eConfidenceLadderState = {
  config: null,
  stageResults: [],
  aggregatedVerdict: null,
  lastError: null,
  auditRecords: [],
};

export function validateConfig(
  config: unknown,
): E2eConfidenceLadderConfig | E2eConfidenceLadderError {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('stages' in config) ||
    !Array.isArray((config as { stages: unknown }).stages)
  ) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Configuration must be an object with a stages array',
    };
  }

  const stages = (config as { stages: unknown }).stages;
  if (stages.length === 0) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'At least one stage must be defined',
    };
  }

  for (const stage of stages as Array<unknown>) {
    if (
      stage === null ||
      typeof stage !== 'object' ||
      !('name' in stage) ||
      !('confidenceThreshold' in stage) ||
      !E2eConfidenceLadderStage.includes((stage as { name: string }).name as E2eConfidenceLadderStage) ||
      typeof (stage as { confidenceThreshold: unknown }).confidenceThreshold !== 'number'
    ) {
      return {
        kind: 'INVALID_CONFIGURATION',
        message: 'Each stage must have a valid name and numeric confidenceThreshold',
      };
    }
  }

  return {
    stages: stages as Array<{
      readonly name: E2eConfidenceLadderStage;
      readonly confidenceThreshold: number;
    }>,
  };
}

export function verifyStageResult(
  stage: E2eConfidenceLadderStage,
  result: E2eConfidenceLadderStageResult,
  config: E2eConfidenceLadderConfig,
): boolean {
  const stageConfig = config.stages.find((s) => s.name === stage);
  if (stageConfig === undefined) {
    return false;
  }
  return result.verdict === 'PASSED' && result.stage === stage;
}

export function aggregateConfidence(
  stageResults: readonly E2eConfidenceLadderStageResult[],
  config: E2eConfidenceLadderConfig,
): E2eConfidenceLadderVerdict {
  for (const stageConfig of config.stages) {
    const stageResult = stageResults.find((sr) => sr.stage === stageConfig.name);
    if (stageResult === undefined || !verifyStageResult(stageConfig.name, stageResult, config)) {
      return 'FAILED';
    }
  }
  return 'PASSED';
}

export function verifyLadder(
  state: E2eConfidenceLadderState,
): { readonly verdict: E2eConfidenceLadderVerdict } | E2eConfidenceLadderError {
  if (state.config === null) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Ladder configuration is missing',
    };
  }

  for (const stageConfig of state.config.stages) {
    const stageResult = state.stageResults.find((sr) => sr.stage === stageConfig.name);
    if (stageResult === undefined) {
      return {
        kind: 'MISSING_STAGE_EVIDENCE',
        message: `Missing evidence for stage ${stageConfig.name}`,
        stage: stageConfig.name,
      };
    }

    if (!verifyStageResult(stageConfig.name, stageResult, state.config)) {
      return {
        kind: 'VERIFICATION_ERROR',
        message: `Verification failed for stage ${stageConfig.name}`,
        stage: stageConfig.name,
      };
    }
  }

  const aggregatedVerdict = aggregateConfidence(state.stageResults, state.config);
  return { verdict: aggregatedVerdict };
}

export function recordAudit(
  state: E2eConfidenceLadderState,
  stage: E2eConfidenceLadderStage,
  verdict: E2eConfidenceLadderVerdict,
  aggregatedVerdict: E2eConfidenceLadderVerdict,
): E2eConfidenceLadderState {
  const newAuditRecord: E2eConfidenceLadderAuditRecord = {
    stage,
    verdict,
    aggregatedVerdict,
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    auditRecords: [...state.auditRecords, newAuditRecord],
  };
}

export function setStageResult(
  state: E2eConfidenceLadderState,
  stage: E2eConfidenceLadderStage,
  verdict: E2eConfidenceLadderVerdict,
): E2eConfidenceLadderState | E2eConfidenceLadderError {
  if (state.config === null) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Cannot set stage result without configuration',
    };
  }

  const existingIndex = state.stageResults.findIndex((sr) => sr.stage === stage);
  const newStageResults = [...state.stageResults];
  if (existingIndex >= 0) {
    newStageResults[existingIndex] = { stage, verdict, timestamp: new Date().toISOString() };
  } else {
    newStageResults.push({ stage, verdict, timestamp: new Date().toISOString() });
  }

  const verificationResult = verifyLadder({ ...state, stageResults: newStageResults });
  if ('kind' in verificationResult) {
    return verificationResult;
  }

  const newState = {
    ...state,
    stageResults: newStageResults,
    aggregatedVerdict: verificationResult.verdict,
    lastError: null,
  };

  return recordAudit(newState, stage, verdict, verificationResult.verdict);
}

export function checkPromotionReadiness(
  state: E2eConfidenceLadderState,
  targetStage: E2eConfidenceLadderStage,
): { readonly ready: boolean } | E2eConfidenceLadderError {
  if (state.config === null) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Ladder configuration is missing',
    };
  }

  const targetStageConfig = state.config.stages.find((s) => s.name === targetStage);
  if (targetStageConfig === undefined) {
    return {
      kind: 'MISSING_STAGE_EVIDENCE',
      message: `Target stage ${targetStage} not found in configuration`,
      stage: targetStage,
    };
  }

  const currentStageIndex = state.config.stages.findIndex((s) => s.name === targetStage);
  if (currentStageIndex === -1) {
    return {
      kind: 'MISSING_STAGE_EVIDENCE',
      message: `Current stage ${targetStage} not found in configuration`,
      stage: targetStage,
    };
  }

  for (let i = 0; i <= currentStageIndex; i += 1) {
    const stageConfig = state.config.stages[i];
    const stageResult = state.stageResults.find((sr) => sr.stage === stageConfig.name);
    if (stageResult === undefined || stageResult.verdict !== 'PASSED') {
      return {
        kind: 'VERIFICATION_ERROR',
        message: `Stage ${stageConfig.name} not passed`,
        stage: stageConfig.name,
      };
    }
  }

  return { ready: true };
}