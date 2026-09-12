import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, sep } from "node:path";
import { deriveCliTransitionCoverage } from "../../src/graph/cli-transitions.ts";
import { inspectTransition, observationTransitionAdapters, transitionAdaptersForCoverage } from "../../src/commands/transition.ts";

test("installed transition inspect reduces native operational gaps on a genuinely authorised root without effects", {
  skip: process.env.USF_REPOSITORY_ROOT !== undefined && "the direct lane owns isolated construction publication and CLI subprocesses",
}, async (t) => {
  const { cp, mkdir, mkdtemp, readdir, chmod, rm, writeFile } = await import("node:fs/promises");
  const { spawnSync, execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } = await import("../../src/commands/construction-authority.ts");
  const native = await import("../../src/commands/work-completion.ts");
  const { inspectLocalContribution } = await import("../../src/collaboration/local-contribution.ts");
  const { loadSemanticGraph } = await import("../../src/graph/index.ts");
  const { canonicalJson } = await import("../../src/core/canonical.ts");
  const canonicalRoot = fileURLToPath(new URL("../../", import.meta.url));
  const temporaryRoot = process.env.TMPDIR ?? join(canonicalRoot, ".usf/tmp");
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(join(temporaryRoot, "installed-native-frontier-"));
  const root = join(parent, "repository");
  await mkdir(root, { mode: 0o700 });
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const profile = "urn:usf:profile:cli-transition-definition:1";
  try {
    for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
      // The fixture is a clean source checkout. Generated artifacts and
      // retained evidence are runtime/candidate state, not source inputs.
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")
        || entry.name === "artifacts") continue;
      if (entry.name === "evidence") {
        // The fixture publishes its own freshly derived construction authority.
        // Copying the developer's historical receipt directory would create an
        // ambiguous publication state instead of a clean pre-publication root.
        await mkdir(join(root, "evidence/construction-authority"), { recursive: true, mode: 0o700 });
        await cp(join(canonicalRoot, "evidence/semantic-first-bootstrap-admission.json"), join(root, "evidence/semantic-first-bootstrap-admission.json"), { verbatimSymlinks: true });
        continue;
      }
      await cp(join(canonicalRoot, entry.name), join(root, entry.name), { recursive: true });
    }
    // Retained construction publication output is not clean pre-publication
    // fixture input. Leaving any of it in place makes the fresh publication
    // correctly refuse as partial state.
    //
    // A publication emits three record kinds together -- the grant, the
    // ProofResult that authorised it and the Evidence that produced it -- so
    // all three have to go. Removing only the grant used to look sufficient
    // because the retained Evidence and ProofResult were derived against older
    // bases and could not satisfy the current one. The moment a publication
    // lands on the current basis that stops being true: the fixture keeps
    // current-basis Evidence and ProofResult with no grant, which is exactly
    // the partial state the publisher refuses. Strip the whole stage.
    const grantsPath = join(root, "graph/cli-transition-definition-grants.nq");
    const grants = readFileSync(grantsPath, "utf8");
    const constructionPublicationSubjects = [
      "<urn:usf:grant:construction-authority:",
      "<urn:usf:proof-result:construction:",
      "<urn:usf:evidence:construction:",
    ];
    await writeFile(grantsPath, grants.split("\n")
      .filter(line => !constructionPublicationSubjects.some(subject => line.includes(subject)))
      .join("\n"));
    for (const path of ["node_modules"]) {
      const source = join(canonicalRoot, path);
      assert.equal(lstatSync(source).isSymbolicLink(), false, "fixture dependencies must be physical: " + path);
      await mkdir(join(root, path), { recursive: true, mode: 0o700 });
      await cp(source, join(root, path), { recursive: true, verbatimSymlinks: true });
      await chmod(join(root, path), 0o700);
    }
    // The CLI requires an owner-contained cache mount, not the developer's
    // mutable cache contents. Keeping it empty also prevents runtime state
    // from becoming an implicit clean-clone fixture dependency.
    for (const path of [
      ".usf", ".usf/cache", ".usf/candidates", ".usf/candidates/construction-authority",
    ]) await mkdir(join(root, path), { recursive: true, mode: 0o700 });
    const virtualStore = ".usf/cache/pnpm-virtual-store";
    await cp(join(canonicalRoot, virtualStore), join(root, virtualStore), { recursive: true, verbatimSymlinks: true });
    await chmod(join(root, virtualStore), 0o700);
    const assertContainedLinks = (entry: string) => {
      const stat = lstatSync(entry);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(entry);
        const relation = relative(root, target);
        assert.ok(!isAbsolute(relation) && relation !== ".." && !relation.startsWith(".." + sep),
          "copied dependency symlink must resolve within the fixture: " + relative(root, entry));
      } else if (stat.isDirectory()) {
        for (const child of readdirSync(entry).sort()) assertContainedLinks(join(entry, child));
      }
    };
    for (const path of ["node_modules", ".usf/cache"]) assertContainedLinks(join(root, path));
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const snapshot = () => {
      const rows: unknown[] = [];
      const visit = (path: string) => {
        const absolute = join(root, path), stat = lstatSync(absolute);
        rows.push({ path, dev: stat.dev, ino: stat.ino, mode: stat.mode, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs,
          digest: stat.isFile() ? createHash("sha256").update(readFileSync(absolute)).digest("hex") : null,
          link: stat.isSymbolicLink() ? readlinkSync(absolute) : null });
        // Dependency mounts are immutable launcher inputs and are checked for
        // containment above; do not rehash their full contents at each
        // no-effect snapshot.
        if (path === "node_modules" || path === ".usf/cache") return;
        if (stat.isDirectory()) for (const child of readdirSync(absolute).sort()) visit(path === "" ? child : path + "/" + child);
      };
      visit("");
      return rows;
    };
    const inspect = () => {
      const result = spawnSync(join(root, "bin/usf"), ["transition", "inspect", "--root", selection.rootIdentity, "--manifest", selection.manifestPath],
        { cwd: root, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 1, result.stderr);
      const report = JSON.parse(result.stdout) as ReturnType<typeof deriveCliTransitionCoverage>;
      assert.ok(Array.isArray(report.descriptors), result.stdout);
      return report;
    };
    const beforeConstruction = snapshot();
    const refused = inspect();
    const initialGraph = loadSemanticGraph(root, selection.manifestPath);
    const expectedDescriptorCount = deriveCliTransitionCoverage(initialGraph, selection, { complete: false, leaves: [] }, observationTransitionAdapters()).descriptors.length;
    assert.equal(refused.descriptors.length, expectedDescriptorCount);
    assert.ok(refused.waves.length > 0);
    assert.equal(refused.complete, refused.diagnostics.length === 0,
      "semantic completeness must agree with the returned diagnostic set");
    assert.equal(refused.executionAuthority, "none");
    assert.equal(refused.parallelSafety.state, "unproven");
    for (const command of ["realise no-change", "check", "evidence completion", "prove completion", "publish work-completion"]) {
      const identity = inspectTransition(initialGraph, selection, command).transitionIdentity;
      const matches = refused.operationalSupport.filter(support => support.transitionIdentity === identity);
      assert.equal(matches.length, 1, command);
      const support = matches[0]!;
      assert.equal(support.lockAvailability, "not-observed");
      assert.ok(support.outcome === "current" || support.outcome === "refused" || support.outcome === "missing-prerequisite");
      if (support.outcome === "current") {
        assert.equal(support.refusalClass, undefined, "current support must not carry a refusal classification");
        assert.equal(support.refusalCode, undefined);
        assert.ok(support.derivations.length > 0, `${command} must retain authenticated native derivations`);
      } else if (support.outcome === "refused") {
        assert.equal(support.refusalClass, "unclassified", "wire classification must not invent a semantic class from a native error constructor");
        assert.equal(support.refusalCode, "INVALID_REALISATION_BASIS");
        assert.deepEqual(support.derivations, []);
      } else {
        assert.equal(support.refusalClass, undefined);
        assert.equal(support.refusalCode, undefined);
        assert.ok(Array.isArray(support.unavailableInputs) && support.unavailableInputs.length > 0,
          `${command} must retain typed missing prerequisites`);
      }
    }
    assert.equal(refused.diagnostics.some(diagnostic => diagnostic.reasonCode === "TRANSITION_OPERATIONAL_PREFLIGHT_FAILED"), false);
    assert.deepEqual(snapshot(), beforeConstruction, "typed construction refusal must retain the DAG without any fixture mutation");
    const common = ["--profile", profile, "--manifest", selection.manifestPath];
    const evidence = ".usf/candidates/construction-authority/installed-frontier-evidence.json";
    const bundle = ".usf/candidates/construction-authority/installed-frontier-bundle.json";
    await evidenceCommandHandler({ command: "evidence", repositoryRoot: root,
      args: ["construction", "--work", selection.rootIdentity, ...common, "--output", evidence] });
    await proveCommandHandler({ command: "prove", repositoryRoot: root,
      args: ["construction", "--obligation", "urn:usf:proof:cli-transition-definition:construction", "--evidence", evidence, ...common, "--output", bundle] });
    const grant = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root,
      args: ["construction-authority", "--bundle", bundle, ...common, "--apply"] });
    assert.equal((grant.output as { status: string }).status, "ok");
    const graph = loadSemanticGraph(root, selection.manifestPath);
    const baseline = deriveCliTransitionCoverage(graph, selection, { leaves: [], complete: false }, transitionAdaptersForCoverage());
    const original = snapshot();
    const report = inspect();
    // Keep the installed observation bounded; the later snapshot assertion
    // proves this inspection remains no-effect.
    assert.ok(report.descriptors.length > 0);
    assert.deepEqual(report.descriptors, baseline.descriptors);
    assert.deepEqual(report.waves, baseline.waves);
    assert.equal(report.executionAuthority, "none");
    assert.equal(report.parallelSafety.state, "unproven");
    assert.equal(report.topologicalOnly, true);
    assert.equal(report.complete, true);
    const matrix = [
      ["realise no-change", native.inspectNoChangeWork], ["check", native.inspectCompletionChecks],
      ["evidence completion", native.inspectCompletionEvidence], ["prove completion", native.inspectCanonicalCompletionProof],
      ["publish work-completion", native.inspectCanonicalCompletionPublication], ["resolve prepare-local", inspectLocalContribution],
    ] as const;
    const sorted = (values: readonly unknown[]) => values.map(value => canonicalJson(value)).sort();
    const supportedFields = new Set<string>();
    for (const [command, read] of matrix) {
      const transition = inspectTransition(graph, selection, command).transitionIdentity;
      const supports = report.operationalSupport.filter(support => support.transitionIdentity === transition);
      assert.equal(supports.length, 1, command + " must retain one native observation");
      const support = supports[0]!;
      const observed = await read(root, selection);
      assert.equal(support.implementation, "authenticated");
      assert.equal(support.lockAvailability, "not-observed");
      assert.equal(support.outcome, observed.status === "authenticated" ? "current" : "missing-prerequisite");
      assert.ok(support.derivations.length > 0, command + " must bind actual operational field derivations");
      for (const derivation of support.derivations) {
        supportedFields.add(derivation.fieldIdentity);
        assert.deepEqual(sorted(derivation.authenticatedFacts), sorted(observed.facts.map(fact => ({ factKind: fact.kind, identity: fact.identity, digest: fact.digest }))));
      }
      if (support.outcome === "missing-prerequisite") {
        assert.deepEqual(sorted(support.unavailableInputs), sorted(observed.unavailable.map(input => ({
          factKind: input.kind, identity: input.identity, state: input.state, reasonCode: input.reasonCode,
        }))));
      }
      if (command === "publish work-completion") assert.ok(observed.unavailable.some(input => input.identity === "mode"));
      if (command === "resolve prepare-local") assert.ok(observed.unavailable.some(input => input.identity === "proposedOperations"));
      assert.equal(observed.facts.some(fact => fact.kind === "candidate-workspace" || fact.kind === "check-receipt" || fact.kind === "proof-bundle"), false);
    }
    const unresolved = (value: typeof report) => new Set(value.diagnostics.filter(d => d.reasonCode === "CLI_OPERATIONAL_RULE_UNRESOLVED").map(d => d.subject));
    const before = unresolved(baseline), after = unresolved(report);
    const removed = new Set([...before].filter(field => !after.has(field)));
    const newlyExposed = new Set([...after].filter(field => !before.has(field)));
    assert.ok(removed.size > 0, "genuine current authority must reduce the operational family");
    assert.deepEqual(removed, new Set([...before].filter(field => supportedFields.has(field))));
    assert.equal(newlyExposed.size, 0, "proved-only parallel-safety fields are not active for the unproven assessment variant");
    assert.deepEqual(after, new Set([...before].filter(field => !supportedFields.has(field))), "unsupported active operational rules remain unresolved");
    assert.equal(report.parallelSafety.state, "unproven");
    assert.ok(Array.isArray(report.parallelSafety.missingObligations)
      && report.parallelSafety.missingObligations.length > 0, "unproven safety retains its explicit missing obligation");
    assert.deepEqual(snapshot(), original, "installed interrogation and native readback must not write any fixture state");
    const summary = (value: typeof report) => {
      const families: Record<string, number> = {};
      for (const diagnostic of value.diagnostics) families[diagnostic.reasonCode] = (families[diagnostic.reasonCode] ?? 0) + 1;
      return { digest: value.digest, graphDigest: value.graphDigest, descriptors: value.descriptors.length, waves: value.waves.length,
        diagnostics: value.diagnostics.length, operational: value.diagnostics.filter(d => d.reasonCode === "CLI_OPERATIONAL_RULE_UNRESOLVED").length,
        families: Object.fromEntries(Object.entries(families).sort(([left], [right]) => left.localeCompare(right))) };
    };
    t.diagnostic(JSON.stringify({ installedNativeFrontier: { beforeConstruction: summary(refused),
      withoutNativeSupport: summary(baseline), afterConstruction: summary(report),
      removedOperationalFields: [...removed].sort(), executionAuthority: report.executionAuthority,
      parallelSafety: report.parallelSafety.state } }));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
