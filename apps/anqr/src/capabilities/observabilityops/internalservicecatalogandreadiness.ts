export const InternalServiceCatalogAndReadinessReadinessState = [
  'READY',
  'DEGRADED',
  'UNAVAILABLE',
] as const;
export type InternalServiceCatalogAndReadinessReadinessState = typeof InternalServiceCatalogAndReadinessReadinessState[number];

export const InternalServiceCatalogAndReadinessAuditEventKind = [
  'CATALOG_SERVICE_REGISTERED',
  'CATALOG_SERVICE_DEREGISTERED',
  'READINESS_PROBE_INVOKED',
  'READINESS_STATE_CHANGED',
] as const;
export type InternalServiceCatalogAndReadinessAuditEventKind = typeof InternalServiceCatalogAndReadinessAuditEventKind[number];

export const InternalServiceCatalogAndReadinessErrorKind = [
  'TENANT_SCOPE_MISSING',
  'SERVICE_REFERENCE_INVALID',
  'PROBE_FAILURE',
  'PROVIDER_UNAVAILABLE',
  'TENANT_ISOLATION_VIOLATION',
  'AUDIT_FAILURE',
] as const;
export type InternalServiceCatalogAndReadinessErrorKind = typeof InternalServiceCatalogAndReadinessErrorKind[number];

export interface InternalServiceCatalogAndReadinessService {
  readonly id: string;
  readonly provider: string;
  readonly readinessPort: number;
  readonly tenantId: string;
}

export interface InternalServiceCatalogAndReadinessAuditEvent {
  readonly kind: InternalServiceCatalogAndReadinessAuditEventKind;
  readonly serviceId: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly details: unknown;
}

export interface InternalServiceCatalogAndReadinessError {
  readonly kind: InternalServiceCatalogAndReadinessErrorKind;
  readonly message: string;
  readonly serviceId?: string;
  readonly tenantId?: string;
}

export interface InternalServiceCatalogAndReadinessState {
  readonly services: readonly InternalServiceCatalogAndReadinessService[];
  readonly lastAuditEvent: InternalServiceCatalogAndReadinessAuditEvent | null;
  readonly lastError: InternalServiceCatalogAndReadinessError | null;
}

export const initialState: InternalServiceCatalogAndReadinessState = {
  services: [],
  lastAuditEvent: null,
  lastError: null,
};

export function validateTenantScope(tenantId: string | undefined): InternalServiceCatalogAndReadinessError | null {
  if (!tenantId || typeof tenantId !== 'string') {
    return {
      kind: 'TENANT_SCOPE_MISSING',
      message: 'Tenant scope is required',
    };
  }
  return null;
}

export function validateServiceReference(service: InternalServiceCatalogAndReadinessService): InternalServiceCatalogAndReadinessError | null {
  if (!service.id || typeof service.id !== 'string') {
    return {
      kind: 'SERVICE_REFERENCE_INVALID',
      message: 'Service ID is required and must be a string',
      serviceId: service.id,
    };
  }
  if (!service.provider || typeof service.provider !== 'string') {
    return {
      kind: 'SERVICE_REFERENCE_INVALID',
      message: 'Provider is required and must be a string',
      serviceId: service.id,
    };
  }
  if (typeof service.readinessPort !== 'number' || service.readinessPort <= 0) {
    return {
      kind: 'SERVICE_REFERENCE_INVALID',
      message: 'Readiness port must be a positive number',
      serviceId: service.id,
    };
  }
  if (!service.tenantId || typeof service.tenantId !== 'string') {
    return {
      kind: 'SERVICE_REFERENCE_INVALID',
      message: 'Tenant ID is required and must be a string',
      serviceId: service.id,
    };
  }
  return null;
}

export function auditCatalogChange(
  kind: InternalServiceCatalogAndReadinessAuditEventKind,
  serviceId: string,
  tenantId: string,
  details: unknown,
  auditFn: (event: InternalServiceCatalogAndReadinessAuditEvent) => InternalServiceCatalogAndReadinessError | null,
): InternalServiceCatalogAndReadinessError | null {
  const event: InternalServiceCatalogAndReadinessAuditEvent = {
    kind,
    serviceId,
    tenantId,
    timestamp: new Date().toISOString(),
    details,
  };
  return auditFn(event);
}

export function registerService(
  state: InternalServiceCatalogAndReadinessState,
  service: InternalServiceCatalogAndReadinessService,
  auditFn: (event: InternalServiceCatalogAndReadinessAuditEvent) => InternalServiceCatalogAndReadinessError | null,
): InternalServiceCatalogAndReadinessState | InternalServiceCatalogAndReadinessError {
  const scopeError = validateTenantScope(service.tenantId);
  if (scopeError !== null) {
    return scopeError;
  }

  const refError = validateServiceReference(service);
  if (refError !== null) {
    return refError;
  }

  const auditError = auditCatalogChange(
    'CATALOG_SERVICE_REGISTERED',
    service.id,
    service.tenantId,
    { provider: service.provider, readinessPort: service.readinessPort },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const existingService = state.services.find(s => s.id === service.id && s.tenantId === service.tenantId);
  if (existingService !== undefined) {
    return {
      ...state,
      lastError: {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: 'Service already registered for this tenant',
        serviceId: service.id,
        tenantId: service.tenantId,
      },
    };
  }

  return {
    ...state,
    services: [...state.services, service],
    lastAuditEvent: {
      kind: 'CATALOG_SERVICE_REGISTERED',
      serviceId: service.id,
      tenantId: service.tenantId,
      timestamp: new Date().toISOString(),
      details: { provider: service.provider, readinessPort: service.readinessPort },
    },
    lastError: null,
  };
}

export function deregisterService(
  state: InternalServiceCatalogAndReadinessState,
  serviceId: string,
  tenantId: string,
  auditFn: (event: InternalServiceCatalogAndReadinessAuditEvent) => InternalServiceCatalogAndReadinessError | null,
): InternalServiceCatalogAndReadinessState | InternalServiceCatalogAndReadinessError {
  const scopeError = validateTenantScope(tenantId);
  if (scopeError !== null) {
    return scopeError;
  }

  const auditError = auditCatalogChange(
    'CATALOG_SERVICE_DEREGISTERED',
    serviceId,
    tenantId,
    null,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const serviceIndex = state.services.findIndex(s => s.id === serviceId && s.tenantId === tenantId);
  if (serviceIndex === -1) {
    return {
      ...state,
      lastError: {
        kind: 'SERVICE_REFERENCE_INVALID',
        message: 'Service not found for deregistration',
        serviceId,
        tenantId,
      },
    };
  }

  const newServices = [...state.services];
  newServices.splice(serviceIndex, 1);

  return {
    ...state,
    services: newServices,
    lastAuditEvent: {
      kind: 'CATALOG_SERVICE_DEREGISTERED',
      serviceId,
      tenantId,
      timestamp: new Date().toISOString(),
      details: null,
    },
    lastError: null,
  };
}

export interface ReadinessProbeResult {
  readonly state: InternalServiceCatalogAndReadinessReadinessState;
  readonly serviceId: string;
  readonly tenantId: string;
}

export function invokeReadinessProbe(
  service: InternalServiceCatalogAndReadinessService,
  probeFn: (port: number) => ReadinessProbeResult | InternalServiceCatalogAndReadinessError,
  auditFn: (event: InternalServiceCatalogAndReadinessAuditEvent) => InternalServiceCatalogAndReadinessError | null,
): ReadinessProbeResult | InternalServiceCatalogAndReadinessError {
  const auditError = auditCatalogChange(
    'READINESS_PROBE_INVOKED',
    service.id,
    service.tenantId,
    { port: service.readinessPort },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const probeResult = probeFn(service.readinessPort);
  if ('kind' in probeResult) {
    return probeResult;
  }

  const stateChangeAuditError = auditCatalogChange(
    'READINESS_STATE_CHANGED',
    service.id,
    service.tenantId,
    { from: null, to: probeResult.state },
    auditFn,
  );
  if (stateChangeAuditError !== null) {
    return stateChangeAuditError;
  }

  return probeResult;
}

export function getTenantScopedReadiness(
  state: InternalServiceCatalogAndReadinessState,
  tenantId: string,
  probeFn: (port: number) => ReadinessProbeResult | InternalServiceCatalogAndReadinessError,
  auditFn: (event: InternalServiceCatalogAndReadinessAuditEvent) => InternalServiceCatalogAndReadinessError | null,
): {
  readonly services: readonly {
    readonly serviceId: string;
    readonly provider: string;
    readonly readinessState: InternalServiceCatalogAndReadinessReadinessState;
  }[];
  readonly aggregateState: InternalServiceCatalogAndReadinessReadinessState;
  readonly error: InternalServiceCatalogAndReadinessError | null;
} {
  const scopeError = validateTenantScope(tenantId);
  if (scopeError !== null) {
    return {
      services: [],
      aggregateState: 'UNAVAILABLE',
      error: scopeError,
    };
  }

  const tenantServices = state.services.filter(s => s.tenantId === tenantId);
  if (tenantServices.length === 0) {
    return {
      services: [],
      aggregateState: 'UNAVAILABLE',
      error: {
        kind: 'SERVICE_REFERENCE_INVALID',
        message: 'No services found for tenant',
        tenantId,
      },
    };
  }

  const serviceReadiness: Array<{
    readonly serviceId: string;
    readonly provider: string;
    readonly readinessState: InternalServiceCatalogAndReadinessReadinessState;
  }> = [];

  let worstState: InternalServiceCatalogAndReadinessReadinessState = 'READY';
  let lastError: InternalServiceCatalogAndReadinessError | null = null;

  for (const service of tenantServices) {
    const probeResult = invokeReadinessProbe(service, probeFn, auditFn);
    if ('kind' in probeResult) {
      serviceReadiness.push({
        serviceId: service.id,
        provider: service.provider,
        readinessState: 'UNAVAILABLE',
      });
      if (probeResult.kind === 'PROBE_FAILURE' || probeResult.kind === 'PROVIDER_UNAVAILABLE') {
        worstState = 'UNAVAILABLE';
      } else {
        worstState = 'DEGRADED';
      }
      lastError = probeResult;
      continue;
    }

    serviceReadiness.push({
      serviceId: service.id,
      provider: service.provider,
      readinessState: probeResult.state,
    });

    if (probeResult.state === 'UNAVAILABLE') {
      worstState = 'UNAVAILABLE';
    } else if (probeResult.state === 'DEGRADED' && worstState === 'READY') {
      worstState = 'DEGRADED';
    }
  }

  return {
    services: serviceReadiness,
    aggregateState: worstState,
    error: lastError,
  };
}