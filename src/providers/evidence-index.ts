import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * The single implementation that decides which routes have a durable successful
 * invocation. Two implementations of one decision is the defect this module
 * exists to prevent: every caller that needs observed availability reads it
 * here, so the answer cannot diverge between commands.
 */
export interface ObservedAvailability {
  readonly routeIds: readonly string[];
  readonly recordCount: number;
  readonly evaluated: true;
}

export async function observeAvailableRoutes(repositoryRoot: string): Promise<ObservedAvailability> {
  const directory = resolve(repositoryRoot, ".usf", "executions");
  const names = await readdir(directory).catch(() => [] as string[]);
  const observed = new Set<string>();
  let recordCount = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    recordCount += 1;
    try {
      const record = JSON.parse(bytes) as { status?: unknown; selection?: { provider?: unknown; model?: unknown } };
      if (record.status !== "ok") continue;
      const provider = record.selection?.provider;
      const model = record.selection?.model;
      if (typeof provider === "string" && typeof model === "string") observed.add(`${provider}:${model}`);
    } catch { continue; }
  }
  // `evaluated` is explicit so an empty route set is never ambiguous between
  // "evaluated and none observed" and "not evaluated".
  return Object.freeze({ routeIds: Object.freeze([...observed].sort()), recordCount, evaluated: true as const });
}
