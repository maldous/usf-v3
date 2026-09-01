// Compliance Report Access Review Evidence Packs Capability
// Domain: Security Governance

// Error kinds for fail-closed behavior
export const ComplianceReportErrorKind = [
  'MISSING_FOUNDATION_SOURCES',
  'UNHEALTHY_METRICS_SOURCE',
  'UNHEALTHY_INCIDENTS_SOURCE',
  'UNHEALTHY_LEGAL_HOLDS_SOURCE',
  'UNHEALTHY_RETENTION_SOURCE',
  'UNHEALTHY_STORAGE_SOURCE',
  'ROUTE_NOT_REGISTERED',
  'INSUFFICIENT_PERMISSIONS',
  'REPORT_NOT_READY',
  'VALIDATION_FAILURE',
] as const;
export type ComplianceReportErrorKind = typeof ComplianceReportErrorKind[number];

// Route guard for operator/admin-scoped access
export interface ComplianceReportRouteGuard {
  readonly resource: string;
  readonly scope: string;
  readonly requiredPermission: string;
}

// Foundation source types for injected dependencies
export interface MetricsSource {
  readonly healthy: boolean;
  readonly data: readonly string[];
}

export interface IncidentsSource {
  readonly healthy: boolean;
  readonly openCount: number;
}

export interface LegalHoldsSource {
  readonly healthy: boolean;
  readonly holdCount: number;
}

export interface RetentionSource {
  readonly healthy: boolean;
  readonly policyCount: number;
}

export interface StorageSource {
  readonly healthy: boolean;
  readonly configured: boolean;
  readonly isolation: boolean;
}

// Foundation sources bundle
export interface FoundationSources {
  readonly metrics: MetricsSource;
  readonly incidents: IncidentsSource;
  readonly legalHolds: LegalHoldsSource;
  readonly retention: RetentionSource;
  readonly storage: StorageSource;
}

// Storage readiness computed from foundation sources
export interface StorageReadiness {
  readonly configured: boolean;
  readonly isolation: boolean;
}

// Compliance report state
export interface ComplianceReportState {
  readonly routeGuards: readonly ComplianceReportRouteGuard[];
  readonly foundationSources: FoundationSources | null;
  readonly report: ComplianceReport | null;
}

// Generated compliance report
export interface ComplianceReport {
  readonly organisationId: string;
  readonly generatedAt: string;
  readonly metricsSignals: readonly string[];
  readonly openIncidentCount: number;
  readonly legalHoldCount: number;
  readonly retentionPolicyCount: number;
  readonly storageReadiness: StorageReadiness;
  readonly ready: boolean;
}

// Error type with literal discriminant
export interface ComplianceReportError {
  readonly kind: ComplianceReportErrorKind;
  readonly message: string;
}

// Initial state
export const initialState: ComplianceReportState = {
  routeGuards: [],
  foundationSources: null,
  report: null,
};

// Register the operator compliance report route
export function registerRoute(
  state: ComplianceReportState,
  resource: string,
  scope: string,
  requiredPermission: string,
): ComplianceReportState {
  const existingIndex = state.routeGuards.findIndex(
    (rg) => rg.resource === resource && rg.scope === scope,
  );
  
  const newRouteGuards = [...state.routeGuards];
  if (existingIndex >= 0) {
    newRouteGuards[existingIndex] = { resource, scope, requiredPermission };
  } else {
    newRouteGuards.push({ resource, scope, requiredPermission });
  }

  return {
    ...state,
    routeGuards: newRouteGuards,
  };
}

// Validate foundation sources for health (fail-closed)
export function validateFoundationSources(
  sources: FoundationSources,
): ComplianceReportError | null {
  if (!sources.metrics?.healthy) {
    return { kind: 'UNHEALTHY_METRICS_SOURCE', message: 'Metrics source is unhealthy or missing' };
  }
  if (!sources.incidents?.healthy) {
    return { kind: 'UNHEALTHY_INCIDENTS_SOURCE', message: 'Incidents source is unhealthy or missing' };
  }
  if (!sources.legalHolds?.healthy) {
    return { kind: 'UNHEALTHY_LEGAL_HOLDS_SOURCE', message: 'Legal holds source is unhealthy or missing' };
  }
  if (!sources.retention?.healthy) {
    return { kind: 'UNHEALTHY_RETENTION_SOURCE', message: 'Retention source is unhealthy or missing' };
  }
  if (!sources.storage?.healthy) {
    return { kind: 'UNHEALTHY_STORAGE_SOURCE', message: 'Storage source is unhealthy or missing' };
  }
  return null;
}

// Check if route is registered for operator/admin access
export function isRouteRegistered(
  state: ComplianceReportState,
  resource: string,
  scope: string,
): boolean {
  return state.routeGuards.some(
    (rg) => rg.resource === resource && rg.scope === scope,
  );
}

// Check permissions for operator/admin context
export function checkPermissions(
  state: ComplianceReportState,
  resource: string,
  scope: string,
  requiredPermission: string,
  token: { readonly authLevel: string } | null,
): ComplianceReportError | null {
  if (token === null) {
    return { kind: 'INSUFFICIENT_PERMISSIONS', message: 'Authentication required' };
  }

  if (!isRouteRegistered(state, resource, scope)) {
    return { kind: 'ROUTE_NOT_REGISTERED', message: 'Compliance report route not registered' };
  }

  const routeGuard = state.routeGuards.find(
    (rg) => rg.resource === resource && rg.scope === scope,
  );

  if (routeGuard!.requiredPermission !== requiredPermission) {
    return { kind: 'INSUFFICIENT_PERMISSIONS', message: 'Required permission mismatch' };
  }

  if (token.authLevel !== requiredPermission) {
    return { kind: 'INSUFFICIENT_PERMISSIONS', message: 'Insufficient auth level' };
  }

  return null;
}

// Compute storage readiness from foundation sources
export function computeStorageReadiness(
  storage: StorageSource,
): StorageReadiness {
  return {
    configured: storage.configured,
    isolation: storage.isolation,
  };
}

// Determine overall readiness (deterministic composition)
export function determineReadiness(
  sources: FoundationSources,
): boolean {
  // All sources must be healthy and storage must be configured and isolated
  return (
    sources.metrics.healthy &&
    sources.incidents.healthy &&
    sources.legalHolds.healthy &&
    sources.retention.healthy &&
    sources.storage.healthy &&
    sources.storage.configured &&
    sources.storage.isolation
  );
}

// Compose compliance report from foundation sources (deterministic)
export function composeReport(
  organisationId: string,
  sources: FoundationSources,
): ComplianceReport {
  const ready = determineReadiness(sources);
  const storageReadiness = computeStorageReadiness(sources.storage);

  return {
    organisationId,
    generatedAt: new Date().toISOString(),
    metricsSignals: sources.metrics.data,
    openIncidentCount: sources.incidents.openCount,
    legalHoldCount: sources.legalHolds.holdCount,
    retentionPolicyCount: sources.retention.policyCount,
    storageReadiness,
    ready,
  };
}

// Set foundation sources (injected dependencies)
export function setFoundationSources(
  state: ComplianceReportState,
  sources: FoundationSources,
): ComplianceReportState | ComplianceReportError {
  const validationError = validateFoundationSources(sources);
  if (validationError !== null) {
    return validationError;
  }

  return {
    ...state,
    foundationSources: sources,
  };
}

// Generate compliance report (operator/admin-scoped, fail-closed)
export function generateReport(
  state: ComplianceReportState,
  organisationId: string,
  sources: FoundationSources,
  resource: string,
  scope: string,
  requiredPermission: string,
  token: { readonly authLevel: string } | null,
): ComplianceReportState | ComplianceReportError {
  // Check permissions first
  const permissionError = checkPermissions(state, resource, scope, requiredPermission, token);
  if (permissionError !== null) {
    return permissionError;
  }

  // Validate foundation sources
  const sourceError = validateFoundationSources(sources);
  if (sourceError !== null) {
    return sourceError;
  }

  // Compose report deterministically
  const report = composeReport(organisationId, sources);

  return {
    ...state,
    foundationSources: sources,
    report,
  };
}

// Get compliance report (read-only access)
export function getReport(
  state: ComplianceReportState,
  resource: string,
  scope: string,
  requiredPermission: string,
  token: { readonly authLevel: string } | null,
): ComplianceReport | ComplianceReportError {
  // Check permissions
  const permissionError = checkPermissions(state, resource, scope, requiredPermission, token);
  if (permissionError !== null) {
    return permissionError;
  }

  // Check if report exists
  if (state.report === null) {
    return { kind: 'REPORT_NOT_READY', message: 'Compliance report not generated' };
  }

  // Check if report is ready
  if (!state.report.ready) {
    return { kind: 'REPORT_NOT_READY', message: 'Compliance report not ready' };
  }

  return state.report;
}

// Export evidence pack (deterministic export hook)
export function exportEvidencePack(
  report: ComplianceReport,
): string {
  return JSON.stringify(report, null, 2);
}

// Validate report composition (proves counts come from foundation sources)
export function validateReportComposition(
  report: ComplianceReport,
  sources: FoundationSources,
): ComplianceReportError | null {
  if (report.openIncidentCount !== sources.incidents.openCount) {
    return { kind: 'VALIDATION_FAILURE', message: 'Open incident count mismatch' };
  }
  if (report.legalHoldCount !== sources.legalHolds.holdCount) {
    return { kind: 'VALIDATION_FAILURE', message: 'Legal hold count mismatch' };
  }
  if (report.retentionPolicyCount !== sources.retention.policyCount) {
    return { kind: 'VALIDATION_FAILURE', message: 'Retention policy count mismatch' };
  }
  if (report.metricsSignals.length !== sources.metrics.data.length) {
    return { kind: 'VALIDATION_FAILURE', message: 'Metrics signals count mismatch' };
  }
  if (report.storageReadiness.configured !== sources.storage.configured) {
    return { kind: 'VALIDATION_FAILURE', message: 'Storage configured mismatch' };
  }
  if (report.storageReadiness.isolation !== sources.storage.isolation) {
    return { kind: 'VALIDATION_FAILURE', message: 'Storage isolation mismatch' };
  }
  return null;
}