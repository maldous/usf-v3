# Acceptance bundle — composed ANQR + foundation run, 2026-09-02

Produced from the frozen-target run it claims, after that run reported
achievement; a bundle written before its run would be a promise, not evidence.
The companion file `2026-09-02-composed-run.evidence.json` carries the exact
records; this page answers the eleven reviewer questions GOAL.md §25.8 names.
Sanitized: no credential value, host identity or process identity appears.

## The run

Supervisor `45ea9be11dab54d8453154a50`, started 2026-09-02T02:59:51Z on
`graph/manifests/anqr-with-foundation.json` (the composed selection: 103
capabilities, 724 requirements across the foundation and the ANQR product),
concurrency 5, dispatch limit 10, useful-token target frozen at start: 100 000.

Achievement was reported in cycle 2: **120 871 useful tokens**, where useful
counts only tokens whose results were kept — a wasted token is not useful by
definition, and the split is recorded per cycle.

## What a reviewer can determine, and from where

1. **What meaning governed the work** — the selected manifest and its graph
   sources (tracked), each capability's facets carrying statements,
   dispositions and satisfaction conditions; profile revision 2 for ANQR with
   its foundation binding and 22-resource dependency closure.
2. **Which routes were eligible or excluded and why** — `routeHistory` in the
   evidence file: per-route attempts, successes, output acceptances/refusals
   and the standing reason code. Exclusion is always a recorded deferral with a
   reason, never a roster.
3. **Actual models and providers used** — `costAudit.byTransportAndModel`
   (all-time) and `costAudit.successfulModelsInsideRunWindow` (this run).
   Requested and actual identities are both recorded in execution evidence.
4. **What each materially contributed** — providerActivity per cycle carries
   capability, model and tokens; the semantic cache links accepted text to the
   execution evidence digest that produced it.
5. **What was changed and integrated** — one semantic transaction per owning
   repository per cycle, each recorded with its target repository, path count
   and digest; Git history in both repositories carries the checkpoints.
6. **Which checks ran** — conformance evidence records name the capability,
   module and test digests, confinement, exit code and per-facet outcomes.
7. **What evidence and proof concluded** — `facetTruth`: 553 SATISFIED,
   46 UNSATISFIED, 148 NOT_ASSESSED, 0 STALE, 99 NOT_APPLICABLE,
   5 PROFILE_SUPPLIED (exactly the foundation's own UI requirements);
   48 of 103 capabilities fully satisfied at production time.
8. **Why semantic publication was not required** — the run realises
   implementation under existing graph authority; it mints no construction,
   completion or publication authority, and the corpus digests are unchanged by
   cycles (`authorityIdentity` is manifest-derived and recorded).
9. **That paid cost was zero** — every API-transport unit across 1 009 observed
   units reports zero or absent cost; the only non-zero reported cost anywhere
   in retained evidence is the operator's own toggleable Claude subscription
   session (55 units, none inside this run's window, most recent the previous
   day). Paid fallback remains mechanically impossible: a priced model is
   eligible only under an explicit operator authorization, tested.
10. **That continuous operation and provider removal succeeded** — this run is
    the composed supervisor operating unattended across cycles with orderly
    drain; the single most successful route in history (315 of 645 all-time
    accepted entries) was removed in effect by quota exhaustion and production
    continued across other families; inside this run's window two provider
    families produced accepted results (openrouter, cohere).
11. **What remains unproven** — see nonclaims.

## Measured concurrency (GOAL 14.3)

Both measured dispatches of this run reached their target: peak observed 5 of
target 5 (= `min(8, C_target)`), parallel utilisation 0.767 then 0.664,
speedup 3.3× over serial. C_target is derived from ready independent work and
the configured cap, and states only what is modelled.

## Claims

- The composed selection realises both denominators, each capability landing in
  the repository that owns it, with routing resolved from graph authority.
- Satisfaction is derived exclusively from executed behavioural evidence
  resolved against the repository that produced it.
- The frozen useful-token target (floor 100 000, softer targets refused) was
  achieved by kept tokens alone.
- Zero paid API cost across all retained execution evidence.

## Nonclaims

GOAL.md §26 applies in full. Additionally and specifically to this run: it is
not a claim that every capability is satisfied (46 facets are UNSATISFIED and
148 not yet assessed); not a claim that the run's peak concurrency of 5 is the
host's maximum; not a claim of provider SLA or of permanent free-route
availability; and not a claim that the operator-session Claude cost is zero —
that cost is real, authorized, toggleable and outside this run.

## Regeneration

This bundle was assembled deterministically from `.usf` records and the graph.
If producing one becomes routine, that assembly belongs in a registered `usf`
command; until then, this document and its evidence file are the artefacts.
