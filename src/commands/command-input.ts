import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { exitCodes, UsfError } from "../core/errors.ts";

export const maximumCommandInputBytes = 4 * 1024 * 1024;
const inputPattern = /^\.usf\/inputs\/[^/\\\0]+\.json$/u;
const readChunkBytes = 64 * 1024;

export type CommandInput = Readonly<
  { mode: "inline"; json: string }
  | { mode: "source"; source: string }
>;

type CommandPrefix = "CALL" | "RESOLVE";

function inputRefused(command: CommandPrefix, message: string): never {
  throw new UsfError(`${command}_INPUT_REFUSED`, exitCodes.CONTAINMENT_REFUSAL, message);
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !relation.startsWith(sep);
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function exactPrivateRegularFile(metadata: Stats, uid: number): boolean {
  return metadata.isFile()
    && !metadata.isSymbolicLink()
    && metadata.uid === uid
    && metadata.nlink === 1
    && (metadata.mode & 0o7777) === 0o600;
}

export function parseCommandInput(args: readonly string[], command: CommandPrefix): CommandInput {
  const invalid = (message: string): never => {
    throw new UsfError(`${command}_ARGUMENTS_INVALID`, exitCodes.INVALID_INPUT, message);
  };
  if (args.length === 2 && args[0] === "--input" && args[1] !== "" && !args[1]!.startsWith("--")) {
    return Object.freeze({ mode: "source", source: args[1]! });
  }
  if (args.length === 1 && args[0] !== "" && !args[0]!.startsWith("--")) {
    if (Buffer.byteLength(args[0]!, "utf8") > maximumCommandInputBytes) {
      return inputRefused(command, "Inline input exceeds the bounded application size.");
    }
    return Object.freeze({ mode: "inline", json: args[0]! });
  }
  return invalid(`${command.toLowerCase()} requires --input PATH|- or one bounded inline JSON argument.`);
}

async function readIncrementally(handle: FileHandle, command: CommandPrefix): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maximumCommandInputBytes) {
    const remaining = maximumCommandInputBytes + 1 - total;
    if (remaining <= 0) break;
    const buffer = Buffer.allocUnsafe(Math.min(readChunkBytes, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > maximumCommandInputBytes) {
    return inputRefused(command, "Input exceeds the bounded application size.");
  }
  return Buffer.concat(chunks, total);
}

async function readFileInput(root: string, source: string, command: CommandPrefix): Promise<Buffer> {
  if (!inputPattern.test(source)) {
    return inputRefused(command, "File input must be one explicit repository-local .usf/inputs/*.json file.");
  }
  if (typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0) {
    return inputRefused(command, "The mandatory no-follow file boundary is unavailable.");
  }
  let handle: FileHandle | undefined;
  try {
    const canonicalRoot = await realpath(root);
    const lexicalPath = resolve(canonicalRoot, source);
    const canonicalPath = await realpath(lexicalPath);
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    const before = await lstat(lexicalPath);
    if (uid === undefined
      || lexicalPath !== canonicalPath
      || !contained(canonicalRoot, lexicalPath)
      || !exactPrivateRegularFile(before, uid)) {
      return inputRefused(command, "File input must be one exact owner-only regular file within the selected repository.");
    }

    handle = await open(lexicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedBefore = await handle.stat();
    if (!exactPrivateRegularFile(openedBefore, uid) || !sameIdentity(before, openedBefore)) {
      return inputRefused(command, "Input changed or lost its private regular-file identity while opening.");
    }
    const bytes = await readIncrementally(handle, command);
    const openedAfter = await handle.stat();
    const namedAfter = await lstat(lexicalPath);
    if (!exactPrivateRegularFile(openedAfter, uid)
      || !exactPrivateRegularFile(namedAfter, uid)
      || await realpath(lexicalPath) !== lexicalPath
      || !sameIdentity(before, openedAfter)
      || !sameIdentity(before, namedAfter)) {
      return inputRefused(command, "Input changed while reading.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return inputRefused(command, "File input could not be authenticated and read.");
  } finally {
    await handle?.close();
  }
}

async function readStdin(command: CommandPrefix): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const retained = Math.min(bytes.length, maximumCommandInputBytes + 1 - total);
    if (retained > 0) {
      chunks.push(bytes.subarray(0, retained));
      total += retained;
    }
    if (total > maximumCommandInputBytes || retained < bytes.length) {
      return inputRefused(command, "Stdin exceeds the bounded application size.");
    }
  }
  return Buffer.concat(chunks, total);
}

export async function readCommandInput(
  repositoryRoot: string,
  input: CommandInput,
  command: CommandPrefix,
): Promise<unknown> {
  const bytes = input.mode === "inline"
    ? Buffer.from(input.json, "utf8")
    : input.source === "-"
      ? await readStdin(command)
      : await readFileInput(repositoryRoot, input.source, command);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new UsfError(`${command}_INPUT_INVALID`, exitCodes.INVALID_INPUT, "Input must be one bounded UTF-8 JSON value.");
  }
}
