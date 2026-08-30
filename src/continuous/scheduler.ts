/**
 * Deterministic, in-memory continuous composition scheduler.  This is an
 * operational helper: its checkpoint is explicit data, and its local claims
 * grant no semantic or integration authority.
 */
export type PacketState = "accepted" | "rejected" | "failed" | "cached";

export interface WorkPacket {
  id: string;
  /** Packets that must have an accepted or cached result first. */
  dependsOn?: readonly string[];
  /** Eligible routes, in deterministic preference order. */
  routes: readonly string[];
  cacheKey?: string;
  value?: number;
}

export interface Route {
  id: string;
  provider: string;
  /** Shared provider cap; omit only when route caps are the provider cap. */
  providerConcurrency?: number;
  concurrency: number;
}

export interface CallResult {
  outcome: "accepted" | "rejected" | "failed";
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  cacheable?: boolean;
}

export interface Assignment {
  packet: WorkPacket;
  route: Route;
  claim: string;
}

export interface SchedulerCheckpoint {
  completed: readonly string[];
  cacheKeys?: readonly string[];
  /** Transient claims from an interrupted process; rescan discards them. */
  claims?: readonly string[];
}

export interface SchedulerOptions {
  packets: readonly WorkPacket[];
  routes: readonly Route[];
  hostConcurrency: number;
  checkpoint?: SchedulerCheckpoint;
  /** Deterministic adapter injection; it performs no provider I/O itself. */
  invoke: (assignment: Assignment) => CallResult;
}

export interface ContinuousMetrics {
  targetConcurrency: number;
  observedConcurrency: number;
  activeInvocationMs: number;
  elapsedMs: number;
  utilisation: number;
  totalTokens: number;
  usefulTokens: number;
  yield: number;
  cacheReuses: number;
  accepted: number;
  rejected: number;
  failed: number;
  batches: number;
  providerStarts: Readonly<Record<string, number>>;
}

export interface ContinuousResult {
  states: Readonly<Record<string, PacketState>>;
  checkpoint: SchedulerCheckpoint;
  metrics: ContinuousMetrics;
  integrations: readonly (readonly string[])[];
}

interface Active extends Assignment {
  result: CallResult;
  endsAt: number;
}

const sorted = <T extends { id: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Runs a virtual-time schedule.  A restart is just a new call supplied with a
 * checkpoint: completed work and cache keys are rescanned; interrupted local
 * claims are intentionally not carried forward.
 */
export function runContinuous(options: SchedulerOptions): ContinuousResult {
  if (!Number.isInteger(options.hostConcurrency) || options.hostConcurrency < 1) {
    throw new Error("HOST_CONCURRENCY_INVALID");
  }
  const packets = sorted(options.packets);
  const routeById = new Map(sorted(options.routes).map((route) => [route.id, route]));
  const providerCaps = new Map<string, number>();
  for (const route of options.routes) {
    if (!Number.isInteger(route.concurrency) || route.concurrency < 1) throw new Error("ROUTE_CONCURRENCY_INVALID");
    if (route.providerConcurrency !== undefined && (!Number.isInteger(route.providerConcurrency) || route.providerConcurrency < 1)) throw new Error("PROVIDER_CONCURRENCY_INVALID");
    const previous = providerCaps.get(route.provider);
    if (previous !== undefined && route.providerConcurrency !== undefined && previous !== route.providerConcurrency) throw new Error("PROVIDER_CONCURRENCY_INCONSISTENT");
    if (route.providerConcurrency !== undefined) providerCaps.set(route.provider, route.providerConcurrency);
  }
  for (const route of options.routes) {
    if (!providerCaps.has(route.provider)) providerCaps.set(route.provider, options.routes.filter((candidate) => candidate.provider === route.provider).reduce((sum, candidate) => sum + candidate.concurrency, 0));
  }
  const packetById = new Map(packets.map((packet) => [packet.id, packet]));
  if (packetById.size !== packets.length) throw new Error("PACKET_ID_DUPLICATE");
  for (const packet of packets) {
    for (const dependency of packet.dependsOn ?? []) {
      if (!packetById.has(dependency)) throw new Error("PACKET_DEPENDENCY_UNKNOWN");
    }
    for (const routeId of packet.routes) if (!routeById.has(routeId)) throw new Error("ROUTE_UNKNOWN");
  }

  const completed = new Set(options.checkpoint?.completed ?? []);
  const cache = new Set(options.checkpoint?.cacheKeys ?? []);
  const states: Record<string, PacketState> = {};
  for (const id of completed) states[id] = "accepted";
  const pending = new Set(packets.map((packet) => packet.id).filter((id) => !completed.has(id)));
  const active: Active[] = [];
  const routeActive = new Map<string, number>();
  const providerActive = new Map<string, number>();
  const providerStarts: Record<string, number> = {};
  const integrations: string[][] = [];
  let providerCursor = 0;
  let now = 0;
  let observed = 0;
  let activeMs = 0;
  let totalTokens = 0;
  let usefulTokens = 0;
  let accepted = 0;
  let rejected = 0;
  let failed = 0;
  let cacheReuses = 0;
  let batches = 0;

  const isReady = (packet: WorkPacket) =>
    (packet.dependsOn ?? []).every((dependency) => states[dependency] === "accepted" || states[dependency] === "cached");
  const eligible = (packet: WorkPacket) => packet.routes
    .map((id) => routeById.get(id)!)
    .filter((route) => (routeActive.get(route.id) ?? 0) < route.concurrency && (providerActive.get(route.provider) ?? 0) < providerCaps.get(route.provider)!);
  const target = Math.min(
    packets.length,
    options.hostConcurrency,
    [...providerCaps.values()].reduce((sum, cap) => sum + cap, 0),
  );

  while (pending.size > 0 || active.length > 0) {
    let launched = 0;
    while (active.length < options.hostConcurrency) {
      const ready = packets.filter((packet) => pending.has(packet.id) && isReady(packet));
      if (ready.length === 0) break;
      const cached = ready.find((packet) => packet.cacheKey && cache.has(packet.cacheKey));
      if (cached) {
        pending.delete(cached.id);
        states[cached.id] = "cached";
        completed.add(cached.id);
        accepted += 1;
        cacheReuses += 1;
        launched += 1;
        continue;
      }
      // Rotate providers before choosing packets, so no quick provider consumes
      // all otherwise equivalent ready work.
      const providers = [...new Set(sorted(options.routes).map((route) => route.provider))];
      const orderedProviders = providers.map((_, index) => providers[(providerCursor + index) % providers.length]);
      let choice: { packet: WorkPacket; route: Route } | undefined;
      for (const provider of orderedProviders) {
        const packet = ready.find((candidate) => eligible(candidate).some((route) => route.provider === provider));
        if (!packet) continue;
        choice = { packet, route: eligible(packet).find((route) => route.provider === provider)! };
        providerCursor = (providers.indexOf(provider) + 1) % providers.length;
        break;
      }
      if (!choice) break;
      const claim = `${choice.packet.id}:${choice.route.id}`;
      const assignment = { ...choice, claim };
      const result = options.invoke(assignment);
      if (result.durationMs < 0 || result.inputTokens < 0 || result.outputTokens < 0) throw new Error("CALL_RESULT_INVALID");
      pending.delete(choice.packet.id);
      active.push({ ...assignment, result, endsAt: now + result.durationMs });
      routeActive.set(choice.route.id, (routeActive.get(choice.route.id) ?? 0) + 1);
      providerActive.set(choice.route.provider, (providerActive.get(choice.route.provider) ?? 0) + 1);
      providerStarts[choice.route.provider] = (providerStarts[choice.route.provider] ?? 0) + 1;
      observed = Math.max(observed, active.length);
      launched += 1;
    }
    if (launched > 0) batches += 1;
    if (active.length === 0) {
      // Dependencies blocked by rejected/failed work are terminally unrun, not
      // silently successful. They retain an explicit failed state.
      for (const id of pending) { states[id] = "failed"; failed += 1; }
      pending.clear();
      break;
    }
    const next = Math.min(...active.map((call) => call.endsAt));
    const done = active.filter((call) => call.endsAt === next);
    now = next;
    const acceptedBatch: string[] = [];
    for (const call of done) {
      active.splice(active.indexOf(call), 1);
      routeActive.set(call.route.id, (routeActive.get(call.route.id) ?? 1) - 1);
      providerActive.set(call.route.provider, (providerActive.get(call.route.provider) ?? 1) - 1);
      const tokens = call.result.inputTokens + call.result.outputTokens;
      totalTokens += tokens;
      activeMs += call.result.durationMs;
      if (call.result.outcome === "accepted") {
        states[call.packet.id] = "accepted";
        completed.add(call.packet.id);
        accepted += 1;
        usefulTokens += tokens;
        acceptedBatch.push(call.packet.id);
        if (call.packet.cacheKey && call.result.cacheable !== false) cache.add(call.packet.cacheKey);
      } else if (call.result.outcome === "rejected") {
        states[call.packet.id] = "rejected";
        rejected += 1;
      } else {
        states[call.packet.id] = "failed";
        failed += 1;
      }
    }
    if (acceptedBatch.length > 0) integrations.push(acceptedBatch.sort());
  }
  return {
    states,
    checkpoint: { completed: [...completed].sort(), cacheKeys: [...cache].sort(), claims: [] },
    metrics: {
      targetConcurrency: target, observedConcurrency: observed, activeInvocationMs: activeMs, elapsedMs: now,
      utilisation: now === 0 || target === 0 ? 0 : activeMs / (now * target), totalTokens, usefulTokens,
      yield: totalTokens === 0 ? 0 : packets.reduce((sum, packet) => sum + (states[packet.id] === "accepted" || states[packet.id] === "cached" ? packet.value ?? 1 : 0), 0) / totalTokens,
      cacheReuses, accepted, rejected, failed, batches, providerStarts,
    },
    integrations,
  };
}
