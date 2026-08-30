import { createHash } from "node:crypto";
import { constants } from "node:fs";
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

export const metricsCommandHandler: CommandHandler = async ({
  args,
  repositoryRoot,
}) => {
  const parsed = parse(args);
  const source = await readSource(
    repositoryRoot,
    parsed.input,
    parsed.explicitInput,
    parsed.maxEvents,
  );
  const report = aggregateMetrics(source.records, {
    ...parsed.options,
    sourceTruncated: source.truncated,
  });
  return {
    output: {
      ...report,
      source: {
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
      },
    },
  };
};
