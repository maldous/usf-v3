import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { UsfError } from "../../src/core/errors.ts";
import { providerReceiptsCommandHandler, readContainedProviderReceiptFile } from "../../src/commands/provider-receipts.ts";

const root = new URL("../..", import.meta.url).pathname.replace(/\/$/u, "");
const scope = [
  "--route", "groq-qwen3.6-27b",
  "--profile", "urn:usf:profile:v3-self-host:3",
  "--manifest", "graph/manifests/self-host-provider-v3.json",
] as const;

function refusal(args: readonly string[]): string | undefined {
  try {
    providerReceiptsCommandHandler({ command: "providers", args, repositoryRoot: root });
    return undefined;
  } catch (error) {
    return error instanceof UsfError ? error.code : undefined;
  }
}

test("receipt CLI is exact-scope, no-contact and locally contained", () => {
  let contacts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    contacts += 1;
    throw new Error("provider contact forbidden in fixture validation");
  }) as typeof fetch;
  try {
    const cases: readonly [string, readonly string[], string][] = [
      ["acquisition permission", ["acquire", ...scope], "PROVIDERS_RECEIPT_PROOFBLOCKED"],
      ["arbitrary receipt path", ["verify", ...scope, "--receipt", ".usf/inputs/caller.json"], "PROVIDERS_RECEIPT_PATH_REFUSED"],
      ["missing receipt", ["verify", ...scope], "PROVIDERS_RECEIPT_ARGUMENTS_INVALID"],
      ["unversioned profile", ["acquire", "--route", "groq-qwen3.6-27b", "--profile", "urn:usf:profile:v3-self-host", "--manifest", "graph/manifests/self-host-provider-v3.json"], "PROVIDERS_RECEIPT_ARGUMENTS_INVALID"],
    ];
    for (const [label, args, expected] of cases) assert.equal(refusal(args), expected, label);
    assert.equal(contacts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route-local receipt storage refuses an intermediate symlink escape", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "usf-provider-receipt-root-"));
  const outsideRoot = mkdtempSync(resolve(tmpdir(), "usf-provider-receipt-outside-"));
  const route = "a".repeat(64);
  const receipt = "b".repeat(64);
  try {
    const privateDirectories = [
      ".usf",
      ".usf/provider-operations",
      ".usf/provider-operations/routes",
    ];
    for (const directory of privateDirectories) {
      const absolute = resolve(fixtureRoot, directory);
      mkdirSync(absolute, { recursive: true, mode: 0o700 });
      chmodSync(absolute, 0o700);
    }
    mkdirSync(resolve(outsideRoot, "account"), { mode: 0o700 });
    writeFileSync(resolve(outsideRoot, "account", `${receipt}.json`), "{}\n", { mode: 0o600 });
    symlinkSync(outsideRoot, resolve(fixtureRoot, ".usf/provider-operations/routes", route));

    assert.throws(
      () => readContainedProviderReceiptFile(
        fixtureRoot,
        `.usf/provider-operations/routes/${route}/account/${receipt}.json`,
        256 * 1024,
        true,
      ),
      (error: unknown) => error instanceof UsfError && error.code === "PROVIDERS_RECEIPT_PATH_REFUSED",
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});
