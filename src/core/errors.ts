export const exitCodes = {
  SUCCESS: 0,
  /** Compatibility alias for command implementations; both names mean success. */
  OK: 0,
  DOMAIN_FAILURE: 1,
  INVALID_INPUT: 2,
  EXTERNAL_UNAVAILABLE: 3,
  CURRENTNESS_FAILURE: 4,
  CONTAINMENT_REFUSAL: 5,
  NO_ELIGIBLE_ROUTE: 6,
  INTEGRATION_CONFLICT: 7,
  CONTINUOUS_DEGRADED: 8,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

export class UsfError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly details?: Record<string, unknown>;

  constructor(code: string, exitCode: ExitCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "UsfError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

/**
 * A stable machine-readable reason code.
 *
 * Deliberately narrow: upper-case words separated by underscores, optionally
 * followed by a colon and a detail segment, as in
 * `CONSTRUCTION_EVIDENCE_MISSING:urn:usf:evidence-requirement:x`. A message, a
 * file path, a class name and a stack trace all fail this shape, which is the
 * point — the classifier must never manufacture a code out of an implementation
 * detail, and an error carrying something that is not already declared
 * vocabulary is treated as unexpected rather than surfaced.
 */
const STABLE_REASON_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*(?::[\x21-\x7e]{1,200})?$/u;

const REASON_CODE_CARRIERS = ["code", "reasonCode"] as const;

export function isStableReasonCode(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && STABLE_REASON_CODE.test(value);
}

/**
 * Classify a thrown value.
 *
 * The invariant: an error is a semantic refusal if and only if it already
 * carries a stable machine-readable reason code. Everything else is an
 * unexpected implementation failure.
 *
 * The repository has twenty domain error classes beyond UsfError — graph load,
 * schema policy, semantic store, realisation, qualification and the rest — and
 * every one of them carries a `reasonCode`. Before this, only UsfError survived
 * the boundary, so a manifest declaring one graph IRI twice raised
 * GraphLoadError carrying MANIFEST_DUPLICATE_SOURCE_OR_GRAPH and the operator
 * was told "Unexpected internal error". That is not a cosmetic difference:
 * Hermes cannot supervise autonomous realisation while a semantic refusal is
 * indistinguishable from a crash, because the two want opposite responses.
 */
export function classifyError(error: unknown): { readonly reasonCode: string; readonly classified: boolean } {
  if (error === null || typeof error !== "object") return { reasonCode: "INTERNAL_ERROR", classified: false };
  for (const carrier of REASON_CODE_CARRIERS) {
    const candidate = (error as Record<string, unknown>)[carrier];
    if (isStableReasonCode(candidate)) return { reasonCode: candidate, classified: true };
  }
  return { reasonCode: "INTERNAL_ERROR", classified: false };
}

/**
 * The message a classified refusal may carry.
 *
 * A domain error's message is authored text, and several of them are exactly
 * the reason code. An unclassified failure's message is not: it can carry a
 * path, a module name or a fragment of somebody's stack, so it is replaced
 * rather than trimmed.
 */
function refusalMessage(error: unknown, reasonCode: string): string {
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string" || message.length === 0) return reasonCode;
  return message.length > 400 ? `${message.slice(0, 400)}…` : message;
}

export function errorOutput(error: unknown): { schema: "urn:usf:cli-error:1"; status: "refused"; reasonCode: string; message: string; details?: Record<string, unknown> } {
  const { reasonCode, classified } = classifyError(error);
  if (!classified) {
    // Nothing from the error escapes here. An unexpected failure is a defect in
    // this repository, and its internals are for a stack trace on stderr, not
    // for a machine-readable envelope that a supervisor will act on.
    return { schema: "urn:usf:cli-error:1", status: "refused", reasonCode: "INTERNAL_ERROR", message: "Unexpected internal error." };
  }
  const details = (error as { details?: unknown }).details;
  return {
    schema: "urn:usf:cli-error:1",
    status: "refused",
    reasonCode,
    message: refusalMessage(error, reasonCode),
    ...(details === undefined || details === null || typeof details !== "object" ? {} : { details: details as Record<string, unknown> }),
  };
}
