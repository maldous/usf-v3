import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { metricsCommandHandler } from "../../../src/commands/metrics.ts";
import { UsfError } from "../../../src/core/errors.ts";
import {
  aggregateMetrics,
  metricEventSchema,
  validateMetricEvent,
} from "../../../src/observability/metrics.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";

const repositoryRoot = new URL("../../../", import.meta.url).pathname;
const digest = `sha256:${"a".repeat(64)}`;

async function schema(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(repositoryRoot, "schemas", name), "utf8")) as unknown;
}

function completion(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const value: Record<string, unknown> = {
    schema: metricEventSchema,
    at: "2026-08-30T00:00:00.000Z",
    kind: "completion",
    run: "run-1",
    requestedRoute: "route-requested",
    requestedProvider: "provider-requested",
    requestedModel: "model-requested",
    actualProvider: "provider-actual",
    actualModel: "model-actual",
    usage: {
      inputTokens: 4,
      outputTokens: 5,
      cachedTokens: 1,
      reasoningTokens: 2,
      toolCalls: 1,
      retries: 0,
    },
    cost: {
      costClass: "zero-price",
      observedCost: 0,
      currency: "USD",
      evidence: "observed",
    },
    outcome: "accepted",
    lineage: "accepted-candidate",
    contributionDigest: digest,
    durationMs: 100,
    queueMs: 10,
    ...patch,
  };
  if (
    ![
      "accepted-candidate",
      "accepted-review",
      "accepted-repair",
      "proof-conclusion",
    ].includes(String(value.lineage))
  ) {
    delete value.contributionDigest;
  }
  return value;
}

function coverage(
  report: ReturnType<typeof aggregateMetrics>,
  key: string,
): { applicableEvents: number; observedEvents: number; unknownEvents: number } {
  return report.coverage[key] as {
    applicableEvents: number;
    observedEvents: number;
    unknownEvents: number;
  };
}

test("event validation is closed, canonical and refuses kind-inapplicable fields", async () => {
  const valid = completion();
  assert.equal(validateMetricEvent(valid)?.actualModel, "model-actual");
  const validator = createJsonSchemaValidator(await schema("metric-event.schema.json"));
  assert.equal(validator.validate(valid).valid, true);

  const unclassified = completion();
  delete unclassified.lineage;
  delete unclassified.contributionDigest;
  const parityCases: readonly {
    name: string;
    value: Record<string, unknown>;
    valid: boolean;
  }[] = [
    { name: "accepted completion", value: valid, valid: true },
    {
      name: "classified non-useful completion",
      value: completion({ lineage: "not-applicable" }),
      valid: true,
    },
    { name: "unclassified completion", value: unclassified, valid: true },
    {
      name: "request",
      value: {
        schema: metricEventSchema,
        at: valid.at,
        kind: "request",
        requestedProvider: "provider-requested",
      },
      valid: true,
    },
    {
      name: "cache",
      value: { schema: metricEventSchema, at: valid.at, kind: "cache", cacheReuse: false },
      valid: true,
    },
    {
      name: "failure with unobserved cost",
      value: {
        schema: metricEventSchema,
        at: valid.at,
        kind: "failure",
        cost: {
          costClass: "unknown",
          observedCost: null,
          evidence: "unavailable",
        },
      },
      valid: true,
    },
    {
      name: "partial concurrency observation",
      value: { schema: metricEventSchema, at: valid.at, kind: "concurrency", elapsedMs: 1 },
      valid: true,
    },
    { name: "closed event", value: { ...valid, prompt: "secret" }, valid: false },
    {
      name: "real canonical time",
      value: { ...valid, at: "2026-02-30T00:00:00.000Z" },
      valid: false,
    },
    {
      name: "request cannot carry usage",
      value: { schema: metricEventSchema, at: valid.at, kind: "request", usage: valid.usage },
      valid: false,
    },
    {
      name: "cache cannot carry duration",
      value: { schema: metricEventSchema, at: valid.at, kind: "cache", durationMs: 1 },
      valid: false,
    },
    {
      name: "failure cannot carry outcome",
      value: { schema: metricEventSchema, at: valid.at, kind: "failure", outcome: "failed" },
      valid: false,
    },
    {
      name: "concurrency cannot carry provider identity",
      value: {
        schema: metricEventSchema,
        at: valid.at,
        kind: "concurrency",
        actualProvider: "provider",
      },
      valid: false,
    },
    {
      name: "accepted lineage requires digest",
      value: completion({ contributionDigest: undefined }),
      valid: false,
    },
    {
      name: "accepted lineage requires accepted outcome",
      value: completion({ outcome: "rejected" }),
      valid: false,
    },
    {
      name: "digest requires accepted lineage",
      value: { ...unclassified, contributionDigest: digest },
      valid: false,
    },
    {
      name: "observed cost requires currency",
      value: completion({
        cost: {
          costClass: "paid",
          observedCost: 1,
          evidence: "observed",
        },
      }),
      valid: false,
    },
    {
      name: "estimated cost cannot claim observed amount",
      value: completion({
        cost: {
          costClass: "paid",
          observedCost: 1,
          currency: "USD",
          evidence: "estimated",
        },
      }),
      valid: false,
    },
  ];
  for (const item of parityCases) {
    assert.equal(
      validateMetricEvent(item.value) !== undefined,
      item.valid,
      `${item.name}: runtime parity`,
    );
    assert.equal(
      validator.validate(item.value).valid,
      item.valid,
      `${item.name}: schema parity`,
    );
  }
});

test("identity dimensions and group rows keep requested and actual values separate", () => {
  const report = aggregateMetrics(
    [
      {
        schema: metricEventSchema,
        at: "2026-08-30T00:00:00.000Z",
        kind: "request",
        run: "run-1",
        requestedRoute: "route-requested",
        requestedProvider: "provider-requested",
        requestedModel: "model-requested",
      },
      completion(),
    ],
    { view: "providers" },
  );
  assert.equal(report.denominators.requestedRoutes, 1);
  assert.equal(report.denominators.requestedProviders, 1);
  assert.equal(report.denominators.actualProviders, 1);
  const identity = report.coverage.identity as Record<
    string,
    { applicableEvents: number; observedEvents: number; unknownEvents: number }
  >;
  assert.deepEqual(identity.actualProvider, {
    applicableEvents: 1,
    observedEvents: 1,
    unknownEvents: 0,
  });
  const groups = report.items.map((item) => `${String(item.group)}:${String(item.value)}`);
  assert.ok(groups.includes("requestedRoute:route-requested"));
  assert.ok(groups.includes("requestedProvider:provider-requested"));
  assert.ok(groups.includes("actualProvider:provider-actual"));
});

test("optional usage and unattributed lineage remain unknown rather than zero", () => {
  const report = aggregateMetrics(
    [
      completion(),
      completion({
        usage: { inputTokens: 1, outputTokens: 3 },
        outcome: "rejected",
        lineage: "unattributed",
      }),
    ],
    { view: "tokens" },
  );
  assert.equal(report.totals.totalTokens, 13);
  assert.equal(report.totals.cachedTokens, null);
  assert.equal(report.totals.reasoningTokens, null);
  assert.equal(report.totals.usefulTokens, null);
  assert.equal(report.totals.usefulAttributedTokens, 9);
  assert.equal(coverage(report, "usage").unknownEvents, 0);
  assert.equal(coverage(report, "useful").unknownEvents, 1);
  const components = report.coverage.usageComponents as Record<
    string,
    { unknownEvents: number }
  >;
  assert.equal(components.cachedTokens.unknownEvents, 1);
});

test("views with no applicable event are explicitly not observed", () => {
  const report = aggregateMetrics(
    [
      {
        schema: metricEventSchema,
        at: "2026-08-30T00:00:00.000Z",
        kind: "request",
        requestedRoute: "route-a",
      },
    ],
    { view: "cache" },
  );
  assert.equal(report.status, "not-observed");
  assert.equal(report.totals.cacheReuses, null);
  assert.deepEqual(coverage(report, "cache"), {
    applicableEvents: 0,
    observedEvents: 0,
    unknownEvents: 0,
  });
});

test("time filters compare validated numeric instants", () => {
  const report = aggregateMetrics(
    [
      completion({ at: "2026-08-30T00:00:00.000Z" }),
      completion({ at: "2026-08-30T00:00:01.000Z" }),
    ],
    {
      view: "tokens",
      since: "2026-08-30T00:00:01Z",
      until: "2026-08-30T00:00:01.000Z",
    },
  );
  assert.equal(report.coverage.matchedEvents, 1);
  assert.equal(report.coverage.filteredOutEvents, 1);
  assert.throws(
    () => aggregateMetrics([], { since: "2026-08-30T00:00:02Z", until: "2026-08-30T00:00:01Z" }),
    RangeError,
  );
});

test("concurrency sums per-event slot capacity and exposes maximum concurrency", () => {
  const at = "2026-08-30T00:00:00.000Z";
  const report = aggregateMetrics(
    [
      {
        schema: metricEventSchema,
        at,
        kind: "concurrency",
        targetConcurrency: 2,
        observedConcurrency: 2,
        activeInvocationMs: 150,
        elapsedMs: 100,
      },
      {
        schema: metricEventSchema,
        at,
        kind: "concurrency",
        targetConcurrency: 4,
        observedConcurrency: 3,
        activeInvocationMs: 100,
        elapsedMs: 50,
      },
    ],
    { view: "concurrency" },
  );
  assert.equal(report.totals.availableSlotMs, 400);
  assert.equal(report.totals.activeInvocationMs, 250);
  assert.equal(report.totals.elapsedMs, 150);
  assert.equal(report.totals.targetConcurrency, 4);
  assert.equal(report.totals.observedConcurrency, 3);
  assert.equal(report.totals.utilisation, 0.625);

  const incomplete = aggregateMetrics(
    [{ schema: metricEventSchema, at, kind: "concurrency", elapsedMs: 10 }],
    { view: "concurrency" },
  );
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.totals.availableSlotMs, null);
});

test("observed costs never sum across currencies", () => {
  const report = aggregateMetrics(
    [
      completion({
        lineage: "not-applicable",
        cost: {
          costClass: "paid",
          observedCost: 1,
          currency: "USD",
          evidence: "observed",
        },
      }),
      completion({
        lineage: "not-applicable",
        cost: {
          costClass: "paid",
          observedCost: 2,
          currency: "EUR",
          evidence: "observed",
        },
      }),
    ],
    { view: "summary" },
  );
  assert.equal(report.totals.observedCost, null);
  assert.equal(report.totals.observedCostCurrency, null);
  assert.deepEqual(report.totals.observedCostByCurrency, [
    { currency: "EUR", amount: 2, events: 1 },
    { currency: "USD", amount: 1, events: 1 },
  ]);
});

test("failure kind is counted without an outcome and overflow is explicit", () => {
  const failure = (reasonCode?: string) => ({
    schema: metricEventSchema,
    at: "2026-08-30T00:00:00.000Z",
    kind: "failure",
    ...(reasonCode === undefined ? {} : { reasonCode }),
  });
  const report = aggregateMetrics(
    [failure("a"), failure("m"), failure("z")],
    { view: "failures", maxItems: 1 },
  );
  assert.equal(report.totals.failureEvents, 3);
  assert.equal(report.coverage.labelsTruncated, true);
  assert.equal(report.items.length, 2);
  assert.equal(report.items[0]?.value, "a");
  assert.equal(report.items[1]?.value, "other");
  assert.equal(report.items[1]?.overflowedGroups, 2);

  const unknown = aggregateMetrics([failure()], { view: "failures" });
  assert.equal(coverage(unknown, "failureReason").unknownEvents, 1);
  assert.equal(unknown.items[0]?.value, "unknown");
});

test("aggregate and CLI reports validate; source digest covers exact private bytes", async (t) => {
  const reportValidator = createJsonSchemaValidator(
    await schema("metrics-report.schema.json"),
  );
  const aggregate = aggregateMetrics([completion()], { view: "providers" });
  assert.equal(reportValidator.validate(aggregate).valid, true);

  const root = await mkdtemp(join(tmpdir(), "usf-metrics-"));
  const metricsDirectory = join(root, ".usf", "metrics");
  await mkdir(metricsDirectory, { recursive: true, mode: 0o700 });
  await chmod(join(root, ".usf"), 0o700);
  await chmod(metricsDirectory, 0o700);
  const input = join(metricsDirectory, "events.jsonl");
  const raw = `${JSON.stringify(completion())}\n\n`;
  await writeFile(input, raw, { mode: 0o600 });
  await chmod(input, 0o600);
  t.after(async () => rm(root, { recursive: true, force: true }));

  const result = await metricsCommandHandler({
    command: "metrics",
    args: ["summary"],
    repositoryRoot: root,
  });
  const output = result.output as Record<string, unknown>;
  assert.equal(reportValidator.validate(output).valid, true);
  const source = output.source as Record<string, unknown>;
  assert.equal(source.digestBasis, "raw-input-bytes");
  assert.equal(
    source.digest,
    `sha256:${createHash("sha256").update(raw).digest("hex")}`,
  );

  await chmod(input, 0o644);
  await assert.rejects(
    async () =>
      await metricsCommandHandler({
        command: "metrics",
        args: ["summary"],
        repositoryRoot: root,
      }),
    (error: unknown) =>
      error instanceof UsfError && error.code === "METRICS_INPUT_REFUSED",
  );

  await assert.rejects(
    async () =>
      await metricsCommandHandler({
        command: "metrics",
        args: ["summary", "--max-items", "101"],
        repositoryRoot: root,
      }),
    (error: unknown) =>
      error instanceof UsfError && error.code === "METRICS_ARGUMENTS_INVALID",
  );
});
