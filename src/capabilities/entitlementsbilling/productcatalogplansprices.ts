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

export interface ProductCatalogPlansPricesAuditEvent {
  readonly kind: ProductCatalogPlansPricesAuditEventKind;
  readonly operatorId: string;
  readonly entityType: 'PRODUCT' | 'PLAN' | 'PRICE';
  readonly entityId: string;
  readonly timestamp: string;
}

export interface ProductCatalogPlansPricesError {
  readonly kind: ProductCatalogPlansPricesErrorKind;
  readonly message: string;
}

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface Plan {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly currency: string;
  readonly billingPeriod: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface Price {
  readonly id: string;
  readonly planId: string;
  readonly version: number;
  readonly priceType: string;
  readonly unitAmount: number;
  readonly currency: string;
  readonly billingPeriod: string;
  readonly active: boolean;
  readonly createdAt: string;
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
  readonly productId: string;
  readonly name: string;
  readonly currency: string;
  readonly billingPeriod: string;
}

export interface CreatePriceRequest {
  readonly planId: string;
  readonly version: number;
  readonly priceType: string;
  readonly unitAmount: number;
  readonly currency: string;
  readonly billingPeriod: string;
}

export type CreateRequest = CreateProductRequest | CreatePlanRequest | CreatePriceRequest;

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

export function validateCreatePlanRequest(request: unknown): ProductCatalogPlansPricesError | CreatePlanRequest {
  if (request === null || typeof request !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Request must be an object' };
  }

  const { productId, name, currency, billingPeriod } = request as Record<string, unknown>;

  if (typeof productId !== 'string' || productId.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Product ID must be a non-empty string' };
  }

  if (typeof name !== 'string' || name.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Plan name must be a non-empty string' };
  }

  if (typeof currency !== 'string' || currency.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Currency must be a non-empty string' };
  }

  if (typeof billingPeriod !== 'string' || billingPeriod.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Billing period must be a non-empty string' };
  }

  return { productId, name, currency, billingPeriod };
}

export function validateCreatePriceRequest(request: unknown): ProductCatalogPlansPricesError | CreatePriceRequest {
  if (request === null || typeof request !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Request must be an object' };
  }

  const { planId, version, priceType, unitAmount, currency, billingPeriod } = request as Record<string, unknown>;

  if (typeof planId !== 'string' || planId.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Plan ID must be a non-empty string' };
  }

  if (typeof version !== 'number' || version <= 0) {
    return { kind: 'VALIDATION_ERROR', message: 'Version must be a positive number' };
  }

  if (typeof priceType !== 'string' || priceType.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Price type must be a non-empty string' };
  }

  if (typeof unitAmount !== 'number' || unitAmount <= 0) {
    return { kind: 'VALIDATION_ERROR', message: 'Unit amount must be a positive number' };
  }

  if (typeof currency !== 'string' || currency.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Currency must be a non-empty string' };
  }

  if (typeof billingPeriod !== 'string' || billingPeriod.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Billing period must be a non-empty string' };
  }

  return { planId, version, priceType, unitAmount, currency, billingPeriod };
}

export function checkPermission(
  requiredPermission: ProductCatalogPlansPricesPermission,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
): boolean {
  return tokenPermissions.includes(requiredPermission);
}

export function auditCatalogChange(
  operatorId: string,
  entityType: 'PRODUCT' | 'PLAN' | 'PRICE',
  entityId: string,
  auditFn: (event: ProductCatalogPlansPricesAuditEvent) => ProductCatalogPlansPricesError | null,
): ProductCatalogPlansPricesError | null {
  const event: ProductCatalogPlansPricesAuditEvent = {
    kind: 'CATALOG_CHANGED',
    operatorId,
    entityType,
    entityId,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function createProduct(
  state: ProductCatalogPlansPricesState,
  operatorId: string,
  request: unknown,
  auditFn: (event: ProductCatalogPlansPricesAuditEvent) => ProductCatalogPlansPricesError | null,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
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
    id: `product-${Date.now()}`,
    name: validatedRequest.name,
    description: validatedRequest.description,
    active: true,
    createdAt: new Date().toISOString(),
  };

  const auditError = auditCatalogChange(operatorId, 'PRODUCT', newProduct.id, auditFn);
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
      entityId: newProduct.id,
      timestamp: newProduct.createdAt,
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
): ProductCatalogPlansPricesState | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }

  if (state.readiness !== 'FULL') {
    return { kind: 'READINESS_FAILURE', message: 'Catalog mutations disabled due to readiness state' };
  }

  const validatedRequest = validateCreatePlanRequest(request);
  if ('kind' in validatedRequest) {
    return validatedRequest;
  }

  const productExists = state.products.some((p) => p.id === validatedRequest.productId);
  if (!productExists) {
    return { kind: 'REFERENCE_NOT_FOUND', message: `Product with ID ${validatedRequest.productId} not found` };
  }

  const newPlan: Plan = {
    id: `plan-${Date.now()}`,
    productId: validatedRequest.productId,
    name: validatedRequest.name,
    currency: validatedRequest.currency,
    billingPeriod: validatedRequest.billingPeriod,
    active: true,
    createdAt: new Date().toISOString(),
  };

  const auditError = auditCatalogChange(operatorId, 'PLAN', newPlan.id, auditFn);
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
      entityId: newPlan.id,
      timestamp: newPlan.createdAt,
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
): ProductCatalogPlansPricesState | ProductCatalogPlansPricesError {
  if (!checkPermission('PLATFORM_BILLING_ADMIN', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'PLATFORM_BILLING_ADMIN permission required' };
  }

  if (state.readiness !== 'FULL') {
    return { kind: 'READINESS_FAILURE', message: 'Catalog mutations disabled due to readiness state' };
  }

  const validatedRequest = validateCreatePriceRequest(request);
  if ('kind' in validatedRequest) {
    return validatedRequest;
  }

  const planExists = state.plans.some((p) => p.id === validatedRequest.planId);
  if (!planExists) {
    return { kind: 'REFERENCE_NOT_FOUND', message: `Plan with ID ${validatedRequest.planId} not found` };
  }

  const newPrice: Price = {
    id: `price-${Date.now()}`,
    planId: validatedRequest.planId,
    version: validatedRequest.version,
    priceType: validatedRequest.priceType,
    unitAmount: validatedRequest.unitAmount,
    currency: validatedRequest.currency,
    billingPeriod: validatedRequest.billingPeriod,
    active: true,
    createdAt: new Date().toISOString(),
  };

  const auditError = auditCatalogChange(operatorId, 'PRICE', newPrice.id, auditFn);
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
      entityId: newPrice.id,
      timestamp: newPrice.createdAt,
    },
    lastError: null,
  };
}

export function listProducts(
  state: ProductCatalogPlansPricesState,
): readonly Product[] {
  return state.products;
}

export function listPlans(
  state: ProductCatalogPlansPricesState,
  productId?: string,
): readonly Plan[] {
  if (productId === undefined) {
    return state.plans;
  }
  return state.plans.filter((p) => p.productId === productId);
}

export function listPrices(
  state: ProductCatalogPlansPricesState,
  planId?: string,
): readonly Price[] {
  if (planId === undefined) {
    return state.prices;
  }
  return state.prices.filter((p) => p.planId === planId);
}

export function getTenantCatalog(
  state: ProductCatalogPlansPricesState,
  tokenPermissions: readonly ProductCatalogPlansPricesPermission[],
): TenantCatalog | ProductCatalogPlansPricesError {
  if (!checkPermission('TENANT_BILLING_READ', tokenPermissions)) {
    return { kind: 'PERMISSION_DENIED', message: 'TENANT_BILLING_READ permission required' };
  }

  return {
    products: state.products,
    plans: state.plans,
    prices: state.prices,
  };
}