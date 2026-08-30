# USF V3

USF V3 is the repository-contained semantic delivery foundation for ANQR. Its
goal is not to recreate the V1/V2 operational topology; it is to turn bounded,
canonical intent into isolated candidate changes, deterministic observations,
admitted evidence, proof, and coherent ANQR source checkpoints.

The authoritative programme directive is [`GOAL.md`](GOAL.md). The current
bootstrap is deliberately small and will grow only along the first end-to-end
realisation path.

## Bootstrap

Requirements: Git, Node.js 22 or later, Corepack, pnpm, and a POSIX-compatible
shell.

```sh
./bin/usf init
./scripts/verify-contained.sh
```

`init` creates ignored runtime state beneath `.usf/` and contacts no provider.
Provider routes are disabled until explicit zero-cost, privacy, credential, and
fresh probe evidence make them eligible.

## Current claim

This repository is at Gate 0 bootstrap. It does not yet claim live provider
contribution, ANQR realisation, proof completion, or production readiness.
