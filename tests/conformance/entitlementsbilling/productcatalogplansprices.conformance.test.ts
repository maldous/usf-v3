import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/entitlementsbilling/productcatalogplansprices.ts";

test("productcatalogplanspricesauditmodel", () => {
  const operatorId = "operator-123";
  const initial: capability.ProductCatalogPlansPricesState = capability.initialState;
  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => {
    assert.equal(event.kind, "CATALOG_CHANGED");
    assert.equal(event.operatorId, operatorId);
    assert.equal(event.entityType, "PRODUCT");
    assert.ok(event.entityId);
    assert.ok(event.timestamp);
    return null;
  };

  const request = { name: "Test Product", description: "Test Description" } as const;
  const result = capability.createProduct(initial, operatorId, request, auditFn, ["PLATFORM_BILLING_ADMIN"] as const);

  assert.ok(!("kind" in result), "Should not return an error");
  assert.equal(result.lastAuditEvent?.kind, "CATALOG_CHANGED");
  assert.equal(result.lastAuditEvent?.operatorId, operatorId);
  assert.equal(result.lastAuditEvent?.entityType, "PRODUCT");
  assert.ok(result.lastAuditEvent?.entityId);
  assert.ok(result.lastAuditEvent?.timestamp);
});

test("productcatalogplanspricescontracts", () => {
  const state: capability.ProductCatalogPlansPricesState = {
    products: [{ id: "p1", name: "Product 1", description: "Desc", active: true, createdAt: "2023-01-01T00:00:00Z" }],
    plans: [{ id: "pl1", productId: "p1", name: "Plan 1", currency: "USD", billingPeriod: "MONTHLY", active: true, createdAt: "2023-01-01T00:00:00Z" }],
    prices: [{ id: "pr1", planId: "pl1", version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY", active: true, createdAt: "2023-01-01T00:00:00Z" }],
    readiness: "FULL",
    lastAuditEvent: null,
    lastError: null,
  };

  const products = capability.listProducts(state);
  assert.equal(products.length, 1);
  assert.equal(products[0].id, "p1");

  const allPlans = capability.listPlans(state);
  assert.equal(allPlans.length, 1);
  const filteredPlans = capability.listPlans(state, "p1");
  assert.equal(filteredPlans.length, 1);
  assert.equal(filteredPlans[0].productId, "p1");

  const allPrices = capability.listPrices(state);
  assert.equal(allPrices.length, 1);
  const filteredPrices = capability.listPrices(state, "pl1");
  assert.equal(filteredPrices.length, 1);
  assert.equal(filteredPrices[0].planId, "pl1");

  const tenantCatalog = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  assert.ok(!("kind" in tenantCatalog), "Should not return an error");
  assert.equal(tenantCatalog.products.length, 1);
  assert.equal(tenantCatalog.plans.length, 1);
  assert.equal(tenantCatalog.prices.length, 1);
});

test("productcatalogplanspriceserrormodel", () => {
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;
  const invalidRequest = { name: "", description: "Test" } as const;
  const result = capability.createProduct(state, "operator-1", invalidRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.equal(result.kind, "VALIDATION_ERROR");

  const permissionDeniedResult = capability.createProduct(state, "operator-1", { name: "Test", description: "Test" } as const, () => null, [] as const);
  assert.equal(permissionDeniedResult.kind, "PERMISSION_DENIED");

  const readinessState: capability.ProductCatalogPlansPricesState = { ...state, readiness: "READ_ONLY" };
  const readinessResult = capability.createProduct(readinessState, "operator-1", { name: "Test", description: "Test" } as const, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.equal(readinessResult.kind, "READINESS_FAILURE");

  const stateWithProduct: capability.ProductCatalogPlansPricesState = {
    ...state,
    products: [{ id: "p1", name: "Product 1", description: "Desc", active: true, createdAt: "2023-01-01T00:00:00Z" }],
  };
  const referenceNotFoundResult = capability.createPlan(stateWithProduct, "operator-1", { productId: "non-existent", name: "Test", currency: "USD", billingPeriod: "MONTHLY" } as const, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.equal(referenceNotFoundResult.kind, "REFERENCE_NOT_FOUND");
});

test("productcatalogplanspriceslifecycle", () => {
  const operatorId = "operator-123";
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;

  const productRequest = { name: "Test Product", description: "Test Description" } as const;
  const productResult = capability.createProduct(state, operatorId, productRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.ok(!("kind" in productResult), "Should create product");
  assert.equal(productResult.products.length, 1);

  const planRequest = { productId: productResult.products[0].id, name: "Test Plan", currency: "USD", billingPeriod: "MONTHLY" } as const;
  const planResult = capability.createPlan(productResult, operatorId, planRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.ok(!("kind" in planResult), "Should create plan");
  assert.equal(planResult.plans.length, 1);

  const priceRequest = { planId: planResult.plans[0].id, version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" } as const;
  const priceResult = capability.createPrice(planResult, operatorId, priceRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.ok(!("kind" in priceResult), "Should create price");
  assert.equal(priceResult.prices.length, 1);

  const filteredPlans = capability.listPlans(priceResult, productResult.products[0].id);
  assert.equal(filteredPlans.length, 1);

  const filteredPrices = capability.listPrices(priceResult, planResult.plans[0].id);
  assert.equal(filteredPrices.length, 1);

  const tenantCatalog = capability.getTenantCatalog(priceResult, ["TENANT_BILLING_READ"] as const);
  assert.ok(!("kind" in tenantCatalog), "Should return tenant catalog");
  assert.equal(tenantCatalog.products.length, 1);
  assert.equal(tenantCatalog.plans.length, 1);
  assert.equal(tenantCatalog.prices.length, 1);
});

test("productcatalogplanspricespermissions", () => {
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;

  const permissionDeniedResult = capability.createProduct(state, "operator-1", { name: "Test", description: "Test" } as const, () => null, [] as const);
  assert.equal(permissionDeniedResult.kind, "PERMISSION_DENIED");

  const tenantReadDeniedResult = capability.getTenantCatalog(state, [] as const);
  assert.equal(tenantReadDeniedResult.kind, "PERMISSION_DENIED");

  const validCreateResult = capability.createProduct(state, "operator-1", { name: "Test", description: "Test" } as const, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.ok(!("kind" in validCreateResult), "Should succeed with correct permission");

  const validReadResult = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  assert.ok(!("kind" in validReadResult), "Should succeed with correct permission");
});

test("productcatalogplanspricesproof", () => {
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;
  const products = capability.listProducts(state);
  assert.deepEqual(products, []);

  const plans = capability.listPlans(state);
  assert.deepEqual(plans, []);

  const prices = capability.listPrices(state);
  assert.deepEqual(prices, []);

  const tenantCatalog = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  assert.ok(!("kind" in tenantCatalog), "Should return tenant catalog");
  assert.deepEqual(tenantCatalog.products, []);
  assert.deepEqual(tenantCatalog.plans, []);
  assert.deepEqual(tenantCatalog.prices, []);
});

test("productcatalogplanspricesreadinessmodel", () => {
  const readOnlyState: capability.ProductCatalogPlansPricesState = {
    ...capability.initialState,
    readiness: "READ_ONLY",
  };

  const createResult = capability.createProduct(readOnlyState, "operator-1", { name: "Test", description: "Test" } as const, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.equal(createResult.kind, "READINESS_FAILURE");

  const listResult = capability.listProducts(readOnlyState);
  assert.deepEqual(listResult, []);

  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => null;
  const auditResult = capability.auditCatalogChange("operator-1", "PRODUCT", "product-1", auditFn);
  assert.equal(auditResult, null);
});

test("productcatalogplanspricesstatemodel", () => {
  const product: capability.Product = {
    id: "p1",
    name: "Product 1",
    description: "Description",
    active: true,
    createdAt: "2023-01-01T00:00:00Z",
  };
  const plan: capability.Plan = {
    id: "pl1",
    productId: "p1",
    name: "Plan 1",
    currency: "USD",
    billingPeriod: "MONTHLY",
    active: true,
    createdAt: "2023-01-01T00:00:00Z",
  };
  const price: capability.Price = {
    id: "pr1",
    planId: "pl1",
    version: 1,
    priceType: "RECURRING",
    unitAmount: 100,
    currency: "USD",
    billingPeriod: "MONTHLY",
    active: true,
    createdAt: "2023-01-01T00:00:00Z",
  };

  assert.equal(product.id, "p1");
  assert.equal(product.name, "Product 1");
  assert.equal(product.description, "Description");
  assert.equal(product.active, true);
  assert.ok(product.createdAt);

  assert.equal(plan.id, "pl1");
  assert.equal(plan.productId, "p1");
  assert.equal(plan.name, "Plan 1");
  assert.equal(plan.currency, "USD");
  assert.equal(plan.billingPeriod, "MONTHLY");
  assert.equal(plan.active, true);
  assert.ok(plan.createdAt);

  assert.equal(price.id, "pr1");
  assert.equal(price.planId, "pl1");
  assert.equal(price.version, 1);
  assert.equal(price.priceType, "RECURRING");
  assert.equal(price.unitAmount, 100);
  assert.equal(price.currency, "USD");
  assert.equal(price.billingPeriod, "MONTHLY");
  assert.equal(price.active, true);
  assert.ok(price.createdAt);
});

test("productcatalogplanspricesvalidation", () => {
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;

  const invalidProductRequest = { name: "", description: "Test" } as const;
  const productValidationResult = capability.validateCreateProductRequest(invalidProductRequest);
  assert.equal(productValidationResult.kind, "VALIDATION_ERROR");

  const validProductRequest = { name: "Test Product", description: "Test Description" } as const;
  const validProductResult = capability.validateCreateProductRequest(validProductRequest);
  assert.ok(!("kind" in validProductResult), "Should be valid");

  const invalidPlanRequest = { productId: "", name: "Test", currency: "USD", billingPeriod: "MONTHLY" } as const;
  const planValidationResult = capability.validateCreatePlanRequest(invalidPlanRequest);
  assert.equal(planValidationResult.kind, "VALIDATION_ERROR");

  const validPlanRequest = { productId: "p1", name: "Test Plan", currency: "USD", billingPeriod: "MONTHLY" } as const;
  const validPlanResult = capability.validateCreatePlanRequest(validPlanRequest);
  assert.ok(!("kind" in validPlanResult), "Should be valid");

  const invalidPriceRequest = { planId: "", version: 0, priceType: "", unitAmount: 0, currency: "", billingPeriod: "" } as const;
  const priceValidationResult = capability.validateCreatePriceRequest(invalidPriceRequest);
  assert.equal(priceValidationResult.kind, "VALIDATION_ERROR");

  const validPriceRequest = { planId: "pl1", version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" } as const;
  const validPriceResult = capability.validateCreatePriceRequest(validPriceRequest);
  assert.ok(!("kind" in validPriceResult), "Should be valid");
});