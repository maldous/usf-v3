import { exitCodes, UsfError } from "../core/errors.ts";
import { bootstrapCarrier, type BootstrapCarrierMode } from "../realisation/carrier-adoption.ts";
import type { CommandHandler } from "./dispatcher.ts";

export interface BootstrapCarrierArguments {
  readonly mode: BootstrapCarrierMode;
  readonly adoptionIri: string;
  readonly profileIri: string;
  readonly manifestPath: "graph/manifests/integration.json";
}

function invalid(message: string): never {
  throw new UsfError("BOOTSTRAP_CARRIER_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

function optionValue(args: readonly string[], name: string): string {
  const indexes = args.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length !== 1) return invalid(`${name} must occur exactly once.`);
  const value = args[indexes[0]! + 1];
  if (value === undefined || value.startsWith("--")) return invalid(`${name} requires one value.`);
  return value;
}

export function parseBootstrapCarrierArguments(args: readonly string[]): BootstrapCarrierArguments {
  const mode = args[0];
  if (mode !== "verify" && mode !== "adopt") return invalid("bootstrap-carrier requires verify or adopt.");
  const adoptionIri = optionValue(args, "--adoption");
  const profileIri = optionValue(args, "--profile");
  const manifestPath = optionValue(args, "--manifest");
  const permitted = new Set([mode, "--adoption", adoptionIri, "--profile", profileIri, "--manifest", manifestPath]);
  if (args.length !== 7 || args.some((value) => !permitted.has(value))) return invalid("Only the exact adoption, versioned profile and integration manifest options are accepted.");
  if (!/^urn:[^<>\s]+$/u.test(adoptionIri) || !/^urn:[^<>\s]+:[1-9][0-9]*$/u.test(profileIri)) {
    return invalid("The adoption and explicitly versioned profile must be exact IRIs.");
  }
  if (manifestPath !== "graph/manifests/integration.json") return invalid("The exact integration authority manifest is required.");
  return Object.freeze({ mode, adoptionIri, profileIri, manifestPath });
}

export const bootstrapCarrierCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => ({
  output: await bootstrapCarrier(repositoryRoot, parseBootstrapCarrierArguments(args)),
  exitCode: exitCodes.SUCCESS,
});
