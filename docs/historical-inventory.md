# Gate 0 historical inventory

Classification: USF-PROVENANCE-DOCUMENT. This record describes lineage. It is
not current runtime architecture, not semantic authority, and nothing in V3
reads it at build, test, validation, realisation or runtime. It names historical
locations because naming them is the evidence; the containment validation
exempts it on that basis and requires this classification line to be present.

Observed read-only on 2026-08-30 as ordinary user `user`. Secret values were
neither read nor copied. Two entries recorded as unresolved on that date were
resolved on 2026-09-03 under operator-authorized elevation; each is marked
below and the original finding is retained rather than overwritten.

## Starting state

- Source directory: `/home/user/src`; it was not a Git worktree.
- V3 checkout: absent before bootstrap; created at `/home/user/src/usf-v3`.
- GitHub target: `maldous/usf-v3`; it was absent at first inspection, then the
  operator created it private and the default `maldous` SSH identity verified
  it as an empty repository before the initial push.
- Host: Linux x86-64, Git 2.43.0, Node 24.16.0, Corepack 0.35.0.
- `pnpm` was not globally activated. The current registry version observed for
  the repository pin was 11.24.0; its binary/cache is repository-contained.
- `/home/user/src` had no current root `AGENTS.md`. The new repository shim
  points only to `GOAL.md`.

## Historical ANQR

- Local evidence path: `/home/user/src/bak/anqr`.
- Purpose: ANQR 1.0 product monorepo; the launch claim centers on `apps/web`
  and `netlify/*`. QR structural/scannability analysis is an explicit product
  capability.
- Git: `maldous/anqr`, branch `symphony/integration`, HEAD
  `a03cee561f2ad7bf9cb83f15eb857925c967e34f`.
- State: dirty before inspection only by modified `MEMORY.md`.
- Licence/ownership: no tracked root licence was found; commit metadata names
  Matthew, but legal copying terms remain unresolved.
- Relevant evidence: portable analysis contracts under
  `packages/contracts/analyze`; QR analysis code under
  `packages/domain/qr/src/analyze`; domain/application/worker/web analysis
  boundaries.
- Coupling: browser canvas, workers, `ImageData`, camera/Capacitor, React,
  i18n, state, ads, logging, Netlify, and legacy path aliases surround the full
  analyzer.
- Do not copy: `.env`, signing fields, Android/Google service configuration,
  systemd environment files, reports, archives, dependency trees, or generated
  build/test output.

## USF V1

- Local evidence path: `/home/user/src/bak/usf`.
- Purpose: semantic-first evidence-backed service foundation separating
  capabilities, providers, environments, contracts, validation, proof, and
  implementation.
- Git: `maldous/usf`, branch `main`, HEAD
  `028a9f964fd25c2fd774c1b4fde6ea1cebdf8312`.
- State: dirty before inspection: three deleted V2 entries and untracked
  `TID-Draft.pdf`; its recorded `v2/usf` submodule was unavailable.
- Licence: Apache-2.0, copyright 2026 Matthew Aldous.
- Candidate patterns: manifest-driven graph registration; deterministic graph
  digests; explicit evidence/proof separation; bounded result envelopes;
  filesystem ownership/symlink tests; negative provider/tenant tests.
- Rejected dependency/topology: Java 25/Maven/RDF4J/Jena dual-engine runtime,
  Stardog authority, chroot, external work paths, production compose, and broad
  service/tenant capability scope are not V3 bootstrap dependencies.
- Do not copy: generated compose, artifacts/evidence, validator targets,
  caches, dependency trees, environment material, reports, or derived graphs.

## USF V2 semantic graph

- Local evidence path: `/home/user/src/bak/v2/usf`.
- Purpose: graph authority workspace with compiler, Stardog gateway,
  proof/currentness tooling, materialisation/CAS adapter, MCP/CLI gateways, and
  isolation harness.
- Git: `maldous/usf-graph`, branch
  `graph/v2-bau-protected-2d7eb31`, HEAD
  `2d7eb31f0d586b32008ba854dfca0fa8437054cf`.
- State: tracked tree clean; ignored `.env`, `.work`, environments, dependency
  trees, and caches existed. Part of `.work` was unreadable.
- Licence/ownership: no tracked licence/notice was found; copying terms remain
  unresolved.
- Candidate patterns: deterministic compiler/digest binding, semantic manifest,
  proof currentness, repository-relative path/traversal/symlink checks, bounded
  gateways, and fail-closed validation.
- Rejected dependency/topology: Stardog authority, external `/var/lib` CAS and
  programme stores, chroot, coordinator-only mutation, handover states,
  witnesses, rollback protocols, and Factory projection machinery.
- Do not copy: `.env`, `.work`, receipts, caches, virtual environments,
  dependency trees, binaries, signing material, or environment-specific state.

## USF V2 Factory

- Mandated evidence path: `/home/user/src/bak/v2/root/usf-factory`.
- Availability on 2026-08-30: inaccessible. Parent `/home/user/src/bak/v2/root`
  is mode `0700`, owned by `nobody:nogroup`; the ordinary user could not
  establish whether the child was a repository or inspect identity, state,
  licence, or source. A read-only `sudo -n` attempt could not elevate: the
  container had `no new privileges`, and its preserved `/etc/sudo.conf`
  ownership was not accepted by `sudo`.
- **Resolved 2026-09-03** under operator-authorized elevation. The path is a Git
  repository: `maldous/usf-factory`, branch `factory/v2-bau-protected-e67aa4e`,
  HEAD `e67aa4e77c1c0691fd2a66b0204d6b20278094a3`.
- It contains both pinned Factory revisions declared in
  `config/semantic-recovery-sources.json`, verified by object lookup:
  `61ebde784d7b20be1cf890843e86fc290d454512` and
  `6d5a7fa11ba05580b51450af9c294fe602e50846` both resolve as commits.
- Licence: `LICENSE-NOTICE.md` is present at the repository root, which is the
  `evidencePath` the pinned source set names. The recorded reuse boundary —
  behavioural qualification and inventory metadata only — is unchanged.
- Disposition: resolved. The operator clarification recorded on 2026-08-30 (that
  this exact path holds the intended Factory files and needs root because it came
  from a chroot environment) is confirmed. No Factory source or corpus bytes have
  been incorporated; see `provenance/reuse.json`.

## USF V2 operator

- Local evidence path: `/home/user/.local/share/usf-operator`.
- Purpose: external Hermes coordination and bounded Graph/Factory observation;
  its own invariant says USF must not depend on Hermes.
- Identity: not a Git repository; branch, HEAD, remote, and cleanliness do not
  apply. Tree owner is `nobody:nogroup`.
- Licence/ownership: no licence or package ownership manifest was found.
- Candidate patterns: typed bounded bridge; path/command allowlists; masked
  credentials; repository inode/origin verification; confined launch;
  fail-closed evidence validation; minimized observations; negative acceptance
  coverage.
- Rejected dependency/topology: Hermes lifecycle/state machine, leases, ACL
  ownership choreography, system services/sockets, chroot/mount namespaces,
  signing ceremony, external CAS/programme state, fixed Graph/Factory paths,
  and current provider admissions.
- Do not copy: profiles/configuration, credential synchronizers, dated evidence,
  deployment authorizations, cache bytecode, device/inode values, signatures,
  digests, key paths, or environment-specific sockets.

## USF V2 proof cockpit

- Mandated evidence path: `/home/user/.local/share/usf-proof-cockpit`.
- Availability on 2026-08-30: inaccessible. It was `nobody:nogroup`, mode `0700`
  in this preserved environment; ordinary-user access failed and an
  operator-authorized `sudo -n` read-only attempt was prevented by
  `no new privileges`.
- **Resolved 2026-09-03** under operator-authorized elevation: the directory is
  **empty**. It is `root:root`, mode `0700`, and contains zero entries at any
  depth.
- Disposition: resolved as vacuous. The earlier entry was right to refuse a reuse
  decision from silence; the finding is that there was nothing there to decide
  about, not that a decision was made. The running V2 cockpit deployment lived at
  `/opt/usf/staging-proof-cockpit` instead, and was retired on 2026-09-03 — see
  `docs/v3-transition-record.md`.

## Gate 0 reuse decision

No historical implementation bytes are incorporated. V3 presently reuses only
programme-authorized ideas expressed as fresh, minimal code and records no
historical component entry in `provenance/reuse.json`. Exact source reuse stays
blocked until its licence, scope, provenance, and removed coupling are verified.

## Historical source availability — 2026-09-03

The pinned historical sources are identified by revision and tree digest in
`config/semantic-recovery-sources.json`, never by filesystem path. That is what
makes them re-obtainable rather than depended upon: any checkout of the named
revision satisfies the pin, and no particular copy is privileged.

Each historical repository was confirmed present on GitHub under the `maldous`
owner, and each pin was checked against it:

| Source | Remote | Visibility | State | Pin status |
|---|---|---|---|---|
| USF V1 | `maldous/usf` | public | archived | `main` HEAD is exactly the pinned `028a9f96` |
| USF V2 | `maldous/usf-graph` | public | archived | pinned `2d7eb31f` present |
| V2 Factory | `maldous/usf-factory` | private | archived | both pinned revisions present |
| ANQR 1.0 | `maldous/anqr` | private | archived | pre-V3 product history, unrelated to USF V1/V2 |

All four were archived on 2026-09-03, so each is read-only at the remote: no
push, no new issue, no workflow run. The two current repositories,
`maldous/usf-v3` and `maldous/anqr-v3`, are deliberately not archived. Before
archiving, the self-hosted runners registered to `maldous/usf` and
`maldous/usf-graph` were deregistered, so neither archive carries a stale runner.

The remotes are the durable location of this material. Local checkouts under the
operator's own backup area are convenience copies: V3 requires none of them, and
the containment validation refuses any tracked runtime-bearing file that names
one. A third party reproducing a historical claim supplies the pinned sources
themselves; a third party running V3 supplies nothing.

This is a provenance statement, not an authority one. GitHub is carrier and
history. Currentness and acceptance bind to content, tree, semantic, inventory
and scoped dependency digests inside this repository, and no build, test, graph
inspection, runtime, BAU, currentness or acceptance step contacts GitHub or
reads a historical checkout.
