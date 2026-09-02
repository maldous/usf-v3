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
  'DEGRADED_FAILURE',
  'CONFIGURATION_INVALID',
  'TENANT_ISOLATION_VIOLATION',
] as const;
export type ErrorKind = typeof ErrorKind[number];

// Fixed set of decision kinds
export const DecisionKind = [
  'GRANTED',
  'POLICY_DENIED',
  'RESOURCE_NOT_REGISTERED',
  'INSUFFICIENT_AUTH_LEVEL',
  'DEGRADED',
] as const;
export type DecisionKind = typeof DecisionKind[number];

// Fixed set of readiness values
export const Readiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
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
  readonly details?: Readonly<Record<string, unknown>>;
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
  readonly isError: true;
  readonly statusCode?: number;
}

export function isTypedError(value: unknown): value is TypedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isError' in value &&
    (value as TypedError).isError === true
  );
}

export function createAuditFailureError(message: string): TypedError {
  return { kind: 'AUDIT_FAILURE', message, isError: true, statusCode: 403 };
}

export function createPolicyDeniedError(message: string): TypedError {
  return { kind: 'POLICY_DENIED', message, isError: true, statusCode: 403 };
}

export function createServerUnavailableError(message: string): TypedError {
  return { kind: 'SERVER_UNAVAILABLE', message, isError: true, statusCode: 503 };
}

export function createDegradedFailureError(message: string): TypedError {
  return { kind: 'DEGRADED_FAILURE', message, isError: true, statusCode: 503 };
}

export function createConfigurationInvalidError(message: string): TypedError {
  return { kind: 'CONFIGURATION_INVALID', message, isError: true, statusCode: 400 };
}

export function createTenantIsolationViolationError(message: string): TypedError {
  return { kind: 'TENANT_ISOLATION_VIOLATION', message, isError: true, statusCode: 403 };
}

export function handleProviderFailure(reason: string): TypedError {
  if (reason === 'unavailable' || reason === 'timeout') {
    return createServerUnavailableError(`Provider failure: ${reason}`);
  }
  return createDegradedFailureError(`Provider failure: ${reason}`);
}

// --- Permissions & Isolation ---

export interface TenantToken {
  readonly authLevel?: string;
  readonly tenantId: string;
  readonly entitlements?: readonly string[];
  readonly permissions?: readonly string[];
}

export function validatePermission(
  resource: string,
  requiredPermission: string,
  token: unknown
): boolean {
  if (typeof token !== 'object' || token === null) {
    return false;
  }
  const t = token as Record<string, unknown>;
  if (t.authLevel === requiredPermission) {
    return true;
  }
  if (Array.isArray(t.permissions) && t.permissions.includes(requiredPermission)) {
    return true;
  }
  return false;
}

export function checkTenantIsolation(
  entry: ServiceCatalogEntry,
  tenantId: string
): boolean {
  if (entry.visibility === 'not_exposed') {
    return false;
  }
  if (entry.visibility === 'global_only') {
    return true;
  }
  if (entry.visibility === 'tenant_scoped_safe') {
    return Boolean(tenantId && tenantId.length > 0);
  }
  return false;
}

export function checkTenantAccess(
  entry: ServiceCatalogEntry,
  token: TenantToken
): boolean {
  if (!checkTenantIsolation(entry, token.tenantId)) {
    return false;
  }
  if (entry.entitlementKey && entry.entitlementKey.length > 0) {
    const userEntitlements = token.entitlements ?? [];
    if (!userEntitlements.includes(entry.entitlementKey)) {
      return false;
    }
  }
  return true;
}

// --- State Model ---

export interface ServiceCatalogEntry {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly environmentModel?: string;
  readonly visibility: Visibility;
  readonly integrationDecision: IntegrationDecision;
  readonly entitlementKey: EntitlementKey;
  readonly readiness: Readiness;
  readonly providerDetails: Readonly<Record<string, unknown>>;
  readonly consoleAccessFlag: boolean;
  readonly proofReferences?: readonly string[];
}

export interface ServiceCatalogModel {
  readonly resources: ReadonlyMap<string, ServiceCatalogEntry>;
  readonly lastAuditEvent: AuditEvent | null;
  readonly lastDecision: DecisionKind | null;
  readonly lastError: TypedError | null;
  readonly readiness: Readiness;
  readonly degraded: boolean;
}

export const initialModel: ServiceCatalogModel = {
  resources: new Map(),
  lastAuditEvent: null,
  lastDecision: null,
  lastError: null,
  readiness: 'NOT_READY',
  degraded: false,
};

export const initialState: ServiceCatalogModel = initialModel;

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
  if (model.resources.size === 0) {
    return false;
  }
  let hasValid = false;
  for (const entry of model.resources.values()) {
    if (entry.consoleAccessFlag) {
      if (entry.visibility === 'not_exposed') {
        return false;
      }
      hasValid = true;
    }
  }
  return hasValid;
}

export function proveServiceCatalogRegistry(model: ServiceCatalogModel): boolean {
  return model.resources.size > 0;
}

export function proveEntitlementsRoutes(model: ServiceCatalogModel): boolean {
  if (model.resources.size === 0) {
    return false;
  }
  for (const entry of model.resources.values()) {
    if (entry.entitlementKey && entry.entitlementKey.length > 0) {
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

export function verifyPromotionLineage(model: ServiceCatalogModel): boolean {
  return runAllProofs(model);
}

// --- Readiness Model ---

export function determineReadiness(model: ServiceCatalogModel): Readiness {
  if (model.degraded) {
    return 'DEGRADED';
  }
  if (model.resources.size === 0) {
    return 'NOT_READY';
  }
  let allReady = true;
  for (const entry of model.resources.values()) {
    if (entry.readiness === 'NOT_READY') {
      return 'NOT_READY';
    }
    if (entry.readiness === 'DEGRADED') {
      allReady = false;
    }
  }
  return allReady ? 'READY' : 'DEGRADED';
}

export function getReadiness(model: ServiceCatalogModel): Readiness {
  return model.readiness;
}

export function getPlatformServicesReadiness(model: ServiceCatalogModel): {
  readonly status: Readiness;
  readonly proofsPassed: boolean;
  readonly servicesCount: number;
} {
  return {
    status: getReadiness(model),
    proofsPassed: runAllProofs(model),
    servicesCount: model.resources.size,
  };
}

// --- Validation ---

export function validateCatalogEntry(
  entry: Partial<ServiceCatalogEntry> | Omit<ServiceCatalogEntry, 'id'>
): TypedError | null {
  if (!entry.name || typeof entry.name !== 'string' || entry.name.trim() === '') {
    return createConfigurationInvalidError('Missing or invalid service name');
  }
  if (!entry.category || typeof entry.category !== 'string') {
    return createConfigurationInvalidError('Missing or invalid service category');
  }
  if (!entry.visibility || !Visibility.includes(entry.visibility)) {
    return createConfigurationInvalidError('Missing or invalid visibility');
  }
  if (!entry.integrationDecision || !IntegrationDecision.includes(entry.integrationDecision)) {
    return createConfigurationInvalidError('Missing or invalid integration decision');
  }
  if (typeof entry.entitlementKey !== 'string') {
    return createConfigurationInvalidError('Invalid entitlement key');
  }
  if (!entry.readiness || !Readiness.includes(entry.readiness)) {
    return createConfigurationInvalidError('Missing or invalid readiness');
  }
  if (typeof entry.providerDetails !== 'object' || entry.providerDetails === null) {
    return createConfigurationInvalidError('Invalid or missing provider details');
  }
  if (typeof entry.consoleAccessFlag !== 'boolean') {
    return createConfigurationInvalidError('Invalid console access flag');
  }
  if (entry.visibility === 'not_exposed' && entry.consoleAccessFlag === true) {
    return createTenantIsolationViolationError('Unexposed service cannot have console access');
  }
  return null;
}

// --- Lifecycle Management & Mutations ---

export function registerPlatformService(
  model: ServiceCatalogModel,
  service: Omit<ServiceCatalogEntry, 'id'> & { readonly id?: string },
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  if (model.degraded) {
    return createDegradedFailureError('Cannot perform mutations in degraded mode');
  }

  const validationError = validateCatalogEntry(service);
  if (validationError !== null) {
    return validationError;
  }

  const id = service.id ?? service.key ?? `${service.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
  const key = service.key ?? id;

  const newEntry: ServiceCatalogEntry = {
    ...service,
    id,
    key,
    proofReferences: service.proofReferences ?? [
      'proof:platform-services',
      'proof:service-clickthrough-policy',
      'proof:service-catalog-registry',
      'proof:entitlements-routes',
    ],
  };

  const auditEvent: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource: id,
    operation: 'register',
    actor,
    timestamp: new Date().toISOString(),
    details: { service: newEntry },
  };

  try {
    const auditError = auditFn(auditEvent);
    if (auditError !== null) {
      return auditError;
    }
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }

  const newResources = new Map(model.resources);
  newResources.set(id, newEntry);

  const updatedModel: ServiceCatalogModel = {
    ...model,
    resources: newResources,
    lastAuditEvent: auditEvent,
    lastDecision: 'GRANTED',
    lastError: null,
  };

  return {
    ...updatedModel,
    readiness: determineReadiness(updatedModel),
  };
}

export function registerService(
  model: ServiceCatalogModel,
  service: Omit<ServiceCatalogEntry, 'id'> & { readonly id?: string },
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  return registerPlatformService(model, service, auditFn, actor);
}

export function updateServiceState(
  model: ServiceCatalogModel,
  serviceId: string,
  updates: Partial<Omit<ServiceCatalogEntry, 'id'>>,
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  if (model.degraded) {
    return createDegradedFailureError('Cannot perform mutations in degraded mode');
  }

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
    actor,
    timestamp: new Date().toISOString(),
    details: { updates },
  };

  try {
    const auditError = auditFn(auditEvent);
    if (auditError !== null) {
      return auditError;
    }
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }

  const newResources = new Map(model.resources);
  newResources.set(serviceId, updatedEntry);

  const updatedModel: ServiceCatalogModel = {
    ...model,
    resources: newResources,
    lastAuditEvent: auditEvent,
    lastDecision: 'GRANTED',
    lastError: null,
  };

  return {
    ...updatedModel,
    readiness: determineReadiness(updatedModel),
  };
}

export function unregisterService(
  model: ServiceCatalogModel,
  id: string,
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  if (model.degraded) {
    return createDegradedFailureError('Cannot perform mutations in degraded mode');
  }

  const entry = model.resources.get(id);
  if (!entry) {
    return createPolicyDeniedError(`Service ${id} not found`);
  }

  const auditEvent: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource: id,
    operation: 'unregister',
    actor,
    timestamp: new Date().toISOString(),
  };

  try {
    const auditError = auditFn(auditEvent);
    if (auditError !== null) {
      return auditError;
    }
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }

  const newResources = new Map(model.resources);
  newResources.delete(id);

  const updatedModel: ServiceCatalogModel = {
    ...model,
    resources: newResources,
    lastAuditEvent: auditEvent,
    lastDecision: 'GRANTED',
    lastError: null,
  };

  return {
    ...updatedModel,
    readiness: determineReadiness(updatedModel),
  };
}

export function updateIntegration(
  model: ServiceCatalogModel,
  serviceId: string,
  decision: IntegrationDecision,
  entitlementKey: EntitlementKey,
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  return updateServiceState(
    model,
    serviceId,
    {
      integrationDecision: decision,
      entitlementKey,
    },
    auditFn,
    actor
  );
}

// --- API Contract (Platform Readiness & GET /api/platform/service-catalog) ---

export function getCatalog(model: ServiceCatalogModel): ReadonlyArray<ServiceCatalogEntry> {
  return Array.from(model.resources.values());
}

export function getPlatformServiceCatalog(
  model: ServiceCatalogModel,
  token?: TenantToken
): ReadonlyArray<ServiceCatalogEntry> {
  const all = Array.from(model.resources.values());
  if (!token) {
    return all.filter((s) => s.visibility === 'global_only');
  }
  return all.filter((s) => checkTenantAccess(s, token));
}

export function recoverPlatformServices(
  model: ServiceCatalogModel,
  persistedEntries: readonly ServiceCatalogEntry[],
  auditFn: (event: AuditEvent) => TypedError | null
): ServiceCatalogModel | TypedError {
  const auditEvent: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource: 'catalog:recovery',
    operation: 'recover',
    actor: 'recovery-agent',
    timestamp: new Date().toISOString(),
  };

  try {
    const auditError = auditFn(auditEvent);
    if (auditError !== null) {
      return auditError;
    }
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }

  const restoredMap = new Map<string, ServiceCatalogEntry>();
  for (const entry of persistedEntries) {
    const err = validateCatalogEntry(entry);
    if (err !== null) {
      return err;
    }
    restoredMap.set(entry.id, entry);
  }

  const candidateModel: ServiceCatalogModel = {
    ...model,
    resources: restoredMap,
    lastAuditEvent: auditEvent,
    lastDecision: 'GRANTED',
    lastError: null,
    degraded: false,
    readiness: 'READY',
  };

  if (!verifyPromotionLineage(candidateModel)) {
    return createPolicyDeniedError('Recovery failed: platform proofs did not pass');
  }

  return {
    ...candidateModel,
    readiness: determineReadiness(candidateModel),
  };
}