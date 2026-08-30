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
| Provider qualification | PARALLELISE / CACHE | Active capability set per exact route and agent profile; mechanical availability/economics is separate from semantic task qualification | Lazy bounded probes with frozen catalogue/probe snapshots; explicit Groq `on_demand` and Cerebras `default` service-tier pins; no implicit paid fallback; semantic results bind content digests and default to `UNQUALIFIED` | unmeasured | Probe independent routes concurrently under provider caps; cache only by exact current route/profile/suite/corpus/policy/probe/answer digests |
| Context construction | CACHE | One work packet | Canonical bounded packet cache | unmeasured | Build independent packets concurrently |
| Candidate resolution | LOCALISE | One chain | Deterministic disjoint merge first | unmeasured | Resolve independent chains concurrently |
| Review fanout | SIMPLIFY | Risk dimensions of one candidate | Targeted independent review, not all-to-all | unmeasured | Parallel risk-specific reviews |
| Test execution | PARALLELISE / CACHE | Affected dependency closure | Named no-force-exit unit, contract, integration, lifecycle, adversarial and scale lanes; full gate remains authoritative | latest sample: 5.23 s test runner / 7.95 s full command, 156 tests; p95 not yet established | Run the smallest risk-owning lane during iteration; full gate at integration/publication/acceptance; shard only isolated files |
| Evidence admission | BATCH | Proof-relevant normalized evidence | Admit only conclusion-changing evidence | unmeasured | Normalize candidates concurrently, mutate source once |
| Proof evaluation | CACHE | One obligation and exact evidence set | Pure deterministic evaluation | unmeasured | Evaluate independent obligations concurrently |
| Package generation | DEFER | First ANQR slice output | Add only when slice needs it | unmeasured | Cache by exact source/config digest |
| Content/object storage | DEFER / RESERVED | `.usf/objects` | Ignored disposable reserved directory only; no USF CAS adapter, authority, warm-cache requirement or CAS-specific test lane exists | not applicable | If justified later, reconstruct from tracked files and test immutable digest writes without requiring GitHub or a hosted runner |
| Continuous supervisor | SIMPLIFY | One named lifecycle instance | Disposable foreground process with one OS-released instance lock, no global state machine | lifecycle focused lane 1.90 s; runtime duration unmeasured | Independent named instances/scopes may run separately; external commodity supervision owns restart/forced kill |
| Operator metrics aggregation | LOCALISE / DEFER | One explicit bounded JSONL input and selected dimensions | Pure local aggregation on operator request; never scan from the composer loop | unmeasured | Cache rollups by exact input digest later; optional exporters remain off the critical path |
| CLI help | REMOVE FROM CRITICAL PATH | Static command registry | Render without repository or any external contact | unmeasured | No runtime dependency, history scan or serialization stage |

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
