import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findHelpTopic } from "../../src/commands/help.ts";

test("qualification help matches the immutable parser contract", async () => {
  const source = await readFile(new URL("../../src/commands/probe.ts", import.meta.url), "utf8");
  const parsers = [...source.matchAll(/function parseQualify\(args: readonly string\[\]\): QualifyArguments \{([\s\S]*?)\n\}/gu)];
  assert.equal(parsers.length, 1, "exactly one known qualification parser");
  const parser = parsers[0]![1]!;
  const allowlists = [...parser.matchAll(/if \(!(?<flags>\[[^\n]+\])\.includes\(option\)/gu)];
  assert.equal(allowlists.length, 1, "one literal parser option allowlist");
  const accepted: unknown = JSON.parse(allowlists[0]!.groups!.flags!);
  assert.ok(Array.isArray(accepted) && accepted.every(flag => typeof flag === "string"));
  assert.deepEqual([...accepted].sort(), ["--env-file", "--max-output-tokens", "--model", "--provider", "--task-class"]);

  const required = [...parser.matchAll(/const (provider|model|taskClass|envFile) = values\.get\("([^"]+)"\);/gu)]
    .map(match => ({ variable: match[1]!, flag: match[2]! }));
  assert.equal(required.length, 4);
  const requiredGuard = /if \(([^\n]+)\) \{\s*invalid\("Qualify requires /u.exec(parser)?.[1];
  assert.ok(requiredGuard);
  assert.deepEqual(requiredGuard.split(" || ").sort(), required.map(({ variable }) => variable + " === undefined").sort());
  const defaultTokens = /const tokensText = values\.get\("--max-output-tokens"\) \?\? "([0-9]+)";/u.exec(parser)?.[1];
  const maximumTokens = /if \(maxOutputTokens > ([0-9]+)\)/u.exec(parser)?.[1];
  assert.equal(defaultTokens, "512");
  assert.equal(maximumTokens, "8192");
  assert.ok(parser.includes('invalid("--max-output-tokens must be a positive integer.")'));

  const topic = findHelpTopic(["probe", "qualify"]);
  assert.ok(topic, "registered qualification topic is present");
  const documented = topic.options.flatMap(({ syntax }) => syntax.match(/--[a-z][a-z-]*/gu) ?? []);
  assert.equal(new Set(documented).size, documented.length, "no ambiguous duplicate documented flag");
  assert.deepEqual([...documented].sort(), [...accepted].sort());
  for (const { flag } of required) {
    assert.ok(topic.synopsis.some(line => line.includes(flag)), "synopsis must name required option " + flag);
    assert.ok(documented.includes(flag));
  }
  assert.ok(topic.synopsis.some(line => /\[[^\]]*--max-output-tokens[^\]]*\]/u.test(line)), "token budget is optional in synopsis");
  const tokens = topic.options.find(option => option.syntax.includes("--max-output-tokens"));
  assert.ok(tokens);
  assert.match(tokens.description, /default[^0-9]*512\b/iu);
  assert.match(tokens.description, /max(?:imum)?[^0-9]*8192\b/iu);
  assert.match(tokens.description, /positive integer/iu);
  assert.ok(!topic.synopsis.some(line => /--route\b/u.test(line)));
  assert.ok(topic.purpose.trim().length > 0);
  assert.equal(topic.outputSchema, "urn:usf:qualification-run-result:1");
  assert.deepEqual(topic.exitCodes, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(topic.externalContact, "explicit");
  assert.equal(topic.historyScan, "bounded");
  assert.equal(topic.authorityEffect, "Contacts one exact authorized route and writes an ignored qualification record. It creates no economic, routing, Git or semantic authority.");
  assert.equal(topic.availability, "implemented");
});
