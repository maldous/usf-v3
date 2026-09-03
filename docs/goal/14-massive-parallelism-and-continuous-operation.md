*Normative. Section 14 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 14. Massive parallelism and continuous operation

### 14.1 Meaning of massive

“Massively parallel” means the architecture has no fixed small model or chain limit and useful throughput increases as independent work and eligible routes increase until declared host/provider limits are reached.

It does not mean sending every prompt to every model.

Parallelise by:

- semantic requirement;
- artefact;
- package/component;
- repository path;
- test obligation;
- review dimension;
- implementation hypothesis;
- independent provider route.

### 14.2 Scheduling constraints

For assignment binary variable `x(w,m)`:

```text
x(w,m) = 1 when work packet w is assigned to route m
```

Assignments MUST satisfy:

```text
capabilities(m) ⊇ requirements(w)
privacy(m) permits classification(w)
cost(m,w) = 0
freshProbe(m,w)
providerConcurrency(m) not exceeded
hostConcurrency not exceeded
no prohibited write conflict
```

The scheduler SHOULD select assignments maximizing the objective in Section 7.9. It MUST prevent starvation by aging ready work and MUST maintain provider fairness so one fast route cannot consume every suitable packet when diversity or quota utilization would create higher expected value. Speculative duplicate assignments require an explicit diversity/review rationale and a bounded duplication budget.

### 14.3 Concurrency target

At each scheduling point:

```text
C_target = min(
    ready independent work,
    sum of eligible provider concurrency caps,
    configured host/model concurrency cap,
    memory/process safety cap
)
```

Report:

```text
C_observed
C_target
parallel utilisation = active invocation time / (elapsed × C_target)
```

Provider waiting, integration and semantic publication must not hold unrelated provider slots.

### 14.4 Local claims, not distributed leases

To prevent duplicate mutation on one host, V3 MAY use OS-released file locks or atomic repository-local claim creation keyed by work/route/workspace digest.

Such a claim:

- is transient operational working state;
- grants no semantic or integration authority;
- carries no fencing token;
- is released or invalidated when the owning process is gone;
- cannot block unrelated scope;
- is reconstructed or removed safely at startup.

Do not generalize this into a distributed lease system.

### 14.5 Continuous proof

The terminal proof includes a continuous run that:

- processes at least three successive ready-work batches without manual stage advancement;
- contains multiple simultaneous chains;
- survives one forced watch-process restart;
- survives one injected provider failure and one rejected candidate;
- continues unrelated work during those failures;
- integrates at least one coherent batch;
- publishes at most the significant semantic learning required by the accepted work;
- records zero paid cost.

---
