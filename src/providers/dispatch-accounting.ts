export type DispatchAttemptPhase = "preflight" | "invocation";

export interface DispatchAttemptObservation {
  readonly phase: DispatchAttemptPhase;
  readonly contacted: boolean;
  readonly outcome: "ok" | "refused";
}

export interface GraphDispatchUnitObservation {
  readonly unit: string;
  readonly eligible: boolean;
  readonly attempts: readonly DispatchAttemptObservation[];
  readonly status: "ok" | "refused";
  readonly reasonCode: string;
  readonly resultText: string | null;
}

export interface GraphDispatchAccounting {
  readonly plannedUnits: number;
  readonly eligibleUnits: number;
  readonly attemptedUnits: number;
  readonly contactedUnits: number;
  readonly contactedAttempts: number;
  readonly successfulUnits: number;
  readonly refusedUnits: number;
}

export type HermesTerminalDisposition = "accepted" | "output-refused" | "refused" | "reused";

export interface HermesTerminalObservation {
  readonly unit: string;
  readonly outcome: HermesTerminalDisposition;
}

export interface HermesDispatchAccounting extends GraphDispatchAccounting {
  readonly structurallyAcceptedUnits: number;
  readonly reusedUnits: number;
  /** Compatibility aliases retained for existing readers. */
  readonly dispatchedUnits: number;
  readonly modelInvocations: number;
  readonly cacheHits: number;
  readonly acceptedResults: number;
}

export type ParentLineageDisposition = "initial" | "recorded" | "prior-work-only" | "legacy-no-parent";

export interface DispatchLineage {
  readonly workIdentityDigest: string;
  readonly executionEvidenceDigest: string | null;
  readonly cacheEvidenceDigests: readonly string[];
  readonly repairRound: number;
  readonly repairBasisDigest: string | null;
  readonly parentWorkIdentityDigest: string | null;
  readonly parentExecutionEvidenceDigest: string | null;
  readonly parentLineageDisposition: ParentLineageDisposition;
}

export class DispatchAccountingRefusal extends Error {
  readonly reasonCode = "DISPATCH_ACCOUNTING_INVALID";

  constructor(message: string) {
    super(`DISPATCH_ACCOUNTING_INVALID:${message}`);
    this.name = "DispatchAccountingRefusal";
  }
}

function refuse(message: string): never {
  throw new DispatchAccountingRefusal(message);
}

function assertDistinct(label: string, values: readonly string[]): void {
  if (values.some((value) => typeof value !== "string" || value.length === 0)) refuse(`${label}-identity`);
  if (new Set(values).size !== values.length) refuse(`${label}-duplicate`);
}

function isDigest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/u.test(value);
}

export function deriveGraphDispatchAccounting(
  units: readonly GraphDispatchUnitObservation[],
): GraphDispatchAccounting {
  assertDistinct("graph-unit", units.map((unit) => unit.unit));
  let eligibleUnits = 0;
  let attemptedUnits = 0;
  let contactedUnits = 0;
  let contactedAttempts = 0;
  let successfulUnits = 0;

  for (const unit of units) {
    if (typeof unit.eligible !== "boolean" || !Array.isArray(unit.attempts)) refuse(`graph-unit-shape:${unit.unit}`);
    if (unit.status !== "ok" && unit.status !== "refused") refuse(`graph-unit-status:${unit.unit}`);
    if (typeof unit.reasonCode !== "string" || unit.reasonCode.length === 0) refuse(`graph-unit-reason:${unit.unit}`);
    if (unit.resultText !== null && typeof unit.resultText !== "string") refuse(`graph-unit-result:${unit.unit}`);
    const contacted = unit.attempts.filter((attempt) => attempt.contacted);
    for (const attempt of unit.attempts) {
      if ((attempt.phase === "invocation") !== attempt.contacted) refuse(`attempt-phase-contact:${unit.unit}`);
      if (attempt.outcome === "ok" && !attempt.contacted) refuse(`preflight-success:${unit.unit}`);
      if (attempt.phase !== "preflight" && attempt.phase !== "invocation") refuse(`attempt-phase:${unit.unit}`);
      if (attempt.outcome !== "ok" && attempt.outcome !== "refused") refuse(`attempt-outcome:${unit.unit}`);
    }
    const successfulAttempts = unit.attempts.filter((attempt) => attempt.outcome === "ok");
    const successful = unit.status === "ok";
    if (successful !== (successfulAttempts.length === 1 && unit.resultText !== null && unit.resultText.trim().length > 0)) {
      refuse(`unit-success:${unit.unit}`);
    }
    if (successful && (!unit.eligible || contacted.length === 0)) refuse(`success-without-contact:${unit.unit}`);
    if (!successful && successfulAttempts.length > 0) refuse(`refused-with-success:${unit.unit}`);
    if (unit.reasonCode === "NO_ELIGIBLE_ROUTE"
      && (unit.eligible || unit.attempts.length !== 0 || successful || unit.resultText !== null)) {
      refuse(`no-route-contradiction:${unit.unit}`);
    }
    if (!unit.eligible && contacted.length > 0) refuse(`contact-without-eligibility:${unit.unit}`);

    eligibleUnits += unit.eligible ? 1 : 0;
    attemptedUnits += unit.attempts.length > 0 ? 1 : 0;
    contactedUnits += contacted.length > 0 ? 1 : 0;
    contactedAttempts += contacted.length;
    successfulUnits += successful ? 1 : 0;
  }

  return Object.freeze({
    plannedUnits: units.length,
    eligibleUnits,
    attemptedUnits,
    contactedUnits,
    contactedAttempts,
    successfulUnits,
    refusedUnits: units.length - successfulUnits,
  });
}

export function deriveHermesDispatchAccounting(input: Readonly<{
  plannedUnits: readonly string[];
  graphUnits: readonly GraphDispatchUnitObservation[];
  terminalOutcomes: readonly HermesTerminalObservation[];
}>): HermesDispatchAccounting {
  assertDistinct("planned-unit", input.plannedUnits);
  assertDistinct("terminal-unit", input.terminalOutcomes.map((outcome) => outcome.unit));
  const planned = new Set(input.plannedUnits);
  if (input.terminalOutcomes.length !== input.plannedUnits.length
    || input.terminalOutcomes.some((outcome) => !planned.has(outcome.unit))) {
    refuse("terminal-partition");
  }
  const graphByUnit = new Map(input.graphUnits.map((unit) => [unit.unit, unit] as const));
  if (graphByUnit.size !== input.graphUnits.length
    || input.graphUnits.some((unit) => !planned.has(unit.unit))) refuse("graph-unit-partition");

  let structurallyAcceptedUnits = 0;
  let reusedUnits = 0;
  for (const terminal of input.terminalOutcomes) {
    if (!["accepted", "output-refused", "refused", "reused"].includes(terminal.outcome)) {
      refuse(`terminal-outcome:${terminal.unit}`);
    }
    const graph = graphByUnit.get(terminal.unit);
    if (terminal.outcome === "reused") {
      if (graph !== undefined) refuse(`reuse-with-dispatch:${terminal.unit}`);
      reusedUnits += 1;
      continue;
    }
    if (terminal.outcome === "accepted" || terminal.outcome === "output-refused") {
      if (graph?.status !== "ok") refuse(`admission-without-success:${terminal.unit}`);
    } else if (graph?.status === "ok") {
      refuse(`successful-result-without-admission:${terminal.unit}`);
    }
    structurallyAcceptedUnits += terminal.outcome === "accepted" ? 1 : 0;
  }

  const graph = deriveGraphDispatchAccounting(input.graphUnits);
  const refusedUnits = input.plannedUnits.length - structurallyAcceptedUnits - reusedUnits;
  if (refusedUnits < 0) refuse("negative-refused-units");
  return assertHermesDispatchAccounting({
    ...graph,
    plannedUnits: input.plannedUnits.length,
    refusedUnits,
    structurallyAcceptedUnits,
    reusedUnits,
    dispatchedUnits: graph.contactedUnits,
    modelInvocations: graph.contactedAttempts,
    cacheHits: reusedUnits,
    acceptedResults: structurallyAcceptedUnits + reusedUnits,
  });
}

export function assertHermesDispatchAccounting(value: unknown): HermesDispatchAccounting {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse("counter-object");
  const record = value as Record<string, unknown>;
  const names = [
    "plannedUnits", "eligibleUnits", "attemptedUnits", "contactedUnits", "contactedAttempts",
    "successfulUnits", "structurallyAcceptedUnits", "refusedUnits", "reusedUnits",
    "dispatchedUnits", "modelInvocations", "cacheHits", "acceptedResults",
  ] as const;
  for (const name of names) {
    const number = record[name];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) refuse(`counter:${name}`);
  }
  const counts = record as unknown as HermesDispatchAccounting;
  if (counts.eligibleUnits > counts.plannedUnits - counts.reusedUnits
    || counts.attemptedUnits > counts.plannedUnits - counts.reusedUnits
    || counts.contactedUnits > counts.attemptedUnits
    || counts.contactedAttempts < counts.contactedUnits
    || counts.successfulUnits > counts.contactedUnits
    || counts.structurallyAcceptedUnits > counts.successfulUnits
    || counts.refusedUnits + counts.structurallyAcceptedUnits + counts.reusedUnits !== counts.plannedUnits) {
    refuse("counter-conservation");
  }
  if (counts.dispatchedUnits !== counts.contactedUnits
    || counts.modelInvocations !== counts.contactedAttempts
    || counts.cacheHits !== counts.reusedUnits
    || counts.acceptedResults !== counts.structurallyAcceptedUnits + counts.reusedUnits) {
    refuse("counter-alias");
  }
  return Object.freeze(Object.fromEntries(names.map((name) => [name, counts[name]]))) as unknown as HermesDispatchAccounting;
}

export function deriveDispatchLineage(input: Readonly<{
  workIdentityDigest: string;
  executionEvidenceDigest: string | null;
  cacheEvidenceDigests?: readonly string[];
  repairRound: number;
  repairBasisDigest: string | null;
  parentWorkIdentityDigest?: string | null;
  parentExecutionEvidenceDigest?: string | null;
}>): DispatchLineage {
  if (!isDigest(input.workIdentityDigest)) refuse("work-identity-digest");
  if (input.executionEvidenceDigest !== null && !isDigest(input.executionEvidenceDigest)) refuse("execution-evidence-digest");
  if (!Number.isInteger(input.repairRound) || input.repairRound < 0) refuse("repair-round");
  if (input.repairRound === 0 && input.repairBasisDigest !== null) refuse("initial-repair-basis");
  if (input.repairRound > 0 && (input.repairBasisDigest === null || !isDigest(input.repairBasisDigest))) refuse("repair-basis-digest");
  const cacheEvidenceDigests = Object.freeze([...new Set(input.cacheEvidenceDigests ?? [])].sort());
  if (cacheEvidenceDigests.some((digest) => !isDigest(digest))) refuse("cache-evidence-digest");
  const parentWorkIdentityDigest = input.parentWorkIdentityDigest ?? null;
  const parentExecutionEvidenceDigest = input.parentExecutionEvidenceDigest ?? null;
  if (parentWorkIdentityDigest !== null && !isDigest(parentWorkIdentityDigest)) refuse("parent-work-identity-digest");
  if (parentExecutionEvidenceDigest !== null && !isDigest(parentExecutionEvidenceDigest)) refuse("parent-execution-evidence-digest");
  if (parentExecutionEvidenceDigest !== null && parentWorkIdentityDigest === null) refuse("parent-evidence-without-work");
  if (input.repairRound === 0 && (parentWorkIdentityDigest !== null || parentExecutionEvidenceDigest !== null)) {
    refuse("initial-parent-lineage");
  }
  const parentLineageDisposition: ParentLineageDisposition = input.repairRound === 0 ? "initial"
    : parentWorkIdentityDigest === null ? "legacy-no-parent"
    : parentExecutionEvidenceDigest === null ? "prior-work-only"
    : "recorded";
  return Object.freeze({
    workIdentityDigest: input.workIdentityDigest,
    executionEvidenceDigest: input.executionEvidenceDigest,
    cacheEvidenceDigests,
    repairRound: input.repairRound,
    repairBasisDigest: input.repairBasisDigest,
    parentWorkIdentityDigest,
    parentExecutionEvidenceDigest,
    parentLineageDisposition,
  });
}
