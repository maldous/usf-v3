#!/usr/bin/env node

import { closeSync, globSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createGateChildOwner } from "./full-gate-children.ts";
import { acquireFullGateLock } from "./full-gate-lock.ts";
import { runCompletionCohort } from "./completion-throughput.ts";

const repositoryRoot = process.cwd();
const usf = resolve(repositoryRoot, "bin/usf");
const specialTest = "tests/adversarial/fixture-process-confinement.test.ts";
const completionTest = "tests/integration/work-completion.test.ts";
// These assert exclusivity, which concurrency inherently violates.
//
// The lifecycle tests require a real supervisor to reach a named event within a
// bound; run against 116 concurrent siblings, several of them minutes of solid
// CPU, it is starved and exits CONTINUOUS_DEGRADED before the event. The
// stewardship tests require that no other steward operation is active; a
// sibling test touching stewardship makes them refuse STEWARD_ACTIVITY_BUSY.
// Neither outcome says anything about the behaviour under test, and both pass
// when run alone. They keep their full coverage in a serialized phase rather
// than being skipped or relaxed.
const serialTests = Object.freeze([
  "tests/integration/lifecycle-process.test.ts",
  "tests/integration/hermes-stewardship.test.ts",
]);
const ordinaryPatterns = Object.freeze([
  "tests/unit/**/*.test.ts",
  "tests/contract/**/*.test.ts",
  "tests/integration/**/*.test.ts",
  "tests/adversarial/**/*.test.ts",
  "tests/scale/**/*.test.ts",
  "apps/**/test/**/*.test.ts",
]);
const selection = Object.freeze({
  work: "urn:usf:work:fixture-process-runtime",
  profile: "urn:usf:profile:fixture-process-runtime:1",
  manifest: "graph/manifests/fixture-process-runtime.json",
});
const expectedValidationRoutes = Object.freeze({
  "urn:usf:validation:fixture-process-native-metadata": Object.freeze({
    mode: "urn:usf:mode:confined-fixture-process:2",
    command: Object.freeze(["node", "--test", "--test-isolation=none", "--test-name-pattern=fixture-process-native-metadata", specialTest]),
  }),
  "urn:usf:validation:fixture-process-native-runtime": Object.freeze({
    mode: "urn:usf:mode:confined-fixture-process:2",
    command: Object.freeze(["node", "--test", "--test-isolation=none", "--test-name-pattern=fixture-process-confined", specialTest]),
  }),
  "urn:usf:validation:fixture-process-peer-identity": Object.freeze({
    mode: "urn:usf:mode:confined-fixture-process:2",
    command: Object.freeze(["node", "--test", "--test-isolation=none", "--test-name-pattern=fixture-process-peer-identity", specialTest]),
  }),
  "urn:usf:validation:fixture-process-runtime": Object.freeze({
    mode: "urn:usf:mode:confined-fixture-process:1",
    command: Object.freeze(["node", "--test", "--test-isolation=none", "--test-name-pattern=fixture-process-confined", specialTest]),
  }),
  "urn:usf:validation:fixture-process-runtime-default-denial": Object.freeze({
    mode: "urn:usf:mode:deterministic-test-substitute",
    command: Object.freeze(["node", "--test", "--test-isolation=none", "--test-name-pattern=fixture-process-default-denial", specialTest]),
  }),
});
const expectedValidationObligations = Object.freeze(Object.keys(expectedValidationRoutes).sort());
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const maxBuffer = 16 * 1024 * 1024;
let retainedLog = null;
let releaseFullGateLock;
let gateChildren;
const childResults = [];
const fixtureCheckResults = [];
const phaseDurations = [];
const phaseStarts = new Map();

function childStdio() {
  return ["ignore", "pipe", "pipe", ...(releaseFullGateLock === undefined ? [] : [releaseFullGateLock.descriptor])];
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function observedWrite(stream, bytes) {
  stream.write(bytes);
  if (retainedLog !== null) writeSync(retainedLog.handle, bytes);
}

function observedJson(value, stream = process.stdout) {
  observedWrite(stream, `${JSON.stringify(value)}\n`);
}

function progress(phase, details = {}) {
  if (details.status === "started") phaseStarts.set(phase, performance.now());
  if (["passed", "failed"].includes(details.status) && phaseStarts.has(phase)) {
    phaseDurations.push({ phase, status: details.status, elapsedMilliseconds: Math.round(performance.now() - phaseStarts.get(phase)) });
    phaseStarts.delete(phase);
  }
  observedJson({ schema: "urn:usf:full-gate-progress:1", phase, observedAt: new Date().toISOString(), ...details });
}

function beginRetention(mode) {
  const directory = resolve(repositoryRoot, ".usf/logs/full-gate");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const runId = `${new Date().toISOString().replaceAll(/[^0-9A-Za-z]/gu, "")}-${process.pid}`;
  const logPath = resolve(directory, `${runId}.log`);
  const reportPath = resolve(directory, `${runId}.json`);
  return Object.freeze({ mode, runId, logPath, reportPath, handle: openSync(logPath, "wx", 0o600) });
}

function finishRetention(retention, terminal) {
  observedJson(terminal, terminal.status === "passed" ? process.stdout : process.stderr);
  closeSync(retention.handle);
  retainedLog = null;
  const rawLog = readFileSync(retention.logPath);
  const report = Object.freeze({
    ...terminal,
    runId: retention.runId,
    logPath: `.usf/logs/full-gate/${retention.runId}.log`,
    logDigest: digest(rawLog),
    nonClaims: Object.freeze(["semantic-completion", "publication", "deployment"]),
  });
  const withDigest = Object.freeze({ ...report, resultDigest: digest(JSON.stringify(report)) });
  const pending = `${retention.reportPath}.pending`;
  const bytes = `${JSON.stringify(withDigest, null, 2)}\n`;
  writeFileSync(pending, bytes, { flag: "wx", mode: 0o600 });
  renameSync(pending, retention.reportPath);
  if (readFileSync(retention.reportPath, "utf8") !== bytes) throw new GateError("FULL_GATE_RESULT_NOT_RETAINED");
  process.stdout.write(`${JSON.stringify({ schema: "urn:usf:full-gate-retention:1", reportPath: `.usf/logs/full-gate/${retention.runId}.json`, resultDigest: withDigest.resultDigest })}\n`);
}

class GateError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "GateError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = {}) {
  throw new GateError(code, details);
}

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function sortedStrings(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value].sort()
    : null;
}

function equalStrings(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function ordinaryTests() {
  const matched = ordinaryPatterns.flatMap((pattern) => globSync(pattern, { cwd: repositoryRoot }));
  const unique = [...new Set(matched)].sort();
  if (!unique.includes(specialTest)) fail("FIXTURE_PROCESS_SPECIAL_TEST_MISSING");
  for (const path of serialTests) if (!unique.includes(path)) fail("SERIAL_TEST_MISSING", { path });
  const ordinary = unique.filter((path) => path !== specialTest && !serialTests.includes(path));
  if (ordinary.length + 1 + serialTests.length !== unique.length
    || ordinary.some((path) => path === specialTest || serialTests.includes(path))) {
    fail("FIXTURE_PROCESS_SPECIAL_TEST_EXCLUSION_INVALID");
  }
  return Object.freeze(ordinary);
}

async function runTestChild(arguments_, label) {
  const started = performance.now();
  const child = gateChildren.spawn(process.execPath, arguments_, { cwd: repositoryRoot, stdio: childStdio() });
  child.stdout.on("data", (chunk) => observedWrite(process.stdout, chunk));
  child.stderr.on("data", (chunk) => observedWrite(process.stderr, chunk));
  let launchError;
  const result = await new Promise((accept) => {
    child.once("error", error => { launchError = error.code ?? error.name; });
    child.once("close", (code, signal) => accept({
      label, pid: child.pid, exitCode: code ?? 1, signal,
      elapsedMilliseconds: Math.round(performance.now() - started),
      ...(launchError === undefined ? {} : { launchError }),
    }));
  });
  childResults.push(result);
  observedJson({ schema: "urn:usf:full-gate-child-result:1", ...result });
  return result;
}

async function runSerialTests() {
  const result = await runTestChild(["--test", "--test-concurrency=1", ...serialTests], "serial");
  if (result.exitCode !== 0) fail("SERIAL_TESTS_FAILED", { results: [result] });
}

async function runCapturedJson(arguments_, label) {
  const child = gateChildren.spawn(usf, arguments_, { cwd: repositoryRoot, stdio: childStdio() });
  const stdout = [], stderr = [];
  let observedBytes = 0, launchError, outputExceeded = false;
  const capture = (destination, bytes) => {
    observedBytes += bytes.length;
    if (observedBytes <= maxBuffer) destination.push(bytes);
    else { outputExceeded = true; gateChildren.abort("FULL_GATE_CHILD_OUTPUT_LIMIT"); }
  };
  child.stdout.on("data", bytes => capture(stdout, bytes));
  child.stderr.on("data", bytes => capture(stderr, bytes));
  const exitCode = await new Promise(accept => {
    child.once("error", error => { launchError = error; });
    child.once("close", code => accept(code ?? 1));
  });
  if (launchError !== undefined) fail(`${label}_LAUNCH_FAILED`, { message: launchError.message });
  if (outputExceeded) fail(`${label}_OUTPUT_LIMIT`);
  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");
  let output;
  try { output = JSON.parse(stdoutText); }
  catch {
    fail(`${label}_OUTPUT_INVALID`, { exitCode, stderr: stderrText.slice(0, 512), stdout: stdoutText.slice(0, 512) });
  }
  return Object.freeze({ exitCode, stderr: stderrText, output });
}

async function currentFixtureWork() {
  const result = await runCapturedJson([
    "work",
    "--profile", selection.profile,
    "--selector", selection.work,
    "--manifest", selection.manifest,
  ], "FIXTURE_PROCESS_WORK");
  const envelope = object(result.output);
  const items = envelope !== null && Array.isArray(envelope.items) ? envelope.items : [];
  const item = items.length === 1 ? object(items[0]) : null;
  if (result.exitCode !== 0 || envelope?.status !== "ok" || item?.id !== selection.work) {
    fail("FIXTURE_PROCESS_WORK_PROJECTION_INVALID", { exitCode: result.exitCode, status: envelope?.status });
  }
  const eligibility = object(item.eligibility);
  const construction = object(eligibility?.construction);
  const basis = object(item.realisationBasis);
  const authority = object(basis?.authority);
  const trace = object(basis?.trace);
  const validations = Array.isArray(trace?.validation)
    ? trace.validation.map((entry) => object(entry)?.id)
    : [];
  const validationObligations = sortedStrings(validations);
  if (validationObligations === null || !equalStrings(validationObligations, expectedValidationObligations)) {
    fail("FIXTURE_PROCESS_VALIDATION_SET_INVALID", { validationObligations });
  }
  if (typeof basis?.basisDigest !== "string" || !digestPattern.test(basis.basisDigest)) {
    fail("FIXTURE_PROCESS_BASIS_INVALID");
  }
  return Object.freeze({ construction, authority, basis, validationObligations });
}

function assertActiveConstruction(work) {
  if (work.construction?.eligible !== true
    || work.construction?.authority !== "active-permission"
    || work.construction?.maximumThrough !== "integrate"
    || work.authority?.effectiveAuthority !== "active-permission"
    || work.authority?.permissionState !== "urn:usf:contract-state:active"
    || work.authority?.effectiveMaximumThrough !== "integrate") {
    fail("FIXTURE_PROCESS_CONSTRUCTION_AUTHORITY_INACTIVE", {
      basisDigest: work.basis.basisDigest,
      construction: work.construction,
      authority: work.authority,
    });
  }
}

async function runOrdinaryTests(paths) {
  const ordinary = paths.filter((path) => path !== completionTest);
  const children = [runTestChild(["--test", "--test-concurrency=4", ...ordinary], "ordinary")];
  if (paths.includes(completionTest)) {
    children.push(runCompletionCohort({
      repositoryRoot,
      childOwner: gateChildren,
      lockDescriptor: releaseFullGateLock?.descriptor,
      onOutput: (channel, bytes) => observedWrite(channel === "stdout" ? process.stdout : process.stderr, bytes),
      onEvent: event => observedJson({ schema: "urn:usf:full-gate-completion-progress:1", ...event }),
    }).then(result => { childResults.push(result); return result; }).catch(error => {
      childResults.push({ label: "completion", exitCode: 1, results: error.results ?? [], reason: String(error) });
      throw error;
    }));
  }
  // A failed launch or lane must not release the full-gate lock while siblings
  // are still executing. The completion scheduler drains its own children too.
  const settled = await Promise.allSettled(children);
  const failures = settled.flatMap(result => result.status === "rejected"
    ? [{ label: "completion", exitCode: 1, reason: String(result.reason) }]
    : result.value.exitCode === 0 ? [] : [result.value]);
  if (failures.length > 0) fail("ORDINARY_TESTS_FAILED", { results: failures });
}

async function realiseNoChange(work) {
  const result = await runCapturedJson([
    "realise", "no-change",
    "--work", selection.work,
    "--profile", selection.profile,
    "--manifest", selection.manifest,
  ], "FIXTURE_PROCESS_REALISE");
  const output = object(result.output);
  const obligations = sortedStrings(output?.validationObligations);
  if (result.exitCode !== 0
    || output?.schema !== "urn:usf:no-change-realisation-result:1"
    || output?.status !== "ready-for-validation"
    || output?.workIri !== selection.work
    || output?.profileIri !== selection.profile
    || output?.manifestPath !== selection.manifest
    || output?.realisationBasisDigest !== work.basis.basisDigest
    || typeof output?.candidateDigest !== "string"
    || !digestPattern.test(output.candidateDigest)
    || obligations === null
    || !equalStrings(obligations, expectedValidationObligations)) {
    fail("FIXTURE_PROCESS_REALISATION_INVALID", {
      exitCode: result.exitCode,
      status: output?.status,
      reasonCode: output?.reasonCode,
    });
  }
  return Object.freeze({
    candidateDigest: output.candidateDigest,
    basisDigest: output.realisationBasisDigest,
    obligations,
  });
}

async function runFixtureChecks(candidate) {
  const failures = [];
  for (const validation of candidate.obligations) {
    const result = await runCapturedJson([
      "check",
      "--candidate", candidate.candidateDigest,
      "--validation", validation,
    ], "FIXTURE_PROCESS_CHECK");
    const output = object(result.output);
    const receipt = object(output?.receipt);
    const route = expectedValidationRoutes[validation];
    const passed = result.exitCode === 0
      && output?.schema === "urn:usf:check-result:1"
      && output?.status === "pass"
      && output?.id === validation
      && receipt?.candidateDigest === candidate.candidateDigest
      && receipt?.originalConstructionBasisDigest === candidate.basisDigest
      && receipt?.validationObligationIri === validation
      && receipt?.validationEnvironmentIri === "urn:usf:environment:hermetic"
      && receipt?.validationExecutionModeIri === route.mode
      && Array.isArray(receipt?.validationCommandTokens)
      && equalStrings(receipt.validationCommandTokens, route.command);
    const summary = {
      schema: "urn:usf:full-gate-fixture-check-summary:1",
      candidateDigest: candidate.candidateDigest,
      validation,
      status: passed ? "pass" : "failed",
      exitCode: result.exitCode,
      ...(typeof output?.reasonCode === "string" ? { reasonCode: output.reasonCode } : {}),
      ...(typeof output?.receiptPath === "string" ? { receiptPath: output.receiptPath } : {}),
    };
    fixtureCheckResults.push(summary);
    observedJson(summary);
    if (!passed) {
      failures.push(summary);
      if (result.stderr.length > 0) observedWrite(process.stderr, result.stderr);
    }
  }
  if (failures.length > 0) fail("FIXTURE_PROCESS_CHECKS_FAILED", { failures });
}

function plan(paths, work) {
  const authorityReady = work.construction?.eligible === true
    && work.construction?.authority === "active-permission"
    && work.construction?.maximumThrough === "integrate"
    && work.authority?.effectiveAuthority === "active-permission"
    && work.authority?.permissionState === "urn:usf:contract-state:active"
    && work.authority?.effectiveMaximumThrough === "integrate";
  return Object.freeze({
    schema: "urn:usf:full-gate-plan:1",
    status: authorityReady ? "authority-ready" : "authority-blocked",
    ordinaryTestCount: paths.length,
    directFixtureTestExcluded: specialTest,
    serialTests,
    ordinaryConcurrency: 4,
    completionRecoveryMaximumProcesses: 2,
    completionSeedPreparation: "genuine-producer-witness-once",
    serialConcurrency: 1,
    selection,
    realisationBasisDigest: work.basis.basisDigest,
    construction: work.construction,
    authority: work.authority,
    validationObligations: work.validationObligations,
  });
}

try {
  const mode = process.argv[2] ?? "--all";
  if (!["--all", "--plan", "--fixtures-only"].includes(mode) || process.argv.length > 3) {
    fail("FULL_GATE_ARGUMENTS_INVALID", { accepted: ["--plan", "--fixtures-only"] });
  }
  gateChildren = createGateChildOwner();
  if (mode !== "--plan") releaseFullGateLock = acquireFullGateLock(repositoryRoot);
  const paths = ordinaryTests();
  const work = await currentFixtureWork();
  if (mode === "--plan") {
    process.stdout.write(`${JSON.stringify(plan(paths, work), null, 2)}\n`);
  } else {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let phase = "authority-preflight";
    const retention = beginRetention(mode);
    retainedLog = retention;
    let failure = null;
    try {
      progress(phase, { status: "started", mode, ordinaryTestCount: paths.length, realisationBasisDigest: work.basis.basisDigest });
      assertActiveConstruction(work);
      progress(phase, { status: "passed" });
      if (mode === "--all") {
        phase = "ordinary-tests";
        progress(phase, { status: "started", ordinaryTestCount: paths.length, concurrency: 4 });
        await runOrdinaryTests(paths);
        progress(phase, { status: "passed", ordinaryTestCount: paths.length });
        phase = "serial-tests";
        progress(phase, { status: "started", serialTests, concurrency: 1 });
        await runSerialTests();
        progress(phase, { status: "passed", serialTests });
      }
      phase = "fixture-checks";
      progress(phase, { status: "started", validationObligations: work.validationObligations });
      await runFixtureChecks(await realiseNoChange(work));
      progress(phase, { status: "passed", validationObligations: work.validationObligations });
      phase = "complete";
    } catch (error) {
      progress(phase, { status: "failed" });
      failure = error instanceof GateError
        ? { reasonCode: error.code, ...error.details }
        : { reasonCode: gateChildren?.interrupted ? "FULL_GATE_INTERRUPTED" : "FULL_GATE_INTERNAL_ERROR" };
    }
    try {
      await gateChildren.close();
    } catch {
      failure = { reasonCode: "FULL_GATE_TREE_DRAIN_UNCONFIRMED" };
      phase = "process-drain";
    }
    const terminal = Object.freeze({
      schema: "urn:usf:full-gate-result:1",
      status: failure === null ? "passed" : "failed",
      exitCode: failure === null ? 0 : 1,
      mode,
      phase,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMilliseconds: Math.round(performance.now() - started),
      ordinaryTestCount: paths.length,
      selection,
      realisationBasisDigest: work.basis.basisDigest,
      validationObligations: work.validationObligations,
      childResults,
      fixtureCheckResults,
      phaseDurations,
      ...(failure ?? {}),
    });
    finishRetention(retention, terminal);
    if (failure !== null) process.exitCode = 1;
  }
} catch (error) {
  const failure = error instanceof GateError
    ? { schema: "urn:usf:full-gate-error:1", status: "failed", reasonCode: error.code, ...error.details }
    : { schema: "urn:usf:full-gate-error:1", status: "failed", reasonCode: error?.code ?? "FULL_GATE_INTERNAL_ERROR" };
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = error?.exitCode ?? 1;
} finally {
  try {
    await gateChildren?.close();
    releaseFullGateLock?.confirmDrained();
  } catch (error) {
    process.exitCode = 1;
    try {
      process.stderr.write(`${JSON.stringify({
        schema: "urn:usf:full-gate-error:1", status: "failed",
        reasonCode: error?.code ?? "FULL_GATE_TREE_DRAIN_UNCONFIRMED",
      })}\n`);
    } catch { /* closed diagnostics cannot clear the unresolved fence */ }
  } finally {
    releaseFullGateLock?.();
  }
}
