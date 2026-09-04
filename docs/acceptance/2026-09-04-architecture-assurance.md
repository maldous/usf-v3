# Architecture assurance: the foundation measures itself

Closed 2026-09-04. Carrier `usf-v3` on `anqr-experience-realisation`.

## 1. The semantic gap, measured before anything was written

`graph/architecture-assurance.nq` already held a product-neutral architecture
vocabulary: twenty types and forty-two predicates covering style, layers,
components, ports, adapters, dependency direction and its three rule kinds,
module boundaries, circular dependency policy, framework isolation, dependency
scope, generated code boundaries, test boundaries, requirement severity,
verification class, enforcement binding, enforcement drift and adversarial
verification. It was not a gap in architecture vocabulary.

It had **zero foundation instances**. Every instance in the corpus belonged to
one product overlay: one style, five layers, ten components, six ports, five
adapters, sixteen dependency rules and fifteen facets, all `urn:anqr:`. The
foundation had never stated its own architecture, so nothing could be measured
against anything. Three of the twenty types had never been instantiated by
anyone: `EnforcementBinding`, `EnforcementDriftCheck` and
`AdversarialVerification` — which is to say the corpus could declare a rule and
had no way to say what proved it or what had been shown to break it.

What was genuinely missing was the machinery that makes a declared architecture
*decidable*:

| missing | why nothing else covered it |
|---|---|
| a declared root | reachability has no meaning without one, and a launched subprocess or a build-time recipe is invisible to import analysis |
| a declared population | a validator that checks everything it discovered, having failed to discover a subtree, has proved nothing about the whole |
| classifications with criteria | "unused file equals defect" is wrong and "unused file is fine" is worse; the difference is whether somebody decided, in the graph |
| an assurance scope | a confined candidate cannot see a corpus property, and the two wrong answers are a vacuous pass and a failure that blames the confinement |
| a composable assurance set | a release cannot depend on evidence it cannot name |
| a fail-closed absence disposition | missing evidence must be distinguishable from failed evidence |

## 2. Concepts reused, unchanged

`Requirement`, `SemanticContract`, `Evidence`, `EvidenceClass`,
`EvidenceRequirement`, `ConstructionEvidenceRequirement`,
`CompletionEvidenceRequirement`, `ProofObligation`, `ProofAlgorithm`,
`ProofResult`, `RealisationPermission`, `WorkPacket`, `AcceptanceCriterion`,
`TestObligation`, `EnvironmentApplicability`, `RealisationProfile`,
`ValidationRuntimeClosure`, `ConstructionAuthorityPublicationPolicy`,
`NoChangeWorkCompletionPublicationPolicy`, `SemanticPublicationAlgorithm`,
`CompletionDerivationRule`, `IntegrityInvariant` — plus the whole
architecture-assurance vocabulary above, including `RequirementSeverity`,
`VerificationClass`, `EnforcementBinding` and `AdversarialVerification`, which
this lane instantiates for the first time.

An architecture verdict travels the same evidence and proof machinery as every
other claim in the corpus. There is no parallel proof system, no new lifecycle
and no architecture layer: architecture is a dimension travelling through the
existing stages.

**No orphan-finding type was added.** An orphan is an implementation unit whose
classification is declared non-conforming, and the finding is the requirement
that reports it. A parallel finding type would have carried the same fact twice.

## 3. Concepts added

Fifteen types and thirty-two predicates, in `graph/architecture-conformance.nq`
(1 189 quads, named graph `urn:usf:graph:architecture-conformance`).

`RuntimeEntryPoint`, `EntryPointSurface`, `ImplementationPopulation`,
`ImplementationUnit`, `ImplementationClassification`, `ClassificationCriterion`,
`ImplementationDispositionDecision`, `ImplementationDenominator`,
`RuntimeReachabilityObservation`, `ConformanceProcedure`,
`ArchitectureConformanceVerdict`, `ArchitectureConformanceDisposition`,
`AssuranceScope`, `AssuranceSet`, `ReleaseAssuranceClaim`.

Two names were rejected on measurement rather than taste: `conformanceRule` and
`scopeRule` already existed in `v3-convention` as prose-valued predicates, and
overloading either would have made the same predicate mean two things. The
selector predicate is `conformanceProcedure`; the existing `scopeRule` is reused
for its existing purpose.

### The universal instances

Six entry point surfaces, and only one of them does not contribute to runtime
reachability: `validation-harness`. Treating a test as a runtime root would make
every unused module reachable and the whole reachability claim vacuous, so the
surface exists and says so.

Seven classification criteria, eight classifications with declared precedence,
nine conformance procedures, five dispositions, two assurance scopes, and one
new evidence class — `structural-observation`, which proves "the implementation
had this structure at the exact population digest the observation carries" and
cannot prove "that a reachable unit is ever executed, or that an unreachable
unit has no consumer outside this repository".

## 4. The foundation's architecture, declared as measured

`urn:usf:architecture:1`: seven layers, twelve components, and a **complete**
forty-two-rule direction matrix over the layers — twenty-two permitted,
twenty forbidden. Completeness is what turns a new import into a finding rather
than a discovery: a direction that is neither permitted nor forbidden cannot
exist.

It is declared as it is, not as a stricter architecture would prefer:

- the realisation and provider layers both reach the command surface, because
  both reuse the registered check boundary rather than re-implementing it;
- the semantic layer reaches the realisation layer, because work derivation
  reads basis, transition and authority state to report a packet stage;
- the primitives layer reaches the semantic layer once, because product
  repository authentication resolves declared layout from the graph.

Each is declared with the measured reason. Tightening one is an architecture
change with its own work, not a correction to this declaration.

**Cycles.** Fourteen units sit in import cycles, all on the work-derivation and
realisation seam. `cyclesPermitted` is `false` with those fourteen enumerated as
a bounded exception: measured debt, declared as a ceiling. Leaving a cycle needs
no permission; joining one is a violation.

**Assurance isolation.** `src/architecture/` is a declared module boundary
scope, not a component. Nothing in the foundation may import it. An assurance
module its own subject depends on can be made to pass by the code it checks,
which is how permanently green output becomes indistinguishable from a check
that observes nothing.

## 5. Evidence-producing mechanisms, and the fact that they are replaceable

Three modules, named by one `EnforcementBinding` and by nothing else:

| module | role | consults a requirement? |
|---|---|---|
| `src/architecture/declaration.ts` | quads to model. Pure; no filesystem, no repository path | no |
| `src/architecture/observe.ts` | tree to facts: units, edges, reachability, cycles, digests | no |
| `src/architecture/conformance.ts` | model plus facts to verdict | yes, and takes every decision from the graph |

The observer is a textual import scan. It over-reports an edge inside a comment
or a string and never under-reports a real one, so it can only add a finding —
the safe direction. Anything the compiler decides remains the compiler's call,
and `tsc` runs over the same tree.

Replaceability is asserted rather than asserted-about: the same structural facts
supplied under a different producer identity yield a byte-identical verdict, in
both the confined and the corpus lanes.

No tool is named in the graph. The enforcement binding names repository modules
and one invocation; it names no analyser, and `enforcementTool` is deliberately
absent.

## 6. Denominator and reachability, against the real tree

Population: every `.ts` module beneath `src/` and `recipes/`, enumerated
recursively, **no exclusions**. Product implementation and assurance tooling are
inside the denominator and carry a classification instead, because a denominator
with an exclusion is one somebody can quietly widen.

### Declared runtime roots — five

| root | surface |
|---|---|
| `src/cli.ts` | runtime-command |
| `src/commands/provider-hosts.ts` | launched-subprocess |
| `src/commands/provider-parallel.ts` | launched-subprocess |
| `src/commands/provider-receipts.ts` | launched-subprocess |
| `recipes/self-host-path-scope.ts` | build-time |

### Measured denominator — 171 units, 0 unaccounted

| classification | units |
|---|---|
| runtime-reachable | 96 |
| product-declared | 64 |
| assurance-tooling | 3 |
| declared-realisation-artefact | 3 |
| superseded-retained | 3 |
| validation-support | 2 |
| generated | 0 |
| **unexplained-orphan** | **0** |

493 internal import edges, 0 unresolved, 14 cycle members, 0 absent roots.

### The eleven units no runtime root reaches, and each disposition

| unit | disposition | the fact that decided it |
|---|---|---|
| `src/continuous/scheduler.ts` | declared-realisation-artefact | `writePath` of `urn:usf:work:provider-parallel-execution` |
| `src/core/asset-index.ts` | declared-realisation-artefact | `writePath` of `urn:usf:work:file-asset-index` |
| `src/providers/qualification-observation.ts` | declared-realisation-artefact | `writePath` of `urn:usf:work:provider-task-qualification` |
| `src/continuous/fake-provider.ts` | validation-support | `repositoryReadFile` of `urn:usf:validation-runtime-closure:provider-parallel-execution:1` |
| `src/continuous/index.ts` | validation-support | same closure |
| `src/core/envelope.ts` | superseded-retained | disposition decision, superseded by the realisation basis |
| `src/core/dependencies.ts` | superseded-retained | same decision |
| `src/collaboration/index.ts` | superseded-retained | same decision |
| `src/architecture/conformance.ts` | assurance-tooling | named by the enforcement binding |
| `src/architecture/declaration.ts` | assurance-tooling | same |
| `src/architecture/observe.ts` | assurance-tooling | same |

Plus 64 modules beneath `src/capabilities/`, deferred to the product profile
that writes that root, with the owner named. Deferring judgement is not
deferring accounting: they are counted, and the foundation still asserts that
none of its own implementation depends on them.

None of these paths appears in any requirement or in the observer. Every
disposition is a graph fact resolved by a criterion.

## 7. The two named orphans, and the one that was not

The lane was asked to use `src/continuous/scheduler.ts` and
`src/continuous/fake-provider.ts` as the first real observations. Both emerged
from the denominator without being named anywhere, and both turned out to be
declared: one is a completed work's write path, the other a declared validation
runtime closure member. Deleting either would have broken a declared write set
to tidy a tree.

A third unit is the honest result of this lane. Under a `src/`-only denominator,
`src/providers/index.ts` was reached by nothing — not the runtime, not the
graph, not the tests — and every module it re-exported was separately reachable.
It was measured as an unexplained orphan and the conclusion was to retire it:

```
disposition: ARCHITECTURE_CONFORMANCE_FAILED
population: 170 orphans: [ 'src/providers/index.ts' ]
 - foundation-runtime-reachability ARCHITECTURE_CONFORMANCE_FAILED
   [ 'implementation unit is reachable from no declared runtime entry point
      and carries no legitimate classification: src/providers/index.ts' ]
```

Deleting it broke the typecheck. `recipes/self-host-path-scope.ts` imports it —
a declared write path of a completed work, a legitimate build-time surface, and
a consumer the denominator had not been widened to include. **The denominator
was wrong, not the module.** The repair was to declare the root and widen the
population to `recipes/`, after which the unit is runtime-reachable and nothing
is deleted.

This is the same class of defect as a non-recursive directory walk, one step
further out: a denominator that stops short of a *consumer* reports live
implementation as abandoned. The model preventing a wrong deletion is a better
result than the deletion would have been, and the population declaration
records why `recipes/` is in scope so the next reader does not have to
rediscover it.

## 8. Injected negative-case proofs — twelve declared, twelve exercised

Every `AdversarialVerification` in the graph is planted in the confined
validation against a synthetic hexagonal corpus, shown to produce the exact
declared disposition, and discarded with the fixture. The fixture is also where
the vocabulary's ports, adapters and `requires` rule are exercised, because the
foundation has none.

| planted | expected | observed |
|---|---|---|
| domain importing an adapter | ARCHITECTURE_CONFORMANCE_FAILED naming the edge | ✔ |
| adapter implementing no port | required dependency absent | ✔ |
| unreachable unit nothing explains | orphan named | ✔ |
| criterion with no decision procedure | reported, not fallen through | ✔ |
| unit under no component or boundary | coverage gap named | ✔ |
| cycle outside the exception | both units named | ✔ |
| judged unit importing deferred implementation | boundary breach named | ✔ |
| deferment with no owner | abandonment named | ✔ |
| component importing the observer | boundary crossing named | ✔ |
| entry point resolving to nothing | stale root named | ✔ |
| unresolved relative import | resolution failure | ✔ |
| observation from another tree | ASSURANCE_EVIDENCE_STALE | ✔ |
| observation against another declaration | ASSURANCE_EVIDENCE_STALE | ✔ |
| requirement with an unimplemented procedure | ASSURANCE_EVIDENCE_MISSING | ✔ |
| corpus requirement on a confined observation | ASSURANCE_SCOPE_UNSATISFIED | ✔ |
| release claim with no verdict | ASSURANCE_EVIDENCE_MISSING | ✔ |
| release claim with a failed verdict | ARCHITECTURE_CONFORMANCE_FAILED | ✔ |
| observer replaced | identical verdict | ✔ |

The three dispositions that are neither a pass nor a failure are each asserted
to be *neither*, not merely to be themselves.

One control matters as much as the failures: an unreachable unit an explicit
disposition decision retains is classified rather than reported, and reversing
one classification's declared precedence reverses the assignment with no code
change. The precedence lives in the graph.

## 9. Scope, and why the corpus claim is not made in the candidate

All nine requirements are declared at `urn:usf:assurance-scope:corpus`. The
graph-selected validation for this work is confined to a candidate workspace,
which materialises the declared closure and nothing else, so it asserts nothing
about the real tree at all: it proves the model, by breaking it.

Evaluating the assurance set against a confined observation yields
`ASSURANCE_SCOPE_UNSATISFIED` for every member and a conforming verdict for
none. That is the correct answer, and it is the generalisation of the previous
lane's finding — where two corpus properties asserted inside a candidate failed
on an absence the confinement caused, and tolerating that failure would have
passed vacuously over a tree the test never read. Scope is now a semantic
property of the evidence relationship rather than a lesson someone has to
remember.

## 10. Release-gate integration

`urn:usf:release-assurance-claim:foundation:1` depends on
`urn:usf:assurance-set:foundation-architecture:1` and declares its
absent-evidence disposition explicitly.

```
RELEASE CONFORMING  required 1  satisfied 1  missing 0  failed 0
```

With no verdict supplied: `missing [foundation-architecture]`, disposition
`ASSURANCE_EVIDENCE_MISSING` — never conforming, and never confused with a
failure. With a failing verdict: `failed [foundation-architecture]`, disposition
`ARCHITECTURE_CONFORMANCE_FAILED`. Both are asserted in both lanes.

The claim is not itself a release gate. It states what a release must be able to
show; binding it into a release profile is separate work and is not claimed.

## 11. Validation and test results

| gate | result |
|---|---|
| `node --run check` (typecheck plus full suite) | **564 pass, 0 fail** |
| new tests added by this lane | 36 (24 confined model, 12 corpus) |
| graph-selected confined validation, in the cage | pass, exit 0 |
| integration postimage validation | pass, no timeout |
| `usf graph integrity` | `gateConforming true`, owned violations **0**, legacy 24 of 24 accepted debt, 57 sources, one component |
| `scripts/verify-contained.sh` | pass, all nine rules |
| architecture conformance verdict | **CONFORMING**, 9 of 9 requirements |
| release assurance composition | **CONFORMING** |

Blast radius, measured rather than assumed: eleven lanes derived before and
after the whole chain are byte-identical, including both previously
verified-complete lanes. The lane is a single-contract profile with a disjoint
sibling publication policy pair, so it cannot stale a cohort.

## 12. Publication chain and identity

| step | result |
|---|---|
| `usf transact` (graph authority, three files) | applied, `conforming true`, owned violations 0 |
| `usf work` | `construction-ready`, `active-permission`, `maximumThrough integrate` |
| `usf evidence construction` → `usf prove construction` | pass, no reason codes |
| `usf publish construction-authority` | verified twice identically, then applied |
| `usf resolve` → `usf apply` | candidate `sha256:eb821b22…` |
| `usf check` | pass, receipt bound |
| `usf integrate --dry-run` → `usf integrate` | `urn:usf:outcome:integration-success`, fast-forward |
| second construction grant at the postimage basis | pass; the first is left exactly as published |
| `usf realise no-change` → `usf check` | `ready-for-validation`, pass |
| `usf evidence completion` → `usf prove completion` | `verified-no-change`, pass |
| `usf publish work-completion` | verified twice identically, then applied |
| `usf work` | **`verified-complete`**, no reason codes |

Integration moved the packet's scoped dependency digest and staled the grant
that authorised the contribution, exactly as the copy-on-write rule requires. A
real byte-delta contribution costs two grants; the first was not repaired.

## 13. Nonclaims

- A conforming verdict is a statement about structure at one population digest.
  It does not claim the implementation behaves correctly, that a reachable unit
  is ever executed, or that an unreachable unit has no consumer outside this
  repository.
- The observer is a textual scan, not a type-checked parse. It over-reports and
  never under-reports.
- The release claim is declared and composable. It is not wired into a release
  profile, and no release is claimed here.
- `generated` is an admitted classification with no instances, because the
  foundation declares no generated code location. The boundary exists so that
  introducing generated implementation is a graph edit with a stated consumer
  rule.
- Six architecture-assurance types remain uninstantiated for the foundation.
  `ArchitecturalPort` and `ArchitecturalAdapter` are absent because the
  foundation is not a ports-and-adapters architecture, and the confined fixture
  exercises both. `DependencyScopeRule`, `FrameworkIsolationRule`,
  `TestBoundaryRule` and `EnforcementDriftCheck` are real gaps: the foundation
  states no runtime-versus-development dependency scope, no technology
  isolation, no per-class test boundary and no enforcement drift check. Each is
  expressible today and none is claimed as covered.
- Nothing is pushed.
