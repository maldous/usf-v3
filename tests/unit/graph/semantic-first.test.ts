import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { resolve } from "node:path";
import { canonicalDigest } from "../../../src/core/canonical.ts";
import { runWork } from "../../../src/commands/work.ts";
import { workCommand } from "../../../src/commands/work.ts";
import { findHelpTopic } from "../../../src/commands/help.ts";
import { loadSemanticGraph, type SemanticGraph } from "../../../src/graph/index.ts";
import type { Quad } from "../../../src/graph/nquads.ts";
import { deriveCurrentRealisationBasis, deriveWork, type WorkPacket } from "../../../src/graph/work.ts";
import { assertBasisMatchesPacket } from "../../../src/realisation/basis.ts";
import { applyTransitionOperations, reverseTransitionOperations, verifyTransitionActivationCurrentness } from "../../../src/realisation/transition.ts";

const root = resolve(import.meta.dirname, "../../..");
const manifest = "graph/manifests/self-host.json";
const profile = "urn:usf:profile:v3-self-host:1";
const gateWork = "urn:usf:work:semantic-first-eligibility";
const basisWork = "urn:usf:work:realisation-basis-chain";
const lifecycleWork = "urn:usf:work:semantic-first-lifecycle-admission";
const ordinaryWork = "urn:usf:work:repository-path-scope";
const fileAssetWork = "urn:usf:work:file-asset-index";
const gateContract = "urn:usf:contract:semantic-first-order:1";
const gatePermission = "urn:usf:permission:semantic-first-order";
const gateException = "urn:usf:exception:semantic-first-bootstrap:1";
const admissionWorkSet = "urn:usf:admission-work-set:semantic-first-bootstrap:1";
const ordinaryPermission = "urn:usf:permission:repository-path-scope";
const ordinaryEvidenceRequirement = "urn:usf:evidence-requirement:repository-path-scope";
const ordinaryProofObligation = "urn:usf:proof:repository-path-scope:construction-authority";
const ordinaryCompletionRequirement = "urn:usf:evidence-requirement:repository-path-scope:completion";
const ordinaryCompletionObligation = "urn:usf:proof:repository-path-scope";
const ordinaryCompletionValidation = "urn:usf:validation:repository-path-tests";
const completionAlgorithm = "urn:usf:proof-algorithm:semantic-work-completion:1";
const completionTransitionVerifier = "urn:usf:algorithm:work-integration-transition:1";
const integrationReceipt = "urn:test:integration-receipt:repository-path";
const completionEvidence = "urn:test:evidence:repository-path:completion";
const completionProof = "urn:test:proof-result:repository-path:completion";
const algorithm = "urn:usf:proof-algorithm:semantic-construction-authority:1";
const evidence = "urn:test:evidence:repository-path";
const proof = "urn:test:proof-result:repository-path";
const graphName = "urn:usf:graph:semantic-first";
const gateCurrentness = "urn:usf:currentness:semantic-first-bootstrap-transition:1";
const sourcePath = "graph/semantic-first.nq";
const p = (name: string) => `urn:usf:predicate:${name}`;
const digest = (hex: string) => `sha256:${hex.repeat(64)}`;
let repositoryRoot = root;
let sourceState: "pre" | "post" = "pre";
let temporaryRepository: string | undefined;

before(async () => {
  const currentGraph = loadSemanticGraph(root, manifest);
  const states = currentGraph.quads
    .filter((quad) => quad.subject === gatePermission && quad.predicate === p("activationState") && quad.objectKind === "iri")
    .map((quad) => quad.object);
  assert.equal(states.length, 1, "the canonical gate permission state is exact");
  if (states[0] === "urn:usf:contract-state:proofblocked") return;
  assert.equal(states[0], "urn:usf:contract-state:active", "the suite accepts only the exact pre or verified post gate state");
  const verified = verifyTransitionActivationCurrentness(currentGraph, gateCurrentness, gatePermission, profile);
  const currentSource = await readFile(resolve(root, sourcePath), "utf8");
  const sourceBefore = reverseTransitionOperations(currentSource, verified.receipt.operations);
  assert.equal(applyTransitionOperations(sourceBefore, verified.receipt.operations), currentSource, "the verified receipt exactly reconstructs the canonical post-state");
  await mkdir(resolve(root, ".usf/tmp"), { recursive: true, mode: 0o700 });
  const temporaryParent = await mkdtemp(resolve(root, ".usf/tmp/semantic-first-pre-"));
  temporaryRepository = resolve(temporaryParent, "repository");
  await mkdir(temporaryRepository, { mode: 0o700 });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "evidence" || entry.name.startsWith(".usf")) continue;
    await cp(resolve(root, entry.name), resolve(temporaryRepository, entry.name), { recursive: true });
  }
  await writeFile(resolve(temporaryRepository, sourcePath), sourceBefore, "utf8");
  repositoryRoot = temporaryRepository;
  sourceState = "post";
});

after(async () => {
  if (temporaryRepository !== undefined) await rm(resolve(temporaryRepository, ".."), { recursive: true, force: true });
});

function graph(transform: (quads: Quad[]) => Quad[] = (quads) => quads): SemanticGraph {
  const loaded = loadSemanticGraph(repositoryRoot, manifest);
  return { ...loaded, quads: transform([...loaded.quads]) };
}

function add(subject: string, name: string, object: string, objectKind: "iri" | "literal" = "iri"): Quad {
  return { subject, predicate: p(name), object, objectKind, graph: graphName, canonical: `${subject}|${name}|${objectKind}|${object}` };
}

function replace(quads: Quad[], subject: string, name: string, object: string): Quad[] {
  return quads.map((quad) => quad.subject === subject && quad.predicate === p(name) ? { ...quad, object, canonical: `${quad.canonical}|replacement:${object}` } : quad);
}

function remove(quads: Quad[], subject: string, name: string): Quad[] {
  return quads.filter((quad) => !(quad.subject === subject && quad.predicate === p(name)));
}

function packet(value: SemanticGraph, id = gateWork): WorkPacket {
  const result = deriveWork(value, { profile, selector: id });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.length, 1);
  const item = result.items?.[0];
  assert.ok(item?.semanticTrace);
  assert.ok(item.realisationAuthority);
  assert.ok(item.eligibility);
  return item;
}

function activeOrdinaryGraph(gateActive = true): SemanticGraph {
  const active = graph((quads) => [
    ...(gateActive
      ? remove(
          replace(replace(quads, ordinaryPermission, "activationState", "urn:usf:contract-state:active"), gatePermission, "activationState", "urn:usf:contract-state:active"),
          gatePermission,
          "activationCurrentness",
        )
      : replace(quads, ordinaryPermission, "activationState", "urn:usf:contract-state:active")),
    add("urn:test:proof-result:semantic-gate", "type", "urn:usf:type:ProofResult"),
    add("urn:test:proof-result:semantic-gate", "forObligation", "urn:usf:proof:semantic-first-order:construction-authority"),
    add("urn:test:proof-result:semantic-gate", "outcome", "pass", "literal"),
  ]);
  const basis = packet(active, ordinaryWork).eligibility?.authorityBasisDigest as string;
  const evidenceContent = digest("c");
  const basisDigest = digest("b");
  return {
    ...active,
    quads: [
      ...active.quads,
      add(evidence, "type", "urn:usf:type:Evidence"),
      add(evidence, "forWork", ordinaryWork),
      add(evidence, "satisfiesEvidenceRequirement", ordinaryEvidenceRequirement),
      add(evidence, "validationResultDigest", digest("a"), "literal"),
      add(evidence, "realisationBasisDigest", basisDigest, "literal"),
      add(evidence, "scopedDependencyDigest", basis, "literal"),
      add(evidence, "contentDigest", evidenceContent, "literal"),
      add(proof, "type", "urn:usf:type:ProofResult"),
      add(proof, "forWork", ordinaryWork),
      add(proof, "forObligation", ordinaryProofObligation),
      add(proof, "algorithm", algorithm),
      add(proof, "evidenceDigest", evidenceContent, "literal"),
      add(proof, "realisationBasisDigest", basisDigest, "literal"),
      add(proof, "scopedDependencyDigest", basis, "literal"),
      add(proof, "outcome", "pass", "literal"),
    ],
  };
}

function withOrdinaryCompletion(
  source: SemanticGraph,
  options: { receipt?: boolean; duplicate?: boolean; stale?: boolean; sibling?: boolean } = {},
): SemanticGraph {
  const current = packet(source, ordinaryWork);
  const basis = current.realisationBasis;
  assert.ok(basis);
  const receiptWork = options.sibling === true ? gateWork : ordinaryWork;
  const receiptBasis = options.stale === true ? digest("d") : basis.basisDigest;
  const candidateDigest = digest("4");
  const integratedTreeDigest = digest("5");
  const lineageDigest = digest("6");
  const integrationDigest = canonicalDigest({
    schema: "urn:usf:schema:admitted-integration-receipt:1",
    work: receiptWork,
    state: "accepted",
    basisDigest: receiptBasis,
    scopedDependencyDigest: basis.work.scopedDependencyDigest,
    candidateDigest,
    integratedTreeDigest,
    lineageDigest,
  });
  const receiptQuads = (id: string): Quad[] => [
    add(id, "type", "urn:usf:type:AdmittedIntegrationReceipt"),
    add(id, "schema", "urn:usf:schema:admitted-integration-receipt:1"),
    add(id, "forWork", receiptWork),
    add(id, "state", "accepted", "literal"),
    add(id, "realisationBasisDigest", receiptBasis, "literal"),
    add(id, "scopedDependencyDigest", basis.work.scopedDependencyDigest, "literal"),
    add(id, "candidateDigest", candidateDigest, "literal"),
    add(id, "integratedTreeDigest", integratedTreeDigest, "literal"),
    add(id, "lineageDigest", lineageDigest, "literal"),
    add(id, "integrationDigest", integrationDigest, "literal"),
  ];
  const evidenceContent = digest("7");
  return {
    ...source,
    quads: [
      ...source.quads,
      ...(options.receipt === false ? [] : receiptQuads(integrationReceipt)),
      ...(options.duplicate === true ? receiptQuads(`${integrationReceipt}:duplicate`) : []),
      add(completionEvidence, "type", "urn:usf:type:Evidence"),
      add(completionEvidence, "forWork", ordinaryWork),
      add(completionEvidence, "satisfiesEvidenceRequirement", ordinaryCompletionRequirement),
      add(completionEvidence, "validationObligation", ordinaryCompletionValidation),
      add(completionEvidence, "integrationReceipt", integrationReceipt),
      add(completionEvidence, "integrationDigest", integrationDigest, "literal"),
      add(completionEvidence, "validationResultDigest", digest("8"), "literal"),
      add(completionEvidence, "realisationBasisDigest", basis.basisDigest, "literal"),
      add(completionEvidence, "scopedDependencyDigest", basis.work.scopedDependencyDigest, "literal"),
      add(completionEvidence, "contentDigest", evidenceContent, "literal"),
      add(completionProof, "type", "urn:usf:type:ProofResult"),
      add(completionProof, "forWork", ordinaryWork),
      add(completionProof, "forObligation", ordinaryCompletionObligation),
      add(completionProof, "algorithm", completionAlgorithm),
      add(completionProof, "integrationReceipt", integrationReceipt),
      add(completionProof, "integrationDigest", integrationDigest, "literal"),
      add(completionProof, "evidenceDigest", evidenceContent, "literal"),
      add(completionProof, "realisationBasisDigest", basis.basisDigest, "literal"),
      add(completionProof, "scopedDependencyDigest", basis.work.scopedDependencyDigest, "literal"),
      add(completionProof, "outcome", "pass", "literal"),
    ],
  };
}

test("semantic-first work eligibility is exact, fail-closed and non-serializing", () => {
  const actualGate = packet(loadSemanticGraph(root, manifest));
  assert.deepEqual(actualGate.eligibility?.construction, sourceState === "post"
    ? { eligible: true, authority: "active-permission", maximumThrough: "integrate", reasonCodes: [] }
    : { eligible: true, authority: "bootstrap-exception", maximumThrough: "check", reasonCodes: [] });
  assert.equal(actualGate.realisationStage?.stage, "construction-ready");
  const canonical = graph();
  const direct = deriveWork(canonical, { selector: profile });
  const compatible = deriveWork(canonical, { selector: `profile:${profile}` });
  assert.equal(direct.status, "ok");
  assert.deepEqual(direct.items, compatible.items);
  assert.deepEqual(direct.items?.[0]?.decisionBoundary, {
    kind: "realisation-profile",
    root: profile,
    profileVersion: "1",
    product: "urn:usf:product:v3",
    foundation: "urn:usf:foundation:v3",
  });
  for (const [selector, reasonCode] of [
    ["profile:not-a-urn", "REALISATION_PROFILE_SELECTOR_MALFORMED"],
    ["profile:urn:test:profile:unknown:1", "REALISATION_PROFILE_UNKNOWN"],
  ] as const) assert.equal(deriveWork(canonical, { selector }).reasonCode, reasonCode, selector);
  assert.deepEqual(JSON.parse(runWork(repositoryRoot, { selector: profile, maxItems: 100 }, manifest)), JSON.parse(runWork(repositoryRoot, { selector: `profile:${profile}`, maxItems: 100 }, manifest)));
  assert.equal(deriveWork(canonical, { ready: true }).reasonCode, "REALISATION_PROFILE_REQUIRED");
  assert.deepEqual(deriveWork(canonical, { profile, selector: gateWork }).items?.map((item) => item.id), [gateWork]);
  assert.equal(deriveWork(canonical, { profile, selector: "urn:usf:profile:v3-semantic-first:1" }).reasonCode, "REALISATION_PROFILE_SELECTOR_CONFLICT");
  assert.equal(deriveWork(canonical, { profile: "urn:usf:profile:v3-semantic-first:1", selector: ordinaryWork }).reasonCode, "REALISATION_PROFILE_SCOPE_MISMATCH");
  const directInspection = deriveWork(canonical, { selector: gateWork }).items?.[0];
  assert.equal(directInspection?.eligibility?.construction.eligible, false);
  assert.equal(directInspection?.eligibility?.construction.reasonCodes.includes("REALISATION_PROFILE_REQUIRED"), true);
  const invalidCallerOption = workCommand({ command: "work", args: ["--accepted", gateWork], repositoryRoot }) as { output: { reasonCode?: string } };
  assert.equal(invalidCallerOption.output.reasonCode, "WORK_ARGUMENTS_INVALID");

  const profileDefects = [
    { name: "missing profile version", mutate: (quads: Quad[]) => remove(quads, profile, "version"), reasonCode: "REALISATION_PROFILE_VERSION_INVALID" },
    { name: "mismatched profile version", mutate: (quads: Quad[]) => replace(quads, profile, "version", "2"), reasonCode: "REALISATION_PROFILE_VERSION_MISMATCH" },
    { name: "untyped product", mutate: (quads: Quad[]) => remove(quads, "urn:usf:product:v3", "type"), reasonCode: "REALISATION_PROFILE_PRODUCT_TYPE_INVALID" },
    { name: "literal product type", mutate: (quads: Quad[]) => quads.map((quad) => quad.subject === "urn:usf:product:v3" && quad.predicate === p("type") ? { ...quad, objectKind: "literal" as const, canonical: `${quad.canonical}|literal-type` } : quad), reasonCode: "REALISATION_PROFILE_PRODUCT_TYPE_INVALID" },
    { name: "untyped foundation", mutate: (quads: Quad[]) => remove(quads, "urn:usf:foundation:v3", "type"), reasonCode: "REALISATION_PROFILE_FOUNDATION_TYPE_INVALID" },
    { name: "cross-foundation product", mutate: (quads: Quad[]) => [...replace(quads, "urn:usf:product:v3", "buildsUpon", "urn:usf:foundation:other"), add("urn:usf:foundation:other", "type", "urn:usf:type:SemanticFoundation")], reasonCode: `REALISATION_PROFILE_CONTRACT_FOUNDATION_MISMATCH:${profile}:urn:usf:contract:file-asset-index:1` },
  ];
  for (const defect of profileDefects) assert.equal(deriveWork(graph(defect.mutate), { profile }).reasonCode, defect.reasonCode, defect.name);

  const gate = packet(canonical);
  assert.ok(gate.realisationBasis);
  assertBasisMatchesPacket(gate.realisationBasis, gate);
  assert.deepEqual(gate.semanticTrace?.stages, [
    { id: "urn:usf:stage:semantic-model", order: 1 },
    { id: "urn:usf:stage:remodel-currentness", order: 2 },
    { id: "urn:usf:stage:evidence", order: 3 },
    { id: "urn:usf:stage:proof", order: 4 },
    { id: "urn:usf:stage:activated-contract", order: 5 },
    { id: "urn:usf:stage:realisation", order: 6 },
    { id: "urn:usf:stage:validation", order: 7 },
  ]);
  assert.equal(gate.semanticTrace?.complete, true);
  assert.deepEqual(gate.stopConditions, gate.semanticTrace?.stopConditions);
  assert.equal(gate.stopConditions.length, 3);
  assert.notEqual(gate.realisationAuthority?.constructionEvidenceRequirement, gate.realisationAuthority?.completionEvidenceRequirement);
  assert.notEqual(gate.realisationAuthority?.constructionProofObligation, gate.realisationAuthority?.completionProofObligation);
  assert.deepEqual(gate.eligibility?.construction, { eligible: true, authority: "bootstrap-exception", maximumThrough: "check", reasonCodes: [] });
  assert.equal(gate.realisationStage?.stage, "construction-ready");
  assert.equal(gate.realisationStage?.completion.verified, false, "bootstrap authority is never completion");
  assert.equal(gate.eligibility?.dependencyAuthority, "bootstrap-atomic-admission");
  assert.equal(gate.eligibility?.activation.eligible, false);

  const ready = deriveWork(canonical, { selector: profile, ready: true, maxItems: 100 });
  assert.deepEqual(ready.items?.map((item) => item.id), [
    gateWork,
    basisWork,
    lifecycleWork,
  ]);
  assert.equal(ready.items?.every((item) => item.eligibility?.dependencyReady === true), true);
  assert.equal(ready.items?.every((item) => item.eligibility?.dependencyAuthority === "bootstrap-atomic-admission"), true);
  assert.deepEqual(deriveWork(canonical, { selector: profile, ready: true, stage: "integrate", maxItems: 100 }).items, []);
  const decompositionCases = [
    { name: "ready selector expands the required predecessor prefix", options: { profile, selector: lifecycleWork, ready: true, maxItems: 100 }, status: "ok", ids: [gateWork, basisWork, lifecycleWork] },
    { name: "ready bootstrap set refuses multi-shard splitting", options: { profile, ready: true, shard: "2/2", maxItems: 100 }, status: "refused", reasonCode: "BOOTSTRAP_ATOMIC_ADMISSION_SHARD_REFUSED" },
  ] as const;
  for (const scenario of decompositionCases) {
    const result = deriveWork(canonical, scenario.options);
    assert.equal(result.status, scenario.status, scenario.name);
    if ("ids" in scenario) assert.deepEqual(result.items?.map((item) => item.id), scenario.ids, scenario.name);
    if ("reasonCode" in scenario) assert.equal(result.reasonCode, scenario.reasonCode, scenario.name);
  }
  const ordinary = packet(canonical, ordinaryWork);
  assert.equal(ordinary.eligibility?.dependencyReady, true);
  assert.equal(ordinary.eligibility?.construction.eligible, false);
  assert.equal(ordinary.eligibility?.construction.reasonCodes.some((reason) => reason.startsWith("REALISATION_PERMISSION_NOT_ACTIVE:")), true);

  const help = findHelpTopic(["work"]);
  assert.ok(help);
  assert.equal(help.synopsis[0]?.includes("--profile PROFILE_IRI"), true);
  assert.equal(help.options.find((option) => option.syntax === "--ready")?.description.includes("caller labels never establish readiness"), true);
  assert.equal(help.options.find((option) => option.syntax === "--stage construct|integrate")?.description.includes("Completed work is excluded"), true);
  assert.equal((workCommand({ command: "work", args: ["--stage", "construct"], repositoryRoot }) as { output: { reasonCode?: string } }).output.reasonCode, "WORK_STAGE_REQUIRES_READY");
  assert.equal((workCommand({ command: "work", args: ["--ready", "--stage", "unknown"], repositoryRoot }) as { output: { reasonCode?: string } }).output.reasonCode, "WORK_ARGUMENTS_INVALID");

  const topologyAndAuthorityDefects: Array<{ name: string; mutate: (quads: Quad[]) => Quad[]; reason: string }> = [
    { name: "missing stage order", mutate: (quads) => remove(quads, "urn:usf:stage:evidence", "order"), reason: "SEMANTIC_ORDER_STAGE_ORDER_MISSING:" },
    { name: "duplicated stage order", mutate: (quads) => [...quads, add("urn:usf:stage:evidence", "order", "30", "literal")], reason: "SEMANTIC_ORDER_STAGE_ORDER_AMBIGUOUS:" },
    { name: "unknown stage", mutate: (quads) => remove(quads, "urn:usf:stage:proof", "type"), reason: "SEMANTIC_ORDER_STAGE_TYPE_INVALID:" },
    { name: "skipped stage", mutate: (quads) => replace(quads, "urn:usf:stage:remodel-currentness", "precedes", "urn:usf:stage:proof"), reason: "SEMANTIC_ORDER_STAGE_SEQUENCE_INVALID:" },
    { name: "missing evidence obligation", mutate: (quads) => remove(quads, gateContract, "constructionEvidenceRequirement"), reason: "CONSTRUCTION_EVIDENCE_REQUIREMENT_MISSING:" },
    { name: "ambiguous proof obligation", mutate: (quads) => [...quads, add(gateContract, "constructionProofObligation", "urn:usf:proof:semantic-first-order")], reason: "CONSTRUCTION_PROOF_OBLIGATION_AMBIGUOUS:" },
    { name: "unresolved applicability", mutate: (quads) => replace(quads, "urn:usf:evidence-requirement:semantic-first-order", "applicability", "unresolved"), reason: "CONSTRUCTION_EVIDENCE_APPLICABILITY_NOT_REQUIRED:" },
    { name: "invalid exception ceiling", mutate: (quads) => replace(quads, gateException, "maximumThrough", "integrate"), reason: "BOOTSTRAP_EXCEPTION_CEILING_INVALID:" },
    { name: "substituted canonical bootstrap set", mutate: (quads) => quads.map((quad) => ((quad.subject === gateException && quad.predicate === p("forWork")) || (quad.subject === admissionWorkSet && quad.predicate === p("member"))) && quad.object === "urn:usf:work:realisation-basis-chain" ? { ...quad, object: ordinaryWork, canonical: `${quad.canonical}|substituted-work` } : quad), reason: "BOOTSTRAP_EXCEPTION_CANONICAL_WORK_SET_INVALID:" },
    { name: "non-atomic bootstrap policy", mutate: (quads) => replace(quads, admissionWorkSet, "dependencyPolicy", "caller-accepted"), reason: "BOOTSTRAP_EXCEPTION_ADMISSION_DEPENDENCY_POLICY_INVALID:" },
    { name: "self-declared active", mutate: (quads) => replace(quads, gatePermission, "activationState", "urn:usf:contract-state:active"), reason: "CONSTRUCTION_PROOF_RESULT_MISSING:" },
  ];
  for (const defect of topologyAndAuthorityDefects) {
    const planted = packet(graph(defect.mutate));
    assert.equal(planted.eligibility?.construction.eligible, false, defect.name);
    const reasons = [...(planted.eligibility?.construction.reasonCodes ?? []), ...(planted.eligibility?.activation.reasonCodes ?? [])];
    assert.equal(reasons.some((reason) => reason.startsWith(defect.reason)), true, `${defect.name}: ${reasons.join(",")}`);
  }

  const active = activeOrdinaryGraph();
  const admitted = packet(active, ordinaryWork);
  assert.ok(admitted.realisationBasis);
  assertBasisMatchesPacket(admitted.realisationBasis, admitted);
  assert.equal(admitted.eligibility?.activation.eligible, true, admitted.eligibility?.activation.reasonCodes.join(","));
  assert.deepEqual(admitted.eligibility?.construction, { eligible: true, authority: "active-permission", maximumThrough: "integrate", reasonCodes: [] });
  assert.equal(admitted.semanticDependencies.some((dependency) => dependency.key === evidence), true);
  assert.equal(admitted.semanticDependencies.some((dependency) => dependency.key === proof), true);

  const gateBlockedOrdinary = packet(activeOrdinaryGraph(false), ordinaryWork);
  assert.equal(gateBlockedOrdinary.eligibility?.construction.eligible, false, "ordinary active permission cannot bypass the proofblocked governing gate");
  assert.equal(gateBlockedOrdinary.eligibility?.activation.reasonCodes.includes(`REQUIRED_PERMISSION_NOT_ACTIVE:${gatePermission}`), true);

  const evidenceProofOnly = packet(withOrdinaryCompletion(active, { receipt: false }), ordinaryWork);
  assert.equal(evidenceProofOnly.realisationStage?.completion.verified, false, "evidence and proof without integration cannot complete work");
  assert.equal(evidenceProofOnly.realisationStage?.completion.reasonCodes.includes(`COMPLETION_INTEGRATION_RECEIPT_MISSING:${ordinaryWork}`), true);
  for (const planted of [
    { name: "stale integration receipt", graph: withOrdinaryCompletion(active, { stale: true }), reason: "COMPLETION_INTEGRATION_BASIS_STALE:" },
    { name: "sibling integration receipt", graph: withOrdinaryCompletion(active, { sibling: true }), reason: `COMPLETION_INTEGRATION_RECEIPT_MISSING:${ordinaryWork}` },
    { name: "ambiguous integration receipt", graph: withOrdinaryCompletion(active, { duplicate: true }), reason: `COMPLETION_INTEGRATION_RECEIPT_AMBIGUOUS:${ordinaryWork}` },
  ]) {
    const result = packet(planted.graph, ordinaryWork);
    assert.equal(result.realisationStage?.completion.verified, false, planted.name);
    assert.equal(result.realisationStage?.completion.reasonCodes.some((reason) => reason.startsWith(planted.reason)), true, `${planted.name}: ${result.realisationStage?.completion.reasonCodes.join(",")}`);
  }
  const fabricatedCompletion = withOrdinaryCompletion(active);
  const fabricatedPacket = packet(fabricatedCompletion, ordinaryWork);
  assert.equal(fabricatedPacket.realisationStage?.stage, "construction-ready", "caller-authored same-basis digests cannot establish a postimage completion");
  assert.equal(fabricatedPacket.realisationStage?.completion.integrationReceipt, integrationReceipt);
  assert.equal(fabricatedPacket.realisationStage?.completion.verified, false);
  assert.equal(
    fabricatedPacket.realisationStage?.completion.reasonCodes.includes(`COMPLETION_POSTIMAGE_VERIFIER_PROOFBLOCKED:${completionTransitionVerifier}`),
    true,
  );
  assert.deepEqual(deriveWork(fabricatedCompletion, { profile, selector: ordinaryWork, ready: true, stage: "construct" }).items?.map((item) => item.id), [ordinaryWork]);
  assert.deepEqual(deriveWork(fabricatedCompletion, { profile, selector: ordinaryWork, ready: true, stage: "integrate" }).items, []);
  const stillLocked = packet(fabricatedCompletion, fileAssetWork);
  assert.equal(stillLocked.eligibility?.dependencyReady, false);
  assert.equal(stillLocked.eligibility?.dependencyAuthority, "none");

  const unresolvedPredecessor = packet({ ...active, quads: [...active.quads, add(ordinaryWork, "dependsOn", gateWork)] }, ordinaryWork);
  assert.equal(unresolvedPredecessor.eligibility?.dependencyReady, false, "active construction permission is not predecessor completion");
  assert.equal(unresolvedPredecessor.eligibility?.dependencyAuthority, "none");
  assert.equal(unresolvedPredecessor.eligibility?.construction.reasonCodes.includes(`WORK_DEPENDENCY_NOT_READY:${ordinaryWork}`), true);

  const activeDefects: Array<{ name: string; mutate: (quads: Quad[]) => Quad[]; reason: string }> = [
    { name: "missing admitted evidence", mutate: (quads) => quads.filter((quad) => quad.subject !== evidence), reason: "CONSTRUCTION_EVIDENCE_MISSING:" },
    { name: "failed proof", mutate: (quads) => replace(quads, proof, "outcome", "fail"), reason: "CONSTRUCTION_PROOF_RESULT_FAILED:" },
    { name: "ambiguous proof", mutate: (quads) => [...quads, ...quads.filter((quad) => quad.subject === proof).map((quad) => ({ ...quad, subject: `${proof}:other`, canonical: `${quad.canonical}|other` }))], reason: "CONSTRUCTION_PROOF_RESULT_AMBIGUOUS:" },
    { name: "stale evidence basis", mutate: (quads) => replace(quads, evidence, "scopedDependencyDigest", digest("d")), reason: "CONSTRUCTION_EVIDENCE_MISSING:" },
    { name: "stale proof basis", mutate: (quads) => replace(quads, proof, "scopedDependencyDigest", digest("d")), reason: "CONSTRUCTION_PROOF_RESULT_MISSING:" },
    { name: "relevant semantic movement", mutate: (quads) => replace(quads, ordinaryEvidenceRequirement, "text", "Moved relevant construction evidence semantics."), reason: "CONSTRUCTION_EVIDENCE_MISSING:" },
  ];
  for (const defect of activeDefects) {
    const planted = packet({ ...active, quads: defect.mutate([...active.quads]) }, ordinaryWork);
    assert.equal(planted.eligibility?.construction.eligible, false, defect.name);
    assert.equal(planted.eligibility?.activation.reasonCodes.some((reason) => reason.startsWith(defect.reason)), true, `${defect.name}: ${planted.eligibility?.activation.reasonCodes.join(",")}`);
  }

  const staleSiblingGraph = graph((quads) => [
    ...quads,
    add("urn:test:evidence:unrelated-malformed", "type", "urn:usf:type:Evidence"),
    add("urn:test:evidence:unrelated-malformed", "forWork", ordinaryWork),
    add("urn:test:evidence:unrelated-malformed", "satisfiesEvidenceRequirement", ordinaryEvidenceRequirement),
    add("urn:test:evidence:unrelated-malformed", "scopedDependencyDigest", "not-a-digest", "literal"),
  ]);
  assert.deepEqual(deriveWork(staleSiblingGraph, { selector: profile, ready: true, maxItems: 100 }).items?.map((item) => item.id), [
    gateWork,
    basisWork,
    lifecycleWork,
  ], "one stale ordinary sibling does not serialize the atomic gate set");

  const unrelated = packet({ ...active, quads: [...active.quads, add("urn:test:unrelated", "text", "Unrelated movement.", "literal")] }, ordinaryWork);
  assert.equal(unrelated.eligibility?.construction.eligible, true);
  assert.equal(unrelated.eligibility?.authorityBasisDigest, admitted.eligibility?.authorityBasisDigest);
});

test("the immutable packet core and persisted construction basis rederive exactly", async () => {
  const current = packet(graph(), gateWork);
  assert.ok(current.realisationBasis);
  assertBasisMatchesPacket(current.realisationBasis, current);
  const rederived = await deriveCurrentRealisationBasis(repositoryRoot, current.realisationBasis);
  assert.equal(rederived.basisDigest, current.realisationBasis.basisDigest);
});

test("a retired work projects as retired, never as blocked", () => {
  // Blocked means "cannot proceed yet"; retired means "will not proceed, and
  // that is the decision". Reporting the second as the first reads as a
  // backlog, which is the exact misreading the capture-remainder assessment
  // existed to remove -- and it reappeared here the moment four works were
  // retired without the deriver being taught the predicate.
  const graph = loadSemanticGraph(repositoryRoot, "graph/manifests/self-host-semantic-recovery.json");
  const result = deriveWork(graph, { selector: "profile:urn:usf:profile:v3-semantic-recovery:1", maxItems: 20 });
  assert.equal(result.status, "ok");
  const byId = new Map((result.items ?? []).map((packet) => [packet.id, packet]));

  // The four retired works carry a retirementDisposition and none may read blocked.
  for (const name of ["semantic-graph-exchange", "semantic-recovery-inventory",
    "semantic-factory-qualification", "semantic-recovery-acceptance"]) {
    const packet = byId.get(`urn:usf:work:${name}`);
    assert.ok(packet, `${name} must still be derived: retirement is a disposition, not a deletion`);
    assert.equal(packet!.realisationStage?.stage, "retired", name);
    assert.equal(packet!.realisationStage?.actionable, false, `${name} must not be actionable`);
  }

  // The two whose declared outputs all landed are blocked on completion
  // currentness, not retired. Retirement must not swallow them.
  for (const name of ["semantic-manifest-store", "semantic-recovery-tooling"]) {
    assert.equal(byId.get(`urn:usf:work:${name}`)?.realisationStage?.stage, "blocked", name);
  }

  // And the lane derives at all. Before the phantom readPaths were dropped it
  // refused outright with WORK_DEPENDENCY_MISSING, so no state was visible.
  assert.ok((result.items ?? []).length >= 9);
});
