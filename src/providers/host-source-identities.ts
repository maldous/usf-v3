import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import {
  accountSourceKeyDigest,
  AccountSourceError,
  parseAccountSourceKey,
  type AccountSourceKey,
  type AccountSourceTransport,
} from "./account-sources.ts";

/**
 * Stable, secret-safe identity for a subscription-host account source.
 *
 * The point of this module is a source key that survives routine host
 * re-authentication. A host authorization expires and is reissued constantly;
 * if its digest were part of the source identity, every reissue would look like
 * a new account source and force needless reacquisition. So the stable identity
 * hashes only the mapping, the credential-file identity, the executable
 * identity and the authentication mode, and the current host authorization
 * binds separately at projection and use time.
 *
 * No credential value is ever read. The credential file is opened no-follow and
 * never read: only its metadata identity is hashed, and the path itself is
 * excluded so an equivalent file at a different location does not change the
 * identity while a substituted file does.
 *
 * Nothing here launches the host executable, logs in, or contacts a provider.
 */

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const instantPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,191}$/u;
const claimPattern = /^[a-z0-9][a-z0-9-]{0,127}$/u;

export type HostIdentityDisposition = "stable" | "unstable" | "unavailable" | "refused";
const hostIdentityDispositions = new Set<HostIdentityDisposition>(["stable", "unstable", "unavailable", "refused"]);

export type HostSourceIdentityCode =
  | "HOST_SOURCE_ROOT_REFUSED"
  | "HOST_SOURCE_CREDENTIAL_FILE_REFUSED"
  | "HOST_SOURCE_CREDENTIAL_FILE_MOVED"
  | "HOST_SOURCE_IDENTITY_MALFORMED"
  | "HOST_SOURCE_IDENTITY_UNSTABLE";

export class HostSourceIdentityError extends Error {
  readonly code: HostSourceIdentityCode;
  constructor(code: HostSourceIdentityCode, message: string) {
    super(message);
    this.name = "HostSourceIdentityError";
    this.code = code;
  }
}

function malformed(what: string): never {
  throw new HostSourceIdentityError("HOST_SOURCE_IDENTITY_MALFORMED", `The host source identity record is malformed: ${what}.`);
}

function matching(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== "string" || !pattern.test(value)) malformed(what);
  return value;
}

/**
 * The nine metadata attributes that must agree before, at and after the open.
 * Comparing fewer would let a file be swapped inside the observation window.
 */
export interface FileIdentityFacts {
  readonly device: string;
  readonly inode: string;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly links: number;
  readonly size: string;
  readonly modifiedNanoseconds: string;
  readonly changedNanoseconds: string;
}

function identityFacts(stats: { dev: bigint | number; ino: bigint | number; uid: bigint | number; gid: bigint | number; mode: bigint | number; nlink: bigint | number; size: bigint | number; mtimeNs?: bigint; ctimeNs?: bigint }): FileIdentityFacts {
  return Object.freeze({
    device: String(stats.dev),
    inode: String(stats.ino),
    uid: Number(stats.uid),
    gid: Number(stats.gid),
    mode: Number(stats.mode) & 0o7777,
    links: Number(stats.nlink),
    size: String(stats.size),
    modifiedNanoseconds: String(stats.mtimeNs ?? 0n),
    changedNanoseconds: String(stats.ctimeNs ?? 0n),
  });
}

function sameIdentity(left: FileIdentityFacts, right: FileIdentityFacts): boolean {
  return (Object.keys(left) as (keyof FileIdentityFacts)[]).every((field) => left[field] === right[field]);
}

/**
 * Owner-controlled provider state root: canonical, owner-owned, owner-rwx and
 * never world-writable. Lexical containment is not enough, so the realpath must
 * equal the lexical path.
 */
export function authenticateProviderStateRoot(directory: string): string {
  if (!isAbsolute(directory) || directory.includes("\0")) {
    throw new HostSourceIdentityError("HOST_SOURCE_ROOT_REFUSED", "The provider state root must be one absolute path.");
  }
  const lexical = resolve(directory);
  let canonical: string;
  let entry;
  try {
    entry = lstatSync(lexical, { bigint: true });
    canonical = realpathSync(lexical);
  } catch {
    throw new HostSourceIdentityError("HOST_SOURCE_ROOT_REFUSED", "The provider state root is unavailable.");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const mode = Number(entry.mode) & 0o7777;
  if (canonical !== lexical || entry.isSymbolicLink() || !entry.isDirectory() || uid === undefined
    || Number(entry.uid) !== uid || (mode & 0o700) !== 0o700 || (mode & 0o002) !== 0 || (mode & 0o7000) !== 0) {
    throw new HostSourceIdentityError("HOST_SOURCE_ROOT_REFUSED", "The provider state root is not an owner-controlled directory.");
  }
  return canonical;
}

/**
 * Hash the credential file's identity without reading one byte of it.
 *
 * The path is deliberately excluded from the digest: the identity is the file,
 * not where it happens to live. Opening no-follow and comparing the pre-open
 * lstat, the opened descriptor's fstat and a post-observation fstat closes the
 * window in which a symlink or a replacement could substitute a different file.
 */
export function credentialFileIdentityDigest(path: string): `sha256:${string}` {
  if (!isAbsolute(path) || path.includes("\0")) {
    throw new HostSourceIdentityError("HOST_SOURCE_CREDENTIAL_FILE_REFUSED", "The credential member must be one absolute path.");
  }
  let before: FileIdentityFacts;
  try { before = identityFacts(lstatSync(path, { bigint: true })); }
  catch { throw new HostSourceIdentityError("HOST_SOURCE_CREDENTIAL_FILE_REFUSED", "The credential member is unavailable."); }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid === undefined || before.uid !== uid || before.mode !== 0o600 || before.links !== 1) {
    throw new HostSourceIdentityError("HOST_SOURCE_CREDENTIAL_FILE_REFUSED", "The credential member is not one owner-private single-link regular file.");
  }
  let descriptor: number;
  try { descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK); }
  catch { throw new HostSourceIdentityError("HOST_SOURCE_CREDENTIAL_FILE_REFUSED", "The credential member could not be opened without following a link."); }
  try {
    const opened = identityFacts(fstatSync(descriptor, { bigint: true }));
    const after = identityFacts(fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(before, opened) || !sameIdentity(opened, after)) {
      throw new HostSourceIdentityError("HOST_SOURCE_CREDENTIAL_FILE_MOVED", "The credential member changed identity during observation.");
    }
    // Only non-secret metadata, and never the path, enters the digest.
    return canonicalDigest({ kind: "credential-file-identity", ...opened });
  } finally {
    closeSync(descriptor);
  }
}

export interface HostSourceIdentity {
  readonly schema: "urn:usf:provider-host-source-identity:1";
  readonly version: 1;
  readonly accountSourceKeyDigest: string;
  readonly sourceKind: "subscription-host";
  readonly transport: AccountSourceTransport;
  readonly provider: string;
  readonly mappingDigest: string;
  readonly credentialMode: "host-authenticated";
  readonly credentialFileIdentityDigest: string | null;
  readonly executableIdentityDigest: string | null;
  readonly authenticationModeDigest: string;
  readonly credentialSourceIdentityDigest: string;
  readonly observedAt: string;
  readonly disposition: HostIdentityDisposition;
  readonly nonClaims: readonly string[];
}

const identityFields = Object.freeze([
  "schema", "version", "accountSourceKeyDigest", "sourceKind", "transport", "provider",
  "mappingDigest", "credentialMode", "credentialFileIdentityDigest", "executableIdentityDigest",
  "authenticationModeDigest", "credentialSourceIdentityDigest", "observedAt", "disposition", "nonClaims",
] as const);

export interface StableHostIdentityInput {
  readonly transport: AccountSourceTransport;
  readonly provider: string;
  readonly mappingDigest: string;
  readonly credentialFileIdentityDigest: string | null;
  readonly executableIdentityDigest: string | null;
  readonly authenticationModeDigest: string;
}

/**
 * The stable credential-source identity: mapping plus the three identity
 * digests, and nothing else. No expiring host authorization, no timestamp and
 * no account label participate, which is exactly why routine re-authentication
 * leaves the source key unchanged.
 */
export function credentialSourceIdentityDigest(input: StableHostIdentityInput): `sha256:${string}` {
  matching(input.provider, identifierPattern, "provider");
  matching(input.mappingDigest, digestPattern, "mapping digest");
  matching(input.authenticationModeDigest, digestPattern, "authentication mode digest");
  if (input.credentialFileIdentityDigest !== null) matching(input.credentialFileIdentityDigest, digestPattern, "credential file identity digest");
  if (input.executableIdentityDigest !== null) matching(input.executableIdentityDigest, digestPattern, "executable identity digest");
  // A host source with neither a credential file nor an executable has no
  // stable identity at all, and must stay ineligible rather than borrow an
  // expiring authorization digest as its key.
  if (input.credentialFileIdentityDigest === null && input.executableIdentityDigest === null) {
    throw new HostSourceIdentityError("HOST_SOURCE_IDENTITY_UNSTABLE", "A host source needs a credential-file or executable identity to be stable.");
  }
  return canonicalDigest({
    kind: "host-credential-source-identity",
    transport: input.transport,
    provider: input.provider,
    mappingDigest: input.mappingDigest,
    credentialFileIdentityDigest: input.credentialFileIdentityDigest,
    executableIdentityDigest: input.executableIdentityDigest,
    authenticationModeDigest: input.authenticationModeDigest,
  });
}

/** Rebuild the profile-independent account-source key for a host source. */
export function hostAccountSourceKey(
  input: StableHostIdentityInput & { readonly controlPlaneIdentity: string; readonly credentialName: string; readonly accountSourceProtocolDigest: string },
): AccountSourceKey {
  return parseAccountSourceKey({
    sourceKind: "subscription-host",
    transport: input.transport,
    provider: input.provider,
    controlPlaneIdentity: input.controlPlaneIdentity,
    responseMappingDigest: input.mappingDigest,
    credentialMode: "host-authenticated",
    credentialName: input.credentialName,
    credentialSourceIdentityDigest: credentialSourceIdentityDigest(input),
    accountSourceProtocolDigest: input.accountSourceProtocolDigest,
  });
}

export function parseHostSourceIdentity(value: unknown): HostSourceIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) malformed("record");
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source).sort();
  const expected = [...identityFields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) malformed("field set");
  if (source.schema !== "urn:usf:provider-host-source-identity:1" || source.version !== 1) malformed("identity");
  if (source.sourceKind !== "subscription-host" || source.credentialMode !== "host-authenticated") malformed("host source kind");
  const credentialFileIdentityDigest_ = source.credentialFileIdentityDigest === null ? null : matching(source.credentialFileIdentityDigest, digestPattern, "credential file identity digest");
  const executableIdentityDigest = source.executableIdentityDigest === null ? null : matching(source.executableIdentityDigest, digestPattern, "executable identity digest");
  const transport = source.transport;
  if (transport !== "codex-cli" && transport !== "claude-cli" && transport !== "direct-sdk" && transport !== "openrouter") malformed("transport");
  const stable: StableHostIdentityInput = {
    transport,
    provider: matching(source.provider, identifierPattern, "provider"),
    mappingDigest: matching(source.mappingDigest, digestPattern, "mapping digest"),
    credentialFileIdentityDigest: credentialFileIdentityDigest_,
    executableIdentityDigest,
    authenticationModeDigest: matching(source.authenticationModeDigest, digestPattern, "authentication mode digest"),
  };
  const declared = matching(source.credentialSourceIdentityDigest, digestPattern, "credential source identity digest");
  // The caller does not get to name the identity: it is recomputed and compared.
  if (declared !== credentialSourceIdentityDigest(stable)) {
    throw new HostSourceIdentityError("HOST_SOURCE_IDENTITY_MALFORMED", "The declared credential-source identity digest does not match its own members.");
  }
  const disposition = source.disposition;
  if (typeof disposition !== "string" || !hostIdentityDispositions.has(disposition as HostIdentityDisposition)) malformed("disposition");
  if (!Array.isArray(source.nonClaims) || source.nonClaims.length > 64) malformed("non-claims");
  return Object.freeze({
    schema: "urn:usf:provider-host-source-identity:1" as const,
    version: 1 as const,
    accountSourceKeyDigest: matching(source.accountSourceKeyDigest, digestPattern, "account source key digest"),
    sourceKind: "subscription-host" as const,
    transport,
    provider: stable.provider,
    mappingDigest: stable.mappingDigest,
    credentialMode: "host-authenticated" as const,
    credentialFileIdentityDigest: credentialFileIdentityDigest_,
    executableIdentityDigest,
    authenticationModeDigest: stable.authenticationModeDigest,
    credentialSourceIdentityDigest: declared,
    observedAt: matching(source.observedAt, instantPattern, "observedAt"),
    disposition: disposition as HostIdentityDisposition,
    nonClaims: Object.freeze(source.nonClaims.map((claim) => matching(claim, claimPattern, "non-claim"))),
  });
}

export function hostSourceIdentityDigest(value: HostSourceIdentity): `sha256:${string}` {
  return canonicalDigest({ ...value });
}

/**
 * Cross-check a parsed host identity against the account-source key it claims.
 * A host identity that names a key it does not reconstruct is not evidence for
 * that source, however internally consistent it looks.
 */
export function hostSourceIdentityMatchesKey(identity: HostSourceIdentity, key: AccountSourceKey): boolean {
  try {
    return identity.accountSourceKeyDigest === accountSourceKeyDigest(key)
      && key.credentialSourceIdentityDigest === identity.credentialSourceIdentityDigest
      && key.transport === identity.transport
      && key.provider === identity.provider;
  } catch (error) {
    if (error instanceof AccountSourceError) return false;
    throw error;
  }
}

/** Repository containment for an ignored route-local record path. */
export function containedRecordPath(repositoryRoot: string, repositoryPath: string): string {
  if (repositoryPath.length === 0 || repositoryPath.includes("\0") || repositoryPath.includes("\\") || isAbsolute(repositoryPath)
    || repositoryPath.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new HostSourceIdentityError("HOST_SOURCE_ROOT_REFUSED", "The record path is not canonical.");
  }
  const canonicalRoot = realpathSync(resolve(repositoryRoot));
  const absolute = resolve(canonicalRoot, repositoryPath);
  if (!absolute.startsWith(canonicalRoot + sep)) {
    throw new HostSourceIdentityError("HOST_SOURCE_ROOT_REFUSED", "The record path escapes the repository.");
  }
  return absolute;
}
