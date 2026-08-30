import { exitCodes, type ExitCode, UsfError } from "../core/errors.ts";

export const commandNames = ["init", "doctor", "status", "query", "observe", "work", "models", "probe", "route", "call", "review", "resolve", "apply", "check", "integrate", "evidence", "prove", "drift", "publish", "watch"] as const;
export type CommandName = (typeof commandNames)[number];
export interface CommandRequest { command: CommandName; args: readonly string[]; repositoryRoot: string; }
export interface CommandResult { output: unknown; exitCode?: ExitCode; }
export type CommandHandler = (request: CommandRequest) => CommandResult | Promise<CommandResult>;
export type CommandHandlers = Partial<Record<CommandName, CommandHandler>>;

export function parseCommand(argv: readonly string[]): { command: CommandName; args: string[] } {
  const [candidate, ...args] = argv;
  if (!candidate) throw new UsfError("COMMAND_REQUIRED", exitCodes.INVALID_INPUT, "A command is required.");
  if (!(commandNames as readonly string[]).includes(candidate)) throw new UsfError("COMMAND_UNKNOWN", exitCodes.INVALID_INPUT, "Unknown command.", { command: candidate });
  return { command: candidate as CommandName, args };
}

export async function dispatchCommand(argv: readonly string[], repositoryRoot: string, handlers: CommandHandlers): Promise<CommandResult> {
  const { command, args } = parseCommand(argv);
  const handler = handlers[command];
  if (!handler) throw new UsfError("COMMAND_NOT_IMPLEMENTED", exitCodes.INVALID_INPUT, "Command is not implemented in this bootstrap build.", { command });
  return handler({ command, args, repositoryRoot });
}
