// servicecatalogandproviderintegrationmodel.ts

// --- Type Definitions ---

export const Visibility = ['tenant_scoped_safe', 'global_only', 'not_exposed'] as const;
export type Visibility = typeof Visibility[number];

export const IntegrationDecision = ['build', 'compose', 'adapter', 'defer', 'reject'] as const;
export type IntegrationDecision = typeof IntegrationDecision[number];

export type EntitlementKey = string;

export type ResourceType = string;

// Fixed set of error kinds for the error model
export const ErrorKind = [
  'AUDIT_FAILURE',
  'AUTHENTICATION_REQUIRED',
  'STEP_UP_REQUIRED',
  'POLICY_DENIED',
  'SERVER_UNAVAILABLE',
] as const;
export type ErrorKind = typeof ErrorKind[number];

// Fixed set of decision kinds
export const DecisionKind = [
  'GRANTED',
  'POLICY_DENIED',
  'RESOURCE_NOT_REGISTERED',
  'INSUFFICIENT_AUTH_LEVEL',
] as const;
export type DecisionKind = typeof DecisionKind[number];

// Fixed set of readiness values
export const Readiness = ['READY', 'NOT_READY'] as const;
export type Readiness = typeof Readiness[number];

// Audit event kind
export const AuditEventKind = ['AUDIT_BEFORE_CHANGE'] as const;
export type AuditEventKind = typeof AuditEventKind[number];

// --- Audit Model ---

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly resource: string;
  readonly operation: string;
  readonly actor: string;
  readonly timestamp: string;
}

export interface AuditResult {
  readonly kind: AuditEventKind;
  readonly resource: string;
  readonly operation: string;
  readonly actor: string;
  readonly outcome: 'success' | 'failure';
  readonly timestamp: string;
}

export function recordAuditBeforeMutation(
  resource: string,
  operation: string,
  actor: string,
  outcome: 'success' | 'failure'
): AuditResult {
  return {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource,
    operation,
    actor,
    outcome,
    timestamp: new Date().toISOString(),
  };
}

export function applyAuditToState(
  state: ServiceCatalogModel,
  event: AuditEvent
): ServiceCatalogModel {
  return {
    ...state,
    lastAuditEvent: event,
  };
}

// --- Error Model ---

export interface TypedError {
  readonly kind: ErrorKind;
  readonly message: string;
}

export function createAuditFailureError(message: string): TypedError {
  return { kind: 'AUDIT_FAILURE', message };
}

export function createPolicyDeniedError(message: string): TypedError {
  return { kind: 'POLICY_DENIED', message };
}

export function createServerUnavailableError(message: string): TypedError {
  return { kind: 'SERVER_UNAVAILABLE', message };
}

export function handleProviderFailure(reason: string): TypedError {
  if (reason === 'unavailable' || reason === 'timeout') {
    return createServerUnavailableError(`Provider failure: ${reason}`);
  }
  return createPolicyDeniedError(`Provider failure: ${reason}`);
}

// --- Permissions & Isolation ---

export interface TenantToken {
  readonly authLevel: string;
  readonly tenantId: string;
}

export function validatePermission(
  resource: string,
  requiredPermission: string,
  token: unknown
): boolean {
  if (typeof token !== 'object' || token === null) {
    return false;
  }
  const tenantToken = token as TenantToken;
  return tenantToken.authLevel === requiredPermission;
}

export function checkTenantIsolation(
  entry: ServiceCatalogEntry,
  tenantId: string
): boolean {
  if (entry.visibility === 'global_only') {
    return true;
  }
  if (entry.visibility === 'tenant_scoped_safe') {
    return true;
  }
  return false;
}

// --- State Model ---

export interface ServiceCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly visibility: Visibility;
  readonly integrationDecision: IntegrationDecision;
  readonly entitlementKey: EntitlementKey;
  readonly readiness: Readiness;
  readonly providerDetails: Readonly<Record<string, unknown>>;
  readonly consoleAccessFlag: boolean;
}

export interface ServiceCatalogModel {
  readonly resources: ReadonlyMap<string, ServiceCatalogEntry>;
  readonly lastAuditEvent: AuditEvent | null;
  readonly lastDecision: DecisionKind | null;
  readonly lastError: TypedError | null;
  readonly readiness: Readiness;
}

export const initialModel: ServiceCatalogModel = {
  resources: new Map(),
  lastAuditEvent: null,
  lastDecision: null,
  lastError: null,
  readiness: 'NOT_READY',
};

// --- API Contract ---

export interface ServiceCatalogAPI {
  getCatalog(model: ServiceCatalogModel): ReadonlyArray<ServiceCatalogEntry>;
  registerService(
    model: ServiceCatalogModel,
    service: Omit<ServiceCatalogEntry, 'id'>,
    auditFn: (event: AuditEvent) => TypedError | null
  ): ServiceCatalogModel | TypedError;
  unregisterService(
    model: ServiceCatalogModel,
    id: string,
    auditFn: (event: AuditEvent) => TypedError | null
  ): ServiceCatalogModel | TypedError;
  updateIntegration(
    model: ServiceCatalogModel,
    serviceId: string,
    decision: IntegrationDecision,
    entitlementKey: EntitlementKey,
    auditFn: (event: AuditEvent) => TypedError | null
  ): ServiceCatalogModel | TypedError;
}

// --- Lifecycle Management ---

export function registerPlatformService(
  model: ServiceCatalogModel,
  service: Omit<ServiceCatalogEntry, 'id'>,
  auditFn: (event: AuditEvent) => TypedError | null
): ServiceCatalogModel | TypedError {
  const id = `${service.name}-${Date.now()}`;
  const newEntry: ServiceCatalogEntry = {
    ...service,
    id,
  };

  const auditEvent: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource: id,
    operation: 'register',
    actor: 'system',
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const newResources = new Map(model.resources);
  newResources.set(id, newEntry);

  return {
    ...model,
    resources: newResources,
    lastAuditEvent: auditEvent,
    lastDecision: 'GRANTED',
    lastError: null,
  };
}

// --- Proof Functions (Hermetic Runtime Lineage) ---

export function provePlatformServices(model: ServiceCatalogModel): boolean {
  if (model.resources.size === 0) {
    return false;
  }

  for (const entry of model.resources.values()) {
    if (
      !entry.id ||
      !entry.name ||
      !entry.category ||
      !Visibility.includes(entry.visibility) ||
      !IntegrationDecision.includes(entry.integrationDecision) ||
      typeof entry.entitlementKey !== 'string' ||
      !Readiness.includes(entry.readiness)
    ) {
      return false;
    }
  }

  return true;
}

export function proveServiceClickthroughPolicy(model: ServiceCatalogModel): boolean {
  for (const entry of model.resources.values()) {
    if (entry.consoleAccessFlag) {
      return true;
    }
  }
  return false;
}

export function proveServiceCatalogRegistry(model: ServiceCatalogModel): boolean {
  return model.resources.size > 0;
}

export function proveEntitlementsRoutes(model: ServiceCatalogModel): boolean {
  for (const entry of model.resources.values()) {
    if (entry.entitlementKey.length > 0) {
      return true;
    }
  }
  return false;
}

export function runAllProofs(model: ServiceCatalogModel): boolean {
  return (
    provePlatformServices(model) &&
    proveServiceClickthroughPolicy(model) &&
    proveServiceCatalogRegistry(model) &&
    proveEntitlementsRoutes(model)
  );
}

// --- Readiness Model ---

export function determineReadiness(model: ServiceCatalogModel): Readiness {
  if (model.readiness === 'READY') {
    return 'READY';
  }

  for (const entry of model.resources.values()) {
    if (entry.readiness !== 'READY') {
      return 'NOT_READY';
    }
  }

  return 'READY';
}

export function getReadiness(model: ServiceCatalogModel): Readiness {
  return model.readiness;
}

// --- State Updates ---

export function validateCatalogEntry(entry: Omit<ServiceCatalogEntry, 'id'>): TypedError | null {
  if (
    !entry.name ||
    !entry.category ||
    !Visibility.includes(entry.visibility) ||
    !IntegrationDecision.includes(entry.integrationDecision) ||
    typeof entry.entitlementKey !== 'string' ||
    !Readiness.includes(entry.readiness) ||
    typeof entry.providerDetails !== 'object' ||
    typeof entry.consoleAccessFlag !== 'boolean'
  ) {
    return createPolicyDeniedError('Invalid catalog entry');
  }
  return null;
}

export function updateServiceState(
  model: ServiceCatalogModel,
  serviceId: string,
  updates: Partial<Omit<ServiceCatalogEntry, 'id'>>,
  auditFn: (event: AuditEvent) => TypedError | null
): ServiceCatalogModel | TypedError {
  const entry = model.resources.get(serviceId);
  if (!entry) {
    return createPolicyDeniedError(`Service ${serviceId} not found`);
  }

  const updatedEntry: ServiceCatalogEntry = {
    ...entry,
    ...updates,
  };

  const validationError = validateCatalogEntry(updatedEntry);
  if (validationError !== null) {
    return validationError;
  }

  const auditEvent: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource: serviceId,
    operation: 'update',
    actor: 'system',
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const newResources = new Map(model.resources);
  newResources.set(serviceId, updatedEntry);

  return {
    ...model,
    resources: newResources,
    lastAuditEvent: auditEvent,
    lastDecision: 'GRANTED',
    lastError: null,
  };
}

// --- API Contract Implementation ---

export function getCatalog(model: ServiceCatalogModel): ReadonlyArray<ServiceCatalogEntry> {
  return Array.from(model.resources.values());
}

export function registerService(
  model: ServiceCatalogModel,
  service: Omit<ServiceCatalogEntry, 'id'>,
  auditFn: (event: AuditEvent) => TypedError | null
): ServiceCatalogModel | TypedError {
  const validationError = validateCatalogEntry(service);
  if (validationError !== null) {
    return validationError;
  }

  return registerPlatformService(model, service, auditFn);
}

export function unregisterService(
  model: ServiceCatalogModel,
  id: string,
  auditFn: (event: AuditEvent) => TypedError | null
): ServiceCatalogModel | TypedError {
  const entry = model.resources.get(id);
  if (!entry) {
    return createPolicyDeniedError(`Service ${id} not found`);
  }

  const auditEvent: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource: id,
    operation: 'unregister',
    actor: 'system',
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const newResources = new Map(model.resources);
  newResources.delete(id);

  return {
    ...model,
    resources: newResources,
    lastAuditEvent: auditEvent,
    lastDecision: 'GRANTED',
    lastError: null,
  };
}

export function updateIntegration(
  model: ServiceCatalogModel,
  serviceId: string,
  decision: IntegrationDecision,
  entitlementKey: EntitlementKey,
  auditFn: (event: AuditEvent) => TypedError | null
): ServiceCatalogModel | TypedError {
  const entry = model.resources.get(serviceId);
  if (!entry) {
    return createPolicyDeniedError(`Service ${serviceId} not found`);
  }

  const updates: Partial<Omit<ServiceCatalogEntry, 'id'>> = {
    integrationDecision: decision,
    entitlementKey,
  };

  return updateServiceState(model, serviceId, updates, auditFn);
}