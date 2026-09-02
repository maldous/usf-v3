import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import type { SemanticGraph } from "../graph/index.ts";

/**
 * The bridge from recovered facet requirements to executable product work.
 *
 * A facet is a requirement, not a task. The 553 outstanding requirements are
 * implementation-conformance statements: they describe what the ANQR product
 * must *do*, not which file must exist. This module turns them into cohesive
 * implementation work whose target paths come from graph authority, whose
 * decomposition follows the declared cohesion rule, and whose evidence must be
 * produced by executing the result rather than by observing that a file exists.
 */
const P = "urn:usf:predicate:";
const conventionType = "urn:usf:type:CapabilityImplementationConvention";
const conformanceRuleType = "urn:usf:type:ImplementationConformanceRule";

function one(graph: SemanticGraph, subject: string, predicate: string): string | null {
  const values = graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`);
  return values.length === 1 ? values[0]!.object : null;
}
function subjectsOfType(graph: SemanticGraph, type: string): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === type)
    .map((quad) => quad.subject).sort());
}
function localName(iri: string): string {
  return iri.split(":").pop() ?? iri;
}

export interface ImplementationConvention {
  readonly convention: string;
  readonly realisationRoot: string;
  /** Set when the owning repository is a product repository resolved by locator. */
  readonly productRepository: string | null;
  readonly modulePathPattern: string;
  readonly conformancePathPattern: string;
  readonly pathDerivation: string;
  readonly cohesionRule: string;
  readonly dependencyDerivationRule: string;
  readonly outputRule: string;
  readonly filenameConvention: string;
}

/**
 * Read the declared convention. Nothing is defaulted: an absent convention is a
 * graph closure defect, and inventing a path here would be exactly the failure
 * the convention exists to prevent.
 */
export function readImplementationConvention(graph: SemanticGraph): ImplementationConvention {
  const conventions = readImplementationConventions(graph);
  if (conventions.length !== 1) {
    throw new UsfError("IMPLEMENTATION_CONVENTION_AMBIGUOUS", exitCodes.DOMAIN_FAILURE,
      "This selection declares more than one implementation convention, so no single one governs it.",
      { declared: conventions.length });
  }
  return conventions[0]!;
}

/**
 * Every convention the selection declares.
 *
 * A selection may compose a product profile with the foundation, in which case
 * both are realised: each capability under the convention whose repository owns
 * it, into that repository. Requiring exactly one convention made that
 * composition impossible to express -- the selection refused before it could
 * describe work it was perfectly able to describe.
 */
export function readImplementationConventions(graph: SemanticGraph): readonly ImplementationConvention[] {
  const subjects = subjectsOfType(graph, conventionType);
  if (subjects.length === 0) {
    throw new UsfError("IMPLEMENTATION_CONVENTION_UNAVAILABLE", exitCodes.DOMAIN_FAILURE,
      "At least one capability implementation convention must be declared before implementation work can be derived.",
      { declared: 0 });
  }
  return Object.freeze(subjects.map((subject) => readOneConvention(graph, subject)));
}

function readOneConvention(graph: SemanticGraph, convention: string): ImplementationConvention {
  const repository = one(graph, convention, "ownedByRepository");
  // A convention may be owned by USF itself, which declares its realisation
  // root in the graph, or by a product repository, which deliberately does not:
  // where a product sits on a given machine is operator state, so the graph
  // names the repository by identity and the root is resolved from the locator
  // at execution time. Both cases produce repository-relative paths; they
  // differ only in which repository those paths are relative to.
  const productRepository = repository !== null
    && one(graph, repository, "type") === "urn:usf:type:ProductRepository"
    ? repository : null;
  const realisationRoot = repository === null ? null
    : productRepository !== null ? "." : one(graph, repository, "realisationRoot");
  const moduleRule = one(graph, convention, "implementationPathRule");
  const conformanceRule = one(graph, convention, "conformancePathRule");
  const modulePathPattern = moduleRule === null ? null : one(graph, moduleRule, "pathPattern");
  const conformancePathPattern = conformanceRule === null ? null : one(graph, conformanceRule, "pathPattern");
  if (realisationRoot === null || modulePathPattern === null || conformancePathPattern === null) {
    throw new UsfError("IMPLEMENTATION_CONVENTION_INCOMPLETE", exitCodes.DOMAIN_FAILURE,
      "The implementation convention must name an owning repository realisation root and both path rules.",
      { realisationRoot, modulePathPattern, conformancePathPattern });
  }
  return Object.freeze({
    convention, realisationRoot, productRepository, modulePathPattern, conformancePathPattern,
    pathDerivation: one(graph, convention, "pathDerivation") ?? "",
    cohesionRule: one(graph, convention, "cohesionRule") ?? "",
    dependencyDerivationRule: one(graph, convention, "dependencyDerivationRule") ?? "",
    outputRule: one(graph, convention, "outputRule") ?? "",
    filenameConvention: one(graph, convention, "filenameConvention") ?? "",
  });
}

export interface ConformanceRule {
  readonly rule: string;
  readonly evidenceRule: string;
  readonly admissibilityRule: string;
  readonly coverageMode: string;
}

export function readConformanceRule(graph: SemanticGraph): ConformanceRule | null {
  const subjects = subjectsOfType(graph, conformanceRuleType);
  if (subjects.length !== 1) return null;
  const rule = subjects[0]!;
  return Object.freeze({
    rule,
    evidenceRule: one(graph, rule, "evidenceRule") ?? "",
    admissibilityRule: one(graph, rule, "admissibilityRule") ?? "",
    coverageMode: one(graph, rule, "coverageMode") ?? "",
  });
}

export interface FacetRequirement {
  readonly facet: string;
  readonly canonicalName: string;
  readonly requirementClass: string;
  readonly statement: string;
}

/** One capability's complete outstanding implementation obligation. */
export interface CapabilityImplementationNeed {
  readonly capability: string;
  readonly canonicalName: string;
  readonly domain: string;
  readonly contract: string | null;
  /** Graph-derived. A model never sees a path decision. */
  readonly modulePath: string;
  readonly conformancePath: string;
  readonly requirements: readonly FacetRequirement[];
  readonly requirementClasses: readonly string[];
  /** Capabilities this one composes with at runtime; context only, not ordering. */
  readonly runtimeDependencies: readonly string[];
  /**
   * The product repository this capability lands in, or null for the foundation
   * itself. The command resolves it to an on-disk root; the graph never holds a
   * path to one.
   */
  readonly sourceRepository: string | null;
}

/**
 * Group every outstanding applicable implementation-conformance facet by the
 * capability whose behaviour it describes. The declared cohesion rule makes the
 * capability, not the facet, the unit of work: those requirements are jointly
 * realized by one module, so splitting them would force a model to reinvent
 * the same module several times and would create write conflicts between units.
 */
export function deriveCapabilityImplementationNeeds(
  graph: SemanticGraph,
  governing: ImplementationConvention | readonly ImplementationConvention[],
): readonly CapabilityImplementationNeed[] {
  const conventions = Array.isArray(governing)
    ? governing as readonly ImplementationConvention[]
    : [governing as ImplementationConvention];
  // A capability declared by a product profile is that product's, and lands in
  // that product's repository. Anything no profile declares is the foundation's
  // own. Resolving it this way keeps the rule in the graph rather than in an
  // IRI-prefix guess, which is the same mistake that once made every product
  // capability invisible.
  const repositoryOfCapability = new Map<string, string>();
  for (const quad of graph.quads) {
    if (quad.predicate !== `${P}declaresCapability`) continue;
    const repository = one(graph, quad.subject, "productRepository");
    if (repository !== null) repositoryOfCapability.set(quad.object, repository);
  }
  const byRepository = new Map<string | null, ImplementationConvention>();
  for (const entry of conventions) byRepository.set(entry.productRepository, entry);
  const foundationConvention = byRepository.get(null) ?? conventions[0]!;
  const conventionFor = (capability: string): ImplementationConvention =>
    byRepository.get(repositoryOfCapability.get(capability) ?? null) ?? foundationConvention;
  const contractOfFacet = new Map<string, string>();
  for (const quad of graph.quads) {
    if (quad.predicate === `${P}declaresFacet`) contractOfFacet.set(quad.object, quad.subject);
  }
  const capabilityOfContract = new Map<string, string>();
  for (const quad of graph.quads) {
    if (quad.predicate === `${P}definesCompletionFor`) capabilityOfContract.set(quad.subject, quad.object);
  }
  const domainOf = new Map<string, string>();
  const runtimeDependencies = new Map<string, string[]>();
  const capabilityName = new Map<string, string>();
  // A capability is recognised by its declared type, never by the namespace its
  // IRI happens to sit in. Keying this on "urn:usf:delivery-capability:" made
  // every capability a product profile declares invisible to the frontier while
  // its facets, contract and paths were all perfectly well formed, so the
  // profile mechanism could describe work that could never be selected.
  const declaredCapabilities = new Set(subjectsOfType(graph, "urn:usf:type:DeliveryCapability"));
  for (const quad of graph.quads) {
    if (quad.predicate === `${P}inDomain`) domainOf.set(quad.subject, quad.object);
    if (quad.predicate === `${P}productRuntimeDependency`) {
      runtimeDependencies.set(quad.subject, [...(runtimeDependencies.get(quad.subject) ?? []), quad.object]);
    }
    if (quad.predicate === `${P}canonicalName` && declaredCapabilities.has(quad.subject)) {
      capabilityName.set(quad.subject, quad.object);
    }
  }

  const byCapability = new Map<string, FacetRequirement[]>();
  for (const facet of subjectsOfType(graph, "urn:usf:type:DeliveryFacet")) {
    if (one(graph, facet, "admissibleEvidenceClass") !== "implementation-conformance") continue;
    if (one(graph, facet, "facetApplicability") !== "APPLICABLE") continue;
    const statement = one(graph, facet, "facetStatement");
    const capability = capabilityOfContract.get(contractOfFacet.get(facet) ?? "");
    if (statement === null || capability === undefined) continue;
    byCapability.set(capability, [...(byCapability.get(capability) ?? []), Object.freeze({
      facet,
      canonicalName: one(graph, facet, "canonicalName") ?? localName(facet),
      requirementClass: one(graph, facet, "requirementClass") ?? "unclassified",
      statement,
    })]);
  }

  return Object.freeze([...byCapability.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, requirements]) => {
      const name = capabilityName.get(capability) ?? localName(capability);
      const domain = localName(domainOf.get(capability) ?? "urn:usf:delivery-domain:foundation");
      // A realisation root of "." means the owning repository realises this
      // itself, so the declared pattern is already repository-relative and
      // nothing is prefixed to it.
      const governingConvention = conventionFor(capability);
      const substitute = (pattern: string): string => {
        const resolved = pattern.replace("{domain}", domain).replace("{capability}", name);
        const root = governingConvention.realisationRoot;
        return root === "." || root.length === 0 ? resolved : `${root}/${resolved}`;
      };
      const sorted = Object.freeze([...requirements].sort((left, right) => left.facet.localeCompare(right.facet)));
      return Object.freeze({
        capability,
        canonicalName: name,
        domain,
        contract: [...capabilityOfContract.entries()].find(([, value]) => value === capability)?.[0] ?? null,
        modulePath: substitute(governingConvention.modulePathPattern),
        conformancePath: substitute(governingConvention.conformancePathPattern),
        requirements: sorted,
        requirementClasses: Object.freeze([...new Set(sorted.map((entry) => entry.requirementClass))].sort()),
        runtimeDependencies: Object.freeze([...(runtimeDependencies.get(capability) ?? [])].sort()),
        sourceRepository: governingConvention.productRepository,
      });
    }));
}

export type ImplementationStage = "implementation" | "conformance";

/** One requirement whose behavioural check executed and did not hold. */
export interface FailingRequirement {
  readonly facetName: string;
  readonly detail: string | null;
}

export interface ImplementationWorkUnit {
  readonly unit: string;
  readonly stage: ImplementationStage;
  readonly need: CapabilityImplementationNeed;
  readonly targetPath: string;
  /** The concrete result this unit needs before it can be correctly written. */
  readonly requiresUnit: string | null;
  readonly ready: boolean;
  readonly readyReason: string;
  /** Non-empty when this unit exists to repair observed failing behaviour. */
  readonly repairs: readonly FailingRequirement[];
  readonly repairRound: number;
}

export function unitIdentifier(stage: ImplementationStage, need: CapabilityImplementationNeed, round = 0): string {
  return round === 0
    ? `urn:usf:workunit:${stage}-${need.canonicalName}`
    : `urn:usf:workunit:${stage}-${need.canonicalName}-repair-${round}`;
}

/**
 * A failing behavioural check is a result, not a dead end. After the bound the
 * capability stops consuming provider budget and is reported as a blocker
 * instead, because an unbounded repair loop is how autonomous work burns a
 * night on one module.
 */
export const maximumRepairRounds = 4;

export interface CapabilityRepairState {
  readonly failing: readonly FailingRequirement[];
  readonly round: number;
  /**
   * Which side to correct first. A compiler naming only the test file is
   * telling us which artefact is wrong, and spending a round regenerating a
   * module that compiles would waste it.
   */
  readonly preferredStage?: ImplementationStage;
}

/**
 * Project the executable frontier. Implementation units are all ready at once:
 * the declared dependency rule says the contract and facet statements already
 * carry the authority each module needs, so nothing orders one capability's
 * module behind another's. Only the conformance unit has a genuine dependency,
 * because a behavioural test cannot be written against a surface that does not
 * yet exist.
 */
export function deriveImplementationWorkUnits(
  needs: readonly CapabilityImplementationNeed[],
  present: ReadonlySet<string>,
  repairs: ReadonlyMap<string, CapabilityRepairState> = new Map(),
): readonly ImplementationWorkUnit[] {
  const units: ImplementationWorkUnit[] = [];
  const none = Object.freeze([] as readonly FailingRequirement[]);
  for (const need of needs) {
    const moduleLanded = present.has(need.modulePath);
    const conformanceLanded = present.has(need.conformancePath);
    if (!moduleLanded) {
      units.push(Object.freeze({
        unit: unitIdentifier("implementation", need), stage: "implementation" as const, need,
        targetPath: need.modulePath, requiresUnit: null, ready: true,
        readyReason: "Every authority this module needs is already current: its capability contract, its facet statements and its canonical path.",
        repairs: none, repairRound: 0,
      }));
    }
    const outstanding = repairs.get(need.capability);
    if (!conformanceLanded) {
      // A module that does not hold up is not a surface to write a test
      // against: the test would describe code that cannot run.
      const bindable = moduleLanded && (outstanding === undefined || outstanding.failing.length === 0);
      units.push(Object.freeze({
        unit: unitIdentifier("conformance", need), stage: "conformance" as const, need,
        targetPath: need.conformancePath,
        requiresUnit: bindable ? null : unitIdentifier("implementation", need),
        ready: bindable,
        readyReason: bindable
          ? "The implementation module exists and holds up, so its exported surface is concrete and a behavioural test can bind to it."
          : moduleLanded
            ? "The implementation module exists but does not hold up, so there is no stable surface to write a behavioural test against yet."
            : "A behavioural test requires the concrete exported surface of the implementation module, which does not exist yet.",
        repairs: none, repairRound: 0,
      }));
      if (!moduleLanded) continue;
    }
    const repair = outstanding;
    if (repair === undefined || repair.failing.length === 0 || repair.round > maximumRepairRounds) continue;
    // Rounds alternate, because a behavioural check that keeps failing is as
    // likely to be a wrong test as wrong code and alternating finds out without
    // an operator deciding which. Where the evidence already says which side is
    // wrong, that side goes first.
    // When the evidence names which artefact is wrong, correct that one every
    // round. Alternation exists only for a behavioural failure, which does not
    // say whether the code or the test is at fault.
    const stage = repair.preferredStage
      ?? (repair.round % 2 === 1 ? "implementation" as const : "conformance" as const);
    units.push(Object.freeze({
      unit: unitIdentifier(stage, need, repair.round), stage, need,
      targetPath: stage === "implementation" ? need.modulePath : need.conformancePath,
      requiresUnit: null, ready: true,
      readyReason: `Round ${repair.round} of bounded repair: ${repair.failing.length} behavioural checks executed and did not hold.`,
      repairs: repair.failing, repairRound: repair.round,
    }));
  }
  return Object.freeze(units);
}

const maximumInspectedBytes = 12_000;
const maximumSiblingBytes = 5_000;
/**
 * A file being rewritten is shown whole.
 *
 * Asking for "the complete updated content" of a 26 KB module while showing its
 * first 12 KB is not a task any model can perform, and three capabilities
 * blocked on exactly that every cycle. Context is not the scarce resource here;
 * a coherent request is.
 */
const maximumRewriteBytes = 64_000;
export { maximumRewriteBytes };

/** Read the current content of a path, bounded, for existing-code inspection. */
export async function inspectRepositoryFile(
  repositoryRoot: string,
  path: string,
  limit = maximumInspectedBytes,
): Promise<string | null> {
  const bytes = await readFile(resolve(repositoryRoot, path), "utf8").catch(() => undefined);
  if (bytes === undefined) return null;
  return bytes.length > limit ? `${bytes.slice(0, limit)}\n/* truncated for inspection */\n` : bytes;
}

export { maximumSiblingBytes };

export interface InspectionContext {
  /** Current content at the target path, when the unit modifies rather than creates. */
  readonly existingTarget: string | null;
  /** The module the conformance unit must bind to. */
  readonly moduleSource: string | null;
  /** An already-realized sibling module, so conventions are copied rather than invented. */
  readonly siblingModule: Readonly<{ path: string; source: string }> | null;
}

/**
 * One line per requirement, but a detail shared by every requirement -- a
 * compiler error blocks them all at once -- is stated once. Repeating a
 * thousand characters eight times crowds out the code the model must read.
 */
function summariseFailures(failing: readonly FailingRequirement[]): readonly string[] {
  const shared = new Set(failing.map((entry) => entry.detail ?? ""));
  if (shared.size === 1 && failing.length > 1) {
    return Object.freeze([
      `Requirements affected: ${failing.map((entry) => entry.facetName).join(", ")}.`,
      `Observed: ${[...shared][0]!}`,
    ]);
  }
  return Object.freeze(failing.map((entry) => `- ${entry.facetName}: ${entry.detail ?? "the behavioural subtest failed"}`));
}

function requirementBlock(need: CapabilityImplementationNeed): string {
  // The identifier is given on its own line and unadorned. A model shown
  // `[name]` copies the brackets into the subtest name, which is the evidence
  // key, so the requirement is then unattributable.
  return need.requirements.map((requirement, index) => [
    `${index + 1}. Requirement identifier: ${requirement.canonicalName}`,
    `   Class: ${requirement.requirementClass}`,
    `   Statement: ${requirement.statement}`,
  ].join("\n")).join("\n");
}

/**
 * The implementation requirement, derived entirely from authority. The model is
 * told what behaviour must hold and what surface shape the convention requires.
 * It is never told, and never decides, where the module goes.
 */
export function deriveImplementationPrompt(
  need: CapabilityImplementationNeed,
  convention: ImplementationConvention,
  context: InspectionContext,
  failing: readonly FailingRequirement[] = [],
): string {
  const existing = context.existingTarget === null
    ? "This module does not exist yet. Create its complete content."
    : `The module already exists. Return its complete updated content, changing the minimum required to satisfy every requirement below.\n\nCurrent content:\n${context.existingTarget}`;
  const sibling = context.siblingModule === null ? "" :
    `\nAn already-accepted module in this product, shown so you follow the same conventions rather than inventing new ones:\n${context.siblingModule.source}\n`;
  const repair = failing.length === 0 ? "" : [
    ``,
    `These requirements did not hold when the current module was checked. Correct the module so each one does, and change nothing else:`,
    ...summariseFailures(failing),
  ].join("\n");
  return [
    `Implement one capability module for the ANQR product in TypeScript.`,
    `Capability: ${need.canonicalName}. Domain: ${need.domain}.`,
    ``,
    `The module must make every one of the following behavioural requirements true. They are the recovered specification of this capability and they describe behaviour, not files:`,
    requirementBlock(need),
    ``,
    `Module contract: ${convention.outputRule}`,
    ``,
    `Rules you must follow exactly:`,
    `- Return only the TypeScript source of this one module. No commentary, no code fence, no file path, no additional file.`,
    `- Import nothing outside the Node standard library. Do not import any package.`,
    `- Export named functions and named constants. Every behaviour a requirement above asserts must be reachable by calling an export with ordinary values.`,
    `- Where a requirement names a fixed set of outcomes, export that set as a readonly array of string literals and a union type over it.`,
    `- Where a requirement says a check must precede a mutation, make the ordering observable: the mutation function must accept the audit function and must not mutate when it throws or returns a failure.`,
    `- Where a requirement is fail-closed, the default branch must deny.`,
    `- Prefer pure functions taking explicit state and returning new state. Do not use module-level mutable state, timers, the network, the filesystem or the process environment.`,
    `- Write TypeScript that compiles under strict mode with no 'any' and no non-null assertion.`,
    `- Where a function may return either a result or an error, make the two discriminable by a literal field so a caller can narrow the union before reading a member.`,
    ``,
    existing,
    repair,
    sibling,
  ].filter((line) => line !== null).join("\n");
}

/**
 * The conformance requirement. The test is derived from the same facet
 * statements and the concrete module surface, and is dispatched as its own unit
 * so an implementation does not author the evidence that satisfies it.
 */
export function deriveConformancePrompt(
  need: CapabilityImplementationNeed,
  moduleSource: string,
  importSpecifier: string,
  failing: readonly FailingRequirement[] = [],
  existingTest: string | null = null,
): string {
  const repair = failing.length === 0 ? "" : [
    ``,
    `A previous test for these requirements did not hold against this exact module. Either it does not compile, or it asserted something the requirement does not state, or the module is wrong. Correct it so every requirement is checked against the surface this module actually exposes.`,
    ...summariseFailures(failing),
    ...(existingTest === null ? [] : ["", "The test as it currently stands, which you are correcting:", existingTest]),
  ].join("\n");
  return [
    `Write one Node test-runner conformance test for the ANQR capability module below.`,
    `Capability: ${need.canonicalName}.`,
    ``,
    `The module under test, exactly as it exists:`,
    moduleSource,
    ``,
    `Each requirement below must be checked by exactly one top-level subtest whose name is that requirement's identifier, spelled exactly and with nothing added -- no brackets, no numbering, no description:`,
    requirementBlock(need),
    ``,
    `Rules you must follow exactly:`,
    `- Return only the TypeScript source of this one test file. No commentary, no code fence, no file path.`,
    `- Import assert from "node:assert/strict" and test from "node:test".`,
    `- Import the module under test with exactly: import * as capability from "${importSpecifier}";`,
    `- Declare one subtest per requirement as: test("<identifier>", () => { ... }); for example test("${need.requirements[0]?.canonicalName ?? "requirementidentifier"}", () => { ... });`,
    `- Every subtest must call at least one export of the module under test and assert on what it returned or threw. A subtest that asserts a constant, or that reimplements the behaviour instead of calling it, is worthless and will be rejected.`,
    `- Assert the behaviour the requirement states, including its negative case where it states one: a fail-closed requirement must be checked with an input that must be denied.`,
    `- Do not stub, mock, monkey-patch or re-declare the module under test.`,
    `- Do not use timers, the network, the filesystem or the process environment.`,
    `- Write TypeScript that compiles under strict mode. Where a value has string-literal members, annotate it with the module's exported type or use "as const" so it is not widened to string, and narrow a union result before reading a member of one branch.`,
    `- If an export the requirement needs does not exist on the module, assert the closest behaviour the module does expose rather than inventing an import.`,
    repair,
  ].filter((line) => line.length > 0).join("\n");
}

/**
 * Facet names whose subtest actually invokes the module under test.
 *
 * Importing the module is not enough. A subtest that only asserts the shape of
 * an exported constant establishes that the constant is declared, which the
 * type system already guarantees, and says nothing about the behaviour the
 * requirement asserts. This is the single rule both admission and evidence
 * apply, so a test that would be refused if written today cannot keep standing
 * as evidence because it was written yesterday.
 */
export function subtestsInvokingModule(
  content: string,
  facetNames: readonly string[],
): ReadonlySet<string> {
  return classifySubtests(content, facetNames).invoking;
}

/**
 * A facet with no subtest at all is unobserved; a facet whose subtest exists
 * but never calls the module is inadmissible. They are different states and
 * only the second is a defect in the test.
 */
export function classifySubtests(
  content: string,
  facetNames: readonly string[],
): Readonly<{ named: ReadonlySet<string>; invoking: ReadonlySet<string> }> {
  const named = new Set<string>();
  const invoking = new Set<string>();
  for (const name of facetNames) {
    const opening = new RegExp(`test\\(\\s*["'\`][^"'\`]*${name}[^"'\`]*["'\`]\\s*,`, "u").exec(content);
    if (opening === null) continue;
    named.add(name);
    // Walk the subtest body by brace depth from its opening brace.
    const start = content.indexOf("{", opening.index + opening[0].length);
    if (start < 0) continue;
    let depth = 1;
    let index = start + 1;
    while (index < content.length && depth > 0) {
      if (content[index] === "{") depth += 1;
      else if (content[index] === "}") depth -= 1;
      index += 1;
    }
    if (/\bcapability\s*\.\s*\w+\s*[(<]/u.test(content.slice(start, index))) invoking.add(name);
  }
  return Object.freeze({ named, invoking });
}


/**
 * Structural truncation detection.
 *
 * A generation cut off by an output ceiling ends mid-construct, and the
 * compiler then reports the damage far from its cause -- a missing semicolon at
 * line 718 of a file whose real defect is that it stops. API transports report
 * finishReason and are refused upstream; host-CLI transports report nothing, so
 * the text itself is the only witness. The scanner skips strings, template
 * literals and comments, then calls the output truncated only on the compound
 * signal: brace depth still open at end of text AND the text stopping somewhere
 * no module ends. Either alone is too eager; together they do not occur in a
 * finished module.
 */
export function looksTruncated(content: string): boolean {
  let depth = 0;
  let index = 0;
  const length = content.length;
  while (index < length) {
    const ch = content[index]!;
    const next = content[index + 1];
    if (ch === "/" && next === "/") {
      while (index < length && content[index] !== "\n") index += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      index += 2;
      while (index < length && !(content[index] === "*" && content[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      index += 1;
      while (index < length) {
        if (content[index] === "\\") { index += 2; continue; }
        // A template's interpolation may hold braces; counting the outer pair
        // and skipping its contents is enough for a depth-only scan.
        if (quote === "`" && content[index] === "$" && content[index + 1] === "{") {
          let inner = 1;
          index += 2;
          while (index < length && inner > 0) {
            if (content[index] === "{") inner += 1;
            if (content[index] === "}") inner -= 1;
            index += 1;
          }
          continue;
        }
        if (content[index] === quote) break;
        if (quote !== "`" && content[index] === "\n") break;
        index += 1;
      }
      index += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    index += 1;
  }
  if (depth <= 0) return false;
  const tail = content.trimEnd();
  const last = tail[tail.length - 1] ?? "";
  // A finished construct ends a line at one of these; text cut mid-token does not.
  return !["}", ";", ")", "\u0060"].includes(last);
}

export interface ImplementationOutputCheck {
  readonly accepted: boolean;
  readonly code: string;
  readonly detail: string | null;
  readonly content: string;
  readonly contentDigest: string;
}

function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/giu, "").replace(/^[\s\S]*?<\/think>/iu, "");
}
/**
 * Take the fenced block wherever it sits.
 *
 * Requiring the fence to wrap the entire output means a model that adds one
 * closing sentence ships its fence into the file, where the compiler reports it
 * as a module declaration on line 1 and the whole generation is discarded.
 */
function stripCodeFence(text: string): string {
  const whole = /^\s*```(?:[a-z0-9]+)?\s*\n([\s\S]*?)\n?\s*```\s*$/u.exec(text);
  if (whole !== null) return whole[1]!;
  const embedded = /```(?:[a-z0-9]+)?\s*\n([\s\S]*?)\n\s*```/u.exec(text);
  return embedded === null ? text : embedded[1]!;
}

const forbiddenImport = /(?:^|\n)\s*(?:import[\s\S]{0,200}?from\s*|import\s*)["']([^"']+)["']/gu;

/**
 * A Node builtin reached by its bare legacy name is still a Node builtin. The
 * rule exists to keep a package out of a capability module, not to enforce a
 * specifier style, and refusing `crypto` cost a whole dispatch.
 */
function nodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  const { isBuiltin } = process.getBuiltinModule?.("module") ?? {};
  return typeof isBuiltin === "function" ? isBuiltin(specifier) : false;
}

/**
 * Structural admission for a generated module. This checks that the output is
 * the kind of thing the convention authorizes, not that it is correct: only
 * executing it can establish that.
 */
export function validateImplementationOutput(raw: string): ImplementationOutputCheck {
  const content = stripCodeFence(stripReasoning(raw)).trim();
  const refuse = (code: string, detail: string): ImplementationOutputCheck =>
    Object.freeze({ accepted: false, code, detail, content, contentDigest: canonicalDigest(content) });
  if (content.length === 0) return refuse("empty-output", "the model returned no content");
  if (looksTruncated(content)) {
    return refuse("candidate-truncated",
      "the generation was cut off by an output ceiling: it ends mid-construct with braces still open. Produce a materially smaller module that still satisfies every facet, rather than the same module again");
  }
  // Content beginning with a slash reads as an absolute path to the canonical
  // envelope. A leading comment is not that, and rejecting idiomatic TypeScript
  // that opens with a docblock would discard most valid output.
  if (content.startsWith("/") && !content.startsWith("//") && !content.startsWith("/*")) {
    return refuse("leading-slash", "module content may not begin with a path-like slash");
  }
  if (!/\bexport\b/u.test(content)) return refuse("no-export", "a capability module must export its surface");
  for (const match of content.matchAll(forbiddenImport)) {
    const specifier = match[1]!;
    if (!nodeBuiltin(specifier) && !specifier.startsWith(".")) {
      return refuse("external-import", `a capability module may import only Node builtins and its own directory: ${specifier}`);
    }
  }
  // Only an actual annotation position, so prose mentioning the word in a
  // comment cannot cost a whole dispatch.
  if (/:\s*any\s*[;,)\]=>]/u.test(content)) {
    return refuse("any-type", "a capability module must be typed without any");
  }
  return Object.freeze({ accepted: true, code: "accepted", detail: null, content, contentDigest: canonicalDigest(content) });
}

/**
 * Structural admission for a generated conformance test. A test that does not
 * import and call the module is not evidence of anything, so it is refused
 * before it is ever executed.
 */
export function validateConformanceOutput(
  raw: string,
  need: CapabilityImplementationNeed,
  importSpecifier: string,
): ImplementationOutputCheck & { readonly coveredFacets: readonly string[] } {
  const content = stripCodeFence(stripReasoning(raw)).trim();
  const digest = canonicalDigest(content);
  const refuse = (code: string, detail: string) => Object.freeze({
    accepted: false, code, detail, content, contentDigest: digest, coveredFacets: Object.freeze([] as readonly string[]),
  });
  if (content.length === 0) return refuse("empty-output", "the model returned no content");
  if (looksTruncated(content)) {
    return refuse("candidate-truncated",
      "the generation was cut off by an output ceiling: it ends mid-construct with braces still open. Produce a materially smaller test that still exercises every facet, rather than the same test again");
  }
  if (content.startsWith("/") && !content.startsWith("//") && !content.startsWith("/*")) {
    return refuse("leading-slash", "test content may not begin with a path-like slash");
  }
  if (!content.includes(importSpecifier)) {
    return refuse("module-not-imported", `the test must import the module under test at ${importSpecifier}`);
  }
  if (/\b(?:mock|stub)\b\s*\.\s*(?:method|fn|module)/u.test(content) || /\bmock\.module\b/u.test(content)) {
    return refuse("module-stubbed", "a stubbed module cannot evidence the behaviour of the real module");
  }
  // The subtest name is the evidence key and its body must exercise the module.
  const invoking = subtestsInvokingModule(content, need.requirements.map((entry) => entry.canonicalName));
  const covered = [...invoking];
  if (covered.length === 0) {
    return refuse("no-facet-subtest",
      "the test declares no subtest that is named for an outstanding requirement and invokes the module");
  }
  if (!/\bassert\b/u.test(content)) return refuse("no-assertion", "the test makes no assertion");
  return Object.freeze({
    accepted: true, code: "accepted", detail: null, content, contentDigest: digest,
    coveredFacets: Object.freeze(covered.sort()),
  });
}

/** Relative specifier from the conformance test to the module, both graph-derived. */
export function importSpecifierFor(need: CapabilityImplementationNeed): string {
  const from = need.conformancePath.split("/").slice(0, -1);
  const to = need.modulePath.split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  const up = Array.from({ length: from.length - shared }, () => "..");
  const specifier = [...up, ...to.slice(shared)].join("/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}
