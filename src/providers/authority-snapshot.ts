import { canonicalDigest } from "../core/canonical.ts";
import type { AuthenticatedTransportCapability } from "./transports.ts";

/**
 * The semantic authority a route selection depends on. Only inputs that could
 * invalidate a selected route are included, so unrelated graph movement never
 * refuses an execution.
 *
 * This recovers the invariant behind V2's bracketed authority read: the
 * authority used to select an execution must still be current when that
 * execution begins. V3 mutates no tracked authority during model invocation, so
 * no transaction or rollback stack is required -- only a re-read and compare.
 */
export interface AuthoritySnapshot {
  readonly schema: "urn:usf:authority-snapshot:1";
  readonly catalogueRawDigest: string;
  readonly catalogueNormalizedDigest: string;
  readonly economicPolicyDigest: string;
  readonly economicAuthorizationDigest: string;
  readonly installedAdapterDigest: string;
  readonly suppliedCredentialNameDigest: string;
  readonly transportCapabilityDigest: string;
  /** Identity of the whole snapshot; equality of this value is the bracket. */
  readonly snapshotDigest: string;
  readonly coveredInputs: readonly string[];
  readonly nonClaims: readonly string[];
}

export interface AuthoritySnapshotInput {
  readonly catalogueRawDigest: string;
  readonly catalogueNormalizedDigest: string;
  readonly policy: unknown;
  readonly authorizations: unknown;
  readonly installedAdapterPackages: readonly string[];
  /** Names only; a credential value never enters a snapshot. */
  readonly suppliedCredentialNames: readonly string[];
  readonly transportCapabilities: readonly AuthenticatedTransportCapability[];
}

const coveredInputs = Object.freeze([
  "models.dev catalogue projection identity (raw and normalized digests)",
  "effective cost policy",
  "operator economic authorizations",
  "installed adapter package set",
  "supplied credential names",
  "local agent transport authentication metadata",
]);

export function readAuthoritySnapshot(input: AuthoritySnapshotInput): AuthoritySnapshot {
  const economicPolicyDigest = canonicalDigest(input.policy);
  const economicAuthorizationDigest = canonicalDigest(input.authorizations);
  const installedAdapterDigest = canonicalDigest([...input.installedAdapterPackages].sort());
  const suppliedCredentialNameDigest = canonicalDigest([...input.suppliedCredentialNames].sort());
  // Observation instants are excluded: a capability observed a second later is
  // the same authority, and including the instant would refuse every execution.
  const transportCapabilityDigest = canonicalDigest([...input.transportCapabilities]
    .map((capability) => Object.freeze({
      transport: capability.transport,
      authenticationKind: capability.authenticationKind,
      usable: capability.usable,
      reason: capability.reason,
      credentialName: capability.credentialName,
      executablePath: capability.executablePath,
      executableVersion: capability.executableVersion,
    }))
    .sort((left, right) => left.transport.localeCompare(right.transport)));

  const body = Object.freeze({
    catalogueRawDigest: input.catalogueRawDigest,
    catalogueNormalizedDigest: input.catalogueNormalizedDigest,
    economicPolicyDigest,
    economicAuthorizationDigest,
    installedAdapterDigest,
    suppliedCredentialNameDigest,
    transportCapabilityDigest,
  });

  return Object.freeze({
    schema: "urn:usf:authority-snapshot:1" as const,
    ...body,
    snapshotDigest: canonicalDigest(body),
    coveredInputs,
    nonClaims: Object.freeze([
      "This snapshot covers only the inputs that could invalidate a route selection. Unrelated graph or repository movement does not change it.",
      "No credential value, and no digest of a credential value, is included; credentials are covered by name only.",
    ]),
  });
}

/** Which covered inputs moved between two snapshots. */
export function snapshotDifference(before: AuthoritySnapshot, after: AuthoritySnapshot): readonly string[] {
  const fields = [
    "catalogueRawDigest", "catalogueNormalizedDigest", "economicPolicyDigest",
    "economicAuthorizationDigest", "installedAdapterDigest",
    "suppliedCredentialNameDigest", "transportCapabilityDigest",
  ] as const;
  return Object.freeze(fields.filter((field) => before[field] !== after[field]));
}
