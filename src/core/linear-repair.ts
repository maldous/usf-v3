/** Pure, bounded contracts for explicitly graph-authorised candidate repair. */
export interface LinearCandidateRepairPolicy {
  readonly rootBinding: string;
  readonly round: number;
  readonly maximumRounds: number;
  readonly predecessorBinding?: string;
}

export const LINEAR_REPAIR_MAXIMUM_RESPONSE_BYTES = 65536;
export const LINEAR_REPAIR_MAXIMUM_OPERATIONS = 16;
export const LINEAR_CANDIDATE_REPAIR_RESPONSE_CONTRACT =
  "urn:usf:linear-candidate-repair-response:1: Return only one JSON object with exactly an operations array. "
  + "Use 1 to 16 operations, each with exactly kind, path, oldText and newText. "
  + "kind must be replace. Use at most one operation per authorized sourceContext write path. "
  + "oldText must be nonempty, copied literally from its supplied excerpt, and unique in both the excerpt and complete source. "
  + "newText must be a string. The complete UTF-8 response must not exceed 65536 bytes. "
  + "Do not escape source characters a second time, normalize source, emit Markdown or add explanation. "
  + "If context is insufficient, return an empty operations array; this blocks delivery and does not authorize repair.";

const IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/u;

function iri(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && IRI.test(value);
}

/** null is invalid, not an absent policy or permission to use a default. */
export function parseLinearCandidateRepairPolicy(text: string): LinearCandidateRepairPolicy | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!iri(record.rootBinding) || typeof record.round !== "number" || !Number.isSafeInteger(record.round)
    || typeof record.maximumRounds !== "number" || !Number.isSafeInteger(record.maximumRounds)
    || record.maximumRounds < 1 || record.maximumRounds > 4
    || record.round < 0 || record.round > record.maximumRounds) return null;
  const expected = record.round === 0
    ? "maximumRounds,rootBinding,round"
    : "maximumRounds,predecessorBinding,rootBinding,round";
  if (Object.keys(record).sort().join(",") !== expected
    || (record.round > 0 && !iri(record.predecessorBinding))) return null;
  return Object.freeze({
    rootBinding: record.rootBinding, round: record.round, maximumRounds: record.maximumRounds,
    ...(record.round === 0 ? {} : { predecessorBinding: record.predecessorBinding as string }),
  });
}

export type LinearRepairResponseReason =
  | "LINEAR_BINDING_REPAIR_RESPONSE_JSON_INVALID"
  | "LINEAR_BINDING_REPAIR_RESPONSE_SCHEMA_INVALID"
  | "LINEAR_BINDING_REPAIR_RESPONSE_ANCHOR_INVALID"
  | "LINEAR_BINDING_REPAIR_CONTEXT_INSUFFICIENT"
  | "LINEAR_BINDING_REPAIR_RESPONSE_LIMIT";

export interface LinearRepairDiagnostic {
  readonly reasonCode: LinearRepairResponseReason;
  readonly operationIndex?: number;
}

export interface LinearRepairSource {
  readonly path: string;
  readonly excerpt: string;
  readonly source: string;
}

export interface LinearCandidateRepairFeedback {
  readonly predecessorBinding: string;
  readonly predecessorAttempt: string;
  readonly predecessorEvidenceDigest: string;
  readonly predecessorResultDigest: string;
  readonly diagnostic: LinearRepairDiagnostic;
}

export type LinearRepairResponse =
  | { readonly status: "valid"; readonly retryable: false }
  | { readonly status: "rejected"; readonly retryable: true; readonly diagnostic: LinearRepairDiagnostic }
  | { readonly status: "blocked"; readonly retryable: false; readonly diagnostic: LinearRepairDiagnostic };

function response(
  reasonCode: LinearRepairResponseReason, retryable: boolean, operationIndex?: number,
): LinearRepairResponse {
  const diagnostic = Object.freeze({ reasonCode, ...(operationIndex === undefined ? {} : { operationIndex }) });
  return retryable
    ? Object.freeze({ status: "rejected", retryable: true, diagnostic })
    : Object.freeze({ status: "blocked", retryable: false, diagnostic });
}

function unique(haystack: string, needle: string): boolean {
  const first = haystack.indexOf(needle);
  return first >= 0 && haystack.indexOf(needle, first + 1) < 0;
}

/**
 * This is an opted-in response contract, not contribution lowering or authority.
 * The caller must authenticate source bytes, write scope and retained response.
 * It never modifies a response or interprets an operational exception as repair.
 */
export function evaluateLinearCandidateRepairResponse(
  resultText: string, sources: readonly LinearRepairSource[], writePaths: readonly string[],
): LinearRepairResponse {
  const authorized = new Set(writePaths);
  const contexts = new Map<string, LinearRepairSource>();
  if (sources.length === 0 || sources.length > 16) {
    return response("LINEAR_BINDING_REPAIR_CONTEXT_INSUFFICIENT", false);
  }
  for (const source of sources) {
    if (typeof source.path !== "string" || typeof source.excerpt !== "string"
      || typeof source.source !== "string" || source.excerpt.length === 0
      || !source.source.includes(source.excerpt) || contexts.has(source.path)) {
      return response("LINEAR_BINDING_REPAIR_CONTEXT_INSUFFICIENT", false);
    }
    contexts.set(source.path, source);
  }
  if (![...contexts.keys()].some(path => authorized.has(path))) {
    return response("LINEAR_BINDING_REPAIR_CONTEXT_INSUFFICIENT", false);
  }
  if (Buffer.byteLength(resultText, "utf8") > LINEAR_REPAIR_MAXIMUM_RESPONSE_BYTES) {
    return response("LINEAR_BINDING_REPAIR_RESPONSE_LIMIT", false);
  }
  let value: unknown;
  try { value = JSON.parse(resultText); }
  catch { return response("LINEAR_BINDING_REPAIR_RESPONSE_JSON_INVALID", true); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return response("LINEAR_BINDING_REPAIR_RESPONSE_SCHEMA_INVALID", true);
  }
  const record = value as Record<string, unknown>;
  // An explicit empty result never obtains another provider attempt.
  if (Array.isArray(record.operations) && record.operations.length === 0) {
    return response("LINEAR_BINDING_REPAIR_CONTEXT_INSUFFICIENT", false);
  }
  if (Object.keys(record).join(",") !== "operations" || !Array.isArray(record.operations)
    || record.operations.length > LINEAR_REPAIR_MAXIMUM_OPERATIONS) {
    return response("LINEAR_BINDING_REPAIR_RESPONSE_SCHEMA_INVALID", true);
  }
  const selected = new Set<string>();
  for (const [operationIndex, value] of record.operations.entries()) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "kind,newText,oldText,path") {
      return response("LINEAR_BINDING_REPAIR_RESPONSE_SCHEMA_INVALID", true, operationIndex);
    }
    const operation = value as Record<string, unknown>;
    if (operation.kind !== "replace" || typeof operation.path !== "string"
      || !authorized.has(operation.path) || !contexts.has(operation.path) || selected.has(operation.path)
      || typeof operation.oldText !== "string" || operation.oldText.length === 0
      || typeof operation.newText !== "string") {
      return response("LINEAR_BINDING_REPAIR_RESPONSE_SCHEMA_INVALID", true, operationIndex);
    }
    const context = contexts.get(operation.path)!;
    if (!unique(context.excerpt, operation.oldText) || !unique(context.source, operation.oldText)) {
      return response("LINEAR_BINDING_REPAIR_RESPONSE_ANCHOR_INVALID", true, operationIndex);
    }
    selected.add(operation.path);
  }
  return Object.freeze({ status: "valid", retryable: false });
}
