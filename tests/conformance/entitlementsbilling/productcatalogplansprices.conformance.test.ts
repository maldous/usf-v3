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

  const request: capability.CreateProductRequest = { name: "Test Product", description: "Test Description" };
  const result = capability.createProduct(initial, operatorId, request, auditFn, ["PLATFORM_BILLING_ADMIN"] as const);

  if ("kind" in result) {
    assert.fail("Should not return an error");
  }
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
  const filteredPlans = capability.listPlans(state