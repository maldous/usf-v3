# USF V3

**USF is the Universal Service Foundation**: a repository-contained, reusable
semantic delivery foundation. The graph is authority — it defines durable
meaning, capabilities, contracts, constraints, acceptance obligations and
evidence requirements. Models generate candidate implementations; they do not
define truth.

**ANQR is a product**, not a branch of USF and not a layer of it. USF and ANQR
are independently versioned semantic authorities with separate namespaces and
separate authority closures. An ANQR **profile revision** binds explicitly to
an identified USF **foundation revision**; ANQR consumes identified USF
capabilities through that binding and never "latest".

**Hermes** performs bounded external realisation and orchestration. It is not
semantic authority, not part of any product's identity, and never a synonym
for USF.

V3 turns a versioned product profile and its bounded semantic closure into
isolated candidate changes, deterministic observations, admitted evidence,
proof, and coherent source checkpoints.

Naming, namespaces and repository conventions are defined once in
[`docs/naming.md`](docs/naming.md), which is the canonical source.

The authoritative programme directive is [`GOAL.md`](GOAL.md), an index carrying
the terminal criteria and the nonclaims, with its remaining sections one file
each under [`docs/goal/`](docs/goal/). The current
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
./bin/usf query --manifest graph/products/anqr/manifest.json --contract urn:anqr:contract:decoded-payload:1
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

## Relationship to V1 and V2

**V3 is the current system.** USF V1 (`maldous/usf`) and USF V2
(`maldous/usf-graph`), together with the V2 Factory (`maldous/usf-factory`) and
the pre-V3 product repository (`maldous/anqr`), are history. All four are
archived and read-only. None is an architectural plane, a runtime dependency, a
build input or a fallback, and no V3 path imports, invokes, reads or contacts
any of them.

What V3 keeps from them is evidence, held entirely inside this repository and
classified as provenance rather than architecture:

| Retained | Why it is kept |
|---|---|
| `docs/historical-inventory.md` | What was inspected at Gate 0, and what each evidence path turned out to be. |
| `docs/semantic-disposition-ledger.json`, `docs/v1-v2-lessons.md` | The disposition decisions and the reasoning that produced them. |
| `docs/v3-transition-record.md` | How V3 superseded its predecessors, and the accounting for retiring their operational plane. |

What is retained is provenance only. There is no re-verification lane and no
extraction code: the mechanism that mined those predecessors was removed once it
had nothing left to discover, because a mechanism kept for a discovery already
made is indistinguishable from one nobody has yet needed. The three requirements
it found that are still required are stated natively in
`urn:usf:contract:semantic-authority-path:1` -- one semantic ingestion path,
`bootstrap-nquads-v1` as the only operational source profile, and measured
projection ceilings -- carrying no predecessor namespace or extraction identity.
Git history is the record that the exercise happened.

`scripts/verify-contained.sh` enforces the boundary rather than asserting it. It
refuses any tracked runtime-bearing file that names a historical repository,
worktree, recovery directory or removed installation, a V1/V2 executable or
module import, historical runtime state, or any absolute development-machine
path. Five provenance documents are exempt, and each must exist and declare
itself as one.

## Current claim

The terminal outcome in `GOAL.md` § 25 is **declared reached on 2026-09-03**:

```text
USF_V3_CONTINUOUS_PROVIDER_INDEPENDENT_ANQR_REALISATION_PROVEN
```

Every condition in 25.1 through 25.8 is met criterion by criterion in
[`docs/acceptance/2026-09-03-terminal-declaration.md`](docs/acceptance/2026-09-03-terminal-declaration.md).
Composed satisfaction is 103/103 capabilities with UNSATISFIED, NOT_ASSESSED,
BLOCKED and STALE all 0, and the three verdict digests reproduce byte-identically
in a fresh clone. The live provider criteria rest on the recorded run in
[`docs/acceptance/2026-09-02-composed-run.md`](docs/acceptance/2026-09-02-composed-run.md):
120 871 useful tokens against a pre-frozen 100 000 floor, peak concurrency 5 of
target 5, two provider families accepted in-window, zero paid cost across 1 009
units. `GOAL.md` § 26's nonclaims apply in full and are unchanged.

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
