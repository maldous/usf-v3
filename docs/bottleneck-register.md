# Bottleneck register

Only measured or invariant-required serialization belongs on the realisation
critical path. Durations are `unmeasured` until the corresponding command path
exists; unmeasured entries are not evidence of acceptable performance.

| Stage | Classification | Protected scope | Initial treatment | Duration | Batching / parallel opportunity |
|---|---|---|---|---:|---|
| Git integration mutation | RETAIN - HARD INVARIANT | Primary Git branch mutation instant | One repository-local primary-mutation lock | unmeasured | Prepare and validate disjoint candidates concurrently; batch coherent changes |
| Semantic source mutation | RETAIN - HARD INVARIANT | Affected tracked graph files | Share the narrow primary-mutation lock; no nested lock | unmeasured | Validate deltas concurrently; publish compatible significant deltas together |
| Whole-graph currentness | SIMPLIFY | Exact semantic dependencies | Use work/contract/predecessor closure plus profile boundary identity; operational contracts require reciprocal work/contract edges and every implementing packet includes them in scoped closure; never traverse sibling `selectsContract` content into a work basis | one sibling-scope invalidation and one omitted operational-contract closure class observed and corrected before checkpoint; command duration not used as an acceptance metric | Unrelated sibling contract and graph movement remains fresh; profile membership, operational contracts and explicit dependencies still invalidate |
| Whole-tree candidate currentness | SIMPLIFY | Declared read/write pre-images | Compare scoped file digests only | unmeasured | Rebase unaffected candidates without new model calls |
| Provider qualification | PARALLELISE / CACHE | Active capability set per exact route and agent profile; mechanical availability/economics is separate from semantic task qualification | Lazy bounded probes with frozen catalogue/probe snapshots; explicit Groq `on_demand` and Cerebras `default` service-tier pins; no implicit paid fallback; semantic results bind content digests and default to `UNQUALIFIED` | unmeasured | Probe independent routes concurrently under provider caps; cache only by exact current route/profile/suite/corpus/policy/probe/answer digests |
| Provider capability construction | BATCH / PARALLELISE | One reusable no-contact source capability | Keep source-mutating capability packets pairwise write-disjoint; every operational output has an implementing owner, jointly implemented operations bind every implementer, and a declared dependency join owns the combined output. Live account, adapter, answer, evaluation and qualification records stay outside tracked source | unmeasured | Implement and checkpoint coherent capabilities; after qualification, independent routes advance without Git, commit, semantic publication or sibling reproof |
| Route qualification sequence | RETAIN - HARD INVARIANT / LOCALISE | One exact route-member causal chain | Serialize only account-source authorization -> account receipt -> adapter preflight -> inference authorization -> provider answer -> hidden evaluation -> qualification for that route. Store immutable records below its ignored route-member digest | unmeasured | Different routes and provider families run concurrently; expiry or failure invalidates only the exact route member |
| Context construction | CACHE | One work packet | Canonical bounded packet cache | unmeasured | Build independent packets concurrently |
| Candidate resolution | LOCALISE | One chain | Deterministic disjoint merge first | unmeasured | Resolve independent chains concurrently |
| Review fanout | SIMPLIFY | Risk dimensions of one candidate | Targeted independent review, not all-to-all | unmeasured | Parallel risk-specific reviews |
| Test execution | PARALLELISE / CACHE | Affected dependency closure | Named no-force-exit unit, contract, integration, lifecycle, adversarial and scale lanes; full gate remains authoritative | latest external-root sample: 23.14 s test runner / 28.2 s full command, 192 tests; p95 not yet established | Run the smallest risk-owning lane during iteration; full gate at integration/publication/acceptance; shard only isolated files |
| Evidence admission | BATCH | Proof-relevant normalized evidence | Admit only conclusion-changing evidence | unmeasured | Normalize candidates concurrently, mutate source once |
| Proof evaluation | CACHE | One obligation and exact evidence set | Pure deterministic evaluation | unmeasured | Evaluate independent obligations concurrently |
| Package generation | DEFER | First ANQR slice output | Add only when slice needs it | unmeasured | Cache by exact source/config digest |
| Content/object storage | DEFER / RESERVED | `.usf/objects` | Ignored disposable reserved directory only; no USF CAS adapter, authority, warm-cache requirement or CAS-specific test lane exists | not applicable | If justified later, reconstruct from tracked files and test immutable digest writes without requiring GitHub or a hosted runner |
| Continuous supervisor | SIMPLIFY | One named lifecycle instance | Disposable foreground process with one OS-released instance lock, no global state machine | lifecycle focused lane 1.90 s; runtime duration unmeasured | Independent named instances/scopes may run separately; external commodity supervision owns restart/forced kill |
| Hermes optimization | OPTIONAL / PARALLELISE | One fully input-bound proposal for an exact ready set | Run as its own visible capped assignment beside the deterministic composer; it may not reserve unrelated slots or affect claimed work, and late/stale/failed advice keeps the unchanged fallback | unmeasured; runtime adapter not yet implemented | Parallelize independent proposals; disable without blocking; promote only measured reusable learning |
| Commit cohort formation | BATCH / LOCALISE | Compatible checked candidates and one rollback unit | USF validates cohorts; Hermes may only propose. Flush is limited by selected through/automation policy; at check, stop only leaves candidates queued. Never commit per prompt/triple/stage | unmeasured; local observation-only apply/check/integrate exists, while cohort automation remains planned | Provider and candidate preparation continues while the brief authorized single-writer mutation waits |
| Operator metrics aggregation | LOCALISE / DEFER | One explicit bounded JSONL input and selected dimensions | Pure local aggregation on operator request; never scan from the composer loop | unmeasured | Cache rollups by exact input digest later; optional exporters remain off the critical path |
| CLI help | REMOVE FROM CRITICAL PATH | Static command registry | Render without repository or any external contact | unmeasured | No runtime dependency, history scan or serialization stage |
| Provider CLI extension | REMOVE SHARED WRITE | One predecessor-owned `providers` dispatcher/help reservation | Integrate the top-level provider family once through the operator registry, keep provider-census ownership to feature files, derive the exact selected composition from the explicit imported profile manifest, and dynamically load the independently owned receipt implementation only after construction qualification | the initial profile audit found nine pairwise ownership/currentness conflicts; the exact nine-packet profile now has none; performance unmeasured | Later receipt implementation writes only `provider-receipts.ts` and its schemas/tests; it does not reopen the shared registry, stale operator observability or block census work |
| Checkpoint-document currentness | REMOVE FROM FUNCTIONAL BASIS | `docs/handover.md` and shared operational bottleneck reporting | Keep operator checkpoint prose outside ordinary work read/write sets; retain historical carrier references as immutable observations only. Scope focused packets to the tests they actually execute | observed one unnecessary operator construction/completion reproof before correction; command duration not used as an acceptance metric | Handover and global reporting may move after a functional proof without staling it; genuine implementation, decision and validation dependencies remain exact |

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

The current five tests above ten seconds retain distinct real boundaries:
foreground lifecycle owns ordinary process start/status/stop and cleanup;
provider profile authority owns exact imported-profile derivation; fresh
publication/crash recovery owns interrupted additive publication; work
completion owns the isolated evidence/proof/publication chain; and local Git
integration owns dirty-index and repository mutation behavior. Their latest
durations are observations, not individual gates. They should be shortened by
shared fixture setup or process reuse only when doing so preserves the boundary
being proved; they must not be multiplied into provider/model/prompt matrices.

Hermes adds only one distinct config/command refusal table and one real
start/status/ordinary-stop process boundary. Its timeout/fallback and provider
population behavior reuse the existing scheduler, provider and lifecycle
fixtures. A separate matrix per provider, model, prompt or skill is forbidden;
live Hermes-Agent/provider execution stays outside the default lane.

## Certification throughput, 2026-09-15

The optimization target is elapsed time from the first repair through current
authority and independent Hermes progress. Full-gate duration alone excludes
focused checks, repeated cold seeds, source edits, evidence, proof, publication
and the gaps between executions. Earlier seconds-scale budgets above are
historical; they do not describe the current completion suite.

Run `node scripts/certification-history.ts 20` for bounded, read-only accounting
of retained full-gate runs. It reports summed execution time, occupied wall time
and unobserved gaps. Repeated fixture bases are investigation candidates, never
proof that an old full gate certifies a new source cohort.

The gate completed at 2026-09-15T12:44:03.605Z in 3,218.530 seconds (53m38.530s).
Its ordinary lane passed 1,073 tests; the completion lane passed 20 with one
skip; the later exclusive lifecycle/stewardship lane passed 12; all five
fixture obligations passed. The report is
`.usf/logs/full-gate/20260915T115025075Z-2718087.json`. Subsequent source edits
make this a historical observation, not certification of those edits.

| Cost | Treatment | Required evidence |
|---|---|---|
| Overlapping/nested full gates | One kernel execution lock at the runner boundary; competing invocation refuses before tests | Real second-process refusal, process-death release, independent repository progress |
| Repeated sequential gates | Freeze one complete cohort; select `check` or `test`, since both invoke the same full gate | Complete source/test/graph/toolchain identity before any exact-result reuse; fixture basis alone is insufficient |
| Repeated completion setup | Share immutable prepared seed and private mutable clones; preserve a genuine validation producer | Cold/warm phase timings, one builder, every real interruption witness retained |
| Sequential CPU-bound recovery | Two bounded isolated worker processes after seed preparation | Actual overlap, exact case union, terminal results, aggregate process-tree memory and timeout headroom |
| Minor-change certification | USF-1201 Gate Lever 3 through current receipt authentication and fresh aggregate evidence | Complete transitive closure and denominator; unknown impact requires full gate |
| Authority publication | Batch compatible authority members after the complete cohort freezes | Evidence/prove/verify/apply intervals and current readback; no intervening source edits |

### TypeScript tooling decision

Retain the current native Node runner for this repair. Node already supports
sharding, CPU profiles and process isolation. Its CLI concurrency flag is
ignored under isolation `none`; actual overlapping processes must be measured.
See [Node 24.16 CLI](https://nodejs.org/download/release/v24.16.0/docs/api/cli.html).

Vitest provides pool controls and separates transform, setup and execution in
its profiling guidance. Evaluate a bounded representative pilot only if
profiles show runner/transform overhead remains material after fixture repair.
See [Vitest profiling](https://vitest.dev/guide/profiling-test-performance).
Jest offers related-test selection, but that selection cannot account for
undeclared semantic graph inputs by itself. See
[Jest CLI](https://jestjs.io/docs/cli).
Nx task caching can avoid repeat task execution when its complete declared
inputs match; adopting it would still require USF receipt reauthentication and
would not establish semantic currentness. See
[Nx task caching](https://nx.dev/docs/features/cache-task-results).

New transpilers, test-runner migration, remote caches and filesystem changes
have no measured benefit for this cohort yet. The host observation showed
approximately 30.8 GiB available memory and negligible current memory/I/O
pressure. Size worker admission from complete descendant process trees and
actual pressure during execution. Swap occupancy alone does not prove thrashing.
Keep MySQL and Claude running while measuring. RAM-backed fixtures, reflinks
or snapshots need measured I/O benefit and independent-write/recovery evidence
before adoption.
