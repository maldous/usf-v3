import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { exitCodes, UsfError } from "../core/errors.ts";
import {
  aggregateMetrics,
  metricInstant,
  type AggregateOptions,
  type MetricView,
} from "../observability/metrics.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { summarizeJobLifecycle, type LifecycleSource } from "../observability/job-lifecycle.ts";
import { appendLifecycleObservation, createLifecycleObservation } from "../observability/job-lifecycle-recorder.ts";

const views = new Set<MetricView>([
  "summary",
  "providers",
  "models",
  "tokens",
  "runs",
  "cache",
  "failures",
  "concurrency",
]);
const maximumBytes = 8 * 1024 * 1024;
const maximumEvents = 100_000;
const maximumItems = 100;
const defaultInput = ".usf/metrics/events.jsonl";
const inputPattern = /^\.usf\/metrics\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.jsonl$/;
const labelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const recordInputPattern = /^\.usf\/inputs\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.json$/;

interface ParsedMetrics {
  readonly view: MetricView;
  readonly input: string;
  readonly explicitInput: boolean;
  readonly maxEvents: number;
  readonly options: AggregateOptions;
}

interface ReadMetricsSource {
  readonly records: readonly unknown[];
  readonly truncated: boolean;
  readonly raw: Buffer | null;
  readonly missing: boolean;
}

function invalidArguments(message: string): never {
  throw new UsfError(
    "METRICS_ARGUMENTS_INVALID",
    exitCodes.INVALID_INPUT,
    message,
  );
}

function parse(args: readonly string[]): ParsedMetrics {
  const [first, ...rest] = args;
  const view =
    first !== undefined && views.has(first as MetricView)
      ? (first as MetricView)
      : "summary";
  const remaining = first === view ? rest : args;
  const flags = new Map<string, string>();
  for (let index = 0; index < remaining.length; index += 2) {
    const key = remaining[index];
    const value = remaining[index + 1];
    if (
      key === undefined ||
      value === undefined ||
      !key.startsWith("--") ||
      flags.has(key)
    ) {
      invalidArguments("Metrics arguments must be unique flag/value pairs.");
    }
    flags.set(key, value);
  }
  const allowed = new Set([
    "--input",
    "--max-events",
    "--max-items",
    "--since",
    "--until",
    "--run",
    "--provider",
    "--model",
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) invalidArguments("Unknown metrics option.");
  }

  const boundedInteger = (key: string, fallback: number, maximum: number) => {
    const text = flags.get(key);
    const value = text === undefined ? fallback : Number(text);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      invalidArguments(`${key} must be a bounded positive integer.`);
    }
    return value;
  };
  for (const key of ["--run", "--provider", "--model"] as const) {
    if (flags.has(key) && !labelPattern.test(flags.get(key)!)) {
      invalidArguments(`${key} must be a bounded identifier.`);
    }
  }
  for (const key of ["--since", "--until"] as const) {
    if (flags.has(key) && metricInstant(flags.get(key)) === undefined) {
      invalidArguments(`${key} must be a canonical UTC instant.`);
    }
  }
  const since = flags.has("--since") ? metricInstant(flags.get("--since")) : undefined;
  const until = flags.has("--until") ? metricInstant(flags.get("--until")) : undefined;
  if (since !== undefined && until !== undefined && since > until) {
    invalidArguments("--since must not be later than --until.");
  }

  return Object.freeze({
    view,
    input: flags.get("--input") ?? defaultInput,
    explicitInput: flags.has("--input"),
    maxEvents: boundedInteger("--max-events", 10_000, maximumEvents),
    options: Object.freeze({
      view,
      maxItems: boundedInteger("--max-items", 20, maximumItems),
      since: flags.get("--since"),
      until: flags.get("--until"),
      run: flags.get("--run"),
      provider: flags.get("--provider"),
      model: flags.get("--model"),
    }),
  });
}

function parseJsonLines(raw: Buffer, limit: number): ReadMetricsSource {
  const rows = raw
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  return Object.freeze({
    records: Object.freeze(
      rows.slice(0, limit).map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      }),
    ),
    truncated: rows.length > limit,
    raw,
    missing: false,
  });
}

async function readStdin(limit: number): Promise<ReadMetricsSource> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > maximumBytes) {
      throw new UsfError(
        "METRICS_INPUT_REFUSED",
        exitCodes.CONTAINMENT_REFUSAL,
        "Metrics stdin exceeds the bounded input size.",
      );
    }
    chunks.push(buffer);
  }
  return parseJsonLines(Buffer.concat(chunks, bytes), limit);
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new UsfError(
      "METRICS_INPUT_REFUSED",
      exitCodes.CONTAINMENT_REFUSAL,
      "Metrics input directories must be private, owned, real directories.",
    );
  }
}

async function readFileSource(
  repositoryRoot: string,
  input: string,
  explicit: boolean,
  limit: number,
): Promise<ReadMetricsSource> {
  const safeRoot = resolve(repositoryRoot);
  const absolute = resolve(safeRoot, input);
  const relation = relative(safeRoot, absolute);
  if (
    !inputPattern.test(input) ||
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`)
  ) {
    throw new UsfError(
      "METRICS_INPUT_REFUSED",
      exitCodes.CONTAINMENT_REFUSAL,
      "Metrics input must be a direct repository-relative .usf/metrics JSONL file.",
    );
  }

  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch {
    if (!explicit && input === defaultInput) {
      return Object.freeze({
        records: Object.freeze([]),
        truncated: false,
        raw: null,
        missing: true,
      });
    }
    throw new UsfError(
      "METRICS_INPUT_UNREADABLE",
      exitCodes.INVALID_INPUT,
      "The requested metrics input is unavailable.",
    );
  }

  await assertPrivateDirectory(resolve(safeRoot, ".usf"));
  await assertPrivateDirectory(resolve(safeRoot, ".usf/metrics"));
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > maximumBytes ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new UsfError(
      "METRICS_INPUT_REFUSED",
      exitCodes.CONTAINMENT_REFUSAL,
      "Metrics input must be a private bounded regular file owned by this user.",
    );
  }
  const canonicalRoot = await realpath(safeRoot);
  const canonicalFile = await realpath(absolute);
  const canonicalRelation = relative(canonicalRoot, canonicalFile);
  if (
    canonicalRelation === "" ||
    canonicalRelation === ".." ||
    canonicalRelation.startsWith(`..${sep}`)
  ) {
    throw new UsfError(
      "METRICS_INPUT_REFUSED",
      exitCodes.CONTAINMENT_REFUSAL,
      "Metrics input resolves outside the repository.",
    );
  }

  const handle = await open(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      opened.ino !== metadata.ino ||
      opened.dev !== metadata.dev ||
      opened.size !== metadata.size
    ) {
      throw new UsfError(
        "METRICS_INPUT_REFUSED",
        exitCodes.CONTAINMENT_REFUSAL,
        "Metrics input changed while opening.",
      );
    }
    const raw = await handle.readFile();
    const after = await lstat(absolute);
    if (
      after.ino !== opened.ino ||
      after.dev !== opened.dev ||
      after.size !== raw.length
    ) {
      throw new UsfError(
        "METRICS_INPUT_REFUSED",
        exitCodes.CONTAINMENT_REFUSAL,
        "Metrics input changed while reading.",
      );
    }
    await assertPrivateDirectory(resolve(safeRoot, ".usf"));
    await assertPrivateDirectory(resolve(safeRoot, ".usf/metrics"));
    return parseJsonLines(raw, limit);
  } finally {
    await handle.close();
  }
}

async function readSource(
  repositoryRoot: string,
  input: string,
  explicit: boolean,
  limit: number,
): Promise<ReadMetricsSource> {
  return input === "-"
    ? readStdin(limit)
    : readFileSource(repositoryRoot, input, explicit, limit);
}

function assertPrivateRecordFile(metadata: Stats): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    metadata.size > 16_384 ||
    (metadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input must be one private bounded regular file.");
  }
}

function samePrivateRecordFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

interface DirectorySnapshot {
  readonly path: string;
  readonly canonical: string;
  readonly dev: number;
  readonly ino: number;
}

async function privateDirectorySnapshot(path: string): Promise<DirectorySnapshot> {
  await assertPrivateDirectory(path);
  const metadata = await lstat(path);
  return Object.freeze({ path, canonical: await realpath(path), dev: metadata.dev, ino: metadata.ino });
}

async function rootDirectorySnapshot(path: string): Promise<DirectorySnapshot> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record repository root must be an owned non-writable real directory.");
  }
  return Object.freeze({ path, canonical: await realpath(path), dev: metadata.dev, ino: metadata.ino });
}

async function revalidateDirectorySnapshot(snapshot: DirectorySnapshot, privateDirectory: boolean): Promise<void> {
  if (await realpath(snapshot.path) !== snapshot.canonical) {
    throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input ancestor changed while reading.");
  }
  if (privateDirectory) await assertPrivateDirectory(snapshot.path);
  else await rootDirectorySnapshot(snapshot.path);
  const metadata = await lstat(snapshot.path);
  if (metadata.dev !== snapshot.dev || metadata.ino !== snapshot.ino) {
    throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input ancestor changed while reading.");
  }
}

async function recordInput(repositoryRoot: string, input: string): Promise<{ readonly value: unknown; readonly root: DirectorySnapshot }> {
  if (!recordInputPattern.test(input)) invalidArguments("Record input must be a direct .usf/inputs JSON file.");
  try {
    const root = await realpath(repositoryRoot);
    const inputs = resolve(root, ".usf/inputs");
    const rootSnapshot = await rootDirectorySnapshot(root);
    const usfSnapshot = await privateDirectorySnapshot(resolve(root, ".usf"));
    const inputsSnapshot = await privateDirectorySnapshot(inputs);
    const canonicalInputs = inputsSnapshot.canonical;
    const path = resolve(root, input);
    const namedRelation = relative(canonicalInputs, path);
    if (namedRelation === "" || namedRelation === ".." || namedRelation.startsWith(`..${sep}`) || namedRelation.includes(sep)) {
      throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input escapes the private inputs directory.");
    }
    const named = await lstat(path).catch(() => undefined);
    if (named === undefined) throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input is unavailable.");
    assertPrivateRecordFile(named);
    const canonicalPath = await realpath(path);
    const canonicalRelation = relative(canonicalInputs, canonicalPath);
    if (canonicalRelation !== namedRelation || canonicalRelation === "" || canonicalRelation === ".." || canonicalRelation.startsWith(`..${sep}`) || canonicalRelation.includes(sep)) {
      throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input resolves outside the private inputs directory.");
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      assertPrivateRecordFile(opened);
      if (!samePrivateRecordFile(named, opened)) throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input changed while opening.");
      const raw = await handle.readFile();
      if (raw.byteLength !== opened.size) throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input changed while reading.");
      const after = await lstat(path);
      assertPrivateRecordFile(after);
      if (!samePrivateRecordFile(opened, after)) throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input changed while reading.");
      if (await realpath(path) !== canonicalPath) throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input changed while reading.");
      await revalidateDirectorySnapshot(rootSnapshot, false);
      await revalidateDirectorySnapshot(usfSnapshot, true);
      await revalidateDirectorySnapshot(inputsSnapshot, true);
      try {
        return Object.freeze({ value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)), root: rootSnapshot });
      } catch {
        throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.INVALID_INPUT, "Record input must be UTF-8 JSON.");
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof UsfError) throw error;
    throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record input could not be authenticated.");
  }
}

export const metricsCommandHandler: CommandHandler = async ({
  args,
  repositoryRoot,
}) => {
  if (args[0] === "record") {
    if (args.length !== 3 || args[1] !== "--input") invalidArguments("metrics record requires exactly --input PATH.");
    const authenticated = await recordInput(repositoryRoot, args[2]!);
    const event = createLifecycleObservation(authenticated.value);
    try {
      await revalidateDirectorySnapshot(authenticated.root, false);
    } catch (error) {
      if (error instanceof UsfError) throw error;
      throw new UsfError("METRICS_INPUT_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Record root changed before append.");
    }
    const result = await appendLifecycleObservation(authenticated.root.canonical, event);
    return { output: Object.freeze({ schema: "urn:usf:job-lifecycle-record-result:1", ...result, acceptanceStatus: "unverified", acceptedOutcome: null }) };
  }
  const parsed = parse(args);
  const source = await readSource(
    repositoryRoot,
    parsed.input,
    parsed.explicitInput,
    parsed.maxEvents,
  );
  const lifecycleSelection = parsed.view === "summary" && parsed.explicitInput && (parsed.input === "-" || source.records.length === 0 || source.records.every((row) => typeof row === "object" && row !== null && (row as Record<string, unknown>).schema === "urn:usf:job-lifecycle-metric-event:2"));
  if (parsed.explicitInput && source.records.some((row) => typeof row === "object" && row !== null && (row as Record<string, unknown>).schema === "urn:usf:job-lifecycle-metric-event:2") && !lifecycleSelection) invalidArguments("Lifecycle metrics support only explicit summary input without v1 filters.");
  const sourceDetails: LifecycleSource = {
        status: source.missing ? "not-observed" : "observed",
        kind: parsed.input === "-" ? "stdin" : "repository-relative-jsonl",
        path: parsed.input === "-" ? null : parsed.input,
        eventLimit: parsed.maxEvents,
        eventsRead: source.records.length,
        bytesRead: source.raw?.length ?? 0,
        truncated: source.truncated,
        digest:
          source.raw === null
            ? null
            : `sha256:${createHash("sha256").update(source.raw).digest("hex")}`,
        digestBasis: source.raw === null ? "not-observed" : "raw-input-bytes",
  };
  if (lifecycleSelection) {
    if (parsed.options.since !== undefined || parsed.options.until !== undefined || parsed.options.run !== undefined || parsed.options.provider !== undefined || parsed.options.model !== undefined) invalidArguments("Lifecycle metrics do not support v1 filters.");
    return { output: summarizeJobLifecycle(source.records, { source: sourceDetails, maxItems: parsed.options.maxItems ?? 20 }) };
  }
  const report = aggregateMetrics(source.records, { ...parsed.options, sourceTruncated: source.truncated });
  return { output: { ...report, source: sourceDetails } };
};
