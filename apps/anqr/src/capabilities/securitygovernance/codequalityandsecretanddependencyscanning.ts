```typescript
// State definitions for the security-gating capability
export interface StaticAnalysisFinding {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  location: string;
}

export interface SBOMBaseline {
  version: string;
  lockHash: string;
  createdAt: string;
}

export interface SBOMPolicyAudit {
  passed: boolean;
  details: string[];
}

export interface CodeScanningConfig {
  enabled: boolean;
  binaryPath?: string;
  dbConnection?: string;
  resultStore?: string;
}

export interface SecurityRoute {
  resource: string;
  scope: string;
  requiredPermission: string;
  registeredAt: string;
}

export interface ConsoleReadiness {
  servicesPro