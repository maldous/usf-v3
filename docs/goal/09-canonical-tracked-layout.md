*Normative. Section 9 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 9. Canonical tracked layout

Create the smallest initial tracked layout capable of the first vertical slice:

```text
.
├── GOAL.md
├── AGENTS.md
├── README.md
├── LICENSE
├── .env.example
├── .gitignore
├── .npmrc
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml          when apps/packages exist
├── tsconfig.json
├── bin/
│   └── usf
├── scripts/
│   ├── bootstrap.sh
│   ├── env.sh
│   └── verify-contained.sh
├── src/
│   ├── cli.ts
│   ├── commands/
│   ├── core/
│   ├── graph/
│   ├── providers/
│   ├── collaboration/
│   ├── realisation/
│   ├── evidence/
│   └── continuous/
├── apps/
│   └── anqr/                    created by the first ANQR slice
├── packages/                    created only for justified reusable packages
├── graph/
│   ├── manifest.json
│   ├── ontology/
│   ├── vocabulary/
│   ├── shapes/
│   ├── rules/
│   ├── contracts/
│   ├── realisations/
│   ├── evidence/
│   ├── proofs/
│   └── fixtures/
├── schemas/
├── config/
│   ├── policy.json
│   ├── providers.json
│   ├── privacy.json
│   ├── automation.json
│   └── validation.json
├── recipes/
│   ├── realise.sh
│   ├── continuous.sh
│   └── demo.sh
├── tests/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   ├── adversarial/
│   ├── scale/
│   └── live/
├── evidence/
│   └── acceptance/              sanitized terminal-proof bundles only
├── provenance/
│   └── reuse.json
└── docs/
    ├── architecture.md
    ├── anqr-first-slice.md
    ├── v1-v2-lessons.md
    ├── provider-boundary.md
    ├── semantic-lifecycle.md
    ├── bottleneck-register.md
    ├── board-summary.md
    └── decisions/
```

Do not create extra top-level homes without an accepted need.

---
