import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLinearCandidateRepairResponse, parseLinearCandidateRepairPolicy,
  LINEAR_REPAIR_MAXIMUM_RESPONSE_BYTES,
} from "../../../src/core/linear-repair.ts";

const rootBinding = "urn:test:repair:root";
const path = "src/example.ts";
const excerpt = 'const value = "before";\n';
const sources = [{ path, excerpt, source: "// before\n" + excerpt + "// after\n" }];
const operation = { kind: "replace", path, oldText: excerpt, newText: 'const value = "after";\n' };
const evaluate = (value: string) => evaluateLinearCandidateRepairResponse(value, sources, [path]);

test("candidate repair policy has exact keys and a finite explicit round budget", () => {
  for (const maximumRounds of [1, 2, 3, 4]) {
    assert.deepEqual(parseLinearCandidateRepairPolicy(JSON.stringify({ rootBinding, round: 0, maximumRounds })),
      { rootBinding, round: 0, maximumRounds });
    assert.deepEqual(parseLinearCandidateRepairPolicy(JSON.stringify({
      rootBinding, round: maximumRounds, maximumRounds, predecessorBinding: "urn:test:repair:parent",
    })), { rootBinding, round: maximumRounds, maximumRounds, predecessorBinding: "urn:test:repair:parent" });
  }
  for (const value of [
    null, [], {}, { rootBinding, round: 0, maximumRounds: 0 }, { rootBinding, round: 0, maximumRounds: 5 },
    { rootBinding, round: -1, maximumRounds: 2 }, { rootBinding, round: 0.5, maximumRounds: 2 },
    { rootBinding, round: 3, maximumRounds: 2 }, { rootBinding, round: 1, maximumRounds: 2 },
    { rootBinding, round: 0, maximumRounds: 2, predecessorBinding: rootBinding },
    { rootBinding, round: 0, maximumRounds: 2, retry: true },
    { rootBinding: "not an iri", round: 0, maximumRounds: 2 },
    { rootBinding, round: 1, maximumRounds: 2, predecessorBinding: null },
  ]) assert.equal(parseLinearCandidateRepairPolicy(JSON.stringify(value)), null, JSON.stringify(value));
  assert.equal(parseLinearCandidateRepairPolicy("{"), null);
});

test("exact replacement contract accepts real quotes and newlines without transforming bytes", () => {
  const text = JSON.stringify({ operations: [operation] });
  assert.deepEqual(evaluate(text), { status: "valid", retryable: false });
  assert.equal(JSON.parse(text).operations[0].oldText, excerpt);
  assert.deepEqual(evaluate(JSON.stringify({ operations: [{ ...operation, newText: "" }] })),
    { status: "valid", retryable: false });
});

test("only bounded typed response failures request repair", () => {
  for (const value of ["{", "plain prose", "~~~json\n{}\n~~~"]) {
    assert.deepEqual(evaluate(value), { status: "rejected", retryable: true,
      diagnostic: { reasonCode: "LINEAR_BINDING_REPAIR_RESPONSE_JSON_INVALID" } });
  }
  for (const value of [
    null, [], { fileOperations: [operation] }, { operations: [operation], explanation: "extra" },
    { operations: [{ ...operation, kind: "write" }] }, { operations: [{ ...operation, extra: true }] },
    { operations: [{ ...operation, oldText: "" }] }, { operations: [{ ...operation, newText: null }] },
    { operations: [{ ...operation, path: "src/unapproved.ts" }] }, { operations: [operation, operation] },
    { operations: Array.from({ length: 17 }, () => operation) },
  ]) {
    const result = evaluate(JSON.stringify(value));
    assert.equal(result.status, "rejected", JSON.stringify(value));
    assert.equal(result.retryable, true);
    assert.equal("diagnostic" in result && result.diagnostic.reasonCode,
      "LINEAR_BINDING_REPAIR_RESPONSE_SCHEMA_INVALID");
  }
});

test("overescaped and nonunique anchors are refused rather than unescaped or guessed", () => {
  const wrong = excerpt.replaceAll('"', '\\"');
  const result = evaluate(JSON.stringify({ operations: [{ ...operation, oldText: wrong }] }));
  assert.deepEqual(result, { status: "rejected", retryable: true,
    diagnostic: { reasonCode: "LINEAR_BINDING_REPAIR_RESPONSE_ANCHOR_INVALID", operationIndex: 0 } });
  assert.deepEqual(evaluateLinearCandidateRepairResponse(JSON.stringify({ operations: [operation] }),
    [{ path, excerpt, source: excerpt + "// outside excerpt\n" + excerpt }], [path]), result,
  "uniqueness must hold in the complete source, not just the excerpt");
  assert.equal(evaluateLinearCandidateRepairResponse(
    JSON.stringify({ operations: [{ ...operation, oldText: "aa" }] }),
    [{ path, excerpt: "aaa", source: "aaa" }], [path]).status, "rejected",
  "overlapping occurrences are not unique");
});

test("empty results insufficient context and response bounds never grant another attempt", () => {
  for (const result of [
    evaluate('{"operations":[]}'),
    evaluateLinearCandidateRepairResponse("{", [], [path]),
    evaluateLinearCandidateRepairResponse("{", sources, []),
    evaluateLinearCandidateRepairResponse("{", [{ path, excerpt, source: "different" }], [path]),
    evaluateLinearCandidateRepairResponse("{", [sources[0]!, sources[0]!], [path]),
  ]) {
    assert.equal(result.status, "blocked");
    assert.equal(result.retryable, false);
    assert.equal("diagnostic" in result && result.diagnostic.reasonCode,
      "LINEAR_BINDING_REPAIR_CONTEXT_INSUFFICIENT");
  }
  assert.deepEqual(evaluate(" ".repeat(LINEAR_REPAIR_MAXIMUM_RESPONSE_BYTES + 1)),
    { status: "blocked", retryable: false, diagnostic: { reasonCode: "LINEAR_BINDING_REPAIR_RESPONSE_LIMIT" } });
});
