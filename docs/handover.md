# USF V3 handover

## Repository hygiene — what is and is not disposable

`.usf/` is ignored and mostly disposable, but not uniformly, and the difference
costs real time if it is discovered by deleting the wrong half.

| path | disposable? |
|---|---|
| `.usf/workspaces/` | **yes**, once a check receipt exists. The receipt is the evidence; the directory is not. |
| `.usf/cache/` | **no.** This is the offline package mirror `usf init` resolves against. Removing it makes `usf init` fail with `ERR_PNPM_NO_OFFLINE_META` and no command that loads the graph will run. |
| `.usf/semantic-cache/`, `.usf/graph-executions/` | yes, at the cost of recomputation |
| `.usf/receipts/`, `.usf/proposals/` | keep: receipts are the evidence for work already done |

Measured on 2026-09-04: removing `.usf` entirely and running `usf init` fails
offline, so an empty-`.usf` clean clone is reproducible only with the mirror
supplied or with network access. That is the documented standalone-qualification
posture — the mirror is an expected input — but it is not the same claim as
"`.usf` is pure acceleration", and the two are easy to conflate.

## Naming

Terminology, namespaces, IRI construction, repository and path conventions are
defined once in [`naming.md`](naming.md). It is canonical: a second statement of
a rule is drift waiting to happen, so nothing here repeats it.

## Current position — 2026-09-04

`hermetic-release-1` is the immutable release boundary and remains untouched.
**Provider routing now reads authority instead of inferring it**, and the
foundation measures itself against its own declared architecture:
`urn:usf:work:architecture-conformance` is `verified-complete`, the whole
implementation population is classified with zero unaccounted and zero
unexplained orphans, and a release claim can depend on that assurance by name
and fails closed without it.

| | |
|---|---|
| USF carrier | `anqr-experience-realisation`, clean, **not pushed** |
| ANQR carrier | `f983edbd5` on `anqr-experience-realisation`, clean, **not pushed** |
| Release boundary | `hermetic-release-1` = `9e6239e`, untouched |
| USF | **564/564 tests**, typecheck 0, integrity gate conforming, containment pass |
| ANQR | 367/367, typecheck 0, architecture conforming, `validate` exit 0 |
| Architecture | population **171**, unaccounted **0**, unexplained orphans **0**, 9 of 9 requirements CONFORMING |
| Routing | 81 routable candidates, **0** admitted on catalogue price, 8 of 8 accounts declared |
| Qualified routes | **0** — the gate is connected and has nothing to admit until the suite can be passed |
| Release assurance | CONFORMING; required 1, satisfied 1, missing 0, failed 0 |
| Closure | NOT_ASSESSED **72 → 1**; SATISFIED 719 → 775; capabilities fully satisfied 95 → **109** |
| Remaining (ANQR) | 15 BLOCKED + 1 NOT_ASSESSED, **all architecture facets**, one exact cause |
| Source accounting (ANQR) | 151 = 32 + 119 + **0 unaccounted** |
| Next | the ANQR architecture evidence-class contradiction, then the testing rung |

### Provider routing reads authority now, and the qualification gate is live

Four defects were measured against the live surface and three were repaired;
the full evaluation and programme are in
[`acceptance/2026-09-04-provider-surface-evaluation.md`](acceptance/2026-09-04-provider-surface-evaluation.md).

**Catalogue price no longer authorizes anything.** 21 of 45 routable candidates
used to enter on `catalogue-declared-zero-price` with no declared authorization,
which is how OpenRouter came to carry 1 799 of 4 383 historical attempts while
no commit had ever authorized it. Authorization and spend permission are now two
axes: an authorization says which account may be used, `permittedCostClass` says
what for, and `paidSpendPermitted` says whether it may reach anything chargeable.
All eight accounts the operator holds are declared. 81 candidates, none on price.

**Antigravity was running in plan mode.** `agy --mode plan` answers a generation
request by writing a plan artefact and asking for approval, which is the whole
explanation for 20 of 20 invocations succeeding, 0 of 13 outputs accepted and
606 619 tokens spent. Pinned to `accept-edits`, verified against the binary from
a scratch working directory.

**Hermes never consulted qualification.** `graph execute` is the only path
`hermes implement` dispatches through and it passed no earned task classes, so a
qualification model holding thirteen adversarial properties constrained nothing.
It is passed now, and the input was made *required* — which immediately caught a
second caller, `usf probe availability`, with the same defect.

The gate binds nothing today and that is deliberate to state: both Hermes
entry points set `requiredCapabilities: []`, so no dispatched unit asks for a
task class. It binds when a supplied work graph declares one, or when
`modelCapability` is propagated into dispatched units — a separate decision.

**D4 was withdrawn rather than deferred.** Hermes has three prompt shapes and
none asks for N-Quads, so "put the strict profile in semantic-work prompts" had
no site. The real finding in its place: `rdf-semantics` is declared on nine work
packets, is unqualifiable because the suite grades no case for it, and is never
dispatched.

### Two lanes moved and both are back

Changing the economics evaluator, classification ladder, capability vocabulary
and route universe stales every work that reads them. Priced before the first
edit: three of four were already blocked and exactly one was verified-complete.
`provider-task-qualification` went blocked as predicted and was restored;
`provider-capability-universe` completed. Model ranking was **not** tuned —
routes earn position through the mechanism this programme connected.

### The foundation's architecture is declared and decidable

`graph/architecture-assurance.nq` could already state a topology and had never
stated this one: every instance in the corpus was `urn:anqr:`, and three of its
twenty types — enforcement binding, drift check and adversarial verification —
had never been instantiated by anyone. What was missing was not architecture
vocabulary but the machinery that makes a declared architecture decidable, so
`graph/architecture-conformance.nq` adds only that: declared roots and whether
each surface counts as running implementation, an enumerated population, eight
classifications each with the criterion and precedence that decide it, explicit
disposition decisions, assurance scope, a composable assurance set, and a
release claim with a declared absent-evidence disposition. Fifteen types,
thirty-two predicates, no new lifecycle and no parallel proof system.

Full report, including every disposition and all twelve planted negative cases:
[`acceptance/2026-09-04-architecture-assurance.md`](acceptance/2026-09-04-architecture-assurance.md).

### A wrong deletion was prevented by the denominator, not by review

Under a `src/`-only population, `src/providers/index.ts` was reached by nothing
— not the runtime, not the graph, not the tests — and the model reported it as
an unexplained orphan. Deleting it broke the typecheck: `recipes/` holds a
declared build-time recipe that imports it, and `recipes/` had never been in the
denominator. **The denominator was wrong, not the module.** The repair was to
declare the build-time root and widen the population; nothing was deleted.

This is the non-recursive-`readdir` defect one step further out. A denominator
that stops short of a *consumer* reports live implementation as abandoned, and
the population declaration now records why `recipes/` is in scope so nobody has
to rediscover it. If another root is ever added outside `src/` and `recipes/`,
it belongs in `populationRoot` in the same change.

### Two things the foundation genuinely does not have

The architecture is declared as measured, not as wished for. It is a module
architecture, not a hexagon: the realisation and provider layers both reach the
command surface, the semantic layer reaches the realisation layer, and fourteen
units sit in import cycles enumerated as a bounded exception. All of that is
declared with its reason, and tightening any of it is an architecture change
with its own work.

Six architecture-assurance types remain uninstantiated for the foundation.
`ArchitecturalPort` and `ArchitecturalAdapter` are absent because the foundation
is not ports-and-adapters. `DependencyScopeRule`, `FrameworkIsolationRule`,
`TestBoundaryRule` and `EnforcementDriftCheck` are real gaps, expressible today
and not claimed as covered.

### Two released digests no longer recompute, and nothing tracked changed

Core `e958768a` is still byte-identical. `anqr` and `anqr-with-foundation` are
not, and the cause was measured: neither manifest contains any source added in
this or the previous boundary, and the movement came entirely from
`.usf/conformance-evidence`, which is gitignored disposable state. Executing
conformance superseded the cached records the released recomputation had been
reading. The release record and tag are unmodified.

The check run at four consecutive boundaries was therefore reading disposable
local cache. That is the finding, not the digests.

### The blocker is a semantic contradiction, not missing work

All 16 remaining facets are architecture facets declaring
`implementation-conformance`, which means a subtest named for the facet that
**invokes the capability module**. An architecture property is not a behaviour
of a capability module, so the evaluator refuses such a subtest — correctly, by
the anti-self-warrant rule. Resolving it needs those facets to declare an
evidence class the architecture checker produces, and the evaluator to load it.

### The denominator is the deliverable

Reconciliation against the whole legacy application — 126 store actions, 185
API parameters, 33 payload serialisers, 12 routes, 5 functions, 86 locales, a
published OpenAPI document — found fourteen behaviours owned by no capability.
Revision 3 declares 58; revision 2 stays immutable at 44. An action denominator
beneath capabilities immediately earned itself by exposing two admin behaviours
that capability-level coverage could not show.

Two directive premises turned out to be wrong and are recorded as such: USF
already had 67 delivery contracts and 25 capability ports, so only nine were
genuinely absent; and the seven environments already existed, but as bare type
assertions with no posture, ordering or evidence requirements.

### Where it stops

Semantics, classification, enforcement and work derivation are complete and
checked. **No capability is implemented against revision 3**, the
integration-test environment is not instantiated, and staging and production
are unbound. Production-ready is not production-deployed, and neither is
claimed.

### The first experience is a chain, not a screen

`semantic capability → experience intent → Future Use Pattern → product
experience profile → design semantics → interaction/state contract →
implementation binding → Preact realisation → rendered evidence → adversarial
validation`. Preact sits at the implementation end and holds no semantic
authority: the state machine, the permitted transitions, the design roles and
the admissible parameter join are all framework-free and all projected from the
graph. Replacing Preact would not touch any of them.

### Profiles are documented

[`profiles.md`](profiles.md) records the three distinct things called a profile
— core realisation profiles, product realisation profiles and product profile
revisions — with each one's exact contract selection, why revisions exist
instead of edits, and the observed lane digests. It is a projection of the
graph, not authority.

### The suite was order-dependent and is not any more

Two test files planted violations into the shared working tree. Node runs each
test file as its own process, so the plants interleaved with the sibling file's
known-good assertion: the same suite passed twice and failed once, and the
failing test moved. A fresh clone showing 288/289 against the primary tree's
289/289 is what exposed it. Planting now happens in a disposable copy of the
real tree, with no assertion weakened. Ten consecutive clean runs in the
primary tree, three in the clone.

### The output boundary is real

Five declared-but-missing contracts are implemented against their ports, with
their real capability limits preserved rather than smoothed into false
symmetry: `svg-container` (encode, one frame, no rasteriser, row runs merged),
`png-container` (real chunks, CRC32, fixed deflate level for reproducible
bytes), `gif-container` (the only animated container; refuses a palette beyond
256 colours rather than quantising), `system-clock`, and `png-image-source` (a
real PNG decoder reversing all five filters; PNG only, because a lossy format
needs a DCT and is refused instead of approximated).

End-to-end proof: a real QR symbol is rasterised, encoded to PNG, SVG and GIF,
decoded back through the image source, resampled to a module grid, and decoded
by the codec to the exact payload. No mocked codec, no mocked container.

### The enforcement was worthless and is not any more

Probed before implementing: the old check asked whether *any* file existed
beneath the adapters component, so one file satisfied all six adapters, deleting
an adapter went undetected, and an empty file passed. Now each adapter resolves
to its own derived path, must be owned by a component in its declared layer,
must import the contract of every port it claims, and must bind an **exported**
annotated value — which proves the type checker is engaged, and tsc then decides
conformance. Twelve planted proofs cover missing port, missing adapter with a
sibling present, empty file, marker export, annotated-but-not-exported, port
bypass, wrong component, novelty, unknown port claim, and a compiler-backed case
where an incompatible adapter fails `tsc`.

### Drift enforcement is registered

`scripts/derive-anqr-architecture-rules.mjs` projects graph to product rules;
`tests/contract/anqr-architecture-rules-drift.test.ts` is reached by `npm test`
— placed in `tests/contract` deliberately, because `test:full` does not glob
`tests/conformance` and putting it there would have been another enumeration
blind spot. It fails on output drift and on authority drift, both planted, and
the graph is what wins. ANQR additionally refuses an incoherent projection
before computing any verdict.

### Next work item

**D5: decouple qualification from the account-tier receipt and justify its
lifetime.** Until it lands, the qualification gate D3 connected has nothing to
admit: the store holds one expired `UNQUALIFIED` record, `validitySeconds` is
900, and four of the suite's sixteen graders are `exact` string matches on prose.
Then D6 (census verdicts are unconditional literals), D7 (let groq earn narrow
code repair) and D8 (`rdf-semantics` has no suite case and no dispatch path).

Also open, unchanged: the ANQR architecture evidence-class contradiction (§6 of the acceptance record),
which is graph authority plus a USF source change through their own staged
chains. Then the testing rung, localisation, browser evidence and per-action
proof — all listed with what each needs in
[`acceptance/2026-09-04-anqr-testing-realisation.md`](acceptance/2026-09-04-anqr-testing-realisation.md).

### Open and honestly unfinished

- **Eight facets remain undecidable and were not turned green.** Two of them
  could have been argued and were not: `surfaceparity` has one surface where
  parity needs two comparable subjects, and `localeparity` has no locale
  resource — strings existing is not parity. The other six await evidence
  classes this lane does not produce.
- The architecture checker is a regex scanner, not a TypeScript AST parse. It
  over-reports and never under-reports; conformance is the compiler's call.
- ANQR's rules-integrity check cannot catch a coordinated edit that stays
  internally consistent; only the USF-side authority comparison can.
- No continuous integration exists in the product repository, so the
  order-dependence above was found by hand rather than by a second runner.
- One rendered surface exists. Android, iPhone, API and MCP realisations are
  modelled and unrealised.
- **Priority 1 publication debt stands unchanged.** The packet still reports
  `COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT` and
  `COMPLETION_POSTIMAGE_VERIFIER_PROOFBLOCKED:work-integration-transition:1`.
  All three declared versions of that Foundation verifier are proofblocked, so
  the byte-delta completion route cannot be published without implementing it
  or falsely claiming no-change. Neither was done, and neither was worked
  around.
- Nothing is pushed.

## Closed boundaries

Each boundary below is complete. Its reasoning lives in the commit message named
here, and its evidence in the acceptance record; neither is restated in this
ledger, which is the live operational state and not an archive.

| Closed | Boundary | Detail |
|---|---|---|
| 2026-09-04 | Provider surface evaluated; routing assurance programme landed (D1-D3) | [`acceptance/2026-09-04-provider-surface-evaluation.md`](acceptance/2026-09-04-provider-surface-evaluation.md) |
| 2026-09-04 | Foundation architecture declared and decidable; population classified; release assurance composed | [`acceptance/2026-09-04-architecture-assurance.md`](acceptance/2026-09-04-architecture-assurance.md) |
| 2026-09-04 | Corpus-wide assurances moved to repository scope | `31f2a88` |
| 2026-09-04 | Diagnostic boundary repaired; fourteen capabilities realised; closure 72 to 1 | [`acceptance/2026-09-04-anqr-testing-realisation.md`](acceptance/2026-09-04-anqr-testing-realisation.md) |
| 2026-09-04 | ANQR application denominator, delivery semantics and environment ladder | [`acceptance/2026-09-04-anqr-full-realisation.md`](acceptance/2026-09-04-anqr-full-realisation.md) |
| 2026-09-04 | First semantic experience realised in Preact; profiles documented | `c0dbf8f`, [`acceptance/2026-09-04-first-semantic-experience.md`](acceptance/2026-09-04-first-semantic-experience.md), [`profiles.md`](profiles.md) |
| 2026-09-04 | Test suite made order-independent; real-tree planting isolated | ANQR `f7c92a58c` |
| 2026-09-03 | Artefact output boundary closed; five adapters and the image-source port implemented | `8030d9d`, [`acceptance/2026-09-03-anqr-architecture-enforcement.md`](acceptance/2026-09-03-anqr-architecture-enforcement.md) |
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
