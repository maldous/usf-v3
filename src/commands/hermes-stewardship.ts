import {
  claimStewardship,
  handoffStewardship,
  observeStewardship,
  releaseStewardship,
  renewStewardship,
  stewardshipReasonCodes,
  type StewardshipDependencies,
} from "../continuous/stewardship.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import type { CommandResult } from "./dispatcher.ts";
import { loadSemanticGraph, objectValues } from "../graph/index.ts";
import { observeSupervisor } from "./hermes-lifecycle.ts";
import { listPendingTransactions } from "./transact.ts";
import { acquirePrimaryMutationLock } from "../realisation/transition.ts";

const lifecycleId = "urn:usf:operational-lifecycle:stewardship:1";

/** Interface-layer composition; operations never import these authority APIs. */
export function currentStewardshipDependencies(repositoryRoot: string): StewardshipDependencies {
  return {
    adapters: {
      renewalPolicy: async () => {
        const graph = loadSemanticGraph(repositoryRoot, "graph/manifests/operational-stewardship.json");
        const value = (predicate: string): number => {
          const values = objectValues(graph, lifecycleId, predicate);
          if (values.length !== 1 || !/^[1-9][0-9]{0,5}$/u.test(values[0]!)) throw new UsfError("STEWARD_POLICY_INVALID", exitCodes.CONTINUOUS_DEGRADED, "The stewardship renewal policy is absent or ambiguous.");
          return Number(values[0]);
        };
        return Object.freeze({ defaultSeconds: value("urn:usf:predicate:defaultRenewalSeconds"), minimumSeconds: value("urn:usf:predicate:minimumRenewalSeconds"), maximumSeconds: value("urn:usf:predicate:maximumRenewalSeconds") });
      },
      currentSupervisor: async () => { const value = await observeSupervisor(repositoryRoot); return value.liveness === "live" ? value.record?.process ?? null : null; },
      pendingTransactions: () => listPendingTransactions(repositoryRoot),
      acquirePrimaryMutation: async () => { const lock = await acquirePrimaryMutationLock(repositoryRoot); return Object.freeze({ release: () => lock.handle.close() }); },
    },
  };
}

type Action = "claim" | "status" | "renew" | "handoff" | "recover" | "release";

interface Arguments {
  readonly action: Action;
  readonly agent?: string;
  readonly claim?: string;
  readonly generation?: string;
  readonly seconds?: number;
}

function invalid(message: string): never { throw new UsfError("STEWARD_INPUT_INVALID", exitCodes.INVALID_INPUT, message); }

function parse(args: readonly string[]): Arguments {
  const [action, ...rest] = args;
  if (!(["claim", "status", "renew", "handoff", "recover", "release"] as const).includes(action as Action)) {
    throw new UsfError(stewardshipReasonCodes.ACTION_UNKNOWN, exitCodes.INVALID_INPUT, "Hermes steward requires claim, status, renew, handoff, recover, or release.");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (!(["--agent", "--claim", "--generation", "--seconds"] as const).includes(option as "--agent") || values.has(option!)) invalid(`Unknown or duplicate stewardship option: ${String(option)}`);
    const value = rest[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    values.set(option!, value);
  }
  const secondsText = values.get("--seconds");
  const seconds = secondsText === undefined ? undefined : Number(secondsText);
  if (secondsText !== undefined && (!/^[0-9]+$/u.test(secondsText) || !Number.isSafeInteger(seconds))) invalid("--seconds must be an integer.");
  if (action === "status" && values.size !== 0) invalid("status accepts no options.");
  const allowed = action === "claim" || action === "recover"
    ? new Set(["--agent", "--seconds"])
    : action === "renew"
      ? new Set(["--claim", "--generation", "--seconds"])
      : new Set(["--claim", "--generation"]);
  for (const option of values.keys()) if (!allowed.has(option)) invalid(`${option} is not accepted by ${action}.`);
  if ((action === "claim" || action === "recover") && values.get("--agent") === undefined) invalid(`${action} requires --agent.`);
  if ((action === "renew" || action === "handoff" || action === "release") && (values.get("--claim") === undefined || values.get("--generation") === undefined)) invalid(`${action} requires --claim and --generation.`);
  if (!["claim", "recover", "renew"].includes(action!) && seconds !== undefined) invalid(`--seconds is not accepted by ${action}.`);
  return Object.freeze({ action: action as Action, agent: values.get("--agent"), claim: values.get("--claim"), generation: values.get("--generation"), seconds });
}

/** Local operational coordination only: it does not derive or grant semantic work. */
export async function stewardshipCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const input = parse(args);
  const dependencies = currentStewardshipDependencies(repositoryRoot);
  switch (input.action) {
    case "status": return { output: await observeStewardship(repositoryRoot, dependencies), exitCode: exitCodes.SUCCESS };
    case "claim": return { output: { schema: "urn:usf:stewardship-result:1", action: input.action, result: await claimStewardship(repositoryRoot, { agent: input.agent!, seconds: input.seconds, dependencies }) }, exitCode: exitCodes.SUCCESS };
    case "recover": return { output: { schema: "urn:usf:stewardship-result:1", action: input.action, result: await claimStewardship(repositoryRoot, { agent: input.agent!, seconds: input.seconds, recover: true, dependencies }) }, exitCode: exitCodes.SUCCESS };
    case "renew": return { output: { schema: "urn:usf:stewardship-result:1", action: input.action, result: await renewStewardship(repositoryRoot, input.claim!, input.generation!, input.seconds, dependencies) }, exitCode: exitCodes.SUCCESS };
    case "handoff": return { output: { schema: "urn:usf:stewardship-result:1", action: input.action, result: await handoffStewardship(repositoryRoot, input.claim!, input.generation!, dependencies) }, exitCode: exitCodes.SUCCESS };
    case "release": return { output: { schema: "urn:usf:stewardship-result:1", action: input.action, result: await releaseStewardship(repositoryRoot, input.claim!, input.generation!, dependencies) }, exitCode: exitCodes.SUCCESS };
  }
}
