# USF V3 handover

## Current position — 2026-09-03

The repository is clean, reproducible and green. `413/413` tests, the graph
integrity gate reads `gateConforming: true`, every realisation frontier is
empty, and a fresh `--no-hardlinks` clone reproduces the same result from
tracked bytes alone. V3 is the sole current system: V1 and V2 have no
operational, build, runtime, workspace or repository presence, and the four
historical remotes are archived.

| | |
|---|---|
| Tests | 413/413, typecheck clean |
| Containment | pass — 9 rules, every one planted-defect proven, plus two exemption guards |
| Integrity gate | conforming — 24 legacy against a recorded debt constant of 24, 0 owned |
| Corpus | 28 185 quads, 4 153 subjects |
| Facets (implement lane, core) | 670 — 548 SATISFIED, 90 NOT_APPLICABLE, 27 OTHER_LANE, 5 PROFILE_SUPPLIED |
| Facets (implement lane, composed) | 850 — 719 SATISFIED, 99 NOT_APPLICABLE, 27 OTHER_LANE, 5 PROFILE_SUPPLIED |
| Facets (realise lane, core) | 670 — 575 SATISFIED, 90 NOT_APPLICABLE |
| | every lane: UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED all 0 |
| Capabilities | core 64/64, anqr 39/39, **composed 103/103** fully satisfied; every frontier empty |
| Verdict digests | core `e958768a…`, anqr `17d52953…`, composed `3a9fa0d6…` — unchanged across the V1/V2 retirement |
| Delivery artefacts | 29 satisfied, 8 superseded, 0 authority-blocked, 0 drifted |
| ANQR profile | `current`, 14-resource closure `a3a2d810…`, 0 moved/added/removed, 0 external drift |
| Provider packet lane | 9/9 `verified-complete`, semantic digest `ca977577…` |
| Statement of applicability | 93 declared, 93 decided, 0 pending |

Eight authority boundaries were closed on this date. Each is described in full in
its own commit message, which is where that detail now lives:

- `14f5778` four V1 capture remainders assessed as invariants V3 satisfies by
  another mechanism — 846 of the 1 082 enumerated declarations read as backlog
  and were not.
- `10379e2` the functional-predicate set declared in the graph, resolving the
  `gateConforming: false` condition the housekeeping boundary below left open.
  The debt constant was **not** raised; it is unchanged at 24 and now truthful.
- `251d604` the ISO/IEC 27001:2022 Annex A governance layer captured from the
  pinned V1 sources, and the statement of applicability realised by a
  deterministic generator with zero model invocations.
- `300855b` a `writeAuthority` status projection, so "who may write path X, by
  which mechanism" is answerable without grepping three predicates.
- `202246d` an open product-event vocabulary, so canonical events the delivery
  facets name in prose are stated as resources.
- `136985b` the 45 undecided controls decided against declared ISMS scope facts,
  plus two real defects fixed in the realisation path.
- `1c2766e` the GOAL § 25 terminal outcome declared reached, criterion by
  criterion, with two readings of GOAL's own wording put to the operator and
  recorded rather than absorbed.
- `e2dc18a` hermes dispatch concurrency derived from declared authority. The
  graph declared a default of 4 and the supervisor hardcoded 6, contradicting
  its own corpus with nothing detecting it. The default is now **5** — the
  highest concurrency with a live measurement above the repository's own 0.60
  efficiency floor (measured utilisation 0.664, speedup 3.318 at peak 5) — with
  that basis recorded on the constraint, and an explicit value above the
  declared ceiling refuses rather than clamps.

Four lessons from those boundaries that change how the next one should be run:

- **`transact` authorizes by path prefix; contract `permitsWrite` and work
  `writePath` govern only the staged contribution chain.** "No work owns this
  graph path" is not a missing-owner gap, it is the wrong mechanism. Resolving
  ownership by grep first produced a confident wrong four-part authority plan.
- **`transact --dry-run` reporting `conforming: true` is not a staleness
  answer.** It validates the resulting corpus and is silent on whether any
  completion goes stale. Measure that separately in a disposable clone, and
  compare lane-before against lane-after, never lane against primary.
- **Presence is not satisfaction for a derived artefact.** Fixed here, but the
  general form applies: anything projected from authority must be re-derived and
  compared, or it drifts silently from the thing it projects.
- **Authority declared but not read is the recurring defect of this corpus.**
  It appeared three times in one session: the functional-predicate set, derived
  artefact drift, and a dispatch concurrency the graph declared and the
  supervisor overrode. The corpus is emphatic that verdicts are derived and
  never stored; the same discipline has to reach every constant a runtime
  carries. When a value exists in both the graph and the code, assume they
  disagree until measured.

### The terminal outcome is declared reached

GOAL.md § 25 is met, criterion by criterion, recorded in
[`docs/acceptance/2026-09-03-terminal-declaration.md`](acceptance/2026-09-03-terminal-declaration.md):

```text
USF_V3_CONTINUOUS_PROVIDER_INDEPENDENT_ANQR_REALISATION_PROVEN
```

An earlier draft of this ledger claimed the outcome was blocked on credentials.
**That was wrong.** It conflated the two unqualified API-key routes in
`config/providers.json` with the transports that actually did the work, and the
evidence was already tracked: `docs/acceptance/2026-09-02-composed-run.md`
records 120 871 useful tokens against a pre-frozen 100 000 floor, peak
concurrency 5 of target 5, two provider families accepted in-window and zero
paid cost across 1 009 units. A second wrong reading followed — that § 25.4's
cross-provider review had no mechanism — when `review-diverse` is an implemented
routing strategy selecting across distinct provider families and distinct
underlying model families, reachable through `usf route` and the default
strategy in the routing test fixtures. Both corrections are recorded in the
declaration rather than quietly fixed.

### What remains, and why

Nothing blocks ordinary operation, and nothing gates the terminal outcome. Three
items are open, each needing a decision or ordinary work rather than a gate:

1. **`usf review` remains `planned`.** The standalone convenience command
   `usf review --candidate DIGEST` is declared registered surface that has not
   landed. The cross-provider review mechanism it would wrap is implemented and
   tested, so this is registered-surface debt, not a missing capability.
2. **The product-event vocabulary is open, deliberately.** Two events are
   declared from facet evidence. Closing it means deciding the product event set
   and binding each event to its producing capability, which is a product
   decision. The `event-vocabulary` capture remainder therefore keeps verdict
   `SURVIVING_INVARIANT_REQUIRES_MECHANISM`.
3. ~~**The provider packet lane reads 3 of 9 `verified-complete`**~~ — resolved.
   The lane reads **9 of 9 `verified-complete`** as of the V1/V2 retirement
   boundary below, restored twice in that pass for reasons recorded there.

### Provider lane restored to 7 of 9

The lane reads **7 verified-complete**, one construction-ready and one blocked,
against 3 at the start of the day. Two closure defects were found and fixed
getting there, and one is left deliberately.

**I staled it before restoring it.** Editing `src/graph/work.ts` for the retired
stage took the lane from 3 verified-complete to 0, because that file sits in
those packets' scoped dependency closures and is declared 29 times. Then editing
a test file mid-restoration re-staled two works I had just restored. The lesson
is ordering: **restore last, after source is stable**, or each fix undoes the
previous restoration. Recorded in the operator skill, along with the sharper
point that "source code is not semantic authority" and "a source change has no
blast radius" are unrelated claims — the first is true and the second is false.

Each restoration ran the full chain: construction evidence, proof, publish
verified twice for an identical projection then applied, no-change realisation,
every graph-required check, completion evidence, completion proof, and a
completion publish again verified twice. The three roots could not be batched —
`CONSTRUCTION_PUBLICATION_AUTHORITY_MIXED`, because each carries its own
contract and publication authority — so each cost a digest move and a
rederivation, exactly as the skill warns. Restoring a root repeatedly freed a
consumer for nothing, also as predicted.

**Two closure defects fixed.** `provider-account-tier-receipt` refused with an
opaque `CHECK_FAILED` while its validation command passed uncaged. Its
`ValidationRuntimeClosure` was incomplete by three members, and two of them were
reachable only through `await import(...)` — a static from-clause scan does not
see a dynamic import, and the skill's rule that an actually-executed dynamic
import is a closure member is exactly the case. Adding
`host-source-identities.ts`, `execution-economics.ts` and `transports.ts`
completed it and the packet verified.

**One left deliberately.** `provider-semantic-qualification-v2` needs **33**
further closure members. Its validation runs eight test files spanning the whole
provider subsystem and value-reaches 37 modules including commands and
realisation, while the work itself declares four read/write paths. Adding 33
members would make the packet sensitive to a third of the codebase — the
coupling the skill explicitly says not to create, and it names a validation
whose command opens files the work does not own as a mis-scoping defect rather
than a sandbox fault. That defect is pre-existing and is not mine to paper over,
so the packet keeps its construction grant and its honest state.
`provider-parallel-execution` waits on it.

**One unsound test assumption fixed.** A contract test asserted the provider
qualification-stage order by reading quad iteration order, which N-Quads does not
guarantee and which `transact` deliberately destroys by canonically sorting every
line it writes. It had passed only while the file happened to sit in pipeline
order. The graph declares the order explicitly as `sequenceIndex`, so the test now
sorts by that and additionally asserts every stage in the sequence declares an
index, or the sort would silently degrade to the iteration order it replaces.

### Outstanding work cleared

Four items from the outstanding list are resolved, and two findings came out of
doing it.

**A regression I introduced is fixed.** Retiring four recovery works recorded a
`retirementDisposition` the deriver had never been taught, so they went on
projecting as `blocked`. Blocked means cannot proceed yet; retired means will
not proceed and that is the decision, and reporting the second as the first
reads as a backlog — precisely the misreading the capture-remainder work existed
to remove, reappearing in my own change. `work.ts` now derives a `retired`
stage, and it displaces only `blocked`: a retired work that is somehow
actionable or complete keeps that stage so an inconsistency surfaces rather than
being hidden by the label. The recovery lane now reads four retired, two blocked
on completion currentness, three construction-ready. Planted-defect proven.

**The three planned commands are assessed rather than built.** None was ever
graph-declared as a `RegisteredCliCommand`, so by the corpus's own rule — help
text alone is not command authority — they were never properly registered.
`drift` is superseded: `usf profile status` compares recorded against current
foundation digests and reports currentness, external-fact drift and the moved,
added and removed resource sets, without repair, which is drift's entire
declared purpose under a better-scoped name. `observe` is superseded: six
commands already observe their own domain with their own identity binding, and a
unifying command would add a second path to facts that each have exactly one
owner. `review` keeps verdict `SURVIVING_INVARIANT_REQUIRES_MECHANISM`: the
cross-family half is implemented as the `review-diverse` routing strategy, but
the declared shape excludes the route that produced a candidate, and a candidate
carries no producer identity — deliberately, since actual identity lives in
execution evidence, which is ignored disposable state and may never be selection
authority. Implementing it as declared needs a candidate-envelope change, not a
wrapper.

I tried removing the three from the help surface and reverted it. A test
asserts that one static registry covers parsing and every self-describing help
topic, and the corpus requires that registry be reserved once as a closed
machine-readable set and stay immutable to later packets. Removing entries broke
that invariant, so the help listing stands and the graph now records why the
three will not arrive.

**The disposition ledger carries a verification note**, added without
reordering the file: one line stating the 87-of-90 result, the two
mis-dispositioned concepts, the one genuine gap, and that only 19 of the 29
integrity branches land in the suite their shared reason claims.

**A bound was mis-calibrated and is recalibrated.** The graph loader refused with
`MANIFEST_SOURCE_TOO_LARGE` once `graph/v3-delivery.nq` reached 2 100 737 bytes
against a hardcoded 2 MiB. At that figure the guard was refusing the
repository's own largest authored source rather than protecting against a
malformed one, so it is now 4 MiB in both the graph loader and the semantic
store, which had to move together or the store would refuse what the loader
accepts. The aggregate 64 MiB bound is unchanged and the quad count is 26 068 of
100 000, so loading stays bounded. A single source approaching 4 MiB again is a
signal to split the graph rather than raise the guard twice.

### Historical knowledge confirmed, historical dependency retired

**Confirmed: 87 of the 90 concepts the disposition ledger committed to
retaining are present in V3** — 24 as a resource, 21 as a predicate, 19 in
source, 12 as a type, 11 renamed. Presence in source rather than the graph is
legitimate for a derived state: work dependency status is computed and never
stored, which is the corpus rule.

Three were absent, all under family-level ledger reasons naming no V3
replacement — the exposure the ledger's own methodology note flags. They split
two ways, recorded in `urn:usf:retention-verification:v1-v2:1`:

- **Mis-dispositioned, not missing.** `FieldTenancyClassification` should read
  SUPERSEDE: V3 enforces tenancy at the operation and repository boundary, not
  by classifying fields. `TokenClaimConstraintTemplate` should read SIMPLIFY:
  the concrete constraint survives in the authentication platform, only the
  reusable template abstraction was dropped, and V3 declares one claim mapping
  per platform.
- **A genuine gap, deliberately not re-labelled.** `ConsentBasis` has no V3
  mechanism. The data-governance capability fulfils data-subject requests
  against durable evidence but models no lawful basis for processing, and those
  are different obligations. Re-dispositioning it to make the retention count
  clean would assert coverage that does not exist. It is also now more visible:
  the applicability decision for the privacy control cites a consent-proof
  semantics document that does not exist in this repository.

The ledger is **not rewritten**. It records what was decided; the verification
resource records what was confirmed, and states the disagreement rather than
editing the earlier decision.

A fourth finding is a documentation defect: all 29 V2 integrity branches carry
the same reason claiming compression into the twelve-invariant suite, but only
19 land there. The other ten are equally enforced — dependency cycles and
unknown dependencies in the work-dependency deriver, evaluation drift in the
core freshness check, the rest as graph policy predicates — just not where the
ledger says. An operator reading it would run `usf graph integrity` and wrongly
conclude those ten were unenforced.

**Historical dependency is retired without losing the capability.** Four
recovery works were unsatisfiable: `semantic-recovery-acceptance` declared two
readPaths that have never existed and depended on two works never implemented;
`semantic-recovery-inventory` and `semantic-factory-qualification` landed none
of their outputs; `semantic-graph-exchange` landed four of nine. The first two
are now superseded by the V1 and V2 specification accountings, which do their
stated job with verified counts. The other two are retired unimplemented, with
`factory-qualification`'s invariant satisfied by the hidden-holdout evaluator,
the adversarial suite and planted-defect coverage across fifteen files — the
Factory-derived form was never built and Factory's licence is restricted to
behavioural qualification and inventory metadata anyway.

The phantom readPaths are gone, so the lane stops hard-refusing and now derives
an honest nine-item state instead of `WORK_DEPENDENCY_MISSING`.

**What is kept, and why it is not a dependency.**
`urn:usf:policy:historical-source-dependency:1` states that V1, V2 and Factory
are optional re-verification inputs, never required, and that no build, test,
graph inspection, runtime, BAU, currentness or acceptance may depend on their
presence. That is enforced rather than asserted: `verify-contained.sh` refuses
any tracked runtime-bearing content naming a historical path, exempting only
four provenance documents, and it runs as a graph-declared validation. A fresh
clone with no historical source present reproduces the suite and all three
facet verdict digests byte-identically.

Retained complete are the semantic manifest store and the recovery tooling,
sixteen and seven declared outputs all landed. They are what would reproduce the
V1 and V2 accounting from the pinned sources, so its counts stay checkable
rather than asserted. Deleting them would make the corpus tidier and its
historical claims weaker.

### V1 and V2 accounting is complete

Every V1 capture remainder now carries a **verified** count and a determinate
disposition, and V2 has a content-capture accounting for the first time
(`urn:usf:delivery-requirement:v2-specification:1`).

Verification found three errors in V3's own declared authority. The six declared
counts summed to 1082, which **no scope of the pinned V1 sources reproduces** —
all files give 1106, excluding fixtures gives 1079. The verified total is
**1079**, differing on exactly three off-by-ones, and three independent surveys
converged on the same three by different methods:

| Layer | Declared | Verified | Cause of the error |
|---|---|---|---|
| assurance-content | 238 | **236** | counted the whole graph tree, admitting SHACL and defect fixtures as content |
| realisation-bindings | 119 | **118** | the count's pattern zero-length-matched the prefix declaration, so the 72nd realisation was the empty string |
| state-machine-content | 443 | 443 | correct |
| governance-content | 186 | 186 | correct |
| event-vocabulary | 50 | 50 | correct |
| validator-rules | 46 | 46 | correct |

The `realisation-bindings` note was also factually wrong: it described "47
bindings from specification to implementation", but bindings never reference
specification — `usf:viaBinding` has zero uses, so realisations and bindings are
independent sub-layers. Corrected.

Four layers are **refused**, evidenced against the source rather than argued
from V3's preference. The state machines are enums chained (15 of 16 families
satisfy transitions = states − 1; twelve job failure classes wired as a chain);
the assurance layer never ran (51 of 52 results `unknown`/`stale`, zero
executable content, `TestExecution` and `TestResult` with no instances); the
realisation layer is path-free and its one concrete path names a V1 directory
absent from this repository; and the validator rules carry no executable content
while pointing into a different namespace from the real SHACL. Capturing any of
them would import placeholder metadata into a corpus whose equivalents are
executable and proven — the same objection the corpus already recorded against
`validator-manifest`.

**V2 is an accounting, not a capture, and that is a licence boundary rather than
a choice.** V2's licence status is undetermined and its declared reuse boundary
permits inventory metadata and original V3 re-expression only, so counts, class
names, graph identities and scale are recorded while content is not carried.
V2 holds 126 318 quads across 54 files and 50 graphs, declares 502 classes of
which 101 have no instances, and carries 10 278 instance declarations. On the
same class-for-class basis its six-layer equivalent is **797** against V1's
1079. Governance is **identical** in both at 186, which is why capturing it from
V1 was sufficient. Excluding the three bulk observational graphs V2 itself
retired, V2 is the larger semantic model by 4.3× in bytes and 4.7× in quads —
V1's raw 580 843 quads are 97.6 per cent a single 104 MB scrape file.

Also unchanged and dormant: `urn:usf:work:semantic-recovery-acceptance` refuses
`WORK_DEPENDENCY_MISSING:config/semantic-recovery-inventory.json`. **Two** of its
declared readPaths have never existed — `config/semantic-recovery.json` as well —
which the ledger previously recorded as one. The lane is the explicitly
incomplete historical recovery lane; the accounting above supersedes what it
would have documented.

Next safe action: none required. The terminal outcome is declared, the repository
is in a resumable coherent state, and every open item above is a decision or
ordinary work rather than an unfinished mechanism.

## V1/V2 retirement boundary — 2026-09-03

V3 is now the sole current system. The repository was already hermetic against
V1 and V2 before this pass; what changed is that the predecessor's *operational*
plane no longer exists, the containment guard now enforces the boundary it
previously only sampled, and the retained historical material is explicitly
classified.

### The completion condition was changed, deliberately

The directive asked for the V1 and V2 repositories to be absent. Put to the
operator, the answer was to keep the local checkouts and **confirm the GitHub
repository is read-only rather than delete local copies** — for legacy ANQR too.
That is the stronger condition, not the weaker one: the pinned sources in
`config/semantic-recovery-sources.json` are identified by revision and tree
digest and never by path, so any checkout of the named revision satisfies the
pin. "No V3 path depends on it, and the pinned bytes remain obtainable" is
checkable; "the directory is gone" proves nothing and destroys the operator's
own backups.

Each remote was confirmed present and each pin checked against it. `maldous/usf`
carries the pinned V1 revision `028a9f96` as its own `main` HEAD;
`maldous/usf-graph` carries `2d7eb31f`; `maldous/usf-factory` carries both pinned
Factory revisions. The table is in `docs/historical-inventory.md`. None is
archived, so "read-only" is currently a statement about how V3 uses them, not
about GitHub's own flag.

### The historical runtime plane is gone

Confirmed V1/V2-bound and removed: both self-hosted GitHub runners (registered to
`maldous/usf` and `maldous/usf-graph`, deregistered through the API first, so
neither repository keeps an offline registration), `usf-proof-cockpit.service`,
the `usf-graph-{ownership,runtime,validation-mcp}` and `usf-semantic-mcp` sockets
with their template units, the runner watchdog timer, and the user-level
`usf-operator` broker and health units — whose unit files had already been
deleted while systemd kept them loaded and running. 9 069 889 164 bytes under
`/opt`, `/usr/local/lib` and `/var/lib`, plus 100 `/tmp/usf-cache-*` extraction
directories. `usf-v3` has no `.github` directory and never had a workflow, so no
V3 CI depended on either runner. Full accounting in
`docs/v3-transition-record.md`.

Left deliberately: the inert V2 operator tree named in the inventory (not a
repository, no remote, nothing executes from it now that the broker is stopped)
and the unrelated `ods-*` container stack. Both are located in
`docs/v3-transition-record.md`, which is a classified provenance document.

### Two Gate 0 unknowns are now resolved

Operator-authorized elevation resolved both entries the 2026-08-30 inventory had
to leave open, and the original findings are retained rather than overwritten:

- The mandated V2 Factory evidence path **is** `maldous/usf-factory`, HEAD
  `e67aa4e7`, branch `factory/v2-bau-protected-e67aa4e`, holding both pinned
  Factory revisions and its `LICENSE-NOTICE.md`. The 2026-08-30 operator
  clarification is confirmed.
- The mandated V2 proof-cockpit evidence path is **empty** — zero entries at any
  depth. Resolved as vacuous. The earlier entry was right to refuse a reuse
  decision from silence; the finding is that there was nothing there to decide.

  Both paths are named in `docs/historical-inventory.md`, which is a classified
  provenance document and the only place they belong. The containment check
  refused this section when it first quoted them here, which is the guard
  working: the handover is a live operational ledger, not provenance, so it does
  not get an exemption and should not name historical locations.

**The guard had a bypass, found by not trusting it.** An independent grep with a
deliberately broader pattern than the guard's own found a tilde-abbreviated home
path surviving in this ledger: the rule matched the fully spelled Linux and macOS
home prefixes and missed the abbreviations. The tilde form and both
environment-variable forms are now prohibited too, all three planted-defect
proven, with a bare tilde as ordinary prose punctuation still passing. This
paragraph cannot spell any of them, which is the proof restated. Writing the
check is not the same as knowing what it covers — grep the class separately,
once, with a wider net than the guard uses.

### Containment now enforces the whole boundary

`scripts/verify-contained.sh` grew from three sampled path patterns to nine
rules: the four structural ones it already had, plus historical repositories,
worktrees, recovery directories and removed installations; V1/V2 executables;
V1/V2 package and module imports; historical runtime state; and any absolute
development-machine path. Every rule is planted-defect proven, and two benign
controls pass — a relative repository path, and `/home/provider`, the confined
launcher's declared sandbox home.

Exemptions are self-invalidating. A tracked exempt path that is not the programme
document or the verifier itself must carry `USF-PROVENANCE-DOCUMENT` in its own
bytes; an exemption for an untracked path is inert, so a minimal or synthetic
checkout may omit every provenance document. That second rule exists because the
first version required existence and broke the fresh-init contract test, which
builds a synthetic repository with no `docs/` at all.

Two tracked files carried real machine paths and no longer do.
`tests/adversarial/realisation-check.test.ts` asserted a confined read of a
hardcoded home-directory path naming a V2 checkout that never existed on this
host, so the assertion had no force; `tests/unit/providers/implementation-work.test.ts`
used a home-directory path as its leading-slash fixture. Both now use synthetic
absolutes. This paragraph cannot quote either original, which is the point.

### The re-verification lane is retained and classified

`urn:usf:reverification-lane:1` records what it is and why it stays. No command,
provider, realisation or core module imports `src/graph/recovery.ts` or
`src/graph/recovery-extract.ts`; the only importer in the repository is their own
unit test. It is retained anyway, because it is the only mechanism that can
reproduce the V1 and V2 accounting from the pinned sources — deleting it would
leave the corpus asserting historical figures nothing could re-derive.

It cannot become a dependency: the extractor takes exact supplied bytes (commit
object bytes plus per-file path, mode and content) and recomputes the git object
identities, so it opens no repository. Invoking it without separately supplying
the pinned sources refuses `LEGACY_EXTRACTION_COMMIT_OID_MISMATCH`, proven twice
— with no bytes at all, and with bytes that are not the pinned commit object.

### Canonicalisation was assessed, and nothing was renamed

Every `legacy`, `v1`, `v2`, `old` and `migration` name was examined against the
test "does this imply an *active historical dependency*". None does:

- `config/provider-legacy-observations.json` holds observations *of* legacy
  provider configuration, every row already recorded as excluded and unqualified.
  It is V3-owned canonical config — tracked, schema'd, digest-bound, with
  explicit nonclaims. Renaming it would move a versioned record identity and
  stale the provider cohort to make a correct name look tidier.
- `legacyGraphViolationCount` and the debt constant in `src/commands/graph-integrity.ts`
  count V3's **own** pre-convention graphs, all `urn:usf:graph:*`.
- `apply.ts`'s `legacy`/`legacy-inline` modes are V3's own earlier CLI argument
  form, retained as bounded compatibility.
- `migrationLineage` and its siblings are product-domain database migrations.

The directive's own guard applies: do not erase provenance to make the repository
look cleaner. Recorded here rather than silently skipped.

### Cost, and the ordering mistake that doubled it

Strengthening the containment guard staled the provider lane, because
`scripts/verify-contained.sh` is a `readPath` of `operator-observability`. This
was measured wrongly first: checking the path against
`realisationBasis.work.dependencies` for all nine packets returned "present in
none", and the edit then took the lane from nine `verified-complete` to three.
Scope is `readSet ∪ writeSet ∪ fileDependencies`, and the only answer that cannot
be wrong is deriving the lane before and after.

The lane was then restored — and staled again, because the fresh-init test
failure above was found *after* the restoration and its fix touched the same
file. The cohort was restored twice. The rule is: get the full suite green
first, then walk the restoration tiers. Both lessons are in the operator skill.

Restoring the root unblocks consumers rather than completing them: they move
`blocked -> construction-ready` and each still needs its own completion chain,
though usually only `realise no-change`, its checks, completion evidence, proof
and a twice-verified publish, because the construction grant is still current.
One further trap: the completion proof obligation must be read from the packet's
`realisationAuthority.completionProofObligation`, not composed from the work
name — `provider-invocation-boundary` completes through
`urn:usf:proof:provider-adapter-preflight`.

### What is deliberately not done

`usf` gains no restore command in this boundary. The stale-completion chain was
run eleven times by hand here through a scratch script, which the operator skill
says must not remain the operator interface — but a new top-level command must
edit `src/commands/help.ts` and `dispatcher.ts`, both owned by
`operator-observability`, so registering it costs the staged chain, two
construction grants and a third full cohort restoration. By operator decision it
is deferred to its own packet where that cost is budgeted rather than absorbed
into a release boundary. The chain itself is now documented in the skill with
all three traps that cost time today, so the deferral loses no knowledge.

Next safe action: none required. The tree is clean, the suite is green, the gate
conforms, all three verdict digests are unchanged, and the provider lane reads
nine of nine.

## Housekeeping boundary 2026-09-03 — release candidate prepared

A post-realisation housekeeping pass prepared the wrap-up boundary below as a
clean, hermetic release baseline. No product behaviour or semantic requirement
changed. What was done, all evidence-backed:

- **Worktrees**: seven leftover detached validation lanes (five
  `/tmp/usf-integration-validation-verify.*`, `.usf/tmp/full-check-46c18cb`,
  `.usf/tmp/integration-validation-verify.8R6PiH`) were removed after proving
  per blob that every byte they held is superseded on the mainline (each lane
  was one synthetic integration-verification commit whose only unique blob was
  an earlier iteration of a file the mainline carries in later form; the one
  dirty edit, a `${originalBinding}\n` replace fix in
  `tests/unit/realisation/workspace.test.ts`, is already at HEAD line 574).
  One canonical worktree remains.
- **Branches**: `recovery/operator-leaf-tsc-failure` deleted; its one commit's
  blobs landed at 349a362 with the removed test block relocated to
  `tests/contract/operator-provider-leaf.test.ts`. `main` is retained and equal
  to `origin/main` (8fa2ef7), the last remote-verified boundary; the release
  line `v3-authority-transition` is 101 commits ahead and unpushed.
- **Refs**: five ad-hoc bookmark refs under `refs/usf/` (authority-restored,
  census-done, fai-done, final, handover-tip) deleted; each pointed at a
  mainline ancestor. The registered `refs/usf/integration/*` refs are retained.
- **Ignored state**: `.usf` pruned from 1.3 GB to ~460 MB — `.usf/tmp` lanes
  and scratch, `.usf/workspaces` (post-integration candidate materialisations,
  rederivable through resolve/apply), a check-debug directory, a stale pnpm
  store-index backup, and the orphaned `.usf/drafts/operator-6076913` (an
  abandoned implementation iteration from the 2026-09-01 tsc-failure recovery,
  referenced by nothing tracked and superseded by the landed, fully verified
  implementation). Retained: `.usf/cache` (hermetic pnpm store),
  `.usf/catalog` (frozen catalogue bytes bound by recorded digests),
  credentials, the repository locator, and all receipt/evidence/observation
  records.
- **ANQR repository**: the final supervisor cycle's post-checkpoint output
  (repaired payloadclassification and qrartefactcreation module/test pairs)
  was checkpointed as `1cf44ce`; the 39/39 verdict binds those exact bytes.
  The repository is clean. (Resolved after the proof: by operator direction it
  now pushes to the new private `github.com/maldous/anqr-v3` — the legacy
  `maldous/anqr` repository holds unrelated pre-V3 history and was left
  untouched.)
- **Interface hygiene**: `scripts/hermes-bau.sh` (superseded external driver
  with a hard-coded machine path; graph-undeclared) removed. README's
  "Current claim" was two boundaries stale and now states the realisation
  boundary, the re-derivation commands and the product-repository locator.

Known conditions recorded, deliberately not repaired here because each is an
authority change, not hygiene:

- ~~The graph integrity gate reads `gateConforming: false`~~ — **resolved
  2026-09-03 at `10379e2`**; the gate now conforms and the debt constant is
  unchanged at 24. Original text: legacy violations 27 against a recorded debt
  constant of 24 (`src/commands/graph-integrity.ts`).
  The three newer entries are multi-valued `selectedModel` declarations on the
  three host-CLI transports — intended state since the multi-model pool work,
  flagged by a single-valued-predicate rule. Deciding between raising the
  recorded debt, exempting the predicate, or remodelling the declaration is a
  semantic decision for a follow-up directive.
- The provider packet lane (`graph/manifests/self-host-provider-v3.json`,
  profile v3-self-host:3, semantic digest `sha256:aea7ac1b…` unchanged) reads
  3 of 9 packets `verified-complete` (repository-path-scope, file-asset-index,
  provider-hidden-holdout) and 6 `blocked` on completion currentness: the
  realisation run's ~100 commits moved bytes inside their scoped closures.
  That is the copy-on-write rule working, not a defect; restoring the cohort
  (stale roots before consumers) is possible follow-up work under the recorded
  recovery pattern.
- `urn:usf:work:semantic-recovery-acceptance` refuses derivation with
  `WORK_DEPENDENCY_MISSING:config/semantic-recovery-inventory.json` — the
  dormant, explicitly incomplete historical recovery lane, unchanged by this
  pass.

### Clean-clone proof (executed 2026-09-03)

Semantic completion is reproducible from tracked bytes, not preserved cache.
A private standalone lane held fresh `--no-hardlinks` clones of both
repositories, usf-v3 detached at `e815080` and anqr at `1cf44ce`, given only
the hermetic inputs a third party would supply: the pnpm store and frozen
catalogue copied beneath `.usf/` (`.usf/cache` kept owner-private 0700), the
`.usf/repositories.json` locator naming `anqr-main: ../anqr`, and an empty
mode-0600 env file. `FORCE_COLOR` was unset throughout. Then, in order:

1. `./scripts/bootstrap.sh` — offline frozen-lockfile install completed in
   747 ms with no network fetch; the frozen catalogue read back the exact
   recorded digests (`raw sha256:9c9be3f3…`, `normalized sha256:f54dc34e…`);
   `usf init` ok; containment check pass.
2. `corepack pnpm run check` — typecheck clean, **404/404 tests, 0 failures**.
3. Evidence regeneration: the lane starts at NOT_ASSESSED 719 because
   conformance evidence is ignored state. Five
   `usf hermes implement --apply` invocations (empty env file, `--limit 1`)
   re-executed **all 103 capability conformance suites inside the cage:
   103/103 executed, 0 failed, 0 units dispatched to any provider**.
4. Facet read-back after regeneration: 64/64, 39/39 and 103/103 with
   UNSATISFIED/BLOCKED/STALE/NOT_ASSESSED all 0, and the three verdict digests
   **byte-identical to the primary's**
   (`sha256:e958768a…`, `sha256:17d52953…`, `sha256:3a9fa0d6…`).
5. The packet-lane read-back reproduced semantic digest `sha256:aea7ac1b…`;
   `usf profile record` regenerated the realisation record and
   `usf profile status` then read `current` with closure digest
   `sha256:5527a1e5…` and no external-fact drift.
6. The lane's working tree remained clean at the exact commit through every
   step. The lane was removed after this record was written; the receipt is
   the evidence, the directory is not.

Declared prerequisites outside the repository, all machine-checked during the
proof: Git, Node.js ≥ 22, Corepack (pnpm 11.24.0 pinned by `packageManager`),
util-linux `flock`, bubblewrap 0.9.0 (graph-declared exact host tool), a POSIX
shell, and — only for a first bootstrap with no provided catalogue — bounded
network access to models.dev. Secrets/runtime configuration:
`.usf/credentials/providers.env` (operator-supplied, owner-only, never
tracked) and the repository locator. Optional pinned historical sources (V1 at
028a9f96, V2 at 2d7eb31) are re-audit inputs only and are not needed for any
build, test, evaluation or realisation step above.

Released 2026-09-03: annotated tag `semantic-realisation-1` identifies
usf-v3 `76b7dfd` and anqr `1cf44ce`, both pushed. `v3-authority-transition`
now tracks `origin/v3-authority-transition`; anqr's `main` tracks the new
private `github.com/maldous/anqr-v3` (operator-directed; the legacy
`maldous/anqr` holds unrelated pre-V3 history and was left untouched).

Next safe action: none required.

## Wrap-up 2026-09-02 — directive complete; supervisor intentionally stopped

The operator directed the supervisor wrapped up and the remainder completed by
hand. Supervisor fb06a4176966fd1029889c7e3 drained cleanly (`usf hermes stop`,
outcome drained) and was deliberately not restarted; the restart command in the
section below remains correct if a future directive needs it.

Completion condition from the boundary below, measured after the work:
implementation-conformance facets read UNSATISFIED 0, NOT_ASSESSED 0, BLOCKED 0,
STALE 0 on `graph/manifests/v3-delivery.json` (64/64 capabilities fully
satisfied), `graph/products/anqr/manifest.json` (39/39, denominator fully
assessed, including qrartefactcreation) and the composed
`graph/manifests/anqr-with-foundation.json` (103/103); remaining work reads 0
in every lane. The realise lane assesses the 27 realized-artefact facets
against real artefacts: NOT_ASSESSED 0 there too.

What closed the tail, in order:

- Host-CLI transport misclassification fixed (commit ff61175): a refused turn
  is classified from the CLI's own report, a subscription/quota limit defers as
  TRANSPORT_USAGE_LIMIT_EXCEEDED with the provider-stated reset, an unknown
  model defers a day as TRANSPORT_MODEL_NOT_ACCEPTED, and attempt records
  retain the redacted refusal detail. The Gemini pool was repaired through one
  conforming transaction (dead gemini-3.1-pro-medium removed,
  gemini-3.8-flash-low declared).
- The last blocker was the regenerated customdomainsdnsownershiptlscanonical
  permissions test asserting both an empty list and PERMISSION_DENIED for
  equally ungranted tenants — unsatisfiable by any tenant-scoped fail-closed
  module; two whole-module repair rounds were spent on it. The facet statement
  decides it: isolation is proven on a granted tenant, fail-closed assertions
  unchanged, suite 9/9 against the incumbent module (transaction applied, then
  checkpoint commit 7d573d6 landed the drained cycle work).
- The standing "19 capabilities with remaining work" was a projection defect,
  not a backlog: the implementation lane reported facets it deliberately loads
  no evidence for as NOT_ASSESSED. An evaluation now declares its loaded
  evidence classes and such facets read OTHER_LANE, excluded from the lane's
  denominator and explicitly not a satisfaction claim (commit e179497). No
  supervisor cycle count would ever have moved those 27; gates on
  NOT_ASSESSED=0 in that lane are now satisfiable and truthful.

Next safe action: none required. The section below is retained as the
historical live boundary this wrap-up closed.

## Earlier history

The six authority boundaries closed on 2026-09-03 were collapsed into the current
position above once the work they described was complete; their full detail lives
in the commit messages named there. Four superseded continuation sections and the
historical long-run boundary were pruned at the same time:

- Historical boundary (closed by the 2026-09-02 wrap-up) — unattended long-run convergence
- Previous boundary — composed realisation, admission-ranked routing, and measurable satisfaction
- Previous boundary — ANQR has a product semantic denominator, and Hermes realises it into the ANQR repository
- Previous boundary — product implementation realization is wired and executable
- Previous boundary — the registration-feature digest model is declared and executable

A handover is the live operational ledger — what is true now and what the next
safe action is. Detail that has stopped binding belongs in Git, which is where
these went.


Forty-six older boundary and continuation sections were pruned from this ledger
at `f3797ac8f0db`. They are not lost: `git show f3797ac8f0db:docs/handover.md` returns
the ledger in full, and `git log --follow docs/handover.md` walks every version.

A handover is the live operational ledger — what is true now and what the next
safe action is. It had grown to 49 stacked boundaries and 5 863 lines, which is
an archive rather than a ledger: the current position was 4 % of the file, and
the rest competed with it for attention. What those sections recorded that still
binds has been carried into the graph, the registered CLI surface, the operator
skill and the sections above; what they recorded about superseded intermediate
states is history, and history belongs in Git.

The pruned sections, newest first:

- Prior boundary — the feature model was unreconstructible; alternatives compared
- Prior boundary — the receipt seam is derived, and its missing primitive proven
- Prior boundary — all nine provider packets verified-complete
- Prior boundary — eight packets complete; confinement repaired properly
- Prior boundary — graph-owned authority can now evolve legitimately
- Prior boundary — seven packets complete; the invocation boundary is real
- Prior boundary — six packets complete; account-tier backed by a real closure
- Prior boundary — five packets complete; semantic diagnostics registered
- Prior boundary — five packets complete; first real byte-delta contribution
- Prior boundary — four packets complete; file-asset-index policy gap closed
- Prior boundary — census complete; account-tier proven to need real implementation
- Prior boundary — root authority restored; file-asset-index policy gap evidenced
- Prior boundary — primary-owned receipt semantics
- Live continuation update — repository-path currentness restored
- Superseded historical boundary — former secondary account-source model
- Prior provider-census completion boundary
- Prior remotely authenticated operator completion boundary
- Live continuation update — profile predecessor and bounded leaf closure
- Live continuation update — production host command exposed closure defects
- Live continuation update — provider leaf registry integrated
- Live continuation update — provider-census candidate refused
- Live continuation update — executable provider-leaf dispatch correction
- Live continuation update — module presence is not leaf authority
- Live continuation update — bind leaf authority and imported bytes
- Live continuation update — one-time provider registry closure
- Live continuation update — complete validation-set integration
- Live continuation update — provider census integrated and completion published
- Verified carrier and gate
- Historical superseded provider-profile checkpoint (not current authority)
- Earlier profile-scoped authority and completion history
- Current graph authority
- Semantic-first authority boundary
- Integration and carrier-adoption boundary
- Ordinary construction-authority boundary
- Semantic recovery boundary
- Provider and model population
- Provider/currentness correction and legacy invariant audit
- Provider safe sequence
- Hermes-Agent boundary
- Git, currentness and batching
- Lifecycle and truthful first implementation
- Test economics and authoritative checks
- Skills and plugins
- Next exact actions
- Per-route provider-contact blocker derivation (turn 8)
- V3 live execution demonstration (achieved)

---
