import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  capabilityKind, observedModelFeatureCapabilities, observeQualifiedTaskClasses,
  splitCapabilityRequirement, satisfiesCapabilities, taskClassCapabilities,
  unmetCapabilities,
} from "../../src/providers/capabilities.ts";
import { antigravityCliArguments, claudeCliArguments, codexModelSelection } from "../../src/providers/cli-transports.ts";
import { createQualificationPolicy, createQualificationSuite } from "../../src/providers/qualification.ts";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
import { deriveRouteUniverse } from "../../src/providers/route-universe.ts";

/**
 * Adversarial proof for the shared capability vocabulary.
 *
 * The defect this closes was invisible rather than loud. Work packets declared
 * `modelCapability` across nine task classes; the catalogue described models
 * with five model features; the two sets did not intersect at all. Nothing
 * translated between them, so a work unit requiring `typescript` could never
 * have matched a route. It went unnoticed because the dispatcher read a third
 * predicate the graph does not contain, leaving the requirement permanently
 * empty -- and an empty requirement refuses nothing, so a router that could not
 * match a capability looked exactly like a router with nothing to match.
 *
 * The property under test is therefore not "capabilities match". It is that a
 * capability is satisfied only by its own kind of evidence, and that every way
 * of failing to satisfy one is distinguishable from success. A vocabulary that
 * silently accepts an unknown name has the same failure mode as the bug it
 * replaced.
 */

const evidence = (modelFeatures: readonly string[], qualifiedTaskClasses: readonly string[]) =>
  ({ modelFeatures, qualifiedTaskClasses });

test("the two vocabularies do not intersect, which is why a join was needed", () => {
  const overlap = (observedModelFeatureCapabilities as readonly string[]).filter((name) =>
    (taskClassCapabilities as readonly string[]).includes(name));
  assert.deepEqual(overlap, [], "a name in both vocabularies would make its evidence ambiguous");
});

test("task classes are the closed half and everything else is a model feature", () => {
  assert.equal(capabilityKind("typescript"), "task-class");
  assert.equal(capabilityKind("tool-call"), "model-feature");
  // A feature models.dev has not published yet, and a plain typo, are both
  // model features. Neither is admitted by that: each is matched against the
  // model's own catalogue entry and refuses when absent. Treating an
  // unrecognised name as its own category needed a hardcoded feature list,
  // which would have refused the entire catalogue the day a feature was added.
  assert.equal(capabilityKind("vision"), "model-feature");
  assert.equal(capabilityKind("tool-calll"), "model-feature");
  // Task-class membership is exact: a near-miss is not a task class, so it can
  // never be satisfied by a qualification record.
  assert.equal(capabilityKind("TypeScript"), "model-feature");
  assert.equal(capabilityKind(" typescript"), "model-feature");
});

test("a requirement is split by vocabulary, deduplicated and ordered", () => {
  const split = splitCapabilityRequirement(["typescript", "tool-call", "vision", "typescript"]);
  assert.deepEqual(split.modelFeatures, ["tool-call", "vision"]);
  assert.deepEqual(split.taskClasses, ["typescript"]);
});

test("a model feature is satisfied by catalogue evidence and nothing else", () => {
  assert.ok(satisfiesCapabilities(["tool-call"], evidence(["tool-call"], [])));
  const unmet = unmetCapabilities(["tool-call"], evidence([], ["typescript", "node-test"]));
  assert.deepEqual(unmet.missingModelFeatures, ["tool-call"],
    "earning every task class must not supply a model feature");
});

test("a task class is satisfied by qualification and nothing else", () => {
  assert.ok(satisfiesCapabilities(["typescript"], evidence([], ["typescript"])));
  const unmet = unmetCapabilities(["typescript"], evidence([...observedModelFeatureCapabilities], []));
  assert.deepEqual(unmet.unqualifiedTaskClasses, ["typescript"],
    "holding every catalogue feature must not supply a task class");
});

test("neither vocabulary can borrow the other's evidence, in either direction", () => {
  // The single property the whole split exists to guarantee. A route that is
  // strong on one axis and absent on the other must fail on the absent one.
  const featuresOnly = evidence([...observedModelFeatureCapabilities], []);
  const classesOnly = evidence([], [...taskClassCapabilities]);
  assert.equal(satisfiesCapabilities(["typescript"], featuresOnly), false);
  assert.equal(satisfiesCapabilities(["tool-call"], classesOnly), false);
});

test("a capability nothing advertises refuses and is never silently satisfied", () => {
  // The bug's own shape: a requirement that matches nothing must refuse, not
  // pass. A route holding every observed feature and every task class still
  // fails a name it does not hold, and fails it as a missing model feature
  // rather than being waved through.
  const everything = evidence([...observedModelFeatureCapabilities], [...taskClassCapabilities]);
  assert.equal(satisfiesCapabilities(["invented-capability"], everything), false);
  assert.deepEqual(
    unmetCapabilities(["invented-capability"], everything).missingModelFeatures,
    ["invented-capability"],
  );
});

test("an empty requirement is satisfied by an empty route", () => {
  // Not a permissive default by accident: requiring nothing is a real request
  // and must succeed, or every unconstrained dispatch would refuse.
  assert.ok(satisfiesCapabilities([], evidence([], [])));
});

test("every task class the graph's work packets declare is in the vocabulary", () => {
  // The vocabulary is closed, so a packet naming a class it does not contain
  // would refuse every route. These are the nine the graph actually declares.
  for (const declared of ["typescript", "node-test", "provider-routing", "rdf-semantics",
    "cli-design", "semantic-evaluation", "process-lifecycle", "technical-writing", "semantic-review"]) {
    assert.equal(capabilityKind(declared), "task-class", `${declared} must be a known task class`);
  }
});

// ---- stored qualification records -------------------------------------------

async function repositoryWith(records: readonly Readonly<Record<string, unknown>>[]): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "usf-qualification-"));
  const directory = resolve(root, ".usf", "qualifications");
  await mkdir(directory, { recursive: true });
  // The observer binds a record against the qualification authority in force,
  // so the fixture root carries the real one rather than a convenient copy.
  await mkdir(resolve(root, "config"), { recursive: true });
  await writeFile(resolve(root, "config/qualification.json"),
    await readFile(resolve(repositoryRoot, "config/qualification.json"), "utf8"), "utf8");
  let index = 0;
  for (const record of records) {
    await writeFile(resolve(directory, `record-${index++}.json`), JSON.stringify(record), "utf8");
  }
  return root;
}

const qualificationConfig = JSON.parse(
  await readFile(resolve(repositoryRoot, "config/qualification.json"), "utf8"),
) as { suite: Parameters<typeof createQualificationSuite>[0]; policy: Parameters<typeof createQualificationPolicy>[0] };
const currentSuite = createQualificationSuite(qualificationConfig.suite);
const currentPolicy = createQualificationPolicy(qualificationConfig.policy);

const past = "2000-01-01T00:00:00.000Z";
const route = { provider: "groq", model: "qwen/qwen3.6-27b" };
const record = (over: Readonly<Record<string, unknown>> = {}) => {
  const on = (over.route as typeof route | undefined) ?? route;
  return {
    status: "ok", role: "PATCH_PRODUCER", taskClass: "typescript",
    route: on, ...over,
    qualification: {
      inputs: {
        corpusDigest: currentSuite.corpusDigest,
        qualificationPolicyDigest: currentPolicy.policyDigest,
      },
      // Evidence follows the route it is filed under unless a case overrides it.
      profile: { requested: on, actual: on },
      ...(over.qualification as Record<string, unknown> | undefined ?? {}),
    },
  };
};

test("a current record grants exactly its own task class to its own route", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([record()]));
  assert.deepEqual([...observed.byRoute.keys()], ["groq:qwen/qwen3.6-27b"]);
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["typescript"]);
});

/**
 * The freshness repair, asserted from both sides.
 *
 * A qualification used to expire fifteen minutes after it was earned. That
 * number was copied from probe freshness in the same commit that introduced it,
 * and the two are different kinds of fact: whether a route is answering right
 * now decays, whether a model demonstrated competence at a task class does not.
 * The routing replay had decided it by identity all along and never consulted
 * the clock; this observer is what disagreed.
 */
test("elapsed time alone does not withdraw a qualification", async () => {
  // A record that would have been long expired under the old window, carrying
  // an ageing expiresAt the observer no longer reads at all.
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([record({ expiresAt: past, evaluatedAt: past, observedAt: past })]));
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["typescript"]);
  assert.equal(observed.supersededCount, 0, "age is not supersession");
});

test("a changed corpus supersedes the qualification earned under the old one", async () => {
  // Changing any grader, prompt or case changes the corpus digest, so a verdict
  // earned under the previous meaning of the task class stops counting. This is
  // the invalidation that matters, and it names itself.
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    record({ qualification: { inputs: { corpusDigest: `sha256:${"0".repeat(64)}`, qualificationPolicyDigest: currentPolicy.policyDigest }, profile: { requested: route, actual: route } } }),
  ]));
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.supersededCount, 1);
});

test("a changed policy supersedes the qualification earned under the old thresholds", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    record({ qualification: { inputs: { corpusDigest: currentSuite.corpusDigest, qualificationPolicyDigest: `sha256:${"1".repeat(64)}` }, profile: { requested: route, actual: route } } }),
  ]));
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.supersededCount, 1);
});

test("a record carrying no bound identity proved nothing checkable and is refused", async () => {
  // Not superseded -- inadmissible. There is no contract to compare it against,
  // and admitting it at any strength would let a writable file decide the
  // outcome. This is also what retires every record written under the old shape.
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    { status: "ok", role: "PATCH_PRODUCER", taskClass: "typescript", route, expiresAt: "2099-01-01T00:00:00.000Z" },
  ]));
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.supersededCount, 0);
  assert.equal(observed.recordCount, 1);
});

test("evidence produced by another model cannot be indexed under this route", async () => {
  // The record names one route and the evidence names another. Whichever is the
  // mistake, the pair is not evidence for the route it is filed under.
  const other = { provider: "groq", model: "openai/gpt-oss-120b" };
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    record({ qualification: { inputs: { corpusDigest: currentSuite.corpusDigest, qualificationPolicyDigest: currentPolicy.policyDigest }, profile: { requested: route, actual: other } } }),
  ]));
  assert.equal(observed.byRoute.size, 0);
});

test("the admitted basis is reported, so what was required is inspectable", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([record()]));
  assert.equal(observed.basis.corpusDigest, currentSuite.corpusDigest);
  assert.equal(observed.basis.qualificationPolicyDigest, currentPolicy.policyDigest);
  assert.equal(observed.basis.suiteId, currentSuite.suiteId);
  assert.equal(observed.basis.suiteVersion, currentSuite.suiteVersion);
});

test("UNQUALIFIED is a recorded fact and not a capability", async () => {
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([record({ role: "UNQUALIFIED" })]));
  assert.equal(observed.byRoute.size, 0);
});

test("a failed, malformed or unparseable record grants nothing", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    record({ status: "failed" }),
    record({ taskClass: "not-a-task-class" }),
    record({ route: { provider: "groq" } }),
  ]));
  assert.equal(observed.byRoute.size, 0, "no partial credit from a defective record");
});

test("a record may not grant a model feature under the guise of a task class", async () => {
  // `tool-call` is a real capability name, but of the wrong kind. Accepting it
  // here would let a stored file mint catalogue evidence -- the one direction
  // of borrowing a writable record could actually achieve.
  const observed = await observeQualifiedTaskClasses(
    await repositoryWith([record({ taskClass: "tool-call" })]));
  assert.equal(observed.byRoute.size, 0);
});

test("records accumulate per route and stay sorted and duplicate-free", async () => {
  const observed = await observeQualifiedTaskClasses(await repositoryWith([
    record({ taskClass: "typescript" }),
    record({ taskClass: "node-test" }),
    record({ taskClass: "typescript" }),
    record({ taskClass: "cli-design", route: { provider: "cohere", model: "north-mini-code-1-0" } }),
  ]));
  assert.deepEqual(observed.byRoute.get("groq:qwen/qwen3.6-27b"), ["node-test", "typescript"]);
  assert.deepEqual(observed.byRoute.get("cohere:north-mini-code-1-0"), ["cli-design"]);
});

test("a repository with no qualification directory reports evaluated and empty", async () => {
  // Evaluated-and-none must be distinguishable from not-evaluated, or an empty
  // result would be read as an unknown one and then guessed at.
  const observed = await observeQualifiedTaskClasses(await repositoryWith([]));
  assert.equal(observed.evaluated, true);
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.recordCount, 0);
});

test("absent qualification authority admits nothing and still reports evaluated", async () => {
  // A root with no config/qualification.json has no contract to bind a record
  // against, so a record that would otherwise be admitted is inadmissible. The
  // result is evaluated-and-none, never unknown.
  const root = await mkdtemp(resolve(tmpdir(), "usf-qualification-bare-"));
  await mkdir(resolve(root, ".usf", "qualifications"), { recursive: true });
  await writeFile(resolve(root, ".usf", "qualifications", "r.json"), JSON.stringify(record()), "utf8");
  const observed = await observeQualifiedTaskClasses(root);
  assert.equal(observed.evaluated, true);
  assert.equal(observed.recordCount, 1);
  assert.equal(observed.byRoute.size, 0);
  assert.equal(observed.basis.corpusDigest, "");
});

/**
 * Adversarial proof that the qualification gate is load-bearing on the path
 * Hermes dispatches through.
 *
 * Every property above held before this was written, and constrained nothing:
 * the map of earned task classes was an optional input, and two of the three
 * production callers of the route universe simply did not pass it -- including
 * `graph execute`, the only path `hermes implement` dispatches through. So a
 * qualification model with thirteen proven properties derived every candidate
 * with an empty earned set. The field is required now, which is why the two
 * omissions became compiler errors rather than a finding somebody had to notice.
 */
test("a task class constrains the derived universe, and its absence refuses", () => {
  const catalogueModel = {
    route: { provider: "groq", model: "m" },
    underlying: { family: "f", model: "m" },
    capabilityNames: ["reasoning"],
    cost: { input: 0, output: 0, currency: "USD", unit: "per-million-tokens" },
    limits: { context: 100_000, output: 8_000, input: null },
    modalities: { input: ["text"], output: ["text"] },
  };
  const universeInput = (qualified: ReadonlyMap<string, readonly string[]>) => ({
    snapshot: {
      schema: "urn:usf:model-catalogue:1",
      source: "models.dev/api.json",
      rawDigest: `sha256:${"a".repeat(64)}`,
      normalizedDigest: `sha256:${"b".repeat(64)}`,
      providers: [{
        providerRoute: "groq", name: "Groq",
        adapter: { package: "@ai-sdk/groq", installedVersion: "1" },
        credentialNames: ["GROQ_API_KEY"],
        models: [catalogueModel],
      }],
      denominators: {},
      nonclaims: [],
    } as unknown as Parameters<typeof deriveRouteUniverse>[0]["snapshot"],
    installedAdapterPackages: ["@ai-sdk/groq"],
    suppliedCredentialNames: ["GROQ_API_KEY"],
    authorizations: [{
      transport: "vercel-ai-sdk" as const, provider: "groq", entitlement: "free-quota",
      basis: "operator-declared-free-tier", maximumPaidCostUsd: 0,
      evidence: "documented free tier", sourceDocumentation: "https://example.invalid",
      accountBasis: "trial", permittedCostClasses: ["zero-price"], paidSpendPermitted: false,
    }],
    policy: {
      maximumPaidCost: 0, paidFallback: "prohibited", unknownPrice: "ineligible",
      acceptedCostClasses: ["free-quota", "zero-price", "subscription-included"],
    },
    requirement: { requiredCapabilities: ["typescript"], minimumContextTokens: null, minimumOutputTokens: null },
    observedAvailableRouteIds: [],
    localAgentCapabilities: [],
    qualifiedTaskClassesByRoute: qualified,
  });

  // No qualification: the model is authorized, capable and refused, because the
  // work asks for a task class this route has not earned.
  const withoutQualification = deriveRouteUniverse(universeInput(new Map()));
  assert.deepEqual(withoutQualification.candidates.map((entry) => entry.candidateId), []);

  // The exact route earns it and becomes a candidate. Nothing else changed.
  const withQualification = deriveRouteUniverse(universeInput(new Map([["groq:m", ["typescript"]]])));
  assert.deepEqual(withQualification.candidates.map((entry) => entry.candidateId), ["vercel-ai-sdk:groq:m"]);
  assert.deepEqual(withQualification.candidates[0]?.qualifiedTaskClasses, ["typescript"]);

  // A different task class on the same route earns nothing for this work.
  const wrongClass = deriveRouteUniverse(universeInput(new Map([["groq:m", ["node-test"]]])));
  assert.deepEqual(wrongClass.candidates.map((entry) => entry.candidateId), []);

  // The same task class on a sibling model earns nothing for this one.
  const wrongModel = deriveRouteUniverse(universeInput(new Map([["groq:other", ["typescript"]]])));
  assert.deepEqual(wrongModel.candidates.map((entry) => entry.candidateId), []);
});

/**
 * Adversarial proof for the Antigravity worker turn.
 *
 * A route that answers every time and produces nothing usable is the one failure
 * the transport layer cannot report, so the mode it runs in is pinned and
 * asserted rather than left to a default.
 */
test("the antigravity worker turn pins accept-edits and never plan mode", () => {
  const argv = antigravityCliArguments("do the work", "gpt-oss-120b-medium");
  const mode = argv[argv.indexOf("--mode") + 1];
  assert.equal(mode, "accept-edits");
  assert.notEqual(mode, "plan");
  assert.equal(argv.includes("plan"), false);
  // The rest of the turn stays bounded: one printed answer, structured output,
  // sandboxed, and an explicit model because the transport's default carries its
  // own quota.
  assert.equal(argv.includes("--print"), true);
  assert.deepEqual(argv.slice(argv.indexOf("--output-format"), argv.indexOf("--output-format") + 2), ["--output-format", "stream-json"]);
  assert.equal(argv.includes("--sandbox"), true);
  assert.equal(argv[argv.indexOf("--model") + 1], "gpt-oss-120b-medium");
  // Exactly one mode is named, so no later argument can override it.
  assert.equal(argv.filter((entry) => entry === "--mode").length, 1);
});

/**
 * Adversarial proof that the presented CLI surface and the dispatching one agree.
 *
 * Help is a hand-maintained table and the dispatcher is what actually parses, so
 * they are two statements of one surface and nothing forced them to match. They
 * did not. `probe qualify` was implemented, reachable, and the command's own
 * refusal message named it -- while help offered only availability and semantic,
 * so the live qualification path was undiscoverable from the CLI that carries it.
 * `profile build`, `export` and `import` were implemented and registered in the
 * graph and likewise absent.
 *
 * This does not turn help into a derived projection; that is a redesign. It makes
 * the second statement provably consistent with the first, which is the part that
 * was missing.
 */
test("every subcommand the dispatcher accepts is presented, and every presented one dispatches", async () => {
  const commandSource = await readFile(resolve(repositoryRoot, "src/commands/probe.ts"), "utf8");
  const profileSource = await readFile(resolve(repositoryRoot, "src/commands/profile.ts"), "utf8");
  const helpSource = await readFile(resolve(repositoryRoot, "src/commands/help.ts"), "utf8");

  /**
   * What the handler accepts. An explicit allowlist array is preferred where one
   * exists, because it is the handler's own complete statement; scraping the
   * equality chain is the fallback and cannot see a fallthrough default, which is
   * exactly how `profile status` reads as unaccepted when it is the default.
   */
  const accepted = (source: string): readonly string[] => {
    const allowlist = /const operations = \[([^\]]+)\] as const;/u.exec(source);
    if (allowlist !== null) {
      return Object.freeze([...new Set([...(allowlist[1] as string).matchAll(/"([a-z-]+)"/gu)].map((m) => m[1] as string))].sort());
    }
    return Object.freeze([...new Set([
      ...[...source.matchAll(/operation === "([a-z-]+)"/gu)].map((m) => m[1] as string),
      ...[...source.matchAll(/operation !== "([a-z-]+)"/gu)].map((m) => m[1] as string),
    ])].sort());
  };

  // What help presents is the alternation in its own synopsis lines.
  const presented = (command: string): readonly string[] => {
    const found = new Set<string>();
    for (const match of helpSource.matchAll(new RegExp(String.raw`usf ${command} (?:<([a-z|-]+)>|([a-z][a-z-]*))`, "gu"))) {
      if (match[1] !== undefined) for (const part of match[1].split("|")) found.add(part);
      else if (match[2] !== undefined) found.add(match[2]);
    }
    return Object.freeze([...found].sort());
  };

  for (const [command, source] of [["probe", commandSource], ["profile", profileSource]] as const) {
    const dispatches = accepted(source);
    const shown = presented(command);
    assert.ok(dispatches.length > 0, `${command} accepts at least one operation`);
    assert.deepEqual(
      dispatches.filter((operation) => !shown.includes(operation)), [],
      `${command}: implemented and reachable but absent from help`,
    );
    assert.deepEqual(
      shown.filter((operation) => !dispatches.includes(operation)), [],
      `${command}: presented in help but not accepted by the handler`,
    );
  }
});

/**
 * Adversarial proof for the external CLI argv Hermes constructs.
 *
 * A flag the binary rejects fails the whole route as a usage error, and the mode
 * a flag selects can make a route answer every time while producing nothing --
 * which is how one transport spent 606 619 output tokens across 20 successful
 * invocations for zero accepted results. Neither failure is visible in the
 * transport layer, so the argv is asserted here against the shape each installed
 * CLI documents, recorded at claude 2.1.251, codex-cli 0.152.0 and agy 1.1.26.
 */
test("every constructed provider argv names only flags and values the CLI documents", () => {
  const claude = claudeCliArguments("work", "claude-haiku-4-5-20251001");
  assert.deepEqual([...claude], ["-p", "work", "--output-format", "json", "--model", "claude-haiku-4-5-20251001"]);
  // json is one of exactly text, json and stream-json; --max-turns is not a flag
  // this CLI has, and reintroducing it would fail the route.
  assert.equal(claude.includes("--max-turns"), false);
  assert.equal(claude[claude.indexOf("--output-format") + 1], "json");
  // Omitting the model is permitted by the CLI and refused here: the transport's
  // default carries its own quota and is not the model the operator chose.
  assert.deepEqual([...claudeCliArguments("work", null)], ["-p", "work", "--output-format", "json"]);

  const agy = antigravityCliArguments("work", "gpt-oss-120b-medium");
  assert.equal(agy[agy.indexOf("--mode") + 1], "accept-edits");
  assert.equal(agy.includes("plan"), false);
  assert.equal(agy[agy.indexOf("--output-format") + 1], "stream-json");
  assert.equal(agy.filter((entry) => entry === "--mode").length, 1);

  const codex = codexModelSelection("gpt-5.3-codex-spark@medium");
  // The effort is always explicit: exec inherits the operator's config.toml
  // otherwise, which is how single worker units burned a million reasoning
  // tokens. A declared model@effort suffix selects it; anything else takes low.
  assert.equal(codex.effort, "medium");
  assert.equal(codex.model, "gpt-5.3-codex-spark");
  assert.equal(codexModelSelection(null).effort, "low");
  assert.equal(codexModelSelection("gpt-5.6-sol").effort, "low");
});
