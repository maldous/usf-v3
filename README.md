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
./scripts/bootstrap.sh
corepack pnpm install --frozen-lockfile
./bin/usf init
./scripts/verify-contained.sh
```

The dependency-free tracked bootstrap creates the initial ignored layout; the
lockfile-pinned install then makes the TypeScript CLI available. `init`
revalidates repository-local operational state beneath `.usf/` and contacts no
provider. The current CLI cannot bootstrap its own package dependencies before
they are installed, so this ordering is required until `usf init` gains a
dependency-free entry boundary.
Provider routes are disabled until explicit zero-cost, privacy, credential, and
fresh probe evidence make them eligible.

The complete `.usf/` tree is disposable operational state: candidates, caches,
local receipts and run history may be deleted and rederived. Semantic knowledge,
accepted authority, integrated implementation and reproducible operator behavior
must live in tracked graph/source/evidence plus the registered `usf` CLI and its
help. External Codex skills are optional operator guidance, never a clean-clone
build, runtime, proof or third-party usability dependency.

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

## Product repositories

ANQR's realised source lives in its own repository, declared in the graph as
`urn:anqr:repository:main` and mapped to a local checkout through ignored
operator state, exactly as credentials are handled. Clone it beside this
repository and write the locator before running product conformance or
product-profile evaluation:

```sh
printf '%s\n' '{' ' "schema": "urn:usf:repository-locators:1",' ' "repositories": { "anqr-main": "../anqr" }' '}' > .usf/repositories.json
```

Product evidence executes against that checkout inside USF's confinement; the
product repository needs no toolchain of its own.

## Current claim

The first complete semantic realisation boundary was reached on 2026-09-02.
Every implementation-conformance facet on `graph/manifests/v3-delivery.json`
(64/64 capabilities), `graph/products/anqr/manifest.json` (39/39) and the
composed `graph/manifests/anqr-with-foundation.json` (103/103) reads
UNSATISFIED 0, NOT_ASSESSED 0, BLOCKED 0 and STALE 0. Verdicts are derived
from executed behavioural conformance evidence, never authored or stored;
re-derive them at any time with:

```sh
./bin/usf hermes implement --manifest graph/manifests/anqr-with-foundation.json
./bin/usf profile status --manifest graph/products/anqr/manifest.json
```

Since that boundary the graph integrity gate has been brought to
`gateConforming: true` — 24 legacy violations against a recorded debt constant
of 24, with 0 in owned graphs — by declaring the corpus functional-predicate set
in the graph rather than raising the constant. All six enumerated V1 capture
remainders now carry a verdict, and the ISO/IEC 27001:2022 Annex A governance
layer is captured, so `apps/platform/assurance/statement-of-applicability.json`
is derived by a deterministic generator over 93 declared controls with 93
decided and 0 pending:

```sh
./bin/usf graph integrity
./bin/usf hermes realise
```

Claims stop there: no staging, production, terminal proof or live external
provider behaviour is claimed. The statement of applicability is
`prepared-not-certified` and carries `no-iso-certification-claim` and
`no-external-auditor-acceptance-claim` — it records which controls apply and
why, not that any is implemented or that any audit has occurred. Packet-lane
completion records under `graph/manifests/self-host-provider-v3.json` are
point-in-time authority whose currentness moves with the exact bytes they bind.
See [`docs/handover.md`](docs/handover.md) for the current position and what
remains, and [`docs/acceptance/`](docs/acceptance/) for the recorded acceptance
run.
