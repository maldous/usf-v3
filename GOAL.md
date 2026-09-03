# GOAL.md — USF V3 Continuous Parallel Semantic Realisation of ANQR

## Index

The directive is normative in full. Sections 25 and 26 are retained here
because they are the completion criteria and the nonclaims, and they are
cited more than anything else. Every other section is one file under
[`docs/goal/`](docs/goal/), in directive order, with its numbering unchanged.

| § | Section | |
|---|---|---|
| 0 | Status, authority and immediate instruction | [`00-status-authority-and-immediate-instruction.md`](docs/goal/00-status-authority-and-immediate-instruction.md) |
| 1 | North Light | [`01-north-light.md`](docs/goal/01-north-light.md) |
| 2 | Normative language and decision precedence | [`02-normative-language-and-decision-precedence.md`](docs/goal/02-normative-language-and-decision-precedence.md) |
| 3 | Starting environment and historical sources | [`03-starting-environment-and-historical-sources.md`](docs/goal/03-starting-environment-and-historical-sources.md) |
| 4 | Repository identity and containment | [`04-repository-identity-and-containment.md`](docs/goal/04-repository-identity-and-containment.md) |
| 5 | Product boundary: ANQR | [`05-product-boundary-anqr.md`](docs/goal/05-product-boundary-anqr.md) |
| 6 | V1 and V2 lessons | [`06-v1-and-v2-lessons.md`](docs/goal/06-v1-and-v2-lessons.md) |
| 7 | Formal semantic model | [`07-formal-semantic-model.md`](docs/goal/07-formal-semantic-model.md) |
| 8 | Technology and third-party boundary | [`08-technology-and-third-party-boundary.md`](docs/goal/08-technology-and-third-party-boundary.md) |
| 9 | Canonical tracked layout | [`09-canonical-tracked-layout.md`](docs/goal/09-canonical-tracked-layout.md) |
| 10 | Semantic authority and lifecycle | [`10-semantic-authority-and-lifecycle.md`](docs/goal/10-semantic-authority-and-lifecycle.md) |
| 11 | Shared artefact contract | [`11-shared-artefact-contract.md`](docs/goal/11-shared-artefact-contract.md) |
| 12 | Command surface | [`12-command-surface.md`](docs/goal/12-command-surface.md) |
| 13 | Provider and zero-paid-cost architecture | [`13-provider-and-zero-paid-cost-architecture.md`](docs/goal/13-provider-and-zero-paid-cost-architecture.md) |
| 14 | Massive parallelism and continuous operation | [`14-massive-parallelism-and-continuous-operation.md`](docs/goal/14-massive-parallelism-and-continuous-operation.md) |
| 15 | Token and context economy | [`15-token-and-context-economy.md`](docs/goal/15-token-and-context-economy.md) |
| 16 | Collaboration and developer-like iteration | [`16-collaboration-and-developer-like-iteration.md`](docs/goal/16-collaboration-and-developer-like-iteration.md) |
| 17 | Git and integration semantics | [`17-git-and-integration-semantics.md`](docs/goal/17-git-and-integration-semantics.md) |
| 18 | Validation, evidence, proof and publication | [`18-validation-evidence-proof-and-publication.md`](docs/goal/18-validation-evidence-proof-and-publication.md) |
| 19 | Security, privacy and egress | [`19-security-privacy-and-egress.md`](docs/goal/19-security-privacy-and-egress.md) |
| 20 | Selective reuse and provenance | [`20-selective-reuse-and-provenance.md`](docs/goal/20-selective-reuse-and-provenance.md) |
| 21 | Adversarial bottleneck review | [`21-adversarial-bottleneck-review.md`](docs/goal/21-adversarial-bottleneck-review.md) |
| 22 | Validation and planted-defect requirements | [`22-validation-and-planted-defect-requirements.md`](docs/goal/22-validation-and-planted-defect-requirements.md) |
| 23 | Bootstrap, self-hosting and terminal proof | [`23-bootstrap-self-hosting-and-terminal-proof.md`](docs/goal/23-bootstrap-self-hosting-and-terminal-proof.md) |
| 24 | Execution plan — spent | [`24-execution-plan-spent.md`](docs/goal/24-execution-plan-spent.md) |
| 25 | Terminal outcome and completion criteria | [below](#25-terminal-outcome-and-completion-criteria) |
| 26 | Explicit nonclaims | [below](#26-explicit-nonclaims) |
| 27 | Required progress reports | [`27-required-progress-reports.md`](docs/goal/27-required-progress-reports.md) |
| 28 | First action — spent | [`28-first-action-spent.md`](docs/goal/28-first-action-spent.md) |
| 29 | Final principle | [`29-final-principle.md`](docs/goal/29-final-principle.md) |

---

## 25. Terminal outcome and completion criteria

The only successful terminal outcome is:

```text
USF_V3_CONTINUOUS_PROVIDER_INDEPENDENT_ANQR_REALISATION_PROVEN
```

It requires all conditions below.

> **Declared reached on 2026-09-03** at `usf-v3` `72d527e` with `anqr` `1cf44ce`.
> Every condition in 25.1 through 25.8 is met, criterion by criterion, in
> [`docs/acceptance/2026-09-03-terminal-declaration.md`](docs/acceptance/2026-09-03-terminal-declaration.md)
> and its evidence file. Two conditions turned on a reading of the wording here
> rather than on evidence — provider removal in 25.3 and cross-provider review
> in 25.4 — and both were put to the operator and answered; the answers are
> recorded in that document rather than absorbed into the verdict. The live
> provider criteria rest on the recorded run in
> [`docs/acceptance/2026-09-02-composed-run.md`](docs/acceptance/2026-09-02-composed-run.md).
>
> This note records that these criteria are satisfied. It changes none of them,
> and Section 26's nonclaims apply in full and are unchanged.

### 25.1 Repository and containment

- `maldous/usf-v3` exists and is independently cloneable;
- normal operation needs no V1/V2/ANQR historical directory;
- all mutable V3 state is beneath the repository;
- secrets and `.usf/` are ignored;
- no mandatory external CAS, semantic service, chroot, workflow database or coordinator;
- containment gates pass.

### 25.2 Semantics

- semantic kernel and first ANQR contract exist;
- graph validates with intended defect fixtures;
- content-only revision is deterministic;
- no self-reference;
- scoped dependency model is proven;
- unrelated changes do not globally invalidate work;
- significant publication policy is enforced;
- fresh clone reconstructs the same semantic revision.

### 25.3 Provider independence and cost

- models.dev supplies catalogue input;
- AI SDK or equivalent maintained adapters supply protocol translation;
- current Codex and Claude subscription-host model surfaces are considered
  alongside the models.dev denominator without converting either host route
  into a paid API route;
- no fixed roster;
- all configured eligible routes are considered for active work;
- at least two provider families contribute successfully live;
- requested and actual identities are recorded;
- paid fallback is mechanically impossible;
- observed paid cost is exactly zero;
- one successful provider can be removed without preventing success.

### 25.4 Collaboration and realisation

- more than one provider makes material contribution or critique;
- cross-provider review occurs where alternatives exist;
- lineages and disagreements survive resolution;
- a real non-trivial ANQR deliverable is implemented;
- iterative editing occurs without per-edit commits or semantic publication;
- candidate writes remain isolated and scoped;
- Git derives final diffs;
- coherent batches integrate normally.

### 25.5 Continuous massive parallelism

- fake-provider scale test passes 64 routes, 256 packets and 10M accounted tokens;
- supported speedup thresholds pass;
- peak live concurrent provider calls reach `min(8, C_target)` and never fall below two while two independent eligible assignments are ready;
- the pre-run live useful-token target is at least 100,000 and is achieved;
- continuous foreground operation processes at least three batches;
- the same composer is operable through explicit `usf start` and `usf stop`
  contracts without conversational intervention or hidden lifecycle state;
- multiple chains run concurrently;
- forced supervisor restart is safe;
- provider and candidate failures remain scoped;
- observed and target concurrency/utilisation are reported;
- integration/publication are measured and do not hold unrelated work.

### 25.6 Validation, evidence and proof

- affected and full validation policies are implemented;
- negative behaviour is tested;
- observations, evidence and proof are distinct;
- stale relevant evidence cannot satisfy;
- accepted evidence is bound to exact scoped dependencies;
- proof passes over current evidence;
- post-integration/publication drift is zero;
- claims and nonclaims are exact.

### 25.7 Token efficiency

- bounded packets are proven materially smaller than whole-graph/repository input;
- repeated unchanged work uses cache or is explicitly justified;
- total/useful input and output tokens are reported where providers expose them;
- useful-token target is computed before the run, frozen, at least 100,000 and achieved without fabricated work;
- gross throughput, useful throughput, yield and cache reuse are reported.

### 25.8 Auditability

From tracked Git history, semantic source and the sanitized acceptance bundle, a reviewer can determine:

- what meaning and scoped dependencies governed the work;
- which routes were eligible or excluded and why;
- actual models/providers used;
- what each materially contributed;
- what was changed and integrated;
- which checks ran;
- what evidence and proof concluded;
- why semantic publication was or was not required;
- that paid cost was zero;
- that continuous operation and provider removal succeeded;
- what remains unproven.

A blocked outcome is:

```text
USF_V3_BLOCKED_<EXACT_REASON>
```

Only unavailable mandatory credentials, no usable zero-paid-cost route, an unresolvable host limit, a genuine authority conflict, legal/human acceptance or another exact externally irreducible condition qualifies. Routine defects, failed tests, design ambiguity, provider 429s, rejected candidates and stale caches are normal work, not terminal blockers.

---

## 26. Explicit nonclaims

The V3 terminal outcome does not claim:

- multi-host distributed coordination;
- exactly-once execution;
- autonomous production deployment;
- enterprise change-control compliance;
- legal non-repudiation;
- signed human or agent identity;
- permanent free-provider availability;
- provider SLA;
- SOC or ISO certification;
- production security certification;
- full historical ANQR feature parity;
- complete realisation of every semantic concept;
- that model consensus establishes truth;
- that the foreground continuous supervisor is a production BAU service.

It does claim a continuously operating, restartable, single-repository, single-host semantic realisation system capable of parallel live zero-cost provider work and real ANQR delivery.

---
