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

/**
 * The exact argv for one bounded Claude CLI worker turn.
 *
 * One flag matters and was missing. Without --model the CLI inherits the
 * operator's interactive default -- at the time of writing a heavyweight
 * reasoning configuration -- so worker units drew the supervisor's own model
 * and died at the timeout; both recorded failures of this route were exactly
 * that.
 *
 * This comment used to name a second flag, --max-turns 1, as bounding the
 * agentic loop, three lines above an inline comment saying that flag does not
 * exist and had been removed as stale knowledge. Two comments in one function
 * disagreeing is worse than either alone: an agent reading the first would
 * reintroduce a flag the binary rejects, which fails the whole route as a usage
 * error. Verified against claude 2.1.251: --max-turns appears nowhere in its
 * help, and --output-format offers exactly text, json and stream-json.
 */
export function claudeCliArguments(prompt: string, model: string | null): readonly string[] {
  // No turn-bounding flag: the installed CLI's help does not list one, and a
  // flag the binary rejects fails the whole route as a usage error. Verified
  // against the binary, not remembered -- the first version of this function
  // carried --max-turns from stale knowledge of a different build.
  return Object.freeze([
    "-p", prompt,
    "--output-format", "json",
    // Restrict the surface while keeping subscription authentication: no
    // built-in tools (one empty --tools set), no ambient MCP servers or
    // customisations. The turn is bounded by restriction, not by a turn flag.
    "--safe-mode",
    "--tools", "",
    "--strict-mcp-config",
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
    const failed = error as { killed?: boolean; stdout?: unknown; stderr?: unknown };
    const detail = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    const killed = failed.killed === true;
    // A non-zero exit still carries the CLI's own report on the error object's
    // stdout/stderr, and that report is the only place a subscription usage
    // limit is visible: the bare exit code reads as a transport defect, which
    // is how twelve limit refusals once burned the attempt ceiling and stood
    // Sonnet and Fable down for a day. The signature is a family match on the
    // CLI's own words, not a verified exact message; anything unmatched still
    // records the full detail for the next diagnosis.
    const report = `${typeof failed.stdout === "string" ? failed.stdout : ""}\n${typeof failed.stderr === "string" ? failed.stderr : ""}\n${detail}`;
    const limited = claudeUsageLimitSignature(report);
    return frozenRefusal(
      "claude-cli",
      killed ? "TRANSPORT_TIMEOUT" : limited ? "TRANSPORT_USAGE_LIMIT_EXCEEDED" : "TRANSPORT_INVOCATION_FAILED",
      detail,
    );
  }

  // The CLI's result JSON is one line of stdout, but stdout is not only the
  // result: the installed build appends stray diagnostics after it -- an MCP
  // warning at the time this was found -- and parsing the whole buffer threw
  // Extra data, classifying every successful turn as unparseable. Four recorded
  // route failures were exactly this, while the probe's own JSON carried
  // subtype success and a result. Parse per line and take the first document
  // that has the result shape.
  let parsed: Record<string, unknown> | null = null;
  for (const line of stdout.split("\n")) {
    const candidateLine = line.trim();
    if (!candidateLine.startsWith("{")) continue;
    try {
      const document = JSON.parse(candidateLine) as Record<string, unknown>;
      if ("is_error" in document || "result" in document || "subtype" in document) { parsed = document; break; }
    } catch { continue; }
  }
  if (parsed === null) {
    return frozenRefusal("claude-cli", "TRANSPORT_OUTPUT_UNPARSEABLE", stdout.slice(0, 200));
  }
  if (parsed.is_error === true || parsed.subtype !== "success") {
    const status = typeof parsed.api_error_status === "string" ? parsed.api_error_status : null;
    // An in-band error turn can also be a usage limit; its words are in the
    // result field. Same family match, same honesty boundary as above.
    const inBand = `${typeof parsed.result === "string" ? parsed.result : ""} ${status ?? ""}`;
    if (claudeUsageLimitSignature(inBand)) {
      return frozenRefusal("claude-cli", "TRANSPORT_USAGE_LIMIT_EXCEEDED", inBand.trim().slice(0, 300));
    }
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

/**
 * A declared codex model may carry its effort as a suffix: "model@effort".
 *
 * Codex expresses effort as configuration, not as part of the model name, so
 * without this the effort dimension could not be declared, measured or ranked
 * per candidate the way antigravity's tier-named models already are. The
 * default is low: a worker turn is bounded generation, and the operator's own
 * config proved what inheriting a supervising effort costs -- single units at
 * a million tokens of internal reasoning.
 */
export function codexModelSelection(declared: string | null): Readonly<{ model: string | null; effort: string }> {
  if (declared === null || declared.length === 0) return Object.freeze({ model: null, effort: "low" });
  const at = declared.lastIndexOf("@");
  if (at <= 0) return Object.freeze({ model: declared, effort: "low" });
  const effort = declared.slice(at + 1);
  return Object.freeze({
    model: declared.slice(0, at),
    effort: ["minimal", "low", "medium", "high", "xhigh"].includes(effort) ? effort : "low",
  });
}

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
        ((): readonly string[] => {
          // The operator's config.toml sets model_reasoning_effort for their own
          // interactive use -- xhigh at the time this was found -- and exec
          // inherits it, which is how single worker units burned a million
          // tokens of internal reasoning. Effort is therefore always pinned
          // explicitly, from the declared model@effort suffix or the low
          // default, never inherited.
          const selection = codexModelSelection(model);
          return [
            "exec", "--json", "-s", "read-only", "--skip-git-repo-check",
            "-c", `model_reasoning_effort="${selection.effort}"`,
            ...(selection.model === null ? [] : ["-m", selection.model]),
            "-o", lastMessagePath, prompt,
          ];
        })(),
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
 * The instant an antigravity quota refusal says it clears, as ISO 8601.
 *
 * The CLI states the reset relatively -- "Resets in 137h51m25s", measured
 * against the installed build -- so the instant is derived from the clock the
 * refusal was observed on. An unparseable or absent duration returns null and
 * the deferral falls back to its class default.
 */
/**
 * Whether a failed Claude CLI turn's own report names a subscription usage
 * limit. A family match on the CLI's words, not a verified exact message:
 * matched turns defer as temporary limits, unmatched ones keep the full
 * detail and the defect classification.
 */
export function claudeUsageLimitSignature(report: string): boolean {
  return /usage limit|limit reached|out of usage/iu.test(report);
}

/**
 * Classify a failed antigravity turn from the result envelope's own error
 * text. Quota and unknown-model wordings are measured against the installed
 * build; anything else stays a turn failure carrying its detail.
 */
export function classifyAntigravityFailureDetail(
  detail: string,
): "TRANSPORT_USAGE_LIMIT_EXCEEDED" | "TRANSPORT_MODEL_NOT_ACCEPTED" | "TRANSPORT_SESSION_UNAUTHENTICATED" | "TRANSPORT_TURN_FAILED" {
  // A quota refusal is temporary and provider-stated, and it names its own
  // reset instant; classifying it as a defect once burned the attempt ceiling
  // and stood every Gemini tier down as TRANSPORT_INVOCATION_FAILED.
  if (/quota reached|upgrade your subscription/iu.test(detail)) return "TRANSPORT_USAGE_LIMIT_EXCEEDED";
  // The CLI reports an unknown model by listing the models it does accept.
  if (/invalid model selection|not recognized as a known model/iu.test(detail)) return "TRANSPORT_MODEL_NOT_ACCEPTED";
  if (/sign in|not signed in/iu.test(detail)) return "TRANSPORT_SESSION_UNAUTHENTICATED";
  return "TRANSPORT_TURN_FAILED";
}

export function antigravityQuotaResetInstant(detail: string, observedAtMs: number): string | null {
  const match = /resets in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/iu.exec(detail);
  if (match === null || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) return null;
  const ms = (Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1000;
  if (ms <= 0) return null;
  return new Date(observedAtMs + ms).toISOString();
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
/**
 * The exact argv for one bounded Antigravity CLI worker turn.
 *
 * Mode is pinned, and pinned to accept-edits rather than plan. In plan mode this
 * CLI answers a generation request by writing an implementation-plan artefact
 * and asking for approval -- "I've created an implementation plan ... you can
 * review it" -- so the route cannot return the work at all. Measured over one
 * session: 20 of 20 invocations succeeded, 0 of 13 outputs survived admission,
 * and 606 619 output tokens were spent producing plans nobody asked for. A
 * perfect transport record and no useful work is the worst shape a route can
 * have, because nothing in the transport layer reports it.
 *
 * Compared directly on one repair prompt, from a scratch working directory so
 * neither mode could touch the repository: accept-edits returned the complete
 * corrected module carrying the fix in 648 output tokens, plan returned 406
 * characters of narrative in 1 359, and neither created a file. Verified against
 * the installed binary, whose --mode accepts only accept-edits or plan.
 */
export function antigravityCliArguments(prompt: string, modelId: string): readonly string[] {
  return Object.freeze([
    "--print", prompt,
    "--output-format", "stream-json",
    "--sandbox",
    "--mode", "accept-edits",
    "--model", modelId,
  ]);
}

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
      [...antigravityCliArguments(prompt, modelId)],
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
    // The installed build exits non-zero on a refused turn while its result
    // envelope -- quota, unknown model, error text -- is already complete on
    // stdout. Measured: "Individual quota reached ... Resets in 137h51m25s"
    // exits 1. The exit code is therefore not the classification; when the
    // envelope arrived, fall through and let it speak. Only a kill or an
    // empty stream is a transport-level failure.
    if (!killed && stdoutText.trim().length > 0) {
      stdout = stdoutText;
    } else {
      return frozenRefusal("antigravity-cli", killed ? "TRANSPORT_TIMEOUT" : "TRANSPORT_INVOCATION_FAILED", detail);
    }
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
    const code = classifyAntigravityFailureDetail(detail);
    return frozenRefusal("antigravity-cli", code, detail.slice(0, 300),
      code === "TRANSPORT_USAGE_LIMIT_EXCEEDED" ? antigravityQuotaResetInstant(detail, Date.now()) : null);
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
