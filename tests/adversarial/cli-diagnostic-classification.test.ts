import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classifyError, errorOutput, exitCodes, isStableReasonCode, UsfError } from "../../src/core/errors.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The command boundary must tell a refusal from a crash.
 *
 * Before this, only UsfError kept its reason code. Twenty other error classes
 * in this repository carry a `reasonCode` and every one of them arrived at the
 * operator as "Unexpected internal error" — which is how a manifest declaring
 * one graph IRI twice, refused correctly and precisely as
 * MANIFEST_DUPLICATE_SOURCE_OR_GRAPH, became indistinguishable from a bug.
 *
 * The invariant: an error is a semantic refusal if and only if it already
 * carries a stable machine-readable reason code. The "if and only if" is the
 * point, so both directions are planted.
 *
 * The domain classes are proven by reading their declarations rather than by
 * importing them. That is deliberate and stronger here: importing one would
 * drag its whole module graph into this packet's read closure, and what needs
 * proving is that the convention holds across the classes, not that one
 * instance can be constructed.
 */

// ------------------------------------------- the convention, read from source

const DOMAIN_ERROR_SOURCES = [
  "src/graph/index.ts",
  "src/realisation/index.ts",
  "src/core/asset-index.ts",
  "src/schema/index.ts",
  "src/providers/qualification.ts",
] as const;

test("every domain error class in the read closure carries a reason code", () => {
  // If a class stops declaring one, it silently becomes unclassifiable and the
  // regression this repair exists to fix comes back for that class alone.
  let found = 0;
  for (const path of DOMAIN_ERROR_SOURCES) {
    const source = readFileSync(resolve(repositoryRoot, path), "utf8");
    for (const match of source.matchAll(/export class (\w*Error) extends Error \{([\s\S]{0,400}?)\n\}/gu)) {
      const [, name, body] = match;
      found += 1;
      assert.match(body ?? "", /readonly reasonCode\s*:/u,
        `${name} in ${path} declares no reasonCode, so the boundary could not classify it`);
    }
  }
  assert.ok(found >= 6, `expected the known domain error classes, found ${found}`);
});

// -------------------------------------------------------- the three classes

test("a UsfError reaches the boundary under its own code", () => {
  const output = errorOutput(new UsfError("TRANSACT_STALE_PREIMAGE", exitCodes.CURRENTNESS_FAILURE, "The proposal was derived against a state that has since changed."));
  assert.equal(output.reasonCode, "TRANSACT_STALE_PREIMAGE");
  assert.equal(output.status, "refused");
  assert.match(output.message, /derived against a state/u);
});

test("a domain error that is not a UsfError keeps its own reason code", () => {
  // The exact case that started this, in the exact shape GraphLoadError has:
  // name, message equal to the code, a reasonCode field and structured details.
  class GraphLoadErrorShape extends Error {
    readonly reasonCode: string;
    readonly details?: Readonly<Record<string, unknown>>;
    constructor(reasonCode: string, details?: Readonly<Record<string, unknown>>) {
      super(reasonCode);
      this.name = "GraphLoadError";
      this.reasonCode = reasonCode;
      this.details = details;
    }
  }
  const output = errorOutput(new GraphLoadErrorShape("MANIFEST_DUPLICATE_SOURCE_OR_GRAPH", { path: "graph/manifests/x.json" }));
  assert.equal(output.reasonCode, "MANIFEST_DUPLICATE_SOURCE_OR_GRAPH");
  assert.notEqual(output.reasonCode, "INTERNAL_ERROR");
  assert.deepEqual(output.details, { path: "graph/manifests/x.json" });
});

test("a genuinely unexpected exception is INTERNAL_ERROR and leaks nothing", () => {
  const output = errorOutput(new TypeError("Cannot read properties of undefined (reading 'length')"));
  assert.equal(output.reasonCode, "INTERNAL_ERROR");
  assert.equal(output.message, "Unexpected internal error.");
  assert.equal(output.details, undefined);
  assert.doesNotMatch(JSON.stringify(output), /Cannot read properties|TypeError/u,
    "an unexpected failure's own text must not reach the envelope");
});

test("a thrown non-object is INTERNAL_ERROR rather than a crash inside the classifier", () => {
  for (const thrown of [undefined, null, "a string", 42, Symbol("s")]) {
    assert.equal(errorOutput(thrown).reasonCode, "INTERNAL_ERROR");
  }
});

// -------------------------------------------------- planted: the "only if"

test("planted: a message masquerading as a reason code is refused", () => {
  const impostor = Object.assign(new Error("boom"), { reasonCode: "The proposal was derived against a stale state." });
  assert.equal(errorOutput(impostor).reasonCode, "INTERNAL_ERROR",
    "a sentence is not a machine-readable code, and inventing one would be worse than INTERNAL_ERROR");
});

test("planted: a stack trace offered as a reason code is refused", () => {
  // A stack shape, not a real one. The containment boundary refuses any
// tracked runtime-bearing file naming an absolute development-machine
// path, and a fixture is no exception: the property under test is that no
// stack frame becomes a reason code, which needs a frame, not this frame.
  const stack = "Error: nope\n    at Object.<anonymous> (/repository/src/graph/index.ts:87:93)";
  const output = errorOutput(Object.assign(new Error("nope"), { reasonCode: stack }));
  assert.equal(output.reasonCode, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(output), /usf-v3|index\.ts|at Object/u,
    "no filesystem path or stack frame may reach the envelope");
});

test("planted: a class name offered as a reason code is refused", () => {
  assert.equal(errorOutput(Object.assign(new Error("x"), { reasonCode: "GraphLoadError" })).reasonCode, "INTERNAL_ERROR");
  assert.equal(errorOutput(Object.assign(new Error("x"), { code: "ENOENT_but_lowercase" })).reasonCode, "INTERNAL_ERROR");
});

test("planted: an error with no reason code at all stays INTERNAL_ERROR", () => {
  assert.equal(errorOutput(new Error("just a message")).reasonCode, "INTERNAL_ERROR");
  assert.equal(errorOutput({ message: "an object pretending" }).reasonCode, "INTERNAL_ERROR");
});

test("the accepted shape is exactly as narrow as it claims", () => {
  for (const good of ["INTERNAL_ERROR", "A", "TRANSACT_STALE_PREIMAGE",
    "CONSTRUCTION_EVIDENCE_MISSING:urn:usf:evidence-requirement:x",
    "WORK_WRITE_NOT_PERMITTED:urn:usf:work:a:src/b.ts"]) {
    assert.equal(isStableReasonCode(good), true, `${good} must be accepted`);
  }
  for (const bad of ["lower_case", "Mixed_Case", "TRAILING_", "_LEADING", "HAS SPACE", "",
    "A".repeat(300), "WITH\nNEWLINE", "COLON:", "a:b"]) {
    assert.equal(isStableReasonCode(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
});

test("details survive only for a classified refusal", () => {
  assert.deepEqual(errorOutput(new UsfError("X_Y", exitCodes.DOMAIN_FAILURE, "m", { a: 1 })).details, { a: 1 });
  const unclassified = errorOutput(Object.assign(new Error("m"), { details: { secret: "value" } }));
  assert.equal(unclassified.details, undefined);
  assert.doesNotMatch(JSON.stringify(unclassified), /secret/u);
});

test("classification and reporting agree", () => {
  // errorOutput must not classify one way and report another.
  const cases: readonly unknown[] = [
    new UsfError("A_B", exitCodes.DOMAIN_FAILURE, "m"),
    Object.assign(new Error("m"), { reasonCode: "C_D" }),
    new Error("m"),
    "not an error",
  ];
  for (const error of cases) {
    const { classified, reasonCode } = classifyError(error);
    const output = errorOutput(error);
    assert.equal(output.reasonCode, classified ? reasonCode : "INTERNAL_ERROR");
  }
});
