# USF V3 handover

## Current position — 2026-09-03

`hermetic-release-1` is the immutable release boundary and remains untouched.
Transaction integrity is repaired. ANQR is independently reproducible and its
architecture is enforced by an adversarially proven checker.

| | |
|---|---|
| USF carrier | `192b7ea` on `anqr-experience-realisation`, clean, **not pushed** |
| ANQR carrier | `368528853` on `anqr-experience-realisation`, clean, **not pushed** |
| Release boundary | `hermetic-release-1` = `9e6239e`, annotated, reachable, untouched |
| USF tests | 433/433, gate conforming, containment pass, legacy 24 against its constant |
| ANQR clean clone | `npm ci` → typecheck 0 errors → 200/200 tests → architecture |
| Released verdicts | core `e958768a`, anqr `17d52953`, composed `3a9fa0d6` — byte-identical |
| Live provider lane | 9/9 `verified-complete`, digest `2e6a4780`, unchanged throughout |
| Architecture facets | 9 satisfied, 1 truthfully violated, 5 undecidable |
| Planted proofs | 18, all passing |
| Hermes | not running |

### ANQR is reproducible

Four defects made the released product repository unable to validate itself:
`typecheck` declared with no dependency at all and therefore never executed; no
lockfile; a test script enumerating one root and hiding the eleven codec tests;
and six ports declared at paths that did not exist. A fifth was introduced and
caught during the work, where unquoted globs made the shell rather than Node
expand them.

Declared now, exactly: `typescript` 7.0.2 and `@types/node` 26.4.1 with
`package-lock.json`, and `types: ["node"]` in tsconfig. That took typecheck from
unrunnable, to 125 errors, to 0 — the 125 almost all cascades from unresolved
`node:` types defeating the assertion signatures on `node:assert`. One real
error, in my own `reed-solomon.ts`. **The released capability modules and
conformance tests needed no change.**

### Architecture is enforced, not described

`packages/architecture/rules.json` is generated from the graph; the checker knows
how to check and never what is true; every finding carries its facet IRI. Six
facets pass by the checker, three by the mechanisms they delegate to, one is
truthfully violated because four adapters and the `image-source` port are
unrealised, and five are undecidable because their subject does not exist.
`npm run architecture` exits non-zero and is not weakened.

Eighteen planted-violation proofs run known-good → plant → fail for the intended
code → restore → pass, including four aimed squarely at the Priority 1 failure
classes: novelty, depth, unassigned-file attribution and unread import forms.
Two proofs initially failed and the checker was right both times.

Full evidence:
[`acceptance/2026-09-03-anqr-architecture-enforcement.md`](acceptance/2026-09-03-anqr-architecture-enforcement.md).

### Priority 1 formal completion is structural debt

A byte-delta completion runs through `semantic-work-completion:1`, whose
`integrationTransitionVerifier` is `work-integration-transition` — **proofblocked
at every declared version, 1, 2 and 3** — and `src/graph/work.ts:752` requires
exactly that state. The only implemented route is no-change completion, which
this work cannot claim because it changed 58 lines and added a file. Closing the
chain would require implementing a Foundation verifier left proofblocked by
design, or falsely asserting no-change. Both excluded, so it stays recorded as
publication debt: repair landed, integrated and proven; formal completion not
published.

### Next safe actions

1. **Realise the four container adapters and the image-source port**, which is
   the only thing standing between the architecture checker and a clean gate,
   and is also the artefact output layer the vertical slice needs.
2. **Register the rules-drift check** as a recurring check rather than a manual
   regeneration and byte comparison.
3. **Then the Preact slice**, once the adapter gap is closed.

### Open and honestly unfinished

- `portimplementationconformance` violated: 4 adapters + 1 port unrealised.
- Five facets undecidable: no build, no locale resource, no rendered surface, no
  join-rule validator, one realised surface where parity needs two.
- The architecture checker is a regex scanner, not a TypeScript AST parse. It
  over-reports and never under-reports.
- No continuous integration exists in the product repository, so no enforcement
  runs automatically.
- 81 of 93 ANQR sources belong to no declared component; reported, and the
  module boundary makes it a named exclusion.
- Priority 1 formal completion debt as above.
- Nothing is pushed.

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
