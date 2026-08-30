# USF V3

USF V3 is a repository-contained semantic delivery foundation. ANQR is its
first product realisation, not a product-specific branch of the kernel. V3
turns a versioned product profile and its bounded semantic closure into
isolated candidate changes, deterministic observations, admitted evidence,
proof, and coherent source checkpoints.

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

The default graph manifest contains reusable USF foundation knowledge only.
Select a product or self-host overlay explicitly:

```sh
./bin/usf query --manifest graph/products/anqr/manifest.json --contract urn:usf:contract:anqr-decoded-payload:1
./bin/usf work --manifest graph/manifests/self-host.json --selector profile:urn:usf:profile:v3-self-host:1
```

Profiles are versioned semantic decision boundaries. Adding another product
overlay does not implicitly adopt its contracts, capabilities, assets, or
model requirements into an existing profile.

## Current claim

Gate 0 and the fake-provider/isolated-check Gate 1 path are implemented. The
repository does not yet claim live provider contribution, complete semantic
denominator coverage, enterprise ANQR realisation, terminal proof, staging, or
production readiness. See [`docs/handover.md`](docs/handover.md) for the exact
current boundary.
