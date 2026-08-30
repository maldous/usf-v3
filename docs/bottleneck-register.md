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
| Test execution | PARALLELISE / CACHE | Affected dependency closure | Named no-force-exit unit, contract, integration, lifecycle, adversarial and scale lanes; full gate remains authoritative | 11.05 s one sample before lifecycle repair; p95 not yet established | Run the smallest risk-owning lane during iteration; full gate at integration/publication/acceptance; shard only isolated files |
| Evidence admission | BATCH | Proof-relevant normalized evidence | Admit only conclusion-changing evidence | unmeasured | Normalize candidates concurrently, mutate source once |
| Proof evaluation | CACHE | One obligation and exact evidence set | Pure deterministic evaluation | unmeasured | Evaluate independent obligations concurrently |
| Package generation | DEFER | First ANQR slice output | Add only when slice needs it | unmeasured | Cache by exact source/config digest |
| Content/object storage | LOCALISE | `.usf/objects` | Repository-local digest-addressed files | unmeasured | Concurrent immutable writes by digest |
| Continuous supervisor | SIMPLIFY | Ready work composition | Disposable foreground process, no global state machine | unmeasured | Multiple processes may use short local claims |

## Test portfolio maintenance

The full suite remains the authoritative local test gate. Named lanes exist to
shorten iteration, not to waive coverage. Every retained test must own a unique
semantic acceptance/refusal, serialization invariant or real process boundary.
A new test replaces a duplicate lower-value test in the same change where
possible. Pure calculations use injected clocks and synthetic data; wall-clock
sleeps, provider calls, GitHub calls and retrying flaky tests are forbidden in
the default lanes.

Performance budgets are established only from ten clean runs on the same host
class. Until that baseline exists, durations are observations, not gates. The
initial proposed ceilings are p95 15 seconds for `check:fast`, 45 seconds for
the integration lane and 60 seconds for the full local suite. Any single
integration test above 10 seconds needs an explicit process-boundary rationale.
Default and lifecycle lanes intentionally omit `--test-force-exit`, because
forced runner exit would conceal descriptor or child-process leaks.
