import { exitCodes, UsfError } from "../core/errors.ts";

export type CommandGroup = "setup" | "inspect" | "compose" | "admit" | "operate";
export type CommandAvailability = "implemented" | "planned";

export interface HelpOption {
  readonly syntax: string;
  readonly description: string;
}

export interface HelpTopic {
  readonly path: readonly string[];
  readonly purpose: string;
  readonly synopsis: readonly string[];
  readonly options: readonly HelpOption[];
  readonly outputSchema: string;
  readonly exitCodes: readonly number[];
  readonly externalContact: "none" | "explicit" | "possible";
  readonly historyScan: "none" | "bounded";
  readonly authorityEffect: string;
  readonly availability: CommandAvailability;
}

export interface CommandMetadata extends HelpTopic {
  readonly name: string;
  readonly group: CommandGroup;
  readonly topics?: readonly HelpTopic[];
}

const standardExitCodes = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8] as const);
const exitCodeDescriptions = Object.freeze({
  0: "success",
  1: "domain failure",
  2: "invalid input or command usage",
  3: "explicit external dependency unavailable",
  4: "currentness or drift failure",
  5: "containment refusal",
  6: "no eligible zero-paid route",
  7: "integration conflict",
  8: "continuous operation degraded",
} as const);
const noOptions = Object.freeze([] as const);
const localReadOnly = "Read-only local observation; no semantic mutation, commit, push, or authority effect.";
const planned = "Planned command; invoking it currently refuses without changing state.";

function command<const T extends Omit<CommandMetadata, "path">>(input: T): T & { readonly path: readonly [T["name"]] } {
  return Object.freeze({ ...input, path: Object.freeze([input.name]) }) as T & { readonly path: readonly [T["name"]] };
}

function topic(path: readonly string[], input: Omit<HelpTopic, "path">): HelpTopic {
  return Object.freeze({ ...input, path: Object.freeze([...path]) });
}

const metricOptions = Object.freeze([
  { syntax: "--input .usf/metrics/FILE.jsonl|-", description: "Read one explicit local JSONL source or bounded stdin; default is .usf/metrics/events.jsonl." },
  { syntax: "--max-events N", description: "Read at most N local event records (default 10000; maximum 100000)." },
  { syntax: "--max-items N", description: "Return at most N named groups plus an explicit overflow group (default 20; maximum 100)." },
  { syntax: "--since RFC3339 | --until RFC3339", description: "Bound the observed time range." },
  { syntax: "--run ID", description: "Select one explicit run." },
  { syntax: "--provider NAME | --model NAME", description: "Select an observed provider route or underlying model." },
] as const);

const metricTopicDefaults = {
  options: metricOptions,
  outputSchema: "urn:usf:metrics-report:1",
  exitCodes: standardExitCodes,
  externalContact: "none" as const,
  historyScan: "bounded" as const,
  authorityEffect: localReadOnly,
  availability: "implemented" as const,
};

const modelFilterOptions = Object.freeze([
  { syntax: "--provider-route ID | --model ID", description: "Filter one exact provider-route or route-model identity." },
  { syntax: "--underlying-family ID | --underlying-model ID", description: "Filter normalized underlying identity without conflating it with the provider route." },
  { syntax: "--capability NAME | --credential-name NAME", description: "Filter normalized catalogue capability or public credential name." },
  { syntax: "--adapter any|installed", description: "Include every catalogue route or only adapters frozen as installed." },
  { syntax: "--catalogue-price known|unknown|zero-price", description: "Filter catalogue pricing facts; zero-price is not entitlement or availability proof." },
  { syntax: "--max-items N", description: "Bound returned model routes (default 50; maximum 1000)." },
] as const);

export const commandRegistry = Object.freeze([
  command({ name: "init", group: "setup", purpose: "Create and verify the repository-local operational layout.", synopsis: ["usf init"], options: noOptions, outputSchema: "urn:usf:init-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: "Creates only ignored operational state; never establishes semantic authority.", availability: "implemented" }),
  command({ name: "doctor", group: "setup", purpose: "Inspect local provider configuration, policy, catalogue, adapters, credential names and containment without probing.", synopsis: ["usf doctor [--env-file PATH]"], options: [{ syntax: "--env-file PATH", description: "Explicitly inspect one owner-only untracked environment file through configured credential-name allowlists; values are never emitted." }], outputSchema: "urn:usf:doctor-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: localReadOnly, availability: "implemented" }),
  command({ name: "status", group: "inspect", purpose: "Report a broad, bounded current operational summary; use the lifecycle topic for one named process instance.", synopsis: ["usf status [--profile URN --manifest PATH] [--detail summary|full] [--max-items N] [--instance NAME]", "usf status lifecycle [--instance NAME]"], options: [{ syntax: "--profile URN --manifest PATH", description: "Explicitly select a versioned product/profile scope; neither option selects a product alone." }, { syntax: "--detail summary|full", description: "Choose bounded summary or fuller local detail." }, { syntax: "--max-items N", description: "Bound returned work rows." }, { syntax: "--instance NAME", description: "Select nested lifecycle status; when used alone, preserves the initial lifecycle-only spelling." }], outputSchema: "urn:usf:status-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented", topics: [topic(["status", "lifecycle"], { purpose: "Read the current state of one local foreground lifecycle instance.", synopsis: ["usf status lifecycle [--instance NAME]", "usf status --instance NAME"], options: [{ syntax: "--instance NAME", description: "Select the exact local lifecycle instance; default is only the default instance." }], outputSchema: "urn:usf:lifecycle-status-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented" })] }),
  command({ name: "query", group: "inspect", purpose: "Read one bounded semantic projection by selector, exact IRI or contract IRI.", synopsis: ["usf query (--selector IRI | --iri IRI | --contract IRI) [--max-items N] [--manifest PATH]"], options: [{ syntax: "--selector IRI | --iri IRI | --contract IRI", description: "Select a semantic projection, one exact resource, or one exact contract." }, { syntax: "--max-items N", description: "Bound returned rows." }, { syntax: "--manifest PATH", description: "Select a repository-relative graph manifest." }], outputSchema: "urn:usf:query-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented" }),
  command({ name: "observe", group: "inspect", purpose: "Produce a factual point-in-time repository, graph, runtime, provider, validation or artefact observation.", synopsis: ["usf observe --subject repository|graph|runtime|provider|validation|artifact"], options: [{ syntax: "--subject KIND", description: "Select exactly one factual observation domain." }], outputSchema: "urn:usf:observation:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "metrics", group: "inspect", purpose: "Aggregate bounded local operational history without becoming telemetry or semantic authority.", synopsis: ["usf metrics <summary|providers|models|tokens|runs|cache|failures|concurrency> [filters]"], options: metricOptions, outputSchema: "urn:usf:metrics-report:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: localReadOnly, availability: "implemented", topics: [
    topic(["metrics", "summary"], { ...metricTopicDefaults, purpose: "Return a bounded cross-cutting operational summary.", synopsis: ["usf metrics summary [filters]"] }),
    topic(["metrics", "providers"], { ...metricTopicDefaults, purpose: "Group requested routes and actual provider routes separately.", synopsis: ["usf metrics providers [--provider NAME] [filters]"] }),
    topic(["metrics", "models"], { ...metricTopicDefaults, purpose: "Group observed underlying models without conflating provider routes.", synopsis: ["usf metrics models [--provider NAME] [--model NAME] [filters]"] }),
    topic(["metrics", "tokens"], { ...metricTopicDefaults, purpose: "Report total and useful token denominators, preserving unknown usage and lineage.", synopsis: ["usf metrics tokens [--provider NAME] [--model NAME] [filters]"] }),
    topic(["metrics", "runs"], { ...metricTopicDefaults, purpose: "Summarise explicitly identified local runs.", synopsis: ["usf metrics runs [--run ID] [filters]"] }),
    topic(["metrics", "cache"], { ...metricTopicDefaults, purpose: "Report observed cache outcomes and missing-cache coverage.", synopsis: ["usf metrics cache [filters]"] }),
    topic(["metrics", "failures"], { ...metricTopicDefaults, purpose: "Report bounded observed failures without provider contact or raw payloads.", synopsis: ["usf metrics failures [--provider NAME] [filters]"] }),
    topic(["metrics", "concurrency"], { ...metricTopicDefaults, purpose: "Report observed concurrency and utilisation denominators.", synopsis: ["usf metrics concurrency [--provider NAME] [filters]"] }),
  ] }),
  command({ name: "work", group: "compose", purpose: "Derive bounded graph-authorized work packets.", synopsis: ["usf work [--selector IRI] [--ready] [--stream] [--shard ID] [--max-items N] [--manifest PATH]"], options: [{ syntax: "--selector IRI", description: "Select an exact work or profile scope." }, { syntax: "--ready", description: "Return only packets whose graph-defined prerequisites are ready." }, { syntax: "--stream", description: "Return the bounded stream projection supported by the work derivation contract." }, { syntax: "--shard ID", description: "Select one exact graph-defined shard." }, { syntax: "--max-items N", description: "Bound returned work packets." }, { syntax: "--manifest PATH", description: "Select a repository-relative graph manifest." }], outputSchema: "urn:usf:work-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented" }),
  command({ name: "models", group: "inspect", purpose: "Freeze and read models.dev catalogue facts while keeping route, underlying model, adapter and credential-name identities distinct.", synopsis: ["usf models <summary|list|refresh> [filters]"], options: modelFilterOptions, outputSchema: "urn:usf:models-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: "Summary/list are local read-only; refresh atomically writes only ignored private catalogue snapshots.", availability: "implemented", topics: [
    topic(["models", "summary"], { purpose: "Summarize one exact frozen raw and normalized catalogue pair without external contact.", synopsis: ["usf models summary [filters]"], options: modelFilterOptions, outputSchema: "urn:usf:models-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: localReadOnly, availability: "implemented" }),
    topic(["models", "list"], { purpose: "List a bounded filtered view from one exact frozen raw and normalized catalogue pair.", synopsis: ["usf models list [filters]"], options: modelFilterOptions, outputSchema: "urn:usf:models-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: localReadOnly, availability: "implemented" }),
    topic(["models", "refresh"], { purpose: "Explicitly fetch the fixed models.dev catalogue and atomically freeze exact private raw and normalized snapshots.", synopsis: ["usf models refresh [filters] [--timeout-ms N] [--max-bytes N]"], options: Object.freeze([...modelFilterOptions, { syntax: "--timeout-ms N", description: "Bound the fixed-origin request (default 10000; maximum 30000)." }, { syntax: "--max-bytes N", description: "Bound exact response bytes (default 16 MiB; maximum 32 MiB)." }]), outputSchema: "urn:usf:models-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: "Writes only ignored private catalogue snapshots; no semantic, Git, eligibility or proof effect.", availability: "implemented" }),
  ] }),
  command({ name: "probe", group: "inspect", purpose: "Run the fail-closed provider availability preflight or a local fixture semantic evaluation.", synopsis: ["usf probe <availability|semantic> [options]"], options: [{ syntax: "availability --route ID --env-file PATH --economics .usf/inputs/FILE.json|- --allow-inference --max-cost-usd 0 [--timeout-ms N]", description: "Validate explicit local intent and economics input; provider contact remains disabled until a registered trusted account-tier receipt exists." }, { syntax: "semantic --input .usf/inputs/FILE.json|-", description: "Locally evaluate stored answers against an exact supplied suite, profile and successful probe. stdin supports Unix composition." }], outputSchema: "urn:usf:cli-error:1 | urn:usf:semantic-qualification-result:1", exitCodes: Object.freeze([0, 2, 4, 5, 6]), externalContact: "none", historyScan: "bounded", authorityEffect: "Both paths are local and read-only. Neither creates semantic authority; availability cannot contact a provider in the current graph slice.", availability: "implemented", topics: [
    topic(["probe", "availability"], { purpose: "Validate a bounded availability request and fail closed before contact while trusted account-tier receipt acquisition is unavailable.", synopsis: ["usf probe availability --route ID --env-file PATH --economics .usf/inputs/FILE.json|- --allow-inference --max-cost-usd 0 [--timeout-ms N]"], options: [{ syntax: "--route ID", description: "Select exactly one configured provider route." }, { syntax: "--env-file PATH", description: "Select the future untracked owner-only mode-0600 credential file; values are never read after the current account-tier refusal." }, { syntax: "--economics .usf/inputs/FILE.json|-", description: "Supply bounded operator-asserted economics facts for binding checks; they cannot authenticate account tier or unlock provider contact." }, { syntax: "--allow-inference --max-cost-usd 0", description: "Both intent controls are mandatory but insufficient without a future registered trusted receipt." }, { syntax: "--timeout-ms N", description: "Declare the future request bound (default 10000; maximum 30000); no request is made in this slice." }], outputSchema: "urn:usf:cli-error:1", exitCodes: Object.freeze([2, 4, 5]), externalContact: "none", historyScan: "bounded", authorityEffect: "Fail-closed local preflight only. No provider contact, semantic qualification, routing grant, Git mutation, eligibility, acceptance or proof effect.", availability: "implemented" }),
    topic(["probe", "semantic"], { purpose: "Deterministically evaluate a supplied profile and stored fixture answers against a supplied versioned semantic suite without provider contact.", synopsis: ["usf probe semantic --input .usf/inputs/FILE.json", "producer | usf probe semantic --input -"], options: [{ syntax: "--input PATH|-", description: "One bounded UTF-8 semantic-qualification input. Files are limited to ignored owner-only .usf/inputs/*.json; '-' reads bounded stdin." }], outputSchema: "urn:usf:semantic-qualification-result:1", exitCodes: Object.freeze([0, 2, 5, 6]), externalContact: "none", historyScan: "none", authorityEffect: "Local fixture evaluation only; supplied authority and answers are replayed but not independently admitted.", availability: "implemented" }),
  ] }),
  command({ name: "route", group: "compose", purpose: "Locally replay supplied work, probe and semantic results against the unchanged indexed qualification suite and policy, then derive bounded assignments without provider invocation.", synopsis: ["usf route --input .usf/inputs/FILE.json [--strategy NAME] [--host-concurrency N] [--max-assignments N]", "producer | usf route --input -"], options: [{ syntax: "--input PATH|-", description: "One bounded route-input JSON object with exact answer replay sources but no self-supplied suite or policy. Files are limited to ignored owner-only .usf/inputs/*.json; '-' reads bounded stdin. config/qualification.json supplies the separate indexed suite and policy authority." }, { syntax: "--strategy NAME", description: "Override the input strategy only when it matches: all-eligible, diverse, fastest, review-diverse or deterministic-fixture." }, { syntax: "--host-concurrency N | --max-assignments N", description: "Optional bounded caps; an explicit value must match any value in the input envelope." }], outputSchema: "urn:usf:route-result:1", exitCodes: Object.freeze([0, 2, 4, 5, 6]), externalContact: "none", historyScan: "none", authorityEffect: "Read-only local fixture/replay assignment derivation against file-based authority. It creates no provider contact, semantic qualification, execution, Git mutation, acceptance or proof.", availability: "implemented" }),
  command({ name: "call", group: "compose", purpose: "Invoke explicit assignments through the current deterministic bootstrap provider abstraction.", synopsis: ["usf call '<assignments-and-host-concurrency-json>'"], options: [{ syntax: "JSON", description: "One canonical JSON object containing assignments and optional hostConcurrency." }], outputSchema: "urn:usf:call-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: "Returns fake-provider contributions only in this bootstrap build; no semantic mutation, Git effect, or live-provider claim.", availability: "implemented" }),
  command({ name: "review", group: "compose", purpose: "Create independent risk-based review assignments.", synopsis: ["usf review --candidate DIGEST"], options: [{ syntax: "--candidate DIGEST", description: "Select one candidate basis." }], outputSchema: "urn:usf:review-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "resolve", group: "compose", purpose: "Resolve compatible contributions into a candidate without writing a repository.", synopsis: ["usf resolve '<contribution-array-json>'"], options: [{ syntax: "JSON", description: "One canonical JSON array of contributions." }], outputSchema: "urn:usf:resolve-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: "Produces a candidate only; no semantic or Git mutation.", availability: "implemented" }),
  command({ name: "apply", group: "admit", purpose: "Materialise an isolated candidate workspace from an exact candidate delta.", synopsis: ["usf apply CANDIDATE"], options: [{ syntax: "CANDIDATE", description: "Provide one explicit candidate envelope." }], outputSchema: "urn:usf:apply-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: "Writes only an isolated ignored candidate workspace; no primary workspace or semantic mutation.", availability: "implemented" }),
  command({ name: "check", group: "admit", purpose: "Run one allowlisted focused validation under Node permission confinement.", synopsis: ["usf check CANDIDATE_DIGEST '<allowlist-json>' CHECK_ID"], options: [{ syntax: "CANDIDATE_DIGEST", description: "Select an existing isolated candidate workspace." }, { syntax: "JSON", description: "One explicit focused-check allowlist array." }, { syntax: "CHECK_ID", description: "Select one allowlisted check." }], outputSchema: "urn:usf:check-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: "Produces a check observation only; no semantic authority mutation.", availability: "implemented" }),
  command({ name: "integrate", group: "admit", purpose: "Integrate checked candidates through ordinary Git in a short-lived workspace.", synopsis: ["usf integrate --candidate DIGEST"], options: [{ syntax: "--candidate DIGEST", description: "Select one checked candidate." }], outputSchema: "urn:usf:integrate-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "evidence", group: "admit", purpose: "Normalize selected observations and check results into evidence candidates.", synopsis: ["usf evidence --input PATH"], options: [{ syntax: "--input PATH", description: "Provide explicit selected inputs." }], outputSchema: "urn:usf:evidence-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "prove", group: "admit", purpose: "Evaluate exact evidence against exact obligations without modifying source.", synopsis: ["usf prove --obligation IRI --evidence PATH"], options: [{ syntax: "--obligation IRI", description: "Select one declared obligation." }], outputSchema: "urn:usf:prove-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "drift", group: "inspect", purpose: "Compare scoped semantic, realization and current observations without repair.", synopsis: ["usf drift [--scope IRI]"], options: [{ syntax: "--scope IRI", description: "Select bounded comparison scope." }], outputSchema: "urn:usf:drift-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "publish", group: "admit", purpose: "Validate and atomically apply compatible significant semantic deltas.", synopsis: ["usf publish --delta PATH"], options: [{ syntax: "--delta PATH", description: "Provide explicit semantic delta input." }], outputSchema: "urn:usf:publish-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: "May mutate tracked semantic source only after validation; never implies commit or push.", availability: "planned" }),
  command({ name: "start", group: "operate", purpose: "Run one profile-bound foreground lifecycle instance.", synopsis: ["usf start --profile VERSIONED_URN --manifest PATH [--through check|integrate|publish] [--instance NAME]"], options: [{ syntax: "--profile VERSIONED_URN", description: "Select the exact explicitly versioned profile (required)." }, { syntax: "--manifest PATH", description: "Select its repository-relative product manifest explicitly (required)." }, { syntax: "--through check|integrate|publish", description: "Set the policy-bounded delivery ceiling; the tracked automation policy supplies the default." }, { syntax: "--instance NAME", description: "Select a local OS-locked instance; default is default." }], outputSchema: "urn:usf:lifecycle-event:1", exitCodes: standardExitCodes, externalContact: "possible", historyScan: "bounded", authorityEffect: "Writes ignored process records and may invoke graph-authorized work; process records are not semantic authority.", availability: "implemented" }),
  command({ name: "stop", group: "operate", purpose: "Request bounded drain and stop for one named lifecycle instance.", synopsis: ["usf stop [--instance NAME] [--wait-ms N]"], options: [{ syntax: "--instance NAME", description: "Select one local lifecycle instance." }, { syntax: "--wait-ms N", description: "Bound observed drain wait." }], outputSchema: "urn:usf:lifecycle-stop-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: "Writes an ignored instance-bound stop request only; no semantic authority mutation.", availability: "implemented" }),
  command({ name: "watch", group: "operate", purpose: "Run the same profile-bound foreground composer as start.", synopsis: ["usf watch --profile VERSIONED_URN --manifest PATH [--through check|integrate|publish] [--instance NAME]"], options: [{ syntax: "--profile VERSIONED_URN", description: "Select the exact explicitly versioned profile (required)." }, { syntax: "--manifest PATH", description: "Select its repository-relative product manifest explicitly (required)." }, { syntax: "--through check|integrate|publish", description: "Set the policy-bounded delivery ceiling; the tracked automation policy supplies the default." }, { syntax: "--instance NAME", description: "Select a local OS-locked instance; default is default." }], outputSchema: "urn:usf:lifecycle-event:1", exitCodes: standardExitCodes, externalContact: "possible", historyScan: "bounded", authorityEffect: "Writes ignored process records and may invoke graph-authorized work; process records are not semantic authority.", availability: "implemented" }),
  command({ name: "help", group: "inspect", purpose: "Describe the static CLI interface without inspecting a repository or contacting any service.", synopsis: ["usf --help", "usf help [COMMAND [SUBCOMMAND]] [--json]"], options: [{ syntax: "--json", description: "Emit stable machine-readable help metadata." }], outputSchema: "urn:usf:cli-help:1", exitCodes: Object.freeze([0, 2] as const), externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented" }),
] as const satisfies readonly CommandMetadata[]);

export type CommandName = (typeof commandRegistry)[number]["name"];
export const commandNames = Object.freeze(commandRegistry.map((entry) => entry.name)) as readonly CommandName[];

export function findHelpTopic(path: readonly string[]): CommandMetadata | HelpTopic | undefined {
  if (path.length === 0) return undefined;
  const command = commandRegistry.find((entry) => entry.name === path[0]);
  if (!command) return undefined;
  if (path.length === 1) return command;
  const topics = "topics" in command ? command.topics : undefined;
  return topics?.find((entry) => entry.path.length === path.length && entry.path.every((segment, index) => segment === path[index]));
}

function serialiseTopic(entry: CommandMetadata | HelpTopic): Record<string, unknown> {
  return {
    path: entry.path,
    purpose: entry.purpose,
    synopsis: entry.synopsis,
    options: entry.options,
    outputSchema: entry.outputSchema,
    exitCodes: entry.exitCodes,
    exitCodeMeanings: entry.exitCodes.map((code) => ({ code, meaning: exitCodeDescriptions[code as keyof typeof exitCodeDescriptions] ?? "command-specific refusal" })),
    externalContact: entry.externalContact,
    historyScan: entry.historyScan,
    authorityEffect: entry.authorityEffect,
    availability: entry.availability,
    ...("group" in entry ? { group: entry.group } : {}),
    ...(!("topics" in entry) || entry.topics === undefined ? {} : { topics: entry.topics.map(serialiseTopic) }),
  };
}

export function renderHelpText(entry: CommandMetadata | HelpTopic | undefined): string {
  if (entry === undefined) {
    const groups = (["setup", "inspect", "compose", "admit", "operate"] as const).map((group) => {
      const entries = commandRegistry
        .filter((candidate) => candidate.group === group)
        .map((candidate) => `    ${candidate.name}${candidate.availability === "planned" ? " (planned)" : ""}: ${candidate.purpose}`)
        .join("\n");
      return `  ${group}:\n${entries}`;
    });
    return ["USF command interface", "", "Usage: usf <command> [options]", "       usf help [command [subcommand]] [--json]", "", ...groups, "", "Run 'usf help <command>' for bounded options, output, effects and availability."].join("\n");
  }
  const topics = "topics" in entry && entry.topics !== undefined
    ? ["", "Topics:", ...entry.topics.map((child) => `  ${child.path.slice(1).join(" ")}: ${child.purpose}`)]
    : [];
  return [
    `USF ${entry.path.join(" ")}`,
    "",
    entry.purpose,
    `Availability: ${entry.availability}`,
    `External contact: ${entry.externalContact}; history scan: ${entry.historyScan}.`,
    `Authority effect: ${entry.authorityEffect}`,
    "",
    "Usage:",
    ...entry.synopsis.map((line) => `  ${line}`),
    "",
    "Options:",
    ...(entry.options.length === 0 ? ["  (none)"] : entry.options.map((option) => `  ${option.syntax}  ${option.description}`)),
    ...topics,
    "",
    `Output schema: ${entry.outputSchema}`,
    "Exit codes:",
    ...entry.exitCodes.map((code) => `  ${code}: ${exitCodeDescriptions[code as keyof typeof exitCodeDescriptions] ?? "command-specific refusal"}`),
  ].join("\n");
}

export function parseHelpArguments(args: readonly string[]): { readonly path: readonly string[]; readonly json: boolean } {
  const json = args.includes("--json");
  const path = args.filter((argument) => argument !== "--json");
  if (path.some((argument) => argument.startsWith("-")) || path.length > 2) {
    throw new UsfError("HELP_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Help accepts an optional command, subcommand, and --json.");
  }
  if (path.length > 0 && findHelpTopic(path) === undefined) {
    throw new UsfError("HELP_TOPIC_UNKNOWN", exitCodes.INVALID_INPUT, "Unknown help topic.", { topic: path.join(" ") });
  }
  return Object.freeze({ path: Object.freeze(path), json });
}

export function helpCommandResult(args: readonly string[]): { readonly output: unknown; readonly outputMode: "text" | "json" } {
  const request = parseHelpArguments(args);
  const selected = findHelpTopic(request.path);
  if (request.json) {
    return Object.freeze({ output: { schema: "urn:usf:cli-help:1", status: "ok", topic: request.path, ...(selected === undefined ? { commands: commandRegistry.map(serialiseTopic) } : { command: serialiseTopic(selected) }) }, outputMode: "json" as const });
  }
  return Object.freeze({ output: renderHelpText(selected), outputMode: "text" as const });
}
