import type { SemanticGraph } from "./index.ts";
import { isRepositoryRelativePath } from "../core/scope.ts";

export type OwningModel = "ANQR" | "USF" | "UXF" | "UIF";

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
  readonly supersedes: string | null;
  readonly realisationDisposition?: "no-change";
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
  const profile = one("selectedProfile", "iri", "LINEAR_BINDING_PROFILE_MISSING");
  const targetManifest = one("targetManifest", "literal", "LINEAR_BINDING_MANIFEST_MISSING");
  if (!isRepositoryRelativePath(targetManifest)) refuse("LINEAR_BINDING_MANIFEST_MISSING");
  const workIri = one("workIri", "iri", "LINEAR_BINDING_WORK_MISSING");
  const fixedPrompt = one("fixedPrompt", "literal", "LINEAR_BINDING_PROMPT_POLICY_INVALID", 4 * 1024 * 1024);
  if (new TextEncoder().encode(fixedPrompt).byteLength > 4 * 1024 * 1024) refuse("LINEAR_BINDING_PROMPT_POLICY_INVALID");
  const supersedes = field("supersedesBinding", "iri", "LINEAR_BINDING_SUPERSESSION_INVALID", true);
  const realisationDisposition = field("realisationDisposition", "literal", "LINEAR_BINDING_REALISATION_DISPOSITION_INVALID", true);
  if (realisationDisposition !== null && realisationDisposition !== "no-change") refuse("LINEAR_BINDING_REALISATION_DISPOSITION_INVALID");
  return Object.freeze({ bindingIri, locator, workspace, issueUuid, owner, profile, targetManifest, workIri, fixedPrompt, maximumPromptTokens, supersedes,
    ...(realisationDisposition === null ? {} : { realisationDisposition }),
  });
}
