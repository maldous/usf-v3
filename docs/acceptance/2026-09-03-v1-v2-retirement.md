# V1/V2 retirement — evidence record, 2026-09-03

This is a status record. `GOAL.md` remains the normative directive and is
unchanged by it.

V3 is the sole current system. V1 and V2 have no operational, build, runtime,
workspace or repository presence; the historical remotes are archived; and the
retained historical material is provenance and re-verification only.

## Position

| | |
|---|---|
| usf-v3 | `b7bd959` on `v3-authority-transition`, tree `409033ec`, clean |
| anqr | `1cf44ce`, clean |
| Baseline compared against | `8114d4c` plus its uncommitted provider-lane work |

## The completion condition, as decided

The directive asked for the V1 and V2 repositories to be absent. Put to the
operator, the answer was to keep the local checkouts and instead confirm that
each historical repository is a **read-only remote** with no local copy
depended upon. The pinned sources are identified by revision and tree digest and
never by path, so any checkout of the named revision satisfies the pin; the
condition below is checkable in a way that deletion is not.

| Claim | State |
|---|---|
| V1 repository as a V3 dependency | absent |
| V2 repository as a V3 dependency | absent |
| V1/V2 worktrees as a V3 dependency | absent |
| Historical runtime processes | absent |
| Historical systemd units, system and user | absent |
| External historical filesystem dependencies | absent |
| Historical remotes archived, read-only | `maldous/usf`, `maldous/usf-graph`, `maldous/usf-factory`, `maldous/anqr` |
| Local historical checkouts | retained by operator decision; not a dependency; containment-enforced |

## Proof — primary at `b7bd959`

| Step | Result |
|---|---|
| Build / typecheck | clean |
| Complete test suite | 413/413, 0 failures |
| Containment validation | pass, 9 rules |
| Semantic graph validation | `gateConforming: true`, 28 185 quads, 4 153 subjects, 0 owned violations, 24 legacy against a constant of 24 |
| USF realisation | 29 satisfied, 8 superseded, 0 authority-blocked, 0 drifted, frontier 0 |
| ANQR realisation | `current`, 14-resource closure `a3a2d810…`, 0 moved/added/removed, 0 external drift |
| Provider packet lane | 9/9 `verified-complete`, semantic digest `ca977577…` |
| Verdict digests | core `e958768a…`, anqr `17d52953…`, composed `3a9fa0d6…` |

The three verdict digests are **byte-identical to the pre-removal baseline**,
which is the equivalence the directive requires where the result is
deterministic.

## Proof — fresh clone, no historical source present

A private standalone lane held `--no-hardlinks` clones of both repositories,
usf-v3 detached at the release commit and anqr at `1cf44ce`, given only the
hermetic inputs a third party would supply: the pnpm store and frozen catalogue
beneath the ignored runtime root (its cache kept owner-private `0700`), the
repository locator, and an empty mode-0600 env file. `FORCE_COLOR` was unset
throughout. No V1, V2 or Factory source was present or reachable.

| Step | Result |
|---|---|
| `./scripts/bootstrap.sh` | offline frozen-lockfile install in 766 ms, no network fetch; catalogue read back at the exact recorded digests `9c9be3f3…` / `f54dc34e…` |
| `usf init` | ok, `providerContacted: false` |
| Containment | pass, 9 rules |
| `corepack pnpm run check` | typecheck clean, **413/413**, 0 failures |
| `usf graph integrity` | identical to primary — 28 185 quads, 4 153 subjects, `gateConforming: true` |
| Provider packet lane | 9/9 `verified-complete`, digest `ca977577…` — identical to primary |
| Self-host lane | identical to primary |
| Conformance evidence | regenerated from tracked bytes in five cage cycles, 103 capabilities, 0 dispatched to any provider |
| Verdict digests | core, anqr and composed all **byte-identical to the primary** |
| ANQR profile | closure digest identical; `usf profile record` then `usf profile status` reads `current`, 0 drift |

The lane's working tree stayed clean at the exact commit throughout. It was
removed once this record was written; the receipt is the evidence, the directory
is not.

## Containment, strengthened and proven

`scripts/verify-contained.sh` grew from three sampled path patterns to nine
rules. Each was proven by planting a defect and observing exit 5; the controls
pass.

| Rule | Planted case | Result |
|---|---|---|
| historical | historical repository path | refused |
| historical | historical worktree path | refused |
| historical | removed runner installation | refused |
| historical | removed triplestore installation | refused |
| state | historical runner work folder | refused |
| state | historical runtime socket | refused |
| executable | V1/V2 executable name | refused |
| import | V1/V2 module import | refused |
| absolute development-machine path | Linux home prefix | refused |
| absolute development-machine path | macOS home prefix | refused |
| absolute development-machine path | tilde-abbreviated home | refused |
| absolute development-machine path | both environment-variable home forms | refused |
| control | relative repository path | pass |
| control | the confined launcher's declared sandbox home | pass |
| control | a bare tilde as prose punctuation | pass |

Two exemption guards were proven separately: a tracked provenance document that
loses its classification marker refuses, and an exemption naming an untracked
path is inert, so a minimal checkout passes while still refusing a historical
path.

The guard has force against its own author. It refused three separate paragraphs
of this boundary's own prose while they were being written, which is why the
handover names no historical location and why the paragraph describing the
abbreviated-home bypass cannot spell it.

## Re-verification lane

Retained and classified as `urn:usf:reverification-lane:1`.

- No command, provider, realisation or core module imports it; the only importer
  in the repository is its own unit test.
- Not required to build or realise USF or ANQR.
- Cannot require a historical repository to remain installed: the extractor takes
  exact supplied bytes and recomputes the git object identities.
- Refuses clearly without the pinned sources —
  `LEGACY_EXTRACTION_COMMIT_OID_MISMATCH`, proven with no bytes at all and with
  bytes that are not the pinned commit object.

## Nonclaims

- Archiving a remote makes it read-only at GitHub. It is not a claim that the
  bytes are immutable, that GitHub is an authority, or that any V3 step contacts
  it. No build, test, graph inspection, runtime, BAU, currentness or acceptance
  step does.
- The retained local historical checkouts are not verified by this repository,
  not pinned by it, and not required. Their presence or absence changes nothing
  proven here.
- Confirming a pinned revision is present on a remote is a provenance
  observation, not an independent re-extraction. Independent re-extraction
  remains a separate claim requiring the pinned bytes to be supplied.
- The inert V2 operator tree named in the inventory and the unrelated `ods-*`
  container stack were deliberately left in place; neither is reachable from V3.
- `usf` gains no restore command in this boundary; that is deferred to its own
  packet by operator decision, for the reason recorded in the handover.
- Nothing here claims staging, production, terminal proof beyond the separately
  recorded declaration, or live external provider behaviour.
