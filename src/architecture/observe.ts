import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { declarationDigest, type ArchitectureDeclaration } from "./declaration.ts";

/**
 * The replaceable evidence producer.
 *
 * It asserts facts and nothing else: which units exist, which imports resolve
 * to which units, which units a declared entry point can reach, and which units
 * sit in an import cycle. It reads the declaration only to know where to look
 * and where to start; it never consults a requirement and never decides whether
 * anything conforms. Replacing it with a compiler-backed or third-party
 * analyser changes the evidence and leaves every requirement untouched, which
 * is the property the assurance model exists to protect.
 *
 * Its own limitation is stated rather than hidden: import extraction is textual,
 * so it over-reports an edge inside a comment or a string and never under-reports
 * a real one. A conservative over-report can only add a finding, never remove
 * one, which is the safe direction for an assurance observer.
 */

export const observerIdentity = "urn:usf:architecture-observer:textual-import-scan:1";

export interface ObservedImportEdge {
  readonly from: string;
  readonly to: string;
}

export interface ObservedUnresolvedImport {
  readonly from: string;
  readonly specifier: string;
}

export interface ArchitectureObservation {
  readonly schema: "urn:usf:architecture-observation:1";
  readonly scope: string;
  readonly producer: string;
  readonly observedAt: string;
  readonly declarationDigest: string;
  readonly populationDigest: string;
  readonly population: readonly string[];
  readonly internalImports: readonly ObservedImportEdge[];
  readonly unresolvedImports: readonly ObservedUnresolvedImport[];
  readonly externalImports: readonly ObservedUnresolvedImport[];
  readonly absentEntryPointModules: readonly string[];
  readonly runtimeReachable: readonly string[];
  readonly cycleMembers: readonly string[];
}

export interface ObserveInput {
  readonly repositoryRoot: string;
  readonly declaration: ArchitectureDeclaration;
  readonly scope: string;
  readonly observedAt?: string;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function repositoryPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function walk(root: string, absolute: string, into: string[]): void {
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) walk(root, child, into);
    else if (entry.isFile()) into.push(repositoryPath(root, child));
  }
}

export function enumeratePopulation(repositoryRoot: string, declaration: ArchitectureDeclaration): string[] {
  const population = declaration.population;
  if (population === null) return [];
  const found: string[] = [];
  for (const root of population.roots) walk(repositoryRoot, resolve(repositoryRoot, root), found);
  const suffixes = population.suffixes;
  return found
    .filter((path) => suffixes.length === 0 || suffixes.some((suffix) => path.endsWith(suffix)))
    .filter((path) => !population.excludedRoots.some((excluded) => path.startsWith(excluded)))
    .sort();
}

const staticImportPattern = /(?:^|[\s;=({,])(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g;
const dynamicImportPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every module specifier the text of one unit mentions, in source order, de-duplicated. */
export function extractImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(staticImportPattern)) specifiers.add(match[1] as string);
  for (const match of source.matchAll(dynamicImportPattern)) specifiers.add(match[1] as string);
  return [...specifiers];
}

/**
 * Resolves one relative specifier against the observed unit set rather than the
 * filesystem, so resolution is decided by the same population the denominator is
 * measured over. A specifier that resolves outside the population is
 * unresolved, which is the honest answer: the architecture cannot speak about a
 * unit it does not contain.
 */
export function resolveRelativeSpecifier(from: string, specifier: string, units: ReadonlySet<string>): string | null {
  const base = dirname(`/${from}`);
  const target = resolve(base, specifier).slice(1);
  const candidates = [target, target.replace(/\.js$/u, ".ts"), `${target}.ts`, `${target}/index.ts`];
  for (const candidate of candidates) if (units.has(candidate)) return candidate;
  return null;
}

function tarjanCycleMembers(nodes: readonly string[], edges: ReadonlyMap<string, readonly string[]>): string[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const members = new Set<string>();
  let counter = 0;

  const strongConnect = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (next === node) members.add(node);
      if (!index.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node) as number, low.get(next) as number));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) as number, index.get(next) as number));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      for (;;) {
        const popped = stack.pop() as string;
        onStack.delete(popped);
        component.push(popped);
        if (popped === node) break;
      }
      if (component.length > 1) for (const each of component) members.add(each);
    }
  };

  for (const node of nodes) if (!index.has(node)) strongConnect(node);
  return [...members].sort();
}

export function observeArchitecture(input: ObserveInput): ArchitectureObservation {
  const { repositoryRoot, declaration, scope } = input;
  const population = enumeratePopulation(repositoryRoot, declaration);
  const units = new Set(population);

  const contentDigests: string[] = [];
  const internalImports: ObservedImportEdge[] = [];
  const unresolvedImports: ObservedUnresolvedImport[] = [];
  const externalImports: ObservedUnresolvedImport[] = [];
  const adjacency = new Map<string, string[]>();

  for (const unit of population) {
    const absolute = resolve(repositoryRoot, unit);
    const source = statSync(absolute).isFile() ? readFileSync(absolute, "utf8") : "";
    contentDigests.push(`${unit} ${sha256(source)}`);
    const outgoing: string[] = [];
    for (const specifier of extractImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        externalImports.push({ from: unit, specifier });
        continue;
      }
      const target = resolveRelativeSpecifier(unit, specifier, units);
      if (target === null) unresolvedImports.push({ from: unit, specifier });
      else if (target !== unit) {
        internalImports.push({ from: unit, to: target });
        outgoing.push(target);
      }
    }
    adjacency.set(unit, [...new Set(outgoing)].sort());
  }

  const runtimeRoots = declaration.entryPoints.filter((entry) => entry.contributesToRuntimeReachability).map((entry) => entry.module);
  const absentEntryPointModules = declaration.entryPoints.map((entry) => entry.module).filter((module) => !units.has(module)).sort();
  const reachable = new Set<string>();
  const queue = runtimeRoots.filter((module) => units.has(module));
  while (queue.length > 0) {
    const unit = queue.pop() as string;
    if (reachable.has(unit)) continue;
    reachable.add(unit);
    for (const next of adjacency.get(unit) ?? []) if (!reachable.has(next)) queue.push(next);
  }

  return {
    schema: "urn:usf:architecture-observation:1",
    scope,
    producer: observerIdentity,
    observedAt: input.observedAt ?? new Date().toISOString(),
    declarationDigest: declarationDigest(declaration),
    populationDigest: sha256(contentDigests.join("\n")),
    population,
    internalImports: internalImports.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
    unresolvedImports: unresolvedImports.sort((left, right) => left.from.localeCompare(right.from) || left.specifier.localeCompare(right.specifier)),
    externalImports: externalImports.sort((left, right) => left.from.localeCompare(right.from) || left.specifier.localeCompare(right.specifier)),
    absentEntryPointModules,
    runtimeReachable: [...reachable].sort(),
    cycleMembers: tarjanCycleMembers(population, adjacency),
  };
}
