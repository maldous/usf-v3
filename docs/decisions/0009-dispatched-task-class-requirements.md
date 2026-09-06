# 0009 — Dispatched task-class requirements

## Status

Accepted decision prerequisite for USF-1164. This document does not dispatch work, qualify capacity, change routing or enforce a gate.

## Observed dispatched families

| Family | Current code fact | Decision |
| --- | --- | --- |
| Hermes implement capability module | emitted unit has an empty required-capabilities array | **Authoring blocker `TASK_CLASS_ROLE_MAPPING_UNAUTHORED`:** require a governed mapping to task class and producer role before capability requirements are emitted. No feature flag is a substitute. |
| Hermes implement capability conformance | emitted unit has an empty required-capabilities array | **Authoring blocker `CONFORMANCE_PRODUCER_ROLE_UNDECLARED`:** a conformance producer role must be decided independently; it must not borrow the REVIEWER role. |
| Hermes realise deterministic generation | deterministic generator may legitimately produce the artefact without a model | No model task class. Preserve as deterministic work. |
| Hermes realise semantic-artifact generation | unresolved model-dispatched lane with empty required-capabilities array | **Authoring blocker `ARTEFACT_CLASS_ROLE_MAPPING_UNAUTHORED`:** select class and producer role by exact artefact contract, then prove capacity separately. |
| Direct graph-execute work | reads modelCapability and requiredCapability aliases | Preserve both aliases and their declared capability filters. **Authoring blocker `TASK_CLASS_ROLE_MAPPING_UNAUTHORED`:** until the selected dispatch family has an explicit task-class and required producer-role mapping, aliases alone do not supply that missing mapping or role. This disposition is reported during authoring; it does not activate a runtime refusal for existing units. |
| Execute CLI capability filter | user-supplied capabilities are optional | Preserve optional filtering. **Authoring blocker `AD_HOC_TASK_FAMILY_UNDECLARED`:** semantic producer competence cannot be inferred from an arbitrary prompt or optional feature filter; an explicitly mechanical text-generation request remains mechanically scoped. |

## Required decision before authoring

The qualification suite presently declares four classes with four cases each: cli-design, node-test, provider-routing and typescript. The current class/role pairs are cli-design/PATCH_PRODUCER, node-test/REVIEWER, provider-routing/PLANNER_CANDIDATE and typescript/PATCH_PRODUCER. Capability-module production targets typescript/PATCH_PRODUCER, subject to exact family binding and verified capacity. Conformance production targets node-test competence but its producer-role authority is undeclared; the existing REVIEWER grant is insufficient. An artefact-specific mapping may need a different governed class: if its suite cases are absent, report `TASK_CLASS_SUITE_CASES_MISSING` rather than borrowing an unrelated qualification. Capacity, qualification and role mapping are separate prerequisites.

Negative examples: a provider-routing qualification does not qualify capability-module authoring; a typescript qualification does not qualify conformance production; catalogue features, availability, cost and a REVIEWER role do not prove producer competence.

## Compatibility and rollout

Existing WorkPacket taskClassRequirement `none` is an explicit statement for that packet only. It does not license all semantic work units. First observe the resulting family mapping without dispatch or enforcement; then USF-1166 qualifies capacity and USF-1167 decides gating. Preserve feature metadata independently.

The historical handover has no expiry acceptance while legacy routing described a TTL. That is an ambiguity, not a policy: this decision adds no expiry or TTL rule.

## Evidence boundary

Inspected source carrier `bb523b6b6a2ba418bf1daa7144b6f9735bc8d233`: `src/commands/hermes-implement.ts` identity and emitted units; `src/commands/hermes-realise.ts` deterministic and model branches; `src/commands/hermes.ts` graph dispatch; `src/commands/graph-execute.ts` alias reader; `src/commands/execute.ts` optional filter; `config/qualification.json`; `graph/work-task-class-disposition.nq`. These are executable dispatch paths, not evidence that each path was invoked during this pass. Graph-declared classes used by operator-staged WorkPackets are not counted as Hermes dispatches. The blocker names above are decision-report categories; no runtime reason code or enforcement implementation is claimed.
