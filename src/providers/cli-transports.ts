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
  /** Prompt-cache activity, when the transport reports it. */
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
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
/**
 * The exact argv for one bounded Claude CLI worker turn.
 *
 * Two flags matter and were missing. Without --model the CLI inherits the
 * operator's interactive default -- at the time of writing a heavyweight
 * reasoning configuration -- so worker units drew the supervisor's own model
 * and died at the timeout; both recorded failures of this route were exactly
 * that. And --max-turns 1 bounds the CLI's agentic loop to a single answer: a
 * worker unit needs one generation, not a session.
 */
export function claudeCliArguments(prompt: string, model: string | null): readonly string[] {
  // No turn-bounding flag: the installed CLI's help does not list one, and a
  // flag the binary rejects fails the whole route as a usage error. Verified
  // against the binary, not remembered -- the first version of this function
  // carried --max-turns from stale knowledge of a different build.
  return Object.freeze([
    "-p", prompt,
    "--output-format", "json",
    ...(model === null || model.length === 0 ? [] : ["--model", model]),
  ]);
}

export async function invokeClaudeCli(
  prompt: string,
  timeoutMs: number,
  model: string | null = null,
  executable = "claude",
): Promise<CliInvocationResult> {
  let stdout: string;
  try {
    const produced = await runFile(executable, [...claudeCliArguments(prompt, model)], {
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
  // Claude Code prompt-caches its own API calls and reports the split, which is
  // exactly the measurement the prefix-stable prompt layout exists to feed.
  const cacheReadTokens = integerOrNull(usage.cache_read_input_tokens);
  const cacheWriteTokens = integerOrNull(usage.cache_creation_input_tokens);
  return Object.freeze({
    transport: "claude-cli" as const,
    outcome: "ok" as const,
    reasonCode: "INVOCATION_OK",
    cacheReadTokens,
    cacheWriteTokens,
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
    cacheReadTokens: null,
    cacheWriteTokens: null,
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
  /**
   * Named from graph authority. The transport's default model carries its own
   * quota, so invoking without naming one can exhaust against a model the
   * operator never chose while another still answers.
   */
  model: string | null = null,
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
        [
          "exec", "--json", "-s", "read-only", "--skip-git-repo-check",
          // The operator's config.toml sets model_reasoning_effort for their own
          // interactive use -- xhigh at the time this was found -- and exec
          // inherits it, which is how single worker units burned a million
          // tokens of internal reasoning. A worker turn is bounded generation:
          // pin the effort low explicitly, the same lever the antigravity
          // declarations already use through their model tier names.
          "-c", 'model_reasoning_effort="low"',
          ...(model === null || model.length === 0 ? [] : ["-m", model]),
          "-o", lastMessagePath, prompt,
        ],
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
      cacheReadTokens: null,
      cacheWriteTokens: null,
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

/**
 * Antigravity CLI: one bounded non-interactive turn.
 *
 * The interface is taken from V2's working adapter rather than guessed: the
 * prompt is the argument to `--print`, because passing it on standard input
 * makes the CLI read `--model` as the prompt and silently invoke its configured
 * default. Stream JSON is required because the routed model identity comes from
 * the provider-reported init envelope, never from configuration. An explicit
 * model identity is mandatory; there is no default fallback.
 */
export async function invokeAntigravityCli(
  prompt: string,
  modelId: string,
  timeoutMs: number,
  executable = "agy",
): Promise<CliInvocationResult> {
  if (modelId.length === 0 || modelId === "default") {
    return frozenRefusal("antigravity-cli", "TRANSPORT_MODEL_IDENTITY_REQUIRED",
      "antigravity-cli requires an explicit model identity and permits no default fallback");
  }
  let stdout: string;
  try {
    const produced = await runFile(
      executable,
      ["--print", prompt, "--output-format", "stream-json", "--sandbox", "--mode", "plan", "--model", modelId],
      { timeout: timeoutMs, maxBuffer: maximumOutputBytes, encoding: "utf8", windowsHide: true },
    );
    stdout = produced.stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    const killed = (error as { killed?: boolean }).killed === true;
    const stdoutText = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
    if (/sign in|not signed in|please sign/iu.test(`${detail} ${stdoutText}`)) {
      return frozenRefusal("antigravity-cli", "TRANSPORT_SESSION_UNAUTHENTICATED",
        "the Antigravity CLI holds no signed-in session");
    }
    return frozenRefusal("antigravity-cli", killed ? "TRANSPORT_TIMEOUT" : "TRANSPORT_INVOCATION_FAILED", detail);
  }

  if (/sign in|not signed in|please sign/iu.test(stdout)) {
    return frozenRefusal("antigravity-cli", "TRANSPORT_SESSION_UNAUTHENTICATED",
      "the Antigravity CLI holds no signed-in session");
  }

  // Parse the stream-JSON envelope. The init event carries the routed identity;
  // the terminal result event carries the answer, usage and conversation id.
  let initModel: string | null = null;
  let status: string | null = null;
  let response: string | null = null;
  let conversationId: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let totalTokens: number | null = null;
  let resultError: string | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }
    if (event.event === "init" && typeof event.init === "object" && event.init !== null) {
      const reported = (event.init as { model?: unknown }).model;
      if (typeof reported === "string" && reported.length > 0) {
        // Two conflicting identities in one turn is a defect, not a choice.
        if (initModel !== null && initModel !== reported) {
          return frozenRefusal("antigravity-cli", "TRANSPORT_CONFLICTING_MODEL_IDENTITY", `first=${initModel} later=${reported}`);
        }
        initModel = reported;
      }
      continue;
    }
    if (event.event !== "result" || typeof event.result !== "object" || event.result === null) continue;
    const result = event.result as Record<string, unknown>;
    if (typeof result.status === "string") status = result.status;
    if (typeof result.response === "string") response = result.response;
    if (typeof result.conversation_id === "string" && result.conversation_id.length > 0) {
      conversationId = result.conversation_id;
    }
    if (typeof result.error === "string" && result.error.length > 0) resultError = result.error;
    if (typeof result.usage === "object" && result.usage !== null) {
      const usage = result.usage as Record<string, unknown>;
      inputTokens = integerOrNull(usage.input_tokens);
      outputTokens = integerOrNull(usage.output_tokens);
      totalTokens = integerOrNull(usage.total_tokens);
    }
  }

  if (status !== "SUCCESS") {
    const detail = resultError ?? `status=${status ?? "absent"}`;
    // The CLI reports an unknown model by listing the models it does accept.
    const code = /invalid model selection|not recognized as a known model/iu.test(detail)
      ? "TRANSPORT_MODEL_NOT_ACCEPTED"
      : /sign in|not signed in/iu.test(detail)
        ? "TRANSPORT_SESSION_UNAUTHENTICATED"
        : "TRANSPORT_TURN_FAILED";
    return frozenRefusal("antigravity-cli", code, detail.slice(0, 300));
  }
  const text = (response ?? "").trim();
  if (text.length === 0) return frozenRefusal("antigravity-cli", "TRANSPORT_OUTPUT_ABSENT", null);
  return Object.freeze({
    transport: "antigravity-cli" as const,
    outcome: "ok" as const,
    cacheReadTokens: null, cacheWriteTokens: null,
    reasonCode: "INVOCATION_OK",
    text,
    // Provider-reported, never the configured default.
    actualModel: initModel,
    invocationIdentity: conversationId,
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    transportReportedCostUsd: null,
    latencyMsReported: null,
    retryAfter: null,
    refusalDetail: null,
  });
}
