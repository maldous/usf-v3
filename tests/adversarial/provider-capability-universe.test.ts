import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  capabilityKind, observedModelFeatureCapabilities, observeQualifiedTaskClasses,
  splitCapabilityRequirement, satisfiesCapabilities, taskClassCapabilities,
  unmetCapabilities,
} from "../../src/providers/capabilities.ts";

/**
 * Adversarial proof for the shared capability vocabulary.
 *
 * The defect this closes was invisible rather than loud. Work packets declared
 * `modelCapability` across nine task classes; the catalogue described models
 * with five model features; the two sets did not intersect at all. Nothing
 * translated between them, so a work unit requiring `typescript` could never
 * have matched a route. It went unnoticed because the dispatcher read a third
 * predicate the graph does not contain, leaving the requirement permanently
 * empty -- and an empty requirement refuses nothing, so a router that could not
 * match a capability looked exactly like a router with nothing to match.
 *
 * The property under test is therefore not "capabilities match". It is that a
 * capability is satisfied only by its own kind of evidence, and that every way
 * of failing to satisfy one is distinguishable from success. A vocabulary that
 * silently accepts an unknown name has the same failure mode as the bug it
 * replaced.
 */

const evidence = (modelFeatures: readonly string[], qualifiedTaskClasses: readonly string[]) =>
  ({ modelFeatures, qualifiedTaskClasses });

test("the two vocabularies do not intersect, which is why a join was needed", () => {
  const overlap = (observedModelFeatureCapabilities as readonly string[]).filter((name) =>
    (taskClassCapabilities as readonly string[]).includes(name));
  assert.deepEqual(overlap, [], "a name in both vocabularies would make its evidence ambiguous");
});

test("task classes are the closed half and everything else is a model feature", () => {
  assert.equal(capabilityKind("typescript"), "task-class");
  assert.equal(capabilityKind("tool-call"), "model-feature");
  // A feature models.dev has not published yet, and a plain typo, are both
  // model features. Neither is admitted by that: each is matched against the
  // model's own catalogue entry and refuses when absent. Treating an
  // unrecognised name as its own category needed a hardcoded feature list,
  // which would have refused the entire catalogue the day a feature was added.
  assert.equal(capabilityKind("vision"), "model-feature");
  assert.equal(capabilityKind("tool-calll"), "model-feature");
  // Task-class membership is exact: a near-miss is not a task class, so it can
  // never be satisfied by a qualification record.
  assert.equal(capabilityKind("TypeScript"), "model-feature");
  assert.equal(capabilityKind(" typescript"), "model-feature");
});

test("a requirement is split by vocabulary, deduplicated and ordered", () => {
  const split = splitCapabilityRequirement(["typescript", "tool-call", "vision", "typescript"]);
  assert.deepEqual(split.modelFeatures, ["tool-call", "vision"]);
  assert.deepEqual(split.taskClasses, ["typescript"]);
});

test("a model feature is satisfied by catalogue evidence and nothing else", () => {
  assert.ok(satisfiesCapabilities(["tool-call"], evidence(["tool-call"], [])));
  const unmet = unmetCapabilities(["tool-call"], evidence([], ["typescript", "node-test"]));
  assert.deepEqual(unmet.missingModelFeatures, ["tool-call"],
    "earning every task class must not supply a model feature");
});

test("a task class is satisfied by qualification and nothing else", () => {
  assert.ok(satisfiesCapabilities(["typescript"], evidence([], ["typescript"])));
  const unmet = unmetCapabilities(["typescript"], evidence([...observedModelFeatureCapabilities], []));
  assert.deepEqual(unmet.unqualifiedTaskClasses, ["typescript"],
    "holding every catalogue feature must not supply a task class");
});

test("neither vocabulary can borrow the other's evidence, in either direction", () => {
  // The single property the whole split exists to guarantee. A route that is
  // strong on one axis and absent on the other must fail on the absent one.
  const featuresOnly = evidence([...observedModelFeatureCapabilities], []);
  const classesOnly = evidence([], [...taskClassCapabilities]);
  assert.equal(satisfiesCapabilities(["typescript"], featuresOnly), false);
  assert.equal(satisfiesCapabilities(["tool-call"], classesOnly), false);
});

test("a capability nothing advertises refuses and is never silently satisfied", () => {
  // The bug's own shape: a requirement that matches nothing must refuse, not
  // pass. A route holding every observed feature and every task class still
  // fails a name it does not hold, and fails it as a missing model feature
  // rather than being waved through.
  const everything = evidence([...observedModelFeatureCapabilities], [...taskClassCapabilities]);
  assert.equal(satisfiesCapabilities(["invented-capability"], everything), false);
  assert.deepEqual(
    unmetCapabilities(["invented-capability"], everything).missingModelFeatures,
    ["invented-capability"],
  );
});

test("an empty requirement is satisfied by an empty route", () => {
  // Not a permissive default by accident: requiring nothing is a real request
  // and must succeed, or every unconstrained dispatch would refuse.
  assert.ok(satisfiesCapabilities([], evidence([], [])));
});

test("every task class the graph's work packets declare is in the vocabulary", () => {
  // The vocabulary is closed, so a packet naming a class it does not contain
  // would refuse every route. These are the nine the graph actually declares.
  for (const declared of ["typescript", "node-test", "provider-routing", "rdf-semantics",
    "cli-design", "semantic-evaluation", "process-lifecycle", "technical-writing", "semantic-review"]) {
    assert.equal(capabilityKind(declared), "task-class", `${declared} must be a known task class`);
  }
});

// ---- stored qualification records -------------------------------------------

async function repositoryWith(records: readonly Readonly<Record<string, unknown>>[]): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "usf-qualification-"));
  const directory = resolve(root, ".usf", "qualifications");
  await mkdir(directory, { recursive: true });
  let index = 0;
  for (const record of records) {
    await writeFile(resolve(directory, `record-${index++}.json`), JSON.stringify(record), "utf8");
  }
  return root;
}

const future = "2099-01-01T00:00:00.000Z";
const past = "2000-01-01T00:00:00.000Z";
const record = (over: Readonly<Record<string, unknown>> = {}) => ({
  status: "ok", role: "PATCH_PRODUCER", taskClass: "typescript",
  route: { provider: "groq", model: "qwen/qwen3.6-27b" }, expiresAt: future, ...over,
});

test("a current record grants exactly its own task class to its own route", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([record()]), new Date());
  assert.deepEqual([...observed.byRoute.keys()], ["groq:qwen/qwen3.6-27b"]);
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["typescript"]);
});

test("an expired record grants nothing and is counted as expired", async () => {
  // The validity window is the point: a stale pass stops being a claim rather
  // than becoming a weaker one.
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([record({ expiresAt: past })]), new Date());
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.expiredCount, 1);
});

test("UNQUALIFIED is a recorded fact and not a capability", async () => {
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([record({ role: "UNQUALIFIED" })]), new Date());
  assert.equal(observed.byRoute.size, 0);
});

test("a failed, malformed or unparseable record grants nothing", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    record({ status: "failed" }),
    record({ taskClass: "not-a-task-class" }),
    record({ route: { provider: "groq" } }),
    record({ expiresAt: "not-a-date" }),
  ]), new Date());
  assert.equal(observed.byRoute.size, 0, "no partial credit from a defective record");
});

test("a record may not grant a model feature under the guise of a task class", async () => {
  // `tool-call` is a real capability name, but of the wrong kind. Accepting it
  // here would let a stored file mint catalogue evidence -- the one direction
  // of borrowing a writable record could actually achieve.
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([record({ taskClass: "tool-call" })]), new Date());
  assert.equal(observed.byRoute.size, 0);
});

test("records accumulate per route and stay sorted and duplicate-free", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    record({ taskClass: "typescript" }),
    record({ taskClass: "node-test" }),
    record({ taskClass: "typescript" }),
    record({ taskClass: "cli-design", route: { provider: "cohere", model: "north-mini-code-1-0" } }),
  ]), new Date());
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["node-test", "typescript"]);
  assert.deepEqual(observed.byRoute.get("cohere:north-mini-code-1-0"), ["cli-design"]);
});

test("a repository with no qualification directory reports evaluated and empty", async () => {
  // Evaluated-and-none must be distinguishable from not-evaluated, or an empty
  // result would be read as an unknown one and then guessed at.
  const root = await mkdtemp(resolve(tmpdir(), "usf-qualification-empty-"));
  const observed = await observeQualifiedTaskClasses(root, new Date());
  assert.equal(observed.evaluated, true);
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.recordCount, 0);
});
