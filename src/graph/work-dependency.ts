import type { Quad } from "./nquads.ts";

/**
 * A semantic work unit may depend on the successful terminal outcome of other
 * work units. Readiness is always derived from the dependency edges and the
 * recorded terminal outcomes; it is never stored, so it cannot drift from the
 * facts that produce it.
 */
export const dependsOnPredicate = "urn:usf:predicate:dependsOn";

export type WorkUnitState =
  /** Every dependency has a successful terminal outcome. */
  | "ready"
  /** At least one dependency has no terminal outcome yet. */
  | "blocked"
  /** At least one dependency terminally failed, so this unit can never run. */
  | "unreachable"
  /** This unit has a successful terminal outcome. */
  | "succeeded"
  /** This unit exhausted its attempts. */
  | "failed";

export type DependencyDefect =
  | "dependency-cycle"
  | "unknown-dependency"
  | "self-dependency";

export interface DependencyDefectReport {
  readonly defect: DependencyDefect;
  readonly unit: string;
  readonly detail: string;
}

export interface DependencyGraph {
  readonly units: readonly string[];
  /** Dependencies of each unit, sorted. */
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  readonly defects: readonly DependencyDefectReport[];
  readonly acyclic: boolean;
}

/** Read the dependency DAG out of a work graph without interpreting outcomes. */
export function readDependencyGraph(quads: readonly Quad[], units: readonly string[]): DependencyGraph {
  const known = new Set(units);
  const dependencies = new Map<string, readonly string[]>();
  const defects: DependencyDefectReport[] = [];
  for (const unit of units) {
    const edges = Object.freeze([...new Set(quads
      .filter((quad) => quad.subject === unit && quad.predicate === dependsOnPredicate && quad.objectKind === "iri")
      .map((quad) => quad.object))].sort());
    for (const edge of edges) {
      if (edge === unit) {
        defects.push(Object.freeze({ defect: "self-dependency" as const, unit, detail: "a work unit may not depend on itself" }));
      } else if (!known.has(edge)) {
        defects.push(Object.freeze({ defect: "unknown-dependency" as const, unit, detail: `dependency ${edge} is not a declared work unit` }));
      }
    }
    dependencies.set(unit, edges);
  }

  // Cycle detection by iterative depth-first search over the declared edges.
  const colour = new Map<string, 0 | 1 | 2>();
  const cycles: string[] = [];
  for (const start of [...units].sort()) {
    if (colour.get(start) === 2) continue;
    const stack: Array<{ unit: string; index: number }> = [{ unit: start, index: 0 }];
    colour.set(start, 1);
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const edges = dependencies.get(frame.unit) ?? [];
      if (frame.index >= edges.length) {
        colour.set(frame.unit, 2);
        stack.pop();
        continue;
      }
      const next = edges[frame.index]!;
      frame.index += 1;
      if (!known.has(next)) continue;
      const seen = colour.get(next);
      if (seen === 1) { cycles.push(`${frame.unit} -> ${next}`); continue; }
      if (seen === 2) continue;
      colour.set(next, 1);
      stack.push({ unit: next, index: 0 });
    }
  }
  for (const edge of [...new Set(cycles)].sort()) {
    defects.push(Object.freeze({ defect: "dependency-cycle" as const, unit: edge.split(" -> ")[0]!, detail: `cycle through ${edge}` }));
  }

  return Object.freeze({
    units: Object.freeze([...units].sort()),
    dependencies,
    defects: Object.freeze(defects),
    acyclic: cycles.length === 0,
  });
}

export interface OutcomeView {
  /** Units with a successful terminal outcome. */
  readonly succeeded: ReadonlySet<string>;
  /** Units that exhausted their attempts. */
  readonly failed: ReadonlySet<string>;
}

/**
 * Derive one deterministic state per unit. A unit is ready only when every
 * dependency has succeeded; a single failed dependency makes it unreachable,
 * transitively, so dependent work is stopped rather than retried forever.
 */
export function deriveStates(graph: DependencyGraph, outcomes: OutcomeView): ReadonlyMap<string, WorkUnitState> {
  const states = new Map<string, WorkUnitState>();
  const resolve = (unit: string, guard: ReadonlySet<string>): WorkUnitState => {
    const cached = states.get(unit);
    if (cached !== undefined) return cached;
    if (guard.has(unit)) return "unreachable";
    if (outcomes.succeeded.has(unit)) { states.set(unit, "succeeded"); return "succeeded"; }
    if (outcomes.failed.has(unit)) { states.set(unit, "failed"); return "failed"; }
    const edges = graph.dependencies.get(unit) ?? [];
    const nextGuard = new Set([...guard, unit]);
    let blocked = false;
    for (const edge of edges) {
      if (!graph.units.includes(edge)) { states.set(unit, "unreachable"); return "unreachable"; }
      const edgeState = resolve(edge, nextGuard);
      if (edgeState === "failed" || edgeState === "unreachable") { states.set(unit, "unreachable"); return "unreachable"; }
      if (edgeState !== "succeeded") blocked = true;
    }
    const state: WorkUnitState = blocked ? "blocked" : "ready";
    states.set(unit, state);
    return state;
  };
  for (const unit of graph.units) resolve(unit, new Set());
  return states;
}

/** Units that may be dispatched now, in deterministic order. */
export function readyUnits(states: ReadonlyMap<string, WorkUnitState>): readonly string[] {
  return Object.freeze([...states.entries()]
    .filter(([, state]) => state === "ready")
    .map(([unit]) => unit)
    .sort());
}

export function stateCounts(states: ReadonlyMap<string, WorkUnitState>): Readonly<Record<WorkUnitState, number>> {
  const counts: Record<WorkUnitState, number> = { ready: 0, blocked: 0, unreachable: 0, succeeded: 0, failed: 0 };
  for (const state of states.values()) counts[state] += 1;
  return Object.freeze(counts);
}
