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
  readonly statusCode: number;
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

export interface AbacPolicyDecisionPointEvaluationResult {
  readonly decision: AbacPolicyDecisionPointDecision;
  readonly error: AbacPolicyDecisionPointError | null;
}

export const initialState: AbacPolicyDecisionPointState = {
  routeGuards: [],
  resourcePolicies: [],
  lastDecision: null,
  lastError: null,
  readiness: 'READY',
};

function matchesResource(pattern: string, target: string): boolean {
  if (pattern === '*' || pattern === target) {
    return true;
  }
  if (pattern.endsWith('*')) {
    return target.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function extractTokenAuth(token: unknown): { readonly valid: boolean; readonly authLevel: string; readonly permissions: readonly string[] } {
  if (token === null || typeof token !== 'object') {
    return { valid: false, authLevel: '', permissions: [] };
  }
  const tokenRecord = token as Record<string, unknown>;
  const authLevel = typeof tokenRecord.authLevel === 'string' ? tokenRecord.authLevel : '';
  const permissions: string[] = [];
  if (Array.isArray(tokenRecord.permissions)) {
    for (const p of tokenRecord.permissions) {
      if (typeof p === 'string') {
        permissions.push(p);
      }
    }
  }
  if (authLevel !== '') {
    permissions.push(authLevel);
  }
  return {
    valid: 'authLevel' in tokenRecord || 'permissions' in tokenRecord,
    authLevel,
    permissions,
  };
}

export function mapErrorToStatusCode(error: AbacPolicyDecisionPointError): number {
  switch (error.kind) {
    case 'AUTHENTICATION_REQUIRED':
    case 'STEP_UP_REQUIRED':
      return 401;
    case 'POLICY_DENIED':
    case 'AUDIT_FAILURE':
    default:
      return 403;
  }
}

export function mapDecisionToStatusCode(decision: AbacPolicyDecisionPointDecision): number {
  switch (decision) {
    case 'GRANTED':
      return 200;
    case 'INSUFFICIENT_AUTH_LEVEL':
      return 401;
    case 'POLICY_DENIED':
      return 403;
    case 'SERVER_UNAVAILABLE':
    case 'RESOURCE_NOT_REGISTERED':
      return 503;
    default:
      return 403;
  }
}

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
  try {
    const result = auditFn(event);
    if (result !== null) {
      return {
        kind: result.kind ?? 'AUDIT_FAILURE',
        message: result.message ?? 'Audit failure',
        statusCode: result.statusCode ?? 403,
      };
    }
    return null;
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit failed',
      statusCode: 403,
    };
  }
}

export function readResourcePolicy(
  state: AbacPolicyDecisionPointState,
  resource: string,
): AbacPolicyDecisionPointResourcePolicy | null {
  const policy = state.resourcePolicies.find((rp) => matchesResource(rp.resource, resource));
  return policy ?? null;
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

  const existingIndex = state.resourcePolicies.findIndex((rp) => rp.resource === resource);
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
): AbacPolicyDecisionPointEvaluationResult {
  const routeGuard = state.routeGuards.find(
    (rg) => matchesResource(rg.resource, resource) && (rg.scope === scope || rg.scope === '*'),
  );

  if (!serverAvailable) {
    return {
      decision: 'SERVER_UNAVAILABLE',
      error: null,
    };
  }

  if (token === null || typeof token !== 'object') {
    return {
      decision: 'INSUFFICIENT_AUTH_LEVEL',
      error: { kind: 'AUTHENTICATION_REQUIRED', message: 'Missing expected token', statusCode: 401 },
    };
  }

  const parsedToken = extractTokenAuth(token);
  if (!parsedToken.valid) {
    return {
      decision: 'INSUFFICIENT_AUTH_LEVEL',
      error: { kind: 'AUTHENTICATION_REQUIRED', message: 'Missing expected token', statusCode: 401 },
    };
  }

  const resourcePolicy = state.resourcePolicies.find((rp) => matchesResource(rp.resource, resource));

  if (resourcePolicy !== undefined) {
    if (routeGuard !== undefined && routeGuard.requiredPermission !== '') {
      const hasPermission =
        parsedToken.permissions.includes(routeGuard.requiredPermission) ||
        parsedToken.authLevel === routeGuard.requiredPermission;
      if (!hasPermission) {
        return {
          decision: 'INSUFFICIENT_AUTH_LEVEL',
          error: { kind: 'STEP_UP_REQUIRED', message: 'Insufficient auth level', statusCode: 401 },
        };
      }
    }
    return {
      decision: 'GRANTED',
      error: null,
    };
  }

  if (routeGuard === undefined) {
    return {
      decision: 'RESOURCE_NOT_REGISTERED',
      error: null,
    };
  }

  if (routeGuard.requiredPermission !== '') {
    const hasPermission =
      parsedToken.permissions.includes(routeGuard.requiredPermission) ||
      parsedToken.authLevel === routeGuard.requiredPermission;
    if (hasPermission) {
      return {
        decision: 'GRANTED',
        error: null,
      };
    }
    return {
      decision: 'INSUFFICIENT_AUTH_LEVEL',
      error: { kind: 'STEP_UP_REQUIRED', message: 'Insufficient auth level', statusCode: 401 },
    };
  }

  return {
    decision: 'POLICY_DENIED',
    error: { kind: 'POLICY_DENIED', message: 'Policy denied', statusCode: 403 },
  };
}

export function evaluateRequestWithFallback(
  state: AbacPolicyDecisionPointState,
  token: unknown,
  resource: string,
  scope: string,
  serverAvailable: boolean,
): AbacPolicyDecisionPointEvaluationResult {
  const parsedToken = extractTokenAuth(token);
  if (!parsedToken.valid) {
    return {
      decision: 'INSUFFICIENT_AUTH_LEVEL',
      error: { kind: 'AUTHENTICATION_REQUIRED', message: 'Missing expected token', statusCode: 401 },
    };
  }

  const routeGuard = state.routeGuards.find(
    (rg) => matchesResource(rg.resource, resource) && (rg.scope === scope || rg.scope === '*'),
  );

  if (serverAvailable) {
    const directResult = evaluateRequest(state, token, resource, scope, serverAvailable);
    if (directResult.decision === 'GRANTED' || directResult.decision === 'INSUFFICIENT_AUTH_LEVEL') {
      return directResult;
    }
  }

  if (routeGuard === undefined) {
    return {
      decision: 'POLICY_DENIED',
      error: { kind: 'POLICY_DENIED', message: 'Unknown or unregistered resource degrades to absent static permission', statusCode: 403 },
    };
  }

  if (routeGuard.requiredPermission === '') {
    return {
      decision: 'POLICY_DENIED',
      error: { kind: 'POLICY_DENIED', message: 'Static fallback without a permission maps to 403', statusCode: 403 },
    };
  }

  const hasStaticPermission =
    parsedToken.permissions.includes(routeGuard.requiredPermission) ||
    parsedToken.authLevel === routeGuard.requiredPermission;

  if (hasStaticPermission) {
    return {
      decision: 'GRANTED',
      error: null,
    };
  }

  return {
    decision: 'POLICY_DENIED',
    error: { kind: 'POLICY_DENIED', message: 'Static permission backstop denied', statusCode: 403 },
  };
}

export function evaluateLifecycle(
  state: AbacPolicyDecisionPointState,
  action: 'read' | 'write',
  resource: string,
  token: unknown,
  scope: string,
  serverAvailable: boolean,
): AbacPolicyDecisionPointEvaluationResult {
  const parsedToken = extractTokenAuth(token);
  if (!parsedToken.valid) {
    return {
      decision: 'INSUFFICIENT_AUTH_LEVEL',
      error: { kind: 'AUTHENTICATION_REQUIRED', message: 'Missing expected token', statusCode: 401 },
    };
  }

  if (action === 'read') {
    return evaluateRequestWithFallback(state, token, resource, scope, serverAvailable);
  }

  if (action === 'write') {
    const requiredWritePermission = 'tenant:auth-settings';
    const hasWritePermission =
      parsedToken.permissions.includes(requiredWritePermission) ||
      parsedToken.authLevel === requiredWritePermission ||
      parsedToken.permissions.includes('admin') ||
      parsedToken.authLevel === 'admin';

    const routeGuard = state.routeGuards.find(
      (rg) => matchesResource(rg.resource, resource) && (rg.scope === scope || rg.scope === '*'),
    );

    if (routeGuard !== undefined && routeGuard.requiredPermission !== '') {
      const hasRoutePermission =
        parsedToken.permissions.includes(routeGuard.requiredPermission) ||
        parsedToken.authLevel === routeGuard.requiredPermission;
      if (!hasRoutePermission && !hasWritePermission) {
        return {
          decision: 'INSUFFICIENT_AUTH_LEVEL',
          error: { kind: 'STEP_UP_REQUIRED', message: 'Insufficient auth level for write operation', statusCode: 401 },
        };
      }
    } else if (!hasWritePermission) {
      return {
        decision: 'INSUFFICIENT_AUTH_LEVEL',
        error: { kind: 'STEP_UP_REQUIRED', message: 'Insufficient auth level: tenant auth-settings required', statusCode: 401 },
      };
    }

    if (!serverAvailable) {
      return {
        decision: 'SERVER_UNAVAILABLE',
        error: null,
      };
    }

    return {
      decision: 'GRANTED',
      error: null,
    };
  }

  return {
    decision: 'POLICY_DENIED',
    error: { kind: 'POLICY_DENIED', message: 'Unknown action', statusCode: 403 },
  };
}

export function computeReadiness(
  state: AbacPolicyDecisionPointState,
): AbacPolicyDecisionPointReadiness {
  if (state.readiness === 'DEGRADED') {
    return 'DEGRADED';
  }
  if (state.lastDecision === 'SERVER_UNAVAILABLE' || state.lastDecision === 'RESOURCE_NOT_REGISTERED') {
    return 'DEGRADED';
  }
  return 'READY';
}

export function validateResourcePolicy(
  resource: string,
  policy: unknown,
  staticPermission: string | null,
  routeGuards: readonly AbacPolicyDecisionPointRouteGuard[],
): AbacPolicyDecisionPointError | null {
  if (policy !== null && typeof policy === 'object') {
    return null;
  }

  const matchingGuard = routeGuards.find((rg) => matchesResource(rg.resource, resource));
  if (matchingGuard === undefined) {
    return {
      kind: 'POLICY_DENIED',
      message: 'Resource not registered and no injected policy',
      statusCode: 403,
    };
  }

  if (staticPermission === null || staticPermission === '') {
    return {
      kind: 'POLICY_DENIED',
      message: 'Absent static permission denies',
      statusCode: 403,
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