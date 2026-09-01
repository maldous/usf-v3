import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/entitlementsbilling/productcatalogplansprices.ts";

test("productcatalogplanspricesauditmodel", () => {
  const operatorId = "operator-123";
  const initial: capability.ProductCatalogPlansPricesState = capability.initialState;
  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => null;

  const request: capability.CreateProductRequest = { name: "Test Product", description: "Test Description" };
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
    ...capability.initialState,
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
  assert.equal(filteredPlans[0].id, "pl1");

  const allPrices = capability.listPrices(state);
  assert.equal(allPrices.length, 1);
  const filteredPrices = capability.listPrices(state, "pl1");
  assert.equal(filteredPrices.length, 1);
  assert.equal(filteredPrices[0].id, "pr1");

  const tenantCatalog = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  assert.ok(!("kind" in tenantCatalog));
  assert.equal(tenantCatalog.products.length, 1);
  assert.equal(tenantCatalog.plans.length, 1);
  assert.equal(tenantCatalog.prices.length, 1);
});

test("productcatalogplanspriceserrormodel", () => {
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;
  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => null;

  const invalidRequest = { name: "", description: "Test" };
  const validationResult = capability.validateCreateProductRequest(invalidRequest);
  assert.equal(validationResult.kind, "VALIDATION_ERROR");

  const permissionResult = capability.createProduct(state, "operator-123", { name: "Test", description: "Test" }, auditFn, []);
  assert.equal(permissionResult.kind, "PERMISSION_DENIED");

  const readinessState: capability.ProductCatalogPlansPricesState = { ...state, readiness: "READ_ONLY" };
  const readinessResult = capability.createProduct(readinessState, "operator-123", { name: "Test", description: "Test" }, auditFn, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.equal(readinessResult.kind, "READINESS_FAILURE");
});

test("productcatalogplanspriceslifecycle", () => {
  const operatorId = "operator-123";
  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => null;
  const permissions = ["PLATFORM_BILLING_ADMIN"] as const;

  let state: capability.ProductCatalogPlansPricesState = capability.initialState;

  const productRequest: capability.CreateProductRequest = { name: "Test Product", description: "Test Description" };
  const productResult = capability.createProduct(state, operatorId, productRequest, auditFn, permissions);
  assert.ok(!("kind" in productResult));
  state = productResult;
  assert.equal(state.products.length, 1);

  const planRequest: capability.CreatePlanRequest = { productId: state.products[0].id, name: "Test Plan", currency: "USD", billingPeriod: "MONTHLY" };
  const planResult = capability.createPlan(state, operatorId, planRequest, auditFn, permissions);
  assert.ok(!("kind" in planResult));
  state = planResult;
  assert.equal(state.plans.length, 1);

  const priceRequest: capability.CreatePriceRequest = { planId: state.plans[0].id, version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" };
  const priceResult = capability.createPrice(state, operatorId, priceRequest, auditFn, permissions);
  assert.ok(!("kind" in priceResult));
  state = priceResult;
  assert.equal(state.prices.length, 1);

  const tenantCatalog = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  assert.ok(!("kind" in tenantCatalog));
  assert.equal(tenantCatalog.products.length, 1);
  assert.equal(tenantCatalog.plans.length, 1);
  assert.equal(tenantCatalog.prices.length, 1);
});

test("productcatalogplanspricespermissions", () => {
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;
  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => null;

  const noPermissionResult = capability.createProduct(state, "operator-123", { name: "Test", description: "Test" }, auditFn, []);
  assert.equal(noPermissionResult.kind, "PERMISSION_DENIED");

  const tenantReadResult = capability.getTenantCatalog(state, []);
  assert.equal(tenantReadResult.kind, "PERMISSION_DENIED");

  const validCreateResult = capability.createProduct(state, "operator-123", { name: "Test", description: "Test" }, auditFn, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.ok(!("kind" in validCreateResult));

  const validReadResult = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  assert.ok(!("kind" in validReadResult));
});

test("productcatalogplanspricesproof", () => {
  const state: capability.ProductCatalogPlansPricesState = capability.initialState;
  const products = capability.listProducts(state);
  assert.deepEqual(products, []);

  const plans = capability.listPlans(state);
  assert.deepEqual(plans, []);

  const prices = capability.listPrices(state);
  assert.deepEqual(prices, []);
});

test("productcatalogplanspricesreadinessmodel", () => {
  const readOnlyState: capability.ProductCatalogPlansPricesState = {
    ...capability.initialState,
    readiness: "READ_ONLY",
  };
  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => null;

  const result = capability.createProduct(readOnlyState, "operator-123", { name: "Test", description: "Test" }, auditFn, ["PLATFORM_BILLING_ADMIN"] as const);
  assert.equal(result.kind, "READINESS_FAILURE");

  const products = capability.listProducts(readOnlyState);
  assert.deepEqual(products, []);
});

test("productcatalogplanspricesstatemodel", () => {
  const product: capability.Product = { id: "p1", name: "Product 1", description: "Desc", active: true, createdAt: "2023-01-01T00:00:00Z" };
  const plan: capability.Plan = { id: "pl1", productId: "p1", name: "Plan 1", currency: "USD", billingPeriod: "MONTHLY", active: true, createdAt: "2023-01-01T00:00:00Z" };
  const price: capability.Price = { id: "pr1", planId: "pl1", version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY", active: true, createdAt: "2023-01-01T00:00:00Z" };

  assert.equal(product.id, "p1");
  assert.equal(product.name, "Product 1");
  assert.equal(product.description, "Desc");
  assert.equal(product.active, true);
  assert.equal(product.createdAt, "2023-01-01T00:00:00Z");

  assert.equal(plan.id, "pl1");
  assert.equal(plan.productId, "p1");
  assert.equal(plan.name, "Plan 1");
  assert.equal(plan.currency, "USD");
  assert.equal(plan.billingPeriod, "MONTHLY");
  assert.equal(plan.active, true);
  assert.equal(plan.createdAt, "2023-01-01T00:00:00Z");

  assert.equal(price.id, "pr1");
  assert.equal(price.planId, "pl1");
  assert.equal(price.version, 1);
  assert.equal(price.priceType, "RECURRING");
  assert.equal(price.unitAmount, 100);
  assert.equal(price.currency, "USD");
  assert.equal(price.billingPeriod, "MONTHLY");
  assert.equal(price.active, true);
  assert.equal(price.createdAt, "2023-01-01T00:00:00Z");
});

test("productcatalogplanspricesvalidation", () => {
  const invalidProduct = capability.validateCreateProductRequest({ name: "", description: "Test" });
  assert.equal(invalidProduct.kind, "VALIDATION_ERROR");

  const invalidPlan = capability.validateCreatePlanRequest({ productId: "", name: "Test", currency: "USD", billingPeriod: "MONTHLY" });
  assert.equal(invalidPlan.kind, "VALIDATION_ERROR");

  const invalidPrice = capability.validateCreatePriceRequest({ planId: "", version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" });
  assert.equal(invalidPrice.kind, "VALIDATION_ERROR");

  const state: capability.ProductCatalogPlansPricesState = capability.initialState;
  const auditFn = (event: capability.ProductCatalogPlansPricesAuditEvent): capability.ProductCatalogPlansPricesError | null => null;
  const permissions = ["PLATFORM_BILLING_ADMIN"] as const;

  const planRequest: capability.CreatePlanRequest = { productId: "non-existent", name: "Test", currency: "USD", billingPeriod: "MONTHLY" };
  const planResult = capability.createPlan(state, "operator-123", planRequest, auditFn, permissions);
  assert.equal(planResult.kind, "REFERENCE_NOT_FOUND");

  const priceRequest: capability.CreatePriceRequest = { planId: "non-existent", version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" };
  const priceResult = capability.createPrice(state, "operator-123", priceRequest, auditFn, permissions);
  assert.equal(priceResult.kind, "REFERENCE_NOT_FOUND");
});