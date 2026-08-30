# USF V3 execution shim

`GOAL.md` is the single durable programme directive and semantic precedence
source for this repository. Read it completely before substantial work. Do not
create a competing plan, constitution, North Light, or hidden state model.

Resolve the repository root with `git rev-parse --show-toplevel`. Keep all
mutable runtime state under `.usf/`; tracked code and tests must work without
the historical source paths named in `GOAL.md`.

Historical repositories are read-only evidence. Reuse only bounded components
with explicit provenance, licence review, removed topology coupling, and new
deterministic validation. Never copy secrets, generated state, external CAS
layouts, or V1/V2 workflow machinery.

The overarching order is semantic model, deterministic remodel/currentness,
admitted evidence, deterministic proof, proof-warranted contract activation,
realisation, then validation. Validation feeds the next evidence/remodel cycle;
it never retroactively authorises build-first work. A contract definition,
dependency-ready packet, process-ready record, test result, Git state, or model
response cannot activate a contract.

Keep pre-realisation construction evidence/proof separate from
post-realisation completion validation/evidence/proof. A permission may depend
only on the former; the latter evaluates the authorised result and feeds a
later cycle.

A self-closing authority admission must bind a reversible exact pre-state,
delta and expected post-state in a closed tracked transition receipt outside
the semantic graph. Never let a proof hash itself into its own basis or let a
self-declared active state establish its own currentness.

Build the shortest current path from proof-warranted semantic intent to tested
ANQR software. Every command from work through check must carry or rederive one
exact current immutable realisation basis and refuse missing, mixed, fabricated
or stale authority. Use isolated candidate workspaces, scoped dependencies,
zero-paid-cost routes, and deterministic checks. A model response never
establishes truth or accepts its own output. Observation, evidence, proof,
semantic publication, and Git history remain distinct.

Prefer parallel work only for independent scopes. Keep integration and semantic
publication locks narrow. Commit coherent accepted checkpoints, not prompts or
intermediate iterations. Report exact evidence, claims, nonclaims, cost, drift,
and the next critical-path action.

Higher-precedence host safety policy applies. In particular, repository tools
must use `USF_PROVIDER_HOME` for contained provider state and set any child
process home explicitly at the process boundary; this shim does not reassign
the operator shell's `HOME`.
