import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { readLinearPolicySource, parseLinearPolicy } from "./linear-client.ts";
export { readLinearPolicySource } from "./linear-client.ts";
import { LinearStateStore, readLinearRecord, writeLinearRecord, type LinearRecordValue } from "./linear-state.ts";
import { linuxProcessInspector } from "../continuous/lifecycle.ts";
import { acquireSupervisorLifetimeLock, claimStewardship, releaseStewardship, withSupervisorActivity } from "../continuous/stewardship.ts";
import { currentStewardshipDependencies } from "./hermes-stewardship.ts";
import { registerForegroundSupervisor, unregisterForegroundSupervisor, foregroundSupervisorStopRequested, type HermesSupervisorRecord } from "./hermes-supervisor-foreground.ts";
import { readRuntimeAuthority } from "../graph/runtime-authority.ts";
import { parseHermesLinearArguments, loadLinearCredentials, runHermesLinearCycle } from "./hermes-linear-autonomy.ts";
export {
  parseHermesLinearArguments, loadLinearCredentials, runHermesLinearCycle,
  linearReason, currentLinearBindingSelections, discoverLinearLanes, compatibleLinearLanes,
  linearMutationLedgerSettled, runLinearLaneCycle, LinearMutations, createDeclaredLinearIssues,
} from "./hermes-linear-autonomy.ts";
export type { HermesLinearArguments, LinearLane, LinearLaneDiscovery, LinearCycleOutcome } from "./hermes-linear-autonomy.ts";
import type { CommandResult } from "./dispatcher.ts";

function refuse(code: string): never { throw new UsfError(code, exitCodes.CURRENTNESS_FAILURE, code); }
function recordValue(value: unknown): LinearRecordValue { return JSON.parse(JSON.stringify(value)) as LinearRecordValue; }

export async function hermesLinearCommand(root: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parseHermesLinearArguments(args);
  const selectorDigest = canonicalDigest({ manifest: parsed.manifest, policyIri: parsed.policyIri });
  const key = selectorDigest.slice(7);
  if (parsed.operation === "status") {
    const runtime = await readLinearRecord(root, `runtime-${key}`);
    const identity = runtime && typeof runtime === "object" && "process" in runtime ? runtime.process : null;
    const pid = identity && typeof identity === "object" && "pid" in identity ? identity.pid : null;
    const observed = typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? await linuxProcessInspector.inspect(pid) : null;
    const running = observed !== null && canonicalDigest(observed) === canonicalDigest(identity);
    return { exitCode: exitCodes.SUCCESS, output: { schema: "urn:usf:hermes-linear-status:1", selectorDigest, running,
      runtime, cycle: await readLinearRecord(root, `cycle-${key}`) } };
  }
  if (parsed.operation === "stop") {
    const runtime = await readLinearRecord(root, `runtime-${key}`);
    if (runtime === null) return { exitCode: exitCodes.SUCCESS, output: { schema: "urn:usf:hermes-linear-stop:1", status: "not-running", selectorDigest } };
    await writeLinearRecord(root, `stop-${key}`, { requestedAt: new Date().toISOString(), runtimeDigest: canonicalDigest(runtime) });
    return { exitCode: exitCodes.SUCCESS, output: { schema: "urn:usf:hermes-linear-stop:1", status: "drain-requested", selectorDigest } };
  }
  const policy = parseLinearPolicy(await readLinearPolicySource(root, parsed.manifest, parsed.policyIri));
  const policyDigest = canonicalDigest(policy);
  const credentials = await loadLinearCredentials(root, parsed.envFile, policy.workspaces.map((workspace) => workspace.credentialName));
  const missing = policy.workspaces.filter((workspace) => !credentials?.hasCredential(workspace.credentialName)).map((workspace) => workspace.credentialName);
  if (credentials === null || missing.length === policy.workspaces.length) {
    return { exitCode: exitCodes.EXTERNAL_UNAVAILABLE, output: { schema: "urn:usf:hermes-linear-start:1", status: "blocked",
      reasonCode: "MISSING_LINEAR_CREDENTIAL", credentialFile: parsed.envFile, missingCredentials: missing, externalContact: "none" } };
  }
  await readLinearPolicySource(root, parsed.manifest, parsed.policyIri, true);
  const processIdentity = await linuxProcessInspector.inspect(process.pid);
  if (!processIdentity) refuse("HERMES_LINEAR_PROCESS_UNOBSERVABLE");
  const selectedGraph = loadSemanticGraph(root, parsed.manifest);
  const bounds = readRuntimeAuthority(selectedGraph.quads);
  const concurrency = bounds.concurrencyDefault ?? 1;
  const lifetime = await acquireSupervisorLifetimeLock(root);
  const dependencies = { ...currentStewardshipDependencies(root), controller: processIdentity,
    sessionId: `hermes-linear-${processIdentity.pid}-${processIdentity.startTicks}` };
  let claim: Awaited<ReturnType<typeof claimStewardship>> | undefined;
  let registered: HermesSupervisorRecord | undefined;
  let stop = false;
  const onStop = (): void => { stop = true; };
  try {
    claim = await claimStewardship(root, { agent: "hermes-linear", recover: true, dependencies });
    const startedAt = new Date().toISOString();
    const record: HermesSupervisorRecord = { schema: "urn:usf:hermes-supervisor:1", version: 1,
      supervisorId: canonicalDigest({ process: processIdentity, startedAt }).slice(7, 32), startedAt, process: processIdentity,
      manifest: parsed.manifest, usefulTokenTarget: 100_000, envFile: parsed.providerEnvFile,
      pauseSeconds: policy.pollSeconds, concurrency, dispatchLimit: 12,
      authorityIdentity: canonicalDigest(selectedGraph.graphDigests ?? {}) };
    registered = await registerForegroundSupervisor(root, { lifetime, process: processIdentity,
      claimId: claim.record.claimId, generation: claim.record.generation, dependencies, record });
    await releaseStewardship(root, claim.record.claimId, claim.record.generation, dependencies);
    claim = undefined;
    const runtime = { schema: "urn:usf:hermes-linear-runtime:1", policyDigest, process: processIdentity, startedAt: new Date().toISOString() };
    await writeLinearRecord(root, `runtime-${key}`, recordValue(runtime));
    const runtimeDigest = canonicalDigest(runtime);
    const store = await LinearStateStore.open(root);
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
    let cycles = 0;
    while (!stop && (parsed.maximumCycles === null || cycles < parsed.maximumCycles)) {
      if (await foregroundSupervisorStopRequested(root, registered)) break;
      const currentPolicy = parseLinearPolicy(await readLinearPolicySource(root, parsed.manifest, parsed.policyIri, true));
      if (canonicalDigest(currentPolicy) !== policyDigest) refuse("LINEAR_POLICY_CHANGED");
      const result = await withSupervisorActivity(root, processIdentity, () => runHermesLinearCycle(root, currentPolicy,
        credentials, store, parsed.providerEnvFile, concurrency, () => stop), dependencies);
      await writeLinearRecord(root, `cycle-history-${canonicalDigest(result).slice(7)}`, recordValue(result));
      await writeLinearRecord(root, `cycle-${key}`, recordValue(result));
      cycles += 1;
      if (await foregroundSupervisorStopRequested(root, registered)) stop = true;
      const request = await readLinearRecord(root, `stop-${key}`);
      if (request && typeof request === "object" && "runtimeDigest" in request && request.runtimeDigest === runtimeDigest) stop = true;
      if (!stop && (parsed.maximumCycles === null || cycles < parsed.maximumCycles)) {
        for (let second = 0; second < policy.pollSeconds && !stop; second += 1) {
          await new Promise((done) => setTimeout(done, 1000));
          const request = await readLinearRecord(root, `stop-${key}`);
          if (request && typeof request === "object" && "runtimeDigest" in request && request.runtimeDigest === runtimeDigest) stop = true;
          if (await foregroundSupervisorStopRequested(root, registered)) stop = true;
        }
      }
    }
    return { exitCode: exitCodes.SUCCESS, output: { schema: "urn:usf:hermes-linear-run:1", status: "stopped", cycles,
      policyDigest, cyclePath: `.usf/hermes/linear/records/cycle-${key}.json`, nonclaims: ["Stopped is not semantic completion."] } };
  } finally {
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
    if (claim) await releaseStewardship(root, claim.record.claimId, claim.record.generation, dependencies).catch(() => undefined);
    try { if (registered) await unregisterForegroundSupervisor(root, registered); }
    finally { await lifetime.release(); }
  }
}
