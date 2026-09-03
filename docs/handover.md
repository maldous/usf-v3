# USF V3 handover

## Current position — 2026-09-03

V3 is the sole current system. V1 and V2 have no operational, build, runtime,
workspace or repository presence; the four historical remotes are archived and
read-only; and the retained historical material is provenance and
re-verification only, classified as such and enforced by the containment
validation rather than asserted.

| | |
|---|---|
| Carrier | `f049355` on `v3-authority-transition`, clean, **pushed** |
| Tests | 421/421, typecheck clean |
| Containment | pass — 9 rules, every one planted-defect proven, plus two exemption guards |
| Integrity gate | conforming — **16 invariants**, 0 owned violations, 24 legacy against a constant of 24 |
| Corpus | 21 sources, 33 177 quads, 4 751 subjects, 1 291 predicates, 13 773 edges, **1 connected component** |
| Manifests | 15 of 15 derive; none refuses |
| Realisation lanes | 34 total; **1** policy-covered (`self-host-provider-v3` x `v3-self-host:3`) at 9/9 `verified-complete` |
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

Nothing blocks build, test, containment, integrity, realisation or Hermes. Three
surfaces are open, and all three are recorded decisions rather than debt:
33 of 34 lanes are policy-uncovered by design, four works are uncoverable under
any profile, and 24 legacy integrity violations sit at an unchanged recorded
constant of 24. Each is stated with its evidence in
[`acceptance/2026-09-03-hermetic-release-proof.md`](acceptance/2026-09-03-hermetic-release-proof.md).

Four surfaces that were open are now closed by explicit decision: the six
profile dispositions, derived from the contract-selection lattice; the three
planned command retirements; the product-event vocabulary, closed at nine
events; and the CLI packet — `usf graph lanes` delivered, the restoration chain
decided against because a single invocation would hide the between-step digest
read-backs that make it safe.

**V3 is technically ready to tag and is not tagged.** The canonical branch is
pushed and remote HEAD equals local HEAD.

### Graph correctness

The USF and ANQR graphs were exercised structurally on 2026-09-03. The gate read
its directory non-recursively and checked 14 of 21 authored sources, so the whole
ANQR product graph had never been integrity-checked; `usf transact` had the same
loader, so its guarantee about the resulting corpus was true of 14 of 21 sources
in the write path. Both recurse now, excluding fixtures. Three invariants were
added, 126 undeclared predicates were declared, and four untyped unreachable
subjects were typed and connected.

The corpus is now one connected component of 4 700 subjects and 13 593 edges,
every subject typed, every predicate declared, out-degree minimum 1 with zero
sinks, dependency edges acyclic, 16 invariants, 0 owned violations. Full figures,
proofs and nonclaims:
[`acceptance/2026-09-03-graph-correctness-proof.md`](acceptance/2026-09-03-graph-correctness-proof.md).

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
