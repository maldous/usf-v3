# Decision 0007: optional Hermes-Agent autonomous management

## Status

Accepted as graph authority. Runtime realization remains bounded by
the product-neutral `urn:usf:work:hermes-management-facade` and the isolated
`urn:usf:work:hermes-bau-binding` ANQR packet.

## Context

USF must run unattended outside a conversational agent and may benefit from
Hermes-Agent for prompt/context optimization, agent-role selection, review and
repair fanout, integration-cohort proposals and reusable skill candidates.
Historical Hermes also carried workflow state, credentials, daemon topology and
coordination ceremony. Reintroducing that topology would duplicate V3's
foreground composer, serialize provider work and recreate the repair loop that
V3 deliberately removed.

The V3 provider catalogue can be broad while operational admission remains
narrow. Catalogue membership, installed adapters and credential-name presence
are not availability; volatile counts belong in a digest-bound observation,
not this durable decision.

USF core and ANQR also evolve independently. A management configuration must
bind both axes without copying ANQR triples into the reusable core or turning a
global graph/Git revision into a reproof barrier.

## Decision

`usf hermes` is an optional facade over the existing USF CLI and exact
foreground composer. Bare invocation resolves one closed tracked default BAU
intent. `start`, `status`, `stop` and `doctor` are bounded subcommands. Missing,
invalid or ambiguous intent refuses before external contact.

The reusable core capability and product-neutral facade packet live in
`graph/hermes-management.nq`. The exact ANQR operating intent,
`urn:anqr:intent:hermes-bau:1`, product profile,
`urn:anqr:profile:hermes-bau:1`, and ANQR binding packet live only in the ANQR
overlay selected by `graph/products/anqr/hermes-manifest.json`. The combined
manifest makes both axes query-verifiable without adding product triples to the
core manifest. A core-only selector cannot authorize ANQR binding.

The facade:

- reuses the existing instance lock, JSONL readiness, stop intent, bounded
  drain, signal handling and restart-by-rescan path;
- binds exact versioned USF and ANQR profiles/manifests plus directional and
  composite content digests;
- consumes the same provider configuration, policy, catalogue, availability,
  qualification, routing and host/provider caps as ordinary USF commands;
- considers all configured routes and all current eligible routes dynamically,
  with complete assigned, excluded and eligible-unassigned dispositions;
- gives Hermes-Agent no provider roster, whole environment, credential store,
  provider home, mutation lock, semantic authority or independent invocation
  path;
- performs no credential lookup in the initial lane. Future live work names one
  exact repository-relative ignored owner-only credential file, never falls
  back to ambient variables, and releases only the selected route's allowlisted
  variable through the content-verified scrubbed provider child;
- runs optimization asynchronously and falls back to the unchanged
  deterministic plan on absence, timeout, refusal or failure. A future Hermes
  call consumes its own visible assignment, slot and budgets, cannot reserve
  unrelated slots, and returns only a ranking proposal bound to the exact base
  plan, ready set, scoped dependencies, prompts, context, output, tools, skill
  bundle and optimizer runtime. Late, stale or mismatched advice is ignored and
  cannot cancel, duplicate or suppress claimed work;
- tracks one stable policy envelope but writes resolved AI-tuned instance
  configuration atomically owner-only beneath ignored
  `.usf/runs/hermes/<digest>`. Status/restart rederive it from authority and do
  not trust ignored state as a scheduler;
- treats prompt plans, batch proposals and generated skills as non-authoritative
  candidates. Skills require versioning, scope, tests, independent review and a
  later graph-authorized activation boundary;
- may propose coherent integration or publication cohorts but never decides
  admission, mutates primary source or holds the `primary-mutation` lock.

Hermes is neither a scheduler nor a prerequisite. `usf start`, `usf watch` and
`usf stop` remain sufficient for USF, ANQR and any later product when given the
exact selected profile/manifest. A different product may define a different
versioned operating intent and stable Hermes configuration without requiring a
different engine. Ordinary `usf stop --instance NAME` targets a Hermes
lifecycle instance through the same protocol.

## Provider gate order

No management mode changes this order:

1. acquire a trusted exact-account tier receipt;
2. execute the maintained adapter in a content-verified scrubbed child that
   receives only the selected credential variable and bounded public input;
3. acquire authenticated provider-produced semantic qualification answers;
4. perform genuine task/profile hidden-holdout qualification;
5. enable live calls and unattended composition;
6. demonstrate live multi-provider parallelism or semantic-token reduction
   only from accepted lineage.

The first implementation is therefore a hermetic control-plane slice. It may
start and stop both lifecycle modes, validate the USF-plus-ANQR configuration,
and reuse the ordinary provider census/evaluator. It cannot run a live
Hermes-Agent/provider lane or call that BAU production-ready.

This optional facade is an independent lane, never a prerequisite for trusted
receipt acquisition, scrubbed adapters, authenticated qualification answers or
the live composer. Those provider-critical steps may and should progress
without waiting for Hermes realization.

## Commit and test economics

Semantic-chain boundaries do not imply commits. A compatible batch requires
checked candidates, fresh scoped dependencies, compatible write sets and
validation boundaries, no unresolved blocker and one coherent rollback unit.
Every flush remains bounded by the selected `through` ceiling and tracked
automation policy. At `check`, stop leaves candidates queued and performs no
integration, commit or publication. At a separately authorized higher ceiling,
flush on coherent-unit closure, risk/diff/age ceiling, explicit checkpoint or
stop drain. There is no minimum batch size and no prompt-, triple- or
stage-level commit.

Tests extend the existing table-driven provider, product-overlay and lifecycle
fixtures. Add only the config/command refusals and one real Hermes
start/status/ordinary-stop process boundary. Live provider and Hermes-Agent
execution stay in explicit non-default lanes. Docker, GitHub, remote runners,
CAS and provider credentials remain outside the default gate.

## Consequences and nonclaims

Hermes can be net-positive only when measured accepted value or useful-token
yield improves without worsening queue latency, mutation-lock duration,
provider utilization or failure isolation. Otherwise the deterministic path is
the correct path.

A lifecycle-ready record is not evidence that Hermes-Agent ran, that a provider
was contacted, that ANQR changed, or that tokens were reduced. This decision
does not establish live provider eligibility, hidden-holdout qualification,
live parallelism, full ANQR, staging, production, production BAU or terminal
proof.
