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
  const validEnvs = BackupAndRestoreEnvironment;
  const isValidEnv = validEnvs.includes(environment as BackupAndRestoreEnvironment);
  if (operation === 'BACKUP') {
    if (isValidEnv) {
      return null;
    }
    if (config.allowEnvironmentOverride === undefined) {
      return {
        kind: 'ENVIRONMENT_GUARD_VIOLATION',
        message: `Backup refused: environment ${environment} is not allowed and no override provided`,
      };
    }
    if (config.allowEnvironmentOverride !== environment) {
      return {
        kind: 'ENVIRONMENT_GUARD_VIOLATION',
        message: `Backup refused: override environment ${config.allowEnvironmentOverride} does not match requested ${environment}`,
      };
    }
    return null;
  }

  if (!isValidEnv) {
    return {
      kind: 'ENVIRONMENT_GUARD_VIOLATION',
      message: `Restore refused: environment ${environment} is not DEVELOPMENT or TEST`,
    };
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
  const envError = validateEnvironmentGuard(environment, config, 'BACKUP');
  if (envError) return envError;

  const stageError = validateStageSettings(config, 'BACKUP');
  if (stageError) return stageError;

  const toolingError = validateToolingAvailable(config);
  if (toolingError) return toolingError;

  const artifact: BackupArtifact = {
    name: `backup_${Date.now()}`,
    timestamp: new Date().toISOString(),
    compressed: true,
  };

  const auditError = auditFn(artifact);
  if (auditError) return auditError;

  return { result: artifact };
}

export function restoreBackup(
  environment: BackupAndRestoreEnvironment,
  targetDatabase: string,
  artifactName: string,
  config: BackupAndRestoreConfig,
  auditFn: (artifact: BackupArtifact) => BackupAndRestoreError | null,
): { readonly result: BackupArtifact } | BackupAndRestoreError {
  const envError = validateEnvironmentGuard(environment, config, 'RESTORE');
  if (envError) return envError;

  const tokenError = validateRestoreConfirmation(environment, config);
  if (tokenError) return tokenError;

  const stageError = validateStageSettings(config, 'RESTORE');
  if (stageError) return stageError;

  const toolingError = validateToolingAvailable(config);
  if (toolingError) return toolingError;

  const artifact: BackupArtifact = {
    name: artifactName,
    timestamp: new Date().toISOString(),
    compressed: true,
  };

  const auditError = auditFn(artifact);
  if (auditError) return auditError;

  return { result: artifact };
}

export function computeReadiness(
  state: BackupAndRestoreState,
  config: BackupAndRestoreConfig,
): BackupAndRestoreReadiness {
  if (!config.toolingAvailable) {
    return 'DEGRADED';
  }
  if (state.lastBackupProof?.verdict === 'SUCCESS') {
    return 'READY';
  }
  return 'NOT_READY';
}