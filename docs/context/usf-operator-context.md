# USF operator context for Hermes feedback

This is provider-neutral, advisory-only USF operator context. A consuming
configuration must bind its exact digest and provenance through an explicit
allowlist.

## Imported operator guidance

This document contains a bounded attributed adaptation of
`usf-v3-operator`, source digest
`sha256:a3cff97711f1c50ef42b7f8b92f179436353dee76ce3c64cad519b59db77cc04`,
import version `usf-v3-operator-guidance:2`. It is repository content, not a
runtime dependency on a Codex host path, session, credential, or private skill
installation. The adaptation is limited to these operating rules:

- Read current CLI help before selecting an operation; static guidance cannot
  replace current command authority.
- Keep source manifest/binding authority distinct from target work manifest and
  exact profile selection.
- When registered, interrogate `transition inspect` for the selected root and
  re-interrogate after accepted changes. Valid bounded diagnostic JSON may
  accompany a nonzero exit; its classification is not a transport failure.
- Derive required inputs, artifacts, recovery and legal next work from current
  semantic contracts, not a remembered fixed command sequence. An observation
  or helper output grants no execution, acceptance, proof or completion.
- Deliver a coherent adapter or diagnostic family with its recovery tests and
  declared validation closure. Run the registered test set, including help and
  parser contracts, before the full gate. An isolated overlay is diagnostic
  evidence, not governed acceptance.
- Keep adapter mapping, passing checks and authenticated terminal completion
  separate. DAG topology alone cannot establish parallel safety.
- Record recurring operational gaps in Linear and fix the supported CLI surface.
  Ignored runtime files may retain temporal observations and recovery state,
  but required implementations, contracts and guidance must be tracked.
- Keep exact declared scope and concurrent exclusion. A proposal cannot widen
  its write set, select unrelated work, or bypass the current controller.
- When a retained completed attempt requires replacement, create a governed
  superseding binding, prepare/run that exact binding, and read its settled
  attempt/result. Do not replay the stale binding or manufacture closure.

Version 2 includes explicit operator-directed frontier and validation guidance.
It is not an automatically learned skill proposal or a measured ROI claim.

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
