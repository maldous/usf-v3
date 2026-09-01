import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import { canonicalQuadLine, type Quad } from "../../../src/graph/nquads.ts";
import {
  authenticateProductRepositoryRoot, containedInRoot, readProductRepositories,
} from "../../../src/core/product-repository.ts";

const G = "urn:anqr:graph:profile";
const P = "urn:usf:predicate:";
function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "literal"): Quad {
  const built = { subject, predicate, object, objectKind, graph: G, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}
function graphOf(quads: readonly Quad[]): SemanticGraph {
  return Object.freeze({ quads: Object.freeze([...quads]) }) as unknown as SemanticGraph;
}
const repository = "urn:anqr:repository:main";
function declaration(): Quad[] {
  return [
    quad(repository, `${P}type`, "urn:usf:type:ProductRepository", "iri"),
    quad(repository, `${P}canonicalName`, "anqr"),
    quad(repository, `${P}repositoryLocator`, "anqr-main"),
    quad(repository, `${P}authorizedPathPrefix`, "src/"),
    quad(repository, `${P}requiredRepositoryFile`, "package.json"),
  ];
}

const roots: string[] = [];
async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "usf-product-repo-"));
  roots.push(root);
  await mkdir(resolve(root, ".usf"), { recursive: true, mode: 0o700 });
  return root;
}
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

test("a product repository is declared by identity and layout, never by path", () => {
  const declared = readProductRepositories(graphOf(declaration()));
  assert.equal(declared.length, 1);
  assert.equal(declared[0]!.locator, "anqr-main");
  assert.deepEqual(declared[0]!.authorizedPathPrefixes, ["src/"]);
  // The tracked declaration carries no filesystem location, so the graph stays
  // machine-independent and another operator can point it at their own checkout.
  assert.equal(JSON.stringify(declared[0]).includes("/home"), false);
});

test("an unmapped or unsafe root is refused before anything is written", async () => {
  const root = await workspace();
  const declared = readProductRepositories(graphOf(declaration()))[0]!;

  await assert.rejects(
    () => authenticateProductRepositoryRoot(root, declared),
    (error: unknown) => (error as { code?: string }).code === "PRODUCT_REPOSITORY_UNMAPPED");

  // Mapped, but the checkout does not exist.
  await writeFile(resolve(root, ".usf/repositories.json"),
    JSON.stringify({ repositories: { "anqr-main": "./absent" } }), { mode: 0o600 });
  await assert.rejects(
    () => authenticateProductRepositoryRoot(root, declared),
    (error: unknown) => (error as { code?: string }).code === "PRODUCT_REPOSITORY_ROOT_UNSAFE");

  // Exists, but does not satisfy the declared layout.
  await mkdir(resolve(root, "checkout"), { recursive: true });
  await writeFile(resolve(root, ".usf/repositories.json"),
    JSON.stringify({ repositories: { "anqr-main": "./checkout" } }), { mode: 0o600 });
  await assert.rejects(
    () => authenticateProductRepositoryRoot(root, declared),
    (error: unknown) => (error as { code?: string }).code === "PRODUCT_REPOSITORY_LAYOUT_INCOMPLETE");

  // Layout satisfied: authentication succeeds and yields the canonical root.
  await writeFile(resolve(root, "checkout/package.json"), "{}\n", { mode: 0o600 });
  const authenticated = await authenticateProductRepositoryRoot(root, declared);
  assert.equal(authenticated, resolve(root, "checkout"));
});

test("containment is enforced relative to the authenticated root", () => {
  assert.equal(containedInRoot("/a/b", "src/x.ts"), true);
  assert.equal(containedInRoot("/a/b", "../c/x.ts"), false);
  assert.equal(containedInRoot("/a/b", "src/../../c/x.ts"), false);
  // The root itself is not a writable path.
  assert.equal(containedInRoot("/a/b", "."), false);
});
