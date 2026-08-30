import { resolve } from "node:path";

/**
 * Minimal replacement environment for repository-local, read-only Git
 * inspection. Ambient credentials and all caller-supplied Git controls are
 * intentionally absent.
 */
export function localGitChildEnvironment(repositoryRoot: string): NodeJS.ProcessEnv {
  const usfRoot = resolve(repositoryRoot, ".usf");
  return Object.freeze({
    // Repository authority checks must not resolve a caller-planted Git shim.
    // A host without Git in these system locations fails closed.
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    HOME: resolve(usfRoot, "home"),
    XDG_CACHE_HOME: resolve(usfRoot, "cache"),
    XDG_CONFIG_HOME: resolve(usfRoot, "home", ".config"),
    TMPDIR: resolve(usfRoot, "tmp"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  });
}
