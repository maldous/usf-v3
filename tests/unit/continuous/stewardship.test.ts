import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UsfError } from "../../../src/core/errors.ts";
import {
  acquireStewardActivity,
  claimStewardship,
  handoffStewardship,
  isExactRootUidMap,
  observeStewardship,
  releaseStewardship,
  renewStewardship,
  stewardshipReasonCodes,
  withOperationalExclusion,
  withStewardedOperation,
  withTransactionRecoveryExclusion,
  type StewardshipClock,
  type StewardshipDependencies,
} from "../../../src/continuous/stewardship.ts";
import type { ProcessIdentity, ProcessInspector } from "../../../src/continuous/lifecycle.ts";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const first: ProcessIdentity = Object.freeze({ pid: 41, uid: process.getuid?.() ?? 1000, bootId: "01234567-89ab-cdef-0123-456789abcdef", startTicks: "100", argvDigest: digest("a"), executablePathDigest: digest("b") });
const second: ProcessIdentity = Object.freeze({ ...first, pid: 42, startTicks: "101", argvDigest: digest("c") });

function refusal(code: string): (error: unknown) => boolean {
  return (error) => { assert.ok(error instanceof UsfError); assert.equal(error.code, code); return true; };
}

test("exact root UID mapping accepts bounded ASCII row whitespace only", () => {
  for (const accepted of [
    "1000 0 1",
    "1000 0 1\n",
    "   1000\t0   1  \n",
    "\t001000 00 01\r\n",
  ]) assert.equal(isExactRootUidMap(Buffer.from(accepted, "ascii")), true, accepted);

  for (const rejected of [
    "",
    "1000 0",
    "1000 0 2\n",
    "1001 0 1\n",
    "1000 1 1\n",
    "1000 0 1 extra\n",
    "1000 0 1\n1000 0 1\n",
    "1000 0 1\n\n",
    "1000 0 1\r",
    "1000\u00a00 1\n",
    `${" ".repeat(249)}1000 0 1\n`,
  ]) assert.equal(isExactRootUidMap(Buffer.from(rejected, "utf8")), false, JSON.stringify(rejected));
});

function dependencies(controller: ProcessIdentity, sessionId: string, now: () => number, live: Set<number>): StewardshipDependencies {
  const inspector: ProcessInspector = {
    current: async () => controller,
    inspect: async (pid) => live.has(pid) ? (pid === first.pid ? first : second) : null,
  };
  const clock: StewardshipClock = { monotonicSeconds: async () => now() };
  return {
    controller, sessionId, inspector, clock,
    adapters: {
      renewalPolicy: async () => ({ defaultSeconds: 300, minimumSeconds: 30, maximumSeconds: 1800 }),
      currentSupervisor: async () => null,
      pendingTransactions: async () => [],
      acquirePrimaryMutation: async () => ({ release: async () => undefined }),
    },
  };
}

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "usf-stewardship-"));
  await mkdir(join(root, ".usf"), { mode: 0o700 });
  await mkdir(join(root, "graph", "manifests"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "graph", "operational-stewardship.nq"), [
    '<urn:usf:operational-lifecycle:stewardship:1> <urn:usf:predicate:defaultRenewalSeconds> "300" <urn:usf:graph:operational-stewardship> .',
    '<urn:usf:operational-lifecycle:stewardship:1> <urn:usf:predicate:minimumRenewalSeconds> "30" <urn:usf:graph:operational-stewardship> .',
    '<urn:usf:operational-lifecycle:stewardship:1> <urn:usf:predicate:maximumRenewalSeconds> "1800" <urn:usf:graph:operational-stewardship> .',
    "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(join(root, "graph", "manifests", "operational-stewardship.json"), JSON.stringify({
    schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{ path: "graph/operational-stewardship.nq", format: "application/n-quads", graph: "urn:usf:graph:operational-stewardship", role: "contract", validationProfile: "bootstrap-nquads-v1" }],
  }), { mode: 0o600 });
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

test("same controlling session replays one generation while another live session refuses", async (t) => {
  const root = await temporaryRoot(t);
  let monotonic = 100;
  const live = new Set([first.pid, second.pid]);
  const one = dependencies(first, "session-one-0123456789", () => monotonic, live);
  const two = dependencies(second, "session-two-0123456789", () => monotonic, live);
  const claimed = await claimStewardship(root, { agent: "Codex", dependencies: one });
  const replayed = await claimStewardship(root, { agent: "Codex", dependencies: one });
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.record.generation, claimed.record.generation);
  await assert.rejects(claimStewardship(root, { agent: "Claude", dependencies: two }), refusal(stewardshipReasonCodes.OWNERSHIP_CONFLICT));
});

test("handoff supersedes the old generation and expired claims cannot renew or release", async (t) => {
  const root = await temporaryRoot(t);
  let monotonic = 100;
  const live = new Set([first.pid, second.pid]);
  const one = dependencies(first, "session-one-0123456789", () => monotonic, live);
  const two = dependencies(second, "session-two-0123456789", () => monotonic, live);
  const claimed = await claimStewardship(root, { agent: "Codex", dependencies: one });
  await assert.rejects(handoffStewardship(root, claimed.record.claimId, digest("f"), one), refusal(stewardshipReasonCodes.CLAIM_STALE));
  await handoffStewardship(root, claimed.record.claimId, claimed.record.generation, one);
  const replacement = await claimStewardship(root, { agent: "Claude", dependencies: two });
  await assert.rejects(withStewardedOperation(root, claimed.record.claimId, claimed.record.generation, async () => undefined, one), refusal(stewardshipReasonCodes.CLAIM_STALE));
  monotonic = 401;
  await assert.rejects(renewStewardship(root, replacement.record.claimId, replacement.record.generation, undefined, two), refusal(stewardshipReasonCodes.CLAIM_STALE));
  await assert.rejects(releaseStewardship(root, replacement.record.claimId, replacement.record.generation, two), refusal(stewardshipReasonCodes.CLAIM_STALE));
});

test("dead stewardship requires explicit recovery and boot-monotonic time controls expiry", async (t) => {
  const root = await temporaryRoot(t);
  let monotonic = 1;
  const live = new Set([first.pid]);
  const one = dependencies(first, "session-one-0123456789", () => monotonic, live);
  const two = dependencies(second, "session-two-0123456789", () => monotonic, live);
  await claimStewardship(root, { agent: "Codex", dependencies: one });
  live.delete(first.pid);
  await assert.rejects(claimStewardship(root, { agent: "Claude", dependencies: two }), refusal(stewardshipReasonCodes.RECOVERY_REQUIRED));
  live.add(second.pid);
  const recovered = await claimStewardship(root, { agent: "Claude", dependencies: two, recover: true });
  assert.equal(recovered.status, "recovered");
  monotonic = 999_999;
  assert.equal((await observeStewardship(root, two)).status, "expired");
});

test("activity lock serializes guarded work and legacy compatibility is atomic", async (t) => {
  const root = await temporaryRoot(t);
  const lock = await acquireStewardActivity(root);
  await assert.rejects(acquireStewardActivity(root), refusal(stewardshipReasonCodes.ACTIVITY_BUSY));
  await lock.release();
  let performed = false;
  await withOperationalExclusion(root, undefined, undefined, async () => { performed = true; }, { requireClaim: false, dependencies: dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid])) });
  assert.equal(performed, true);
  await assert.rejects(withOperationalExclusion(root, undefined, undefined, async () => undefined, { requireClaim: true, dependencies: dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid])) }), refusal(stewardshipReasonCodes.CLAIM_STALE));
});

test("a released or handed-off live controller permits only bounded transaction recovery before successor claim", async (t) => {
  const root = await temporaryRoot(t);
  let monotonic = 100;
  const live = new Set([first.pid, second.pid]);
  const one = dependencies(first, "session-one-0123456789", () => monotonic, live);
  const two = dependencies(second, "session-two-0123456789", () => monotonic, live);
  const claimed = await claimStewardship(root, { agent: "Codex", dependencies: one });
  await handoffStewardship(root, claimed.record.claimId, claimed.record.generation, one);
  let recovered = false;
  await withTransactionRecoveryExclusion(root, undefined, undefined, async () => { recovered = true; }, one);
  assert.equal(recovered, true);
  const successor = await claimStewardship(root, { agent: "Claude", dependencies: two });
  await releaseStewardship(root, successor.record.claimId, successor.record.generation, two);
  recovered = false;
  await withTransactionRecoveryExclusion(root, undefined, undefined, async () => { recovered = true; }, two);
  assert.equal(recovered, true);
});

test("ordinary operational exclusion refuses pending transactions before callbacks for absent and active claims", async (t) => {
  const root = await temporaryRoot(t);
  const pendingDirectory = join(root, ".usf", "transactions");
  await mkdir(pendingDirectory, { mode: 0o700 });
  await writeFile(join(pendingDirectory, `${"a".repeat(64)}.pending.json`), "{}\n", { mode: 0o600 });
  let called = false;
  const pending = (): StewardshipDependencies => ({ ...dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid])), adapters: { ...dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid])).adapters!, pendingTransactions: async () => ["pending"] } });
  await assert.rejects(withOperationalExclusion(root, undefined, undefined, async () => { called = true; }, { requireClaim: false, dependencies: pending() }), refusal(stewardshipReasonCodes.PENDING_TRANSACTION));
  assert.equal(called, false);
  await rm(join(pendingDirectory, `${"a".repeat(64)}.pending.json`));
  let monotonic = 100;
  const live = new Set([first.pid]);
  const one = dependencies(first, "session-one-0123456789", () => monotonic, live);
  const claim = await claimStewardship(root, { agent: "Codex", dependencies: one });
  await writeFile(join(pendingDirectory, `${"b".repeat(64)}.pending.json`), "{}\n", { mode: 0o600 });
  await assert.rejects(withOperationalExclusion(root, claim.record.claimId, claim.record.generation, async () => { called = true; }, { requireClaim: true, dependencies: { ...one, adapters: { ...one.adapters!, pendingTransactions: async () => ["pending"] } } }), refusal(stewardshipReasonCodes.PENDING_TRANSACTION));
  assert.equal(called, false);
});

test("unsafe record paths fail closed and status is read-only", async (t) => {
  const root = await temporaryRoot(t);
  const observer = dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid]));
  assert.equal((await observeStewardship(root, observer)).status, "absent");
  assert.equal((await observeStewardship(root, observer)).activeActivity, "absent");
  const directory = join(root, ".usf", "hermes", "stewardship");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(root, "outside.json"), "{}\n", { mode: 0o600 });
  await symlink(join(root, "outside.json"), join(directory, "record.json"));
  await assert.rejects(observeStewardship(root, observer), refusal(stewardshipReasonCodes.RECORD_UNSAFE));
});

test("hard-linked and malformed stewardship records refuse", async (t) => {
  const root = await temporaryRoot(t);
  const directory = join(root, ".usf", "hermes", "stewardship");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = join(directory, "source.json");
  await writeFile(source, "{}\n", { mode: 0o600 });
  await link(source, join(directory, "record.json"));
  await assert.rejects(observeStewardship(root, dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid]))), refusal(stewardshipReasonCodes.RECORD_UNSAFE));
  await rm(join(directory, "record.json"));
  await rm(source);
  await writeFile(join(directory, "record.json"), "{}\n", { mode: 0o600 });
  await assert.rejects(observeStewardship(root, dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid]))), refusal(stewardshipReasonCodes.RECORD_INVALID));
});

test("existing unsafe or redirected stewardship ancestors refuse even when the record is absent", async (t) => {
  const unsafe = await temporaryRoot(t);
  await mkdir(join(unsafe, ".usf", "hermes"), { mode: 0o700 });
  await chmod(join(unsafe, ".usf", "hermes"), 0o755);
  await assert.rejects(observeStewardship(unsafe, dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid]))), refusal(stewardshipReasonCodes.RECORD_UNSAFE));
  const redirected = await temporaryRoot(t);
  await mkdir(join(redirected, "elsewhere"), { mode: 0o700 });
  await symlink(join(redirected, "elsewhere"), join(redirected, ".usf", "hermes"));
  await assert.rejects(observeStewardship(redirected, dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid]))), refusal(stewardshipReasonCodes.RECORD_UNSAFE));
});

test("a genuinely missing private runtime subtree stays absent and read-only status creates no runtime state", async (t) => {
  const root = await temporaryRoot(t);
  const status = await observeStewardship(root, dependencies(first, "session-one-0123456789", () => 100, new Set([first.pid])));
  assert.equal(status.status, "absent");
  assert.equal(status.activeActivity, "absent");
  await assert.rejects(lstat(join(root, ".usf", "hermes")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
});
