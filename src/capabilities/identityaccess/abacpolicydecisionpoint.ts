export const AbacPolicyDecisionPointDecision = [
  'GRANTED',
  'POLICY_DENIED',
  'INSUFFICIENT_AUTH_LEVEL',
  'SERVER_UNAVAILABLE',
  'RESOURCE_NOT_REGISTERED',
] as const;
export type AbacPolicyDecisionPointDecision = typeof AbacPolicyDecisionPointDecision[number];

export const AbacPolicyDecisionPointAuditEventKind = ['AUDIT_BEFORE_CHANGE'] as const;
export type AbacPolicyDecisionPointAuditEventKind = typeof AbacPolicyDecisionPointAuditEventKind[number];

export const AbacPolicyDecisionPointErrorKind = [
  'AUDIT_FAILURE',
  'AUTHENTICATION_REQUIRED',
  'STEP_UP_REQUIRED',
  'POLICY_DENIED',
] as const;
export type AbacPolicyDecisionPointErrorKind = typeof AbacPolicyDecisionPointErrorKind[number];

export const AbacPolicyDecisionPointReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type AbacPolicyDecisionPointReadiness = typeof AbacPolicyDecisionPointReadiness[number];

export interface AbacPolicyDecisionPointAuditEvent {
  readonly kind: AbacPolicyDecisionPointAuditEventKind;
  readonly resource: string;
  readonly policy: unknown;
  readonly timestamp: string;
}

export interface AbacPolicyDecisionPointError {
  readonly kind: AbacPolicyDecisionPointErrorKind;
  readonly message: string;
}

export interface AbacPolicyDecisionPointRouteGuard {
  readonly resource: string;
  readonly scope: string;
  readonly requiredPermission: string;
}

export interface AbacPolicyDecisionPointResourcePolicy {
  readonly resource: string;
  readonly policy: unknown;
}

export interface AbacPolicyDecisionPointState {
  readonly routeGuards: readonly AbacPolicyDecisionPointRouteGuard[];
  readonly resourcePolicies: readonly AbacPolicyDecisionPointResourcePolicy[];
  readonly lastDecision: AbacPolicyDecisionPointDecision | null;
  readonly lastError: AbacPolicyDecisionPointError | null;
  readonly readiness: AbacPolicyDecisionPointReadiness;
}

export const initialState: AbacPolicyDecisionPointState = {
  routeGuards: [],
  resourcePolicies: [],
  lastDecision: null,
  lastError: null,
  readiness: 'NOT_READY',
};

export function auditPolicyChange(
  resource: string,
  policy: unknown,
  auditFn: (event: AbacPolicyDecisionPointAuditEvent) => AbacPolicyDecisionPointError | null,
): AbacPolicyDecisionPointError | null {
  const event: AbacPolicyDecisionPointAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource,
    policy,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function replaceResourcePolicy(
  state: AbacPolicyDecisionPointState,
  resource: string,
  policy: unknown,
  auditFn: (event: AbacPolicyDecisionPointAuditEvent) => AbacPolicyDecisionPointError | null,
): AbacPolicyDecisionPointState | AbacPolicyDecisionPointError {
  const auditError = auditPolicyChange(resource, policy, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const existingIndex = state.resourcePolicies.findIndex(
    (rp) => rp.resource === resource,
  );
  const newResourcePolicies = [...state.resourcePolicies];
  if (existingIndex >= 0) {
    newResourcePolicies[existingIndex] = { resource, policy };
  } else {
    newResourcePolicies.push({ resource, policy });
  }

  return {
    ...state,
    resourcePolicies: newResourcePolicies,
    lastDecision: null,
    lastError: null,
    readiness: 'READY',
  };
}

export function evaluateRequest(
  state: AbacPolicyDecisionPointState,
  token: unknown,
  resource: string,
  scope: string,
  serverAvailable: boolean,
): {
  readonly decision: AbacPolicyDecisionPointDecision;
  readonly error: AbacPolicyDecisionPointError | null;
} {
  const routeGuard = state.routeGuards.find(
    (rg) => rg.resource === resource && rg.scope === scope,
  );

  if (token === null || typeof token !== 'object' || !('authLevel' in token)) {
    return {
      decision: 'RESOURCE_NOT_REGISTERED',
      error: { kind: 'AUTHENTICATION_REQUIRED', message: 'Missing expected token' },
    };
  }

  const tokenObj = token as { readonly authLevel: string };

  if (routeGuard === undefined) {
    return {
      decision: 'RESOURCE_NOT_REGISTERED',
      error: null,
    };
  }

  if (!serverAvailable) {
    return {
      decision: 'SERVER_UNAVAILABLE',
      error: null,
    };
  }

  if (tokenObj.authLevel !== routeGuard.requiredPermission) {
    return {
      decision: 'INSUFFICIENT_AUTH_LEVEL',
      error: { kind: 'STEP_UP_REQUIRED', message: 'Insufficient auth level' },
    };
  }

  const resourcePolicy = state.resourcePolicies.find(
    (rp) => rp.resource === resource,
  );

  if (resourcePolicy !== undefined) {
    return {
      decision: 'GRANTED',
      error: null,
    };
  }

  return {
    decision: 'POLICY_DENIED',
    error: { kind: 'POLICY_DENIED', message: 'Policy denied' },
  };
}

export function evaluateRequestWithFallback(
  state: AbacPolicyDecisionPointState,
  token: unknown,
  resource: string,
  scope: string,
  serverAvailable: boolean,
): {
  readonly decision: AbacPolicyDecisionPointDecision;
  readonly error: AbacPolicyDecisionPointError | null;
} {
  const directResult = evaluateRequest(state, token, resource, scope, serverAvailable);

  if (directResult.decision === 'GRANTED') {
    return directResult;
  }

  if (directResult.decision === 'INSUFFICIENT_AUTH_LEVEL') {
    return directResult;
  }

  const staticFallback = state.routeGuards.find(
    (rg) => rg.resource === resource && rg.scope === scope,
  );

  if (staticFallback !== undefined && staticFallback.requiredPermission === '') {
    return {
      decision: 'GRANTED',
      error: null,
    };
  }

  if (directResult.decision === 'SERVER_UNAVAILABLE' || directResult.decision === 'RESOURCE_NOT_REGISTERED') {
    return {
      ...directResult,
      decision: directResult.decision,
      error: directResult.error,
    };
  }

  return {
    decision: 'POLICY_DENIED',
    error: { kind: 'POLICY_DENIED', message: 'Fail-closed: No permission found' },
  };
}

export function evaluateLifecycle(
  state: AbacPolicyDecisionPointState,
  action: 'read' | 'write',
  resource: string,
  token: unknown,
  scope: string,
  serverAvailable: boolean,
): {
  readonly decision: AbacPolicyDecisionPointDecision;
  readonly error: AbacPolicyDecisionPointError | null;
} {
  if (action === 'read') {
    const resourcePolicy = state.resourcePolicies.find(
      (rp) => rp.resource === resource,
    );
    if (resourcePolicy !== undefined) {
      return {
        decision: 'GRANTED',
        error: null,
      };
    }
    return {
      decision: 'RESOURCE_NOT_REGISTERED',
      error: null,
    };
  }

  if (action === 'write') {
    if (token === null || typeof token !== 'object' || !('authLevel' in token)) {
      return {
        decision: 'POLICY_DENIED',
        error: { kind: 'AUTHENTICATION_REQUIRED', message: 'Missing expected token' },
      };
    }

    const tokenObj = token as { readonly authLevel: string };
    const routeGuard = state.routeGuards.find(
      (rg) => rg.resource === resource && rg.scope === scope,
    );

    if (routeGuard === undefined) {
      return {
        decision: 'RESOURCE_NOT_REGISTERED',
        error: null,
      };
    }

    if (tokenObj.authLevel !== routeGuard.requiredPermission) {
      return {
        decision: 'INSUFFICIENT_AUTH_LEVEL',
        error: { kind: 'STEP_UP_REQUIRED', message: 'Insufficient auth level' },
      };
    }

    if (!serverAvailable) {
      return {
        decision: 'SERVER_UNAVAILABLE',
        error: null,
      };
    }

    const resourcePolicy = state.resourcePolicies.find(
      (rp) => rp.resource === resource,
    );

    if (resourcePolicy !== undefined) {
      return {
        decision: 'GRANTED',
        error: null,
      };
    }

    return {
      decision: 'POLICY_DENIED',
      error: { kind: 'POLICY_DENIED', message: 'Policy denied' },
    };
  }

  return {
    decision: 'POLICY_DENIED',
    error: { kind: 'POLICY_DENIED', message: 'Unknown action' },
  };
}

export function computeReadiness(
  state: AbacPolicyDecisionPointState,
): AbacPolicyDecisionPointReadiness {
  if (state.readiness === 'READY') {
    return 'READY';
  }
  if (state.lastDecision === 'SERVER_UNAVAILABLE' || state.lastDecision === 'RESOURCE_NOT_REGISTERED') {
    return 'DEGRADED';
  }
  return 'NOT_READY';
}

export function validateResourcePolicy(
  resource: string,
  policy: unknown,
  staticPermission: string | null,
  routeGuards: readonly AbacPolicyDecisionPointRouteGuard[],
): AbacPolicyDecisionPointError | null {
  const matchingGuard = routeGuards.find((rg) => rg.resource === resource);
  if (matchingGuard === undefined) {
    return {
      kind: 'POLICY_DENIED',
      message: 'Resource not registered',
    };
  }

  if (staticPermission === null) {
    return {
      kind: 'POLICY_DENIED',
      message: 'Static permission not configured for resource',
    };
  }

  return null;
}

export function applyValidation(
  state: AbacPolicyDecisionPointState,
  resource: string,
  policy: unknown,
  staticPermission: string | null,
): AbacPolicyDecisionPointError | null {
  return validateResourcePolicy(resource, policy, staticPermission, state.routeGuards);
}