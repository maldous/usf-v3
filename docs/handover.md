# USF V3 handover

## Authority boundary 2026-09-03 — product events are stated, not only narrated

`urn:usf:product-event-vocabulary:v1:1` declares the canonical product events
the delivery facets already named in prose, so an event the corpus asserts is
also a resource. Transaction `sha256:5a83494e…`, 26 quads, corpus 25 865.

The verified defect: no event subject was declared in **any** graph file, while
two facets name canonical product events in their `facetStatement` text, and the
event substrate types an event as a free-form `eventType: string`. So the corpus
asserted events it did not state, and nothing constrained an undeclared one.

Declared from facet evidence only:

- `report.run`, payload key `reportId`, delivery guarantee at-least-once,
  carried by the event-bus capability and **produced by**
  `scheduledjobsbuiltinontheeventsubstrate`. The producer is stated because that
  facet says a due tick enqueues a platform event and names `report.run` as its
  example.
- `tenant.config.changed`, payload key `key`, delivery guarantee at-least-once,
  carried by the event-bus capability, **producer deliberately left unstated**
  with a reason. The facet names it as a canonical product event with a strict
  versioned payload contract but names no producer, and binding it to the
  event-bus capability would confuse the substrate that carries an event with
  the capability that emits it.

The vocabulary declares itself **open**, with a completeness rule saying so: it
is not a claim that these are the product's only events, and it constrains
nothing yet, because the substrate still accepts an undeclared event. Closing it
means deciding the product event set and binding each event to its producer,
which is a product decision rather than a derivation — the same boundary the
statement of applicability draws around its 45 undecided controls.

This partially addresses the `event-vocabulary` remainder, whose verdict stays
`SURVIVING_INVARIANT_REQUIRES_MECHANISM`. The delivery-guarantee half now has a
predicate and two instances; the closed-vocabulary and full producer-binding
half does not.

Blast radius measured in a clone lane at `ca14e5c` before applying, not assumed:
this change adds a quad whose subject is the **existing** remainder resource, so
it is not purely additive. All eight profile projections were byte-identical and
the facet verdict digest unchanged. 407/407 tests, gate conforming.

## Authority boundary 2026-09-03 — write authority is a registered projection

`usf status` now carries a `writeAuthority` projection, registered as
`urn:usf:status-projection:write-authority:1`. It closes the first of the two
CLI gaps recorded below: nothing answered "who may write path X, by which
mechanism", and resolving it by hand across `permitsWrite`, `writePath` and
`authorizedPathPrefix` produced a confident wrong four-part authority plan
earlier in this session.

It states both mechanisms side by side, because they authorize differently: a
semantic transaction matches the declared prefix set, so any path under one is
writable by `usf transact` whatever the ownership rows say, while contract
`permitsWrite` and work `writePath` govern only the staged contribution chain.
Each declared staged path reports its owning contracts and works and whether a
transaction prefix also covers it, and every prefix with no staged owner is
named. An authority outside the selected manifest closure reports
`declared: false` with a note, because an unqualified empty prefix list reads as
"nothing is transactable" — the exact confusion the projection exists to remove.

Two things worth carrying forward from building it:

- **I applied a graph registration without measuring it first**, on the reasoning
  that it was trivially additive, and then misdiagnosed the resulting red gate as
  that change staling a packet. It had not: the failure was my own new test.
  Measure before applying even when the change looks free, and bisect before
  attributing.
- The failing test was `CHECK_FAILED` inside the confined lane while passing
  outside it. `src/commands/status.ts` statically imports `node:child_process`,
  which the cage denies, so every sibling test in that file opens with
  `if (childProcessUnavailable(t)) return;` before its dynamic import. Mine did
  not. That guard is the file's convention, not an optional nicety.

`src/commands/status.ts` is a `writePath` of `urn:usf:work:operator-observability`,
so unlike the unowned runtime readers changed at `10379e2` this file does have a
staged-chain owner. Read back after the edit, the provider lane is unchanged at
3 verified-complete and 6 blocked, with `operator-observability` already among
the blocked six from the realisation run. No new staleness was introduced.

407/407 tests, gate conforming, corpus 25 839 quads.

### The staleness projection was attempted and withdrawn

The second recorded CLI gap — `transact --dry-run` reporting `conforming: true`
while saying nothing about staleness — is **not** closed. An implementation was
built (stage the postimages into a throwaway `graph/` tree, re-derive per
profile, diff) and then removed, because it was wrong four separate ways and
each looked correct until tested against an independently measured case:

1. Comparing the profile `semanticDigest` misses the documented trap entirely.
   Widening a shared contract moves `coreToProductDigest` while leaving the
   profile and product digests untouched, so the projection reported "nothing
   moved" for exactly the change known to stale a cohort.
2. A `catch` around the derivation turned every failure into a silent empty
   result that read as "nothing moved".
3. Reading a manifest's own `sources` rather than the expanded `sources` set
   under-reported every transitively affected manifest.
4. `deriveWork` refuses `maxItems` above 100, so an out-of-range bound yielded
   zero packets — invisibly, because of (2).

After all four were fixed it then **over**-reported: it flagged as staling a
delivery-lane append that had been measured twice in a clone lane as byte-identical
across all eight profiles. A staged tree containing only `graph/` is evidently
not equivalent to the repository for digest purposes.

A staleness projection that can be wrong in either direction is worse than
none — a false negative licenses an unmeasured cohort-staling change and a
false positive makes operators abandon safe ones — so it was withdrawn rather
than shipped green. Until one is validated against several independently
measured cases in both directions, measure in a disposable clone. `drift`
(planned) remains the registered home.

## Authority boundary 2026-09-03 — governance captured, every remainder assessed

The statement of applicability is realised and all six capture remainders now
carry a verdict. `apps/platform/assurance/statement-of-applicability.json`
exists, 49 KB, derived by a deterministic generator with **zero model
invocations**.

Operator input that unblocked it: **ISO 27001 prepared, but not certified.**
That is a real posture, and clause 6.1.3(d) requires an SoA during preparation,
so producing one in prepared state is not fabrication. What would be false is
presenting it as complete or certified, and the artefact says otherwise in six
explicit non-claims including `no-iso-certification-claim` and
`prepared-is-not-certified-no-certification-audit-has-occurred`.

The earlier refusal — "a truthful statement cannot be derived" — was correct
while nothing stated the control set. It no longer holds:

- **Captured** from the pinned V1 sources under the Apache-2.0
  reviewed-re-expression boundary: the complete ISO/IEC 27001:2022 Annex A set
  of 93 controls from `bak/usf/graph/assurance/enterprise.trig` at `028a9f96`,
  joined to the 48 decisions the V1 alignment artefact had actually made, which
  also supplied the control titles the assurance graph alone did not hold. 1 122
  quads, transaction `sha256:29d1647a…`.
- **Nothing was invented.** 48 controls carry a decided applicability (43
  applicable, 5 not applicable) with rationale, evidence classification and
  decision basis. The remaining **45 stay `pending-assessment`** with an explicit
  basis recording that no assessment ever decided them, and no fabricated title
  or evidence. A statement that could not distinguish undecided from excluded
  would be the compliance artefact this refusal existed to prevent.
- The artefact reports its own completeness — declared 93, decided 48, pending
  45 — rather than implying it.

Mechanism: `realizationMechanism` moved `BLOCKED_ON_AUTHORITY` →
`DETERMINISTIC_GENERATOR`. That is a functional predicate, so this is the one
change in the session that required `write-file` rather than append; the
postimage was generated programmatically with exact-line removal that fails
loudly on drift, and removed exactly the 8 intended lines and no others. The
`assurance` generator is implemented in `src/providers/delivery-generators.ts`
and registered; the registry comment claiming the assurance family was legacy
ceremony is corrected, since its own assessment classifies it
`PRODUCT_DELIVERABLE`.

**`event-vocabulary` is resolved as PARTIAL**, verdict
`SURVIVING_INVARIANT_REQUIRES_MECHANISM`. V1 modelled the same occurrence twice,
as a bus-delivered domain event and as an audit record, and 45 of its 50
domain-event names also exist as audit-event names. V3 carries that half under
`auditmodel`: 52 exported audit-event-kind constants yielding 147 distinct
kinds, 67 `auditmodel` facetStatements, audit assertions in all 64 conformance
suites. What has **no** V3 mechanism is the delivery contract — a per-event
guarantee (all 50 V1 events declared at-least-once; V3 declares no
delivery-guarantee predicate at all) and a producer binding over a closed
vocabulary (V3 types an event as a free-form string and the graph names
canonical product events in facet prose without declaring them). The gap is
real but far narrower than `declarationCount "50"` implies: only 5 of the 50
names have no V3 counterpart of any kind, and V2 had grown the vocabulary to
60, so this is a V1-to-V3 discontinuity rather than a deprecation.

All six verdicts now read: assurance-content, realisation-bindings,
state-machine-content and validator-rules superseded; event-vocabulary requires
a mechanism; governance-content not yet satisfied, pending 45 decisions.

Verification: 406/406 tests, gate conforming (24 legacy against a constant of
24, 0 owned), corpus 24 697 → 25 831 quads. Blast radius measured in a lane at
`10379e2` before applying — all eight profile projections and the facet verdict
digest byte-identical, even though the governance capture removes quads from a
subject the artefact set references. Facet **states** are unchanged after
realisation (670 facets, 575 SATISFIED, UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED
all 0, 64 capabilities fully satisfied); the realise-lane verdict digest moved
`sha256:92a7e6a4…` → `sha256:1ffb9646…` because that digest binds the corpus
that produced the verdicts and the corpus grew. Satisfaction did not change;
identity did.

Remaining, and genuinely not derivable: deciding the 45 pending controls is
governance judgement. It cannot come from facet evidence, and no model should
supply it.

## Authority boundary 2026-09-03 — capture remainders assessed

One bounded semantic transaction landed against `graph/v3-delivery.nq`,
committed at `14f5778`. It is purely additive: 50 quads, 0 deletions.

- Proposal `sha256:1903fd34…`, transaction `sha256:8dfd6c89…`,
  preimage `sha256:c8d96b37…` → postimage `sha256:e1d73f40…`. Corpus
  24 640 → 24 690 quads, `ownedGraphViolationCount` 0, `conforming: true`.
- **Measured zero blast radius** before applying. A standalone `--no-hardlinks`
  clone detached at `f330c15`, bootstrapped offline, reproduced the recorded
  provider-lane digest `sha256:aea7ac1b…` and the
  `WORK_DEPENDENCY_MISSING:config/semantic-recovery-inventory.json` refusal.
  Eight profile/manifest `usf work` projections were **byte-identical** before
  and after, and the lane's facet verdict digest was unchanged. After applying
  to the primary, the realise-lane facet verdict digest reads
  `sha256:92a7e6a4…`, identical to its pre-change value, with 575 SATISFIED and
  UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED all 0.

What it records: four of the six V1 capture remainders — state-machine-content,
assurance-content, validator-rules and realisation-bindings, **846 of the 1 082
enumerated declarations** — guard invariants V3 satisfies by a different
mechanism, namely executed behavioural conformance subtests and graph-derived
module paths rather than carried V1 declarations. Each now carries a
`MechanismAssessmentItem` with verdict `INVARIANT_RETAINED_MECHANISM_SUPERSEDED`,
the same idiom already used for `spec-validation-workflow` and
`validator-manifest`. Their `captureStatus "not-captured"` was deliberately left
in place: it is a true statement about V1's declarations, and only its reading as
a work backlog was wrong.

Two corrections to earlier analysis in this session, both evidenced:

- An earlier claim that the statement-of-applicability blocker **misattributed**
  its input to V1 was **wrong and is retracted**. V1 defines the classes itself
  (`bak/usf/graph/ontology.ttl:1335-1341`) and holds exactly 93
  `usf:FrameworkControl` and 93 `usf:ApplicabilityDecision` instances in
  `bak/usf/graph/assurance/enterprise.trig` at the pinned recovery revision
  `028a9f96`. The blocker text is accurate as written. The error came from
  reading the disposition ledger's `generation: "v2"` as V2-only; the ledger
  records where a concept was encoded for disposition, and V2 separately reused
  the name `ApplicabilityDecision` for the ANQR route-credibility ceremony,
  which is the collision the OBSOLETE disposition describes.
- `.usf/hermes/candidate-failures.json` is last-failure-per-capability history
  and is never cleared on success. Its nine entries were read as live blockers;
  both lane derivations report `readyFrontier: 0`, `repairExhausted: 0` and all
  64 capabilities fully satisfied. Derive the frontier from
  `hermes implement`/`hermes realise`, never from that file.

New evidence on the governance remainder, recorded as
`mechanism-assessment-item:governance-capture-feasibility` (verdict unchanged at
`SURVIVING_INVARIANT_NOT_YET_SATISFIED`): the V1 layer names ISO/IEC 27001:2022
Annex A and carries the complete 93-control set, licensed for reviewed
re-expression, so capture is mechanically feasible. But all 93 applicability
decisions hold the identical `pendingassessment` status with one boilerplate
rationale under a `draft` statement of applicability, the controls carry no
titles anywhere on disk, and the only decided applicability — 43 applicable, 5
not applicable, with per-control justification — covers 48 of 93 in a separate
`alignmentOnly` artefact that disclaims completeness. Capture would convert an
absent control set into an undecided one.

## Authority boundary 2026-09-03 — the integrity gate conforms

The `gateConforming: false` condition recorded at the housekeeping boundary is
resolved. The gate now reads **`legacyGraphViolationCount` 24 against
`acceptedLegacyDebtCount` 24, `ownedGraphViolationCount` 0,
`gateConforming: true`, `scopeFromGraphAuthority: true`** — and the debt constant
was **not** raised. It is now simply truthful.

Operator directive: declare the arity in the graph, rather than raise the debt
constant, exempt the predicate in code, or remodel the declarations. The 27
violations were 24 `multiple-type-declaration` plus exactly 3
`functional-predicate-conflict`, the three being the host-CLI transports
(`antigravity-cli`, `codex-cli`, `claude-cli`) that declare several models each.
Those several values are intended state: one candidate per declared model, so a
single exhausted quota cannot remove a whole subscription from the pool. Raising
the constant would have recorded a measured routing correction as legacy debt.

Landed in two halves, since a graph-declared scope is inert until the runtime
reads it:

- **Graph half** — one bounded transaction appending a `functionalPredicate` set
  plus its rule and exclusion reason to `urn:usf:integrity-scope:corpus:1` in
  `graph/v3-convention.nq`, deliberately omitting `selectedModel`. 7 quads,
  transaction `sha256:700c16db…`, corpus 24 690 → 24 697. That subject is
  referenced by nothing as an object, so it sits outside every resource closure;
  measured in a lane at `14f5778`, all eight profile projections were
  byte-identical even though `v3-convention.nq` is upstream of both the delivery
  and ANQR manifests.
- **Code half** — `readRuntimeAuthority` now reads `functionalPredicate`,
  `IntegrityOptions` carries the declared set, and `checkIntegrity` prefers it
  over its compiled constant, threaded through both consumers
  (`graph-integrity.ts` and `transact.ts`). The compiled list is retained and
  redocumented as the fallback for a corpus that has not declared its own,
  matching the existing `derivedOnlyTypes` shape.

No write-owner primitive was created, and the earlier plan for one is withdrawn.
Those three files are runtime readers, and the transaction authority states
plainly that "source code is not semantic authority and is deliberately
excluded: the runtime reads authority, it is not authority." Modelling a runtime
reader as owned semantic authority would contradict that; the gate for changing
one is the check suite, not a graph grant.

Verification: typecheck clean, **406/406 tests pass** (404 plus two new), and the
new coverage is planted-defect proven — reverting the one-line wiring at the
check site fails exactly one test. Both facet verdict digests are **unchanged**
across the whole boundary, `sha256:92a7e6a4…` for the realise lane and
`sha256:e958768a…` for implement, with 575 SATISFIED and
UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED all 0 and 64 capabilities fully
satisfied. `readRuntimeAuthority` had no test coverage at all before this; it
now has the reciprocal case.

Next safe actions, in order of independence:

1. **`event-vocabulary` (50 declared domain events) is unaccounted.** None of the
   ten facet kinds covers domain events. It is the only remainder neither
   superseded nor evidenced as a real gap; it needs a decision, not an assertion.
2. **The statement of applicability needs governance judgement**, not model work:
   deciding 45 undecided controls and reconciling the 48 already assessed.

Recorded CLI observability gaps, both from this session:

- `transact --dry-run` reports `conforming: true`, which is **not** a staleness
  answer — it validates the resulting corpus and is silent on whether any
  completion goes stale. Answering that by hand required a clone, the hermetic
  inputs and a profile-set loop, which is exactly the ad hoc harness that must
  not become the operator interface. `transact` already holds every postimage in
  memory and needs no clone; `drift` (planned) is the alternative home.
- No registered command answers "who may write path X, by which mechanism".
  Resolving it required grepping `permitsWrite`, `writePath` and
  `authorizedPathPrefix` across every source, and produced one confident wrong
  conclusion first: contract/work ownership governs only the staged contribution
  chain, while `transact` authorizes by prefix and already covers `graph/`.

## Housekeeping boundary 2026-09-03 — release candidate prepared

A post-realisation housekeeping pass prepared the wrap-up boundary below as a
clean, hermetic release baseline. No product behaviour or semantic requirement
changed. What was done, all evidence-backed:

- **Worktrees**: seven leftover detached validation lanes (five
  `/tmp/usf-integration-validation-verify.*`, `.usf/tmp/full-check-46c18cb`,
  `.usf/tmp/integration-validation-verify.8R6PiH`) were removed after proving
  per blob that every byte they held is superseded on the mainline (each lane
  was one synthetic integration-verification commit whose only unique blob was
  an earlier iteration of a file the mainline carries in later form; the one
  dirty edit, a `${originalBinding}\n` replace fix in
  `tests/unit/realisation/workspace.test.ts`, is already at HEAD line 574).
  One canonical worktree remains.
- **Branches**: `recovery/operator-leaf-tsc-failure` deleted; its one commit's
  blobs landed at 349a362 with the removed test block relocated to
  `tests/contract/operator-provider-leaf.test.ts`. `main` is retained and equal
  to `origin/main` (8fa2ef7), the last remote-verified boundary; the release
  line `v3-authority-transition` is 101 commits ahead and unpushed.
- **Refs**: five ad-hoc bookmark refs under `refs/usf/` (authority-restored,
  census-done, fai-done, final, handover-tip) deleted; each pointed at a
  mainline ancestor. The registered `refs/usf/integration/*` refs are retained.
- **Ignored state**: `.usf` pruned from 1.3 GB to ~460 MB — `.usf/tmp` lanes
  and scratch, `.usf/workspaces` (post-integration candidate materialisations,
  rederivable through resolve/apply), a check-debug directory, a stale pnpm
  store-index backup, and the orphaned `.usf/drafts/operator-6076913` (an
  abandoned implementation iteration from the 2026-09-01 tsc-failure recovery,
  referenced by nothing tracked and superseded by the landed, fully verified
  implementation). Retained: `.usf/cache` (hermetic pnpm store),
  `.usf/catalog` (frozen catalogue bytes bound by recorded digests),
  credentials, the repository locator, and all receipt/evidence/observation
  records.
- **ANQR repository**: the final supervisor cycle's post-checkpoint output
  (repaired payloadclassification and qrartefactcreation module/test pairs)
  was checkpointed as `1cf44ce`; the 39/39 verdict binds those exact bytes.
  The repository is clean. (Resolved after the proof: by operator direction it
  now pushes to the new private `github.com/maldous/anqr-v3` — the legacy
  `maldous/anqr` repository holds unrelated pre-V3 history and was left
  untouched.)
- **Interface hygiene**: `scripts/hermes-bau.sh` (superseded external driver
  with a hard-coded machine path; graph-undeclared) removed. README's
  "Current claim" was two boundaries stale and now states the realisation
  boundary, the re-derivation commands and the product-repository locator.

Known conditions recorded, deliberately not repaired here because each is an
authority change, not hygiene:

- The graph integrity gate reads `gateConforming: false`: legacy violations 27
  against a recorded debt constant of 24 (`src/commands/graph-integrity.ts`).
  The three newer entries are multi-valued `selectedModel` declarations on the
  three host-CLI transports — intended state since the multi-model pool work,
  flagged by a single-valued-predicate rule. Deciding between raising the
  recorded debt, exempting the predicate, or remodelling the declaration is a
  semantic decision for a follow-up directive.
- The provider packet lane (`graph/manifests/self-host-provider-v3.json`,
  profile v3-self-host:3, semantic digest `sha256:aea7ac1b…` unchanged) reads
  3 of 9 packets `verified-complete` (repository-path-scope, file-asset-index,
  provider-hidden-holdout) and 6 `blocked` on completion currentness: the
  realisation run's ~100 commits moved bytes inside their scoped closures.
  That is the copy-on-write rule working, not a defect; restoring the cohort
  (stale roots before consumers) is possible follow-up work under the recorded
  recovery pattern.
- `urn:usf:work:semantic-recovery-acceptance` refuses derivation with
  `WORK_DEPENDENCY_MISSING:config/semantic-recovery-inventory.json` — the
  dormant, explicitly incomplete historical recovery lane, unchanged by this
  pass.

### Clean-clone proof (executed 2026-09-03)

Semantic completion is reproducible from tracked bytes, not preserved cache.
A private standalone lane held fresh `--no-hardlinks` clones of both
repositories, usf-v3 detached at `e815080` and anqr at `1cf44ce`, given only
the hermetic inputs a third party would supply: the pnpm store and frozen
catalogue copied beneath `.usf/` (`.usf/cache` kept owner-private 0700), the
`.usf/repositories.json` locator naming `anqr-main: ../anqr`, and an empty
mode-0600 env file. `FORCE_COLOR` was unset throughout. Then, in order:

1. `./scripts/bootstrap.sh` — offline frozen-lockfile install completed in
   747 ms with no network fetch; the frozen catalogue read back the exact
   recorded digests (`raw sha256:9c9be3f3…`, `normalized sha256:f54dc34e…`);
   `usf init` ok; containment check pass.
2. `corepack pnpm run check` — typecheck clean, **404/404 tests, 0 failures**.
3. Evidence regeneration: the lane starts at NOT_ASSESSED 719 because
   conformance evidence is ignored state. Five
   `usf hermes implement --apply` invocations (empty env file, `--limit 1`)
   re-executed **all 103 capability conformance suites inside the cage:
   103/103 executed, 0 failed, 0 units dispatched to any provider**.
4. Facet read-back after regeneration: 64/64, 39/39 and 103/103 with
   UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED all 0, and the three verdict digests
   **byte-identical to the primary's**
   (`sha256:e958768a…`, `sha256:17d52953…`, `sha256:3a9fa0d6…`).
5. The packet-lane read-back reproduced semantic digest `sha256:aea7ac1b…`;
   `usf profile record` regenerated the realisation record and
   `usf profile status` then read `current` with closure digest
   `sha256:5527a1e5…` and no external-fact drift.
6. The lane's working tree remained clean at the exact commit through every
   step. The lane was removed after this record was written; the receipt is
   the evidence, the directory is not.

Declared prerequisites outside the repository, all machine-checked during the
proof: Git, Node.js ≥ 22, Corepack (pnpm 11.24.0 pinned by `packageManager`),
util-linux `flock`, bubblewrap 0.9.0 (graph-declared exact host tool), a POSIX
shell, and — only for a first bootstrap with no provided catalogue — bounded
network access to models.dev. Secrets/runtime configuration:
`.usf/credentials/providers.env` (operator-supplied, owner-only, never
tracked) and the repository locator. Optional pinned historical sources (V1 at
028a9f96, V2 at 2d7eb31) are re-audit inputs only and are not needed for any
build, test, evaluation or realisation step above.

Released 2026-09-03: annotated tag `semantic-realisation-1` identifies
usf-v3 `76b7dfd` and anqr `1cf44ce`, both pushed. `v3-authority-transition`
now tracks `origin/v3-authority-transition`; anqr's `main` tracks the new
private `github.com/maldous/anqr-v3` (operator-directed; the legacy
`maldous/anqr` holds unrelated pre-V3 history and was left untouched).

Next safe action: none required.

## Wrap-up 2026-09-02 — directive complete; supervisor intentionally stopped

The operator directed the supervisor wrapped up and the remainder completed by
hand. Supervisor fb06a4176966fd1029889c7e3 drained cleanly (`usf hermes stop`,
outcome drained) and was deliberately not restarted; the restart command in the
section below remains correct if a future directive needs it.

Completion condition from the boundary below, measured after the work:
implementation-conformance facets read UNSATISFIED 0, NOT_ASSESSED 0, BLOCKED 0,
STALE 0 on `graph/manifests/v3-delivery.json` (64/64 capabilities fully
satisfied), `graph/products/anqr/manifest.json` (39/39, denominator fully
assessed, including qrartefactcreation) and the composed
`graph/manifests/anqr-with-foundation.json` (103/103); remaining work reads 0
in every lane. The realise lane assesses the 27 realized-artefact facets
against real artefacts: NOT_ASSESSED 0 there too.

What closed the tail, in order:

- Host-CLI transport misclassification fixed (commit ff61175): a refused turn
  is classified from the CLI's own report, a subscription/quota limit defers as
  TRANSPORT_USAGE_LIMIT_EXCEEDED with the provider-stated reset, an unknown
  model defers a day as TRANSPORT_MODEL_NOT_ACCEPTED, and attempt records
  retain the redacted refusal detail. The Gemini pool was repaired through one
  conforming transaction (dead gemini-3.1-pro-medium removed,
  gemini-3.8-flash-low declared).
- The last blocker was the regenerated customdomainsdnsownershiptlscanonical
  permissions test asserting both an empty list and PERMISSION_DENIED for
  equally ungranted tenants — unsatisfiable by any tenant-scoped fail-closed
  module; two whole-module repair rounds were spent on it. The facet statement
  decides it: isolation is proven on a granted tenant, fail-closed assertions
  unchanged, suite 9/9 against the incumbent module (transaction applied, then
  checkpoint commit 7d573d6 landed the drained cycle work).
- The standing "19 capabilities with remaining work" was a projection defect,
  not a backlog: the implementation lane reported facets it deliberately loads
  no evidence for as NOT_ASSESSED. An evaluation now declares its loaded
  evidence classes and such facets read OTHER_LANE, excluded from the lane's
  denominator and explicitly not a satisfaction claim (commit e179497). No
  supervisor cycle count would ever have moved those 27; gates on
  NOT_ASSESSED=0 in that lane are now satisfiable and truthful.

Next safe action: none required. The section below is retained as the
historical live boundary this wrap-up closed.

## Historical boundary (closed by the wrap-up above) — unattended long-run convergence

Prepared 2026-09-02, written for continuation after the supervising session
halts on quota. Everything below is resumable from documents plus the graph;
nothing depends on the halted conversation.

### The one command that continues the work

    ./bin/usf hermes start --manifest graph/manifests/anqr-with-foundation.json \
      --env-file .usf/credentials/providers.env --limit 12 --concurrency 8 --pause-seconds 60

The supervisor is detached from any session and survives it. `usf hermes status`
reports liveness, the selected manifest, per-cycle and cumulative tokens split
kept/wasted, cache reads, concurrency observed/target/utilisation, and facet
satisfaction. If it is already running, leave it running.

### Where the work stands

Both denominators are fully landed (every module, every conformance test) and
converging on executed verdicts. At writing: ANQR 36/39 capabilities fully
satisfied (94% of facets, denominator fully assessed); Core 38/64 (88%), with a
check backlog draining at 24 per cycle. Completion condition for the operator directive (task: drive defined scope to
done), scoped to what the running loop can satisfy: for every
**implementation-conformance** facet, UNSATISFIED, NOT_ASSESSED and BLOCKED all
zero on both `graph/manifests/v3-delivery.json` and
`graph/products/anqr/manifest.json`. BLOCKED joined the condition when unwritten
subtests became visible repairable work (commit 9852142). The **realized-
artefact** facets (27 at writing, e.g. every capability's statemodel) are a
separate lane: they are satisfied by an artefact at a canonical path, produced
by `usf hermes realise`, which is deliberately not run under a product profile.
They will sit NOT_ASSESSED throughout this run and that is correct, not a stall;
closing them is its own directive, not part of this one. The conformance loop
cannot and must not try to satisfy them.

One implementation-conformance capability is also excluded, by operator decision
on 2026-09-02 and recorded as `urn:anqr:known-limitation:qrartefactcreation-codec`:
`qrartefactcreation` requires a from-scratch QR codec (Reed-Solomon, matrix
placement, decoder) that the stdlib-only convention forbids importing and a
bounded worker cannot write; aimed repair with the real assertion did not close
it. Its 5 facets stay honestly UNSATISFIED in the evaluator and are subtracted
from the completion condition. Resolution options (heavier route, permit one
audited dependency, or leave open) are in the graph record; the operator accepted
it open. UI and other undefined
scope deliberately waits; it is recorded as dispositions and opportunities in
the ANQR profile, not as pending work.

### The machinery the run relies on (all committed, all tested)

- admission-ranked routing with spend-per-acceptance tiebreak; output-
  unproductive stand-down at 12 fruitless verdicts; surface-preservation gate on
  repairs; truncation named at admission; repair context that survives to the
  round that needs it; no cache reuse of bytes already landed.
- prefix-stable prompts and 4-unit burst rotation so provider prompt caches have
  something to hit; cacheReadTokens measured per cycle (baseline was under 1%).
- dynamic invocation timeouts: API routes 150s floor, host-agent CLIs 420s,
  3x a route's own mean latency, 600s absolute ceiling.
- subscription CLIs each pin model AND effort so worker turns never inherit the
  supervising configuration: claude-cli pins the declared Haiku worker model
  (graph: selectedModel on the transport), codex pins model_reasoning_effort
  low, antigravity declares low-tier model names. Quota exhaustion self-defers
  6h and self-expires; no manual re-enable is ever needed.
- the operator's Claude session is admitted (policyActive false on
  urn:usf:provider-execution-policy:operator-reserved-claude-oauth:1); set it
  back to "true" by one-quad transaction to reserve it again.

### Watch conditions for whoever resumes

1. A capability at repair round 5 twice in a row despite genuine byte changes:
   read its latest conformance evidence before touching anything; the proven
   remedies are (a) exact-diagnosis context reseed, (b) git-revert of a
   collapsed pair to last good committed bytes, (c) removal of a degenerate
   artefact so the frontier rebuilds it fresh. All three are in this file's
   history and in the session memory.
2. Waste above 50% for 3+ consecutive cycles: decompose per route; a route
   producing inadmissible output stands itself down at the ceiling -- the two
   high-waste cycles that preceded the last stand-down were the tariff of
   measuring it, and they self-resolved.
3. When UNSATISFIED and NOT_ASSESSED reach zero on both manifests: drain the
   supervisor, checkpoint both repositories, record the completion boundary
   here, and only then consider new definition work (UI semantics being the
   named next candidate, currently dispositioned deferred/reserved).

### Checkpoint discipline

Cycle-landed files are checkpointed at drain boundaries, never mid-run (a
transact can race a mid-cycle commit). Both repositories were checkpointed at
this boundary; anything dirty on resume is post-checkpoint cycle output and is
checkpointed the same way.


## Previous boundary — composed realisation, admission-ranked routing, and measurable satisfaction

Prepared 2026-09-02, after the profile breakthrough was consolidated. Read
current Git and supervisor state rather than trusting any identifier here.

### The three selections

| manifest | selects | lands in |
| --- | --- | --- |
| `graph/manifests/v3-delivery.json` | 64 foundation capabilities, 553 requirements | USF |
| `graph/products/anqr/manifest.json` | 39 ANQR capabilities, 171 requirements | the ANQR repository |
| `graph/manifests/anqr-with-foundation.json` | 103 capabilities, 724 requirements — their exact union | each capability into the repository that owns it |

Ownership is resolved from the graph (`declaresCapability` → `productRepository`),
never from an IRI namespace or a path shape — both conventions declare the same
path pattern, so a path cannot say which repository a result belongs in. One
proposal is written per owning repository and the supervisor transacts each
against its own target. Switching manifests does not stale evidence: staleness
compares file digests against the owning repository; `authoritySnapshot` is
recorded, never compared.

### Evidence now counts

`loadConformanceEvidence` resolved every record under the USF root, so product
evidence was permanently stale and ANQR satisfaction was pinned at zero while
real subtests passed. Records now name their `sourceRepository` and the loader
resolves per record. Verified live: ANQR went 0 → 54+ SATISFIED within two
cycles of the fix, with STALE returning to 0.

### Routing runs on what survives admission

Two measured defects, both fixed with regression tests that fail without the fix:

1. **Route history was write-only.** The reader omitted `attempts`, `successes`
   and `meanLatencyMs`, so the productivity map was always empty, ordering by
   production never happened, and the 12-attempt ceiling could never fire.
2. **Transport success outranked usefulness.** One host route
   (`antigravity-cli:gpt-oss-120b-medium`) answered 43 times for 1.77M tokens —
   86% of recent spend — with almost nothing admitted, and its perfect transport
   record kept it first in its provider. Admission verdicts now fold back into
   route history (never re-counting the invocation), ordering prefers admission
   rate wherever verdicts exist, and a route that spends the ceiling producing
   nothing admissible stands down for a day.

Truncation is also named at admission: host-CLI transports report no
finishReason, so a ceiling-cut generation reached the compiler and was reported
hundreds of lines from its cause. A compound structural check (open brace depth
AND text ending where no module ends) refuses it as `candidate-truncated` and
tells the repair round to produce a smaller module. 63–70% of cycle spend was
going to candidates that did not compile; these are the two named causes that
were measurable.

### What each cycle reports

Per-cycle and cumulative token usage, split kept/wasted (usage rides on refusal
outcomes too — a cycle that produced nothing still reports what it spent);
per-unit tokens in `providerActivity`; the manifest and whether the artefact
lane applies; facet satisfaction derived from the selected profile **after** the
cycle's own conformance runs.

### Operating state

Supervisor BAU: `usf hermes start --manifest <selection> --env-file
.usf/credentials/providers.env`. The child receives every operator selection
(tested round-trip); status reports only a cycle from the observed supervisor
and surfaces older ones as `supersededCycle`.

### Remaining work is decided here and in GOAL.md, nowhere else

Two sources decide remaining work, by kind:

- **Implementation work is decided by the graph.** The frontier is
  `usf hermes implement --manifest <selection>`; this ledger never enumerates
  unrealised capabilities, because prose copies of a frontier go stale the cycle
  after they are written. Unsatisfied and blocked facets are read from the facet
  evaluator, and repair is the supervisor's own loop.
- **Programme-level remaining work is decided by GOAL.md section 25** (the
  acceptance boundary) minus what current evidence already satisfies. The open
  criteria as of this boundary:
  - **25.5 concurrency**: **measured and met on record.** Both measured
    dispatches of the acceptance run reached peak 5 of target 5
    (= `min(8, C_target)`), utilisation 0.767 and 0.664, speedup 3.3x; recorded
    in the acceptance bundle. The never-below-two-while-two-ready clause holds
    by construction of the worker pool and is visible in the same records.
  - **25.5 continuous operation**: three-plus batches, forced supervisor
    restart, and concurrent chains have all been exercised, but not recorded as
    one auditable acceptance run.
  - **25.7 useful-token target**: **achieved.** The composed run frozen at
    100 000 reported 120 871 kept tokens in cycle 2
    (`usefulTokenTargetAchieved: true`), recorded in the acceptance bundle.
  - **25.3 provider removal**: demonstrated live, not only in the deterministic
    scale suite. `mistral-medium-3-5` produced 315 of the 645 all-time accepted
    cache entries — the single most successful route — then became quota-
    exhausted (removed in effect); production continued across openrouter,
    nvidia, cohere, groq and antigravity routes, including whole later cycles at
    6/6 acceptance. Recorded here as the removal evidence; the scale suite's
    failure-isolation and two-family-overlap tests carry the mechanism.
  - **25.8 sanitized acceptance bundle**: **produced** from the achieved run —
    `docs/acceptance/2026-09-02-composed-run.md` and its evidence file. It
    answers the eleven reviewer questions, discloses that the only non-zero
    reported cost anywhere is the operator's own toggleable Claude session
    (none inside the run window; zero paid API cost across 1 009 units), and
    carries exact claims and nonclaims.
- **Everything in the gap register below** is remaining work by definition;
  when an entry is fixed it must leave the register in the same change.

### Next safe actions

1. Let the composed supervisor keep realising the remaining frontier; the graph
   decides it. Checkpoint cycle-landed files at boundaries.
2. When a repair round leaves a facet UNSATISFIED at the repair ceiling, read
   the evidence record before touching the module: the failure is a product
   behaviour statement, and the fix may belong in the facet, the module or the
   test.
3. The next restart picks up the profile-supplied denominator fix (18e5cc6);
   the projection recomputes from evidence, so no restart is needed for it
   alone — usefulTokens accumulate per supervisor and a restart resets them.

### Gap register

Every entry here is remaining work; fixing one removes it in the same change.

- ~~Repair state unscoped by profile~~ — closed by inspection: repair-rounds and
  candidate-failures are keyed by full capability IRI (namespaces cannot
  collide), conformance evidence carries `sourceRepository`, and the cycle
  record is read only for the observed supervisor. The remaining constraint is
  the intended one: two supervisors cannot run at once, and start refuses a
  duplicate.
- `usf hermes run` unexercised against a product or composed selection.
- `typecheckCandidateModule` compiles in USF's scratch — sound while the output
  rule holds modules to the Node stdlib; an assumption, not a boundary.
- "USF as needed" composition is not derivable: no Core capability references a
  `CapabilityPort`; would need `fulfilledByCapability` edges, which restale the
  ANQR profile closure. Operator has accepted union composition instead.
- Payment payloads remain `experimental` pending per-standard vectors.
- GOAL.md §7 and §12 carry 13 MUST clauses largely realised elsewhere; pruning
  them needs a clause-by-clause check against the graph.


## Previous boundary — ANQR has a product semantic denominator, and Hermes realises it into the ANQR repository

Prepared 2026-09-02. Read current Git and remote state rather than trusting any
identifier here.

Branch `v3-authority-transition`. The Core/Profile mechanism was proved but
ANQR had no semantics: `urn:anqr:profile-revision:1` was an immutable *empty*
revision whose own nonClaim said it declared no capability, facet or
requirement. USF could realise USF, and nothing could realise ANQR.

That gap is now closed. `urn:anqr:profile-revision:2` supersedes revision 1 —
revision 1 is untouched and still declares nothing, so no identifier changed
meaning.

### What the denominator contains

44 capabilities across 10 domains, 180 facets, landed through `usf transact`
(append-only, zero owned integrity violations). Each capability states
`userOutcome`, `targetUser`, `businessValue`, `applicableInterface`,
`applicableRuntime`, `capabilityInput`, `observableOutput`,
`productConstraint`, `satisfactionCondition`, `productScopeDisposition` and
`justifiedByEvidenceSource`.

Domains: creation, payload, presentation, analysis, distribution,
**localisation**, experience, trust, quality, enterprise.

Localisation is a domain rather than a feature because the evidence says so:
89 interface locales at 1 676 keys, 87 locales × 9 static page types at 22 MB,
declared direction per locale, a per-script font map, an alias-driven
negotiation order, hreflang alternates across the whole set, and a *separate
public translation repository* (`github.com/maldous/anqr-i18n`) with a
browser-based contribution route published on all 87 localised pages.

Dispositions are real, not decorative: 39 capabilities are `current` or
`experimental`, and 5 are `deferred`/`reserved` (mobile application,
authenticated service consumption, self-hosted operation, policy boundary
control, platform parity). Payment payload representation is `experimental`:
21 schemes are declared, and the profile states that declared breadth is
evidence of intent rather than proof any scheme conforms to its published
standard.

Every facet carries `satisfactionStatus: not-assessed`. The profile claims
outcomes; it asserts no satisfaction.

### What it deliberately excludes

14 `ProductExclusion` records, each with its reason. Eight are the old
Harness/Symphony concerns — provider routing, worker scheduling, autonomous
issue handling, worktree orchestration, evidence admission, integration
orchestration, self-feeding loops, host supervision — recorded as superseded by
USF and Hermes rather than as ANQR capabilities. Four are QR implementation
mathematics: Reed-Solomon and finite-field arithmetic, matrix placement, mask
scoring, bit packing. Two are boundary claims ANQR must never make: validating
what a payload refers to, and assessing the safety of a payload destination.

The contract states observable invariants — an artefact decodes to the payload
requested; customisation stays inside a declared scan-safety acceptance — and
prescribes no algorithm for either.

### The V1 finding

The directive expected recoverable V1 ANQR semantics. There are none.
`grep -ril anqr` over the whole pinned USF V1 checkout at `028a9f96`, and over
V2, returns **zero** matches. V1's 68 capabilities are USF's own platform
semantics and are already in Core, exactly as `semantic-recovery-sources.json`
classifies them (`historical-usf-repository`). Recorded as
`urn:anqr:evidence-source:usf-v1-absence` so the absence is a finding rather
than an omission. The retained V1 value ANQR consumes is the **port set**, as
foundation, not as re-expressed product semantics.

### Foundation reuse is resource-scoped

`urn:anqr:profile-foundation-binding:2` binds `urn:usf:foundation-revision:v3:1`
through the `v3-delivery` authority manifest **named by path, never imported**.
11 seeds expand to a 22-resource closure: 7 `CapabilityPort`s the product
actually needs (apiruntime, observabilitysink, cacheprovider, secretresolver,
configlayerprovider, guardrailport, objectstore) plus the core surface policy,
implementation convention and conformance rule.

Ten `ProfileFoundationDependency` records each state the product reason that
requires the port. Three are `deferred` (identityprovider,
backuprestoreprovider, resourcelifecycleport) and are declared but **not
seeded** — deferring a capability defers its infrastructure. No provider
technology appears as an ANQR capability, and a test enforces that.

Three injected-and-reverted proofs:

| injection | result |
| --- | --- |
| `capability-port:cacheprovider` (inside closure) | `stale`, naming exactly that resource with recorded vs current digests |
| `capability-port:notificationprovider` (outside closure) | `current` |
| `pnpm-lock.yaml` (external fact) | `current`, reporting `externalFactDrift: [dependency-lock]` |

### Hermes selects from the ANQR profile and lands in the ANQR repository

`usf hermes implement --manifest graph/products/anqr/manifest.json` projects
**39 capabilities, 171 requirements, 78 units** through
`urn:anqr:capability-implementation-convention:v1:1`. The Core frontier is
unchanged at 64 capabilities and 553 requirements through its own convention.
The two share no capability.

Deferred and reserved capabilities produce **no work at all**, because their
facets are `NOT_APPLICABLE`. An aspiration cannot be dispatched.

One bounded proof unit was carried end to end:

1. `localenegotiation` implementation unit → `groq/compound` via
   `vercel-ai-sdk`, 2 419 output tokens;
2. landed by `usf transact --repository urn:anqr:repository:main` at
   `src/capabilities/localisation/localenegotiation.ts` **in the ANQR
   repository**, resolved through the operator locator (`.usf/repositories.json`
   maps `anqr-main` to `../anqr`). USF Core has no `localisation` capability
   directory at all;
3. conformance unit → a behavioural test at
   `tests/conformance/localisation/localenegotiation.conformance.test.ts`,
   also in the ANQR repository;
4. executed inside the repository confinement against ANQR source:
   **4 facets executed, 4 passed, 0 unobserved**, exit code 0, `confined: true`.

The evidence record names `urn:anqr:delivery-capability:localenegotiation` and
one subtest per ANQR facet. ANQR satisfaction is derived from ANQR evidence.

### Three generic Core improvements this required

None is ANQR-specific and all are covered by tests:

1. **`deriveCapabilityImplementationNeeds` keyed capability names on the
   `urn:usf:delivery-capability:` IRI prefix.** Any product profile's
   capabilities were therefore invisible to the frontier while their facets,
   contract and paths were perfectly well formed — the profile mechanism could
   describe work that could never be selected. Now keyed on the declared type.
2. **`readImplementationConvention` required `realisationRoot` on the owning
   repository.** A `ProductRepository` deliberately has none, because where it
   sits is operator state. A convention owned by one now resolves its root
   through the locator and authenticates it before any write.
3. **`hermes implement` was hard-bound to `graph/manifests/v3-delivery.json`.**
   It now takes `--manifest`, and the conformance runner takes a source root so
   product evidence executes against product source while the compiler stays
   USF's — which is why a product repository can remain a plain checkout with no
   toolchain of its own.

### Isolation regression found and fixed mid-flight

Making the product-profile vocabulary layer import `v3-convention.json` pulled
`v3-execution` → `self-host` behind it, so the ANQR overlay absorbed five USF
self-host contracts and moved the self-host profile's composed scoped digest.
`tests/unit/graph/product-overlays.test.ts` caught it as a computed-vs-computed
difference, not a stale pin. The vocabulary layer now imports nothing: the
`undeclared-type` invariant is enforced over the transacting corpus, not over a
product overlay, so a product overlay never needed Core's convention source.
All 8 overlay tests pass, including *a versioned profile selects an exact
closure and unrelated product overlays do not stale it*.

### Where the semantics live

| path | contains |
| --- | --- |
| `graph/products/anqr/profile-revision-2.nq` | revision, binding, 10 domains, 44 capabilities, 180 facets, 14 exclusions, 18 evidence sources |
| `graph/products/anqr/opportunities.nq` | 16 product opportunities, every one `reserved` |
| `graph/products/anqr/ui-ownership.nq` | 14 UI surfaces owned or dispositioned; all 5 Core `PROFILE_SUPPLIED` UI facets answered |
| `graph/products/anqr/realisation-convention.nq` | ANQR's own convention, path rules and conformance rule |
| `graph/product-profile-vocabulary.nq` | generic Core grammar: 5 types, 29 predicates, 6 scope dispositions. Names no product |
| `tests/integration/anqr-profile-isolation.test.ts` | 13 tests over isolation, closure, dispositions and exclusions |

### Opportunities are recorded, not scoped

16 opportunities, each `reserved`, each carrying the evidence that already
exists, the new semantic requirement it would need, the foundation ports that
would make it cheap, the additional service commitment it implies, and its
value. Two stand out as needing no new capability: agent-native generation
(MCP is already served) and localisation as a contributed platform asset. The
most commonly paid-for QR feature in the market — managed dynamic destinations
— is recorded honestly as absent, and as implying a redirect service whose
uptime becomes a customer promise.

### The supervisor now operates the ANQR profile

`usf hermes start --manifest graph/products/anqr/manifest.json` runs unattended
BAU against ANQR. The supervisor record, every cycle projection and
`hermes status` all carry the selected manifest, and `authorityIdentity` is
derived from it — an ANQR supervisor reports
`sha256:bb4c6805...` where a foundation one reports `sha256:30770331...`.

Three consequences were handled rather than assumed:

- The cycle transaction is told which repository owns the results
  (`--repository` from the implementation lane's `targetRepository`). Without it
  the product's paths would be written into USF itself.
- The **artefact lane is not run** under a product profile. It realises USF's
  own delivery artefacts and only those, so running it would spend the cycle on
  foundation capabilities merely because they are available. It is recorded as
  `artefactLane: not-applicable-under-a-product-profile`, not silently skipped.
- That lane also carried the facet-satisfaction projection. Facet satisfaction
  is a property of the selected profile, so the implementation lane now derives
  it from the selected graph. An ANQR cycle reports its own 180 facets.

### Two silent-selection defects the restart exposed

Both were invisible failures that reported success, and both now have tests.

1. **`hermes start` did not forward `--manifest` to the supervisor child.** The
   parent spawns a detached child that owns the cycle. Starting on the ANQR
   profile therefore started a *foundation* supervisor while reporting back the
   product one that was asked for. The only visible symptom was an
   `authorityIdentity` that happened to match the previous run; the child's own
   command line was the evidence. The child arguments are now a named function
   with a round-trip test through the child's own parser, because a forwarded
   option the child would reject is not forwarding either.
2. **`hermes status` reported a departed supervisor's cycle.** `cycle.json` is a
   single unscoped file, so the previous supervisor's projection outlived it and
   was reported beside the new supervisor's manifest — 670 foundation facet
   verdicts under an ANQR supervisor that has 180. A projection is now reported
   only when its `supervisorId` matches the observed supervisor; an earlier one
   surfaces as `supersededCycle` so it stays visible as history.

### Gap register
- The ANQR repository has no `node_modules`; the conformance cage works because
  ANQR modules are self-contained by convention. A capability needing a runtime
  dependency would need that boundary reconsidered.
- `.usf/hermes/supervisor/cycle.json`, the repair-round and candidate-failure
  records and the conformance-evidence directory are all **unscoped by profile**.
  Status no longer misreads the cycle record, but running a foundation and a
  product supervisor in sequence still shares repair state between them. Only one
  supervisor may run at a time, so this is latent rather than active.
- `usf hermes run` takes `--manifest` through the same parser but has not been
  exercised against a product profile; only `start` has.
- **Blocking measurement:** `loadConformanceEvidence` resolves a record's
  `modulePath` and `conformancePath` against the USF root, so evidence produced
  in a product repository is always stale and an ANQR facet can never reach
  SATISFIED. Ten executed records at the current authority snapshot carry real
  passing subtests and all read STALE. The conformance *runner* was threaded with
  a source root; the *evaluator* was not. The fix needs the owning repository
  recorded in the evidence, because Core and product records share one unscoped
  directory and each set resolves under a different root.
- `typecheckCandidateModule` still compiles candidates in USF's scratch. That is
  sound while the output rule holds the module to the Node standard library, and
  it is an assumption rather than an enforced boundary.

## Previous boundary — product implementation realization is wired and executable

Prepared 2026-09-02. Read current Git and remote state rather than trusting any
identifier here.

Branch `v3-authority-transition`. The semantic consolidation established that
the 553 outstanding requirements are **implementation-conformance** statements,
not missing artefacts: V3 has largely realized the ANQR *specification* and had
not begun the ANQR *product behaviour* that specification describes. Nothing
turned those requirements into work, so `usf hermes realise` reported
`readyFrontier 0` and BAU had nothing to do.

That gap is now closed end to end.

### Graph authority for implementation

Two resources landed through `usf transact` (append-only, zero owned integrity
violations, resulting corpus 24 365 quads):

- `urn:usf:capability-implementation-convention:v1:1` — owning repository,
  module and conformance path rules, path derivation, filename convention, the
  cohesion rule and the dependency rule.
- `urn:usf:implementation-conformance-rule:v1:1` — what may evidence an
  implementation-conformance requirement, and what is refused before execution.

Paths are graph-derived: `apps/anqr/src/capabilities/{domain}/{capability}.ts`
and `apps/anqr/tests/conformance/{domain}/{capability}.conformance.test.ts`. No
model proposes, chooses or influences a path.

### The bridge

`usf hermes implement` projects the frontier. Every outstanding applicable
requirement of one capability forms **one** implementation unit, because one
module realizes them jointly; the conformance unit is the only dependency edge,
because a behavioural test needs a concrete exported surface. That yields
**64 ready implementation units, 64 following, over 553 requirements** — the
widest truthful frontier, with pairwise-disjoint write ownership.

### Evidence is executed

`src/providers/implementation-conformance.ts` typechecks the module and its
test, then runs the test inside the repository's existing bubblewrap and Node
permission confinement — no network, no writable filesystem outside a scratch
root, no ambient environment — and records what each facet-named subtest
returned. The facet evaluator derives `SATISFIED`, `UNSATISFIED` or `STALE` from
that outcome. A realized artefact can no longer evidence a behavioural
requirement, and a test that does not import the real module is refused before
it is executed.

A failing check drives **bounded alternating repair**: round 1 regenerates the
module, round 2 the test, and after four rounds the capability is reported as a
blocker rather than consuming further provider budget.

### The supported operator interface

`usf hermes start | status | stop` own process identity, duplicate refusal,
orderly drain and every runtime file. `scripts/hermes-bau.sh` is no longer the
interface. Liveness comes from durable Linux process identity (boot id, start
ticks, uid, argv digest, executable digest), so a recycled PID is never mistaken
for the supervisor. Stop is idempotent, drains at a cycle boundary, honours
SIGTERM at the next boundary rather than mid-transaction, and keeps SIGKILL as
the deterministic backstop. Semantic state is never reset by process lifecycle.

### Two dispatch defects found under real load

Both fixed in `src/commands/graph-execute.ts`:

1. A provider returning HTTP 200 with **no text** was recorded as success, so a
   silent model consumed a unit another route could complete. An empty answer is
   now a refusal (`PROVIDER_EMPTY_RESULT:<finishReason>`) and falls through.
2. Only **four** candidates of a 57-route universe were ever attempted. The
   bound is now eight, which reaches the deep providers.

Routes that refuse now earn a bounded, self-expiring, **per-route** deferral
(`src/providers/route-deferral.ts`), so unattended operation stops re-paying a
two-minute empty answer every cycle. It is never a provider-family disablement:
quota exhaustion defers one exact route for six hours and clears on the next
success.

### The loop is closed, with evidence

`accessibilitya11ygate` is the first ANQR capability that conforms. Its path:

1. eight facet statements → one implementation unit → `mistral-medium-3-5`
   produced a 188-line module, landed at
   `apps/anqr/src/capabilities/foundation/accessibilitya11ygate.ts`;
2. one conformance unit → a behavioural test at
   `apps/anqr/tests/conformance/foundation/accessibilitya11ygate.conformance.test.ts`;
3. two bounded repair rounds, both driven by the compiler naming the test file;
4. eight subtests executed inside the confinement, **eight passing**.

The facet evaluator then moved the corpus from **27 to 35 SATISFIED**, with
`capabilitiesFullySatisfied 1`. Every one of those eight verdicts names the
behavioural outcome that produced it. None was authored, and no realized
artefact contributed to any of them.

### Observed provider reality

Real dispatch on this host, recorded in `.usf/graph-executions/`:

| route | observation |
| --- | --- |
| `cerebras` | HTTP 402 `payment_required`, free trial exhausted |
| `codex-cli` | usage limit exceeded, retry after 7 Sep 2026 |
| `cohere north-mini-code-1-0` | 200 with empty text, `finishReason: length` after ~120 s |
| `groq qwen/qwen3.6-27b` | HTTP 413 at a 16 000-token output budget |
| `nvidia` | 27 zero-price reasoning routes eligible at that budget; the deep bench |

Claude remains reserved and unroutable throughout
(`urn:usf:provider-execution-policy:operator-reserved-claude:1`, untouched).

## Previous boundary — the registration-feature digest model is declared and executable

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider contacted, no credential read, no adapter loaded.

The two prose-only binding terms are now a canonical, graph-owned, executable
semantic model. Landed as **one alignment**: a single contribution over four
paths through `realisation-basis-chain`, integrated once, with **zero completion
restoration required** — all nine packets stayed `verified-complete` throughout.
Gate **240/240**, containment `pass`, and a fresh empty-`.usf` standalone clone at
`91bc726ecca56cef806bff0c35171aa5779c8dfc` reproduces semantic digest
`sha256:aea7ac1b81bce8f4d38714457a8b748cfcc6bf6226b6d30e5902254b08b5d720` with
`closureSatisfiability satisfiable` and `publicationPolicyCoverage covered`.

### The decision, made and recorded

Following `urn:usf:type:CanonicalKeyedMemberDigestProtocol`, both digests now
have declared preimages rather than prose:

- `urn:usf:provider-operation:registration-feature-operations-key:1` declares
  `registrationFeatureOperationsDigest` over the **path-ordered resolved
  operations**, each a closed `{kind, path, contentDigest}` member. Content is
  bound by digest; transport `encoding` and `mediaType` are excluded.
- `urn:usf:provider-operation:registration-feature-postimage-key:1` declares
  `registrationFeaturePostimageSetDigest` over the **entire declared write set**,
  one `{path, kind, resultingMode, resultingContentDigest}` member per declared
  path. A path the feature does not operate on carries all-null: canonical
  absence of effect, never an omitted member. So the key binds intended scope as
  well as resulting state.

Both carry `excludesFromDigest` for `basisDigest`, candidate `artifactDigest`,
`acceptedContributionDigests`, construction-grant identity and timestamps, making
them basis-independent by declaration — which is exactly why candidate identity
cannot serve as the cross-phase equality key.

Member records are backed by `schemas/candidate.schema.json#/$defs/...`,
following the existing fragment convention. Implementation sits in
`src/collaboration/resolve.ts` — the module that already produces the resolved
path-sorted operations the key binds. Choosing it over `src/realisation/index.ts`
kept the blast radius at zero; the same change in `index.ts` staled all nine.

Three focused tests make the rule's refusal prose executable: canonical
path-ordering independent of submission order, cross-phase equality of
independently constructed representations, and fail-closed refusal on changed,
missing, extra, duplicate, out-of-scope, absolute and traversing members.

### The demo is capped by provider reality, not by repository work

Re-derived this session and load-bearing for planning: **no available lane can
produce a trusted zero-paid account receipt**, so no route can qualify and the
end-to-end demo cannot complete regardless of further building.

`urn:usf:requirement:provider-pipeline-account-tier` demands a *provider-owned
non-inference account source* proving zero paid cost, paid usage disabled,
automatic overage disabled, bounded quota and source authenticity, and states
that "self-authored assertions ... are insufficient". Against that:

| lane | status |
|---|---|
| `groq-qwen3.6-27b`, `cerebras-gpt-oss-120b` (the only configured routes) | **no `ProviderAccountSourceMapping` at all**; zero mentions of groq/cerebras in any account-source context |
| `codex-cli`, `claude-cli` subscription hosts | mapped, but `configuredRouteJoinRule` states "Subscription-host candidates have no configured-route join under the current route schema" — they can never yield an assignment |
| `openrouter-current-key:1` | the only real mapped endpoint, but `mappingDisposition: insufficient-alone-for-zero-paid-account-receipt` with four enumerated `missingRequiredEvidence` items: paid usage disabled, automatic overage disabled, automatic top-up disabled, free-model eligibility plus fallback prohibition. Not a configured route. |

Every route to a demo therefore requires one of: fabricating a Groq/Cerebras
account endpoint that does not exist; asserting OpenRouter returns evidence its
endpoint does not return; changing the route schema so host candidates can join;
or relaxing the zero-paid evidence requirement. The first two are fabrication.
The last two materially redefine USF's trust model, which is an operator
decision, not a bounded implementation choice.

Note this is **not** the receipt-v2 seam blocking the demo. Completing all three
seam phases would move `providers receipt acquire` from
`PROVIDERS_RECEIPT_PROOFBLOCKED` to a credential/mapping refusal and no further,
because there is no mapping for either configured route to acquire against.

### Gap register (non-demo-path)

- receipt-v2 seam remains unimplemented; its binding key now exists, so it is
  implementable without invented authority.
- `CALL_LEAF_DEPENDENCY_REFUSED` on `call parallel`: no
  `ProductionLeafRuntimeClosure` for `src/commands/provider-parallel.ts`;
  off the contact path.
- `src/realisation/index.ts` begins with `/` and is therefore uncontributable
  through `usf call` (`ABSOLUTE_PATH_FORBIDDEN`); worked around here by siting
  the change in `resolve.ts`.

## Earlier history

Forty-six older boundary and continuation sections were pruned from this ledger
at `f3797ac8f0db`. They are not lost: `git show f3797ac8f0db:docs/handover.md` returns
the ledger in full, and `git log --follow docs/handover.md` walks every version.

A handover is the live operational ledger — what is true now and what the next
safe action is. It had grown to 49 stacked boundaries and 5 863 lines, which is
an archive rather than a ledger: the current position was 4 % of the file, and
the rest competed with it for attention. What those sections recorded that still
binds has been carried into the graph, the registered CLI surface, the operator
skill and the sections above; what they recorded about superseded intermediate
states is history, and history belongs in Git.

The pruned sections, newest first:

- Prior boundary — the feature model was unreconstructible; alternatives compared
- Prior boundary — the receipt seam is derived, and its missing primitive proven
- Prior boundary — all nine provider packets verified-complete
- Prior boundary — eight packets complete; confinement repaired properly
- Prior boundary — graph-owned authority can now evolve legitimately
- Prior boundary — seven packets complete; the invocation boundary is real
- Prior boundary — six packets complete; account-tier backed by a real closure
- Prior boundary — five packets complete; semantic diagnostics registered
- Prior boundary — five packets complete; first real byte-delta contribution
- Prior boundary — four packets complete; file-asset-index policy gap closed
- Prior boundary — census complete; account-tier proven to need real implementation
- Prior boundary — root authority restored; file-asset-index policy gap evidenced
- Prior boundary — primary-owned receipt semantics
- Live continuation update — repository-path currentness restored
- Superseded historical boundary — former secondary account-source model
- Prior provider-census completion boundary
- Prior remotely authenticated operator completion boundary
- Live continuation update — profile predecessor and bounded leaf closure
- Live continuation update — production host command exposed closure defects
- Live continuation update — provider leaf registry integrated
- Live continuation update — provider-census candidate refused
- Live continuation update — executable provider-leaf dispatch correction
- Live continuation update — module presence is not leaf authority
- Live continuation update — bind leaf authority and imported bytes
- Live continuation update — one-time provider registry closure
- Live continuation update — complete validation-set integration
- Live continuation update — provider census integrated and completion published
- Verified carrier and gate
- Historical superseded provider-profile checkpoint (not current authority)
- Earlier profile-scoped authority and completion history
- Current graph authority
- Semantic-first authority boundary
- Integration and carrier-adoption boundary
- Ordinary construction-authority boundary
- Semantic recovery boundary
- Provider and model population
- Provider/currentness correction and legacy invariant audit
- Provider safe sequence
- Hermes-Agent boundary
- Git, currentness and batching
- Lifecycle and truthful first implementation
- Test economics and authoritative checks
- Skills and plugins
- Next exact actions
- Per-route provider-contact blocker derivation (turn 8)
- V3 live execution demonstration (achieved)

---
