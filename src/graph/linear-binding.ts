import type { SemanticGraph } from "./index.ts";
import { isRepositoryRelativePath } from "../core/scope.ts";
import { canonicalDigest } from "../core/canonical.ts";
import { parseLinearCandidateRepairPolicy, type LinearCandidateRepairPolicy } from "../core/linear-repair.ts";

export type OwningModel = "ANQR" | "USF" | "UXF" | "UIF";

export interface LinearSourceContextSelection {
  readonly path: string;
  readonly start: string;
  readonly end: string;
  readonly maximumBytes: number;
}

/** A semantic declaration, not runtime admission or authenticated supersession. */
export interface LinearBindingAuthority {
  readonly bindingIri: string;
  readonly locator: string;
  readonly workspace: string;
  readonly issueUuid: string;
  readonly owner: OwningModel;
  readonly profile: string;
  readonly targetManifest: string;
  readonly workIri: string;
  readonly fixedPrompt: string;
  readonly maximumPromptTokens: number;
  readonly maximumOutputTokens?: number;
  readonly supersedes: string | null;
  readonly realisationDisposition?: "no-change";
  readonly sourceContext?: readonly LinearSourceContextSelection[];
  readonly candidateRepair?: LinearCandidateRepairPolicy;
}

export class LinearBindingError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "LinearBindingError";
    this.reasonCode = reasonCode;
  }
}

const P = "urn:usf:predicate:";
const BINDING_TYPE = "urn:usf:type:LinearIssueWorkBinding";
const OWNERS = new Set<OwningModel>(["ANQR", "USF", "UXF", "UIF"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/u;
function refuse(reason: string): never { throw new LinearBindingError(reason); }

function sourceContextSelections(text: string | null): readonly LinearSourceContextSelection[] | undefined {
  if (text === null) return undefined;
  let value: unknown;
  try { value = JSON.parse(text); } catch { refuse("LINEAR_BINDING_SOURCE_CONTEXT_INVALID"); }
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) refuse("LINEAR_BINDING_SOURCE_CONTEXT_INVALID");
  const paths = new Set<string>();
  let maximumBytes = 0;
  const selections = value.map((item: unknown): LinearSourceContextSelection => {
    if (item === null || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).sort().join(",") !== "end,maximumBytes,path,start") refuse("LINEAR_BINDING_SOURCE_CONTEXT_INVALID");
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== "string" || !isRepositoryRelativePath(entry.path)
      || entry.path.includes("\\") || entry.path.includes("\u0000")
      || entry.path.split("/").some(part => part === "" || part === "." || part === "..")
      || paths.has(entry.path)
      || typeof entry.start !== "string" || entry.start.length === 0 || Buffer.byteLength(entry.start, "utf8") > 1024
      || typeof entry.end !== "string" || entry.end.length === 0 || Buffer.byteLength(entry.end, "utf8") > 1024
      || typeof entry.maximumBytes !== "number" || !Number.isSafeInteger(entry.maximumBytes)
      || entry.maximumBytes < 1 || entry.maximumBytes > 16384) refuse("LINEAR_BINDING_SOURCE_CONTEXT_INVALID");
    paths.add(entry.path);
    maximumBytes += entry.maximumBytes;
    if (maximumBytes > 65536) refuse("LINEAR_BINDING_SOURCE_CONTEXT_INVALID");
    return Object.freeze({ path: entry.path, start: entry.start, end: entry.end, maximumBytes: entry.maximumBytes });
  });
  return Object.freeze(selections);
}

export function deriveLinearBindingDeclaration(graph: SemanticGraph, bindingIri: string): LinearBindingAuthority {
  if (typeof bindingIri !== "string" || bindingIri.length > 4096 || !IRI.test(bindingIri)) refuse("LINEAR_BINDING_SELECTOR_INVALID");
  const rows = graph.quads.filter(q => q.subject === bindingIri);
  const field = (predicate: string, kind: "iri" | "literal", reason: string, optional = false, maximum = 4096): string | null => {
    const found = rows.filter(q => q.predicate === P + predicate);
    if (found.some(q => q.objectKind !== kind)) refuse("LINEAR_BINDING_FIELD_KIND_INVALID");
    if (optional && found.length === 0) return null;
    if (found.length !== 1) refuse(reason);
    const value = found[0]!.object;
    if (typeof value !== "string" || value.length === 0 || value.length > maximum || (kind === "iri" && !IRI.test(value))) refuse(reason);
    return value;
  };
  const one = (predicate: string, kind: "iri" | "literal", reason: string, maximum = 4096): string => field(predicate, kind, reason, false, maximum)!;
  if (one("type", "iri", "LINEAR_BINDING_GRAPH_BINDING_MISSING") !== BINDING_TYPE) refuse("LINEAR_BINDING_GRAPH_BINDING_MISSING");
  const workspace = one("issueWorkspace", "literal", "LINEAR_BINDING_LOCATOR_INVALID");
  const issueUuid = one("issueUuid", "literal", "LINEAR_BINDING_LOCATOR_INVALID").toLowerCase();
  if (!SAFE_PART.test(workspace) || !UUID.test(issueUuid)) refuse("LINEAR_BINDING_LOCATOR_INVALID");
  const locator = `${workspace}:${issueUuid}`;
  const declaredLocator = field("canonicalIssueLocator", "literal", "LINEAR_BINDING_LOCATOR_INVALID", true);
  if (declaredLocator !== null && declaredLocator !== locator) refuse("LINEAR_BINDING_LOCATOR_INVALID");
  const owner = one("owningModel", "literal", "LINEAR_BINDING_OWNER_INVALID") as OwningModel;
  if (!OWNERS.has(owner)) refuse("LINEAR_BINDING_OWNER_INVALID");
  const tokenText = one("maximumPromptTokens", "literal", "LINEAR_BINDING_PROMPT_POLICY_INVALID");
  const maximumPromptTokens = Number(tokenText);
  if (!/^[1-9][0-9]*$/u.test(tokenText) || !Number.isSafeInteger(maximumPromptTokens)) refuse("LINEAR_BINDING_PROMPT_POLICY_INVALID");
  const outputText = field("maximumOutputTokens", "literal", "LINEAR_BINDING_OUTPUT_POLICY_INVALID", true);
  const maximumOutputTokens = outputText === null ? undefined : Number(outputText);
  if (outputText !== null && (!/^[1-9][0-9]{0,9}$/u.test(outputText)
    || !Number.isSafeInteger(maximumOutputTokens))) refuse("LINEAR_BINDING_OUTPUT_POLICY_INVALID");
  const profile = one("selectedProfile", "iri", "LINEAR_BINDING_PROFILE_MISSING");
  const targetManifest = one("targetManifest", "literal", "LINEAR_BINDING_MANIFEST_MISSING");
  if (!isRepositoryRelativePath(targetManifest)) refuse("LINEAR_BINDING_MANIFEST_MISSING");
  const workIri = one("workIri", "iri", "LINEAR_BINDING_WORK_MISSING");
  const fixedPrompt = one("fixedPrompt", "literal", "LINEAR_BINDING_PROMPT_POLICY_INVALID", 4 * 1024 * 1024);
  if (new TextEncoder().encode(fixedPrompt).byteLength > 4 * 1024 * 1024) refuse("LINEAR_BINDING_PROMPT_POLICY_INVALID");
  const supersedes = field("supersedesBinding", "iri", "LINEAR_BINDING_SUPERSESSION_INVALID", true);
  const realisationDisposition = field("realisationDisposition", "literal", "LINEAR_BINDING_REALISATION_DISPOSITION_INVALID", true);
  if (realisationDisposition !== null && realisationDisposition !== "no-change") refuse("LINEAR_BINDING_REALISATION_DISPOSITION_INVALID");
  const sourceContext = sourceContextSelections(field("sourceContext", "literal", "LINEAR_BINDING_SOURCE_CONTEXT_INVALID", true, 65536));
  if (sourceContext !== undefined && realisationDisposition !== null) refuse("LINEAR_BINDING_SOURCE_CONTEXT_INVALID");
  if (maximumOutputTokens !== undefined && realisationDisposition !== null) refuse("LINEAR_BINDING_OUTPUT_POLICY_INVALID");
  const repairText = field("candidateRepair", "literal", "LINEAR_BINDING_REPAIR_POLICY_INVALID", true, 16384);
  const candidateRepair = repairText === null ? undefined : parseLinearCandidateRepairPolicy(repairText)
    ?? refuse("LINEAR_BINDING_REPAIR_POLICY_INVALID");
  if (candidateRepair !== undefined && (realisationDisposition !== null || sourceContext === undefined
    || (candidateRepair.round === 0
      ? candidateRepair.rootBinding !== bindingIri
      : candidateRepair.rootBinding === bindingIri || candidateRepair.predecessorBinding !== supersedes
        || candidateRepair.predecessorBinding === bindingIri))) refuse("LINEAR_BINDING_REPAIR_POLICY_INVALID");
  return Object.freeze({ bindingIri, locator, workspace, issueUuid, owner, profile, targetManifest, workIri, fixedPrompt, maximumPromptTokens, supersedes,
    ...(realisationDisposition === null ? {} : { realisationDisposition }),
    ...(sourceContext === undefined ? {} : { sourceContext }),
    ...(maximumOutputTokens === undefined ? {} : { maximumOutputTokens }),
    ...(candidateRepair === undefined ? {} : { candidateRepair }),
  });
}

/** Validate the complete finite declaration before any repair-chain dispatch. */
export function deriveLinearCandidateRepairChain(
  graph: SemanticGraph, authority: LinearBindingAuthority,
): readonly LinearBindingAuthority[] {
  const policy = authority.candidateRepair;
  if (policy === undefined) return Object.freeze([]);
  const subjects = [...new Set(graph.quads.filter(q => q.predicate === P + "candidateRepair").map(q => q.subject))];
  const chain = subjects.map(subject => deriveLinearBindingDeclaration(graph, subject))
    .filter(declaration => declaration.candidateRepair?.rootBinding === policy.rootBinding)
    .sort((left, right) => left.candidateRepair!.round - right.candidateRepair!.round);
  if (chain.length !== policy.maximumRounds + 1 || chain[0]?.bindingIri !== policy.rootBinding) {
    refuse("LINEAR_BINDING_REPAIR_CHAIN_INVALID");
  }
  const shape = (entry: LinearBindingAuthority): string => canonicalDigest({
    locator: entry.locator, owner: entry.owner, workIri: entry.workIri, profile: entry.profile,
    targetManifest: entry.targetManifest, fixedPrompt: entry.fixedPrompt,
    sourceContext: entry.sourceContext, maximumPromptTokens: entry.maximumPromptTokens,
    maximumOutputTokens: entry.maximumOutputTokens ?? null,
  });
  const expected = shape(authority);
  for (const [round, declaration] of chain.entries()) {
    const current = declaration.candidateRepair!;
    if (current.round !== round || current.maximumRounds !== policy.maximumRounds
      || shape(declaration) !== expected
      || (round > 0 && (current.predecessorBinding !== chain[round - 1]!.bindingIri
        || declaration.supersedes !== chain[round - 1]!.bindingIri))) {
      refuse("LINEAR_BINDING_REPAIR_CHAIN_INVALID");
    }
  }
  if (chain[0]!.supersedes !== null && chain.some(entry => entry.bindingIri === chain[0]!.supersedes)) {
    refuse("LINEAR_BINDING_REPAIR_CHAIN_INVALID");
  }
  return Object.freeze(chain);
}
