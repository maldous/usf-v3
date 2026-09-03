# USF V3 handover

## Current position — 2026-09-03

`hermetic-release-1` is the immutable release boundary and remains untouched.
The successor line has closed the transaction-integrity defect and carries the
ANQR semantic build model plus a real QR codec.

| | |
|---|---|
| USF carrier | `fbddf7b` on `anqr-experience-realisation`, clean, **not pushed** |
| ANQR carrier | `c65426db7` on `anqr-experience-realisation`, clean, **not pushed** |
| Release boundary | `hermetic-release-1` = `9e6239e`, annotated, reachable, untouched |
| Tests | USF 433/433, containment pass; ANQR codec 11/11 |
| Integrity gate | conforming — 16 invariants, 0 owned violations, legacy 24 against a constant of 24 |
| Corpus | 32 sources, 36 995 quads, **1 connected component** |
| Released verdicts | core `e958768a`, anqr `17d52953`, composed `3a9fa0d6` — all **byte-identical** to the release |
| Live provider lane | 9/9 `verified-complete`, semantic digest `2e6a4780`, **unchanged throughout** |
| Semantic build lane | 104 capabilities, 739 requirements, `architecture` 15 NOT_ASSESSED, verdict `6ad5df33` |
| Hermes | not running |

### Transaction integrity is repaired

`usf transact` guarantees that the resulting corpus satisfies every integrity
invariant before any path is written. Two defects broke that, and both are now
fixed, landed through the ordinary staged chain and adversarially proven.

**Novelty.** Discovery walked the on-disk graph tree and substituted postimages
only for files it had found, so a transaction that *created* a graph source
never parsed or checked the bytes it produced. Measured: a transaction creating
nine sources carrying 3 611 quads reported `graphFilesParsed: 21` and
`resultingQuadCount: 33 177`, the pre-transaction corpus, and applied
successfully. The earlier recursion repair fixed depth, not novelty, and its
regression test could not catch this because it appends to an overlay that
already exists.

**Attribution.** Owned violations were filtered on `graph.length > 0`, and
`undeclared-type` reports with an *empty* graph label, so every corpus-level
violation was silently excused. A transaction introducing an undeclared type
was accepted while `usf graph integrity` called the same corpus non-conforming.
This was found by planting the violation, which is the whole point of planting
it.

Demonstrated after the repair: a creating transaction reports 33 sources against
32 on disk and 36 998 quads against 36 995. Adversarially: reverting the fix
makes 5 of the 7 end-to-end cases fail, and the two that pass either way are the
controls. Without the fix a syntactically invalid created source was **written**.

### Ownership was created by measurement, not by preference

No work owned `src/commands/transact.ts`; sibling commands are owned file by
file and no contract permits an `src/commands/` prefix. Two cheaper routes were
authored, applied, measured and reverted, each taking the live provider lane
from nine `verified-complete` packets to nine `blocked` with all nine scoped
dependency digests moved: appending four ownership quads to
`graph/semantic-first.nq`, and selecting an overlay source into
`graph/manifests/self-host.json`. That source and that manifest are each in
those packets' candidate scope. Creating a manifest that *imports* another was
measured separately and is free.

The repair therefore runs from a self-contained authority island in new files
under a new manifest — contract, proofblocked permission, work owning exactly
two paths, hermetic validation, evidence requirements, proof obligations, a
disjoint construction-authority policy enumerating one work, its reciprocal
publication algorithm, and a profile. Construction authority was granted the way
all nine completed packets got theirs, and the chain ran in full:
`work -> contribution -> resolve -> apply -> check -> integrate`, with the
confined check passing and a durable receipt.

Three derivation refusals shaped the island, each read from the packet:
`REALISATION_PROFILE_PRODUCT_TYPE_INVALID`, `WORK_PACKET_ENVIRONMENT_IRI_INVALID`
and a grant that projected as inapplicable until the permission itself declared
`activationDerivationRule`.

The validation cannot drive `usf transact` end to end inside the cage at all:
transact requires its proposal to resolve inside the repository and the cage
grants one scoped write root. So the repair is reachable through two exported
pure functions the confined lane asserts with no filesystem, while the
write-dependent cases are guarded by `process.permission` and asserted in the
outer carrier lane. Coverage rose from 7 cases to 12.

### Next safe actions, in order

1. **Priority 2 — ANQR clean-clone build assurance.** `typecheck` is declared in
   `package.json` but TypeScript is not a declared dependency and
   `node_modules` is absent, so the released product repository's own typecheck
   script has never run from a clean clone. Fix that first, then `install`,
   `typecheck`, architecture checks, `test` and `build` must all run from a
   fresh clone with no developer-machine residue.
2. **Priority 2 — enforcement for the 15 architecture facets.** Select the
   minimum mechanisms from the requirements, bind each facet to a named tool,
   invocation and configuration digest, then plant a representative violation
   per boundary and show the verifier failing. Until then none is proof and the
   facets must stay honestly NOT_ASSESSED.
3. **Priority 3 — the Preact vertical slice**, using the semantics already
   established rather than a second UI ontology.

### Open and honestly unfinished

- Fifteen architecture facets are declared blocking and **none is enforced**.
- One of ten declared architecture components is realised; four of five delivery
  surfaces are unrealised, so the parity obligations prove nothing yet.
- ANQR `typecheck` remains unexecutable from a clean clone.
- The 86-locale claim is a denominator with a blocking parity obligation, not an
  assertion that any translation is reviewed.
- Hosting and deployment targets are undetermined.
- No experience profile, design profile, implementation pack, experience
  binding, coverage evaluator or rendered slice exists.
- No graph source created by an earlier transaction is retroactively validated
  by this repair; the ANQR semantic build sources were validated by the
  `usf graph integrity` run that followed them.

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
