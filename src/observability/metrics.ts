/** Pure, bounded classification of local operational JSONL. */
export const metricEventSchema = "urn:usf:metric-event:1" as const;
export const metricsReportSchema = "urn:usf:metrics-report:1" as const;

const maximumAggregateEvents = 100_000;
const maximumAggregateItems = 100;
const maximumAggregatableNatural = 45_000_000_000;
const maximumConcurrency = 10_000;
const maximumConcurrencyIntervalMs = 9_000_000;
const maximumObservedCost = 1_000_000_000;
const labelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const instantPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;

const metricKinds = new Set(["request", "completion", "cache", "failure", "concurrency"]);
const acceptedLineages = new Set([
  "accepted-candidate",
  "accepted-review",
  "accepted-repair",
  "proof-conclusion",
]);
const lineages = new Set([...acceptedLineages, "unattributed", "not-applicable"]);
const costClasses = new Set([
  "local",
  "zero-price",
  "free-quota",
  "subscription",
  "paid",
  "unknown",
]);

export type MetricView =
  | "summary"
  | "providers"
  | "models"
  | "tokens"
  | "runs"
  | "cache"
  | "failures"
  | "concurrency";

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly toolCalls?: number;
  readonly retries?: number;
}

export interface Cost {
  readonly costClass:
    | "local"
    | "zero-price"
    | "free-quota"
    | "subscription"
    | "paid"
    | "unknown";
  readonly observedCost: number | null;
  readonly currency?: string;
  readonly evidence: "observed" | "estimated" | "unavailable";
}

export interface MetricEvent {
  readonly schema: typeof metricEventSchema;
  readonly at: string;
  readonly kind: "request" | "completion" | "cache" | "failure" | "concurrency";
  readonly run?: string;
  readonly requestedRoute?: string;
  readonly requestedProvider?: string;
  readonly requestedModel?: string;
  readonly actualProvider?: string;
  readonly actualModel?: string;
  readonly usage?: Usage;
  readonly cost?: Cost;
  readonly outcome?: "accepted" | "rejected" | "failed";
  readonly cacheReuse?: boolean;
  readonly reasonCode?: string;
  readonly lineage?:
    | "accepted-candidate"
    | "accepted-review"
    | "accepted-repair"
    | "proof-conclusion"
    | "unattributed"
    | "not-applicable";
  readonly contributionDigest?: `sha256:${string}`;
  readonly targetConcurrency?: number;
  readonly observedConcurrency?: number;
  readonly activeInvocationMs?: number;
  readonly elapsedMs?: number;
  readonly queueMs?: number;
  readonly durationMs?: number;
}

export interface MetricFilters {
  readonly since?: string;
  readonly until?: string;
  readonly run?: string;
  /** Filters the observed actual provider, never the requested identity. */
  readonly provider?: string;
  /** Filters the observed actual model, never the requested identity. */
  readonly model?: string;
}

export interface AggregateOptions extends MetricFilters {
  readonly view?: MetricView;
  readonly maxItems?: number;
  readonly sourceTruncated?: boolean;
}

export interface DimensionCoverage {
  readonly applicableEvents: number;
  readonly observedEvents: number;
  readonly unknownEvents: number;
}

export interface MetricsReport {
  readonly schema: typeof metricsReportSchema;
  readonly status: "ok" | "incomplete" | "not-observed";
  readonly view: MetricView;
  readonly coverage: Readonly<Record<string, unknown>>;
  readonly denominators: Readonly<Record<string, number | null>>;
  readonly totals: Readonly<Record<string, unknown>>;
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly nonclaims: readonly string[];
}

type MetricKind = MetricEvent["kind"];
type IdentityField =
  | "requestedRoute"
  | "requestedProvider"
  | "requestedModel"
  | "actualProvider"
  | "actualModel"
  | "run";
type UsageComponent = "cachedTokens" | "reasoningTokens" | "toolCalls" | "retries";
type GroupName = IdentityField | "failureReason";

const commonFields = ["schema", "at", "kind", "run"] as const;
const fieldsByKind: Readonly<Record<MetricKind, readonly string[]>> = Object.freeze({
  request: Object.freeze([
    ...commonFields,
    "requestedRoute",
    "requestedProvider",
    "requestedModel",
  ]),
  completion: Object.freeze([
    ...commonFields,
    "requestedRoute",
    "requestedProvider",
    "requestedModel",
    "actualProvider",
    "actualModel",
    "usage",
    "cost",
    "outcome",
    "reasonCode",
    "lineage",
    "contributionDigest",
    "queueMs",
    "durationMs",
  ]),
  cache: Object.freeze([
    ...commonFields,
    "requestedRoute",
    "requestedProvider",
    "requestedModel",
    "actualProvider",
    "actualModel",
    "cacheReuse",
  ]),
  failure: Object.freeze([
    ...commonFields,
    "requestedRoute",
    "requestedProvider",
    "requestedModel",
    "actualProvider",
    "actualModel",
    "usage",
    "cost",
    "reasonCode",
    "queueMs",
    "durationMs",
  ]),
  concurrency: Object.freeze([
    ...commonFields,
    "targetConcurrency",
    "observedConcurrency",
    "activeInvocationMs",
    "elapsedMs",
  ]),
});

const identityKinds: Readonly<Record<IdentityField, ReadonlySet<MetricKind>>> =
  Object.freeze({
    requestedRoute: new Set<MetricKind>(["request", "completion", "cache", "failure"]),
    requestedProvider: new Set<MetricKind>(["request", "completion", "cache", "failure"]),
    requestedModel: new Set<MetricKind>(["request", "completion", "cache", "failure"]),
    actualProvider: new Set<MetricKind>(["completion", "cache", "failure"]),
    actualModel: new Set<MetricKind>(["completion", "cache", "failure"]),
    run: new Set<MetricKind>(["request", "completion", "cache", "failure", "concurrency"]),
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isClosed = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const isNatural = (
  value: unknown,
  maximum = maximumAggregatableNatural,
): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;

const isNamed = (value: unknown): value is string =>
  typeof value === "string" && labelPattern.test(value);

/** Accept only real UTC instants in the one canonical representation used by events. */
export function metricInstant(value: unknown): number | undefined {
  if (typeof value !== "string" || !instantPattern.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  const normalised = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return new Date(milliseconds).toISOString() === normalised ? milliseconds : undefined;
}

function validUsage(value: unknown): value is Usage {
  return (
    isRecord(value) &&
    isClosed(value, [
      "inputTokens",
      "outputTokens",
      "cachedTokens",
      "reasoningTokens",
      "toolCalls",
      "retries",
    ]) &&
    isNatural(value.inputTokens) &&
    isNatural(value.outputTokens) &&
    [value.cachedTokens, value.reasoningTokens, value.toolCalls, value.retries].every(
      (item) => item === undefined || isNatural(item),
    )
  );
}

function validCost(value: unknown): value is Cost {
  if (
    !isRecord(value) ||
    !isClosed(value, ["costClass", "observedCost", "currency", "evidence"]) ||
    typeof value.costClass !== "string" ||
    !costClasses.has(value.costClass) ||
    !["observed", "estimated", "unavailable"].includes(String(value.evidence)) ||
    (value.currency !== undefined &&
      (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)))
  ) {
    return false;
  }
  if (value.evidence === "observed") {
    return (
      typeof value.observedCost === "number" &&
      Number.isFinite(value.observedCost) &&
      value.observedCost >= 0 &&
      value.observedCost <= maximumObservedCost &&
      value.currency !== undefined
    );
  }
  return value.observedCost === null && value.currency === undefined;
}

/** Refuse inapplicable fields instead of silently applying them to another kind. */
export function validateMetricEvent(value: unknown): MetricEvent | undefined {
  if (
    !isRecord(value) ||
    value.schema !== metricEventSchema ||
    metricInstant(value.at) === undefined ||
    typeof value.kind !== "string" ||
    !metricKinds.has(value.kind) ||
    !isClosed(value, fieldsByKind[value.kind as MetricKind])
  ) {
    return undefined;
  }

  for (const key of [
    "run",
    "requestedRoute",
    "requestedProvider",
    "requestedModel",
    "actualProvider",
    "actualModel",
    "reasonCode",
  ] as const) {
    if (value[key] !== undefined && !isNamed(value[key])) return undefined;
  }
  if (value.usage !== undefined && !validUsage(value.usage)) return undefined;
  if (value.cost !== undefined && !validCost(value.cost)) return undefined;
  if (
    value.outcome !== undefined &&
    !["accepted", "rejected", "failed"].includes(String(value.outcome))
  ) {
    return undefined;
  }
  if (value.cacheReuse !== undefined && typeof value.cacheReuse !== "boolean") return undefined;
  if (
    value.lineage !== undefined &&
    (typeof value.lineage !== "string" || !lineages.has(value.lineage))
  ) {
    return undefined;
  }
  if (
    value.targetConcurrency !== undefined &&
    !isNatural(value.targetConcurrency, maximumConcurrency)
  ) {
    return undefined;
  }
  if (
    value.observedConcurrency !== undefined &&
    !isNatural(value.observedConcurrency, maximumConcurrency)
  ) {
    return undefined;
  }
  for (const key of ["activeInvocationMs", "elapsedMs"] as const) {
    if (
      value[key] !== undefined &&
      !isNatural(value[key], maximumConcurrencyIntervalMs)
    ) {
      return undefined;
    }
  }
  for (const key of ["queueMs", "durationMs"] as const) {
    if (value[key] !== undefined && !isNatural(value[key])) return undefined;
  }

  const acceptedLineage =
    typeof value.lineage === "string" && acceptedLineages.has(value.lineage);
  if (
    acceptedLineage &&
    (value.outcome !== "accepted" ||
      typeof value.contributionDigest !== "string" ||
      !digestPattern.test(value.contributionDigest))
  ) {
    return undefined;
  }
  if (!acceptedLineage && value.contributionDigest !== undefined) return undefined;
  return Object.freeze(value as unknown as MetricEvent);
}

const dimensionCoverage = (
  applicableEvents: number,
  observedEvents: number,
): DimensionCoverage =>
  Object.freeze({
    applicableEvents,
    observedEvents,
    unknownEvents: applicableEvents - observedEvents,
  });

const complete = (coverage: DimensionCoverage) =>
  coverage.applicableEvents > 0 && coverage.unknownEvents === 0;

const identityApplies = (event: MetricEvent, field: IdentityField) =>
  identityKinds[field].has(event.kind);
const isUsageEvent = (event: MetricEvent) =>
  event.kind === "completion" || event.kind === "failure";
const isOutcomeEvent = (event: MetricEvent) => event.kind === "completion";
const isFailureEvent = (event: MetricEvent) =>
  event.kind === "failure" ||
  (event.kind === "completion" && event.outcome === "failed");

interface Calculated {
  readonly identity: Readonly<Record<IdentityField, DimensionCoverage>>;
  readonly usage: DimensionCoverage;
  readonly components: Readonly<Record<UsageComponent, DimensionCoverage>>;
  readonly useful: DimensionCoverage;
  readonly outcome: DimensionCoverage;
  readonly cost: DimensionCoverage;
  readonly duration: DimensionCoverage;
  readonly queue: DimensionCoverage;
  readonly cache: DimensionCoverage;
  readonly failureReason: DimensionCoverage;
  readonly concurrency: DimensionCoverage;
  readonly totals: Readonly<Record<string, unknown>>;
}

function calculate(events: readonly MetricEvent[]): Calculated {
  const identityApplicable: Record<IdentityField, number> = {
    requestedRoute: 0,
    requestedProvider: 0,
    requestedModel: 0,
    actualProvider: 0,
    actualModel: 0,
    run: 0,
  };
  const identityObserved: Record<IdentityField, number> = {
    requestedRoute: 0,
    requestedProvider: 0,
    requestedModel: 0,
    actualProvider: 0,
    actualModel: 0,
    run: 0,
  };
  const componentObserved: Record<UsageComponent, number> = {
    cachedTokens: 0,
    reasoningTokens: 0,
    toolCalls: 0,
    retries: 0,
  };
  const componentTotals: Record<UsageComponent, number> = {
    cachedTokens: 0,
    reasoningTokens: 0,
    toolCalls: 0,
    retries: 0,
  };
  let usageApplicable = 0;
  let usageObserved = 0;
  let usefulApplicable = 0;
  let usefulObserved = 0;
  let outcomeApplicable = 0;
  let outcomeObserved = 0;
  let costApplicable = 0;
  let costObserved = 0;
  let durationApplicable = 0;
  let durationObserved = 0;
  let queueObserved = 0;
  let cacheApplicable = 0;
  let cacheObserved = 0;
  let failureApplicable = 0;
  let failureReasonObserved = 0;
  let concurrencyApplicable = 0;
  let concurrencyObserved = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let usefulAttributedTokens = 0;
  let acceptedObserved = 0;
  let rejectedObserved = 0;
  let failedObserved = 0;
  let cacheReuses = 0;
  let cacheMisses = 0;
  let durationMs = 0;
  let queueMs = 0;
  let activeInvocationMs = 0;
  let elapsedMs = 0;
  let availableSlotMs = 0;
  let maximumTargetConcurrency = 0;
  let maximumObservedConcurrency = 0;
  const costsByCurrency = new Map<string, { amount: number; events: number }>();
  const costClassCounts = new Map<string, number>();

  for (const event of events) {
    for (const field of Object.keys(identityApplicable) as IdentityField[]) {
      if (!identityApplies(event, field)) continue;
      identityApplicable[field]++;
      if (event[field] !== undefined) identityObserved[field]++;
    }

    if (isUsageEvent(event)) {
      usageApplicable++;
      if (event.usage !== undefined) {
        usageObserved++;
        inputTokens += event.usage.inputTokens;
        outputTokens += event.usage.outputTokens;
        for (const field of Object.keys(componentObserved) as UsageComponent[]) {
          const component = event.usage[field];
          if (component === undefined) continue;
          componentObserved[field]++;
          componentTotals[field] += component;
        }
      }
    }

    if (event.kind === "completion") {
      usefulApplicable++;
      const attributed =
        typeof event.lineage === "string" && acceptedLineages.has(event.lineage);
      if (event.lineage === "not-applicable") {
        usefulObserved++;
      } else if (attributed && event.usage !== undefined) {
        usefulObserved++;
        usefulAttributedTokens += event.usage.inputTokens + event.usage.outputTokens;
      }
    }

    if (isOutcomeEvent(event)) {
      outcomeApplicable++;
      if (event.outcome !== undefined) outcomeObserved++;
    }
    if (event.outcome === "accepted") acceptedObserved++;
    if (event.outcome === "rejected") rejectedObserved++;
    if (isFailureEvent(event)) failedObserved++;

    if (isUsageEvent(event)) {
      costApplicable++;
      if (event.cost !== undefined) {
        costClassCounts.set(
          event.cost.costClass,
          (costClassCounts.get(event.cost.costClass) ?? 0) + 1,
        );
      }
      if (
        event.cost?.evidence === "observed" &&
        event.cost.observedCost !== null &&
        event.cost.currency !== undefined
      ) {
        costObserved++;
        const current = costsByCurrency.get(event.cost.currency) ?? { amount: 0, events: 0 };
        current.amount += event.cost.observedCost;
        current.events++;
        costsByCurrency.set(event.cost.currency, current);
      }

      durationApplicable++;
      if (event.durationMs !== undefined) {
        durationObserved++;
        durationMs += event.durationMs;
      }
      if (event.queueMs !== undefined) {
        queueObserved++;
        queueMs += event.queueMs;
      }
    }

    if (event.kind === "cache") {
      cacheApplicable++;
      if (event.cacheReuse !== undefined) {
        cacheObserved++;
        if (event.cacheReuse) cacheReuses++;
        else cacheMisses++;
      }
    }

    if (isFailureEvent(event)) {
      failureApplicable++;
      if (event.reasonCode !== undefined) failureReasonObserved++;
    }

    if (event.kind === "concurrency") {
      concurrencyApplicable++;
      if (
        event.targetConcurrency !== undefined &&
        event.observedConcurrency !== undefined &&
        event.activeInvocationMs !== undefined &&
        event.elapsedMs !== undefined
      ) {
        concurrencyObserved++;
        activeInvocationMs += event.activeInvocationMs;
        elapsedMs += event.elapsedMs;
        availableSlotMs += event.elapsedMs * event.targetConcurrency;
        maximumTargetConcurrency = Math.max(maximumTargetConcurrency, event.targetConcurrency);
        maximumObservedConcurrency = Math.max(
          maximumObservedConcurrency,
          event.observedConcurrency,
        );
      }
    }
  }

  const identity = Object.freeze(
    Object.fromEntries(
      (Object.keys(identityApplicable) as IdentityField[]).map((field) => [
        field,
        dimensionCoverage(identityApplicable[field], identityObserved[field]),
      ]),
    ) as unknown as Record<IdentityField, DimensionCoverage>,
  );
  const usageCoverage = dimensionCoverage(usageApplicable, usageObserved);
  const components = Object.freeze(
    Object.fromEntries(
      (Object.keys(componentObserved) as UsageComponent[]).map((field) => [
        field,
        dimensionCoverage(usageApplicable, componentObserved[field]),
      ]),
    ) as unknown as Record<UsageComponent, DimensionCoverage>,
  );
  const usefulCoverage = dimensionCoverage(usefulApplicable, usefulObserved);
  const outcomeCoverage = dimensionCoverage(outcomeApplicable, outcomeObserved);
  const costCoverage = dimensionCoverage(costApplicable, costObserved);
  const durationCoverage = dimensionCoverage(durationApplicable, durationObserved);
  const queueCoverage = dimensionCoverage(durationApplicable, queueObserved);
  const cacheCoverage = dimensionCoverage(cacheApplicable, cacheObserved);
  const failureCoverage = dimensionCoverage(failureApplicable, failureReasonObserved);
  const concurrencyCoverage = dimensionCoverage(
    concurrencyApplicable,
    concurrencyObserved,
  );
  const currencyRows = Object.freeze(
    [...costsByCurrency.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, value]) =>
        Object.freeze({ currency, amount: value.amount, events: value.events }),
      ),
  );
  const singleCompleteCurrency =
    complete(costCoverage) && currencyRows.length === 1 ? currencyRows[0] : undefined;
  const failureEvents = failureApplicable === 0 ? null : failedObserved;

  return Object.freeze({
    identity,
    usage: usageCoverage,
    components,
    useful: usefulCoverage,
    outcome: outcomeCoverage,
    cost: costCoverage,
    duration: durationCoverage,
    queue: queueCoverage,
    cache: cacheCoverage,
    failureReason: failureCoverage,
    concurrency: concurrencyCoverage,
    totals: Object.freeze({
      events: events.length,
      inputTokens: complete(usageCoverage) ? inputTokens : null,
      outputTokens: complete(usageCoverage) ? outputTokens : null,
      totalTokens: complete(usageCoverage) ? inputTokens + outputTokens : null,
      cachedTokens: complete(components.cachedTokens) ? componentTotals.cachedTokens : null,
      reasoningTokens: complete(components.reasoningTokens)
        ? componentTotals.reasoningTokens
        : null,
      toolCalls: complete(components.toolCalls) ? componentTotals.toolCalls : null,
      retries: complete(components.retries) ? componentTotals.retries : null,
      usefulTokens: complete(usefulCoverage) ? usefulAttributedTokens : null,
      usefulAttributedTokens:
        usefulCoverage.applicableEvents === 0 ? null : usefulAttributedTokens,
      accepted: complete(outcomeCoverage) ? acceptedObserved : null,
      rejected: complete(outcomeCoverage) ? rejectedObserved : null,
      failed: complete(outcomeCoverage)
        ? failedObserved
        : outcomeCoverage.applicableEvents === 0 && failureEvents !== null
          ? failedObserved
          : null,
      failureEvents,
      failureReasonUnknown:
        failureCoverage.applicableEvents === 0 ? null : failureCoverage.unknownEvents,
      cacheReuses: cacheApplicable === 0 ? null : cacheReuses,
      cacheMisses: cacheApplicable === 0 ? null : cacheMisses,
      cacheUnknown: cacheApplicable === 0 ? null : cacheCoverage.unknownEvents,
      cacheObserved: cacheApplicable === 0 ? null : cacheObserved,
      cacheReuseRatio:
        cacheApplicable === 0 || cacheObserved === 0 ? null : cacheReuses / cacheObserved,
      observedCost: singleCompleteCurrency?.amount ?? null,
      observedCostCurrency: singleCompleteCurrency?.currency ?? null,
      observedCostCount: costApplicable === 0 ? null : costObserved,
      observedCostByCurrency: currencyRows,
      costClassCounts: Object.freeze(
        [...costClassCounts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([costClass, count]) => Object.freeze({ costClass, events: count })),
      ),
      durationMs: complete(durationCoverage) ? durationMs : null,
      queueMs: complete(queueCoverage) ? queueMs : null,
      activeInvocationMs: complete(concurrencyCoverage) ? activeInvocationMs : null,
      elapsedMs: complete(concurrencyCoverage) ? elapsedMs : null,
      targetConcurrency: complete(concurrencyCoverage) ? maximumTargetConcurrency : null,
      observedConcurrency: complete(concurrencyCoverage)
        ? maximumObservedConcurrency
        : null,
      availableSlotMs: complete(concurrencyCoverage) ? availableSlotMs : null,
      utilisation:
        complete(concurrencyCoverage) && availableSlotMs > 0
          ? activeInvocationMs / availableSlotMs
          : null,
    }),
  });
}

function groupRows(
  events: readonly MetricEvent[],
  group: GroupName,
  maximumItems: number,
): { readonly rows: readonly Readonly<Record<string, unknown>>[]; readonly truncated: boolean } {
  const groups = new Map<string, MetricEvent[]>();
  for (const event of events) {
    let value: string | undefined;
    if (group === "failureReason") {
      if (!isFailureEvent(event)) continue;
      value = event.reasonCode ?? "unknown";
    } else {
      if (!identityApplies(event, group)) continue;
      value = event[group];
      if (value === undefined) continue;
    }
    const members = groups.get(value) ?? [];
    members.push(event);
    groups.set(value, members);
  }

  const entries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const shown = entries.slice(0, maximumItems);
  const omitted = entries.slice(maximumItems);
  const row = (
    value: string,
    members: readonly MetricEvent[],
    overflowedGroups: number,
  ) => {
    const result = calculate(members);
    return Object.freeze({
      group,
      value,
      events: members.length,
      overflowedGroups,
      usage: result.usage,
      useful: result.useful,
      outcome: result.outcome,
      inputTokens: result.totals.inputTokens,
      outputTokens: result.totals.outputTokens,
      totalTokens: result.totals.totalTokens,
      cachedTokens: result.totals.cachedTokens,
      reasoningTokens: result.totals.reasoningTokens,
      toolCalls: result.totals.toolCalls,
      retries: result.totals.retries,
      usefulTokens: result.totals.usefulTokens,
      usefulAttributedTokens: result.totals.usefulAttributedTokens,
      acceptedEvents: members.filter((event) => event.outcome === "accepted").length,
      rejectedEvents: members.filter((event) => event.outcome === "rejected").length,
      failureEvents: members.filter(isFailureEvent).length,
    });
  };
  const rows = shown.map(([value, members]) => row(value, members, 0));
  if (omitted.length > 0) {
    rows.push(
      row(
        "other",
        omitted.flatMap(([, members]) => members),
        omitted.length,
      ),
    );
  }
  return Object.freeze({ rows: Object.freeze(rows), truncated: omitted.length > 0 });
}

function matches(event: MetricEvent, filters: MetricFilters): boolean {
  const at = metricInstant(event.at)!;
  const since = filters.since === undefined ? undefined : metricInstant(filters.since);
  const until = filters.until === undefined ? undefined : metricInstant(filters.until);
  return (
    (since === undefined || at >= since) &&
    (until === undefined || at <= until) &&
    (filters.run === undefined || event.run === filters.run) &&
    (filters.provider === undefined || event.actualProvider === filters.provider) &&
    (filters.model === undefined || event.actualModel === filters.model)
  );
}

function selectedCoverage(
  view: MetricView,
  calculated: Calculated,
  events: readonly MetricEvent[],
): readonly DimensionCoverage[] {
  switch (view) {
    case "providers":
      return [
        calculated.identity.requestedRoute,
        calculated.identity.requestedProvider,
        calculated.identity.actualProvider,
      ];
    case "models":
      return [calculated.identity.requestedModel, calculated.identity.actualModel];
    case "tokens":
      return [calculated.usage, ...Object.values(calculated.components), calculated.useful];
    case "runs":
      return [calculated.identity.run];
    case "cache":
      return [calculated.cache];
    case "failures":
      return [calculated.failureReason];
    case "concurrency":
      return [calculated.concurrency];
    case "summary":
      return events.length === 0
        ? []
        : [
            ...Object.values(calculated.identity),
            calculated.usage,
            calculated.useful,
            calculated.outcome,
            calculated.cost,
            calculated.duration,
            calculated.queue,
            calculated.cache,
            calculated.failureReason,
            calculated.concurrency,
          ];
  }
}

function validateAggregateOptions(options: AggregateOptions, inputLength: number): number {
  const maximumItems = options.maxItems ?? 20;
  if (
    !Number.isSafeInteger(maximumItems) ||
    maximumItems < 1 ||
    maximumItems > maximumAggregateItems
  ) {
    throw new RangeError("maxItems must be an integer from 1 through 100.");
  }
  if (inputLength > maximumAggregateEvents) {
    throw new RangeError("Metric aggregation is limited to 100000 input records.");
  }
  for (const value of [options.run, options.provider, options.model]) {
    if (value !== undefined && !isNamed(value)) {
      throw new RangeError("Metric filters must be bounded identifiers.");
    }
  }
  const since = options.since === undefined ? undefined : metricInstant(options.since);
  const until = options.until === undefined ? undefined : metricInstant(options.until);
  if (
    (options.since !== undefined && since === undefined) ||
    (options.until !== undefined && until === undefined) ||
    (since !== undefined && until !== undefined && since > until)
  ) {
    throw new RangeError("Metric time filters must be ordered canonical UTC instants.");
  }
  return maximumItems;
}

export function aggregateMetrics(
  input: readonly unknown[],
  options: AggregateOptions = {},
): MetricsReport {
  const maximumItems = validateAggregateOptions(options, input.length);
  const view = options.view ?? "summary";
  const parsed = input.map(validateMetricEvent);
  const invalidEvents = parsed.filter((event) => event === undefined).length;
  const validEvents = parsed.filter(
    (event): event is MetricEvent => event !== undefined,
  );
  const events = validEvents.filter((event) => matches(event, options));
  const calculated = calculate(events);
  const unique = (field: IdentityField) => {
    const coverage = calculated.identity[field];
    if (coverage.applicableEvents === 0 || coverage.observedEvents === 0) return null;
    return new Set(
      events
        .filter((event) => identityApplies(event, field))
        .map((event) => event[field])
        .filter((value): value is string => value !== undefined),
    ).size;
  };

  const requestedRoutes = groupRows(events, "requestedRoute", maximumItems);
  const requestedProviders = groupRows(events, "requestedProvider", maximumItems);
  const actualProviders = groupRows(events, "actualProvider", maximumItems);
  const requestedModels = groupRows(events, "requestedModel", maximumItems);
  const actualModels = groupRows(events, "actualModel", maximumItems);
  const runs = groupRows(events, "run", maximumItems);
  const failures = groupRows(events, "failureReason", maximumItems);
  const selectedRows =
    view === "providers"
      ? [...requestedRoutes.rows, ...requestedProviders.rows, ...actualProviders.rows]
      : view === "models"
        ? [...requestedModels.rows, ...actualModels.rows]
        : view === "runs"
          ? runs.rows
          : view === "failures"
            ? failures.rows
            : [];
  const labelsTruncated =
    (view === "providers" &&
      (requestedRoutes.truncated ||
        requestedProviders.truncated ||
        actualProviders.truncated)) ||
    (view === "models" && (requestedModels.truncated || actualModels.truncated)) ||
    (view === "runs" && runs.truncated) ||
    (view === "failures" && failures.truncated);
  const relevantCoverage = selectedCoverage(view, calculated, events);
  const applicableEvents = relevantCoverage.reduce(
    (sum, coverage) => sum + coverage.applicableEvents,
    0,
  );
  const selectedUnknown = relevantCoverage.some(
    (coverage) => coverage.applicableEvents > 0 && coverage.unknownEvents > 0,
  );
  const notObserved = events.length === 0 || applicableEvents === 0;
  const incomplete =
    invalidEvents > 0 ||
    options.sourceTruncated === true ||
    labelsTruncated ||
    selectedUnknown;

  return Object.freeze({
    schema: metricsReportSchema,
    status: notObserved ? "not-observed" : incomplete ? "incomplete" : "ok",
    view,
    coverage: Object.freeze({
      observedEvents: input.length,
      matchedEvents: events.length,
      invalidEvents,
      filteredOutEvents: validEvents.length - events.length,
      sourceTruncated: options.sourceTruncated === true,
      labelsTruncated,
      usageUnknownEvents: calculated.usage.unknownEvents,
      usefulClassificationUnknownEvents: calculated.useful.unknownEvents,
      costUnknownEvents: calculated.cost.unknownEvents,
      durationUnknownEvents: calculated.duration.unknownEvents,
      queueUnknownEvents: calculated.queue.unknownEvents,
      concurrencyUnknownEvents: calculated.concurrency.unknownEvents,
      identity: calculated.identity,
      usage: calculated.usage,
      usageComponents: calculated.components,
      useful: calculated.useful,
      outcome: calculated.outcome,
      cost: calculated.cost,
      duration: calculated.duration,
      queue: calculated.queue,
      cache: calculated.cache,
      failureReason: calculated.failureReason,
      concurrency: calculated.concurrency,
      filters: Object.freeze({
        since: options.since ?? null,
        until: options.until ?? null,
        run: options.run ?? null,
        provider: options.provider ?? null,
        model: options.model ?? null,
      }),
    }),
    denominators: Object.freeze({
      requestedRoutes: unique("requestedRoute"),
      requestedProviders: unique("requestedProvider"),
      requestedModels: unique("requestedModel"),
      actualProviders: unique("actualProvider"),
      actualModels: unique("actualModel"),
      runs: unique("run"),
    }),
    totals: calculated.totals,
    items: Object.freeze(selectedRows),
    nonclaims: Object.freeze([
      "Local operational observation only; not semantic authority, accepted evidence, proof, integration, publication, provider census, quota, pricing or live state.",
      "No provider, network, GitHub, repository mutation, commit or push occurred.",
    ]),
  });
}
