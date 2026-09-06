# Linear execution checkpoint — 2026-09-06

## Accepted scope

This checkpoint carries definition-level completion for UXF-4, UXF-7, UIF-82, UIF-83 and UIF-85, plus the discovery/decision prerequisite USF-1164. It also repairs the demonstrated USF-1171 registry/guidance mismatch and the toolchain failures encountered while validating that work. These declarations do not prove consuming-product implementation or production.

UXF revision 3 adds four product-neutral presentation contracts: accessible feedback and recovery, locale-directional layout, uncertain-assessment disclosure, and command-free observational mobile drill-down. Requirements distinguish captured data from live state, expose actual values and missingness, and require keyboard/focus/assistive access. Future observations bind the exact consumer/revision/output/environment. The current ANQR experience binding remains UXF revision 1, seed `urn:uxf:closure:initial:1`, 23 resources, closure digest `sha256:a51d140aa78e8c6b67b1708daf24b82cc20909784ffdb5dc9912b1758f2f65a4`.

UIF revision 2 is an opt-in successor importing revision 1. It defines hosting/runtime, edge/DNS/TLS, network boundaries, jobs/object-persistence and observability capability templates; typed consumer bindings; configuration/secret-reference/identity/environment isolation; and resilience, recovery and versioned upgrade/rollback. Separate JSON Schemas distinguish a whole resilience envelope from one persisted-state entry. Applicable state requires owner, retention, restore and backup; a reasoned inapplicable entry is a separate branch. A stateless consumer retains health/readiness/recovery/upgrade obligations. No provider, account, resource, credential or consumer binding was selected.

USF-1164 records actual dispatch paths, a typescript/PATCH_PRODUCER target for module production, explicit authoring blockers for unresolved producer roles and artefact mappings, packet-specific `none`, alias compatibility, and capacity-before-enforcement sequencing. It adds no dispatch or gating implementation.

## Reproducible validation boundary

The installed compiler command `node node_modules/typescript/bin/tsc --noEmit` exited 0. It invoked no package manager. The corrected no-force-exit full gate `node --run test:full` exited 0: 745 ordinary tests passed, zero failed or skipped, followed by all five graph-selected fixture obligations passing. The ordinary batch took 125746.772411 milliseconds; that duration excludes the five later fixture checks. The full log remains owner-local ignored evidence at `.usf/inputs/linear-completion-repaired-full-gate.log`.

Fixture candidate `sha256:173cf32b0408b59e89ad1160e898bb505c56ffcb9ec8771241d161432030ccce` binds basis `sha256:57a9857e04d0370236fe0e307c7f3fbc9ddd691657946727923d0b56f3070670`. Five independently read-back receipts establish one mode-1 shared confinement, three mode-2 observations (shared confinement, native metadata and peer identity), and one default child-process denial. They remain under `.usf/receipts/check/173cf32b0408b59e89ad1160e898bb505c56ffcb9ec8771241d161432030ccce/`. This is fixture evidence, not actual cross-agent takeover or production authority.

The full gate preceded the final UIF-only graph/schema transaction. That later transaction independently parsed 80 graph sources and 51628 quads against 16 integrity invariants with zero owned violations. The installed schema validator accepted synthetic stateless/stateful examples and rejected missing owner, retention, applicable backup, contradictory empty-state disposition and missing unconditional upgrade. Dedicated entry validation accepted applicable and reasoned-inapplicable entries and rejected missing owner/backup and empty reason. These are definition checks, not real recovery observations.

## Toolchain repair under GOAL section 23.2

The registry test now includes the already implemented `linear-binding` command. Hermes guidance distinguishes the detached supervisor, foreground composer and refused bare invocation, uses valid profile selections, and defers provider availability/qualification to live observations.

The old full-test glob ran mutually incompatible fixture modes in an ambient process. `scripts/test-full.mjs` preserves all six ordinary test families, excludes exactly that special file from ambient execution, then requires and checks the complete five-obligation graph-selected fixture set. It cannot publish construction authority and refuses an inactive or changed basis. `package.json` selects this runner.

Confined basis-chain validation lacked the actual `fixture-process.ts` import used by `transition.ts`. One supplemental runtime-closure read in `graph/usf-bootstrap.nq` fixes it. The historical `graph/semantic-first.nq` bytes were restored exactly after the initial work-read-path approach invalidated its immutable admission; no historical receipt was rewritten. The 15 focused basis-chain tests then passed. No assertion or confinement requirement was weakened.

Construction-only receipts were refreshed for the existing fixture-runtime and provider-capability work. They confer neither completion nor provider/production authority.

## Continuation

USF-1165 remains open. Independent review rejected the initial isolated reader candidate because a fully rehashed forged score projection could still pass without durable observation replay. The candidate is being replaced in ignored isolated state; no provider-reader implementation from that candidate is part of this checkpoint. The accepted no-clock-expiry decision and a legacy routing TTL path also require consistent disposition before claiming all readers agree.

USF-1182 remains open: live importer comparison still finds `n3`, `oxigraph` and `rdf-validate-shacl` in the lockfile but absent from package.json. A cached compiler pass does not prove frozen clean-clone bootstrap.

No push, deployment, external provider invocation, managed-resource operation, actual Claude takeover, consumer adoption or whole-programme completion was performed by this checkpoint. The ANQR worktree's existing edits and the running Hermes supervisor PID 2054583 were preserved. Re-read current Git, CLI and stewardship state before continuing; these observations are historical once the source or runtime moves.
