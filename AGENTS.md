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

Build the shortest current path from semantic intent to tested ANQR software.
Use isolated candidate workspaces, scoped dependencies, zero-paid-cost routes,
and deterministic checks. A model response never establishes truth or accepts
its own output. Observation, evidence, proof, semantic publication, and Git
history remain distinct.

Prefer parallel work only for independent scopes. Keep integration and semantic
publication locks narrow. Commit coherent accepted checkpoints, not prompts or
intermediate iterations. Report exact evidence, claims, nonclaims, cost, drift,
and the next critical-path action.

Higher-precedence host safety policy applies. In particular, repository tools
must use `USF_PROVIDER_HOME` for contained provider state and set any child
process home explicitly at the process boundary; this shim does not reassign
the operator shell's `HOME`.
