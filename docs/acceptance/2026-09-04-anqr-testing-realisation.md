# ANQR revision-3 realisation through development — acceptance record

Date: 2026-09-04. USF and ANQR carriers clean, nothing pushed.
Release boundary: `hermetic-release-1` = `9e6239e`, untouched.

## 1. Starting identities

Measured: USF `1ea8b98`, ANQR `dde40c738`, both clean, one worktree each.
Revision 3 at 58 capabilities, 60 ApplicationActions, Hermes deriving 104
capabilities / 922 facets / 72 NOT_ASSESSED / frontier 1.

## 2. The CLI diagnostic defect, repaired

**Twenty** domain error classes carry a stable `reasonCode` and only `UsfError`
survived the command boundary. The invariant now: an error is a semantic
refusal **if and only if** it already carries a stable machine-readable reason
code; everything else is `INTERNAL_ERROR`, and nothing of an unexpected
failure's own text reaches the envelope.

Landed through the full staged chain, not by editing `src/` directly — graph
authority, construction evidence, construction proof, an applied
construction-authority grant, resolve, apply, a passing graph-selected check,
`integrate --dry-run` with confined postimage validation, then `integrate`.

Four refusals along the way were the mechanism working: `WORK_WRITE_NOT_PERMITTED`
for the command entry point, which three packets already own; then missing
`permitsWrite`, `privacy` and `targetRuntimeProvider` declarations.

Proven end to end in the primary tree:

| case | reported |
|---|---|
| missing manifest (non-`UsfError`) | `MANIFEST_UNREADABLE` |
| `--ready` without a profile (`UsfError`) | `REALISATION_PROFILE_REQUIRED` |
| duplicate graph IRI — **the original defect** | `MANIFEST_DUPLICATE_SOURCE_OR_GRAPH` |
| a real `TypeError` | `INTERNAL_ERROR`, carrying none of its text |

Planted and refused: a sentence, a stack trace and a class name each offered as
a reason code.

## 3. A derivation defect that made the whole denominator invisible

Before any capability could be realised, Hermes derived **104 needs and not one
was new**. Twenty-two predicates in the previous boundary's capability source
were authored in the product namespace where the pre-existing forty-four use
the foundation namespace. The derivation reads `urn:usf:predicate:declaresFacet`
and `definesCompletionFor`, so all fourteen new capabilities were unreachable —
while the graph was internally consistent and every closure check passed,
because they all matched on local names.

Repointed 657 quads. Hermes then derived **118 capabilities, 30 units, 15
ready**. Two new checks make this unrepeatable: one asserts the predicates the
derivation reads are in the foundation namespace, the other asserts end to end
that no capability declaring an APPLICABLE facet is unreachable by any
derivation.

## 4. Capability implementation: 14 of 58 newly realised

The fourteen capabilities revision 3 added are implemented against their 56
declared facets, with 56 conformance subtests exercising the behaviour. Not
scaffolds: the limiter refuses before the handler runs and fails closed; the
entitlement keeps absent, malformed and expired apart; GIF refuses structured
metadata by naming field and container; every excluded cache parameter is
proven unable to change the bytes; the whole core journey runs with no network;
lookup and manual entry produce identical payloads; telemetry sanitising is a
whitelist so a parameter added tomorrow is not emitted.

The other 44 were already landed at the 39/39 baseline plus core.

## 5. Closure progression

| measure | before | after |
|---|--:|--:|
| NOT_ASSESSED | 72 | **1** |
| SATISFIED | 719 | **775** |
| capabilities fully satisfied | 95 | **109** |
| capabilities with remaining work | 23 | **9** |
| derived units | 2 (blind) → 30 | 2 |
| ANQR tests | 297 | **367** |
| USF tests | 470 | **484** |

## 6. The remaining 16 facets, with an exact blocker

All 16 are `architecture` facets, and the blocker is a **semantic
contradiction**, not missing work.

They declare `admissibleEvidenceClass: implementation-conformance`, which the
evaluator defines as an executed subtest named for the facet **that invokes the
capability module**. An architecture property is not a behaviour of a capability
module. Subtests were written that run the real mechanism — the checker over the
real tree, `tsc`, the declared build, byte-identical repeat production, a real
round trip, a refused parameter join, a rendered surface's accessibility — and
the evaluator classified every one as inadmissible. **It was right to**: that is
the anti-self-warrant rule which stops an implementation authoring its own
evidence.

The tests were kept, because they exercise real properties, and renamed so they
describe what they do rather than naming a facet they cannot discharge.

Resolving this needs the architecture facets to declare an evidence class the
architecture checker actually produces, and the evaluator to load it. That is
graph authority plus a USF source change, each through its own staged chain.

`architecturelocaleparity` was deliberately excluded from the attempt: it is
required-and-unrealised, and asserting it would be the one thing forbidden.

## 7. External Deployment Decision Record

Eleven decisions recorded, each with the contract requiring it, its allowed
shape, affected environments, supplying authority, the evidence it unlocks and
whether it is secret. Three are secret and appear as a resolver and a
consequence, never a value. The platform the legacy application used was
discovered, not selected, and discovering it grants no authority to choose it.

## 8. A released digest reproduction that no longer reproduces

**This is the most important negative finding of this boundary and it is
stated first rather than last.**

Two of the three released verdict digests no longer recompute to their released
values on this machine:

| lane | released | recomputes to |
|---|---|---|
| core `v3-delivery` | `e958768a…` | `e958768a…` — **unchanged** |
| `anqr` | `17d52953…` | `b3791738…` |
| `anqr-with-foundation` | `3a9fa0d6…` | `d628de30…` |

Cause, established by measurement rather than inference: **nothing tracked
changed.** Neither manifest contains any source added in this or the previous
boundary. The movement came from `.usf/conformance-evidence`, which is
gitignored disposable state. Executing conformance for the ANQR lane superseded
the cached records that the released recomputation had been reading, and
`recordConformanceRun` removes superseded records. They are not recoverable
here: regenerating them would need the ANQR tree at its release commit and the
authority snapshot of that time, which has since moved.

What is intact: the release record `2026-09-03-hermetic-release-proof.md` is
unmodified since `704d89e` and still carries all three digests; the annotated
tag still points at `9e6239e`; the core lane still recomputes byte-identically.

What this also shows: the "byte-identical" check run at four consecutive
boundaries was reading disposable local cache. A reproduction that depends on
ignored state is weaker than it looked, and saying so is worth more than the
four green checks were.

## 9. Not done in this boundary

- **60 ApplicationActions are not individually proven.** Capability-level
  evidence exists; per-action executable evidence does not.
- **The testing rung is not instantiated.** No composed environment was stood
  up, so no capability holds a testing-rung verdict.
- **Localisation is not realised.** 86 locales at 1676 keys remain legacy
  evidence; the current semantic message denominator was not derived.
- **No browser-rendered or human visual evidence** at any viewport class.
- **The browser journey was not extended** beyond the one proven slice.
- **No immutable build candidate** was produced with a recorded provenance set.
- Staging and production remain externally blocked, correctly.

## 10. Boundaries

`hermetic-release-1` untouched at `9e6239e`. Live provider lane `2e6a4780`
with both frontiers at 0. Priority 1 publication debt unchanged. Source
accounting 151 = 32 + 119 + **0 unaccounted**. USF 484/484, ANQR 367/367,
`validate` exit 0. Nothing pushed.
