# USF-1192 CLI transition audit

Status: implementation prerequisite, not acceptance or semantic authority.
Audited source: 632cddadacdd423fc41c604445d8f1f6ffbd2549.
Safe handover carrier: 43bca69fd9476d14a71c898e6c62c77fd87c4005.

## Contract acceptance correction

The development descriptor/interrogation draft is not accepted. Required schema
bytes must be governed tracked source, with one canonical descriptor definition
referenced by interrogation rather than independently copied. Schema generation
or validation must bind current semantic authority, not a shadow lifecycle.
Generic operational `fields` must become typed properties with explicit input
derivations, artifact proof meaning and recovery obligations.

Semantic completeness is independent of execution permission: a complete
no-effect explanation can have executionAuthority none. Current incomplete
semantics must still refuse. Topological layers never prove parallel safety;
future proven states require authenticated semantic/currentness basis and
conflict analysis. Terminal closure must include all required completion artifacts
and recovery/reconciliation obligations, not merely reachable or unconsumed nodes.
These requirements are recorded in USF-1192 comment
519a933f-e90c-4355-a7e6-e83e15143bf0. USF-1193 owns ignored-state migration and
clean-clone proof; neither ticket's prose confers execution authority.

## Current interpretation boundaries

| Concern | Current source | Observed gap |
| --- | --- | --- |
| Top-level command names | commands/help.ts, imported by dispatcher.ts | Names are shared, but the handler map in cli.ts is separate. |
| Leaf inputs | cli.ts linear-binding block; work.ts; work-completion.ts; domain parsers | Help syntax strings are not the parsers' canonical structured definitions. |
| Effect admission | cli.ts operationalMutation and argument inspections | Effect descriptions in help do not select guards. |
| Work and basis | graph/work.ts; realisation/basis.ts | Existing exact scoped derivation must be reused, not reconstructed by a controller. |
| Construction/completion | realisation/construction-authority.ts; work-completion.ts | Graph selects policies, schemas and algorithms; command sequencing remains separate. |
| Candidate/check/integration | commands/apply.ts; commands/check.ts; realisation/transition.ts | Receipt authentication and locked postimage checks are executable, but no complete artifact/recovery DAG exposes them. |
| Binding and Linear | commands/linear-binding.ts; linear-state.ts; linear-delivery.ts; hermes-linear.ts | Attempts, remote mutation transitions and delivery sequencing are code-owned. |
| Provider eligibility | graph-execute.ts; providers capabilities and route universe | Whole-catalogue qualification exists; catalogue availability is not task eligibility or acceptance. |
| Observation | hermes-lifecycle.ts; hermes-stewardship.ts | Supervisor liveness, active activity and primary mutation are distinct from semantic completion. |

Concrete drift: the graph command branch accepts `lanes`, but its unknown-operation
diagnostic lists only execute and integrity. The main entry also parses arguments
before dispatch parses them again. These are defects to cover through generated
contracts, not justification for another handwritten dispatcher.

## Existing semantic ingredients

Selected graph closures contain RegisteredCliCommand resources, publication
policies, schema/tool dependencies, work scopes, validation requirements,
directional currentness and domain-specific transition states. They do not yet
give every leaf a complete structured input/adapter/guard/recovery contract.
Identically named commands can have different versions in different graph
contexts; flattening the corpus into one global registry would lose authority.

The recovery work's requirements name original authority, attempt, execution
evidence, integration receipt, refreshed construction, no-change check,
completion proof/publication and binding readback in prose. Its empty work
dependsOn set does not encode those artifact dependencies. A generic seven-stage
semantic trace is not the required durable artifact DAG.

`usf query --iri urn:usf:cli-decision:restore-chain-operator-driven:1 --manifest graph/manifests/self-host.json --max-items 20`
returned resource digest
sha256:cedfdac9444a94b2a369a170ef4d8e128f227944b3547e23d2415a250338f833.
That decision declined a multi-effect restore shortcut and placed ordering in
the operator skill. Current operator direction replaces the skill dependency,
not the requirement for authenticated readback between effects. Preserve the
historical decision and explicitly reconcile its scope in new semantic source.

## Bounded implementation direction

One generic single-transition interpreter consumes the selected graph closure,
structured input contract and authenticated observations. The graph defines
dependencies, outputs, effect class, admissibility and recovery edges. Trusted
adapter identities select existing implementations; graph text must never name
an arbitrary executable/import path. Planning and execution share resolution.
Domain receipt readers and lock boundaries retain their existing checks.

The complete artifact DAG and deterministic parallel waves derive from those
same definitions. Missing semantics fail closed, rather than silently importing
the old controller sequence. Integration ownership, overlapping read/write
sets, authority dependencies, account capacities and Linear serialization are
explicit conflicts. Re-interrogation follows accepted effects; it is not a new
persistent workflow database or a fixed phase array.

Coverage must compare independently enumerated semantic commands/transitions,
adapter registrations and canonical input ownership. A graph assertion that
coverage is complete is not evidence. Seed orphan commands/transitions, missing
recovery, hidden downstream inputs, conflicting scopes, stale reusable
artifacts and parser bypasses. Compare full-path and stepwise terminal closure.

Repository-free static bootstrap help remains a discovery surface, never live
eligibility. Work-context interrogation must dynamically load current authority.
Any generated repository-free projection needs a checked source identity; it
cannot silently become a second semantic source.

## Nonclaims

No generic transition kernel, full-path CLI command, generated exhaustive
coverage, live autonomous failover, Linear cut-over or USF-1192 acceptance is
established by this audit. Existing tests passing does not close these gaps.
The two earlier implementation drafts remain frozen and unaccepted as recorded
in docs/handover.md. No recovery history or remote intent was deleted.
