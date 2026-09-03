*Normative. Section 10 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 10. Semantic authority and lifecycle

### 10.1 Authority definition

USF V3 semantic revision identity is the canonical content digest `A(S)` defined in Section 7.

Tracked source is the durable carrier. The Git tree containing that source is recorded for provenance but does not alter semantic identity when the semantic bytes are unchanged.

Distinguish:

- `localSemanticRevision` — the validated semantic source bytes in the designated integration workspace, which may include an uncommitted compatible publication batch;
- `durableSemanticRevision` — the latest validated semantic source carried by an accepted Git commit.

Normal work may bind explicitly to either revision. A local revision is not fresh-clone durable until committed. `usf status`, work packets, publication receipts and terminal evidence must state which one they use. The terminal proof requires local and durable revisions to be equal.

The local semantic store is a disposable projection.

### 10.2 Semantic source

Tracked semantic source includes only durable meaning:

- ontology and vocabulary;
- contracts, requirements, constraints and acceptance criteria;
- explicit obligation applicability;
- significant realisation decisions;
- admitted proof-relevant evidence;
- proof definitions and accepted proof results where they alter durable conclusions;
- explicit claims, nonclaims and dispositions.

Do not place these in canonical semantic source by default:

- provider availability and quotas;
- prompts and model responses;
- work claims;
- retries;
- temporary patches;
- test logs;
- every implementation iteration;
- routine observations that do not affect proof or future semantic decisions.

### 10.3 Manifest and canonicalization

`graph/manifest.json` lists exact files, RDF formats, named graph IRIs, semantic roles and validation profiles.

The manifest does not contain its current authority digest.

Derivation MUST be deterministic, stratified or otherwise proven to terminate. Iterate to fixed point with a bounded maximum. Failure to converge is an error, not a new state.

Canonicalization and digests exclude timestamps, absolute paths, PIDs, run IDs, environment values, mutable provider metadata and self-referential digest records.

### 10.4 Minimum semantic kernel

Define only the concepts required by realisation:

```text
SemanticContract
SemanticOrderPolicy
Requirement
Constraint
AcceptanceCriterion
Capability
Artifact
RepositoryPathRole
RepresentationFormat
RealisationOption
RealisationDecision
Implementation
Observation
EvidenceRequirement
Evidence
ConstructionEvidenceRequirement
ValidationObligation
TestObligation
ProofObligation
ConstructionProofObligation
CompletionEvidenceRequirement
CompletionProofObligation
ProofResult
RealisationPermission
RealisationBasis
WorkPacket
ProviderCapabilityRequirement
Claim
NonClaim
Disposition
SourceReference
```

The graph must answer, for a bounded contract:

```text
What must be built?
Why?
Which paths and formats may change?
What must not change?
Which model capabilities and privacy posture are required?
What counts as acceptable?
Which checks must run?
What evidence must exist?
Which proof evaluates it?
What remains unproven?
```

### 10.5 Applicability

For each relevant obligation family, actionable contracts have exactly one state:

```text
required
not-required
conditional
reserved
unresolved
```

Silence cannot mean not required.

### 10.6 Lifecycle

```text
Semantic Model
  → Remodel and Scoped Currentness
  → Admitted Evidence
  → Deterministic Proof
  → Activated Contract and Realisation Permission
  → Work Graph
  → Contribution
  → Candidate
  → Realisation
  → Validation Observation
  → Admitted Evidence / Reproof / Significant Remodel when applicable
```

No stage grants authority because a file or label claims the stage completed.
The authored contract definition is distinct from its proof-warranted active
permission. Every command from `work` through `check` carries or rederives
one immutable `RealisationBasis`; mixed, fabricated or stale bases refuse.
Pre-realisation construction evidence and proof gate the permission.
Post-realisation validation observations, completion evidence and completion
proof evaluate the result without participating in the permission that
authorised it.

---
