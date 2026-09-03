*Normative. Section 12 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 12. Command surface

Expose one executable:

```bash
usf <command> [options]
```

Required commands:

```text
usf init
usf doctor
usf status
usf query
usf observe
usf metrics
usf work
usf models
usf probe
usf route
usf call
usf review
usf resolve
usf apply
usf check
usf integrate
usf evidence
usf prove
usf drift
usf publish
usf start
usf stop
usf watch
usf hermes
```

Every command MUST:

- have one primary responsibility;
- accept explicit files, stdin or JSONL;
- emit machine-readable output to stdout and diagnostics to stderr;
- avoid hidden global state;
- record exact inputs and scoped dependencies;
- be independently testable;
- be safe to retry when inputs are unchanged;
- avoid ANSI in machine mode;
- support repository-relative output paths;
- never require another command to have advanced a hidden lifecycle state.

The command registry is the single source for parsing and help. `usf --help`,
`usf help`, `usf help <command> [subcommand]` and
`usf <command> [subcommand] --help` MUST work without a repository, GitHub,
provider credentials, a supervisor or network access. Help states the purpose,
synopsis, bounded options, output schema, exit codes, implementation status,
external contact, history scan and authority/mutation effect for the selected
topic. Human help is text; `usf help ... --json` is stable machine-readable
metadata.

### 12.1 `usf init`

Create `.usf/`, verify containment, install/verify dependencies, retrieve catalogue snapshots, compile the local graph and contact no provider unless explicitly requested.

Idempotent.

### 12.2 `usf doctor`

Check Git identity, repository containment, package versions, `.env` tracking/mode, credentials by name only, graph capability, catalogue freshness, adapters, privacy policy, zero-cost policy, path/symlink safety and optional provider health.

### 12.3 `usf status`

Report observed state only: Git, semantic revision, store drift, current work graph, active chains, eligible routes, throughput, latest checks, integration queue and terminal-proof progress.

### 12.4 `usf query`

Read bounded semantic projections by IRI, contract, selector or SPARQL. Refuse mutation SPARQL. Emit truncation metadata. Produce fine-grained semantic dependency manifests.

### 12.5 `usf observe`

Produce factual observations for repository, graph, runtime, provider, validation and artefact state. Observation identity binds only observed facts, not summaries containing the observation identity.

### 12.5.1 `usf metrics`

Aggregate bounded operational history without becoming telemetry authority.
Keep `status` as the cheap current summary and `observe` as a point-in-time
factual observation. `metrics` reads explicit JSONL or ignored
`.usf/metrics/` records and exposes:

```text
usf metrics summary
usf metrics providers
usf metrics models
usf metrics tokens
usf metrics runs
usf metrics cache
usf metrics failures
usf metrics concurrency
```

Every view MUST accept bounded source and result limits, explicit time/run and
provider/model filters where applicable, and report input coverage,
truncation/incompleteness, numerators and denominators. Requested identity,
actual provider route and underlying model are separate dimensions. Missing
usage, cost, lineage, quota or identity is `unknown` / `not-observed`, never
zero. `T_useful` is reported only for tokens whose contribution digest is
referenced by accepted candidate, review, repair or proof-relevant lineage;
accepted adapter output alone is insufficient.

The command contacts no provider, GitHub or remote and performs no implicit
probe, publication, commit, push or semantic mutation. Operational events and
rollups contain no prompt/response bytes, credentials, endpoints, absolute
paths or unbounded labels. They are rebuildable local observations, not
evidence, proof, work completion or semantic source. Do not add a duplicate
`stats` alias or provider-specific top-level commands.

The bootstrap operator-observability slice implements help, broad `status` and
bounded `metrics`; it reserves `observe` as a distinct planned command for a
later graph-defined point-in-time observation slice rather than conflating it
with historical aggregation.

### 12.6 `usf work`

Derive the current work DAG and emit bounded work packets. Support:

```text
--ready
--selector
--stream
--shard
--max-items
```

A packet includes objective, semantic dependencies, read/write sets,
constraints, acceptance criteria, validation plan, evidence requirements,
proof obligations, contract permission, construction and activation
eligibility, immutable realisation basis, model capabilities, privacy, output
schema and graph-defined stop conditions.

No ticket is required. Dependency-ready alone is not semantic readiness. The
packet grants no authority beyond its exact current graph-derived basis and
permission ceiling.

### 12.7 `usf models`

Retrieve/normalize models.dev data, distinguish underlying model from provider route, report installed adapters and credentials by name, filter by capability/privacy/cost and maintain no independent hand-curated model database. Each chain/run freezes the exact raw catalogue snapshot digest and normalized-view digest it uses; a later refresh cannot silently alter an in-flight route decision.

### 12.8 `usf probe`

Perform bounded live capability and zero-cost verification. Probe lazily for active work, not every model before work begins. Record endpoint, actual provider/model, capability result, quota signal, usage and observed cost. Reject hidden paid fallback and unknown pricing.

### 12.9 `usf route`

Purely match semantically eligible work packets with current realisation bases
to fresh probe results and empirical validated performance observations.
Explain every inclusion/exclusion. Refuse external contact for proofblocked,
missing-evidence, failed-proof, stale or fabricated bases. Support diverse,
all-eligible, fastest, review-diverse and deterministic-fixture strategies.

Routing metrics are operational observations, not semantic authority or a fixed roster.

### 12.10 `usf call`

Invoke one or many assignments through the provider abstraction with provider-specific concurrency, bounded retries and `Retry-After` handling.

Every assignment carries explicit maximum turns, wall time, input/output tokens, tool calls and retry counts. A provider call is deduplicated by work-packet, route, prompt-template, tool-version and scoped dependency digests. Repeating an unchanged call requires `--force` or an explicit independence/freshness purpose.

Support two bounded modes:

1. `proposal` — return structured proposal, patch or file operations;
2. `workspace` — operate through a scope-checked tool broker in an isolated candidate workspace for developer-like iterative edit/test/repair.

Permitted broker tools may include read/search, typed write/patch and approved focused validation. Models receive no unrestricted shell, network, Git mutation, graph publication or secret access.

One workspace session may perform many edits and focused tests before any commit.

### 12.11 `usf review`

Create independent, risk-based review assignments. Review semantic coverage, implementation defects, security, tests, path scope, contradictions and claims. Use blocker/warning/note. Avoid all-to-all review and self-review when alternatives exist.

### 12.12 `usf resolve`

Resolve compatible contributions and reviews into one candidate using deterministic merge where possible and model-assisted synthesis only where reasoning is required. Preserve accepted/rejected lineage and unresolved findings. Do not write to a repository.

### 12.13 `usf apply`

Create or use an isolated candidate workspace materialised from the exact scoped base under `.usf/workspaces/<candidate-digest>/`. Candidate iteration MUST NOT require a Git branch, worktree or commit. Materialise with a repository-contained copy-on-write/reflink strategy where supported, otherwise a bounded copied snapshot; never use writable hard links to primary source. The workspace contains no usable primary `.git` control directory. Do not require the whole repository tree to be unchanged when unrelated paths changed. Derive the candidate change from actual pre/post file bytes, never model prose. `usf integrate` later applies the accepted typed delta to a short-lived Git integration worktree and derives the authoritative final diff from Git. Never modify the primary workspace during candidate execution.

### 12.14 `usf check`

Run affected checks during iteration and full checks at declared integration/publication/acceptance boundaries.

Checks include graph/schema/SHACL/integrity, format, typecheck, lint, unit/contract/integration tests, build, path scope, secret scan, generated freshness and planted defects.

Cache results by exact dependency digests. An unrelated change must not force unrelated expensive checks.

### 12.15 `usf integrate`

Integrate one or more checked candidates through standard Git.

Requirements:

- verify scoped dependencies and pre-images;
- batch candidates with disjoint or cleanly mergeable write sets;
- acquire one short repository-local integration lock only during primary-branch mutation;
- create a coherent Git commit, not one commit per model action;
- rerun affected checks after batch integration;
- schedule periodic/full checks by policy;
- leave conflicting candidates as explicit repair work;
- never create a second merge protocol.

Provider work and unrelated chains continue while integration waits.

### 12.16 `usf evidence`

Normalize observations and check results into evidence candidates. Promote only evidence required for a proof conclusion or durable future decision. Routine logs remain operational working state.

### 12.17 `usf prove`

Deterministically evaluate exact evidence against exact obligations with explicit applicability and scoped currentness. Distinguish pass, fail, blocked and unresolved. Do not modify source.

### 12.18 `usf drift`

Compare semantic source, derived store, graph-authorised realisation, Git implementation, accepted evidence and current observations. Report scoped and global drift. Do not repair.

### 12.19 `usf publish`

Validate and atomically apply one or more compatible significant semantic deltas to tracked graph source.

Requirements:

- validate candidate deltas without requiring prior commits;
- batch compatible deltas;
- lock only the affected publication scope or the brief final graph-source mutation;
- run affected graph checks first and complete graph gates at the publication boundary;
- rebuild from resulting tracked files;
- emit a publication receipt;
- create no implicit push or release;
- permit a later coherent Git checkpoint to contain several publications.

### 12.20 `usf start` and `usf stop`

Expose an explicit process lifecycle without creating a second scheduler,
authority plane or service manager.

`usf start` MUST:

- require an explicit versioned realisation profile and explicit
  repository-relative product manifest; bind the process-control identity to
  the profile selector, manifest selector, through boundary,
  tracked automation-policy digest and exact lifecycle-tool digest;
- record the global semantic revision and selected per-work scoped dependency
  digests as dynamic observations rather than process-wide invalidation keys;
  semantic or product-overlay movement rederives the selected work projection
  and re-evaluates only affected work rather than restarting the composer or
  requiring whole-run reproof;
- require no GitHub or Git-remote availability for local query, work,
  contribution, candidate, check or lifecycle progress. Local Git carrier
  identity may be observed, but commit batching and explicit push remain
  separate boundaries and remote failure cannot stop unrelated local work;
- acquire one exact instance-scoped, OS-released repository-local ownership
  lock before any provider contact and retain it while admitted work exists;
  this is neither a distributed lease nor a global lifecycle checkpoint;
- run the same composer as `usf watch` in the foreground, emit a
  machine-readable readiness record only after identity and policy checks pass,
  and leave backgrounding or restart policy to ordinary Unix process
  supervision;
- be retry-safe: an identical live instance reports `already-running`, while a
  conflicting live instance fails closed;
- keep all process records beneath ignored `.usf/runs`, mode-restricted and
  operational only. A running or ready record never establishes semantic
  completion, evidence or proof.

`usf stop` MUST:

- target an exact named instance, defaulting only to the unambiguous default
  instance;
- validate the complete recorded process identity and write an instance-bound
  graceful-stop intent beneath `.usf/` rather than signalling a PID blindly;
- stop new assignment admission, wait for bounded drain and return an explicit
  `stopped`, `already-stopped`, `degraded` or refused result;
- be idempotent, never signal an unrelated process, and leave forced
  termination to an explicit external-supervisor action. If admitted work
  ignores cancellation beyond the drain bound, return a degraded observation
  to the waiting stop command but retain instance ownership until that work
  actually settles or the external supervisor terminates the process;
- permit restart to quarantine demonstrably stale operational records and
  rescan current artefacts, Git and semantic source without replay.

Every executable or continuously operating deliverable MUST declare its start,
readiness, drain and stop contract. Pure libraries, metadata indexes and static
file artefacts declare lifecycle not applicable rather than gaining a
fictitious process. Lifecycle declarations grant no integration, publication
or runtime-provider authority.

### 12.21 `usf hermes`

Provide an optional Hermes-Agent management facade without creating another
composer or authority plane.

`usf hermes` MUST:

- resolve bare invocation to exactly one tracked, versioned default operating
  intent or refuse before provider or Hermes-Agent contact when the intent is
  absent, invalid or ambiguous;
- bind an exact USF core profile and manifest plus an exact selected-product
  profile and manifest, retaining separate core-to-product, product-to-core and
  composite content digests so unrelated movement does not require global
  reproof. ANQR is one product overlay, not a Hermes-only execution mode;
- invoke the same disposable foreground composer, lifecycle owner lock, stop
  intent, bounded drain and restart-by-rescan path used by `usf start` and
  `usf watch`; ordinary `usf stop --instance NAME` can stop the exact Hermes
  lifecycle instance;
- consume the same provider configuration, availability, economics,
  qualification, routing and concurrency decisions as ordinary USF commands,
  considering every currently configured and eligible route dynamically rather
  than maintaining a Hermes roster;
- preserve the live-provider sequence: trusted exact-account receipt,
  content-verified scrubbed adapter child, authenticated provider-produced
  answers, genuine hidden-holdout qualification, then live call and unattended
  composition;
- perform no credential lookup in the initial hermetic facade. Later live work
  names one exact repository-relative ignored owner-only credential file,
  never falls back to ambient inherited variables, and forwards at most the
  selected route's allowlisted variable through the same future scrubbed child;
  never copy or export the complete V3 credential environment to Hermes-Agent;
- keep Hermes optimization optional, asynchronous and bounded. It may propose
  prompt/context compression, agent roles, route mixtures, review, repair,
  batch cohorts and skill candidates, but failure, timeout or absence preserves
  the deterministic plan. A future Hermes call consumes its own visible
  assignment, provider slot and budgets, but cannot reserve unrelated slots or
  the `primary-mutation` lock. Every proposal binds the exact base plan, ready
  set, scoped dependencies, prompts, context, output, tools, skills and
  optimizer runtime, applies only to unclaimed work, and is ignored when late,
  stale or mismatched; it cannot cancel, duplicate or suppress assignments;
- keep one stable closed policy envelope tracked, while each AI-tuned resolved
  instance configuration is schema-validated, fully input-digest-bound and
  atomically stored owner-only beneath ignored `.usf/runs/hermes/`. Status and
  restart rederive it from tracked authority rather than trusting ignored
  state; routine tuning creates no Git commit or semantic publication;
- treat generated skills as isolated, versioned candidates that require normal
  validation, independent review and later graph-authorized activation. A live
  run cannot hot-mutate active instructions, tools, qualifications, acceptance
  or authority;
- require no Docker daemon, GitHub, hosted or self-hosted runner, external CAS,
  database, Stardog, V1/V2 checkout or separate repository for deterministic
  help, doctor, lifecycle, fallback, restart or verification.

Hermes may propose coherent commit or publication batches, but USF decides
eligibility from checked candidates, fresh scoped dependencies, compatible
write sets and validation boundaries, unresolved blockers and rollback scope.
A chain stage is not automatically a commit boundary. Every flush is limited
by the selected `through` ceiling and tracked automation policy. At `check`,
stop leaves checked candidates queued and performs no integration, commit or
publication. At an explicitly authorized higher ceiling, flush on
coherent-unit closure, risk/diff/age ceilings, explicit checkpoint or stop
drain, with no minimum batch size that can starve a lone accepted candidate.

Hermes is never required to select a product. Ordinary `usf start` can select
the USF-only profile, ANQR profile or any later product profile directly. A
different product may provide a different versioned operating intent and
stable Hermes policy configuration while using the same optional facade.

The initial Hermes slice may prove only local configuration, provider
population evaluation, deterministic fallback and foreground start/status/stop
through fixtures. It MUST NOT claim that Hermes-Agent ran, that a provider was
contacted, live parallelism or semantic-token reduction, production BAU, full
ANQR, staging, production or terminal proof without the exact evidence.

### 12.22 `usf watch`

Provide continuous foreground semantic realisation without introducing a second authority or workflow engine.

`watch` MUST:

- repeatedly derive ready work from current graph/repository/evidence;
- launch bounded independent chains through the same command contracts;
- use provider-specific queues and host/resource caps;
- allow multiple watch processes to cooperate through short-lived repository-local atomic claims;
- derive completion from valid artefacts, integration and semantic state;
- release claims automatically on process exit where the host supports file locks;
- recover after restart by rescanning explicit artefacts rather than replaying events;
- isolate provider and candidate failures;
- idle when no useful work exists rather than fabricate activity;
- support `--through check`, `--through integrate` and `--through publish`;
- default to `--through check`; integration or publication requires explicit CLI selection and tracked automation policy;
- use bounded idle backoff rather than busy polling;
- handle SIGINT/SIGTERM by stopping new assignments, allowing bounded in-flight artefacts to finish or time out, and releasing local claims;
- preserve every failed chain for diagnosis;
- stop safely on containment, privacy, cost or integrity refusal.

`watch` is a disposable composer. Killing it must not require a recovery protocol.

### 12.23 Command stitching and authority effects

The command surface is complete only when the following composition holds without hidden stages:

| Concern | Command | Primary input | Primary output | Canonical authority effect |
|---|---|---|---|---|
| Repository setup | `init` | tracked configuration | contained local projection | none |
| Health/current state | `doctor`, `status` | repository/runtime | observations | none |
| Semantic context | `query` | semantic selector | bounded context | none |
| Factual state | `observe` | repo/graph/provider/runtime | observation | none |
| Work derivation | `work` | profile + contract + evidence/proof/currentness | eligible/refused work DAG/packets + realisation basis | none |
| Model ecosystem | `models`, `probe` | catalogue/config/credential | route observations | none |
| Assignment | `route` | work + probe snapshot | assignments | none |
| Contribution | `call` | assignment + bounded packet | contribution/workspace candidate | none |
| Critique | `review` | candidate + criteria | findings | none |
| Candidate formation | `resolve` | contributions + findings | candidate | none |
| Isolated mutation | `apply` | candidate | worktree diff | none |
| Deterministic judgement | `check` | worktree/delta | validation observation | none |
| Durable source integration | `integrate` | checked candidates | coherent Git commit | implementation history only |
| Evidence formation | `evidence` | observations/checks | evidence candidate | none until publication |
| Proof evaluation | `prove` | obligation + exact evidence | proof result | none until publication |
| Consistency | `drift` | semantic/repo/evidence/current observations | drift report | none |
| Semantic admission | `publish` | significant checked semantic/evidence delta | validated semantic source | local semantic authority |
| Process start/stop | `start`, `stop` | explicit profile + tracked automation policy | lifecycle observations | none |
| Continuous composition | `watch` | policy + ready work | repeated chains | only through explicit called boundaries |
| Optional autonomous management | `hermes` | exact tracked default intent + current core/product/provider inputs | proposals and the same foreground lifecycle observations | none beyond explicit called boundaries |

No other hidden application is required to move an artefact between rows. Standard Git push is outside the semantic lifecycle and remains an explicit source-publication action.

---
