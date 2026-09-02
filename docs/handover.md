# USF V3 handover

## Current live boundary — composed realisation, admission-ranked routing, and measurable satisfaction

Prepared 2026-09-02, after the profile breakthrough was consolidated. Read
current Git and supervisor state rather than trusting any identifier here.

### The three selections

| manifest | selects | lands in |
| --- | --- | --- |
| `graph/manifests/v3-delivery.json` | 64 foundation capabilities, 553 requirements | USF |
| `graph/products/anqr/manifest.json` | 39 ANQR capabilities, 171 requirements | the ANQR repository |
| `graph/manifests/anqr-with-foundation.json` | 103 capabilities, 724 requirements — their exact union | each capability into the repository that owns it |

Ownership is resolved from the graph (`declaresCapability` → `productRepository`),
never from an IRI namespace or a path shape — both conventions declare the same
path pattern, so a path cannot say which repository a result belongs in. One
proposal is written per owning repository and the supervisor transacts each
against its own target. Switching manifests does not stale evidence: staleness
compares file digests against the owning repository; `authoritySnapshot` is
recorded, never compared.

### Evidence now counts

`loadConformanceEvidence` resolved every record under the USF root, so product
evidence was permanently stale and ANQR satisfaction was pinned at zero while
real subtests passed. Records now name their `sourceRepository` and the loader
resolves per record. Verified live: ANQR went 0 → 54+ SATISFIED within two
cycles of the fix, with STALE returning to 0.

### Routing runs on what survives admission

Two measured defects, both fixed with regression tests that fail without the fix:

1. **Route history was write-only.** The reader omitted `attempts`, `successes`
   and `meanLatencyMs`, so the productivity map was always empty, ordering by
   production never happened, and the 12-attempt ceiling could never fire.
2. **Transport success outranked usefulness.** One host route
   (`antigravity-cli:gpt-oss-120b-medium`) answered 43 times for 1.77M tokens —
   86% of recent spend — with almost nothing admitted, and its perfect transport
   record kept it first in its provider. Admission verdicts now fold back into
   route history (never re-counting the invocation), ordering prefers admission
   rate wherever verdicts exist, and a route that spends the ceiling producing
   nothing admissible stands down for a day.

Truncation is also named at admission: host-CLI transports report no
finishReason, so a ceiling-cut generation reached the compiler and was reported
hundreds of lines from its cause. A compound structural check (open brace depth
AND text ending where no module ends) refuses it as `candidate-truncated` and
tells the repair round to produce a smaller module. 63–70% of cycle spend was
going to candidates that did not compile; these are the two named causes that
were measurable.

### What each cycle reports

Per-cycle and cumulative token usage, split kept/wasted (usage rides on refusal
outcomes too — a cycle that produced nothing still reports what it spent);
per-unit tokens in `providerActivity`; the manifest and whether the artefact
lane applies; facet satisfaction derived from the selected profile **after** the
cycle's own conformance runs.

### Operating state

Supervisor BAU: `usf hermes start --manifest <selection> --env-file
.usf/credentials/providers.env`. The child receives every operator selection
(tested round-trip); status reports only a cycle from the observed supervisor
and surfaces older ones as `supersededCycle`.

### Gap register

- Repair-rounds, candidate-failures, cycle and conformance-evidence records are
  unscoped by profile; safe while one supervisor runs at a time.
- `usf hermes run` unexercised against a product or composed selection.
- `typecheckCandidateModule` compiles in USF's scratch — sound while the output
  rule holds modules to the Node stdlib; an assumption, not a boundary.
- "USF as needed" composition is not derivable: no Core capability references a
  `CapabilityPort`; would need `fulfilledByCapability` edges, which restale the
  ANQR profile closure. Operator has accepted union composition instead.
- Payment payloads remain `experimental` pending per-standard vectors.
- GOAL.md §7 and §12 carry 13 MUST clauses largely realised elsewhere; pruning
  them needs a clause-by-clause check against the graph.


## Previous boundary — ANQR has a product semantic denominator, and Hermes realises it into the ANQR repository

Prepared 2026-09-02. Read current Git and remote state rather than trusting any
identifier here.

Branch `v3-authority-transition`. The Core/Profile mechanism was proved but
ANQR had no semantics: `urn:anqr:profile-revision:1` was an immutable *empty*
revision whose own nonClaim said it declared no capability, facet or
requirement. USF could realise USF, and nothing could realise ANQR.

That gap is now closed. `urn:anqr:profile-revision:2` supersedes revision 1 —
revision 1 is untouched and still declares nothing, so no identifier changed
meaning.

### What the denominator contains

44 capabilities across 10 domains, 180 facets, landed through `usf transact`
(append-only, zero owned integrity violations). Each capability states
`userOutcome`, `targetUser`, `businessValue`, `applicableInterface`,
`applicableRuntime`, `capabilityInput`, `observableOutput`,
`productConstraint`, `satisfactionCondition`, `productScopeDisposition` and
`justifiedByEvidenceSource`.

Domains: creation, payload, presentation, analysis, distribution,
**localisation**, experience, trust, quality, enterprise.

Localisation is a domain rather than a feature because the evidence says so:
89 interface locales at 1 676 keys, 87 locales × 9 static page types at 22 MB,
declared direction per locale, a per-script font map, an alias-driven
negotiation order, hreflang alternates across the whole set, and a *separate
public translation repository* (`github.com/maldous/anqr-i18n`) with a
browser-based contribution route published on all 87 localised pages.

Dispositions are real, not decorative: 39 capabilities are `current` or
`experimental`, and 5 are `deferred`/`reserved` (mobile application,
authenticated service consumption, self-hosted operation, policy boundary
control, platform parity). Payment payload representation is `experimental`:
21 schemes are declared, and the profile states that declared breadth is
evidence of intent rather than proof any scheme conforms to its published
standard.

Every facet carries `satisfactionStatus: not-assessed`. The profile claims
outcomes; it asserts no satisfaction.

### What it deliberately excludes

14 `ProductExclusion` records, each with its reason. Eight are the old
Harness/Symphony concerns — provider routing, worker scheduling, autonomous
issue handling, worktree orchestration, evidence admission, integration
orchestration, self-feeding loops, host supervision — recorded as superseded by
USF and Hermes rather than as ANQR capabilities. Four are QR implementation
mathematics: Reed-Solomon and finite-field arithmetic, matrix placement, mask
scoring, bit packing. Two are boundary claims ANQR must never make: validating
what a payload refers to, and assessing the safety of a payload destination.

The contract states observable invariants — an artefact decodes to the payload
requested; customisation stays inside a declared scan-safety acceptance — and
prescribes no algorithm for either.

### The V1 finding

The directive expected recoverable V1 ANQR semantics. There are none.
`grep -ril anqr` over the whole pinned USF V1 checkout at `028a9f96`, and over
V2, returns **zero** matches. V1's 68 capabilities are USF's own platform
semantics and are already in Core, exactly as `semantic-recovery-sources.json`
classifies them (`historical-usf-repository`). Recorded as
`urn:anqr:evidence-source:usf-v1-absence` so the absence is a finding rather
than an omission. The retained V1 value ANQR consumes is the **port set**, as
foundation, not as re-expressed product semantics.

### Foundation reuse is resource-scoped

`urn:anqr:profile-foundation-binding:2` binds `urn:usf:foundation-revision:v3:1`
through the `v3-delivery` authority manifest **named by path, never imported**.
11 seeds expand to a 22-resource closure: 7 `CapabilityPort`s the product
actually needs (apiruntime, observabilitysink, cacheprovider, secretresolver,
configlayerprovider, guardrailport, objectstore) plus the core surface policy,
implementation convention and conformance rule.

Ten `ProfileFoundationDependency` records each state the product reason that
requires the port. Three are `deferred` (identityprovider,
backuprestoreprovider, resourcelifecycleport) and are declared but **not
seeded** — deferring a capability defers its infrastructure. No provider
technology appears as an ANQR capability, and a test enforces that.

Three injected-and-reverted proofs:

| injection | result |
| --- | --- |
| `capability-port:cacheprovider` (inside closure) | `stale`, naming exactly that resource with recorded vs current digests |
| `capability-port:notificationprovider` (outside closure) | `current` |
| `pnpm-lock.yaml` (external fact) | `current`, reporting `externalFactDrift: [dependency-lock]` |

### Hermes selects from the ANQR profile and lands in the ANQR repository

`usf hermes implement --manifest graph/products/anqr/manifest.json` projects
**39 capabilities, 171 requirements, 78 units** through
`urn:anqr:capability-implementation-convention:v1:1`. The Core frontier is
unchanged at 64 capabilities and 553 requirements through its own convention.
The two share no capability.

Deferred and reserved capabilities produce **no work at all**, because their
facets are `NOT_APPLICABLE`. An aspiration cannot be dispatched.

One bounded proof unit was carried end to end:

1. `localenegotiation` implementation unit → `groq/compound` via
   `vercel-ai-sdk`, 2 419 output tokens;
2. landed by `usf transact --repository urn:anqr:repository:main` at
   `src/capabilities/localisation/localenegotiation.ts` **in the ANQR
   repository**, resolved through the operator locator (`.usf/repositories.json`
   maps `anqr-main` to `../anqr`). USF Core has no `localisation` capability
   directory at all;
3. conformance unit → a behavioural test at
   `tests/conformance/localisation/localenegotiation.conformance.test.ts`,
   also in the ANQR repository;
4. executed inside the repository confinement against ANQR source:
   **4 facets executed, 4 passed, 0 unobserved**, exit code 0, `confined: true`.

The evidence record names `urn:anqr:delivery-capability:localenegotiation` and
one subtest per ANQR facet. ANQR satisfaction is derived from ANQR evidence.

### Three generic Core improvements this required

None is ANQR-specific and all are covered by tests:

1. **`deriveCapabilityImplementationNeeds` keyed capability names on the
   `urn:usf:delivery-capability:` IRI prefix.** Any product profile's
   capabilities were therefore invisible to the frontier while their facets,
   contract and paths were perfectly well formed — the profile mechanism could
   describe work that could never be selected. Now keyed on the declared type.
2. **`readImplementationConvention` required `realisationRoot` on the owning
   repository.** A `ProductRepository` deliberately has none, because where it
   sits is operator state. A convention owned by one now resolves its root
   through the locator and authenticates it before any write.
3. **`hermes implement` was hard-bound to `graph/manifests/v3-delivery.json`.**
   It now takes `--manifest`, and the conformance runner takes a source root so
   product evidence executes against product source while the compiler stays
   USF's — which is why a product repository can remain a plain checkout with no
   toolchain of its own.

### Isolation regression found and fixed mid-flight

Making the product-profile vocabulary layer import `v3-convention.json` pulled
`v3-execution` → `self-host` behind it, so the ANQR overlay absorbed five USF
self-host contracts and moved the self-host profile's composed scoped digest.
`tests/unit/graph/product-overlays.test.ts` caught it as a computed-vs-computed
difference, not a stale pin. The vocabulary layer now imports nothing: the
`undeclared-type` invariant is enforced over the transacting corpus, not over a
product overlay, so a product overlay never needed Core's convention source.
All 8 overlay tests pass, including *a versioned profile selects an exact
closure and unrelated product overlays do not stale it*.

### Where the semantics live

| path | contains |
| --- | --- |
| `graph/products/anqr/profile-revision-2.nq` | revision, binding, 10 domains, 44 capabilities, 180 facets, 14 exclusions, 18 evidence sources |
| `graph/products/anqr/opportunities.nq` | 16 product opportunities, every one `reserved` |
| `graph/products/anqr/ui-ownership.nq` | 14 UI surfaces owned or dispositioned; all 5 Core `PROFILE_SUPPLIED` UI facets answered |
| `graph/products/anqr/realisation-convention.nq` | ANQR's own convention, path rules and conformance rule |
| `graph/product-profile-vocabulary.nq` | generic Core grammar: 5 types, 29 predicates, 6 scope dispositions. Names no product |
| `tests/integration/anqr-profile-isolation.test.ts` | 13 tests over isolation, closure, dispositions and exclusions |

### Opportunities are recorded, not scoped

16 opportunities, each `reserved`, each carrying the evidence that already
exists, the new semantic requirement it would need, the foundation ports that
would make it cheap, the additional service commitment it implies, and its
value. Two stand out as needing no new capability: agent-native generation
(MCP is already served) and localisation as a contributed platform asset. The
most commonly paid-for QR feature in the market — managed dynamic destinations
— is recorded honestly as absent, and as implying a redirect service whose
uptime becomes a customer promise.

### The supervisor now operates the ANQR profile

`usf hermes start --manifest graph/products/anqr/manifest.json` runs unattended
BAU against ANQR. The supervisor record, every cycle projection and
`hermes status` all carry the selected manifest, and `authorityIdentity` is
derived from it — an ANQR supervisor reports
`sha256:bb4c6805...` where a foundation one reports `sha256:30770331...`.

Three consequences were handled rather than assumed:

- The cycle transaction is told which repository owns the results
  (`--repository` from the implementation lane's `targetRepository`). Without it
  the product's paths would be written into USF itself.
- The **artefact lane is not run** under a product profile. It realises USF's
  own delivery artefacts and only those, so running it would spend the cycle on
  foundation capabilities merely because they are available. It is recorded as
  `artefactLane: not-applicable-under-a-product-profile`, not silently skipped.
- That lane also carried the facet-satisfaction projection. Facet satisfaction
  is a property of the selected profile, so the implementation lane now derives
  it from the selected graph. An ANQR cycle reports its own 180 facets.

### Two silent-selection defects the restart exposed

Both were invisible failures that reported success, and both now have tests.

1. **`hermes start` did not forward `--manifest` to the supervisor child.** The
   parent spawns a detached child that owns the cycle. Starting on the ANQR
   profile therefore started a *foundation* supervisor while reporting back the
   product one that was asked for. The only visible symptom was an
   `authorityIdentity` that happened to match the previous run; the child's own
   command line was the evidence. The child arguments are now a named function
   with a round-trip test through the child's own parser, because a forwarded
   option the child would reject is not forwarding either.
2. **`hermes status` reported a departed supervisor's cycle.** `cycle.json` is a
   single unscoped file, so the previous supervisor's projection outlived it and
   was reported beside the new supervisor's manifest — 670 foundation facet
   verdicts under an ANQR supervisor that has 180. A projection is now reported
   only when its `supervisorId` matches the observed supervisor; an earlier one
   surfaces as `supersededCycle` so it stays visible as history.

### Gap register
- The ANQR repository has no `node_modules`; the conformance cage works because
  ANQR modules are self-contained by convention. A capability needing a runtime
  dependency would need that boundary reconsidered.
- `.usf/hermes/supervisor/cycle.json`, the repair-round and candidate-failure
  records and the conformance-evidence directory are all **unscoped by profile**.
  Status no longer misreads the cycle record, but running a foundation and a
  product supervisor in sequence still shares repair state between them. Only one
  supervisor may run at a time, so this is latent rather than active.
- `usf hermes run` takes `--manifest` through the same parser but has not been
  exercised against a product profile; only `start` has.
- **Blocking measurement:** `loadConformanceEvidence` resolves a record's
  `modulePath` and `conformancePath` against the USF root, so evidence produced
  in a product repository is always stale and an ANQR facet can never reach
  SATISFIED. Ten executed records at the current authority snapshot carry real
  passing subtests and all read STALE. The conformance *runner* was threaded with
  a source root; the *evaluator* was not. The fix needs the owning repository
  recorded in the evidence, because Core and product records share one unscoped
  directory and each set resolves under a different root.
- `typecheckCandidateModule` still compiles candidates in USF's scratch. That is
  sound while the output rule holds the module to the Node standard library, and
  it is an assumption rather than an enforced boundary.

## Previous boundary — product implementation realization is wired and executable

Prepared 2026-09-02. Read current Git and remote state rather than trusting any
identifier here.

Branch `v3-authority-transition`. The semantic consolidation established that
the 553 outstanding requirements are **implementation-conformance** statements,
not missing artefacts: V3 has largely realized the ANQR *specification* and had
not begun the ANQR *product behaviour* that specification describes. Nothing
turned those requirements into work, so `usf hermes realise` reported
`readyFrontier 0` and BAU had nothing to do.

That gap is now closed end to end.

### Graph authority for implementation

Two resources landed through `usf transact` (append-only, zero owned integrity
violations, resulting corpus 24 365 quads):

- `urn:usf:capability-implementation-convention:v1:1` — owning repository,
  module and conformance path rules, path derivation, filename convention, the
  cohesion rule and the dependency rule.
- `urn:usf:implementation-conformance-rule:v1:1` — what may evidence an
  implementation-conformance requirement, and what is refused before execution.

Paths are graph-derived: `apps/anqr/src/capabilities/{domain}/{capability}.ts`
and `apps/anqr/tests/conformance/{domain}/{capability}.conformance.test.ts`. No
model proposes, chooses or influences a path.

### The bridge

`usf hermes implement` projects the frontier. Every outstanding applicable
requirement of one capability forms **one** implementation unit, because one
module realizes them jointly; the conformance unit is the only dependency edge,
because a behavioural test needs a concrete exported surface. That yields
**64 ready implementation units, 64 following, over 553 requirements** — the
widest truthful frontier, with pairwise-disjoint write ownership.

### Evidence is executed

`src/providers/implementation-conformance.ts` typechecks the module and its
test, then runs the test inside the repository's existing bubblewrap and Node
permission confinement — no network, no writable filesystem outside a scratch
root, no ambient environment — and records what each facet-named subtest
returned. The facet evaluator derives `SATISFIED`, `UNSATISFIED` or `STALE` from
that outcome. A realized artefact can no longer evidence a behavioural
requirement, and a test that does not import the real module is refused before
it is executed.

A failing check drives **bounded alternating repair**: round 1 regenerates the
module, round 2 the test, and after four rounds the capability is reported as a
blocker rather than consuming further provider budget.

### The supported operator interface

`usf hermes start | status | stop` own process identity, duplicate refusal,
orderly drain and every runtime file. `scripts/hermes-bau.sh` is no longer the
interface. Liveness comes from durable Linux process identity (boot id, start
ticks, uid, argv digest, executable digest), so a recycled PID is never mistaken
for the supervisor. Stop is idempotent, drains at a cycle boundary, honours
SIGTERM at the next boundary rather than mid-transaction, and keeps SIGKILL as
the deterministic backstop. Semantic state is never reset by process lifecycle.

### Two dispatch defects found under real load

Both fixed in `src/commands/graph-execute.ts`:

1. A provider returning HTTP 200 with **no text** was recorded as success, so a
   silent model consumed a unit another route could complete. An empty answer is
   now a refusal (`PROVIDER_EMPTY_RESULT:<finishReason>`) and falls through.
2. Only **four** candidates of a 57-route universe were ever attempted. The
   bound is now eight, which reaches the deep providers.

Routes that refuse now earn a bounded, self-expiring, **per-route** deferral
(`src/providers/route-deferral.ts`), so unattended operation stops re-paying a
two-minute empty answer every cycle. It is never a provider-family disablement:
quota exhaustion defers one exact route for six hours and clears on the next
success.

### The loop is closed, with evidence

`accessibilitya11ygate` is the first ANQR capability that conforms. Its path:

1. eight facet statements → one implementation unit → `mistral-medium-3-5`
   produced a 188-line module, landed at
   `apps/anqr/src/capabilities/foundation/accessibilitya11ygate.ts`;
2. one conformance unit → a behavioural test at
   `apps/anqr/tests/conformance/foundation/accessibilitya11ygate.conformance.test.ts`;
3. two bounded repair rounds, both driven by the compiler naming the test file;
4. eight subtests executed inside the confinement, **eight passing**.

The facet evaluator then moved the corpus from **27 to 35 SATISFIED**, with
`capabilitiesFullySatisfied 1`. Every one of those eight verdicts names the
behavioural outcome that produced it. None was authored, and no realized
artefact contributed to any of them.

### Observed provider reality

Real dispatch on this host, recorded in `.usf/graph-executions/`:

| route | observation |
| --- | --- |
| `cerebras` | HTTP 402 `payment_required`, free trial exhausted |
| `codex-cli` | usage limit exceeded, retry after 7 Sep 2026 |
| `cohere north-mini-code-1-0` | 200 with empty text, `finishReason: length` after ~120 s |
| `groq qwen/qwen3.6-27b` | HTTP 413 at a 16 000-token output budget |
| `nvidia` | 27 zero-price reasoning routes eligible at that budget; the deep bench |

Claude remains reserved and unroutable throughout
(`urn:usf:provider-execution-policy:operator-reserved-claude:1`, untouched).

## Previous boundary — the registration-feature digest model is declared and executable

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider contacted, no credential read, no adapter loaded.

The two prose-only binding terms are now a canonical, graph-owned, executable
semantic model. Landed as **one alignment**: a single contribution over four
paths through `realisation-basis-chain`, integrated once, with **zero completion
restoration required** — all nine packets stayed `verified-complete` throughout.
Gate **240/240**, containment `pass`, and a fresh empty-`.usf` standalone clone at
`91bc726ecca56cef806bff0c35171aa5779c8dfc` reproduces semantic digest
`sha256:aea7ac1b81bce8f4d38714457a8b748cfcc6bf6226b6d30e5902254b08b5d720` with
`closureSatisfiability satisfiable` and `publicationPolicyCoverage covered`.

### The decision, made and recorded

Following `urn:usf:type:CanonicalKeyedMemberDigestProtocol`, both digests now
have declared preimages rather than prose:

- `urn:usf:provider-operation:registration-feature-operations-key:1` declares
  `registrationFeatureOperationsDigest` over the **path-ordered resolved
  operations**, each a closed `{kind, path, contentDigest}` member. Content is
  bound by digest; transport `encoding` and `mediaType` are excluded.
- `urn:usf:provider-operation:registration-feature-postimage-key:1` declares
  `registrationFeaturePostimageSetDigest` over the **entire declared write set**,
  one `{path, kind, resultingMode, resultingContentDigest}` member per declared
  path. A path the feature does not operate on carries all-null: canonical
  absence of effect, never an omitted member. So the key binds intended scope as
  well as resulting state.

Both carry `excludesFromDigest` for `basisDigest`, candidate `artifactDigest`,
`acceptedContributionDigests`, construction-grant identity and timestamps, making
them basis-independent by declaration — which is exactly why candidate identity
cannot serve as the cross-phase equality key.

Member records are backed by `schemas/candidate.schema.json#/$defs/...`,
following the existing fragment convention. Implementation sits in
`src/collaboration/resolve.ts` — the module that already produces the resolved
path-sorted operations the key binds. Choosing it over `src/realisation/index.ts`
kept the blast radius at zero; the same change in `index.ts` staled all nine.

Three focused tests make the rule's refusal prose executable: canonical
path-ordering independent of submission order, cross-phase equality of
independently constructed representations, and fail-closed refusal on changed,
missing, extra, duplicate, out-of-scope, absolute and traversing members.

### The demo is capped by provider reality, not by repository work

Re-derived this session and load-bearing for planning: **no available lane can
produce a trusted zero-paid account receipt**, so no route can qualify and the
end-to-end demo cannot complete regardless of further building.

`urn:usf:requirement:provider-pipeline-account-tier` demands a *provider-owned
non-inference account source* proving zero paid cost, paid usage disabled,
automatic overage disabled, bounded quota and source authenticity, and states
that "self-authored assertions ... are insufficient". Against that:

| lane | status |
|---|---|
| `groq-qwen3.6-27b`, `cerebras-gpt-oss-120b` (the only configured routes) | **no `ProviderAccountSourceMapping` at all**; zero mentions of groq/cerebras in any account-source context |
| `codex-cli`, `claude-cli` subscription hosts | mapped, but `configuredRouteJoinRule` states "Subscription-host candidates have no configured-route join under the current route schema" — they can never yield an assignment |
| `openrouter-current-key:1` | the only real mapped endpoint, but `mappingDisposition: insufficient-alone-for-zero-paid-account-receipt` with four enumerated `missingRequiredEvidence` items: paid usage disabled, automatic overage disabled, automatic top-up disabled, free-model eligibility plus fallback prohibition. Not a configured route. |

Every route to a demo therefore requires one of: fabricating a Groq/Cerebras
account endpoint that does not exist; asserting OpenRouter returns evidence its
endpoint does not return; changing the route schema so host candidates can join;
or relaxing the zero-paid evidence requirement. The first two are fabrication.
The last two materially redefine USF's trust model, which is an operator
decision, not a bounded implementation choice.

Note this is **not** the receipt-v2 seam blocking the demo. Completing all three
seam phases would move `providers receipt acquire` from
`PROVIDERS_RECEIPT_PROOFBLOCKED` to a credential/mapping refusal and no further,
because there is no mapping for either configured route to acquire against.

### Gap register (non-demo-path)

- receipt-v2 seam remains unimplemented; its binding key now exists, so it is
  implementable without invented authority.
- `CALL_LEAF_DEPENDENCY_REFUSED` on `call parallel`: no
  `ProductionLeafRuntimeClosure` for `src/commands/provider-parallel.ts`;
  off the contact path.
- `src/realisation/index.ts` begins with `/` and is therefore uncontributable
  through `usf call` (`ABSOLUTE_PATH_FORBIDDEN`); worked around here by siting
  the change in `resolve.ts`.

## Earlier history

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
