import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { inspect } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  CredentialEnvError,
  loadCredentialEnvFile,
  parseProviderConfig,
  ProviderConfigError,
  providerCredentialNames,
} from "../../../src/providers/config.ts";

// The hermetic validation environment mounts the candidate tree read-only and
// grants exactly one writable scratch root, exported as TMPDIR. Resolving the
// ephemeral root from the launcher instead of from the repository root is what
// keeps this validation runnable under confinement without making any path in
// the checkout writable.
const runtimeRoot = join(tmpdir(), "usf-provider-config");

const route = Object.freeze({
  id: "groq:llama",
  family: "groq",
  provider: "groq",
  adapterPackage: "@ai-sdk/groq",
  credentialName: "GROQ_API_KEY",
  model: "llama-3.3-70b-versatile",
  capabilities: ["text", "structured-output"],
  privacy: ["public"],
  cost: "free-quota",
  entitlement: "free-quota",
  paidFallback: false,
  concurrency: 4,
  probeFreshnessSeconds: 900,
});

const config = (routes: readonly unknown[] = [route]): unknown => ({
  $schema: "urn:usf:providers:1",
  catalogueSource: "models.dev",
  routes,
});

async function withRuntimeDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(runtimeRoot, "provider-config-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The hermetic validation cage runs Node with `--permission` and exactly one
 * scoped `--allow-fs-write` for the launcher-supplied scratch root. Node reports
 * a scoped grant as *not* holding the full `fs.write` capability, which is how a
 * validation distinguishes the confined lane from the ordinary outer carrier.
 */
function confinedFileSystem(): boolean {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  return permission !== undefined && !permission.has("fs.write");
}

function skipOutsideOuterLane(context: TestContext, why: string): boolean {
  if (!confinedFileSystem()) return false;
  context.skip(why);
  return true;
}

function reason(error: unknown): string | undefined {
  return error instanceof ProviderConfigError || error instanceof CredentialEnvError
    ? error.reasonCode
    : undefined;
}

test("provider config is closed, bounded and retains route/model identity separately", () => {
  const parsed = parseProviderConfig(config());
  assert.equal(parsed.routes[0]?.id, "groq:llama");
  assert.equal(parsed.routes[0]?.provider, "groq");
  assert.equal(parsed.routes[0]?.model, "llama-3.3-70b-versatile");
  assert.deepEqual(providerCredentialNames(parsed), ["GROQ_API_KEY"]);
  assert.throws(
    () => parseProviderConfig({ ...(config() as object), unexpected: true }),
    (error) => reason(error) === "PROVIDER_CONFIG_INVALID",
  );
  assert.throws(
    () => parseProviderConfig(config([{ ...route, extra: true }])),
    (error) => reason(error) === "PROVIDER_CONFIG_INVALID",
  );
  assert.throws(
    () => parseProviderConfig(config([{ ...route, concurrency: Number.POSITIVE_INFINITY }])),
    (error) => reason(error) === "PROVIDER_CONFIG_INVALID",
  );
});

test("provider config rejects duplicate semantic routes and repeated classifications", () => {
  const cases: readonly [unknown, string][] = [
    [config([route, { ...route }]), "PROVIDER_CONFIG_DUPLICATE_ROUTE"],
    [config([{ ...route, capabilities: ["text", "text"] }]), "PROVIDER_CONFIG_DUPLICATE_CAPABILITY"],
    [config([{ ...route, privacy: ["public", "public"] }]), "PROVIDER_CONFIG_DUPLICATE_PRIVACY"],
    [config([{ ...route, capabilities: [] }]), "PROVIDER_CONFIG_INVALID"],
    [config([{ ...route, privacy: [] }]), "PROVIDER_CONFIG_INVALID"],
  ];
  for (const [candidate, expected] of cases) {
    assert.throws(() => parseProviderConfig(candidate), (error) => reason(error) === expected);
  }
});

test("credential loader retains only allowlisted values and public metadata cannot disclose them", async () => {
  await withRuntimeDirectory(async (directory) => {
    const envPath = join(directory, "selected.env");
    await writeFile(envPath, "# selected credentials\nOTHER_SECRET=not-retained\nGROQ_API_KEY='private-token'\n", { mode: 0o600 });
    const loaded = await loadCredentialEnvFile(envPath, ["MISTRAL_API_KEY", "GROQ_API_KEY"]);

    assert.equal(loaded.getCredential("GROQ_API_KEY"), "private-token");
    assert.equal(loaded.getCredential("MISTRAL_API_KEY"), undefined);
    assert.deepEqual(loaded.metadata, {
      credentials: [
        { name: "GROQ_API_KEY", present: true },
        { name: "MISTRAL_API_KEY", present: false },
      ],
    });
    assert.doesNotMatch(JSON.stringify(loaded), /private-token|not-retained/);
    assert.doesNotMatch(inspect(loaded), /private-token|not-retained/);
    assert.throws(
      () => loaded.getCredential("OTHER_SECRET"),
      (error) => reason(error) === "CREDENTIAL_NAME_NOT_ALLOWLISTED",
    );
  });
});

test("credential loader refuses insecure-mode, duplicate, blank and invalid files", async () => {
  await withRuntimeDirectory(async (directory) => {
    const target = join(directory, "target.env");
    await writeFile(target, "GROQ_API_KEY=value\n", { mode: 0o600 });

    await chmod(target, 0o640);
    await assert.rejects(
      loadCredentialEnvFile(target, ["GROQ_API_KEY"]),
      (error) => reason(error) === "CREDENTIAL_ENV_REFUSED",
    );

    const invalidCases: readonly [string, string][] = [
      ["GROQ_API_KEY=one\nGROQ_API_KEY=two\n", "CREDENTIAL_ENV_DUPLICATE"],
      ["GROQ_API_KEY=\n", "CREDENTIAL_ENV_INVALID"],
      ["export GROQ_API_KEY=value\n", "CREDENTIAL_ENV_INVALID"],
      ["GROQ_API_KEY= value\n", "CREDENTIAL_ENV_INVALID"],
    ];
    for (const [content, expected] of invalidCases) {
      const candidate = join(directory, `case-${expected}-${content.length}.env`);
      await writeFile(candidate, content, { mode: 0o600 });
      await assert.rejects(
        loadCredentialEnvFile(candidate, ["GROQ_API_KEY"]),
        (error) => reason(error) === expected,
      );
    }
  });
});

test("credential values use literal KEY=VALUE parsing without expansion", async () => {
  await withRuntimeDirectory(async (directory) => {
    const envPath = join(directory, "literal.env");
    const literal = "$(printf should-not-run)=$OTHER";
    await writeFile(envPath, `GROQ_API_KEY=${literal}\n`, { mode: 0o600 });
    const loaded = await loadCredentialEnvFile(envPath, ["GROQ_API_KEY"]);
    assert.equal(loaded.getCredential("GROQ_API_KEY"), literal);
  });
});

// `fs.symlink` requires the full unscoped fs read+write capability, so it is
// categorically unavailable under `--permission` no matter how the scratch root
// is scoped. The symlink refusal therefore stays in the ordinary outer carrier
// lane behind the same guard the repository already uses for cage-incompatible
// coverage, rather than weakening confinement to reach it.
test("credential loader refuses a symlinked credential file", async (t) => {
  if (skipOutsideOuterLane(t, "fs.symlink needs full fs permissions; asserted in the outer authoritative lane")) return;
  await withRuntimeDirectory(async (directory) => {
    const target = join(directory, "target.env");
    await writeFile(target, "GROQ_API_KEY=value\n", { mode: 0o600 });
    const link = join(directory, "link.env");
    await symlink(target, link);
    await assert.rejects(
      loadCredentialEnvFile(link, ["GROQ_API_KEY"]),
      (error) => reason(error) === "CREDENTIAL_ENV_REFUSED",
    );
  });
});

// The declared ephemeral write effect of urn:usf:environment:hermetic, proved
// from both sides: writes beneath the launcher-supplied scratch root succeed,
// and a write anywhere else in the confined tree still fails closed.
test("the declared scratch root is writable and the repository tree is not", async (t) => {
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const scratchFile = join(runtimeRoot, "scratch-boundary-probe");
  await writeFile(scratchFile, "ephemeral\n", { mode: 0o600 });
  await rm(scratchFile, { force: true });

  if (!confinedFileSystem()) {
    t.diagnostic("outer lane: the repository-tree refusal is asserted only inside the confined cage");
    return;
  }
  await assert.rejects(
    writeFile(join(process.cwd(), ".usf-scratch-boundary-probe"), "x\n", { mode: 0o600 }),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ERR_ACCESS_DENIED",
  );
  await assert.rejects(
    writeFile(join(process.cwd(), "src", ".usf-scratch-boundary-probe"), "x\n", { mode: 0o600 }),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ERR_ACCESS_DENIED",
  );
});
