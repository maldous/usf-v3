*Normative. Section 18 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 18. Validation, evidence, proof and publication

### 18.1 Validation profiles

At minimum:

```text
graph-affected
graph-full
source-affected
candidate
integration-batch
full
acceptance
```

Focused affected validation runs during iteration. Full graph/source gates run at meaningful publication, integration and terminal boundaries.

### 18.2 Incremental semantic validation

Determine the affected semantic closure from changed named graphs/resources and dependency declarations.

Changes to ontology, vocabulary, global shapes, derivation rules or manifest semantics trigger broader validation.

An ordinary contract/evidence change does not automatically force unrelated expensive proof or source checks during every intermediate edit.

Full graph validation remains mandatory at semantic publication and terminal acceptance.

### 18.3 Accepted evidence

Only evidence that satisfies, invalidates or materially changes an explicit proof/future decision is promoted to tracked semantic/evidence source.

Routine provider responses, logs, repeated passing checks and operational scheduling remain beneath `.usf/`.

### 18.4 Publication

`usf publish` applies significant semantic/evidence changes in compatible batches.

A publication receipt identifies base and resulting semantic revision, exact deltas, validation, affected scope and remaining nonclaims.

Publication does not itself claim programme completion and does not push.

### 18.5 Drift

Drift classes include:

- semantic source/store mismatch;
- derived closure mismatch;
- missing or unexpected realisation path;
- scoped dependency mismatch;
- stale evidence/proof;
- source-head/path-preimage mismatch;
- provider actual-identity mismatch;
- generated output drift;
- untracked implementation bytes;
- historical/external runtime dependency.

---
