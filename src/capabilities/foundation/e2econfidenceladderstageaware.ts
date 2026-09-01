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

function isE2eConfidenceLadderConfig(config: unknown): config is E2eConfidenceLadderConfig {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('stages' in config)
  ) {
    return false;
  }

  const stages = (config as { stages: unknown }).stages;
  if (
    !Array.isArray(stages) ||
    stages.length === 0
  ) {
    return false;
  }

  for (const stage of stages) {
    if (
      stage === null ||
      typeof stage !== 'object' ||
      !('name' in stage) ||
      !('confidenceThreshold' in stage) ||
      !E2eConfidenceLadderStage.includes((stage as { name: string }).name as E2eConfidenceLadderStage) ||
      typeof (stage as { confidenceThreshold: unknown }).confidenceThreshold !== 'number'
    ) {
      return false;
    }
  }

  return true;
}

export function validateConfig(
  config: unknown,
): E2eConfidenceLadderConfig | E2eConfidenceLadderError {
  if (!isE2eConfidenceLadderConfig(config)) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Configuration must be an object with a non-empty stages array where each stage has a valid name and numeric confidenceThreshold',
    };
  }
  return config;
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

    if (stageResult.verdict === 'UNKNOWN' || stageResult.verdict === 'DEGRADED') {
      return {
        kind: 'STALE_STAGE_EVIDENCE',
        message: `Stale or degraded evidence for stage ${stageConfig.name}`,
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
  auditFn: (record: E2eConfidenceLadderAuditRecord) => E2eConfidenceLadderError | null,
): E2eConfidenceLadderState | E2eConfidenceLadderError {
  if (state.config === null) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Cannot set stage result without configuration',
    };
  }

  const existingIndex = state.stageResults.findIndex((sr) => sr.stage === stage);
  const newStageResults = [...state.stageResults];
  const timestamp = new Date().toISOString();
  if (existingIndex >= 0) {
    newStageResults[existingIndex] = { stage, verdict, timestamp };
  } else {
    newStageResults.push({ stage, verdict, timestamp });
  }

  const verificationResult = verifyLadder({ ...state, stageResults: newStageResults });
  if ('kind' in verificationResult) {
    return verificationResult;
  }

  const newAuditRecord: E2eConfidenceLadderAuditRecord = {
    stage,
    verdict,
    aggregatedVerdict: verificationResult.verdict,
    timestamp,
  };
  const auditError = auditFn(newAuditRecord);
  if (auditError !== null) {
    return auditError;
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
): { readonly ready: boolean; readonly verdict: E2eConfidenceLadderVerdict } | E2eConfidenceLadderError {
  if (state.config === null) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Ladder configuration is missing',
    };
  }

  const targetStageIndex = state.config.stages.findIndex((s) => s.name === targetStage);
  if (targetStageIndex === -1) {
    return {
      kind: 'MISSING_STAGE_EVIDENCE',
      message: `Target stage ${targetStage} not found in configuration`,
      stage: targetStage,
    };
  }

  for (let i = 0; i <= targetStageIndex; i += 1) {
    const stageConfig = state.config.stages[i];
    const stageResult = state.stageResults.find((sr) => sr.stage === stageConfig.name);
    if (stageResult === undefined) {
      return {
        kind: 'MISSING_STAGE_EVIDENCE',
        message: `Missing evidence for stage ${stageConfig.name}`,
        stage: stageConfig.name,
      };
    }
    if (stageResult.verdict === 'UNKNOWN' || stageResult.verdict === 'DEGRADED') {
      return {
        kind: 'STALE_STAGE_EVIDENCE',
        message: `Stale or degraded evidence for stage ${stageConfig.name}`,
        stage: stageConfig.name,
      };
    }
    if (!verifyStageResult(stageConfig.name, stageResult, state.config)) {
      return {
        kind: 'VERIFICATION_ERROR',
        message: `Stage ${stageConfig.name} not passed`,
        stage: stageConfig.name,
      };
    }
  }

  const aggregatedVerdict = aggregateConfidence(state.stageResults, state.config);
  return { ready: true, verdict: aggregatedVerdict };
}