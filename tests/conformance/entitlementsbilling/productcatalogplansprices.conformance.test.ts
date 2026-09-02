import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/entitlementsbilling/productcatalogplansprices.ts";

test("productcatalogplanspricesauditmodel", () => {
  const operatorId = "operator-123";
  const result = capability.createProduct(
    capability.initialState,
    operatorId,
    { name: "Test Product", description: "Test Description" },
    () => null,
    ["PLATFORM_BILLING_ADMIN"] as const,
  );
  if ("kind" in result) {
    throw new Error("Unexpected error: " + result.kind);
  }
  assert.ok(result.lastAuditEvent);
  assert.equal(result.lastAuditEvent.kind, "CATALOG_CHANGED");
  assert.equal(result.lastAuditEvent.operatorId, operatorId);
  assert.equal(result.lastAuditEvent.entityType, "PRODUCT");
  assert.ok(result.lastAuditEvent.entityId.startsWith("product-"));
  assert.ok(result.lastAuditEvent.timestamp);
});

test("productcatalogplanspricescontracts", () => {
  const product: capability.Product = {
    identifier: "p1",
    name: "Product 1",
    description: "Desc",
    active: true,
    createdTimestamp: "2023-01-01T00:00:00Z",
  };
  const plan: capability.Plan = {
    identifier: "pl1",
    owningProduct: "p1",
    name: "Plan 1",
    currency: "USD",
    billingPeriod: "MONTHLY",
    active: true,
    createdTimestamp: "2023-01-01T00:00:00Z",
  };
  const price: capability.Price = {
    identifier: "pr1",
    owningPlan: "pl1",
    version: 1,
    priceType: "RECURRING",
    unitAmount: 100,
    currency: "USD",
    billingPeriod: "MONTHLY",
    active: true,
    createdTimestamp: "2023-01-01T00:00:00Z",
  };
  const state: capability.ProductCatalogPlansPricesState = {
    products: [product],
    plans: [plan],
    prices: [price],
    readiness: "FULL",
    lastAuditEvent: null,
    lastError: null,
  };

  const products = capability.listProducts(state);
  assert.equal(products.length, 1);
  assert.equal(products[0].identifier, "p1");

  const allPlans = capability.listPlans(state);
  assert.equal(allPlans.length, 1);
  const filteredPlans = capability.listPlans(state, "p1");
  assert.equal(filteredPlans.length, 1);
  assert.equal(filteredPlans[0].owningProduct, "p1");

  const allPrices = capability.listPrices(state);
  assert.equal(allPrices.length, 1);
  const filteredPrices = capability.listPrices(state, "pl1");
  assert.equal(filteredPrices.length, 1);
  assert.equal(filteredPrices[0].owningPlan, "pl1");

  const tenantCatalog = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  if ("kind" in tenantCatalog) {
    throw new Error("Unexpected error: " + tenantCatalog.kind);
  }
  assert.equal(tenantCatalog.products.length, 1);
  assert.equal(tenantCatalog.plans.length, 1);
  assert.equal(tenantCatalog.prices.length, 1);
});

test("productcatalogplanspriceserrormodel", () => {
  const state = capability.initialState;

  const invalidRequest = { name: "", description: "Test" };
  const validationResult = capability.createProduct(state, "operator-1", invalidRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if (!("kind" in validationResult)) throw new Error("Expected error");
  assert.equal(validationResult.kind, "VALIDATION_ERROR");

  const permissionDeniedResult = capability.createProduct(state, "operator-1", { name: "Test", description: "Test" }, () => null, []);
  if (!("kind" in permissionDeniedResult)) throw new Error("Expected error");
  assert.equal(permissionDeniedResult.kind, "PERMISSION_DENIED");

  const readinessState: capability.ProductCatalogPlansPricesState = { ...state, readiness: "READ_ONLY" };
  const readinessResult = capability.createProduct(readinessState, "operator-1", { name: "Test", description: "Test" }, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if (!("kind" in readinessResult)) throw new Error("Expected error");
  assert.equal(readinessResult.kind, "READINESS_FAILURE");

  const validRequest = { name: "Test Product", description: "Test Description" };
  const validResult = capability.createProduct(state, "operator-1", validRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if ("kind" in validResult) throw new Error("Unexpected error");
  assert.equal(validResult.products.length, 1);
});

test("productcatalogplanspriceslifecycle", () => {
  const operatorId = "operator-123";
  const initialState = capability.initialState;

  const productResult = capability.createProduct(initialState, operatorId, { name: "Test Product", description: "Test Description" }, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if ("kind" in productResult) throw new Error("Unexpected error: " + productResult.kind);
  assert.equal(productResult.products.length, 1);
  const createdProductIdentifier = productResult.products[0].identifier;

  const planRequest: capability.CreatePlanRequest = { owningProduct: createdProductIdentifier, name: "Test Plan", currency: "USD", billingPeriod: "MONTHLY" };
  const planResult = capability.createPlan(productResult, operatorId, planRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if ("kind" in planResult) throw new Error("Unexpected error: " + planResult.kind);
  assert.equal(planResult.plans.length, 1);
  const createdPlanIdentifier = planResult.plans[0].identifier;

  const priceRequest: capability.CreatePriceRequest = { owningPlan: createdPlanIdentifier, version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" };
  const priceResult = capability.createPrice(planResult, operatorId, priceRequest, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if ("kind" in priceResult) throw new Error("Unexpected error: " + priceResult.kind);
  assert.equal(priceResult.prices.length, 1);

  const filteredPlans = capability.listPlans(priceResult, createdProductIdentifier);
  assert.equal(filteredPlans.length, 1);
  assert.equal(filteredPlans[0].owningProduct, createdProductIdentifier);

  const filteredPrices = capability.listPrices(priceResult, createdPlanIdentifier);
  assert.equal(filteredPrices.length, 1);
  assert.equal(filteredPrices[0].owningPlan, createdPlanIdentifier);

  const tenantCatalog = capability.getTenantCatalog(priceResult, ["TENANT_BILLING_READ"] as const);
  if ("kind" in tenantCatalog) throw new Error("Unexpected error: " + tenantCatalog.kind);
  assert.equal(tenantCatalog.products.length, 1);
  assert.equal(tenantCatalog.plans.length, 1);
  assert.equal(tenantCatalog.prices.length, 1);
});

test("productcatalogplanspricespermissions", () => {
  const state = capability.initialState;

  const permissionDeniedResult = capability.createProduct(state, "operator-1", { name: "Test", description: "Test" }, () => null, []);
  if (!("kind" in permissionDeniedResult)) throw new Error("Expected error");
  assert.equal(permissionDeniedResult.kind, "PERMISSION_DENIED");

  const tenantReadDeniedResult = capability.getTenantCatalog(state, []);
  if (!("kind" in tenantReadDeniedResult)) throw new Error("Expected error");
  assert.equal(tenantReadDeniedResult.kind, "PERMISSION_DENIED");

  const validCreateResult = capability.createProduct(state, "operator-1", { name: "Test", description: "Test" }, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if ("kind" in validCreateResult) throw new Error("Unexpected error: " + validCreateResult.kind);
  assert.equal(validCreateResult.products.length, 1);

  const validReadResult = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  if ("kind" in validReadResult) throw new Error("Unexpected error: " + validReadResult.kind);
});

test("productcatalogplanspricesproof", () => {
  const state = capability.initialState;
  const products = capability.listProducts(state);
  assert.deepEqual(products, []);

  const plans = capability.listPlans(state);
  assert.deepEqual(plans, []);

  const prices = capability.listPrices(state);
  assert.deepEqual(prices, []);

  const tenantCatalog = capability.getTenantCatalog(state, ["TENANT_BILLING_READ"] as const);
  if ("kind" in tenantCatalog) throw new Error("Unexpected error: " + tenantCatalog.kind);
  assert.deepEqual(tenantCatalog.products, []);
  assert.deepEqual(tenantCatalog.plans, []);
  assert.deepEqual(tenantCatalog.prices, []);
});

test("productcatalogplanspricesreadinessmodel", () => {
  const readOnlyState: capability.ProductCatalogPlansPricesState = {
    ...capability.initialState,
    readiness: "READ_ONLY",
  };

  const createResult = capability.createProduct(readOnlyState, "operator-1", { name: "Test", description: "Test" }, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if (!("kind" in createResult)) throw new Error("Expected error");
  assert.equal(createResult.kind, "READINESS_FAILURE");

  const listResult = capability.listProducts(readOnlyState);
  assert.deepEqual(listResult, []);

  const readCatalogResult = capability.getTenantCatalog(readOnlyState, ["TENANT_BILLING_READ"] as const);
  if ("kind" in readCatalogResult) throw new Error("Unexpected error: " + readCatalogResult.kind);
  assert.deepEqual(readCatalogResult.products, []);
});

test("productcatalogplanspricesstatemodel", () => {
  const productResult = capability.createProduct(
    capability.initialState,
    "test-operator",
    { name: "Test Product", description: "Test Description" },
    () => null,
    ["PLATFORM_BILLING_ADMIN"] as const,
  );
  if ("kind" in productResult) throw new Error("Expected product creation to succeed: " + productResult.kind);
  const product = productResult.products[0];

  assert.ok(typeof product.identifier === "string" && product.identifier.startsWith("product-"));
  assert.equal(product.name, "Test Product");
  assert.equal(product.description, "Test Description");
  assert.equal(product.active, true);
  assert.ok(product.createdTimestamp);

  const listedProducts = capability.listProducts(productResult);
  assert.equal(listedProducts.length, 1);
  assert.equal(listedProducts[0].identifier, product.identifier);

  const planResult = capability.createPlan(
    productResult,
    "test-operator",
    { owningProduct: product.identifier, name: "Test Plan", currency: "USD", billingPeriod: "MONTHLY" },
    () => null,
    ["PLATFORM_BILLING_ADMIN"] as const,
  );
  if ("kind" in planResult) throw new Error("Expected plan creation to succeed: " + planResult.kind);
  const plan = planResult.plans[0];

  assert.ok(typeof plan.identifier === "string" && plan.identifier.startsWith("plan-"));
  assert.equal(plan.owningProduct, product.identifier);
  assert.equal(plan.name, "Test Plan");
  assert.equal(plan.currency, "USD");
  assert.equal(plan.billingPeriod, "MONTHLY");
  assert.equal(plan.active, true);
  assert.ok(plan.createdTimestamp);

  const listedPlans = capability.listPlans(planResult);
  assert.equal(listedPlans.length, 1);
  assert.equal(listedPlans[0].identifier, plan.identifier);

  const priceResult = capability.createPrice(
    planResult,
    "test-operator",
    { owningPlan: plan.identifier, version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" },
    () => null,
    ["PLATFORM_BILLING_ADMIN"] as const,
  );
  if ("kind" in priceResult) throw new Error("Expected price creation to succeed: " + priceResult.kind);
  const price = priceResult.prices[0];

  assert.ok(typeof price.identifier === "string" && price.identifier.startsWith("price-"));
  assert.equal(price.owningPlan, plan.identifier);
  assert.equal(price.version, 1);
  assert.equal(price.priceType, "RECURRING");
  assert.equal(price.unitAmount, 100);
  assert.equal(price.currency, "USD");
  assert.equal(price.billingPeriod, "MONTHLY");
  assert.equal(price.active, true);
  assert.ok(price.createdTimestamp);

  const listedPrices = capability.listPrices(priceResult);
  assert.equal(listedPrices.length, 1);
  assert.equal(listedPrices[0].identifier, price.identifier);

  const priceResultV2 = capability.createPrice(
    priceResult,
    "test-operator",
    { owningPlan: plan.identifier, version: 2, priceType: "RECURRING", unitAmount: 150, currency: "USD", billingPeriod: "MONTHLY" },
    () => null,
    ["PLATFORM_BILLING_ADMIN"] as const,
  );
  if ("kind" in priceResultV2) throw new Error("Expected second price creation to succeed: " + priceResultV2.kind);
  const prices = priceResultV2.prices;
  assert.equal(prices.length, 2);

  const firstPrice = prices.find((p) => p.identifier === price.identifier);
  const secondPrice = prices.find((p) => p.identifier !== price.identifier);

  assert.equal(firstPrice?.version, 1);
  assert.equal(secondPrice?.version, 2);
});

test("productcatalogplanspricesvalidation", () => {
  const invalidProductRequest = { name: "", description: "Test" };
  const productValidation = capability.validateCreateProductRequest(invalidProductRequest);
  if (!("kind" in productValidation)) throw new Error("Expected error");
  assert.equal(productValidation.kind, "VALIDATION_ERROR");

  const invalidPlanRequest = { owningProduct: "", name: "Test", currency: "USD", billingPeriod: "MONTHLY" };
  const planValidation = capability.validateCreatePlanRequest(invalidPlanRequest);
  if (!("kind" in planValidation)) throw new Error("Expected error");
  assert.equal(planValidation.kind, "VALIDATION_ERROR");

  const invalidPriceRequest = { owningPlan: "", version: 0, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" };
  const priceValidation = capability.validateCreatePriceRequest(invalidPriceRequest);
  if (!("kind" in priceValidation)) throw new Error("Expected error");
  assert.equal(priceValidation.kind, "VALIDATION_ERROR");

  const validProductRequest = { name: "Test Product", description: "Test Description" };
  const validProduct = capability.validateCreateProductRequest(validProductRequest);
  if ("kind" in validProduct) throw new Error("Unexpected error: " + validProduct.kind);
  assert.equal(validProduct.name, "Test Product");
  assert.equal(validProduct.description, "Test Description");

  const validPlanRequest = { owningProduct: "p1", name: "Test Plan", currency: "USD", billingPeriod: "MONTHLY" };
  const validPlan = capability.validateCreatePlanRequest(validPlanRequest);
  if ("kind" in validPlan) throw new Error("Unexpected error: " + validPlan.kind);
  assert.equal(validPlan.owningProduct, "p1");

  const validPriceRequest = { owningPlan: "pl1", version: 1, priceType: "RECURRING", unitAmount: 100, currency: "USD", billingPeriod: "MONTHLY" };
  const validPrice = capability.validateCreatePriceRequest(validPriceRequest);
  if ("kind" in validPrice) throw new Error("Unexpected error: " + validPrice.kind);
  assert.equal(validPrice.unitAmount, 100);

  const product: capability.Product = {
    identifier: "p1",
    name: "Product 1",
    description: "Desc",
    active: true,
    createdTimestamp: "2023-01-01T00:00:00Z",
  };
  const plan: capability.Plan = {
    identifier: "pl1",
    owningProduct: "p1",
    name: "Plan 1",
    currency: "USD",
    billingPeriod: "MONTHLY",
    active: true,
    createdTimestamp: "2023-01-01T00:00:00Z",
  };
  const stateWithRef: capability.ProductCatalogPlansPricesState = {
    products: [product],
    plans: [plan],
    prices: [],
    readiness: "FULL",
    lastAuditEvent: null,
    lastError: null,
  };

  const missingProductRefResult = capability.createPlan(stateWithRef, "op-1", { owningProduct: "missing", name: "X", currency: "USD", billingPeriod: "MONTHLY" }, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if (!("kind" in missingProductRefResult)) throw new Error("Expected error");
  assert.equal(missingProductRefResult.kind, "REFERENCE_NOT_FOUND");

  const missingPlanRefResult = capability.createPrice(stateWithRef, "op-1", { owningPlan: "missing", version: 1, priceType: "RECURRING", unitAmount: 1, currency: "USD", billingPeriod: "MONTHLY" }, () => null, ["PLATFORM_BILLING_ADMIN"] as const);
  if (!("kind" in missingPlanRefResult)) throw new Error("Expected error");
  assert.equal(missingPlanRefResult.kind, "REFERENCE_NOT_FOUND");
});