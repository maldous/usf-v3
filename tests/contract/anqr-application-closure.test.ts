import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The application denominator, made load-bearing.
 *
 * Declaring fifty-eight capabilities, sixty actions, an environment ladder and
 * a delivery requirement set proves nothing on its own: a denominator that
 * nothing checks drifts silently, and its first drift is invisible precisely
 * because it is a denominator. These are the checks that make the declarations
 * refuse to be wrong, each followed by a planted violation proving the check
 * would catch it.
 *
 * Every assertion reads the graph sources directly. Nothing here consults a
 * derived projection, because a projection agreeing with itself is not
 * evidence about authority.
 */

const SOURCES = [
  "graph/products/anqr/application-actions.nq",
  "graph/products/anqr/profile-revision-3.nq",
  "graph/products/anqr/capabilities-revision-3.nq",
  "graph/products/anqr/delivery-posture.nq",
  "graph/products/anqr/environment-bindings.nq",
  "graph/delivery-environment.nq",
  "graph/delivery-contracts.nq",
  "graph/realisation-basis.nq",
] as const;

interface Quad { readonly s: string; readonly p: string; readonly o: string; readonly literal: boolean }

function parse(text: string): readonly Quad[] {
  const quads: Quad[] = [];
  for (const line of text.split("\n")) {
    // <s> <p> <o|"literal"> <graph> .
    const match = /^<([^>]+)> <([^>]+)> (?:<([^>]+)>|"((?:[^"\\]|\\.)*)") <[^>]+> \.$/u.exec(line);
    if (match === null) continue;
    quads.push({
      s: match[1]!, p: match[2]!,
      o: match[3] ?? (match[4] ?? "").replace(/\\"/gu, '"').replace(/\\\\/gu, "\\"),
      literal: match[3] === undefined,
    });
  }
  return quads;
}

function load(extra: ReadonlyMap<string, string> = new Map()): readonly Quad[] {
  const all: Quad[] = [];
  for (const path of SOURCES) {
    const text = extra.get(path) ?? readFileSync(resolve(repositoryRoot, path), "utf8");
    all.push(...parse(text));
  }
  return all;
}

const local = (iri: string): string => iri.slice(iri.lastIndexOf(":") + 1);
const objects = (q: readonly Quad[], p: string, s?: string): readonly string[] =>
  q.filter((x) => x.p.endsWith(`:${p}`) && (s === undefined || x.s === s)).map((x) => x.o);
const subjectsOfType = (q: readonly Quad[], type: string): readonly string[] =>
  q.filter((x) => x.p === "urn:usf:predicate:type" && x.o === `urn:usf:type:${type}`).map((x) => x.s);

const BASE = load();

// -------------------------------------------------------- denominator closure

test("every declared capability owns an action or is declared cross-cutting", () => {
  const declared = new Set(objects(BASE, "declaresCapability", "urn:anqr:profile-revision:3").map(local));
  assert.equal(declared.size, 58, "the revision-3 denominator");
  const owning = new Set(objects(BASE, "owningCapability").map(local));
  const cross = new Set(BASE.filter((x) => x.p.endsWith(":capabilityRealisationMode") && x.o === "cross-cutting").map((x) => local(x.s)));
  const orphans = [...declared].filter((c) => !owning.has(c) && !cross.has(c));
  assert.deepEqual(orphans, [], "a capability with no action and no cross-cutting declaration is indistinguishable from an oversight");
  assert.equal(cross.size, 2, "accessibility and parity are properties of actions, not actions");
});

test("every action names a capability the revision declares", () => {
  const declared = new Set(objects(BASE, "declaresCapability", "urn:anqr:profile-revision:3"));
  const actions = new Set(subjectsOfType(BASE, "ApplicationAction"));
  assert.equal(actions.size, 60);
  for (const action of actions) {
    const owns = objects(BASE, "owningCapability", action);
    assert.ok(owns.length > 0, `${local(action)} owns no capability`);
    for (const c of owns) assert.ok(declared.has(c), `${local(action)} names undeclared ${local(c)}`);
  }
});

test("every action carries the full attribute set, not a convenient subset", () => {
  const REQUIRED = ["actionActor", "actionTrigger", "actionPrecondition", "actionInput", "owningCapability",
    "actionStateTransition", "actionSideEffect", "actionOutput", "actionFailure", "actionRecovery",
    "experienceExposure", "foundationDependency", "actionDisposition", "evidenceMechanism"] as const;
  for (const action of subjectsOfType(BASE, "ApplicationAction")) {
    for (const attribute of REQUIRED) {
      assert.ok(objects(BASE, attribute, action).length > 0, `${local(action)} is missing ${attribute}`);
    }
  }
});

test("no action is left without a disposition", () => {
  for (const action of subjectsOfType(BASE, "ApplicationAction")) {
    const d = objects(BASE, "actionDisposition", action);
    assert.equal(d.length, 1, `${local(action)} must carry exactly one disposition`);
    assert.match(d[0]!, /^urn:anqr:action-disposition:(retained|excluded-harness|obsolete|non-product)$/u);
  }
});

test("the legacy store surface is claimed exactly once, group by group", () => {
  // 126 legacy store actions in 13 groups. Each group is claimed by one action,
  // so the accounting is by construction rather than by assertion.
  const claims = BASE.filter((x) => x.p.endsWith(":governsParameterGroup"));
  const groups = claims.map((x) => x.o);
  assert.equal(new Set(groups).size, groups.length, "a group claimed twice would double-count the surface");
  assert.equal(groups.length, 13);
  const totals = objects(BASE, "governsStoreAction")
    .map((text) => Number(/^(\d+) legacy store actions/u.exec(text)?.[1] ?? "0"))
    .reduce((a, b) => a + b, 0);
  assert.equal(totals, 126, "the claimed store actions must sum to the observed surface");
});

// ------------------------------------------------------ delivery requirements

test("every required delivery contract exists, and every non-requirement names a real one", () => {
  const set = "urn:anqr:delivery-requirement-set:1";
  const declaredContracts = new Set([
    ...subjectsOfType(BASE, "DeliveryContract"),
    // the sixty-seven pre-existing contracts live in the core delivery source
    ...parse(readFileSync(resolve(repositoryRoot, "graph/v3-delivery.nq"), "utf8"))
      .filter((x) => x.p === "urn:usf:predicate:type" && x.o === "urn:usf:type:DeliveryContract").map((x) => x.s),
  ]);
  const required = objects(BASE, "requiresDeliveryContract", set);
  const notRequired = objects(BASE, "explicitlyNotRequired", set);
  // Twenty-four, not twenty-five: reconciliation withdrew a separate TLS
  // contract because the existing custom-domains contract already owns the
  // name, the zone and the certificate together.
  assert.equal(required.length, 24);
  assert.equal(notRequired.length, 35);
  for (const c of [...required, ...notRequired]) {
    assert.ok(declaredContracts.has(c), `${local(c)} is referenced but never declared`);
  }
});

test("a contract cannot be both required and explicitly not required", () => {
  const set = "urn:anqr:delivery-requirement-set:1";
  const required = new Set(objects(BASE, "requiresDeliveryContract", set));
  const overlap = objects(BASE, "explicitlyNotRequired", set).filter((c) => required.has(c));
  assert.deepEqual(overlap, [], "a contract in both lists makes the requirement set meaningless");
});

test("every explicit non-requirement states why, in the product's own terms", () => {
  const set = "urn:anqr:delivery-requirement-set:1";
  for (const c of objects(BASE, "explicitlyNotRequired", set)) {
    const reasons = BASE.filter((x) => x.s === c && x.p.endsWith(":notRequiredReason"));
    assert.equal(reasons.length, 1, `${local(c)} is excluded without a reason`);
    assert.ok(reasons[0]!.o.length > 40, `${local(c)}'s reason is too thin to review`);
  }
});

// --------------------------------------------------------- environment ladder

test("the rungs are totally ordered and each promotes to the next", () => {
  const rungs = subjectsOfType(BASE, "DeliveryRung");
  assert.equal(rungs.length, 4);
  const order = new Map(rungs.map((r) => [r, Number(objects(BASE, "rungOrder", r)[0])]));
  assert.deepEqual([...order.values()].sort((a, b) => a - b), [1, 2, 3, 4]);
  for (const r of rungs) {
    const next = objects(BASE, "promotesTo", r);
    const n = order.get(r)!;
    if (n === 4) assert.equal(next.length, 0, "production promotes to nothing");
    else assert.equal(order.get(next[0]!), n + 1, `${local(r)} must promote to exactly the next rung`);
  }
});

test("every environment belongs to a rung, and every rung has one", () => {
  const environments = BASE.filter((x) => x.p.endsWith(":belongsToRung"));
  assert.equal(environments.length, 7, "the seven pre-existing environments");
  const rungs = new Set(subjectsOfType(BASE, "DeliveryRung"));
  for (const e of environments) assert.ok(rungs.has(e.o), `${local(e.s)} names an unknown rung`);
  for (const r of rungs) {
    assert.ok(objects(BASE, "deliveryRungOf", r).length > 0, `${local(r)} has no environment`);
  }
});

test("every evidence class a rung requires is declared, and states what it cannot prove", () => {
  const classes = new Set(subjectsOfType(BASE, "EvidenceClass"));
  for (const r of subjectsOfType(BASE, "DeliveryRung")) {
    const required = objects(BASE, "requiresEvidenceClass", r);
    assert.ok(required.length > 0, `${local(r)} requires no evidence at all`);
    for (const c of required) assert.ok(classes.has(c), `${local(r)} requires undeclared ${local(c)}`);
  }
  for (const c of classes) {
    assert.equal(objects(BASE, "cannotProve", c).length, 1, `${local(c)} does not state its limit`);
  }
});

test("only production requires human approval, and it names an authority", () => {
  const approving = subjectsOfType(BASE, "DeliveryRung")
    .filter((r) => objects(BASE, "requiresHumanApproval", r)[0] === "true");
  assert.deepEqual(approving.map(local), ["production"]);
  const gate = "urn:usf:promotion-gate:staging-to-production";
  assert.equal(objects(BASE, "requiresHumanApproval", gate)[0], "true");
  assert.deepEqual(objects(BASE, "approvalAuthority", gate), ["urn:usf:approval-authority:operator"]);
});

test("every promotion gate refuses forced promotion and cross-rung evidence", () => {
  const gates = subjectsOfType(BASE, "PromotionGate");
  assert.equal(gates.length, 3);
  for (const g of gates) {
    const reasons = objects(BASE, "refusalReason", g).map(local);
    assert.ok(reasons.includes("forced-promotion-attempted"), `${local(g)} permits a forced promotion`);
    assert.ok(reasons.includes("evidence-environment-below-requirement"), `${local(g)} permits borrowed evidence`);
    assert.ok(reasons.includes("aggregate-without-constituents"), `${local(g)} accepts a green summary`);
  }
});

// ---------------------------------------------------------- realisation basis

test("every basis axis names a declared source type", () => {
  const axes = subjectsOfType(BASE, "BasisAxis");
  assert.equal(axes.length, 18);
  for (const a of axes) {
    assert.equal(objects(BASE, "axisSource", a).length, 1, `${local(a)} has no source of truth`);
  }
  const members = objects(BASE, "member", "urn:usf:realisation-identity:v2:1");
  assert.equal(members.length, axes.length, "every axis must be a member and every member an axis");
});

test("invalidation is narrow: no axis invalidates every evidence class", () => {
  const classes = new Set(subjectsOfType(BASE, "EvidenceClass").map(local));
  for (const a of subjectsOfType(BASE, "BasisAxis")) {
    const invalidated = new Set(objects(BASE, "axisInvalidates", a).map(local));
    assert.ok(invalidated.size < classes.size,
      `${local(a)} invalidates everything, which makes reproving meaningless`);
  }
  // and the axes that should invalidate nothing genuinely do
  for (const name of ["external-fact-snapshot", "evidence-set-identity", "core-manifest-digest", "product-manifest-digest"]) {
    assert.deepEqual(objects(BASE, "axisInvalidates", `urn:usf:basis-axis:${name}`), [],
      `${name} must not stale anything`);
  }
});

// -------------------------------------------------------------------- secrets

test("no secret value appears in authority, only names, resolvers and consequences", () => {
  const requirements = BASE.filter((x) => x.s.startsWith("urn:anqr:secret-requirement:"));
  assert.ok(requirements.length > 0);
  const names = new Set(requirements.map((x) => x.s));
  for (const s of names) {
    assert.equal(objects(BASE, "secretResolver", s).length, 1, `${local(s)} has no resolver`);
    assert.equal(objects(BASE, "secretConsequence", s).length, 1, `${local(s)} does not say what breaks`);
  }
  // Nothing anywhere in these sources may look like a credential.
  const SUSPICIOUS = /\b(?:sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u;
  for (const quad of BASE) {
    if (!quad.literal) continue;
    assert.doesNotMatch(quad.o, SUSPICIOUS, `${local(quad.s)} carries something shaped like a secret`);
  }
});

test("an unresolved environment binding names its decisions and who must make them", () => {
  const bindings = BASE.filter((x) => x.p.endsWith(":bindingStatus"));
  const unresolved = bindings.filter((x) => x.o === "unresolved").map((x) => x.s);
  assert.ok(unresolved.length >= 2, "staging and production are not bound");
  for (const b of unresolved) {
    assert.ok(objects(BASE, "unresolvedDecision", b).length >= 3, `${local(b)} is unresolved without saying what is missing`);
    assert.deepEqual(objects(BASE, "requiresExternalAuthority", b), ["urn:usf:approval-authority:operator"]);
  }
  for (const b of bindings.filter((x) => x.o === "bound").map((x) => x.s)) {
    assert.deepEqual(objects(BASE, "unresolvedDecision", b), [], `${local(b)} claims to be bound with open decisions`);
  }
});

test("no vendor fact appears in a generic delivery contract", () => {
  // The nine new contracts are provider-neutral by construction; this is the
  // check that keeps them that way when someone adds the tenth.
  const VENDORS = /\b(?:netlify|vercel|aws|amazon|gcp|google cloud|azure|cloudflare|heroku|fly\.io|render\.com)\b/iu;
  const generic = new Set(subjectsOfType(BASE, "DeliveryContract"));
  for (const quad of BASE) {
    if (!quad.literal || !generic.has(quad.s)) continue;
    assert.doesNotMatch(quad.o, VENDORS, `${local(quad.s)} names a vendor; that belongs at the binding`);
  }
});

// ------------------------------------------------------------ planted proofs

/** Runs the closure assertions against a mutated copy of one source. */
function withMutation(path: (typeof SOURCES)[number], mutate: (text: string) => string): readonly Quad[] {
  const original = readFileSync(resolve(repositoryRoot, path), "utf8");
  return load(new Map([[path, mutate(original)]]));
}

test("planted: an action naming an undeclared capability is caught", () => {
  const quads = withMutation("graph/products/anqr/application-actions.nq", (text) =>
    text.replace("urn:anqr:delivery-capability:qrartefactcreation", "urn:anqr:delivery-capability:inventedcapability"));
  const declared = new Set(objects(quads, "declaresCapability", "urn:anqr:profile-revision:3"));
  const dangling = objects(quads, "owningCapability").filter((c) => !declared.has(c));
  assert.ok(dangling.includes("urn:anqr:delivery-capability:inventedcapability"),
    "the check must see an action reaching for a capability the denominator does not declare");
});

test("planted: a capability with no action and no cross-cutting declaration is caught", () => {
  const quads = withMutation("graph/products/anqr/profile-revision-3.nq", (text) =>
    text + '<urn:anqr:profile-revision:3> <urn:usf:predicate:declaresCapability> <urn:anqr:delivery-capability:orphaned> <urn:anqr:graph:profile-revision-3> .\n');
  const declared = new Set(objects(quads, "declaresCapability", "urn:anqr:profile-revision:3").map(local));
  const owning = new Set(objects(quads, "owningCapability").map(local));
  const cross = new Set(quads.filter((x) => x.p.endsWith(":capabilityRealisationMode")).map((x) => local(x.s)));
  assert.deepEqual([...declared].filter((c) => !owning.has(c) && !cross.has(c)), ["orphaned"]);
});

test("planted: an action stripped of an attribute is caught", () => {
  const quads = withMutation("graph/products/anqr/application-actions.nq", (text) =>
    text.split("\n").filter((line) => !line.startsWith("<urn:anqr:application-action:export-artefact> <urn:anqr:predicate:actionRecovery>")).join("\n"));
  assert.equal(objects(quads, "actionRecovery", "urn:anqr:application-action:export-artefact").length, 0,
    "the missing attribute must be observable, not defaulted");
});

test("planted: a secret value in authority is caught", () => {
  const quads = withMutation("graph/products/anqr/environment-bindings.nq", (text) =>
    text + '<urn:anqr:secret-requirement:deploy-credential> <urn:usf:predicate:objective> "the value is sk-abcdefghijklmnop" <urn:anqr:graph:environment-bindings> .\n');
  const SUSPICIOUS = /\bsk-[A-Za-z0-9]{8,}/u;
  assert.ok(quads.some((q) => q.literal && SUSPICIOUS.test(q.o)), "a credential-shaped literal must be visible to the scan");
});

test("planted: a vendor name in a generic delivery contract is caught", () => {
  const quads = withMutation("graph/delivery-contracts.nq", (text) =>
    text.replace('"Serve an immutable set of built assets', '"Serve, on Netlify, an immutable set of built assets'));
  const VENDORS = /\bnetlify\b/iu;
  const generic = new Set(subjectsOfType(quads, "DeliveryContract"));
  assert.ok(quads.some((q) => q.literal && generic.has(q.s) && VENDORS.test(q.o)),
    "a vendor fact in a generic contract must be visible");
});

test("planted: a rung promoting past the next one is caught", () => {
  const quads = withMutation("graph/delivery-environment.nq", (text) =>
    text.replace("<urn:usf:delivery-rung:development> <urn:usf:predicate:promotesTo> <urn:usf:delivery-rung:testing>",
                 "<urn:usf:delivery-rung:development> <urn:usf:predicate:promotesTo> <urn:usf:delivery-rung:production>"));
  const order = new Map(subjectsOfType(quads, "DeliveryRung").map((r) => [r, Number(objects(quads, "rungOrder", r)[0])]));
  const next = objects(quads, "promotesTo", "urn:usf:delivery-rung:development")[0]!;
  assert.notEqual(order.get(next), order.get("urn:usf:delivery-rung:development")! + 1,
    "skipping a rung must be observable");
});

test("planted: a production gate without an approval authority is caught", () => {
  const quads = withMutation("graph/delivery-environment.nq", (text) =>
    text.split("\n").filter((line) => !line.startsWith("<urn:usf:promotion-gate:staging-to-production> <urn:usf:predicate:approvalAuthority>")).join("\n"));
  assert.deepEqual(objects(quads, "approvalAuthority", "urn:usf:promotion-gate:staging-to-production"), [],
    "a production gate with no authority must be visible, because a machine could then satisfy it");
});

test("planted: an axis invalidating every evidence class is caught", () => {
  const quads = withMutation("graph/realisation-basis.nq", (text) => {
    const classes = ["implementation-conformance", "realized-artefact", "deployment-observation",
      "runtime-observation", "browser-render", "human-review", "release-provenance"];
    return text + classes.map((c) =>
      `<urn:usf:basis-axis:external-fact-snapshot> <urn:usf:predicate:axisInvalidates> <urn:usf:evidence-class:${c}> <urn:usf:graph:realisation-basis> .`).join("\n") + "\n";
  });
  const classes = new Set(subjectsOfType(quads, "EvidenceClass").map(local));
  const invalidated = new Set(objects(quads, "axisInvalidates", "urn:usf:basis-axis:external-fact-snapshot").map(local));
  assert.equal(invalidated.size, classes.size, "blanket invalidation must be observable");
});

test("planted: a contract in both the required and not-required lists is caught", () => {
  const quads = withMutation("graph/products/anqr/delivery-posture.nq", (text) =>
    text + '<urn:anqr:delivery-requirement-set:1> <urn:anqr:predicate:explicitlyNotRequired> <urn:usf:delivery-contract:staticassetruntime> <urn:anqr:graph:delivery-posture> .\n');
  const set = "urn:anqr:delivery-requirement-set:1";
  const required = new Set(objects(quads, "requiresDeliveryContract", set));
  assert.ok(objects(quads, "explicitlyNotRequired", set).some((c) => required.has(c)),
    "a contract on both lists must be visible");
});

test("control: the unmutated sources satisfy every check above", () => {
  // The planted cases would all pass vacuously if the base state were already
  // broken, so this states plainly that it is not.
  const declared = new Set(objects(BASE, "declaresCapability", "urn:anqr:profile-revision:3").map(local));
  const owning = new Set(objects(BASE, "owningCapability").map(local));
  const cross = new Set(BASE.filter((x) => x.p.endsWith(":capabilityRealisationMode")).map((x) => local(x.s)));
  assert.deepEqual([...declared].filter((c) => !owning.has(c) && !cross.has(c)), []);
  assert.equal(subjectsOfType(BASE, "ApplicationAction").length, 60);
  assert.equal(subjectsOfType(BASE, "DeliveryRung").length, 4);
  assert.equal(subjectsOfType(BASE, "BasisAxis").length, 18);
});
