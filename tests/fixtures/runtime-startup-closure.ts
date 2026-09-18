import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";
import ts from "typescript";
import { loadSemanticGraph, objectValues, validationRuntimeClosure } from "../../src/graph/index.ts";
import { deriveWork, type WorkPacket } from "../../src/graph/work.ts";
import { candidateScope } from "../../src/realisation/index.ts";

/** Startup edges only: no claim about dynamic imports, package loading or data reads. */
export function staticRuntimeSpecifiers(path: string, source: string): readonly string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  assert.equal(diagnostics.length, 0, `Invalid startup source: ${path}`);
  const specifiers = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isImportEqualsDeclaration(statement)) {
      assert.ok(statement.isTypeOnly, `Unsupported runtime import assignment: ${path}`);
    }
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const bindings = clause?.namedBindings;
      if (clause?.name === undefined && bindings !== undefined && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every(binding => binding.isTypeOnly)) continue;
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier), `Nonliteral static import: ${path}`);
      specifiers.add(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)
        && clause.elements.length > 0 && clause.elements.every(binding => binding.isTypeOnly)) continue;
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier), `Nonliteral static re-export: ${path}`);
      specifiers.add(statement.moduleSpecifier.text);
    }
  }
  return [...specifiers].sort();
}

/** Extract this fixture's actual inline declaration without importing or executing its tests. */
export function syntheticSecondaryClosureFiles(source: string): readonly string[] {
  const file = ts.createSourceFile("workspace.test.ts", source, ts.ScriptTarget.Latest, false);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  assert.equal(diagnostics.length, 0, "Invalid synthetic fixture source");
  const title = "integration consumes each graph-required validation exactly once in canonical order";
  const calls: ts.CallExpression[] = [];
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    const name = call.arguments[0];
    if (ts.isIdentifier(call.expression) && call.expression.text === "test"
      && name !== undefined && ts.isStringLiteral(name) && name.text === title) calls.push(call);
  }
  assert.equal(calls.length, 1, "Expected exactly one named synthetic fixture callback");
  assert.equal(calls[0]!.arguments.length, 2, "Unexpected synthetic fixture test signature");
  const callback = calls[0]!.arguments[1]!;
  assert.ok((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && ts.isBlock(callback.body),
    "Synthetic fixture must have an inline callback block");
  const arrays: ts.Expression[] = [];
  for (const statement of callback.body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const push = statement.expression;
    if (!ts.isPropertyAccessExpression(push.expression) || push.expression.name.text !== "push"
      || !ts.isIdentifier(push.expression.expression) || push.expression.expression.text !== "statements") continue;
    for (const argument of push.arguments) {
      if (!ts.isSpreadElement(argument) || !ts.isCallExpression(argument.expression)) continue;
      const map = argument.expression;
      if (!ts.isPropertyAccessExpression(map.expression) || map.expression.name.text !== "map") continue;
      const mapper = map.arguments[0];
      if (mapper === undefined || !ts.isArrowFunction(mapper) || !ts.isTemplateExpression(mapper.body)) continue;
      const template = mapper.body;
      const subject = template.templateSpans[0];
      if (subject === undefined || !ts.isIdentifier(subject.expression) || subject.expression.text !== "secondaryClosure"
        || subject.literal.text !== "> <urn:usf:predicate:repositoryReadFile> ") continue;
      assert.equal(map.arguments.length, 1, "Unexpected synthetic closure map arguments");
      assert.equal(mapper.parameters.length, 1, "Unexpected synthetic closure map parameters");
      const parameter = mapper.parameters[0]!.name;
      assert.ok(ts.isIdentifier(parameter), "Synthetic closure map must bind one path identifier");
      assert.equal(template.head.text, "<", "Unexpected synthetic closure subject template");
      assert.equal(template.templateSpans.length, 3, "Unexpected synthetic closure statement template");
      const object = template.templateSpans[1]!;
      assert.ok(ts.isCallExpression(object.expression) && ts.isPropertyAccessExpression(object.expression.expression)
        && ts.isIdentifier(object.expression.expression.expression) && object.expression.expression.expression.text === "JSON"
        && object.expression.expression.name.text === "stringify" && object.expression.arguments.length === 1
        && ts.isIdentifier(object.expression.arguments[0]!) && object.expression.arguments[0]!.text === parameter.text,
      "Synthetic closure must serialize the mapped path directly");
      const graph = template.templateSpans[2]!;
      assert.ok(object.literal.text === " <" && ts.isIdentifier(graph.expression)
        && graph.expression.text === "graph" && graph.literal.text === "> .",
      "Unexpected synthetic closure graph template");
      arrays.push(map.expression.expression);
    }
  }
  assert.equal(arrays.length, 1, "Expected exactly one secondaryClosure repositoryReadFile map");
  const array = arrays[0]!;
  assert.ok(ts.isArrayLiteralExpression(array), "Synthetic closure must use a literal array");
  assert.ok(array.elements.length > 0 && array.elements.length <= 128,
    "Synthetic closure requires 1 to 128 literal files");
  const paths = array.elements.map(element => {
    assert.ok(ts.isStringLiteral(element), "Synthetic closure requires literal file paths");
    return exactPath(element.text);
  });
  assert.equal(new Set(paths).size, paths.length, "Synthetic closure file paths must be unique");
  return Object.freeze(paths);
}

function exactPath(path: string): string {
  assert.ok(path.length > 0 && path !== "." && !path.startsWith("/") && path !== ".."
    && !path.startsWith("../") && !path.endsWith("/") && !/[\\*?\[\]\u0000]/u.test(path)
    && posix.normalize(path) === path, `Expected an exact repository file path: ${path}`);
  return path;
}

export interface MissingStartupDependency {
  readonly from: string;
  readonly specifier: string;
  readonly missing: string;
}

/** Parse each reached source once, but recheck admission on every walk. */
export function createStartupWalker(readSource: (path: string) => string) {
  const parsed = new Map<string, readonly string[]>();
  return (entries: readonly string[], available: ReadonlySet<string>) => {
    for (const path of available) exactPath(path);
    const visited = new Set<string>();
    const missing: MissingStartupDependency[] = [];
    const pending = entries.map(path => ({ from: "<entry>", specifier: path, target: exactPath(path) }));
    while (pending.length > 0) {
      const edge = pending.pop()!;
      if (!available.has(edge.target)) {
        missing.push({ from: edge.from, specifier: edge.specifier, missing: edge.target });
        continue;
      }
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/u.test(edge.target)) continue;
      let specifiers = parsed.get(edge.target);
      if (specifiers === undefined) {
        specifiers = staticRuntimeSpecifiers(edge.target, readSource(edge.target));
        parsed.set(edge.target, specifiers);
      }
      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) continue;
        const target = exactPath(posix.join(posix.dirname(edge.target), specifier));
        pending.push({ from: edge.target, specifier, target });
      }
    }
    return {
      visited: [...visited].sort(),
      missing: missing.sort((a, b) => `${a.from}\0${a.specifier}`.localeCompare(`${b.from}\0${b.specifier}`)),
    };
  };
}

export interface StartupSelection {
  readonly manifestPath: string;
  readonly profile: string;
  readonly work: string;
  readonly validation: string;
}

/** Read-only test projection; never creates a candidate, receipt or authority. */
export function createRuntimeStartupAudit(repositoryRoot: string) {
  const graphs = new Map<string, ReturnType<typeof loadSemanticGraph>>();
  const packets = new Map<string, WorkPacket>();
  const walk = createStartupWalker(path => readFileSync(resolve(repositoryRoot, path), "utf8"));

  function graphFor(manifestPath: string) {
    let graph = graphs.get(manifestPath);
    if (graph === undefined) {
      graph = loadSemanticGraph(repositoryRoot, manifestPath);
      graphs.set(manifestPath, graph);
    }
    return graph;
  }

  // Expand only paths supplied by the actual candidate/fixture selection.
  // Missing optional write preimages do not materialize source files.
  function materializedFiles(paths: Iterable<string>): Set<string> {
    const files = new Set<string>();
    const visited = new Set<string>();
    const pending = [...paths];
    while (pending.length > 0) {
      const path = exactPath(pending.pop()!.replace(/\/$/u, ""));
      if (visited.has(path)) continue;
      visited.add(path);
      let metadata;
      try { metadata = lstatSync(resolve(repositoryRoot, path)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      assert.equal(metadata.isSymbolicLink(), false, `Materialized source cannot be a symlink: ${path}`);
      if (metadata.isDirectory()) {
        for (const name of readdirSync(resolve(repositoryRoot, path)).sort()) pending.push(`${path}/${name}`);
      } else {
        assert.ok(metadata.isFile(), `Materialized source must be a regular file: ${path}`);
        files.add(path);
      }
    }
    return files;
  }

  function view(selection: StartupSelection) {
    const graph = graphFor(selection.manifestPath);
    const key = `${selection.manifestPath}\0${selection.profile}\0${selection.work}`;
    let work = packets.get(key);
    if (work === undefined) {
      const result = deriveWork(graph, { selector: selection.work, profile: selection.profile, maxItems: 1 });
      assert.equal(result.status, "ok", `${selection.work}: ${result.reasonCode}`);
      assert.equal(result.items?.length, 1, selection.work);
      work = result.items![0]!;
      packets.set(key, work);
    }
    const basis = work.realisationBasis;
    assert.ok(basis, `Missing selected basis: ${selection.work}`);
    assert.ok(work.validationPlan.some(item => item.id === selection.validation),
      `Validation is not selected by this work: ${selection.validation}`);
    const closure = validationRuntimeClosure(graph, selection.validation);
    assert.ok(closure.id, `Missing runtime closure: ${selection.validation}`);
    const commands = objectValues(graph, selection.validation, "urn:usf:predicate:command");
    assert.equal(commands.length, 1, selection.validation);
    const tokens = commands[0]!.split(" ");
    assert.deepEqual(tokens.slice(0, 2), ["node", "--test"], selection.validation);
    const entries = tokens.filter(token => token.endsWith(".test.ts")).map(exactPath);
    assert.ok(entries.length > 0, `Missing exact startup test entries: ${selection.validation}`);
    const candidateFiles = materializedFiles(candidateScope(basis));
    const supplementalFiles = materializedFiles(closure.repositoryReadFiles);
    assert.equal(supplementalFiles.size, closure.repositoryReadFiles.length,
      `Runtime closure must contain existing exact files: ${closure.id}`);
    const files = new Set([...candidateFiles, ...supplementalFiles]);
    return { graph, work, basis, closure, candidateFiles, files, entries };
  }

  return { view, walk, graphFor, materializedFiles };
}
