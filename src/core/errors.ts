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

export function errorOutput(error: unknown): { schema: "urn:usf:cli-error:1"; status: "refused"; reasonCode: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof UsfError) {
    return { schema: "urn:usf:cli-error:1", status: "refused", reasonCode: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
  }
  return { schema: "urn:usf:cli-error:1", status: "refused", reasonCode: "INTERNAL_ERROR", message: "Unexpected internal error." };
}
