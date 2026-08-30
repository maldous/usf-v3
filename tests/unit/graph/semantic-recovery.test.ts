import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  extractLegacySources,
  computeExactLegacyGitBlobOid,
  computeExactLegacyGitCommitOid,
  computeExactLegacyGitTreeOid,
  LegacyExtractionError,
  type ExactLegacyFile,
  type LegacyExtractionResult,
} from "../../../src/graph/recovery-extract.ts";
import {
  compileSemanticRecovery,
  computeExtractionReceiptDigest,
  computeInventoryDigest,
  computeReadinessDigest,
  computeRecoveryDigest,
  computeSourceSetDigest,
  createLegacyGraphInventory,
  deriveRecoveryAuthorityContext,
  recoveryCandidateKinds,
  requiredBauDimensions,
  recoveryAuthorityVocabulary,
  SemanticRecoveryError,
  verifyLegacyGraphInventory,
  type AdoptionReadinessRecord,
  type AdverseLesson,
  type CompactDispositionRule,
  type LegacyGraphInventory,
  type RecoveryAuthorityContext,
  type RecoveryConfig,
  type RecoveryDisposition,
  type RecoverySourceSetContract,
  type V3RecoverySelection,
} from "../../../src/graph/recovery.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] : T[K] extends object ? Mutable<T[K]> : T[K] };

const root = resolve(import.meta.dirname, "../../..");
const sourceId = "urn:fixture:source:v2";
const reviewDigest = digest("independent-review");
const licenceDecisionDigest = digest("licence-decision");
const validationDigest = digest("validation-obligation");
const testDigest = digest("test-obligation");
const encoder = new TextEncoder();

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function reason(error: unknown): string | undefined {
  if (error instanceof SemanticRecoveryError || error instanceof LegacyExtractionError) return error.reasonCode;
  return undefined;
}

function exactFiles(): ExactLegacyFile[] {
  const inactive = bytes("@prefix legacy: <urn:legacy:> . legacy:Inactive legacy:state legacy:retired .\n");
  const leaf = bytes(`version: 1
retiredGraphs:
  - graph: "urn:legacy:graph:retired"
    supersededBy: "urn:legacy:graph:definition"
inactiveSources:
  - file: graph/inactive.trig
    contentDigest: ${digest(inactive)}
    disposition: historical-only
    authorityEligible: false
`);
  const rootManifest = bytes(`version: 1
baseIri: "urn:legacy:"
imports:
  - leaf.yaml
definitionGraphs:
  - file: graph/definition.ttl
    graph: "urn:legacy:graph:shared"
    loadOrder: 0
    validationOrder: 0
authoredGraphs:
  - file: graph/authored.trig
    graph: "urn:legacy:graph:authored"
    loadOrder: 1
    validationOrder: 1
observedGraphs:
  - file: graph/observed.trig
    graph: "urn:legacy:graph:observed"
    loadOrder: 2
    validationOrder: 2
    collector: "urn:legacy:collector:fixture"
shapeGraphs:
  - file: graph/shape.ttl
    graph: "urn:legacy:graph:shared"
    loadOrder: 0
    validationOrder: 3
    liveValidation: false
derivedGraphs:
  - file: graph/derived.trig
    graph: "urn:legacy:graph:derived"
    loadOrder: 4
    validationOrder: 4
rules:
  - file: rules/derive.rq
    kind: derivation
fixtures:
  conforming: fixtures/conforming
  defects: fixtures/defects
  loadAsAuthority: false
`);
  return [
    { path: "manifests/root.yaml", mode: "100644", bytes: rootManifest },
    { path: "manifests/leaf.yaml", mode: "100644", bytes: leaf },
    { path: "manifests/graph/definition.ttl", mode: "100644", bytes: bytes(`@prefix legacy: <urn:legacy:> .
legacy:Service a legacy:ServiceType ; legacy:connector legacy:Connector .
legacy:Connector a legacy:ConnectorType ; legacy:label "mail" .
[] a legacy:AnonymousType ; legacy:link legacy:Service .
`) },
    { path: "manifests/graph/authored.trig", mode: "100644", bytes: bytes("@prefix legacy: <urn:legacy:> . legacy:authored { legacy:Authored a legacy:Definition . }\n") },
    { path: "manifests/graph/observed.trig", mode: "100644", bytes: bytes("@prefix legacy: <urn:legacy:> . legacy:observed { legacy:Observed legacy:signal legacy:Signal . }\n") },
    { path: "manifests/graph/shape.ttl", mode: "100644", bytes: bytes("@prefix legacy: <urn:legacy:> . legacy:Shape a legacy:ShapeType ; legacy:target legacy:Service .\n") },
    { path: "manifests/graph/derived.trig", mode: "100644", bytes: bytes("@prefix legacy: <urn:legacy:> . legacy:derived { legacy:Derived legacy:from legacy:Service . }\n") },
    { path: "manifests/graph/inactive.trig", mode: "100644", bytes: inactive },
    { path: "manifests/rules/derive.rq", mode: "100644", bytes: bytes("CONSTRUCT { ?s <urn:legacy:derived> ?o } WHERE { ?s <urn:legacy:source> ?o }\n") },
    { path: "manifests/fixtures/conforming/case.ttl", mode: "100644", bytes: bytes("<urn:fixture:ok> <urn:fixture:state> <urn:fixture:valid> .\n") },
    { path: "manifests/fixtures/defects/case.ttl", mode: "100644", bytes: bytes("not turtle by design\n") },
    { path: "registries/factory.json", mode: "100644", bytes: bytes('{"services":{"mailer":{"enabled":true}},"actions":["PROCEED","HOLD"],"schema":"evidence"}\n') },
    { path: "config/providers.yaml", mode: "100644", bytes: bytes("providers:\n  - id: local\n    model: fixture\n") },
    { path: "tests/journey.test.ts", mode: "100644", bytes: bytes("export const journey = 'fixture';\n") },
    { path: "docs/architecture.md", mode: "100644", bytes: bytes("# Architecture\n\nSemantic lineage fixture.\n") },
  ];
}

function gitIdentity(files: readonly ExactLegacyFile[]) {
  const tree = computeExactLegacyGitTreeOid(files);
  const commitBytes = bytes(`tree ${tree}\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nsemantic recovery fixture\n`);
  return { tree, commitBytes, revision: computeExactLegacyGitCommitOid(commitBytes) };
}

function makeSourceSet(files: readonly ExactLegacyFile[]): RecoverySourceSetContract {
  const { revision, tree } = gitIdentity(files);
  const rootManifest = files.find((file) => file.path === "manifests/root.yaml");
  assert.ok(rootManifest);
  const withoutDigest = {
    schema: "urn:usf:semantic-recovery-source-set:1" as const,
    version: 1 as const,
    sources: [{
      id: sourceId,
      kind: "historical-usf-repository",
      revision,
      tree,
      selection: { mode: "full-tracked-tree-closure" as const, trackedFileCount: files.length, trackedByteCount: files.reduce((sum, file) => sum + file.bytes.byteLength, 0), filters: [] },
      graphManifest: { path: rootManifest.path, digest: digest(rootManifest.bytes), selectionMode: "full-declared-closure" as const },
      licence: { status: "declared" as const, identifier: "Apache-2.0", evidencePath: "LICENSE", reuseBoundary: "inventory-metadata-and-reviewed-reexpression" },
    }],
  };
  return { ...withoutDigest, sourceSetDigest: computeSourceSetDigest(withoutDigest) };
}

interface Fixture {
  readonly files: readonly ExactLegacyFile[];
  readonly sourceSet: RecoverySourceSetContract;
  readonly extraction: LegacyExtractionResult;
  readonly inventory: LegacyGraphInventory;
}

async function buildFixture(files: readonly ExactLegacyFile[] = exactFiles()): Promise<Fixture> {
  const sourceSet = makeSourceSet(files);
  const { revision, tree, commitBytes } = gitIdentity(files);
  const extraction = await extractLegacySources({
    schema: "urn:usf:exact-legacy-extraction-input:1",
    version: 1,
    sourceSetDigest: sourceSet.sourceSetDigest,
    sources: [{ id: sourceId, revision, tree, commitBytes, manifestRoots: ["manifests/root.yaml"], files }],
  });
  return { files, sourceSet, extraction, inventory: createLegacyGraphInventory(sourceSet, extraction) };
}

let fixturePromise: Promise<Fixture> | undefined;
function fixture(): Promise<Fixture> {
  fixturePromise ??= buildFixture();
  return fixturePromise;
}

const lessonNames = [
  "absence-never-authorizes", "empty-gap-is-not-complete", "limit-one-is-ambiguous", "paging-hides-negative-state", "readiness-binds-validation",
  "single-freshness-axis", "subclass-does-not-govern", "server-size-is-not-identity", "single-materialisation-path", "authority-stable-through-apply",
] as const;

function lessons(): AdverseLesson[] {
  return lessonNames.map((name, index) => ({ id: `lesson:${name}`, kind: index % 2 === 0 ? "defect" : "adverse-lesson", sourceIds: [sourceId], evidenceDigest: digest(`lesson:${name}`) }));
}

function v3Selection(): V3RecoverySelection {
  return {
    profileIri: "urn:usf:profile:v3:1", profileVersion: "1", semanticDigest: digest("v3-semantic"), closureDigest: digest("v3-closure"),
    consumers: [{ iri: "urn:usf:requirement:mailer", kind: "requirement", digest: digest("consumer-mailer"), status: "unsatisfied" }],
    connections: [{ targetIri: "urn:usf:core:mailer", relationType: "reexpresses", digest: digest("typed-connection") }],
    validationObligationDigests: [validationDigest], testObligationDigests: [testDigest],
  };
}

function nqLiteral(value: string): string {
  return JSON.stringify(value);
}

function deriveFixtureAuthority(base: Fixture, config: RecoveryConfig): RecoveryAuthorityContext {
  const { predicate: p, type: t } = recoveryAuthorityVocabulary;
  const authority = "urn:fixture:recovery-authority";
  const profile = "urn:usf:profile:v3:1";
  const consumer = "urn:usf:requirement:mailer";
  const connection = "urn:fixture:connection:mailer";
  const validation = "urn:fixture:validation";
  const testObligation = "urn:fixture:test";
  const licence = "urn:fixture:licence";
  const layer = "urn:fixture:layer";
  const review = "urn:fixture:review";
  const graph = "urn:fixture:graph:recovery-authority";
  const q = (subject: string, predicate: string, object: string, literal = false) => `<${subject}> <${predicate}> ${literal ? nqLiteral(object) : `<${object}>`} <${graph}> .`;
  const quads: string[] = [
    q(authority, p.type, t.authority), q(authority, p.profile, profile), q(authority, p.acceptedSourceSetDigest, base.sourceSet.sourceSetDigest, true),
    q(profile, p.type, t.profile), q(profile, p.version, "1", true),
    q("urn:usf:core:mailer", p.type, t.contract),
    q(authority, p.consumer, consumer), q(consumer, p.type, t.requirement), q(consumer, p.recoveryStatus, "unsatisfied", true),
    q(authority, p.connection, connection), q(connection, p.type, t.connection), q(connection, p.target, "urn:usf:core:mailer"), q(connection, p.relationType, "reexpresses", true),
    q(authority, p.validationObligation, validation), q(validation, p.type, t.validationObligation),
    q(authority, p.testObligation, testObligation), q(testObligation, p.type, t.testObligation),
    q(authority, p.licenceDecision, licence), q(licence, p.type, t.licenceDecision), q(licence, p.source, sourceId), q(licence, p.decisionStatus, "cleared-for-original-v3-reexpression", true),
    q(authority, p.layerDecision, layer), q(layer, p.type, t.layerDecision), q(layer, p.target, "urn:usf:core:mailer"), q(layer, p.targetLayer, "core", true), q(layer, p.isolationStatus, "cleared", true),
    q(authority, p.allowedReview, review), q(review, p.type, t.review),
  ];
  for (const [index, name] of lessonNames.entries()) {
    const lesson = `urn:fixture:lesson:${name}`;
    quads.push(q(authority, p.adverseLesson, lesson), q(lesson, p.type, index % 2 === 0 ? t.defect : t.adverseLesson), q(lesson, p.source, sourceId));
  }
  for (const dimension of requiredBauDimensions) {
    const policy = `urn:fixture:bau:${dimension}`;
    quads.push(q(authority, p.bauPolicy, policy), q(policy, p.type, t.bauPolicy), q(policy, p.dimension, dimension, true), q(policy, p.maximumCeiling, "100", true), q(policy, p.unit, "bounded-units", true));
  }
  const temporaryParent = join(root, ".usf", "tmp");
  mkdirSync(temporaryParent, { recursive: true });
  const temporaryRoot = mkdtempSync(join(temporaryParent, "recovery-authority-"));
  try {
    writeFileSync(join(temporaryRoot, "authority.nq"), `${quads.join("\n")}\n`);
    writeFileSync(join(temporaryRoot, "manifest.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{ path: "authority.nq", format: "application/n-quads", graph, role: "foundation", validationProfile: "bootstrap-nquads-v1" }] }));
    return deriveRecoveryAuthorityContext(temporaryRoot, { manifestPath: "manifest.json", authorityIri: authority, profileIri: profile, sourceSet: base.sourceSet, inventory: base.inventory, config });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function resolution(disposition: RecoveryDisposition, readinessRecordDigest: string | null = null) {
  return {
    disposition,
    rationale: disposition === "re-express-ready" ? "Exact reviewed V3 need." : "Historical metadata remains covered without V3 admission.",
    targetV3Iri: disposition === "re-express-ready" ? "urn:usf:core:mailer" : null,
    definitionCoverageState: disposition === "re-express-ready" ? "absent" as const : "unknown" as const,
    operationalImplementationState: disposition === "re-express-ready" ? "not-implemented" as const : "unknown" as const,
    readinessRecordDigest,
  };
}

interface RecoveryFixture extends Fixture {
  readonly config: RecoveryConfig;
  readonly authority: RecoveryAuthorityContext;
  readonly readyCandidateId: string;
}

async function recoveryFixture(): Promise<RecoveryFixture> {
  const base = await fixture();
  const readyCandidate = base.inventory.candidates.find((candidate) => candidate.identity.candidateKind === "named-semantic-resource" && candidate.typeIris.includes("urn:legacy:ServiceType"));
  assert.ok(readyCandidate);
  const selection = v3Selection();
  const adverseLessons = lessons();
  const readinessWithoutDigest: Omit<AdoptionReadinessRecord, "readinessDigest"> = {
    schema: "urn:usf:semantic-adoption-readiness:1", candidateId: readyCandidate.candidateId, sourceDigest: readyCandidate.sourceDigest, reviewed: true, reviewDigest,
    relevance: { consumerIri: "urn:usf:requirement:mailer", consumerKind: "requirement", consumerDigest: digest("consumer-mailer"), unsatisfied: true, duplicate: false },
    connectivity: { status: "connected", selectedProfileIri: selection.profileIri, selectedProfileVersion: selection.profileVersion, closureDigest: selection.closureDigest, targetIri: "urn:usf:core:mailer", relationType: "reexpresses", intendedConsumers: [], newRootExceptionDigest: null },
    licence: { status: "cleared", decisionDigest: licenceDecisionDigest },
    layer: { targetLayer: "core", productProfileIri: null, productProfileVersion: null, isolationStatus: "cleared", decisionDigest: digest("layer-decision") },
    mitigations: adverseLessons.map((lesson) => ({ lessonId: lesson.id, mitigation: `V3 mitigation for ${lesson.id}`, verificationDigest: digest(`mitigation:${lesson.id}`) })),
    currentness: { sourceSetDigest: base.sourceSet.sourceSetDigest, inventoryDigest: base.inventory.inventoryDigest, selectedProfileIri: selection.profileIri, selectedProfileVersion: selection.profileVersion, semanticDigest: selection.semanticDigest, closureDigest: selection.closureDigest, validationObligationDigest: validationDigest, testObligationDigest: testDigest },
    bauCeilings: requiredBauDimensions.map((dimension) => ({ dimension, ceiling: 10, observed: 0, unit: "bounded-units", status: "within" })),
    lifecycle: { applicability: "not-applicable", rationale: "A static semantic definition has no process lifecycle." },
  };
  const readiness: AdoptionReadinessRecord = { ...readinessWithoutDigest, readinessDigest: computeReadinessDigest(readinessWithoutDigest) };
  const rules: CompactDispositionRule[] = recoveryCandidateKinds.map((candidateKind) => ({ id: `rule:${candidateKind}`, match: { sourceId, candidateKind }, resolution: resolution("metadata-only"), provenance: { reviewId: `review:${candidateKind}`, reviewDigest } }));
  rules.push({ id: "rule:shape-type", match: { sourceId, candidateKind: "named-semantic-resource", exactType: "urn:legacy:ShapeType" }, resolution: resolution("historical-only"), provenance: { reviewId: "review:shape-type", reviewDigest } });
  const configWithoutDigest = {
    schema: "urn:usf:semantic-recovery:1" as const, version: 1 as const, sourceSetDigest: base.sourceSet.sourceSetDigest, inventoryDigest: base.inventory.inventoryDigest,
    exactDispositions: [{ candidateId: readyCandidate.candidateId, resolution: resolution("re-express-ready", readiness.readinessDigest), provenance: { reviewId: "review:ready-mailer", reviewDigest } }],
    rules, readinessRecords: [readiness], reviewedMappings: [],
  };
  let config: RecoveryConfig = { ...configWithoutDigest, recoveryDigest: computeRecoveryDigest(configWithoutDigest) };
  const provisionalAuthority = deriveFixtureAuthority(base, config);
  const revised = structuredClone(config) as Mutable<RecoveryConfig>;
  const revisedReadiness = revised.readinessRecords[0]!;
  const selectedConsumer = provisionalAuthority.v3Selection.consumers[0]!;
  revisedReadiness.reviewDigest = provisionalAuthority.allowedReviewDigests[0]!;
  revisedReadiness.relevance.consumerDigest = selectedConsumer.digest;
  revisedReadiness.connectivity.selectedProfileIri = provisionalAuthority.v3Selection.profileIri;
  revisedReadiness.connectivity.selectedProfileVersion = provisionalAuthority.v3Selection.profileVersion;
  revisedReadiness.connectivity.closureDigest = provisionalAuthority.v3Selection.closureDigest;
  revisedReadiness.licence.decisionDigest = provisionalAuthority.licenceDecisions[0]!.decisionDigest;
  revisedReadiness.layer.decisionDigest = provisionalAuthority.layerDecisions[0]!.decisionDigest;
  revisedReadiness.mitigations = provisionalAuthority.adverseLessons.map((lesson) => ({ lessonId: lesson.id, mitigation: `V3 mitigation for ${lesson.id}`, verificationDigest: digest(`mitigation:${lesson.id}`) }));
  revisedReadiness.currentness.semanticDigest = provisionalAuthority.v3Selection.semanticDigest;
  revisedReadiness.currentness.closureDigest = provisionalAuthority.v3Selection.closureDigest;
  revisedReadiness.currentness.validationObligationDigest = provisionalAuthority.v3Selection.validationObligationDigests[0]!;
  revisedReadiness.currentness.testObligationDigest = provisionalAuthority.v3Selection.testObligationDigests[0]!;
  revisedReadiness.readinessDigest = computeReadinessDigest(revisedReadiness as AdoptionReadinessRecord);
  revised.exactDispositions[0]!.resolution.readinessRecordDigest = revisedReadiness.readinessDigest;
  for (const rule of revised.rules) rule.provenance.reviewDigest = provisionalAuthority.allowedReviewDigests[0]!;
  revised.exactDispositions[0]!.provenance.reviewDigest = provisionalAuthority.allowedReviewDigests[0]!;
  config = resign(revised);
  const authority = deriveFixtureAuthority(base, config);
  return { ...base, config, authority, readyCandidateId: readyCandidate.candidateId };
}

function resign(config: Mutable<RecoveryConfig>): RecoveryConfig {
  config.recoveryDigest = computeRecoveryDigest(config as RecoveryConfig);
  return config as RecoveryConfig;
}

function mutateReadiness(base: RecoveryFixture, mutate: (record: Mutable<AdoptionReadinessRecord>) => void): { config: RecoveryConfig; authority: RecoveryAuthorityContext } {
  const config = structuredClone(base.config) as Mutable<RecoveryConfig>;
  const record = config.readinessRecords[0] as Mutable<AdoptionReadinessRecord>;
  mutate(record);
  record.readinessDigest = computeReadinessDigest(record as AdoptionReadinessRecord);
  config.exactDispositions[0]!.resolution.readinessRecordDigest = record.readinessDigest;
  const resigned = resign(config);
  return { config: resigned, authority: deriveFixtureAuthority(base, resigned) };
}

test("exact-byte extraction covers every denominator family deterministically and validates closed schemas", async () => {
  const value = await recoveryFixture();
  const inventoryValidator = createJsonSchemaValidator(JSON.parse(readFileSync(resolve(root, "schemas/legacy-graph-inventory.schema.json"), "utf8")));
  const recoveryValidator = createJsonSchemaValidator(JSON.parse(readFileSync(resolve(root, "schemas/semantic-recovery.schema.json"), "utf8")));
  assert.equal(inventoryValidator.validate(value.inventory).valid, true);
  assert.equal(recoveryValidator.validate(value.config).valid, true);
  assert.equal(Object.isFrozen(value.extraction), true);
  assert.equal(Object.isFrozen(value.inventory), true);
  for (const kind of recoveryCandidateKinds) assert.equal(value.inventory.candidates.some((candidate) => candidate.identity.candidateKind === kind), true, kind);
  assert.equal(value.inventory.graphSelections.filter((selection) => selection.graphIri === "urn:legacy:graph:shared").length, 2, "repeated graph and load order remain distinct selections");
  assert.equal(value.inventory.graphSelections.some((selection) => selection.kind === "rule" && selection.outputGraphIri === null), true);
  assert.equal(value.inventory.graphSelections.some((selection) => selection.kind === "retired-graph" && selection.filePath === null), true);
  assert.equal(value.inventory.graphSelections.filter((selection) => selection.kind === "fixture-root").length, 2);
  assert.equal(value.inventory.candidates.some((candidate) => candidate.identity.discriminator.startsWith("blank-node-component:")), true);
  assert.equal(value.extraction.sources.flatMap((source) => source.manifests).flatMap((manifest) => manifest.entries).flatMap((entry) => "quads" in entry ? entry.quads : []).some((quad) => quad.object === "mail"), false, "literal payloads are not persisted");

  const beforeInventory = structuredClone(value.inventory);
  const beforeConfig = structuredClone(value.config);
  const report = compileSemanticRecovery(value.inventory, value.config, value.authority);
  assert.equal(report.totals.resolved, value.inventory.candidates.length);
  assert.equal(Object.values(report.totals.byCandidateKind).reduce((sum, count) => sum + count, 0), report.totals.candidates);
  assert.equal(report.totals.byGraphSelectionKind.rule, 1);
  assert.equal(report.candidates.find((candidate) => candidate.candidateId === value.readyCandidateId)?.disposition, "re-express-ready");
  assert.equal(report.candidates.some((candidate) => candidate.provenanceId === "rule:shape-type" && candidate.disposition === "historical-only"), true);
  assert.equal(report.historicalReextraction, "not-independently-re-extracted");
  assert.deepEqual(value.inventory, beforeInventory);
  assert.deepEqual(value.config, beforeConfig);

  const reordered = await buildFixture([...value.files].reverse());
  assert.equal(reordered.sourceSet.sourceSetDigest, value.sourceSet.sourceSetDigest);
  assert.equal(reordered.extraction.resultDigest, value.extraction.resultDigest);
  assert.equal(reordered.inventory.inventoryDigest, value.inventory.inventoryDigest);

  const originalLocaleCompare = String.prototype.localeCompare;
  Object.defineProperty(String.prototype, "localeCompare", { configurable: true, writable: true, value(this: string, other: string) { throw new Error(`locale ordering is forbidden: ${this}/${other}`); } });
  try {
    const localePoisoned = await buildFixture(value.files);
    assert.equal(localePoisoned.extraction.resultDigest, value.extraction.resultDigest, "extraction identity is byte-order deterministic");
    assert.equal(localePoisoned.inventory.inventoryDigest, value.inventory.inventoryDigest, "inventory identity is byte-order deterministic");
  } finally {
    Object.defineProperty(String.prototype, "localeCompare", { configurable: true, writable: true, value: originalLocaleCompare });
  }

  const dualBaseFiles: ExactLegacyFile[] = [
    { path: "manifests/root.yaml", mode: "100644", bytes: bytes("version: 1\nimports:\n  - first.yaml\n  - second.yaml\n") },
    { path: "manifests/first.yaml", mode: "100644", bytes: bytes("version: 1\nbaseIri: \"urn:fixture:first:\"\ndefinitionGraphs:\n  - file: graph/shared.ttl\n    graph: urn:fixture:graph:first\n    loadOrder: 0\n    validationOrder: 0\n") },
    { path: "manifests/second.yaml", mode: "100644", bytes: bytes("version: 1\nbaseIri: \"urn:fixture:second:\"\ndefinitionGraphs:\n  - file: graph/shared.ttl\n    graph: urn:fixture:graph:second\n    loadOrder: 0\n    validationOrder: 0\n") },
    { path: "manifests/graph/shared.ttl", mode: "100644", bytes: bytes("<relative> a <Type> .\n") },
  ];
  const dualBase = await buildFixture(dualBaseFiles);
  const definitions = dualBase.extraction.sources[0]!.manifests.flatMap((manifest) => manifest.entries).filter((entry) => entry.kind === "definition-graph");
  assert.deepEqual(definitions.map((entry) => entry.resourceDefinitions[0]?.iri).sort(), ["urn:fixture:first:relative", "urn:fixture:second:relative"], "RDF parsing is keyed by exact file and manifest base IRI, never by file path alone");
});

test("strict exact-byte parser, source binding, bounds, and shortened inventory defects fail closed", async () => {
  const baseline = await fixture();
  const extractWith = (files: readonly ExactLegacyFile[], sourceSet = makeSourceSet(files), limits: Parameters<typeof extractLegacySources>[1] = {}) => {
    const { revision, tree, commitBytes } = gitIdentity(files);
    return extractLegacySources({ schema: "urn:usf:exact-legacy-extraction-input:1", version: 1, sourceSetDigest: sourceSet.sourceSetDigest, sources: [{ id: sourceId, revision, tree, commitBytes, manifestRoots: ["manifests/root.yaml"], files }] }, limits);
  };
  const replace = (path: string, replacement: Uint8Array): ExactLegacyFile[] => baseline.files.map((file) => file.path === path ? { path, mode: file.mode, bytes: replacement } : file);
  const decode = (path: string): string => new TextDecoder().decode(baseline.files.find((file) => file.path === path)?.bytes);
  const { revision, tree, commitBytes } = gitIdentity(baseline.files);
  const extractionInput = { schema: "urn:usf:exact-legacy-extraction-input:1" as const, version: 1 as const, sourceSetDigest: baseline.sourceSet.sourceSetDigest, sources: [{ id: sourceId, revision, tree, commitBytes, manifestRoots: ["manifests/root.yaml"], files: baseline.files }] };
  const sourceInput = extractionInput.sources[0]!;

  const parserDefects = [
    { name: "duplicate YAML key", path: "config/providers.yaml", source: "a: 1\na: 2\n", expected: "LEGACY_EXTRACTION_STRUCTURED_PARSE_FAILED" },
    { name: "YAML alias", path: "config/providers.yaml", source: "a: &x 1\nb: *x\n", expected: "LEGACY_EXTRACTION_YAML_ALIAS_FORBIDDEN" },
    { name: "YAML merge", path: "config/providers.yaml", source: "<<: 1\n", expected: "LEGACY_EXTRACTION_YAML_MERGE_FORBIDDEN" },
    { name: "YAML tag", path: "config/providers.yaml", source: "a: !!str x\n", expected: "LEGACY_EXTRACTION_YAML_TAG_FORBIDDEN" },
    { name: "YAML 1.1", path: "config/providers.yaml", source: "%YAML 1.1\n---\na: 1\n", expected: "LEGACY_EXTRACTION_YAML_VERSION_INVALID" },
    { name: "non JSON", path: "registries/factory.json", source: '{"a":1,}\n', expected: "LEGACY_EXTRACTION_JSON_SYNTAX_INVALID" },
    { name: "bad RDF", path: "manifests/graph/definition.ttl", source: "not turtle\n", expected: "LEGACY_EXTRACTION_RDF_PARSE_FAILED" },
    { name: "bad SPARQL", path: "manifests/rules/derive.rq", source: "NOT A QUERY\n", expected: "LEGACY_EXTRACTION_SPARQL_PARSE_FAILED" },
  ] as const;
  for (const defect of parserDefects) await assert.rejects(extractWith(replace(defect.path, bytes(defect.source))), (error) => reason(error) === defect.expected, defect.name);

  const limitDefects = [
    { limits: { maxFiles: 1 }, expected: "LEGACY_EXTRACTION_FILE_LIMIT_EXCEEDED" },
    { limits: { maxFileBytes: sourceInput.commitBytes.byteLength + 1 }, expected: "LEGACY_EXTRACTION_FILE_BYTE_LIMIT_EXCEEDED" },
    { limits: { maxTotalBytes: 1 }, expected: "LEGACY_EXTRACTION_TOTAL_BYTE_LIMIT_EXCEEDED" },
    { limits: { maxNodes: 1 }, expected: "LEGACY_EXTRACTION_NODE_LIMIT_EXCEEDED" },
    { limits: { maxDepth: 1 }, expected: "LEGACY_EXTRACTION_PATH_DEPTH_LIMIT_EXCEEDED" },
    { limits: { maxRecords: 1 }, expected: "LEGACY_EXTRACTION_RECORD_LIMIT_EXCEEDED" },
    { limits: { maxQuads: 1 }, expected: "LEGACY_EXTRACTION_QUAD_LIMIT_EXCEEDED" },
    { limits: { maxManifests: 1 }, expected: "LEGACY_EXTRACTION_MANIFEST_LIMIT_EXCEEDED" },
  ] as const;
  for (const defect of limitDefects) await assert.rejects(() => extractLegacySources(extractionInput, defect.limits), (error) => reason(error) === defect.expected);
  const costlyYaml = Array.from({ length: 1_000 }, (_value, index) => `entry${index}: ${index}\n`).join("");
  const costlyFiles = replace("config/providers.yaml", bytes(costlyYaml));
  await assert.rejects(() => extractWith(costlyFiles, makeSourceSet(costlyFiles), { maxElapsedMilliseconds: 1 }), (error) => reason(error) === "LEGACY_EXTRACTION_DEADLINE_EXCEEDED", "deadline cannot be bypassed by a caller-supplied clock");

  const definition = decode("manifests/graph/definition.ttl");
  const omittedTriple = "legacy:Connector a legacy:ConnectorType ; legacy:label \"mail\" .";
  const rdfOmission = await buildFixture(replace("manifests/graph/definition.ttl", bytes(definition.replace(omittedTriple, " ".repeat(omittedTriple.length)))));
  assert.notEqual(rdfOmission.sourceSet.sourceSetDigest, baseline.sourceSet.sourceSetDigest);
  assert.equal(rdfOmission.inventory.candidates.length < baseline.inventory.candidates.length, true, "omitted RDF cannot preserve the candidate closure");

  const registry = decode("registries/factory.json");
  const omittedProperty = ',"schema":"evidence"';
  const recordOmission = await buildFixture(replace("registries/factory.json", bytes(registry.replace(omittedProperty, " ".repeat(omittedProperty.length)))));
  assert.notEqual(recordOmission.sourceSet.sourceSetDigest, baseline.sourceSet.sourceSetDigest);
  assert.equal(recordOmission.inventory.structuredRecords.length < baseline.inventory.structuredRecords.length, true, "omitted structured records change the exact inventory");

  const rootManifest = decode("manifests/root.yaml");
  const shapeBlock = `shapeGraphs:
  - file: graph/shape.ttl
    graph: "urn:legacy:graph:shared"
    loadOrder: 0
    validationOrder: 3
    liveValidation: false
`;
  const manifestOmissionBytes = bytes(rootManifest.replace(shapeBlock, shapeBlock.replace(/[^\n]/gu, " ")));
  const manifestOmissionFiles = replace("manifests/root.yaml", manifestOmissionBytes);
  const manifestOmission = await extractWith(manifestOmissionFiles, baseline.sourceSet);
  assert.throws(() => createLegacyGraphInventory(baseline.sourceSet, manifestOmission), (error) => reason(error) === "LEGACY_EXTRACTION_SOURCE_DENOMINATOR_MISMATCH");

  const definitionBlock = `  - file: graph/definition.ttl
    graph: "urn:legacy:graph:shared"
    loadOrder: 0
    validationOrder: 0
`;
  await assert.rejects(extractWith(replace("manifests/root.yaml", bytes(rootManifest.replace(definitionBlock, `${definitionBlock}${definitionBlock}`)))), (error) => reason(error) === "LEGACY_MANIFEST_DUPLICATE_ENTRY_IDENTITY");
  const leafManifest = decode("manifests/leaf.yaml");
  await assert.rejects(extractWith(replace("manifests/leaf.yaml", bytes(leafManifest.replace("urn:legacy:graph:retired", "urn:legacy:graph:shared")))), (error) => reason(error) === "LEGACY_MANIFEST_CURRENT_RETIRED_CONTRADICTION");

  const unsupportedFiles = replace("manifests/root.yaml", bytes(rootManifest.replace("graph/definition.ttl", "graph/definition.rdf"))).map((file) => file.path === "manifests/graph/definition.ttl" ? { path: "manifests/graph/definition.rdf", mode: file.mode, bytes: file.bytes } : file);
  await assert.rejects(extractWith(unsupportedFiles), (error) => reason(error) === "LEGACY_EXTRACTION_RDF_FORMAT_UNSUPPORTED");

  const query = decode("manifests/rules/derive.rq").trimEnd();
  const bundled = await extractWith(replace("manifests/rules/derive.rq", bytes(`${query}\n#---NEXT---#\nASK { ?s ?p ?o }\n`)));
  const bundledRule = bundled.sources[0]?.manifests.flatMap((manifest) => manifest.entries).find((entry) => entry.kind === "rule");
  assert.equal(bundledRule?.operationKind.length !== 0, true);
  await assert.rejects(extractWith(replace("manifests/rules/derive.rq", bytes(`${query}\n#---NEXT---#\n\n`))), (error) => reason(error) === "LEGACY_EXTRACTION_SPARQL_EMPTY_UNIT");

  const blankA = await extractWith(replace("manifests/graph/definition.ttl", bytes(definition.replace("[] a legacy:AnonymousType", "_:a a legacy:AnonymousType"))));
  const blankB = await extractWith(replace("manifests/graph/definition.ttl", bytes(definition.replace("[] a legacy:AnonymousType", "_:b a legacy:AnonymousType"))));
  const definitionEntry = (result: LegacyExtractionResult) => result.sources[0]?.manifests.flatMap((manifest) => manifest.entries).find((entry) => entry.kind === "definition-graph");
  assert.equal(definitionEntry(blankA)?.semanticDigest, definitionEntry(blankB)?.semanticDigest);
  assert.equal(definitionEntry(blankA)?.blankNodeComponents[0]?.componentDigest, definitionEntry(blankB)?.blankNodeComponents[0]?.componentDigest);
  assert.notEqual(blankA.sources[0]?.trackedFiles.find((file) => file.path === "manifests/graph/definition.ttl")?.digest, blankB.sources[0]?.trackedFiles.find((file) => file.path === "manifests/graph/definition.ttl")?.digest);

  const missingDocumentResult = await extractWith(baseline.files.filter((file) => file.path !== "docs/architecture.md"));
  assert.throws(() => createLegacyGraphInventory(baseline.sourceSet, missingDocumentResult), (error) => reason(error) === "LEGACY_EXTRACTION_SOURCE_SET_DIGEST_MISMATCH");

  const filterDrift = structuredClone(baseline.sourceSet) as Mutable<RecoverySourceSetContract>;
  filterDrift.sources[0]!.selection.filters.push("graph/**");
  filterDrift.sourceSetDigest = computeSourceSetDigest(filterDrift as RecoverySourceSetContract);
  assert.throws(() => createLegacyGraphInventory(filterDrift as RecoverySourceSetContract, baseline.extraction), (error) => reason(error) === "SOURCE_SET_FILTERS_FORBIDDEN");
  const treeDrift = structuredClone(baseline.sourceSet) as Mutable<RecoverySourceSetContract>;
  treeDrift.sources[0]!.tree = "3".repeat(40);
  treeDrift.sourceSetDigest = computeSourceSetDigest(treeDrift as RecoverySourceSetContract);
  assert.throws(() => createLegacyGraphInventory(treeDrift as RecoverySourceSetContract, baseline.extraction), (error) => reason(error) === "LEGACY_EXTRACTION_SOURCE_SET_DIGEST_MISMATCH");

  const provenanceDefects = [
    { name: "copied extraction provenance", value: { ...baseline.extraction }, expected: "LEGACY_EXTRACTION_RESULT_UNAUTHENTIC" },
    { name: "cloned extraction provenance", value: structuredClone(baseline.extraction), expected: "LEGACY_EXTRACTION_RESULT_UNAUTHENTIC" },
  ] as const;
  for (const defect of provenanceDefects) assert.throws(() => createLegacyGraphInventory(baseline.sourceSet, defect.value), (error) => reason(error) === defect.expected, defect.name);

  const gitDefects = [
    { name: "wrong commit object", input: { ...sourceInput, commitBytes: bytes(`${new TextDecoder().decode(sourceInput.commitBytes)}tampered`) }, expected: "LEGACY_EXTRACTION_COMMIT_OID_MISMATCH" },
    { name: "wrong declared tree", input: { ...sourceInput, tree: "0".repeat(40) }, expected: "LEGACY_EXTRACTION_TREE_OID_MISMATCH" },
    { name: "wrong file mode closure", input: { ...sourceInput, files: sourceInput.files.map((file) => file.path === "docs/architecture.md" ? { ...file, mode: "100755" as const } : file) }, expected: "LEGACY_EXTRACTION_TREE_OID_MISMATCH" },
    { name: "wrong blob closure", input: { ...sourceInput, files: sourceInput.files.map((file) => file.path === "docs/architecture.md" ? { ...file, bytes: bytes("# altered\n") } : file) }, expected: "LEGACY_EXTRACTION_TREE_OID_MISMATCH" },
  ] as const;
  for (const defect of gitDefects) await assert.rejects(extractLegacySources({ ...extractionInput, sources: [defect.input] }), (error) => reason(error) === defect.expected, defect.name);
  const deceptiveFile = { ...sourceInput.files[0]! } as { path: string; mode: "100644" | "100755" | "120000"; bytes: Uint8Array };
  let reads = 0;
  Object.defineProperty(deceptiveFile, "bytes", { enumerable: true, get() { reads += 1; return reads === 1 ? sourceInput.files[0]!.bytes : new Uint8Array(129 * 1024 * 1024); } });
  await assert.rejects(extractLegacySources({ ...extractionInput, sources: [{ ...sourceInput, files: [deceptiveFile, ...sourceInput.files.slice(1)] }] }), (error) => reason(error) === "LEGACY_EXTRACTION_FILE_INVALID", "accessor-backed bytes cannot bypass the exact-byte ceiling");
  const deceptiveRevision = { ...sourceInput } as typeof sourceInput;
  let revisionReads = 0;
  Object.defineProperty(deceptiveRevision, "revision", { enumerable: true, get() { revisionReads += 1; return revisionReads === 1 ? sourceInput.revision : "f".repeat(40); } });
  await assert.rejects(extractLegacySources({ ...extractionInput, sources: [deceptiveRevision] }), (error) => reason(error) === "LEGACY_EXTRACTION_INPUT_INVALID", "accessor-backed revision cannot produce a branded receipt");
  const iteratorBackedBytes = Uint8Array.from(sourceInput.files[0]!.bytes);
  Object.defineProperty(iteratorBackedBytes, Symbol.iterator, { value: function* iteratorPayload() { for (let index = 0; index < 100_001; index += 1) yield 0; } });
  const iteratorBackedFile = { ...sourceInput.files[0]!, bytes: iteratorBackedBytes };
  await assert.rejects(extractLegacySources({ ...extractionInput, sources: [{ ...sourceInput, files: [iteratorBackedFile, ...sourceInput.files.slice(1)] }] }, { maxFileBytes: 100_000 }), (error) => reason(error) === "LEGACY_EXTRACTION_FILE_INVALID", "iterator-backed bytes cannot expand the accepted payload");
  assert.equal(computeExactLegacyGitBlobOid(baseline.files[0]!.bytes), baseline.extraction.sources[0]!.trackedFiles.find((file) => file.path === baseline.files[0]!.path)?.blobOid);

  assert.throws(() => createLegacyGraphInventory(baseline.sourceSet, baseline.extraction, { maxTrackedFiles: 1 }), (error) => reason(error) === "LEGACY_TRACKED_FILE_LIMIT_EXCEEDED");
  assert.throws(() => verifyLegacyGraphInventory(baseline.inventory, baseline.sourceSet, { maxElapsedMilliseconds: 1 }), (error) => reason(error) === "RECOVERY_DEADLINE_EXCEEDED", "inventory verification has no caller-controlled clock bypass");

  const tampered = structuredClone(baseline.inventory) as Mutable<LegacyGraphInventory>;
  const removed = tampered.trackedFiles.find((file) => file.path === "docs/architecture.md");
  assert.ok(removed);
  tampered.trackedFiles = tampered.trackedFiles.filter((file) => file.path !== removed.path);
  tampered.sources[0]!.trackedFileCount -= 1;
  tampered.sources[0]!.trackedByteCount -= removed.bytes;
  tampered.sources[0]!.roleAssertionCount -= removed.roles.length;
  tampered.sources[0]!.candidateCount -= 2;
  tampered.sources[0]!.extractionReceipt.counts.trackedFiles -= 1;
  tampered.sources[0]!.extractionReceipt.counts.trackedBytes -= removed.bytes;
  tampered.sources[0]!.extractionReceipt.counts.roleAssertions -= removed.roles.length;
  tampered.sources[0]!.extractionReceipt.receiptDigest = computeExtractionReceiptDigest(tampered.sources[0]!.extractionReceipt);
  tampered.candidates = tampered.candidates.filter((candidate) => candidate.identity.candidateIriPathOrRegistryKey !== removed.path);
  tampered.inventoryDigest = computeInventoryDigest(tampered as LegacyGraphInventory);
  const compiled = await recoveryFixture();
  assert.throws(() => compileSemanticRecovery(tampered as LegacyGraphInventory, compiled.config, compiled.authority), (error) => reason(error) === "LEGACY_INVENTORY_SOURCE_DENOMINATOR_MISMATCH");

  const parserOutcomeOmission = structuredClone(baseline.inventory) as Mutable<LegacyGraphInventory>;
  const parsedFile = parserOutcomeOmission.trackedFiles.find((file) => file.parserOutcomes.length > 0);
  assert.ok(parsedFile);
  parsedFile.parserOutcomes = [];
  parserOutcomeOmission.inventoryDigest = computeInventoryDigest(parserOutcomeOmission as LegacyGraphInventory);
  assert.throws(() => verifyLegacyGraphInventory(parserOutcomeOmission as LegacyGraphInventory, baseline.sourceSet), (error) => reason(error) === "LEGACY_INVENTORY_EXTRACTION_COUNT_MISMATCH", "retained parser outcomes cannot be omitted after extraction");

  const coordinated = structuredClone(baseline.inventory) as Mutable<LegacyGraphInventory>;
  const omittedCandidate = coordinated.candidates.find((candidate) => candidate.identity.candidateKind === "referenced-iri");
  assert.ok(omittedCandidate);
  coordinated.candidates = coordinated.candidates.filter((candidate) => candidate.candidateId !== omittedCandidate.candidateId);
  coordinated.sources[0]!.candidateCount -= 1;
  coordinated.inventoryDigest = computeInventoryDigest(coordinated as LegacyGraphInventory);
  assert.throws(() => verifyLegacyGraphInventory(coordinated as LegacyGraphInventory, baseline.sourceSet), (error) => reason(error) === "LEGACY_INVENTORY_CANDIDATE_COVERAGE_GAP", "retained RDF observations independently rederive the candidate closure");

  const structuredOmission = structuredClone(baseline.inventory) as Mutable<LegacyGraphInventory>;
  const omittedRecord = structuredOmission.structuredRecords[0];
  assert.ok(omittedRecord);
  const omittedStructuredCandidate = structuredOmission.candidates.find((candidate) => candidate.identity.candidateKind === "structured-schema-or-registry-record" && candidate.identity.selectedFileGraphOrRegistryId === omittedRecord.registryId && candidate.identity.candidateIriPathOrRegistryKey === omittedRecord.key);
  assert.ok(omittedStructuredCandidate);
  structuredOmission.candidates = structuredOmission.candidates.filter((candidate) => candidate.candidateId !== omittedStructuredCandidate.candidateId);
  structuredOmission.sources[0]!.candidateCount -= 1;
  structuredOmission.inventoryDigest = computeInventoryDigest(structuredOmission as LegacyGraphInventory);
  assert.throws(() => verifyLegacyGraphInventory(structuredOmission as LegacyGraphInventory, baseline.sourceSet), (error) => reason(error) === "LEGACY_INVENTORY_CANDIDATE_COVERAGE_GAP", "retained structured records independently rederive the candidate closure");
});

test("exact and indexed compact dispositions are total while ambiguity, gaps, duplicates, stale rules, and rule-ready fail closed", async () => {
  const baseline = await recoveryFixture();
  const report = compileSemanticRecovery(baseline.inventory, baseline.config, baseline.authority);
  assert.equal(report.totals.candidates, report.totals.resolved);
  assert.equal(Object.values(report.totals.byDisposition).reduce((sum, count) => sum + count, 0), report.totals.candidates);

  const defects: Array<{ name: string; expected: string; mutate: (config: Mutable<RecoveryConfig>) => void }> = [
    { name: "missing compact source", expected: "RECOVERY_RULE_INVALID", mutate: (config) => { delete (config.rules[0]!.match as { sourceId?: string }).sourceId; } },
    { name: "unmatched", expected: "RECOVERY_COVERAGE_UNMATCHED", mutate: (config) => { config.rules = config.rules.filter((rule) => rule.match.candidateKind !== "semantic-document"); } },
    { name: "duplicate exact", expected: "RECOVERY_EXACT_DISPOSITION_DUPLICATE", mutate: (config) => { config.exactDispositions.push(structuredClone(config.exactDispositions[0]!)); } },
    { name: "duplicate match", expected: "RECOVERY_RULE_DUPLICATE_MATCH", mutate: (config) => { const duplicate = structuredClone(config.rules[0]!); duplicate.id = "rule:duplicate"; config.rules.push(duplicate); } },
    { name: "compact ready", expected: "RECOVERY_RULE_READY_FORBIDDEN", mutate: (config) => { config.rules[0]!.resolution = resolution("re-express-ready", digest("fake-readiness")); } },
    { name: "multiple compact discriminators", expected: "RECOVERY_RULE_DISCRIMINATOR_INVALID", mutate: (config) => { config.rules[0]!.match.exactType = "urn:legacy:ServiceType"; config.rules[0]!.match.pathClass = "rdf"; } },
    { name: "ambiguous incomparable", expected: "RECOVERY_COVERAGE_AMBIGUOUS", mutate: (config) => { config.rules.push({ id: "rule:rdf-path", match: { sourceId, candidateKind: "named-semantic-resource", pathClass: "rdf" }, resolution: resolution("reject"), provenance: { reviewId: "review:rdf-path", reviewDigest } }); } },
    { name: "stale zero match", expected: "RECOVERY_RULE_ZERO_MATCH", mutate: (config) => { config.rules.push({ id: "rule:stale", match: { sourceId, candidateKind: "named-semantic-resource", exactType: "urn:legacy:NeverObserved" }, resolution: resolution("defer"), provenance: { reviewId: "review:stale", reviewDigest } }); } },
  ];
  for (const defect of defects) {
    const config = structuredClone(baseline.config) as Mutable<RecoveryConfig>;
    defect.mutate(config);
    for (const rule of config.rules) rule.provenance.reviewDigest = baseline.authority.allowedReviewDigests[0]!;
    for (const exact of config.exactDispositions) exact.provenance.reviewDigest = baseline.authority.allowedReviewDigests[0]!;
    const resigned = resign(config);
    if (defect.expected === "RECOVERY_RULE_DISCRIMINATOR_INVALID" || defect.expected === "RECOVERY_RULE_INVALID") assert.throws(() => deriveFixtureAuthority(baseline, resigned), (error) => reason(error) === defect.expected, defect.name);
    else assert.throws(() => compileSemanticRecovery(baseline.inventory, resigned, deriveFixtureAuthority(baseline, resigned)), (error) => reason(error) === defect.expected, defect.name);
  }
});

test("re-express-ready is exact, independently authorized, source-bound, current, mitigated, bounded, and lifecycle-complete", async () => {
  const baseline = await recoveryFixture();
  const missingRecord = structuredClone(baseline.config) as Mutable<RecoveryConfig>;
  missingRecord.readinessRecords = [];
  const missingConfig = resign(missingRecord);
  const missingAuthority = deriveFixtureAuthority(baseline, missingConfig);
  const missingReport = compileSemanticRecovery(baseline.inventory, missingConfig, missingAuthority);
  assert.equal(missingReport.candidates.find((candidate) => candidate.candidateId === baseline.readyCandidateId)?.disposition, "unresolved", "exhaustive discovery alone is not readiness");

  const cases: Array<{ name: string; expected: "defer" | "unresolved"; mutate: (record: Mutable<AdoptionReadinessRecord>) => void }> = [
    { name: "disconnected", expected: "defer", mutate: (record) => { record.connectivity.status = "disconnected"; } },
    { name: "fake consumer", expected: "unresolved", mutate: (record) => { record.relevance.consumerIri = "urn:usf:requirement:invented"; } },
    { name: "duplicate", expected: "defer", mutate: (record) => { (record.relevance as unknown as { duplicate: boolean }).duplicate = true; } },
    { name: "stale V3 semantic currentness", expected: "unresolved", mutate: (record) => { record.currentness.semanticDigest = digest("stale"); } },
    { name: "unmitigated adverse lesson", expected: "defer", mutate: (record) => { record.mitigations.pop(); } },
    { name: "over BAU ceiling", expected: "defer", mutate: (record) => { record.bauCeilings[0]!.observed = 11; } },
    { name: "unknown is not observed zero", expected: "unresolved", mutate: (record) => { record.bauCeilings[0]!.status = "unknown"; record.bauCeilings[0]!.observed = 0; } },
    { name: "missing validation binding", expected: "unresolved", mutate: (record) => { record.currentness.validationObligationDigest = digest("other-validation"); } },
    { name: "missing test binding", expected: "unresolved", mutate: (record) => { record.currentness.testObligationDigest = digest("other-test"); } },
    { name: "layer isolation violation", expected: "defer", mutate: (record) => { record.layer.isolationStatus = "violated"; } },
    { name: "self-authored layer decision", expected: "defer", mutate: (record) => { record.layer.decisionDigest = digest("invented-layer-decision"); } },
    { name: "unsafe unattended lifecycle", expected: "defer", mutate: (record) => { record.lifecycle = { applicability: "applicable", rationale: "Daemon lifecycle.", commands: { start: true, status: true, stop: true }, retryBound: 0, drainMilliseconds: 1, restartBound: 1, noPartialAuthorityMutation: true }; } },
    { name: "target mismatch", expected: "unresolved", mutate: (record) => { record.connectivity.targetIri = "urn:usf:core:other"; } },
  ];
  for (const item of cases) {
    const changed = mutateReadiness(baseline, item.mutate);
    const report = compileSemanticRecovery(baseline.inventory, changed.config, changed.authority);
    assert.equal(report.candidates.find((candidate) => candidate.candidateId === baseline.readyCandidateId)?.disposition, item.expected, item.name);
  }

  const unapproved = mutateReadiness(baseline, (record) => { record.reviewDigest = digest("unapproved-review"); });
  assert.throws(() => compileSemanticRecovery(baseline.inventory, unapproved.config, unapproved.authority), (error) => reason(error) === "RECOVERY_READINESS_REVIEW_UNAUTHORIZED");

  const copiedAuthority = { ...baseline.authority } as RecoveryAuthorityContext;
  const clonedAuthority = structuredClone(baseline.authority) as RecoveryAuthorityContext;
  for (const unauthentic of [copiedAuthority, clonedAuthority]) assert.throws(() => compileSemanticRecovery(baseline.inventory, baseline.config, unauthentic), (error) => reason(error) === "RECOVERY_AUTHORITY_UNAUTHENTIC", "serialized or copied graph authority is not reusable");
});
