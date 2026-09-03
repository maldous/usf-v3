# USF V3 handover

## Current position — 2026-09-03

The repository is clean, reproducible and green. `410/410` tests, the graph
integrity gate reads `gateConforming: true`, every realisation frontier is
empty, and a fresh `--no-hardlinks` clone reproduces the same result from
tracked bytes alone.

| | |
|---|---|
| Tests | 410/410 |
| Integrity gate | conforming — 24 legacy against a recorded debt constant of 24, 0 owned |
| Corpus | 25 870 quads |
| Facets (core lane) | 670 — 575 SATISFIED, UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED all 0 |
| Facets (composed) | 724 — 719 SATISFIED, UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED all 0 |
| Capabilities | core 64/64, anqr 39/39, **composed 103/103** fully satisfied; every frontier empty |
| Verdict digests | core `e958768a…`, anqr `17d52953…`, composed `3a9fa0d6…` — reproduced in a clean clone |
| Delivery artefacts | 29 satisfied, 8 superseded, 0 authority-blocked, 0 drifted |
| Statement of applicability | 93 declared, 93 decided, 0 pending |

Six authority boundaries were closed on this date. Each is described in full in
its own commit message, which is where that detail now lives:

- `14f5778` four V1 capture remainders assessed as invariants V3 satisfies by
  another mechanism — 846 of the 1 082 enumerated declarations read as backlog
  and were not.
- `10379e2` the functional-predicate set declared in the graph, resolving the
  `gateConforming: false` condition the housekeeping boundary below left open.
  The debt constant was **not** raised; it is unchanged at 24 and now truthful.
- `251d604` the ISO/IEC 27001:2022 Annex A governance layer captured from the
  pinned V1 sources, and the statement of applicability realised by a
  deterministic generator with zero model invocations.
- `300855b` a `writeAuthority` status projection, so "who may write path X, by
  which mechanism" is answerable without grepping three predicates.
- `202246d` an open product-event vocabulary, so canonical events the delivery
  facets name in prose are stated as resources.
- `136985b` the 45 undecided controls decided against declared ISMS scope facts,
  plus two real defects fixed in the realisation path.

Three lessons from those boundaries that change how the next one should be run:

- **`transact` authorizes by path prefix; contract `permitsWrite` and work
  `writePath` govern only the staged contribution chain.** "No work owns this
  graph path" is not a missing-owner gap, it is the wrong mechanism. Resolving
  ownership by grep first produced a confident wrong four-part authority plan.
- **`transact --dry-run` reporting `conforming: true` is not a staleness
  answer.** It validates the resulting corpus and is silent on whether any
  completion goes stale. Measure that separately in a disposable clone, and
  compare lane-before against lane-after, never lane against primary.
- **Presence is not satisfaction for a derived artefact.** Fixed here, but the
  general form applies: anything projected from authority must be re-derived and
  compared, or it drifts silently from the thing it projects.

### The terminal outcome is declared reached

GOAL.md § 25 is met, criterion by criterion, recorded in
[`docs/acceptance/2026-09-03-terminal-declaration.md`](acceptance/2026-09-03-terminal-declaration.md):

```text
USF_V3_CONTINUOUS_PROVIDER_INDEPENDENT_ANQR_REALISATION_PROVEN
```

An earlier draft of this ledger claimed the outcome was blocked on credentials.
**That was wrong.** It conflated the two unqualified API-key routes in
`config/providers.json` with the transports that actually did the work, and the
evidence was already tracked: `docs/acceptance/2026-09-02-composed-run.md`
records 120 871 useful tokens against a pre-frozen 100 000 floor, peak
concurrency 5 of target 5, two provider families accepted in-window and zero
paid cost across 1 009 units. A second wrong reading followed — that § 25.4's
cross-provider review had no mechanism — when `review-diverse` is an implemented
routing strategy selecting across distinct provider families and distinct
underlying model families, reachable through `usf route` and the default
strategy in the routing test fixtures. Both corrections are recorded in the
declaration rather than quietly fixed.

### What remains, and why

Nothing blocks ordinary operation, and nothing gates the terminal outcome. Three
items are open, each needing a decision or ordinary work rather than a gate:

1. **`usf review` remains `planned`.** The standalone convenience command
   `usf review --candidate DIGEST` is declared registered surface that has not
   landed. The cross-provider review mechanism it would wrap is implemented and
   tested, so this is registered-surface debt, not a missing capability.
2. **The product-event vocabulary is open, deliberately.** Two events are
   declared from facet evidence. Closing it means deciding the product event set
   and binding each event to its producing capability, which is a product
   decision. The `event-vocabulary` capture remainder therefore keeps verdict
   `SURVIVING_INVARIANT_REQUIRES_MECHANISM`.
3. **The provider packet lane reads 3 of 9 `verified-complete`**, with 6 blocked
   on completion currentness because the realisation run moved bytes inside their
   scoped closures. That is the copy-on-write rule working, not a defect.
   Restoring it means republishing authority for each stale root before its
   consumers, which mints construction grants and is worth doing only if that
   lane's completion is wanted for its own sake.

Also unchanged and dormant: `urn:usf:work:semantic-recovery-acceptance` refuses
`WORK_DEPENDENCY_MISSING:config/semantic-recovery-inventory.json`. That file has
never existed; the lane is the explicitly incomplete historical recovery lane.

Next safe action: none required. The terminal outcome is declared, the repository
is in a resumable coherent state, and every open item above is a decision or
ordinary work rather than an unfinished mechanism.

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

- ~~The graph integrity gate reads `gateConforming: false`~~ — **resolved
  2026-09-03 at `10379e2`**; the gate now conforms and the debt constant is
  unchanged at 24. Original text: legacy violations 27 against a recorded debt
  constant of 24 (`src/commands/graph-integrity.ts`).
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

## Earlier history

The six authority boundaries closed on 2026-09-03 were collapsed into the current
position above once the work they described was complete; their full detail lives
in the commit messages named there. Four superseded continuation sections and the
historical long-run boundary were pruned at the same time:

- Historical boundary (closed by the 2026-09-02 wrap-up) — unattended long-run convergence
- Previous boundary — composed realisation, admission-ranked routing, and measurable satisfaction
- Previous boundary — ANQR has a product semantic denominator, and Hermes realises it into the ANQR repository
- Previous boundary — product implementation realization is wired and executable
- Previous boundary — the registration-feature digest model is declared and executable

A handover is the live operational ledger — what is true now and what the next
safe action is. Detail that has stopped binding belongs in Git, which is where
these went.


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
