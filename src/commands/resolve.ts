import { readFileSync } from "node:fs";

import { resolveContributions, type Resolution, type ResolvableContribution } from "../collaboration/resolve.ts";
import { LocalContributionError, parseLocalContribution } from "../collaboration/local-contribution.ts";
import type { Contribution } from "../providers/types.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { assertSameBasis, parseRealisationBasis } from "../realisation/basis.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import { parseCommandInput, readCommandInput } from "./command-input.ts";
import { observationCommandHandler } from "./transition.ts";

const callResultValidator = createJsonSchemaValidator(JSON.parse(
  readFileSync(new URL("../../schemas/call-result.schema.json", import.meta.url), "utf8"),
) as unknown);
const resolveResultValidator = createJsonSchemaValidator<Resolution>(JSON.parse(
  readFileSync(new URL("../../schemas/resolve-result.schema.json", import.meta.url), "utf8"),
) as unknown);

export function resolveCommand(contributions: readonly ResolvableContribution[]): Resolution {
  return resolveContributions(contributions);
}

/** Keep local proposals out of provider call-result and success accounting. */
export const resolveCommandHandler: CommandHandler = async (request) => {
  const { args, repositoryRoot } = request;
  if (args[0] === "prepare-local") return observationCommandHandler({ ...request, args: args.slice(1) }, "resolve prepare-local");
  const value = await readCommandInput(repositoryRoot, parseCommandInput(args, "RESOLVE"), "RESOLVE");
  const localInput = value !== null && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).schema === "urn:usf:local-contribution:1";
  const contributionInput = Array.isArray(value) || localInput;
  let contributions: ResolvableContribution[];
  if (contributionInput) {
    contributions = (localInput ? [value] : value) as ResolvableContribution[];
  }
  else if (value && typeof value === "object") {
    const envelope = value as Record<string, unknown>;
    if (!callResultValidator.validate(envelope).valid
      || envelope.status !== "ok"
      || !Array.isArray(envelope.contributions)
      || envelope.contributions.length === 0
      || !Array.isArray(envelope.failures)
      || envelope.failures.length !== 0) {
      throw new UsfError("RESOLVE_CALL_RESULT_INCOMPLETE", exitCodes.INTEGRATION_CONFLICT, "Resolve requires a complete successful call-result envelope.");
    }
    const metrics = envelope.metrics;
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new UsfError("RESOLVE_CALL_RESULT_INCOMPLETE", exitCodes.INTEGRATION_CONFLICT, "Call-result metrics are incomplete.");
    const m = metrics as Record<string, unknown>;
    if (m.failed !== 0 || m.requested !== m.succeeded || m.succeeded !== envelope.contributions.length) {
      throw new UsfError("RESOLVE_CALL_RESULT_INCOMPLETE", exitCodes.INTEGRATION_CONFLICT, "Call-result completeness metrics are inconsistent.");
    }
    try {
      const basis = parseRealisationBasis(envelope.basis);
      contributions = (envelope.contributions as Contribution[]).map((contribution) => ({ ...contribution, basis: parseRealisationBasis(contribution.basis) }));
      for (const contribution of contributions) assertSameBasis(basis, contribution.basis);
    } catch { throw new UsfError("RESOLVE_BASIS_INVALID", exitCodes.INVALID_INPUT, "Call-result envelope and contributions require one exact immutable basis."); }
  } else throw new UsfError("RESOLVE_INPUT_INVALID", exitCodes.INVALID_INPUT, "usf resolve input must be a local contribution, contribution array or call-result envelope.");
  if (contributions.length === 0) throw new UsfError("RESOLVE_CONTRIBUTIONS_REQUIRED", exitCodes.INVALID_INPUT, "Resolve requires at least one contribution.");
  try {
    contributions = contributions.map((contribution) => contribution.schema === "urn:usf:local-contribution:1"
      ? parseLocalContribution(contribution)
      : ({ ...contribution, basis: parseRealisationBasis(contribution.basis) }));
    for (const contribution of contributions.slice(1)) assertSameBasis(contributions[0]!.basis, contribution.basis);
  } catch (error) {
    if (error instanceof UsfError) throw error;
    if (error instanceof LocalContributionError) throw new UsfError(error.reasonCode, exitCodes.INVALID_INPUT, "Local contribution does not satisfy its closed provenance and identity contract.");
    throw new UsfError("RESOLVE_BASIS_INVALID", exitCodes.INVALID_INPUT, "Every contribution requires the same valid immutable wire realisation basis.");
  }
  const providerContributions = contributions.filter((contribution): contribution is Contribution => contribution.schema !== "urn:usf:local-contribution:1");
  if (contributionInput && providerContributions.length > 0) {
    const syntheticCallResult = {
      schema: "urn:usf:call-result:1",
      basis: contributions[0]!.basis,
      status: "ok",
      contributions: providerContributions,
      failures: [],
      metrics: { requested: providerContributions.length, succeeded: providerContributions.length, failed: 0, observedCost: 0 },
    };
    if (!callResultValidator.validate(syntheticCallResult).valid) {
      throw new UsfError("RESOLVE_INPUT_INVALID", exitCodes.INVALID_INPUT, "Manual contribution input must satisfy the complete contribution shape.");
    }
  }
  let output: Resolution;
  try { output = resolveCommand(contributions); }
  catch { throw new UsfError("RESOLVE_BASIS_INVALID", exitCodes.INVALID_INPUT, "Contribution bases could not be resolved as one immutable basis."); }
  if (!resolveResultValidator.validate(output).valid) throw new UsfError("RESOLVE_RESULT_INVALID", exitCodes.DOMAIN_FAILURE, "The resolve result does not satisfy its closed result schema.");
  return { output, exitCode: output.status === "refused" ? exitCodes.INTEGRATION_CONFLICT : exitCodes.SUCCESS };
};
