import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { validateRepositoryManifest, validateVersionedProfile } from "../continuous/lifecycle.ts";
import { loadSemanticGraph, objectValues, resourceDigest, type SemanticGraph } from "../graph/index.ts";
import { deriveWork } from "../graph/work.ts";
import { parseProviderConfig, type ProviderRouteConfig } from "../providers/config.ts";
import {
  accountSourceAuthorizationDigest,
  accountTierReceiptDigest,
  parseAccountSourceAuthorization,
  parseAccountTierReceipt,
  verifyAccountTierReceipt,
  type AccountSourceAuthorization,
  type AccountTierReceipt,
} from "../providers/economics.ts";
import type { CommandHandler } from "./dispatcher.ts";

const workIri = "urn:usf:work:provider-account-tier-receipt";
const contractIri = "urn:usf:contract:provider-account-tier-receipt:1";
const acquisitionContractIri = "urn:usf:contract:provider-account-receipt-acquisition:1";
const protocolIri = "urn:usf:provider-operation:account-source-protocol:1";
const candidateMappingPredicate = "urn:usf:predicate:candidateMapping";
const providerPredicate = "urn:usf:predicate:provider";
const endpointPredicate = "urn:usf:predicate:endpointIdentity";
const credentialNamePredicate = "urn:usf:predicate:credentialName";
const mappingDispositionPredicate = "urn:usf:predicate:mappingDisposition";
const privacyPredicate = "urn:usf:predicate:privacy";
const routePattern = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,191}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const receiptPathPattern = /^\.usf\/provider-operations\/routes\/([0-9a-f]{64})\/account\/([0-9a-f]{64})\.json$/u;
const maximumConfigBytes = 256 * 1024;
const maximumPolicyBytes = 64 * 1024;
const maximumRecordBytes = 256 * 1024;

interface ParsedRequest {
  readonly operation: "acquire" | "verify";
  readonly route: string;
  readonly profile: string;
  readonly manifest: string;
  readonly receipt: string | undefined;
}

function refuse(code: string, exitCode: (typeof exitCodes)[keyof typeof exitCodes], message: string, details?: Record<string, unknown>): never {
  throw new UsfError(code, exitCode, message, details);
}

function parseRequest(args: readonly string[]): ParsedRequest {
  const operation = args[0];
  if (operation !== "acquire" && operation !== "verify") {
    refuse("PROVIDERS_RECEIPT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Provider receipt requires acquire or verify.");
  }
  const remaining = args.slice(1);
  if (remaining.length % 2 !== 0) refuse("PROVIDERS_RECEIPT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Provider receipt options require explicit values.");
  const values = new Map<string, string>();
  for (let index = 0; index < remaining.length; index += 2) {
    const option = remaining[index]!;
    const value = remaining[index + 1]!;
    if (!option.startsWith("--") || value.length === 0 || value.startsWith("--") || values.has(option)) {
      refuse("PROVIDERS_RECEIPT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Provider receipt options must be unique flag/value pairs.");
    }
    values.set(option, value);
  }
  const allowed = new Set(["--route", "--profile", "--manifest"]);
  if (operation === "verify") allowed.add("--receipt");
  for (const option of values.keys()) if (!allowed.has(option)) {
    refuse("PROVIDERS_RECEIPT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Provider receipt received an unknown option.");
  }
  const route = values.get("--route");
  const selectedProfile = values.get("--profile");
  const selectedManifest = values.get("--manifest");
  const receipt = values.get("--receipt");
  if (route === undefined || !routePattern.test(route) || selectedProfile === undefined || selectedManifest === undefined
    || (operation === "verify" && receipt === undefined) || (operation === "acquire" && receipt !== undefined)) {
    refuse("PROVIDERS_RECEIPT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Provider receipt requires the exact route, versioned profile and manifest; verify also requires one receipt path.");
  }
  let profile: string;
  let manifest: string;
  try {
    profile = validateVersionedProfile(selectedProfile);
    manifest = validateRepositoryManifest(selectedManifest);
  } catch {
    return refuse("PROVIDERS_RECEIPT_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "The provider receipt profile or manifest is invalid.");
  }
  if (receipt !== undefined && (receipt.length > 512 || receipt.includes("\0") || receipt.includes("\\") || !receiptPathPattern.test(receipt))) {
    refuse("PROVIDERS_RECEIPT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The receipt path is outside the exact ignored route-local account root.");
  }
  return Object.freeze({ operation, route, profile, manifest, receipt });
}

function currentUid(): number {
  if (typeof process.getuid !== "function") refuse("PROVIDERS_RECEIPT_OWNER_UNAVAILABLE", exitCodes.CONTAINMENT_REFUSAL, "Owner identity is unavailable.");
  return process.getuid();
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function exactContainedFilePath(root: string, repositoryPath: string, privateFile: boolean): string {
  const canonicalRoot = realpathSync(resolve(root));
  if (repositoryPath.length === 0 || repositoryPath.includes("\0") || repositoryPath.includes("\\") || isAbsolute(repositoryPath)
    || repositoryPath.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    refuse("PROVIDERS_RECEIPT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The route-local record path is not canonical.");
  }
  const absolute = resolve(canonicalRoot, repositoryPath);
  if (!contained(canonicalRoot, absolute)) {
    refuse("PROVIDERS_RECEIPT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The route-local record escapes the repository.");
  }
  const uid = currentUid();
  let cursor = canonicalRoot;
  for (const segment of repositoryPath.split("/").slice(0, -1)) {
    cursor = resolve(cursor, segment);
    let entry;
    try { entry = lstatSync(cursor); }
    catch { return refuse("PROVIDERS_RECEIPT_FILE_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "A required route-local receipt record is unavailable."); }
    let canonical: string;
    try { canonical = realpathSync(cursor); }
    catch { return refuse("PROVIDERS_RECEIPT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The route-local record ancestry cannot be authenticated."); }
    if (entry.isSymbolicLink() || !entry.isDirectory() || canonical !== cursor || !contained(canonicalRoot, canonical)
      || (privateFile && (entry.uid !== uid || (entry.mode & 0o077) !== 0))) {
      refuse("PROVIDERS_RECEIPT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The route-local record ancestry is not owner-contained.");
    }
  }
  let canonicalFile: string;
  try { canonicalFile = realpathSync(absolute); }
  catch { return refuse("PROVIDERS_RECEIPT_FILE_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "A required route-local receipt record is unavailable."); }
  if (canonicalFile !== absolute || !contained(canonicalRoot, canonicalFile)) {
    refuse("PROVIDERS_RECEIPT_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "The route-local record ancestry escapes the repository.");
  }
  return absolute;
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.mode === right.mode
    && left.nlink === right.nlink && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

export function readContainedProviderReceiptFile(root: string, repositoryPath: string, maximumBytes: number, privateFile: boolean): Buffer {
  const path = exactContainedFilePath(root, repositoryPath, privateFile);
  let named;
  try { named = lstatSync(path); }
  catch { return refuse("PROVIDERS_RECEIPT_FILE_UNAVAILABLE", exitCodes.CURRENTNESS_FAILURE, "A required route-local receipt record is unavailable."); }
  const uid = currentUid();
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || named.size > maximumBytes
    || (privateFile && (named.uid !== uid || (named.mode & 0o7777) !== 0o600))) {
    refuse("PROVIDERS_RECEIPT_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A required receipt record is not a bounded owner-private regular file.");
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(named, opened)) {
      refuse("PROVIDERS_RECEIPT_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A receipt record changed while it was opened.");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    let namedAfter;
    try { namedAfter = lstatSync(path); }
    catch { return refuse("PROVIDERS_RECEIPT_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A receipt record changed while it was read."); }
    if (!sameFileIdentity(opened, after) || !sameFileIdentity(named, namedAfter) || bytes.byteLength !== opened.size
      || exactContainedFilePath(root, repositoryPath, privateFile) !== path) {
      refuse("PROVIDERS_RECEIPT_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A receipt record changed while it was read.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return refuse("PROVIDERS_RECEIPT_FILE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A receipt record could not be opened and read through the contained no-follow boundary.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseCanonicalJson<T>(bytes: Buffer, parse: (value: unknown) => T, reason: string): T {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return refuse(reason, exitCodes.CURRENTNESS_FAILURE, "A receipt record is not bounded canonical UTF-8 JSON."); }
  let parsed: T;
  try { parsed = parse(value); }
  catch { return refuse(reason, exitCodes.CURRENTNESS_FAILURE, "A receipt record does not satisfy its closed schema."); }
  if (`${canonicalJson(parsed, { rejectAbsolutePaths: true })}\n` !== bytes.toString("utf8")) {
    refuse(reason, exitCodes.CURRENTNESS_FAILURE, "A receipt record is not exact canonical JSON.");
  }
  return parsed;
}

function readProviderConfig(root: string): readonly ProviderRouteConfig[] {
  const bytes = readContainedProviderReceiptFile(root, "config/providers.json", maximumConfigBytes, false);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return refuse("PROVIDERS_RECEIPT_CONFIG_INVALID", exitCodes.CURRENTNESS_FAILURE, "The provider configuration is invalid."); }
  try { return parseProviderConfig(value).routes; }
  catch { return refuse("PROVIDERS_RECEIPT_CONFIG_INVALID", exitCodes.CURRENTNESS_FAILURE, "The provider configuration does not satisfy its closed schema."); }
}

function currentPolicyDigest(root: string): string {
  const bytes = readContainedProviderReceiptFile(root, "config/policy.json", maximumPolicyBytes, false);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return refuse("PROVIDERS_RECEIPT_POLICY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The tracked effective policy is invalid."); }
  try { return canonicalDigest(value, { rejectAbsolutePaths: true }); }
  catch { return refuse("PROVIDERS_RECEIPT_POLICY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The tracked effective policy cannot be projected canonically."); }
}

function currentPrivacyProjectionDigest(graph: SemanticGraph): string {
  const classification = exactValue(graph, acquisitionContractIri, privacyPredicate, "literal");
  if (classification === null) {
    refuse("PROVIDERS_RECEIPT_PRIVACY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The account-source privacy projection is unavailable.");
  }
  return canonicalDigest({ contract: acquisitionContractIri, classification }, { rejectAbsolutePaths: true });
}

function semanticAuthority(root: string, request: ParsedRequest): SemanticGraph {
  let graph: SemanticGraph;
  let result;
  try {
    graph = loadSemanticGraph(root, request.manifest);
    result = deriveWork(graph, { profile: request.profile, selector: workIri, maxItems: 1 });
  } catch (error) {
    return refuse("PROVIDERS_RECEIPT_SCOPE_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The exact provider receipt semantic scope could not be derived.", {
      reasonCode: error instanceof Error ? error.message.slice(0, 160) : "GRAPH_LOAD_FAILED",
    });
  }
  const packet = result.items?.[0];
  if (result.status !== "ok" || result.items?.length !== 1 || packet?.id !== workIri || packet.contract !== contractIri
    || packet.decisionBoundary.kind !== "realisation-profile" || packet.decisionBoundary.root !== request.profile
    || packet.eligibility?.construction.eligible !== true || packet.eligibility.construction.authority !== "active-permission") {
    refuse("PROVIDERS_RECEIPT_PROOFBLOCKED", exitCodes.DOMAIN_FAILURE, "The exact account-tier receipt capability is not currently active.");
  }
  return graph;
}

function exactValue(graph: SemanticGraph, subject: string, predicate: string, kind: "iri" | "literal"): string | null {
  const values = graph.quads.filter((quad) => quad.subject === subject && quad.predicate === predicate && quad.objectKind === kind);
  return values.length === 1 ? values[0]!.object : null;
}

function sortedValues(graph: SemanticGraph, subject: string, predicate: string, kind: "iri" | "literal"): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.subject === subject && quad.predicate === predicate && quad.objectKind === kind)
    .map((quad) => quad.object)
    .sort());
}

function accountSourceProtocolDigest(graph: SemanticGraph): string {
  return canonicalDigest({
    iri: protocolIri,
    version: exactValue(graph, protocolIri, "urn:usf:predicate:version", "literal"),
    acquisitionOwner: exactValue(graph, protocolIri, "urn:usf:predicate:acquisitionOwner", "literal"),
    authoritativeSourceOwner: exactValue(graph, protocolIri, "urn:usf:predicate:authoritativeSourceOwner", "literal"),
    contactClass: exactValue(graph, protocolIri, "urn:usf:predicate:contactClass", "literal"),
    requiredBasis: sortedValues(graph, protocolIri, "urn:usf:predicate:requiredBasis", "literal"),
    refuses: sortedValues(graph, protocolIri, "urn:usf:predicate:refuses", "literal"),
    nonClaims: sortedValues(graph, protocolIri, "urn:usf:predicate:nonClaim", "literal"),
  }, { rejectAbsolutePaths: true });
}

function accountSourceMappingDigest(graph: SemanticGraph, mapping: string): string {
  return canonicalDigest({
    iri: mapping,
    version: exactValue(graph, mapping, "urn:usf:predicate:version", "literal"),
    provider: exactValue(graph, mapping, providerPredicate, "literal"),
    endpointIdentity: exactValue(graph, mapping, endpointPredicate, "literal"),
    fixedOrigin: exactValue(graph, mapping, "urn:usf:predicate:fixedOrigin", "literal"),
    method: exactValue(graph, mapping, "urn:usf:predicate:method", "literal"),
    authentication: exactValue(graph, mapping, "urn:usf:predicate:authentication", "literal"),
    credentialName: exactValue(graph, mapping, "urn:usf:predicate:credentialName", "literal"),
    maximumResponseBytes: exactValue(graph, mapping, "urn:usf:predicate:maximumResponseBytes", "literal"),
    timeoutMilliseconds: exactValue(graph, mapping, "urn:usf:predicate:timeoutMilliseconds", "literal"),
    redirectPolicy: exactValue(graph, mapping, "urn:usf:predicate:redirectPolicy", "literal"),
    responseMediaType: exactValue(graph, mapping, "urn:usf:predicate:responseMediaType", "literal"),
    responseRoot: exactValue(graph, mapping, "urn:usf:predicate:responseRoot", "literal"),
    mapsFields: sortedValues(graph, mapping, "urn:usf:predicate:mapsField", "literal"),
    ignoredFields: sortedValues(graph, mapping, "urn:usf:predicate:ignoredField", "literal"),
    mappingDisposition: exactValue(graph, mapping, mappingDispositionPredicate, "literal"),
    missingRequiredEvidence: sortedValues(graph, mapping, "urn:usf:predicate:missingRequiredEvidence", "literal"),
    responseMappingDigestRule: exactValue(graph, mapping, "urn:usf:predicate:responseMappingDigestRule", "literal"),
    nonClaims: sortedValues(graph, mapping, "urn:usf:predicate:nonClaim", "literal"),
  }, { rejectAbsolutePaths: true });
}

function mappingForRoute(graph: SemanticGraph, route: ProviderRouteConfig): Readonly<{
  iri: string;
  endpoint: string;
  credentialName: string;
  maximumResponseBytes: number;
  timeoutMilliseconds: number;
  protocolDigest: string;
  mappingDigest: string;
  disposition: string;
}> {
  const candidates = objectValues(graph, protocolIri, candidateMappingPredicate)
    .filter((mapping) => exactValue(graph, mapping, providerPredicate, "literal") === route.provider);
  if (candidates.length !== 1) {
    refuse("PROVIDERS_RECEIPT_MAPPING_UNAVAILABLE", exitCodes.DOMAIN_FAILURE, "No unique graph-versioned provider-owned account-source mapping exists for this route.");
  }
  const mapping = candidates[0]!;
  const endpoint = exactValue(graph, mapping, endpointPredicate, "literal");
  const credentialName = exactValue(graph, mapping, credentialNamePredicate, "literal");
  const maximumResponseBytesText = exactValue(graph, mapping, "urn:usf:predicate:maximumResponseBytes", "literal");
  const timeoutMillisecondsText = exactValue(graph, mapping, "urn:usf:predicate:timeoutMilliseconds", "literal");
  const disposition = exactValue(graph, mapping, mappingDispositionPredicate, "literal");
  const maximumResponseBytes = Number(maximumResponseBytesText);
  const timeoutMilliseconds = Number(timeoutMillisecondsText);
  if (endpoint === null || credentialName === null || disposition === null
    || !Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1 || maximumResponseBytes > 1_048_576
    || !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 60_000) {
    refuse("PROVIDERS_RECEIPT_MAPPING_INVALID", exitCodes.CURRENTNESS_FAILURE, "The selected account-source mapping is incomplete.");
  }
  return Object.freeze({
    iri: mapping,
    endpoint,
    credentialName,
    maximumResponseBytes,
    timeoutMilliseconds,
    protocolDigest: accountSourceProtocolDigest(graph),
    mappingDigest: accountSourceMappingDigest(graph, mapping),
    disposition,
  });
}

function verifyReceipt(root: string, request: ParsedRequest, graph: SemanticGraph, route: ProviderRouteConfig): AccountTierReceipt {
  const routeMemberDigest = canonicalDigest(route, { rejectAbsolutePaths: true });
  const match = receiptPathPattern.exec(request.receipt!);
  if (match === null || match[1] !== routeMemberDigest.slice("sha256:".length)) {
    refuse("PROVIDERS_RECEIPT_ROUTE_MISMATCH", exitCodes.CONTAINMENT_REFUSAL, "The receipt path is not keyed by the selected exact route member.");
  }
  const mapping = mappingForRoute(graph, route);
  const receiptBytes = readContainedProviderReceiptFile(root, request.receipt!, maximumRecordBytes, true);
  const receipt = parseCanonicalJson(receiptBytes, parseAccountTierReceipt, "PROVIDERS_RECEIPT_INVALID");
  const receiptDigest = accountTierReceiptDigest(receipt);
  if (match[2] !== receiptDigest.slice("sha256:".length) || receipt.routeMemberDigest !== routeMemberDigest) {
    refuse("PROVIDERS_RECEIPT_DIGEST_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The route-local receipt filename or member binding is invalid.");
  }
  const routeRoot = `.usf/provider-operations/routes/${routeMemberDigest.slice("sha256:".length)}`;
  const authorizationPath = `${routeRoot}/account-authorization/${receipt.accountSourceAuthorizationDigest.slice("sha256:".length)}.json`;
  const authorizationBytes = readContainedProviderReceiptFile(root, authorizationPath, maximumRecordBytes, true);
  const authorization = parseCanonicalJson<AccountSourceAuthorization>(authorizationBytes, parseAccountSourceAuthorization, "PROVIDERS_RECEIPT_AUTHORIZATION_INVALID");
  if (accountSourceAuthorizationDigest(authorization) !== receipt.accountSourceAuthorizationDigest) {
    refuse("PROVIDERS_RECEIPT_AUTHORIZATION_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The retained authorization digest does not bind this receipt.");
  }
  const rawPath = `${routeRoot}/account-raw/${receipt.rawProviderResponseDigest.slice("sha256:".length)}.bin`;
  const raw = readContainedProviderReceiptFile(root, rawPath, mapping.maximumResponseBytes, true);
  const decision = verifyAccountTierReceipt({
    authorization,
    receipt,
    rawProviderResponse: raw,
    expectedRouteMemberDigest: routeMemberDigest,
    expectedProfileDigest: resourceDigest(graph, request.profile),
    expectedEffectivePolicyDigest: currentPolicyDigest(root),
    expectedPrivacyProjectionDigest: currentPrivacyProjectionDigest(graph),
    expectedAccountSourceProtocolDigest: mapping.protocolDigest,
    expectedEndpointIdentity: mapping.endpoint,
    expectedCredentialName: mapping.credentialName,
    expectedMaximumResponseBytes: mapping.maximumResponseBytes,
    expectedTimeoutMilliseconds: mapping.timeoutMilliseconds,
    trustedResponseMapping: Object.freeze({ iri: mapping.iri, digest: mapping.mappingDigest, disposition: mapping.disposition }),
    observedAt: new Date().toISOString(),
  });
  if (decision.code === "ACCOUNT_TIER_MAPPING_INSUFFICIENT") {
    refuse("PROVIDERS_RECEIPT_MAPPING_INSUFFICIENT", exitCodes.DOMAIN_FAILURE, "The graph-selected mapping cannot establish every zero-paid account fact from retained content-mapped bytes.", {
      mappingDisposition: mapping.disposition,
      contentVerified: true,
      authenticatedAccountIdentityDigest: decision.authenticatedAccountIdentityDigest,
      receiptDigest: decision.receiptDigest,
    });
  }
  if (!decision.allowed) {
    refuse("PROVIDERS_RECEIPT_VERIFICATION_REFUSED", exitCodes.CURRENTNESS_FAILURE, "The retained account receipt failed content-bound verification.", {
      receiptReasonCode: decision.code,
    });
  }
  return receipt;
}

export const providerReceiptsCommandHandler: CommandHandler = ({ args, repositoryRoot }) => {
  const request = parseRequest(args);
  const graph = semanticAuthority(repositoryRoot, request);
  if (request.operation === "acquire") {
    refuse("PROVIDERS_RECEIPT_PROOFBLOCKED", exitCodes.DOMAIN_FAILURE, "Live account-source acquisition remains separately proofblocked; no provider was contacted.");
  }
  const routes = readProviderConfig(repositoryRoot);
  const matching = routes.filter((route) => route.id === request.route);
  if (matching.length !== 1) refuse("PROVIDERS_RECEIPT_ROUTE_UNKNOWN", exitCodes.INVALID_INPUT, "The selected route is not uniquely configured.");
  const route = matching[0]!;
  return { output: verifyReceipt(repositoryRoot, request, graph, route) };
};
