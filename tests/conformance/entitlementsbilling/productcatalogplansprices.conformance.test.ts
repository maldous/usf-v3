import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/entitlementsbilling/productcatalogplansprices.ts";

type Permission = capability.ProductCatalogPlansPricesPermission;

const adminPermissions = ["PLATFORM_BILLING_ADMIN"] as const satisfies readonly Permission[];
const tenantPermissions = ["TENANT_BILLING_READ"] as const satisfies readonly Permission[];

const usd: capability.ProductCatalogPlansPricesCurrency = "USD";
const eur: capability.ProductCatalogPlansPricesCurrency = "EUR";
const monthly: capability.ProductCatalogPlansPricesBillingPeriod = "MONTHLY";
const annual: capability.ProductCatalogPlansPricesBillingPeriod = "ANNUAL";
const fixed: capability.ProductCatalogPlansPricesPriceType = "FIXED";

function noAudit(_event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null {
  return null;
}

function isCatalogError(value: unknown): value is capability.ProductCatalogPlansPricesError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

function expectSuccess<T>(
  result: T | capability.ProductCatalogPlansPricesError,
  label: string,
): T {
  if (isCatalogError(result)) {
    throw new Error(`Expected ${label} to succeed, got ${result.kind}`);
  }
  return result;
}

function expectError<T>(
  result: T | capability.ProductCatalogPlansPricesError,
  label: string,
): capability.ProductCatalogPlansPricesError {
  if (!isCatalogError(result)) {
    throw new Error(`Expected ${label} to fail`);
  }
  return result;
}

function seedState(): capability.ProductCatalogPlansPricesState {
  return {
    products: [
      {
        identifier: "product-seed",
        name: "Seed Product",
        description: "Seed description",
        active: true,
        createdTimestamp: "2023-01-01T00:00:00.000Z",
      },
    ],
    plans: [
      {
        identifier: "plan-seed",
        owningProduct: "product-seed",
        name: "Seed Plan",
        currency: usd,
        billingPeriod: monthly,
        active: true,
        createdTimestamp: "2023-01-01T00:00:00.000Z",
      },
    ],
    prices: [
      {
        identifier: "price-seed",
        owningPlan: "plan-seed",
        version: 1,
        priceType: fixed,
        unitAmount: 100,
        currency: usd,
        billingPeriod: monthly,
        active: true,
        createdTimestamp: "2023-01-01T00:00:00.000Z",
      },
    ],
    readiness: "FULL",
    lastAuditEvent: null,
    lastError: null,
  };
}

test("productcatalogplanspricesauditmodel", () => {
  const events: capability.ProductCatalogPlansPricesAuditEvent[] = [];
  const auditCollector = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => {
    events.push(event);
    return null;
  };

  let state = expectSuccess(
    capability.createProduct(
      capability.initialState,
      "operator-audit",
      { name: "Audit Product", description: "Audit proof" },
      auditCollector,
      adminPermissions,
      () => "product-audit",
      () => "2024-01-01T00:00:00.000Z",
    ),
    "createProduct",
  );

  assert.equal(state.lastAuditEvent?.kind, "CATALOG_CHANGED");
  assert.equal(state.lastAuditEvent?.operatorId, "operator-audit");
  assert.equal(state.lastAuditEvent?.entityType, "PRODUCT");
  assert.equal(state.lastAuditEvent?.entityId, "product-audit");
  assert.equal(state.lastAuditEvent?.timestamp, "2024-01-01T00:00:00.000Z");
  assert.equal(events.length, 1);

  state = expectSuccess(
    capability.createPlan(
      state,
      "operator-audit",
      { owningProduct: "product-audit", name: "Audit Plan", currency: usd, billingPeriod: monthly },
      auditCollector,
      adminPermissions,
      () => "plan-audit",
      () => "2024-01-02T00:00:00.000Z",
    ),
    "createPlan",
  );

  assert.equal(state.lastAuditEvent?.kind, "CATALOG_CHANGED");
  assert.equal(state.lastAuditEvent?.operatorId, "operator-audit");
  assert.equal(state.lastAuditEvent?.entityType, "PLAN");
  assert.equal(state.lastAuditEvent?.entityId, "plan-audit");
  assert.equal(state.lastAuditEvent?.timestamp, "2024-01-02T00:00:00.000Z");
  assert.equal(events.length, 2);

  state = expectSuccess(
    capability.createPrice(
      state,
      "operator-audit",
      {
        owningPlan: "plan-audit",
        version: 1,
        priceType: fixed,
        unitAmount: 250,
        currency: usd,
        billingPeriod: monthly,
      },
      auditCollector,
      adminPermissions,
      () => "price-audit",
      () => "2024-01-03T00:00:00.000Z",
    ),
    "createPrice",
  );

  assert.equal(state.lastAuditEvent?.kind, "CATALOG_CHANGED");
  assert.equal(state.lastAuditEvent?.operatorId, "operator-audit");
  assert.equal(state.lastAuditEvent?.entityType, "PRICE");
  assert.equal(state.lastAuditEvent?.entityId, "price-audit");
  assert.equal(state.lastAuditEvent?.timestamp, "2024-01-03T00:00:00.000Z");
  assert.equal(events.length, 3);

  const directAudit = capability.auditCatalogChange(
    "operator-direct",
    "PRODUCT",
    "product-direct",
    auditCollector,
    "2024-01-04T00:00:00.000Z",
  );
  assert.equal(directAudit, null);
  assert.equal(events.length, 4);
  assert.equal(events[3]!.operatorId, "operator-direct");
  assert.equal(events[3]!.entityType, "PRODUCT");
  assert.equal(events[3]!.entityId, "product-direct");
  assert.equal(events[3]!.kind, "CATALOG_CHANGED");
});

test("productcatalogplanspricescontracts", () => {
  const state = seedState();

  const products = expectSuccess(capability.listProducts(state, adminPermissions), "listProducts");
  assert.equal(products.length, 1);
  assert.equal(products[0]!.identifier, "product-seed");

  const allPlans = expectSuccess(capability.listPlans(state, adminPermissions), "listPlans");
  assert.equal(allPlans.length, 1);
  const filteredPlans = expectSuccess(capability.listPlans(state, adminPermissions, "product-seed"), "listPlans(product filter)");
  assert.equal(filteredPlans.length, 1);
  assert.equal(filteredPlans[0]!.owningProduct, "product-seed");

  const orphanPlans = expectSuccess(
    capability.listPlans(state, adminPermissions, "product-missing"),
    "listPlans(empty filter)",
  );
  assert.equal(orphanPlans.length, 0);

  const allPrices = expectSuccess(capability.listPrices(state, adminPermissions), "listPrices");
  assert.equal(allPrices.length, 1);
  const filteredPrices = expectSuccess(capability.listPrices(state, adminPermissions, "plan-seed"), "listPrices(plan filter)");
  assert.equal(filteredPrices.length, 1);
  assert.equal(filteredPrices[0]!.owningPlan, "plan-seed");

  const tenantCatalog = expectSuccess(
    capability.getTenantCatalog(state, tenantPermissions, "tenant-1", "tenant-1"),
    "getTenantCatalog",
  );
  assert.equal(tenantCatalog.products.length, 1);
  assert.equal(tenantCatalog.plans.length, 1);
  assert.equal(tenantCatalog.prices.length, 1);

  const productRequest: capability.CreateProductRequest = {
    name: "Contract Product",
    description: "Contract test",
  };
  const validatedProduct = expectSuccess(
    capability.validateCreateProductRequest(productRequest),
    "validateCreateProductRequest",
  );
  assert.equal(validatedProduct.name, "Contract Product");

  const planRequest: capability.CreatePlanRequest = {
    owningProduct: "product-seed",
    name: "Contract Plan",
    currency: eur,
    billingPeriod: annual,
  };
  const validatedPlan = expectSuccess(
    capability.validateCreatePlanRequest(planRequest, state.products),
    "validateCreatePlanRequest",
  );
  assert.equal(validatedPlan.owningProduct, "product-seed");

  const priceRequest: capability.CreatePriceRequest = {
    owningPlan: "plan-seed",
    version: 2,
    priceType: "TIERED",
    unitAmount: 75,
    currency: eur,
    billingPeriod: annual,
  };
  const validatedPrice = expectSuccess(
    capability.validateCreatePriceRequest(priceRequest, state.plans),
    "validateCreatePriceRequest",
  );
  assert.equal(validatedPrice.owningPlan, "plan-seed");

  const withContractPlan = expectSuccess(
    capability.createPlan(
      state,
      "operator-contract",
      validatedPlan,
      noAudit,
      adminPermissions,
      () => "plan-contract",
      () => "2024-02-01T00:00:00.000Z",
    ),
    "createPlan contract path",
  );
  assert.equal(withContractPlan.plans.length, 2);

  const withContractPrice = expectSuccess(
    capability.createPrice(
      withContractPlan,
      "operator-contract",
      validatedPrice,
      noAudit,
      adminPermissions,
      () => "price-contract",
      () => "2024-02-02T00:00:00.000Z",
    ),
    "createPrice contract path",
  );
  assert.equal(withContractPrice.prices.length, 2);
});

test("productcatalogplanspriceserrormodel", () => {
  const empty = capability.initialState;

  const badRequest = expectError(
    capability.createProduct(
      empty,
      "operator-error",
      { name: "", description: "bad" },
      noAudit,
      adminPermissions,
    ),
    "invalid create body",
  );
  assert.equal(badRequest.kind, "VALIDATION_ERROR");
  assert.equal(empty.products.length, 0);

  const permissionFailure = expectError(
    capability.createPlan(
      empty,
      "operator-error",
      { owningProduct: "missing", name: "Plan", currency: usd, billingPeriod: monthly },
      noAudit,
      [] as readonly Permission[],
    ),
    "permission check before handlers",
  );
  assert.equal(permissionFailure.kind, "PERMISSION_DENIED");

  const readinessFailure = expectError(
    capability.createPrice(
      { ...empty, readiness: "READ_ONLY" },
      "operator-error",
      {
        owningPlan: "missing",
        version: 1,
        priceType: fixed,
        unitAmount: 10,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
    ),
    "readiness guard",
  );
  assert.equal(readinessFailure.kind, "READINESS_FAILURE");

  const downstreamFailure = expectError(
    capability.createProduct(
      empty,
      "operator-error",
      { name: "Product", description: "Downstream unavailable" },
      () => ({ kind: "READINESS_FAILURE", message: "provider offline" }),
      adminPermissions,
    ),
    "audit failure to typed readiness",
  );
  assert.equal(downstreamFailure.kind, "READINESS_FAILURE");
  assert.equal(empty.products.length, 0);

  const successState = expectSuccess(
    capability.createProduct(
      empty,
      "operator-error",
      { name: "Created", description: "Success" },
      noAudit,
      adminPermissions,
      () => "product-success",
      () => "2024-03-01T00:00:00.000Z",
    ),
    "successful create",
  );
  assert.equal(successState.products.length, 1);
  assert.equal(successState.products[0]!.identifier, "product-success");
  assert.equal(successState.lastError, null);

  const currentProducts = expectSuccess(capability.listProducts(successState, adminPermissions), "list after create");
  assert.equal(currentProducts.length, 1);
});

test("productcatalogplanspriceslifecycle", () => {
  const operator = "operator-lifecycle";
  let state = capability.initialState;

  state = expectSuccess(
    capability.createProduct(
      state,
      operator,
      { name: "Lifecycle Product", description: "Lifecycle" },
      noAudit,
      adminPermissions,
      () => "product-lifecycle",
      () => "2024-04-01T00:00:00.000Z",
    ),
    "lifecycle product",
  );

  state = expectSuccess(
    capability.createPlan(
      state,
      operator,
      {
        owningProduct: "product-lifecycle",
        name: "Lifecycle Plan",
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
      () => "plan-lifecycle",
      () => "2024-04-02T00:00:00.000Z",
    ),
    "lifecycle plan",
  );

  state = expectSuccess(
    capability.createPrice(
      state,
      operator,
      {
        owningPlan: "plan-lifecycle",
        version: 1,
        priceType: fixed,
        unitAmount: 99,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
      () => "price-lifecycle",
      () => "2024-04-03T00:00:00.000Z",
    ),
    "lifecycle price",
  );

  const byProduct = expectSuccess(
    capability.listPlans(state, adminPermissions, "product-lifecycle"),
    "filtered listPlans",
  );
  assert.equal(byProduct.length, 1);
  assert.equal(byProduct[0]!.owningProduct, "product-lifecycle");

  const byPlan = expectSuccess(
    capability.listPrices(state, adminPermissions, "plan-lifecycle"),
    "filtered listPrices",
  );
  assert.equal(byPlan.length, 1);
  assert.equal(byPlan[0]!.owningPlan, "plan-lifecycle");

  const tenantCatalog = expectSuccess(
    capability.getTenantCatalog(state, tenantPermissions, "tenant-lifecycle", "tenant-lifecycle"),
    "tenant catalog lifecycle",
  );
  assert.equal(tenantCatalog.products[0]!.identifier, "product-lifecycle");
  assert.equal(tenantCatalog.plans[0]!.identifier, "plan-lifecycle");
  assert.equal(tenantCatalog.prices[0]!.identifier, "price-lifecycle");

  const assertInactive = capability.setPlanActive(state, "plan-lifecycle", false);
  const activeScoped = expectSuccess(
    capability.getTenantCatalog(assertInactive, tenantPermissions, "tenant-lifecycle", "tenant-lifecycle"),
    "tenant catalog after inactivation",
  );
  assert.equal(activeScoped.plans.length, 0);
  assert.equal(activeScoped.prices.length, 1);

  assert.equal(state.lastAuditEvent?.operatorId, operator);
});

test("productcatalogplanspricespermissions", () => {
  const state = seedState();

  const deniedCreateProduct = expectError(
    capability.createProduct(
      state,
      "operator-noauth",
      { name: "Deny", description: "Denied" },
      noAudit,
      [] as readonly Permission[],
    ),
    "no admin create product",
  );
  assert.equal(deniedCreateProduct.kind, "PERMISSION_DENIED");

  const deniedCreatePlan = expectError(
    capability.createPlan(
      state,
      "operator-noauth",
      { owningProduct: "product-seed", name: "Denied Plan", currency: usd, billingPeriod: monthly },
      noAudit,
      [] as readonly Permission[],
    ),
    "no admin create plan",
  );
  assert.equal(deniedCreatePlan.kind, "PERMISSION_DENIED");

  const deniedCreatePrice = expectError(
    capability.createPrice(
      state,
      "operator-noauth",
      {
        owningPlan: "plan-seed",
        version: 2,
        priceType: fixed,
        unitAmount: 10,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      [] as readonly Permission[],
    ),
    "no admin create price",
  );
  assert.equal(deniedCreatePrice.kind, "PERMISSION_DENIED");

  const deniedListProducts = expectError(capability.listProducts(state, [] as readonly Permission[]), "no admin list products");
  assert.equal(deniedListProducts.kind, "PERMISSION_DENIED");

  const deniedListPlans = expectError(capability.listPlans(state, [] as readonly Permission[]), "no admin list plans");
  assert.equal(deniedListPlans.kind, "PERMISSION_DENIED");

  const deniedListPrices = expectError(capability.listPrices(state, [] as readonly Permission[]), "no admin list prices");
  assert.equal(deniedListPrices.kind, "PERMISSION_DENIED");

  const deniedTenantRead = expectError(
    capability.getTenantCatalog(state, [] as readonly Permission[], "tenant-1", "tenant-1"),
    "no tenant permission",
  );
  assert.equal(deniedTenantRead.kind, "PERMISSION_DENIED");

  const crossTenant = expectError(
    capability.getTenantCatalog(state, tenantPermissions, "tenant-a", "tenant-b"),
    "cross-tenant read denied",
  );
  assert.equal(crossTenant.kind, "PERMISSION_DENIED");

  assert.equal(capability.checkPermission("PLATFORM_BILLING_ADMIN", [] as readonly Permission[]), false);
  assert.equal(capability.checkPermission("PLATFORM_BILLING_ADMIN", adminPermissions), true);
  assert.equal(capability.checkPermission("TENANT_BILLING_READ", tenantPermissions), true);
  assert.equal(capability.checkPermission("TENANT_BILLING_READ", adminPermissions), false);

  const allowedCreate = expectSuccess(
    capability.createProduct(
      capability.initialState,
      "operator-allowed",
      { name: "Allowed", description: "Allowed" },
      noAudit,
      adminPermissions,
      () => "product-allowed",
      () => "2024-05-01T00:00:00.000Z",
    ),
    "allowed create",
  );
  const allowedTenantRead = expectSuccess(
    capability.getTenantCatalog(allowedCreate, tenantPermissions, "tenant-1", "tenant-1"),
    "allowed tenant read",
  );
  assert.equal(allowedTenantRead.products[0]!.identifier, "product-allowed");
});

test("productcatalogplanspricesproof", () => {
  const emptyProducts = expectSuccess(capability.listProducts(capability.initialState, adminPermissions), "proof empty products");
  assert.deepEqual(emptyProducts, []);

  const emptyTenant = expectSuccess(
    capability.getTenantCatalog(capability.initialState, tenantPermissions, "tenant-proof", "tenant-proof"),
    "proof empty tenant catalog",
  );
  assert.deepEqual(emptyTenant.products, []);
  assert.deepEqual(emptyTenant.plans, []);
  assert.deepEqual(emptyTenant.prices, []);

  const validated = expectSuccess(
    capability.validateCreateProductRequest({ name: "Proof Product", description: "Proof" }),
    "proof product validation",
  );
  assert.equal(validated.name, "Proof Product");

  const invalidProof = expectError(
    capability.validateCreateProductRequest({ name: "", description: "Proof" }),
    "proof validation failure",
  );
  assert.equal(invalidProof.kind, "VALIDATION_ERROR");

  const unsorted = [...capability.productCatalogPlansPricesMigrations].reverse();
  const migratedFromScratch = capability.applyMigrations({ version: 0, state: capability.initialState }, unsorted);
  assert.equal(migratedFromScratch.version, 2);

  const migratedViaFacade = capability.migrateCatalog(capability.initialState, 1);
  assert.equal(migratedViaFacade.version, 2);

  const auditEvents: capability.ProductCatalogPlansPricesAuditEvent[] = [];
  assert.equal(
    capability.auditCatalogChange(
      "operator-proof",
      "PRODUCT",
      "proof-product",
      (event) => {
        auditEvents.push(event);
        return null;
      },
      "2024-06-01T00:00:00.000Z",
    ),
    null,
  );
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]!.entityId, "proof-product");
});

test("productcatalogplanspricesreadinessmodel", () => {
  const seeded = seedState();

  const readOnly = capability.setReadiness(seeded, "READ_ONLY");
  assert.equal(readOnly.readiness, "READ_ONLY");

  const blockedProduct = expectError(
    capability.createProduct(
      readOnly,
      "operator-readiness",
      { name: "Blocked", description: "Blocked" },
      noAudit,
      adminPermissions,
    ),
    "create blocked by readiness",
  );
  assert.equal(blockedProduct.kind, "READINESS_FAILURE");

  const blockedPlan = expectError(
    capability.createPlan(
      readOnly,
      "operator-readiness",
      { owningProduct: "product-seed", name: "Blocked", currency: usd, billingPeriod: monthly },
      noAudit,
      adminPermissions,
    ),
    "plan blocked by readiness",
  );
  assert.equal(blockedPlan.kind, "READINESS_FAILURE");

  const blockedPrice = expectError(
    capability.createPrice(
      readOnly,
      "operator-readiness",
      {
        owningPlan: "plan-seed",
        version: 2,
        priceType: fixed,
        unitAmount: 100,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
    ),
    "price blocked by readiness",
  );
  assert.equal(blockedPrice.kind, "READINESS_FAILURE");

  const readOnlyProducts = expectSuccess(capability.listProducts(readOnly, adminPermissions), "list during readiness");
  assert.equal(readOnlyProducts.length, 1);
  const readOnlyTenant = expectSuccess(
    capability.getTenantCatalog(readOnly, tenantPermissions, "tenant-1", "tenant-1"),
    "tenant read during readiness",
  );
  assert.equal(readOnlyTenant.products.length, 1);
  assert.equal(readOnlyTenant.plans.length, 1);
  assert.equal(readOnlyTenant.prices.length, 1);

  const ready = capability.setReadiness(readOnly, "FULL");
  const writtenPrice = expectSuccess(
    capability.createPrice(
      ready,
      "operator-readiness",
      {
        owningPlan: "plan-seed",
        version: 2,
        priceType: fixed,
        unitAmount: 150,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
      () => "price-ready",
      () => "2024-06-02T00:00:00.000Z",
    ),
    "create while full",
  );
  assert.equal(writtenPrice.prices.length, 2);
});

test("productcatalogplanspricesstatemodel", () => {
  let state = capability.initialState;

  state = expectSuccess(
    capability.createProduct(
      state,
      "operator-state",
      { name: "State Product", description: "Stateful" },
      noAudit,
      adminPermissions,
      () => "product-state",
      () => "2024-07-01T00:00:00.000Z",
    ),
    "state product",
  );
  assert.equal(state.products[0]!.identifier, "product-state");
  assert.equal(state.products[0]!.name, "State Product");
  assert.equal(state.products[0]!.description, "Stateful");
  assert.equal(state.products[0]!.active, true);
  assert.equal(state.products[0]!.createdTimestamp, "2024-07-01T00:00:00.000Z");

  state = expectSuccess(
    capability.createPlan(
      state,
      "operator-state",
      { owningProduct: "product-state", name: "State Plan", currency: usd, billingPeriod: monthly },
      noAudit,
      adminPermissions,
      () => "plan-state",
      () => "2024-07-02T00:00:00.000Z",
    ),
    "state plan",
  );
  assert.equal(state.plans[0]!.identifier, "plan-state");
  assert.equal(state.plans[0]!.owningProduct, "product-state");
  assert.equal(state.plans[0]!.name, "State Plan");
  assert.equal(state.plans[0]!.currency, usd);
  assert.equal(state.plans[0]!.billingPeriod, monthly);
  assert.equal(state.plans[0]!.active, true);

  state = expectSuccess(
    capability.createPrice(
      state,
      "operator-state",
      {
        owningPlan: "plan-state",
        version: 1,
        priceType: fixed,
        unitAmount: 75,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
      () => "price-state",
      () => "2024-07-03T00:00:00.000Z",
    ),
    "state price",
  );
  assert.equal(state.prices[0]!.identifier, "price-state");
  assert.equal(state.prices[0]!.owningPlan, "plan-state");
  assert.equal(state.prices[0]!.version, 1);
  assert.equal(state.prices[0]!.priceType, fixed);
  assert.equal(state.prices[0]!.unitAmount, 75);
  assert.equal(state.prices[0]!.active, true);

  state = expectSuccess(
    capability.addPriceVersion(
      state,
      "operator-state",
      "price-state",
      2,
      150,
      noAudit,
      () => "price-state-v2",
      () => "2024-07-04T00:00:00.000Z",
    ),
    "versioning",
  );

  assert.equal(state.prices.length, 2);
  const historic = state.prices.find((candidate) => candidate.identifier === "price-state");
  const successor = state.prices.find((candidate) => candidate.identifier === "price-state-v2");
  assert.ok(historic);
  assert.ok(successor);
  assert.equal(historic!.active, false);
  assert.equal(historic!.unitAmount, 75);
  assert.equal(historic!.version, 1);
  assert.equal(successor!.active, true);
  assert.equal(successor!.version, 2);
  assert.equal(successor!.unitAmount, 150);

  const inactiveProduct = capability.setProductActive(state, "product-state", false);
  const deactivated = inactiveProduct.products.find((product) => product.identifier === "product-state");
  assert.ok(deactivated);
  assert.equal(deactivated!.active, false);

  const activeProduct = capability.setProductActive(inactiveProduct, "product-state", true);
  const reactivated = activeProduct.products.find((product) => product.identifier === "product-state");
  assert.ok(reactivated);
  assert.equal(reactivated!.active, true);

  const inactivePlan = capability.setPlanActive(activeProduct, "plan-state", false);
  assert.equal(
    inactivePlan.plans.find((plan) => plan.identifier === "plan-state")!.active,
    false,
  );

  const migrated = capability.migrateCatalog(state, 0);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.state.products[0]!.identifier, "product-state");
  assert.equal(migrated.state.plans[0]!.identifier, "plan-state");
});

test("productcatalogplanspricesvalidation", () => {
  const planRefState = seedState();

  const productInvalid = expectError(capability.validateCreateProductRequest({ name: "", description: "Bad" }), "invalid product");
  assert.equal(productInvalid.kind, "VALIDATION_ERROR");

  const nonObjectProduct = expectError(
    capability.validateCreateProductRequest("not-an-object"),
    "non-object product",
  );
  assert.equal(nonObjectProduct.kind, "VALIDATION_ERROR");

  const planInvalidCurrency = expectError(
    capability.validateCreatePlanRequest(
      { owningProduct: "product-seed", name: "Bad", currency: "ZZZ", billingPeriod: monthly },
      planRefState.products,
    ),
    "invalid plan currency",
  );
  assert.equal(planInvalidCurrency.kind, "VALIDATION_ERROR");

  const planInvalidBilling = expectError(
    capability.validateCreatePlanRequest(
      { owningProduct: "product-seed", name: "Bad", currency: usd, billingPeriod: "FOREVER" },
      planRefState.products,
    ),
    "invalid plan billing period",
  );
  assert.equal(planInvalidBilling.kind, "VALIDATION_ERROR");

  const priceInvalidVersion = expectError(
    capability.validateCreatePriceRequest(
      {
        owningPlan: "plan-seed",
        version: 0,
        priceType: fixed,
        unitAmount: 50,
        currency: usd,
        billingPeriod: monthly,
      },
      planRefState.plans,
    ),
    "invalid price version",
  );
  assert.equal(priceInvalidVersion.kind, "VALIDATION_ERROR");

  const priceInvalidAmount = expectError(
    capability.validateCreatePriceRequest(
      {
        owningPlan: "plan-seed",
        version: 1,
        priceType: fixed,
        unitAmount: -1,
        currency: usd,
        billingPeriod: monthly,
      },
      planRefState.plans,
    ),
    "invalid price amount",
  );
  assert.equal(priceInvalidAmount.kind, "VALIDATION_ERROR");

  const priceMissingReference = expectError(
    capability.createPrice(
      planRefState,
      "operator-validation",
      {
        owningPlan: "missing-plan",
        version: 2,
        priceType: fixed,
        unitAmount: 10,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
    ),
    "missing price reference",
  );
  assert.equal(priceMissingReference.kind, "VALIDATION_ERROR");

  const planMissingReference = expectError(
    capability.createPlan(
      planRefState,
      "operator-validation",
      { owningProduct: "missing-product", name: "Missing", currency: usd, billingPeriod: monthly },
      noAudit,
      adminPermissions,
    ),
    "missing plan reference",
  );
  assert.equal(planMissingReference.kind, "VALIDATION_ERROR");

  const resolvedPlan = expectSuccess(
    capability.createPlan(
      planRefState,
      "operator-validation",
      { owningProduct: "product-seed", name: "Linked", currency: usd, billingPeriod: monthly },
      noAudit,
      adminPermissions,
      () => "plan-linked",
      () => "2024-08-01T00:00:00.000Z",
    ),
    "resolved plan",
  );
  assert.equal(resolvedPlan.plans.length, 2);

  const resolvedPrice = expectSuccess(
    capability.createPrice(
      resolvedPlan,
      "operator-validation",
      {
        owningPlan: "plan-seed",
        version: 2,
        priceType: fixed,
        unitAmount: 10,
        currency: usd,
        billingPeriod: monthly,
      },
      noAudit,
      adminPermissions,
      () => "price-linked",
      () => "2024-08-02T00:00:00.000Z",
    ),
    "resolved price",
  );
  assert.equal(resolvedPrice.prices.length, 2);
  assert.equal(resolvedPrice.prices[1]!.owningPlan, "plan-seed");
});