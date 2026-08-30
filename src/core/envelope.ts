import { canonicalDigest, type JsonValue } from "./canonical.ts";
import { dependencyDigest, type Dependency } from "./dependencies.ts";
import { UsfError, exitCodes } from "./errors.ts";

export interface EnvelopeInput {
  kind: string;
  producer: { command: string; version: string };
  semantic?: { globalRevisionDigest?: `sha256:${string}`; dependencies?: Dependency[] };
  repository?: { carrierCommit?: string; carrierTree?: string; pathDependencies?: Dependency[] };
  inputs?: JsonValue[];
  payload?: JsonValue;
  metrics?: JsonValue;
  claims?: JsonValue[];
  nonclaims?: JsonValue[];
  chainDigest?: `sha256:${string}`;
  createdAt?: string;
}

export interface Envelope extends Omit<Required<EnvelopeInput>, "semantic" | "repository" | "chainDigest" | "createdAt"> {
  schema: "urn:usf:envelope:1";
  identity: { artifactDigest: `sha256:${string}`; chainDigest: `sha256:${string}` };
  semantic: { globalRevisionDigest: `sha256:${string}` | null; dependencyDigest: `sha256:${string}`; dependencies: Dependency[] };
  repository: { carrierCommit: string | null; carrierTree: string | null; pathDependencies: Dependency[] };
  createdAt: string;
}

function identityMaterial(input: Omit<Envelope, "identity" | "createdAt">): Omit<Envelope, "identity" | "createdAt"> { return input; }

export function createEnvelope(input: EnvelopeInput): Envelope {
  if (!input.kind || !input.producer?.command || !input.producer?.version) throw new UsfError("ENVELOPE_INVALID", exitCodes.INVALID_INPUT, "Envelope kind and producer command/version are required.");
  const semanticDependencies = input.semantic?.dependencies ?? [];
  const pathDependencies = input.repository?.pathDependencies ?? [];
  const semantic = { globalRevisionDigest: input.semantic?.globalRevisionDigest ?? null, dependencyDigest: dependencyDigest(semanticDependencies), dependencies: [...semanticDependencies] };
  const repository = { carrierCommit: input.repository?.carrierCommit ?? null, carrierTree: input.repository?.carrierTree ?? null, pathDependencies: [...pathDependencies] };
  const base = {
    schema: "urn:usf:envelope:1" as const,
    kind: input.kind,
    producer: { ...input.producer },
    semantic,
    repository,
    inputs: input.inputs ?? [], payload: input.payload ?? {}, metrics: input.metrics ?? {}, claims: input.claims ?? [], nonclaims: input.nonclaims ?? [],
  };
  const artifactDigest = canonicalDigest(identityMaterial(base), { rejectAbsolutePaths: true });
  const chainDigest = input.chainDigest ?? artifactDigest;
  return { ...base, identity: { artifactDigest, chainDigest }, createdAt: input.createdAt ?? new Date().toISOString() };
}

export function envelopeIdentity(envelope: Envelope): `sha256:${string}` {
  const { identity: _identity, createdAt: _createdAt, ...material } = envelope;
  return canonicalDigest(identityMaterial(material), { rejectAbsolutePaths: true });
}
