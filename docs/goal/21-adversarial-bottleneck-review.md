*Normative. Section 21 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 21. Adversarial bottleneck review

Before adding or accepting any service, daemon, database, protocol, workflow, proof wrapper or global lock, answer in order:

1. Can it be removed?
2. Can commodity tooling replace it?
3. Can it be a library or command rather than a service?
4. Can it be moved off the critical path?
5. Can it be parallelized or sharded?
6. Can it be local rather than global?
7. Can it use fine-grained dependencies rather than whole-tree invalidation?
8. Can it be incremental?
9. Can unchanged results be cached?
10. Can operations be batched behind one checkpoint?
11. Can speculative work proceed while it waits?
12. Can failure affect only its work scope?
13. What hard correctness property requires remaining serialization?

Classify findings:

```text
REMOVE
SIMPLIFY
PARALLELISE
BATCH
CACHE
LOCALISE
DEFER
RETAIN — HARD INVARIANT
```

Maintain `docs/bottleneck-register.md` with every remaining serialized stage, protected scope, measured duration, batching opportunity and justification.

Mandatory adversarial targets:

- Git integration;
- semantic publication;
- whole-graph currentness;
- whole-tree candidate currentness;
- provider qualification;
- provider routing and rate limits;
- context construction;
- candidate resolution;
- review fanout;
- test execution;
- evidence admission;
- proof evaluation;
- package generation;
- content/object storage;
- central supervisor and global state.

---
