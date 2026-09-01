import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/entitlementsbilling/subscriptionsinvoicespaymentmethodsdunning.ts";

// Audit model test
test("subscriptionsinvoicespaymentmethodsdunningauditmodel", () => {
  // Test audit event recording
  const initialState = capability.initialState;
  const testEvent: capability.AuditEvent = {
    kind: 'SUBSCRIPTION_TRANSITION',
    timestamp: '2023-01-01T00:00:00.000Z',
    tenantId: 'tenant1',
    metadata: { action: 'create' }
  };
  
  const updatedState = capability.recordAuditEvent(initialState, testEvent);
  assert.ok(updatedState.auditLedger.length === 1);
  assert.deepStrictEqual(updatedState.auditLedger[0], testEvent);
  
  // Test audit financial action
  let auditCalled = false;
  const auditFn = (event: capability.AuditEvent) => {
    auditCalled = true;
    return null;
  };
  
  const error = capability.auditFinancialAction(
    'CAPTURE_ATTEMPT',
    'tenant1',
    { amount: 100, currency: 'USD' },
    auditFn
  );
  
  assert.ok(auditCalled);
  assert.strictEqual(error, null);
});

// Contracts test
test("subscriptionsinvoicespaymentmethodsdunningcontracts", () => {
  // Test in-memory provider
  const inMemoryProvider = capability.createInMemoryProvider();
  assert.strictEqual(inMemoryProvider.kind, 'IN_MEMORY');
  assert.strictEqual(inMemoryProvider.readiness, 'READY');
  
  // Test external provider
  const externalProvider = capability.createExternalProvider(true);
  assert.strictEqual(externalProvider.kind, 'EXTERNAL');
  assert.strictEqual(externalProvider.readiness, 'READY');
  
  // Test provider methods exist and have correct signatures
  const invoiceId = 'test_invoice';
  const paymentMethodId = 'test_payment_method';
  const idempotencyKey = 'test_key';
  const amount: capability.Money = { amount: 100, currency: 'USD' };
  
  const captureResult = inMemoryProvider.capturePayment(invoiceId, paymentMethodId, idempotencyKey, amount);
  assert.ok('status' in captureResult);
  assert.strictEqual(captureResult.status, 'succeeded');
  assert.ok('chargeId' in captureResult);
  
  // Test idempotency key requirement
  const refundResult = inMemoryProvider.refundPayment('charge1', 'test_key', amount);
  assert.ok('status' in refundResult);
  assert.strictEqual(refundResult.status, 'succeeded');
});

// Error model test
test("subscriptionsinvoicespaymentmethodsdunningerrormodel", () => {
  // Test provider error handling - external provider unavailable
  const externalProvider = capability.createExternalProvider(false);
  const amount: capability.Money = { amount: 100, currency: 'USD' };
  
  const result = externalProvider.capturePayment('inv1', 'pm1', 'key1', amount);
  assert.ok('kind' in result);
  assert.strictEqual(result.kind, 'PROVIDER_UNAVAILABLE');
  
  // Test idempotency duplicate handling in capturePayment
  const inMemoryState = capability.initialState;
  const subscriptionState = capability.createSubscription(
    inMemoryState,
    'acc1',
    'plan1',
    'price1',
    'tenant1',
    'token1',
    capability.createInMemoryProvider(),
    (event: capability.AuditEvent) => null
  );
  
  const invoiceState = capability.issueInvoice(
    subscriptionState,
    'sub1',
    amount,
    'tenant1',
    'token1',
    capability.createInMemoryProvider(),
    (event: capability.AuditEvent) => null
  );
  
  // Capture first time
  const captureState1 = capability.capturePayment(
    invoiceState,
    'inv1',
    'pm1',
    'key1',
    'tenant1',
    'token1',
    capability.createInMemoryProvider(),
    (event: capability.AuditEvent) => null
  );
  assert.ok(captureState1.charges.length > 0);
  
  // Capture again with same idempotency key - should return same state (idempotent)
  const captureState2 = capability.capturePayment(
    invoiceState,
    'inv1',
    'pm1',
    'key1',
    'tenant1',
    'token1',
    capability.createInMemoryProvider(),
    (event: capability.AuditEvent) => null
  );
  assert.strictEqual(captureState1.charges.length, captureState2.charges.length);
});

// Lifecycle test
test("subscriptionsinvoicespaymentmethodsdunninglifecycle", () => {
  // Create account
  const state1 = capability.createAccount(capability.initialState, 'acc1', 'ext_acc1', 'tenant1', 'token1');
  assert.ok('accounts' in state1);
  assert.strictEqual(state1.accounts.length, 1);
  assert.strictEqual(state1.accounts[0].id, 'acc1');
  
  // Create subscription
  const provider = capability.createInMemoryProvider();
  const subscriptionState = capability.createSubscription(
    state1,
    'acc1',
    'plan1',
    'price1',
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  assert.ok('subscriptions' in subscriptionState);
  assert.strictEqual(subscriptionState.subscriptions.length, 1);
  assert.strictEqual(subscriptionState.subscriptions[0].status, 'active');
  
  // Issue invoice
  const amount: capability.Money = { amount: 100, currency: 'USD' };
  const invoiceState = capability.issueInvoice(
    subscriptionState,
    'sub1',
    amount,
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  assert.ok('invoices' in invoiceState);
  assert.strictEqual(invoiceState.invoices.length, 1);
  assert.strictEqual(invoiceState.invoices[0].status, 'open');
  assert.strictEqual(invoiceState.invoices[0].openAmount.amount, 100);
  
  // Capture payment
  const captureState = capability.capturePayment(
    invoiceState,
    'inv1',
    'pm1',
    'key1',
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  assert.ok('charges' in captureState);
  assert.strictEqual(captureState.charges.length, 1);
  assert.strictEqual(captureState.charges[0].status, 'succeeded');
  assert.strictEqual(captureState.invoices[0].status, 'paid');
});

// Permissions test
test("subscriptionsinvoicespaymentmethodsdunningpermissions", () => {
  // Test tenant access control on getAccount
  const state = capability.initialState;
  const correctAccount = capability.createAccount(state, 'acc1', 'ext_acc1', 'tenant1', 'token1');
  
  // Same tenant should succeed
  const sameTenantAccount = capability.getAccount(correctAccount, 'acc1', 'tenant1');
  assert.ok('id' in sameTenantAccount);
  assert.strictEqual(sameTenantAccount.id, 'acc1');
  
  // Different tenant should fail
  const differentTenantAccount = capability.getAccount(correctAccount, 'acc1', 'tenant2');
  assert.ok('kind' in differentTenantAccount);
  assert.strictEqual(differentTenantAccount.kind, 'TENANT_ACCESS_DENIED');
  
  // Test checkTenantAccess function directly
  const accessError = capability.checkTenantAccess(correctAccount, 'tenant1', 'tenant1');
  assert.strictEqual(accessError, null);
  
  const crossTenantError = capability.checkTenantAccess(correctAccount, 'tenant1', 'tenant2');
  assert.ok(crossTenantError !== null);
  assert.strictEqual(crossTenantError.kind, 'TENANT_ACCESS_DENIED');
});

// Proof test - demonstrate behavior
test("subscriptionsinvoicespaymentmethodsdunningproof", () => {
  // Demonstrate idempotent capture
  const provider = capability.createInMemoryProvider();
  const amount: capability.Money = { amount: 50, currency: 'EUR' };
  
  // Create subscription and invoice
  let state = capability.createAccount(capability.initialState, 'acc1', 'ext_acc1', 'tenant1', 'token1');
  state = capability.createSubscription(
    state,
    'acc1',
    'plan1',
    'price1',
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  state = capability.issueInvoice(
    state,
    'sub1',
    amount,
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  
  // First capture - should create charge
  state = capability.capturePayment(
    state,
    'inv1',
    'pm1',
    'key1',
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  assert.strictEqual(state.charges.length, 1);
  assert.strictEqual(state.invoices[0].status, 'paid');
  
  // Second capture with same key - should be idempotent (same state)
  const firstChargeCount = state.charges.length;
  const state2 = capability.capturePayment(
    state,
    'inv1',
    'pm1',
    'key1',
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  assert.strictEqual(state2.charges.length, firstChargeCount); // No new charge
});

// Readiness model test
test("subscriptionsinvoicespaymentmethodsdunningreadinessmodel", () => {
  // Test in-memory provider readiness
  const inMemoryProvider = capability.createInMemoryProvider();
  assert.strictEqual(inMemoryProvider.readiness, 'READY');
  
  // Test external provider ready
  const externalReadyProvider = capability.createExternalProvider(true);
  assert.strictEqual(externalReadyProvider.readiness, 'READY');
  
  // Test external provider degraded
  const externalDegradedProvider = capability.createExternalProvider(false);
  assert.strictEqual(externalDegradedProvider.readiness, 'DEGRADED');
  
  // Test readiness check for mutation
  const error = capability.checkReadiness(inMemoryProvider, true);
  assert.strictEqual(error, null);
  
  // Test provider readiness
  assert.strictEqual(capability.checkProviderReadiness(inMemoryProvider), 'READY');
  assert.strictEqual(capability.checkProviderReadiness(externalDegradedProvider), 'DEGRADED');
  
  // Test set readiness
  let state = capability.initialState;
  state = capability.setReadiness(state, 'DEGRADED');
  assert.strictEqual(state.readiness, 'DEGRADED');
  assert.notStrictEqual(state.lastError, null);
  assert.strictEqual(state.lastError?.kind, 'PROVIDER_READINESS_DEGRADED');
});

// State model test
test("subscriptionsinvoicespaymentmethodsdunningstatemodel", () => {
  // Create account and verify state structure
  const state = capability.createAccount(capability.initialState, 'acc1', 'ext_acc1', 'tenant1', 'token1');
  assert.ok('accounts' in state);
  assert.strictEqual(state.accounts.length, 1);
  assert.strictEqual(state.accounts[0].externalAccountId, 'ext_acc1');
  
  // Create subscription and verify state includes plan/price
  const provider = capability.createInMemoryProvider();
  const stateWithSubscription = capability.createSubscription(
    state,
    'acc1',
    'plan_pro',
    'price_monthly',
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  assert.strictEqual(stateWithSubscription.subscriptions[0].planId, 'plan_pro');
  assert.strictEqual(stateWithSubscription.subscriptions[0].priceId, 'price_monthly');
  assert.strictEqual(stateWithSubscription.subscriptions[0].status, 'active');
  
  // Issue invoice and verify amount/currency
  const amount: capability.Money = { amount: 999.99, currency: 'USD' };
  const stateWithInvoice = capability.issueInvoice(
    stateWithSubscription,
    'sub1',
    amount,
    'tenant1',
    'token1',
    provider,
    (event: capability.AuditEvent) => null
  );
  assert.strictEqual(stateWithInvoice.invoices[0].openAmount.amount, 999.99);
  assert.strictEqual(stateWithInvoice.invoices[0].openAmount.currency, 'USD');
  
  // Verify audit ledger is append-only
  assert.strictEqual(stateWithInvoice.auditLedger.length, 0);
});

// Validation test
test("subscriptionsinvoicespaymentmethodsdunningvalidation", () => {
  // Test amount validation
  const amountError = capability.validateAmount(-10);
  assert.ok(amountError !== null);
  assert.strictEqual(amountError.kind, 'INVALID_AMOUNT');
  
  const amountValid = capability.validateAmount(10);
  assert.strictEqual(amountValid, null);
  
  // Test currency validation
  const currencyError = capability.validateCurrency('US');
  assert.ok(currencyError !== null);
  assert.strictEqual(currencyError.kind, 'INVALID_CURRENCY');
  
  const currencyValid = capability.validateCurrency('USD');
  assert.strictEqual(currencyValid, null);
  
  // Test subscription status validation
  const statusError = capability.validateSubscriptionStatus('invalid_status');
  assert.ok(statusError !== null);
  assert.strictEqual(statusError.kind, 'INVALID_STATUS');
  
  const statusValid = capability.validateSubscriptionStatus('active');
  assert.strictEqual(statusValid, null);
  
  // Test invoice status validation
  const invoiceStatusError = capability.validateInvoiceStatus('pending');
  assert.ok(invoiceStatusError !== null);
  assert.strictEqual(invoiceStatusError.kind, 'INVALID_STATUS');
  
  const invoiceStatusValid = capability.validateInvoiceStatus('open');
  assert.strictEqual(invoiceStatusValid, null);
  
  // Test idempotency key validation
  const keyError = capability.validateIdempotencyKey('');
  assert.ok(keyError !== null);
  assert.strictEqual(keyError.kind, 'IDEMPOTENCY_KEY_REQUIRED');
  
  const keyValid = capability.validateIdempotencyKey('valid-key-123');
  assert.strictEqual(keyValid, null);
});