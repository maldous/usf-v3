import assert from "node:assert/strict";
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
    "/etc/passwd", "C:\\Windows\\system.ini", "../outside", "src/../outside", "./src/file.ts",
    "src//file.ts", "src/./file.ts", "src/*.ts", "src/[ab].ts", ".git/config", "src/.git/config",
    ".usf/state.json", "src/.usf/state.json", ".env", ".env.local", "config/.env.production", "nul\u0000byte",
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
