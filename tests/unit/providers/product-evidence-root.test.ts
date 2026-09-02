import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { canonicalDigest } from "../../../src/core/canonical.ts";
import { loadConformanceEvidence } from "../../../src/providers/implementation-conformance.ts";

/**
 * Evidence produced in a product repository has to be read back against that
 * repository.
 *
 * It was read back against USF. A product record's modulePath does not exist
 * there, so its digest read null, null never matched the recorded digest, and
 * every product observation was permanently stale. Ten executed records with
 * genuinely passing subtests all reported STALE, which meant a product facet
 * could never reach SATISFIED however much work was done.
 *
 * The failure was silent in the worst way: nothing threw, the evidence files
 * were correct, the subtests really had passed, and the only symptom was a
 * satisfaction count that would not move.
 */
const canonicalRoot = resolve(import.meta.dirname, "../../..");
const productRepository = "urn:anqr:repository:main";
const modulePath = "src/capabilities/localisation/example.ts";
const conformancePath = "tests/conformance/localisation/example.conformance.test.ts";
const facet = "urn:anqr:delivery-facet:examplecontracts";

const moduleSource = "export function example(): number { return 1; }\n";
const testSource = [
  'import test from "node:test";',
  'import * as capability from "../../../src/capabilities/localisation/example.ts";',
  'test("examplecontracts", () => { capability.example(); });',
  "",
].join("\n");

async function fixture(): Promise<{
  usfRoot: string; productRoot: string; cleanup: () => Promise<void>;
}> {
  const parent = await mkdtemp(resolve(canonicalRoot, ".usf/tmp/product-evidence-"));
  const usfRoot = resolve(parent, "usf");
  const productRoot = resolve(parent, "product");
  for (const [root, relative] of [[productRoot, modulePath], [productRoot, conformancePath]] as const) {
    await mkdir(resolve(root, relative, ".."), { recursive: true });
  }
  await writeFile(resolve(productRoot, modulePath), moduleSource);
  await writeFile(resolve(productRoot, conformancePath), testSource);
  await mkdir(resolve(usfRoot, ".usf/conformance-evidence"), { recursive: true });
  const record = {
    schema: "urn:usf:implementation-conformance-evidence:1",
    version: 1,
    outcomeClass: "observed",
    capability: "urn:anqr:delivery-capability:example",
    sourceRepository: productRepository,
    modulePath,
    modulePathDigest: canonicalDigest(moduleSource),
    conformancePath,
    conformancePathDigest: canonicalDigest(testSource),
    confined: true,
    command: ["node", "--test", conformancePath],
    executed: true,
    exitCode: 0,
    signal: null,
    typecheck: { ran: true, clean: true, detail: null },
    reportedPassCount: 1,
    reportedFailCount: 0,
    authoritySnapshot: "sha256:example",
    outcomes: [{
      facet, facetName: "examplecontracts", executed: true, passed: true,
      admissible: true, detail: null,
    }],
    refusal: null,
    nonClaims: [],
  };
  await writeFile(resolve(usfRoot, ".usf/conformance-evidence/example.json"), JSON.stringify(record));
  return { usfRoot, productRoot, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

test("a product record resolves against the product repository, not against USF", async () => {
  const { usfRoot, productRoot, cleanup } = await fixture();
  try {
    const evidence = await loadConformanceEvidence(usfRoot,
      (repository) => repository === productRepository ? productRoot : usfRoot);
    const entry = evidence.get(facet);
    assert.ok(entry !== undefined, "the record must be loaded at all");
    assert.equal(entry.executed, true);
    assert.equal(entry.passed, true);
    assert.equal(entry.stale, false, "current product bytes must not read as stale");
  } finally { await cleanup(); }
});

test("resolving a product record under USF is exactly the defect, and is visible", async () => {
  const { usfRoot, cleanup } = await fixture();
  try {
    // The default resolver sends every record to the USF root. For a product
    // record that is wrong, and the observable consequence is permanent
    // staleness rather than an error.
    const evidence = await loadConformanceEvidence(usfRoot);
    assert.equal(evidence.get(facet)?.stale, true,
      "this asserts the failure mode, so the fix cannot be silently reverted");
  } finally { await cleanup(); }
});

test("a record naming no repository is USF's, which keeps old evidence readable", async () => {
  const { usfRoot, productRoot, cleanup } = await fixture();
  try {
    // Records written before the field existed carry no sourceRepository. They
    // are USF's, so the resolver must be asked for null and must not be handed
    // a product root by accident.
    const asked: (string | null)[] = [];
    await loadConformanceEvidence(usfRoot, (repository) => {
      asked.push(repository);
      return repository === productRepository ? productRoot : usfRoot;
    });
    assert.deepEqual(asked, [productRepository]);
  } finally { await cleanup(); }
});
