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

/**
 * Validates that the operation is allowed in the given environment.
 * For BACKUP, an explicit allowEnvironmentOverride may be supplied to
 * permit execution in non‑DEV/TEST environments, but the override must
 * match the requested environment.
 * For RESTORE, only DEV/TEST are permitted; no override is accepted.
 */
export function validateEnvironmentGuard(
  environment: string,
  config: BackupAndRestoreConfig,
  operation: BackupAndRestoreOperation,
): BackupAndRestoreError | null {
  const validEnvs = BackupAndRestoreEnvironment as readonly string[];
  const isValidEnv = validEnvs.includes(environment);
  if (operation === 'BACKUP') {
    if (isValidEnv) {
      return null;
    }
    // Non‑dev/test: require explicit override that names the target environment
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
    if (!validEnvs.includes(config.allowEnvironmentOverride)) {
      return {
        kind: 'ENVIRONMENT_GUARD_VIOLATION',
        message: `Backup refused: override environment ${config.allowEnvironmentOverride} is invalid`,
      };
    }
    return null;
  }

  // RESTORE path – only DEV/TEST, no override
  if (!isValidEnv) {
    return {
      kind: 'ENVIRONMENT_GUARD_VIOLATION',
      message: `Restore refused: environment ${environment} is not DEVELOPMENT or TEST`,
    };
  }
  return null;
}

/**
 * Validates that the confirmation token for a restore matches the environment.
 */
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

/**
 * Validates stage‑level settings that control destructive operations.
 */
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

/**
 * Validates that tooling required for backup/restore is available.
 */
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

/**
 * Produces a backup artifact after all guards and audit succeed.
 * The audit function receives the artifact metadata; if it returns an error,
 * the backup is aborted and no artifact is produced.
 */
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

/**
 * Restores a previously produced backup artifact.
 * All guards (environment, confirmation token, stage settings, tooling) must pass
 * before the audit function is invoked. No mutation occurs on failure.
 */
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

  // In a real system the targetDatabase would be overwritten here.
  // This pure model returns the artifact to signal success.
  return { result: artifact };
}

/**
 * Computes readiness based on current state and configuration.
 * Backup readiness is READY only when a successful backup proof exists.
 * Tooling unavailability degrades readiness; otherwise NOT_READY.
 */
export function computeReadiness(
  state: BackupAndRestoreState,
  config: BackupAndRestoreConfig,
): BackupAndRestoreReadiness {
  if (!config.toolingAvailable) {
    return 'DEGRADED';
  }
  if (state.lastBackupProof?.verdict === 'SUCCESS') {
    return 'READY';