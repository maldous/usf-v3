import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalParserContracts,
  canonicalParserCommandPath,
  forwardedCanonicalParserArgs,
  matchCanonicalParserContract,
} from "../../../src/commands/canonical-parser-contracts.ts";

const cases = [
  ["realise", ["no-change", "--input", "request.json"], "urn:usf:cli-canonical-parser-contract:realise-no-change:1", ["--input", "request.json"], "realise no-change"],
  ["check", ["--input", "request.json"], "urn:usf:cli-canonical-parser-contract:check-input:1", ["--input", "request.json"], "check"],
  ["evidence", ["completion", "--input", "request.json"], "urn:usf:cli-canonical-parser-contract:completion-evidence:1", ["--input", "request.json"], "evidence completion"],
  ["prove", ["completion", "--input", "request.json"], "urn:usf:cli-canonical-parser-contract:completion-proof:1", ["--input", "request.json"], "prove completion"],
  ["publish", ["work-completion", "--input", "request.json"], "urn:usf:cli-canonical-parser-contract:completion-publication:1", ["--input", "request.json"], "publish work-completion"],
] as const;

test("five versioned parser contracts bind exact selectors, fallback identities, commands, and adapters", () => {
  assert.equal(canonicalParserContracts.contracts.length, 5);
  assert.ok(Object.isFrozen(canonicalParserContracts));
  assert.ok(Object.isFrozen(canonicalParserContracts.contracts));
  for (const [command, args, identity, forwarded, commandPath] of cases) {
    const contract = matchCanonicalParserContract(command, args);
    assert.equal(contract?.identity, identity);
    assert.equal(contract?.version, "1");
    assert.equal(canonicalParserContracts.sourcePath, "src/cli.ts");
    assert.equal(canonicalParserContracts.parserExport, "src/commands/canonical-parser-contracts.ts#canonicalParserContracts");
    assert.equal(contract?.fallbackRegion.complementOf, identity);
    assert.equal(contract?.fallbackRegion.sourceDispatchSurfaceToken, command);
    assert.ok(Object.isFrozen(contract));
    assert.ok(Object.isFrozen(contract!.canonicalSelectorTokens));
    assert.ok(Object.isFrozen(contract!.fallbackRegion));
    assert.equal(canonicalParserCommandPath(contract!), commandPath);
    assert.deepEqual(forwardedCanonicalParserArgs(contract!, args), forwarded);
  }
});

test("selector mismatch remains in the typed fallback region", () => {
  assert.equal(matchCanonicalParserContract("realise", ["no-change"]), undefined);
  assert.equal(matchCanonicalParserContract("check", ["--candidate", "x"]), undefined);
  assert.equal(matchCanonicalParserContract("evidence", ["completion", "--bundle", "x"]), undefined);
  assert.equal(matchCanonicalParserContract("prove", ["construction", "--input", "x"]), undefined);
  assert.equal(matchCanonicalParserContract("publish", ["work-completion"]), undefined);
});

test("CLI handlers consume the shared parser matcher and preserve the publication exclusion", async () => {
  const source = await readFile(new URL("../../../src/cli.ts", import.meta.url), "utf8");
  assert.match(source, /from "\.\/commands\/canonical-parser-contracts\.ts"/u);
  assert.equal((source.match(/matchCanonicalParserContract\(context\.command, context\.args\)/gu) ?? []).length, 5);
  assert.equal((source.match(/forwardedCanonicalParserArgs\(parserContract, context\.args\)/gu) ?? []).length, 5);
  assert.equal((source.match(/canonicalParserCommandPath\(parserContract\)/gu) ?? []).length, 5);
  assert.match(source, /operationalMutation\(context\.repositoryRoot, \(\) => executeTransitionCommand\(/u);
});
