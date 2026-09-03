*Normative. Section 22 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 22. Validation and planted-defect requirements

### 22.1 Graph

Require:

- all manifest entries parse;
- SHACL conforms;
- zero integrity violations;
- zero unresolved semantic references;
- stable canonical identity per intended concept;
- explicit obligation applicability;
- deterministic fixed-point derivation;
- repeated compilation yields identical revision digest;
- no self-referential identity;
- source/store drift zero;
- relevant dependency invalidation and unrelated-change preservation.

### 22.2 Commands

Each command has valid, malformed, stale-relevant-dependency, unrelated-change, containment, deterministic-payload and exact reason-code tests where applicable.

### 22.3 Providers

Test:

- catalogue says capable but probe fails;
- actual model/provider differs;
- routed identity hidden;
- paid fallback attempt;
- HTTP 402;
- HTTP 429 with/without `Retry-After`;
- malformed structured output;
- invalid tool call;
- duplicate identities;
- secret-shaped output;
- one provider failure does not block others;
- no eligible route gives exit 6.

### 22.4 Realisation

Test:

- path outside allowlist;
- traversal and symlink escape;
- `.git` and `.env` writes;
- relevant pre-image mismatch;
- unrelated tree movement remains applicable;
- model diff differs from Git diff;
- failed validation leaves primary tree unchanged;
- semantic relevant dependency changes;
- independent candidates batch;
- conflicting candidates become repair work.

### 22.5 Evidence/proof

Test:

- missing authority/dependency provenance;
- stale relevant source;
- unrelated source movement does not stale narrowly scoped evidence;
- failed check presented as pass;
- sibling obligation substitution;
- superseded/invalidated evidence;
- missing applicability;
- proof inferred from absence;
- server statistic alters authority identity;
- self-referential digest;
- forged stable flag;
- routine evidence is not promoted unnecessarily.

### 22.6 Continuous and scale

Use deterministic fake providers to test at least:

```text
64 provider routes
256 independent work packets
32 concurrent calls or the host safety cap, whichever is lower
10,000,000 accounted tokens
provider failure injection
watch-process restart
candidate rejection
integration batching
```

For fixed-latency fake work, measure speedup:

```text
speedup(k) = elapsed(1 worker) / elapsed(k workers)
```

For `k ∈ {2,4,8}` supported by the host, require:

```text
speedup(k) ≥ 0.60 × k
```

or produce a measured bottleneck finding, correct it and rerun. Do not waive the result by narration.

Every critical rule has a planted defect that fails for its intended stable reason, not an unrelated parse error.

### 22.7 Test portfolio economics

The full no-force-exit suite remains the authoritative local gate. Named unit,
contract, integration, lifecycle, adversarial and scale lanes exist for focused
iteration; they never waive the full gate at integration, publication or
acceptance. Every test owns one distinct semantic acceptance/refusal,
serialization invariant or real process boundary. When a new lower-cost test
subsumes an existing assertion, prune the duplicate in the same change.

Use table-driven pure tests, injected clocks, fake providers and isolated
runtime roots. Do not grow Cartesian per-command matrices, wall-clock sleeps,
network/GitHub dependencies, hidden flaky retries or repeated scale fixtures.
Ignored repository-local caches, including any future `.usf/objects` adapter,
MUST be reconstructable from tracked inputs or explicit test fixtures. Tests
MUST pass from a clean clone with an empty `.usf/`, MUST NOT require a warm CAS
or GitHub-hosted cache, and MUST exercise any future content-store invariants
locally before merely repeating them in optional hosted CI. No self-hosted
GitHub runner is a V3 prerequisite.
Establish duration budgets from at least ten clean runs on the same host class,
record p95 and slowest files, and treat a regression as a measured bottleneck.
Do not use forced test-runner exit because it can conceal leaked descriptors or
child processes.

---
