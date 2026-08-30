# Bottleneck register

Only measured or invariant-required serialization belongs on the realisation
critical path. Durations are `unmeasured` until the corresponding command path
exists; unmeasured entries are not evidence of acceptable performance.

| Stage | Classification | Protected scope | Initial treatment | Duration | Batching / parallel opportunity |
|---|---|---|---|---:|---|
| Git integration mutation | RETAIN - HARD INVARIANT | Primary Git branch mutation instant | One repository-local primary-mutation lock | unmeasured | Prepare and validate disjoint candidates concurrently; batch coherent changes |
| Semantic source mutation | RETAIN - HARD INVARIANT | Affected tracked graph files | Share the narrow primary-mutation lock; no nested lock | unmeasured | Validate deltas concurrently; publish compatible significant deltas together |
| Whole-graph currentness | SIMPLIFY | Exact semantic dependencies | Replace global invalidation with scoped digests | unmeasured | Unrelated work remains fresh |
| Whole-tree candidate currentness | SIMPLIFY | Declared read/write pre-images | Compare scoped file digests only | unmeasured | Rebase unaffected candidates without new model calls |
| Provider qualification | PARALLELISE / CACHE | Active capability set per route | Lazy bounded probes with frozen snapshots | unmeasured | Probe routes concurrently under provider caps |
| Context construction | CACHE | One work packet | Canonical bounded packet cache | unmeasured | Build independent packets concurrently |
| Candidate resolution | LOCALISE | One chain | Deterministic disjoint merge first | unmeasured | Resolve independent chains concurrently |
| Review fanout | SIMPLIFY | Risk dimensions of one candidate | Targeted independent review, not all-to-all | unmeasured | Parallel risk-specific reviews |
| Test execution | PARALLELISE / CACHE | Affected dependency closure | Focused checks during iteration | unmeasured | Run independent check shards concurrently; reserve full gate for checkpoints |
| Evidence admission | BATCH | Proof-relevant normalized evidence | Admit only conclusion-changing evidence | unmeasured | Normalize candidates concurrently, mutate source once |
| Proof evaluation | CACHE | One obligation and exact evidence set | Pure deterministic evaluation | unmeasured | Evaluate independent obligations concurrently |
| Package generation | DEFER | First ANQR slice output | Add only when slice needs it | unmeasured | Cache by exact source/config digest |
| Content/object storage | LOCALISE | `.usf/objects` | Repository-local digest-addressed files | unmeasured | Concurrent immutable writes by digest |
| Continuous supervisor | SIMPLIFY | Ready work composition | Disposable foreground process, no global state machine | unmeasured | Multiple processes may use short local claims |
