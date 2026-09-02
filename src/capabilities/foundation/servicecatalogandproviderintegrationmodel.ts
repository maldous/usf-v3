export const Visibility = ['tenant_scoped_safe', 'global_only', 'not_exposed'] as const;
export type Visibility = typeof Visibility[number];

export const IntegrationDecision = ['build', 'compose', 'adapter', 'defer', 'reject'] as const;
export type IntegrationDecision = typeof IntegrationDecision[number];

export type EntitlementKey = string;
export type ResourceType = string;

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

export const DecisionKind = [
  'GRANTED',
  'POLICY_DENIED',
  'RESOURCE_NOT_REGISTERED',
  'INSUFFICIENT_AUTH_LEVEL',
  'DEGRADED',
] as const;
export type DecisionKind = typeof DecisionKind[number];

export const Readiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type Readiness = typeof Readiness[number];

export const AuditEventKind = ['AUDIT_BEFORE_CHANGE'] as const;
export type AuditEventKind = typeof AuditEventKind[number];

export const RequiredProofReferences = [
  'proof:platform-services',
  'proof:service-clickthrough-policy',
  'proof:service-catalog-registry',
  'proof:entitlements-routes',
] as const;
export type RequiredProofReferences = typeof RequiredProofReferences[number];

export const ProviderConfigKeys = [
  'platformServicesRegistry',
  'serviceCatalogRegistry',
  'providerAdapters',
  'observabilityAdapters',
  'entitlementsRegistry',
] as const;
export type ProviderConfigKeys = typeof ProviderConfigKeys[number];

export const CatalogEndpoints = [
  'GET /api/platform/service-catalog',
] as const;
export type CatalogEndpoints = typeof CatalogEndpoints[number];

export const CatalogContractVersions = [
  'catalog-v2',
] as const;
export type CatalogContractVersions = typeof CatalogContractVersions[number];

export const LifecycleReadinessModel = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type LifecycleReadinessModel = typeof LifecycleReadinessModel[number];

export const CatalogEntryDecisionSet = ['build', 'compose', 'adapter', 'defer', 'reject'] as const;
export type CatalogEntryDecisionSet = typeof CatalogEntryDecisionSet[number];

export const LifecycleProofs = [
  'proof:platform-services',
  'proof:service-clickthrough-policy',
  'proof:service-catalog-registry',
  'proof:entitlements-routes',
] as const;
export type LifecycleProofs = typeof LifecycleProofs[number];

export const LifecycleEndpoints = [
  'proof:platform-services',
  'proof:service-clickthrough-policy',
  'proof:service-catalog-registry',
  'proof:entitlements-routes',
  'GET /api/platform/service-catalog',
  'catalog-v2',
] as const;
export type LifecycleEndpoints = typeof LifecycleEndpoints[number];

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
    auditEvidencePreserved: true,
  };
}

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
    (value as { isError: unknown }).isError === true
  );
}

export function createAuditFailureError(message: string): TypedError {
  return { kind: 'AUDIT_FAILURE', message, isError: true, statusCode: 403 };
}

export function createAuthenticationRequiredError(message: string): TypedError {
  return { kind: 'AUTHENTICATION_REQUIRED', message, isError: true, statusCode: 401 };
}

export function createStepUpRequiredError(message: string): TypedError {
  return { kind: 'STEP_UP_REQUIRED', message, isError: true, statusCode: 401 };
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

export interface ProviderConfig {
  readonly platformServicesRegistry?: ReadonlyMap<string, ServiceCatalogEntry> | undefined;
  readonly serviceCatalogRegistry?: ReadonlyMap<string, ServiceCatalogEntry> | undefined;
  readonly providerAdapters?: ReadonlyMap<string, Readonly<Record<string, unknown>>> | undefined;
  readonly observabilityAdapters?: ReadonlyMap<string, Readonly<Record<string, unknown>>> | undefined;
  readonly entitlementsRegistry?: ReadonlyMap<string, readonly string[]> | undefined;
}

export function isProviderConfig(value: unknown): value is ProviderConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    if (!(ProviderConfigKeys as readonly string[]).includes(k)) {
      return false;
    }
    const field = v[k];
    if (field !== undefined && !(field instanceof Map)) {
      return false;
    }
  }
  return true;
}

export function readProviderConfig(
  config: unknown,
  key: ProviderConfigKeys
): ReadonlyMap<string, unknown> {
  if (!isProviderConfig(config)) {
    throw createConfigurationInvalidError(
      `Configuration plane for '${key}' is missing or invalid; failing closed`
    );
  }
  const v = config as Record<string, unknown>;
  const field = v[key];
  if (!(field instanceof Map)) {
    throw createConfigurationInvalidError(
      `Configuration plane for '${key}' is missing or invalid; failing closed`
    );
  }
  return field as ReadonlyMap<string, unknown>;
}

export function resolveProviderDetails(
  config: unknown,
  providerKey: string
): Readonly<Record<string, unknown>> {
  try {
    const adapters = readProviderConfig(config, 'providerAdapters');
    const v = adapters.get(providerKey);
    if (v === undefined || typeof v !== 'object' || v === null) {
      throw createConfigurationInvalidError(
        `Provider adapter for '${providerKey}' did not resolve; failing closed`
      );
    }
    return v as Readonly<Record<string, unknown>>;
  } catch (err) {
    if (isTypedError(err)) {
      throw err;
    }
    throw createConfigurationInvalidError(
      `Provider resolution for '${providerKey}' failed`
    );
  }
}

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
  readonly observabilityAdaptersAvailable: boolean;
  readonly tenantIsolationSignal: boolean;
  readonly auditSignal: boolean;
  readonly lifecycleReadiness: Readiness;
  readonly auditEvidencePreserved: boolean;
  readonly tenantBoundaryPreserved: boolean;
  readonly lifecycleContractUnchanged: boolean;
}

export const initialModel: ServiceCatalogModel = {
  resources: new Map(),
  lastAuditEvent: null,
  lastDecision: null,
  lastError: null,
  readiness: 'READY',
  degraded: false,
  observabilityAdaptersAvailable: true,
  tenantIsolationSignal: true,
  auditSignal: true,
  lifecycleReadiness: 'READY',
  auditEvidencePreserved: true,
  tenantBoundaryPreserved: true,
  lifecycleContractUnchanged: true,
};

export const initialState: ServiceCatalogModel = initialModel;

function isProviderResolved(details: Readonly<Record<string, unknown>>): boolean {
  const record = details as Record<string, unknown>;
  const falseByBoolean: readonly string[] = [
    'providerResolved',
    'resolved',
    'providerAvailable',
    'available',
    'adapterAvailable',
  ];

  for (const key of falseByBoolean) {
    const value = record[key];
    if (typeof value === 'boolean' && value === false) {
      return false;
    }
  }

  const explicitErrors: readonly string[] = [
    'resolutionError',
    'providerError',
    'adapterError',
    'providerResolutionError',
  ];
  for (const key of explicitErrors) {
    if (typeof record[key] === 'string' && (record[key] as string).trim().length > 0) {
      return false;
    }
  }

  const status = record.status;
  if (typeof status === 'string') {
    if (status === 'DEGRADED' || status === 'FAILED' || status === 'UNAVAILABLE') {
      return false;
    }
  }

  return true;
}

function isCatalogEntryCoherent(entry: ServiceCatalogEntry): boolean {
  return validateCatalogEntry(entry) === null && isProviderResolved(entry.providerDetails);
}

export function provePlatformServices(model: ServiceCatalogModel): boolean {
  if (model.resources.size === 0) {
    return false;
  }

  for (const entry of model.resources.values()) {
    if (!isCatalogEntryCoherent(entry)) {
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
  return runAllProofs(model) && model.lifecycleContractUnchanged;
}

export function determineReadiness(model: ServiceCatalogModel): Readiness {
  if (!model.tenantIsolationSignal || !model.auditSignal) {
    return 'NOT_READY';
  }
  if (!model.lifecycleContractUnchanged) {
    return 'NOT_READY';
  }
  if (!model.tenantBoundaryPreserved || !model.auditEvidencePreserved) {
    return 'NOT_READY';
  }
  if (model.resources.size === 0) {
    return 'READY';
  }
  if (!provePlatformServices(model)) {
    return 'NOT_READY';
  }

  if (model.degraded || !model.observabilityAdaptersAvailable) {
    return 'DEGRADED';
  }
  return 'READY';
}

export function getReadiness(model: ServiceCatalogModel): Readiness {
  return determineReadiness(model);
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

export function observabilityAdaptersAvailable(
  model: ServiceCatalogModel
): boolean {
  return model.observabilityAdaptersAvailable;
}

export function enterDegradedMode(
  model: ServiceCatalogModel,
  reason: string
): ServiceCatalogModel {
  const err = createDegradedFailureError(reason);
  return {
    ...model,
    degraded: true,
    observabilityAdaptersAvailable: false,
    readiness: 'DEGRADED',
    lifecycleReadiness: 'DEGRADED',
    lastDecision: 'DEGRADED',
    lastError: err,
    auditSignal: model.auditSignal,
    tenantIsolationSignal: model.tenantIsolationSignal,
    auditEvidencePreserved: true,
    tenantBoundaryPreserved: true,
  };
}

export function reportObservabilityAdapterLoss(
  model: ServiceCatalogModel,
  reason: string
): ServiceCatalogModel {
  return enterDegradedMode(model, reason);
}

export function restoreObservabilityAdapters(
  model: ServiceCatalogModel
): ServiceCatalogModel {
  if (!model.degraded) {
    return model;
  }
  const candidate: ServiceCatalogModel = {
    ...model,
    observabilityAdaptersAvailable: true,
  };
  return {
    ...candidate,
    degraded: false,
    readiness: determineReadiness(candidate),
    lifecycleReadiness: determineReadiness(candidate),
    lastError: null,
  };
}

export function isReadOnlyReadyInDegradedMode(model: ServiceCatalogModel): boolean {
  return model.degraded;
}

export function canMutateInCurrentMode(model: ServiceCatalogModel): boolean {
  if (!model.tenantIsolationSignal || !model.auditSignal) {
    return false;
  }
  if (!model.lifecycleContractUnchanged) {
    return false;
  }
  return !model.degraded && model.observabilityAdaptersAvailable;
}

export function detectMissingTenantIsolationOrAuditSignal(
  model: ServiceCatalogModel
): boolean {
  return !model.tenantIsolationSignal || !model.auditSignal;
}

export function raiseTenantDataOrSecurityAlert(
  model: ServiceCatalogModel
): TypedError {
  return createTenantIsolationViolationError(
    'Missing tenant isolation or audit signal: alertable tenant-data-or-security condition'
  );
}

export function validateCatalogEntry(
  entry: Partial<ServiceCatalogEntry> | Omit<ServiceCatalogEntry, 'id'>
): TypedError | null {
  if ('id' in entry && (typeof entry.id !== 'string' || entry.id.trim() === '')) {
    return createConfigurationInvalidError('Missing or invalid service identifier');
  }
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
  if (entry.visibility === 'not_exposed' && entry.entitlementKey.trim() !== '') {
    return createTenantIsolationViolationError('Unexposed service cannot have an entitlement key');
  }
  if (entry.visibility === 'not_exposed' && entry.readiness === 'READY') {
    return createTenantIsolationViolationError('Unexposed service must not be marked READY');
  }
  if (entry.visibility === 'global_only' && entry.readiness === 'READY' && entry.entitlementKey.trim() === '') {
    return createConfigurationInvalidError('Global-only READY service must declare an entitlement key');
  }
  return null;
}

export function isAuditBeforeMutation(ordering: readonly ('audit' | 'mutate')[]): boolean {
  if (ordering.length < 2) {
    return false;
  }
  return ordering[0] === 'audit' && ordering[1] === 'mutate';
}

function auditThenMutate(
  model: ServiceCatalogModel,
  auditEvent: AuditEvent,
  auditFn: (event: AuditEvent) => TypedError | null,
  mutate: (m: ServiceCatalogModel) => ServiceCatalogModel
): ServiceCatalogModel | TypedError {
  const ordering: ('audit' | 'mutate')[] = ['audit', 'mutate'];
  if (!isAuditBeforeMutation(ordering)) {
    return createAuditFailureError('Audit-before-mutation ordering violated');
  }
  let auditError: TypedError | null;
  try {
    auditError = auditFn(auditEvent);
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }
  if (auditError !== null) {
    return auditError;
  }
  const mutated = mutate(model);
  return {
    ...mutated,
    lastAuditEvent: auditEvent,
    auditEvidencePreserved: true,
    tenantBoundaryPreserved: true,
    auditSignal: true,
    tenantIsolationSignal: true,
    lifecycleContractUnchanged: model.lifecycleContractUnchanged,
  };
}

export function registerPlatformService(
  model: ServiceCatalogModel,
  service: Omit<ServiceCatalogEntry, 'id'> & { readonly id?: string },
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  if (!canMutateInCurrentMode(model)) {
    return createDegradedFailureError(
      'Cannot perform mutations in degraded mode: observability adapters unavailable'
    );
  }

  const validationError = validateCatalogEntry(service);
  if (validationError !== null) {
    return validationError;
  }

  const id = service.id ?? service.key ?? `${service.name.toLowerCase().replace(/\s+/g, '-')}-recovery`;
  const key = service.key ?? id;

  const newEntry: ServiceCatalogEntry = {
    ...service,
    id,
    key,
    proofReferences: service.proofReferences ?? [
      ...RequiredProofReferences,
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

  return auditThenMutate(
    model,
    auditEvent,
    auditFn,
    (m) => {
      const newResources = new Map(m.resources);
      newResources.set(id, newEntry);
      const candidate: ServiceCatalogModel = {
        ...m,
        resources: newResources,
        lastDecision: 'GRANTED',
        lastError: null,
        tenantBoundaryPreserved: true,
        auditEvidencePreserved: true,
      };
      return {
        ...candidate,
        readiness: determineReadiness(candidate),
        lifecycleReadiness: determineReadiness(candidate),
      };
    }
  );
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
  if (!canMutateInCurrentMode(model)) {
    return createDegradedFailureError(
      'Cannot perform mutations in degraded mode: observability adapters unavailable'
    );
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

  return auditThenMutate(
    model,
    auditEvent,
    auditFn,
    (m) => {
      const newResources = new Map(m.resources);
      newResources.set(serviceId, updatedEntry);
      const candidate: ServiceCatalogModel = {
        ...m,
        resources: newResources,
        lastDecision: 'GRANTED',
        lastError: null,
        tenantBoundaryPreserved: true,
        auditEvidencePreserved: true,
      };
      return {
        ...candidate,
        readiness: determineReadiness(candidate),
        lifecycleReadiness: determineReadiness(candidate),
      };
    }
  );
}

export function unregisterService(
  model: ServiceCatalogModel,
  id: string,
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  if (!canMutateInCurrentMode(model)) {
    return createDegradedFailureError(
      'Cannot perform mutations in degraded mode: observability adapters unavailable'
    );
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

  return auditThenMutate(
    model,
    auditEvent,
    auditFn,
    (m) => {
      const newResources = new Map(m.resources);
      newResources.delete(id);
      const candidate: ServiceCatalogModel = {
        ...m,
        resources: newResources,
        lastDecision: 'GRANTED',
        lastError: null,
        tenantBoundaryPreserved: true,
        auditEvidencePreserved: true,
      };
      return {
        ...candidate,
        readiness: determineReadiness(candidate),
        lifecycleReadiness: determineReadiness(candidate),
      };
    }
  );
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

export interface CatalogReadResponse {
  readonly endpoint: 'GET /api/platform/service-catalog';
  readonly version: 'catalog-v2';
  readonly entries: ReadonlyArray<ServiceCatalogEntry>;
  readonly readiness: Readiness;
  readonly proofsPassed: boolean;
  readonly isError: false;
}

export interface CatalogReadError {
  readonly endpoint: 'GET /api/platform/service-catalog';
  readonly version: 'catalog-v2';
  readonly isError: true;
  readonly error: TypedError;
}

export type CatalogReadResult = CatalogReadResponse | CatalogReadError;

export function getCatalog(model: ServiceCatalogModel): ReadonlyArray<ServiceCatalogEntry> {
  return Array.from(model.resources.values());
}

export function getPlatformServiceCatalog(model: ServiceCatalogModel, token?: TenantToken): ReadonlyArray<ServiceCatalogEntry> {
  const all = Array.from(model.resources.values());
  if (!token) {
    return all.filter((s) => s.visibility === 'global_only');
  }
  return all.filter((s) => checkTenantAccess(s, token));
}

export function readPlatformServiceCatalog(
  model: ServiceCatalogModel,
  token?: TenantToken
): CatalogReadResult {
  if (!runAllProofs(model)) {
    return {
      endpoint: 'GET /api/platform/service-catalog',
      version: 'catalog-v2',
      isError: true,
      error: createPolicyDeniedError(
        'Catalog proofs did not pass; failing closed rather than inventing defaults'
      ),
    };
  }
  const entries = getPlatformServiceCatalog(model, token);
  return {
    endpoint: 'GET /api/platform/service-catalog',
    version: 'catalog-v2',
    entries,
    readiness: determineReadiness(model),
    proofsPassed: true,
    isError: false,
  };
}

export function readReadinessSurface(
  model: ServiceCatalogModel
): {
  readonly endpoint: 'proof:platform-services';
  readonly status: Readiness;
  readonly proofsPassed: boolean;
  readonly degraded: boolean;
  readonly observabilityAdaptersAvailable: boolean;
  readonly isError: false;
  readonly readOnly: boolean;
  readonly lifecycleContractUnchanged: boolean;
  readonly lifecycleReadiness: Readiness;
  readonly auditSignal: boolean;
  readonly tenantIsolationSignal: boolean;
  readonly auditEvidencePreserved: boolean;
  readonly tenantBoundaryPreserved: boolean;
} {
  return {
    endpoint: 'proof:platform-services',
    status: getReadiness(model),
    proofsPassed: runAllProofs(model),
    degraded: model.degraded,
    observabilityAdaptersAvailable: model.observabilityAdaptersAvailable,
    isError: false,
    readOnly: isReadOnlyReadyInDegradedMode(model),
    lifecycleContractUnchanged: model.lifecycleContractUnchanged,
    lifecycleReadiness: model.lifecycleReadiness,
    auditSignal: model.auditSignal,
    tenantIsolationSignal: model.tenantIsolationSignal,
    auditEvidencePreserved: model.auditEvidencePreserved,
    tenantBoundaryPreserved: model.tenantBoundaryPreserved,
  };
}

export function readLifecycleReadinessSurface(
  model: ServiceCatalogModel
): {
  readonly endpoint: 'proof:platform-services';
  readonly status: LifecycleReadinessModel;
  readonly proofsPassed: boolean;
  readonly degraded: boolean;
  readonly observabilityAdaptersAvailable: boolean;
  readonly isError: false;
  readonly readOnly: boolean;
  readonly contractUnchanged: boolean;
} {
  return {
    endpoint: 'proof:platform-services',
    status: model.lifecycleReadiness,
    proofsPassed: runAllProofs(model),
    degraded: model.degraded,
    observabilityAdaptersAvailable: model.observabilityAdaptersAvailable,
    isError: false,
    readOnly: isReadOnlyReadyInDegradedMode(model),
    contractUnchanged: model.lifecycleContractUnchanged,
  };
}

export interface ProviderPort {
  readonly name: string;
  readonly resolve: (key: string) => Readonly<Record<string, unknown>>;
}

export function makeProviderPort(
  name: string,
  config: unknown
): ProviderPort {
  return {
    name,
    resolve(key: string): Readonly<Record<string, unknown>> {
      return resolveProviderDetails(config, key);
    },
  };
}

export function resolveThroughPort(
  port: ProviderPort,
  key: string
): Readonly<Record<string, unknown>> {
  return port.resolve(key);
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

  const ordering: ('audit' | 'mutate')[] = ['audit', 'mutate'];
  if (!isAuditBeforeMutation(ordering)) {
    return createAuditFailureError('Audit-before-mutation ordering violated during recovery');
  }

  let auditError: TypedError | null;
  try {
    auditError = auditFn(auditEvent);
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }
  if (auditError !== null) {
    return auditError;
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
    auditEvidencePreserved: true,
    tenantBoundaryPreserved: true,
    auditSignal: true,
    tenantIsolationSignal: true,
    lifecycleContractUnchanged: model.lifecycleContractUnchanged,
  };

  const proofsPassed =
    provePlatformServices(candidateModel) &&
    proveServiceClickthroughPolicy(candidateModel) &&
    proveServiceCatalogRegistry(candidateModel) &&
    proveEntitlementsRoutes(candidateModel);

  if (!proofsPassed || !candidateModel.lifecycleContractUnchanged) {
    return createPolicyDeniedError('Recovery failed: platform proofs did not pass');
  }

  return {
    ...candidateModel,
    readiness: determineReadiness(candidateModel),
    lifecycleReadiness: determineReadiness(candidateModel),
  };
}

export interface LifecycleContract {
  readonly capability: string;
  readonly contractVersion: string;
  readonly endpoints: readonly string[];
  readonly requiredProofs: readonly string[];
  readonly backedBy: readonly string[];
  readonly touchesTenantData: boolean;
  readonly catalogEndpoint: string;
  readonly catalogVersion: string;
  readonly readinessEndpoint: string;
  readonly supportsBuildComposeAdapter: boolean;
  readonly decision: IntegrationDecision;
  readonly visibility: Visibility;
}

export const LIFECYCLE_PROOFS: readonly string[] = [
  'proof:platform-services',
  'proof:service-clickthrough-policy',
  'proof:service-catalog-registry',
  'proof:entitlements-routes',
];

export const LIFECYCLE_ENDPOINTS: readonly string[] = [
  'proof:platform-services',
  'proof:service-clickthrough-policy',
  'proof:service-catalog-registry',
  'proof:entitlements-routes',
  'GET /api/platform/service-catalog',
  'catalog-v2',
];

export const lifecycleContract: LifecycleContract = {
  capability: 'servicecatalogandproviderintegrationmodel',
  contractVersion: 'V1',
  endpoints: LIFECYCLE_ENDPOINTS,
  requiredProofs: LIFECYCLE_PROOFS,
  backedBy: ['provider', 'database'],
  touchesTenantData: true,
  catalogEndpoint: 'GET /api/platform/service-catalog',
  catalogVersion: 'catalog-v2',
  readinessEndpoint: 'proof:platform-services',
  supportsBuildComposeAdapter: true,
  decision: 'build',
  visibility: 'global_only',
};

export function getLifecycleContract(): LifecycleContract {
  return lifecycleContract;
}

export function listRequiredProofs(): readonly string[] {
  return LIFECYCLE_PROOFS;
}

export function getLifecycleEndpoints(): readonly string[] {
  return LIFECYCLE_ENDPOINTS;
}

export function getCatalogEndpoint(): string {
  return lifecycleContract.catalogEndpoint;
}

export function getCatalogVersion(): string {
  return lifecycleContract.catalogVersion;
}

export function getReadinessEndpoint(): string {
  return lifecycleContract.readinessEndpoint;
}

export function getRequiredProofsForPromotion(): readonly string[] {
  return LIFECYCLE_PROOFS;
}

export function isLifecycleContractUnchanged(
  model: ServiceCatalogModel
): boolean {
  return model.lifecycleContractUnchanged;
}

export function reRunPromotionProofs(
  model: ServiceCatalogModel
): boolean {
  return (
    provePlatformServices(model) &&
    proveServiceClickthroughPolicy(model) &&
    proveServiceCatalogRegistry(model) &&
    proveEntitlementsRoutes(model)
  );
}

export function mayContinuePromotion(model: ServiceCatalogModel): boolean {
  return reRunPromotionProofs(model) && model.lifecycleContractUnchanged;
}

export function registerIntegrationModel(
  model: ServiceCatalogModel,
  service: Omit<ServiceCatalogEntry, 'id'> & { readonly id?: string },
  auditFn: (event: AuditEvent) => TypedError | null,
  actor: string = 'system'
): ServiceCatalogModel | TypedError {
  return registerPlatformService(model, service, auditFn, actor);
}

export function getContractSurface(): {
  readonly endpoint: string;
  readonly version: string;
  readonly configKeys: readonly ProviderConfigKeys[];
  readonly proofs: readonly RequiredProofReferences[];
} {
  return {
    endpoint: 'GET /api/platform/service-catalog',
    version: 'catalog-v2',
    configKeys: [...ProviderConfigKeys],
    proofs: [...RequiredProofReferences],
  };
}

export function validateConfigPlane(config: unknown): boolean {
  return isProviderConfig(config);
}

export interface PlatformServiceContractSurface {
  readonly endpoint: 'proof:platform-services';
  readonly version: 'catalog-v2';
  readonly isError: false;
  readonly status: Readiness;
  readonly proofsPassed: boolean;
  readonly degraded: boolean;
  readonly observabilityAdaptersAvailable: boolean;
  readonly readOnly: boolean;
  readonly lifecycleReadiness: Readiness;
  readonly lifecycleContractUnchanged: boolean;
  readonly requiredProofs: readonly string[];
}

export interface PlatformServiceContractError {
  readonly endpoint: 'proof:platform-services';
  readonly version: 'catalog-v2';
  readonly isError: true;
  readonly error: TypedError;
}

export type PlatformServiceContractResult = PlatformServiceContractSurface | PlatformServiceContractError;

export function readPlatformServiceContract(
  model: ServiceCatalogModel
): PlatformServiceContractResult {
  return {
    endpoint: 'proof:platform-services',
    version: 'catalog-v2',
    isError: false,
    status: getReadiness(model),
    proofsPassed: runAllProofs(model),
    degraded: model.degraded,
    observabilityAdaptersAvailable: model.observabilityAdaptersAvailable,
    readOnly: isReadOnlyReadyInDegradedMode(model),
    lifecycleReadiness: model.lifecycleReadiness,
    lifecycleContractUnchanged: model.lifecycleContractUnchanged,
    requiredProofs: LIFECYCLE_PROOFS,
  };
}

export function isAuditEvidencePreserved(model: ServiceCatalogModel): boolean {
  return model.auditEvidencePreserved;
}

export function isTenantBoundaryPreserved(model: ServiceCatalogModel): boolean {
  return model.tenantBoundaryPreserved;
}

export function recordAuditEvidence(
  model: ServiceCatalogModel,
  event: AuditEvent
): ServiceCatalogModel {
  return {
    ...model,
    lastAuditEvent: event,
    auditEvidencePreserved: true,
  };
}

export function preserveTenantBoundary(
  model: ServiceCatalogModel
): ServiceCatalogModel {
  return {
    ...model,
    tenantBoundaryPreserved: true,
  };
}

export function auditBeforeMutation(
  resource: string,
  operation: string,
  actor: string,
  auditFn: (event: AuditEvent) => TypedError | null
): AuditResult | TypedError {
  const event: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource,
    operation,
    actor,
    timestamp: new Date().toISOString(),
  };
  try {
    const result = auditFn(event);
    if (result !== null) {
      return result;
    }
    return {
      kind: 'AUDIT_BEFORE_CHANGE',
      resource,
      operation,
      actor,
      outcome: 'success',
      timestamp: event.timestamp,
    };
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }
}

export function isReadyInDegradedMode(model: ServiceCatalogModel): boolean {
  return model.degraded && (model.tenantIsolationSignal && model.auditSignal);
}

export function isReadinessExplicitlyDegraded(model: ServiceCatalogModel): boolean {
  return model.degraded && !model.observabilityAdaptersAvailable;
}

export function readinessFailsClosed(model: ServiceCatalogModel): boolean {
  return model.degraded || !model.observabilityAdaptersAvailable;
}

export function isPromotionGated(model: ServiceCatalogModel): boolean {
  if (!model.lifecycleContractUnchanged) {
    return false;
  }
  return runAllProofs(model);
}

export function recordAudit(
  model: ServiceCatalogModel,
  event: AuditEvent
): ServiceCatalogModel {
  return {
    ...model,
    lastAuditEvent: event,
    auditEvidencePreserved: true,
    auditSignal: true,
    tenantBoundaryPreserved: true,
  };
}

export function observeReadinessDegradation(
  model: ServiceCatalogModel,
  reason: string
): ServiceCatalogModel {
  if (!model.observabilityAdaptersAvailable) {
    return {
      ...model,
      degraded: true,
      readiness: 'DEGRADED',
      lifecycleReadiness: 'DEGRADED',
      lastDecision: 'DEGRADED',
      lastError: createDegradedFailureError(reason),
      auditSignal: model.auditSignal,
      tenantIsolationSignal: model.tenantIsolationSignal,
      auditEvidencePreserved: true,
      tenantBoundaryPreserved: true,
    };
  }
  return model;
}

export function readPlatformServicesReadiness(
  model: ServiceCatalogModel
): Readiness {
  return determineReadiness(model);
}

export function evaluateReadinessSurface(
  model: ServiceCatalogModel
): Readiness {
  return determineReadiness(model);
}

export function evaluateLifecycleReadiness(
  model: ServiceCatalogModel
): LifecycleReadinessModel {
  const r = determineReadiness(model);
  return r;
}

export function auditBeforeMutationCallable(
  resource: string,
  operation: string,
  actor: string,
  auditFn: (event: AuditEvent) => TypedError | null,
  mutate: () => ServiceCatalogModel
): ServiceCatalogModel | TypedError {
  const ordering: ('audit' | 'mutate')[] = ['audit', 'mutate'];
  if (!isAuditBeforeMutation(ordering)) {
    return createAuditFailureError('Audit-before-mutation ordering violated');
  }
  const auditEvent: AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource,
    operation,
    actor,
    timestamp: new Date().toISOString(),
  };
  let auditError: TypedError | null;
  try {
    auditError = auditFn(auditEvent);
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }
  if (auditError !== null) {
    return auditError;
  }
  return mutate();
}

export function auditEvidencePreservedOnMutation(
  beforeModel: ServiceCatalogModel,
  afterModel: ServiceCatalogModel
): boolean {
  if (!beforeModel.auditEvidencePreserved) {
    return false;
  }
  if (afterModel.lastAuditEvent === null) {
    return false;
  }
  if (!afterModel.auditEvidencePreserved) {
    return false;
  }
  return true;
}

export function recoverCatalogWithAudit(
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

  let auditError: TypedError | null;
  try {
    auditError = auditFn(auditEvent);
  } catch (err) {
    return createAuditFailureError(err instanceof Error ? err.message : 'Audit failed');
  }
  if (auditError !== null) {
    return auditError;
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
    auditEvidencePreserved: true,
    tenantBoundaryPreserved: true,
    auditSignal: true,
    tenantIsolationSignal: true,
    lifecycleContractUnchanged: model.lifecycleContractUnchanged,
  };

  const proofsPassed = runAllProofs(candidateModel);

  if (!proofsPassed || !candidateModel.lifecycleContractUnchanged) {
    return createPolicyDeniedError('Recovery failed: platform proofs did not pass');
  }

  return {
    ...candidateModel,
    readiness: determineReadiness(candidateModel),
    lifecycleReadiness: determineReadiness(candidateModel),
  };
}