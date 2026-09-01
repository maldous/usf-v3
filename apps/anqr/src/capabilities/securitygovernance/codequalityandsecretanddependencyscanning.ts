```typescript
export const CodeQualityAndSecretAndDependencyScanningVerdict = ['PASS', 'FAIL'] as const;
export type CodeQualityAndSecretAndDependencyScanningVerdict = typeof CodeQualityAndSecretAndDependencyScanningVerdict[number];

export const CodeQualityAndSecretAndDependencyScanningReadiness = ['READY', 'NOT_READY'] as const;
export type CodeQualityAndSecretAndDependencyScanningReadiness = typeof CodeQualityAndSecretAndDependencyScanningReadiness[number];

export const CodeQualityAndSecretAndDependencyScanningErrorKind = [
  'STATIC_ANALYSIS_ERROR',
  'SBOM_MISSING',
  'SBOM_STALE',
  'SBOM_POLICY_VIOLATION