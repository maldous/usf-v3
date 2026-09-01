// Compliance Report Access Review Evidence Packs Capability
// Domain: securitygovernance

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

// Bundle of all foundation sources
export interface FoundationSources {
  readonly metrics: MetricsSource;
  readonly incidents: IncidentsSource;
  readonly legalHolds: LegalHoldsSource;
  readonly retention: RetentionSource;
  readonly storage: StorageSource;
}

// Computed storage readiness
export interface StorageReadiness {
  readonly configured: boolean;
  readonly isolation: boolean;
}

// Full compliance report state
export interface ComplianceReportState {
  readonly routeGuards: readonly ComplianceReportRouteGuard[];
  readonly foundationSources: FoundationSources | null;
  readonly report: ComplianceReport | null;
}

// Generated compliance report (read‑only)
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

// Discriminated error type
export interface ComplianceReportError {
  readonly kind: ComplianceReportErrorKind;
  readonly message: string;
}

// Initial empty state
export const initialState: ComplianceReportState = {
  routeGuards: [],
  foundationSources: null,
  report: null,
};

// ---------------------------------------------------------------------------
// Route registration (admin/operator scoped)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Permission & route checks (fail‑closed)
// ---------------------------------------------------------------------------
export function isRouteRegistered(
  state: ComplianceReportState,
  resource: string,
  scope: string,
): boolean {
  return state.routeGuards.some(
    (rg) => rg.resource === resource && rg.scope === scope,
  );
}

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

  const routeGuard = state.routeGuards.find(
    (rg) => rg.resource === resource && rg.scope === scope,
  );

  if (routeGuard === undefined) {
    return { kind: 'ROUTE_NOT_REGISTERED', message: 'Compliance report route not registered' };
  }

  if (routeGuard.requiredPermission !== requiredPermission) {
    return { kind: 'INSUFFICIENT_PERMISSIONS', message: 'Required permission mismatch' };
  }

  if (token.authLevel !== requiredPermission) {
    return { kind: 'INSUFFICIENT_PERMISSIONS', message: 'Insufficient auth level' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Foundation source validation (fail‑closed)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Readiness computation (deterministic, includes route registration)
// ---------------------------------------------------------------------------
export function computeStorageReadiness(storage: StorageSource): StorageReadiness {
  return {
    configured: storage.configured,
    isolation: storage.isolation,
  };
}

export function determineReadiness(
  sources: FoundationSources,
  state: ComplianceReportState,
  resource: string,
  scope: string,
): boolean {
  // All foundation sources must be healthy and storage must be configured & isolated.
  // Additionally, the route must be registered for the operator/admin use case.
  return (
    sources.metrics.healthy &&
    sources.incidents.healthy &&
    sources.legalHolds.healthy &&
    sources.retention.healthy &&
    sources.storage.healthy &&
    sources.storage.configured &&
    sources.storage.isolation &&
    isRouteRegistered(state, resource, scope)
  );
}

// ---------------------------------------------------------------------------
// Report composition (pure, read‑only)
// ---------------------------------------------------------------------------
export function composeReport(
  organisationId: string,
  sources: FoundationSources,
  state: ComplianceReportState,
  resource: string,
  scope: string,
): ComplianceReport {
  const ready = determineReadiness(sources, state, resource, scope);
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

// ---------------------------------------------------------------------------
// State mutation helpers (order observable, fail‑closed)
// ---------------------------------------------------------------------------
export function setFoundationSources(