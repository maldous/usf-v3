export const WebhookDeliveryStatus = ['PENDING', 'DELIVERED', 'FAILED', 'DEAD'] as const;
export type WebhookDeliveryStatus = typeof WebhookDeliveryStatus[number];

export const WebhookReadinessState = ['NO_SUBSCRIPTIONS', 'CONFIGURED', 'HAS_DEAD_DELIVERIES'] as const;
export type WebhookReadinessState = typeof WebhookReadinessState[number];

export const WebhookErrorKind = [
  'NOT_FOUND',
  'UNAUTHORIZED',
  'NO_SUBSCRIPTIONS',
  'UNAVAILABLE',
  'AUDIT_FAILURE',
  'MAX_ATTEMPTS_REACHED'
] as const;
export type WebhookErrorKind = typeof WebhookErrorKind[number];

export const WebhookAuditEventKind = [
  'CREATE_SUBSCRIPTION',
  'ROTATE_SECRET',
  'REDRIVE_DELIVERY'
] as const;
export type WebhookAuditEventKind = typeof WebhookAuditEventKind[number];

export interface WebhookError {
  readonly _type: 'error';
  readonly kind: WebhookErrorKind;
  readonly message: string;
}

export interface WebhookSuccess<T> {
  readonly _type: 'success';
  readonly value: T;
}

export type WebhookResult<T> = WebhookSuccess<T> | WebhookError;

export interface WebhookSubscription {
  readonly identifier: string;
  readonly organizationId: string;
  readonly url: string;
  readonly eventTypes: readonly string[];
  readonly enabled: boolean;
  readonly secretHash: string;
}

export interface WebhookSubscriptionCreateResult {
  readonly subscription: WebhookSubscription;
  readonly revealOnceSecret: string;
}

export interface WebhookDelivery {
  readonly identifier: string;
  readonly organizationId: string;
  readonly subscriptionId: string;
  readonly eventType: string;
  readonly payload: string;
  readonly status: WebhookDeliveryStatus;
  readonly attemptCount: number;
  readonly nextAttemptTime: number;
  readonly lastStatus: number | null;
  readonly idempotencyKey: string;
}

export interface WebhookState {
  readonly subscriptions: readonly WebhookSubscription[];
  readonly deliveries: readonly WebhookDelivery[];
  readonly adapterAvailable: boolean;
  readonly workerAvailable: boolean;
}

export interface WebhookAuditMetadata {
  readonly kind: WebhookAuditEventKind;
  readonly organizationId: string;
  readonly targetIdentifier: string;
  readonly actor: string;
}

export interface WebhookActor {
  readonly organizationId: string;
  readonly actor: string;
  readonly hasTenantWebhooksPermission: boolean;
}

export function createSubscription(
  state: WebhookState,
  actor: WebhookActor,
  url: string,
  eventTypes: readonly string[],
  identifier: string,
  newSecretHash: string,
  revealOnceSecret: string,
  auditFn: (metadata: WebhookAuditMetadata) => WebhookResult<void>
): WebhookResult<{ readonly state: WebhookState; readonly result: WebhookSubscriptionCreateResult }> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const auditResult = auditFn({
    kind: 'CREATE_SUBSCRIPTION',
    organizationId: actor.organizationId,
    targetIdentifier: identifier,
    actor: actor.actor
  });
  if (auditResult._type === 'error') {
    return auditResult;
  }

  const subscription: WebhookSubscription = {
    identifier,
    organizationId: actor.organizationId,
    url,
    eventTypes,
    enabled: true,
    secretHash: newSecretHash
  };

  return {
    _type: 'success',
    value: {
      state: {
        ...state,
        subscriptions: [...state.subscriptions, subscription]
      },
      result: {
        subscription,
        revealOnceSecret
      }
    }
  };
}

export function rotateSecret(
  state: WebhookState,
  actor: WebhookActor,
  identifier: string,
  newSecretHash: string,
  revealOnceSecret: string,
  auditFn: (metadata: WebhookAuditMetadata) => WebhookResult<void>
): WebhookResult<{ readonly state: WebhookState; readonly revealOnceSecret: string }> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const subscription = state.subscriptions.find(s => s.identifier === identifier && s.organizationId === actor.organizationId);
  if (!subscription) {
    return { _type: 'error', kind: 'NOT_FOUND', message: 'Subscription not found' };
  }

  const auditResult = auditFn({
    kind: 'ROTATE_SECRET',
    organizationId: actor.organizationId,
    targetIdentifier: identifier,
    actor: actor.actor
  });
  if (auditResult._type === 'error') {
    return auditResult;
  }

  const updatedSubscription = { ...subscription, secretHash: newSecretHash };
  return {
    _type: 'success',
    value: {
      state: {
        ...state,
        subscriptions: state.subscriptions.map(s => s.identifier === identifier ? updatedSubscription : s)
      },
      revealOnceSecret
    }
  };
}

export function updateSubscription(
  state: WebhookState,
  actor: WebhookActor,
  identifier: string,
  eventTypes: readonly string[],
  enabled: boolean
): WebhookResult<WebhookState> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const subscription = state.subscriptions.find(s => s.identifier === identifier && s.organizationId === actor.organizationId);
  if (!subscription) {
    return { _type: 'error', kind: 'NOT_FOUND', message: 'Subscription not found' };
  }

  const updatedSubscription = { ...subscription, eventTypes, enabled };
  return {
    _type: 'success',
    value: {
      ...state,
      subscriptions: state.subscriptions.map(s => s.identifier === identifier ? updatedSubscription : s)
    }
  };
}

export function deleteSubscription(
  state: WebhookState,
  actor: WebhookActor,
  identifier: string
): WebhookResult<WebhookState> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const subscription = state.subscriptions.find(s => s.identifier === identifier && s.organizationId === actor.organizationId);
  if (!subscription) {
    return { _type: 'error', kind: 'NOT_FOUND', message: 'Subscription not found' };
  }

  return {
    _type: 'success',
    value: {
      ...state,
      subscriptions: state.subscriptions.filter(s => s.identifier !== identifier),
      deliveries: state.deliveries.filter(d => d.subscriptionId !== identifier)
    }
  };
}

export type RedactedSubscription = Omit<WebhookSubscription, 'secretHash'>;

export function listSubscriptions(
  state: WebhookState,
  actor: WebhookActor
): WebhookResult<readonly RedactedSubscription[]> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }

  const subscriptions = state.subscriptions
    .filter(s => s.organizationId === actor.organizationId)
    .map(({ secretHash, ...rest }) => rest);

  return { _type: 'success', value: subscriptions };
}

export function queryReadiness(
  state: WebhookState,
  actor: WebhookActor
): WebhookResult<WebhookReadinessState> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }

  const orgSubscriptions = state.subscriptions.filter(s => s.organizationId === actor.organizationId && s.enabled);
  if (orgSubscriptions.length === 0) {
    return { _type: 'success', value: 'NO_SUBSCRIPTIONS' };
  }

  const hasDeadDeliveries = state.deliveries.some(d => d.organizationId === actor.organizationId && d.status === 'DEAD');
  if (hasDeadDeliveries) {
    return { _type: 'success', value: 'HAS_DEAD_DELIVERIES' };
  }

  return { _type: 'success', value: 'CONFIGURED' };
}

export function fanOutEvent(
  state: WebhookState,
  eventType: string,
  payload: string,
  organizationId: string,
  idempotencyKey: string,
  currentTime: number,
  deliveryIdGenerator: () => string
): WebhookResult<WebhookState> {
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const enabledSubscriptions = state.subscriptions.filter(s => 
    s.organizationId === organizationId && 
    s.enabled && 
    s.eventTypes.includes(eventType)
  );

  if (enabledSubscriptions.length === 0) {
    return { _type: 'error', kind: 'NO_SUBSCRIPTIONS', message: 'No enabled subscriptions for event type' };
  }

  const newDeliveries: WebhookDelivery[] = enabledSubscriptions.map(sub => ({
    identifier: deliveryIdGenerator(),
    organizationId,
    subscriptionId: sub.identifier,
    eventType,
    payload,
    status: 'PENDING',
    attemptCount: 0,
    nextAttemptTime: currentTime,
    lastStatus: null,
    idempotencyKey
  }));

  return {
    _type: 'success',
    value: {
      ...state,
      deliveries: [...state.deliveries, ...newDeliveries]
    }
  };
}

export function processDeliveryResponse(
  state: WebhookState,
  deliveryId: string,
  statusCode: number,
  currentTime: number,
  maxAttempts: number,
  backoffMs: number
): WebhookState {
  const delivery = state.deliveries.find(d => d.identifier === deliveryId);
  if (!delivery) {
    return state;
  }

  let nextStatus: WebhookDeliveryStatus = 'PENDING';
  let nextAttemptTime = delivery.nextAttemptTime;
  const nextAttemptCount = delivery.attemptCount + 1;

  if (statusCode >= 200 && statusCode < 300) {
    nextStatus = 'DELIVERED';
  } else {
    if (nextAttemptCount >= maxAttempts) {
      nextStatus = 'DEAD';
    } else {
      nextStatus = 'FAILED';
      nextAttemptTime = currentTime + (backoffMs * Math.pow(2, nextAttemptCount - 1));
    }
  }

  const updatedDelivery: WebhookDelivery = {
    ...delivery,
    status: nextStatus,
    attemptCount: nextAttemptCount,
    nextAttemptTime,
    lastStatus: statusCode
  };

  return {
    ...state,
    deliveries: state.deliveries.map(d => d.identifier === deliveryId ? updatedDelivery : d)
  };
}

export function redriveDelivery(
  state: WebhookState,
  actor: WebhookActor,
  deliveryId: string,
  newIdempotencyKey: string,
  currentTime: number,
  auditFn: (metadata: WebhookAuditMetadata) => WebhookResult<void>
): WebhookResult<WebhookState> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const delivery = state.deliveries.find(d => d.identifier === deliveryId && d.organizationId === actor.organizationId);
  if (!delivery) {
    return { _type: 'error', kind: 'NOT_FOUND', message: 'Delivery not found' };
  }

  const auditResult = auditFn({
    kind: 'REDRIVE_DELIVERY',
    organizationId: actor.organizationId,
    targetIdentifier: deliveryId,
    actor: actor.actor
  });
  if (auditResult._type === 'error') {
    return auditResult;
  }

  const updatedDelivery: WebhookDelivery = {
    ...delivery,
    status: 'PENDING',
    attemptCount: 0,
    nextAttemptTime: currentTime,
    idempotencyKey: newIdempotencyKey
  };

  return {
    _type: 'success',
    value: {
      ...state,
      deliveries: state.deliveries.map(d => d.identifier === deliveryId ? updatedDelivery : d)
    }
  };
}

export function redriveAllDeadDeliveries(
  state: WebhookState,
  actor: WebhookActor,
  currentTime: number,
  idempotencyKeyGenerator: (delivery: WebhookDelivery) => string,
  auditFn: (metadata: WebhookAuditMetadata) => WebhookResult<void>
): WebhookResult<WebhookState> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const deadDeliveries = state.deliveries.filter(d => d.organizationId === actor.organizationId && d.status === 'DEAD');
  
  const auditResult = auditFn({
    kind: 'REDRIVE_DELIVERY',
    organizationId: actor.organizationId,
    targetIdentifier: 'ALL_DEAD',
    actor: actor.actor
  });
  if (auditResult._type === 'error') {
    return auditResult;
  }

  const updatedDeliveries = state.deliveries.map(d => {
    if (d.organizationId === actor.organizationId && d.status === 'DEAD') {
      return {
        ...d,
        status: 'PENDING' as WebhookDeliveryStatus,
        attemptCount: 0,
        nextAttemptTime: currentTime,
        idempotencyKey: idempotencyKeyGenerator(d)
      };
    }
    return d;
  });

  return {
    _type: 'success',
    value: {
      ...state,
      deliveries: updatedDeliveries
    }
  };
}

export interface WebhookMetrics {
  readonly pendingCount: number;
  readonly deliveredCount: number;
  readonly failedCount: number;
  readonly deadCount: number;
}

export function getDeliveryMetrics(
  state: WebhookState,
  actor: WebhookActor,
  subscriptionId: string
): WebhookResult<WebhookMetrics> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }

  const subscription = state.subscriptions.find(s => s.identifier === subscriptionId && s.organizationId === actor.organizationId);
  if (!subscription) {
    return { _type: 'error', kind: 'NOT_FOUND', message: 'Subscription not found' };
  }

  const deliveries = state.deliveries.filter(d => d.subscriptionId === subscriptionId && d.organizationId === actor.organizationId);
  
  return {
    _type: 'success',
    value: {
      pendingCount: deliveries.filter(d => d.status === 'PENDING').length,
      deliveredCount: deliveries.filter(d => d.status === 'DELIVERED').length,
      failedCount: deliveries.filter(d => d.status === 'FAILED').length,
      deadCount: deliveries.filter(d => d.status === 'DEAD').length
    }
  };
}

export function listDeliveries(
  state: WebhookState,
  actor: WebhookActor,
  subscriptionId: string
): WebhookResult<readonly WebhookDelivery[]> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }

  const subscription = state.subscriptions.find(s => s.identifier === subscriptionId && s.organizationId === actor.organizationId);
  if (!subscription) {
    return { _type: 'error', kind: 'NOT_FOUND', message: 'Subscription not found' };
  }

  const deliveries = state.deliveries.filter(d => d.subscriptionId === subscriptionId && d.organizationId === actor.organizationId);
  return { _type: 'success', value: deliveries };
}

export interface TestDeliveryRequest {
  readonly subscriptionId: string;
  readonly payload: string;
}

export function testDelivery(
  state: WebhookState,
  actor: WebhookActor,
  request: TestDeliveryRequest,
  deliveryIdGenerator: () => string,
  currentTime: number
): WebhookResult<{ readonly state: WebhookState; readonly delivery: WebhookDelivery }> {
  if (!actor.hasTenantWebhooksPermission) {
    return { _type: 'error', kind: 'UNAUTHORIZED', message: 'Missing tenant webhooks permission' };
  }
  if (!state.adapterAvailable || !state.workerAvailable) {
    return { _type: 'error', kind: 'UNAVAILABLE', message: 'Webhook adapter or worker unavailable' };
  }

  const subscription = state.subscriptions.find(s => s.identifier === request.subscriptionId && s.organizationId === actor.organizationId);
  if (!subscription) {
    return { _type: 'error', kind: 'NOT_FOUND', message: 'Subscription not found' };
  }

  const delivery: WebhookDelivery = {
    identifier: deliveryIdGenerator(),
    organizationId: actor.organizationId,
    subscriptionId: subscription.identifier,
    eventType: 'test',
    payload: request.payload,
    status: 'PENDING',
    attemptCount: 0,
    nextAttemptTime: currentTime,
    lastStatus: null,
    idempotencyKey: 'test-' + deliveryIdGenerator()
  };

  return {
    _type: 'success',
    value: {
      state: {
        ...state,
        deliveries: [...state.deliveries, delivery]
      },
      delivery
    }
  };
}