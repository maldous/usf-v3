import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runBootstrapLoop } from "../src/bootstrap/loop.ts";
import { loadSemanticGraph } from "../src/graph/index.ts";
import { deriveWork } from "../src/graph/work.ts";
import { fakeProviderRoutes } from "../src/providers/index.ts";

export const pathScopeSource = `import { posix } from "node:path";

export type RepositoryPathKind = "file" | "directory";

const globMagic = /[*?\\[\\]{}!]/;
const controlCharacters = /[\\u0000-\\u001f\\u007f]/;

function isControlSegment(segment: string): boolean {
  return segment === ".git" || segment === ".usf" || segment === ".env" || segment.startsWith(".env.");
}

/** Lexically validate one POSIX repository-relative path without filesystem access. */
export function parseRepositoryPath(value: unknown, kind: RepositoryPathKind): string | null {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.startsWith("./") || value.includes("\\\\") || globMagic.test(value) || controlCharacters.test(value)) return null;
  const directory = value.endsWith("/");
  if ((kind === "directory") !== directory) return null;
  const body = directory ? value.slice(0, -1) : value;
  if (body.length === 0 || posix.normalize(body) !== body) return null;
  const segments = body.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || isControlSegment(segment))) return null;
  return value;
}

/** File-operation paths are files; directory permissions use parseRepositoryPath directly. */
export function isRepositoryRelativePath(value: unknown): value is string {
  return parseRepositoryPath(value, "file") !== null;
}

/** Exact files cover only themselves; slash-terminated directories cover their descendants. */
export function isPathWithinPermission(path: string, permission: string): boolean {
  const pathKind: RepositoryPathKind = path.endsWith("/") ? "directory" : "file";
  const permissionKind: RepositoryPathKind = permission.endsWith("/") ? "directory" : "file";
  if (parseRepositoryPath(path, pathKind) === null || parseRepositoryPath(permission, permissionKind) === null) return false;
  return permissionKind === "file" ? path === permission : path.startsWith(permission);
}
`;

export const pathScopeTests = `import assert from "node:assert/strict";
import test from "node:test";
import { isPathWithinPermission, isRepositoryRelativePath, parseRepositoryPath } from "../../../src/core/scope.ts";

test("canonical repository files and explicit directories are distinguished", () => {
  assert.equal(parseRepositoryPath("src/core/scope.ts", "file"), "src/core/scope.ts");
  assert.equal(parseRepositoryPath(".github/workflows/ci.yml", "file"), ".github/workflows/ci.yml");
  assert.equal(parseRepositoryPath("src/core/", "directory"), "src/core/");
  assert.equal(parseRepositoryPath("src/core", "directory"), null);
  assert.equal(parseRepositoryPath("src/core/", "file"), null);
  assert.equal(isRepositoryRelativePath("src/core/scope.ts"), true);
  assert.equal(isRepositoryRelativePath("src/core/"), false);
});

test("absolute, traversal, non-canonical, magic and control paths fail closed", () => {
  for (const value of [
    "/etc/passwd", "C:\\\\Windows\\\\system.ini", "../outside", "src/../outside", "./src/file.ts",
    "src//file.ts", "src/./file.ts", "src/*.ts", "src/[ab].ts", ".git/config", "src/.git/config",
    ".usf/state.json", "src/.usf/state.json", ".env", ".env.local", "config/.env.production", "nul\\u0000byte",
  ]) assert.equal(parseRepositoryPath(value, "file"), null, value);
});

test("file and directory permissions cannot be confused by sibling prefixes", () => {
  assert.equal(isPathWithinPermission("src/core/scope.ts", "src/core/scope.ts"), true);
  assert.equal(isPathWithinPermission("src/core/other.ts", "src/core/scope.ts"), false);
  assert.equal(isPathWithinPermission("src/core/scope.ts", "src/core/"), true);
  assert.equal(isPathWithinPermission("src/core/nested/file.ts", "src/core/"), true);
  assert.equal(isPathWithinPermission("src/core-ish/file.ts", "src/core/"), false);
  assert.equal(isPathWithinPermission("../outside", "src/"), false);
  assert.equal(isPathWithinPermission("src/file.ts", "src/*"), false);
});
`;

export async function executePathScopeSelfHost(repositoryRoot = resolve(import.meta.dirname, "..")) {
  const result = deriveWork(loadSemanticGraph(repositoryRoot, "graph/manifests/self-host.json"), { selector: "profile:urn:usf:profile:v3-self-host:1" });
  const work = result.status === "ok" ? result.items?.find((item) => item.id === "urn:usf:work:repository-path-scope") : undefined;
  if (!work) throw new Error(`SELF_HOST_WORK_REFUSED:${result.reasonCode ?? "NOT_EXACT"}`);
  const [sourceRoute, testRoute] = fakeProviderRoutes();
  if (!sourceRoute || !testRoute) throw new Error("SELF_HOST_ROUTES_UNAVAILABLE");
  return runBootstrapLoop({
    repositoryRoot,
    work,
    proposals: [
      { route: sourceRoute, operations: [{ kind: "write", path: "src/core/scope.ts", content: pathScopeSource }] },
      { route: testRoute, operations: [{ kind: "write", path: "tests/unit/core/scope.test.ts", content: pathScopeTests }] },
    ],
    validationId: "urn:usf:validation:repository-path-tests",
    hostConcurrency: 2,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(await executePathScopeSelfHost())}\n`);
}
