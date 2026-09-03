import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const generator = "scripts/derive-anqr-architecture-rules.mjs";

/**
 * ANQR enforces its architecture from a rules file projected out of this graph.
 * The graph is authority; the projection is not. This is the registered check
 * that keeps that relationship the right way round, and it fails in both
 * directions:
 *
 *   output drift    the product's committed rules were edited, so they no
 *                   longer equal a fresh derivation
 *   authority drift the graph moved and the projection was not regenerated
 *
 * The product checkout is mapped through ignored operator state rather than
 * declared here, so when it is absent this skips with a stated reason instead
 * of failing. That keeps USF independently testable, which is the same reason
 * ANQR must not import USF.
 */
function productRulesPath(): string | null {
  // Sibling checkout by convention, which is how the operator maps it locally.
  const candidate = resolve(repositoryRoot, "../anqr/packages/architecture/rules.json");
  return existsSync(candidate) ? candidate : null;
}

function derive(): string {
  return execFileSync(process.execPath, [generator], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1 << 28,
    env: { ...process.env, FORCE_COLOR: undefined },
  });
}

test("the derivation is deterministic, so a difference means drift and not noise", () => {
  assert.equal(derive(), derive());
});

test("the derivation covers every architecture facet the graph declares", () => {
  const derived = JSON.parse(derive()) as {
    facets: readonly { name: string }[];
    adapters: readonly { name: string; implementsPort: readonly string[] }[];
    ports: readonly { name: string; direction: string }[];
    components: readonly unknown[];
    moduleBoundaries: readonly unknown[];
  };
  // A projection that silently dropped a rule would let the product enforce
  // less than the graph requires, which is the failure this guards.
  assert.equal(derived.facets.length, 15, "all fifteen architecture facets must project");
  assert.ok(derived.components.length >= 10);
  assert.ok(derived.ports.length >= 6);
  assert.ok(derived.adapters.length >= 5);
  assert.ok(derived.moduleBoundaries.length >= 2);
  for (const port of derived.ports.filter((entry) => entry.direction === "outbound")) {
    assert.ok(derived.adapters.some((adapter) => adapter.implementsPort.includes(port.name)),
      `outbound port ${port.name} projects with no adapter, so the product could not enforce it`);
  }
});

test("the product's committed rules equal a fresh derivation from the graph", (context) => {
  const path = productRulesPath();
  if (path === null) {
    context.skip("the ANQR checkout is not mapped beside this repository; authority comparison needs the product tree");
    return;
  }
  assert.equal(readFileSync(path, "utf8"), derive(),
    "the committed rules have drifted from the graph; regenerate with the derivation script rather than editing them");
});

test("planted: output drift is detected and the restored state passes", (context) => {
  const path = productRulesPath();
  if (path === null) {
    context.skip("the ANQR checkout is not mapped beside this repository");
    return;
  }
  const original = readFileSync(path, "utf8");
  try {
    assert.equal(original, derive(), "known-good: committed rules equal the derivation");

    // Weakening enforcement by editing the projection is the realistic attack:
    // remove a facet and the product's checker stops asking for it.
    const weakened = JSON.parse(original) as { facets: unknown[] };
    weakened.facets = weakened.facets.slice(1);
    writeFileSync(path, `${JSON.stringify(weakened, null, 2)}\n`);
    assert.notEqual(readFileSync(path, "utf8"), derive(), "a dropped facet must be detected as drift");

    writeFileSync(path, original);
    assert.equal(readFileSync(path, "utf8"), derive(), "restoring must return to known-good");
  } finally {
    writeFileSync(path, original);
  }
});

test("planted: authority drift is detected, and the graph is what wins", (context) => {
  const path = productRulesPath();
  if (path === null) {
    context.skip("the ANQR checkout is not mapped beside this repository");
    return;
  }
  const source = resolve(repositoryRoot, "graph/products/anqr/architecture.nq");
  const graphBytes = readFileSync(source, "utf8");
  const committed = readFileSync(path, "utf8");
  try {
    assert.equal(committed, derive(), "known-good");

    // Move the authority without regenerating the projection. The committed
    // rules are now stale, and the check must say so rather than accepting
    // them as truth.
    // A new layer subject, because appending a duplicate predicate to an
    // existing subject is invisible to the projection: the reader takes the
    // first value, so the derivation would not move and the case would prove
    // nothing. Verified by trying it that way first.
    const planted = [
      `<urn:anqr:architectural-layer:planted-drift> <urn:usf:predicate:type> <urn:usf:type:ArchitecturalLayer> <urn:anqr:graph:architecture> .`,
      `<urn:anqr:architectural-layer:planted-drift> <urn:usf:predicate:canonicalName> "planted-drift" <urn:anqr:graph:architecture> .`,
      `<urn:anqr:architectural-layer:planted-drift> <urn:usf:predicate:layerOrdinal> "9" <urn:anqr:graph:architecture> .`,
    ].join("\n");
    writeFileSync(source, `${graphBytes}${planted}\n`);
    const afterDrift = derive();
    assert.notEqual(afterDrift, committed, "a graph change must change the derivation");
    assert.notEqual(readFileSync(path, "utf8"), afterDrift,
      "the committed projection must now be reported as stale relative to the graph");

    writeFileSync(source, graphBytes);
    assert.equal(readFileSync(path, "utf8"), derive(), "restoring the graph must return to known-good");
  } finally {
    writeFileSync(source, graphBytes);
  }
});
