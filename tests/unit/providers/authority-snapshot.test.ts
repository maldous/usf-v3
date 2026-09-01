import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readAuthoritySnapshot, snapshotDifference, type AuthoritySnapshotInput,
} from "../../../src/providers/authority-snapshot.ts";
import type { AuthenticatedTransportCapability } from "../../../src/providers/transports.ts";

function capability(usable: boolean, observedAt: string): AuthenticatedTransportCapability {
  return Object.freeze({
    schema: "urn:usf:authenticated-transport-capability:1",
    transport: "claude-cli", authenticationKind: "local-agent-session",
    usable, reason: null, credentialName: null,
    executablePath: "/usr/bin/claude", executableVersion: "1.0",
    observedAt, nonClaims: [],
  }) as AuthenticatedTransportCapability;
}

function input(overrides: Partial<AuthoritySnapshotInput> = {}): AuthoritySnapshotInput {
  return {
    catalogueRawDigest: `sha256:${"a".repeat(64)}`,
    catalogueNormalizedDigest: `sha256:${"b".repeat(64)}`,
    policy: { maximumPaidCost: 0, acceptedCostClasses: ["free-quota"] },
    authorizations: [{ transport: "vercel-ai-sdk", provider: "groq", entitlement: "free-quota" }],
    installedAdapterPackages: ["@ai-sdk/groq"],
    suppliedCredentialNames: ["GROQ_API_KEY"],
    transportCapabilities: [capability(true, "2026-09-01T00:00:00.000Z")],
    ...overrides,
  };
}

test("an unchanged authority yields an identical snapshot digest", () => {
  assert.equal(readAuthoritySnapshot(input()).snapshotDigest, readAuthoritySnapshot(input()).snapshotDigest);
});

test("a re-observation instant alone never moves the snapshot", () => {
  // Otherwise every dispatch would refuse: the capability is re-observed each time.
  const before = readAuthoritySnapshot(input());
  const after = readAuthoritySnapshot(input({ transportCapabilities: [capability(true, "2026-09-02T11:22:33.000Z")] }));
  assert.equal(before.snapshotDigest, after.snapshotDigest);
  assert.deepEqual(snapshotDifference(before, after), []);
});

test("each route-invalidating input moves the snapshot and is named", () => {
  const base = readAuthoritySnapshot(input());
  const cases: ReadonlyArray<readonly [Partial<AuthoritySnapshotInput>, string]> = [
    [{ catalogueRawDigest: `sha256:${"c".repeat(64)}` }, "catalogueRawDigest"],
    [{ policy: { maximumPaidCost: 5, acceptedCostClasses: ["paid"] } }, "economicPolicyDigest"],
    [{ authorizations: [] }, "economicAuthorizationDigest"],
    [{ installedAdapterPackages: [] }, "installedAdapterDigest"],
    [{ suppliedCredentialNames: [] }, "suppliedCredentialNameDigest"],
    [{ transportCapabilities: [capability(false, "2026-09-01T00:00:00.000Z")] }, "transportCapabilityDigest"],
  ];
  for (const [override, field] of cases) {
    const moved = readAuthoritySnapshot(input(override));
    assert.notEqual(moved.snapshotDigest, base.snapshotDigest, `${field} must move the snapshot`);
    assert.deepEqual(snapshotDifference(base, moved), [field]);
  }
});

test("a snapshot carries no credential value or digest of one", () => {
  const serialized = JSON.stringify(readAuthoritySnapshot(input()));
  assert.equal(serialized.includes("GROQ_API_KEY"), false, "credential names are digested, not embedded");
  assert.ok(readAuthoritySnapshot(input()).coveredInputs.length >= 6);
});

test("adapter and credential ordering does not affect identity", () => {
  const left = readAuthoritySnapshot(input({ installedAdapterPackages: ["@ai-sdk/groq", "@ai-sdk/cerebras"] }));
  const right = readAuthoritySnapshot(input({ installedAdapterPackages: ["@ai-sdk/cerebras", "@ai-sdk/groq"] }));
  assert.equal(left.snapshotDigest, right.snapshotDigest);
});
