import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExecutionTransportId } from "./transports.ts";

const runFile = promisify(execFile);
const maximumOutputBytes = 8 * 1024 * 1024;

/**
 * A local agent CLI is a first-class V3 execution transport. It authenticates
 * through its own session mechanism, so no API credential abstraction is built
 * around it. Its result is normalized into the same envelope the AI SDK
 * adapters produce, and any identity the CLI does not expose is recorded as
 * null rather than invented.
 */
export interface CliInvocationResult {
  readonly transport: ExecutionTransportId;
  readonly outcome: "ok" | "refused";
  readonly reasonCode: string;
  /** Model text answer, or null when the transport refused. */
  readonly text: string | null;
  /** Underlying model identity when the transport exposes it, else null. */
  readonly actualModel: string | null;
  /** Transport-native invocation identity, when exposed. */
  readonly invocationIdentity: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  /** Cost the transport itself reports, on a list basis, when exposed. */
  readonly transportReportedCostUsd: number | null;
  readonly latencyMsReported: number | null;
  /** Provider-stated retry instant for a usage-limit refusal, when exposed. */
  readonly retryAfter: string | null;
  readonly refusalDetail: string | null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Claude CLI: one bounded non-interactive turn with structured JSON output. */
export async function invokeClaudeCli(
  prompt: string,
  timeoutMs: number,
  executable = "claude",
): Promise<CliInvocationResult> {
  let stdout: string;
  try {
    const produced = await runFile(executable, ["-p", prompt, "--output-format", "json"], {
      timeout: timeoutMs,
      maxBuffer: maximumOutputBytes,
      encoding: "utf8",
      windowsHide: true,
    });
    stdout = produced.stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    const killed = (error as { killed?: boolean }).killed === true;
    return frozenRefusal("claude-cli", killed ? "TRANSPORT_TIMEOUT" : "TRANSPORT_INVOCATION_FAILED", detail);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return frozenRefusal("claude-cli", "TRANSPORT_OUTPUT_UNPARSEABLE", null);
  }
  if (parsed.is_error === true || parsed.subtype !== "success") {
    const status = typeof parsed.api_error_status === "string" ? parsed.api_error_status : null;
    return frozenRefusal("claude-cli", "TRANSPORT_TURN_FAILED", status);
  }
  const usage = (parsed.usage ?? {}) as Record<string, unknown>;
  const modelUsage = (parsed.modelUsage ?? {}) as Record<string, unknown>;
  const models = Object.keys(modelUsage).sort();
  const inputTokens = integerOrNull(usage.input_tokens);
  const outputTokens = integerOrNull(usage.output_tokens);
  return Object.freeze({
    transport: "claude-cli" as const,
    outcome: "ok" as const,
    reasonCode: "INVOCATION_OK",
    text: typeof parsed.result === "string" ? parsed.result : null,
    // The CLI may use several models in one turn; report the exact set it named.
    actualModel: models.length === 0 ? null : models.join("+"),
    invocationIdentity: typeof parsed.session_id === "string" ? parsed.session_id : null,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    transportReportedCostUsd: integerOrNull(parsed.total_cost_usd),
    latencyMsReported: integerOrNull(parsed.duration_api_ms),
    retryAfter: null,
    refusalDetail: null,
  });
}

function frozenRefusal(
  transport: ExecutionTransportId,
  reasonCode: string,
  refusalDetail: string | null,
  retryAfter: string | null = null,
): CliInvocationResult {
  return Object.freeze({
    transport,
    outcome: "refused" as const,
    reasonCode,
    text: null,
    actualModel: null,
    invocationIdentity: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    transportReportedCostUsd: null,
    latencyMsReported: null,
    retryAfter,
    refusalDetail,
  });
}

/**
 * Codex CLI: one bounded non-interactive read-only turn. The final message is
 * captured from an explicit file and usage/refusal facts from the JSONL event
 * stream. Standard input is closed so the CLI never waits for more input.
 */
export async function invokeCodexCli(
  prompt: string,
  timeoutMs: number,
  executable = "codex",
): Promise<CliInvocationResult> {
  const scratch = await mkdtemp(join(tmpdir(), "usf-codex-"));
  const lastMessagePath = join(scratch, "last-message.txt");
  try {
    // Codex reads additional instructions from standard input when it stays
    // open, so stdin is closed explicitly. A hung transport must refuse, not
    // block the scheduler.
    const { stdout, timedOut } = await new Promise<{ stdout: string; timedOut: boolean }>((settle) => {
      const child = spawn(
        executable,
        ["exec", "--json", "-s", "read-only", "--skip-git-repo-check", "-o", lastMessagePath, prompt],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      let collected = "";
      let bytes = 0;
      let expired = false;
      const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk, "utf8");
        if (bytes <= maximumOutputBytes) collected += chunk;
      });
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timer); settle({ stdout: collected, timedOut: expired }); });
      child.on("close", () => { clearTimeout(timer); settle({ stdout: collected, timedOut: expired }); });
    });
    if (timedOut && stdout.length === 0) return frozenRefusal("codex-cli", "TRANSPORT_TIMEOUT", null);

    let usageEvent: Record<string, unknown> | undefined;
    let errorMessage: string | undefined;
    let threadId: string | undefined;
    let failed = false;
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
      if (type === "error" && typeof event.message === "string") errorMessage = event.message;
      if (type === "turn.failed") failed = true;
      if (type === "turn.completed") usageEvent = event;
    }

    if (errorMessage !== undefined || failed) {
      const detail = errorMessage ?? "the codex turn failed without an explicit message";
      // A subscription usage limit is a precise, temporary refusal, not a defect.
      const limited = /usage limit|purchase more credits|try again at/i.test(detail);
      const instant = /try again at ([^.]+)\./i.exec(detail)?.[1]?.trim() ?? null;
      return frozenRefusal(
        "codex-cli",
        limited ? "TRANSPORT_USAGE_LIMIT_EXCEEDED" : "TRANSPORT_TURN_FAILED",
        detail.slice(0, 300),
        limited ? instant : null,
      );
    }

    const text = await readFile(lastMessagePath, "utf8").catch(() => undefined);
    if (text === undefined) return frozenRefusal("codex-cli", "TRANSPORT_OUTPUT_ABSENT", null);
    const usage = (usageEvent?.usage ?? {}) as Record<string, unknown>;
    const inputTokens = integerOrNull(usage.input_tokens);
    const outputTokens = integerOrNull(usage.output_tokens);
    return Object.freeze({
      transport: "codex-cli" as const,
      outcome: "ok" as const,
      reasonCode: "INVOCATION_OK",
      text,
      // Codex exec does not report the resolved underlying model identity.
      actualModel: null,
      invocationIdentity: threadId ?? null,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
      transportReportedCostUsd: null,
      latencyMsReported: null,
      retryAfter: null,
      refusalDetail: null,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
