export const ProductCatalogPlansPricesAuditEventKind = ['CATALOG_CHANGED'] as const;
export type ProductCatalogPlansPricesAuditEventKind = typeof ProductCatalogPlansPricesAuditEventKind[number];

export const ProductCatalogPlansPricesErrorKind = [
  'VALIDATION_ERROR',
  'PERMISSION_DENIED',
  'READINESS_FAILURE',
  'REFERENCE_NOT_FOUND',
] as const;
export type ProductCatalogPlansPricesErrorKind = typeof ProductCatalogPlansPricesErrorKind[number];

export const ProductCatalogPlansPricesPermission = [
  'PLATFORM_BILLING_ADMIN',
  'TENANT_BILLING_READ',
] as const;
export type ProductCatalogPlansPricesPermission = typeof ProductCatalogPlansPricesPermission[number];

export const ProductCatalogPlansPricesReadiness = [
  'READ_ONLY',
  'FULL',
] as const;
export type ProductCatalogPlansPricesReadiness = typeof ProductCatalogPlansPricesReadiness[number];

export const ProductCatalogPlansPricesCurrency = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
] as const;
export type ProductCatalogPlansPricesCurrency = typeof ProductCatalogPlansPricesCurrency[number];

export const ProductCatalogPlansPricesBillingPeriod = [
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'WEEKLY',
  'DAILY',
] as const;
export type ProductCatalogPlansPricesBillingPeriod = typeof ProductCatalogPlansPricesBillingPeriod[number];

export const ProductCatalogPlansPricesPriceType = [
  'FIXED',
  'PER_UNIT',
  'TIERED',
  'GRADUATED',
  'VOLUME',
] as const;
export type ProductCatalogPlansPricesPriceType = typeof ProductCatalogPlansPricesPriceType[number];

export const ProductCatalogPlansPricesEntityType = [
  'PRODUCT',
  'PLAN',
  'PRICE',
] as const;
export type ProductCatalogPlansPricesEntityType = typeof ProductCatalogPlansPricesEntityType[number];

export interface ProductCatalogPlansPricesAuditEvent {
  readonly kind: ProductCatalogPlansPricesAuditEventKind;
  readonly operatorId: string;
  readonly entityType: ProductCatalogPlansPricesEntityType;
  readonly entityId: string;
  readonly timestamp: string;
}

export interface ProductCatalogPlansPricesError {
  readonly kind: ProductCatalogPlansPricesErrorKind;
  readonly message: string;
}

export interface Product {
  readonly identifier: string;
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly createdTimestamp: string;
}

export interface Plan {
  readonly identifier: string;
  readonly owningProduct: string;
  readonly name: string;
  readonly currency: ProductCatalogPlansPricesCurrency;
  readonly billingPeriod: ProductCatalogPlansPricesBillingPeriod;
  readonly active: boolean;
  readonly createdTimestamp: string;
}

export interface Price {
  readonly identifier: string;
  readonly owningPlan: string;
  readonly version: number;
  readonly priceType: ProductCatalogPlansPricesPriceType;
  readonly unitAmount: number;
  readonly currency: ProductCatalogPlansPricesCurrency;
  readonly billingPeriod: ProductCatalogPlansPricesBillingPeriod;
  readonly active: boolean;
  readonly createdTimestamp: string;
}

export interface TenantCatalog {
  readonly products: readonly Product[];
  readonly plans: readonly Plan[];
  readonly prices: readonly Price[];
}

export interface ProductCatalogPlansPricesState {
  readonly products: readonly Product[];
  readonly plans: readonly Plan[];
  readonly prices: readonly Price[];
  readonly readiness: ProductCatalogPlansPricesReadiness;
  readonly lastAuditEvent: ProductCatalogPlansPricesAuditEvent | null;
  readonly lastError: ProductCatalogPlansPricesError | null;
}

export const initialState: ProductCatalogPlansPricesState = {
  products: [],
  plans: [],
  prices: [],
  readiness: 'FULL',
  lastAuditEvent: null,
  lastError: null,
};

export interface CreateProductRequest {
  readonly name: string;
  readonly description: string;
}

export interface CreatePlanRequest {
  readonly owningProduct: string;
  readonly name: string;
  readonly currency: ProductCatalogPlansPricesCurrency;
  readonly billingPeriod: ProductCatalogPlansPricesBillingPeriod;
}

export interface CreatePriceRequest {
  readonly owningPlan: string;
  readonly version: number;
  readonly priceType: ProductCatalogPlansPricesPriceType;
  readonly unitAmount: number;
  readonly currency: ProductCatalogPlansPricesCurrency;
  readonly billingPeriod: ProductCatalogPlansPricesBillingPeriod;
}

export type CreateRequest = CreateProductRequest | CreatePlanRequest | CreatePriceRequest;

export function isProductCatalogPlansPricesCurrency(value: string): value is ProductCatalogPlansPricesCurrency {
  return (ProductCatalogPlansPricesCurrency as readonly string[]).includes(value);
}

export function isProductCatalogPlansPricesBillingPeriod(value: string): value is ProductCatalogPlansPricesBillingPeriod {
  return (ProductCatalogPlansPricesBillingPeriod as readonly string[]).includes(value);
}

export function isProductCatalogPlansPricesPriceType(value: string): value is ProductCatalogPlansPricesPriceType {
  return (ProductCatalogPlansPricesPriceType as readonly string[]).includes(value);
}

export function validateCreateProductRequest(request: unknown): ProductCatalogPlansPricesError | CreateProductRequest {
  if (request === null || typeof request !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Request must be an object' };
  }

  const { name, description } = request as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Product name must be a non-empty string' };
  }

  if (typeof description !== 'string') {
    return { kind: 'VALIDATION_ERROR', message: 'Product description must be a string' };
  }

  return { name, description };
}

export function validateCreatePlanRequest(
  request: unknown,
  knownProducts: readonly Product[],
): ProductCatalogPlansPricesError | CreatePlanRequest {
  if (request === null || typeof request !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Request must be an object' };
  }

  const { owningProduct, name, currency, billingPeriod } = request as Record<string, unknown>;

  if (typeof owningProduct !== 'string' || owningProduct.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Owning product must be a non-empty string' };
  }

  if (typeof name !== 'string' || name.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Plan name must be a non-empty string' };
  }

  if (typeof currency !== 'string' || !isProductCatalogPlansPricesCurrency(currency)) {
    return { kind: 'VALIDATION_ERROR', message: 'Currency must be a supported currency code' };
  }

  if (typeof billingPeriod !== 'string' || !isProductCatalogPlansPricesBillingPeriod(billingPeriod)) {
    return { kind: 'VALIDATION_ERROR', message: 'Billing period must be a supported billing period' };
  }

  const productExists = knownProducts.some((p) => p.identifier === owningProduct);
  if (!productExists) {
    return { kind: 'VALIDATION_ERROR', message: `Owning product reference ${owningProduct} does not resolve` };
  }

  return { owningProduct, name, currency, billingPeriod };
}

export function validateCreatePriceRequest(
  request: unknown,
  knownPlans: readonly Plan[],
): ProductCatalogPlansPricesError | CreatePriceRequest {
  if (request === null || typeof request !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Request must be an object' };
  }

  const { owningPlan, version, priceType, unitAmount, currency, billingPeriod } = request as Record<string, unknown>;

  if (typeof owningPlan !== 'string' || owningPlan.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Owning plan must be a non-empty string' };
  }

  if (typeof version !== 'number' || version <= 0) {
    return { kind: 'VALIDATION_ERROR', message: 'Version must be a positive number' };
  }

  if (typeof priceType !== 'string' || !isProductCatalogPlansPricesPriceType(priceType)) {
    return { kind: 'VALIDATION_ERROR', message: 'Price type must be a supported price type' };
  }

  if (typeof unitAmount !== 'number' || unitAmount <= 0) {
    return { kind: 'VALIDATION_ERROR', message: 'Unit amount must be a positive number' };
  }

  if (typeof currency !== 'string' || !isProductCatalogPlansPricesCurrency(currency)) {
    return { kind: 'VALIDATION_ERROR', message: 'Currency must be a supported currency code' };
  }

  if (typeof billingPeriod !== 'string' || !isProductCatalogPlansPricesBillingPeriod(billingPeriod)) {
    return { kind: 'VALIDATION_ERROR', message: 'Billing period must be a supported billing period' };
  }

  const planExists = knownPlans.some((p) => p.identifier === owningPlan);
  if (!planExists) {
    return { kind: 'VALIDATION_ERROR', message: `Owning plan reference ${owningPlan} does not resolve` };
  }

  return { owningPlan, version, priceType, unitAmount, currency, billingPeriod };
}

export function checkPermission(
  requiredPermission: ProductCatalogPlansPricesPermission,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
): boolean {
  return tokenPermissions.includes(requiredPermission);
}

export function auditCatalogChange(
  operatorId: string,
  entityType: ProductCatalogPlansPricesEntityType,
  entityId: string,
  auditFn: (event: ProductCatalogPlansPricesAuditEvent) => ProductCatalogPlansPricesError | null,
  timestamp: string = new Date().toISOString(),
): ProductCatalogPlansPricesError | null {
  const event: ProductCatalogPlansPricesAuditEvent = {
    kind: 'CATALOG_CHANGED',
    operatorId,
    entityType,
    entityId,
    timestamp,
  };
  return auditFn(event);
}

export function createProduct(
  state: ProductCatalogPlansPricesState,
  operatorId: string,
  request: unknown,
  auditFn: (event: ProductCatalogPlansPricesAuditEvent) => ProductCatalogPlansPricesError | null,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
  idGenerator: () => string = () => `product-${state.products.length + 1}`,
  clock: () => string = () => new Date().toISOString(),
): ProductCatalogPlansPricesState | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }

  if (state.readiness !== 'FULL') {
    return { kind: 'READINESS_FAILURE', message: 'Catalog mutations disabled due to readiness state' };
  }

  const validatedRequest = validateCreateProductRequest(request);
  if ('kind' in validatedRequest) {
    return validatedRequest;
  }

  const newProduct: Product = {
    identifier: idGenerator(),
    name: validatedRequest.name,
    description: validatedRequest.description,
    active: true,
    createdTimestamp: clock(),
  };

  const auditError = auditCatalogChange(operatorId, 'PRODUCT', newProduct.identifier, auditFn, newProduct.createdTimestamp);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    products: [...state.products, newProduct],
    lastAuditEvent: {
      kind: 'CATALOG_CHANGED',
      operatorId,
      entityType: 'PRODUCT',
      entityId: newProduct.identifier,
      timestamp: newProduct.createdTimestamp,
    },
    lastError: null,
  };
}

export function createPlan(
  state: ProductCatalogPlansPricesState,
  operatorId: string,
  request: unknown,
  auditFn: (event: ProductCatalogPlansPricesAuditEvent) => ProductCatalogPlansPricesError | null,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
  idGenerator: () => string = () => `plan-${state.plans.length + 1}`,
  clock: () => string = () => new Date().toISOString(),
): ProductCatalogPlansPricesState | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }

  if (state.readiness !== 'FULL') {
    return { kind: 'READINESS_FAILURE', message: 'Catalog mutations disabled due to readiness state' };
  }

  const validatedRequest = validateCreatePlanRequest(request, state.products);
  if ('kind' in validatedRequest) {
    return validatedRequest;
  }

  const newPlan: Plan = {
    identifier: idGenerator(),
    owningProduct: validatedRequest.owningProduct,
    name: validatedRequest.name,
    currency: validatedRequest.currency,
    billingPeriod: validatedRequest.billingPeriod,
    active: true,
    createdTimestamp: clock(),
  };

  const auditError = auditCatalogChange(operatorId, 'PLAN', newPlan.identifier, auditFn, newPlan.createdTimestamp);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    plans: [...state.plans, newPlan],
    lastAuditEvent: {
      kind: 'CATALOG_CHANGED',
      operatorId,
      entityType: 'PLAN',
      entityId: newPlan.identifier,
      timestamp: newPlan.createdTimestamp,
    },
    lastError: null,
  };
}

export function createPrice(
  state: ProductCatalogPlansPricesState,
  operatorId: string,
  request: unknown,
  auditFn: (event: ProductCatalogPlansPricesAuditEvent) => ProductCatalogPlansPricesError | null,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
  idGenerator: () => string = () => `price-${state.prices.length + 1}`,
  clock: () => string = () => new Date().toISOString(),
): ProductCatalogPlansPricesState | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }

  if (state.readiness !== 'FULL') {
    return { kind: 'READINESS_FAILURE', message: 'Catalog mutations disabled due to readiness state' };
  }

  const validatedRequest = validateCreatePriceRequest(request, state.plans);
  if ('kind' in validatedRequest) {
    return validatedRequest;
  }

  const newPrice: Price = {
    identifier: idGenerator(),
    owningPlan: validatedRequest.owningPlan,
    version: validatedRequest.version,
    priceType: validatedRequest.priceType,
    unitAmount: validatedRequest.unitAmount,
    currency: validatedRequest.currency,
    billingPeriod: validatedRequest.billingPeriod,
    active: true,
    createdTimestamp: clock(),
  };

  const auditError = auditCatalogChange(operatorId, 'PRICE', newPrice.identifier, auditFn, newPrice.createdTimestamp);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    prices: [...state.prices, newPrice],
    lastAuditEvent: {
      kind: 'CATALOG_CHANGED',
      operatorId,
      entityType: 'PRICE',
      entityId: newPrice.identifier,
      timestamp: newPrice.createdTimestamp,
    },
    lastError: null,
  };
}

export function listProducts(
  state: ProductCatalogPlansPricesState,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
): readonly Product[] | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }
  return state.products;
}

export function listPlans(
  state: ProductCatalogPlansPricesState,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
  owningProduct?: string,
): readonly Plan[] | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }
  if (owningProduct === undefined) {
    return state.plans;
  }
  return state.plans.filter((p) => p.owningProduct === owningProduct);
}

export function listPrices(
  state: ProductCatalogPlansPricesState,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
  owningPlan?: string,
): readonly Price[] | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }
  if (owningPlan === undefined) {
    return state.prices;
  }
  return state.prices.filter((p) => p.owningPlan === owningPlan);
}

export function getTenantCatalog(
  state: ProductCatalogPlansPricesState,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
  organisationId: string,
  tokenOrganisationId: string,
): TenantCatalog | ProductCatalogPlansPricesError {
  if (!checkPermission('TENANT_BILLING_READ', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'TENANT_BILLING_READ permission required' };
  }

  if (organisationId !== tokenOrganisationId) {
    return { kind: 'PERMISSION_DENIED', message: 'Tenant context cannot access another tenant catalog' };
  }

  return {
    products: state.products.filter((p) => p.active),
    plans: state.plans.filter((p) => p.active),
    prices: state.prices.filter((p) => p.active),
  };
}

export function setReadiness(
  state: ProductCatalogPlansPricesState,
  readiness: ProductCatalogPlansPricesReadiness,
): ProductCatalogPlansPricesState {
  return {
    ...state,
    readiness,
  };
}

export interface MigrationStep {
  readonly sourceVersion: number;
  readonly targetVersion: number;
  readonly apply: (state: ProductCatalogPlansPricesState) => ProductCatalogPlansPricesState;
}

export const productCatalogPlansPricesMigrations: readonly MigrationStep[] = [
  {
    sourceVersion: 0,
    targetVersion: 1,
    apply: (state: ProductCatalogPlansPricesState): ProductCatalogPlansPricesState => ({
      ...state,
      products: state.products.map((p): Product => ({
        identifier: p.identifier,
        name: p.name,
        description: p.description,
        active: p.active,
        createdTimestamp: p.createdTimestamp,
      })),
      plans: state.plans.map((p): Plan => ({
        identifier: p.identifier,
        owningProduct: p.owningProduct,
        name: p.name,
        currency: p.currency,
        billingPeriod: p.billingPeriod,
        active: p.active,
        createdTimestamp: p.createdTimestamp,
      })),
      prices: state.prices.map((p): Price => ({
        identifier: p.identifier,
        owningPlan: p.owningPlan,
        version: p.version,
        priceType: p.priceType,
        unitAmount: p.unitAmount,
        currency: p.currency,
        billingPeriod: p.billingPeriod,
        active: p.active,
        createdTimestamp: p.createdTimestamp,
      })),
    }),
  },
  {
    sourceVersion: 1,
    targetVersion: 2,
    apply: (state: ProductCatalogPlansPricesState): ProductCatalogPlansPricesState => ({
      ...state,
      products: state.products.map((p): Product => ({
        identifier: p.identifier,
        name: p.name,
        description: p.description,
        active: p.active,
        createdTimestamp: p.createdTimestamp,
      })),
      plans: state.plans.map((p): Plan => ({
        identifier: p.identifier,
        owningProduct: p.owningProduct,
        name: p.name,
        currency: p.currency,
        billingPeriod: p.billingPeriod,
        active: p.active,
        createdTimestamp: p.createdTimestamp,
      })),
      prices: state.prices.map((p): Price => ({
        identifier: p.identifier,
        owningPlan: p.owningPlan,
        version: p.version,
        priceType: p.priceType,
        unitAmount: p.unitAmount,
        currency: p.currency,
        billingPeriod: p.billingPeriod,
        active: p.active,
        createdTimestamp: p.createdTimestamp,
      })),
    }),
  },
];

export interface VersionedProductCatalogPlansPricesState {
  readonly version: number;
  readonly state: ProductCatalogPlansPricesState;
}

export function applyMigrations(
  versioned: VersionedProductCatalogPlansPricesState,
  migrations: readonly MigrationStep[] = productCatalogPlansPricesMigrations,
): VersionedProductCatalogPlansPricesState {
  let currentVersion = versioned.version;
  let currentState = versioned.state;

  const sortedMigrations: readonly MigrationStep[] = [...migrations].sort(
    (a, b) => a.sourceVersion - b.sourceVersion,
  );

  for (const migration of sortedMigrations) {
    if (migration.sourceVersion === currentVersion) {
      currentState = migration.apply(currentState);
      currentVersion = migration.targetVersion;
    }
  }

  return { version: currentVersion, state: currentState };
}

export function migrateCatalog(
  state: ProductCatalogPlansPricesState,
  currentVersion: number,
  migrations: readonly MigrationStep[] = productCatalogPlansPricesMigrations,
): VersionedProductCatalogPlansPricesState {
  return applyMigrations({ version: currentVersion, state }, migrations);
}

export function setProductActive(
  state: ProductCatalogPlansPricesState,
  identifier: string,
  active: boolean,
): ProductCatalogPlansPricesState {
  return {
    ...state,
    products: state.products.map((p): Product =>
      p.identifier === identifier
        ? {
            identifier: p.identifier,
            name: p.name,
            description: p.description,
            active,
            createdTimestamp: p.createdTimestamp,
          }
        : p,
    ),
  };
}

export function setPlanActive(
  state: ProductCatalogPlansPricesState,
  identifier: string,
  active: boolean,
): ProductCatalogPlansPricesState {
  return {
    ...state,
    plans: state.plans.map((p): Plan =>
      p.identifier === identifier
        ? {
            identifier: p.identifier,
            owningProduct: p.owningProduct,
            name: p.name,
            currency: p.currency,
            billingPeriod: p.billingPeriod,
            active,
            createdTimestamp: p.createdTimestamp,
          }
        : p,
    ),
  };
}

export function addPriceVersion(
  state: ProductCatalogPlansPricesState,
  operatorId: string,
  basePriceIdentifier: string,
  newVersion: number,
  newUnitAmount: number,
  auditFn: (event: ProductCatalogPlansPricesAuditEvent) => ProductCatalogPlansPricesError | null,
  idGenerator: () => string = () => `price-${state.prices.length + 1}`,
  clock: () => string = () => new Date().toISOString(),
): ProductCatalogPlansPricesState | ProductCatalogPlansPricesError {
  if (state.readiness !== 'FULL') {
    return { kind: 'READINESS_FAILURE', message: 'Catalog mutations disabled due to readiness state' };
  }

  const basePrice = state.prices.find((p) => p.identifier === basePriceIdentifier);
  if (basePrice === undefined) {
    return { kind: 'REFERENCE_NOT_FOUND', message: `Price with identifier ${basePriceIdentifier} not found` };
  }

  if (newVersion <= basePrice.version) {
    return { kind: 'VALIDATION_ERROR', message: 'New price version must be greater than existing version' };
  }

  const deactivated: Price = {
    identifier: basePrice.identifier,
    owningPlan: basePrice.owningPlan,
    version: basePrice.version,
    priceType: basePrice.priceType,
    unitAmount: basePrice.unitAmount,
    currency: basePrice.currency,
    billingPeriod: basePrice.billingPeriod,
    active: false,
    createdTimestamp: basePrice.createdTimestamp,
  };

  const newPrice: Price = {
    identifier: idGenerator(),
    owningPlan: basePrice.owningPlan,
    version: newVersion,
    priceType: basePrice.priceType,
    unitAmount: newUnitAmount,
    currency: basePrice.currency,
    billingPeriod: basePrice.billingPeriod,
    active: true,
    createdTimestamp: clock(),
  };

  const auditError = auditCatalogChange(operatorId, 'PRICE', newPrice.identifier, auditFn, newPrice.createdTimestamp);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    prices: [...state.prices.filter((p) => p.identifier !== basePrice.identifier), deactivated, newPrice],
    lastAuditEvent: {
      kind: 'CATALOG_CHANGED',
      operatorId,
      entityType: 'PRICE',
      entityId: newPrice.identifier,
      timestamp: newPrice.createdTimestamp,
    },
    lastError: null,
  };
}