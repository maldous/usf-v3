import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { canonicalDigest } from "../../src/core/canonical.ts";
import {
  loadConformanceEvidence, recordConformanceRun, runCapabilityConformance,
} from "../../src/providers/implementation-conformance.ts";
import type { CapabilityImplementationNeed } from "../../src/providers/implementation-work.ts";

// The probe lives under the ignored operational root so the repository's own
// test globs never collect its deliberately failing subtest.
const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const probeRoot = ".usf/conformance-probe";
const modulePath = `${probeRoot}/probe.ts`;
const conformancePath = `${probeRoot}/probe.conformance.test.ts`;
const evidenceRoot = resolve(repositoryRoot, ".usf", "conformance-evidence");

function need(): CapabilityImplementationNeed {
  const requirement = (name: string) => Object.freeze({
    facet: `urn:usf:delivery-facet:${name}`, canonicalName: name,
    requirementClass: "behavioural-runtime", statement: `${name} must hold`,
  });
  return Object.freeze({
    capability: "urn:usf:delivery-capability:probe",
    canonicalName: "probe", domain: "foundation", contract: null,
    modulePath, conformancePath,
    requirements: Object.freeze([requirement("probeholds"), requirement("probefails"), requirement("probeunwritten")]),
    requirementClasses: Object.freeze(["behavioural-runtime"]),
    runtimeDependencies: Object.freeze([]),
  });
}

after(async () => { await rm(resolve(repositoryRoot, probeRoot), { recursive: true, force: true }); });

async function writeProbe(moduleSource: string, testSource: string): Promise<void> {
  await mkdir(resolve(repositoryRoot, probeRoot), { recursive: true, mode: 0o700 });
  await writeFile(resolve(repositoryRoot, modulePath), moduleSource, { mode: 0o600 });
  await writeFile(resolve(repositoryRoot, conformancePath), testSource, { mode: 0o600 });
}

test("behaviour is observed by executing the module inside the repository confinement", async () => {
  await writeProbe(
    'export function decide(allow: boolean): "granted" | "denied" {\n  return allow ? "granted" : "denied";\n}\n',
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'import * as capability from "./probe.ts";',
      'test("probeholds", () => { assert.equal(capability.decide(true), "granted"); });',
      'test("probefails", () => { assert.equal(capability.decide(false), "granted"); });',
      "",
    ].join("\n"),
  );
  const run = await runCapabilityConformance(repositoryRoot, need(), "sha256:test");
  assert.equal(run.refusal, null, `unexpected refusal: ${String(run.refusal)}`);
  assert.equal(run.executed, true);
  assert.equal(run.confined, true);
  assert.equal(run.typecheck.clean, true);

  const byName = new Map(run.outcomes.map((outcome) => [outcome.facetName, outcome] as const));
  assert.deepEqual(
    [byName.get("probeholds")!.passed, byName.get("probeholds")!.executed],
    [true, true],
  );
  // A requirement the module does not satisfy is observed failing, not absent.
  assert.deepEqual(
    [byName.get("probefails")!.passed, byName.get("probefails")!.executed],
    [false, true],
  );
  // A requirement with no subtest is unobserved, which is not the same as failing.
  assert.equal(byName.get("probeunwritten")!.executed, false);

  // The recorded evidence binds the exact bytes it observed, and reduces to one
  // entry per facet that the evaluator can read.
  const path = await recordConformanceRun(repositoryRoot, run);
  try {
    const evidence = await loadConformanceEvidence(repositoryRoot);
    assert.equal(evidence.get("urn:usf:delivery-facet:probeholds")?.passed, true);
    assert.equal(evidence.get("urn:usf:delivery-facet:probeholds")?.stale, false);
    assert.equal(evidence.get("urn:usf:delivery-facet:probefails")?.passed, false);
    assert.equal(evidence.get("urn:usf:delivery-facet:probeunwritten"), undefined);

    // Changing the module makes the recorded observation stale rather than wrong.
    await writeFile(resolve(repositoryRoot, modulePath),
      'export function decide(allow: boolean): "granted" | "denied" {\n  return allow ? "granted" : "denied";\n}\n// changed\n',
      { mode: 0o600 });
    const afterChange = await loadConformanceEvidence(repositoryRoot);
    assert.equal(afterChange.get("urn:usf:delivery-facet:probeholds")?.stale, true);
  } finally {
    await rm(resolve(evidenceRoot, path.split("/").pop()!), { force: true });
  }
});

test("a module that does not typecheck yields no behavioural observation", async () => {
  await writeProbe(
    'export function decide(allow: boolean): string {\n  return allow.missingMethod();\n}\n',
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'import * as capability from "./probe.ts";',
      'test("probeholds", () => { assert.ok(capability.decide(true)); });',
      "",
    ].join("\n"),
  );
  const run = await runCapabilityConformance(repositoryRoot, need(), "sha256:test");
  assert.equal(run.executed, false);
  assert.equal(run.typecheck.clean, false);
  assert.match(String(run.refusal), /does not typecheck/u);
  assert.ok(run.outcomes.every((outcome) => !outcome.passed && !outcome.executed));
});

test("an absent module is a recorded fact, not a passing check", async () => {
  await rm(resolve(repositoryRoot, probeRoot), { recursive: true, force: true });
  const run = await runCapabilityConformance(repositoryRoot, need(), "sha256:test");
  assert.equal(run.executed, false);
  assert.match(String(run.refusal), /does not exist/u);
  assert.equal(run.modulePathDigest, "");
  assert.notEqual(canonicalDigest(run), "");
});
