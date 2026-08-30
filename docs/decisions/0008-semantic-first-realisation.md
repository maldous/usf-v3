# 0008 — Semantic-first realisation admission

Status: accepted authority definition; executable gate and activation evidence
remain pending.

## Decision

Every USF V3 and product-overlay realisation path uses this primary order:

```text
semantic model
  -> deterministic remodel and scoped currentness
  -> admitted evidence
  -> deterministic proof
  -> proof-warranted contract activation
  -> realisation
  -> validation
```

Validation produces observations for a later evidence, proof or significant
remodel cycle. It cannot retroactively authorise the candidate that produced
the observations.

An authored `SemanticContract` is not an active contract. Each contract names
an explicit construction-evidence requirement, construction-proof obligation,
`RealisationPermission`, completion-validation obligation, completion-evidence
requirement and completion-proof obligation. A permission remains
`proofblocked` unless exact admitted current pre-realisation evidence and a
deterministic passing construction proof warrant activation. Post-realisation
validation and completion proof assess the realised result; they are never an
input to the permission that authorised that result. This prevents both
build-first inversion and the circular requirement to validate nonexistent
candidate bytes before construction. A work-specific product-overlay permission
must require and narrow the core permission; it cannot replace or weaken it.

Every transition from `work` through `check` carries or rederives one
immutable `RealisationBasis` binding the exact manifest, versioned profile,
contract, permission, work packet, semantic trace, scoped dependency entries,
write/preimage scope, evidence, proof, validation, policy, schema and tool
digests. Caller labels, Git status, packet existence, process readiness, test
success and model prose cannot supply missing authority.

## Construction and activation

`ConstructionEligible` is per work item. It requires a complete current graph
basis, explicit applicability, accepted prerequisites, graph-defined write and
stop boundaries, and an active permission through the requested ceiling.
`ActivationEligible` requires admitted construction evidence and a current
passing construction proof for the exact obligation, algorithm/version and
basis. Completion validation, evidence and proof are evaluated only after the
authorised realisation.

The one-time gate bootstrap is the typed resource
`urn:usf:exception:semantic-first-bootstrap:1`. It names exactly the three gate
work packets, is open only for local hermetic deterministic-fixture execution,
requires isolated writes and is capped at `check`. It prohibits live provider
contact, credential access, integration, runtime activation, historical-source
mutation and every semantic publication except one exact self-closing admission
delta in `graph/semantic-first.nq`. That delta may contain only the three named
sanitized evidence records, one aggregate proof result, activation of the
ordinary gate permission and closure of the exception itself. Each packet has
its own focused validation/proof; only the final packet evaluates the aggregate
admission proof. Any extra subject, predicate, graph, path or sibling effect
refuses. It never authorises or activates sibling work.

The admission is verified by one closed tracked transition receipt at
`evidence/semantic-first-bootstrap-admission.json`. The receipt is not imported
by a semantic manifest. Its missing-file preimage and exact path are bound, but
its content bytes are excluded from the semantic state it attests. It binds the
exact reversible N-Quad source operations, immutable pre-state basis and source
digest, exact delta digest, and expected post-state source and scoped semantic
digests. A clean clone reverses the current source to the proven pre-state,
re-evaluates the proof, replays the delta in memory and compares the current
post-state. This avoids both circular self-hashing and immediate post-admission
staleness. Any changed receipt field, operation, preimage, postimage, relevant
dependency or extra effect refuses.

## Non-serialization

Eligibility, proof and currentness are cached by exact scoped inputs.
Proofblocked or stale work is excluded independently; an eligible sibling
continues. Process readiness may truthfully report ready and idle with no
eligible work. Hermes may rank only the already eligible set, and its absence
preserves the same deterministic plan.

Git records coherent durable checkpoints after accepted authority or
realisation batches. It is not the semantic clock and does not require reproof
for unrelated graph, product or repository movement.

## Verification economy

The executable packet permits only:

- one table-driven semantic eligibility and refusal test;
- one table-driven cross-transition basis test; and
- one lifecycle sibling-isolation and Hermes-absence test.

Existing tests must be extended or pruned when they already own the same risk.
There is no provider/model/command/stage Cartesian test matrix.

## Current nonclaims

The graph definition does not prove that the executable gate exists, that any
legacy contract is active, that historical semantics are completely recovered,
that a provider or Hermes-Agent ran, or that ANQR, staging, production, BAU or
terminal acceptance is complete.
