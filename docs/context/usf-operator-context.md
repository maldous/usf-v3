# USF operator context for Hermes feedback

This is provider-neutral, advisory-only USF operator context. A consuming
configuration must bind its exact digest and provenance through an explicit
allowlist.

## Imported operator guidance

This document contains a bounded attributed adaptation of
`usf-v3-operator`, source digest
`sha256:df82615ea637d0f54981cd7c04da913bba6be5148c1a5b087905dbc039c77946`,
import version `usf-v3-operator-guidance:5`. It is repository content, not a
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
- Before confined validation, compare every runtime import, file read and
  recursively imported manifest with the candidate tree and admitted runtime
  read closure. Include helper fixtures in this audit. A broad read-only overlay
  can hide undeclared dependencies; an incomplete copied overlay can omit valid
  repository inputs. Neither establishes confined acceptance.
- Freeze graph, schema, manifest and fixture dependencies together with source.
  Confirm active readers use those frozen copies before changing shared
  authority. A live-root overlay is not an immutable candidate. Check mount
  destinations, including new files, before launching a test process.
  Use independent copies or reflinks, not hardlinks to mutable primary files;
  shared inodes can alter source bytes or block governed source replacement.
- Keep whole-graph regressions in their governed whole-graph test family. Do
  not widen runtime limits or skip assertions to fit an adapter check. Preserve
  the original regression and its negative cases when correcting test ownership.
- Inspect command-size limits and the candidate/postimage obligation-set rule
  before changing validation coverage. Replace a duplicated test entry only if
  another required obligation retains that coverage. Do not silently change the
  required receipt denominator.
- Preflight aggregate input bytes, input path/mode rules and measured selected
  test cost against the admitted runtime budget. Use supported compatible
  contribution composition when necessary, without widening limits. Unknown
  timings remain unknown; a small passing subset does not establish full cost.
- Treat fixed limits as safety ceilings, not workload estimates. Where the
  semantic contract exposes workload size or complexity, derive a bounded
  operational budget from that current context and evidence, never above the
  fixed ceiling. A timeout or size refusal is not evidence that the ceiling
  should be widened; first verify the selected work, validation denominator and
  currentness basis. Report wall, queue, active and validation time separately
  when they are observable.
- Require a genuine producer-to-reader round trip before freezing persistence
  changes. Typechecking and schema-only checks do not prove intermediate
  filesystem states, durable publication or restart/readback compatibility.
  Keep all negative assertions when eliminating unrelated repeated evaluation.
- When a failed check omits diagnostic details, retain the refusal and record
  the CLI observability gap. Inspect dependencies deterministically and repair
  the supported diagnostic boundary rather than blindly retrying or introducing
  ignored lifecycle scripts.
- Keep adapter mapping, passing checks and authenticated terminal completion
  separate. DAG topology alone cannot establish parallel safety.
- Record recurring operational gaps in Linear and fix the supported CLI surface.
  Ignored runtime files may retain temporal observations and recovery state,
  but required implementations, contracts and guidance must be tracked.
  When an error repeats an existing rule, identify the missed preflight and
  enforce it through the CLI or tests instead of adding another paraphrase.
- Keep exact declared scope and concurrent exclusion. A proposal cannot widen
  its write set, select unrelated work, or bypass the current controller.
- Current stewardship uses a caller-created opaque session identifier, not an
  externally issued credential. An authorized fresh controller can generate a
  fresh random identifier in one durable shell environment without printing it,
  then use supported claim/recover. The CLI binds the digest to the actual
  controlling parent. Never copy an old session, invent process identity, edit
  claim records, bypass a live owner or replace a healthy supervisor. Keep
  guarded operations under that parent and hand off before ending it. This does
  not authorize generating or replacing provider credentials.
- When a retained completed attempt requires replacement, create a governed
  superseding binding, prepare/run that exact binding, and read its settled
  attempt/result. Do not replay the stale binding or manufacture closure.

Version 8 retains the authorized stewardship setup correction and adds explicit
full-context freeze, dispatch-budget, dynamic-within-ceiling budget and producer/readback preflights following
the repeated USF-1192 candidate and diagnostic-boundary failures. These are
operator-requested discipline corrections, not inferred semantic requirements.
Their scope is repository validation and bounded persistence work, not provider
qualification, semantic acceptance or host admission.
It is not an automatically learned skill proposal or a measured ROI claim.

Workload-sensitive budgets are derived inputs, not replacements for safety
ceilings. A descriptor may account for scope size, dependency count, artifact
volume, expected validation cost, and configured concurrency when choosing a
budget within the fixed ceiling. It must refuse an out-of-ceiling request and
preserve the original reason code. Never increase a timeout or payload limit
merely because a job is large, slow, or important; require an authenticated
authority change and evidence from comparable settled runs.

These imported rules are provider-neutral. They are advisory context for this
helper and never activate runtime behavior or update a host skill.

Steward recovery is a same-shell operation boundary. After a supported
`steward claim` or `steward recover`, the exact returned claim and generation
must be exported as `USF_STEWARD_CLAIM_ID` and `USF_STEWARD_GENERATION` before
the guarded CLI operation. Otherwise the operation must refuse with
`STEWARD_CLAIM_STALE`; a successful claim alone is not ambient authorization.
Keep recovery, guarded mutation, and release/handoff in one durable shell and
explicitly recover a claim whose prior shell exited.

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

Publication snapshot schemas are a separate validation dependency closure from
completion check-receipt authority. Derive external schema paths from the
selected snapshot schema identities in the semantic graph; do not add those
paths to the completion policy's receipt-authority schema set merely to make a
validator resolve. Doing so changes currentness and invalidates otherwise
authentic retained check receipts. A schema-ref refusal is a tooling defect to
diagnose, not permission to weaken validation or replay the whole frontier.

When a retained check receipt fails currentness, the CLI may report a bounded
sorted claim-name list in diagnosticDetails.mismatchedClaims. Use that list to
repair the exact producer/reader contract. Do not expose or reconstruct
authority from caller-supplied values, and do not treat a cache hit as a receipt
until all currentness, identity, environment and recovery checks pass.

For repeat validation, use the registered `check` adapter as the only result
reuse surface. It may reuse a complete receipt only when the current candidate,
RealisationBasis, validation command/resource, environment, execution policy,
tool/schema/authority closure and recovery state all reauthenticate. Validator
compilation caching is an implementation detail and cannot stand in for a
receipt. Missing, stale, conflicting, partial, interrupted or unknown state
must reconcile or refuse through the native transition; it must never be
treated as a blind cache miss or replayed from a label match. This guidance
reduces repeated discovery and is provider-neutral; it does not change semantic
authority or completion rules.

For expensive terminal or lineage fixtures, separate authenticated receipt-set
setup from the read-only assertion under test. Reuse one exact
content/currentness-bound seed for later lineage mutations, never synthetic
receipts or a label-only cache hit, and report setup and assertion durations
separately. An interrupted setup is an incomplete observation, not a terminal
test result.

`transition inspect` can return `complete: true` with
`executionAuthority: none`: semantic coverage is complete, but no effect is
authorised. Keep `parallelSafety` independent and fail closed when it is
`unproven`, even if diagnostics are empty.
