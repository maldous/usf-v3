import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { dispatchCommand, parseCommand, type CommandHandlers } from "./commands/dispatcher.ts";
import { errorOutput, exitCodes, UsfError } from "./core/errors.ts";
import { resolveRepositoryRoot } from "./core/repository.ts";
import { localGitChildEnvironment } from "./providers/local-git.ts";
import { withOperationalExclusion, withTransactionRecoveryExclusion } from "./continuous/stewardship.ts";

async function operationalMutation<T>(repositoryRoot: string, action: () => Promise<T>, requireClaim = false): Promise<T> {
  const { observeSupervisor } = await import("./commands/hermes-lifecycle.ts");
  const { currentStewardshipDependencies } = await import("./commands/hermes-stewardship.ts");
  return withOperationalExclusion(repositoryRoot, process.env.USF_STEWARD_CLAIM_ID, process.env.USF_STEWARD_GENERATION, action, {
    requireClaim,
    dependencies: currentStewardshipDependencies(repositoryRoot),
    requireClaimWhenAbsent: async () => (await observeSupervisor(repositoryRoot)).liveness === "live",
  });
}

const bootstrapHandlers: CommandHandlers = {
  transition: async (context) => (await import("./commands/transition.ts")).transitionCommandHandler(context, Object.keys(bootstrapHandlers)),
  init: ({ repositoryRoot }) => {
    const result = spawnSync("sh", [resolve(repositoryRoot, "scripts/bootstrap.sh")], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status !== 0) throw new UsfError("INIT_FAILED", exitCodes.CONTAINMENT_REFUSAL, "Initialization failed.");
    return { output: undefined };
  },
  doctor: async (context) => (await import("./commands/doctor.ts")).doctorCommandHandler(context),
  status: async (context) => (await import("./commands/status.ts")).broadStatusCommandHandler(context),
  query: async (context) => (await import("./commands/query.ts")).queryCommand(context),
  work: async (context) => (await import("./commands/work.ts")).workCommand(context),
  // Generic call accepts only options and performs no external contact. Every
  // named call leaf passes the same exclusion boundary, including future
  // registered leaves, before its own semantic and provider admission.
  call: async (context) => {
    if (context.args[0] !== undefined && !context.args[0].startsWith("-")) {
      return operationalMutation(context.repositoryRoot, async () => (await import("./commands/call.ts")).callCommandHandler(context));
    }
    return (await import("./commands/call.ts")).callCommandHandler(context);
  },
  resolve: async (context) => (await import("./commands/resolve.ts")).resolveCommandHandler(context),
  realise: async (context) => {
    if (context.args[0] === "no-change" && context.args[1] === "--input") {
      const { executeTransitionCommand } = await import("./commands/transition.ts");
      return executeTransitionCommand({ ...context, args: context.args.slice(1) }, "realise no-change");
    }
    return (await import("./commands/work-completion.ts")).realiseCommandHandler(context);
  },
  apply: async (context) => (await import("./commands/apply.ts")).applyHandler(context),
  check: async (context) => {
    if (context.args[0] === "--input") {
      const { executeTransitionCommand } = await import("./commands/transition.ts");
      return executeTransitionCommand(context, "check");
    }
    return (await import("./commands/apply.ts")).admissionCheckHandler(context);
  },
  integrate: (context) => operationalMutation(context.repositoryRoot, async () => (await import("./commands/apply.ts")).integrateCommandHandler(context)),
  "bootstrap-carrier": async (context) => {
    const { bootstrapCarrierCommandHandler } = await import("./commands/bootstrap-carrier.ts");
    return context.args[0] === "adopt"
      ? operationalMutation(context.repositoryRoot, async () => bootstrapCarrierCommandHandler(context))
      : bootstrapCarrierCommandHandler(context);
  },
  evidence: async (context) => {
    if (context.args[0] === "completion" && context.args[1] === "--input") {
      const { observationCommandHandler } = await import("./commands/transition.ts");
      return observationCommandHandler({ ...context, args: context.args.slice(1) }, "evidence completion");
    }
    return (await import("./commands/work-completion.ts")).completionAwareEvidenceCommandHandler(context);
  },
  prove: async (context) => (await import("./commands/work-completion.ts")).completionAwareProveCommandHandler(context),
  metrics: async (context) => (await import("./commands/metrics.ts")).metricsCommandHandler(context),
  models: async (context) => {
    const { modelsCommandHandler } = await import("./commands/models.ts");
    return context.args[0] === "refresh" ? operationalMutation(context.repositoryRoot, async () => modelsCommandHandler(context)) : modelsCommandHandler(context);
  },
  providers: async (context) => {
    const { providersCommandHandler } = await import("./commands/providers.ts");
    return context.args[0] === "policy" ? operationalMutation(context.repositoryRoot, async () => providersCommandHandler(context)) : providersCommandHandler(context);
  },
  probe: async (context) => {
    const { probeCommandHandler } = await import("./commands/probe.ts");
    return context.args[0] === "qualify" ? operationalMutation(context.repositoryRoot, async () => probeCommandHandler(context)) : probeCommandHandler(context);
  },
  publish: async (context) => {
    const { completionAwarePublishCommandHandler } = await import("./commands/work-completion.ts");
    return context.args.includes("--apply") ? operationalMutation(context.repositoryRoot, async () => completionAwarePublishCommandHandler(context)) : completionAwarePublishCommandHandler(context);
  },
  execute: (context) => operationalMutation(context.repositoryRoot, async () => (await import("./commands/execute.ts")).executeCommandHandler(context)),
  "linear-binding": async ({ args, repositoryRoot }) => {
    const operation = args[0];
    if (operation !== "prepare" && operation !== "status" && operation !== "settle") {
      throw new UsfError("LINEAR_BINDING_OPERATION_UNKNOWN", exitCodes.INVALID_INPUT, "Linear binding requires exactly one of: prepare, status, settle.");
    }
    const values = new Map<string, string>();
    for (let index = 1; index < args.length; index += 1) {
      const option = args[index]!;
      const allowed = operation === "settle"
        ? option === "--manifest" || option === "--binding" || option === "--evidence"
        : option === "--manifest" || option === "--binding";
      if (!allowed || values.has(option)) {
        throw new UsfError("LINEAR_BINDING_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, `Linear binding options must be unique and explicit: ${option}`);
      }
      const value = args[++index];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new UsfError("LINEAR_BINDING_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, `Missing value for ${option}.`);
      }
      values.set(option, value);
    }
    const manifestPath = values.get("--manifest");
    const bindingIri = values.get("--binding");
    const evidenceDigest = values.get("--evidence");
    const expectedSize = operation === "settle" ? 3 : 2;
    if (
      manifestPath === undefined
      || bindingIri === undefined
      || values.size !== expectedSize
      || (operation === "settle" && (evidenceDigest === undefined || !/^sha256:[0-9a-f]{64}$/.test(evidenceDigest)))
    ) {
      throw new UsfError(
        "LINEAR_BINDING_ARGUMENTS_INVALID",
        exitCodes.INVALID_INPUT,
        operation === "settle"
          ? "Linear binding settle requires exactly --manifest PATH, --binding IRI, and --evidence sha256:<64hex>."
          : "Linear binding prepare and status require exactly --manifest PATH and --binding IRI.",
      );
    }
    const linear = await import("./commands/linear-binding.ts");
    try {
      const selector = Object.freeze({ repositoryRoot, manifestPath, bindingIri });
      const result = operation === "prepare"
        ? await operationalMutation(repositoryRoot, () => linear.prepareLinearBinding(selector), true)
        : operation === "settle"
          ? await operationalMutation(
              repositoryRoot,
              () => linear.afterHermesResult(selector, evidenceDigest as Parameters<typeof linear.afterHermesResult>[1]),
              true,
            )
          : await linear.observeLinearBinding(selector);
      return { output: Object.freeze({ schema: "urn:usf:linear-binding-result:1" as const, result }), exitCode: exitCodes.SUCCESS };
    } catch (error) {
      if (error instanceof linear.LinearBindingError) {
        throw new UsfError(error.reasonCode, exitCodes.DOMAIN_FAILURE, error.reasonCode);
      }
      throw error;
    }
  },
  hermes: async ({ args, repositoryRoot }) => {
    if (args[0] === "steward") {
      const { stewardshipCommand } = await import("./commands/hermes-stewardship.ts");
      return stewardshipCommand(repositoryRoot, args.slice(1));
    }
    if (args[0] === "realise") {
      const { realisePlanCommand } = await import("./commands/hermes-realise.ts");
      return args.includes("--apply")
        ? operationalMutation(repositoryRoot, () => realisePlanCommand(repositoryRoot, args.slice(1)), true)
        : realisePlanCommand(repositoryRoot, args.slice(1));
    }
    if (args[0] === "implement") {
      const { implementCommand } = await import("./commands/hermes-implement.ts");
      return args.includes("--apply")
        ? operationalMutation(repositoryRoot, () => implementCommand(repositoryRoot, args.slice(1)), true)
        : implementCommand(repositoryRoot, args.slice(1));
    }
    if (args.includes("--linear-policy")) {
      const { hermesLinearCommand } = await import("./commands/hermes-linear.ts");
      return hermesLinearCommand(repositoryRoot, args);
    }
    if (args[0] === "start" || args[0] === "stop" || args[0] === "supervise" || args[0] === "status") {
      const lifecycle = await import("./commands/hermes-lifecycle.ts");
      if (args[0] === "start") return operationalMutation(repositoryRoot, () => lifecycle.hermesStartCommand(repositoryRoot, args.slice(1)), true);
      if (args[0] === "stop") return operationalMutation(repositoryRoot, () => lifecycle.hermesStopCommand(repositoryRoot, args.slice(1)), true);
      if (args[0] === "status") return lifecycle.hermesLifecycleStatusCommand(repositoryRoot, args.slice(1));
      return lifecycle.hermesSuperviseCommand(repositoryRoot, args.slice(1));
    }
    const { hermesCommand } = await import("./commands/hermes.ts");
    return args[0] === "run"
      ? operationalMutation(repositoryRoot, () => hermesCommand(repositoryRoot, args), true)
      : hermesCommand(repositoryRoot, args);
  },
  transact: async ({ args, repositoryRoot }) => {
    const { transactCommand } = await import("./commands/transact.ts");
    if (args.includes("--recover")) {
      const { currentStewardshipDependencies } = await import("./commands/hermes-stewardship.ts");
      return withTransactionRecoveryExclusion(repositoryRoot, process.env.USF_STEWARD_CLAIM_ID, process.env.USF_STEWARD_GENERATION,
        () => transactCommand(repositoryRoot, args), currentStewardshipDependencies(repositoryRoot));
    }
    return args.includes("--dry-run") ? transactCommand(repositoryRoot, args)
      : operationalMutation(repositoryRoot, () => transactCommand(repositoryRoot, args));
  },
  profile: async ({ args, repositoryRoot }) => {
    const { profileCommand } = await import("./commands/profile.ts");
    return profileCommand(repositoryRoot, args);
  },
  graph: async ({ args, repositoryRoot }) => {
    if (args[0] === "integrity") return (await import("./commands/graph-integrity.ts")).graphIntegrityCommand(repositoryRoot, args.slice(1));
    if (args[0] === "lanes") return (await import("./commands/graph-lanes.ts")).graphLanesCommand(repositoryRoot, args.slice(1));
    if (args[0] !== "execute") {
      throw new UsfError("GRAPH_OPERATION_UNKNOWN", exitCodes.INVALID_INPUT, "Graph requires exactly one of: execute, integrity.");
    }
    return operationalMutation(repositoryRoot, async () => (await import("./commands/graph-execute.ts")).graphExecuteCommand(repositoryRoot, args.slice(1)));
  },
  route: async (context) => (await import("./commands/route.ts")).routeCommandHandler(context),
  // The current foreground composer only observes eligible work and retains
  // its own instance lifecycle lock. A future executing composer must acquire
  // stewardship per bounded wave; a lifetime activity lock would block stop.
  start: async (context) => (await import("./commands/lifecycle.ts")).startCommandHandler(context),
  stop: async (context) => (await import("./commands/lifecycle.ts")).stopCommandHandler(context),
  watch: async (context) => (await import("./commands/lifecycle.ts")).watchCommandHandler(context),
};

function resolveRepositoryRootWithMinimalEnvironment(): string {
  const original = { ...process.env };
  const replacement = localGitChildEnvironment(process.cwd());
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, replacement);
    return resolveRepositoryRoot();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    const parsed = parseCommand(argv);
    const repositoryRoot = parsed.command === "help" ? "" : resolveRepositoryRootWithMinimalEnvironment();
    const result = await dispatchCommand(argv, repositoryRoot, bootstrapHandlers);
    if (result.output !== undefined) {
      if (result.outputMode === "text") process.stdout.write(`${String(result.output)}\n`);
      else process.stdout.write(`${JSON.stringify(result.output)}\n`);
    }
    process.exitCode = result.exitCode ?? exitCodes.SUCCESS;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(errorOutput(error))}\n`);
    process.exitCode = error instanceof UsfError ? error.exitCode : exitCodes.DOMAIN_FAILURE;
  }
}

void main();
