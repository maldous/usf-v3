import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseBootstrapCarrierArguments } from "../../src/commands/bootstrap-carrier.ts";
import { loadSemanticGraph, objectsFor } from "../../src/graph/index.ts";
import { bootstrapCarrier } from "../../src/realisation/carrier-adoption.ts";
import { createJsonSchemaValidator } from "../../src/schema/index.ts";

const root = resolve(import.meta.dirname, "../..");
const manifestPath = "graph/manifests/integration.json" as const;
const predicate = (name: string): string => `urn:usf:predicate:${name}`;

const adoptions = [
  ["urn:usf:carrier-adoption:semantic-first-gate:1", "urn:usf:profile:v3-semantic-first:1"],
  ["urn:usf:carrier-adoption:repository-path-scope:1", "urn:usf:profile:v3-self-host:1"],
  ["urn:usf:carrier-adoption:integration-toolchain-repair:1", "urn:usf:profile:v3-self-host:1"],
] as const;

test("bootstrap-carrier has one finite graph/CLI/schema surface without replaying historical validations", async () => {
  const graph = loadSemanticGraph(root, manifestPath);
  const algorithm = "urn:usf:algorithm:bootstrap-carrier-adoption-transition:1";
  const command = "urn:usf:command:bootstrap-carrier:1";
  assert.deepEqual(objectsFor(graph, algorithm, predicate("eligibleCarrierAdoption")).map((item) => item.object).sort(), adoptions.map(([iri]) => iri).sort());
  assert.deepEqual(objectsFor(graph, command, predicate("availability")).map((item) => item.object), ["implemented"]);
  assert.deepEqual(objectsFor(graph, command, predicate("externalContact")).map((item) => item.object), ["none"]);

  for (const [adoptionIri, profileIri] of adoptions) {
    assert.deepEqual(parseBootstrapCarrierArguments(["verify", "--adoption", adoptionIri, "--profile", profileIri, "--manifest", manifestPath]), {
      mode: "verify", adoptionIri, profileIri, manifestPath,
    });
  }

  for (const name of ["bootstrap-carrier-adoption-receipt", "bootstrap-carrier-result"]) {
    const schema = JSON.parse(readFileSync(resolve(root, `schemas/${name}.schema.json`), "utf8")) as unknown;
    assert.equal(createJsonSchemaValidator(schema).schemaId, `urn:usf:${name}:1`);
  }

  const transient = resolve(root, ".usf/receipts/bootstrap-carrier/repository-path-scope-v1.json");
  const before = existsSync(transient);
  await assert.rejects(
    bootstrapCarrier(root, { mode: "verify", adoptionIri: adoptions[1][0], profileIri: "urn:usf:profile:v3-semantic-first:1", manifestPath }),
    { code: "BOOTSTRAP_CARRIER_PROFILE_MISMATCH", exitCode: 4 },
  );
  assert.equal(existsSync(transient), before);
});

test("the selected-subdiff denominator and bounded validation timeout remain graph-defined", () => {
  const graph = loadSemanticGraph(root, manifestPath);
  const adoption = adoptions[1][0];
  const scope = objectsFor(graph, adoption, predicate("pathEffectScope"))[0]!.object;
  const literal = (name: string): string => objectsFor(graph, scope, predicate(name))[0]!.object;
  assert.equal(literal("coverageMode"), "exact-selected-path-subdiff");
  assert.equal(literal("carrierTotalChangedPathCount"), "100");
  assert.equal(literal("selectedPathCount"), "2");
  assert.equal(literal("includedPathCount"), "2");
  assert.equal(literal("excludedSelectedPathCount"), "0");

  const algorithm = "urn:usf:algorithm:bootstrap-carrier-adoption-transition:1";
  assert.deepEqual({
    wall: objectsFor(graph, algorithm, predicate("validationWallTimeMilliseconds"))[0]!.object,
    grace: objectsFor(graph, algorithm, predicate("validationTerminationGraceMilliseconds"))[0]!.object,
    settlement: objectsFor(graph, algorithm, predicate("validationMaximumSettlementWallTimeMilliseconds"))[0]!.object,
  }, { wall: "300000", grace: "5000", settlement: "305000" });
});
