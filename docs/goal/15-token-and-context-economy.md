*Normative. Section 15 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 15. Token and context economy

### 15.1 Bounded packets

Models receive the smallest sufficient packet:

- objective;
- relevant semantic identities and requirements;
- scoped source excerpts or read tools;
- permitted writes;
- acceptance and validation;
- output schema;
- claims/nonclaims and stop conditions.

Do not send full graph, full repository, conversation history, unrelated logs, provider catalogue or previous reasoning.

### 15.2 Cache identity

Cache model and deterministic results by material inputs, including:

```text
semantic dependency digest
work packet digest
repository path dependency digest
prompt-template digest
provider and actual model
adapter/tool version
required capability set
```

Do not repeat a model call when all material inputs are unchanged and a valid result remains reusable, unless explicitly running an independence or freshness experiment.

### 15.3 High-token objective

V3 must be capable of exploiting high aggregate free-token capacity when useful ANQR work exists.

Define:

```text
T_useful = input + output tokens from calls that contribute to accepted work,
           actionable defect discovery or accepted repair
T_total  = all provider input + output tokens
Yield    = graph-weighted accepted value / T_total
```

A call is counted as useful only when its contribution digest is referenced by an accepted candidate, an accepted review finding, an accepted repair lineage or a proof-relevant conclusion. Unreferenced alternatives, probes and malformed responses remain in `T_total` but not `T_useful`.

Before the live proof begins, compute and freeze:

```text
T_target = min(operator target, evidenced free capacity, useful ready-work demand)
```

The default operator target is `1,000,000` aggregate useful tokens. The terminal proof requires `T_target ≥ 100,000` and requires the frozen target to be achieved. A target below the default is permitted only when the pre-run provider census and real ANQR work graph independently demonstrate the constraint. Free-capacity evidence must come from current quota/rate-limit metadata, provider responses or a conservative operator cap; model prose is not evidence. Where exact token quota is unavailable, calculate a conservative bound from the declared run duration, provider request/token limits and work budgets. Do not lower the target after observing the run, substitute paid capacity, repeat duplicate prompts or fabricate work merely to accumulate tokens. If evidenced zero-paid-cost capacity is below 100,000 useful tokens, the high-token terminal proof is blocked rather than waived.

The architecture scale test MUST simulate at least `10,000,000` accounted tokens through fake providers to prove that token accounting, fanout, caching and aggregation do not require external capacity.

Record gross token throughput, useful token throughput, cache reuse and yield. A system that achieves correctness only by repeatedly sending enormous duplicate contexts has failed.

### 15.4 Deterministic work before model work

Use deterministic tools for inventories, graph derivation, source search, digests, schema validation, patch application, test execution and mechanically compatible merge.

Use models for interpretation, design, implementation, critique, repair and genuine ambiguity.

---
