import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/developerplatform/openapidrifthardgate.ts";

test("openapidrifthardgateauditmodel", () => {
  const state: capability.OpenApiDriftHardGateState = {
    routes: [],
    openApiPaths: [],
    missingRoutes: [],
    extraRoutes: [],
    unresolvedReferences: [],
    schemalessBodies: [],
    mode: 'STRICT',
  };
  const result = capability.runDriftGate(state);
  assert.deepEqual(result, { result: 'PASS', error: null });
});

test("openapidrifthardgatecontracts", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [
    { path: '/users', method: 'GET' },
    { path: '/users', method: 'POST' },
  ];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [
    {
      path: '/users',
      methods: ['GET', 'POST'],
      hasRequestBodySchema: true,
      hasResponseBodySchemas: true,
      references: [],
    },
  ];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  assert.deepEqual(state.missingRoutes, []);
  assert.deepEqual(state.extraRoutes, []);
  assert.deepEqual(state.unresolvedReferences, []);
  assert.deepEqual(state.schemalessBodies, []);
});

test("openapidrifthardgateerrormodel", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [{ path: '/users', method: 'GET' }];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  const result = capability.runDriftGate(state);
  assert.equal(result.result, 'FAIL');
  assert.equal(result.error?.kind, 'DRIFT_DETECTED');
  assert.equal(result.error?.drifts?.length, 1);
  assert.equal(result.error?.drifts?.[0].kind, 'MISSING_ROUTE');

  const reportOnlyState = capability.createStateFromInputs(routes, openApiPaths, 'REPORT_ONLY');
  const reportOnlyResult = capability.runDriftGate(reportOnlyState);
  assert.equal(reportOnlyResult.result, 'PASS');
  assert.equal(reportOnlyResult.error?.kind, 'DRIFT_DETECTED');
});

test("openapidrifthardgatelifecycle", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [{ path: '/users', method: 'GET' }];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [
    {
      path: '/users',
      methods: ['GET', 'POST'],
      hasRequestBodySchema: false,
      hasResponseBodySchemas: false,
      references: ['#/components/schemas/User'],
    },
  ];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  assert.equal(state.missingRoutes.length, 0);
  assert.equal(state.extraRoutes.length, 1);
  assert.equal(state.extraRoutes[0].kind, 'EXTRA_ROUTE');
  assert.equal(state.unresolvedReferences.length, 1);
  assert.equal(state.unresolvedReferences[0].kind, 'UNRESOLVED_REFERENCE');
  assert.equal(state.schemalessBodies.length, 2);
  assert.equal(state.schemalessBodies[0].kind, 'SCHEMALESS_BODY');
  const result = capability.runDriftGate(state);
  assert.equal(result.result, 'FAIL');
});

test("openapidrifthardgatepermissions", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  assert.doesNotThrow(() => capability.runDriftGate(state));
});

test("openapidrifthardgateproof", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [{ path: '/users', method: 'GET' }];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [
    {
      path: '/users',
      methods: ['GET'],
      hasRequestBodySchema: true,
      hasResponseBodySchemas: true,
      references: [],
    },
  ];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  const result = capability.runDriftGate(state);
  assert.equal(result.result, 'PASS');
  assert.equal(result.error, null);
});

test("openapidrifthardgatereadinessmodel", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [{ path: '/users', method: 'GET' }];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [
    {
      path: '/users',
      methods: ['GET'],
      hasRequestBodySchema: true,
      hasResponseBodySchemas: true,
      references: [],
    },
  ];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  const result = capability.runDriftGate(state);
  assert.equal(result.result, 'PASS');

  const badRoutes: capability.OpenApiDriftHardGateRoute[] = [{ path: '/users', method: 'GET' }];
  const badOpenApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [
    {
      path: '/users',
      methods: ['GET', 'POST'],
      hasRequestBodySchema: true,
      hasResponseBodySchemas: true,
      references: [],
    },
  ];
  const badState = capability.createStateFromInputs(badRoutes, badOpenApiPaths, 'STRICT');
  const badResult = capability.runDriftGate(badState);
  assert.equal(badResult.result, 'FAIL');
});

test("openapidrifthardgatestatemodel", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [
    { path: '/users', method: 'GET' },
    { path: '/posts', method: 'POST' },
  ];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [
    {
      path: '/users',
      methods: ['GET'],
      hasRequestBodySchema: true,
      hasResponseBodySchemas: true,
      references: [],
    },
    {
      path: '/posts',
      methods: ['POST'],
      hasRequestBodySchema: false,
      hasResponseBodySchemas: false,
      references: ['#/components/schemas/Post'],
    },
  ];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  assert.deepEqual(state.routes, routes);
  assert.deepEqual(state.openApiPaths, openApiPaths);
  assert.equal(state.missingRoutes.length, 0);
  assert.equal(state.extraRoutes.length, 0);
  assert.equal(state.unresolvedReferences.length, 1);
  assert.equal(state.schemalessBodies.length, 1);
  assert.equal(state.mode, 'STRICT');
});

test("openapidrifthardgatevalidation", () => {
  const routes: capability.OpenApiDriftHardGateRoute[] = [{ path: '/users', method: 'GET' }];
  const openApiPaths: capability.OpenApiDriftHardGateOpenApiPath[] = [
    {
      path: '/users',
      methods: ['GET'],
      hasRequestBodySchema: true,
      hasResponseBodySchemas: true,
      references: [],
    },
  ];
  const state = capability.createStateFromInputs(routes, openApiPaths, 'STRICT');
  const result = capability.runDriftGate(state);
  assert.equal(result.result, 'PASS');
  assert.equal(result.error, null);

  const missingRouteState = capability.createStateFromInputs(
    [{ path: '/users', method: 'GET' }, { path: '/posts', method: 'GET' }],
    openApiPaths,
    'STRICT'
  );
  const missingResult = capability.runDriftGate(missingRouteState);
  assert.equal(missingResult.result, 'FAIL');
  assert.equal(missingResult.error?.drifts?.length, 1);
  assert.equal(missingResult.error?.drifts?.[0].kind, 'MISSING_ROUTE');

  const extraRouteState = capability.createStateFromInputs(
    routes,
    [
      {
        path: '/users',
        methods: ['GET', 'POST'],
        hasRequestBodySchema: true,
        hasResponseBodySchemas: true,
        references: [],
      },
    ],
    'STRICT'
  );
  const extraResult = capability.runDriftGate(extraRouteState);
  assert.equal(extraResult.result, 'FAIL');
  assert.equal(extraResult.error?.drifts?.length, 1);
  assert.equal(extraResult.error?.drifts?.[0].kind, 'EXTRA_ROUTE');

  const unresolvedRefState = capability.createStateFromInputs(
    routes,
    [
      {
        path: '/users',
        methods: ['GET'],
        hasRequestBodySchema: true,
        hasResponseBodySchemas: true,
        references: ['#/components/schemas/Unknown'],
      },
    ],
    'STRICT'
  );
  const unresolvedResult = capability.runDriftGate(unresolvedRefState);
  assert.equal(unresolvedResult.result, 'FAIL');
  assert.equal(unresolvedResult.error?.drifts?.length, 1);
  assert.equal(unresolvedResult.error?.drifts?.[0].kind, 'UNRESOLVED_REFERENCE');

  const schemalessState = capability.createStateFromInputs(
    routes,
    [
      {
        path: '/users',
        methods: ['GET'],
        hasRequestBodySchema: false,
        hasResponseBodySchemas: false,
        references: [],
      },
    ],
    'STRICT'
  );
  const schemalessResult = capability.runDriftGate(schemalessState);
  assert.equal(schemalessResult.result, 'FAIL');
  assert.equal(schemalessResult.error?.drifts?.length, 1);
  assert.equal(schemalessResult.error?.drifts?.[0].kind, 'SCHEMALESS_BODY');
});