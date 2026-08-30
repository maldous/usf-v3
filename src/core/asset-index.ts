import { createHash } from "node:crypto";
import { parseRepositoryPath } from "./scope.ts";

const schema = "urn:usf:file-asset-index:1" as const;
const maxEntries = 10_000;
const maxPathLength = 1_024;
const contentDigestPattern = /^sha256:[a-f0-9]{64}$/;
// This deliberately supports a canonical ASCII URN subset rather than trying
// to normalize every RFC 8141 equivalence. Percent escapes, query components,
// and fragments are refused so alternate spellings cannot evade deduplication.
const semanticIdentifierPattern = /^urn:[a-z0-9][a-z0-9-]{0,30}[a-z0-9]:[A-Za-z0-9][A-Za-z0-9._~:/@!$&'()*+,;=-]{0,447}$/;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;
const entryKeys = ["contentDigest", "id", "mediaType", "path", "product"] as const;

export const assetIndexReasonCodes = Object.freeze({
  INPUT_INVALID: "ASSET_INDEX_INPUT_INVALID",
  TOO_LARGE: "ASSET_INDEX_TOO_LARGE",
  ENTRY_INVALID: "ASSET_INDEX_ENTRY_INVALID",
  IDENTIFIER_INVALID: "ASSET_INDEX_IDENTIFIER_INVALID",
  IDENTIFIER_DUPLICATE: "ASSET_INDEX_IDENTIFIER_DUPLICATE",
  PATH_INVALID: "ASSET_INDEX_PATH_INVALID",
  PATH_DUPLICATE: "ASSET_INDEX_PATH_DUPLICATE",
  MEDIA_TYPE_INVALID: "ASSET_INDEX_MEDIA_TYPE_INVALID",
  CONTENT_DIGEST_INVALID: "ASSET_INDEX_CONTENT_DIGEST_INVALID",
} as const);

export type AssetIndexReasonCode = (typeof assetIndexReasonCodes)[keyof typeof assetIndexReasonCodes];

export class AssetIndexError extends Error {
  readonly reasonCode: AssetIndexReasonCode;

  constructor(reasonCode: AssetIndexReasonCode, message: string) {
    super(message);
    this.name = "AssetIndexError";
    this.reasonCode = reasonCode;
  }
}

export interface AssetIndexEntry {
  /** Semantic identity of the product to which this asset belongs. */
  readonly product: string;
  /** Globally unique semantic identity of the indexed asset. */
  readonly id: string;
  /** Repository-relative path metadata; this module never reads the path. */
  readonly path: string;
  /** Parameter-free, lowercase media type metadata. */
  readonly mediaType: string;
  /** Exact SHA-256 identity supplied for the indexed asset bytes. */
  readonly contentDigest: `sha256:${string}`;
}

export interface FileAssetIndex {
  readonly contentDigest: `sha256:${string}`;
  readonly entries: readonly AssetIndexEntry[];
  readonly schema: typeof schema;
}

function refuse(reasonCode: AssetIndexReasonCode, message: string): never {
  throw new AssetIndexError(reasonCode, message);
}

function isExactDataRecord(value: unknown): value is Record<(typeof entryKeys)[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return false;
  const keys = (ownKeys as string[]).sort();
  if (keys.length !== entryKeys.length || keys.some((key, index) => key !== entryKeys[index])) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
  });
}

function semanticIdentifier(value: unknown): string {
  if (typeof value !== "string" || !semanticIdentifierPattern.test(value)) {
    refuse(assetIndexReasonCodes.IDENTIFIER_INVALID, "Asset semantic identifiers must use the bounded canonical URN subset.");
  }
  return value;
}

function repositoryPath(value: unknown): string {
  if (typeof value !== "string" || value.length > maxPathLength || parseRepositoryPath(value, "file") === null) {
    refuse(assetIndexReasonCodes.PATH_INVALID, "Asset paths must be bounded repository-relative files.");
  }
  return value;
}

function mediaType(value: unknown): string {
  if (typeof value !== "string" || !mediaTypePattern.test(value)) {
    refuse(assetIndexReasonCodes.MEDIA_TYPE_INVALID, "Asset media types must be bounded lowercase type/subtype values.");
  }
  return value;
}

function contentDigest(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !contentDigestPattern.test(value)) {
    refuse(assetIndexReasonCodes.CONTENT_DIGEST_INVALID, "Asset content digests must be exact lowercase SHA-256 digests.");
  }
  return value as `sha256:${string}`;
}

function validatedEntry(value: unknown): AssetIndexEntry {
  if (!isExactDataRecord(value)) {
    refuse(assetIndexReasonCodes.ENTRY_INVALID, "Asset index entries must contain exactly the supported data fields.");
  }
  const product = semanticIdentifier(value.product);
  const id = semanticIdentifier(value.id);
  const path = repositoryPath(value.path);
  const type = mediaType(value.mediaType);
  const digest = contentDigest(value.contentDigest);
  return Object.freeze({ contentDigest: digest, id, mediaType: type, path, product });
}

function compareEntries(left: AssetIndexEntry, right: AssetIndexEntry): number {
  for (const [a, b] of [
    [left.product, right.product],
    [left.id, right.id],
    [left.path, right.path],
    [left.mediaType, right.mediaType],
    [left.contentDigest, right.contentDigest],
  ] as const) {
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function sha256(bytes: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function identityBytes(entries: readonly AssetIndexEntry[]): string {
  return JSON.stringify({ entries, schema });
}

/**
 * Validate metadata and derive a canonical file-data index without filesystem,
 * database, CAS, network, evidence, proof, or semantic-authority effects.
 */
export function createFileAssetIndex(input: unknown): FileAssetIndex {
  if (!Array.isArray(input)) {
    refuse(assetIndexReasonCodes.INPUT_INVALID, "Asset index input must be an array.");
  }
  if (input.length > maxEntries) {
    refuse(assetIndexReasonCodes.TOO_LARGE, "Asset index input exceeds the bounded entry limit.");
  }

  for (let index = 0; index < input.length; index += 1) {
    if (!Object.hasOwn(input, index)) {
      refuse(assetIndexReasonCodes.ENTRY_INVALID, "Asset index arrays must not contain sparse entries.");
    }
  }
  const entries = Object.freeze(Array.from(input, validatedEntry).sort(compareEntries));
  const identifiers = new Set<string>();
  const paths = new Set<string>();
  for (const entry of entries) {
    if (identifiers.has(entry.id)) {
      refuse(assetIndexReasonCodes.IDENTIFIER_DUPLICATE, "Each asset semantic identifier may appear only once.");
    }
    if (paths.has(entry.path)) {
      refuse(assetIndexReasonCodes.PATH_DUPLICATE, "Each asset path may appear only once.");
    }
    identifiers.add(entry.id);
    paths.add(entry.path);
  }

  return Object.freeze({ contentDigest: sha256(identityBytes(entries)), entries, schema });
}

/** Canonical UTF-8-compatible JSON file bytes, terminated by one newline. */
export function serializeFileAssetIndex(input: unknown): string {
  const index = createFileAssetIndex(input);
  return JSON.stringify({ contentDigest: index.contentDigest, entries: index.entries, schema: index.schema }) + "\n";
}
