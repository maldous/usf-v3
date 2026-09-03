# Graph correctness proof — 2026-09-03

This is a status record. `GOAL.md` remains the normative directive.

The USF and ANQR graphs were exercised structurally, not narratively. Every
figure below is derived from committed bytes and reproducible by the commands
named. Where a property is proven, the proof is a planted defect that makes the
check fail; where a condition is merely observed, this record says so.

## What the exercise found, before any fix

Four defect classes, all previously invisible.

| Finding | Extent |
|---|---|
| The gate read the graph directory **non-recursively** | 14 of 21 authored sources checked; the entire ANQR product graph — 3 963 quads, 380 subjects — had never been integrity-checked |
| `usf transact` had the **same** loader | its guarantee that "the resulting corpus satisfies every integrity invariant" was only ever true of 14 of 21 sources, and a transaction writing an overlay path would have had its own postimage neither parsed nor checked |
| Predicates used without declaration | **126**, with 889 of the uses in the ISO 27001 governance layer |
| Subjects untyped and unreachable | **4** — the links of `urn:usf:execution-digest-chain:execution:1`, which named them only as ordered string literals |

The one real defect hiding in the unchecked region was
`urn:usf:type:OperatingIntent`, used by `urn:anqr:intent:hermes-bau:1` and
declared nowhere.

## Scope now checked

| | Before | Now |
|---|---|---|
| Authored sources | 14 | **21** |
| Quads | 28 685 | **32 681** |
| Subjects | 4 307 | **4 700** |
| Invariants | 13 | **16** |

`graph/fixtures/` is excluded deliberately: it is synthetic test input in its own
`urn:fixture:` namespace and is not corpus authority. Its three dangling
references and one undeclared type are fixture data and must not gate the
corpus.

## Correctness

16 invariants, **0 violations in owned graphs**, legacy debt 24 against a
recorded constant of 24, gate conforming.

```text
undeclared-type            dangling-reference        multiple-type-declaration
self-dependency            type-local-name-style     predicate-local-name-style
instance-local-name-style  iri-segment-shape         derived-type-authored
superseded-still-referenced-as-current               state-missing-reason
duplicate-quad             functional-predicate-conflict
undeclared-predicate       untyped-subject           disconnected-graph
```

The three new invariants are each planted-defect proven in
`tests/unit/graph/integrity.test.ts`. Writing those tests found a determinism
bug in the new code: components were ordered by size alone, which is not a total
order, so two equal-sized islands could swap between runs. Ordering is now size
then smallest member IRI, and a test asserts two runs agree.

## Completeness — nothing missing

| Property | Value |
|---|---|
| Predicates used but not declared | **0** of 1 283 |
| Types used but not declared | **0** of 206 |
| Subjects with no type | **0** of 4 700 |
| Unparsed source files | **0** of 21 |

All 126 undeclared predicates were declared: 113 core in `v3-convention.nq`, 13
product-scoped in `product-profile-vocabulary.nq`, following the corpus
convention that a declaration is one bare type quad.

## Connectivity — nothing unconnected

| Property | Value |
|---|---|
| Weakly connected components | **1** (was 5) |
| Nodes | 4 700 |
| Edges between defined subjects | 13 593 |
| Out-degree | min **1**, mean 2.89, max 671 |
| In-degree | min 0, mean 2.89, max 1 284 |
| Sinks (out-degree 0) | **0** |
| Sources (in-degree 0) | 1 571 |

Out-degree minimum 1 with zero sinks is the strong form: every subject in the
corpus says something about something else. In-degree 0 is legitimate — those
1 571 are roots.

A bound worth stating, because it limits what `disconnected-graph` can ever
mean: type-declaration edges make the corpus connected by construction. An
instance reaches its type, its type reaches the meta-type, and the meta-type is
in the vocabulary. A **typed** subject therefore cannot be an island however
little else references it; only untyped subjects, or subjects whose type is
undeclared, can be. This is asserted as a test.

### The 20 unresolved IRI references are out-of-model by design

They are not defects and are deliberately left:

- **11 named-graph labels** (`urn:usf:graph:*`). A named graph is the fourth
  quad component. It is never a subject, and referencing one via
  `conventionExemptGraph`, `targetNamedGraph`, `admissionGraph` or
  `stateReasonGraph` is correct.
- **9 wire schema identities** (`urn:usf:cli-error:1`, `urn:usf:contribution:1`
  and seven more). These are the `"schema"` string in JSON payloads. The
  declared `urn:usf:schema:*` resources point at them through `schemaIdentity`,
  so the graph resource and the wire identifier are deliberately distinct.

## Acyclicity

256 dependency-class edges (`dependsOn`, `requires`, `supersedes`,
`requiresPermission`, `implementsContract`) over 51 subjects, checked by
iterative three-colour depth-first search: **no cycle**. The Hermes work
dependency graph reports `acyclic: true` independently.

## Realisation

| Lane | Capabilities | Facets | UNSATISFIED / BLOCKED / STALE / NOT_ASSESSED | Verdict digest |
|---|---|---|---|---|
| core | 64/64 | 670, 548 satisfied | 0 / 0 / 0 / 0 | `e958768a…` |
| anqr | 39/39 | 180, 171 satisfied | 0 / 0 / 0 / 0 | `17d52953…` |
| composed | 103/103 | 850, 719 satisfied | 0 / 0 / 0 / 0 | `3a9fa0d6…` |

All three digests are byte-identical to the pre-removal baseline and reproduce
in a fresh clone with no historical source present. USF artefacts: 29 satisfied,
8 superseded, 0 authority-blocked, 0 drifted, frontier 0. ANQR profile
`current`, 14-resource closure, 0 drift. Hermes: ready 0, no blockers.

## The lane census, and what it explains

`urn:usf:realisation-lane-census:1` records a derived fact that changes how the
rest of the corpus should be read.

Of **34** resolving manifest-by-profile lanes across 12 manifests and 9
profiles, exactly **one** has full publication-policy coverage:
`graph/manifests/self-host-provider-v3.json` bound to
`urn:usf:profile:v3-self-host:3`, which reads **9 of 9 verified-complete**.
**184 of 208** work slots in the other lanes are uncovered.

Policy admission is a precondition for construction authority and for
completion: zero covering policies refuses `CONSTRUCTION_WORK_NOT_ELIGIBLE` and
`WORK_COMPLETION_NOT_ELIGIBLE`. So the other 33 lanes reporting outstanding work
is a **structural fact, not a backlog** — no amount of work completes a lane
whose works no policy admits. Four works carry no publication policy anywhere in
the corpus and are named on the census as uncoverable.

## Reproduction

```sh
./bin/usf graph integrity                                    # 16 invariants, 21 sources
./bin/usf hermes implement --manifest graph/manifests/anqr-with-foundation.json
./bin/usf profile status --manifest graph/products/anqr/manifest.json
./bin/usf status --profile PROFILE --manifest MANIFEST --detail full   # publicationPolicyCoverage
corepack pnpm run check                                      # 417/417
./scripts/verify-contained.sh                                # 9 containment rules
```

## Nonclaims

- A conforming report means these 16 enumerated invariants hold over these
  32 681 quads. It is not a claim that the corpus is semantically complete, that
  unlisted invariants hold, or that the modelling is the best available.
- Structural correctness is not semantic correctness. Zero dangling references
  says every reference resolves, not that any statement is true.
- The census is a point-in-time derivation and changes no authority. An
  uncovered lane is **not** a superseded lane: each remaining lane still needs
  its own recorded disposition, and only `v3-self-host` has one.
- 100 per cent typed subjects and one connected component are properties of the
  authored corpus, not of the ignored runtime state under `.usf/`.
- Excluding `graph/fixtures/` is a deliberate scope decision. Fixture defects
  are real defects in fixtures and are not corpus defects.
