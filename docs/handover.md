# USF V3 handover

## Current position — 2026-09-03

V3 is the sole current system. V1 and V2 have no operational, build, runtime,
workspace or repository presence; the four historical remotes are archived and
read-only; and the retained historical material is provenance and
re-verification only, classified as such and enforced by the containment
validation rather than asserted.

| | |
|---|---|
| Carrier | `b58213d` on `v3-authority-transition`, clean |
| Tests | 413/413, typecheck clean |
| Containment | pass — 9 rules, every one planted-defect proven, plus two exemption guards |
| Integrity gate | conforming — 24 legacy against a recorded debt constant of 24, 0 owned |
| Corpus | 28 544 quads, 4 178 subjects |
| Manifests | 15 of 15 derive; none refuses |
| Provider packet lane | 9/9 `verified-complete` under `urn:usf:profile:v3-self-host:3` |
| Capabilities | core 64/64, anqr 39/39, **composed 103/103**; every frontier empty |
| Facets | UNSATISFIED / BLOCKED / STALE / NOT_ASSESSED all 0 in every lane |
| Verdict digests | core `e958768a…`, anqr `17d52953…`, composed `3a9fa0d6…` — unchanged across the whole V1/V2 retirement |
| Delivery artefacts | 29 satisfied, 8 superseded, 0 authority-blocked, 0 drifted |
| ANQR profile | `current`, 14-resource closure, 0 moved/added/removed, 0 external drift |
| Hermes | not running; ready 0, no blockers, no work graphs |
| Statement of applicability | 93 declared, 93 decided, 0 pending |

The programme directive is an index at `GOAL.md` carrying the terminal criteria
and the nonclaims, with its remaining sections one file each under
[`docs/goal/`](goal/), numbering unchanged and citations repointed in the graph.

### What remains

Nothing blocks ordinary operation and nothing gates the terminal outcome. Five
items are open; each needs a decision or ordinary work rather than a gate.

1. **A registered restore command, and a corpus lane projection.** The
   stale-completion chain has now been run by hand more than twenty times
   through a scratch script, and surveying every manifest-by-profile lane still
   means hand-rolling the projection. Both belong in the CLI, and both need
   `src/commands/help.ts` and `dispatcher.ts`, which `operator-observability`
   owns — so registering either costs the staged chain, two construction grants
   and a full cohort restoration. Deferred by operator decision to its own
   packet where that cost is budgeted rather than absorbed into a release. The
   chain and its traps are documented in the operator skill, so the deferral
   loses no knowledge.
2. **Four works carry no publication policy anywhere in the corpus** —
   `foreground-lifecycle`, `semantic-first-eligibility`, `realisation-basis-chain`
   and `semantic-first-lifecycle-admission`. Zero policies means
   `CONSTRUCTION_WORK_NOT_ELIGIBLE` and `WORK_COMPLETION_NOT_ELIGIBLE`, so they
   cannot complete under any profile. They are reachable only from the
   superseded self-host lanes. Recorded on the lineage record rather than
   repaired: giving each a disjoint sibling policy pair would assert authority
   at a boundary the corpus deliberately moved past.
3. **Six profiles still have no declared lineage.** `v3-self-host` is declared —
   revision 3 current, revisions 1 and 2 closed. The hermes, semantic-first,
   semantic-recovery and three ANQR profiles are not, so their lanes still read
   as outstanding work when they may be closed boundaries. Each is a decision,
   not a derivation.
4. **`usf review` remains `planned`.** The standalone convenience command is
   declared registered surface that has not landed. The cross-provider review
   mechanism it would wrap is implemented and tested, so this is
   registered-surface debt, not a missing capability.
5. **The product-event vocabulary is open, deliberately.** Two events are
   declared from facet evidence. Closing it means deciding the product event set
   and binding each event to its producing capability, which is a product
   decision. The `event-vocabulary` capture remainder keeps verdict
   `SURVIVING_INVARIANT_REQUIRES_MECHANISM`.

Next safe action: none required.

## Closed boundaries

Each boundary below is complete. Its reasoning lives in the commit message named
here, and its evidence in the acceptance record; neither is restated in this
ledger, which is the live operational state and not an archive.

| Closed | Boundary | Detail |
|---|---|---|
| 2026-09-03 | Programme directive split by topic; self-host profile lineage declared | `b58213d` |
| 2026-09-03 | `validation-scratch-confinement` relocated to the graph declaring its contract; eight manifests stopped refusing derivation | `e3ec381` |
| 2026-09-03 | V1/V2 retirement evidence recorded | `e6274e7`, [`acceptance/2026-09-03-v1-v2-retirement.md`](acceptance/2026-09-03-v1-v2-retirement.md) |
| 2026-09-03 | Abbreviated home-path bypass closed in the containment guard | `b7bd959` |
| 2026-09-03 | V3 established as the sole current system | `872fd20` |
| 2026-09-03 | Provider lane restored to nine of nine | `8114d4c` |
| 2026-09-03 | Outstanding work cleared: retired stage, planned-command assessment, bound recalibration | `4ed7555` |
| 2026-09-03 | Historical knowledge confirmed, historical dependency retired | `f48825e` |
| 2026-09-03 | V1 remainder accounting completed and V2 accounting added | `6c219cf` |
| 2026-09-03 | Terminal outcome declared reached | `1c2766e`, [`acceptance/2026-09-03-terminal-declaration.md`](acceptance/2026-09-03-terminal-declaration.md) |
| 2026-09-02 | Composed realisation run | [`acceptance/2026-09-02-composed-run.md`](acceptance/2026-09-02-composed-run.md) |

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
