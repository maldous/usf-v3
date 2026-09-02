import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import type { CommandResult } from "./dispatcher.ts";
import { transactCommand } from "./transact.ts";

/**
 * Toggling a provider reservation and promoting a provider for dispatch were
 * being done by hand-editing graph quads through an ad-hoc transaction each
 * time. Both are repeatable operator actions, so they belong in a registered
 * command with the exact quad, the exact refusal classes and a deterministic
 * result -- the operator skill's own rule that executable knowledge lives in the
 * CLI, not in prose or a remembered incantation.
 *
 * This module holds the deterministic core: a pure builder that turns an action
 * and a transport into the one contribution a transaction would carry, so the
 * mutation is testable without touching the graph, and the handler that runs it
 * through the ordinary transact path so nothing here mints authority of its own.
 */
const P = "urn:usf:predicate:";
const EXECUTION_GRAPH = "urn:usf:graph:v3-execution";
const EXECUTION_SOURCE = "graph/v3-execution.nq";

export type ProviderPolicyAction = "promote" | "demote" | "reserve" | "admit";

const actions: ReadonlySet<string> = new Set(["promote", "demote", "reserve", "admit"]);

interface ParsedPolicy {
  readonly action: ProviderPolicyAction;
  readonly transport: string;
}

function parse(args: readonly string[]): ParsedPolicy {
  const action = args[0];
  if (action === undefined || !actions.has(action)) {
    throw new UsfError("PROVIDER_POLICY_ACTION_INVALID", exitCodes.INVALID_INPUT,
      "The first argument must be one of promote, demote, reserve or admit.", { action: action ?? null });
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index]!;
    if (option !== "--transport" || values.has(option)) {
      throw new UsfError("PROVIDER_POLICY_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT,
        "policy accepts an action and exactly one --transport.", { option });
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new UsfError("PROVIDER_POLICY_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Missing value for --transport.");
    }
    values.set(option, value);
  }
  const transport = values.get("--transport");
  if (transport === undefined) {
    throw new UsfError("PROVIDER_POLICY_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "policy requires --transport.");
  }
  return Object.freeze({ action: action as ProviderPolicyAction, transport });
}

function quadsFor(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return graph.quads.filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object);
}

/** Resolve the exact subject/predicate/value the action sets. */
export function resolvePolicyMutation(
  graph: SemanticGraph,
  parsed: ParsedPolicy,
): Readonly<{ subject: string; predicate: string; value: string }> {
  const transportIri = `urn:usf:execution-transport:${parsed.transport}`;
  if (parsed.action === "promote" || parsed.action === "demote") {
    if (quadsFor(graph, transportIri, "type").length === 0
      && graph.quads.every((quad) => quad.subject !== transportIri)) {
      throw new UsfError("PROVIDER_POLICY_TRANSPORT_UNKNOWN", exitCodes.DOMAIN_FAILURE,
        "No such execution transport is declared.", { transport: parsed.transport });
    }
    return Object.freeze({
      subject: transportIri, predicate: "operatorPreferredForDispatch",
      value: parsed.action === "promote" ? "true" : "false",
    });
  }
  // reserve / admit act on the reservation policy for this transport.
  const policy = graph.quads.find((quad) =>
    quad.predicate === `${P}reservedTransport` && quad.object === transportIri)?.subject;
  if (policy === undefined) {
    throw new UsfError("PROVIDER_POLICY_NO_RESERVATION", exitCodes.DOMAIN_FAILURE,
      "No reservation policy reserves that transport, so it cannot be reserved or admitted.",
      { transport: parsed.transport });
  }
  return Object.freeze({
    subject: policy, predicate: "policyActive",
    value: parsed.action === "reserve" ? "true" : "false",
  });
}

/**
 * The exact append-or-replace contribution the mutation needs, as a semantic
 * transaction proposal over the execution source. A single-line predicate is
 * replaced in place, so a toggle never accumulates conflicting values.
 */
export function buildProviderPolicyProposal(
  graph: SemanticGraph,
  currentSource: string,
  parsed: ParsedPolicy,
): Readonly<{ intent: string; content: string }> {
  const target = resolvePolicyMutation(graph, parsed);
  const line = `<${target.subject}> <${P}${target.predicate}> "${target.value}" <${EXECUTION_GRAPH}> .`;
  const kept = currentSource.split("\n").filter((existing) => {
    const prefix = `<${target.subject}> <${P}${target.predicate}> `;
    return existing.trim().length > 0 && !existing.startsWith(prefix);
  });
  const content = [...kept, line].sort().join("\n") + "\n";
  return Object.freeze({
    intent: `Operator ${parsed.action} of ${parsed.transport}: set ${target.predicate} on ${target.subject.split(":").slice(-2).join(":")}.`,
    content,
  });
}

export async function providerPolicyCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parse(args);
  const graph = loadSemanticGraph(repositoryRoot, "graph/manifests/v3-execution.json");
  const { readFile } = await import("node:fs/promises");
  const currentSource = await readFile(resolve(repositoryRoot, EXECUTION_SOURCE), "utf8");
  const built = buildProviderPolicyProposal(graph, currentSource, parsed);

  const { canonicalDigest } = await import("../core/canonical.ts");
  const proposal = {
    schema: "urn:usf:semantic-transaction-proposal:1" as const,
    intent: built.intent,
    declaredAffectedPaths: [EXECUTION_SOURCE],
    operations: [Object.freeze({
      kind: "write-file" as const, path: EXECUTION_SOURCE, content: built.content,
      preimageDigest: canonicalDigest(currentSource),
    })],
  };
  const directory = resolve(repositoryRoot, ".usf", "proposals");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const proposalPath = ".usf/proposals/provider-policy.json";
  await writeFile(resolve(repositoryRoot, proposalPath), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });

  return transactCommand(repositoryRoot, ["--proposal", proposalPath]);
}
