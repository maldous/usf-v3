# Retained worktree inventory

Captured 2026-09-13 during stabilisation at HEAD 80909ad. Every entry below holds
uncommitted work belonging to an earlier lane. None is discarded, pruned or
overwritten. A worktree is only removable once its lane confirms the work is
either integrated or genuinely abandoned; absence of a prunable flag is not that
confirmation.

## `.usf/inputs/linear-completion-cli-qualification-archive`

HEAD `fd7ddbf` (`HEAD`), 3 uncommitted path(s):

    ?? graph/manifests/provider-cli-qualification.json
    ?? graph/provider-cli-qualification-grants.nq
    ?? graph/provider-cli-qualification.nq

## `.usf/inputs/usf1192-operational-support-diagnostic`

HEAD `1b1b311` (`HEAD`), 14 uncommitted path(s):

     M graph/cli-transition-definition.nq
     M graph/cli-transition-record-specifications.nq
     M schemas/cli-transition-descriptor.schema.json
     M schemas/cli-transition-interrogation.schema.json
     M src/collaboration/local-contribution.ts
     M src/commands/check.ts
     M src/commands/transition.ts
     M src/commands/work-completion.ts
     M src/graph/cli-transitions.ts
     M src/realisation/index.ts
     M tests/contract/cli-transition-coverage.test.ts
     M tests/integration/work-completion.test.ts
     M tests/unit/commands/transition.test.ts
     M tests/unit/realisation/workspace.test.ts

## `.usf/integration-worktrees/usf-1169-diagnostic`

HEAD `9ca3b38` (`HEAD`), 2 uncommitted path(s):

     M tests/integration/work-completion.test.ts
    ?? tests/fixtures/work-completion/

## `.usf/integration-worktrees/usf-1169-direct`

HEAD `03cf786` (`HEAD`), 2 uncommitted path(s):

     M tests/integration/work-completion.test.ts
    ?? tests/fixtures/work-completion/

## `.usf/workspaces/completion-receipt-1169-candidate`

HEAD `6d1600f` (`HEAD`), 5 uncommitted path(s):

     M tests/integration/work-completion.test.ts
    ?? evidence/construction-authority/a929f47fd99301dacccf64b6d73dac5f449641a290ca1209401930663e1af912.json
    ?? graph/completion-receipt-reauthentication-assurance-grants.nq
    ?? graph/completion-receipt-reauthentication-assurance.nq
    ?? graph/manifests/completion-receipt-reauthentication-assurance.json

## `.usf/workspaces/job-lifecycle-recorder-candidate`

HEAD `fd7ddbf` (`HEAD`), 8 uncommitted path(s):

     M graph/foundations/job-lifecycle-metrics-v2.nq
     M schemas/job-lifecycle-metric-event-v2.schema.json
    ?? evidence/construction-authority/9c03ea54b4babba7ecb1b3589bedbb1d995aee908383223020773780c94c0676.json
    ?? graph/job-lifecycle-recorder-grants.nq
    ?? graph/job-lifecycle-recorder.nq
    ?? graph/manifests/job-lifecycle-recorder.json
    ?? src/observability/job-lifecycle-recorder.ts
    ?? tests/adversarial/job-lifecycle-recorder.test.ts

## `.usf/workspaces/job-lifecycle-recorder-candidate-r2`

HEAD `fd7ddbf` (`HEAD`), 8 uncommitted path(s):

     M graph/foundations/job-lifecycle-metrics-v2.nq
     M schemas/job-lifecycle-metric-event-v2.schema.json
    ?? evidence/construction-authority/9c03ea54b4babba7ecb1b3589bedbb1d995aee908383223020773780c94c0676.json
    ?? graph/job-lifecycle-recorder-grants.nq
    ?? graph/job-lifecycle-recorder.nq
    ?? graph/manifests/job-lifecycle-recorder.json
    ?? src/observability/job-lifecycle-recorder.ts
    ?? tests/adversarial/job-lifecycle-recorder.test.ts

## `.usf/workspaces/job-lifecycle-recorder-candidate-r3`

HEAD `fd7ddbf` (`HEAD`), 8 uncommitted path(s):

     M graph/foundations/job-lifecycle-metrics-v2.nq
     M schemas/job-lifecycle-metric-event-v2.schema.json
    ?? evidence/construction-authority/9c03ea54b4babba7ecb1b3589bedbb1d995aee908383223020773780c94c0676.json
    ?? graph/job-lifecycle-recorder-grants.nq
    ?? graph/job-lifecycle-recorder.nq
    ?? graph/manifests/job-lifecycle-recorder.json
    ?? src/observability/job-lifecycle-recorder.ts
    ?? tests/adversarial/job-lifecycle-recorder.test.ts

## `.usf/workspaces/job-lifecycle-recorder-candidate-r4`

HEAD `fd7ddbf` (`HEAD`), 8 uncommitted path(s):

     M graph/foundations/job-lifecycle-metrics-v2.nq
     M schemas/job-lifecycle-metric-event-v2.schema.json
    ?? evidence/construction-authority/9c03ea54b4babba7ecb1b3589bedbb1d995aee908383223020773780c94c0676.json
    ?? graph/job-lifecycle-recorder-grants.nq
    ?? graph/job-lifecycle-recorder.nq
    ?? graph/manifests/job-lifecycle-recorder.json
    ?? src/observability/job-lifecycle-recorder.ts
    ?? tests/adversarial/job-lifecycle-recorder.test.ts

## `.usf/workspaces/linear-binding-acceptance-r1`

HEAD `3fedcdd` (`HEAD`), 1 uncommitted path(s):

    ?? node_modules

## `.usf/workspaces/linear-binding-acceptance-r2`

HEAD `3fedcdd` (`HEAD`), 1 uncommitted path(s):

    ?? node_modules

## `.usf/workspaces/linear-binding-current-r1`

HEAD `3f09fe8` (`HEAD`), 1 uncommitted path(s):

    ?? node_modules

## `.usf/workspaces/linear-binding-current-r2`

HEAD `a1cdf21` (`HEAD`), 3 uncommitted path(s):

    ?? .closure-list-r2.mjs
    ?? .closure-list-r3.mjs
    ?? .mode2-debug-r3.mjs

## `.usf/workspaces/linear-completion-job-reader-candidate`

HEAD `efe357d` (`HEAD`), 4 uncommitted path(s):

     M src/commands/help.ts
     M src/commands/metrics.ts
    ?? src/observability/job-lifecycle.ts
    ?? tests/adversarial/job-lifecycle-metrics.test.ts

## `.usf/workspaces/metrics-record-r4-candidate`

HEAD `72648ed` (`HEAD`), 9 uncommitted path(s):

     M src/commands/help.ts
     M src/commands/metrics.ts
     M tests/contract/operator-observability.test.ts
    ?? evidence/construction-authority/a7d75e37b2c363c2798412ad6175c9fd786a0960b08b1a72296619d0703258dc.json
    ?? graph/manifests/metrics-record.json
    ?? graph/metrics-record-grants.nq
    ?? graph/metrics-record.nq
    ?? schemas/job-lifecycle-record-result.schema.json
    ?? tests/adversarial/metrics-record-cli.test.ts

## `.usf/workspaces/usf-1158-stewardship`

HEAD `f6cf95b` (`issue/usf-1158-stewardship`), 10 uncommitted path(s):

     M docs/hermes-management.md
     M src/cli.ts
     M src/commands/help.ts
     M src/commands/hermes-lifecycle.ts
     M src/commands/transact.ts
    ?? src/commands/hermes-stewardship.ts
    ?? src/continuous/stewardship.ts
    ?? tests/adversarial/transaction-exclusion.test.ts
    ?? tests/integration/hermes-stewardship.test.ts
    ?? tests/unit/continuous/stewardship.test.ts

## `.usf/worktrees/proof-publication-cohort-diagnostic-6a63c55`

HEAD `782ec79` (`HEAD`), 15 uncommitted path(s):

     M src/commands/check.ts
     M src/commands/resolve.ts
     M src/commands/transition.ts
     M src/commands/work-completion.ts
     M src/graph/work.ts
     M src/realisation/index.ts
     M src/realisation/work-completion.ts
     M tests/adversarial/realisation-check.test.ts
     M tests/fixtures/realisation/completion-publication-interruption.ts
     M tests/fixtures/work-completion/repository-path-checked-receipt.json
     M tests/fixtures/work-completion/repository-path-checked-receipt.provenance.json
     M tests/integration/work-completion.test.ts
     M tests/unit/commands/transition.test.ts
     M tests/unit/realisation/workspace.test.ts
    ?? tests/fixtures/realisation/checked-completion.ts

## `.usf/worktrees/proof-publication-native-diagnostic-19857b9`

HEAD `19857b9` (`HEAD`), 5 uncommitted path(s):

     M src/commands/work-completion.ts
     M src/realisation/work-completion.ts
     M tests/contract/cli-transition-coverage.test.ts
     M tests/fixtures/realisation/completion-publication-interruption.ts
     M tests/integration/work-completion.test.ts

## `/tmp/usf1192-preflight-257cey`

HEAD `b35ed3e` (`HEAD`), 3 uncommitted path(s):

     M src/realisation/index.ts
     M tests/unit/realisation/workspace.test.ts
    ?? node_modules

## `/tmp/usf1192-transition-readback-Ob4M9H`

HEAD `9a150e7` (`HEAD`), 3 uncommitted path(s):

     M src/graph/work.ts
    ?? node_modules
    ?? tests/unit/graph/transition-receipt-readback.test.ts

## `/tmp/uxf5-proposed`

HEAD `fd7ddbf` (`HEAD`), 7 uncommitted path(s):

    ?? binding.base.nq
    ?? changed-selected.json
    ?? changed-unsupported.json
    ?? closure.json
    ?? graph/manifests/anqr-uxf-pack-qualification.json
    ?? graph/products/anqr/uxf-pack-qualification.nq
    ?? readback.json

