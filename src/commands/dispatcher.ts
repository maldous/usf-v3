import { exitCodes, type ExitCode, UsfError } from "../core/errors.ts";
import { commandNames, helpCommandResult, type CommandName } from "./help.ts";

export { commandNames, type CommandName } from "./help.ts";
export interface CommandRequest { command: CommandName; args: readonly string[]; repositoryRoot: string; }
export interface CommandResult { output: unknown; exitCode?: ExitCode; outputMode?: "text" | "json"; }
export type CommandHandler = (request: CommandRequest) => CommandResult | Promise<CommandResult>;
export type CommandHandlers = Partial<Record<CommandName, CommandHandler>>;

export function parseCommand(argv: readonly string[]): { command: CommandName; args: string[] } {
  const [candidate, ...args] = argv;
  if (!candidate) throw new UsfError("COMMAND_REQUIRED", exitCodes.INVALID_INPUT, "A command is required.");
  if (candidate === "--help" || candidate === "-h") return { command: "help", args };
  if (!(commandNames as readonly string[]).includes(candidate)) throw new UsfError("COMMAND_UNKNOWN", exitCodes.INVALID_INPUT, "Unknown command.", { command: candidate });
  if (candidate === "help") return { command: "help", args: args.filter((argument) => argument !== "--help" && argument !== "-h") };
  const helpIndex = args.findIndex((argument) => argument === "--help" || argument === "-h");
  if (helpIndex >= 0) {
    return { command: "help", args: [candidate, ...args.filter((_, index) => index !== helpIndex)] };
  }
  return { command: candidate as CommandName, args };
}

export async function dispatchCommand(argv: readonly string[], repositoryRoot: string, handlers: CommandHandlers): Promise<CommandResult> {
  const { command, args } = parseCommand(argv);
  if (command === "help") return helpCommandResult(args);
  const handler = handlers[command];
  if (!handler) throw new UsfError("COMMAND_NOT_IMPLEMENTED", exitCodes.INVALID_INPUT, "Command is not implemented in this bootstrap build.", { command });
  return handler({ command, args, repositoryRoot });
}
