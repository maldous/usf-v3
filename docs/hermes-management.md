# Hermes-Agent management boundary

This document is the operator-facing design for the graph-defined
`urn:usf:contract:hermes-autonomous-management:1`. The current authority is
selected through:

```sh
./bin/usf query \
  --iri urn:usf:profile:v3-self-host-hermes:1 \
  --manifest graph/manifests/self-host-hermes.json

./bin/usf query \
  --iri urn:anqr:intent:hermes-bau:1 \
  --manifest graph/products/anqr/hermes-manifest.json

./bin/usf work \
  --selector urn:usf:work:hermes-management-facade \
  --max-items 10 \
  --manifest graph/manifests/self-host-hermes.json

./bin/usf work \
  --selector profile:urn:anqr:profile:hermes-bau:1 \
  --max-items 20 \
  --manifest graph/products/anqr/hermes-manifest.json

./bin/usf work \
  --selector urn:usf:work:hermes-bau-binding \
  --max-items 10 \
  --manifest graph/products/anqr/hermes-manifest.json
```

The first packet is product-neutral. The second proves the selected ANQR
management closure; the final exact product packet cannot be derived from the
core-only manifest.

## Implemented lifecycle surface

`usf hermes start`, `usf hermes status` and `usf hermes stop` are the supported
operator interface for business-as-usual. They own process identity, duplicate
refusal, orderly drain and the runtime files, so no operator needs to know a
PID or any file under `.usf/hermes/`. The former external driver script
(`scripts/hermes-bau.sh`) was removed at the post-realisation housekeeping
boundary; the registered lifecycle commands are the only interface.

```text
usf hermes start  [--env-file PATH] [--pause-seconds N] [--concurrency N] [--limit N]
usf hermes status
usf hermes stop   [--wait-ms N]
```

`start` refuses a second supervisor while one is live, reclaims a stale record
left by a dead process, spawns the detached supervisor and returns only after it
has observed the record that supervisor wrote for itself. Semantic state is never
reset by process lifecycle: the semantic cache, conformance evidence and landed
implementation survive any restart.

`stop` writes an instance-bound stop request, waits for the supervisor to observe
it at a cycle boundary — never inside a transaction — and only then escalates to
`SIGTERM` and `SIGKILL` within a bounded grace. It is idempotent: stopping a
supervisor that is not running is a success, and a stale record is reclaimed
without signalling anything.

`status` contacts no provider. It reports liveness, supervisor identity, the
current cycle and its last reason, ready/blocked/landed work counts, provider
activity, transactions, blockers, the latest behavioural evidence, facet counts
and the authority identity the supervisor started against.

Supervisor liveness is derived from durable Linux process identity — boot id,
start ticks, uid, argv digest and executable digest — so a recycled PID can never
be mistaken for the owner. `usf hermes supervise` is the foreground loop `start`
owns; it is not an operator entry point.

`usf hermes implement` and `usf hermes realise` are the two work lanes the
supervisor drives, and both remain separately invocable for inspection.

The remaining planned surface is:

```text
usf hermes doctor [--config config/hermes.json]
```

Bare `usf hermes` is an intentional full-management entrypoint, not help. It
resolves the one exact tracked default BAU intent and starts the same foreground
composer used by `usf start` and `usf watch`. Help remains available through
`usf hermes --help` and `usf help hermes [topic]` without a repository.

`start` writes only ignored lifecycle/plan records and emits JSONL. `status` and
`doctor` are read-only. `stop` writes the same exact instance-bound stop intent
as ordinary `usf stop`; therefore both of these target the configured instance:

```text
usf hermes stop
usf stop --instance hermes-bau
```

No hidden executable or temporary shell recipe is part of the interface.

## Tracked policy and resolved configuration

`config/hermes.json` is a stable, closed policy envelope. It names:

- Hermes-Agent as an optional optimizer, not an authority or prerequisite;
- one exact default BAU intent and lifecycle instance;
- the versioned USF core profile/manifest;
- the graph-authorized `urn:anqr:intent:hermes-bau:1`, ordinary ANQR product
  profile `urn:anqr:profile:bau:1`, optional management profile
  `urn:anqr:profile:hermes-bau:1` and product manifest;
- `check` as the default ceiling unless tracked automation policy explicitly
  permits a higher selected boundary;
- the existing provider, qualification, privacy, cost and automation files;
- dynamic selection of every currently eligible configured route;
- strict asynchronous budgets and deterministic fallback;
- credential, batching, generated-config and skill-candidate policies.

At invocation, USF validates the tracked envelope, loads the graph profiles,
derives their content identities, reads the ordinary provider readiness result
and creates an effective digest. A resolved AI-tuned instance may add bounded
prompt/context, role and cohort proposals, but it cannot change authority
fields. It binds the exact base plan, ready set, scoped dependencies, prompts,
context, output schema, tools, skill bundle and optimizer runtime. Its canonical
JSON is validated and written atomically at mode `0600` beneath:

```text
.usf/runs/hermes/<effective-digest>/
```

That directory is ignored, disposable and reconstructable. Status and restart
rederive it from tracked authority; ignored state is never scheduling
authority. Routine tuning does not justify a Git commit or semantic
publication. Only a proven reusable learning may later enter a graph-authorized
tracked batch.

## Core and product directionality

The USF profile and ANQR profile have independent versions. The effective
management identity retains:

```text
core profile + core digest
product profile + product digest
core-to-product digest
product-to-core digest
composite digest
```

A core change identifies the product interpretation that may need
re-evaluation. A product change identifies the core contract it is asking to
satisfy. Unrelated movement invalidates neither direction. These are
deterministic currentness digests, not signatures, and GitHub does not own or
calculate them. ANQR remains an overlay; reusable core manifests contain no
ANQR triples.

## Provider population and credentials

“Full provider/model population” means every route currently configured and
every route currently eligible under the exact frozen inputs, not every
catalogue row and not a fixed list copied from historical `.env` files.

Current volatile counts are obtained with `usf models summary`, whose output
binds the exact raw and normalized catalogue digests. The tracked
`config/providers.json` currently declares only Cerebras `gpt-oss-120b` and
Groq `qwen/qwen3.6-27b`. Both adapters are installed. Neither route currently
has trusted account-tier evidence, a live probe or provider-produced semantic
qualification answers, so both remain ineligible and `UNQUALIFIED`.
OpenAI/Codex catalogue presence is not configuration or entitlement; a future
Codex agent adapter must bind its binary/runtime, model, authentication,
tool/skill/rule bundle, sandbox, nested-agent accounting, economics and
qualification.

Hermes consumes the ordinary `doctor`, `models`, `probe` and `route` results.
It never maintains a provider roster. The initial hermetic facade performs no
credential lookup. Future live work must select one exact repository-relative,
ignored owner-only V3 credential file and never fall back to ambient inherited
variables; only the selected route's named variable enters the content-verified
scrubbed provider child. Hermes-Agent receives no copied environment or
independent provider API access.

## Non-serializing process flow

```text
USF derives semantic model and scoped currentness
  -> admits exact required construction evidence
  -> evaluates deterministic construction proof
  -> activates exact bounded realisation permission
  -> derives eligible work and immutable realisation bases
  -> deterministic plan
  |-- independent provider/candidate/check work continues under caps
  |-- optional bounded Hermes assignment uses its own visible slot and budgets
  `-- current proposal may rank unclaimed prompts, roles or cohorts
        |
        `-- timeout/refusal/failure/late/stale => unchanged plan

checked compatible candidates
  -> brief single-writer integration/publication instant
  -> coherent commit checkpoint
  -> optional independent push
```

Hermes never sits between every command or owns the mutation lock. Its own
future model call consumes one accounted slot, but its wait cannot reserve or
block unrelated provider slots. A proposal applies only to still-unclaimed
work and cannot cancel, duplicate or suppress an assignment. GitHub/push and
metrics aggregation hold no provider slot. No chain stage automatically creates
a commit.

## Start/stop without and with Hermes

The deterministic path remains independently usable. On each cycle, ordinary
`usf start` rederives per-work semantic eligibility and realisation bases from
the exact selected profile/manifest, construction evidence/proof and current files through
its selected ceiling. Process readiness may be ready and idle while
proofblocked work is excluded. It does not invent missing contracts, treat
dependency readiness as activation, accept absent evidence or bypass provider
gates:

```sh
./bin/usf start \
  --profile urn:usf:profile:v3-self-host:2 \
  --manifest graph/manifests/self-host-provider.json \
  --through check \
  --instance default

./bin/usf stop --instance default --wait-ms 5000
```

ANQR also remains directly selectable without Hermes:

```sh
./bin/usf start \
  --profile urn:anqr:profile:bau:1 \
  --manifest graph/products/anqr/hermes-manifest.json \
  --through check \
  --instance anqr-bau

./bin/usf stop --instance anqr-bau --wait-ms 5000
```

Any later product follows the same pattern with its own versioned product
overlay. It may additionally define its own operating intent and stable Hermes
configuration; it does not need a different Hermes engine.

After the graph-defined implementation packet is realized, the optional facade
uses its exact tracked default:

```sh
./bin/usf hermes
./bin/usf hermes status
./bin/usf hermes stop --wait-ms 5000
```

The first accepted test may prove these lifecycle/control contracts with the
ordinary local provider evaluator and deterministic fallback only. It does not
prove that Hermes-Agent or a live model ran.

## Skills, batching and BAU

Hermes may propose a skill after repeated measured success or failure. The
candidate must be versioned, digest-bound, narrowly scoped, tested and
independently reviewed. Activation is a later graph-authorized profile change;
the running process cannot install or activate it.

Hermes may propose commit cohorts. USF admits only compatible checked deltas
with current dependencies and a coherent rollback scope. The selected
`through` ceiling remains absolute: at `check`, stop leaves candidates queued
and performs no integration, commit or publication. Routine generated
configuration, prompts, provider responses, metrics and repeated passing checks
stay under `.usf/`.

`BAU` is a versioned operating intent, not a claim of production maturity. The
current ceiling remains `check`; automatic integration and publication are
disabled. Production BAU, complete ANQR, live multi-provider parallelism and
semantic-token reduction remain unproven until exact evidence exists.
