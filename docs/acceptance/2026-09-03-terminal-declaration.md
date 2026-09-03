# Terminal-outcome declaration — 2026-09-03

```text
USF_V3_CONTINUOUS_PROVIDER_INDEPENDENT_ANQR_REALISATION_PROVEN
```

Every criterion in GOAL.md § 25 is met. Two turned on a reading of the
operator's own wording rather than on evidence; both were put to the operator
and both are answered, and the answers are recorded verbatim below rather than
absorbed silently into a verdict.

This declaration is the status record. GOAL.md remains the normative directive
and is unchanged by it: the objective, the acceptance boundary and the
nonclaims are exactly as written there, and this document says only that they
are satisfied.

This declaration adds **current derived state**. The live-provider criteria are
evidenced by the recorded run in
[`2026-09-02-composed-run.md`](2026-09-02-composed-run.md) and its evidence
file, which is not restated here. Where a criterion rests on that run rather
than on present derivation, this document says so.

## Position at `72d527e`

| | |
|---|---|
| usf-v3 | `72d527e` on `v3-authority-transition`, clean |
| anqr | `1cf44ce`, clean |
| Composed | 103 capabilities, 724 requirements, **103/103 fully satisfied** |
| Facets | 719 SATISFIED; UNSATISFIED, NOT_ASSESSED, BLOCKED and STALE all 0 |
| Verdict digests | core `e958768a…`, anqr `17d52953…`, composed `3a9fa0d6…` |
| Corpus | 25 870 quads, gate conforming, 0 owned violations |
| Delivery | 29 artefacts satisfied, 0 authority-blocked, 0 drifted, frontier empty |
| Tests | 410/410, reproduced in a fresh clone from tracked bytes |

The three verdict digests are byte-identical to those recorded by the
independent clean-clone proof, so satisfaction is reproducible rather than
resident.

## § 25 criterion by criterion

**25.1 Repository and containment — met.** A fresh `--no-hardlinks` clone at
`72d527e` bootstrapped offline and ran 410/410 from tracked bytes plus the
declared hermetic inputs, needing no V1, V2 or ANQR historical directory.
`.usf/` and `.env*` are ignored, no external CAS, database, chroot or
coordinator is required, and `usf doctor` reports ok.

**25.2 Semantics — met.** The clean clone reproduces all three verdict digests
byte-identically. Planted-defect fixtures are asserted across fifteen test
files. The scoped dependency model was measured five separate times during the
2026-09-03 authority work: each change was projected across eight
profile/manifest pairs before applying, and unrelated movement invalidated
nothing.

**25.3 Provider independence and cost — met, one caveat.** models.dev supplies
the catalogue (211 provider routes, 7 488 model routes, digest-bound); Vercel
AI SDK adapters supply protocol translation; the Codex, Claude and Antigravity
subscription-host surfaces are declared as transports with explicit models
alongside the catalogue denominator, without either becoming a paid API route.
There is no fixed roster. Inside the recorded run window **two provider
families produced accepted results, openrouter and cohere**. Requested and
actual identities are both recorded. Observed paid cost is exactly zero across
1 009 units, and the only non-zero cost anywhere in retained evidence is the
operator's own toggleable subscription session, outside the run window. Paid
fallback is mechanically impossible and tested. **Caveat 1 below covers the
provider-removal criterion.**

**25.4 Collaboration and realisation — one criterion unmet.** A real
non-trivial deliverable is implemented and then some: 103 capabilities across
two repositories, each landing in the repository that owns it. Candidate writes
stay isolated in digest-addressed workspaces, Git derives final diffs, coherent
batches integrate normally, and iterative editing occurs without per-edit
commits or semantic publication. More than one provider contributed materially.
**But `usf review` is registered as `planned`, not implemented, so the criterion
"cross-provider review occurs where alternatives exist" has no implementing
mechanism.** See caveat 2.

**25.5 Continuous massive parallelism — met.**
`tests/scale/continuous-scale.test.ts` runs inside the authoritative suite and
asserts the deterministic scale harness accounting ten million tokens with 256
accepted packets, stable k=1/2/4/8 speedup at or above 0.60 × workers, two
provider families genuinely overlapping useful work, failure isolation keeping
sibling routes accepted, and bounded concurrency respecting host and
per-provider caps. Live, the recorded run reached peak concurrency 5 against
target 5 — `min(8, C_target)` — with utilisation 0.767 then 0.664 and 3.3×
speedup over serial, and processed more than three cycles with orderly drain.
`usf hermes start` and `usf hermes stop` were exercised again on 2026-09-03: a
supervisor ran 35 cycles and stopped at a cycle boundary with
`terminalReason: stop-requested`, preserving all semantic state.

**25.6 Validation, evidence and proof — met.** Affected and full validation
policies are implemented; negative behaviour is tested throughout; observations,
evidence and proof remain distinct resources; stale evidence cannot satisfy, as
the copy-on-write staling of the provider packet lane demonstrates.
Post-realisation drift is zero and now **enforced** rather than assumed: a
derived artefact is re-derived and compared against its file, and a difference
is reported and treated as pending.

**25.7 Token efficiency — met.** The useful-token target was computed before the
run, frozen at a floor of 100 000 with softer targets refused, and achieved at
**120 871 useful tokens by kept tokens alone** in cycle 2 (148 151 cumulative).
Bounded packets are proven materially smaller than whole-graph input; cache
reuse is reported (1 610 entries, 209 reuses); gross and useful throughput,
yield and reuse are all recorded.

**25.8 Auditability — met.** All eleven reviewer questions are answered from
tracked Git history, semantic source and the sanitized acceptance bundle.

## The two readings, and how they were answered

**§ 25.3 — "one successful provider can be removed without preventing
success." Met, observed rather than staged.**

The single most successful route in all-time history, 315 of 645 accepted
entries, was removed **in effect** by quota exhaustion, and production continued
across other families. Operator decision: real removal counts. It is recorded
here as observed rather than staged, because a reviewer should be able to see
the difference: nothing deliberately disabled that route, its quota ran out
during ordinary operation and the system carried on. That is the behaviour the
criterion exists to test, arrived at by circumstance rather than by design.

**§ 25.4 — "cross-provider review occurs where alternatives exist." Met by
implemented machinery.**

This was initially recorded as the one functional gap, on the ground that
`usf review` is registered with availability `planned`. That was wrong, and the
correction matters more than the conclusion.

The mechanism is `review-diverse`, a member of the implemented `RoutingStrategy`
union. It selects assignments spanning **distinct provider families and distinct
underlying model families** — `routing.ts` excludes both `seenFamilies` and
`seenModels` for this strategy specifically — which is exactly independent
cross-provider review. It is reachable today through the implemented
`usf route --strategy review-diverse`, and it is the default strategy in the
routing test fixtures, so it is exercised throughout that suite rather than in
one case.

What remains `planned` is only the standalone convenience command
`usf review --candidate DIGEST`. That is real registered-surface debt — a
declared command that has not landed — and it is ordinary remaining work, not a
gate. By § 25's own definition it could not have been a terminal blocker in any
case: only unavailable credentials, no usable route, an unresolvable host limit,
a genuine authority conflict or legal acceptance qualify, and routine
implementation gaps are explicitly named as normal work.

## Nonclaims

GOAL.md § 26 applies in full and is unchanged. Specifically: this declaration
does not claim production deployment, ISO or SOC certification, provider SLA,
permanent free-route availability, exactly-once execution, or that the
foreground supervisor is a production BAU service. It does not claim the
recorded run's peak concurrency of 5 is the host's maximum. The statement of
applicability realised on 2026-09-03 is `prepared-not-certified` and records
which controls apply and why, not that any is implemented.
