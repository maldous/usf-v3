# USF operator context for Hermes feedback

This is provider-neutral, advisory-only USF operator context. A consuming
configuration must bind its exact digest and provenance through an explicit
allowlist.

## Imported operator guidance

This document contains a bounded attributed adaptation of
`usf-v3-operator`, source digest
`sha256:14672e49700a4712b7db168825b4a6bea587b5f3364d22493fdbcbc826749800`,
import version `usf-v3-operator-guidance:1`. It is repository content, not a
runtime dependency on a Codex host path, session, credential, or private skill
installation. The adaptation is limited to these operating rules:

- Read current CLI help before selecting an operation; static guidance cannot
  replace current command authority.
- Keep source manifest/binding authority distinct from target work manifest and
  exact profile selection.
- Follow the governed staged path `work -> route -> call -> resolve -> apply ->
  check -> integrate`; no observation or helper output grants semantic
  authority, acceptance, proof, publication, or completion.
- Keep exact declared scope and concurrent exclusion. A proposal cannot widen
  its write set, select unrelated work, or bypass the current controller.
- When a retained completed attempt requires replacement, create a governed
  superseding binding, prepare/run that exact binding, and read its settled
  attempt/result. Do not replay the stale binding or manufacture closure.

These imported rules are provider-neutral. They are advisory context for this
helper and never activate runtime behavior or update a host skill.

The helper joins an observed lifecycle phase with a supplied settled result
reference. Its input records explicit nullable attempt, issue, lane, work,
basis, route, validation and merge joins, plus source, timestamp and clock
instance identity. The helper validates internal consistency and equality only;
it does not authenticate a supplied reference or promote recorder output, site
metrics, or provider result into an authenticated claim.

Measure only monotonic observed phase-wall duration. Do not rename it to
model-active time, queue time, provider latency, total elapsed time, or accepted
progress. Queue, model-active and token values are either nonnegative values
with producer provenance or explicit nulls. Raw provider outcome is separate
from semantic disposition.

Propose accepted-progress or ROI guidance only after at least three distinct
settled, accepted attempts have the same comparable scope and measurement
definition. Separately, at least three distinct settled attempts with the same
comparable scope and one failure kind may justify a narrow recurring-failure
advisory proposal for failed validation, provider failure, or merge failure.
Failure guidance never claims accepted progress or ROI. Both proposal kinds are
data for a separately governed decision and must not activate semantics, modify
routing, update a host skill, or apply themselves.

Context is an explicit digest-addressed allowlist. Never read private Codex
runtime state, chat/session material, credentials, ambient host configuration,
or provider-specific private prompts.
