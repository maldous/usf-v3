import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/entitlementsbilling/subscriptionsinvoicespaymentmethodsdunning.ts";

test("subscriptionsinvoicespaymentmethodsdunningauditmodel", () => {
  const initialState = capability.initialState;
  const testEvent: capability.AuditEvent = {
    kind: 'CAPTURE_ATTEMPT',
    timestamp: '2023-01-01T00:00:00.000Z',
    tenantId: 'tenant1',
    metadata: { invoiceId: 'inv1', amount: 100, currency: 'USD' }
  };

  const updatedState = capability.recordAuditEvent(initialState, testEvent);
  assert.strictEqual(updatedState.auditLedger.length, 1);
  assert.deepStrictEqual(updatedState.auditLedger[0], testEvent);

  let auditCalled = false;
  const auditFn = (event: capability.AuditEvent): capability.BillingError | null => {
    auditCalled = true;
    assert.strictEqual(event.kind, 'CAPTURE_ATTEMPT');
    assert.strictEqual(event.tenantId, 'tenant1');
    assert.deepStrictEqual(event.metadata, { invoiceId: 'inv1', amount: 100, currency: 'USD' });
    return null;
  };

  const error = capability.auditFinancialAction(
    'CAPTURE_ATTEMPT',
    'tenant1',
    { invoiceId: 'inv1', amount: 100, currency: 'USD' },
    auditFn
  );
  assert.ok(auditCalled);
  assert.strictEqual(error, null);
});

test("subscriptionsinvoicespaymentmethodsdunningcontracts", () => {
  const inMemoryProvider = capability.createInMemoryProvider();
  assert.strictEqual(inMemoryProvider.kind, 'IN_MEMORY');
  assert.strictEqual(inMemoryProvider.readiness, 'READY');

  const externalProvider = capability.createExternalProvider(true);
  assert.strictEqual(externalProvider.kind, 'EXTERNAL');
  assert.strictEqual(externalProvider.readiness, 'READY');

  const amount: capability.Money = { amount: 100, currency: 'USD' };
  const captureResult = inMemoryProvider.capturePayment('inv1', 'pm1', 'key1', amount);
  assert.ok(!('kind' in captureResult));
  assert.strictEqual(captureResult.status, 'succeeded');
  assert.ok(captureResult.chargeId !== undefined);

  const refundResult = inMemoryProvider.refundPayment('charge1', 'key1', amount);
  assert.ok(!('kind' in refundResult));
  assert.strictEqual(refundResult.status, 'succeeded');

  const subResult = inMemoryProvider.createSubscription('acc1', 'plan1', 'price1');
  assert.ok(!('kind' in subResult));
  assert.ok(subResult.subscriptionId !== undefined);

  const invoiceResult = inMemoryProvider.issueInvoice('sub1', amount);
  assert.ok(!('kind' in invoiceResult));
  assert.ok(invoiceResult.invoiceId !== undefined);

  const dunningResult = inMemoryProvider.performDunningStep('sub1', 'first_attempt');
  assert.ok(!('kind' in dunningResult));
  assert.strictEqual(dunningResult.success, true);
});

test("subscriptionsinvoicespaymentmethodsdunningerrormodel", () => {
  const externalProvider = capability.createExternalProvider(false);
  const amount: capability.Money = { amount: 100, currency: 'USD' };

  const result = externalProvider.capturePayment('inv1', 'pm1', 'key1', amount);
  assert.ok('kind' in result);
  assert.strictEqual(result.kind, 'PROVIDER_UNAVAILABLE');

  const inMemoryProvider = capability.createInMemoryProvider();
  const noKeyResult = inMemoryProvider.capturePayment('inv1', 'pm1', '', amount);
  assert.ok('kind' in noKeyResult);
  assert.strictEqual(noKeyResult.kind, 'IDEMPOTENCY_KEY_REQUIRED');

  const invalidAmountResult = inMemoryProvider.capturePayment('inv1', 'pm1', 'key1', { amount: -1, currency: 'USD' });
  assert.ok('kind' in invalidAmountResult);
  assert.strictEqual(invalidAmountResult.kind, 'INVALID_AMOUNT');

  const invalidCurrencyResult = inMemoryProvider.capturePayment('inv1', 'pm1', 'key1', { amount: 100, currency: 'US' });
  assert.ok('kind' in invalidCurrencyResult);
  assert.strictEqual(invalidCurrencyResult.kind, 'INVALID_CURRENCY');

  const state1 = capability.createAccount(capability.initialState, 'acc1', 'ext1', 'tenant1', 'token1');
  if ('accounts' in state1) {
    const state2 = capability.createSubscription(
      state1,
      'acc1',
      'plan1',
      'price1',
      'tenant1',
      'token1',
      inMemoryProvider,
      (e: capability.AuditEvent) => null
    );
    if ('subscriptions' in state2) {
      const state3 = capability.issueInvoice(
        state2,
        state2.subscriptions[0].id,
        amount,
        'tenant1',
        'token1',
        inMemoryProvider,
        (e: capability.AuditEvent) => null
      );
      if ('invoices' in state3) {
        const captureResult1 = capability.capturePayment(
          state3,
          state3.invoices[0].id,
          'pm1',
          'key1',
          'tenant1',
          'token1',
          inMemoryProvider,
          (e: capability.AuditEvent) => null
        );
        if ('charges' in captureResult1) {
          const captureResult2 = capability.capturePayment(
            state3,
            state3.invoices[0].id,
            'pm1',
            'key1',
            'tenant1',
            'token1',
            inMemoryProvider,
            (e: capability.AuditEvent) => null
          );
          if ('charges' in captureResult2) {
            assert.strictEqual(captureResult1.charges.length, captureResult2.charges.length);
          }
        }
      }
    }
  }
});

test("subscriptionsinvoicespaymentmethodsdunninglifecycle", () => {
  const state1 = capability.createAccount(capability.initialState, 'acc1', 'ext1', 'tenant1', 'token1');
  assert.ok('accounts' in state1);
  assert.strictEqual(state1.accounts.length, 1);

  const provider = capability.createInMemoryProvider();
  const state2 = capability.createSubscription(
    state1,
    'acc1',
    'plan1',
    'price1',
    'tenant1',
    'token1',
    provider,
    (e: capability.AuditEvent) => null
  );
  assert.ok('subscriptions' in state2);
  assert.strictEqual(state2.subscriptions.length, 1);

  const amount: capability.Money = { amount: 100, currency: 'USD' };
  const state3 = capability.issueInvoice(
    state2,
    state2.subscriptions[0].id,
    amount,
    'tenant1',
    'token1',
    provider,
    (e: capability.AuditEvent) => null
  );
  assert.ok('invoices' in state3);
  assert.strictEqual(state3.invoices.length, 1);

  const state4 = capability.capturePayment(
    state3,
    state3.invoices[0].id,
    'pm1',
    'key1',
    'tenant1',
    'token1',
    provider,
    (e: capability.AuditEvent) => null
  );
  assert.ok('charges' in state4);
  assert.strictEqual(state4.charges.length, 1);
  assert.strictEqual(state4.invoices[0].status, 'paid');

  const state5 = capability.refundPayment(
    state4,
    state4.charges[0].idempotencyKey,
    'refund_key1',
    amount,
    'tenant1',
    'token1',
    provider,
    (e: capability.AuditEvent) => null
  );
  assert.ok('refunds' in state5);
  assert.strictEqual(state5.refunds.length, 1);

  const state6 = capability.performDunningStep(
    state5,
    state5.subscriptions[0].id,
    'first_attempt',
    'tenant1',
    'token1',
    provider,
    (e: capability.AuditEvent) => null
  );
  assert.ok('dunningRecords' in state6);
  assert.strictEqual(state6.dunningRecords.length, 1);
});

test("subscriptionsinvoicespaymentmethodsdunningpermissions", () => {
  const state1 = capability.createAccount(capability.initialState, 'acc1', 'ext1', 'tenant1', 'token1');
  if ('accounts' in state1) {
    const account = capability.getAccount(state1, 'acc1', 'tenant1');
    assert.ok(!('kind' in account));
    assert.strictEqual(account.id, 'acc1');

    const crossTenantResult = capability.getAccount(state1, 'acc1', 'tenant2');
    assert.ok('kind' in crossTenantResult);
    assert.strictEqual(crossTenantResult.kind, 'TENANT_ACCESS_DENIED');

    const accessError = capability.checkTenantAccess(state1, 'tenant1', 'tenant1');
    assert.strictEqual(accessError, null);

    const crossAccessError = capability.checkTenantAccess(state1, 'tenant1', 'tenant2');
    assert.ok(crossAccessError !== null);
    assert.strictEqual(crossAccessError.kind, 'TENANT_ACCESS_DENIED');

    const noTokenResult = capability.createAccount(state1, 'acc2', 'ext2', 'tenant1', '');
    assert.ok('kind' in noTokenResult);
    assert.strictEqual(noTokenResult.kind, 'TENANT_ACCESS_DENIED');
  }
});

test("subscriptionsinvoicespaymentmethodsdunningproof", () => {
  const provider = capability.createInMemoryProvider();
  const amount: capability.Money = { amount: 50, currency: 'EUR' };

  let state = capability.createAccount(capability.initialState, 'acc1', 'ext1', 'tenant1', 'token1');
  if ('accounts' in state) {
    state = capability.createSubscription(
      state,
      'acc1',
      'plan1',
      'price1',
      'tenant1',
      'token1',
      provider,
      (e: capability.AuditEvent) => null
    );
    if ('subscriptions' in state) {
      state = capability.issueInvoice(
        state,
        state.subscriptions[0].id,
        amount,
        'tenant1',
        'token1',
        provider,
        (e: capability.AuditEvent) => null
      );
      if ('invoices' in state) {
        state = capability.capturePayment(
          state,
          state.invoices[0].id,
          'pm1',
          'key1',
          'tenant1',
          'token1',
          provider,
          (e: capability.AuditEvent) => null
        );
        if ('charges' in state) {
          assert.strictEqual(state.charges.length, 1);
          const firstChargeCount = state.charges.length;

          const state2 = capability.capturePayment(
            state,
            state.invoices[0].id,
            'pm1',
            'key1',
            'tenant1',
            'token1',
            provider,
            (e: capability.AuditEvent) => null
          );
          if ('charges' in state2) {
            assert.strictEqual(state2.charges.length, firstChargeCount);
          }
        }
      }
    }
  }
});

test("subscriptionsinvoicespaymentmethodsdunningreadinessmodel", () => {
  const inMemoryProvider = capability.createInMemoryProvider();
  assert.strictEqual(inMemoryProvider.readiness, 'READY');

  const externalReadyProvider = capability.createExternalProvider(true);
  assert.strictEqual(externalReadyProvider.readiness, 'READY');

  const externalDegradedProvider = capability.createExternalProvider(false);
  assert.strictEqual(externalDegradedProvider.readiness, 'DEGRADED');

  const readinessError = capability.checkReadiness(externalDegradedProvider, true);
  assert.ok(readinessError !== null);
  assert.strictEqual(readinessError.kind, 'PROVIDER_READINESS_DEGRADED');

  assert.strictEqual(capability.checkProviderReadiness(inMemoryProvider), 'READY');
  assert.strictEqual(capability.checkProviderReadiness(externalDegradedProvider), 'DEGRADED');

  const state1 = capability.setReadiness(capability.initialState, 'DEGRADED');
  assert.strictEqual(state1.readiness, 'DEGRADED');
  assert.ok(state1.lastError !== null);
  assert.strictEqual(state1.lastError?.kind, 'PROVIDER_READINESS_DEGRADED');
});

test("subscriptionsinvoicespaymentmethodsdunningstatemodel", () => {
  const state1 = capability.createAccount(capability.initialState, 'acc1', 'ext1', 'tenant1', 'token1');
  assert.ok('accounts' in state1);
  assert.strictEqual(state1.accounts.length, 1);
  assert.strictEqual(state1.accounts[0].externalAccountId, 'ext1');

  const provider = capability.createInMemoryProvider();
  const state2 = capability.createSubscription(
    state1,
    'acc1',
    'plan_pro',
    'price_monthly',
    'tenant1',
    'token1',
    provider,
    (e: capability.AuditEvent) => null
  );
  assert.ok('subscriptions' in state2);
  assert.strictEqual(state2.subscriptions[0].planId, 'plan_pro');
  assert.strictEqual(state2.subscriptions[0].priceId, 'price_monthly');
  assert.strictEqual(state2.subscriptions[0].status, 'active');

  const amount: capability.Money = { amount: 999.99, currency: 'USD' };
  const state3 = capability.issueInvoice(
    state2,
    state2.subscriptions[0].id,
    amount,
    'tenant1',
    'token1',
    provider,
    (e: capability.AuditEvent) => null
  );
  assert.ok('invoices' in state3);
  assert.strictEqual(state3.invoices[0].openAmount.amount, 999.99);
  assert.strictEqual(state3.invoices[0].openAmount.currency, 'USD');
  assert.strictEqual(state3.invoices[0].status, 'open');
});

test("subscriptionsinvoicespaymentmethodsdunningvalidation", () => {
  const amountError = capability.validateAmount(-10);
  assert.ok(amountError !== null);
  assert.strictEqual(amountError.kind, 'INVALID_AMOUNT');

  const amountValid = capability.validateAmount(10);
  assert.strictEqual(amountValid, null);

  const currencyError = capability.validateCurrency('US');
  assert.ok(currencyError !== null);
  assert.strictEqual(currencyError.kind, 'INVALID_CURRENCY');

  const currencyValid = capability.validateCurrency('USD');
  assert.strictEqual(currencyValid, null);

  const statusError = capability.validateSubscriptionStatus('invalid_status');
  assert.ok(statusError !== null);
  assert.strictEqual(statusError.kind, 'INVALID_STATUS');

  const statusValid = capability.validateSubscriptionStatus('active');
  assert.strictEqual(statusValid, null);

  const invoiceStatusError = capability.validateInvoiceStatus('pending');
  assert.ok(invoiceStatusError !== null);
  assert.strictEqual(invoiceStatusError.kind, 'INVALID_STATUS');

  const invoiceStatusValid = capability.validateInvoiceStatus('open');
  assert.strictEqual(invoiceStatusValid, null);

  const keyError = capability.validateIdempotencyKey('');
  assert.ok(keyError !== null);
  assert.strictEqual(keyError.kind, 'IDEMPOTENCY_KEY_REQUIRED');

  const keyValid = capability.validateIdempotencyKey('valid-key-123');
  assert.strictEqual(keyValid, null);
});