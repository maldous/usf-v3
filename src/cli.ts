import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command] = process.argv.slice(2);

if (command === "init") {
  const result = spawnSync("sh", [resolve(repositoryRoot, "scripts/bootstrap.sh")], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

process.stdout.write(
  `${JSON.stringify({
    schema: "urn:usf:cli-error:1",
    status: "refused",
    reasonCode: command ? "COMMAND_NOT_IMPLEMENTED" : "COMMAND_REQUIRED",
    command: command ?? null,
  })}\n`,
);
process.exitCode = 2;
