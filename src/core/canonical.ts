import { createHash } from "node:crypto";
import { UsfError, exitCodes } from "./errors.ts";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const forbiddenKeys = new Set(["createdAt", "absolutePath", "localPath", "runLabel", "timestamp"]);
const absolutePath = /^(?:[A-Za-z]:[\\/]|\/|~\/)/;

export interface CanonicalOptions {
  excludeIdentityFields?: boolean;
  rejectAbsolutePaths?: boolean;
}

function normalize(value: unknown, options: Required<CanonicalOptions>, path: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && options.rejectAbsolutePaths && absolutePath.test(value)) {
      throw new UsfError("ABSOLUTE_PATH_FORBIDDEN", exitCodes.CONTAINMENT_REFUSAL, "Absolute paths are not permitted in canonical artefacts.", { path });
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new UsfError("NON_CANONICAL_NUMBER", exitCodes.INVALID_INPUT, "Canonical JSON requires finite, non-negative-zero numbers.", { path });
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalize(entry, options, `${path}[${index}]`));
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(input).sort()) {
      if (options.excludeIdentityFields && forbiddenKeys.has(key)) continue;
      if (input[key] === undefined) continue;
      result[key] = normalize(input[key], options, path === "$" ? key : `${path}.${key}`);
    }
    return result;
  }
  throw new UsfError("NON_JSON_VALUE", exitCodes.INVALID_INPUT, "Canonical JSON accepts only JSON values.", { path, type: typeof value });
}

export function canonicalJson(value: unknown, options: CanonicalOptions = {}): string {
  return JSON.stringify(normalize(value, { excludeIdentityFields: options.excludeIdentityFields ?? false, rejectAbsolutePaths: options.rejectAbsolutePaths ?? false }, "$"));
}

export function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalDigest(value: unknown, options: CanonicalOptions = {}): `sha256:${string}` {
  return sha256(canonicalJson(value, options));
}
