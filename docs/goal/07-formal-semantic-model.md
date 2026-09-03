*Normative. Section 7 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 7. Formal semantic model

This section is normative. It removes ambiguity about authority, currentness, parallelism, publication and acceptance.

### 7.1 State domains

Let:

- `S` be the tracked authored semantic source selected by `graph/manifest.json`;
- `D(S)` be the deterministic derived closure of `S`;
- `C(X)` be canonical RDF dataset serialization of `X` partitioned by named graph;
- `H(X)` be SHA-256 over canonical bytes;
- `A(S) = H(C(D(S)))` be the global semantic revision digest;
- `R` be a repository realisation state represented by Git tree plus scoped file digests;
- `O` be factual observations;
- `E = N(O, requirement)` be normalized evidence satisfying an evidence schema;
- `P = Eval(obligation, E)` be deterministic proof evaluation;
- `M_t` be the provider/model routes eligible at time `t`;
- `W_t` be the actionable work graph at time `t`;
- `χ` be one explicit realisation chain.

The same semantic bytes at different Git commits have the same semantic revision digest. Git is a carrier and history mechanism, not the semantic identity function.

Semantic state, realisation state and operational working state are distinct authority classes. Movement between them is explicit:

- semantic source authorises and constrains;
- realisation source attempts to satisfy;
- operational artefacts coordinate and observe;
- normalized proof-relevant evidence may be promoted into semantic source only through `usf publish`.

An operational file does not become evidence, and implementation does not become semantic truth, merely because another file references it. Promotion copies/serializes the accepted normalized content and provenance into tracked source; canonical authority never depends on an ignored object path.

### 7.2 Semantic source and candidate deltas

A candidate semantic delta `δ` is evaluated as:

```text
S' = apply(S, δ)
A' = A(S')
```

`δ` may be validated, queried, reviewed and used in an isolated chain without first creating a Git commit.

A candidate delta is not canonical authority until `usf publish` validates and atomically applies it to the designated semantic source workspace.

A Git commit records a coherent durable checkpoint after one or more compatible semantic publications. It is not required after each triple, candidate, observation or proof result.

### 7.3 Significance predicate

A semantic delta is significant exactly when at least one predicate is true:

```text
Significant(δ) :=
    changesRequiredObservableBehaviour(δ)
 OR changesAcceptanceCriteria(δ)
 OR changesConstraintOrPermission(δ)
 OR changesObligationApplicability(δ)
 OR changesDurableConceptIdentityOrRelationship(δ)
 OR recordsAcceptedProductDecision(δ)
 OR admitsEvidenceThatChangesProofConclusion(δ)
 OR correctsSemanticContradictionOrOmission(δ)
```

The following alone are not significant:

- refactoring;
- renaming a test or file without semantic effect;
- provider availability or quota change;
- a different model answer;
- a routine test run;
- package upgrade without changed required behaviour;
- an intermediate source edit;
- a rejected candidate;
- operational scheduling or retry state.

Only significant deltas or evidence that changes a durable proof conclusion enter canonical semantic source.

### 7.4 Fine-grained dependency currentness

A global authority digest is recorded for audit, but it MUST NOT be the sole acceptance boundary for all work.

Every work packet and downstream artefact has a dependency set:

```text
Dep(x) =
    semantic resource or named-graph digests actually read
  + repository file pre-image digests actually read or writable
  + relevant policy/schema/tool-version digests
  + provider catalogue/probe digests where applicable
```

Its scoped dependency digest is:

```text
SD(x) = H(canonicalSort(Dep(x)))
```

An artefact is fresh when every member of `Dep(x)` still matches.

```text
Fresh(x, current) ⇔ ∀ d ∈ Dep(x): current(d.key) = d.digest
```

An unrelated repository or graph change MUST NOT invalidate `x` merely because the global Git tree or global semantic digest moved.

A global change to ontology, vocabulary, shared constraints, manifest semantics or another declared transitive dependency may invalidate broad scope because it appears in `Dep(x)`.

Adversarial tests MUST prove both:

- relevant dependency movement invalidates;
- unrelated movement does not invalidate.

### 7.5 Work graph and independence

Actionable work is represented as a directed acyclic graph:

```text
G_W = (V, E)
```

where vertices are work packets and edge `u → v` means `v` depends on accepted output from `u`. If semantic decomposition produces a dependency cycle, either collapse the strongly connected component into one composite atomic work packet or report a semantic decomposition defect; do not schedule a cyclic graph as if it were ready.

For work packet `w`, define:

- `Read(w)` — repository and semantic read set;
- `Write(w)` — permitted repository or semantic write set;
- `Dep(w)` — exact currentness dependencies;
- `Accept(w)` — deterministic acceptance criteria;
- `Value(w)` — sum of graph-declared weights for acceptance criteria newly closed by an accepted result; each criterion defaults to weight `1` when no explicit priority is declared. Model self-assessment cannot alter the weight.

Two work packets are parallel-compatible when:

```text
Independent(a,b) ⇔
    Write(a) ∩ Write(b) = ∅
 AND no unresolved semantic dependency edge exists between them
 AND neither changes a shared transitive dependency of the other
```

Read-only work may run concurrently without write isolation.

Writing work receives separate workspaces unless `Independent` and the implementation explicitly proves a shared workspace safe. The default is separate workspaces.

The dependency-ready set at time `t` is the maximal set of vertices whose
declared work dependencies are accepted and whose scoped inputs are fresh.
It is not yet the realisation-ready set. Realisation readiness additionally
requires one exact graph-derived current basis, declared applicability,
required admitted evidence, passing current proof and proof-warranted
permission through the requested ceiling. A narrowly graph-declared bootstrap
exception may permit isolated local check-only construction of the gate that
enforces this rule; it grants no provider contact, integration, publication,
runtime activation or completion authority.

### 7.6 Chains

A chain `χ` is an explicit content-addressed artefact graph associated with one semantic objective. It may branch and converge.

A chain contains references to:

- starting semantic revision and scoped dependency digest;
- work packet;
- routes and assignments;
- provider contributions;
- critiques;
- candidate workspaces or patches;
- checks;
- observations;
- evidence;
- proof;
- final disposition.

A chain is not:

- a global state machine;
- a lease or generation;
- a semantic graph node by default;
- a reason to block unrelated chains.

Chain stage is derived from valid artefacts, not trusted from one mutable status field.

A chain directory SHOULD use the following explicit layout:

```text
.usf/chains/<chain-digest>/
├── manifest.json
├── work.json
├── assignments.jsonl
├── contributions.jsonl
├── reviews.jsonl
├── candidates/
├── checks/
├── observations/
├── evidence/
├── proofs/
└── disposition.json
```

Files are immutable once referenced by digest. A corrected result is a new object/reference, not an in-place rewrite of historical bytes. Human run labels may point to chain digests but never determine identity.

Killing a process does not require replay. On restart, V3 scans valid artefacts, scoped claims, Git and semantic source to recompute ready work.

### 7.7 Realisation acceptance

A candidate `k` is accepted for integration only when:

```text
Accepted(k) ⇔
    schemaValid(k)
 AND realisationBasisCurrent(k)
 AND constructionAndActivationEligible(k)
 AND scopedDependenciesFresh(k)
 AND authorizedWriteSet(k)
 AND noUnresolvedBlocker(k)
 AND deterministicChecksPass(k)
 AND observedDiffEqualsWorkspaceState(k)
 AND zeroSecretLeakage(k)
```

Model agreement is neither necessary nor sufficient.

### 7.8 Evidence and proof

An observation is factual output.

Evidence is an observation normalized to an explicit evidence requirement with exact provenance and currentness.

Proof evaluates exact evidence against an explicit obligation.

```text
Evidence(o,r) ⇔ schemaValid(o) ∧ satisfiesProvenance(o,r)
ProofPass(p) ⇔ algorithm(p)(exactEvidenceSet(p), obligation(p)) = pass
```

Silence, missing applicability, stale evidence, sibling-obligation evidence, failed checks and model approval cannot imply proof success.

### 7.9 Optimization objective

Safety and semantic correctness are constraints, not optimization variables.

Within those constraints, scheduling uses lexicographic objectives:

1. maximize graph-weighted acceptance criteria closed per wall-clock time;
2. maintain exactly zero paid cost;
3. minimize critical-path latency;
4. maximize useful provider diversity;
5. maximize useful free-token throughput;
6. minimize repeated input tokens through bounded context and caching;
7. minimize serialized integration and publication time.

Raw model-call count and raw token volume are not success measures.

A token is useful when it belongs to an actionable chain and materially contributes to an accepted candidate, a defect found, a repair, or a proof-relevant conclusion. Probe and malformed-call tokens are reported separately.

### 7.10 Global invariants

The following invariants must hold at every accepted boundary:

```text
I01  Semantic identity is a function of canonical semantic content only.
I02  Git carrier identity and semantic identity are recorded separately.
I03  Candidate semantics can be validated before a Git commit.
I04  Candidate implementation can iterate before a Git commit.
I05  Relevant dependency movement invalidates; unrelated movement does not.
I06  No model response establishes truth or acceptance.
I07  No provider call may incur paid cost or hidden paid fallback.
I08  Requested and actual provider/model identity remain distinct.
I09  Provider models cannot directly mutate canonical graph or primary source.
I10  Candidate writes are isolated, contained and derived from explicit scope.
I11  Integration and publication locks are narrow, local and short-lived.
I12  Independent work proceeds while unrelated work integrates or publishes.
I13  Observation, evidence, validation and proof remain different artefact kinds.
I14  Missing applicability, evidence or proof never implies success.
I15  Routine operational state does not enter semantic authority.
I16  Only Significant(delta) is eligible for canonical semantic publication.
I17  All mutable runtime state remains beneath USF_ROOT.
I18  Historical sources are never runtime dependencies.
I19  A killed worker or watch process leaves no ambiguous authoritative effect.
I20  Completion is derived from valid artefacts and integrated source, not a status label.
I21  Unchanged material inputs permit deterministic or model-result reuse.
I22  External source egress never exceeds the work packet privacy policy.
I23  Model-generated code is never executed with provider credentials or unrestricted host access.
I24  Every core abstraction is justified by ANQR delivery or a measured bottleneck.
I25  Semantic model, remodel/currentness, evidence, proof and activated permission precede realisation; validation feeds the next evidence cycle.
I26  Contract definition, work readiness and process readiness never imply contract activation.
```

A design or implementation that violates an invariant must be corrected at the responsible boundary rather than compensated for by a new global workflow layer.

### 7.11 Terminal predicate

The successful terminal statement is valid exactly when the conjunction below is true:

```text
TerminalProof :=
    RepositoryContained
  ∧ HistoricalIndependence
  ∧ SemanticKernelValid
  ∧ DeterministicSemanticIdentity
  ∧ FineGrainedCurrentnessProven
  ∧ ZeroPaidCost
  ∧ LiveProviderFamiliesContributing ≥ 2
  ∧ ConstructiveCrossProviderCollaboration
  ∧ NonTrivialANQRRealisationIntegrated
  ∧ DeterministicChecksPass
  ∧ CurrentEvidenceAdmitted
  ∧ ProofObligationsPass
  ∧ PostIntegrationDrift = 0
  ∧ ContinuousThreeBatchRunPasses
  ∧ ForcedRestartPasses
  ∧ ProviderRemovalRepeatPasses
  ∧ SyntheticParallelScalePasses
  ∧ SanitizedAcceptanceBundleComplete
```

No subset, narrative approximation or favourable model judgement permits the terminal claim. Section 25 expands each conjunct into executable criteria.

---
