import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exitCodes, UsfError } from "../core/errors.ts";
import { classifyCatalogue, type RoutingRequirement } from "../providers/classification.ts";
import { CredentialEnvError, loadCredentialEnvFile } from "../providers/config.ts";
import { parseExecutionEconomicAuthorizations } from "../providers/execution-economics.ts";
import type { CommandResult } from "./dispatcher.ts";
import { observeInstalledAdapter, readLocalCatalogue } from "./models.ts";
import { observeAvailableRoutes } from "../providers/evidence-index.ts";
import { readGraphDerivedEconomics } from "../providers/economics-projection.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { readProviderBindings, type ProviderBindings } from "../providers/provider-bindings.ts";
import { readTrackedJson } from "./probe.ts";
import { parseEffectiveCostPolicy } from "./execute.ts";

function invalid(message: string): never {
  throw new UsfError("CLASSIFY_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message);
}

interface ParsedClassifyArguments {
  readonly envFile: string | null;
  readonly requirement: RoutingRequirement;
  readonly showStates: readonly string[];
  readonly limit: number;
}

function parse(args: readonly string[]): ParsedClassifyArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--env-file", "--require-capability", "--minimum-context", "--minimum-output", "--show-state", "--limit"].includes(option)) {
      invalid(`Unknown classify option: ${option}`);
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    if (option === "--require-capability" || option === "--show-state") {
      values.set(option, values.has(option) ? `${values.get(option)!},${value}` : value);
      continue;
    }
    if (values.has(option)) invalid(`Option ${option} may appear only once.`);
    values.set(option, value);
  }
  const numeric = (option: string): number | null => {
    const text = values.get(option);
    if (text === undefined) return null;
    if (!/^[1-9][0-9]{0,9}$/u.test(text)) invalid(`${option} must be a positive integer.`);
    return Number(text);
  };
  const limitText = values.get("--limit") ?? "0";
  if (!/^[0-9]{1,5}$/u.test(limitText)) invalid("--limit must be a non-negative integer.");
  const capabilityText = values.get("--require-capability");
  const stateText = values.get("--show-state");
  return Object.freeze({
    envFile: values.get("--env-file") ?? null,
    requirement: Object.freeze({
      requiredCapabilities: Object.freeze(capabilityText === undefined ? [] : [...new Set(capabilityText.split(","))].sort()),
      minimumContextTokens: numeric("--minimum-context"),
      minimumOutputTokens: numeric("--minimum-output"),
    }),
    showStates: Object.freeze(stateText === undefined ? [] : [...new Set(stateText.split(","))].sort()),
    limit: Number(limitText),
  });
}

export async function classifyCatalogueCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parse(args);
  const catalogue = await readLocalCatalogue(repositoryRoot);
  // Economics come from graph authority through the verified projection; no
  // surface decides against a separately maintained policy file.
  const semanticGraph = loadSemanticGraph(repositoryRoot, "graph/manifests/v3-convention.json");
  const bindings = readProviderBindings(semanticGraph);
  const economics = readGraphDerivedEconomics(
    await readTrackedJson(repositoryRoot, "config/execution-economics.json"),
    semanticGraph,
  );
  const policy = economics.policy;
  const authorizations = economics.authorizations;

  // Installed adapter observation across every adapter package the catalogue names.
  const adapterPackages = Object.freeze([...new Set(
    catalogue.snapshot.providers.map((provider) => provider.adapter.package).filter((value): value is string => typeof value === "string" && value.length > 0),
  )].sort());
  const installed: string[] = [];
  for (const adapterPackage of adapterPackages) {
    if (await observeInstalledAdapter(repositoryRoot, adapterPackage) !== undefined) installed.push(adapterPackage);
  }

  // Credential names actually supplied by the owner-private credential file.
  let suppliedCredentialNames: readonly string[] = Object.freeze([]);
  if (parsed.envFile !== null) {
    const catalogueNames = Object.freeze([...new Set(
      catalogue.snapshot.providers.flatMap((provider) => provider.credentialNames ?? []),
    )].sort());
    // A catalogue credential name that is not a legal environment variable name
    // cannot be supplied by any credential file; excluding it keeps the rest of
    // the allowlist usable instead of failing the whole observation closed.
    const environmentNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;
    const allowlist = Object.freeze([...catalogueNames]
      .filter((name) => environmentNamePattern.test(name)).sort());
    try {
      const environment = await loadCredentialEnvFile(resolve(repositoryRoot, parsed.envFile), allowlist);
      suppliedCredentialNames = Object.freeze(allowlist.filter((name) => {
        const value = environment.getCredential(name);
        return typeof value === "string" && value.length > 0;
      }).sort());
    } catch (error) {
      if (!(error instanceof CredentialEnvError)) throw error;
    }
  }

  const { classifications, summary } = classifyCatalogue({
    snapshot: catalogue.snapshot,
    installedAdapterPackages: Object.freeze(installed),
    suppliedCredentialNames,
    authorizations,
    policy,
    requirement: parsed.requirement,
    observedAvailableRouteIds: (await observeAvailableRoutes(repositoryRoot)).routeIds,
    credentialAliases: bindings.credentialAliases,
    providerEndpoints: bindings.endpoints,
  });

  const shown = parsed.showStates.length === 0
    ? Object.freeze([])
    : Object.freeze(classifications
      .filter((entry) => parsed.showStates.includes(entry.state))
      .slice(0, parsed.limit === 0 ? 200 : parsed.limit));

  return {
    output: Object.freeze({
      ...summary,
      installedAdapterPackages: Object.freeze(installed),
      declaredAdapterPackages: adapterPackages.length,
      suppliedCredentialNameCount: suppliedCredentialNames.length,
      requirement: parsed.requirement,
      models: shown,
    }),
    exitCode: exitCodes.SUCCESS,
  };
}
