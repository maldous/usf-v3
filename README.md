# USF V3

**A repository-contained foundation for evidence-driven AI software delivery.**

USF connects versioned semantic requirements to bounded changes, deterministic checks and explicit evidence. ANQR is its first product realisation. It explores how AI-assisted engineering can preserve the difference between a proposed change, a checked result and an accepted outcome.

[Matthew Aldous](https://aldous.info/) · [Programme directive](GOAL.md) · [Current implementation boundary](#current-claim)

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
./bin/usf work --manifest graph/manifests/self-host-hermes.json --selector urn:usf:work:hermes-management-facade
./bin/usf work --manifest graph/products/anqr/hermes-manifest.json --selector profile:urn:anqr:profile:hermes-bau:1
```

Profiles are versioned semantic decision boundaries. Adding another product
overlay does not implicitly adopt its contracts, capabilities, assets, or
model requirements into an existing profile.

The graph defines optional `usf hermes` autonomous management as a
product-neutral facade over the same foreground composer and provider
evaluation model; ANQR supplies its own isolated optional BAU binding.
Deterministic `usf start` and `usf stop` remain sufficient for USF, ANQR and
later products without Hermes-Agent. Docker, GitHub, remote runners, CAS,
databases and historical repositories are not runtime prerequisites. See
[`docs/hermes-management.md`](docs/hermes-management.md).

## Current claim

Gate 0, the fake-provider/isolated-check Gate 1 path, foreground lifecycle,
provider-qualification foundation and bounded semantic-recovery tooling are
implemented. Historical recovery inventory/adoption, trusted provider receipt
and live provider contribution remain incomplete. The repository does not claim
complete semantic denominator coverage, enterprise ANQR realisation, terminal
proof, staging, production or production BAU. See
[`docs/handover.md`](docs/handover.md) for the exact optional-Hermes realization
status and current boundary.
