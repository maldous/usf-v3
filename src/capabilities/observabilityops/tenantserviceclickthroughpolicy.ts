export const TenantServiceClickthroughPolicyDecision = [
  'GRANTED',
  'DENIED',
  'INVALID_CONFIGURATION',
  'RECONCILER_UNAVAILABLE',
] as const;
export type TenantServiceClickthroughPolicyDecision = typeof TenantServiceClickthroughPolicyDecision[number];

export const TenantServiceClickthroughPolicyAuditEventKind = [
  'ACCESS_DECISION',
  'POLICY_CHANGE',
  'RECONCILIATION_CHANGE',
] as const;
export type TenantServiceClickthroughPolicyAuditEventKind = typeof TenantServiceClickthroughPolicyAuditEventKind[number];

export const TenantServiceClickthroughPolicyErrorKind = [
  'AUDIT_FAILURE',
  'MISSING_TENANT_ISOLATION',
  'INVALID_SERVICE_DESCRIPTOR',
  'RECONCILER_FAILURE',
  'MIGRATION_BYPASS',
] as const;
export type TenantServiceClickthroughPolicyErrorKind = typeof TenantServiceClickthroughPolicyErrorKind[number];

export const TenantServiceClickthroughPolicyReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type TenantServiceClickthroughPolicyReadiness = typeof TenantServiceClickthroughPolicyReadiness[number];

export const TenantServiceClickthroughPolicyClassification = [
  'INTERNAL',
  'COMPOSED',
  'DEV_ONLY',
] as const;
export type TenantServiceClickthroughPolicyClassification = typeof TenantServiceClickthroughPolicyClassification[number];

export interface TenantServiceClickthroughPolicyServiceDescriptor {
  readonly id: string;
  readonly resource: string;
  readonly apexPath: string;
  readonly tenantPath: string;
  readonly classification: TenantServiceClickthroughPolicyClassification;
  readonly landingPath: string;
  readonly devOnly: boolean;
  readonly systemAdminResourceSets: readonly string[];
  readonly tenantAdminResourceSets: readonly string[];
}

export interface TenantServiceClickthroughPolicyAuditEvent {
  readonly kind: TenantServiceClickthroughPolicyAuditEventKind;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly decision: TenantServiceClickthroughPolicyDecision | null;
  readonly reason: string;
  readonly dsrGdprEvidence: unknown;
  readonly timestamp: string;
}

export interface TenantServiceClickthroughPolicyError {
  readonly kind: TenantServiceClickthroughPolicyErrorKind;
  readonly message: string;
  readonly tenantId: string | null;
}

export interface TenantServiceClickthroughPolicyState {
  readonly services: readonly TenantServiceClickthroughPolicyServiceDescriptor[];
  readonly lastDecision: TenantServiceClickthroughPolicyDecision | null;
  readonly lastError: TenantServiceClickthroughPolicyError | null;
  readonly readiness: TenantServiceClickthroughPolicyReadiness;
  readonly auditEvents: readonly TenantServiceClickthroughPolicyAuditEvent[];
  readonly reconcilerAvailable: boolean;
}

export const initialState: TenantServiceClickthroughPolicyState = {
  services: [],
  lastDecision: null,
  lastError: null,
  readiness: 'NOT_READY',
  auditEvents: [],
  reconcilerAvailable: false,
};

export interface TenantServiceClickthroughPolicyDecisionResult {
  readonly decision: TenantServiceClickthroughPolicyDecision;
  readonly reason: string;
  readonly clickthroughUrl: string | null;
  readonly forwardAuthSets: readonly string[];
  readonly reconciliationConfig: string | null;
}

export function validateServiceDescriptor(
  descriptor: TenantServiceClickthroughPolicyServiceDescriptor,
): TenantServiceClickthroughPolicyError | null {
  if (descriptor.id.trim() === '') {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'Service ID cannot be empty',
      tenantId: null,
    };
  }
  if (descriptor.apexPath.trim() === '') {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'Apex path cannot be empty',
      tenantId: null,
    };
  }
  if (descriptor.tenantPath.trim() === '') {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'Tenant path cannot be empty',
      tenantId: null,
    };
  }
  if (descriptor.landingPath.trim() === '') {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'Landing path cannot be empty',
      tenantId: null,
    };
  }
  if (!TenantServiceClickthroughPolicyClassification.includes(descriptor.classification)) {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'Invalid service classification',
      tenantId: null,
    };
  }
  return null;
}

export function auditAccessDecision(
  tenantId: string,
  serviceId: string,
  decision: TenantServiceClickthroughPolicyDecision | null,
  reason: string,
  dsrGdprEvidence: unknown,
  auditFn: (event: TenantServiceClickthroughPolicyAuditEvent) => TenantServiceClickthroughPolicyError | null,
): TenantServiceClickthroughPolicyError | null {
  const event: TenantServiceClickthroughPolicyAuditEvent = {
    kind: 'ACCESS_DECISION',
    tenantId,
    serviceId,
    decision,
    reason,
    dsrGdprEvidence,
    timestamp: new Date().toISOString(),
  };
  try {
    const result = auditFn(event);
    if (result !== null) {
      if (result.kind === undefined) {
        return {
          kind: 'AUDIT_FAILURE',
          message: result.message ?? 'Audit failure',
          tenantId,
        };
      }
      return result;
    }
    return null;
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit failed',
      tenantId,
    };
  }
}

export function auditPolicyChange(
  tenantId: string,
  serviceId: string,
  auditFn: (event: TenantServiceClickthroughPolicyAuditEvent) => TenantServiceClickthroughPolicyError | null,
): TenantServiceClickthroughPolicyError | null {
  const event: TenantServiceClickthroughPolicyAuditEvent = {
    kind: 'POLICY_CHANGE',
    tenantId,
    serviceId,
    decision: null,
    reason: 'Policy configuration changed',
    dsrGdprEvidence: null,
    timestamp: new Date().toISOString(),
  };
  try {
    const result = auditFn(event);
    if (result !== null) {
      if (result.kind === undefined) {
        return {
          kind: 'AUDIT_FAILURE',
          message: result.message ?? 'Audit failure',
          tenantId,
        };
      }
      return result;
    }
    return null;
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit failed',
      tenantId,
    };
  }
}

export function auditReconciliationChange(
  tenantId: string,
  serviceId: string,
  auditFn: (event: TenantServiceClickthroughPolicyAuditEvent) => TenantServiceClickthroughPolicyError | null,
): TenantServiceClickthroughPolicyError | null {
  const event: TenantServiceClickthroughPolicyAuditEvent = {
    kind: 'RECONCILIATION_CHANGE',
    tenantId,
    serviceId,
    decision: null,
    reason: 'Reconciliation configuration changed',
    dsrGdprEvidence: null,
    timestamp: new Date().toISOString(),
  };
  try {
    const result = auditFn(event);
    if (result !== null) {
      if (result.kind === undefined) {
        return {
          kind: 'AUDIT_FAILURE',
          message: result.message ?? 'Audit failure',
          tenantId,
        };
      }
      return result;
    }
    return null;
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit failed',
      tenantId,
    };
  }
}

export function addServiceDescriptor(
  state: TenantServiceClickthroughPolicyState,
  descriptor: TenantServiceClickthroughPolicyServiceDescriptor,
  auditFn: (event: TenantServiceClickthroughPolicyAuditEvent) => TenantServiceClickthroughPolicyError | null,
): TenantServiceClickthroughPolicyState | TenantServiceClickthroughPolicyError {
  const validationError = validateServiceDescriptor(descriptor);
  if (validationError !== null) {
    return validationError;
  }

  const auditError = auditPolicyChange(descriptor.tenantPath, descriptor.id, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const existingService = state.services.find((s) => s.id === descriptor.id);
  if (existingService !== undefined) {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'Service descriptor with this ID already exists',
      tenantId: descriptor.tenantPath,
    };
  }

  const newAuditEvents: readonly TenantServiceClickthroughPolicyAuditEvent[] = [
    ...state.auditEvents,
    {
      kind: 'POLICY_CHANGE',
      tenantId: descriptor.tenantPath,
      serviceId: descriptor.id,
      decision: null,
      reason: 'Policy configuration changed',
      dsrGdprEvidence: null,
      timestamp: new Date().toISOString(),
    },
  ];

  const nextReadiness: TenantServiceClickthroughPolicyReadiness =
    state.reconcilerAvailable ? 'READY' : 'DEGRADED';

  return {
    ...state,
    services: [...state.services, descriptor],
    lastDecision: null,
    lastError: null,
    readiness: nextReadiness,
    auditEvents: newAuditEvents,
  };
}

export function computeAccessDecision(
  state: TenantServiceClickthroughPolicyState,
  tenantId: string,
  serviceId: string,
  userResourceSets: readonly string[],
  reconcilerAvailable: boolean,
  auditFn: (event: TenantServiceClickthroughPolicyAuditEvent) => TenantServiceClickthroughPolicyError | null,
): TenantServiceClickthroughPolicyDecisionResult | TenantServiceClickthroughPolicyError {
  const service = state.services.find((s) => s.id === serviceId);
  if (service === undefined) {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'Service not found',
      tenantId,
    };
  }

  if (service.tenantPath !== tenantId) {
    const auditError = auditAccessDecision(
      tenantId,
      serviceId,
      'DENIED',
      'Tenant isolation violation: service does not belong to tenant',
      null,
      auditFn,
    );
    if (auditError !== null) {
      return auditError;
    }
    return {
      kind: 'MISSING_TENANT_ISOLATION',
      message: 'Tenant isolation violation: service does not belong to tenant',
      tenantId,
    };
  }

  if (service.devOnly) {
    const auditError = auditAccessDecision(
      tenantId,
      serviceId,
      'DENIED',
      'Dev-only service not accessible in this context',
      null,
      auditFn,
    );
    if (auditError !== null) {
      return auditError;
    }
    return {
      decision: 'DENIED',
      reason: 'Dev-only service not accessible in this context',
      clickthroughUrl: null,
      forwardAuthSets: [],
      reconciliationConfig: null,
    };
  }

  if (!reconcilerAvailable) {
    const auditError = auditAccessDecision(
      tenantId,
      serviceId,
      'RECONCILER_UNAVAILABLE',
      'Reconciler unavailable, defaulting to deny',
      null,
      auditFn,
    );
    if (auditError !== null) {
      return auditError;
    }
    return {
      decision: 'RECONCILER_UNAVAILABLE',
      reason: 'Reconciler unavailable',
      clickthroughUrl: null,
      forwardAuthSets: [],
      reconciliationConfig: null,
    };
  }

  const hasSystemAdminAccess = service.systemAdminResourceSets.some((set) =>
    userResourceSets.includes(set),
  );
  const hasTenantAdminAccess = service.tenantAdminResourceSets.some((set) =>
    userResourceSets.includes(set),
  );

  if (!hasSystemAdminAccess && !hasTenantAdminAccess) {
    const auditError = auditAccessDecision(
      tenantId,
      serviceId,
      'DENIED',
      'User lacks required resource sets for access',
      null,
      auditFn,
    );
    if (auditError !== null) {
      return auditError;
    }
    return {
      decision: 'DENIED',
      reason: 'User lacks required resource sets for access',
      clickthroughUrl: null,
      forwardAuthSets: [],
      reconciliationConfig: null,
    };
  }

  const clickthroughUrl = `${service.apexPath}${service.tenantPath}${service.landingPath}`;
  const forwardAuthSets = [
    ...(hasSystemAdminAccess ? service.systemAdminResourceSets : []),
    ...(hasTenantAdminAccess ? service.tenantAdminResourceSets : []),
  ];
  const reconciliationConfig = generateCaddyfileReconciliation(
    service,
    forwardAuthSets,
  );

  const auditError = auditAccessDecision(
    tenantId,
    serviceId,
    'GRANTED',
    'Access granted based on resource sets',
    { userResourceSets, serviceResourceSets: forwardAuthSets },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    decision: 'GRANTED',
    reason: 'Access granted based on resource sets',
    clickthroughUrl,
    forwardAuthSets,
    reconciliationConfig,
  };
}

function generateCaddyfileReconciliation(
  service: TenantServiceClickthroughPolicyServiceDescriptor,
  forwardAuthSets: readonly string[],
): string {
  const authSetsString = forwardAuthSets.join(',');
  return `
    ${service.apexPath}${service.tenantPath}* {
      forward_auth /auth {
        uri /auth/verify?sets=${authSetsString}
        copy_headers Remote-User Remote-Groups
      }
      reverse_proxy ${service.landingPath}
    }
  `.trim();
}

export function deriveReconciliation(
  state: TenantServiceClickthroughPolicyState,
  tenantId: string,
  reconcilerAvailable: boolean,
  auditFn: (event: TenantServiceClickthroughPolicyAuditEvent) => TenantServiceClickthroughPolicyError | null,
): string | TenantServiceClickthroughPolicyError {
  if (!reconcilerAvailable) {
    const auditError = auditReconciliationChange(
      tenantId,
      'all',
      auditFn,
    );
    if (auditError !== null) {
      return auditError;
    }
    return {
      kind: 'RECONCILER_FAILURE',
      message: 'Reconciler unavailable, cannot derive reconciliation',
      tenantId,
    };
  }

  const tenantServices = state.services.filter((s) => s.tenantPath === tenantId);
  if (tenantServices.length === 0) {
    return {
      kind: 'INVALID_SERVICE_DESCRIPTOR',
      message: 'No services found for tenant',
      tenantId,
    };
  }

  const reconciliationParts = tenantServices.map((service) => {
    const forwardAuthSets = [
      ...service.systemAdminResourceSets,
      ...service.tenantAdminResourceSets,
    ];
    return generateCaddyfileReconciliation(service, forwardAuthSets);
  });

  const fullReconciliation = reconciliationParts.join('\n\n');

  const auditError = auditReconciliationChange(
    tenantId,
    'all',
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return fullReconciliation;
}

export function getReadiness(
  state: TenantServiceClickthroughPolicyState,
): TenantServiceClickthroughPolicyReadiness {
  if (!state.reconcilerAvailable) {
    return 'DEGRADED';
  }
  if (state.services.length === 0) {
    return 'NOT_READY';
  }
  return state.readiness;
}

export function setReadiness(
  state: TenantServiceClickthroughPolicyState,
  readiness: TenantServiceClickthroughPolicyReadiness,
  reconcilerAvailable: boolean,
): TenantServiceClickthroughPolicyState {
  const effectiveReadiness: TenantServiceClickthroughPolicyReadiness =
    !reconcilerAvailable && readiness === 'READY' ? 'DEGRADED' : readiness;
  return {
    ...state,
    readiness: effectiveReadiness,
    reconcilerAvailable,
  };
}

export function computeReadiness(
  state: TenantServiceClickthroughPolicyState,
  reconcilerAvailable: boolean,
): TenantServiceClickthroughPolicyState {
  const nextReadiness: TenantServiceClickthroughPolicyReadiness = !reconcilerAvailable
    ? 'DEGRADED'
    : state.services.length === 0
      ? 'NOT_READY'
      : 'READY';
  return {
    ...state,
    readiness: nextReadiness,
    reconcilerAvailable,
  };
}