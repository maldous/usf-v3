# Hermetic V3 release proof — 2026-09-03

This is a status record. `GOAL.md` remains the normative directive.

USF V3 is hermetic. V1 and V2 are historical provenance only. ANQR sits inside
the same validated semantic authority and realisation methodology as USF. A
clean clone independently reproduces the build, the tests, the graph invariants
and every deterministic identity. The canonical branch is pushed. The working
tree is clean.

**V3 is technically ready to tag. This record does not tag it.**

## Release identity

| | |
|---|---|
| HEAD | `f049355048355ed0cc04ad188fa336ea7daa6483` |
| Tree | `dd59d55a4296244a7e0a0238510d441a0259b4a9` |
| Branch | `v3-authority-transition` |
| Remote | `github.com/maldous/usf-v3`, ref sha equals local HEAD, 0 ahead |
| Working tree | clean, 0 entries, 1 worktree |
| Product repository | `maldous/anqr-v3` `main` at `1cf44ce093028f77bbf6a4db67ae1d0600570283`, clean, 0 ahead |

27 commits were pushed. The range was inspected in full: one author and one
committer throughout, zero merge commits, the remote an ancestor of local HEAD
so the push was a fast-forward with no history rewritten, and every touched path
inside the repository tree. Ten commits are from this boundary; seventeen were
already unpushed before it.

## Corpus

| | |
|---|---|
| Authored graph sources | **21** (recursive; `graph/fixtures/` deliberately excluded) |
| Quads | **33 177** |
| Subjects | **4 751** |
| Predicates | **1 291** |
| Edges between defined subjects | **13 773** |
| Weakly connected components | **1** |
| Out-degree minimum / sinks | **1 / 0** |

## Gate

| | |
|---|---|
| Invariants checked | **16** |
| Violations in owned graphs | **0** |
| Legacy violations / accepted constant | **24 / 24** |
| `gateConforming` | **true** |
| Unparsed sources | **0** |
| Undeclared predicates | **0** of 1 291 |
| Untyped subjects | **0** of 4 751 |
| Undeclared types | **0** |
| Dependency edges / cycle | 260 / **none** |

## Build, test, containment, derivation

| | |
|---|---|
| Build | offline frozen-lockfile bootstrap, no network fetch, catalogue at the exact recorded digests |
| Tests | **421/421**, typecheck clean |
| Containment | **pass**, 9 rules |
| Manifest derivation | **15/15** |
| Transaction postimage validation | 21 sources, 33 177 quads, 16 invariants, conforming |

## Deterministic evidence

| Lane | Capabilities | UNSATISFIED / BLOCKED / STALE / NOT_ASSESSED | Verdict digest |
|---|---|---|---|
| core | 64/64 | 0 / 0 / 0 / 0 | `sha256:e958768a3ba88f5e2efb45c983668fb4e7dce3c1d5deb95f6397bb8412d7f306` |
| anqr | 39/39 | 0 / 0 / 0 / 0 | `sha256:17d52953f7217e8acb6d9818c67c45eedef40e92d7e2963140925f5284df09cf` |
| composed | 103/103 | 0 / 0 / 0 / 0 | `sha256:3a9fa0d63031954f8f701f1aa0ae3694390315fa9a46bebdb16afefba674f0ac` |

Semantic authority identity of the live lane:
`sha256:2e6a4780d3dc17df860f226093622aacf7dc2c220ccf87a68de734f9d1a5bf9f`.
ANQR closure identity:
`sha256:a3a2d8103e71ff0502a4230308e4b94b167900cf7f309e97f9261310c1eb3b52`.

## Realisation

| | |
|---|---|
| USF realisation | 29 artefacts satisfied, 8 superseded, 0 authority-blocked, 0 drifted, frontier 0 |
| ANQR realisation | `current`, 14-resource closure, 0 moved/added/removed, 0 external drift |
| Hermes | not running; ready 0, blockers 0, work graphs 0, awaiting conformance check 0 |

## Clean-clone proof

A private standalone lane held `--no-hardlinks` clones of both repositories,
usf-v3 detached at the release commit and anqr at `1cf44ce`, given only the
hermetic inputs a third party supplies: the pnpm store and frozen catalogue
beneath the ignored runtime root, the repository locator, and an empty mode-0600
env file. `FORCE_COLOR` was unset. The environment had no V1 repository, no V2
repository, no historical worktree, no historical build product, no historical
runtime state, no external source tree and, after one removal described below,
no developer-local symlink.

Every step passed in the clone: offline bootstrap, `usf init`, containment,
421/421 tests with typecheck clean, graph integrity, 15/15 manifest derivation,
transaction postimage validation over a product-overlay path, conformance
evidence regenerated from tracked bytes in five cage cycles with nothing
dispatched to any provider, USF realisation, ANQR realisation, and Hermes
readiness. The clone tree stayed clean at the exact commit throughout, and was
removed once this record was written.

**29 deterministic identities were compared clone against canonical. 0 differ.**
Source, quad, subject, predicate and component counts; owned, legacy and
accepted violation counts; the invariant count; all three verdict digests; all
three capability ratios; all twelve facet state counts; and the lane semantic
digest.

### One real finding, fixed rather than excused

The proof environment initially contained a developer-local symlink: an
untracked, **dangling** pnpm-store project link pointing at
`/tmp/usf-carrier-…/repository`, a carrier lane deleted long ago. It was inert
and the build succeeded either way, but it is exactly the class of leftover the
proof environment must not contain. It was removed from the lane and from the
canonical ignored cache, and the offline build was re-run to confirm nothing
depended on it. Zero dangling links remain in either.

## Historical independence

Each proposition below is proven twice: statically against the canonical
checkout, and dynamically by the clean clone completing that step with no
historical material reachable.

| Proposition | Result |
|---|---|
| V1 required to build | **no** |
| V2 required to build | **no** |
| V1 required to test | **no** |
| V2 required to test | **no** |
| V1 required at runtime | **no** |
| V2 required at runtime | **no** |
| V1 required by Hermes | **no** |
| V2 required by Hermes | **no** |
| V1 required to realise USF | **no** |
| V2 required to realise USF | **no** |
| V1 required to realise ANQR | **no** |
| V2 required to realise ANQR | **no** |

Static evidence: exactly four tracked files name a historical path, and all four
are the containment-exempt provenance documents — the containment guard refuses
any other. No source, test, script or configuration imports a V1 or V2 module or
package. No build or test script references a historical path; the only matches
are the containment guard's own prohibition patterns. No code reads a historical
environment variable. The pinned sources in
`config/semantic-recovery-sources.json` carry a revision and a tree digest and
**no filesystem path field at all**, which is what makes them re-obtainable
rather than depended upon. No Hermes module references historical material.

Retained V3-owned provenance is untouched: the pinned source set, the historical
inventory, the disposition ledger, the transition record, and the
re-verification lane. None is a dependency; the lane's extractor takes exact
supplied bytes and refuses `LEGACY_EXTRACTION_COMMIT_OID_MISMATCH` when the
pinned sources are not supplied.

## The repaired validation boundary

Each repair retains a planted-defect regression proof.

| Property | Regression proof |
|---|---|
| Graph source discovery is recursive | asserts the exact source count derived from the filesystem at run time; a flat `readdir` lands on the root-only figure and fails |
| Every authored source is parsed | asserts `unparsedFiles` is empty over all 21 |
| ANQR product graphs cannot bypass integrity | the same count assertion; the overlay is inside it |
| Transaction postimages cannot bypass validation | a no-op append to a product-overlay path must report 21 sources parsed |
| Every used predicate is declared | `undeclared-predicate`, planted, reported once per predicate |
| Every subject is typed | `untyped-subject`, planted |
| The corpus is one graph | `disconnected-graph`, planted, one violation per component |
| Integrity output is deterministically ordered | two runs over reversed input agree, including component ordering |

Reverting both loaders to the flat `readdir` that caused the original defect
fails both discovery tests; restoring the repairs passes both. That was executed,
not assumed.

## Reference exceptions

20 IRI references resolve to no subject. They are out-of-model **by design** and
were deliberately not "fixed" to reach zero.

- **11 named-graph labels** (`urn:usf:graph:*`). A named graph is the fourth
  component of a quad. It is never a subject, so referencing one through
  `conventionExemptGraph`, `targetNamedGraph`, `admissionGraph` or
  `stateReasonGraph` is correct and complete.
- **9 wire schema identities** (`urn:usf:cli-error:1`, `urn:usf:contribution:1`,
  `urn:usf:lane-census-result:1` and six more). These are the `"schema"` string
  in a JSON payload, not a graph resource. The declared `urn:usf:schema:*`
  resources point at them through `schemaIdentity`, so the graph resource and
  the wire identifier are deliberately distinct identities.

Both classes are registered in `terminalIdentifierKinds`, so the gate treats
them as terminal rather than dangling — and an unregistered one still fails.
Registering `usf graph lanes` proved that: its output schema was refused as a
dangling reference until it joined the list.

**Single-component connectivity is not strong evidence and is not claimed as
such.** Type-declaration edges connect the corpus by construction: an instance
reaches its type, its type reaches the meta-type, and the meta-type is in the
vocabulary. A typed subject therefore cannot be an island however little else
references it, so only untyped subjects, or subjects whose type is undeclared,
ever could be. The metric's real value is that it caught four untyped
definition-only subjects; beyond that it is close to tautological, and a test
asserts the bound so the number is not over-read.

## Open decision surfaces

These are **deferred product and operational decisions, not hidden release
failures**. Each is recorded in the graph with its evidence, and none blocks
build, test, containment, integrity, realisation or Hermes.

1. **33 of 34 realisation lanes are policy-uncovered — 184 of 208 work slots.**
   Publication-policy admission is a precondition for construction authority and
   completion, so an uncovered lane cannot complete under any amount of work.
   This is structural inadmissibility under current policy, recorded on
   `urn:usf:realisation-lane-census:1`, and it is explicitly **not**
   implementation backlog. Giving any lane a disjoint policy pair is a decision
   available at any time; nothing forces it.
2. **Four works carry no publication policy anywhere in the corpus** —
   `foreground-lifecycle`, `semantic-first-eligibility`,
   `realisation-basis-chain`, `semantic-first-lifecycle-admission`. They are
   reachable only from dispositioned lanes and are named on the census as
   uncoverable. Recorded rather than repaired: giving them policies would assert
   authority at a boundary the corpus deliberately moved past.
3. **24 accepted legacy integrity violations**, all `multiple-type-declaration`
   on subjects typed in both `urn:usf:graph:integration` and
   `urn:usf:graph:profile-authority`. The recorded debt constant is 24 and has
   not been raised. Remodelling those declarations, or exempting the pair
   explicitly, is a semantic decision.

Four surfaces that were open before this boundary are now closed by explicit
decision rather than deferred: the six profile dispositions, the three planned
command retirements, the product-event vocabulary at nine events, and the CLI
packet — half delivered as `usf graph lanes`, half decided against with the
reason recorded.

## Nonclaims

- A conforming gate means these 16 invariants hold over these 33 177 quads. It
  is not a claim of semantic completeness, that unlisted invariants hold, or
  that the modelling is the best available.
- Structural correctness is not semantic correctness. Zero dangling references
  says every reference resolves, not that any statement is true.
- 29 matching identities prove reproducibility of *derivation* from tracked
  bytes. They do not prove the derived verdicts are the right verdicts.
- Excluding `graph/fixtures/` is a deliberate scope decision. Fixture defects
  are real defects in fixtures and are not corpus defects.
- Pushing establishes durability, not authority. Git remains carrier and
  history; currentness binds to content, tree, semantic, inventory and scoped
  dependency digests inside the repository.
- Nothing here claims staging, production, live external provider behaviour, or
  terminal proof beyond the separately recorded declaration.
- This record does not tag. The release remains an explicit final decision.

---

# Adversarial release-candidate verification — 2026-09-03

The evidence above was treated as a claim to falsify, not an assumption to
inherit. The candidate survived. **No release-blocking defect was found.**

The material weakness in the evidence above was that every clean-clone proof
**copied** `.usf/cache` and `.usf/catalog` from the canonical working directory.
That is not a fresh machine. This exercise copied nothing.

## Candidate identity, re-fixed

| | |
|---|---|
| Branch / HEAD | `v3-authority-transition` / `61073d49f1a8dced2cb072b10d2155a46d9333d5` |
| Tree | `5f33c72d94320558dd9bbab904c036b0d9696924` |
| Local == remote | yes, 0 ahead, 0 behind |
| Tracked tree | clean; 0 staged, 0 unstaged, 0 untracked |
| Worktrees / submodules | 1 / 0 |
| Tools | git 2.43.0, node v24.16.0, corepack 0.35.0, pnpm 11.24.0 pinned, bubblewrap 0.9.0, flock 2.39.3 |
| Corpus | 21 sources, 33 177 quads, 4 751 subjects, 1 291 predicates, 1 component, 16 invariants, 0 owned |

## Hygiene: every dependency classified

| Item | Class |
|---|---|
| `.usf/cache` (pnpm store) | **1 — declared reproducible.** Rebuilt from the lockfile over the network on a fresh machine. |
| `.usf/catalog` (models.dev snapshot) | **1 — declared reproducible.** Refetched by `models refresh`; digest-bound and drift-reported, not required to match. |
| `.usf/credentials/providers.env` | **2 — operator.** Never tracked; an empty mode-0600 file suffices for every gate. |
| `.usf/repositories.json` | **2 — operator.** Product checkout locator; the README gives the exact command. |
| Everything else under `.usf/` | **1 — ignored disposable state.** Regenerable; proven by the perturbation drill below. |
| `refs/usf/integration/*` (28) | **1.** Written by integration, never read as a precondition. The remote advertises none and a fresh clone fetches none. |
| Branch `main` | **2.** Retained deliberately at the last remote-verified boundary. |
| `/usr/bin/flock`, bubblewrap, Node ≥ 22, Corepack | **2 — host, declared** in the README. |
| Tracked symlinks / dangling symlinks | none / none |
| Sockets, PIDs | none; two zero-byte lock files under ignored state |
| **Category 3 (release defect)** | **none found** |

## Fresh-machine simulation — nothing copied

Cloned from `git@github.com:maldous/usf-v3.git` at the candidate SHA and
`maldous/anqr-v3` at `1cf44ce`, into a directory containing nothing else. No
`.usf`, no `node_modules`, no `refs/usf/*`. Bootstrapped only through
`./scripts/bootstrap.sh`, which installed from the registry and refetched the
catalogue over the network.

**The refetched catalogue does not match the recorded one.** models.dev has
moved: 212 provider routes against 211, 7 495 model routes against 7 488, and
different digests (`d3664a80…` against `9c9be3f3…`). That is the sharpest
available falsification test, and the candidate passes it:

| Property | Fresh clone | Canonical | |
|---|---|---|---|
| Sources / quads / subjects / predicates | 21 / 33 177 / 4 751 / 1 291 | identical | MATCH |
| Components / invariants / owned violations | 1 / 16 / 0 | identical | MATCH |
| Gate conforming | true | true | MATCH |
| Manifest derivation | 15/15 | 15/15 | MATCH |
| Live lane | 9/9 `verified-complete`, `sha256:2e6a4780…` | identical | MATCH |
| Tests | 421/421 | 421/421 | MATCH |
| Verdict digests (all three) | identical | identical | MATCH |
| Product-neutrality | 0 `urn:anqr:` quads in three core manifests; 3 948 in the product manifest | identical | MATCH |

Conformance evidence regenerated from tracked bytes in five cage cycles with
nothing dispatched to any provider. **The catalogue is genuinely an external
fact, not a semantic input.**

Two apparent discrepancies were chased and are not defects:

- `installedAdapterPackages` reads 8 on the fresh clone against 2 on canonical
  with byte-identical `node_modules`. It is derived from the catalogue's own
  adapter-package names, so it moves when the catalogue moves.
- `normalizedDigest` matches neither the normalized file's bytes nor
  `canonicalDigest` of its text. It is `canonicalDigest` of the *parsed* basis,
  deliberately stable across formatting. `rawDigest` **is** the file's byte
  digest and matches the recorded value exactly.

## Operational smoke test

Every command below was run and its output inspected.

```sh
./bin/usf graph lanes                # 15 manifests, 9 profiles, 34 lanes, 1 policy-covered
./bin/usf profile status  --manifest graph/products/anqr/manifest.json
./bin/usf profile closure --manifest graph/products/anqr/manifest.json    # 14 resources
./bin/usf query --manifest graph/manifests/v3-delivery.json --iri urn:usf:product-event:approval-granted
./bin/usf help review --json         # availability: superseded
./bin/usf review                     # COMMAND_NOT_IMPLEMENTED, exit 2
./bin/usf restore                    # COMMAND_UNKNOWN, exit 2
```

All nine declared product events resolve to a carrying capability and a facet
evidence statement; eight name a producing capability and
`tenant-config-changed` carries an explicit `producerUndeclaredReason` instead.
`review-diverse` is a documented `--strategy` value on `usf route`, implemented
with cross-provider-family **and** cross-model-family selection. The three
retired commands report `superseded` in both the JSON help and the listing, and
refuse `COMMAND_NOT_IMPLEMENTED` when invoked — they do not pretend to work.
`usf restore` is absent, and `urn:usf:cli-decision:restore-chain-operator-driven:1`
states why.

## Hermes behavioural proof

**Stable case.** Cycle advanced 8 → 9 with the tracked tree, the concatenated
graph bytes and the concatenated evidence bytes all byte-identical, 0 ready, 0
blockers, 0 tokens, 0 provider activity.

**Controlled perturbation.** One capability's conformance evidence was deleted —
`urn:anqr:delivery-capability:qrdecoding`, a product capability, so the drill
exercises the ANQR half.

| Required property | Observed |
|---|---|
| Notices the deficiency | anqr lane fell to 38/39, `remaining=1`, 5 NOT_ASSESSED facets, verdict digest moved to `84aefded…` |
| Derives appropriate work, not arbitrary | exactly one capability; `awaitingConformanceCheck` 1 |
| Routes only what is required | `cumulativeTokens` 0, provider activity 0 |
| Validates the resulting postimage | conformance re-executed in the cage, evidence record rewritten |
| Reaches the correct terminal state | 39/39, `remaining=0`, all states 0 |
| Returns to deterministic idle | ready 0, awaitingConformanceCheck 0, blockers 0 |
| Leaves no unrelated mutation | tracked tree, graph bytes, gate identities and lane digest all exactly restored |

The repaired evidence lands under a different content-digest filename, and the
**verdict digest returns to exactly `sha256:17d52953…`** — regeneration is
deterministic in what it means, not in which file holds it. The backup taken
before the drill was never used.

Hermes was then stopped cleanly: `outcome: drained`, `waitedMs: 501`, liveness
`absent`.

## Negative testing

Each historical failure mode was reintroduced and removed.

| Perturbation | Rejected by | Detail |
|---|---|---|
| Flat, non-recursive graph source discovery | `tests/contract/graph-source-discovery.test.ts` | the gate reports **`gateConforming: true` over 14 sources and 29 186 quads** — silently conforming over two thirds of the corpus. Only the regression test catches it. |
| Unchecked transaction postimage | same test | the overlay postimage is neither parsed nor counted |
| Product resource in the foundation graph | `tests/unit/graph/product-overlays.test.ts` | product-neutrality invariant refuses a core graph naming `urn:anqr:` |
| Dangling external symlink | hygiene sweep (`find -xtype l`) | detected; zero present in the candidate |
| Historical path in a runtime-bearing file | `scripts/verify-contained.sh` | exit 5, names the file and the offending line |
| Undeclared predicate | `undeclared-predicate` | gate false, names the predicate |
| Event relation naming a nonexistent capability | `dangling-reference` | gate false, names the capability |

## Restore/recovery safety

The documented chain was walked in an isolated clone.

- Out-of-order steps refuse: `CONSTRUCTION_BUNDLE_SET_INVALID`,
  `WORK_COMPLETION_OPTION_REQUIRED`, `WORK_COMPLETION_REALISATION_REFUSED`.
- `publish --verify` is genuinely observational: two runs **byte-identical**,
  tracked tree unchanged, `publicationState: verified-without-publication`, and
  it projects `baseSemanticDigest`, `resultingSemanticDigest` and
  `receiptDigest` — the read-backs an operator must compare.
- `--apply` reports `created`. **Re-applying the same bundle reports
  `matching`** with `authorityEffect: existing-copy-on-write-construction-authority-authenticated`,
  the same receipt digest, and writes no second grant. Idempotent by content
  authentication rather than by refusal.
- No single command collapses the chain: `usf restore` is `COMMAND_UNKNOWN`.

One incidental discovery, and it is the guard working rather than a defect:
publication refuses `CONSTRUCTION_PRIVATE_PATH_UNSAFE` when `.usf` private-state
ancestry is not owner-contained. It fired because the drill pre-created
`.usf/candidates` from a shell with `umask 022`. The CLI creates that path itself
with `mkdir(mode: 0o700)`, so the documented flow is unaffected; hand-creating
private state with a permissive umask is refused rather than proceeding unsafely.

## Final state

Hermes stopped and drained. Both test clones removed. No usf or hermes process
of this repository remains. Zero dangling symlinks under the repository and zero
under `.usf/cache`. No residual `/tmp` state. Canonical tree clean at
`5f33c72d…`, remote HEAD unchanged at `61073d4`, no tag at HEAD.

Release gate rerun after every exercise: containment pass, gate conforming over
21 sources and 33 177 quads with one component and 16 invariants, 15/15
manifests, 34 lanes with 1 policy-covered, doctor ok, **421/421 tests**, and all
three verdict digests at their canonical values.

## Verdict

The candidate survived the fresh-clone, operational, negative, recovery, Hermes,
reproducibility and hygiene exercises with no unexplained dependency and no
unexplained mutation.

**READY_TO_TAG** — and deliberately not tagged. ANQR is not yet fully modelled;
this candidate is a clean starting line, and its three open surfaces are recorded
decisions rather than conformance debt.

---

# Release finalisation — 2026-09-03

The historical proofs above are unchanged. This section records tagging and
independent reproduction from the tag, in four distinct stages.

## 1. Certified pre-tag candidate

Reconfirmed before anything was created.

| | |
|---|---|
| Local HEAD | `9e6239e35dd1eebd50e8d381928a6329064b3145` |
| Remote branch HEAD | identical |
| Tree | `90a327dfa7c6d6beed68cf90ecdd9865fe324a44` |
| Tracked tree | clean — 0 staged, 0 unstaged, 0 untracked |
| Worktrees | 1 |
| Hermes | stopped, liveness `absent`, 0 processes |
| Dangling symlinks / temp state / test clones | 0 / 0 / 0 |
| Acceptance record at the certified commit | 442 lines, adversarial section present, `READY_TO_TAG` verdict present |

The candidate identity had not changed, so tagging proceeded.

## 2. Tag creation

The convention was read from practice rather than assumed: the repository has no
declared tag policy, `package.json` is `0.0.0` and private, and the one existing
tag is the annotated `semantic-realisation-1` — a kebab-case
`<milestone>-<sequence>` name with an annotation carrying completion state,
verdict digests and a pointer to the proof record. This boundary is named
"Hermetic V3 release proof" by the repository itself, so the tag follows as
`hermetic-release-1`.

| | |
|---|---|
| Tag name | `hermetic-release-1` |
| Object type | annotated tag object |
| Tag object digest | `1daecb23b949a5d341821cc7f557925a43af06b0` |
| Tagged commit | `9e6239e35dd1eebd50e8d381928a6329064b3145` |
| Tagger | maldous, 2026-09-03T19:44:30+10:00 |
| Remote ref | `refs/tags/hermetic-release-1` → `1daecb23…`, object type `tag`, target `9e6239e…` |

**Only the tag was pushed.** No branch moved, no commit was amended, no source
changed, no semantic artefact was regenerated and no release commit was
introduced. The established mechanics required none: the annotated tag is the
release object. The branch head was verified still at `9e6239e` after the push.

## 3. Clean tag reproduction

A new empty directory, `git clone --branch hermetic-release-1` from the remote,
and a separate clone of the product repository at `1cf44ce`. Nothing was copied
from the canonical checkout — no `.usf`, no `node_modules`, no package store, no
generated state, no worktree, no semantic artefact, no historical integration
refs (the clone fetched zero `refs/usf/*`). Bootstrapped only through
`./scripts/bootstrap.sh`.

`git describe --tags --exact-match` reports `hermetic-release-1`, HEAD is the
certified commit and the tree digest matches.

### Three identity classes, deliberately separated

| Class | At the tag | Recorded during development | Verdict |
|---|---|---|---|
| **Raw external catalogue** | `sha256:a5f72158214ee23f7751e290829085706a53a392282431abc00ea5bcf369484c`, 212 provider routes, 7 495 model routes | `sha256:9c9be3f3…`, 211 / 7 488 | **differs — expected** |
| **Normalized catalogue basis** | `sha256:25ab00464728b47b590a290cc9622adf5c8b66abb7e0fed21f2dcc6e6994fde9` | `sha256:f54dc34e…` | **differs — expected** |
| **Semantic identities** | see below | | **all identical** |

models.dev moved twice within this session's window — during adversarial
verification it read `sha256:d3664a80…`, and at tagged reproduction
`sha256:a5f72158…`. Both differ from development, and no semantic identity moved
in either case.

**This is external runtime and provider discovery, not semantic authority.** The
catalogue is refetched at bootstrap, digest-recorded for attribution, and read as
an external fact; its movement is reported as drift and never as staleness. It is
classified as such here because the semantic identities below are unchanged. Its
current or historical digest is deliberately not a release requirement.

### Semantic identities reproduced from the tag

| Property | Required | Observed | |
|---|---|---|---|
| Semantic sources | 21 | 21 | MATCH |
| Quads | 33 177 | 33 177 | MATCH |
| Subjects | 4 751 | 4 751 | MATCH |
| Predicates | 1 291 | 1 291 | MATCH |
| Connected components | 1 | 1 | MATCH |
| Invariants / owned violations | 16 / 0 | 16 / 0 | MATCH |
| Legacy debt / constant | 24 / 24 | 24 / 24 | MATCH |
| Gate conforming | true | true | MATCH |
| Manifests | 15/15 | 15/15 | MATCH |
| Tests | 421/421 | 421/421 | MATCH |
| Live lane | 9/9 `verified-complete` | 9/9 | MATCH |
| Lane semantic digest | `sha256:2e6a4780…` | identical | MATCH |
| Verdict digest, core | `sha256:e958768a…` | identical | MATCH |
| Verdict digest, anqr | `sha256:17d52953…` | identical | MATCH |
| Verdict digest, composed | `sha256:3a9fa0d6…` | identical | MATCH |
| Facet states, all lanes | U0 B0 S0 N0 | U0 B0 S0 N0 | MATCH |
| USF artefacts | 29 satisfied, 0 drifted, frontier 0 | identical | MATCH |
| ANQR closure digest | `sha256:a3a2d810…` | identical, `current`, 0 drift | MATCH |
| Containment | pass, 9 rules | pass | MATCH |

Recursive source discovery confirmed **active**: 21 authored `.nq` files exist
excluding fixtures, a root-only read would find 14, and the gate reports 21 with
7 product-overlay sources inside the corpus. Product neutrality holds one-way:
four core manifests contain 0 `urn:anqr:` quads, the product manifest contains
3 948. Conformance evidence regenerated from tracked bytes in five cage cycles
with nothing dispatched to any provider.

### One reproduction failure, diagnosed to the environment

The first full-suite run from the tag reported **420/421**.
`tests/integration/publish-transition.test.ts:115` asserts a published receipt is
mode `0644` and observed `0600`. The cause was the reproduction shell's
`umask 077`, which I had set earlier to satisfy the private-state ancestry
requirement; `src/commands/publish.ts` requests `atomicCreate(..., 0o644)` and
the umask masked it down. Rerun under the operator default umask the same test
passes and the suite reports **421/421**. Recorded rather than omitted: the
release's receipt mode is umask-derived, and the test asserts the code's intent
under a normal umask.

## 4. Final operational smoke proof

From the tagged checkout only.

```sh
./scripts/bootstrap.sh                                     # offline install + catalogue refresh
./bin/usf graph integrity                                  # 21 sources, 33 177 quads, gate true
./bin/usf graph lanes                                      # 15 manifests, 9 profiles, 34 lanes, 1 covered
./bin/usf work --manifest graph/manifests/anqr-with-foundation.json --max-items 1
./bin/usf hermes implement --manifest graph/manifests/anqr-with-foundation.json
./bin/usf profile status --manifest graph/products/anqr/manifest.json
./bin/usf help review --json                               # availability: superseded
./bin/usf restore                                          # COMMAND_UNKNOWN
```

The composed USF/ANQR manifest resolves to `sha256:0666476e…`. Capability,
module and conformance relationships are inspectable: 103 capabilities, 724
requirements, 103 landed modules, 103 landed conformance tests, 0 awaiting a
check, and all 103 carry an evidenced module-and-conformance pair — for example
`urn:anqr:delivery-capability:qrdecoding` binding
`src/capabilities/analysis/qrdecoding.ts` to
`tests/conformance/analysis/qrdecoding.conformance.test.ts`.

`review`, `observe` and `drift` each report availability `superseded` and refuse
`COMMAND_NOT_IMPLEMENTED`. **`usf restore` remains `COMMAND_UNKNOWN`.**

The documented recovery verification path was exercised: with one packet staled,
`publish construction-authority --verify` ran twice byte-identically, left the
tracked tree unchanged, reported `verified-without-publication`, and projected
the three read-backs an operator must compare — `baseSemanticDigest`,
`resultingSemanticDigest` and `receiptDigest`. No hidden single-command restore
path has appeared. The probe was reverted to zero diff.

### Hermes from the tag

Started against the tagged composed manifest as supervisor
`4e1621263a1bf49f4ea2cc864` with **authority identity
`sha256:19789067565af8195dffc5066a29c62b572b2f4caaceadd940217cc1a6a0dbf5` —
identical to the canonical run**, concurrency 5, dispatch limit 12.

| Required | Observed |
|---|---|
| Capabilities | 103 |
| Landed modules | 103 |
| Landed conformance tests | 103 |
| Ready | 0 |
| Blocked on predecessor | 0 |
| Awaiting conformance check | 0 |
| Blockers | 0 |
| Provider contact | 0 |
| Token consumption | 0 |
| Repeated stable cycles | cycles 1 → 2 observed across four samples |
| Tracked-tree mutation | none — tree `90a327df…` unchanged |
| Semantic-corpus mutation | none — graph bytes and 33 177 quads unchanged |

Drained at a cycle boundary: `outcome: drained`, `drained: true`,
`waitedMs: 501`, `terminationSignal: null`, liveness `absent`.

The adversarial perturbation was **not** repeated. It was already certified
against this exact commit and the tagged checkout behaved identically to the
certified candidate.

## Release hygiene

Reproduction checkout removed. No usf or Hermes process remains. Canonical
environment clean at `9e6239e`, tree `90a327df…`, 1 worktree, Hermes stopped,
zero dangling symlinks, zero temporary release state. Remote branch head still
`9e6239e`. Remote tag `hermetic-release-1` resolves to annotated tag object
`1daecb23…` whose target is the certified commit. Two tags exist on the remote:
`semantic-realisation-1` and `hermetic-release-1`.

## Verdict

The remote tag, checked out into an empty environment with nothing copied and
bootstrapped only through documented mechanisms, independently reproduced every
deterministic semantic identity of the certified release while the mutable
provider catalogue moved beneath it.

**TAGGED_RELEASE_REPRODUCED**
