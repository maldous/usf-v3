# USF V3 handover

## Latest bounded checkpoint — 2026-09-06

See [the Linear execution checkpoint](acceptance/2026-09-06-linear-execution-checkpoint.md) for current accepted source, timings, CLI validation and remaining proof gaps. Accepted carriers are `76a3adb9` (foundation definitions and full validation), `0051410e` (bounded qualification-reader integration), and `cf9dece8` (build/source-transfer/retained-semantics decisions). Eleven Linear tasks, including ANQ-4954 scope/decision work, are confirmed Done at this checkpoint. USF-1165 remains open because provider-contact authenticity, current installed-adapter observation and legacy routing currentness remain unresolved. USF-1182 lock consistency and its 11-case retained-identity regression are integrated at `ccd8fb7b`; its generic completion policy remains proofblocked. Actual clean offline bootstrap now refuses because 47 of 48 required full registry-metadata paths are absent; no network or trust-policy bypass is authorised. ANQ-4954 managed-service scope and its verified 73-resource UIF closure are committed in `08c73927`. USF-1188 is a separate isolated Atlas lane. Its capture-only observer contract/schema is now applied, and site-owned scoped implementation proceeds; no live reader or Atlas acceptance is claimed.

The existing Hermes supervisor was last read back live at cycle 70 at 2026-09-06 02:44 UTC; this is a dated runtime observation. USF-1177 runs bounded single-reviewer passes during this steward session. No persistent review timer is enabled: USF-1178 remains dependent on the unresolved USF-1162 acceptance boundary. Custom operator and continuous-review skills have been updated; they grant no runtime authority. Prospective job recording has resumed in the existing `.usf/metrics/programme-jobs.jsonl` ledger; missing older durations remain unknown. Preserve the existing ANQR edits and live Hermes; re-read current stewardship before mutation. No push, deployment, actual Claude takeover or whole-programme completion is claimed.

USF-1168 now has an independently accepted accounting definition and published current construction authority; exact work readback permits six source/test paths through integration. Implementation is still pending and completion remains proofblocked. Atlas inventory and local acceptance corrections continue in its isolated lane; no Atlas acceptance is claimed.

USF-1187 now has an independently accepted definition for finite exact product dependency adoption, applied by transaction ae5384379e4c8b847f830d511b2ec47485485410fa465cf492962945739022eb. Currentness/refusal are mandatory per-adoption records and the Node-only default remains intact. No package, product adoption or implementation reader is selected or activated; USF-1187 remains open.

USF-1176/1173 now have an independently accepted versioned job-lifecycle metric definition and schema, applied by transaction c690a6f236e3fd22dde6befe78e93f105f8bb4bc7ab56d849eb30e39b39ac8f5. This defines future record identity, clocks, unknowns and refusal rules; it does not admit the operational ledger or implement a recorder/reader. Both tasks remain open pending dispatch-accounting integration and governed instrumentation.

Atlas capture v2 resource semantics are applied by transaction a4ad7965d9717678b03c5b75c72ce729ee4444f78a9beffd2705486ffc70350a. The successor preserves v1 and binds the one-shot extractor to a temporary whole-process-group cgroup with 512 MiB memory, 100% CPU quota and 30 seconds wall time. CPU quota and wall time are not measured aggregate CPU milliseconds. Current captures use three named carriers; the schema maximum of eight is a ceiling, not eight-carrier qualification. Site consumer rebinding and browser acceptance remain pending.

The prospective operator timing helper was corrected and independently reviewed: exact argv digest/count and measurement identity are retained without raw arguments; command startup refusal and interruptions preserve their outcomes or uncertainty. Installed raw SHA-256 is 5578c65d26c46a640c8afe5e98942ed47a935c5432a16eff431974410913cf37. Three focused child outcomes (exit 0, exit 1, missing executable 127) were observed. These remain unadmitted operational observations; source identity, upstream tokens and acceptance are not inferred, and guarded stewardship commands retain their direct controlling parent. No persistent reviewer was enabled.

ANQ-4955 foundation selection is corrected by transaction bfcf63bb82a18105d4d622f3c6300755e600139c5cf90e8cca7c9242fe4e1e05: `graph/manifests/v3-delivery.json` now imports the existing delivery-environment authority. No product or foundation definitions were rewritten. Current revision 4 is selected explicitly with `./bin/usf profile closure --manifest graph/manifests/anqr-safety-assessment.json --binding urn:anqr:profile-foundation-binding:4`; it resolves all four formerly missing seeds, 133 resources, closure `sha256:a0cc287753cab77b536a26d21c41da78cbe75e6643b7b13735fcf1c47b8895ec`. The older application manifest still selects revisions 1–3 and cannot answer a revision-4 query. Current revision-4 status is `never-realised`; resolving authority does not create a product realisation, environment, deployment or completion record.

Measured current binding-4 closure and status jobs took 558955428 ns and 583323000 ns. A 633732031 ns isolated reader check verified that changing a selected foundation contract marks exactly that resource stale, while adding unrelated foundation and product resources leaves the closure/currentness unchanged. The fixture record existed only in a temporary directory and was removed. Exact private readback hashes: closure sha256:d29fc7ac2885f6567b58480793976155b3ce93a04dc307fe5ae397e8b6f9484d, status sha256:2caf89040a9284c48c3aaebab3a8a1dc5db9a06f54520afe2608e2a06ce66b42, directional check sha256:ff9af979a375e40655a818fb64e652864f8624bff849c412a72c47552c0fb18b. These observations do not claim product execution or work-output reuse.

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
| Qualified routes | **0** — the gate is connected, no longer expires, and has nothing to admit until the graders are repaired |
| Release assurance | CONFORMING; required 1, satisfied 1, missing 0, failed 0 |
| Closure | NOT_ASSESSED **72 → 1**; SATISFIED 719 → 775; capabilities fully satisfied 95 → **109** |
| Remaining (ANQR) | 15 BLOCKED + 1 NOT_ASSESSED, **all architecture facets**, one exact cause |
| Source accounting (ANQR) | 151 = 32 + 119 + **0 unaccounted** |
| Next | the ANQR architecture evidence-class contradiction, then the testing rung |

### A qualification no longer expires, and the CLI stopped hiding a command

Full record in
[`acceptance/2026-09-04-qualification-authority-and-cli-validity.md`](acceptance/2026-09-04-qualification-authority-and-cli-validity.md).

**The 900-second lifetime had no rationale.** `validitySeconds: 900` entered in
the same commit that set `probeFreshnessSeconds: 900`, and the decision record
justifies neither. They are different kinds of fact: whether a route answers now
decays, whether a model demonstrated competence does not. The routing replay had
decided it by identity all along — comparing corpus, policy and route digests and
never the clock — and only `observeQualifiedTaskClasses` disagreed. The newer
consumer now agrees with the established one, and the time parameter is gone, so
wall-clock expiry is unrepresentable rather than merely absent.

**The graders are why nothing qualifies, and eight of sixteen leak the answer.**
Run for real: `groq:openai/gpt-oss-120b` answered all four typescript cases and
passed one — the `json-schema` one. Eight cases require the model to reproduce
USF's own private vocabulary the prompt never supplies. One asked for the
TypeScript immutability modifier, got "The modifier is `readonly`", and scored
zero. The repair is designed in §4 of the record and **is the next step**; it
touches `config/qualification.json`, a different owner, and was not rushed into
this chain.

**`probe qualify` was implemented, reachable, and absent from help** — while the
command's own refusal message named it. `profile build`, `export` and `import`
were implemented, registered in the graph, and likewise absent. All four are in
help now, and a test asserts the dispatcher and help agree in both directions.

**Every provider adapter argv was validated against the installed CLI** — claude
2.1.251, codex-cli 0.152.0, agy 1.1.26 — flags and accepted values. All valid.
One doc defect fixed: the claude adapter's comment claimed a `--max-turns` flag
that its own inline comment three lines below said does not exist.

### `rdf-semantics` is outside Hermes, and no grader should be added for it

`modelCapability` on a work packet and `requiredCapability` on a dispatched unit
are different predicates. All nine `rdf-semantics` packets were realised through
the staged chain by an operator, not dispatched; Hermes has three prompt shapes
and none asks for N-Quads. Not stale, not a backlog, not a qualification gap.

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

**Repair the qualification graders.** The freshness half of D5 is done; this is
the half that still blocks everything. Eleven of sixteen graders are brittle and
eight leak USF's private vocabulary as the expected answer, so no model can
qualify for reasons unrelated to competence. The replacement is designed
case-by-case in §4 of the record, needs no new grader kind, and must keep grading
pure because `routeWork` replays it. Owner: `provider-semantic-qualification`.

Then run the suite across the authorized population, and only then decide whether
to propagate `modelCapability` into dispatched `requiredCapability` — turning that
on today would stop dispatch entirely, since nothing is qualified.

Also open: D6 (census verdicts are unconditional literals), the `usf graph`
refusal message that omits `lanes`, and the `RegisteredCliCommand` gap (27 of
about 74 surface points declared).

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
| 2026-09-04 | Qualification freshness repaired; CLI surface validated and reconciled | [`acceptance/2026-09-04-qualification-authority-and-cli-validity.md`](acceptance/2026-09-04-qualification-authority-and-cli-validity.md) |
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

## Architecture evidence-class rebinding (2026-09-04)

USF `1ae1373`, clean. ANQR `585f25057`, clean. Hermes live on
`graph/manifests/anqr-application.json`, authority
`sha256:ba5913a41d71206f5be4c034253507944c042310e581a351018a00296bd775c3`.

**What was wrong.** Fifteen ANQR architecture requirements declared
`admissibleEvidenceClass "implementation-conformance"` while declaring a corpus
`requirementScope`. The class admits only a subtest named for the requirement
that invokes one capability module, and no export of one module knows what the
others import, so the artefact Hermes was asked for could not be written
truthfully. Eight capabilities spent five repair rounds each on it. The control
case proves the mechanism was never the problem: `architecturesurfaceparity` is
the one architecture concern expressible as a call on a module's own exports,
and BAU generated and satisfied it in a single cycle.

**What changed.** Corpus requirements are now observed at corpus scope through a
declared `CorpusObservationProcedure`. Nothing was invented: `structural-observation`
is the class the foundation's own architecture requirements already declare,
`assurance-scope:corpus`, `conformanceProcedure` and `requirementClass "structural"`
already existed, and ANQR already had a checker returning a per-facet verdict
over the real tree. Only the path from that evidence to the evaluator was
missing. Observations execute through the same confinement as every other check
and are recorded bound to a digest of exactly the corpus they observed.

**Result.** Architecture facets `BLOCKED 15 → 4`, `SATISFIED 1 → 12`, with
`UNSATISFIED`, `STALE` and `NOT_ASSESSED` all 0. `repairExhausted 8 → 0` on
every manifest. All four manifests are at `ready 0`.

**The four that remain BLOCKED are correct, not a backlog.** Static type
correctness, build correctness and deterministic artefact production each need
a child process, and an observation runs inside a confinement that grants none,
so the declared procedure records them undecided rather than passed. Deciding
them needs an observation vehicle that may spawn the toolchain — a real
follow-up, and not something to fix by loosening the confinement. Locale parity
is required and unrealised; no procedure should assert it until it is built.

**Separate reporting defect, not causal here.** `src/commands/hermes-implement.ts:697`
sets `dispatchedUnits: pending.length` while actual dispatch is gated on
`envFile !== null` near line 490, so a credential-free run reports units
dispatched having contacted no provider. Same class as the D6 census literals.
Unowned and unrepaired.


## The four remaining architecture requirements (2026-09-04)

USF `eae26c0`, clean. ANQR `915e03a14`, clean. Hermes live on
`anqr-application`. Architecture facets `SATISFIED 14`, `BLOCKED 2`,
`UNSATISFIED 0`, `STALE 0`. All four manifests `ready 0`, `repairExhausted 0`.

They were not four of a kind:

- **Deterministic artefact production — wrong assumption, now decided.** It was
  grouped with the subprocess requirements on the belief that determinism meant
  repeating the build. Artefact production is a library call with an injectable
  clock, so the corpus procedure produces one specification twice and compares
  bytes.
- **Static type correctness — real, and the authority already existed.** Every
  conformance run already shells to USF's own locked `tsc` outside the
  confinement, on the stated ground that it reads sources and never executes
  them. That exemption is now declared: a `CorpusToolObservationProcedure` names
  a host tool carrying `tool-execution-class:source-reader`.
- **Build correctness — real, and deliberately still blocked.** The declared
  build executes the corpus, so it does not carry the reader class. Deciding it
  needs an execution authority for a tool that runs product code. That is an
  operator decision, not an inference from the requirement being blocking.
- **Locale parity — real, unrealised, correctly blocked.** No locale resource
  exists in the product repository. The 86 resources at 1676 keys each are
  legacy evidence and the graph already records bringing them across as an
  unresolved delivery decision with a known denominator. Hermes must not derive
  work for it: a generated string table would evidence nothing.

**The reader-tool authority, and its limits.** Tool must be a declared
`HostToolDependency` carrying the source-reader class; operation selects a fixed
argument template held in implementation, so no argument comes from the graph;
executable path must be repository-relative inside USF's locked dependencies;
environment carries no PATH; time and output bounded; absent tool records a
refusal. It is **not** network-sandboxed the way the bwrap vehicle is — the
grant rests on the tool being a reader, not on isolation. Every observation
record now names the authority it ran under, and one naming neither is
inadmissible.

**Do not put a declaration a product profile needs into `graph/semantic-first.nq`.**
It is currentness-bound: nine quads there failed fifteen transition and
publication tests with `TRANSITION_CURRENT_POSTSTATE_MISMATCH`. Foundation
vocabulary a product imports belongs in `graph/architecture-assurance.nq`.


## Grader semantics (2026-09-05)

USF `5b86ab5`, clean. ANQR `915e03a14`, clean and untouched — this lane is
foundation-only. Architecture facets unchanged at `SATISFIED 14`, `BLOCKED 2`.
Hermes live throughout, cycle 188, blockers 0.

**What a grader is, now stated.** Each kind declares what it asserts, its
judgement mode — comparison, selection, structural-validation or
marker-detection, and deliberately never *proof* — and the dimensions it is
competent to judge. A grade is one of PASS, FAIL, REFUSAL, INAPPLICABLE or
INSUFFICIENT_EVIDENCE with a machine-readable diagnostic. Only PASS scores, and
an unjudgeable case stays in the denominator: dropping it would raise the score
of a suite that failed to ask the question.

**The audit is mechanical and reproduced the manual one exactly** — eleven of
sixteen cases defective: four whose grader could not judge the dimension, one
whose options no prompt supplied, and eight requiring vocabulary private to this
repository. Eight cases repaired to be answerable from what they state; thirteen
of sixteen are now clean with **zero hard defects**. The remaining three require
recall of general engineering knowledge, which is legitimate and is reported
rather than hidden.

**Anti-circularity is structural, not asserted.** Grading is a pure total
function of case and answer, proven against the source so no later edit can
reach a clock, a filesystem or a provider. No grader can ask a model, so model
agreement can never become evidence. One answer evidences one case: reuse across
cases now evidences nothing, so a single generic response cannot be multiplied
by several graders happening to accept it.

**Hermes did not exercise the grader path, and cannot.** All three dispatch
sites set `requiredCapabilities: []`, so ordinary BAU requests no task class —
verified: the newest qualification record predates the running supervisor by
hours. The gate is connected and binds nothing, which remains the intended
state. It binds when a supplied work graph declares `requiredCapability`, or if
`modelCapability` is ever propagated into dispatched units — still an unmade
decision, and not one to make by manufacturing work to demonstrate a mechanism.

**The suite moved to 1.1.0**, which supersedes stored qualification by design: a
changed case changes what the task class means. Nothing was lost — the two
stored records carry no corpus binding at all and were already inadmissible.

**Editing `config/qualification.json` refuses `usf route` until it is committed**
(`ROUTE_QUALIFICATION_AUTHORITY_UNCURRENT`): the authority is compared against
the Git-indexed blob, not the working tree.

