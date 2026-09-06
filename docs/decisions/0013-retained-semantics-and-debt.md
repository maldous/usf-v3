# 0013 — Retained semantics and accepted debt disposition

USF-1172 is bounded to the three named retention leads and the accepted legacy integrity debt. This current disposition supplements the dated ledger; it does not rewrite what earlier operators decided, import historical code/topology, activate new contracts, or claim all historical semantics are implemented.

On 2026-09-06 the source carrier is USF `76a3adb9f3448ecdcdf0843af2182219b54a2b86`. The historical consolidation snapshot records 653 ledger entries: RETAIN 76, MERGE 14, SIMPLIFY 202, SUPERSEDE 35, HISTORICAL 153 and OBSOLETE 173. Its 87/90 retention observation is dated, not a current count of tested concepts. The three findings have the following current disposition.

| Historical concept | Current disposition | Current evidence | Behavioral evidence boundary |
| --- | --- | --- | --- |
| ConsentBasis | Represented as the processor recording obligation; retain the resolved historical gap | `graph/v3-delivery.nq`, `urn:usf:processing-basis-model:v1:1` and `urn:usf:retention-finding:consent-basis` resolution | The graph declares basis vocabulary and per-tenant/per-purpose recording of the controller's assertion. No targeted behavioral test of the recording rule was identified here; no actual tenant assertion, lawfulness determination or compliance proof is claimed. |
| FieldTenancyClassification | SUPERSEDE | `urn:usf:retention-finding:field-tenancy-classification`; operation/repository tenancy boundaries replace field classification | Preserve tenancy intent. No field-classification mechanism or field-specific test is invented; boundary behavior needs evidence from the consuming runtime. |
| TokenClaimConstraintTemplate | SIMPLIFY | `urn:usf:retention-finding:token-claim-constraint-template`; concrete claim constraints survive while the parameterized template abstraction is absent | No reusable template implementation or template conformance is claimed. Concrete authentication constraint behavior must be checked at its declared runtime. |

The ConsentBasis finding intentionally retains the earlier OPEN_GAP assertions alongside its dated resolution; the resolution explains how the graph representation changed. Do not erase the finding or infer that its resolution proves execution. These are repository semantic dispositions, not new legal advice or product policy decisions.

The current read-only `./bin/usf graph integrity` command exited 0 with 80 parsed sources, 51,628 quads, 16 checked codes, zero owned violations, and 24 legacy violations within the accepted debt of 24. `gateConforming=true` and `conforming=false` are both preserved: the accepted-debt gate passes, while strict zero-violation conformance does not. A zero exit cannot be cited as removal of the debt.

Every row below is one current `multiple-type-declaration` subject typed in both `urn:usf:graph:integration` and `urn:usf:graph:profile-authority`. Each remains accepted legacy debt for later narrow cleanup; it is not missing intent, an independently executed behavior, or newly accepted debt. The historical ledger and these two graph files are unchanged by this disposition.

| Subject | Current disposition |
| --- | --- |
| `urn:usf:algorithm:construction-evidence-normalization:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:algorithm:no-change-completion-evidence:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:algorithm:no-change-workspace-materialisation:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:command:evidence-completion:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:command:evidence-construction:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:command:prove-completion:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:command:prove-construction:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:command:publish-construction-authority:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:command:publish-work-completion:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:command:realise-no-change:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:proof-algorithm:semantic-no-change-completion:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:admitted-no-change-realisation-receipt:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:completion-evidence-candidate:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:completion-proof-bundle:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:construction-authority-publication-result:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:construction-evidence-candidate:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:construction-proof-bundle:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:no-change-realisation-result:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:no-change-workspace-manifest:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:work-completion-publication-receipt:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:schema:work-completion-publication-result:1` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:type:AdmittedNoChangeRealisationReceipt` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:type:ConstructionAuthorityPublicationPolicy` | Accepted legacy multiple-type declaration; cleanup deferred |
| `urn:usf:type:NoChangeWorkCompletionPublicationPolicy` | Accepted legacy multiple-type declaration; cleanup deferred |

Detection is implemented in `src/graph/integrity.ts` (multiple-type detection and the current 16-code suite). `src/commands/graph-integrity.ts` owns the existing accepted debt value and separates strict conformance from its gate. `tests/unit/graph/integrity.test.ts` contains planted multiple-type and deterministic-result cases; this audit inspected those locations but did not rerun them or claim a separate test for each of the 24 subjects. The earlier full-gate result has its own carrier and scope in the execution checkpoint.

The ledger's common claim that all 29 retained integrity branches collapse into a twelve-invariant suite is historical and too broad for current enforcement reporting. Its finding places 19 in that earlier suite and ten elsewhere. The current corpus suite has 16 codes; that change does not establish a one-to-one mapping of every historical branch to an independently exercised test.

| Current mechanism family | Evidence locator | Disposition and limit |
| --- | --- | --- |
| Work cycles, unknown dependencies and ordering | `src/graph/work.ts`, `tests/unit/graph/work-dependency.test.ts`; undeclared dependency case in `tests/unit/graph/product-overlays.test.ts` | Current mechanism exists; the historical ten-branch mapping is not independently exercised. |
| Dependency and directional currentness | `src/graph/work.ts`, `src/semantic/`, `graph/foundation.nq`, product-overlay tests | Current mechanisms/policy exist; branch-level historical parity remains unverified. |
| Host/account source identity, protocol shape and authorization freshness | `src/commands/provider-receipts.ts`, `graph/provider-pipeline.nq`, `tests/contract/provider-commands.test.ts` | Policy and current test locations exist; graph declaration alone does not prove runtime enforcement of each historical branch. |

Do not invent a ten-row mapping from family descriptions. The exact branch-to-test mapping and targeted recording/tenant/claim behavioral evidence are unresolved assurance work, covered by existing USF-1169 (evidence/grader gaps) and the relevant product/runtime owner when consumed. They do not require a duplicate task or resurrection of a dropped abstraction. This first-pass disposition is complete only at the finite inventory/evidence-boundary level; implementation, strict debt removal and universal historical equivalence remain unclaimed.

V2 Stardog/CAS/chroot/coordinator/lease/fence/journal/signing topology remains rejected unless a later explicit current decision authorizes a specific replacement. A historical paragraph is evidence to assess, never an executable obligation. Revisit a row only when its current authority, implementation or evidence changes; preserve this dated disposition and record the successor decision explicitly.
