import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { canonicalDigest } from "../core/canonical.ts";

const runFile = promisify(execFile);

/**
 * V3 separates model discovery from execution transport. A transport is a
 * mechanism that can carry one invocation to a real model under an identity
 * this host already holds. Transports authenticate differently on purpose: an
 * API-adapter transport needs an owner-private credential, whereas a local
 * agent CLI is already authenticated as the operator. Nothing here requires a
 * provider to publish a machine-readable account-tier endpoint.
 */
/**
 * The closed set of execution transports.
 *
 * Exported as a value so no consumer restates it. A parser that restated it
 * fell behind when antigravity-cli was added and dropped its authorization
 * silently, which presented as the transport simply never being chosen.
 */
export const executionTransportIds = ["vercel-ai-sdk", "claude-cli", "codex-cli", "antigravity-cli"] as const;
export type ExecutionTransportId = (typeof executionTransportIds)[number];

/**
 * Host-agent transports: every transport that is not the API-adapter one.
 * Derived rather than restated, so adding a transport reaches every consumer.
 */
export const localAgentTransportIds = Object.freeze(
  executionTransportIds.filter((id) => id !== "vercel-ai-sdk"),
) as readonly Exclude<ExecutionTransportId, "vercel-ai-sdk">[];

export type TransportAuthenticationKind =
  | "owner-private-credential-file"
  | "local-agent-session";

export type TransportUnavailableReason =
  | "ADAPTER_NOT_INSTALLED"
  | "CREDENTIAL_FILE_ABSENT"
  | "CREDENTIAL_NAME_ABSENT"
  | "EXECUTABLE_ABSENT"
  | "SESSION_MATERIAL_ABSENT"
  | "SESSION_MATERIAL_INSECURE";

export interface TransportDescriptor {
  readonly transport: ExecutionTransportId;
  readonly authenticationKind: TransportAuthenticationKind;
  /** Absolute path of the executable a CLI transport requires, when applicable. */
  readonly executable: string | null;
  /** Home-relative path of the session material a CLI transport requires. */
  readonly sessionMaterial: string | null;
}

export const transportDescriptors: Readonly<Record<ExecutionTransportId, TransportDescriptor>> = Object.freeze({
  "vercel-ai-sdk": Object.freeze({
    transport: "vercel-ai-sdk" as const,
    authenticationKind: "owner-private-credential-file" as const,
    executable: null,
    sessionMaterial: null,
  }),
  "claude-cli": Object.freeze({
    transport: "claude-cli" as const,
    authenticationKind: "local-agent-session" as const,
    executable: "claude",
    sessionMaterial: ".claude/.credentials.json",
  }),
  "codex-cli": Object.freeze({
    transport: "codex-cli" as const,
    authenticationKind: "local-agent-session" as const,
    executable: "codex",
    sessionMaterial: ".codex/auth.json",
  }),
  "antigravity-cli": Object.freeze({
    transport: "antigravity-cli" as const,
    authenticationKind: "local-agent-session" as const,
    executable: "agy",
    // The CLI keeps its OAuth material under a directory named for the product,
    // not for the binary. Only existence is ever checked.
    sessionMaterial: ".gemini/antigravity-cli/antigravity-oauth-token",
  }),
});

/**
 * A capability observation proves only that this transport is currently usable
 * under an authorized local identity. It never carries, hashes or reveals the
 * secret itself; a credential is described by name and by the mode of the file
 * that holds it.
 */
export interface AuthenticatedTransportCapability {
  readonly schema: "urn:usf:authenticated-transport-capability:1";
  readonly transport: ExecutionTransportId;
  readonly authenticationKind: TransportAuthenticationKind;
  readonly usable: boolean;
  readonly reason: TransportUnavailableReason | null;
  /** Credential name for an adapter transport; null for a local session transport. */
  readonly credentialName: string | null;
  /** Resolved executable identity for a CLI transport; null otherwise. */
  readonly executablePath: string | null;
  readonly executableVersion: string | null;
  readonly observedAt: string;
  readonly nonClaims: readonly string[];
}

const capabilityNonClaims = Object.freeze([
  "This observation proves only that the transport is presently usable under an authorized local identity. It carries no secret value or digest of a secret.",
  "It asserts no account tier, balance, subscription state, quota remaining or paid-usage entitlement; economics are evaluated separately.",
]);

function capability(
  transport: ExecutionTransportId,
  observedAt: string,
  usable: boolean,
  reason: TransportUnavailableReason | null,
  extra: Partial<Pick<AuthenticatedTransportCapability, "credentialName" | "executablePath" | "executableVersion">> = {},
): AuthenticatedTransportCapability {
  return Object.freeze({
    schema: "urn:usf:authenticated-transport-capability:1" as const,
    transport,
    authenticationKind: transportDescriptors[transport].authenticationKind,
    usable,
    reason,
    credentialName: extra.credentialName ?? null,
    executablePath: extra.executablePath ?? null,
    executableVersion: extra.executableVersion ?? null,
    observedAt,
    nonClaims: capabilityNonClaims,
  });
}

async function secureOwnerFile(path: string): Promise<"ok" | TransportUnavailableReason> {
  const metadata = await lstat(path).catch(() => undefined);
  if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) return "SESSION_MATERIAL_ABSENT";
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid === undefined || metadata.uid !== uid || (metadata.mode & 0o077) !== 0) return "SESSION_MATERIAL_INSECURE";
  return "ok";
}

async function executableIdentity(name: string): Promise<Readonly<{ path: string; version: string | null }> | undefined> {
  // Resolve from PATH directly. Spawning a shell to locate the executable would
  // concatenate rather than escape its argument.
  const searchPath = (process.env.PATH ?? "").split(":").filter((entry) => entry.length > 0);
  let located: string | undefined;
  for (const directory of searchPath) {
    const candidate = resolve(directory, name);
    const metadata = await lstat(candidate).catch(() => undefined);
    if (metadata !== undefined && (metadata.isFile() || metadata.isSymbolicLink())) { located = candidate; break; }
  }
  if (located === undefined) return undefined;
  const canonical = await realpath(located).catch(() => undefined);
  if (canonical === undefined) return undefined;
  const version = await runFile(located, ["--version"], { timeout: 15_000, maxBuffer: 64 * 1024, encoding: "utf8" })
    .then((result) => result.stdout.trim().split("\n", 1)[0] ?? null)
    .catch(() => null);
  return Object.freeze({ path: canonical, version });
}

export interface CredentialFilePresence {
  readonly present: boolean;
  readonly names: readonly string[];
}

/**
 * Observe which credential names an owner-private credential file supplies,
 * without retaining any value. The caller supplies the already-validated
 * environment loader result so this module never parses secrets itself.
 */
export function credentialPresence(names: readonly string[], available: readonly string[]): CredentialFilePresence {
  const supplied = new Set(available);
  return Object.freeze({
    present: names.some((name) => supplied.has(name)),
    names: Object.freeze([...names].filter((name) => supplied.has(name)).sort()),
  });
}

export interface TransportObservationInput {
  readonly repositoryRoot: string;
  readonly homeDirectory: string;
  readonly observedAt: string;
  /** Credential names the owner-private credential file actually supplied. */
  readonly suppliedCredentialNames: readonly string[];
  /** Credential name the selected adapter route requires. */
  readonly requiredCredentialName: string | null;
  /** Whether the adapter package for an adapter route is installed. */
  readonly adapterInstalled: boolean;
}

export async function observeTransportCapability(
  transport: ExecutionTransportId,
  input: TransportObservationInput,
): Promise<AuthenticatedTransportCapability> {
  const descriptor = transportDescriptors[transport];
  if (descriptor.authenticationKind === "owner-private-credential-file") {
    if (!input.adapterInstalled) return capability(transport, input.observedAt, false, "ADAPTER_NOT_INSTALLED");
    const required = input.requiredCredentialName;
    if (required === null) return capability(transport, input.observedAt, false, "CREDENTIAL_NAME_ABSENT");
    if (input.suppliedCredentialNames.length === 0) {
      return capability(transport, input.observedAt, false, "CREDENTIAL_FILE_ABSENT", { credentialName: required });
    }
    if (!input.suppliedCredentialNames.includes(required)) {
      return capability(transport, input.observedAt, false, "CREDENTIAL_NAME_ABSENT", { credentialName: required });
    }
    return capability(transport, input.observedAt, true, null, { credentialName: required });
  }

  const identity = descriptor.executable === null ? undefined : await executableIdentity(descriptor.executable);
  if (identity === undefined) return capability(transport, input.observedAt, false, "EXECUTABLE_ABSENT");
  const material = descriptor.sessionMaterial === null
    ? "ok" as const
    : await secureOwnerFile(resolve(input.homeDirectory, descriptor.sessionMaterial));
  if (material !== "ok") {
    return capability(transport, input.observedAt, false, material, { executablePath: identity.path, executableVersion: identity.version });
  }
  return capability(transport, input.observedAt, true, null, { executablePath: identity.path, executableVersion: identity.version });
}

export function transportCapabilityDigest(capabilities: readonly AuthenticatedTransportCapability[]): string {
  return canonicalDigest([...capabilities].sort((left, right) => left.transport.localeCompare(right.transport)));
}
