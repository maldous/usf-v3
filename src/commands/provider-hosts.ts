import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import {
  observeSubscriptionHosts,
  SubscriptionHostContainmentError,
  type SubscriptionHostCensus,
  type SubscriptionHostObservation,
} from "../providers/subscription-hosts.ts";
import type { ModelCatalogueSnapshot } from "../providers/catalogue.ts";
import type { CommandHandler } from "./dispatcher.ts";

const providerCensusWork = "urn:usf:work:provider-census";
const providerCensusContract = "urn:usf:contract:provider-census:1";
const defaultMaxItems = 100;
const maximumMaxItems = 1_000;

interface ParsedArguments {
  readonly profile: string;
  readonly manifest: string;
  readonly maxItems: number;
  readonly providerHome: string;
}

interface HostSummary {
  readonly schema: "urn:usf:subscription-host-summary:1";
  readonly transport: SubscriptionHostObservation["transport"];
  readonly provider: SubscriptionHostObservation["provider"];
  readonly catalogueProvider: SubscriptionHostObservation["catalogueProvider"];
  readonly executable: string;
  readonly executableVersion: string | null;
  readonly observedAt: string;
  readonly status: SubscriptionHostObservation["status"];
  readonly failureCode: SubscriptionHostObservation["failureCode"];
  readonly authentication: SubscriptionHostObservation["authentication"];
  readonly candidateSurface: SubscriptionHostObservation["candidateSurface"];
  readonly candidateCount: number;
  readonly authorizationDigest: string | null;
  readonly apiAndCloudCredentialEnvironmentForwarded: false;
  readonly observationDigest: string;
  readonly nonclaims: readonly string[];
}

interface SelectedScope {
  readonly status: "selected";
  readonly profile: string;
  readonly profileVersion: string;
  readonly product: string;
  readonly foundation: string;
  readonly manifest: string;
  readonly semanticDigest: string;
  readonly work: typeof providerCensusWork;
  readonly contract: typeof providerCensusContract;
  readonly scopedDependencyDigest: string;
  readonly capabilityStage: "verified-complete";
  readonly completionProofResult: string;
}

function fail(code: string, exitCode: (typeof exitCodes)[keyof typeof exitCodes], message: string, details?: Record<string, unknown>): never {
  throw new UsfError(code, exitCode, message, details);
}

function positiveInteger(value: string | undefined): number {
  if (value === undefined) return defaultMaxItems;
  if (!/^[1-9][0-9]{0,3}$/u.test(value)) fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--max-items must be a bounded positive integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximumMaxItems) fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--max-items exceeds the supported bound.");
  return parsed;
}

function parseArguments(
  args: readonly string[],
  validateVersionedProfile: (value: string) => string,
  validateRepositoryManifest: (value: string) => string,
): ParsedArguments {
  if (args[0] !== "census") fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Providers host requires exactly the census operation.");
  const remaining = args.slice(1);
  if (remaining.length % 2 !== 0) fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Providers host options require explicit values.");
  const values = new Map<string, string>();
  const allowed = new Set(["--profile", "--manifest", "--max-items", "--provider-home"]);
  for (let index = 0; index < remaining.length; index += 2) {
    const option = remaining[index]!;
    const value = remaining[index + 1]!;
    if (!allowed.has(option) || values.has(option) || value.length === 0 || value.startsWith("--")) {
      fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Providers host options must be unique supported flag/value pairs.");
    }
    values.set(option, value);
  }
  const profileInput = values.get("--profile");
  const manifestInput = values.get("--manifest");
  const providerHome = values.get("--provider-home");
  if (profileInput === undefined || manifestInput === undefined || providerHome === undefined) {
    fail("PROVIDERS_HOST_SCOPE_REQUIRED", exitCodes.INVALID_INPUT, "Subscription-host census requires an exact versioned profile, manifest and provider-state root.");
  }
  if (!isAbsolute(providerHome) || providerHome === "/" || providerHome.endsWith("/") || providerHome.length > 4_096
    || /(?:^|\/)\.\.?(?:\/|$)|[\u0000-\u001f\u007f]/u.test(providerHome)) {
    fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "--provider-home must be one explicit absolute provider-state root.");
  }
  try {
    return Object.freeze({
      profile: validateVersionedProfile(profileInput),
      manifest: validateRepositoryManifest(manifestInput),
      maxItems: positiveInteger(values.get("--max-items")),
      providerHome,
    });
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "The selected subscription-host profile or manifest is invalid.");
  }
}

function hostSummary(host: SubscriptionHostObservation): HostSummary {
  return Object.freeze({
    schema: "urn:usf:subscription-host-summary:1",
    transport: host.transport,
    provider: host.provider,
    catalogueProvider: host.catalogueProvider,
    executable: host.executable,
    executableVersion: host.executableVersion,
    observedAt: host.observedAt,
    status: host.status,
    failureCode: host.failureCode,
    authentication: host.authentication,
    candidateSurface: host.candidateSurface,
    candidateCount: host.candidates.length,
    authorizationDigest: host.authorization?.digest ?? null,
    apiAndCloudCredentialEnvironmentForwarded: false,
    observationDigest: host.digest,
    nonclaims: host.nonclaims,
  });
}

export function buildProviderHostCensusResult(census: SubscriptionHostCensus, semanticScope: SelectedScope, maxItems: number): Readonly<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > maximumMaxItems) {
    return fail("PROVIDERS_HOST_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "The provider-host projection bound is invalid.");
  }
  const candidates = census.candidates.slice(0, maxItems);
  const basis = Object.freeze({
    schema: "urn:usf:provider-host-census-result:1" as const,
    version: 1 as const,
    status: "ok" as const,
    operation: "host-census" as const,
    externalContact: "none" as const,
    authorityEffect: "none" as const,
    semanticScope,
    source: census.source,
    observationDigest: census.digest,
    denominators: Object.freeze({
      ...census.denominators,
      matchedCandidates: census.candidates.length,
      returnedCandidates: candidates.length,
    }),
    truncation: Object.freeze({
      maxItems,
      matchedItems: census.candidates.length,
      returnedItems: candidates.length,
      truncated: candidates.length < census.candidates.length,
    }),
    hosts: Object.freeze(census.hosts.map(hostSummary)),
    authorizations: census.authorizations,
    candidates: Object.freeze(candidates),
    nonclaims: Object.freeze([
      ...census.nonclaims,
      "host-authorization-is-census-only-and-does-not-authorize-inference",
      "every-candidate-remains-unqualified-until-authenticated-answer-and-hidden-holdout-evidence-pass",
      "no-account-identity-or-credential-value-is-retained",
    ]),
  });
  return Object.freeze({ ...basis, resultDigest: canonicalDigest(basis) });
}

export interface ProviderHostCommandResolution {
  readonly scope: SelectedScope;
  readonly maxItems: number;
  readonly providerHome: string;
  readonly catalogue: ModelCatalogueSnapshot;
}

export interface ProviderHostCommandDependencies {
  readonly resolveRequest: (args: readonly string[], repositoryRoot: string) => Promise<ProviderHostCommandResolution>;
  readonly observe: typeof observeSubscriptionHosts;
}

export function createProviderHostsCommandHandler(dependencies: ProviderHostCommandDependencies): CommandHandler {
  return async ({ args, repositoryRoot }) => {
  const request = await dependencies.resolveRequest(args, repositoryRoot);
  let census;
  try {
    census = await dependencies.observe(request.catalogue, { providerRoot: request.providerHome });
  } catch (error) {
    if (error instanceof SubscriptionHostContainmentError) {
      return fail("PROVIDERS_HOST_CONTAINMENT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The selected provider-state root or confined metadata projection is unsafe or drifted.", { reasonCode: error.reasonCode });
    }
    throw error;
  }
  const output = buildProviderHostCensusResult(census, request.scope, request.maxItems);
  const schemaPaths = ["schemas/provider-host-authorization.schema.json", "schemas/provider-host-census-result.schema.json"] as const;
  const schemas = await Promise.all(schemaPaths.map(async (path) => {
    const bytes = await readFile(resolve(repositoryRoot, path));
    if (bytes.length > 1024 * 1024) return fail("PROVIDERS_HOST_SCHEMA_INVALID", exitCodes.CURRENTNESS_FAILURE, "A provider-host schema exceeds its bound.");
    try { return JSON.parse(bytes.toString("utf8")) as unknown; }
    catch { return fail("PROVIDERS_HOST_SCHEMA_INVALID", exitCodes.CURRENTNESS_FAILURE, "A provider-host schema is not valid JSON."); }
  }));
  const authorizationValidator = createJsonSchemaValidator(schemas[0]);
  if (census.authorizations.some((authorization) => !authorizationValidator.validate(authorization).valid)
    || !createJsonSchemaValidator(schemas[1]).validate(output).valid) {
    return fail("PROVIDERS_HOST_OUTPUT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The provider-host projection failed its closed schema.");
  }
  return Object.freeze({ output });
  };
}

async function resolveProductionRequest(args: readonly string[], repositoryRoot: string): Promise<ProviderHostCommandResolution> {
  const [lifecycle, graph, work, models] = await Promise.all([
    import("../continuous/lifecycle.ts"),
    import("../graph/index.ts"),
    import("../graph/work.ts"),
    import("./models.ts"),
  ]);
  const parsed = parseArguments(args, lifecycle.validateVersionedProfile, lifecycle.validateRepositoryManifest);
  let result;
  try {
    result = work.deriveWork(graph.loadSemanticGraph(repositoryRoot, parsed.manifest), {
      profile: parsed.profile,
      selector: providerCensusWork,
      maxItems: 1,
    });
  } catch (error) {
    const reasonCode = error instanceof UsfError ? error.code : error instanceof Error ? error.message : "GRAPH_LOAD_FAILED";
    return fail("PROVIDERS_HOST_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The subscription-host semantic scope could not be derived.", { reasonCode });
  }
  const packet = result.items?.[0];
  if (
    result.status !== "ok"
    || result.semanticDigest === undefined
    || result.items?.length !== 1
    || packet?.id !== providerCensusWork
    || packet.contract !== providerCensusContract
    || packet.decisionBoundary.kind !== "realisation-profile"
    || packet.decisionBoundary.root !== parsed.profile
    || packet.decisionBoundary.profileVersion === undefined
    || packet.decisionBoundary.product === undefined
    || packet.decisionBoundary.foundation === undefined
  ) {
    return fail("PROVIDERS_HOST_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The selected profile does not resolve the exact provider-census capability.");
  }
  const stage = packet.realisationStage;
  if (stage?.stage !== "verified-complete" || stage.completion.verified !== true || stage.completion.proofResult === null) {
    return fail(
      "PROVIDERS_HOST_PROOFBLOCKED",
      exitCodes.DOMAIN_FAILURE,
      "The registered subscription-host census remains unavailable until provider-census completion is independently verified and published.",
      { capabilityStage: stage?.stage ?? "unknown", completionReasonCodes: stage?.completion.reasonCodes ?? [] },
    );
  }
  const catalogue = await models.readLocalCatalogue(repositoryRoot);
  return Object.freeze({
    maxItems: parsed.maxItems,
    providerHome: parsed.providerHome,
    catalogue: catalogue.snapshot,
    scope: Object.freeze({
      status: "selected",
      profile: parsed.profile,
      profileVersion: packet.decisionBoundary.profileVersion,
      product: packet.decisionBoundary.product,
      foundation: packet.decisionBoundary.foundation,
      manifest: parsed.manifest,
      semanticDigest: result.semanticDigest,
      work: providerCensusWork,
      contract: providerCensusContract,
      scopedDependencyDigest: packet.scopedDependencyDigest,
      capabilityStage: "verified-complete",
      completionProofResult: stage.completion.proofResult,
    }),
  });
}

export const providerHostsCommandHandler: CommandHandler = createProviderHostsCommandHandler({
  resolveRequest: resolveProductionRequest,
  observe: observeSubscriptionHosts,
});
