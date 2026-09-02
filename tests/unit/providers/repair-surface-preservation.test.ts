import assert from "node:assert/strict";
import test from "node:test";

import { exportedNames } from "../../../src/providers/implementation-work.ts";

/**
 * A repair exists to fix failing behaviour, not to reinvent the module.
 *
 * Measured: a clean-compiling wholesale rewrite landed during repair and took
 * two capabilities from two failing facets to nine at once, because the test
 * asserts against the incumbent's exported names and the rewrite dropped them.
 * The gate compares surfaces by name; behaviour changes inside a preserved
 * surface stay the rounds ceiling's problem, which keeps the gate from becoming
 * a freeze on legitimate repair.
 */
test("exported declarations of every kind are recognised", () => {
  const source = [
    "export const limit = 4;",
    "export function run(input: string): string { return input; }",
    "export async function later(): Promise<void> {}",
    "export class Engine {}",
    "export interface Shape { id: string }",
    "export type Outcome = 'ok' | 'refused';",
    "export enum Mode { A, B }",
  ].join("\n");
  assert.deepEqual(exportedNames(source),
    ["Engine", "Mode", "Outcome", "Shape", "later", "limit", "run"]);
});

test("re-export lists and renames count by their public name", () => {
  const source = [
    "const internal = 1;",
    "const helper = 2;",
    "export { internal as publicName, helper };",
  ].join("\n");
  assert.deepEqual(exportedNames(source), ["helper", "publicName"]);
});

test("a rewrite that drops incumbent names is detectable, a superset is not", () => {
  const incumbent = "export function exportArtefact(): void {}\nexport interface Artefact { id: string }";
  const shrunk = "export const exportFailureReasons = ['x'] as const;";
  const grown = `${incumbent}\nexport function getAvailableFormats(): string[] { return []; }`;
  const incumbentNames = exportedNames(incumbent);
  assert.deepEqual(incumbentNames.filter((name) => !exportedNames(shrunk).includes(name)),
    ["Artefact", "exportArtefact"], "the degenerate rewrite is exactly what must be caught");
  assert.deepEqual(incumbentNames.filter((name) => !exportedNames(grown).includes(name)), [],
    "adding surface is never a regression");
});

test("mentions inside strings and comments are not exports", () => {
  const source = [
    "// export const misleading = 1;",
    "const text = 'export function fake() {}';",
    "export const real = text;",
  ].join("\n");
  assert.deepEqual(exportedNames(source), ["real"]);
});
