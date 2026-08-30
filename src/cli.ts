import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { dispatchCommand, parseCommand, type CommandHandlers } from "./commands/dispatcher.ts";
import { admissionCheckHandler, applyHandler, integrateCommandHandler } from "./commands/apply.ts";
import { bootstrapCarrierCommandHandler } from "./commands/bootstrap-carrier.ts";
import { callCommandHandler } from "./commands/call.ts";
import { doctorCommandHandler } from "./commands/doctor.ts";
import { startCommandHandler, stopCommandHandler, watchCommandHandler } from "./commands/lifecycle.ts";
import { metricsCommandHandler } from "./commands/metrics.ts";
import { modelsCommandHandler } from "./commands/models.ts";
import { probeCommandHandler } from "./commands/probe.ts";
import { publishCommandHandler } from "./commands/publish.ts";
import { queryCommand } from "./commands/query.ts";
import { resolveCommandHandler } from "./commands/resolve.ts";
import { routeCommandHandler } from "./commands/route.ts";
import { broadStatusCommandHandler } from "./commands/status.ts";
import { workCommand } from "./commands/work.ts";
import { errorOutput, exitCodes, UsfError } from "./core/errors.ts";
import { resolveRepositoryRoot } from "./core/repository.ts";
import { localGitChildEnvironment } from "./providers/local-git.ts";

const bootstrapHandlers: CommandHandlers = {
  init: ({ repositoryRoot }) => {
    const result = spawnSync("sh", [resolve(repositoryRoot, "scripts/bootstrap.sh")], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status !== 0) throw new UsfError("INIT_FAILED", exitCodes.CONTAINMENT_REFUSAL, "Initialization failed.");
    return { output: undefined };
  },
  doctor: doctorCommandHandler,
  status: broadStatusCommandHandler,
  query: queryCommand,
  work: workCommand,
  call: callCommandHandler,
  resolve: resolveCommandHandler,
  apply: applyHandler,
  check: admissionCheckHandler,
  integrate: integrateCommandHandler,
  "bootstrap-carrier": bootstrapCarrierCommandHandler,
  metrics: metricsCommandHandler,
  models: modelsCommandHandler,
  probe: probeCommandHandler,
  publish: publishCommandHandler,
  route: routeCommandHandler,
  start: startCommandHandler,
  stop: stopCommandHandler,
  watch: watchCommandHandler,
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
