import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalContribution, parseLocalContribution, prepareLocalContribution, LocalContributionError } from "../../../src/collaboration/local-contribution.ts";
import { createRealisationBasis } from "../../../src/realisation/basis.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";
import { proposalBasis } from "../../fixtures/proposal-packet.ts";

function basis() {
  const { basisDigest: _digest, ...draft } = proposalBasis();
  const requirements = ["urn:usf:contribution-source:local-authored:1", "urn:usf:algorithm:local-contribution-preparation:1"].map(id => ({ id, digest: "sha256:" + "c".repeat(64) }));
  return createRealisationBasis({ ...draft,
    trace: { ...draft.trace, requirements: [...draft.trace.requirements, ...requirements] },
    work: { ...draft.work, dependencies: [...draft.work.dependencies, ...requirements.map(r => ({ kind: "semantic-resource" as const, key: r.id, digest: r.digest }))] },
    scope: { readSet: [], writeSet: ["src/a.ts", "src/b.ts"], preimages: { "src/a.ts": null, "src/b.ts": "sha256:" + "b".repeat(64) } } });
}
const ops = [{ kind: "write", path: "src/a.ts", content: "authored bytes" }];

test("local wire is closed, deterministic, immutable and carries unknown origin rather than provider facts", () => {
  const a = createLocalContribution(basis(), ops), b = createLocalContribution(basis(), structuredClone(ops));
  assert.deepEqual(a, b); assert.deepEqual(parseLocalContribution(a), a); assert(Object.isFrozen(a.payload.operations));
  assert.equal(a.provenance.originalAuthor, null); assert.equal(a.provenance.model, null); assert.equal(a.provenance.tokens, null); assert.equal(a.provenance.cost, null);
  assert.equal(a.provenance.reviewIndependence, "unknown"); assert.equal("actual" in a, false); assert.equal("assignment" in a, false);
  const validator = createJsonSchemaValidator(JSON.parse(readFileSync(new URL("../../../schemas/local-contribution.schema.json", import.meta.url), "utf8")));
  assert.equal(validator.validate(a).valid, true);
  assert.equal(validator.validate({ ...a, usage: {} }).valid, false);
});

test("false provenance, stale hashes and malformed bases refuse with typed errors", () => {
  const good = createLocalContribution(basis(), ops);
  const variants = [
    { ...good, identity: { ...good.identity, artifactDigest: "sha256:" + "0".repeat(64) } },
    { ...good, provenance: { ...good.provenance, originalAuthor: "invented" } },
    { ...good, provenance: { ...good.provenance, reviewIndependence: "independent" } },
    { ...good, provenance: { ...good.provenance, tokens: 0 } },
    { ...good, basis: { ...good.basis, basisDigest: "sha256:" + "0".repeat(64) } },
    { ...good, payload: { operations: [{ ...good.payload.operations[0], content: "changed" }] } },
    { ...good, unknown: true },
  ];
  for (const value of variants) assert.throws(() => parseLocalContribution(value), LocalContributionError);
});

test("local wire cannot bypass source admission using a rehashed basis", () => {
  const { basisDigest: _digest, ...draft } = basis();
  const source = "urn:usf:contribution-source:local-authored:1";
  for (const changed of [
    { ...draft, trace: { ...draft.trace, requirements: draft.trace.requirements.filter(r => r.id !== source) } },
    { ...draft, work: { ...draft.work, dependencies: draft.work.dependencies.filter(d => d.key !== source) } },
    { ...draft, trace: { ...draft.trace, requirements: draft.trace.requirements.map(r => r.id === source ? { ...r, digest: "sha256:" + "d".repeat(64) } : r) } },
  ]) {
    const changedBasis = createRealisationBasis(changed);
    assert.throws(() => createLocalContribution(changedBasis, ops), { reasonCode: "LOCAL_SOURCE_NOT_ADMITTED" });
    const good = createLocalContribution(basis(), ops);
    assert.throws(() => parseLocalContribution({ ...good, basis: changedBasis }), { reasonCode: "LOCAL_SOURCE_NOT_ADMITTED" });
  }
});

test("scope, operation collisions, supplied preimages and unknown keys refuse", () => {
  for (const proposed of [
    [{ kind: "write", path: "src/outside.ts", content: "no" }],
    [{ ...ops[0], expectedDigest: "sha256:" + "0".repeat(64) }],
    [{ ...ops[0], author: "me" }],
    [ops[0], ops[0]],
    [{ kind: "delete", path: "src/a.ts" }],
    [{ kind: "write", path: "../escape", content: "no" }],
  ]) assert.throws(() => createLocalContribution(basis(), proposed), LocalContributionError);
  const deletion = createLocalContribution(basis(), [{ kind: "delete", path: "src/b.ts" }]);
  assert.equal(deletion.payload.operations[0]?.expectedDigest, basis().scope.preimages["src/b.ts"]);
  assert.deepEqual(parseLocalContribution(deletion), deletion);
});

test("native preparation rejects selector authority overrides before repository access", async () => {
  await assert.rejects(prepareLocalContribution("/missing", { rootIdentity: "urn:test:work", manifestPath: "graph/test.json", basis: basis() } as never, ops), LocalContributionError);
  await assert.rejects(prepareLocalContribution("/missing", { rootIdentity: "", manifestPath: "graph/test.json" }, ops), LocalContributionError);
});

test("native preparation requires selected contract source admission, not ambient source declarations", async () => {
  const root = mkdtempSync(join(tmpdir(), "usf-local-admission-"));
  const source = "urn:usf:contribution-source:local-authored:1";
  const algorithm = "urn:usf:algorithm:local-contribution-preparation:1";
  const quad = (s: string, p: string, o: string) => `<${s}> <urn:usf:predicate:${p}> <${o}> <urn:test:graph> .`;
  try {
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{ path: "source.nq", format: "application/n-quads", graph: "urn:test:graph", role: "contract", validationProfile: "bootstrap-nquads-v1" }] }));
    const common = [quad("urn:test:work", "type", "urn:usf:type:WorkPacket"), quad("urn:test:work", "contract", "urn:test:contract")];
    const declarations = [quad(source, "type", "urn:usf:type:LocalContributionSource"), quad(algorithm, "type", "urn:usf:type:CliFieldDerivationRule")];
    const required = [quad("urn:test:contract", "requires", source), quad("urn:test:contract", "requires", algorithm)];
    for (const rows of [[], declarations, [...declarations, required[0]!], [...declarations, required[1]!], required,
      [...declarations, quad("urn:test:other-contract", "requires", source), quad("urn:test:other-contract", "requires", algorithm)]]) {
      writeFileSync(join(root, "source.nq"), [...common, ...rows].join("\n") + "\n");
      await assert.rejects(prepareLocalContribution(root, { rootIdentity: "urn:test:work", manifestPath: "manifest.json" }, ops), { reasonCode: "LOCAL_SOURCE_NOT_ADMITTED" });
    }
    writeFileSync(join(root, "source.nq"), [...common, ...declarations, ...required].join("\n") + "\n");
    // Source admission permits further interrogation, not execution or construction.
    await assert.rejects(prepareLocalContribution(root, { rootIdentity: "urn:test:work", manifestPath: "manifest.json" }, ops), { reasonCode: "LOCAL_PROFILE_AMBIGUOUS" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native context refuses missing, ambiguous and mixed-kind selections without construction authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "usf-local-context-"));
  const quad = (s: string, p: string, o: string, literal = false) => `<${s}> <urn:usf:predicate:${p}> ${literal ? JSON.stringify(o) : `<${o}>`} <urn:test:graph> .`;
  const work = "urn:test:work", contract = "urn:test:contract", profile = "urn:test:profile";
  const source = "urn:usf:contribution-source:local-authored:1", algorithm = "urn:usf:algorithm:local-contribution-preparation:1";
  const common = [quad(work, "type", "urn:usf:type:WorkPacket"), quad(work, "contract", contract)];
  const admittedSource = [quad(contract, "requires", source), quad(contract, "requires", algorithm),
    quad(source, "type", "urn:usf:type:LocalContributionSource"), quad(algorithm, "type", "urn:usf:type:CliFieldDerivationRule")];
  const selectedProfile = [quad(profile, "type", "urn:usf:type:RealisationProfile"), quad(profile, "selectsContract", contract)];
  const cases: readonly [string, readonly string[], string][] = [
    ["missing root", [quad("urn:test:other", "type", "urn:usf:type:WorkPacket")], "LOCAL_ROOT_UNINTERPRETABLE"],
    ["wrong root type", [quad(work, "type", "urn:usf:type:SemanticContract")], "LOCAL_ROOT_UNINTERPRETABLE"],
    ["missing contract", [common[0]!], "LOCAL_ROOT_AMBIGUOUS"],
    ["ambiguous contract", [...common, quad(work, "contract", "urn:test:other-contract")], "LOCAL_ROOT_AMBIGUOUS"],
    ["mixed root type", [...common, quad(work, "type", "not-an-IRI", true)], "LOCAL_SELECTION_INVALID"],
    ["mixed contract", [...common, quad(work, "contract", contract, true)], "LOCAL_SELECTION_INVALID"],
    ["missing profile", [...common, ...admittedSource], "LOCAL_PROFILE_AMBIGUOUS"],
    ["untyped profile", [...common, ...admittedSource, selectedProfile[1]!], "LOCAL_PROFILE_AMBIGUOUS"],
    ["ambiguous profile", [...common, ...admittedSource, ...selectedProfile, quad("urn:test:second-profile", "type", "urn:usf:type:RealisationProfile"), quad("urn:test:second-profile", "selectsContract", contract)], "LOCAL_PROFILE_AMBIGUOUS"],
    ["mixed profile type", [...common, ...admittedSource, ...selectedProfile, quad(profile, "type", "invalid", true)], "LOCAL_SELECTION_INVALID"],
    ["mixed profile selection", [...common, ...admittedSource, ...selectedProfile, quad(profile, "selectsContract", contract, true)], "LOCAL_SELECTION_INVALID"],
  ];
  try {
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{ path: "source.nq", format: "application/n-quads", graph: "urn:test:graph", role: "contract", validationProfile: "bootstrap-nquads-v1" }] }));
    for (const [label, rows, reasonCode] of cases) {
      writeFileSync(join(root, "source.nq"), rows.join("\n") + "\n");
      await assert.rejects(prepareLocalContribution(root, { rootIdentity: work, manifestPath: "manifest.json" }, ops), { reasonCode }, label);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native preparation refuses symlinked and non-file manifest inputs before authority derivation", async () => {
  for (const mode of ["manifest-link", "source-link", "source-parent-link", "source-directory"] as const) {
    const root = mkdtempSync(join(tmpdir(), "usf-local-nofollow-"));
    try {
      mkdirSync(join(root, "actual"));
      const sourceBytes = "<urn:test:work> <urn:usf:predicate:type> <urn:usf:type:WorkPacket> <urn:test:graph> .\n";
      writeFileSync(join(root, "actual", "source.nq"), sourceBytes);
      let path = "actual/source.nq";
      if (mode === "source-link") { symlinkSync("actual/source.nq", join(root, "source.nq")); path = "source.nq"; }
      if (mode === "source-parent-link") { symlinkSync("actual", join(root, "alias")); path = "alias/source.nq"; }
      if (mode === "source-directory") path = "actual";
      const manifest = JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{ path, format: "application/n-quads", graph: "urn:test:graph", role: "contract", validationProfile: "bootstrap-nquads-v1" }] });
      writeFileSync(join(root, "actual-manifest.json"), manifest);
      if (mode === "manifest-link") symlinkSync("actual-manifest.json", join(root, "manifest.json"));
      else writeFileSync(join(root, "manifest.json"), manifest);
      const reasonCode = mode === "manifest-link" ? "MANIFEST_PATH_ESCAPE" : mode === "source-directory" ? "MANIFEST_SOURCE_UNREADABLE" : "MANIFEST_SOURCE_PATH_ESCAPE";
      await assert.rejects(prepareLocalContribution(root, { rootIdentity: "urn:test:work", manifestPath: "manifest.json" }, ops), { reasonCode }, mode);
      assert.equal(readFileSync(join(root, "actual", "source.nq"), "utf8"), sourceBytes);
      assert.equal(readFileSync(join(root, "actual-manifest.json"), "utf8"), manifest);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
