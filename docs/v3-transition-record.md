# V3 authority transition record

Completed 2026-09-01. Branch `v3-authority-transition`, commits `618cb5c` and
`5042cc0`. Not pushed.

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
