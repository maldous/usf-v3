import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { dispatchCommand, type CommandHandlers } from "./commands/dispatcher.ts";
import { applyHandler } from "./commands/apply.ts";
import { callCommandHandler } from "./commands/call.ts";
import { checkHandler } from "./commands/check.ts";
import { queryCommand } from "./commands/query.ts";
import { resolveCommandHandler } from "./commands/resolve.ts";
import { workCommand } from "./commands/work.ts";
import { errorOutput, exitCodes, UsfError } from "./core/errors.ts";
import { resolveRepositoryRoot } from "./core/repository.ts";

const bootstrapHandlers: CommandHandlers = {
  init: ({ repositoryRoot }) => {
    const result = spawnSync("sh", [resolve(repositoryRoot, "scripts/bootstrap.sh")], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status !== 0) throw new UsfError("INIT_FAILED", exitCodes.CONTAINMENT_REFUSAL, "Initialization failed.");
    return { output: undefined };
  },
  query: queryCommand,
  work: workCommand,
  call: callCommandHandler,
  resolve: resolveCommandHandler,
  apply: applyHandler,
  check: checkHandler,
};

async function main(): Promise<void> {
  try {
    const repositoryRoot = resolveRepositoryRoot();
    const result = await dispatchCommand(process.argv.slice(2), repositoryRoot, bootstrapHandlers);
    if (result.output !== undefined) process.stdout.write(`${JSON.stringify(result.output)}\n`);
    process.exitCode = result.exitCode ?? exitCodes.SUCCESS;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(errorOutput(error))}\n`);
    process.exitCode = error instanceof UsfError ? error.exitCode : exitCodes.DOMAIN_FAILURE;
  }
}

void main();
