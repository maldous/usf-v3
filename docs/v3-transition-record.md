# V3 authority transition record

Classification: USF-PROVENANCE-DOCUMENT. This record accounts for how V3
superseded its predecessors. It describes lineage and transition, not current
runtime architecture, and nothing in V3 reads it at build, test, validation,
realisation or runtime. It names historical locations because the accounting is
the evidence; the containment validation exempts it on that basis and requires
this classification line to be present.

Completed 2026-09-01. Branch `v3-authority-transition`, commits `618cb5c` and
`5042cc0`.

## Legacy authority superseded

`graph/v3-execution.nq` declares `urn:usf:supersession:legacy-provider-account-lane:1`,
superseding on the execution critical path:

- `urn:usf:provider-operation:account-source-protocol:1`
- `urn:usf:provider-operation:account-source-protocol:2`
- `urn:usf:contract:provider-account-tier-receipt:1`

Reason: that lane required a provider-owned non-inference account-tier endpoint.
Neither Groq, Cerebras nor OpenRouter publishes one, so the evidence class it
demanded cannot exist. The v1 verifier was additionally hardwired to OpenRouter
and had no allowed return path at all — all eight returns were denials.

No historical commit, grant, receipt or completion record was recycled,
reinterpreted or re-dated. History remains history. The legacy commands remain
callable for inspection and are outside V3 execution authority.

## Knowledge retained

`docs/v1-v2-lessons.md` carried the Gate 0 semantic-first retention. This
transition adds the operational-convention classification: retained V3
invariants (N-Quads profile, canonical digesting, manifest composition, IRI and
schema conventions, credential containment, confinement expectations,
operator JSON conventions, fail-closed ordering), simplified reimplementations
(economics, route qualification, catalogue, concurrency evidence),
historical-only material, and deletions from the active path.

## New V3 authority identity

- Generation: `urn:usf:authority-generation:v3:1`, foundation `urn:usf:foundation:v3`
- Architecture graph: `graph/v3-execution.nq`, 238 quads, 48 subjects
- Manifest: `graph/manifests/v3-execution.json`, composing 1689 quads total

## Catalogue coverage

models.dev projection, 211 providers and 7488 models at transition time
(212 / 7476 on a fresh refresh). Every model is classified deterministically
through the six-state ladder, ordered independently of catalogue iteration:

| state | count | dominant stop reason |
|---|---|---|
| DISCOVERED | 7117 | `TRANSPORT_ADAPTER_NOT_INSTALLED` (25 of 28 adapter packages absent) |
| AUTHENTICATED | 333 | `ECONOMICS_COST_CLASS_REFUSED` (OpenRouter priced and unknown-price) |
| ROUTABLE | 37 | Groq 15, Cerebras 2, OpenRouter zero-price 21, minus the observed route |
| AVAILABLE | 1 | durable successful invocation record |

## Transports proven

| transport | authentication | status |
|---|---|---|
| `vercel-ai-sdk` | owner-private credential file | Groq and OpenRouter executed |
| `claude-cli` | local agent session | executed; real model identity and session id |
| `codex-cli` | local agent session | authenticates and invokes; refuses `TRANSPORT_USAGE_LIMIT_EXCEEDED`, retry instant Sep 7th 2026 |

Cerebras returns HTTP 402 `payment_required` on an exhausted free trial,
recorded as `PROVIDER_QUOTA_EXHAUSTED_PAYMENT_REQUIRED` with `costIncurred:
false`. OpenRouter priced routes are refused before contact.

## Semantic graph demonstration

`usf graph execute` accepted 4 semantic work units as blank-node-free N-Quads,
routed each across the whole candidate universe, dispatched under bounded
parallelism and returned a 64-quad result graph. Peak concurrency 4, wall clock
9.9 s against 23.8 s summed unit duration — a measured 2.41x overlap. Two
transports carried the batch. Each result asserts `derivedFrom` its unit, the
digest of exactly the quads that asserted it, and the source graph digest.

## Hermes autonomous cycle

`usf hermes run` inspected authority, discovered pending work, derived and ran
its own cycles, merged results into `urn:usf:graph:hermes-state`, and reached
`all-work-terminal` with 7 of 7 units complete across three work graphs.
Hermes selected no provider or model itself.

- Cycle 1: `demo-analysis`, 2 units, `claude-cli`, peak concurrency 2
- Cycle 2: `demo-work`, 4 units, `claude-cli` and `vercel-ai-sdk`, peak 4
- Re-run: `idle-no-pending-work`, 0 cycles, no provider contact
- Injected new work: discovered and executed unprompted, 7/7

Durable evidence: three cycle reports plus `state.nq` (70 quads) under
`.usf/hermes/`, four graph-execution records under `.usf/graph-executions/`.

## Fresh-state reproduction

A clean clone of the branch with no `.usf` directory installed from the frozen
lockfile, refreshed the catalogue from models.dev, classified 7476 models
failing closed with no credentials, loaded the V3 architecture graph and
answered `usf hermes status`. No V1/V2 operational history was replayed.

## Residual backlog, non-blocking

- **Credential rotation required.** `GROQ_API_KEY`, `CEREBRAS_API_KEY` and
  `OPENROUTER_API_KEY` were exposed in session transcript by an assistant error
  and must be rotated before this evidence is treated as production quality.
- Codex CLI cannot return a model result until its subscription limit resets on
  Sep 7th 2026. The transport is complete; only the external quota blocks it.
- 25 of 28 catalogue adapter packages are not installed, holding 7105 models at
  DISCOVERED. Installing more widens the routable universe with no code change.
- Antigravity is not modelled as a transport; the operator has offered a
  system-wide install. Each agent CLI carries its own quota and capability set,
  so it would need its own transport profile rather than reusing another's.
- `trustedAccountTierReceiptAvailable()` in `src/commands/probe.ts` remains a
  hardcoded `false`. That is honest for the superseded probe lane and is not on
  the V3 execution path.
- The change set was not landed through the legacy contribution chain, by
  design: the mission preferred one coherent closing change set over
  reconstructing legacy completion identities.
- Branch is local; nothing pushed.

## Semantic closure: the four remaining gaps, closed

### 1. Semantic work dependencies

`src/graph/work-dependency.ts`. A unit declares `urn:usf:predicate:dependsOn`
edges; the DAG is validated for cycles, self-edges and unknown targets before
anything is scheduled. One state per unit — `ready`, `blocked`, `unreachable`,
`succeeded`, `failed` — is derived from edges plus recorded outcomes and never
stored. A failed dependency makes dependent work transitively `unreachable`.

Proof: workload `A,B → C → E` and `D → F`, 6 units and 4 edges. Hermes derived
3 ready / 3 blocked before execution, then ran cycle 1 = {A,B,D} at peak
concurrency 3 (2.66x overlap), cycle 2 = {C,F}, cycle 3 = {E}, reaching
`all-work-terminal` at 6/6. The schedule was never specified by hand.

### 2. Bounded authority re-check

`src/providers/authority-snapshot.ts`. The snapshot covers exactly the
route-invalidating inputs and excludes observation instants, so a re-observation
cannot refuse a dispatch. Graph execution snapshots authority, derives routes,
then re-reads immediately before every dispatch.

Proof, both directions: appending a `nonClaim` mid-run changed nothing and all
four units completed; changing groq's entitlement mid-run refused the two
not-yet-dispatched units with `AUTHORITY_MOVED:economicAuthorizationDigest`
while the two already dispatched completed. No stale selection executed.

### 3. Bounded atomic semantic transaction

`usf transact`. Propose, derive affected closure, validate the whole resulting
corpus, apply every path together or none, emit evidence. Identity is the digest
of the transaction's own content; no construction grant, publication object or
intermediate persistent identity exists, and Git carries bytes rather than
identity.

Fail-closed proofs: `TRANSACT_STALE_PREIMAGE`, `TRANSACT_UNDECLARED_EFFECT`,
`TRANSACT_UNAUTHORIZED_PATH`, `TRANSACT_GRAPH_INVALID`,
`TRANSACT_INTEGRITY_VIOLATION`.

Four real transactions were applied through it, including a three-path atomic
change across `graph/v3-execution.nq`, `graph/v3-convention.nq` and
`config/execution-economics.json`. The nine historical works keep their outcomes
as history and were not re-run.

### 4. Graph-derived economics

`src/providers/economics-projection.ts`. The graph carries the policy and its
authorizations including evidence and source documentation;
`config/execution-economics.json` is derived deterministically and stamped with
the digest of exactly the quads that produced it. The runtime consumes the
projection only after proving correspondence.

Proof: hand-adding an authorization to the projection was refused with
`ECONOMICS_PROJECTION_DIVERGED`. Withdrawing `subscription-included` from the
graph through a transaction left the CLI transports authenticated but
economically ineligible, and every attempt went to `vercel-ai-sdk`. Restoring it
through the same mechanism returned a byte-equivalent projection.

### Combined state

- `usf graph integrity`: 12 invariants, 13595 quads, 0 violations in V3-owned
  graphs, 24 recorded legacy items.
- Tests: 195 unit, 34 contract, `tsc` clean, containment `pass`.
- Hermes: 10 units across 2 work graphs, 3 self-derived cycles, dependency
  ordering respected, two transports, one stable authority snapshot across every
  dispatch, `all-work-terminal`; re-run `idle-no-pending-work` with 0 cycles.
- Fresh clone: `usf init` rc=0, catalogue refresh, integrity conforming,
  dependency derivation and a validated transaction all from tracked authority.

## Historical runtime plane retired — 2026-09-03

V3 was already hermetic against everything below: the containment validation
passed before the retirement, no tracked runtime-bearing file named any of these
paths, and the three facet verdict digests were byte-identical before and after.
This section is transition accounting, not a dependency record. Nothing here was
ever a V3 dependency; it was the surviving V1/V2 operational plane running
beside V3 on the same host.

### What was running

| Unit | Bound to | Disposition |
|---|---|---|
| `actions.runner.maldous-usf.usf-linux-x64-controller-01` | GitHub `maldous/usf` (V1) | deregistered, stopped, disabled, removed |
| `actions.runner.maldous-usf-graph.usf-factory-host-20260723` | GitHub `maldous/usf-graph` (V2) | deregistered, stopped, disabled, removed |
| `usf-proof-cockpit.service` | `/opt/usf/staging-proof-cockpit`, `USF_DEPLOYMENT_ID=pr-242-self-hosted-preview` | stopped, disabled, removed |
| `usf-runner-watchdog.timer` / `.service` | runner listener healing | stopped, disabled, removed |
| `usf-graph-ownership.socket` / `@.service` | V2 graph ownership diagnostic | stopped, disabled, removed |
| `usf-graph-runtime.socket` / `@.service` | V2 graph runtime reconciliation | stopped, disabled, removed |
| `usf-graph-validation-mcp.socket` / `@.service` | V2 graph validation MCP | stopped, disabled, removed |
| `usf-semantic-mcp.socket` / `@.service` | V2 semantic MCP, query-only | stopped, disabled, removed |
| `usf-operator-broker.service` (user) | `/usr/local/lib/usf-operator/current` | stopped; unit file was already absent |
| `usf-operator-health.timer` / `.service` (user) | V2 operator health snapshot | stopped; unit files were already absent |

The two GitHub runners were deregistered through the API before removal, so no
offline registration is left behind: both repositories now report zero
self-hosted runners. `usf-v3` has no `.github` directory and never had a
workflow, so no V3 CI depended on either runner.

### What was removed from the filesystem

| Path | Bytes | What it was |
|---|---|---|
| `/opt/usf` | 1 065 431 669 | V2 staging proof cockpit deployment |
| `/opt/usf-github-runner` | 1 362 694 820 | V1 runner installation |
| `/opt/usf-graph-github-runner` | 1 462 786 112 | V2 runner installation |
| `/opt/stardog` | 510 074 525 | Stardog install; V2 authority topology, explicitly rejected by V3 |
| `/usr/local/lib/usf-operator` | 15 682 172 | V2 operator release tree, the broker's `current` symlink target |
| `/var/lib/usf-github-runner` | 3 703 535 746 | V1 runner work folder |
| `/var/lib/usf-graph-github-runner` | 949 684 120 | V2 runner work folder |

Total 9 069 889 164 bytes. Also cleared: 100 `/tmp/usf-cache-*` temporary
extraction directories, the cockpit's systemd private tmp tree, and the loose
V1-extraction and ANQR-query scratch files under `/tmp`.

### What was deliberately left

- **The historical checkouts under the operator's backup area.** They are
  convenience copies of material whose durable location is GitHub, and V3
  requires none of them. See the availability table in
  `docs/historical-inventory.md`.
- **`~/.local/share/usf-operator`** (6.2 MB, inert). It is the evidence path the
  Gate 0 inventory names for the V2 operator, it is not a Git repository and has
  no remote, and nothing executes from it now that the broker is stopped.
  Removing it would destroy the only copy of an inventoried evidence path to no
  containment benefit.
- **`~/.local/share/usf-proof-cockpit`** (empty). Retained so the inventory's
  "resolved as vacuous" finding stays reproducible.
- **The `ods-*` container stack**, including `ods-hermes`. It is the operator's
  own AI-ops infrastructure, unrelated to USF V1/V2, and V3's `usf hermes` is an
  unrelated in-repository command that shares only the name.

### Ambient environment

`STARDOG_SERVER`, `STARDOG_TOKEN`, `STARDOG_PASSWORD`, `STARDOG_DATABASE`,
`STARDOG_USERNAME` and `LINEAR_USF_KEY` are present in the session environment
and `/opt/stardog/bin` was on `PATH`. None is set by any shell profile,
`/etc/environment`, pam, or systemd user environment in this host; they are
injected by the session launcher. V3 reads none of them: `STARDOG_*` appears in
tracked content only as credential *names* in the historical denominator
`config/provider-legacy-observations.json`, where every row is recorded as
excluded and unqualified, and as one comment in `src/graph/integrity.ts`
describing what V3 replaced. No V3 code path reads a `STARDOG_*` value.
