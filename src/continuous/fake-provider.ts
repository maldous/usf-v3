import type { Assignment, CallResult } from "./scheduler.ts";

export interface FakeProviderOptions {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  failPackets?: ReadonlySet<string>;
  rejectPackets?: ReadonlySet<string>;
}

/** Deterministic local fake: never makes a network request or contacts a provider. */
export function createFakeProvider(options: FakeProviderOptions = {}) {
  return (assignment: Assignment): CallResult => ({
    outcome: options.failPackets?.has(assignment.packet.id) ? "failed" : options.rejectPackets?.has(assignment.packet.id) ? "rejected" : "accepted",
    durationMs: options.durationMs ?? 10,
    inputTokens: options.inputTokens ?? 20_000,
    outputTokens: options.outputTokens ?? 20_000,
    cacheable: true,
  });
}
