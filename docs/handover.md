# USF V3 handover

## USF-1192 publication source integrated - 2026-09-08 UTC

Primary source boundary: 2f7913d0217c031a71469ddd17fc83d2db834b2e.
Tree: d1579e0d795bbea528124d65df09871c6ed6b5d9.
Primary was clean, 14 commits ahead of origin, intentionally unpushed at readback.
This handover transaction is subsequent documentation, not source acceptance.
Last full-gated/pushed boundary remains e69759e72921cfe726835889965286b341390852.
No new full repository gate has run.

USF-1192 owns the executable Linear/Hermes/USF completion circuit.
USF-1189 only independently proves/cuts over that completed circuit.
Atlas/USF-1188 remains suspended.

## Current frontier

Installed transition inspect is bounded again, not INTERNAL_ERROR:
digest sha256:03eab1d91e580bb7a50ca5df1d2759f996fabf4b6701aa52ed92e48700ae1758.
105 diagnostics, zero unmapped adapters, complete=false, executionAuthority=none.
Families: 23 operational rules, 73 implementation-only leaves, 1 inventory,
6 evaluators, 1 terminal closure, 1 terminal obligation.
Topology does not prove parallel safety.

## Integrated source and evidence

Native V2 receipt/currentness, graph sibling derivation and transition bindings
were integrated at a6bc4ea900542163ab073eed0d67c7243d72cfcb.
Tracked V2 schema: schemas/work-completion-publication-receipt-v2.schema.json.
V1 history remains readable; changed currentness is never repaired by rewriting it.

The command/check source candidate 85cf64bcd3ae3079d870065b2ad28eb1701653b9bc4645a02b778bfc58a4011d
was prepared/resolved/applied through the CLI and integrated at 2f7913d.
Basis: 9ce21abdb0e02f2bde156a48acf4da40822a921de095b5da6c1e0df58a9296c1.
CLI graph check passed91.19s; receipt db5eadf115b34d8983ab844a866dea8851632dac2f616a509d26c7ad6cf28128.
Local graph check passed36.28s; receipt 2ac76e4e41ba2f2d81edba9dc6d76b5418eb32654723fedbef109eb7b33ef19f.
Integration observation 5b2c502b1f1476deec2707fa0a9cb565713007d0e9a00fb2dd2a1e207bae6a7b:
both postimage obligations passed, neither timed out; lockwait10.417ms,
lockhold4152.49ms; rollback not-required-fast-forward.
Logs: .usf/inputs/usf1192-publication-command-check-3887-*.json and *.stderr.

Frozen fixture5f5e79764ae85deff1d7305b0976c650540399b814e61f268eb51194c4b17b9c
passed genuine two-member V2 publication, rehashed tampering, sibling-source
staleness and replay: 2/2,75.31s. Log:
.usf/inputs/usf1192-publication-v2-cohort-5f5e-run1.log.

Fresh V2 canonical recovery passed5/5, no skips/cancels, wall1848.80s:
before-source681531.454133ms; source-before-receipt287399.051245ms;
receipt-pending-before-link294457.212864ms;
receipt-linked-before-cleanup292720.62485ms; receipt-before-ack292408.550023ms.
It verifies original receipt bytes/inodes and duplicate-free replay.
Log .usf/inputs/usf1192-publication-v2-recovery-secure-tmp-3887-run1.log,
SHA2569288bf972608c3c400a7688592c48b53d1a03e1a0377b1d019c9c84d0d6fce41.
Runner2209103 settled exit0. No recovery process remains.

## Pending bounded candidates

These are temporal postimages, not installed implementation or acceptance:
- .usf/inputs/usf1192-proof-publication-fixtures/tests/integration/work-completion.test.ts
  hash5f5e79764ae85deff1d7305b0976c650540399b814e61f268eb51194c4b17b9c.
- Same candidate root tests/fixtures/realisation/completion-publication-interruption.ts
  hash4e7ff23988a7df69132676be9741702e4e073275462fab63d4456d3d39e9cc3f.
- .usf/inputs/usf1192-check-confinement-diagnostic/postimages/tests/adversarial/realisation-check.test.ts
  hash555dbddcb38835f32b2fa91044c74dea7c19ac0d041622f843d7547a2c08050e.
  Host-native ancestor refusal passed1/1,1598.545ms; no receipt, unchanged manifest.
  Log .usf/inputs/usf1192-check-confinement-diagnostic/ancestor-host-native-run1.log.
- .usf/inputs/usf1192-workspace-manifest-preflight/postimages/src/realisation/index.ts
  hash31724206011ecb56e36987d7a62fca75431346c12fb21b1799f92b5141d03b3a.
  Same root tests/unit/realisation/workspace.test.ts
  hash960d35fc78c2b9ff6ae53759a0d7032f1acb468de0a4d6385d37d1e367ea1451.
  Two low-level preflight tests passed3010.866438ms. No-change uses a genuine
  basis plus synthetic oversized policy input, not semantic policy acceptance.
  Log .usf/inputs/usf1192-workspace-manifest-preflight/evidence/focused-preflight.log.

## Recovery and operating guidance

Retain rejected/stale candidates and logs accurately until bounded cleanup.
The oversized ef7b3b58698cd6c7d2bdcf25a7992dd1dbffcd459f02786239f3cd46dfe466cc
workspace manifest was653764bytes against the512KiB reader limit; never repair
its receipt/manifest manually or raise the bound merely to fit a bundle.
Package remaining candidates within the actual CLI envelope/manifest limits.

Fixture authentication checks every ancestor directory. The diagnostic checkout
and .usf/worktrees parent are0775, so its default descendant temp root refuses.
The existing fixture TMPDIR=/home/user/src/usf-v3/.usf/tmp selects a secure
contained chain. Verify current modes/ownership; do not chmod shared parents.
An outer user-namespace overlay remaps AppArmor metadata uid0 to65534 and is not
equivalent to host-native fixture execution. Do not skip or weaken that guard.
The installed check result now preserves typed confinementFailure details.

Owned diagnostic: .usf/worktrees/proof-publication-cohort-diagnostic-6a63c55.
Its postimages are diagnostic evidence only, never a substitute for integration.
Old native diagnostic and refused candidates remain intentionally retained.
No .usf helper or historical receipt becomes semantic authority.

## Exact next transition

Run:
`./bin/usf work --profile urn:usf:profile:cli-transition-definition:1 --selector urn:usf:work:cli-transition-definition --manifest graph/manifests/cli-transition-definition.json --max-items 1`

Reauthenticate construction after the source integration, using current help
for evidence/prove/publish construction if refresh is required. Prepare the exact
pending test and preflight candidates through resolve prepare-local, resolve,
apply, graph-selected check and integrate; never inject caller basis/grants.
Re-interrogate after each accepted change. Full gate remains acceptance-bound:
confirm stable candidate, graph checks and meaningful movement since the last
full-gated boundary before spending it. Do not repeat the30-minute recovery
diagnostic without changed relevant scope or a concrete unresolved concern.

Next coherent semantic family is13 nonparallel operational roles backed by
shared no-effect native preflights; all10 parallel-safety rules remain unproven.
This requires actual shared behavior, not fingerprint-only declarations.

## Runtime and coordination

One Main steward/integrator; no competing supervisor or transaction writer.
Hermes supervisor e2f6e23b399268910ef4311d9, PID2054583 remains live.
Main controlling shell PID597933, PTY95741, is intentionally retained.
Current supported claim bfdf2be52949b1b34a064f35b5d938e22b270560be00818e9b539869279586d3,
generation e7077a052ee4ad0cae14a4d858c1e8c4683af91a9261d610ac1a2136fe9ebd55,
renewed through boot949942.33. Inspect current status before any effect.

Linear USF-1192 is the durable coordination record. Comments ced42a76 and
3f25b4d9 contain recovery and exact candidate-check evidence.
No full-gate, push, terminal circuit completion, parallel safety, provider
capacity, ANQR delivery, autonomous cutover or USF-1192 closure is claimed.
