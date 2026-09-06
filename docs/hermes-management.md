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
  --profile urn:usf:profile:v3-self-host-hermes:1 \
  --selector urn:usf:work:hermes-management-facade \
  --max-items 10 \
  --manifest graph/manifests/self-host-hermes.json

./bin/usf work \
  --profile urn:anqr:profile:hermes-bau:1 \
  --max-items 20 \
  --manifest graph/products/anqr/hermes-manifest.json

./bin/usf work \
  --profile urn:anqr:profile:hermes-bau:1 \
  --selector urn:usf:work:hermes-bau-binding \
  --max-items 10 \
  --manifest graph/products/anqr/hermes-manifest.json
```

The first packet is product-neutral. The second proves the selected ANQR
management closure; the final exact product packet cannot be derived from the
core-only manifest.

## Linear-bound interim procedure

The current bridge follows one bounded sequence: governed semantic authoring,
`usf linear-binding prepare --manifest PATH --binding IRI`,
`usf hermes run --binding IRI --env-file PATH`, candidate acceptance through
validation/integration/completion, and
`usf linear-binding settle --manifest PATH --binding IRI --evidence sha256:<64hex>`,
followed by a separate evidence-linked Linear update. The source binding
manifest and the target work manifest are distinct: the binding graph selects
the target through `authority.targetManifest`.

The selected run discovers the source binding manifest from native graph
metadata, rederives the current unit identity, and dispatches only the exact
current `unitPath` and `unitIri`. Stale prepared projections for an earlier
scope remain untouched and are excluded; a missing or duplicate current match
fails closed without falling back to other native work. This may execute an
explicit bounded acceptance transport probe, but it does not establish product
completion.

The bridge does not poll Linear, select or fabricate caller work, contact a
provider while observing status or settling saved evidence, update an issue, or
prove completion itself. Preparation and selected dispatch create no new
permission: Hermes accepts only the already-materialised native one-unit graph,
rederives its current binding before provider contact, and correlates a
successful native result using the graph execution evidence digest.

After an interruption, recover the saved native result from
`.usf/graph-executions/<digest>.json` and run `linear-binding settle` with the
same source manifest, binding IRI, and evidence digest. Settlement authenticates
the saved graph and evidence, recovers the matching STARTED or UNKNOWN attempt,
and never redispatches provider work. Repeating the exact settlement is
idempotent and may repair its partial issue-level record; a different digest or
mismatched binding, attempt, intent, or basis is refused. Use `linear-binding
status` independently to observe the attempt. Settlement, status, and any
subsequent Linear update remain separate from proof.

## Operational stewardship and the current CLI

The operator or its authorised Codex/Claude session uses the current CLI; this
page is guidance, and the selected graph contract remains authority.
`graph/manifests/operational-stewardship.json` selects the independent USF
operational stewardship contract. It does not select ANQR work or change any
product requirement.

An agent maintains one opaque `USF_STEWARD_SESSION_ID` in its environment. The
CLI retains its digest, the controlling parent process fingerprint, a claim
generation and a boot-monotonic renewal deadline. It never records the raw
session identity. Successful claim returns the identity the agent supplies as
`USF_STEWARD_CLAIM_ID` together with `USF_STEWARD_GENERATION` when invoking guarded control operations.

```text
usf hermes steward claim --agent LABEL [--seconds N]
usf hermes steward status
usf hermes steward renew --claim DIGEST --generation DIGEST [--seconds N]
usf hermes steward handoff --claim DIGEST --generation DIGEST
usf hermes steward recover --agent LABEL [--seconds N]
usf hermes steward release --claim DIGEST --generation DIGEST
```

Claim replay by the same live controlling session preserves the generation.
Another live session refuses. Handoff makes transfer available only at a safe
boundary; the incoming claim supersedes the outgoing generation. Dead or expired
ownership requires explicit recovery. A pending transaction must be resolved
through `usf transact --recover DIGEST` (with the owning repository/manifest
where applicable) before stewardship transfer; another live owner still blocks
that recovery. Unknown bytes or unsafe records refuse recovery.

Release leaves Hermes running. Renewal time limits operating liveness only;
semantic work identity, evidence currentness and provider qualification remain
bound to their existing semantic identities. A claim is distinct from supervisor
ownership, semantic work ownership, Linear assignment and integration authority.

```text
usf hermes start [--manifest PATH] [--env-file PATH] [--pause-seconds N] [--concurrency N] [--limit N]
usf hermes status
usf hermes stop [--wait-ms N]
```

Start, stop, run and applying the implementation/realisation lanes require a
current stewardship claim. Supervisor admission owns one kernel lifetime lock;
cycles and manual operations share activity exclusion. Primary publication and
integration retain the existing primary mutation lock. Independent candidate
construction does not acquire primary integration authority.

Stop requests an orderly cycle boundary. If the wait expires, it reports
`HERMES_DRAIN_PENDING` and preserves the process, stop request and in-flight
transaction; it does not escalate to killing a transaction. Successful stop
preserves semantic results and evidence. Normal handoffs need no stop or restart.
A previously running supervisor that imported unguarded handlers must be drained
and upgraded before the new guards apply; changing source bytes cannot patch a
live JavaScript module instance.

Supervisor status is a read-only observation of exact process identity and the
last cycle projection. Steward status separately describes claim liveness and
activity availability; unknown lock state remains unknown. A cached empty
transaction list is not proof that no transaction is active. `ready=0` is only
the selected profile's current frontier, not whole-programme completion.

`usf hermes supervise` is an internal child entry admitted by `hermes start`;
direct invocation without its exact current start admission refuses. The child
cannot run a cycle until its current steward has bound its process identity.
`usf start/watch/stop` retain their separate foreground composer contracts;
`usf stop --instance hermes-bau` does not target the business-as-usual supervisor
merely because it has a similar name. Bare `usf hermes` is not an implemented
management invocation; follow `usf hermes --help` and
`usf hermes steward --help` for the registered surface.

A future takeover reads Linear priorities and issue continuation, verifies local
source/semantic identities and runtime state, claims or safely recovers
stewardship, resumes existing valid work, then selects the next ready issue.
The Linear binding and interrupted-session exercise have their own acceptance
in USF-1162 and USF-1163. Ticket prose cannot dispatch work, prove completion or
act as a concurrency lock. Cross-session review scheduling remains separately
tracked in USF-1178; a session's parallel reviewer is not a persistent service.

The following configuration and management material describes the existing
profile-bound composer/management contract. Its intended effects must be checked
against current CLI availability before use; it is not an alternate lifecycle
or permission source.

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

## Dispatch accounting

The implementation and lifecycle result projections distinguish these counts:

| Field | Meaning |
|---|---|
| plannedUnits | Units selected for the wave, including reused units |
| eligibleUnits | Non-reused units with an eligible graph route |
| attemptedUnits | Units with at least one recorded preflight or invocation attempt |
| contactedUnits / contactedAttempts | Distinct units / attempts that entered a local CLI or SDK invocation |
| successfulUnits | Units whose invocation returned a successful nonempty result |
| structurallyAcceptedUnits | Successful units whose output passed the structural acceptance step |
| refusedUnits | Planned units ending refused, including structurally rejected output |
| reusedUnits | Units resolved from retained semantic cache without dispatch |

Compatibility aliases are dispatchedUnits=contactedUnits,
modelInvocations=contactedAttempts, cacheHits=reusedUnits and
acceptedResults=structurallyAcceptedUnits+reusedUnits. Planned units partition
into structurally accepted, refused and reused outcomes. A preflight refusal
can count as attempted but never contacted; no eligible route records zero
attempts and zero contacts. A local invocation can refuse before any remote
provider receives it, so these fields do not authenticate remote contact or
count invisible provider-internal HTTP retries.

Graph attempts expose preflight/invocation phase and contact disposition.
Repair records retain parent/work/evidence lineage; the reader accepts the
older repair shape with explicit missingness. Existing requested/actual model,
usage and economic observations keep their own evidence boundaries. Structural
acceptance, cache reuse and a Linear implementation closure do not publish
semantic completion. The provider census still has separate catalogue,
configured, credential, adapter, availability and qualification denominators.

This is an additive result change, with existing command options and schema
identity retained. A running supervisor may retain already imported modules;
source integration alone does not prove that it has executed the new path.
Use fresh dated readback and the ordinary lifecycle controls when an authorised
upgrade is required.

## Provider population and credentials

“Full provider/model population” means every route currently configured and
every route currently eligible under the exact frozen inputs, not every
catalogue row and not a fixed list copied from historical `.env` files.

Use `usf models summary` for frozen catalogue identities and
`usf providers census` for the current no-contact route projection. Follow each
command's installed help and inspect the selected work's requirements before
using those observations. Configuration, account authorisation, subscription
entitlement, availability, task-class qualification and actual route identity
are separate inputs; a catalogue row or an old example establishes none of them.
The implemented subscription-host adapters have their own contained account and
transport boundaries. Current source, policy and authenticated observations
determine whether a route may receive the selected work.

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
gates. The currently installed foreground composer only observes and orders
eligible work: it has no execution adapter. Its own instance lock controls its
lifecycle. Any future executing composer must acquire stewardship for each
bounded wave and keep stop usable; holding activity for an entire foreground
lifetime would prevent orderly stop. USF-1162 owns the missing execution binding.
An observation-only invocation is:

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

For the separate detached Hermes supervisor, inspect `usf hermes status`
and follow the stewardship and `hermes start`/`hermes stop` procedure above.
Bare `usf hermes` currently refuses; it does not launch the optional management
facade. Starting either lifecycle proves process readiness only. Live model
contribution, candidate acceptance and completion require their own evidence.

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

`BAU` is a versioned operating intent, not a claim of production maturity.
The selected command, profile, current permission and automation policy define
its ceiling. The foreground composer's default `check` ceiling does not describe
the detached supervisor's transaction effects. Report live contribution,
integration, semantic completion and deployment only for the exact scope and
evidence observed.
