import assert from "node:assert/strict";
import test from "node:test";
import { commandRegistry, type CommandMetadata, type HelpTopic } from "../../../src/commands/help.ts";

/** Every row the registry publishes, flattened to its canonical path spelling. */
function registryRows(): Map<string, HelpTopic> {
  const rows = new Map<string, HelpTopic>();
  const visit = (row: HelpTopic): void => {
    const key = row.path.join(" ");
    assert.ok(!rows.has(key), `the registry must publish one row per command path; ${key} appears twice`);
    rows.set(key, row);
    for (const nested of (row as CommandMetadata).topics ?? []) visit(nested);
  };
  for (const command of commandRegistry) visit(command);
  return rows;
}

/**
 * Expand one synopsis line into the command spellings it advertises as callable.
 * The path ends at the first value placeholder or option, and an alternation
 * token such as `claim|recover` or `<census|status|aliases>` advertises each of
 * its alternatives separately.
 */
function advertisedSpellings(line: string): readonly string[] {
  const withoutOptions = line.replace(/\s(?:\[|--).*$/, "");
  let paths: string[][] = [[]];
  for (const token of withoutOptions.split(/\s+/).slice(1)) {
    const bare = token.replace(/^<+/, "").replace(/>+$/, "");
    if (!/^[a-z][a-z-]*(?:\|[a-z][a-z-]*)*$/.test(bare)) break;
    const alternatives = bare.split("|");
    paths = paths.flatMap(prefix => alternatives.map(alternative => [...prefix, alternative]));
  }
  return paths.filter(path => path.length > 0).map(path => path.join(" "));
}

/**
 * A synopsis is the registry's own advertisement that a spelling is callable,
 * so every advertised spelling must carry its own interrogable row. Without
 * one, an operator reading the group inherits the group's output schema, exit
 * codes, contact posture and authority effect - and those differ per leaf, so
 * the inherited answer is not merely coarse but wrong. Closing this by reading
 * handler source is exactly the out-of-band reasoning the registry exists to
 * remove.
 */
test("every advertised command spelling carries its own registry row", () => {
  const rows = registryRows();
  const advertised = new Set<string>();
  for (const row of rows.values()) for (const line of row.synopsis) {
    for (const spelling of advertisedSpellings(line)) advertised.add(spelling);
  }
  const missing = [...advertised].filter(spelling => !rows.has(spelling)).sort();
  assert.deepEqual(missing, [], `advertised without an interrogable row: ${missing.join(", ")}`);
});

test("every row answers the questions an operator cannot otherwise derive", () => {
  for (const [path, row] of registryRows()) {
    assert.ok(row.outputSchema.length > 0, `${path} must declare what it returns`);
    assert.ok(row.authorityEffect.length > 0, `${path} must declare what it changes`);
    assert.ok(row.exitCodes.length > 0, `${path} must declare how it can fail`);
    assert.ok(row.purpose.length > 0, `${path} must declare what it is for`);
    const parent = row.path.slice(0, -1).join(" ");
    if (parent.length > 0) assert.ok(registryRows().has(parent), `${path} must hang from a published parent`);
  }
});

/**
 * The three group rows whose aggregate answer was observably wrong for their
 * own leaves. Pinned as named regressions because each was discovered by
 * running the leaf and comparing, not by reading the registry.
 */
test("leaf rows correct the group answers that were wrong for them", () => {
  const rows = registryRows();
  assert.equal(rows.get("graph integrity")?.outputSchema, "urn:usf:integrity-report:1");
  assert.equal(rows.get("graph lanes")?.outputSchema, "urn:usf:lane-census-result:1");
  assert.equal(rows.get("graph integrity")?.externalContact, "none");
  assert.equal(rows.get("graph lanes")?.externalContact, "none");
  assert.equal(rows.get("graph execute")?.externalContact, "explicit");

  assert.equal(rows.get("linear-binding prepare")?.outputSchema, "urn:usf:bound-semantic-work-unit:1");
  assert.equal(rows.get("linear-binding status")?.outputSchema, "urn:usf:linear-binding-attempt:1");
  assert.equal(rows.get("linear-binding settle")?.outputSchema, "urn:usf:linear-binding-attempt:1");

  // The group promises it creates no semantic authority; this leaf writes one
  // graph line through the ordinary transaction, so it must say so itself.
  assert.equal(rows.get("providers policy")?.outputSchema, "urn:usf:semantic-transaction-proposal:1");
  assert.match(rows.get("providers policy")!.authorityEffect, /transaction/i);

  for (const readOnly of ["profile status", "profile closure", "hermes status", "hermes steward status"]) {
    assert.equal(rows.get(readOnly)?.externalContact, "none", `${readOnly} contacts nothing`);
  }
});
