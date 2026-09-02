import assert from "node:assert/strict";
import test from "node:test";

import { parseLifecycleArguments, superviseArguments } from "../../../src/commands/hermes-lifecycle.ts";

/**
 * The supervisor runs in a detached child, so every selection the operator made
 * has to reach it explicitly.
 *
 * Omitting one does not fail loudly. It starts a supervisor operating a
 * different profile from the one that was reported back, and the only visible
 * symptom is an authority identity that happens to match the previous run. That
 * is a silent failure with real consequence -- a foundation supervisor spending
 * provider budget on capabilities nobody selected -- so the forwarding is
 * asserted here rather than trusted.
 */
const defaultManifest = "graph/manifests/v3-delivery.json";
const productManifest = "graph/products/anqr/manifest.json";

function optionOf(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

test("the foundation manifest is the default selection", () => {
  const parsed = parseLifecycleArguments([]);
  assert.equal(parsed.manifest, defaultManifest);
  assert.equal(optionOf(superviseArguments(parsed), "--manifest"), defaultManifest);
});

test("a selected product manifest reaches the supervisor child", () => {
  const parsed = parseLifecycleArguments(["--manifest", productManifest]);
  assert.equal(parsed.manifest, productManifest);
  assert.equal(optionOf(superviseArguments(parsed), "--manifest"), productManifest);
});

test("every operator selection is forwarded, not only the manifest", () => {
  const parsed = parseLifecycleArguments([
    "--manifest", productManifest,
    "--env-file", ".usf/credentials/providers.env",
    "--pause-seconds", "90",
    "--concurrency", "3",
    "--limit", "6",
    "--useful-token-target", "250000",
  ]);
  const forwarded = superviseArguments(parsed);
  assert.equal(optionOf(forwarded, "--manifest"), productManifest);
  assert.equal(optionOf(forwarded, "--env-file"), ".usf/credentials/providers.env");
  assert.equal(optionOf(forwarded, "--pause-seconds"), "90");
  assert.equal(optionOf(forwarded, "--concurrency"), "3");
  assert.equal(optionOf(forwarded, "--limit"), "6");
  assert.equal(optionOf(forwarded, "--useful-token-target"), "250000");
});

test("the useful-token target is frozen at no less than the acceptance floor", () => {
  // GOAL 25.7: at least one hundred thousand, frozen before the run. The
  // default is exactly the floor, and an attempt to freeze a softer target is
  // refused rather than quietly rounded up.
  assert.equal(parseLifecycleArguments([]).usefulTokenTarget, 100_000);
  assert.equal(parseLifecycleArguments(["--useful-token-target", "150000"]).usefulTokenTarget, 150_000);
  assert.throws(() => parseLifecycleArguments(["--useful-token-target", "99999"]));
});

test("the forwarded arguments parse back to the same selection", () => {
  // A round trip is what actually proves the child receives the parent's
  // decision: a forwarded option the child's own parser would reject is not
  // forwarding, it is a crash waiting for the next start.
  const original = parseLifecycleArguments([
    "--manifest", productManifest, "--pause-seconds", "120", "--concurrency", "4", "--limit", "8",
  ]);
  const round = parseLifecycleArguments(superviseArguments(original));
  assert.equal(round.manifest, original.manifest);
  assert.equal(round.envFile, original.envFile);
  assert.equal(round.pauseSeconds, original.pauseSeconds);
  assert.equal(round.concurrency, original.concurrency);
  assert.equal(round.dispatchLimit, original.dispatchLimit);
});

test("an unknown option is refused rather than silently dropped", () => {
  assert.throws(() => parseLifecycleArguments(["--profile", "urn:anqr:profile-revision:2"]),
    /unique and explicit/u);
  assert.throws(() => parseLifecycleArguments(["--manifest"]), /Missing value/u);
  assert.throws(() => parseLifecycleArguments(["--manifest", "a", "--manifest", "b"]),
    /unique and explicit/u);
});
