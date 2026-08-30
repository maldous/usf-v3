import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import type { Dependency } from "../graph/query.ts";
import type { WorkPacket } from "../graph/work.ts";

export interface BasisDigestRef { readonly id: string; readonly digest: string; }

export interface RealisationBasis {
  readonly schema: "urn:usf:realisation-basis:1";
  readonly basisDigest: string;
  readonly selection: Readonly<{
    manifestPath: string;
    manifestDigest: string;
    profile: string;
    profileVersion: string;
    profileDigest: string;
    product: string;
    productVersion: string;
    productDigest: string;
    foundation: string;
    foundationVersion: string;
    foundationDigest: string;
    coreToProductDigest: string;
    productToCoreDigest: string;
    compositeDigest: string;
  }>;
  readonly authority: Readonly<{
    contract: string;
    contractDigest: string;
    contractShape: string;
    permission: string;
    permissionDigest: string;
    permissionState: string;
    maximumThrough: string;
    effectiveAuthority: "active-permission" | "bootstrap-exception" | "none";
    effectiveMaximumThrough: string;
  }>;
  readonly work: Readonly<{
    id: string;
    resourceDigest: string;
    packetCoreDigest: string;
    semanticDigest: string;
    scopedDependencyDigest: string;
    dependencies: readonly Dependency[];
  }>;
  readonly semanticTrace: Readonly<{
    policy: string | null;
    stages: readonly Readonly<{ id: string; order: number }>[];
  }>;
  readonly scope: Readonly<{
    readSet: readonly string[];
    writeSet: readonly string[];
    preimages: Readonly<Record<string, string | null>>;
  }>;
  readonly trace: Readonly<{
    requirements: readonly BasisDigestRef[];
    evidence: readonly BasisDigestRef[];
    proof: readonly BasisDigestRef[];
    validation: readonly BasisDigestRef[];
  }>;
  readonly inputs: Readonly<{
    policyDigest: string;
    schemaDigests: readonly BasisDigestRef[];
    toolDigests: readonly BasisDigestRef[];
  }>;
}

export type BasisDraft = Omit<RealisationBasis, "basisDigest"> & { readonly basisDigest?: never };

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

const sorted = <T>(items: readonly T[], key: (item: T) => string): T[] => [...items].sort((a, b) => key(a).localeCompare(key(b)));

function canonicalDraft(draft: BasisDraft): Omit<RealisationBasis, "basisDigest"> {
  return {
    ...draft,
    selection: { ...draft.selection },
    authority: { ...draft.authority },
    work: { ...draft.work, dependencies: sorted(draft.work.dependencies, (d) => `${d.kind}|${d.key}|${d.digest}`).map((d) => ({ ...d })) },
    semanticTrace: { ...draft.semanticTrace, stages: sorted(draft.semanticTrace.stages, (s) => `${String(s.order).padStart(4, "0")}|${s.id}`).map((s) => ({ ...s })) },
    scope: {
      ...draft.scope,
      readSet: [...new Set(draft.scope.readSet)].sort(),
      writeSet: [...new Set(draft.scope.writeSet)].sort(),
      preimages: Object.fromEntries(Object.entries(draft.scope.preimages).sort(([a], [b]) => a.localeCompare(b))),
    },
    trace: {
      requirements: sorted(draft.trace.requirements, (r) => `${r.id}|${r.digest}`).map((r) => ({ ...r })),
      evidence: sorted(draft.trace.evidence, (r) => `${r.id}|${r.digest}`).map((r) => ({ ...r })),
      proof: sorted(draft.trace.proof, (r) => `${r.id}|${r.digest}`).map((r) => ({ ...r })),
      validation: sorted(draft.trace.validation, (r) => `${r.id}|${r.digest}`).map((r) => ({ ...r })),
    },
    inputs: {
      ...draft.inputs,
      schemaDigests: sorted(draft.inputs.schemaDigests, (r) => `${r.id}|${r.digest}`).map((r) => ({ ...r })),
      toolDigests: sorted(draft.inputs.toolDigests, (r) => `${r.id}|${r.digest}`).map((r) => ({ ...r })),
    },
  };
}

function withoutDigest(value: RealisationBasis | BasisDraft): Omit<RealisationBasis, "basisDigest"> {
  const { basisDigest: _ignored, ...draft } = value as RealisationBasis;
  return draft;
}

export function realisationBasisDigest(value: RealisationBasis | BasisDraft): string {
  return canonicalDigest(canonicalDraft(withoutDigest(value) as BasisDraft));
}

export function createRealisationBasis(draft: BasisDraft): RealisationBasis {
  const normalized = canonicalDraft(draft);
  const value = { ...normalized, schema: "urn:usf:realisation-basis:1" as const, basisDigest: realisationBasisDigest(normalized as BasisDraft) };
  return freeze(value);
}

/**
 * Reconstruct an immutable canonical basis at a JSON command boundary.
 * The wire representation is necessarily mutable; its supplied digest and
 * complete canonical representation must still match the reconstructed basis.
 */
export function parseRealisationBasis(value: unknown): RealisationBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BASIS_SHAPE_INVALID");
  const supplied = value as Partial<RealisationBasis>;
  const { basisDigest, ...draft } = supplied;
  if (typeof basisDigest !== "string") throw new Error("BASIS_SHAPE_INVALID");
  const normalized = createRealisationBasis(draft as BasisDraft);
  assertRealisationBasis(normalized);
  if (basisDigest !== normalized.basisDigest
    || canonicalJson(value, { rejectAbsolutePaths: true }) !== canonicalJson(normalized, { rejectAbsolutePaths: true })) {
    throw new Error("BASIS_DIGEST_MISMATCH");
  }
  return normalized;
}

export function assertRealisationBasis(value: unknown): asserts value is RealisationBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BASIS_SHAPE_INVALID");
  const basis = value as Partial<RealisationBasis>;
  const required = ["schema", "basisDigest", "selection", "authority", "work", "semanticTrace", "scope", "trace", "inputs"];
  if (Object.keys(basis).sort().join(",") !== required.sort().join(",") || basis.schema !== "urn:usf:realisation-basis:1" || !/^sha256:[0-9a-f]{64}$/u.test(basis.basisDigest ?? "")) throw new Error("BASIS_SHAPE_INVALID");
  const selection = basis.selection as RealisationBasis["selection"];
  if (!selection || Object.keys(selection).sort().join(",") !== "compositeDigest,coreToProductDigest,foundation,foundationDigest,foundationVersion,manifestDigest,manifestPath,product,productDigest,productToCoreDigest,productVersion,profile,profileDigest,profileVersion") throw new Error("BASIS_SHAPE_INVALID");
  const authority = basis.authority as RealisationBasis["authority"];
  if (!authority || Object.keys(authority).sort().join(",") !== "contract,contractDigest,contractShape,effectiveAuthority,effectiveMaximumThrough,maximumThrough,permission,permissionDigest,permissionState") throw new Error("BASIS_SHAPE_INVALID");
  const work = basis.work as RealisationBasis["work"];
  if (!work || Object.keys(work).sort().join(",") !== "dependencies,id,packetCoreDigest,resourceDigest,scopedDependencyDigest,semanticDigest" || !Array.isArray(work.dependencies)) throw new Error("BASIS_SHAPE_INVALID");
  const scope = basis.scope as RealisationBasis["scope"];
  if (!scope || Object.keys(scope).sort().join(",") !== "preimages,readSet,writeSet" || !Array.isArray(scope.readSet) || !Array.isArray(scope.writeSet) || !scope.preimages || Array.isArray(scope.preimages)) throw new Error("BASIS_SHAPE_INVALID");
  for (const ref of [...basis.trace!.requirements, ...basis.trace!.evidence, ...basis.trace!.proof, ...basis.trace!.validation, ...basis.inputs!.schemaDigests, ...basis.inputs!.toolDigests]) if (!ref || Object.keys(ref).sort().join(",") !== "digest,id" || typeof ref.id !== "string" || typeof ref.digest !== "string") throw new Error("BASIS_SHAPE_INVALID");
  for (const dependency of work.dependencies) if (!dependency || Object.keys(dependency).sort().join(",") !== "digest,key,kind" || typeof dependency.key !== "string" || typeof dependency.digest !== "string" || typeof dependency.kind !== "string") throw new Error("BASIS_SHAPE_INVALID");
  if (!deepFrozen(value)) throw new Error("BASIS_NOT_IMMUTABLE");
  if (canonicalJson(withoutDigest(basis as RealisationBasis), { rejectAbsolutePaths: true }) !== canonicalJson(canonicalDraft(withoutDigest(basis as RealisationBasis) as BasisDraft), { rejectAbsolutePaths: true })) throw new Error("BASIS_NONCANONICAL");
  for (const path of [...scope.readSet, ...scope.writeSet, ...Object.keys(scope.preimages)]) if (!/^(?!\.git(?:\/|$))(?!\.usf(?:\/|$))(?!\.env(?:\/|$))[A-Za-z0-9._/-]+\/?$/u.test(path) || path.includes("..")) throw new Error("BASIS_PATH_INVALID");
  for (const digest of [selection.manifestDigest, selection.profileDigest, selection.productDigest, selection.foundationDigest, selection.coreToProductDigest, selection.productToCoreDigest, selection.compositeDigest, authority.contractDigest, authority.permissionDigest, work.resourceDigest, work.packetCoreDigest, work.semanticDigest, work.scopedDependencyDigest, basis.inputs!.policyDigest]) if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw new Error("BASIS_DIGEST_INVALID");
  if (realisationBasisDigest(basis as RealisationBasis) !== basis.basisDigest) throw new Error("BASIS_DIGEST_MISMATCH");
}

function deepFrozen(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value as Record<string, unknown>).every(deepFrozen);
}

export function assertBasisMatchesPacket(basis: RealisationBasis, packet: WorkPacket): void {
  assertRealisationBasis(basis);
  if (basis.work.id !== packet.id || basis.work.packetCoreDigest !== packetDigest(packet)
    || basis.work.scopedDependencyDigest !== packet.scopedDependencyDigest) throw new Error("BASIS_PACKET_MISMATCH");
}

export function packetDigest(packet: WorkPacket): string {
  const { realisationBasis: _basis, realisationStage: _stage, ...packetCore } = packet;
  return canonicalDigest(packetCore, { rejectAbsolutePaths: true });
}

export function assertSameBasis(left: RealisationBasis, right: RealisationBasis): void {
  assertRealisationBasis(left); assertRealisationBasis(right);
  if (left.basisDigest !== right.basisDigest) throw new Error("BASIS_MIXED");
}
