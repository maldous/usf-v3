import { posix } from "node:path";

export type RepositoryPathKind = "file" | "directory";

const globMagic = /[*?\[\]{}!]/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

function isControlSegment(segment: string): boolean {
  return segment === ".git" || segment === ".usf" || segment === ".env" || segment.startsWith(".env.");
}

/** Lexically validate one POSIX repository-relative path without filesystem access. */
export function parseRepositoryPath(value: unknown, kind: RepositoryPathKind): string | null {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.startsWith("./") || value.includes("\\") || globMagic.test(value) || controlCharacters.test(value)) return null;
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
