export const BackupAndRestoreEnvironment = ['DEVELOPMENT', 'TEST'] as const;
export type BackupAndRestoreEnvironment = typeof BackupAndRestoreEnvironment[number];

export const BackupAndRestoreOperation = ['BACKUP', 'RESTORE'] as const;
export type BackupAndRestoreOperation = typeof BackupAndRestoreOperation[number];

export const BackupAndRestoreVerdict = ['SUCCESS', 'FAILURE'] as const;
export type BackupAndRestoreVerdict = typeof BackupAndRestoreVerdict[number];

export const BackupAndRestoreReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type BackupAndRestoreReadiness = typeof BackupAndRestoreReadiness[number];

export const BackupAndRestoreErrorKind = [
  'ENVIRONMENT_GUARD_VIOLATION',
  'CONFIRMATION_TOKEN_MISMATCH',
  'TOOLING_UNAVAILABLE',
  'OPERATION_ABORTED',
  'DEPENDENCY_UNAVAILABLE',
] as const;
export type BackupAndRestoreErrorKind = typeof BackupAndRestoreErrorKind[number];

export interface BackupAndRestoreError {
  readonly kind: BackupAndRestoreErrorKind;
  readonly message: string;
}

export interface BackupArtifact {
  readonly name: string;
  readonly timestamp: string;
  readonly compressed: boolean;
}

export interface BackupProof {
  readonly environment: BackupAndRestoreEnvironment;
  readonly artifact: BackupArtifact;
  readonly verdict: BackupAndRestoreVerdict;
}

export interface BackupAndRestoreConfig {
  readonly allowEnvironmentOverride?: BackupAndRestoreEnvironment;
  readonly confirmationToken?: string;
  readonly toolingAvailable: boolean;
  readonly stageDestructiveAllowed: boolean;
  readonly stageDataPreservation: boolean;
}

export type BackupAndRestoreState = Readonly<{
  readonly readiness: BackupAndRestoreReadiness;
  readonly lastBackupProof: BackupProof | null;
  readonly lastError: BackupAndRestoreError | null;
  readonly lastOperation: BackupAndRestoreOperation | null;
}>;

export const initialState: BackupAndRestoreState = {
  readiness: 'NOT_READY',
  lastBackupProof: null,
  lastError: null,
  lastOperation: null,
};

export function validateEnvironmentGuard(
  environment: string,
  config: BackupAndRestoreConfig,
  operation: BackupAndRestoreOperation,
): BackupAndRestoreError | null {
  const validEnvironments: readonly string[] = BackupAndRestoreEnvironment;
  if (!validEnvironments.includes(environment as BackupAndRestoreEnvironment)) {
    if (config.allowEnvironmentOverride === undefined) {
      return {
        kind: 'ENVIRONMENT_GUARD_VIOLATION',
        message: `Operation ${operation} refused: environment ${environment} is not DEVELOPMENT or TEST and no override provided`,
      };
    }
    if (!validEnvironments.includes(config.allowEnvironmentOverride)) {
      return {
        kind: 'ENVIRONMENT_GUARD_VIOLATION',
        message: `Operation ${operation} refused: override environment ${config.allowEnvironmentOverride} is invalid`,
      };
    }
  }
  return null;
}

export function validateRestoreConfirmation(
  environment: BackupAndRestoreEnvironment,
  config: BackupAndRestoreConfig,
): BackupAndRestoreError | null {
  if (config.confirmationToken === undefined) {
    return {
      kind: 'CONFIRMATION_TOKEN_MISMATCH',
      message: 'Restore refused: confirmation token is required',
    };
  }
  if (config.confirmationToken !== environment) {
    return {
      kind: 'CONFIRMATION_TOKEN_MISMATCH',
      message: `Restore refused: confirmation token "${config.confirmationToken}" does not match environment "${environment}"`,
    };
  }
  return null;
}

export function validateStageSettings(
  config: BackupAndRestoreConfig,
  operation: BackupAndRestoreOperation,
): BackupAndRestoreError | null {
  if (!config.stageDestructiveAllowed) {
    return {
      kind: 'OPERATION_ABORTED',
      message: `Operation ${operation} refused: stage destructive operations are not allowed`,
    };
  }
  if (operation === 'RESTORE' && !config.stageDataPreservation) {
    return {
      kind: 'OPERATION_ABORTED',
      message: 'Restore refused: stage data preservation is not enabled',
    };
  }
  return null;
}

export function validateToolingAvailable(
  config: BackupAndRestoreConfig,
): BackupAndRestoreError | null {
  if (!config.toolingAvailable) {
    return {
      kind: 'TOOLING_UNAVAILABLE',
      message: 'Backup/restore tooling is unavailable',
    };
  }
  return null;
}

export function produceBackup(
  environment: string,
  config: BackupAndRestoreConfig,
  auditFn: (artifact: BackupArtifact) => BackupAndRestoreError | null,
): { readonly result: BackupArtifact } | BackupAndRestoreError {
  const envGuardError = validateEnvironmentGuard(environment, config, 'BACKUP');
  if (envGuardError !== null) return envGuardError;

  const stageError = validateStageSettings(config, 'BACKUP');
  if (stageError !== null) return stageError;

  const toolingError = validateToolingAvailable(config);
  if (toolingError !== null) return toolingError;

  const artifact: BackupArtifact = {
    name: `backup_${Date.now()}`,
    timestamp: new Date().toISOString(),
    compressed: true,
  };

  const auditError = auditFn(artifact);
  if (auditError !== null) return auditError;

  return { result: artifact };
}

export function restoreBackup(
  environment: string,
  targetDatabase: string,
  artifactName: string,
  config: BackupAndRestoreConfig,
  auditFn: (artifact: BackupArtifact) => BackupAndRestoreError | null,
): { readonly result: BackupArtifact } | BackupAndRestoreError {
  if (!BackupAndRestoreEnvironment.includes(environment as BackupAndRestoreEnvironment)) {
    return {
      kind: 'ENVIRONMENT_GUARD_VIOLATION',
      message: `Restore refused: environment ${environment} is not DEVELOPMENT or TEST`,
    };
  }

  const confirmationError = validateRestoreConfirmation(environment, config);
  if (confirmationError !== null) return confirmationError;

  const stageError = validateStageSettings(config, 'RESTORE');
  if (stageError !== null) return stageError;

  const toolingError = validateToolingAvailable(config);
  if (toolingError !== null) return toolingError;

  const artifact: BackupArtifact = {
    name: artifactName,
    timestamp: new Date().toISOString(),
    compressed: true,
  };

  const auditError = auditFn(artifact);
  if (auditError !== null) return auditError;

  return { result: artifact };
}

export function computeReadiness(
  state: BackupAndRestoreState,
  config: BackupAndRestoreConfig,
): BackupAndRestoreReadiness {
  if (!config.toolingAvailable) {
    return 'DEGRADED';
  }
  if (state.lastError !== null && state.lastError.kind === 'TOOLING_UNAVAILABLE') {
    return 'DEGRADED';
  }
  if (state.lastBackupProof !== null && state.lastBackupProof.verdict === 'SUCCESS') {
    return 'READY';
  }
  return 'NOT_READY';
}

export function runBackupProof(
  state: BackupAndRestoreState,
  environment: BackupAndRestoreEnvironment,
  config: BackupAndRestoreConfig,
  auditFn: (artifact: BackupArtifact) => BackupAndRestoreError | null,
): BackupAndRestoreState {
  const toolingError = validateToolingAvailable(config);
  if (toolingError !== null) {
    return {
      ...state,
      readiness: computeReadiness(state, config),
      lastError: toolingError,
      lastOperation: null,
    };
  }

  const envGuardError = validateEnvironmentGuard(environment, config, 'BACKUP');
  if (envGuardError !== null) {
    return {
      ...state,
      readiness: computeReadiness(state, config),
      lastError: envGuardError,
      lastOperation: null,
    };
  }

  const stageError = validateStageSettings(config, 'BACKUP');
  if (stageError !== null) {
    return {
      ...state,
      readiness: computeReadiness(state, config),
      lastError: stageError,
      lastOperation: null,
    };
  }

  const backupResult = produceBackup(environment, config, auditFn);
  if ('kind' in backupResult) {
    return {
      ...state,
      readiness: computeReadiness(state, config),
      lastError: backupResult,
      lastOperation: 'BACKUP',
    };
  }

  const proof: BackupProof = {
    environment,
    artifact: backupResult.result,
    verdict: 'SUCCESS',
  };

  return {
    ...state,
    readiness: computeReadiness(
      {
        ...state,
        lastBackupProof: proof,
        lastError: null,
        lastOperation: 'BACKUP',
      },
      config,
    ),
    lastBackupProof: proof,
    lastError: null,
    lastOperation: 'BACKUP',
  };
}