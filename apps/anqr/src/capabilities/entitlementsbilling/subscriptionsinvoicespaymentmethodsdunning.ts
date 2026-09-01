// Billing capability module for subscriptions, invoices, payment methods, and dunning
// Domain: entitlements billing

// === Constants and Types ===

export const BillingProviderKind = ['IN_MEMORY', 'EXTERNAL'] as const;
export type BillingProviderKind = typeof BillingProviderKind[number];

export const SubscriptionStatus = ['active', 'paused', 'cancelled'] as const;
export type SubscriptionStatus = typeof SubscriptionStatus[number];

export const InvoiceStatus = ['open', 'paid', 'uncollectible', 'void'] as const;
export type InvoiceStatus = typeof InvoiceStatus[number];

export const ChargeStatus = ['succeeded', 'failed', 'pending'] as const;
export type ChargeStatus = typeof ChargeStatus[number];

export const RefundStatus = ['succeeded', 'failed', 'pending'] as const;
export type RefundStatus = typeof RefundStatus[number];

export const DunningStep = ['first_attempt', 'second_attempt', 'final_notice', 'cancel_subscription'] as const;
export type DunningStep = typeof DunningStep[number];

export const BillingReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type BillingReadiness = typeof BillingReadiness[number];

export const BillingErrorKind = [
  'PROVIDER_UNAVAILABLE',
  'INVALID_AMOUNT',
  'INVALID_CURRENCY',
  'INVALID_STATUS',
  'IDEMPOTENCY_KEY_REQUIRED',
  'DUPLICATE_IDEMPOTENCY_KEY',
  'CAPTURE_FAILED',
  'REFUND_FAILED',
  'SUBSCRIPTION_NOT_FOUND',
  'INVOICE_NOT_FOUND',
  'PAYMENT_METHOD_NOT_FOUND',
  'TENANT_ACCESS_DENIED',
  'AUDIT_FAILURE',
  'READINESS_CHECK_FAILED',
  'PROVIDER_READINESS_DEGRADED'
] as const;
export type BillingErrorKind = typeof BillingErrorKind[number];

export const AuditEventKind = [
  'CAPTURE_ATTEMPT',
  'CAPTURE_SUCCEEDED',
  'REFUND_ATTEMPT',
  'REFUND_SUCCEEDED',
  'SUBSCRIPTION_TRANSITION',
  'DUNNING_STEP',
  'INVOICE_ISSUED',
  'PAYMENT_METHOD_UPDATED'
] as const;
export type AuditEventKind = typeof AuditEventKind[number];

// === DTOs ===

export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly timestamp: string;
  readonly tenantId: string;
  readonly metadata: Record<string, string | number | boolean>;
}

export interface BillingError {
  readonly kind: BillingErrorKind;
  readonly message: string;
}

export interface Account {
  readonly id: string;
  readonly tenantId: string;
  readonly externalAccountId: string;
}

export interface Subscription {
  readonly id: string;
  readonly accountId: string;
  readonly tenantId: string;
  readonly status: SubscriptionStatus;
  readonly planId: string;
  readonly priceId: string;
}

export interface Invoice {
  readonly id: string;
  readonly subscriptionId: string;
  readonly tenantId: string;
  readonly status: InvoiceStatus;
  readonly openAmount: Money;
}

export interface Charge {
  readonly idempotencyKey: string;
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly status: ChargeStatus;
  readonly amount: Money;
}

export interface Refund {
  readonly idempotencyKey: string;
  readonly chargeIdempotencyKey: string;
  readonly tenantId: string;
  readonly status: RefundStatus;
  readonly amount: Money;
}

export interface DunningRecord {
  readonly subscriptionId: string;
  readonly tenantId: string;
  readonly step: DunningStep;
  readonly timestamp: string;
}

// === State ===

export interface BillingState {
  readonly accounts: readonly Account[];
  readonly subscriptions: readonly Subscription[];
  readonly invoices: readonly Invoice[];
  readonly charges: readonly Charge[];
  readonly refunds: readonly Refund[];
  readonly dunningRecords: readonly DunningRecord[];
  readonly auditLedger: readonly AuditEvent[];
  readonly readiness: BillingReadiness;
  readonly lastError: BillingError | null;
}

export const initialState: BillingState = {
  accounts: [],
  subscriptions: [],
  invoices: [],
  charges: [],
  refunds: [],
  dunningRecords: [],
  auditLedger: [],
  readiness: 'READY',
  lastError: null,
};

// === Billing Provider Port ===

export interface BillingProvider {
  readonly kind: BillingProviderKind;
  readonly readiness: BillingReadiness;

  capturePayment(
    invoiceId: string,
    paymentMethodId: string,
    idempotencyKey: string,
    amount: Money
  ): { readonly status: ChargeStatus; readonly chargeId?: string } | BillingError;

  refundPayment(
    chargeId: string,
    idempotencyKey: string,
    amount: Money
  ): { readonly status: RefundStatus; readonly refundId?: string } | BillingError;

  createSubscription(
    accountId: string,
    planId: string,
    priceId: string
  ): { readonly subscriptionId: string } | BillingError;

  issueInvoice(
    subscriptionId: string,
    amount: Money
  ): { readonly invoiceId: string } | BillingError;

  performDunningStep(
    subscriptionId: string,
    step: DunningStep
  ): { readonly success: boolean } | BillingError;
}

// === In-Memory Provider ===

export function createInMemoryProvider(): BillingProvider {
  return {
    kind: 'IN_MEMORY',
    readiness: 'READY',

    capturePayment(invoiceId, paymentMethodId, idempotencyKey, amount) {
      if (!idempotencyKey) {
        return { kind: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key required' };
      }
      if (amount.amount <= 0) {
        return { kind: 'INVALID_AMOUNT', message: 'Amount must be positive' };
      }
      if (!amount.currency || amount.currency.length !== 3) {
        return { kind: 'INVALID_CURRENCY', message: 'Invalid currency' };
      }
      return { status: 'succeeded', chargeId: `charge_${idempotencyKey}` };
    },

    refundPayment(chargeId, idempotencyKey, amount) {
      if (!idempotencyKey) {
        return { kind: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key required' };
      }
      if (amount.amount <= 0) {
        return { kind: 'INVALID_AMOUNT', message: 'Amount must be positive' };
      }
      return { status: 'succeeded', refundId: `refund_${idempotencyKey}` };
    },

    createSubscription(accountId, planId, priceId) {
      if (!accountId || !planId || !priceId) {
        return { kind: 'INVALID_STATUS', message: 'Missing required fields' };
      }
      return { subscriptionId: `sub_${accountId}_${planId}` };
    },

    issueInvoice(subscriptionId, amount) {
      if (!subscriptionId) {
        return { kind: 'INVALID_STATUS', message: 'Subscription ID required' };
      }
      if (amount.amount <= 0) {
        return { kind: 'INVALID_AMOUNT', message: 'Amount must be positive' };
      }
      return { invoiceId: `inv_${subscriptionId}_${amount.amount}` };
    },

    performDunningStep(subscriptionId, step) {
      if (!subscriptionId || !step) {
        return { kind: 'INVALID_STATUS', message: 'Missing required fields' };
      }
      return { success: true };
    }
  };
}

// === External Provider (simulated) ===

export function createExternalProvider(available: boolean): BillingProvider {
  return {
    kind: 'EXTERNAL',
    readiness: available ? 'READY' : 'DEGRADED',

    capturePayment(invoiceId, paymentMethodId, idempotencyKey, amount) {
      if (!available) {
        return { kind: 'PROVIDER_UNAVAILABLE', message: 'External provider unavailable' };
      }
      if (!idempotencyKey) {
        return { kind: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key required' };
      }
      return { status: 'succeeded', chargeId: `ext_charge_${idempotencyKey}` };
    },

    refundPayment(chargeId, idempotencyKey, amount) {
      if (!available) {
        return { kind: 'PROVIDER_UNAVAILABLE', message: 'External provider unavailable' };
      }
      if (!idempotencyKey) {
        return { kind: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key required' };
      }
      return { status: 'succeeded', refundId: `ext_refund_${idempotencyKey}` };
    },

    createSubscription(accountId, planId, priceId) {
      if (!available) {
        return { kind: 'PROVIDER_UNAVAILABLE', message: 'External provider unavailable' };
      }
      return { subscriptionId: `ext_sub_${accountId}` };
    },

    issueInvoice(subscriptionId, amount) {
      if (!available) {
        return { kind: 'PROVIDER_UNAVAILABLE', message: 'External provider unavailable' };
      }
      return { invoiceId: `ext_inv_${subscriptionId}` };
    },

    performDunningStep(subscriptionId, step) {
      if (!available) {
        return { kind: 'PROVIDER_UNAVAILABLE', message: 'External provider unavailable' };
      }
      return { success: true };
    }
  };
}

// === Audit Functions ===

export function recordAuditEvent(
  state: BillingState,
  event: AuditEvent
): BillingState {
  return {
    ...state,
    auditLedger: [...state.auditLedger, event]
  };
}

export function auditFinancialAction(
  kind: AuditEventKind,
  tenantId: string,
  metadata: Record<string, string | number | boolean>,
  auditFn: (event: AuditEvent) => BillingError | null
): BillingError | null {
  const event: AuditEvent = {
    kind,
    timestamp: new Date().toISOString(),
    tenantId,
    metadata: { ...metadata }
  };
  return auditFn(event);
}

// === Validation Functions ===

export function validateAmount(amount: number): BillingError | null {
  if (typeof amount !== 'number' || amount <= 0) {
    return { kind: 'INVALID_AMOUNT', message: 'Amount must be a positive number' };
  }
  return null;
}

export function validateCurrency(currency: string): BillingError | null {
  if (typeof currency !== 'string' || currency.length !== 3) {
    return { kind: 'INVALID_CURRENCY', message: 'Currency must be 3-letter code' };
  }
  return null;
}

export function validateSubscriptionStatus(status: string): BillingError | null {
  if (!SubscriptionStatus.includes(status as SubscriptionStatus)) {
    return { kind: 'INVALID_STATUS', message: 'Invalid subscription status' };
  }
  return null;
}

export function validateInvoiceStatus(status: string): BillingError | null {
  if (!InvoiceStatus.includes(status as InvoiceStatus)) {
    return { kind: 'INVALID_STATUS', message: 'Invalid invoice status' };
  }
  return null;
}

export function validateIdempotencyKey(key: string | undefined): BillingError | null {
  if (!key || typeof key !== 'string') {
    return { kind: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key is required' };
  }
  return null;
}

// === Permission Functions ===

export function checkTenantAccess(
  state: BillingState,
  tenantId: string,
  resourceTenantId: string
): BillingError | null {
  if (tenantId !== resourceTenantId) {
    return { kind: 'TENANT_ACCESS_DENIED', message: 'Cross-tenant access denied' };
  }
  return null;
}

export function checkReadiness(
  provider: BillingProvider,
  requireMutation: boolean = false
): BillingError | null {
  if (provider.readiness === 'NOT_READY') {
    return { kind: 'PROVIDER_UNAVAILABLE', message: 'Provider not ready' };
  }
  if (requireMutation && provider.readiness === 'DEGRADED') {
    return { kind: 'PROVIDER_READINESS_DEGRADED', message: 'Mutations disabled in degraded mode' };
  }
  return null;
}

// === Core Operations ===

export function createAccount(
  state: BillingState,
  accountId: string,
  externalAccountId: string,
  tenantId: string,
  operatorToken: string
): BillingState | BillingError {
  // Authorization check
  if (!operatorToken) {
    return { kind: 'TENANT_ACCESS_DENIED', message: 'Operator token required' };
  }

  const account: Account = { id: accountId, externalAccountId, tenantId };
  return {
    ...state,
    accounts: [...state.accounts, account]
  };
}

export function createSubscription(
  state: BillingState,
  accountId: string,
  planId: string,
  priceId: string,
  tenantId: string,
  operatorToken: string,
  provider: BillingProvider,
  auditFn: (event: AuditEvent) => BillingError | null
): BillingState | BillingError {
  // Authorization check
  if (!operatorToken) {
    return { kind: 'TENANT_ACCESS_DENIED', message: 'Operator token required' };
  }

  // Readiness check for mutation
  const readinessError = checkReadiness(provider, true);
  if (readinessError) return readinessError;

  // Audit before mutation
  const auditError = auditFinancialAction(
    'SUBSCRIPTION_TRANSITION',
    tenantId,
    { accountId, planId, priceId, action: 'create' },
    auditFn
  );
  if (auditError) return auditError;

  // Provider call
  const result = provider.createSubscription(accountId, planId, priceId);
  if ('kind' in result) return result;

  const subscription: Subscription = {
    id: result.subscriptionId,
    accountId,
    tenantId,
    status: 'active',
    planId,
    priceId
  };

  return {
    ...state,
    subscriptions: [...state.subscriptions, subscription]
  };
}

export function issueInvoice(
  state: BillingState,
  subscriptionId: string,
  amount: Money,
  tenantId: string,
  operatorToken: string,
  provider: BillingProvider,
  auditFn: (event: AuditEvent) => BillingError | null
): BillingState | BillingError {
  // Authorization check
  if (!operatorToken) {
    return { kind: 'TENANT_ACCESS_DENIED', message: 'Operator token required' };
  }

  // Find subscription and check tenant access
  const subscription = state.subscriptions.find(s => s.id === subscriptionId);
  if (!subscription) {
    return { kind: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' };
  }

  const accessError = checkTenantAccess(state, tenantId, subscription.tenantId);
  if (accessError) return accessError;

  // Readiness check for mutation
  const readinessError = checkReadiness(provider, true);
  if (readinessError) return readinessError;

  // Validate amount
  const amountError = validateAmount(amount.amount);
  if (amountError) return amountError;
  const currencyError = validateCurrency(amount.currency);
  if (currencyError) return currencyError;

  // Audit before mutation
  const auditError = auditFinancialAction(
    'INVOICE_ISSUED',
    tenantId,
    { subscriptionId, amount: amount.amount, currency: amount.currency },
    auditFn
  );
  if (auditError) return auditError;

  // Provider call
  const result = provider.issueInvoice(subscriptionId, amount);
  if ('kind' in result) return result;

  const invoice: Invoice = {
    id: result.invoiceId,
    subscriptionId,
    tenantId,
    status: 'open',
    openAmount: amount
  };

  return {
    ...state,
    invoices: [...state.invoices, invoice]
  };
}

export function capturePayment(
  state: BillingState,
  invoiceId: string,
  paymentMethodId: string,
  idempotencyKey: string,
  tenantId: string,
  operatorToken: string,
  provider: BillingProvider,
  auditFn: (event: AuditEvent) => BillingError | null
): BillingState | BillingError {
  // Authorization check
  if (!operatorToken) {
    return { kind: 'TENANT_ACCESS_DENIED', message: 'Operator token required' };
  }

  // Find invoice and check tenant access
  const invoice = state.invoices.find(i => i.id === invoiceId);
  if (!invoice) {
    return { kind: 'INVOICE_NOT_FOUND', message: 'Invoice not found' };
  }

  const accessError = checkTenantAccess(state, tenantId, invoice.tenantId);
  if (accessError) return accessError;

  // Readiness check for mutation
  const readinessError = checkReadiness(provider, true);
  if (readinessError) return readinessError;

  // Validate idempotency key
  const idempotencyError = validateIdempotencyKey(idempotencyKey);
  if (idempotencyError) return idempotencyError;

  // Check for duplicate idempotency key
  const existingCharge = state.charges.find(c => c.idempotencyKey === idempotencyKey);
  if (existingCharge) {
    // Return existing outcome (idempotent)
    return state;
  }

  // Audit before mutation
  const auditError = auditFinancialAction(
    'CAPTURE_ATTEMPT',
    tenantId,
    { invoiceId, paymentMethodId, idempotencyKey, amount: invoice.openAmount.amount, currency: invoice.openAmount.currency },
    auditFn
  );
  if (auditError) return auditError;

  // Provider call
  const result = provider.capturePayment(invoiceId, paymentMethodId, idempotencyKey, invoice.openAmount);
  if ('kind' in result) return result;

  const charge: Charge = {
    idempotencyKey,
    invoiceId,
    tenantId,
    status: result.status,
    amount: invoice.openAmount
  };

  let newState: BillingState = {
    ...state,
    charges: [...state.charges, charge]
  };

  // Update invoice status if capture succeeded
  if (result.status === 'succeeded') {
    newState = {
      ...newState,
      invoices: newState.invoices.map(inv =>
        inv.id === invoiceId
          ? { ...inv, status: 'paid', openAmount: { amount: 0, currency: inv.openAmount.currency } }
          : inv
      )
    };

    // Audit successful capture
    const successAuditError = auditFinancialAction(
      'CAPTURE_SUCCEEDED',
      tenantId,
      { chargeId: result.chargeId ?? '', idempotencyKey },
      auditFn
    );
    if (successAuditError) return successAuditError;
  }

  return newState;
}

export function refundPayment(
  state: BillingState,
  chargeIdempotencyKey: string,
  refundIdempotencyKey: string,
  amount: Money,
  tenantId: string,
  operatorToken: string,
  provider: BillingProvider,
  auditFn: (event: AuditEvent) => BillingError | null
): BillingState | BillingError {
  // Authorization check
  if (!operatorToken) {
    return { kind: 'TENANT_ACCESS_DENIED', message: 'Operator token required' };
  }

  // Find charge and check tenant access
  const charge = state.charges.find(c => c.idempotencyKey === chargeIdempotencyKey);
  if (!charge) {
    return { kind: 'CAPTURE_FAILED', message: 'Charge not found' };
  }

  const accessError = checkTenantAccess(state, tenantId, charge.tenantId);
  if (accessError) return accessError;

  // Readiness check for mutation
  const readinessError = checkReadiness(provider, true);
  if (readinessError) return readinessError;

  // Validate idempotency key
  const idempotencyError = validateIdempotencyKey(refundIdempotencyKey);
  if (idempotencyError) return idempotencyError;

  // Check for duplicate refund idempotency key
  const existingRefund = state.refunds.find(r => r.idempotencyKey === refundIdempotencyKey);
  if (existingRefund) {
    return state; // Idempotent
  }

  // Audit before mutation
  const auditError = auditFinancialAction(
    'REFUND_ATTEMPT',
    tenantId,
    { chargeIdempotencyKey, refundIdempotencyKey, amount: amount.amount, currency: amount.currency },
    auditFn
  );
  if (auditError) return auditError;

  // Provider call
  const result = provider.refundPayment(chargeIdempotencyKey, refundIdempotencyKey, amount);
  if ('kind' in result) return result;

  const refund: Refund = {
    idempotencyKey: refundIdempotencyKey,
    chargeIdempotencyKey,
    tenantId,
    status: result.status,
    amount
  };

  let newState: BillingState = {
    ...state,
    refunds: [...state.refunds, refund]
  };

  if (result.status === 'succeeded') {
    // Audit successful refund
    const successAuditError = auditFinancialAction(
      'REFUND_SUCCEEDED',
      tenantId,
      { refundId: result.refundId ?? '', idempotencyKey: refundIdempotencyKey },
      auditFn
    );
    if (successAuditError) return successAuditError;
  }

  return newState;
}

export function performDunningStep(
  state: BillingState,
  subscriptionId: string,
  step: DunningStep,
  tenantId: string,
  operatorToken: string,
  provider: BillingProvider,
  auditFn: (event: AuditEvent) => BillingError | null
): BillingState | BillingError {
  // Authorization check
  if (!operatorToken) {
    return { kind: 'TENANT_ACCESS_DENIED', message: 'Operator token required' };
  }

  // Find subscription and check tenant access
  const subscription = state.subscriptions.find(s => s.id === subscriptionId);
  if (!subscription) {
    return { kind: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' };
  }

  const accessError = checkTenantAccess(state, tenantId, subscription.tenantId);
  if (accessError) return accessError;

  // Readiness check for mutation
  const readinessError = checkReadiness(provider, true);
  if (readinessError) return readinessError;

  // Audit before mutation
  const auditError = auditFinancialAction(
    'DUNNING_STEP',
    tenantId,
    { subscriptionId, step },
    auditFn
  );
  if (auditError) return auditError;

  // Provider call
  const result = provider.performDunningStep(subscriptionId, step);
  if ('kind' in result) return result;

  const dunningRecord: DunningRecord = {
    subscriptionId,
    tenantId,
    step,
    timestamp: new Date().toISOString()
  };

  let newState: BillingState = {
    ...state,
    dunningRecords: [...state.dunningRecords, dunningRecord]
  };

  // Update subscription status based on dunning step
  if (step === 'cancel_subscription') {
    newState = {
      ...newState,
      subscriptions: newState.subscriptions.map(sub =>
        sub.id === subscriptionId
          ? { ...sub, status: 'cancelled' }
          : sub
      )
    };
  }

  return newState;
}

// === Read Operations ===

export function getAccount(
  state: BillingState,
  accountId: string,
  tenantId: string
): Account | BillingError {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) {
    return { kind: 'INVOICE_NOT_FOUND', message: 'Account not found' };
  }

  const accessError = checkTenantAccess(state, tenantId, account.tenantId);
  if (accessError) return accessError;

  return account;
}

export function getSubscription(
  state: BillingState,
  subscriptionId: string,
  tenantId: string
): Subscription | BillingError {
  const subscription = state.subscriptions.find(s => s.id === subscriptionId);
  if (!subscription) {
    return { kind: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' };
  }

  const accessError = checkTenantAccess(state, tenantId, subscription.tenantId);
  if (accessError) return accessError;

  return subscription;
}

export function getInvoice(
  state: BillingState,
  invoiceId: string,
  tenantId: string
): Invoice | BillingError {
  const invoice = state.invoices.find(i => i.id === invoiceId);
  if (!invoice) {
    return { kind: 'INVOICE_NOT_FOUND', message: 'Invoice not found' };
  }

  const accessError = checkTenantAccess(state, tenantId, invoice.tenantId);
  if (accessError) return accessError;

  return invoice;
}

// === Readiness Management ===

export function checkProviderReadiness(
  provider: BillingProvider
): BillingReadiness {
  return provider.readiness;
}

export function setReadiness(
  state: BillingState,
  readiness: BillingReadiness
): BillingState {
  return {
    ...state,
    readiness,
    lastError: readiness === 'DEGRADED'
      ? { kind: 'PROVIDER_READINESS_DEGRADED', message: 'Provider in degraded mode' }
      : null
  };
}