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

export const commandRegistry = Object.freeze([
  command({ name: "init", group: "setup", purpose: "Create and verify the repository-local operational layout.", synopsis: ["usf init"], options: noOptions, outputSchema: "urn:usf:init-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: "Creates only ignored operational state; never establishes semantic authority.", availability: "implemented" }),
  command({ name: "doctor", group: "setup", purpose: "Inspect containment, toolchain, graph and configured adapter readiness.", synopsis: ["usf doctor [--provider-health]"], options: [{ syntax: "--provider-health", description: "Explicitly permit a bounded provider health check." }], outputSchema: "urn:usf:doctor-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "status", group: "inspect", purpose: "Report a broad, bounded current operational summary; use the lifecycle topic for one named process instance.", synopsis: ["usf status [--profile URN --manifest PATH] [--detail summary|full] [--max-items N] [--instance NAME]", "usf status lifecycle [--instance NAME]"], options: [{ syntax: "--profile URN --manifest PATH", description: "Explicitly select a versioned product/profile scope; neither option selects a product alone." }, { syntax: "--detail summary|full", description: "Choose bounded summary or fuller local detail." }, { syntax: "--max-items N", description: "Bound returned work rows." }, { syntax: "--instance NAME", description: "Select nested lifecycle status; when used alone, preserves the initial lifecycle-only spelling." }], outputSchema: "urn:usf:status-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented", topics: [topic(["status", "lifecycle"], { purpose: "Read the current state of one local foreground lifecycle instance.", synopsis: ["usf status lifecycle [--instance NAME]", "usf status --instance NAME"], options: [{ syntax: "--instance NAME", description: "Select the exact local lifecycle instance; default is only the default instance." }], outputSchema: "urn:usf:lifecycle-status-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented" })] }),
  command({ name: "query", group: "inspect", purpose: "Read a bounded semantic projection by selector or query.", synopsis: ["usf query --selector IRI [--max-items N] [--manifest PATH]"], options: [{ syntax: "--selector IRI", description: "Select a graph resource or projection." }, { syntax: "--max-items N", description: "Bound returned rows." }, { syntax: "--manifest PATH", description: "Select a repository-relative graph manifest." }], outputSchema: "urn:usf:query-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented" }),
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
  command({ name: "work", group: "compose", purpose: "Derive bounded graph-authorized work packets.", synopsis: ["usf work --selector IRI [--max-items N] [--manifest PATH]"], options: [{ syntax: "--selector IRI", description: "Select work or profile scope." }, { syntax: "--max-items N", description: "Bound work packets." }, { syntax: "--manifest PATH", description: "Select a repository-relative graph manifest." }], outputSchema: "urn:usf:work-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "none", authorityEffect: localReadOnly, availability: "implemented" }),
  command({ name: "models", group: "inspect", purpose: "Normalize a catalogue and expose installed adapters and eligible model facts.", synopsis: ["usf models [filters]"], options: [{ syntax: "--capability NAME", description: "Filter required capability." }], outputSchema: "urn:usf:models-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "probe", group: "inspect", purpose: "Perform an explicit bounded live capability and zero-cost probe.", synopsis: ["usf probe --route ID [limits]"], options: [{ syntax: "--route ID", description: "Select one eligible route." }], outputSchema: "urn:usf:probe-result:1", exitCodes: standardExitCodes, externalContact: "explicit", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
  command({ name: "route", group: "compose", purpose: "Match ready work to fresh observed routes without invocation.", synopsis: ["usf route --work PACKET [--strategy NAME]"], options: [{ syntax: "--work PACKET", description: "Select an explicit work packet." }], outputSchema: "urn:usf:route-result:1", exitCodes: standardExitCodes, externalContact: "none", historyScan: "bounded", authorityEffect: planned, availability: "planned" }),
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
    `Exit codes: ${entry.exitCodes.join(", ")}`,
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
