import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { exitCodes, UsfError } from "../core/errors.ts";
import type { SemanticGraph } from "../graph/index.ts";

/**
 * A product repository USF realises into.
 *
 * USF is the reusable foundation; a product is realised against it. The product
 * therefore lives in its own repository, and USF must be able to write there
 * without weakening the containment that keeps it from writing anywhere else.
 *
 * The tracked graph declares a repository by identity and layout only. Where
 * that repository sits on a given machine is local operator state, held in an
 * ignored mapping file exactly as credentials are, so the graph stays
 * machine-independent and a third party can clone USF and point the same
 * declaration at their own checkout.
 */
const P = "urn:usf:predicate:";
const productRepositoryType = "urn:usf:type:ProductRepository";
export const repositoryLocatorPath = ".usf/repositories.json";

export interface DeclaredProductRepository {
  readonly repository: string;
  readonly canonicalName: string;
  /** Key into the local locator mapping; never a path. */
  readonly locator: string;
  readonly authorizedPathPrefixes: readonly string[];
  readonly requiredFiles: readonly string[];
  readonly product: string | null;
}

function one(graph: SemanticGraph, subject: string, predicate: string): string | null {
  const values = graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`);
  return values.length === 1 ? values[0]!.object : null;
}
function many(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return Object.freeze([...new Set(graph.quads
    .filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object))].sort());
}

export function readProductRepositories(graph: SemanticGraph): readonly DeclaredProductRepository[] {
  const subjects = graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === productRepositoryType)
    .map((quad) => quad.subject).sort();
  return Object.freeze([...new Set(subjects)].map((repository) => Object.freeze({
    repository,
    canonicalName: one(graph, repository, "canonicalName") ?? repository.split(":").slice(-2, -1)[0] ?? repository,
    locator: one(graph, repository, "repositoryLocator") ?? "",
    authorizedPathPrefixes: many(graph, repository, "authorizedPathPrefix"),
    requiredFiles: many(graph, repository, "requiredRepositoryFile"),
    product: one(graph, repository, "product"),
  })));
}

interface LocatorFile {
  readonly schema?: unknown;
  readonly repositories?: Readonly<Record<string, unknown>>;
}

/**
 * Resolve and authenticate the declared repository's root.
 *
 * Authentication is the whole point: a mapping file is ignored local state, so
 * it is not authority for what may be written. It only names a candidate, and
 * the candidate must be a real owner-owned directory whose canonical path
 * equals its lexical path before anything is written into it.
 */
export async function authenticateProductRepositoryRoot(
  usfRoot: string,
  declared: DeclaredProductRepository,
): Promise<string> {
  if (declared.locator.length === 0) {
    throw new UsfError("PRODUCT_REPOSITORY_LOCATOR_UNDECLARED", exitCodes.DOMAIN_FAILURE,
      "The product repository declares no locator, so no local checkout can be resolved for it.",
      { repository: declared.repository });
  }
  const bytes = await readFile(resolve(usfRoot, repositoryLocatorPath), "utf8").catch(() => undefined);
  if (bytes === undefined) {
    throw new UsfError("PRODUCT_REPOSITORY_UNMAPPED", exitCodes.EXTERNAL_UNAVAILABLE,
      `No local repository mapping exists. Create ${repositoryLocatorPath} mapping this locator to a checkout.`,
      { repository: declared.repository, locator: declared.locator, expected: repositoryLocatorPath });
  }
  let mapping: LocatorFile;
  try { mapping = JSON.parse(bytes) as LocatorFile; }
  catch {
    throw new UsfError("PRODUCT_REPOSITORY_MAPPING_INVALID", exitCodes.INVALID_INPUT,
      "The local repository mapping is not valid JSON.", { path: repositoryLocatorPath });
  }
  const candidate = mapping.repositories?.[declared.locator];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new UsfError("PRODUCT_REPOSITORY_UNMAPPED", exitCodes.EXTERNAL_UNAVAILABLE,
      "The local repository mapping names no checkout for this locator.",
      { repository: declared.repository, locator: declared.locator });
  }
  // A relative locator resolves against the USF root so a sibling checkout can
  // be declared without an absolute path.
  const target = isAbsolute(candidate) ? candidate : resolve(usfRoot, candidate);
  const entry = await lstat(target).catch(() => undefined);
  if (entry === undefined || !entry.isDirectory() || entry.isSymbolicLink()) {
    throw new UsfError("PRODUCT_REPOSITORY_ROOT_UNSAFE", exitCodes.CONTAINMENT_REFUSAL,
      "A product repository root must be an existing real directory.", { repository: declared.repository });
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : entry.uid;
  if (entry.uid !== uid || (entry.mode & 0o002) !== 0) {
    throw new UsfError("PRODUCT_REPOSITORY_ROOT_UNSAFE", exitCodes.CONTAINMENT_REFUSAL,
      "A product repository root must be owner-owned and not world-writable.", { repository: declared.repository });
  }
  const canonical = await realpath(target);
  if (canonical !== target) {
    throw new UsfError("PRODUCT_REPOSITORY_ROOT_UNSAFE", exitCodes.CONTAINMENT_REFUSAL,
      "A product repository root must equal its canonical path.", { repository: declared.repository });
  }
  for (const required of declared.requiredFiles) {
    const present = await lstat(resolve(canonical, required)).then((item) => item.isFile(), () => false);
    if (!present) {
      throw new UsfError("PRODUCT_REPOSITORY_LAYOUT_INCOMPLETE", exitCodes.DOMAIN_FAILURE,
        "The product repository does not satisfy its declared layout.",
        { repository: declared.repository, missing: required });
    }
  }
  return canonical;
}

/** Lexical containment of a repository-relative path within an authenticated root. */
export function containedInRoot(root: string, path: string): boolean {
  const target = resolve(root, path);
  const relation = relative(root, target);
  return relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation) && relation.length > 0;
}
