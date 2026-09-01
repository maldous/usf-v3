export const OpenApiDriftHardGateMode = ['STRICT', 'REPORT_ONLY'] as const;
export type OpenApiDriftHardGateMode = typeof OpenApiDriftHardGateMode[number];

export const OpenApiDriftHardGateErrorKind = [
  'MISSING_ROUTE_FILE',
  'MISSING_OPENAPI_FILE',
  'DRIFT_DETECTED',
] as const;
export type OpenApiDriftHardGateErrorKind = typeof OpenApiDriftHardGateErrorKind[number];

export const OpenApiDriftHardGateDriftKind = [
  'MISSING_ROUTE',
  'EXTRA_ROUTE',
  'UNRESOLVED_REFERENCE',
  'SCHEMALESS_BODY',
] as const;
export type OpenApiDriftHardGateDriftKind = typeof OpenApiDriftHardGateDriftKind[number];

export interface OpenApiDriftHardGateDrift {
  readonly kind: OpenApiDriftHardGateDriftKind;
  readonly path: string;
  readonly method: string;
}

export interface OpenApiDriftHardGateError {
  readonly kind: OpenApiDriftHardGateErrorKind;
  readonly message: string;
  readonly drifts?: readonly OpenApiDriftHardGateDrift[];
}

export interface OpenApiDriftHardGateRoute {
  readonly path: string;
  readonly method: string;
}

export interface OpenApiDriftHardGateOpenApiPath {
  readonly path: string;
  readonly methods: readonly string[];
  readonly hasRequestBodySchema: boolean;
  readonly hasResponseBodySchemas: boolean;
  readonly references: readonly string[];
}

export interface OpenApiDriftHardGateState {
  readonly routes: readonly OpenApiDriftHardGateRoute[];
  readonly openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[];
  readonly missingRoutes: readonly OpenApiDriftHardGateDrift[];
  readonly extraRoutes: readonly OpenApiDriftHardGateDrift[];
  readonly unresolvedReferences: readonly OpenApiDriftHardGateDrift[];
  readonly schemalessBodies: readonly OpenApiDriftHardGateDrift[];
  readonly mode: OpenApiDriftHardGateMode;
}

export const initialState: OpenApiDriftHardGateState = {
  routes: [],
  openApiPaths: [],
  missingRoutes: [],
  extraRoutes: [],
  unresolvedReferences: [],
  schemalessBodies: [],
  mode: 'STRICT',
};

export function extractRoutes(routes: readonly OpenApiDriftHardGateRoute[]): readonly OpenApiDriftHardGateRoute[] {
  return [...routes];
}

export function loadOpenApiDocument(
  openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[],
): readonly OpenApiDriftHardGateOpenApiPath[] {
  return [...openApiPaths];
}

export function comparePathAndMethodCoverage(
  routes: readonly OpenApiDriftHardGateRoute[],
  openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[],
): {
  readonly missingRoutes: readonly OpenApiDriftHardGateDrift[];
  readonly extraRoutes: readonly OpenApiDriftHardGateDrift[];
} {
  const routeSet = new Set(routes.map((r) => `${r.method}:${r.path}`));
  const openApiSet = new Set<string>();

  for (const path of openApiPaths) {
    for (const method of path.methods) {
      openApiSet.add(`${method}:${path.path}`);
    }
  }

  const missingRoutes: OpenApiDriftHardGateDrift[] = [];
  const extraRoutes: OpenApiDriftHardGateDrift[] = [];

  for (const route of routes) {
    if (!openApiSet.has(`${route.method}:${route.path}`)) {
      missingRoutes.push({ kind: 'MISSING_ROUTE', path: route.path, method: route.method });
    }
  }

  for (const path of openApiPaths) {
    for (const method of path.methods) {
      if (!routeSet.has(`${method}:${path.path}`)) {
        extraRoutes.push({ kind: 'EXTRA_ROUTE', path: path.path, method });
      }
    }
  }

  return { missingRoutes, extraRoutes };
}

export function collectUnresolvedReferences(
  openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[],
): readonly OpenApiDriftHardGateDrift[] {
  const unresolvedReferences: OpenApiDriftHardGateDrift[] = [];
  const definedReferences = new Set<string>();

  for (const path of openApiPaths) {
    for (const ref of path.references) {
      if (!definedReferences.has(ref)) {
        unresolvedReferences.push({ kind: 'UNRESOLVED_REFERENCE', path: path.path, method: '' });
      }
    }
    for (const ref of path.references) {
      definedReferences.add(ref);
    }
  }

  return unresolvedReferences;
}

export function detectSchemalessBodies(
  openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[],
): readonly OpenApiDriftHardGateDrift[] {
  const schemalessBodies: OpenApiDriftHardGateDrift[] = [];

  for (const path of openApiPaths) {
    if (!path.hasRequestBodySchema || !path.hasResponseBodySchemas) {
      for (const method of path.methods) {
        schemalessBodies.push({ kind: 'SCHEMALESS_BODY', path: path.path, method });
      }
    }
  }

  return schemalessBodies;
}

export function computeDrift(
  routes: readonly OpenApiDriftHardGateRoute[],
  openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[],
): {
  readonly missingRoutes: readonly OpenApiDriftHardGateDrift[];
  readonly extraRoutes: readonly OpenApiDriftHardGateDrift[];
  readonly unresolvedReferences: readonly OpenApiDriftHardGateDrift[];
  readonly schemalessBodies: readonly OpenApiDriftHardGateDrift[];
} {
  const { missingRoutes, extraRoutes } = comparePathAndMethodCoverage(routes, openApiPaths);
  const unresolvedReferences = collectUnresolvedReferences(openApiPaths);
  const schemalessBodies = detectSchemalessBodies(openApiPaths);

  return { missingRoutes, extraRoutes, unresolvedReferences, schemalessBodies };
}

export function runDriftGate(
  state: OpenApiDriftHardGateState,
): { readonly result: 'PASS' | 'FAIL'; readonly error: OpenApiDriftHardGateError | null } {
  const allDrifts = [
    ...state.missingRoutes,
    ...state.extraRoutes,
    ...state.unresolvedReferences,
    ...state.schemalessBodies,
  ];

  if (allDrifts.length === 0) {
    return { result: 'PASS', error: null };
  }

  if (state.mode === 'STRICT') {
    return {
      result: 'FAIL',
      error: {
        kind: 'DRIFT_DETECTED',
        message: 'Drift detected in strict mode',
        drifts: allDrifts,
      },
    };
  }

  return {
    result: 'PASS',
    error: {
      kind: 'DRIFT_DETECTED',
      message: 'Drift detected in report-only mode',
      drifts: allDrifts,
    },
  };
}

export function validateOpenApiDriftHardGate(
  routes: readonly OpenApiDriftHardGateRoute[],
  openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[],
  mode: OpenApiDriftHardGateMode,
): OpenApiDriftHardGateState {
  const { missingRoutes, extraRoutes, unresolvedReferences, schemalessBodies } = computeDrift(
    routes,
    openApiPaths,
  );

  return {
    routes,
    openApiPaths,
    missingRoutes,
    extraRoutes,
    unresolvedReferences,
    schemalessBodies,
    mode,
  };
}

export function createStateFromInputs(
  routes: readonly OpenApiDriftHardGateRoute[],
  openApiPaths: readonly OpenApiDriftHardGateOpenApiPath[],
  mode: OpenApiDriftHardGateMode = 'STRICT',
): OpenApiDriftHardGateState {
  return validateOpenApiDriftHardGate(routes, openApiPaths, mode);
}