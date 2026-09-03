*Normative. Section 17 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 17. Git and integration semantics

Git is used for:

- durable source history;
- coherent checkpoints;
- reviewable diffs;
- integration and release provenance;
- recovery.

Git is not:

- the semantic clock;
- task queue;
- model communication bus;
- run ledger;
- proof engine;
- required boundary after every edit.

### 17.1 Commit policy

Create commits for coherent durable units, such as:

- repository bootstrap;
- one accepted ANQR slice or coherent part thereof;
- one reusable V3 tool capability;
- one compatible batch of validated candidates;
- one coherent batch of significant semantic/evidence publication;
- one correction with its regressions.

Do not create commits for individual prompts, reviews, rejected candidates, test failures, retries, semantic triples or chain stages.

### 17.2 Scoped rebasing

A candidate does not become stale merely because an unrelated commit landed.

`usf apply` and `integrate` compare exact scoped path pre-images and semantic dependencies. If they remain unchanged, the candidate may be applied/rebased and rechecked without repeating provider work.

### 17.3 Integration bottleneck control

Integration and semantic publication are inherently single-writer at the exact designated source-workspace mutation instant. They share one repository-local `primary-mutation` lock and MUST NOT acquire nested mutation locks in conflicting order. All preparation and validation occurs before acquiring it; post-mutation affected verification occurs after the smallest necessary atomic write/commit step where safe. Keep the lock narrow.

Prepare, validate and queue candidates in parallel. Batch independent changes. Measure mutation-lock duration and queue delay. Continue unrelated read/provider/workspace work while the lock is held.

---
