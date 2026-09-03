# USF V3 handover

## Current position — 2026-09-03

`hermetic-release-1` is the immutable release boundary and remains untouched.
Successor work has begun on the ANQR semantic build: the product's architecture,
assurance and feature semantics are declared on new lanes, and a real QR codec
now exists in the product repository.

| | |
|---|---|
| USF carrier | `c10e2a2` on `anqr-experience-realisation`, clean, **not pushed** |
| ANQR carrier | `c65426db7` on `anqr-experience-realisation`, clean, **not pushed** |
| Release boundary | `hermetic-release-1` = `9e6239e`, annotated, reachable, untouched |
| Tests | USF 421/421, typecheck clean; ANQR codec 11/11 |
| Integrity gate | conforming — 16 invariants, 0 owned violations, legacy 24 against a constant of 24 |
| Corpus | 30 sources, 36 788 quads, 5 428 subjects, 1 356 predicates, **1 connected component** |
| Released verdicts | core `e958768a`, anqr `17d52953`, composed `3a9fa0d6` — all **byte-identical** to the release |
| New lane verdict | `6ad5df33` on `graph/products/anqr/semantic-build-manifest.json` |
| New lane | 104 capabilities, 739 requirements, `architecture` 15 NOT_ASSESSED, ready 1, awaiting conformance 8 |
| Hermes | not running |

### What was established

**The QR codec is real.** `urn:anqr:known-limitation:qrartefactcreation-codec`
recorded that the capability could not be satisfied because a bounded worker
repeatedly produced an option surface around a codec decoding to the empty
string, accepted as a documented hard tail on 2026-09-02. `packages/artefact` in
the ANQR repository now implements it clean-room against ISO/IEC 18004 with no
third-party dependency: 160 of 160 version-by-level pairs round-trip with zero
corrections required, none skipped, all eight masks and all three implemented
modes round-trip, and planted damage inside the correction budget still yields
the exact payload. Two defects that produced plausible wrong answers rather than
crashes were found by assertions a weaker test would not have made: Forney
omitted the location factor, and the placement cursor revisited column 4 while
never reaching column 0, corruption that error correction silently repaired.

**Placement follows the Semantic Build ownership rule.** USF already owns the
whole lifecycle — the seven `urn:usf:stage` resources are exactly the canonical
stages, and Requirement, DeliveryFacet, Evidence, ProofObligation,
RealisationPermission, ValidationEvidenceModel and WorkPacket already implement
them. Architecture and experience are therefore dimensions inside that
lifecycle. A parallel experience vocabulary was drafted and **discarded**:
experience travels through the existing `uisemantics` facet kind, of which the
released lane already satisfies seventeen. Architecture added one facet kind and
a topology vocabulary; assurance added exactly two axes, severity and
verification class.

**Projection is proven, not asserted.** The fifteen ANQR architecture
requirements are DeliveryFacets attached to the capabilities whose realisation
they constrain, so they enter the existing implementation-conformance path: the
new lane counts 739 requirements against the released 724, reports
`architecture: 15 NOT_ASSESSED`, brings `platformparity` into the denominator
with a ready implementation unit, and moves eight existing capabilities to
awaiting-conformance-check. A requirement that generated no work would have been
a projection defect by this model's own invariant.

### Next safe actions, in order

1. **Fix the `usf transact` novelty blind spot.** Its guarantee is that the
   resulting corpus satisfies every invariant before any path is written, but its
   validation walks the on-disk `graph/` tree and substitutes postimages only for
   files it found, so a transaction that *creates* a graph source never parses or
   checks the bytes it produces. The semantic-build transaction reported
   `graphFilesParsed: 21` and `resultingQuadCount: 33 177` while creating nine
   sources carrying 3 611 quads; both real defects in them were caught only by
   running `usf graph integrity` afterwards. Same family as the flat-`readdir`
   blind spot — that repair fixed recursion but not novelty. Needs the staged
   chain, because `src/commands/` is outside transact's authorized prefixes.
2. **Bind enforcement to the fifteen architecture facets.** Each needs a named
   tool, invocation and configuration digest, then an adversarial verification
   showing a planted violation failing. Until then none is proof, by the
   `verification-must-be-verified` invariant.
3. **Realise the nine unrealised architecture components**, starting with
   `artefact-ports` and `artefact-application`, so the declared topology stops
   being aspirational.
4. **Author the experience dimension as `uisemantics` facets** on the journeys
   the exposure classification marks directly-journey-visible, then the design
   tokens and the Preact web surface bound through an implementation pack.

### Open and honestly unfinished

- Fifteen architecture facets are declared blocking and **none is enforced**.
- One of ten declared architecture components is realised; four of five delivery
  surfaces are unrealised, so the parity obligations are trivially satisfied and
  prove nothing yet.
- The 86-locale claim is a denominator with a blocking parity obligation, not an
  assertion that any translation is reviewed. Observed at the legacy source:
  `en-US` carried 1994 interface keys while the template and every other locale
  carried 1676, and the legacy guard tolerated the gap.
- ANQR `typecheck` is still unexecutable from a clean clone because TypeScript is
  not a declared dependency and `node_modules` is absent, so the released
  product repository's own typecheck script has never run. Codec evidence comes
  from `node --test`, which needs no dependency.
- Hosting and deployment targets are undetermined; every staging and production
  requirement records that.
- No experience profile, design profile, implementation pack, experience binding
  or coverage evaluator exists yet, and no vertical slice is rendered.

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
