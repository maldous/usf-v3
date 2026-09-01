# USF V3 handover

## Current live boundary — product implementation realization is wired and executable

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

## Prior boundary — the feature model was unreconstructible; alternatives compared

This section supersedes every older `Current`, `Live continuation`, `Prior
boundary` and `Next` heading retained below as chronological evidence; do not
operationalize those older boundaries unless this section explicitly restates
them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded. **No repository
source, schema or graph mutation was made at this boundary.**

Nine of nine packets remain `verified-complete` at semantic digest
`sha256:41d15ade...`, zero stale-authority reason codes, gate 237/237,
containment `pass`, empty-`.usf` standalone reproduction confirmed, 12/12 routes
`UNQUALIFIED`, no credential file present, `README.md` still uncommitted.

### The archaeology: the concepts never had a carrier

`git log -S` places the first and only appearance of both terms in **`fe04a6b`
"Model primary-owned provider receipt semantics"** — the commit that introduced
the whole v2 model (`providers-receipt:2`, its four command modes,
`providers-receipt-list:1`, the activation record and its algorithm). That commit
added exactly one feature-related predicate, `featureOwner`. It did **not** add a
registration-feature resource.

Counted precisely: each term occurs **twice**, both times as a substring inside
two prose literals (`coherentTransitionRule`, `currentHelpRule`) on the single
subject `urn:usf:rule:provider-receipt-target-registration:1`. Zero predicates,
zero schemas, zero record fields, zero `src/`, zero `tests/`.

Searched beyond the current tree: the prior carrier
`usf-v3-carrier-fe04a6b` holds byte-identical prose and no extra definition;
`bak/` (35 entries incl. legacy and ANQR material) and `GOAL.md` contain no
registration-feature, feature-operations or postimage-set concept. So of the four
possibilities, this is **(4) genuinely never existed** — with the important
qualifications below.

### What does exist: an adjacent but disqualified mechanism, and the right pattern

Adjacent machinery exists and is **explicitly unsuitable**, which is informative
rather than incidental. `candidateReceiptFacts` (`src/commands/check.ts:531-558`)
already computes `byteDeltaDigest` over `{kind, path, beforeDigest, afterDigest}`
and `fileModeDigest` over `{path, beforeMode, afterMode}`. Both embed the
**preimage**, and `resolve.ts` builds the candidate identity from
`{basisDigest, operations, acceptedContributionDigests}`. All three are therefore
**basis-dependent**, which is exactly what the rule forbids: it requires
"basis-independent" feature digests precisely because the final candidate's basis
changes when the operator predecessor completes.

The repository also already has the correct *pattern* for a key of this kind:
`urn:usf:type:CanonicalKeyedMemberDigestProtocol`, with three instances
(`account-source-key:1`, `candidate-member-key:1`, `route-member-key:1`). Every
one carries `digestAlgorithm "sha256-usf-canonical-json-v1"`, a `memberSchema`,
a `currentnessRule`, and — decisively — a **`digestPreimage` that enumerates the
exact fields**. There are exactly **3** `digestPreimage` declarations in the
graph and **none** mentions a registration feature.

That is the strongest single finding here: **this repository never leaves a
digest preimage to inference.** `route-member-key:1` even carries
`excludesFromDigest "whole config/providers.json bytes"` to remove doubt.
Inferring a preimage for the two registrationFeature digests would break the
modelling discipline that every comparable key follows.

### Constraints that *are* firmly established

Worth recording, because they narrow the eventual model and were not previously
captured:

- `staticRegistrationCandidateStage: "checked-awaiting-integration"` — Phase 1's
  preliminary candidate must be checked and **not** integrated.
- `requiredLeafStage: "verified-complete"` with
  `requiredLeafStageAppliesTo: "production-runtime-invocation-only"`.
- `repositoryClosureDigest: "canonical-sorted-path-digest-role-set"` — the
  repository's naming convention for a closure digest is a sorted
  path/digest/role tuple set; a sibling shape, not this one.
- `resolve.ts:63` path-sorts operations (`[...seen.keys()].sort()`), so
  "canonical ordered" unambiguously means **path order** in this repository.
  Ordering is *not* one of the open questions.
- The two owners' write sets are disjoint, which is what makes a write-set-scoped
  postimage set basis-independent in practice.

### Why the model is still unreconstructible: two live alternatives per digest

Ordering is settled; the **preimage membership** is not. Each digest has at least
two materially different, equally defensible readings of the same sentence.

**`registrationFeatureOperationsDigest`** — "SHA-256 of its canonical ordered
normalized feature operations"

| | O1 — resolved operations inline | O2 — content-digested operations |
|---|---|---|
| preimage | `canonicalDigest(payload.operations)` with each op `{kind, path, content, encoding, mediaType}` | `canonicalDigest([{kind, path, contentDigest}])` |
| for | `resolve` *is* this repository's normalization step; its output is literally "the normalized operations" | bounded input; "normalized" then does real work; matches the sibling discipline of never digesting whole file bytes into a key |
| against | digest input is multi-megabyte; "normalized" becomes a no-op | drops `encoding`/`mediaType` — or keeps them, which is a third variant |

**`registrationFeaturePostimageSetDigest`** — "SHA-256 of the canonical
path-ordered tuples of operation kind, resulting mode and resulting raw-byte
SHA-256-or-null **across the exact account-tier write set**"

| | P1 — operation-spanning | P2 — write-set-spanning, real resulting state | P3 — write-set-spanning, null for untouched |
|---|---|---|---|
| members | one tuple per operation | one tuple per write-set path (24), untouched paths carry their unchanged mode/digest | one tuple per write-set path, untouched paths carry nulls |
| reading of "across the write set" | a scope constraint: every operation lies within it | the span of the set | the span of the set |
| for | "operation kind" presupposes an operation | a complete statement of the feature's resulting footprint; "or-null" then covers deletes | uses "or-null" uniformly |
| against | nearly redundant with O2 | "operation kind" undefined for an untouched member | two features ending in the same state digest differently, which is wrong for a *postimage* set |

These are not stylistic variants. The digests are the seam's **cross-phase
equality key**, and the rule makes inequality a hard refusal. Picking O1 vs O2, or
P1 vs P2 vs P3, silently changes what "the same feature" means. Choosing one
arbitrarily and encoding it in the graph would mint exactly the kind of
unfounded authority this programme exists to prevent — so the choice is left to
whoever owns the model.

### The decision needed, and the shape of the answer

One decision unblocks everything: **declare the `digestPreimage` for each of the
two digests**, following the existing `CanonicalKeyedMemberDigestProtocol`
pattern — `digestAlgorithm "sha256-usf-canonical-json-v1"`, a `memberSchema`
naming a new closed record, an enumerated `digestPreimage`, a `currentnessRule`
asserting basis-independence, and an `excludesFromDigest` naming `basisDigest`,
`acceptedContributionDigests` and every preimage field.

Once that single choice is recorded, the rest is mechanical and already proven
here: the definition is a set of **new inbound-linked subjects** (zero blast
radius, as measured twice before), landed through `realisation-basis-chain` into
`graph/usf-bootstrap.nq`; the implementation and its tests then follow, covering
deterministic re-derivation, mutation detection, missing/extra operation refusal,
postimage mismatch, canonicalization, the
`checked-awaiting-integration` versus final distinction, operator mutation after
final construction, and equality re-derivation — turning the rule's refusal prose
into executable invariants.

### Next safe order

1. record the chosen `digestPreimage` for both digests (O1 or O2; P1, P2 or P3),
   with the reasoning, so the equality key is declared rather than inferred;
2. land the definition as new inbound-linked subjects through
   `realisation-basis-chain`, with tests, and prove it independently before any
   seam work;
3. then implement the three-phase seam against the declared key;
4. only then supply one operator credential — it changes `CREDENTIAL_MISSING`
   alone and provides no useful proof before the repository path is ready.

## Prior boundary — the receipt seam is derived, and its missing primitive proven

This section supersedes every older `Current`, `Live continuation`, `Prior
boundary` and `Next` heading retained below as chronological evidence; do not
operationalize those older boundaries unless this section explicitly restates
them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded. **No repository
source, schema or graph mutation was made at this boundary**; the carrier is
unchanged apart from this ledger entry.

Nine of nine provider packets remain `verified-complete` at semantic digest
`sha256:41d15ade4561b5a7f9dcb169b8f4bce56ca68600e85430ad9449d321ed191120`, with
zero stale-authority reason codes, gate 237/237, containment `pass` and an
empty-`.usf` standalone reproduction of that digest.

### Read this first: the seam has an unimplementable binding key

`urn:usf:rule:provider-receipt-target-registration:1` mandates that the
operator's static registration be **bound to two feature digests**:
`registrationFeatureOperationsDigest` and
`registrationFeaturePostimageSetDigest`.

Searched exhaustively: **both names occur only inside that rule's own prose
literals** (`coherentTransitionRule` and `currentnessRule`). There is

- no `urn:usf:predicate:registrationFeature*` predicate anywhere in the graph,
- no `SemanticRecordSchema` or `schemas/*.json` carrying them,
- no field for them on
  `urn:usf:provider-account-receipt-acquisition-activation:1` (33 required
  fields, checked against its graph `requiredFieldSet`), and
- no implementation in `src/`, `tests/` or `schemas/`.

So Phase 2 cannot bind what Phase 1 must produce. That is the seam's missing
primitive, and it is why the seam was **not** implemented at this boundary rather
than half-built: the rule explicitly refuses "a partial registry, mixed v1/v2
option surface, preliminary-candidate substitution or drift before operator
publication, unequal rederived feature digests, or operator mutation after final
feature construction". Any of those is a refusal, so there is no honest partial
landing.

The rule does specify the derivation precisely enough to implement later:
`registrationFeatureOperationsDigest` is SHA-256 of the canonical ordered
normalized feature operations; `registrationFeaturePostimageSetDigest` is SHA-256
of the canonical path-ordered tuples of operation kind, resulting mode and
resulting raw-byte SHA-256-or-null across the exact account-tier write set. It
was deliberately not defined in isolation, because the operation set it digests
is the account-tier v2 contribution that does not exist yet; fixing a
cross-seam equality key over a not-yet-existing operation set would be
speculative, and the key is load-bearing refusal machinery.

### The three phases, derived from the graph

Order is semantically constrained: Phase 2 binds digests produced by Phase 1, and
Phase 3 binds the operator completion produced by Phase 2 while proving the
feature digests are unchanged. `currentnessRule` adds that the registration
update must **never follow** final account-tier completion, so it cannot stale
the completion it unlocks.

| | Phase 1 — preliminary feature | Phase 2 — static registration | Phase 3 — final feature |
|---|---|---|---|
| owning resource | `urn:usf:work:provider-account-tier-receipt` (`featureOwner`) | `urn:usf:work:operator-observability` (`staticRegistryOwner`) | `provider-account-tier-receipt` again |
| authority now | `verified-complete`, `active-permission`, `maximumThrough: integrate` | same | same |
| write paths | its 24-path write set, incl. `src/commands/provider-receipts.ts` | its 26-path set, incl. `src/commands/providers.ts`, `src/commands/help.ts`, `src/commands/provider-leaf-dispatch.ts` | same 24 paths |
| existing implementation | `provider-receipts.ts` is 506 lines implementing only v1 `acquire`/`verify` against `account-source-protocol:1`; `acquire` refuses unconditionally. All 11 v2 record schemas already exist, as do `src/providers/account-sources.ts`, `disposition.ts`, `host-source-identities.ts` | v1 `providers receipt acquire|verify` help and dispatch | — |
| missing implementation | the four v2 modes `activate|acquire|verify|reduce` plus `providers receipt list`, wired to `account-source-protocol:2`, with real persistence: no-replace activation records, authorizations, observations, sanitized receipts, attempt records, copy-on-write source-state manifests, the bounded head-set with compare-and-swap and its retry-DAG deferral antichain, and the 256-bucket persisted economics projection with its context-bound list cursor | the **complete** v2/list dispatch and truthful registered-but-proofblocked help, superseding the v1 option shape **atomically in one candidate**, bound to the two feature digests | rematerialise the same feature semantics against the new operator basis |
| transition precondition | none beyond current authority; no source contact permitted | an authenticated preliminary checked candidate plus its two feature digests | the final current operator completion |
| currentness requirement | candidate checked in isolated copy-on-write state | no feature-owner write to operator paths | both feature digests exactly equal; `candidateDigest` is expected to differ and is never the equality key |
| validation obligation | `urn:usf:validation:provider-account-tier-receipt` | `operator-composable-input-tests`, `operator-observability-tests`, `operator-provider-leaf-boundary` | same as Phase 1 |
| resulting state | a checked, unintegrated candidate | operator completion carrying the registration | account-tier integrated and re-completed; `providers-receipt:2` and `providers-receipt-list:1` become operationally admissible |
| failure behaviour | refuses on any source contact | refuses on partial registry or mixed option surface | refuses on unequal digests or on operator mutation after final feature construction |

`availabilityRule` is explicit that operator registration alone never activates
receipt v2/list, authorizes provider contact or proves account-tier completion.
Static path reservation and registered-but-proofblocked help are distinct from
semantic runtime eligibility.

### Contact state re-derived, and why the seam would not change it

| item | current registered value |
|---|---|
| `credentialPresent` | **false** on all 12 routes (`credentialPresent=true` count: 0) |
| account receipt | `economics.accountTierReceipt: "missing"` |
| receipt acquisition | `PROVIDERS_RECEIPT_PROOFBLOCKED` |
| authenticated answer | `AUTHENTICATED_ANSWER_MISSING` |
| hidden holdout | `HIDDEN_HOLDOUT_MISSING` |
| route qualification | 12/12 `UNQUALIFIED`, `allocation: excluded` |
| exclusion reasons | `[ACCOUNT_RECEIPT_MISSING, AUTHENTICATED_ANSWER_MISSING, CREDENTIAL_MISSING, HIDDEN_HOLDOUT_MISSING, UNQUALIFIED]` |
| assignment derivation | no assignment; `usf route` refuses `ROUTE_ARGUMENTS_INVALID` without an input |
| invocation authorization | `usf probe answer` is not dispatchable; `usf call parallel` refuses `CALL_LEAF_DEPENDENCY_REFUSED` |

Completing all three phases would move receipt acquisition from
`PROVIDERS_RECEIPT_PROOFBLOCKED` to a **credential** refusal, because v2
`acquire` requires `--activation` plus `--env-file`. It cannot remove
`CREDENTIAL_MISSING`. The credential boundary is therefore terminal for contact
regardless of the seam, and the seam is best done as one coherent programme.

### Credential mechanics, read from the implementation

`src/providers/config.ts` **never reads `process.env`**. A provider key present
in the shell environment is not credential authority; USF authenticates an
explicitly selected owner-private file and nothing else. It never enumerates
credential directories.

`loadCredentialEnvFile` refuses `CREDENTIAL_ENV_REFUSED` unless the selected file
is owned by the current uid, has mode **exactly `0600`**, has `nlink === 1`, and
opens cleanly with `O_RDONLY | O_NOFOLLOW`. Parsing is literal `KEY=VALUE` with
no expansion: an `export ` prefix, a leading space in the value, a blank value or
a duplicate name each refuse (`CREDENTIAL_ENV_INVALID` /
`CREDENTIAL_ENV_DUPLICATE`). Only allowlisted names are retained, and the loader
exposes names and presence only — never values, never the path.

Presence is proven without exposure: `usf providers status --env-file PATH`
returns `credentialPresent` per route plus the `credentialName`, and its help
states that "values and paths are never emitted". With no `--env-file`, presence
is simply false; USF does not go looking. A missing file refuses
`PROVIDERS_ENV_FILE_REFUSED` with `credentialReasonCode: CREDENTIAL_ENV_UNREADABLE`,
verified here with a non-existent path and no secret involved.

Route-to-variable mapping from `config/providers.json`, matching the tracked
`.env.example` template exactly:

| route | provider | credential name | adapter |
|---|---|---|---|
| `groq-qwen3.6-27b` | groq | `GROQ_API_KEY` | `@ai-sdk/groq` |
| `cerebras-gpt-oss-120b` | cerebras | `CEREBRAS_API_KEY` | `@ai-sdk/cerebras` |

**One credential is sufficient** to make one route's `credentialPresent` true;
each variable activates only its own route. Both remain `UNQUALIFIED` until the
receipt, answer and holdout gates also close.

Untracked by construction: `.gitignore` ignores `.usf/` (line 2) and `.env` /
`.env.*` (lines 5-6), so every candidate location is outside the carrier.
`.usf/inputs` is already mode `700` and owner-private, and the v2 synopsis names
`--env-file .usf/inputs/FILE`, so that is the intended location. `--env-file`
itself is a bounded explicit path resolved against the repository root; the
`.usf/inputs/*.json` restriction applies to `--input` JSON payloads, not to the
env file.

The confined validation launcher clears the environment (`--clearenv`) and sets
only a fixed allowlist, and the provider child receives only the one selected
credential variable — so an inherited shell variable cannot reach a provider
call.

### Operator activation sequence

Run from `/home/user/src/usf-v3`. Never echo the key, never `cat` the file, and
do not add it to Git — the paths are already ignored.

```sh
# 1. create the owner-private credential file (one variable is enough).
#    Substitute the real key; do not print it. Literal KEY=VALUE, no export,
#    no spaces around "=", no quotes needed, single trailing newline.
umask 077
printf 'GROQ_API_KEY=%s
' "$YOUR_GROQ_KEY" > .usf/inputs/provider.env
chmod 600 .usf/inputs/provider.env

# 2. prove presence without exposing the value.
./bin/usf providers status   --profile urn:usf:profile:v3-self-host:3   --manifest graph/manifests/self-host-provider-v3.json   --env-file .usf/inputs/provider.env
#    expect credentialPresent: true on groq-qwen3.6-27b and CREDENTIAL_MISSING
#    to disappear from its exclusionReasons. The other gates remain.

# 3. attempt receipt acquisition through the registered command.
./bin/usf providers receipt acquire --route groq-qwen3.6-27b   --profile urn:usf:profile:v3-self-host:3   --manifest graph/manifests/self-host-provider-v3.json
#    expect PROVIDERS_RECEIPT_PROOFBLOCKED until the three-phase seam above is
#    implemented. This is the honest ordering: credentials do not bypass it.

# 4. after the seam exists, re-check qualification and then run the smallest
#    legitimate execution through registered semantics only.
./bin/usf providers status --profile urn:usf:profile:v3-self-host:3   --manifest graph/manifests/self-host-provider-v3.json   --env-file .usf/inputs/provider.env
./bin/usf probe availability --route groq-qwen3.6-27b   --env-file .usf/inputs/provider.env --allow-inference --max-cost-usd 0   --economics -
```

No persisted receipt or digest of the credential is created by step 2: the census
retains only the non-secret name and a boolean. A durable non-secret
credential-source identity digest is derived only later, by the v2 acquisition
path, from the same owner-private no-follow descriptor.

### Next safe order

1. implement the receipt seam as one coherent programme, beginning by defining
   the missing binding primitive (a record and derivation for the two feature
   digests) together with the account-tier v2 contribution whose operations it
   digests, so the key is fixed against real operations rather than speculatively;
2. then Phase 2's atomic operator registry supersession, then Phase 3's
   rederivation and equality proof;
3. operator credential activation is independent of 1-2 and can happen at any
   time; it changes `CREDENTIAL_MISSING` only;
4. leave the `CALL_LEAF_DEPENDENCY_REFUSED` leaf-closure boundary alone: it is
   off the contact path and changing the contract for a refusal code is churn.

## Prior boundary — all nine provider packets verified-complete

This section supersedes every older `Current`, `Live continuation`, `Prior
boundary` and `Next` heading retained below as chronological evidence; do not
operationalize those older boundaries unless this section explicitly restates
them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

**Nine of nine provider packets are `verified-complete`** at semantic digest
`sha256:41d15ade4561b5a7f9dcb169b8f4bce56ca68600e85430ad9449d321ed191120`,
remote-verified at `9c89f28915b0c1aaa5d93995cf1676e5d9216d76`, tree
`789defcdd59a8bfa6d1348c9984523861fae85da`. Gate **237/237**, containment
`pass`, reproduced from an empty-`.usf` standalone clone.

### Read this first: the objective is blocked by an external input, not by USF

Completing the ninth packet did not enable providers, and re-derived registered
state says exactly why. `usf providers status` gives one configured route this
verdict:

```
qualification:     UNQUALIFIED
allocation:        excluded
credentialPresent: false
economics.accountTierReceipt: "missing"
exclusionReasons: [ACCOUNT_RECEIPT_MISSING, AUTHENTICATED_ANSWER_MISSING,
                   CREDENTIAL_MISSING, HIDDEN_HOLDOUT_MISSING, UNQUALIFIED]
```

Four independent gates, and **zero of twelve routes have
`credentialPresent: true`**. No `.env` and no `.usf/home/.env` exists;
`credentialPresenceNames` counts 5 public catalogue labels, not present secrets.

`urn:usf:requirement:provider-pipeline-credential-containment` requires normal
V3 live operation to read exactly one owner-private untracked repository-local
`.env` or `.usf/home` projection containing only the allowlisted variable for the
selected route. **No repository work can create that file**: it is operator
input, deliberately untracked, and manufacturing one would be a fabricated
credential. That is a genuinely external boundary, so the preferred outcome
(a live provider invocation) is not reachable from tracked state alone and this
boundary is the valid hard stop.

### The remaining semantic rules, in order, with owners and scopes

1. **`ACCOUNT_RECEIPT_MISSING`** — owning resource
   `urn:usf:rule:provider-receipt-target-registration:1`.
   `providerReceiptsCommandHandler` refuses `PROVIDERS_RECEIPT_PROOFBLOCKED`
   unconditionally in `src/commands/provider-receipts.ts`, before any route or
   config lookup. Lifting it needs `urn:usf:command:providers-receipt:2`
   (`availability: "target"`, `implementationState: proofblocked`) to become
   implemented. Required transition: the rule's bounded three-phase
   `coherentTransitionRule`. Authorized scope: `featureOwner`
   `provider-account-tier-receipt` and `staticRegistryOwner`
   `operator-observability`, **both `verified-complete` yet both retaining
   `active-permission` with `maximumThrough: integrate`**, so this is
   implementation scale, not authority scale. The receipt v2 protocol
   (source-state head-set, retry DAG, persisted bucketed projection,
   `activate|acquire|verify|reduce`, bounded list) is fully specified and
   entirely unbuilt.
2. **`CREDENTIAL_MISSING`** — external operator input, as above. Not closable by
   any work.
3. **`AUTHENTICATED_ANSWER_MISSING`** — requires 1 and 2.
4. **`HIDDEN_HOLDOUT_MISSING`** — requires 3.

A separate, lower-level boundary was also newly exposed and is *not* on the
contact path. `usf call parallel` now advances past its proofblock — because
`urn:usf:requirement:operator-call-command-reservation` declares
`requiredLeafStage: "verified-complete"` and that is now satisfied — and refuses
`CALL_LEAF_DEPENDENCY_REFUSED` (exit 4) with "Exactly one graph-projected
production leaf runtime closure is required." No `ProductionLeafRuntimeClosure`
is declared for `src/commands/provider-parallel.ts`. Closing it would only change
that refusal into the truthful `PROVIDER_PARALLEL_PROOFBLOCKED`; it advances
nothing toward contact. It was deliberately **not** done, because
`packet.requirements` is projected from the **contract's** `requires` edges
(`src/graph/work.ts:1213`), so declaring the closure means editing
`urn:usf:contract:provider-parallel-execution:1` and re-completing the packet —
churn for a refusal-code change. Its members would be exactly three:
`src/commands/provider-parallel.ts`, `src/core/canonical.ts`,
`src/core/errors.ts` (`./dispatcher.ts` is type-only and erased).

### What provider-parallel-execution actually implements

Two closed record schemas matching their graph `requiredFieldSet` **exactly and
in order**, verified mechanically, including
`nestedRouteRunRequiredFieldSet` for `routeRuns` members, both compiling through
the narrow schema-policy validator.

The runtime is genuinely concurrent, not `Promise.all` around serial
preparation:

- `dispatchParallel` launches every admitted candidate in a synchronous loop and
  retains promises without awaiting, so no settlement can interleave during a
  wave. `launchedBeforeFirstSettlement` records how many launches actually
  preceded the first settlement — the only honest evidence of dispatch
  independence — and the record refuses when it exceeds `observedConcurrency`.
- `usefulOverlapMilliseconds` is **recomputed by the parser** from the observed
  `usefulStartedAt`/`usefulEndedAt` timestamps via a sweep that counts only
  milliseconds where two or more **distinct families** hold an accepted interval.
  A record asserting overlap the timestamps do not support refuses.
- Measured, not configured: two families at 80 ms overlap positively and finish
  in under 160 ms; awaiting each in turn yields **zero**; two concurrent routes
  inside one family also yield **zero**, because one family is not two.
- Failure isolation, per-provider and host caps, and an explicit disposition for
  every excluded candidate are each asserted.
- Baseline receipts are immutable: the candidate binds the baseline content
  digest, derivation only reads the baseline (its digest is asserted unchanged
  afterwards), self-comparison refuses, and any missing equivalence falls to
  `NO_BENEFIT_CLAIM`. A hand-written record cannot promote itself to
  `SEMANTIC_TOKEN_REDUCTION`.

Both `call parallel` and `call compare` keep an operation-wide proofblocked
refusal raised after argument and semantic-scope validation and **before** any
route or configuration lookup. `src/commands/call.ts` and its help stay owned by
the operator registry predecessor and were not touched.

### Two traps worth carrying forward

**A contribution's content may not start with `/`.** The canonical envelope
rejects it as `ABSOLUTE_PATH_FORBIDDEN` at
`payload.operations[n].content`, because `absolutePath` tests the string itself.
A new TypeScript module opening with a `/**` docblock therefore cannot be
contributed. Some tracked files do start that way — they predate this path — so
the convention for anything landed through `usf call` is imports first, docblock
after. The original bytes are recoverable from `.usf/inputs/*.json` if a local
edit goes wrong, which is how this module was restored byte-identically.

**`provider-cli.test.ts` needed the same child-process guard as
`config.test.ts`.** All seven of its cases spawn the CLI, it had no guard, and
the hermetic cage grants no child-process capability. Because the fixture import
`tests/fixtures/proposal-packet.ts` is a top-level import, the guard alone was
insufficient: module resolution precedes every test body, so the closure needed
that file too. Caged the file now reports 7 skipped / 0 failed; the outer lane
runs all 7.

Modifying it correctly staled **three** completions (`provider-census`,
`provider-invocation-boundary`, `provider-semantic-qualification-v2`) because
that file is inside each scoped closure. All three were restored roots-before-
consumers by fresh authority plus a no-change completion; no grant was repaired.
When a closure changes after a candidate already holds a pass receipt, the
recheck refuses `CHECK_RECEIPT_CONFLICT`: clear that candidate's ignored receipt
directory and recheck both validations so every receipt binds the current
closure.

### Next safe order

1. the receipt-v2 registration seam is the only remaining repository-side work on
   the contact path, and it is implementation scale behind
   `urn:usf:rule:provider-receipt-target-registration:1`;
2. a live invocation additionally requires an operator-supplied owner-private
   credential file, which no work may create;
3. optionally declare the parallel leaf's `ProductionLeafRuntimeClosure` to turn
   `CALL_LEAF_DEPENDENCY_REFUSED` into the truthful proofblock, accepting a
   contract edit and one re-completion.

## Prior boundary — eight packets complete; confinement repaired properly

This section supersedes every older `Current`, `Live continuation`, `Prior
boundary` and `Next` heading retained below as chronological evidence; do not
operationalize those older boundaries unless this section explicitly restates
them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

**Eight packets are `verified-complete`**, newly including
`provider-semantic-qualification-v2`. Its eight-file validation now passes
*inside* the hermetic bwrap cage under Node `--permission`, not around it.

### Read this first: a read-closure fix was not the answer

The previous boundary left `CHECK_FAILED` after the 11-member
`ValidationRuntimeClosure` made confinement provable. The residual failure was a
**write-effect** defect, and it was fixed as one:

`tests/unit/providers/config.test.ts` computed
`runtimeRoot = join(process.cwd(), ".usf", "tmp")`. The cage grants exactly one
`--allow-fs-write` for its scratch root and exports that root as `TMPDIR`, so the
test now resolves `join(tmpdir(), "usf-provider-config")` instead. Nothing was
exempted: the repository root was not made writable, `.usf/tmp` was not added as
a fake read dependency, no test was deleted and nothing ran outside the canonical
validator.

A second, harder fact was measured rather than assumed: **`fs.symlink` requires
the full unscoped filesystem capability**, so it is categorically unavailable
under `--permission` no matter how the scratch is scoped. The symlink-refusal
assertion was therefore split into its own case behind an explicit
`confinedFileSystem()` guard — the same pattern the repository already uses for
cage-incompatible coverage — and is asserted in the ordinary outer carrier lane.

The declared boundary is now proved from **both** sides inside the cage: a write
beneath the launcher-supplied scratch root succeeds, and a planted write to
`<cwd>/.usf-scratch-boundary-probe` and `<cwd>/src/...` is rejected with
`ERR_ACCESS_DENIED`. Confinement got stronger, not weaker.

| lane | result |
|---|---|
| `config.test.ts` caged | 7 tests, 6 pass, 0 fail, 1 guarded skip |
| `config.test.ts` outer | 7 tests, 7 pass, 0 skipped |
| the full eight-file command caged | 64 tests, 63 pass, 0 fail, 1 guarded skip |

Both hermetic validations that name `config.test.ts` are covered:
`urn:usf:validation:provider-qualification-v2` passed as a graph-bound
`usf check`, and `urn:usf:validation:provider-qualification-tests` has a
**byte-identical** `command`, `environment` (`hermetic`), `executionMode` and
`hostToolDependency` (`bwrap:0.9.0`), and that exact command was exercised under
the cage directly. Its own graph-bound `usf check` refuses
`CHECK_VALIDATION_NOT_BOUND` against another work's candidate, which is correct;
running it as a bound check needs the v1 work's own candidate, and that work
remains blocked in the separate `v3-self-host:2` lineage for unrelated reasons.

### The scoping lesson, sharpened by two rejected designs

The previous boundary's rule — measure blast radius from resource closure, never
from file membership — held, and this session found its converse. **Adding a new
unreferenced subject is free; modifying an existing shared subject is not**, and
both live in the same files.

Two designs were authored, measured and **rejected** before anything was landed:

| attempted change | measured effect |
|---|---|
| add `writeAccess`/`sourceAccess`/`environmentRule` to `urn:usf:environment:hermetic` (in the owned `graph/foundation.nq`) | **all seven completions staled.** That resource is reached from every work via validation/proof `environment>` edges, so its digest is in every `coreScope`. |
| add one `permitsWrite` quad to `urn:usf:contract:semantic-first-order:1` | **all seven completions staled.** `coreToProductDigest` moved `597f94e1` -> `334fe492` while `profileDigest` and `productDigest` were untouched. |

So the appealing "declare the write contract on the hermetic environment" design
is wrong, however well it reads. Measure first; both of these looked safe.

### What was actually landed: a narrowly scoped maintenance work

`urn:usf:work:validation-scratch-confinement`, declared through
`realisation-basis-chain` into `graph/usf-bootstrap.nq` as **63 new quads, every
subject new**:

- Its write set is **exactly one path**: `tests/unit/providers/config.test.ts`.
- It needed **no contract edit**, because
  `urn:usf:contract:provider-semantic-qualification:1` already permits the
  `tests/unit/providers/` prefix (`isPermittedWrite` accepts `/`-suffixed
  prefixes, `src/graph/work.ts:317`).
- It needed **no profile edit**, because profiles select *contracts*, and that
  contract is already selected by `v3-self-host-hermes:1`.
- Its authority comes from a **disjoint sibling policy**,
  `urn:usf:publication-policy:validation-scratch-confinement-construction-authority:1`,
  which enumerates exactly one work. `policyBlastRadius` now reports it as
  `eligible 1, stales 0` — it cannot stale a cohort by construction.

Measured blast radius of the whole scaffold: the provider profile projection was
**identical**, and in hermes only the three works whose `readSet` contains
`graph/usf-bootstrap.nq` moved, none of them complete.

A second `realisation-basis-chain` contribution added
`urn:usf:validation-runtime-closure:validation-scratch-confinement:1` (6 quads)
supplying the two files the confined config validation reaches through
`src/providers/config.ts`: `src/schema/index.ts` (value import) and
`schemas/provider-config.schema.json` (read during module evaluation). Note the
confirmation that inbound linkage works as designed: adding that closure did
**not** stale the work's own grant.

Why an existing owner could not be used: `urn:usf:work:provider-semantic-qualification`
already declares `tests/unit/providers/` as a `writePath`, but it is
`WORK_DEPENDENCY_NOT_READY` in the `v3-self-host:2` lineage where no work is
complete. Reviving that lineage is a separate programme.

### Verified evidence at this boundary

Five carrier commits: two `realisation-basis-chain` graph contributions, one
grant checkpoint each for `validation-scratch-confinement` and
`provider-semantic-qualification-v2`, the confinement fix, and the psq-v2 byte
delta (1074 insertions across its three paths) plus its completion. Every graph
publication was a pure append with zero rewritten quads, and every confined
check passed.

Full gate **223 -> 230** (five routing tests, two confinement tests) with
containment `pass`. Preflight before minting completion: `closureSatisfiability`
`satisfiable` with empty `blockedWorks`, `publicationPolicyCoverage` `covered`
with zero works at risk, `policyBlastRadius` over seven policies derived from
scoped-dependency-closure membership, `carrier` observed from local refs only.

The construction grant rolled back in the previous session was **not** reused or
repaired; fresh grants were derived at each basis, and the two-grant rule held
again for the byte delta.

### Environment trap: FORCE_COLOR breaks the authoritative lane

The first standalone run of this boundary failed the gate with three
`SyntaxError: Unexpected token '(', "(node:8564"... is not valid JSON` failures
in `tests/integration/provider-cli.test.ts`, while the primary passed 230/230.
It is **not** a repository defect and not caused by this session's changes.

`src/providers/subscription-hosts.ts:322` deliberately sets `NO_COLOR: "1"` in
its scrubbed child environment. If the surrounding session exports
`FORCE_COLOR`, that variable is not scrubbed, Node then emits
`The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` and the
warning lands in output the test `JSON.parse`s.

Run the authoritative and standalone lanes with `FORCE_COLOR` unset. The
qualification procedure recorded below now does that explicitly. Re-run clean,
the same commit passes 230/230.

There is a real latent robustness gap here worth a future packet: the scrubbed
child drops credentials and proxies but not the colour variables, so a caller's
`FORCE_COLOR` can corrupt a bounded JSON protocol. It belongs to whoever owns
`src/providers/subscription-hosts.ts`, not to this boundary, and it is recorded
rather than smuggled into an unrelated write set.

### Provider state re-derived after completion

Unchanged where it matters, and honest: all **twelve** routes remain
`UNQUALIFIED` and `usf providers receipt acquire` still refuses
`PROVIDERS_RECEIPT_PROOFBLOCKED`. Completing semantic qualification qualified no
route, because qualification consumes live observations that do not exist.

`provider-parallel-execution` is now **`dependencyReady: true` with
`verified-completion`** for the first time (its predecessors
`operator-observability` and `provider-semantic-qualification-v2` are both
complete). It is blocked only on its own evidence, proof and grant. Three of its
five write paths do not exist yet:
`schemas/parallel-provider-run.schema.json`,
`schemas/semantic-token-comparison.schema.json` and
`src/commands/provider-parallel.ts`. Its permission `maximumThrough` is
`runtime`.

The receipt-target seam remains as derived last session: no authority blocker,
both owners `verified-complete` yet retaining `active-permission`/`integrate`, and
the receipt v2 protocol entirely unbuilt.

### provider-parallel-execution, scoped for a clean start

Dependency-ready and not started. Scoped here so the next session does not
re-derive it:

- Two **closed record schemas** must be authored to match their graph
  `requiredFieldSet` exactly and in order — verify mechanically, as the
  invocation-boundary drafts taught:
  `urn:usf:parallel-provider-run:1` (`schemas/parallel-provider-run.schema.json`)
  also carries a `nestedRouteRunRequiredFieldSet` for its `routeRuns` members, and
  `urn:usf:semantic-token-comparison:1`
  (`schemas/semantic-token-comparison.schema.json`).
- `src/commands/provider-parallel.ts` is new; `src/continuous/scheduler.ts` and
  `tests/scale/continuous-scale.test.ts` already exist and are in the write set.
- Its `contentDigestRule` defines useful overlap as the positive intersection of
  accepted useful-work intervals from **at least two distinct independently
  qualified provider families**, and the comparison record requires the candidate
  to bind an immutable baseline digest it cannot rewrite, with missing usage,
  cache or equivalence evidence yielding `NO_BENEFIT_CLAIM`.
- It has **two** required validations:
  `urn:usf:validation:provider-parallel-execution` over
  `tests/scale/continuous-scale.test.ts` and
  `tests/integration/provider-cli.test.ts`, and
  `urn:usf:validation:provider-semantic-token-reduction` over
  `tests/scale/continuous-scale.test.ts` and
  `tests/unit/observability/metrics.test.ts`. Audit both against candidate scope
  before materialising, and note that `provider-cli.test.ts` is the file with the
  `FORCE_COLOR` sensitivity recorded above.
- Its permission `maximumThrough` is `runtime`, and it owns `call parallel` and
  `call compare`. It remains **no-contact and fixture-validated**: completing it
  still does not qualify a route or acquire a receipt.

### Next safe order

1. `provider-parallel-execution`: dependency-ready, repository-contained and
   reversible, scoped immediately above. It is where a live multi-provider run
   first becomes reachable;
2. the receipt-v2 registration seam, which is implementation-scale, not
   authority-scale;
3. reuse `urn:usf:work:validation-scratch-confinement` only for genuine
   ephemeral-write repairs under `tests/unit/providers/`; widen its write set
   through a new disjoint policy rather than by editing a shared contract.

## Prior boundary — graph-owned authority can now evolve legitimately

This section supersedes every older `Current`, `Live continuation`, `Prior
boundary` and `Next` heading retained below as chronological evidence; do not
operationalize those older boundaries unless this section explicitly restates
them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

This was an authority and graph-maintenance boundary, not a provider
implementation one. Seven packets remain `verified-complete` with **byte-identical
basis digests**, and two graph-owned authority resources were added through the
registered chain. Current provider semantic digest
`sha256:19e2c18ba13ec2b70c5e32be9a60f96e7deb9fba2098a4d92b2ec02b377a9308`;
hermes `sha256:1d0b40c1a4ba8b84b699747cded322dc4c76f02ca3c2cce3d3b0eea652cdb3c5`.

### Read this first: the previous boundary's blast-radius claim was wrong

The prior handover recorded that closing these gaps would "stale all seven
current completions and both current grants" and that this was the reason not to
proceed. **That was an invalid inference, and it has now been disproven by
measurement.** No decomposition was needed; the authority model was already
correctly scoped.

The error was reading `foundationDigest` as a property of `graph/foundation.nq`.
It is not. `resourceDigest` (`src/graph/index.ts:299`) digests **only the quads
whose subject is that exact IRI**, so `foundationDigest` is the digest of
`<urn:usf:foundation:v3>`'s own quads. Adding a new subject to a graph source
does not touch it.

The rest of the chain is scoped the same way:

- `candidateScope = readSet ∪ writeSet ∪ fileDependencies`
  (`src/realisation/index.ts:588`).
- `selectedClosure = {profile} ∪ transitiveResourceIris([product, foundation,
  contract, work])` (`src/graph/work.ts:1450`) — a transitive **resource**
  closure from four roots, not a file set. Its own comment says traversing every
  `selectsContract` edge "would incorrectly turn sibling contract content into a
  dependency of this work."
- `productToCoreDigest` binds only `{foundation, foundationVersion}` — identity
  and version, no content — which is exactly the declared
  `boundaryIdentityPolicy: "opposite-identity-and-version-without-opposite-content"`
  of `urn:usf:policy:directional-currentness:1`.
- `compositeDigest` contains `foundation` and `foundationVersion` but **not**
  `foundationDigest`.

Measured, twice, in a disposable clone before touching the primary: appending an
inbound-linked resource left every work's `basisDigest`, `compositeDigest`,
`foundationDigest` and `scopedDependencyDigest` **byte-identical** and all seven
completions `verified-complete`. Only the observational whole-store
`semanticDigest` moved. Confirmed again after the real integrations: the seven
provider basis digests are still `838ac4a89804`, `11fb39151629`, `c14c4d38499f`,
`967713151629`, `043e6d7e11b5`, `1060e91e7776`, `16fe82c31af6`.

Never infer a digest's blast radius from the file a resource lives in. Measure it
by appending to a disposable clone and diffing the projection.

### The authority-evolution mechanism, which already existed

No new primitive was needed. The mechanism is
`urn:usf:work:realisation-basis-chain`:

- Its permission `urn:usf:permission:semantic-first-order` is **permanently
  active** (`activationCurrentness:
  urn:usf:currentness:semantic-first-bootstrap-transition:1`) because
  `urn:usf:exception:semantic-first-bootstrap:1` is already
  `exception-state:closed`. So it reports `construction: eligible=true,
  authority="active-permission", maximumThrough="integrate", reasonCodes=[]`
  and needs **no** construction-authority grant and **no** publication policy.
  This is why `publicationPolicyCoverage` shows it with zero policies and
  `CONSTRUCTION_WORK_NOT_ELIGIBLE` while `usf work` still shows it actionable:
  the two are consistent, because policy admission is only needed for
  *grant-based* authority.
- It legitimately owns `graph/foundation.nq` and `graph/usf-bootstrap.nq` as
  `writePath`s, plus `src/commands/help.ts` and `tests/contract/cli.test.ts`.
- It is selected only under profile `urn:usf:profile:v3-self-host-hermes:1` with
  manifest `graph/manifests/self-host-hermes.json`, and
  `graph/usf-bootstrap.nq` is a transitive source of the provider manifest, so
  resources added there are visible to the provider profile.
- Its own completion stays proofblocked
  (`COMPLETION_POSTIMAGE_VERIFIER_PROOFBLOCKED`), which is correct and honest:
  this is a permanently-constructable maintenance seam, not a work that
  completes.

So graph evolution is the **ordinary registered chain** under that work:
`usf call → usf resolve → usf apply → usf check → usf integrate`. Used twice
this session, both times a pure append with a passing confined check.

The one caveat that is load-bearing: `realisation-basis-chain`'s `readSet` has 44
entries including `src/providers/routing.ts` and
`tests/unit/providers/routing.test.ts`. The preserved qualification-v2 drafts
therefore sit **inside** its basis scope, so they must be moved aside before its
chain runs, or unreviewed bytes are folded into an authority change. They were
moved aside for both contributions and restored afterwards with unchanged
digests.

### Only genuinely dependent authority was invalidated

This is the invariant the session had to preserve, and it holds exactly:

| Profile | Effect of appending to `graph/usf-bootstrap.nq` |
|---|---|
| `v3-self-host:3` (provider) | **identical** — every stage, completion and digest unchanged |
| `v3-self-host-hermes:1` | only `realisation-basis-chain`, `semantic-first-lifecycle-admission` and `hermes-management-facade` moved their `basisDigest`/`scopedDependencyDigest` — the three works whose `readSet` actually contains that file. None of them is complete. `compositeDigest` unchanged even for them. Stages and completion flags identical. |

Stale-completion behaviour was not weakened anywhere. The mutating work correctly
moved its own scoped digest.

### Gap B — closed: the four projections are semantically registered

`usf status` had **no** graph command resource at all; the four projections
existed only in TypeScript and help text. Registered in
`graph/usf-bootstrap.nq` (51 quads, pure append):

- `urn:usf:command:status:1` — `RegisteredCliCommand`, `implemented`,
  `commandPath "status"`, `handlerPath "src/commands/status.ts"`.
- `urn:usf:status-projection:{closure-satisfiability, publication-policy-coverage,
  policy-blast-radius, carrier}:1` — typed
  `urn:usf:type:OperationalStatusProjection`, each carrying `projectionKey`,
  `statusVocabulary`, `derivationRule` and its nonclaims, transcribed from the
  implemented behaviour rather than invented.

The projections link **inbound** via `forCommand`, deliberately mirroring
`ValidationRuntimeClosure`/`forValidation`, so registering a fifth projection
later never rewrites the command's resource identity or any basis containing it.

Both are discoverable and versioned through the registered interface with
machine-readable JSON: `usf query --iri urn:usf:command:status:1` returns the
resource with digest `sha256:911be8a244af4313...`, and each projection carries
its own resource digest. The declared invariant is satisfied.

Recorded honestly: `resultSchemaIdentifier "urn:usf:status-result:1"` is a
literal, and a nonclaim states that no closed `SemanticRecordSchema` or
`schemaPath` exists for it. Registering that record would need
`schemas/status-result.schema.json`, which is not in any work's write set. No
help text was changed — the invariant concerned semantic authority, and
`usf help status` was already truthful about the command, merely silent about the
projection sections.

### Gap A — half closed, and the residual half is proven unreachable

`urn:usf:validation-runtime-closure:provider-qualification-v2:1` is now declared
in `graph/usf-bootstrap.nq` (15 quads, pure append) with **11**
`repositoryReadFile` members, derived mechanically from the eight-file command's
recursive value-import closure plus its runtime file reads:

```
schemas/model-catalogue.schema.json      schemas/probe-result.schema.json
src/providers/fake.ts                    src/providers/local-git.ts
tests/fixtures/proposal-packet.ts        tests/fixtures/providers/models-dev.json
tests/unit/providers/catalogue.test.ts   tests/unit/providers/config.test.ts
tests/unit/providers/fake.test.ts        tests/unit/providers/probe.test.ts
tests/unit/providers/qualification-assets.test.ts
```

That **did** fix confinement provability: the refusal moved from
`CHECK_CONFINEMENT_UNAVAILABLE` to `CHECK_FAILED`, i.e. the launcher now
constructs and the tests actually execute. Measured per-file under the real
permission cage, 7 of the 8 files pass completely — 57 tests:

| file | caged result |
|---|---|
| catalogue | pass 4 |
| **config** | **pass 2, fail 3 — `ERR_ACCESS_DENIED`** |
| economics | pass 15 |
| fake | pass 4 |
| probe | pass 7 |
| qualification-assets | pass 2 |
| qualification | pass 6 |
| routing | pass 19 |

`tests/unit/providers/config.test.ts:15,40-41` computes
`runtimeRoot = join(repositoryRoot, ".usf", "tmp")` and calls `mkdir`/`mkdtemp`
there. The hermetic cage grants `--allow-fs-write` only to its own
`.usf-check-tmp` scratch, so those three cases cannot run. **A
`ValidationRuntimeClosure` supplies read-only files and can never grant write
access**, so this is a second, distinct defect and confinement was not weakened
to hide it.

It is also **pre-existing and systemic, not specific to v2**: both
`urn:usf:validation:provider-qualification-tests` (selected by the v1
`provider-semantic-qualification`) and
`urn:usf:validation:provider-qualification-v2` declare
`urn:usf:environment:hermetic` with bwrap **and** both name `config.test.ts`. So
that file has never been runnable under either declared confinement.

The construction grant published for `provider-semantic-qualification-v2` during
the attempt was **rolled back** again, for the same reason as last session: it
authorizes work whose completion validation still cannot pass.

### The precise missing primitive

Three repairs remain, and all three are blocked by exactly one thing:

1. narrow `urn:usf:validation:provider-qualification-v2`'s command — needs
   `graph/provider-pipeline.nq`;
2. make `config.test.ts` write under the cage-writable `TMPDIR` instead of
   `<root>/.usf/tmp` — needs `tests/unit/providers/config.test.ts`;
3. register a closed record for `urn:usf:status-result:1` — needs
   `schemas/status-result.schema.json`.

**None of those three paths is any work's `writePath`.** Neither is
`graph/provider-pipeline.nq`, `graph/integration.nq` or
`graph/profile-authority.nq`.

So the smallest missing primitive is: **one narrowly scoped graph-maintenance
WorkPacket that owns the currently-unowned graph sources and orphaned
implementation paths.** Critically, that primitive is now *constructible* — a
`WorkPacket` resource declared into `graph/usf-bootstrap.nq` through
`realisation-basis-chain` is a legitimate authorized graph edit, and this session
proved that exact chain works end to end. Under `urn:usf:contract:semantic-first-order:1`
it would inherit the already-active permission and need no new publication
policy. What it still needs authored: its contract binding, evidence
requirements, proof obligations, a validation whose command is satisfiable under
its declared confinement, and a non-empty `readSet` covering that command's
files.

Note the general lesson the v2 defect teaches: **a work with an empty `readSet`
whose validation command names files it does not own is structurally
unsatisfiable.** `realisation-basis-chain` is the counter-example that works —
44 readSet entries covering all five of its validation's test files.

### Gap C — derived: no authority blocker remains, only implementation

`urn:usf:rule:provider-receipt-target-registration:1` needs **no new authority
mechanism**. Both named owners hold current construction authority right now:

| role | work | state |
|---|---|---|
| `featureOwner` | `provider-account-tier-receipt` | `verified-complete`, `active-permission`, `maximumThrough: integrate` |
| `staticRegistryOwner` | `operator-observability` | `verified-complete`, `active-permission`, `maximumThrough: integrate` |

A `verified-complete` work retaining `active-permission` is the point: completed
works can legitimately construct again, so the three-phase seam is performable
without reopening anything by convention. `operator-observability` owns
`src/commands/providers.ts`, `src/commands/help.ts`,
`src/commands/provider-leaf-dispatch.ts` and `src/commands/status.ts`.

What the seam actually costs is implementation, not authority: the entire receipt
v2 protocol (source-state head-set, retry DAG, persisted bucketed projection,
`activate|acquire|verify|reduce` modes and bounded list) is specified in the
graph and entirely unbuilt. Correct the earlier framing: this is a large
implementation packet behind a well-specified seam, not an authority gap.

### Verified evidence at this boundary

Two integration commits, each a pure append with a passing confined
`urn:usf:validation:realisation-basis-chain-focused` check:
`graph/usf-bootstrap.nq` +15 then +51, zero deletions. Full gate **223/223** and
containment `pass` after each. A standalone empty-`.usf` clone at
`4e1aa55a22ad9c661f2ffaf7b4c6fc0bc9fa31e3`, tree
`54ce2defd3d0b3987259b9064737f88f6187f497`, passes **223/223** with containment
`pass`, a clean tracked tree, and reproduces semantic digest
`sha256:19e2c18b...` from tracked graph, source and evidence alone.

The gate stayed at 223 because both contributions were semantic authority only —
no new test coverage, so no count movement is expected here.

Three preserved uncommitted drafts remain, digests unchanged across being moved
aside and restored:

| Path | SHA-256 |
|---|---|
| `schemas/route-qualification-receipt.schema.json` | `95d5e6be…4dd3fc04` |
| `src/providers/routing.ts` | `fb4fbeff…840551f84` |
| `tests/unit/providers/routing.test.ts` | `b03d8dde…19b108d9f` |

`README.md` still carries its unrelated pre-existing documentation draft, outside
every write set and never committed.

### Next safe order

1. author the graph-maintenance WorkPacket described above into
   `graph/usf-bootstrap.nq` through `realisation-basis-chain`. It is the single
   primitive that unblocks all three residual repairs;
2. through it, narrow the v2 validation command or fix `config.test.ts`'s
   write root, then take `provider-semantic-qualification-v2` through the
   canonical chain with the preserved drafts — restoring all three owned paths to
   exact carrier preimage first;
3. then `provider-parallel-execution`;
4. the receipt-v2 seam is implementation-scale and needs no authority work;
   schedule it deliberately as the specified three-phase change.

## Prior boundary — seven packets complete; the invocation boundary is real

This section supersedes every older `Current`, `Live continuation`, `Prior
boundary` and `Next` heading retained below as chronological evidence; do not
operationalize those older boundaries unless this section explicitly restates
them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

Seven packets are `verified-complete`: `repository-path-scope`,
`file-asset-index`, `operator-observability`, `provider-census`,
`provider-hidden-holdout`, `provider-account-tier-receipt` and, newly,
`provider-invocation-boundary`. Current semantic digest
`sha256:762de1315ee2cb3982b931a51abf0085ea7751c4dbbe1ce57199b0691cf8c1c0`.
Remote-verified at `c7fa6a155164b5a8a9aebcc1c46065a58f12a1ec`, tree
`5fe7d22ff7b97162d97e8227b0d856d71cf885b3`.

### Read this first: the preserved drafts were stale against the graph

Four drafts were carried into this session as `provider-invocation-boundary`'s
write set. Comparing them against the graph **before** use was decisive: two of
the three schemas disagreed with their declared `requiredFieldSet`.

| Record | Draft | Graph |
|---|---|---|
| `adapter-preflight-receipt:1` | 14 fields | 14 — matched |
| `provider-answer-observation:1` | 17, one `accountReceiptDigest` | **20**: adds `candidateMemberDigest`, `accountObservationDigest`, `routeModelEconomicsBindingDigest`, `credentialSourceIdentityDigest` |
| `run-authorization:1` | 20, one `accountReceiptDigest` | **23**: the same four plus `accountSourceUseAuthorizationDigest` |

The drafts predate the account-tier remodelling that split the factual account
observation from profile-bound use authorization and gave candidate-member
identity its own key. A single `accountReceiptDigest` is exactly the collapsed
shape that remodelling removed. `src/providers/probe.ts` and the fixture test
carried the same stale field names throughout.

All three schemas now match their graph `requiredFieldSet` exactly **and in
order**, verified mechanically rather than by reading. Never adopt a preserved
draft without that comparison; a draft is a proposal, and the graph moved.

### The confined lane is a permission cage over a full tree, not a pruned one

`urn:usf:validation-runtime-closure:provider-invocation-boundary:1` supplies
only `src/core/canonical.ts`, `src/core/errors.ts` and
`src/providers/economics.ts`, and deliberately omits `src/schema/index.ts`,
which sibling closures (`integration-validation-set`,
`operator-composable-input`, `operator-observability`) do declare. The narrow
validator assertions therefore sit in the ordinary outer carrier lane behind the
same `childProcessUnavailable` guard the observability lane uses, reached through
a dynamic import.

Honest boundary on that decision: the check receipt shows `src/schema/index.ts`
present as a `basis-input` and `validationAuthorityDependencies: []`, so the
confined workspace is a **full candidate tree under a Node permission cage that
denies child processes and network** — not a file-pruned scope. The static
import would very likely have passed too. The guarded split is a conservative
alignment with the graph's declared closure, not a proven necessity, and it
costs nothing: measured directly, the cage runs 3 and skips 1, the outer lane
runs all 4, and total coverage is strictly greater than the draft's.

### Derived write-set truth, not the handover's count

The graph's write set is six paths. Five changed. `src/commands/probe.ts` stayed
at its exact preimage: `usf probe answer` is a graph-registered
`RegisteredCliCommand` with `implementationState: proofblocked` and
`postQualificationAvailabilityTarget: implemented`, and its dispatch and help
belong to the CLI registry owner, not to this packet. `src/commands/help.ts` is
not in this write set, so adding a dispatchable `probe answer` here would have
made help untruthful.

Write-set drift, projected against the filesystem for every work: all seven
`verified-complete` packets have **zero** missing declared write paths,
including the new one at 0/6. `provider-semantic-qualification-v2` is missing 1
of 4 and `provider-parallel-execution` 3 of 5.

### Gate movement

The authoritative standalone empty-`.usf` gate moved **219 -> 223**. Three of the
four new tests run confined; the fourth is the guarded outer-lane validator
test. A byte-changing contribution that adds coverage must move the count.

`README.md` carries an unrelated pre-existing uncommitted documentation draft
(bootstrap ordering and `.usf` disposability). It is **not** in any selected
work's write set and was preserved dirty throughout, including across the
carrier checkpoint, the integration and both publications.

### The two-grant rule held exactly

The byte-delta contribution cost two construction grants. After a successful
`usf integrate` the packet dropped to `blocked` with
`COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT` because integration moved the
scoped dependency digest `sha256:7c4da88f...` -> `sha256:7b1f9e37...`. The first
grant was never repaired. Both publications were pure appends: 32 quads, then
79 quads, zero rewritten lines each.

Restoring the owned paths to exact carrier preimage before deriving evidence was
load-bearing, not ceremony: the scoped dependency digest was
`sha256:7de96bac...` with the drafts dirty and `sha256:9f279dae...` at preimage.
Evidence derived over the dirty desired postimage would have gone stale the
moment the paths were restored.

### Verified evidence at this boundary

A standalone empty-`.usf` clone at `c7fa6a1` passes **223/223** with
containment `pass`, a clean tracked tree, and reproduces semantic digest
`sha256:762de131...` from tracked graph, source and evidence alone. An
independent fresh clone from GitHub carries the exact same commit and tree
`5fe7d22f`. The four projections at that commit report `closureSatisfiability`
`satisfiable` with an empty `blockedWorks`, `publicationPolicyCoverage`
`covered` with 9 works and 0 at risk, `policyBlastRadius` derived from
scoped-dependency-closure membership over 6 policies, and `carrier` observed
from local refs only with no remote contact.

`policyBlastRadius` reproduced the V3 lesson unprompted: after this session's
publications `provider-pipeline-construction-authority:1` enumerates **4**
`eligibleWork` but stales **6** completions. `eligibleWork(policy)` is still not
`workWhoseScopedClosureContains(policy)`.

### What completing this packet did not buy

Nothing about provider contact. Re-evaluated at this boundary: all **twelve**
routes (2 configured, 7 legacy observations, 3 host transports) remain
`UNQUALIFIED` with empty reason codes, and
`usf providers receipt acquire` still refuses `PROVIDERS_RECEIPT_PROOFBLOCKED`.
The fixture proves adapter, authorization, environment, request and sanitized
observation construction. It is not a live answer, route qualification or
contact authority.

### Derived remaining chain to live provider invocation

Do not carry forward the "three packets remain" claim. Queried from registered
semantic state at this boundary, **two** graph-declared packets remain in the
provider profile, and they are not sufficient — and both are now blocked:

1. `provider-semantic-qualification-v2` — became `dependencyReady: true` with
   `verified-completion` authority for the first time this session (its
   predecessors `provider-hidden-holdout` and `provider-invocation-boundary` are
   both complete), was attempted end to end, and is **blocked by a graph closure
   defect** its own declared validation cannot get past. Implementation
   finished and preserved; see the dedicated section below. Permission
   `maximumThrough: route`, which is a provider-pipeline ceiling and does **not**
   gate the contribution chain — `provider-hidden-holdout` integrated a real
   byte delta at `maximumThrough: check`, and neither `integrate` nor
   `transition` reads the field.
2. `provider-parallel-execution` — `dependencyReady: false`; depends on
   `operator-observability` (complete) and the above. Owns
   `call parallel` / `call compare`.

**Neither packet lifts the acquisition proofblock.** This is the real gate, and
it is architecture, not adapters:

- `providerReceiptsCommandHandler` refuses `acquire` unconditionally at
  `src/commands/provider-receipts.ts:484`, immediately after argument and
  semantic-scope validation and **before** route or config lookup. That is the
  operation-wide proofblocked boundary working as designed.
- Lifting it requires `urn:usf:command:providers-receipt:2`, a `CliCommandTarget`
  with `availability: "target"` and `implementationState: proofblocked`. **No
  work declares it as a `registeredCommand`** — only as a
  `targetRegisteredCommand`.
- `urn:usf:rule:provider-receipt-target-registration:1` specifies the seam
  precisely: `featureOwner` `provider-account-tier-receipt`,
  `staticRegistryOwner` `operator-observability` — **both already
  `verified-complete`**. Its `coherentTransitionRule` is a bounded
  non-recurring three-phase sequence: construct and check the preliminary
  account-tier v2 implementation in isolated copy-on-write state and derive
  `registrationFeatureOperationsDigest` and
  `registrationFeaturePostimageSetDigest`; then publish the predecessor-owned
  complete static dispatch/help update bound to those two digests with no
  feature-owner write to operator paths; then rederive account-tier
  construction authority against the final operator completion, rematerialize
  and recheck the same feature semantics, require both feature digests exactly
  equal, and integrate and complete account-tier. `candidateDigest` is
  explicitly never the cross-seam equality key.
- Its `availabilityRule` is explicit that operator registration completion alone
  never activates receipt v2, authorizes provider contact or proves account-tier
  completion.

So the honest chain is: **two declared packets, plus one graph-specified but
unscheduled three-phase registration seam that re-opens two already-complete
works.** The seam, not the packets, is what stands between current authority and
trusted receipt acquisition. Live invocation additionally needs `probe answer`
to move from `proofblocked` to `implemented`.

### Registered-command authority gap — derived owner, and why it stays open

The four `usf status` projections are implemented and tested but are not
versioned graph `RegisteredCliCommand` resources. Resolved from the graph
rather than by topic:

- `RegisteredCliCommand` resources exist only in `graph/integration.nq` (8),
  `graph/profile-authority.nq` (7) and `graph/provider-pipeline.nq` (7). **None
  of those three files is any work's `writePath`**; they are written only by the
  publication commands.
- Across every manifest and profile, exactly two works own a graph source:
  `realisation-basis-chain` (`graph/foundation.nq`, `graph/usf-bootstrap.nq`)
  and `semantic-first-lifecycle-admission` (`graph/semantic-first.nq`), both in
  the hermes profile. `realisation-basis-chain` is `construction-ready` and
  `actionable`, and also owns `src/commands/help.ts`.
- `graph/foundation.nq` is a transitive source of
  `graph/manifests/self-host-provider-v3.json`. All nine works share one
  `foundationDigest` `sha256:f1d0c4c0...`, completions bind
  `realisationBasisDigest`, so a foundation write enters all nine bases at once
  and stales **all seven current completions and both current grants**.
- Registering status diagnostics is also outside `realisation-basis-chain`'s
  declared objective (carrying one immutable RealisationBasis through route,
  call, resolve, apply and check), so using its write permission for this would
  be smuggling an unrelated edit into a live write set.

Disposition: **preserved, not closed.** The implementation stays; the gap is
recorded with its measured cost. The graph does not make it a prerequisite for
the provider chain, and closing it through the only available owner would force
a full-cohort reproof — which is precisely the derailment to avoid. It needs
either a work that legitimately owns a `RegisteredCliCommand`-bearing graph
source, or the same `CliTargetRegistrationRule` seam pattern the receipt-v2
target already uses, with `operator-observability` as `staticRegistryOwner`.

### provider-semantic-qualification-v2 is blocked by a graph closure defect

It was attempted this session, all the way to a materialised candidate, and it
cannot complete. This is evidenced, not inferred.

`urn:usf:validation:provider-qualification-v2` declares an eight-file command:

```
node --test --test-isolation=none tests/unit/providers/catalogue.test.ts \
  tests/unit/providers/config.test.ts tests/unit/providers/economics.test.ts \
  tests/unit/providers/fake.test.ts tests/unit/providers/probe.test.ts \
  tests/unit/providers/qualification-assets.test.ts \
  tests/unit/providers/qualification.test.ts tests/unit/providers/routing.test.ts
```

Only three of those eight are reachable in the packet's own confined scope:
`economics`, `qualification` and the owned `routing`. `catalogue`, `config`,
`fake`, `probe` and `qualification-assets` are in **neither** the packet's
490-file scoped dependency closure **nor** its write set, and **no**
`ValidationRuntimeClosure` is declared for that validation.

The mechanism is exact. `candidateScope` is
`readSet ∪ writeSet ∪ fileDependencies` (`src/realisation/index.ts:588`), and
this packet's `readSet` is empty, so the candidate workspace materialises 267
files without those five. `confinedNodeTestLaunch`
(`src/commands/check.ts:230-242`) requires every test path named by the command
to exist in the candidate as a same-root regular non-symlink file, returns
`null` when one does not, and the caller reports
`CHECK_CONFINEMENT_UNAVAILABLE` (`src/commands/check.ts:619`).

Observed exactly that: `usf check --candidate sha256:a2026ff1... --validation
urn:usf:validation:provider-qualification-v2` refuses
`CHECK_CONFINEMENT_UNAVAILABLE`. It is not an initialization, host-tool,
currentness or retry condition: `usf doctor` reports `ok`, bwrap 0.9.0 is
present and trusted, every ignored operational root is `0700` and owner-owned,
and `.usf/cache` is private. `provider-hidden-holdout` succeeded under the same
machinery precisely because its validation names one file that is inside its
closure.

Every available fix is a write to `graph/provider-pipeline.nq`: declare a
`ValidationRuntimeClosure` for the validation carrying the five missing
`repositoryReadFile` rows; or add them to the work's `readSet`; or narrow the
validation command. That file is **no work's `writePath`** and is written only
by the publication commands, so the fix is not available from inside any
authorized write set. This is the same class of gap as the
`RegisteredCliCommand` one below, and it is why the session stops here rather
than editing the graph directly.

**The implementation itself is finished and verified.** Three preserved
uncommitted drafts sit in the primary working tree:

| Path | SHA-256 |
|---|---|
| `schemas/route-qualification-receipt.schema.json` | `95d5e6be…4dd3fc04` |
| `src/providers/routing.ts` | `fb4fbeff…840551f84` |
| `tests/unit/providers/routing.test.ts` | `b03d8dde…19b108d9f` |

They add `urn:usf:route-qualification-receipt:1` (17 fields, matching its graph
`requiredFieldSet` exactly and in order, compiling through the narrow
validator), `parseRouteQualificationReceipt`,
`routeQualificationReceiptDigest`, `evaluateRouteMemberCurrentness`,
`deriveQualificationCohort` and `evaluateWorkloadReadiness`, plus five
table-driven tests with planted defects. The change is **purely additive**: 914
insertions, **zero** deletions, so the five other validations that import
`src/providers/routing.ts` are untouched. A standalone clone with these three
files passes **228/228** and typechecks clean; the exact validation command
passes 62/62 across all eight files in the outer lane. `src/commands/route.ts`
was deliberately left at preimage: new CLI option surface would need
`src/commands/help.ts`, which is not in this write set.

The construction grant published for this packet during the attempt was
**rolled back** — evidence, proof and a twice-identical verified publication all
succeeded, but a grant whose own completion validation cannot execute unlocks
nothing, and the eventual closure fix will move the semantic digest and stale it
anyway. The repository is back at semantic digest
`sha256:762de131...` with all seven completions `verified-complete`, 223/223,
containment `pass`. A verified reference copy of the postimage also sits in the
standalone clone `/home/user/src/usf-v3-q-ZW1ihm`.

**When the closure is fixed, do not re-derive these bytes from scratch, and do
restore all three owned paths to exact carrier preimage before deriving
construction evidence** — the preserved drafts move the scoped dependency digest
while dirty, exactly as they did for `provider-invocation-boundary`.

### Next safe order

1. `provider-semantic-qualification-v2` is **blocked**, not next: its declared
   validation cannot execute in its own confined scope (see above). It needs a
   `graph/provider-pipeline.nq` write that no work owns. Its implementation is
   done and preserved;
2. then `provider-parallel-execution`, which is blocked behind it;
3. the receipt-v2 registration seam is the true provider gate and is fully
   specified in `urn:usf:rule:provider-receipt-target-registration:1`. Schedule
   it deliberately as a bounded three-phase change over two complete works, not
   opportunistically; and
4. leave the `RegisteredCliCommand` gap preserved until an owner exists.

## Prior boundary — six packets complete; account-tier backed by a real closure

This section supersedes every older `Current`, `Live continuation` and `Next`
heading retained below as chronological evidence; do not operationalize those
older boundaries unless this section explicitly restates them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

Six packets are `verified-complete`: `repository-path-scope`,
`file-asset-index`, `operator-observability`, `provider-census`,
`provider-hidden-holdout` and, newly, `provider-account-tier-receipt`.
Current semantic digest
`sha256:5e3853d3afc6df2f7e6f377f061385044ae9d5648fb8ae4ccd798b9c90ce9ba3`.

### Read this first: completing account-tier does not enable provider contact

The predecessor plan expected this packet to be "the actual provider unlock".
It is not, and that is a property of the repository rather than of the
implementation:

- `providerReceiptsCommandHandler` refuses `acquire` **unconditionally**, by
  design, before any route or config lookup. Live account-source acquisition is
  a separate proofblocked contract.
- The graph chain to one live invocation is
  `provider-account-tier-receipt` -> `provider-invocation-boundary` ->
  `provider-semantic-qualification-v2` -> `provider-parallel-execution`.
  Three packets still stand between here and provider contact.
- Re-evaluated at this boundary after completion: all twelve configured routes
  remain `UNQUALIFIED`, `usf route` derives no assignment, and
  `usf providers receipt acquire` is still proofblocked.

What completion did buy is the invariant: semantic authority no longer asserts
a production path the executable repository cannot honour.

### The rolled-back packet is now completed on real implementation

A previous session completed this packet as no-change, watched the outer gate
fail 208/209, and rolled back. The cause was
`urn:usf:requirement:provider-receipt-production-runtime-closure` declaring a
20-member `ProductionLeafRuntimeClosure` whose members
`src/providers/account-sources.ts`, `src/providers/disposition.ts` and
`src/providers/host-source-identities.ts` did not exist.

The graph, not the handover, was the authority for the write set. It records
**18** missing paths, not the approximate 19 carried forward, and **15** of them
are schemas rather than 16. Always resolve this from
`usf work --selector <work>` against the filesystem.

Every schema's `required` array is generated from its graph-declared
`requiredFieldSet`, so a schema cannot silently drift from its record contract,
and all 15 compile through the repository's narrow schema-policy validator.
Note that the validator admits neither `maxLength` nor `uniqueItems`; those
bounds live in the runtime parsers. Two result schemas inline their nested
closed record into local `$defs`, because an external `$ref` refuses
`SCHEMA_REF_EXTERNAL`.

The three modules are genuinely value-imported at runtime, so the declared
closure is real rather than aspirational: `provider-receipts.ts` value-imports
`disposition.ts` and `host-source-identities.ts`, and `disposition.ts`
value-imports `account-sources.ts`. A type-only import would have been erased
and left the declared member unreached.

They also parse by hand rather than loading their own JSON schemas. That is
deliberate: a schema read synchronously during module evaluation becomes a
further closure member, and the declared count is fixed at 20.
`src/providers/economics.ts` already established this convention.

### Verified at both boundaries before completion was minted

This is the ordering the invariant requires, and it is cheap now that the
diagnostics are registered:

- confined: the packet's sole graph-selected validation
  `urn:usf:validation:provider-account-tier-receipt` passed exit 0 on candidate
  `sha256:4c920c7f...`;
- outer production CLI: `usf status ... .closureSatisfiability` reported
  `satisfiable`, no `blockedWorks`, and both closures matching their declared
  member counts (17/17 and 20/20).

The decisive read-back is the outer leaf. `usf providers receipt acquire` now
returns exit 1 `PROVIDERS_RECEIPT_PROOFBLOCKED` **with the handler's own
message** ("Live account-source acquisition remains separately proofblocked; no
provider was contacted") rather than the dispatcher's proofblock message. That
message difference is the evidence that completion moved execution past the
proofblock, the fresh child authenticated all 20 closure members, and the
handler itself produced the intended outcome. The predecessor's failure mode was
exit 4 `PROVIDERS_RECEIPT_DEPENDENCY_REFUSED` at exactly this point.

### What the three modules do, and what they explicitly do not

- **`account-sources.ts`** holds the profile-independent `accountSourceKeyDigest`
  domain plus strict parsers for authorization v2, observation and attempt. The
  key excludes profile, policy, privacy and time, so one factual observation is
  reusable across profiles without a second account call. Records reconstruct
  their own declared key digest rather than being believed; provider credential
  expiry caps observation expiry; every currentness decision takes an explicit
  instant rather than reading the clock, so a projection and the decision it
  informs cannot disagree about "now"; and a crossed source-kind/credential-mode
  pair refuses so one source kind cannot borrow the other's evidence.
- **`host-source-identities.ts`** derives a stable secret-safe host identity that
  excludes the expiring host authorization, so routine re-authentication does not
  read as a new account source. The credential file is opened no-follow and never
  read: only nine metadata attributes, compared pre-open, at-open and post-open,
  enter the digest, and the path is excluded so an equivalent file elsewhere
  keeps its identity while a substituted file does not. A host source with
  neither a credential-file nor an executable identity refuses
  `HOST_SOURCE_IDENTITY_UNSTABLE` rather than keying on an expiring
  authorization.
- **`disposition.ts`** is the pure, lock-free, snapshot-bound reducer. It is
  total: every candidate gets exactly one terminal disposition. It never chooses
  implicitly: zero applicable sources is `not-observed`, more than one is
  `conflict-ineligible`, and it never breaks ties by array order, latency, price
  or provider preference. A mapping applies only when provider **and** transport
  both match, so an OpenRouter account cannot speak for a direct-SDK route.
  `candidateSourceSetDigest` binds only the sources that apply to that candidate,
  so an unrelated provider's movement does not reproof it. Zero-paid needs a
  current observation, complete pricing with no conditional members, entitlement,
  available quota and all three paid controls explicitly disabled; any unknown
  falls to `not-observed` rather than optimistic zero-paid.

**Explicit nonclaims for this packet.** No live account-source contact is
performed. There is no copy-on-write source-state manifest or head-set protocol,
no 33-head transient reduction, no retry-DAG deferral antichain, no persisted
bucketed economics projection on disk, and no v2
`activate`/`acquire`/`verify`/`reduce` command modes. The graph specifies all of
these under `urn:usf:command:providers-receipt:2` and
`urn:usf:provider-operation:account-source-protocol:2`; they remain unbuilt.
The bucket partitioning and list-cursor binding exist as pure functions with
tests but nothing persists or paginates records yet.

### Gate movement across this session

The authoritative standalone empty-`.usf` gate moved 209 -> 210 -> 213 -> 219.
Every increment is real coverage added by a byte-changing contribution: one test
from the hidden-holdout evaluator, three from the registered diagnostics, six
from the account-tier source domain. A byte-changing contribution that adds
coverage must move the count; an unchanged count after one is suspicious.

A local `node --run check` in the primary reports two more (221) because six
preserved uncommitted drafts remain there, four of which are
`provider-invocation-boundary`'s write set. Only the standalone clone number is
authoritative.

### Next actionable packet

`provider-invocation-boundary` is now `dependencyReady: true` with
`verified-completion` authority for the first time, and **all six of its write
paths already exist** — four of them as the preserved drafts
`schemas/adapter-preflight-receipt.schema.json`,
`schemas/provider-answer-observation.schema.json`,
`schemas/run-authorization.schema.json` and
`tests/integration/provider-invocation.test.ts`. It needs construction evidence
and proof under `urn:usf:permission:provider-adapter-preflight`, which is not
yet active. Treat those drafts as unreviewed proposals that must enter through
the registered contribution chain, never by direct commit.

### Registered-command gap register

| Gap | State | Owner | Required registered behaviour |
|---|---|---|---|
| ~~Production closure satisfiability~~ | **closed** — `usf status ... .closureSatisfiability` | `operator-observability` | Earned its keep immediately: it named the three missing account-tier modules before publication, and gated this boundary's completion. |
| ~~Publication policy coverage~~ | **closed** — `usf status ... .publicationPolicyCoverage` | `operator-observability` | Reports `covered` for the current closure. |
| ~~Policy-widening blast radius~~ | **closed** — `usf status ... .policyBlastRadius` | `operator-observability` | Derived from scoped closure membership, not `eligibleWork`. Predicted its own change's blast radius exactly. |
| Carrier truth | **partly closed** — `usf status ... .carrier` | `operator-observability` (`src/commands/status.ts`) | Local worktree kind, detached HEAD, branch, origin presence, semantic digest and upstream distance from already-fetched local refs are projected. Still open: comparing two named checkouts, and an explicitly requested single named remote ref. Both need an option, so both need the `help.ts` surface. |
| Checkpoint qualification | **open** — still a hand-built shell script, run four times this session | `operator-observability` | One command taking an exact commit and performing the standalone empty-`.usf` qualification. The exact procedure is recorded below, so the rediscovery cost is gone even though the command is not. |
| Obligation identity | **open** | `operator-observability` (`usf work`/`usf query`) | Readable in practice from `realisationAuthority.constructionProofObligation` and `.completionProofObligation`; the gap is that `usf query` does not project them and the reason codes vanish once authority exists. Composing the IRI from the work IRI refuses `CONSTRUCTION_OBLIGATION_MISMATCH`. |
| Batch incompatibility detail | **open** | existing `usf publish` | Name the incompatible member and the compared identity in `WORK_COMPLETION_CANDIDATE_READBACK_INVALID`. |
| Ignored-state readiness | **open** | `provider-census` (`src/commands/doctor.ts`) | Expose every recurring ignored operational root with its required owner, type and mode, so a `.usf/inputs` drift to 775 is a named doctor finding rather than a `DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED` in an unrelated contract test. |
| Graph-registered command authority for projections | **open** | unassigned | The four new `usf status` projections are implemented and tested but are not versioned graph `RegisteredCliCommand` resources, because `graph/provider-pipeline.nq` and `graph/profile-authority.nq` are no work's `writePath` and are written only by the publication commands. Decide which packet owns registering command authority for projections added to an existing command. |
| Write-set drift against the graph | **new, open** | `operator-observability` (`usf work`) | Project, per selected work, which declared `writePath` members do not exist as same-root regular files. Every `verified-complete` packet currently has zero missing write paths, so this is a real invariant; deriving it by hand is how the handover's approximate "19 files, 16 schemas" was corrected to 18 and 15. |

### The standalone empty-`.usf` qualification procedure

Until it is a registered command, this is the exact procedure. It contacts no
remote and uses only local objects.

```sh
PRIMARY=/home/user/src/usf-v3
OUT=$(mktemp -d /home/user/src/usf-v3-q-XXXXXX) && rm -rf "$OUT"
git clone --no-hardlinks --quiet "file://$PRIMARY" "$OUT"
cd "$OUT" && git checkout --quiet --detach <COMMIT>
./scripts/bootstrap.sh                       # creates the empty .usf layout
cp -a "$PRIMARY/node_modules" "$OUT/node_modules"
cp -a "$PRIMARY/.usf/cache/pnpm-virtual-store" "$OUT/.usf/cache/pnpm-virtual-store"
cp -a "$PRIMARY/.usf/cache/pnpm-store"        "$OUT/.usf/cache/pnpm-store"
cp -a "$PRIMARY/.usf/cache/pnpm-store-deps"   "$OUT/.usf/cache/pnpm-store-deps"
cp -a "$PRIMARY/.usf/cache/bootstrap-carrier-packages" "$OUT/.usf/cache/bootstrap-carrier-packages"
chmod 700 "$OUT/.usf/cache"                  # a group-writable cache correctly
                                             # refuses CHECK_CONFINEMENT_UNAVAILABLE
mkdir -p /tmp/usf-authoritative /tmp/usf-corepack
TMPDIR=/tmp/usf-authoritative COREPACK_HOME=/tmp/usf-corepack node --run check
TMPDIR=/tmp/usf-authoritative ./scripts/verify-contained.sh
git rev-parse HEAD && git rev-parse HEAD^{tree} && git status --porcelain
./bin/usf status --profile <PROFILE> --manifest <MANIFEST>   # reproduce the digest
```

### The byte-delta contribution chain, for reuse

Used three times this session. It is not the no-change shape and normally costs
two construction grants, because integration moves the packet's scoped
dependency digest and stales the grant that authorized the contribution.

1. Restore every owned path to its exact carrier preimage; put the desired
   postimage bytes only in the immutable contribution. Develop in a separate
   standalone clone so the primary stays at preimage throughout.
2. If the packet holds **no** current grant: `usf evidence construction` ->
   `usf prove construction` -> `usf publish construction-authority --verify`
   twice with an identical projection -> `--apply`. If it already holds one,
   skip this: a second grant refuses `CONSTRUCTION_PUBLICATION_PARTIAL_STATE`,
   which is correct, not a defect.
3. One bounded owner-private mode-0600 `.usf/inputs/*.json` holding a single
   assignment whose `basis` is the packet's exact current `realisationBasis`,
   whose `packet.permittedPaths` is the write set, whose
   `proposedFileOperations` are `write` operations carrying the postimage bytes,
   and whose `workPacketDigest`, `scopedDependencyDigest` and
   `promptTemplateDigest` equal `basis.work.packetCoreDigest`,
   `basis.work.scopedDependencyDigest` and `basis.inputs.policyDigest`.
4. `usf call --input FILE`, and authenticate a complete `ok` batch: empty
   failures, requested equal to succeeded, failed zero.
5. `usf resolve --input -` then `usf apply --input -`.
6. One `usf check --candidate DIGEST --validation IRI` per completion validation
   obligation. `usf check` takes no `--profile` or `--manifest`.
7. `usf integrate --dry-run`. A first-time `INTEGRATION_DETACHED_BASIS_MISMATCH`
   means the candidate basis contains uncommitted semantic bytes: close a
   coherent carrier checkpoint containing exactly those unchanged bytes and
   retry the same content-addressed candidate and check receipt. Then
   `usf integrate`.
8. Rederive construction authority at the postimage basis, **restoring stale
   roots before consumers** — a consumer refuses `CONSTRUCTION_DEPENDENCY_NOT_READY`
   until its root is complete again, and restoring the root often restores the
   consumers' grants for free. Then `usf realise no-change` -> one `usf check`
   per obligation -> `usf evidence completion` -> `usf prove completion` ->
   `usf publish work-completion --verify` twice -> `--apply`.

Before minting completion for any packet owning a `ProductionLeafRuntimeClosure`,
require `usf status ... .closureSatisfiability` to report `satisfiable` with an
empty `blockedWorks`, and exercise the real registered leaf once.

### Next safe order

1. advance `provider-invocation-boundary`: it is dependency-ready for the first
   time and all six write paths already exist, four as preserved drafts. Its
   `urn:usf:permission:provider-adapter-preflight` is not yet active, so it
   needs construction evidence and proof first;
2. then `provider-semantic-qualification-v2`, then
   `provider-parallel-execution`, which is where a live multi-provider run
   actually becomes reachable;
3. in parallel, close the remaining carrier-truth, checkpoint-qualification,
   write-set-drift and ignored-state gaps, and decide the graph
   `RegisteredCliCommand` ownership question; and
4. only build the receipt v2 protocol surface (source-state head-set, retry DAG,
   persisted bucketed projection, v2 command modes) when a consumer actually
   needs it. It is fully specified in the graph and entirely unbuilt.

Verified evidence at this boundary: a standalone empty-`.usf` clone at
`50683aeeae2e915567496ea3da7475f0824e3516` passes **219/219** with containment
`pass`, an unchanged commit, tree and clean status, and reproduces semantic
digest `sha256:5e3853d3...`, `closureSatisfiability: satisfiable`,
`publicationPolicyCoverage: covered` and the handler-level proofblocked acquire
from tracked files alone.

Provider contact remains disabled and no live demonstration exists. All twelve
configured routes are `UNQUALIFIED`, `usf route` derives no assignment, and
`usf providers receipt acquire` is proofblocked. No live account observation,
provider entitlement, model qualification, adapter load, parallel run,
semantic-token reduction, ANQR realisation, staging, production, BAU or terminal
proof is claimed. The hidden-holdout evaluator is deterministic-fixture
capability only and has never scored a provider answer. The `local` route used
by every contribution this session is the in-repository
`DeterministicFakeProvider`: a no-contact composition boundary, not a provider.

## Prior boundary — five packets complete; semantic diagnostics registered

This section supersedes every older `Current`, `Live continuation` and `Next`
heading retained below as chronological evidence; do not operationalize those
older boundaries unless this section explicitly restates them.

Prepared 2026-09-01. Read current Git and remote state rather than trusting any
identifier here. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

Two things happened at this boundary. `provider-hidden-holdout` was completed
through a genuine byte delta, and the three highest-value diagnostics from the
registered-command gap register became graph-derived projections of
`usf status` rather than operator knowledge.

Five packets are `verified-complete`: `repository-path-scope`,
`file-asset-index`, `operator-observability`, `provider-census` and
`provider-hidden-holdout`. `provider-account-tier-receipt` is
`construction-ready` and must still not be completed as no-change.

### Registered: four graph-derived projections in `usf status`

`usf status --profile PROFILE --manifest PATH` now emits `carrier`,
`closureSatisfiability`, `publicationPolicyCoverage` and `policyBlastRadius`.
Without an explicit profile and manifest each reports `not-selected` rather
than implying a clean bill of health, and each appears in `coverage.unobserved`.

- **`closureSatisfiability`** asserts, for every typed
  `ProductionLeafRuntimeClosure`, that the declared `closureMemberCount` equals
  its distinct `runtimePath` rows, that every member is a same-root regular
  non-symlink file, and that the declared `entryModulePath` is one of its own
  members. Reason codes are `CLOSURE_MEMBER_COUNT_UNDECLARED`,
  `CLOSURE_MEMBER_COUNT_MISMATCH:<declared>:<actual>`,
  `CLOSURE_MEMBER_MISSING:<path>`, `CLOSURE_MEMBER_NOT_REGULAR_FILE:<path>`,
  `CLOSURE_MEMBER_OUTSIDE_ROOT:<path>` and
  `CLOSURE_ENTRY_MODULE_NOT_A_MEMBER:<path>`. Against the current repository it
  reports `unsatisfiable`, `blockedWorks:
  ["urn:usf:work:provider-account-tier-receipt"]`, and names
  `src/providers/account-sources.ts`, `src/providers/disposition.ts` and
  `src/providers/host-source-identities.ts`. That is exactly the defect that
  previously cost a completion publication and a rollback, now readable before
  publication.
- **`publicationPolicyCoverage`** asserts over the exact selected closure that
  every selected work has exactly one construction-authority and one completion
  policy, and that each named policy's `publicationAlgorithm` carries the
  reciprocal `publicationPolicy` edge. Risks are
  `CONSTRUCTION_WORK_NOT_ELIGIBLE`, `CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS`,
  `WORK_COMPLETION_NOT_ELIGIBLE`, `WORK_COMPLETION_POLICY_AMBIGUOUS` and
  `CONSTRUCTION_AUTHORITY_PUBLICATION_CHAIN_INVALID:<policy>`. The current
  closure is `covered`.
- **`policyBlastRadius`** projects, per publication policy, which works would
  stale if that policy's digest moved, split into `currentGrantsAtRisk` and
  `currentCompletionsAtRisk`.
- **`carrier`** reports worktree kind, detached HEAD, branch, origin presence
  and upstream distance, and is discussed below.

### Decision-changing lesson: blast radius is closure membership, not `eligibleWork`

The obvious derivation is wrong. A policy's `eligibleWork` list and the set of
works whose scoped dependency closure actually contains that policy are
genuinely different sets. Measured at this boundary:

| Work | Policies in its scoped closure |
|---|---|
| `repository-path-scope` | `construction-authority:1` only |
| `file-asset-index` | `construction-authority:1`, `construction-authority:3`, `no-change-completion:1` |
| `provider-hidden-holdout` | `construction-authority:2` only |
| `provider-census` | `construction-authority:1`, `no-change-completion:1` |

Note that `file-asset-index` does **not** carry its own completion policy
`no-change-completion:3` in its closure, while it does carry two policies that
do not enumerate it. Only closure membership decides what a digest move stales,
so the projection is derived from each packet's
`realisationBasis.work.dependencies` and reports
`derivation: "scoped-dependency-closure-membership"`.

**The projection predicted its own change's blast radius exactly.** Before
contributing, it named `operator-observability`, `provider-census` and
`provider-account-tier-receipt` as the works whose current authority a change
to `src/commands/status.ts` would stale. Integration then staled exactly those
three. That is the trial-amendment-and-rollback loop replaced by a read-back.

### Decision-changing lesson: restore the stale root, not each consumer

After integration all three staled works reported `blocked`. Deriving
construction evidence for `provider-census` or `provider-account-tier-receipt`
first refused `CONSTRUCTION_DEPENDENCY_NOT_READY`, correctly, because both
depend on `operator-observability`'s completion. Republishing
`operator-observability`'s construction authority and completion **restored
both consumers' grants automatically** to `construction-ready` with
`active-permission`; only `provider-census`, which had been complete, needed
its own completion republished. Restoring roots first collapses what looks like
three recovery chains into one and a half.

### Decision-changing lesson: a current grant is not republished, it is reused

`usf publish construction-authority --verify` refused
`CONSTRUCTION_PUBLICATION_PARTIAL_STATE` when asked to publish a second grant
for a packet whose grant was already current. That is correct and is not a
defect: a packet that already holds active construction authority contributes
under the grant it has. Only after integration stales it does a fresh grant
become both necessary and publishable.

### Confined candidates deliberately do not carry `status.ts`'s imports

The operator no-change candidate contains `src/commands/status.ts` but not
`src/graph/index.ts`, `src/graph/nquads.ts`, `src/graph/query.ts`,
`src/continuous/lifecycle.ts`, `src/core/scope.ts` or `src/realisation/basis.ts`.
Nothing in the confined validation previously imported `status.ts`, so those
imports were never resolved. A static test import of `status.ts` therefore
fails the confined check even though the outer suite passes, and
`urn:usf:validation-runtime-closure:operator-observability:1` cannot be widened
from this profile because `graph/usf-bootstrap.nq` is owned by
`realisation-basis-chain`, and a second closure targeting the same validation
refuses `VALIDATION_RUNTIME_CLOSURE_AMBIGUOUS`.

The accepted correction places the new coverage in the ordinary outer carrier
lane in `tests/integration/observability-cli.test.ts`, reached through a
`await import(...)` guarded by the existing `childProcessUnavailable` check.
The confined lane is unchanged. Do not rediscover this by adding a static
import; it will fail `tests/integration/profile-scoped-authority.test.ts` with
`CHECK_FAILED` and no module-resolution detail.

### The status locality invariant was strengthened, not widened

The carrier projection adds `symbolic-ref`, `config` and `rev-list` to the Git
operations `usf status` performs. All are local reads. Rather than simply
extending the allowlist, the assertion now carries a closed local-only
allowlist **and** an explicit negative assertion that no remote-capable Git
operation (`fetch`, `ls-remote`, `push`, `pull`, `clone`, `remote`,
`submodule`) is ever invoked, plus read-backs of `carrier.remoteContact`,
`upstream.observedFromLocalRefsOnly` and `comparisonScope`.

`carrier` deliberately does not compare this checkout against sibling clones.
One invocation observes one checkout; inventing that comparison from a single
root would be a guess. Upstream distance comes from already-fetched local
remote-tracking refs, so an absent or stale upstream reports `not-observed`
with `CARRIER_HEAD_DETACHED`, `CARRIER_UPSTREAM_NOT_CONFIGURED` or
`CARRIER_UPSTREAM_REF_UNREADABLE` rather than "up to date".

### Still open: account-tier requires real implementation

Unchanged and reconfirmed, and now machine-readable through
`usf status ... | closureSatisfiability`.
`urn:usf:requirement:provider-receipt-production-runtime-closure` declares a
20-member `ProductionLeafRuntimeClosure` whose members
`src/providers/account-sources.ts`, `src/providers/disposition.ts` and
`src/providers/host-source-identities.ts` do not exist. Its confined validation
cannot observe this; only the outer registered `usf providers receipt acquire`
boundary does, by turning exit 1 `PROVIDERS_RECEIPT_PROOFBLOCKED` into exit 4
`PROVIDERS_RECEIPT_DEPENDENCY_REFUSED`. Its declared write set is 24 paths, of
which 19 do not yet exist. Resolve the exact write set from the graph rather
than from that count.

### Remaining preserved drafts

Six deliberately preserved uncommitted drafts remain in the primary checkout
and exist in no commit. Four are exactly the missing write-set members of
`urn:usf:work:provider-invocation-boundary`, which is not yet
dependency-ready: `schemas/adapter-preflight-receipt.schema.json`,
`schemas/provider-answer-observation.schema.json`,
`schemas/run-authorization.schema.json` and
`tests/integration/provider-invocation.test.ts`. The other two, `README.md` and
`src/providers/probe.ts`, are unreviewed and belong to no currently actionable
packet. Do not delete them and do not treat their presence as evidence. They
add two tests to a local `node --run check`, so only the standalone
empty-`.usf` clone number is authoritative.

### The byte-delta contribution chain, for reuse

Both contributions this session used the same shape. It is not the no-change
shape and costs two construction grants, because integration necessarily moves
the packet's scoped dependency digest and stales the grant that authorized the
contribution.

1. Restore every owned path to its exact carrier preimage. Put the desired
   postimage bytes only in the immutable contribution. Evidence derived while
   an owned desired edit is already dirty becomes stale when that path is
   restored.
2. If the packet holds no current grant: `usf evidence construction` ->
   `usf prove construction` -> `usf publish construction-authority --verify`
   twice with an identical projection -> `--apply`. If it already holds one,
   skip this; a second grant refuses `CONSTRUCTION_PUBLICATION_PARTIAL_STATE`.
3. Build one bounded owner-private mode-0600 `.usf/inputs/*.json` holding a
   single assignment whose `basis` is the packet's exact current
   `realisationBasis`, whose `packet.permittedPaths` is the write set, whose
   `proposedFileOperations` are `write` operations carrying the postimage
   bytes, and whose `workPacketDigest`, `scopedDependencyDigest` and
   `promptTemplateDigest` equal `basis.work.packetCoreDigest`,
   `basis.work.scopedDependencyDigest` and `basis.inputs.policyDigest`. Use the
   local zero-cost deterministic route.
4. `usf call --input FILE` and authenticate a complete `ok` batch: empty
   failures, requested equal to succeeded, failed zero.
5. `usf resolve --input -` then `usf apply --input -`.
6. One `usf check --candidate DIGEST --validation IRI` per completion
   validation obligation. `usf check` takes no `--profile` or `--manifest`.
7. `usf integrate --dry-run`. A first-time
   `INTEGRATION_DETACHED_BASIS_MISMATCH` means the candidate basis contains
   uncommitted semantic bytes: close a coherent carrier checkpoint containing
   exactly those unchanged bytes and retry the same content-addressed candidate
   and check receipt. Then `usf integrate`.
8. Rederive construction authority at the postimage basis, restoring stale
   roots before consumers, then `usf realise no-change` -> one `usf check` per
   obligation -> `usf evidence completion` -> `usf prove completion` ->
   `usf publish work-completion --verify` twice -> `--apply`.

### Registered-command gap register

Three gaps closed at this boundary and are struck through below. The rest are
carried forward. Each remaining gap has a real owner and must be registered as
the smallest deterministic `usf` command or projection with stable arguments,
JSON result, help, effects and refusal classes. None may be smuggled into an
unrelated write set.

| Gap | State | Owner | Required registered behaviour |
|---|---|---|---|
| ~~Production closure satisfiability~~ | **closed** — `usf status ... .closureSatisfiability` | `operator-observability` | Implemented in `src/commands/status.ts`; planted-defect table and live filesystem cross-check in `tests/integration/observability-cli.test.ts`. |
| ~~Publication policy coverage~~ | **closed** — `usf status ... .publicationPolicyCoverage` | `operator-observability` | As above. Note the owner is `operator-observability`, not `provider-census` as previously proposed: `usf status` already binds `--profile`/`--manifest`, so the projections needed no new CLI option and no cross-packet write to `src/commands/help.ts`. |
| ~~Policy-widening blast radius~~ | **closed** — `usf status ... .policyBlastRadius` | `operator-observability` | As above. Derived from scoped closure membership, not `eligibleWork`. |
| Carrier truth | **partly closed** — `usf status ... .carrier` | `operator-observability` (`src/commands/status.ts`) | Local worktree kind, detached HEAD, branch, origin presence, semantic digest and upstream distance from already-fetched local refs are now projected. Still open: comparing two named checkouts, and an explicitly requested single named remote ref. Both need an option, so both need the `help.ts` surface and a decision about `RegisteredCliCommand` authority. |
| Checkpoint qualification | **open** — still a hand-built shell script, rebuilt from scratch again this session and run three times | `operator-observability` | One command taking an exact commit and performing the standalone empty-`.usf` qualification, emitting test totals, containment result, reproduced semantic digest and unchanged commit/tree/status. The exact procedure is recorded below so at least the rediscovery cost is gone. |
| Obligation identity | **open** | `operator-observability` (`usf work`/`usf query`) | Project each selected work's exact construction and completion obligation and evidence-requirement IRIs at every stage. These are currently readable from `realisationAuthority.constructionProofObligation` and `.completionProofObligation` on the work packet, which is enough in practice; the remaining gap is that they vanish from reason codes once authority exists and are not projected by `usf query`. Composing the IRI from the work IRI refuses `CONSTRUCTION_OBLIGATION_MISMATCH`. |
| Batch incompatibility detail | **open** | existing `usf publish` | Name the incompatible member and the compared identity in the `WORK_COMPLETION_CANDIDATE_READBACK_INVALID` refusal so cohort formation does not need bisection. |
| Ignored-state readiness | **open** | `provider-census` (`src/commands/doctor.ts`) | Expose every recurring ignored operational root the active chain uses, with required owner, type and mode, so a `.usf/inputs` drift to 775 is a named doctor finding rather than a `DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED` in an unrelated contract test. Observed and repaired with `usf init` this session. |
| Graph-registered command authority for the new projections | **new, open** | unassigned | The four new `usf status` projections are implemented and tested but are not represented as versioned graph `RegisteredCliCommand` resources, because `graph/provider-pipeline.nq` and `graph/profile-authority.nq` are not any work's `writePath` and are written only by the publication commands. Decide which packet owns registering command authority for projections added to an existing command, rather than leaving TypeScript and help text as the only contract. |

### The standalone empty-`.usf` qualification procedure

Until it is a registered command, this is the exact procedure. It contacts no
remote and uses only local objects.

```sh
PRIMARY=/home/user/src/usf-v3
OUT=$(mktemp -d /home/user/src/usf-v3-q-XXXXXX) && rm -rf "$OUT"
git clone --no-hardlinks --quiet "file://$PRIMARY" "$OUT"
cd "$OUT" && git checkout --quiet --detach <COMMIT>
./scripts/bootstrap.sh                       # creates the empty .usf layout
cp -a "$PRIMARY/node_modules" "$OUT/node_modules"
cp -a "$PRIMARY/.usf/cache/pnpm-virtual-store" "$OUT/.usf/cache/pnpm-virtual-store"
cp -a "$PRIMARY/.usf/cache/pnpm-store"        "$OUT/.usf/cache/pnpm-store"
cp -a "$PRIMARY/.usf/cache/pnpm-store-deps"   "$OUT/.usf/cache/pnpm-store-deps"
cp -a "$PRIMARY/.usf/cache/bootstrap-carrier-packages" "$OUT/.usf/cache/bootstrap-carrier-packages"
chmod 700 "$OUT/.usf/cache"                  # a group-writable cache correctly
                                             # refuses CHECK_CONFINEMENT_UNAVAILABLE
mkdir -p /tmp/usf-authoritative /tmp/usf-corepack
TMPDIR=/tmp/usf-authoritative COREPACK_HOME=/tmp/usf-corepack node --run check
TMPDIR=/tmp/usf-authoritative ./scripts/verify-contained.sh
git rev-parse HEAD && git rev-parse HEAD^{tree} && git status --porcelain
./bin/usf status --profile <PROFILE> --manifest <MANIFEST>   # reproduce the digest
```

### Next safe order

1. implement `provider-account-tier-receipt`'s missing write-set paths through
   the registered `usf call`/`resolve`/`apply` chain under its current
   construction authority, check, integrate, rederive authority at the
   postimage and only then complete it. Before minting completion, require
   `usf status ... | .closureSatisfiability.status == "satisfiable"` and no
   `blockedWorks`; that projection now exists precisely so this packet cannot
   repeat its previous failure;
2. close the remaining carrier-truth and checkpoint-qualification gaps, and
   decide the graph `RegisteredCliCommand` ownership question; and
3. only then advance `provider-invocation-boundary`, adapter preflight,
   qualification and parallel execution toward live multi-provider work.

Verified evidence at this boundary: a standalone empty-`.usf` clone at
`d0904023baaf2d4143cdd71873dc50dca67c585f` passes **213/213** with containment
`pass`, an unchanged commit, tree and clean status, and reproduces semantic
digest `sha256:acd0321377ddc75c4af1f879a0736907e1fd56e1efd22ee900db8d104241101a`
plus every new projection from tracked files alone. The gate moved 209 -> 210
-> 213 across this session: one test added by the hidden-holdout contribution
and three by the diagnostics. A byte-changing contribution that adds coverage
must move the count.

Provider contact remains disabled and no live demonstration exists.
`usf probe availability` still fails closed before contact, both configured
routes remain `UNQUALIFIED`, `usf route` still cannot derive an assignment and
`usf providers receipt acquire` is still proofblocked, because no trusted
account-tier receipt exists. No receipt v2 runtime, list runtime, account
observation, provider entitlement, model qualification, adapter load, live
parallel run, semantic-token reduction, ANQR realisation, staging, production,
BAU or terminal proof is claimed. The completed hidden-holdout evaluator is
deterministic-fixture capability only; it has never scored a provider answer.
The `local` route used by both contributions is the in-repository
`DeterministicFakeProvider`; it is a no-contact composition boundary, not a
provider.

## Prior boundary — five packets complete; first real byte-delta contribution

This section supersedes every older `Current`, `Live continuation` and `Next`
heading retained below as chronological evidence; do not operationalize those
older boundaries unless this section explicitly restates them.

Prepared 2026-09-01 from carrier `413c43ce0365b3fad79be6f89c8438c42d2d25f9`,
qualified in an isolated standalone empty-`.usf` clone. Read current Git and
remote state rather than treating that identifier as the new carrier. No
provider or inference endpoint was contacted, no credential value was read,
copied or digested, and no adapter was loaded.

`urn:usf:work:provider-hidden-holdout` is now `verified-complete` and is the
**first packet completed through a genuine byte delta** rather than a
no-change completion of bytes that were already in the carrier.
`repository-path-scope`, `file-asset-index`, `operator-observability` and
`provider-census` remain `verified-complete` and were not staled at any step.
`provider-account-tier-receipt` remains `construction-ready` and must still not
be completed as no-change.

Current semantic digest
`sha256:5aeb3032b7aaf69a21548195ba6341f94782702c9d44e5e27dc7c34e40f60070`,
reproduced exactly by registered read-back inside the standalone empty-`.usf`
clone from tracked files alone.

### The executed contribution chain

Every step used a registered interface; no authority state, manifest, receipt
or graph outcome was hand-edited. The three write-set paths came from the
preserved uncommitted drafts, byte-for-byte:

| Path | Preimage | Postimage |
|---|---|---|
| `schemas/hidden-evaluation-receipt.schema.json` | absent | `sha256:ba3033e2…` (new, 73 lines) |
| `src/providers/qualification.ts` | `sha256:715173b8…` | `sha256:7ace7d8c…` |
| `tests/unit/providers/qualification.test.ts` | `sha256:da4c3c6e…` | `sha256:72b7b3af…` |

1. **Restore preimage first.** The three owned paths were restored to their
   exact carrier preimage before any evidence derivation, and the desired
   postimage bytes were placed only in the immutable contribution. The other
   six preserved drafts were left untouched.
2. `usf evidence construction` -> `usf prove construction` (outcome `pass`) ->
   `usf publish construction-authority --verify` twice with an identical
   projection -> `--apply`. Semantic digest
   `sha256:d14cdff1…` -> `sha256:69aacd43…`, a 32-quad pure append.
3. `usf call --input .usf/inputs/hidden-holdout-call.json` returned a complete
   `ok` batch envelope (requested 1, succeeded 1, failed 0, empty failures,
   envelope basis equal to the contribution basis) using the local zero-cost
   deterministic route. Contribution artifact digest
   `sha256:fb3bc562…`.
4. `usf resolve --input -` accepted the envelope with nothing rejected, and
   `usf apply --input -` materialised candidate
   `sha256:8cd77121…` with a three-path delta (one absent-to-present, two
   modifications).
5. `usf check --candidate … --validation urn:usf:validation:provider-hidden-holdout`
   passed with exit code zero.
6. `usf integrate --dry-run` first refused
   `INTEGRATION_DETACHED_BASIS_MISMATCH`, correctly, because the candidate
   basis contained the uncommitted construction-authority bytes. Closing that
   coherent carrier checkpoint (commit `9add237`) and retrying the same
   content-addressed candidate and check receipt prepared cleanly, and
   ordinary `usf integrate` produced carrier commit `2bf1ab7` with 474
   insertions across the three paths.
7. **Integration correctly staled the grant.** The byte delta moved the
   packet's scoped dependency digest, so read-back dropped the packet to
   `blocked` with `COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT`. This is the
   copy-on-write rule working, not a defect. Construction authority was
   rederived at the postimage basis and published:
   `sha256:69aacd43…` -> `sha256:a82d559e…`.
8. `usf realise no-change` -> `usf check` (pass) -> `usf evidence completion` ->
   `usf prove completion` (`verified-no-change`) ->
   `usf publish work-completion --verify` twice, then `--apply`:
   `sha256:a82d559e…` -> `sha256:5aeb3032…`.

Both graph appends were verified pure: 32 and then 79 inserted quads with zero
removed lines. New tracked receipts are
`evidence/construction-authority/614a45d153230789e69255d14c69d1b27edcf7c7e84e70653ca91bc24ee7ce8b.json`,
`evidence/construction-authority/04272831e8dbb4475061531468dd745dc5738eda318e9bb34c04242117939f0f.json`
and
`evidence/work-completion/c2ac6e43472eca380f3ad23f6feae55e0eb884557cd9a9d1ce76b46086b52de4.json`.

### Decision-changing lesson: a byte delta costs two construction grants

A no-change completion needs one construction-authority publication. A real
byte-delta contribution needs **two**, because integration necessarily moves
the packet's scoped dependency digest and therefore stales the grant that
authorized the contribution. Plan the digest moves accordingly; do not read the
post-integration `blocked` state as a failure or attempt to repair the first
grant.

### Decision-changing lesson: the holdout permission ceiling is `check`

`urn:usf:permission:provider-hidden-holdout` declares `maximumThrough "check"`
while every other current pipeline permission declares `"integrate"`. This did
**not** block the contribution: `usf integrate` prepared and advanced normally,
and no-change completion needs only realise/check/evidence/prove/publish. The
ceiling is therefore not currently an integration gate for this packet. Record
it rather than treating a future integration refusal as a new discovery.

### Repaired: `.usf/inputs` mode drift broke the exact-carrier leaf fixture

`tests/contract/operator-provider-leaf.test.ts` failed in the dirty primary
with `DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED` (exit 5) because `.usf/inputs`
had drifted to mode 775; the leaf dispatcher requires exactly 0700. `usf init`
restored it and the test passed. This is disposable ignored local state, so a
standalone clone never reproduced the failure. If an exact-carrier leaf fixture
refuses on containment, check `.usf` directory modes before suspecting source.

### Gate movement is real, not a regression

The authoritative empty-`.usf` standalone gate is now **210/210**, not 209/209.
The contribution genuinely added one test, `hidden evaluation exposes one
prompt at a time, never graders, and defaults every unmatched answer to
unqualified`. A byte-changing contribution that adds coverage must move the
count; treat an unchanged count after such a contribution as suspicious.

Note that the primary checkout still carries the six remaining preserved
drafts, so a local `node --run check` there reports 212 tests (210 plus two
from the untracked `tests/integration/provider-invocation.test.ts` draft owned
by `provider-invocation-boundary`). Only the standalone clone number is
authoritative.

### Still open: account-tier requires real implementation

Unchanged and reconfirmed. `provider-account-tier-receipt` must not be
completed as a no-change candidate:
`urn:usf:requirement:provider-receipt-production-runtime-closure` declares a
20-member `ProductionLeafRuntimeClosure` whose members
`src/providers/account-sources.ts`, `src/providers/disposition.ts` and
`src/providers/host-source-identities.ts` do not exist. Its confined validation
cannot observe this; only the outer registered `usf providers receipt acquire`
boundary does, by turning exit 1 `PROVIDERS_RECEIPT_PROOFBLOCKED` into exit 4
`PROVIDERS_RECEIPT_DEPENDENCY_REFUSED`. Its declared write set is 24 paths, of
which 19 do not yet exist: 16 new JSON schemas plus the three modules above.
Resolve the exact write set from the graph rather than from that count.

### Remaining preserved drafts

Six deliberately preserved uncommitted drafts remain in the primary checkout
and exist in no commit. Four are exactly the missing write-set members of
`urn:usf:work:provider-invocation-boundary`, which is not yet
dependency-ready: `schemas/adapter-preflight-receipt.schema.json`,
`schemas/provider-answer-observation.schema.json`,
`schemas/run-authorization.schema.json` and
`tests/integration/provider-invocation.test.ts`. The other two, `README.md` and
`src/providers/probe.ts`, are unreviewed and belong to no currently actionable
packet. Do not delete them and do not treat their presence as evidence.

### Publication-policy coverage over the selected closure

Cross-tabulated at this boundary over the transitive manifest closure
(`foundation`, `usf-bootstrap`, `semantic-first`, `profile-authority`,
`provider-pipeline`). Every selected work has exactly one construction-authority
and one completion policy, so no work currently carries the
`CONSTRUCTION_WORK_NOT_ELIGIBLE` or `CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS`
defect:

| Policy pair | `eligibleWork` |
|---|---|
| `provider-pipeline-*:1` | `repository-path-scope`, `operator-observability`, `provider-census`, `provider-account-tier-receipt` |
| `provider-pipeline-*:2` | `provider-hidden-holdout`, `provider-invocation-boundary`, `provider-semantic-qualification-v2`, `provider-parallel-execution` |
| `provider-pipeline-*:3` | `file-asset-index` |

### Registered-command gap register

Carried forward. The authority chain is fully served by registered commands;
the navigation around it is not, and each session still pays the rediscovery
cost. Two gaps were paid again tonight: the standalone qualification was
rebuilt by hand as a shell script, and the publication-policy cross-tabulation
above was recomputed by an ad hoc manifest walk. Each gap has a real owner and
must be registered as the smallest deterministic `usf` command or projection
with stable arguments, JSON result, help, effects and refusal classes. None may
be smuggled into an unrelated write set.

| Gap | Rederived by hand as | Owner | Required registered behaviour |
|---|---|---|---|
| Carrier truth | raw `git log`/`rev-parse`/`worktree list`/`ls-remote` across primary, clones and remote | `operator-observability` (`src/commands/status.ts`) | Bounded projection comparing local `HEAD`, tree, tracked cleanliness, current semantic digest and, only on explicit request, one named remote ref. Must distinguish "primary is behind a local clone" from "primary is behind the remote" and refuse rather than guess. |
| Checkpoint qualification | `git clone --no-hardlinks`, detach, `scripts/bootstrap.sh`, copy `node_modules` plus the `0700` `.usf/cache` virtual store, `node --run check`, containment, read-back — rebuilt from scratch again tonight and run twice | `operator-observability` | One command taking an exact commit and performing the standalone empty-`.usf` qualification, emitting test totals, containment result, reproduced semantic digest and unchanged commit/tree/status. |
| Obligation identity | `grep 'urn:usf:proof:<work>' graph/*.nq` | `operator-observability` (`usf work`/`usf query`) | Project each selected work's exact construction and completion obligation and evidence-requirement IRIs at every stage, not only inside `CONSTRUCTION_*_MISSING` reason codes that vanish once authority exists. Composing the IRI from the work IRI refuses `CONSTRUCTION_OBLIGATION_MISMATCH`. |
| Publication policy coverage | manual transitive manifest resolution, then `grep eligibleWork`, then cross-tabulation — paid again tonight | `provider-census` (`src/commands/doctor.ts`) | Assert over the exact selected closure that every selected work has exactly one construction-authority and one completion policy, and that each policy's publication algorithm carries the reciprocal `publicationPolicy` edge. Report zero as `CONSTRUCTION_WORK_NOT_ELIGIBLE` risk, more than one as `CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS` risk and a broken pair as `CONSTRUCTION_AUTHORITY_PUBLICATION_CHAIN_INVALID` risk, before evidence derivation. |
| Production closure satisfiability | manual enumeration of `runtimePath` members against the filesystem after a failing gate | `provider-census` (`src/commands/doctor.ts`) | Assert for every typed `ProductionLeafRuntimeClosure` that its declared `closureMemberCount` matches its `runtimePath` rows and every member exists as a same-root regular file. Would have caught the three missing account-tier modules before a completion publication. |
| Policy-widening blast radius | trial amendment, read-back, rollback | `provider-census` (`src/commands/doctor.ts`) | Project which current grants a proposed policy change would stale, so widening an existing policy versus adding a disjoint sibling is a read-back decision rather than an experiment. |
| Batch incompatibility detail | trial `--verify` of the cohort | existing `usf publish` | Name the incompatible member and the compared identity in the `WORK_COMPLETION_CANDIDATE_READBACK_INVALID` refusal so cohort formation does not need bisection. |
| Ignored-state readiness | `stat -c '%a'` over `.usf` subdirectories after a confusing containment refusal | `provider-census` (`src/commands/doctor.ts`) | Expose every recurring ignored operational root the active chain uses, with its required owner, type and mode, so a `.usf/inputs` drift to 775 is a named doctor finding rather than a `DYNAMIC_LEAF_FIXTURE_DEPENDENCY_REFUSED` in an unrelated test. |

### Next safe order

1. register the closure-satisfiability, policy-coverage, blast-radius and
   ignored-state assertions through `provider-census`, and the carrier and
   qualification projections through `operator-observability`, each through
   that owner's own construction/integration/completion chain;
2. implement the account-tier packet's 19 missing paths through the registered
   `usf call`/`resolve`/`apply` chain under its current construction authority,
   check, integrate, rederive authority at the postimage and only then complete
   it; and
3. only then advance `provider-invocation-boundary`, adapter preflight,
   qualification and parallel execution toward live multi-provider work.

Verified evidence at this boundary: standalone empty-`.usf` clone at
`413c43ce0365b3fad79be6f89c8438c42d2d25f9` passes 210/210 with containment
`pass`, an unchanged commit, tree and clean status, and reproduces semantic
digest `sha256:5aeb3032…` from tracked files alone.

Provider contact remains disabled and no live demonstration exists.
`usf probe availability` still fails closed before contact and
`usf providers receipt acquire` is still proofblocked, because no trusted
account-tier receipt exists. No receipt v2 runtime, list runtime, account
observation, provider entitlement, model qualification, adapter load, live
parallel run, semantic-token reduction, ANQR realisation, staging, production,
BAU or terminal proof is claimed. The completed hidden-holdout evaluator is
deterministic-fixture capability only; it has never scored a provider answer.

## Prior boundary — four packets complete; file-asset-index policy gap closed

This section supersedes every older `Current`, `Live continuation` and `Next`
heading retained below as chronological evidence; do not operationalize those
older boundaries unless this section explicitly restates them.

Prepared 2026-09-01 from clean pushed carrier
`41e76317c375d2d6ebca972f4cef7426ae78bbee` in an isolated standalone clone.
Read current Git and remote state rather than treating that identifier as the
new carrier. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

`repository-path-scope`, `file-asset-index`, `operator-observability` and
`provider-census` are all `verified-complete` with completion verified and no
reason codes. `provider-account-tier-receipt` holds current construction
authority through `integrate`. Semantic digest movement:

- base `sha256:be453c4fb736396991a817dd722644a4600fa3dee1f1148e3a9ef723faa0cb5e`;
- new disjoint policy pair and reciprocal algorithms ->
  `sha256:6e1f83ceb49c5c97c2588284eddd2db0b650a008e31eee1a65fd1708ce3fda67`;
- file-asset-index construction authority ->
  `sha256:720168f93319af7261b12fca4dc75ada98aea633c990fd7e9585d8cc333cee47`;
- file-asset-index completion ->
  `sha256:d14cdff17d884d9126cdb6678ec135432241a665782171a4ad181afd9a1a5d5c`.

No-change candidate
`sha256:231fa14df146d5724a386cd454878b8f16d4aa8eb9baf7995cabf2c8836289f5`
passed its sole graph-selected `urn:usf:validation:file-asset-index-tests` with
exit code zero. New tracked receipts are
`evidence/construction-authority/6a6fe1a9ca72796ea288c61614de39044714e782d8a3b9006711fcb1bfb4b3ad.json`
and
`evidence/work-completion/836c0a5cd62cc768b1b53977d90a12b42ac16ba4ffc0f353b68142d9f569f79c.json`.

### Resolved: the file-asset-index publication-policy gap

The predecessor boundary recorded that `file-asset-index` was selected,
dependency-ready and permanently non-actionable because no publication policy in
this manifest's import closure enumerated it. Two candidate corrections were
tested empirically rather than assumed, which produced one decision-changing
result worth keeping:

- **adding the work to the existing `provider-pipeline-construction-authority:1`
  and `provider-pipeline-no-change-completion:1` policies staled every current
  grant.** Registered read-back immediately dropped `repository-path-scope`,
  `operator-observability` and `provider-census` from `verified-complete` to
  `blocked`. A publication policy's resource digest is inside the scoped
  dependency closure of every work it makes eligible, so widening a policy
  reproofs its whole cohort. This correction was rolled back.
- **a disjoint sibling policy pair covering only `file-asset-index` preserved
  every grant.** All three completions and the account-tier construction
  authority survived unchanged.

The accepted correction therefore adds
`urn:usf:publication-policy:provider-pipeline-construction-authority:3` and
`urn:usf:publication-policy:provider-pipeline-no-change-completion:3`, each
enumerating only `urn:usf:work:file-asset-index` and otherwise copying the `:1`
policy shape.

A new policy additionally requires its **own** publication algorithm. Reusing
the `:1` algorithms refused exit 4
`CONSTRUCTION_AUTHORITY_PUBLICATION_CHAIN_INVALID`, because
`src/realisation/construction-authority.ts` requires the selected policy's
`publicationAlgorithm` to declare a reciprocal `publicationPolicy` edge back to
that exact policy, and `src/realisation/work-completion.ts` enforces the same
invariant for completion. The correction therefore also defines
`urn:usf:algorithm:provider-pipeline-construction-authority-publication:3` and
`urn:usf:algorithm:provider-pipeline-work-completion-publication:3` with that
reciprocal edge. Policy and publication algorithm are a one-to-one pair; a new
policy is never a policy-only change.

### Still open: account-tier requires real implementation

Unchanged from the predecessor boundary and reconfirmed here.
`provider-account-tier-receipt` must not be completed as a no-change candidate:
`urn:usf:requirement:provider-receipt-production-runtime-closure` declares a
20-member `ProductionLeafRuntimeClosure` whose members
`src/providers/account-sources.ts`, `src/providers/disposition.ts` and
`src/providers/host-source-identities.ts` do not exist. Its confined validation
cannot observe this; only the outer registered
`usf providers receipt acquire` boundary does, by turning exit 1
`PROVIDERS_RECEIPT_PROOFBLOCKED` into exit 4
`PROVIDERS_RECEIPT_DEPENDENCY_REFUSED`. Verified again at this boundary: the
packet is construction-ready and acquire returns exit 1.

Its declared write set is 24 paths, of which 19 do not yet exist: 16 new JSON
schemas plus the three modules above. The packet objective is reusable
no-contact API and subscription-host source verification, the shared
`accountSourceKeyDigest` domain, stable secret-safe host identity, deterministic
source-local retry, explicit copy-on-write manifest/head-set protocols and exact
candidate-local economics/service-tier disposition projection. This is the
single largest remaining item before any provider contact is reachable, and it
is explicitly no-contact work in its own right.

### Available: preserved uncommitted drafts match two packets' write sets exactly

The primary checkout at `/home/user/src/usf-v3` carries nine deliberately
preserved uncommitted drafts that exist in no commit. Five of them are exactly
the missing write-set members of the next two packets, so those packets are
much closer to realisable than a file listing suggests:

- `urn:usf:work:provider-hidden-holdout` has `dependencyReady: true` with
  `dependencyAuthority: no-dependencies` - it is a root - and a three-path write
  set `schemas/hidden-evaluation-receipt.schema.json`,
  `src/providers/qualification.ts` and
  `tests/unit/providers/qualification.test.ts`. **All three exist as preserved
  drafts.** Only the schema is absent from the carrier; the other two are
  modifications. It declares no `ProductionLeafRuntimeClosure`, so it cannot hit
  the account-tier trap, and its sole validation is
  `urn:usf:validation:provider-hidden-holdout`.
- `urn:usf:work:provider-invocation-boundary` is not yet dependency-ready, and
  its four missing write paths `schemas/adapter-preflight-receipt.schema.json`,
  `schemas/provider-answer-observation.schema.json`,
  `schemas/run-authorization.schema.json` and
  `tests/integration/provider-invocation.test.ts` **all exist as preserved
  drafts** too.

These drafts are unreviewed proposals, not authority: they must enter through
the registered `usf call`/`resolve`/`apply` contribution chain under current
construction authority, never by being committed directly, and each must pass
its graph-selected validation. Do not delete them and do not treat their
presence as evidence. `provider-hidden-holdout` is the cheapest next real
implementation candidate.

Note that no provider-driven assignment can be derived yet: `usf route` needs
qualified routes, both configured routes are `UNQUALIFIED`, and qualification is
itself downstream of the account-tier chain. A contribution must therefore be
produced without inventing an ad hoc envelope by hand.

### Registered-command gap register

Carried forward unchanged from the predecessor boundary, with one addition
evidenced tonight. The authority chain is fully served by registered commands;
the navigation around it is not, and each session currently pays the
rediscovery cost.

| Gap | Rederived by hand as | Owner | Required registered behaviour |
|---|---|---|---|
| Carrier truth | raw `git log`/`rev-parse`/`worktree list`/`ls-remote` across primary, clones and remote | `operator-observability` (`src/commands/status.ts`) | Bounded projection comparing local `HEAD`, tree, tracked cleanliness, current semantic digest and, only on explicit request, one named remote ref. Must distinguish "primary is behind a local clone" from "primary is behind the remote" and refuse rather than guess. |
| Checkpoint qualification | `git clone --no-hardlinks`, detach, `scripts/bootstrap.sh`, `node --run check`, containment, read-back — run five times tonight | `operator-observability` | One command taking an exact commit and performing the standalone empty-`.usf` qualification, emitting test totals, containment result, reproduced semantic digest and unchanged commit/tree/status. |
| Obligation identity | `grep 'urn:usf:proof:<work>' graph/*.nq` | `operator-observability` (`usf work`/`usf query`) | Project each selected work's exact construction and completion obligation and evidence-requirement IRIs at every stage, not only inside `CONSTRUCTION_*_MISSING` reason codes that vanish once authority exists. Composing the IRI from the work IRI refuses `CONSTRUCTION_OBLIGATION_MISMATCH`. |
| Publication policy coverage | manual transitive manifest resolution, then `grep eligibleWork`, then cross-tabulation | `provider-census` (`src/commands/doctor.ts`) | Assert over the exact selected closure that every selected work has exactly one construction-authority and one completion policy, and that each policy's publication algorithm carries the reciprocal `publicationPolicy` edge. Report zero as `CONSTRUCTION_WORK_NOT_ELIGIBLE` risk, more than one as `CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS` risk and a broken pair as `CONSTRUCTION_AUTHORITY_PUBLICATION_CHAIN_INVALID` risk, before evidence derivation. |
| Production closure satisfiability | manual enumeration of `runtimePath` members against the filesystem after a failing gate | `provider-census` (`src/commands/doctor.ts`) | Assert for every typed `ProductionLeafRuntimeClosure` that its declared member count matches its `runtimePath` rows and every member exists as a same-root regular file. Would have caught the three missing account-tier modules before a completion publication. |
| Policy-widening blast radius | trial amendment, read-back, rollback | `provider-census` (`src/commands/doctor.ts`) | Project which current grants a proposed policy change would stale, so widening an existing policy versus adding a disjoint sibling is a read-back decision rather than an experiment. |
| Batch incompatibility detail | trial `--verify` of the cohort | existing `usf publish` | Name the incompatible member and the compared identity in the `WORK_COMPLETION_CANDIDATE_READBACK_INVALID` refusal so cohort formation does not need bisection. |

### Next safe order

1. implement the account-tier packet's 19 missing paths through the registered
   `usf call`/`resolve`/`apply` chain under its current construction authority,
   check, integrate and only then complete it;
2. register the closure-satisfiability, policy-coverage and blast-radius
   assertions through `provider-census`, and the carrier, qualification and
   obligation projections through `operator-observability`; and
3. only then advance `provider-invocation-boundary`, adapter preflight,
   qualification and parallel execution toward live multi-provider work.

Verified evidence at this boundary: authoritative typecheck and full suite
209/209 pass, containment pass, `git diff --check` clean, and
`usf providers receipt acquire` correctly exit 1 proofblocked.

Provider contact remains disabled and no live demonstration exists.
`usf start` runs one bounded foreground lifecycle instance that binds the
carrier, semantic digest and per-work scoped dependency digests and stops
cleanly, but its own nonclaims record
`provider-pipeline-remains-unwired-and-fake-only`. No receipt v2 runtime, list
runtime, account observation, provider entitlement, model qualification, adapter
load, live parallel run, semantic-token reduction, ANQR realisation, staging,
production, BAU or terminal proof is claimed.

## Prior boundary — census complete; account-tier proven to need real implementation

This section supersedes every older `Current`, `Live continuation` and `Next`
heading retained below as chronological evidence; do not operationalize those
older boundaries unless this section explicitly restates them.

Prepared 2026-09-01 from clean pushed carrier
`281e47c879fa555f3aa9d64c3f1ab4585f1e33e7` in an isolated standalone clone.
Read current Git and remote state rather than treating that identifier as the
new carrier. No provider or inference endpoint was contacted, no credential
value was read, copied or digested, and no adapter was loaded.

`urn:usf:work:provider-census` is now `verified-complete`; batched construction
authority is current for both `provider-census` and
`provider-account-tier-receipt`. Semantic digest movement:

- base `sha256:218d0b132188d3eca2121de5a0efa11f5e46db8e1daf63b46faa4e86725427dc`;
- batched two-member construction authority ->
  `sha256:47351eb17f93d4b8be2d4f5d6b8e13700c83053183d4cdf6ff9c3edfeba9aef8`;
- provider-census completion ->
  `sha256:be453c4fb736396991a817dd722644a4600fa3dee1f1148e3a9ef723faa0cb5e`.

Census no-change candidate
`sha256:55118a66881bcdafaa230bcdbdec7f8b40d40c2b5f2b35daec48fb4ee7256194`
passed both graph-selected `provider-census` and
`provider-subscription-host-authorization` validations with exit code zero. Two
new tracked receipts:
`evidence/construction-authority/8e00502c1f7ecfdf79f7297e3dab86026240b07e285d02e40a0a19e2add8baf1.json`
(digest `sha256:23bbdad96e75e477567047a07f41280913c2d165226d33f53755d4b1850fd5b9`,
two members) and
`evidence/work-completion/24ae263e68cb5ce1d4c1efffdc7f38565a3e85716b26286a332686ba0ab4051f.json`
(digest `sha256:b2f399812192adb42a9e85092c9a8018d4e02e4651e704912ba8f6209c80c797`).

### Evidenced: account-tier cannot be completed as a no-change candidate

`provider-account-tier-receipt` was taken through the full registered no-change
chain and **rolled back before commit**. Its construction proof, no-change
candidate
`sha256:d5c45ca5565ddec93574d5e15fd39038a43f92fb35ce8b69d6b512d925726449`
and sole graph-selected `urn:usf:validation:provider-account-tier-receipt`
check all passed with exit code zero, and its completion published cleanly to
`sha256:c49c8d4ca147227083c4ce43dde6e2bcbf05f9c3a27da288de36d83b429f29a4`.
The authoritative full gate then failed 208/209.

The single failure is `tests/integration/provider-cli.test.ts:244`:
`usf providers receipt acquire` returned exit 4
`PROVIDERS_RECEIPT_DEPENDENCY_REFUSED` where the registered boundary requires
exit 1 `PROVIDERS_RECEIPT_PROOFBLOCKED`. The cause is exact and reproducible.
`urn:usf:requirement:provider-receipt-production-runtime-closure` declares a
20-member `ProductionLeafRuntimeClosure`, and three declared members do not
exist in the repository:

- `src/providers/account-sources.ts`;
- `src/providers/disposition.ts`; and
- `src/providers/host-source-identities.ts`.

All three are owned by `urn:usf:work:provider-account-tier-receipt`. While the
packet is incomplete, the leaf dispatcher refuses at the proofblock boundary
before closure authentication, so the missing members are never reached.
Publishing completion moves the packet past that boundary, the child then
authenticates the declared closure, and the missing members correctly refuse as
a currentness failure. The confined completion validation cannot observe this
because it does not exercise the production leaf; only the outer registered CLI
boundary does.

The conclusion is that the graph deliberately models receipt v2 ahead of its
implementation, so **a no-change completion of this packet mints authority its
own production path cannot honour**. The packet requires real implementation of
its three owned modules, not a no-change candidate. After rollback,
`usf providers receipt acquire` again returns exit 1
`PROVIDERS_RECEIPT_PROOFBLOCKED` naming
`COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT` and
`WORK_COMPLETION_NO_CHANGE_RECEIPT_MISSING`, and the full gate passes 209/209.
Do not retry a no-change completion for this packet.

### Observed publication batching boundary

Batching works for construction-authority: two independent construction bundles
published as one two-member transition with one receipt, replacing two serial
digest moves, and reproduced the identical resulting digest on a later repeat.
The same two-member batch refused for **work-completion** with exit 4 and
stable `WORK_COMPLETION_CANDIDATE_READBACK_INVALID`, applied nothing and left
the semantic digest unchanged; each bundle then verified and applied
independently. Completion bundles bind candidate workspaces and their
work-scoped manifest digests, so independent construction bundles batch while
independent completion bundles generally do not. Use `--verify` on the intended
cohort as the pre-check; a refused batch never justifies weakening currentness.

### Registered-command gap register

The authority chain itself is fully served by registered commands and needed no
ad hoc tooling. The **navigation around** that chain still depends on operator
knowledge rederived each session, which is a reproducibility bottleneck. Each
gap below has a real owner and must be registered as the smallest deterministic
`usf` command with stable arguments, JSON result, help, effects and refusal
classes. None may be smuggled into an unrelated write set.

| Gap | Rederived by hand as | Owner | Required registered behaviour |
|---|---|---|---|
| Carrier truth | raw `git log`/`rev-parse`/`worktree list`/`ls-remote` across primary, clones and remote | `operator-observability` (`src/commands/status.ts`) | Bounded projection comparing local `HEAD`, tree, tracked cleanliness, current semantic digest and, only on explicit request, one named remote ref. Must distinguish "primary is behind a local clone" from "primary is behind the remote" and refuse rather than guess. |
| Checkpoint qualification | `git clone --no-hardlinks`, detach, `scripts/bootstrap.sh`, `node --run check`, containment, read-back — run four times tonight | `operator-observability` | One command taking an exact commit and performing the standalone empty-`.usf` qualification, emitting test totals, containment result, reproduced semantic digest and unchanged commit/tree/status. The skill already flags this for registration once BAU; it now is. |
| Obligation identity | `grep 'urn:usf:proof:<work>' graph/*.nq` | `operator-observability` (`usf work`/`usf query`) | Project each selected work's exact construction and completion obligation and evidence-requirement IRIs at every stage, not only inside `CONSTRUCTION_*_MISSING` reason codes that vanish once authority exists. Composing the IRI from the work IRI refuses `CONSTRUCTION_OBLIGATION_MISMATCH`. |
| Publication policy coverage | manual transitive resolution of manifest `imports`/`sources`, then `grep eligibleWork`, then cross-tabulation | `provider-census` (`src/commands/doctor.ts`) | Assert over the exact selected closure that every selected work has exactly one construction-authority and one completion policy; report zero as `CONSTRUCTION_WORK_NOT_ELIGIBLE` risk and more than one as `CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS` risk before evidence derivation is attempted. This invariant would have caught `file-asset-index` deterministically. |
| Production closure satisfiability | manual enumeration of `runtimePath` members against the filesystem after a failing gate | `provider-census` (`src/commands/doctor.ts`) | Assert for every typed `ProductionLeafRuntimeClosure` that its declared member count matches its `runtimePath` rows and that every member exists as a same-root regular file. This invariant would have caught the three missing account-tier modules **before** a completion publication rather than through a failing outer test. |
| Batch incompatibility detail | trial `--verify` of the cohort | existing `usf publish` | Name the incompatible member and the compared identity in the `WORK_COMPLETION_CANDIDATE_READBACK_INVALID` refusal so cohort formation does not need bisection. |

### Next safe order

1. implement the three account-tier modules through the registered
   `usf call`/`resolve`/`apply` chain under its current construction authority,
   then check, integrate and only then complete the packet;
2. register the closure-satisfiability and policy-coverage assertions through
   `provider-census`, and the carrier/qualification/obligation projections
   through `operator-observability`;
3. correct the `file-asset-index` publication-policy gap with a disjoint sibling
   policy pair, then run its registered chain; and
4. only then advance `provider-invocation-boundary`, adapter preflight,
   qualification and parallel execution toward live multi-provider work.

Verified evidence at this boundary: authoritative typecheck and full suite
209/209 pass, containment pass, `git diff --check` clean.

Provider contact remains disabled. `usf probe availability` fails closed before
contact and `usf providers receipt acquire` is proofblocked, because no trusted
account-tier receipt exists. No receipt v2 runtime, list runtime, account
observation, provider entitlement, model qualification, adapter load, live
parallel run, semantic-token reduction, ANQR realisation, staging, production,
BAU or terminal proof is claimed.

## Prior boundary — root authority restored; file-asset-index policy gap evidenced

This section supersedes every older `Current`, `Live continuation` and `Next`
heading retained below as chronological evidence; do not operationalize those
older boundaries unless this section explicitly restates them.

Prepared 2026-09-01 from clean pushed carrier
`fe04a6b46f0154983f573594aabc7bc340a5c884` in an isolated standalone clone.
Read current Git and remote state rather than treating that identifier as the
new carrier. The predecessor packet's step 1 is now executed for both roots
through the registered chain only: `usf work` -> `usf evidence construction` ->
`usf prove construction` -> `usf publish construction-authority --verify|--apply`
-> `usf realise no-change` -> `usf check` -> `usf evidence completion` ->
`usf prove completion` -> `usf publish work-completion --verify|--apply`. No ad
hoc work, realisation or publication command was used. No provider or inference
endpoint was contacted and no credential content was read, copied or digested.

Registered profile-bound read-back at exact profile `urn:usf:profile:v3-self-host:3`
and manifest `graph/manifests/self-host-provider-v3.json` moved the semantic
digest as follows, each step verified before it was applied:

- base `sha256:c8fd0765b63b726cb6bca6f6308a716954dcb995a4e4ab6db30d66274a4ffe81`;
- repository-path construction ->
  `sha256:bdf552bf70399dd3737570abf84b6470d71f45036d8931f55dd2f92a22da03db`;
- repository-path completion ->
  `sha256:070fb2673c39d3e1731a2f58e8add9b4172f72670bfc2ba4b8f5d5ff51e53eec`;
- operator construction ->
  `sha256:c028385832eaddb273e93a4b90ec42ee3ef443938dc1489d5bc086ffec92055e`;
- operator completion ->
  `sha256:218d0b132188d3eca2121de5a0efa11f5e46db8e1daf63b46faa4e86725427dc`.

`urn:usf:work:repository-path-scope` bound construction evidence
`sha256:3712fce6bb0e51f092e738c7235bb6ae30a9b2e1fefb5dad9e5c65a3d7356887`,
passing proof `sha256:68fe6def2a5f4e810e58da9f42e81c503606a663e3c081e9a149267f62d9abbe`
and bundle `sha256:25cb3ce226aec61c89b40a6fcf50ba8e83ae3ac8dca4575a479b8937a1021384`.
Its post-publication basis is
`sha256:838ac4a89804906731f66b8280f1a36d6fab5606f1fa632c0082c1d2630fee54`
with scoped dependency digest
`sha256:bd276177b79584f5a0d82181762f97792bffd2d61cfe4a64ebfd67e7f6f94993`;
the pre-publication basis `sha256:d8012809...` was not reused. Positive
no-change candidate
`sha256:698c065f58d77a74dc578f5c8a22af838ea61bbb7a51a6aeffc9ae8175ccce31`
passed its sole graph-selected `urn:usf:validation:repository-path-tests` with
exit code zero. Completion evidence is
`sha256:6399ecba977ad178d475a81f44b972a7cc906461427ab952bc70bd8b0086fdbe`
and passing completion proof is
`sha256:c51a0aa434d79f8b7431f2d6c69ad7b54a612c4af1bbc48a33c3783c2dac6489`.

`urn:usf:work:operator-observability` bound construction evidence
`sha256:0234252a9ac172f3d33bcaa5449632d1826bef6b3d81224e87233fc964112eb3`
and bundle
`sha256:ebc49f825a43027be5883052d074275814269942c959f570de598dda0608520b`.
Positive no-change candidate
`sha256:80c6bcd71a7b14a7cf81bd9d311dd94894036278f9d1cc1a277662cc7eacf9aa`
passed all three graph-selected validations sequentially with exit code zero:
`operator-composable-input-tests`, `operator-observability-tests` and
`operator-provider-leaf-boundary`. Completion evidence is
`sha256:f4bb2cb0d963feac6c92d5a1baf8a9175ef714855355cf9e9559ab41e53057a7`
and passing completion proof bundle is
`sha256:afd5869564e3a7cf17ed7339ce4242da8b8dbdcb13e62d5d085120c0a905d12e`.

The coherent carrier delta is the additive graph projection, this handover and
four new tracked receipts:

- `evidence/construction-authority/3bf626e073859543bc34ae712c7a6ad8a2e6549aec5f810e84a3470010617ca6.json`,
  receipt digest
  `sha256:435aca3b6ab0028f9a885420cfbaa86c9e0750a584d8eb6c59f5e1050ae42388`;
- `evidence/work-completion/f1e54d418993fe2f9d5b8ea34963f7173c27861f670314104b944ca06cbfabf3.json`,
  receipt digest
  `sha256:1b1ee28ba65ceb67003f7c21fd759adcdc6b3de59823abdbb7c9ec1aa16257f3`;
- `evidence/construction-authority/b53b359c38f0eb79fb7ce7c49603b09df07d91974a0ce5a0f45f2dd313fd74c7.json`,
  receipt digest
  `sha256:0857fced5233aaae7ea5d465cc87efc943d3a6ccf2a01638745b87145dc4767e`; and
- `evidence/work-completion/67128ca0e5cef73b035f52820c0ea4627be07ec4cb5a1fc0f62149d9298f6722.json`.

The changed graph file is
`sha256:18e2b0991d509591266cf7958e15119414808ab2f2834e4866169f1d44478125`
and adds 160 quads: four copy-on-write grant/evidence/proof-result/receipt
member sets and no new work, contract, permission, policy or command.

Registered read-back now reports `repository-path-scope` and
`operator-observability` as `verified-complete`, completion verified, with no
reason codes. Both `--ready --stage construct` and `--ready --stage integrate`
return empty selected sets. Verified evidence at this boundary is the
authoritative typecheck and full suite 209/209 pass, containment pass and
`git diff --check` clean, executed from a clean standalone clone of the exact
carrier.

### Newly evidenced blocker — file-asset-index has no publication policy

The predecessor packet's step 1 also stated that `file-asset-index` may proceed
through its recorded no-change chain once repository-path is current. That is
now disproven for this profile. `usf work` correctly reports the packet
`dependencyReady: true` with `dependencyAuthority: verified-completion`, but
registered `usf evidence construction --work urn:usf:work:file-asset-index`
refuses with exit 4 and stable reason code `CONSTRUCTION_WORK_NOT_ELIGIBLE`.

The refusal is exact and is not an initialization, currentness or retry
condition. `deriveConstructionAuthority` in
`src/realisation/construction-authority.ts` selects the single publication
policy whose `eligibleWork` contains the packet and refuses when none exists.
Within the exact import closure of `graph/manifests/self-host-provider-v3.json`
- `graph/foundation.nq`, `graph/usf-bootstrap.nq`, `graph/semantic-first.nq`,
`graph/profile-authority.nq` and `graph/provider-pipeline.nq` -
`urn:usf:work:file-asset-index` is the only selected work with zero
construction-authority policies and zero completion policies. The eight
siblings each have exactly one of each, through
`urn:usf:publication-policy:provider-pipeline-construction-authority:1` or `:2`
and their matching `provider-pipeline-no-change-completion` policies.

The policies that do enumerate `file-asset-index`,
`urn:usf:publication-policy:construction-authority:1` and
`urn:usf:publication-policy:no-change-work-completion:1`, are defined only in
`graph/integration.nq`, which this manifest does not import. Importing that
source is not the correction: it would also enumerate `repository-path-scope`
and make its policy selection ambiguous
(`CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS`).

The smallest reviewable correction is therefore a new sibling policy pair in
`graph/provider-pipeline.nq` covering only `file-asset-index`, following the
existing `:1`/`:2` partition. Adding the work to the existing `:1` policies
would change their digests and stale the repository-path and operator grants
and completions published in this packet, forcing an immediate full reproof;
a new disjoint policy pair should not. That assumption must be verified by
read-back after the amendment rather than assumed. Until this is corrected,
`file-asset-index` is selected, dependency-ready and permanently
non-actionable under this profile.

The next safe order is:

1. amend `graph/provider-pipeline.nq` with the disjoint `file-asset-index`
   construction and no-change-completion publication policy pair as one
   reviewable slice, read back that repository-path and operator remain
   `verified-complete`, then run the registered chain for `file-asset-index`;
2. use the registered account-tier work packet to realise and check one exact
   isolated receipt-v2 activation/acquire/verify/reduce, sole-writer reducer,
   read-only list, closed-schema and bounded-test candidate, without provider
   contact or static help changes;
3. bind the predecessor-owned complete static dispatch/help candidate to that
   exact checked digest, validate and complete operator, then rederive
   account-tier against the final operator predecessor, rematerialise the same
   feature bytes, recheck, integrate and complete it; and
4. only then derive an activation, acquire trusted account observations and
   continue through content-verified adapters, authenticated provider answers,
   genuine hidden holdout, live multi-provider parallelism and comparable
   semantic-token measurement.

This boundary proves restored local construction and no-change completion
authority for two root packets only. It proves no receipt v2 runtime, list
runtime, account observation, provider entitlement, model qualification, live
parallel run, semantic-token reduction, ANQR realisation, staging, production,
BAU or terminal proof.

## Prior boundary — primary-owned receipt semantics

This section supersedes every older `Current`, `Live continuation` and `Next`
heading retained below as chronological evidence; do not operationalize those
older boundaries unless this section explicitly restates them.

Prepared 2026-09-01 from clean pushed carrier
`9f15fe407b4bcaf72568890c37eefbd31c5c5b1c` in the isolated final clone. Read
current Git and remote state rather than treating the preparation commit as the
new carrier identity. This coherent packet changes the provider graph, prunes
one stale topology assertion that required a deleted secondary contract, and
updates this handover. It changes no provider runtime, schema or help source.
No provider or inference endpoint was contacted and no credential content was
read, copied or digested.

The final composed provider manifest is
`graph/manifests/self-host-provider-v3.json`, profile
`urn:usf:profile:v3-self-host:3`, semantic digest
`sha256:c8fd0765b63b726cb6bca6f6308a716954dcb995a4e4ab6db30d66274a4ffe81`.
The changed graph file is
`sha256:3f0baf8fbe72af8c51b941fb968ec368fbfdbd5ae822a692426cd12918396472`.
Profile-bound `usf query` and `usf work` read-back establish the following
current boundary:

- the profile no longer selects
  `urn:usf:contract:provider-account-receipt-acquisition:1`; that secondary
  contract and its permission, evidence, proof, validation and reciprocal work
  ownership have been removed;
- acquisition is now the non-authoritative owner-attached protocol
  `urn:usf:provider-operation:account-receipt-acquisition:1`, owned only by
  `urn:usf:work:provider-account-tier-receipt` and its primary contract;
- `providers receipt activate` is only
  `urn:usf:command-mode:providers-receipt-activate:2` beneath receipt v2. It
  derives one ignored content-addressed call-admission record from the exact
  current primary construction grant and verified completion. It creates no
  second work, contract, permission, policy, proof lane or command leaf;
- acquire, verify and reduce each require that exact admission at
  `.usf/provider-operations/activations/provider-account-tier-receipt/`, while
  list requires no acquisition activation and remains a read-only projection;
- API verify requires explicit current env-file, stored authorization and
  source-owned observation-chain inputs and rederives their account/source and
  credential identity. Ambient credentials and stored identity alone are not
  authority. Host verify separately requires provider home, exact host census
  and host-source identity;
- all provider-home language now reuses the completed
  `exactOwnerControlledDirectory` rule, including lexical/realpath equality,
  invoking uid/gid ownership, owner-rwx, no world-write/special bits/symlink,
  nlink bound, exclusive-current-primary-group proof for group-write, fixed
  auth-file rules and drift rechecks; and
- `urn:usf:command:providers-receipt-list:1` remains a `CliCommandTarget` with
  availability `target`, implementation state `proofblocked` and refusal
  `PROVIDERS_RECEIPT_LIST_PROOFBLOCKED`. It authenticates the selected complete
  256-bucket root, exact case-sensitive provider/model filters, every candidate
  member digest, a projection/filter/root-bound unpadded base64url cursor and
  only the selected page records. The current 7,478 candidate-keyed catalogue
  denominator produces both binding and disposition records and cannot be
  returned within the four-MiB child output ceiling as one result; the graph
  binds the pagination rationale without hard-coding a row count that could
  survive catalogue movement incorrectly.

`urn:usf:rule:provider-receipt-target-registration:1` keeps registration
truthful through one bounded non-recurring seam rather than a BAU bottleneck.
The executable and help surface remains the registered v1 acquire/verify
interface; `usf help providers receipt list` returns `HELP_TOPIC_UNKNOWN`.
Receipt v2/list stays graph-only until the account-tier owner has one exact
isolated handler/schema/mode/test candidate that passes its selected checks.
Only then may the predecessor operator owner register the complete reserved
v2/list dispatch and registered-but-proofblocked help after authenticating that
preliminary candidate and binding the SHA-256 of its canonical ordered feature
operations plus the canonical path-ordered resulting feature mode/content
digest set. Account-tier is subsequently rederived and completed against the
final operator predecessor. Its final candidate digest is expected to differ
because candidate identity includes that changed basis; exact equality is
instead required for both basis-independent feature digests before integration.
Neither owner crosses the other's write set, the registration update never
follows final account-tier completion, and no intermediate Git checkpoint is
authority. A partial registry, mixed v1/v2 surface, preliminary-candidate
substitution before operator publication or unequal rederived feature bytes
refuses. The `usf-v3-operator` skill remains advisory and was not changed before
runtime/help stability; no plugin is needed for this packet.

The operator reservation now carries that registration rule as an explicit
semantic dependency. Its `verified-complete` leaf stage applies only to
production runtime invocation; the one static registration candidate is
explicitly `checked-awaiting-integration`. The same rule is therefore bound by
both owner packets without making either work depend on the other except for
the already declared account-tier predecessor edge.

The current v1 `src/commands/provider-receipts.ts` preimage still contains one
dormant lookup of the deleted secondary contract for its old privacy digest.
Current primary proofblocking refuses before that lookup; it is not graph
authority or an operational v2 implementation. Do not reactivate or preserve
the alias. The first checked account-tier candidate must replace it with the
primary-owner privacy projection. The operator registry then atomically
supersedes the v1 option shape and leaves every v2/list path proofblocked until
the same content-bound feature bytes are rederived and completed, so no
intermediate path invokes the legacy lookup. This semantic packet deliberately
does not edit that source before a fresh primary construction grant.

The only test change deletes the obsolete assertion that the removed secondary
contract registers receipt v1. It adds no fixture, provider/model matrix or
temporary test. Verified evidence at this boundary is:

- authoritative typecheck and full suite: 209/209 pass;
- exact provider/product suite: 76/76 pass;
- bootstrap/carrier/schema lane: 13/13 pass;
- profile-scoped authority: 1/1 pass;
- focused provider topology test: 11/11 pass;
- containment: pass; and
- `git diff --check`: pass.

Because semantic source moved, historical construction/completion receipts are
not reused. Current `usf work` read-back shows repository-path and operator as
dependency roots with no current construction authority, file-asset-index
dependency-blocked on repository-path, and account-tier dependency/proofblocked
on repository-path and operator. No receipt v2 runtime, list runtime, account
observation, provider entitlement, model qualification, live parallel run,
semantic-token reduction, ANQR realisation, staging, production, BAU or terminal
proof is claimed.

After authenticating this packet as a clean pushed carrier, the next safe order
is:

1. restore repository-path and operator authority through their registered
   construction/completion chains; file-asset-index may proceed through its
   already recorded isolated no-change chain once repository-path is current;
2. use the registered account-tier work packet to realise and check one exact
   isolated receipt-v2 activation/acquire/verify/reduce, sole-writer reducer,
   read-only list, closed-schema and bounded-test candidate, without provider
   contact or static help changes;
3. bind the predecessor-owned complete static dispatch/help candidate to that
   exact checked digest, validate and complete operator, then rederive
   account-tier against the final operator predecessor, rematerialise the same
   feature bytes, recheck, integrate and complete it. Accumulate the entire
   bounded seam locally and commit/push once as one coherent packet; and
4. only then derive an activation, acquire trusted account observations and
   continue through content-verified adapters, authenticated provider answers,
   genuine hidden holdout, live multi-provider parallelism and comparable
   semantic-token measurement.

## Live continuation update — repository-path currentness restored

Semantic packet `44f9e2129714d00192eaf2e60e83218bb7fab3ce`
(`Model provider receipt activation and COW state`) is the verified GitHub
`main`. From that clean carrier the registered USF chain restored exact current
authority for `urn:usf:work:repository-path-scope`; no ad hoc work command was
used.

Registered construction evidence/proof publication verified and then created:

- receipt
  `evidence/construction-authority/bf20cf489424c69e7faaa37526843c1269e927319db08ce4756ab188d6f99219.json`;
- receipt digest
  `sha256:f1003af19e1decb6a0ba2ce0d459df14167eda0682d013b8865cbaa732e1a4d8`;
- semantic transition
  `sha256:a807531784f8142e3fb08cd7bc02e1145be513ca610f8e6e4f1be263d31dbde4`
  to
  `sha256:dd18fc092ddd39ab50bc4baa2bd92862185ed02bb5065798939d9a94cf04d97c`.

`usf realise no-change` then materialised candidate
`sha256:fa579992cdb7b352c78e653535495e38d8017ef24e437016736d3a5ec6a6d093`.
The sole graph-selected
`urn:usf:validation:repository-path-tests` passed in the confined registered
check path with receipt digest
`sha256:b44f67665aefcfa8440bc88691eedaab3a07182a4ef1577ef53cb9785cef5044`.
Completion evidence/proof publication verified and then created:

- receipt
  `evidence/work-completion/b97abd998ba96e5e24422f8eb1b9d88c189f228e35d8a239e6a74cc9ebfe4c63.json`;
- receipt digest
  `sha256:2247dad7eced1fef50eb9b4aee07c1057b326ba86c0c357d3d0b4dae368fdc18`;
- current semantic digest
  `sha256:f734ad4a2b6a257d62a7f7d9c2c10cabd7a54b0c63ca54322d646158fbd810d5`.

Fresh untruncated `usf work` read-back now reports `file-asset-index`
dependency-ready. `operator-observability` still has no current construction
authority or completion, so provider account-tier and provider-census remain
dependency-unready. The next safe action is to commit/push the three authority
paths plus this handover as one packet, then realise and complete
operator-observability through its registered chain. No provider or inference
endpoint was contacted,
no credential was read, and no model, ANQR, staging, production or terminal
proof is claimed. Independent registered bundle verification is GO; the graph
file is
`sha256:fe3c20abfd021658d14f80a88b05e8c9411e4121ab973482b841cad1f82c5eb2`,
profile-scoped authority passes 1/1, containment passes and `git diff --check`
is clean.

Repository-path authority packet
`8a3b7e7d616eb9cf94edede8efbbeb2650dfd4e9` is now the verified GitHub
`main`. From that clean carrier the registered operator construction
evidence/proof chain verified and published receipt
`evidence/construction-authority/215473aa1ef08c56f37160e879b5885e52aee07c1a063fb1e516c9ea7ad343a2.json`
with receipt digest
`sha256:41db5a0dfdc4ac65c3405e33f1301ac1566be2b00e5fda51b6284e6d0ec79b0c`.
It moved semantic digest from
`sha256:f734ad4a2b6a257d62a7f7d9c2c10cabd7a54b0c63ca54322d646158fbd810d5`
to
`sha256:646e1c14d3d8f902daf53fe418ee58d87a80371099493dc5fb534c83e7d5055c`
without changing operator implementation bytes. The current graph file is
`sha256:2debbbaab9ae6d19a1b85f2969c5b323c32950c2e863f84844f0f4f79e2a4737`.
The immediate safe action is
to commit/push this construction-authority carrier, then materialise the exact
operator candidate from it through registered `usf` call/resolve/apply/check,
integration and completion commands. No live provider action is part of that
packet.

## Superseded historical boundary — former secondary account-source model

This section records the pre-remodel checkpoint only. Its secondary contract,
standalone activate target, permission-path syntax, authority statements and
next actions are obsolete and MUST NOT be invoked or treated as current. The
first section of this handover is the sole live continuation boundary.

Prepared 2026-09-01 from clean committed carrier
`95e8985b267c5a72b3da9b363ec171497db0fc74` (tree
`e8ea47a0904817695cb8c72205c7f2805fb057c9`, `Complete provider census
authority`) in an isolated clone. The coherent packet modifies only
`graph/provider-pipeline.nq` and this handover; the compact existing contract
test remains exact `HEAD`. The graph file is
`sha256:6722e07e9ef43b251a8fd4a5dff1738178c0ab52b47b6df9e0f2f9ad97577823`.
No provider or inference endpoint was contacted, no credential content was
read, copied or digested, and no live account/provider claim was made.

The exact profile remains `urn:usf:profile:v3-self-host:3` through
`graph/manifests/self-host-provider-v3.json`; no replacement profile or
manifest was introduced. Registered `usf work` read-back is untruncated at
semantic digest
`sha256:a807531784f8142e3fb08cd7bc02e1145be513ca610f8e6e4f1be263d31dbde4`:
nine selected work packets and 11 dependency edges. The existing
`urn:usf:work:provider-account-tier-receipt` is the sole implementation owner
and reciprocally implements both the reusable account-tier capability contract
and the secondary operational acquisition contract. There is no tenth
acquisition work packet or separate acquisition construction-publication
policy. The work remains dependency/proof blocked, so this semantic packet
authorizes neither implementation nor account contact.

Current registered work read-back carries no completion at this moved semantic
basis. `repository-path-scope` and `operator-observability` are root packets but
have no current construction evidence/proof/permission; `file-asset-index` is
therefore dependency-unready, while `provider-account-tier-receipt` and
`provider-census` are dependency-unready on both repository-path and operator.
Earlier completions remain historical evidence only and cannot be treated as
current authority.

The semantic correction closes the following critical-path gaps before code is
built:

- every frozen models.dev provider/model route and separately typed host model
  receives a canonical `candidateMemberDigest`; a configured
  `routeMemberDigest` is a different optional downstream identity and is not
  required to represent the full denominator;
- one factual account-source key is profile-independent and binds transport,
  provider/control plane, response mapping, credential mode/name, non-secret
  credential-source identity and protocol; profile, policy and privacy remain a
  separate exact use/acquisition authorization;
- selected API acquire/verify operations require an explicit owner-private
  `--env-file`. A bounded `--credential-sources` selection can reauthenticate
  retained API sources without ambient environment, directory or history
  discovery; omission makes only the unmapped retained source ineligible. A
  file credential identity retains only its stable non-secret descriptor
  digest—never the secret, a secret-value hash or its path. Subscription hosts
  retain a separate stable non-secret credential namespace identity while
  current expiring host authorization remains a distinct use gate;
- account observations are reusable and single-flight by account-source key,
  while candidate economics and configured-route inference authority remain
  independently scoped; different source keys may proceed concurrently and no
  provider contact holds the primary Git/source mutation lock;
- the frozen raw and normalized catalogue pair is explicitly selected by its
  two authenticated digests; catalogue movement recomputes the pure candidate
  projection locally and does not reacquire an otherwise current account
  observation;
- an expiry/currentness satisfaction rule prevents unattended `usf start`,
  `watch` or Hermes from repeatedly contacting a satisfied source. Routine
  authorization, observation, projection and satisfaction records remain
  owner-private ignored `.usf` state with no Git commit or semantic publication
  requirement. Ordinary failed API contact writes both one factual manifest
  successor and one bounded sanitized source-local retry deferral. A failed
  conflict-reconciliation attempt writes only the deferral and preserves all
  competing factual heads. Profile/policy/privacy movement invalidates only the
  scoped use eligibility, not the reusable factual observation;
- copy-on-write state is an explicit bounded head-set protocol: ordinary state
  has at most 32 heads, the sole transient overflow has exactly 33, recovery
  deterministically reduces the canonical first 32 while retaining the 33rd,
  and no operation emits a 34th head or loses an incomparable concurrent head;
- a pure source-set reducer emits exactly one binding and disposition per
  candidate through fixed 256-bucket roots and a bounded cursor reader. Zero
  applicable current sources is explicit `not-observed`; competing sources are
  conflict-ineligible. Reduction takes no provider, Git or global mutation
  lock; and
- the then-proposed activation used a distinct secondary evidence/proof lane.
  That design was later rejected because it duplicated authority and serialized
  an owner-local call admission; the current primary-owned mode is defined only
  in the first section.

The currently executable registered interface remains
`urn:usf:command:providers-receipt:1`, and current help truthfully exposes only
its route-bound proofblocked forms:

```sh
./bin/usf providers receipt acquire --route ID \
  --profile VERSIONED_IRI --manifest PATH
./bin/usf providers receipt verify --route ID --receipt PATH \
  --profile VERSIONED_IRI --manifest PATH
```

The obsolete target identifiers and permission-path command examples have been
removed from this historical section so they cannot be mistaken for an
operator interface. Use profile-bound `usf query` for graph targets and current
`usf help` for the executable surface; the first section records the exact
current nonclaims and continuation order.

Fresh local `usf models summary` observes the frozen no-contact denominator as
212 provider routes, 7,478 provider/model candidates, 3,806 underlying models,
171 known families, 7,042 candidates with known catalogue price, 436 with
unknown catalogue price and 10 catalogue-zero candidates. These are catalogue
facts only, not configured routes, current entitlement, zero-paid authority,
availability or semantic qualification.

Independent frozen-graph verification passed at this boundary: 6,710 unique
canonical quads from five sources/four manifests; nine profile-selected work
packets and 11 dependency edges in one connected DAG; all nine works
root-reachable; three roots, two leaves, nine singleton strongly connected
components, longest path four edges and maximum antichain four. There are no
missing, duplicate or self dependencies, isolated works or write collisions.
All 84 selected write paths have unique ownership; all 19 selected read paths
exist. Within the changed `graph/provider-pipeline.nq` source, 55 schema-path
triples resolve to 45 unique references and 42 base files: all 20 present
schemas are tracked regular non-symlink valid JSON, and all 22 absent targets
have exactly one selected-work owner. Across the complete imported manifest the
corresponding counts are 69 triples, 49 references, 46 files, 24 present and
the same 22 owned absent targets. The compact existing contract remains 11
tests rather than a provider/model matrix. The provider/product suite passes
76/76, profile authority 1/1,
bootstrap/schema 13/13 and the full authoritative typecheck/suite 209/209.
`git diff --check` and repository containment also pass at the final documented
boundary.

`file-asset-index` retains its bootstrap role and intentionally does not
participate in the later ordinary construction-policy partition, but it is not
currently admitted: repository-path movement made its predecessor authority
stale. Once repository-path current completion is restored, file-asset no-change
recovery can proceed independently of the provider critical path. The remaining
selected ordinary packets use the two existing versioned
provider-pipeline construction-publication policies. The secondary acquisition
contract is activated from exact current completion of its shared implementing
work and its own evidence/proof; it does not create another work packet or
construction-publication policy.

The next safe actions are exact and ordered:

1. Commit and push this already reviewed, authoritative-check-passing semantic
   packet once as one coherent rollback unit. Do not contact a provider in this
   packet.
2. From that durable boundary use registered construction evidence, proof and
   publication commands to restore `repository-path-scope` construction
   authority, then run its registered no-change completion chain. Do not reuse
   a historical receipt as current authority.
3. Use registered construction evidence, proof, publication, integration and
   completion commands to realise and complete `operator-observability` against
   the new basis.
4. Once repository-path and operator are both current, independently rederive
   and publish construction authority for provider-census and file-asset-index,
   then run each registered no-change completion chain while realising the
   account-tier packet. Implement the target activate, v2 receipt and bounded
   list commands, their closed schemas, candidate projection and ignored
   source-state protocol through that graph-owned work; do not use ad hoc work
   commands.
5. Independently validate, integrate and complete the account-tier
   implementation packet, then commit and push it. Invoke the registered
   activation command only after its current completion/evidence/proof inputs
   exist.
6. Acquire current account observations through the activated registered v2
   command. Use OpenRouter only if exact current provider-owned evidence closes
   account identity, zero-paid eligibility, quota, service tier and mechanically
   prohibited paid/overage/top-up/fallback. `/api/v1/key`, historical V2 credit,
   credential presence and catalogue `:free` labels are insufficient alone.
7. Continue in the existing graph order: content-verified scrubbed adapter,
   authenticated provider-produced answer, genuine hidden holdout, exact route
   qualification, then live multi-provider overlap and comparable semantic
   token-reduction measurement. Do not claim any later stage early.

## Prior provider-census completion boundary

Prepared 2026-09-01 from detached isolated carrier base
`e054fcb776c3fcf4ba468f76e48ae15bf14ae1f2`. The authoritative checkpoint is
the clean pushed `HEAD` containing the exact six-path delta described below;
authenticate Git and remote state rather than relying on this base identifier.
Registered copy-on-write
publication has now admitted current construction authority and verified
no-change completion for `urn:usf:work:provider-census` under exact profile
`urn:usf:profile:v3-self-host:3` and manifest
`graph/manifests/self-host-provider-v3.json`. Registered `usf work` read-back
reports the packet `verified-complete`, completion verified and without reason
codes. The current provider-manifest semantic digest is
`sha256:547bb4675c6bf2d8e629c3098ca7463c027a30dbe65a6bb0e3b5ddcb6a9e21a5`;
both `--ready --stage construct` and `--ready --stage integrate` return an
empty selected set.

The pending coherent carrier delta contains the additive graph projection, this
handover, two currentness-sensitive test-fixture corrections and two new
tracked receipts:

- construction authority
  `evidence/construction-authority/96958dba2adb21af9ef81058f57c95dedd39efc37039662758303eda994d7786.json`,
  receipt digest
  `sha256:a14565d9dae7a89d696c81d34230f385600e64ff64e1a3e82aedc89a9492239f`;
- work completion
  `evidence/work-completion/7eb414387e024639ae4e05ac4810927f8296a650a76118de046f24d20abfae43.json`,
  receipt digest
  `sha256:b3b21b9cc93aeb80e636a9ee5767da91d9be7661faa8dc85ced67d8e12e98a39`.

Completion binds no-change candidate
`sha256:eea404f52502726aeee104af4630a5524e2bf6cc38c51af99e7349c49552dee6`,
exact basis
`sha256:0a733d5f1474d45577668f2b29c24ee4d75fe11475f88cebee72e33043208efa`
and the complete two-receipt confined validation set:
`sha256:f7a10e4336577217756b24580e3e994feaaf310dc2a103f14f996fea28a2d34b`
for `provider-census`, and
`sha256:d9e51b021e6662ed711869a1252ca4eb93411a15077167057f03139c8ee3ea16`
for `provider-subscription-host-authorization`. The separate outer carrier
test is not claimed by those confined receipts. Its exact postimage was
independently replayed in a scrubbed standalone repository and passed 7/7 with
zero skips; candidate and carrier both had
`tests/integration/provider-cli.test.ts` digest
`sha256:4465e7b282d4eb9be9d87cba6b94800082afa769e917b667a5128b440afd992b`.
No provider was contacted.

The full-suite review found two tests that inherited the mutable checkout's
historical profile-1 grant and therefore failed whenever relevant tool movement
correctly made that old grant stale. The contract projection now verifies
active/proofblocked state consistency instead of demanding that an old profile
remain active. The completion transition test creates its exact pre-state in
its isolated repository through the registered construction evidence, proof and
publication handlers before testing completion. No new test file or
per-provider matrix was added. This prevents future copy-on-write publications
from requiring packet-specific expectation edits while preserving the rule that
relevant movement must stale authority.

The frozen models.dev denominator currently contains 212 provider routes,
7,477 provider/model routes, 3,806 underlying models, 171 known underlying
families, 209 credential names and 28 adapter packages, of which two are
installed. The registered census composes only 12 configured, legacy and host
candidates; it does not yet assign executable economics or service-tier
dispositions to all 7,477 catalogue routes. The two configured direct routes
and every observed legacy/host route remain `UNQUALIFIED`. OpenRouter is a
catalogue and historical candidate only: the operator's V2 credit/free-model
observation is relevant provenance, but is not current entitlement, zero-paid,
no-fallback, quota or service-tier evidence.

The next safe semantic slice must remodel and activate exact route-bound
account-source acquisition; its contract should co-design the dynamic economics
and service-tier receipt/registry shape over the complete candidate denominator.
This semantic packet defines fields, derivations, expiry, dispositions and the
permission boundary; it cannot supply the live account facts that its later
receipt acquisition observes. Every exact route/model/transport must fail
closed on unknown price dimensions, entitlement, quota, identity, metering or
fallback behavior. Direct SDK routes, OpenRouter, Codex subscription CLI and
Claude subscription CLI remain distinct transports. At that historical
boundary the then-proposed secondary acquisition and `providers receipt`
authority remained proofblocked, so no account or provider contact could occur.
Under the current primary-owned model, trusted receipt acquisition
precedes adapter or inference contact. OpenRouter must additionally prove
current account identity, eligible free models, disabled paid/overage fallback
or an enforceable zero spend cap, quota and exact selected/actual model identity.

This checkpoint is durable only when its graph, two receipts, two fixture
corrections and handover are independently verified, committed and pushed, then
qualified from a standalone fresh clone. If those paths are already clean and
local `HEAD` equals `origin/main`, do not create another carrier-only commit.
`.usf` remains ignored disposable local workspace,
cache and observation state, never authority. Normal operation and verification
must require no V1/V2 path, external CAS/database/Stardog, Docker, GitHub runner
or remote repository.

This boundary proves no live account receipt, current OpenRouter entitlement,
adapter safety, provider availability, authenticated answer, semantic
qualification, parallel execution, semantic-token reduction, BAU, ANQR,
staging, production or terminal claim.

## Prior remotely authenticated operator completion boundary

Recorded 2026-09-01 after full clean-carrier qualification. Completion commit
`617ec3f59909595bfad7d3e2dd1ae9d48441fedd` and `refs/heads/main` were
independently read back equal before account-tier construction began. Its
parent `349a36237cf3bf380ebcb371ef210b802d81c119` is the registered
integration of exact candidate
`sha256:c889de72452b98dd3305a6f59b7007a20b6e123037f4c3a2b8f2dc69f675dd5c`.
Integration request
`sha256:9378e014cd089fe40e0046b9b3b5f2249babc5307e4584d266276edd371a4597`
and observation
`sha256:bd1fa4847601858803ef91fde1f16d192ae1d148ed1b076e148d169da5a27625`
record `integration-success`, `new-advancement` and
`not-required-fast-forward` for checked-candidate set
`sha256:fbd142a9d2b7d541b00ab7f88960fdfaa6675e733d9a3185413f16e3400db4b8`.

The completion checkpoint commits the post-integration graph authority,
construction receipt
`evidence/construction-authority/dc054cef7a67a7ed1588c2af800e07066d64ec7b69b97a0515c6a4823e4ef6d0.json`,
completion receipt
`evidence/work-completion/02151720dfa38edf70e552590dca500cf1f20d7eb043021edc7d16a4afbefb6b.json`
and this ledger. The registered no-change candidate remains
`sha256:aa3ac261ae6107eb159f5deff12b5f243a34703e08aa244694c44162e2e44fb9`
on basis
`sha256:dcbc1e0fa8d3ee02f0d2290c53ee274b766497f3b61b43b7db8c1e97e8e25a1d`;
its three completion checks passed with receipts
`sha256:00cdd4fb774e27fd939180166848b374ec7c7dfee19f7e3aa26850a382cb0ef3`,
`sha256:e3afb1ead68dcab92b18b1ea8d5740c63a078a6a042dede2e1f37d7a5a37e165`
and
`sha256:24a8cecf5242b0bd1734f6e7fcfb82af719737cd137b81be270d6242013fbdc5`.
Registered `usf work` still reports `operator-observability` as
`verified-complete`, completion verified, with no reason codes and the same
realisation basis after the correction below.

A fresh standalone clone of the pre-correction checkpoint executed 204
authoritative tests:
200 passed and four failed. All four were the same cross-validation runtime
closure defect: `realisation-basis-chain-focused` imports the integrated
`call.ts` and `resolve.ts` postimages, but its shared inbound closure omitted
six non-candidate runtime files. The smallest semantic correction removes only
that validation from the two-file shared closure and gives it one dedicated
eight-file closure: the existing construction/completion modules plus
`command-input.ts`, both leaf dispatchers, both result schemas and the tracked
bootstrap-admission receipt. An exact isolated confined replay of this corrected
closure passes all 18 executed inner assertions with zero failures; ten
outer-only cases remain explicitly skipped there, and the selected outer
adversarial case passes. No source implementation was changed.

Registered query read-back confirms the shared closure still contains exactly
two files for its two sibling validations and the dedicated closure contains
exactly eight files for only `realisation-basis-chain-focused`. The current
dirty semantic projection has manifest digest
`sha256:90e91c90aae0a84eecf65d3dc0f1650d8bea611fa6a73357937f05874f176fdf`;
the operator scoped authority remains current.

The first amended-carrier replay was invalid because the audit setup created
the ignored `.usf/cache` directory as mode `0775`; the confinement boundary
correctly refused that non-private dependency root. Restoring its required
owner-private `0700` mode without changing tracked bytes left 203 of 204 tests
passing. The remaining existing integration-order test replaces the production
validation with two synthetic validation IRIs but had not declared an inbound
runtime closure for its synthetic fake-call/resolve member. Independent static
and confined replay identified exactly five supplemental paths: the two result
schemas, `command-input.ts` and both leaf dispatchers. Adding that dedicated
five-file closure only to the synthetic fixture makes the existing test pass;
it adds no test case and does not broaden production graph authority.

Fresh standalone clone `7b31cf8a296ab885f8a56a8fe985a5138a4682ac`
(tree `c24b4d43e312e4e5242d7e413aec9e6a3f193533`) preserved both private
dependency roots, rederived operator completion and passed the entire
authoritative suite: 204 tests passed, zero failed, zero skipped, in
27,956 milliseconds. Independent read-only verification confirms the shared
two-file/two-validation closure, dedicated production eight-file closure,
synthetic five-file closure, `verified-complete` operator read-back with no
reason codes, committed-path isolation and clean range diff. This ledger is the
only tracked change after that qualified carrier.

That boundary's conditional push and exact remote read-back are satisfied by
`617ec3f59909595bfad7d3e2dd1ae9d48441fedd`; the current live account-tier
section above supersedes its next action.

This proves local operator work completion only. It is not provider execution,
multi-provider parallelism, semantic-token reduction, BAU, ANQR, staging,
production or terminal proof. Downstream provider receipt, economics, probe and
qualification drafts remain outside this packet and must remain untouched.

Updated 2026-09-01. The live continuation updates immediately below supersede
older next-action and carrier statements where they differ. The durable pushed
semantic boundary is now
`224796f2d0befa3e68dbe2eaeff49e5ea7df9a0c` (tree
`49ab51aaf8a9a18e1f90395723112d0c1cdcf134`). Its predecessors `a3a40e5`,
`6040fe9`, `4a7d2a7` and `9e5195a` commit the independently reviewed
composable-input, validation-isolation, shared call-leaf, validation-host-tool
and confined link-boundary remodels plus their construction publications.
Remote read-back resolves both `HEAD` and `refs/heads/main` to exact commit
`224796f2d0befa3e68dbe2eaeff49e5ea7df9a0c`. The earlier registered
copy-on-write publication created
`evidence/construction-authority/a5f565bbcc2b38088678c4ad8c745efd9a60450e91f7d5a9bdac305cca7d5927.json`
with receipt digest
`sha256:69a3a56dae0e80d0d092f75773ea9a19ec30d1eb9bb3a59ab51497738b6a5e84`.
The later validation-host-tool correction and its fresh construction authority
are committed together at `4a7d2a7` and remote read-back confirms exact
`origin/main`. Its copy-on-write receipt is
`evidence/construction-authority/8223a32577746690da74dfbc74f79cb3145672814fb6b76ede16b8c35dacf1aa.json`,
receipt digest
`sha256:f6e4bb92ae6117a7b731b4f1809e2cf24b759fb4f12fcbbde014bbd46aabd5f5`;
GitHub did not participate in construction, currentness, proof or runtime
authority. No source implementation from the isolated operator draft has been
integrated into the primary checkout. At exact committed boundary `4a7d2a7`,
registered `usf work` read active construction authority through `integrate`,
with profile semantic digest
`sha256:e96f666823135e3239faf6603c649f33a7f4653b8d35e2e2294485cb7b11d68f`,
current ready-work realisation-basis digest
`sha256:db4d471fc0a80f673d22e1756550a6d96903ff3f6078a91b0ca437c3250cf847`
and packet scoped dependency digest
`sha256:09601abe68c800b6a96d276dddef1745912ece747d84fb17fda910e7e55d549e`.
The fresh-child semantic remodel recorded below supersedes that committed
currentness locally. Registered construction evidence and proof passed and
copy-on-write publication created
`evidence/construction-authority/f7906ef478d268bba407c7d9817df7a828fe0103800c3ff0f0dbb64d0101f595.json`
with receipt digest
`sha256:422a9cdb100810ec083863d503c4ceb03345dfd75d762f5682e0bda2bdc13268`.
The publication moved the profile semantic digest from
`sha256:3f2fb95e13de9a406d5d4e5a404e11a430e908319164e45f1fa95e3998fba39c`
to
`sha256:f38328edc46d30d45fbe5f17c0a4fa3bc33cf29ec659b85a2c84f934f749af86`.
Exact registered `usf work` read-back now reports active construction authority
through `integrate`, basis
`sha256:3f860b520fdff4220944043ce1fed9beb5aa7fdc2cf635d97afa264d56a5053b`
and scoped dependency digest
`sha256:4ebe0ad7b76d6786cfb5f0d45368550dd60350655ff7bf27db941b8f83f5776e`.
Commit `9e5195a` contains this exact graph, receipt and handover carrier. Ordinary
fast-forward push and independent remote read-back both resolve
`origin/main` to `9e5195ab6d71c7b74a848ebcc4a1fb124d801e3a`; implementation may now proceed
from that recorded safe boundary.

The authorized implementation is now complete only in the isolated checkout
`/tmp/usf-operator-realisation-ZGj3V9/repository`; no candidate, primary source
write, integration, commit or push has yet occurred. Its complete 13-path delta
is inside the current `operator-observability` write set. The stable `bin/usf`
launcher takes the shared primary-mutation flock before `src/cli.ts` loads for
the four dynamic leaf prefixes. Provider and call dispatch use their separate
graph-defined fresh Node entries, and parent plus child independently rederive
current completion/basis, authenticate the operator-owned child entry and exact
typed feature closure, and reauthenticate the imported entry. The child emits
`prepared` only after its own shared lock is released; the parent validates and
releases its inherited launcher lock before acknowledgement; handler input and
inference follow acknowledgement. The child uses exact `process.execPath`, no
shell, a fixed locale-only environment, bounded 64-KiB control and four-MiB
result channels, a 30-second admission timeout, five-second termination grace,
no fallback and deterministic process exit after its result.

Independent focused verification reports TypeScript, shell syntax and
`git diff --check` passing. The exact graph-selected composable-input,
observability and provider-leaf lanes pass 4, 13 and 3 cases respectively. The
ordinary outer provider-leaf run executes three cases with zero skips; its two
genuine scrubbed children import the same canonical owner-private fixture URL
around sanctioned byte movement and observe `before` then `after`, without
inheriting credential, proxy or `NODE_OPTIONS` state. Under the confined Node
permission boundary the outer case skips before any fixture write while the two
injected no-child cases pass. Direct Node entry refuses
`CALL_LEAF_LAUNCHER_LOCK_REQUIRED`; registered `bin/usf` reaches the expected
semantic `CALL_LEAF_PROOFBLOCKED` boundary without provider contact. Final
independent adversarial read-back now reports no production transport,
authority, lock-order, cache-currentness, containment or protocol blocker. It
also confirms that the compact provider-leaf lane retains the graph-required
lazy, scope, completion, dependency-movement, cross-root, missing-entry and
no-contact refusals without growing a provider/model test matrix. The accepted
next boundary is therefore to materialise exactly one fresh current-basis
candidate through the registered one-time `usf apply --input` self-repair,
then run the three candidate-bound validations sequentially; never reuse
rejected candidate `1d95f0...`.

That one-time self-repair has now materialised fresh candidate
`sha256:801eeb73e7e2364298f6516bcd62a6de9aae568e58df6acd4da03c7433d2ef21`
against exact current basis
`sha256:3f860b520fdff4220944043ce1fed9beb5aa7fdc2cf635d97afa264d56a5053b`.
Its one deterministic local proposal contribution is
`sha256:3529d5126c774de7e78e2cd4479be922003eb511a962ac81bf3f45ff37a8589e`
and its 13 operations are exactly the independently accepted isolated paths.
The old single-argument `usf call` first refused at the host argv ceiling and
performed no write; the recorded bootstrap exception therefore built the same
current deterministic call/resolve lineage in memory and passed the resolved
envelope only to registered `usf apply --input -`. No primary path changed.
The next live action is the three graph-derived candidate checks, strictly
sequential because their receipt set intentionally has one mutation lock.

The first graph-derived check then refused `CHECK_FAILED` before any passing
receipt. A direct candidate-tree replay initially observed the expected absence
of `src/providers/fake.ts`, but that was not the confined check view: the graph
already supplies that non-owned runtime member. A matching Node-permission
diagnostic in the complete isolated carrier found the actual refusal: Node
denies `fs.symlink` unless the process receives unrestricted filesystem read and
write permission, even when the requested symlink is inside the allowed private
scratch. Bubblewrap and the exact check policy correctly do not grant that
process-wide permission. The other three composable cases pass under the
permission boundary; the existing observability confined replay passes 12 with
its one declared outer-only skip, and the provider-leaf confined replay passes
two with its one declared real-child skip. Candidate `801eeb...` is rejected
and must not be integrated or reused. Before another semantic publication or
candidate, audit all three graph-selected validation closures and confinement
assumptions together; correct the semantic acceptance once rather than weakening
the shared check sandbox or repairing observed symptoms one at a time.

That set-wide audit found no missing transitive repository runtime member and
no defect in the other two validation confinement boundaries. The graph now
models the narrow correction before source work: the composable confined lane
keeps parser, bounded regular-file, mode, invalid-UTF-8, call, basis and resolve
coverage, explicitly skips only link creation, and may not widen the shared
sandbox. The identical tracked ordinary exact-carrier lane must execute both
symlink and hardlink refusal with zero link-authority skips before integration
or completion publication. This semantic movement makes the current operator
construction grant stale; rederive evidence, proof and copy-on-write publication
before changing the isolated test or materialising another candidate.

The first full authoritative replay after that graph-only correction reports
200 of 202 cases passing. One refusal is the expected not-yet-realised semantic
gap: `profile-scoped-authority.test.ts` reconstructs profile 2 and invokes the
same confined composable validation, whose current tracked test still attempts
link creation. It must turn green only after the freshly authorized link-only
skip is realised; it is not a second closure defect. The other refusal is
workspace contamination from the intentionally untouched downstream untracked
account-receipt schema drafts: their `endpointIdentity.maxLength` keyword is not
supported by the current closed schema validator. That downstream failure does
not authorize editing those drafts and cannot be cited as a green authoritative
run. Re-run the complete authoritative suite from the realised carrier with the
downstream packet excluded or completed before integration publication.

The corrected semantic carrier has now passed exact `usf query` read-back and
the registered construction `evidence -> prove -> publish --verify -> --apply`
chain. Copy-on-write publication created
`evidence/construction-authority/aa7e409b9864f6b3fb278e02dc10da47515a13242c1bd541015539a51589ca43.json`
with receipt digest
`sha256:cc054a62e05889c7f38c351297dc5818036a18fa5ca44af3dc7c37d0eb9a8bd1`.
It moved semantic digest
`sha256:a2ac65bb7446294e43bae674d1c3083dfdcfce1bed60e0e281a98d5cd2e9058d`
to
`sha256:95ebeb0cff0bed87a5ab127745ef9c2397c1e9e99ca67191f9bae739409f60a6`,
activating operator construction through `integrate` against basis
`sha256:83c3d064118ad919f79afd12ffa085b534126fdade5a5593d2b38586dbd20bef`
and scoped dependency digest
`sha256:2d97982a11863a44062b040313066f6a9b2106618c0b83ff1ccea54e06fab837`.
Those are the authenticated pre-publication grant inputs. Post-publication
`usf work --ready --stage construct` independently rederives current basis
`sha256:729c0a2b8e141f4b3d61ee3035521c1b400ef090aa97021112243af8f6952e47`
and current scoped dependency digest
`sha256:cab75b566840e4214c35af78da9dc13d4c81b6cc1159f29de286b9802619b9d4`
while retaining active permission through `integrate`.
The focused construction-authority, overlay-isolation, immutable-basis and
semantic-first eligibility replay passes 11/11; containment and
`git diff --check` pass. Independent verifier and adversarial read-back accept
the 32-operation receipt and the link-only confined/ordinary split without a
blocker. A newly derived post-publication bundle is a different prospective
transition and correctly refuses partial-state publication; existing authority
is reauthenticated by current `usf work`, not by misdescribing that fresh bundle
as receipt re-verification. This is construction authority only;
it is not candidate validation, integration, completion, provider execution or
terminal proof. The next authorized source change is only the isolated tracked
composable test's link-case partition, followed by a fresh candidate; rejected
candidate `801eeb...` remains unusable.

That isolated source correction is now complete without changing production
code or adding a test family. The original parser/file/mode/UTF-8/call/basis/
resolve case no longer performs link creation; one adjacent tracked case owns
both symlink and hardlink refusal and skips before scratch creation only when
Node's permission model lacks the unrestricted link authority. TypeScript
passes. The ordinary exact carrier runs all five composable cases with zero
skips, including both link refusals. A fresh current-basis candidate and its
confined graph check remain required; these ordinary results alone do not admit
integration or completion.

A regenerated deterministic call/resolve envelope has materialised fresh
candidate
`sha256:c889de72452b98dd3305a6f59b7007a20b6e123037f4c3a2b8f2dc69f675dd5c`
against exact current basis
`sha256:729c0a2b8e141f4b3d61ee3035521c1b400ef090aa97021112243af8f6952e47`.
Its real local contribution is
`sha256:b05c319416cb9294a801c4f2fead33bdb0660cf21211fa6d00e27424e5e004de`;
all 13 operations are the authorized isolated postimages and no primary tracked
source changed. The first registered graph-derived check again refused before a
passing receipt, so the remaining checks did not run at that point. The
candidate bytes and construction basis remained immutable and current; the
refusal wrote no terminal disposition or passing receipt. Exact reconstruction
of the same confined launch exposed the new
cause: candidate postimage `src/commands/call.ts` imports
`src/schema/index.ts`, but that non-candidate repository file is absent from the
graph's composable validation runtime closure. The earlier closure review read
preimage imports and therefore missed a postimage dependency. Before retrying,
audit the complete recursive runtime and file-read closure of all three actual
candidate validation postimages and correct the graph once. Do not widen the
sandbox, patch primary source or rematerialise identical candidate bytes merely
because a late-bound validation-support dependency was incomplete.

A non-authoritative reconstruction of the exact Bubblewrap/Node permission
launch confirms the boundary precisely: with the current declared closure it
fails on missing `src/schema/index.ts`; adding only that current primary file to
the diagnostic view makes composable pass four with its one declared link skip,
observability pass twelve with its one declared outer skip, and provider-leaf
pass two with its one declared child-process skip. This is diagnostic evidence,
not a check receipt or authority to patch one symptom. Await the exhaustive
postimage closure audit, then remodel and republish before a fresh candidate.

The exhaustive candidate-postimage audit covers 33 per-validation memberships,
22 unique repository files and all executed relative imports plus bounded file
reads. It finds no extraneous declared member and exactly one missing
supplemental file: `src/schema/index.ts` for composable input. Candidate-owned
call/resolve schemas remain candidate bytes, Ajv remains an authenticated tool
dependency, and provider-leaf correctly has no supplemental closure because its
seven required files are already in the candidate tree. The graph now adds only
`src/schema/index.ts` and records the reusable postimage rule: execution view =
candidate postimages + exact supplemental non-owned repository reads +
authenticated tool roots. `ValidationRuntimeClosure` is deliberately linked
inbound to a validation and is not part of the construction packet's static
dependency set. The current construction grant therefore remains active by the
copy-on-write no-reproof rule. `usf check` binds the current supplemental path
set and exact bytes into each receipt, and `usf integrate` rederives that path
set and reauthenticates the bytes; adding an outbound dependency would instead
turn validation-support movement into an unnecessary construction bottleneck.
No new construction evidence/proof, test family or generic closure checker is
required.

The same immutable candidate `c889de...` has now been retried through the three
registered graph-selected checks, strictly sequentially. All three pass and
persist content-bound ignored receipts: composable input
`sha256:db046ef8b9efc7c88df811e80593cdecfa28dbfcd1fc348a9601fa8322bd0825`,
operator observability
`sha256:c40f566acc901c5e702ac74dde37f56cab0ebf71f4eebf80ae0fca1920f5c645`,
and provider leaf
`sha256:1c06e9667c18fe452e9f8cff9abb288975b30b92bac52249f38963259c97b596`.
The composable receipt explicitly binds all six supplemental non-candidate
files including `src/schema/index.ts`; provider leaf correctly binds an empty
supplemental set. This proves candidate reuse after a late-bound closure repair,
not integration, completion, provider execution or terminal proof. The next
boundary is the durable graph/handover checkpoint, then registered integration
of this exact candidate.

The identical isolated carrier has now run the three ordinary tracked contract
files together: 11 tests pass, zero fail and zero skip, including both link
refusals and both genuine scrubbed provider-leaf children. Current primary-tree
TypeScript passes. The focused provider/overlay/construction lane passes 20/20;
containment and `git diff --check` pass. Registered
`usf integrate --candidate c889de... --dry-run` independently reauthenticates
all three receipts and the six-file composable supplemental closure, prepares
carrier commit `349a36237cf3bf380ebcb371ef210b802d81c119` (tree
`7f6289c667048d4ed8c19ac9e8568b614d928d51`) without moving primary, and passes
all three postimage validations. Its request digest is
`sha256:9378e014cd089fe40e0046b9b3b5f2249babc5307e4584d266276edd371a4597`,
checked-candidate-set digest
`sha256:fbd142a9d2b7d541b00ab7f88960fdfaa6675e733d9a3185413f16e3400db4b8`,
postimage-validation-result-set digest
`sha256:db87a81a84098799c9193dd0b1dbe852001ff99f19dc25038016c3d98f103e17`
and independently derived postimage-basis digest
`sha256:dd10363f14403faaa6e06c7166523cf7ed092b619b68e41cc487de1bd531cf75`.
This is preparation only: primary source, completion authority, provider
contact and remote state remain unchanged.

The focused graph/provider topology lane passes 13/13; the independent current
compatibility lanes pass 15/15; `git diff --check` and the containment verifier
pass. A detached exact-carrier bootstrap and full `pnpm run check` completed
196/197 tests. Its sole refusal is the pre-realisation profile-scoped authority
test expecting the historical `operator-observability` validation to pass even
though the new graph deliberately moves provider-leaf assertions into a
profile-3-only validation file that is still absent. This is the exact open
source acceptance item authorised by the packet, not a green authoritative
suite and not evidence of completion. The newly declared profile-3 tests,
schemas and source paths remain proofblocked until materialised and validated;
no completion claim is made for them.

### Active continuation ledger — isolated operator realization

Work is currently isolated at
`/tmp/usf-operator-realisation-ZGj3V9/repository` on exact carrier `6040fe9`;
primary source remains unchanged. The draft now provides the graph-reserved
bounded `call`/`resolve` file, stdin and inline input boundary, closed local
call/resolve result schemas, immutable wire-basis reconstruction, complete-batch
resolution, a shared byte-authenticated runtime-closure primitive, and the lazy
`call parallel`/`call compare` gate. That gate derives the exact
`provider-parallel-execution` completion and current basis under explicit
profile/manifest scope while holding the shared primary-mutation lock,
authenticates the graph-selected closure before import, reauthenticates the
entry module after import, rejects moved cached closure identity, and releases
the lock before handler execution. It does not make either future provider leaf
available and reads no input payload before graph authority succeeds.

Focused evidence at this draft boundary is: TypeScript passes; all five narrow
schema-validator cases pass; and the exact three graph-selected validations
pass 19/19 (four composable-input, thirteen profile-2 observability and two
profile-3 provider-leaf cases). One existing fake-call regression was found
because the new preflight inspected a proposal payload before the
already-declared malformed route-concurrency refusal; the draft was reordered
to refuse the route first and the focused replay now passes. Registered
`work -> apply` materialised isolated candidate
`sha256:1d95f0846072c27985d3f4a12d21584fff55a2695e9270d3c80fffb41e3f32fb`
under `.usf/workspaces/` against exact basis
`sha256:a4cac4fa618e1a189a93041af72e55f65e82f1c70f9a93c8717b72f98025dd74`.
The first candidate-bound attempt deliberately ran the three obligations in
parallel. The existing observability obligation passed with receipt digest
`sha256:0787f2030ae70413efabf6deea0381249a9c917988c66a6007ba775ee0e802b4`;
the two sibling attempts correctly refused `CANDIDATE_BUSY` because one
candidate receipt set has a single mutation lock. On sequential replay the
composable-input obligation refused `CHECK_VALIDATION_TOOL_UNSUPPORTED`. Exact
`usf query` read-back showed that both newly modelled obligations omitted the
mandatory `urn:usf:host-tool:bwrap:0.9.0` dependency carried by existing
confined validations. Candidate `1d95f0...` is therefore rejected and must not
be integrated or promoted by its direct test success or single passing receipt.
The two missing graph edges were added to `graph/provider-pipeline.nq`, exact
query read-back resolved both typed dependencies under semantic digest
`sha256:1acb6282385f76da413c81aa4e9a223c9fafd7059d7b920b91dd0f4d02e4f75d`,
and the fresh construction publication recorded above is active. Candidate
`1d95f0...` remains invalid; materialise a fresh candidate rather than patching
or reusing it.

Final adversarial review of the isolated source then found a separate
proof-blocking long-running-process defect before a fresh candidate was
materialised. The lazy dispatcher keyed cached handlers by `root + leaf`, even
though `parallel` and `compare` share one module, and it did not retain one
process-wide identity for already resident closure members. Node could therefore
return a stale ESM namespace after authenticated bytes moved, including for a
preloaded shared dependency such as `src/core/canonical.ts`. A per-path registry
was independently rejected because it cannot prove which bytes entered the ESM
cache before the registry existed.

The graph has now been remodelled to the Unix-ceiling solution: every production
provider or graph call leaf uses one fresh single-invocation Node child. The
parent holds the shared mutation lock before the child's first repository
module load; the child rederives authority, authenticates and imports the exact
closure, releases its own lock and emits `prepared`; the parent releases its
lock and acknowledges; only then may input consumption or inference begin.
The protocol uses exact `process.execPath`, no shell, a fixed scrubbed
environment, a four-MiB result ceiling and no fallback. Confined tests use an
injected handshake and one planted shared/preloaded movement case, not a real
child or provider matrix. Parent and child repeat exact current admission; the
private protocol is bounded to 64 KiB control and four MiB result bytes, with a
30-second admission timeout, five-second termination grace and no fallback.
Registered construction evidence observed semantic digest
`sha256:3f2fb95e13de9a406d5d4e5a404e11a430e908319164e45f1fa95e3998fba39c`,
realisation-basis digest
`sha256:32e4583ddbf4a8138d43c3c41bb22b36562d9b1c0d562e555b2ffd1d4524afec`
and scoped dependency digest
`sha256:02b8dd264d628d96fdddf1f01db1fc14cdabd48417d457d40d9081f4c70f3077`.
Its evidence and proof bundle passed; the fresh copy-on-write publication and
current read-back are recorded at the top of this handover. Commit and remotely
read back that exact semantic carrier before implementing this model. Do not
reuse either candidate `1d95f0...` or the rejected process-cache draft.

The current graph intentionally has no typed production runtime closure for
the downstream `provider-parallel-execution` leaf and does not semantically
name JavaScript handler exports. The operator gate therefore remains safely
proofblocked. A later semantic remodel must define the exact runtime closure
before that leaf can complete; do not bypass this by treating module presence
or an implementation-derived export convention as graph authority.

The follow-up makes the selected profile publication policy explicitly admit
its newly declared `repository-path-scope` predecessor. Registered construction
evidence derivation for that predecessor now succeeds, but neither it nor the
operator is current until fresh evidence, proof and publication complete. The
operator grant published immediately before this semantic movement remains a
truthful immutable historical record and is intentionally stale. `GOAL.md`
remains the stable normative target and has no pending edit; this handover is
the dynamic continuation record.

Later provider receipt, economics, probe and qualification drafts remain
untouched outside this packet. Earlier operator, provider-census,
`repository-path-scope` and `file-asset-index` receipts are historical
observations unless a current read-back below names them. Routine checkpoint
documentation and unrelated tests are not functional work dependencies.
Full-universe provider qualification is not a prerequisite for the earliest
trusted provider vertical slice: discovery and qualification stay lazy,
bounded and candidate-driven. The rejected first operator integration remains
recoverable at local branch `recovery/operator-leaf-tsc-failure`; it is not in
`main` history. Until the operator says otherwise, one operator owns repository
mutation; delegated implementation remains isolated and delegated review is
read-only.

## Live continuation update — profile predecessor and bounded leaf closure

The first attempt to derive construction evidence for
`urn:usf:work:repository-path-scope` under profile
`urn:usf:profile:v3-self-host:3` refused with
`CONSTRUCTION_WORK_NOT_ELIGIBLE`: provider-census had gained the predecessor
edge, but the profile-3 construction and no-change publication policies did not
yet enumerate that exact predecessor. Both policies now do. An independent
read-only registered-command replay produced repository-path construction
evidence against semantic digest `sha256:50e3c8c4...`, proving policy admission;
it did not publish or activate authority. The later closure correction moved
the current digest to the exact value recorded above, so all authority will be
rederived after this semantic carrier is committed.

Independent runtime review also rejected the initial plan to authenticate all
60 non-URN files in the provider-census packet. That would have made
documentation, tests, schemas and the sibling receipt leaf invalidate the host
command even when its executable bytes were unchanged. The graph now projects
one typed `ProductionLeafRuntimeClosure` requirement for the host owner and
entry module. Its exact 17 paths are the selected handler, the handler's four
direct command-time dynamic imports, and their static runtime imports:

- `src/commands/models.ts`
- `src/commands/provider-hosts.ts`
- `src/continuous/lifecycle.ts`
- `src/core/canonical.ts`
- `src/core/errors.ts`
- `src/core/scope.ts`
- `src/graph/index.ts`
- `src/graph/nquads.ts`
- `src/graph/query.ts`
- `src/graph/work.ts`
- `src/providers/catalogue.ts`
- `src/providers/subscription-hosts.ts`
- `src/realisation/basis.ts`
- `src/realisation/construction-authority.ts`
- `src/realisation/transition.ts`
- `src/realisation/work-completion.ts`
- `src/schema/index.ts`

Registered `usf work` read-back confirms one exact typed closure and an exact
file/tool dependency row for every member; legitimate same-path multi-role
rows remain canonicalized by path and digest. Outer registry modules belong to
the already-authorized operator predecessor, receipt/economics belong to the
sibling receipt leaf, and `src/providers/local-git.ts` remains validation
runtime support. They cannot be pulled into host production currentness merely
because the outer CLI or a test imports them. This leaf-specific selection is
the nonserializing correction: every invocation rederives work authority and
reauthenticates only the executable closure that can affect that leaf before
import or cache reuse.

Against committed carrier `89c3ba9298ddb5fdfeae156abfbcf6f27c6b9085`,
registered construction evidence and proof passed independently for
`repository-path-scope` and `operator-observability`. One compatible two-member
publication verified and then created tracked receipt
`evidence/construction-authority/7fdd9b8e6e24b2edc46723878f92f8f13b17bdcefc1194b94fedc46a13376a25.json`
with receipt digest
`sha256:6f81faf40b406464c7c20b9622d9df6dbb96e65bb0362c21ea8ff4f6d2129543`.
It moved semantic digest from `sha256:61a2081e...` to the current exact digest
above. Registered ready-work read-back now returns exactly the two
construction-ready packets: repository path basis `sha256:de9db106...` and
operator basis `sha256:d38cf688...`. This grants construction through the
declared ceiling only; it is not work completion or runtime authority. An
independent read-only replay reauthenticated both bundles and the exact receipt,
then confirmed those two and no other packets are construction-ready.

## Live continuation update — production host command exposed closure defects

The first registered production invocation of `usf providers host census`
refused safely with `PROVIDERS_HOST_DEPENDENCY_REFUSED` before catalogue read,
credential projection, child creation, provider contact or network contact. The
completed provider-census packet projected 62 repository-role rows over 60
paths. Its only repeated paths were `package.json` as `file` plus `tool` and
`schemas/provider-census-result.schema.json` as `file` plus `schema`, with one
identical digest in each pair. The operator boundary incorrectly treated these
legitimate semantic roles as conflicting identities and only syntax-checked
the selected module digest; it did not authenticate the authorized closure
bytes before import.

The graph-first correction now defines the canonical repository identity as
path, SHA-256 digest and sorted unique role set; same-path/same-digest rows
merge roles, while conflicting digests, unknown roles, malformed paths,
symlinks, non-regular files and byte drift refuse. Every canonical dependency
is authenticated from the selected same repository under the short shared
import lock. The loaded handler is bound to one canonical closure digest;
movement within a live Node process requires restart instead of reusing stale
ESM cache bytes. The selected module is reauthenticated after import and the
lock is still released before handler execution, so this census-time check does
not serialize provider inference. Git index cleanliness, GitHub, CAS and a
database remain outside authority and the runtime critical path.

Production audit also found that the host leaf eagerly imports
`src/core/canonical.ts`, `src/core/errors.ts` and `src/schema/index.ts`, while
the latter two were only validation-runtime dependencies. Its production scope
also omitted dynamically imported `src/continuous/lifecycle.ts` and
`src/graph/index.ts`; the operator dispatcher scope omitted its direct
`src/core/errors.ts` import. Recursive comparison of the registered packet to
the 17-module repository runtime closure additionally found `src/core/scope.ts`,
`src/graph/nquads.ts`, `src/graph/query.ts`, `src/realisation/basis.ts` and
`src/realisation/transition.ts`; all seven previously absent provider modules
are now explicit versioned tool dependencies. This avoids inventing work-DAG
edges to unselected tool-authoring packets while still placing their exact
bytes in the provider packet's authenticated closure. Because
`src/core/scope.ts` is owned by selected `repository-path-scope`, the graph's
existing owner/consumer invariant correctly requires and now contains that one
additional direct predecessor edge. It may be reproofed independently of the
operator source repair before provider-census construction. Exact
absence of `/usr/bin/codex` or `/usr/bin/claude` is evaluated before auth-file
absence and is defined as a route-local `EXECUTABLE_NOT_FOUND` observation that
preserves its frozen candidate denominator without suppressing the sibling
host. A dangling or unsafe present identity, unsafe provider root, missing
Bubblewrap containment tool or containment drift still refuses globally. The
operator packet reserves static `usf doctor --provider-home ABSOLUTE_PATH` help
while the dependent provider-census packet owns its implementation. That
diagnosis reports bounded root, auth-file, Bubblewrap, Codex/Claude
identity/version-check and no-network namespace prerequisites; it launches no
provider, and only the exact Bubblewrap namespace self-check may spawn. It
exposes neither selected paths nor secrets.

The superseded graph-only checkpoint digest at this point was
`sha256:099aa2aa948675c7b19fa0d4d0c90d205be20a58d98b77048d3c983623f9b6e0`.
The profile-policy and leaf-specific closure correction above now defines the
current digest and safe boundary. Operator and provider-census
construction/completion receipts published before that movement remain
truthful historical observations but are not current authorization. Commit the
coherent semantic carrier, publish fresh repository-path and operator
construction authority, realise and independently verify the operator
dispatcher candidate, republish operator completion, then realise the
dependent provider-census absence-isolation and doctor-readiness candidate.
Only after both dependent completions are current may the registered no-network
host census be retried. No provider, inference, GitHub or remote runner contact
has occurred, and this is not a live-provider, ANQR, staging, production, BAU
or terminal-proof claim.

## Live continuation update — provider leaf registry integrated

Semantic carrier `f07164c` binds the CLI implementation root to the selected
repository root and requires current owner-work completion plus exact
repository-relative executable dependency closure before a host or receipt
leaf import. The shared primary-mutation lock covers only final derivation and
import, permits concurrent readers, and is released before handler inference.
Direct Linux read-back confirmed the inherited open-file-description lock stays
held until the parent descriptor closes.

Candidate `sha256:0ab75f...` passed its graph-selected check and both independent
reviews, but the first ordinary integration produced local commit `a1707699`
whose focused test contained a compile-invalid structural cast. No patch commit
was stacked. That exact commit was retained on the recovery branch, `main` was
returned to known carrier `f07164c`, and the packet was regenerated from the
same graph authority.

Replacement candidate
`sha256:7eb9581c630b0aa8f0fedaa648d756d8d2816b882084b04b6dd95a4befaea2bb`
changes the same exact four paths. Graph-selected check receipt
`sha256:09edc039258329d109224a92c5f3ba4e608255d5e4c04a1d53d6792941099acc`
passed, a disposable full-carrier TypeScript check exited zero, independent
adversarial review accepted it, and integration request
`sha256:9b124eecfe3a5a2fa3ec6863131109cd0df7bf89db77776187bd39130ce3cbd2`
created carrier `ed928f31` with no rollback required. Primary-tree TypeScript
then exited zero. Registered `usf providers host census` and
`usf providers receipt verify` both refused with their exact `*_PROOFBLOCKED`
codes before an unqualified module load. No provider, inference, credential,
GitHub or remote runner contact occurred.

Post-integration construction publication
`evidence/construction-authority/374c78a4ca396bddd1ea482a8ac5028059f644f9d29e86142c7cc3e8b20c5c22.json`
created receipt digest `sha256:b811f693654ddd1361ed313fd8ea346b3151f075a54c79633ca4d6065f68a3b1`.
No-change candidate `sha256:f9807346...` passed the exact operator validation,
and work-completion publication
`evidence/work-completion/eaff3456ee41db4fb07109c61872fd99bb22ce1bf2cf5c5b13cb68e9c1257a7d.json`
created receipt digest
`sha256:34b7fd40ffeebb13d62b6fa945948f58b8d0506b9a51dd4df8d7c35c90e863c5`.
Current semantic digest is
`sha256:798b46f804c7b70359e26657cdeb4b8d7e0827ff538062831af4d4ee6d455bf4`;
provider census now reads its predecessor authority as
`verified-completion`. Independent read-back accepted the exact one-member
operator completion and its additive graph-only scope. Provider-census
construction publication
`evidence/construction-authority/8b53089a577391d61a54e5ee50059d80d94f59b2024269a7a33ac1ed8523b63a.json`
then created receipt digest
`sha256:a50e8e6a84b8eecaf1212167e94b309c9b9447b961b8f20d12ed956f89932e8e`
and resulting semantic digest
`sha256:71068ad92971404b34dbf58753fb0b9c894500c65058f0885c7a72e25a936403`.
Provider census is construction-ready at basis
`sha256:9595ebf8cda411cb7f922c33afea22e1e9538ba4327c0ddf91c2cc529f5cf1c6`.
Its old draft is not eligible as-is: it rewrites the operator-owned provider
registry, omits mandatory `--provider-home`, directly executes host CLIs rather
than the required Bubblewrap no-network children, and does not exercise the
production handler/schema projection. The next safe boundary is a fresh exact
provider-census candidate that removes those defects without touching any
predecessor-owned path.

## Live continuation update — provider-census candidate refused

Independent review refused candidate
`sha256:57eff2eddc5bd657d6b73373ea051862a352f287c4f5c7f76f093309586c4428`;
it has not been integrated and none of its passing focused receipts establishes
provider-census completion. Three coupled defects must be corrected together
before a replacement candidate is derived:

- the graph declares `src/commands/providers.ts` predecessor-owned and forbids
  leaf rewrites, but still includes that path in the provider-census write set;
  the operator packet reserved help text without installing the corresponding
  static host dispatcher;
- the candidate launches Codex and Claude directly with scrubbed environment
  variables but without a private network namespace or filesystem projection,
  contradicting the no-contact work boundary; and
- the selected checks cover pure census and injected parser fixtures but not
  the registered handler, exact scope/completion refusal, bounded result
  projection or either new closed output schema.

The next safe correction is graph-first: move the shared provider dispatcher
path exclusively to `operator-observability`, remove it from provider census,
define an explicit owner-selected provider-state root and a Bubblewrap
`--unshare-net` local-metadata boundary, and extend the existing focused host
validation to exercise the production handler factory and validate both output
schemas. Re-realise the affected predecessor first, then derive a fresh
provider-census basis and candidate from clean preimages. Do not integrate or
push `57eff...`, and do not reinterpret installed executables, login status or
catalogue rows as entitlement, inference availability or qualification.

The graph-first correction now rederives semantic digest
`sha256:1fedd3bdc159f1ad972e3d14d5e17d4e5a3c341b0e76acf411251d70127c072c`.
Current operator construction authority is
`evidence/construction-authority/1f44e8c8f3089eb470b3d17004b48ae6d02aec614965206dedd8156f04aea17a.json`.
Replacement operator candidate
`sha256:825f012be5799b4f9f19cd302302436f676e9e7c7e88cfdbfdba3bf19af901e7`
changes only static help, the predecessor-owned provider dispatcher and its
existing registry contract test; its graph-selected check passed. Its first
detached integration dry-run correctly refused with
`INTEGRATION_DETACHED_BASIS_MISMATCH` because this semantic model and grant had
not yet been committed. Commit only that semantic authority carrier, obtain the
pending independent candidate verdict, then rerun dry-run and ordinary local
integration; this refusal is not a candidate-validation failure.

## Live continuation update — executable provider-leaf dispatch correction

Independent verification subsequently refused operator candidate `825f...`:
its confined check proved help metadata and source text but did not execute the
graph-required lazy host dispatch, exact argument/root forwarding or absent-leaf
proofblock. The later integration intent did correctly authenticate committed
carrier `c59efe8` and reach `prepared-commit`; content-addressed construction
basis predating that commit was not itself stale. No ordinary integration was
performed, so `825f...` remains unintegrated.

Candidate `f93bf002ab4ed7bd5a7e138cc120543680cfa7f18afe84d6bb469c59b0366343`
was a diagnostic replacement only. Its graph-selected check refused because a
direct test import of the monolithic provider command required the provider
runtime closure that the confined operator validation intentionally excludes.
It is not eligible for integration.

The current graph-first correction assigns one small predecessor-owned
`src/commands/provider-leaf-dispatch.ts` boundary to `operator-observability`.
The production provider registry delegates host and receipt selection through
that boundary. Its existing confined contract test must prove zero eager module
loads, exact leaf argument and repository-root forwarding, and exact
`PROVIDERS_HOST_PROOFBLOCKED` refusal for the authenticated absent module URL.
Provider-census continues to own only its host leaf, provider-root containment,
schemas and result projection; later feature packets cannot reopen either
operator-owned registry path. Re-derive operator construction authority from
this semantic model. That construction publication is now current at
`evidence/construction-authority/5bc7aabaa8b58dc3f32d5bf38ee0ec3a32980d63921fbbc58eab871ddd15b9de.json`;
the resulting semantic digest is
`sha256:ee27b5a6651f9952d20136c9e4d2728acbf164e2c0cbbcbb3ea06a7168ac17d6`
and operator construction is active. Commit this semantic carrier, materialise
a fresh isolated candidate, obtain independent verification, then integrate
and republish operator completion before resuming provider-census.

## Live continuation update — module presence is not leaf authority

Independent verification refused replacement candidate `57a638...` despite its
passing confined check and dry-run integration. The candidate correctly proved
lazy loading, forwarding and absent-module refusal, but its production default
would import any matching file present in the primary workspace. An untracked
future `src/commands/provider-receipts.ts` draft already exists, so module
presence could execute unqualified bytes before their owning work completed.
No ordinary integration was performed.

The next correction remains graph-first and file-authoritative rather than
GitHub-dependent. Before importing a host or receipt leaf, the operator-owned
boundary must parse the exact explicit profile/manifest and require current
`verified-complete` status for respectively `urn:usf:work:provider-census` or
`urn:usf:work:provider-account-tier-receipt`. Because completion currentness is
bound to the exact scoped file preimages, an untracked, modified, merely
integrated, stale or incomplete leaf stays proofblocked without needing a push
or remote check. The existing compact contract test must add one
present-but-unqualified case and prove the feature loader remains unused.
Current operator construction publication is
`evidence/construction-authority/f52f8d5c0a161b221ab98e879d65401e430d9d02ebfa1ffda94d625a5941a413.json`
and the resulting semantic digest is
`sha256:dcfe054a1c33b16bcf783ced545be003c9e44721d3d3b28a7e5f46eddee8647d`.
Commit this semantic carrier, create and independently verify a fresh
candidate, and only then integrate.

## Live continuation update — bind leaf authority and imported bytes

The module-presence carrier was committed as `3257bfe`, but independent review
refused its first candidate `b2bd8f...`; no ordinary integration occurred.
Although the implementation checked completion before a lazy import, it
derived authority from the caller-selected repository while resolving the
module relative to the CLI implementation. A different checkout could
therefore supply a completed graph while this checkout supplied different leaf
bytes. The focused test also substituted the authorizer and did not execute the
production completion decision.

The graph now closes both defects without putting a serial lock in the provider
runtime. The decomposed production boundary owns the immutable host/receipt
mapping and exact scope/completion decision. It must bind the selected root to
its implementation root and take the existing primary-mutation lock in shared
mode only across final completion derivation, exact executable dependency
closure authentication and same-root import. Multiple readers remain
concurrent, the lock is released before the leaf handler, and provider
inference never takes it. This is the repository's cooperative single-writer
boundary; arbitrary same-UID writes that bypass USF mutation authority are not
supported concurrency. Leaf-owning validation separately proves imports have
no external-contact side effects.

Publish fresh operator construction authority for this semantic preimage,
then generate one replacement candidate. Its existing compact contract test
must execute the exported production authorizer and shared import boundary,
cover cross-root and dependency drift plus present-but-unqualified refusal
before loader use, and preserve exact forwarding/ordinary laziness. Do not
expand the operator validation into the monolithic provider runtime and do not
contact a provider.

That construction authority is now published at
`evidence/construction-authority/0bc9189b551f008faf5013758acd8a842a3bed3f6ab2b97504a29a5d039f2b6c.json`;
its resulting semantic digest is
`sha256:684f6ab7d4072265fbae81735a587cb6dae2c835a84b9bf9a5720e9c825aef55`.
Commit this exact graph/handover/receipt carrier before generating the
replacement candidate.

## Live continuation update — one-time provider registry closure

The shared CLI correction is now graph-defined rather than tribal. Exact
requirement `urn:usf:requirement:operator-provider-command-reservation` binds
`operator-observability` as owner, closes the static `providers` tree over
`census`, `status`, `aliases`, the `host` group and `host census`, plus the
`receipt` group and its `acquire`/`verify` leaves. It binds the exact CLI,
dispatcher, help and provider-registry paths and states that later leaf
implementations may not rewrite predecessor-owned paths. The host-census and
receipt command resources reference this immutable reservation. Provider census
no longer owns `src/commands/help.ts`; it continues to depend on current
operator completion.

The isolated operator candidate
`sha256:bc19a02c6d064762fd4e73d26c9cd7f78cc9ce2adb331327ac91794a78cd9095`
adds both `usf help providers host` and the graph-gated
`usf help providers host census` leaf plus one existing-registry assertion. Its
graph-selected operator check passed. After local semantic commit `f18567a`,
detached dry-run and integration passed without weakening basis authentication;
the observed carrier is `a2d2d7a`. Current operator construction publication
is `evidence/construction-authority/5a965b47a017dc005d96f38a1884beeab75103baad8f9cdc1a3134a095973798.json`
and current completion publication is
`evidence/work-completion/36b8282173f18afc9994b07350d97e969babd196e87cead5e0756c6298dfb02b.json`.
Provider census is dependency-ready with active construction publication
`evidence/construction-authority/f63db154f0fad11a9df2ecff8fc918199ab3be34b40e9c4e8a5f4dad1c4fd5f6.json`,
basis `sha256:28ab3de814e0c57f07de7751d1c19f7d4ffcd882452bb46fd948745bf0cfea06`.
The earlier `0c405e...` grant remains a valid historical receipt but became
stale when its owned topology test was restored from the desired dirty
postimage to the committed preimage. Future construction chains must first
restore every owned path to the intended carrier preimage, then derive the
grant, and only then express desired bytes in a contribution; never derive
authority from an already-applied dirty postimage.
Materialise and validate that packet next, including both graph-selected
validation obligations and the corrected topology assertion, before pushing
the coherent chain.

The account-receipt schemas remove unsupported `format: uri` while retaining
bounded HTTPS patterns and runtime exact endpoint validation. Their required
`maxLength`/`uniqueItems` validator support remains deferred until a graph owner
is active; it was removed from the primary runtime after it changed operator
validation authority outside the active write set. The focused provider
topology draft is 11/11 after replacing the false “every operational contract
is a profile root” assertion with exact implementing-work reachability and
reciprocal scoped dependency checks; it now belongs to the active
provider-census packet and is not yet a completion claim.

One additional deterministic CLI defect was observed while materialising the
operator candidate: JSON parsing makes a wire `RealisationBasis` mutable, but
`usf resolve` passes it directly to the strict in-process resolver, which
requires a recursively frozen canonical basis. The command therefore emits an
opaque `INTERNAL_ERROR`/`BASIS_NOT_IMMUTABLE`. The correct registered repair is
to reconstruct every wire basis with `parseRealisationBasis`, retain the strict
core resolver, and return a stable input/currentness refusal on reconstruction
failure. The current ignored bridge performed that exact reconstruction before
calling the existing resolver and then used registered `usf apply`; it carries
no authority beyond the subsequent graph-selected check. This defect and the
still-missing `usf resolve --input -` form must be closed before unattended BAU.

The resumed operator materialisation exposed the more general registered-input
ceiling. The current operator `usf work` projection is 103,737 bytes; the
isolated provider dispatcher, help and compact contract-test postimages are
31,340, 61,536 and 27,606 bytes respectively, for a 224,219-byte assignment
before JSON envelope overhead. Passing that legitimate assignment through the
documented single-argument `usf call '<JSON>'` form fails in the invoking shell
with `Argument list too long`. Linux reports a larger aggregate `ARG_MAX`, but
one argument remains bounded near 128 KiB on this host, so aggregate capacity
does not make the interface usable. This is a deterministic Unix composition
defect on the critical path, not provider failure, test hardening or a reason to
use another ignored bridge.

`usf apply`, `route` and `probe semantic` already establish the appropriate
repository convention: at most 4 MiB of fatal-UTF-8 JSON, either bounded stdin
selected by `--input -` or an explicit ignored owner-private mode-0600 regular
non-symlink `.usf/inputs/*.json` file authenticated by same-root, descriptor and
stable-read checks. `call` and `resolve` must expose the same registered carrier,
retain bounded inline JSON only for compatibility, reconstruct wire bases
before strict call/resolution logic, and preserve their current no-contact and
no-authority effects. `resolve --input` must accept a complete successful
`urn:usf:call-result:1` envelope as well as the legacy contribution array, and
must refuse partial or failed call envelopes without dropping failures. One
compact command-contract table must cover file, stdin, legacy,
oversize/unsafe-file and malformed/thawed-basis behavior; do not create a new
matrix per provider or model.

Full imported-manifest readback resolves the owner without a new profile root.
Historical `urn:usf:work:realisation-basis-chain` owns `call`, `resolve` and help
only under `urn:usf:profile:v3-semantic-first:1`; profile-3
`provider-parallel-execution` currently owns `call` but is downstream and
proofblocked; and `resolve` otherwise has no profile-3 owner. The existing
`operator-observability` packet is already the profile-3 predecessor for shared
CLI registry/help work and, through imported `graph/usf-bootstrap.nq`, already
owns `help.ts`, `dispatcher.ts` and `cli.ts`; its provider-pipeline extension
adds the two provider registry modules. Therefore the smallest correction is to
extend that already-selected operator contract/work with generic composable
`call`/`resolve` carriage and one reusable command-input module, remove generic
`call.ts` ownership from the later parallel leaf, and put later parallel behavior
behind a leaf module that depends on completed operator authority. Profile
membership and version remain unchanged, so only the operator and its explicit
dependants require fresh scoped authority. Do not reopen the historical
bootstrap packet or treat profile-wide sibling content as a dependency.

Independent review of this remodel also exposed one earlier validation-scope
error before it could be carried forward. The profile-3 provider-leaf boundary
case had been appended to the shared
`tests/contract/operator-observability.test.ts`; its generic registry case also
read `src/commands/providers.ts`. Consequently the authoritative profile-2
reconstruction attempted to execute and read profile-3 code outside its
historical two-file validation runtime closure and refused with `CHECK_FAILED`.
Do not expand that historical closure or duplicate the case. The current
profile-3 operator packet must move the existing provider-leaf case and its
registration-source assertions intact into one profile-3-only graph-selected
test, restore the shared historical file to its generic public operator
boundary, and bind the moved test to its own no-contact operator validation.
This is a semantic ownership correction, not test growth:
the number of behavioral cases remains unchanged, and profile-2 and profile-3
again authenticate only their own selected validation closures.

The follow-up adversarial pass found and the same semantic slice now closes
four related ownership/interface gaps. Composable input uses the new
profile-3-only `tests/contract/operator-composable-input.test.ts`, not the
historical `fake-call-resolve` file. File inputs are exact direct children whose
lexical and canonical paths agree, with owner/mode/single-link/no-follow and
stable pre/open/post descriptor identity plus an incremental max-plus-one read.
The registered composable chain accepts only a schema-valid complete `ok` call
envelope with no failures, exact metrics cardinality and one equal basis across
the envelope and every contribution; a bare array remains manual non-batch
compatibility and cannot evidence batch completeness. Versioned generic
`call:2` and `resolve:2` command resources now bind exact bounded input modes,
effects, refusals and closed tracked call/resolve result schemas.

The operator also owns one reusable `graph-leaf-dispatch.ts` and the closed
`call`, `call parallel`, `call compare` tree. Future parallel/compare leaves
must receive explicit command-line profile and manifest scope; payload content
grants no authority. Before import or contact the gate holds the shared primary
mutation lock across same-root current-basis/work-completion readback, unique
typed production-closure authentication, lazy import and handler-byte
reauthentication, then releases it before inference. No-contact bootstrap call
and manual resolve mint no authority; `apply` remains the exact current-basis
write gate. This avoids binding ordinary local composition to broad graph
runtime imports while leaving no stale-basis route to provider contact.

The current profile-digest implementation also remains sibling-membership
sensitive: adding a valid `selectsContract` edge changes the whole profile
resource digest and therefore every selected work basis. Sibling contract
content is isolated, but profile membership movement is not. Do not add
secondary operational contracts as redundant profile roots to work around
this. They remain current through reciprocal implementing-work dependencies.
A later versioned currentness migration must separate profile structure,
per-work membership-edge and complete-set topology digests; this is recorded as
a non-blocking defect and must not delay the provider proof.

## Live continuation update — complete validation-set integration

The graph-authorized integration runtime correction is committed and pushed as
`2b0c85b2d3da95cd542f29b1e34e36c3d29aae81`. It changes only
`src/realisation/transition.ts` and
`tests/unit/realisation/workspace.test.ts`. Candidate receipts remain the
scalar version-1 receipt executed under transition version 2; the integrated
postimage runtime is version 3 and accepts the complete nonempty set of
graph-required validations in canonical UTF-8 order. It binds per-candidate
receipt-set digests/cardinality, refuses missing, extra and duplicate
obligations/results, preserves exact per-work currentness, and does not scan
ignored receipt directories.

The final immutable candidate was
`sha256:0c97ea1d5f182b148478faa264068cb2d51ec78a3df2911e4c2ce1dfce619cd9`.
Its graph-selected check receipt was
`sha256:ee70c09105d31dfd412b1f275f4758ba41440f83a8d945b784fb518cfef6dd00`.
Dry-run request
`sha256:35c91827c9c57f7c3c90fb4ca8197a44556159b1213e3e3a752e231c0760aa2a`
prepared the exact carrier later integrated. The focused carrier suite passed
6/6, TypeScript passed, an independent read-only review found no blocker, and
an offline standalone local clone of the exact commit passed the clean full
suite 193/193 plus containment. A Git linked-worktree is not a valid substitute
for this clean-carrier qualification because `bootstrap-carrier` intentionally
refuses a separate or file-backed Git directory.

The primary workspace still contains the later provider packet and no part of
that packet entered `2b0c85b`. Running the full gate over that deliberately
dirty combined state passed 196/198 and assigned both failures to the provider
packet:

- provider-census currently rewrites `src/commands/help.ts`, which overlaps the
  completed operator-observability currentness surface; and
- the later account-receipt packet's
  `schemas/account-source-authorization.schema.json` and
  `schemas/account-tier-receipt.schema.json` use an unsupported JSON Schema
  `format` for `endpointIdentity`; this is not a provider-census schema defect.

Both findings are now corrected in the live primary packet; do not amend or
patch the already-qualified integration carrier. The ordinary correction
chain is now fixed as `usf status` / exact `usf work` readback, reason-code
classification, graph-first closure correction when required, fresh immutable
`resolve -> apply`, one `usf check` per graph-selected validation,
`usf integrate --dry-run`, exact standalone-carrier verification, then
`usf integrate`. The local `usf-v3-operator` skill records this sequence and
the linked-worktree qualification refusal. It remains advisory and is not a
repository or third-party runtime dependency.

Three CLI gaps remain explicit rather than tribal: the `usf resolve` JSON
boundary must reconstruct canonical immutable bases, large contributions need
registered `usf resolve --input -`, and repeated BAU carrier qualification
needs a graph-authorized `usf` carrier-verification command. Until those
interfaces exist, the documented deterministic implementation bridges carry
no authority beyond the exact graph checks they invoke.

The next exact action is to rederive the provider-census packet against this
version-3 integration runtime, correct the two provider findings at their
graph/schema owners, materialise the reviewed subscription-host census draft as
a fresh candidate, run every graph-selected validation receipt, and integrate
one coherent provider checkpoint. Only then continue to trusted account-tier
receipt acquisition, scrubbed adapter invocation, authenticated answers,
genuine hidden-holdout qualification and the live qualified-pool parallel
semantic-token proof.

## Live continuation update — provider census integrated and completion published

Fresh provider-census candidate
`sha256:bd56f239b0d51fc510b121ac5cdd196eeb27bbd04f93b51277be7a6e48acd9f3`
is bound to current basis
`sha256:9595ebf8cda411cb7f922c33afea22e1e9538ba4327c0ddf91c2cc529f5cf1c6`
and changes exactly six graph-authorized paths: the two host-census schemas,
the host command, the subscription-host implementation, the existing provider
command contract test and the focused subscription-host integration test. It
does not touch either predecessor-owned provider registry path or any later
account, adapter, answer, qualification or parallel-run draft.

Both graph-selected validations pass from the immutable candidate. The
subscription-host authorization receipt is
`sha256:27e7f021095c79f471356fd637a0cdeaa8299a9cc84987922866b520dceeac1c`;
the provider-census receipt is
`sha256:d642687962ba68bca85bb82ba621f9b8359bac72bd87d0ee276fb7ca897889e1`.
A disposable detached full-carrier TypeScript check and `git diff --check`
both exit zero. Independent read-only verification accepted the six-path
scope, exact currentness, mandatory explicit provider root, closed-schema
projection, bounded result truncation, Codex initialize/initialized/model-list
protocol, honest partial pagination, Claude help-derived aliases and
Bubblewrap user/PID/network/filesystem/environment containment. That review
did not execute host metadata children or contact a provider.

Both independent read-only reviews accepted the candidate. Integration request
`sha256:f9ede620c74eb11d0498a8614f40202afcd7fb0505594dbf9d646279aa4532b2`
reauthenticated both required receipts, passed both postimage validations and
created integration carrier `7c200f875f33cf780290f186b66415ecaa293c99`;
integration observation digest is
`sha256:082d5e973199a5dc0148e4988c3e83c9a4a6953d257553599e61f0d904b7fb26`.
Primary-tree TypeScript exits zero. Before completion publication, registered
`usf providers host census` refused with `PROVIDERS_HOST_PROOFBLOCKED` before
catalogue read or host observation.

Postintegration construction publication
`evidence/construction-authority/ce6e1e540352d1ce66e899611ab5b8b880ee89eacfbba9db722a87f730647e62.json`
has receipt digest
`sha256:44985feb2b3b7fe00d86b832fdfbdc6842efcb831c2163b5d8630b7dce5cb547`.
No-change candidate
`sha256:e9a006dcd6a5586e1b275791ddb2838f04fae10d00c1417885927e7ace61d303`
passed both exact validations with receipt digests
`sha256:2d6e958a007f022afa38dd55b1c6af839fd0d82bf98148eada473c2207014849`
and
`sha256:e5801d0d3ec400337b5f3df47e083f8a717e49ae3b45cc6907d52472fcdc4257`.
Work-completion publication
`evidence/work-completion/c0ddedfc3a40e4d5a411277e7ec45fe3a5ad230f644e92ab99b884f79a5aa29f.json`
has receipt digest
`sha256:b445557ed35d97c8f077ff6b12e7931bf46063ad3f60e3e0424438490f0343c9`
and resulting semantic digest
`sha256:084c80e936173cdc14fd64ba149a8d201b224cfb1cc4b083f889a55d2bb9d1cb`.
Registered work read-back now reports the provider-census permission active and
its completion accepted. Independent receipt and graph reauthentication also
accepted the exact one-member construction and completion publications, the
no-change candidate and its two-validation receipt set. It independently
confirmed that provider account-tier receipt is graph-defined but not yet
construction-eligible.

The first registered production invocation against explicit provider root
`/home/user` then refused safely with
`PROVIDERS_HOST_DEPENDENCY_REFUSED` before catalogue read, host child launch,
credential projection or provider contact. The current work projection contains
62 repository dependency entries over 60 paths. `package.json` appears once as
`file` and once as `tool`; `schemas/provider-census-result.schema.json` appears
once as `file` and once as `schema`; each repeated path has the same exact
digest. The operator-owned leaf boundary currently treats every repeated path
role as a conflicting duplicate instead of canonicalizing the one path/digest
identity, so the complete real work packet cannot pass although the focused
fixture used only one role per path. Do not bypass this gate or run host CLIs
directly. Audit the remaining production path once, clarify same-path/same-
digest role normalization and conflicting-digest refusal in semantic authority,
then realise the smallest operator-owned correction and republish its affected
completion chain before retrying this registered command. Installed executable,
authentication metadata and model listing will remain census facts, not
entitlement, inference availability, semantic qualification or live-provider
proof.

The following packet is still provider account-tier receipt acquisition, not
adapter or inference work. Its current draft also exposes a real owner-ordering
gate: the account schemas require `maxLength` and `uniqueItems`, while the
current custom schema validator does not support those keywords, and the graph
contains no sufficient content-verifying account-source parser for the two
configured direct routes. Resolve those facts at their graph owners after
provider-census completion; do not weaken the schemas or treat the explicitly
insufficient OpenRouter mapping as a trusted account receipt.

## Verified carrier and gate

- The optional Hermes authority baseline is
  `b93026d876d3a6ef8ef08b053d4c0d255cdaf96b`; the bounded recovery-tooling
  checkpoint is `d974570dbe608503ffd94ccbf9ede9eeb06f4d18`.
- The committed and pushed semantic-first model checkpoint is
  `a90228fdb545fab0d031e5db7f713f489247907c`
  (`feat: define semantic-first authority model`). The exact gate was then
  applied, independently replayed, committed and pushed as
  `846c5bbf36c1e9cb022a05bb90a7c0b950c0525a`
  (`feat: admit semantic-first realisation gate`), with
  `HEAD == origin/main` at that checkpoint.
- The tracked receipt is
  `evidence/semantic-first-bootstrap-admission.json`; its canonical
  `receiptDigest` is
  `sha256:87c9a1fe5169fa7b3b71f2c5293cef40e717e34b3b19b4f6b0f4700b3021568e`.
  The exact post-transition semantic digest was
  `sha256:048b0ccdeb660901f465ada4eeb4a295f88d260fbdfcc770eca142918982886e`.
- The full dirty-post authoritative suite passed 173/173 at that checkpoint,
  and containment/diff/readback checks passed. Those observations establish
  only the admitted gate boundary; rerun affected and full checks on later
  bytes before each coherent checkpoint.
- Earlier bootstrap receipts that bound this handover remain immutable
  historical observations. Current ordinary work packets do not include this
  checkpoint narrative in their read/write basis, so routine continuation notes
  cannot serialize construction or force reproof.
- The local integration authority model was committed and pushed as
  `1df0d028fa41fefc92ae61450d06f97e53f08de7`; its implementation was then
  independently verified, committed and pushed as
  `081129f0101707c75b87f5318d9336303f4f6bc5`
  (`feat: implement local candidate integration`), tree
  `d3c5bdb8d31c80170506ece93cd285633eff43ab`. At that checkpoint
  `HEAD == origin/main`, the full authoritative suite passed 181/181,
  containment passed and `git diff --check` passed. These facts establish the
  local observation-only tool boundary, not completion authority.
- Historical-carrier authority was independently reviewed, amended, committed
  and pushed as `59d2699a6b0037e4bb7ddf543a61dae99093fa83`
  (`feat: define historical carrier adoption authority`). The coherent command
  implementation was independently verified, committed and pushed as
  `fc404700b3762bde4cc466b5245abbcd5c91f9ab`
  (`feat: implement historical carrier adoption`). The three immutable
  observations were then committed and pushed together as
  `85c2da48a16f6bbf6b7a002e11f9385fb71afc7e`
  (`chore: record historical carrier observations`). At that boundary local
  and remote `main` matched.

The handover previously stopped at the provider slice and reported 156 tests.
That was stale after the semantic-recovery commits. This version supersedes it.

## Historical superseded provider-profile checkpoint (not current authority)

This retained snapshot predates the current provider-leaf correction chain.
Its reported semantic digest, receipt identities, completion status,
denominators and test timing are historical observations only. They neither
establish current profile-3 authority nor provider-census completion; the live
continuation update above and registered CLI read-back control.

The exact provider profile selects nine in-scope work packets and thirteen
contracts. It deliberately does not reproject the one-time imported
semantic-first bootstrap or foreground-lifecycle construction scopes as
concurrent writers; omission is neither a completion claim nor removal of the
semantic-first policy or `usf start`/`usf stop` capability. This selection rule
is proved only for `urn:usf:profile:v3-self-host:3`; older, Hermes and product
profiles must apply the same discipline or refuse their own overlap before a
Hermes lifecycle demonstration.

The current registered `usf work` projection has nine packets, seven dependency
edges, four roots and three sinks. It has no cycles, missing selected
dependencies, unreachable selected packets, write/write collisions,
undeclared producer-consumer currentness edges or successor writes into
ancestor currentness. The authenticated-answer operation is jointly
implemented by the invocation boundary, hidden evaluator and semantic
qualification packets. The first two remain parallel; semantic qualification
is their necessary join and owns the route-qualification output schema.
Operational contracts are reciprocal scoped dependencies of every implementing
packet, so their movement cannot remain silently current.

Current profile-3 authority is additive and file-backed:

- operator construction receipt
  `evidence/construction-authority/d2171bfacc36d0c46a29b7fee393fb72765c98e6a6b3a3876eeaa1f279b6801c.json`,
  receipt digest
  `sha256:16c64fb95c5f5d5147dead1e46b4a54cd5cce726d1a3bdb53d1d760f1f926ced`;
- operator completion receipt
  `evidence/work-completion/3746ef423b1b8c7cb74fd81f38d9b60e279c00d6f7793c8b8f6c0194fd8a8959.json`,
  receipt digest
  `sha256:2821d02cfddc27e3cb371bd95bb265c14e29cfc28406e7591e5a452c93b59085`;
- provider-census construction receipt
  `evidence/construction-authority/d9d6aea24efcaeff17a426e66e3e01b225fe69cd7661cf7accab2b79c1cb19d5.json`,
  receipt digest
  `sha256:7063f9bd5efaae5cc8031ab8f51ca1523259d67ca7058e62bae4a3fae34c6282`;
  and
- provider-census completion receipt
  `evidence/work-completion/8a8dda58f6e78e4f7cc497bb3331dd0ffab6bc3c3344885d08ed2e90982bab52.json`,
  receipt digest
  `sha256:6b3c830bc310388e576ce00a1f046f766ad9c7061cae6e91c4aa78a747238223`.

The current provider-profile semantic digest is
`sha256:de739639b0a3b8ba53f7b2f7002e74690e619816ef9079ca2370908292d25e87`.
The current operator and census scoped dependency digests are respectively
`sha256:032a33ad6f121570746d42ead24037c4fe4d44eebb399d708b92e5a3bed137a0`
and
`sha256:5d3d6fe02278b8c9a858086acf9f91be0476a7c3ca07292f491433accf182109`.
Re-derive these values through the registered commands after any relevant
movement; this narrative is not authority.

The provider census is a no-contact denominator, not a live provider table. At
this boundary it reports 211 catalogue provider routes, 7,488 catalogue model
routes, 3,834 underlying models, 171 underlying families, 208 catalogue
credential names, 24 reviewed legacy credential names, seven reviewed legacy
provider observations, two configured direct routes and three host transports.
Both configured routes remain `availability: unknown`, `UNQUALIFIED` and
excluded. Claude and Codex host transports are observations only; neither is a
qualified route. No credential value was read and no provider/account endpoint
was contacted.

The external-root authoritative run passed 192/192: test-runner duration
23.14 seconds and full command duration 28.2 seconds. Containment and
`git diff --check` passed. The pnpm hermetic correction is intentional: an
isolated workspace must receive authenticated read-only aliases for both
`node_modules` and its relative `.usf/cache` virtual store. Testing with an
external `TMPDIR` prevents accidental success through ancestor module
resolution. Only those authenticated dependency roots are projected read-only
into freshly created empty local mountpoints; the correction adds no network,
child-process or writable scope. These observations prove the local checkpoint only; no live
provider, multi-provider overlap, semantic-token reduction, full recovery,
Hermes-Agent execution, ANQR, staging, production or terminal proof is claimed.

## Earlier profile-scoped authority and completion history

The graph-defined `realise no-change`, `evidence completion`, `prove
completion` and `publish work-completion` commands are implemented as separate
Unix-composable stages. They preserve one exact versioned profile and
RealisationBasis, use an owner-private Git-less workspace, require every
graph-selected confined check receipt, and publish only additive file-backed
no-change receipt, Evidence and ProofResult records. An empty delta alone never
establishes completion, and no-change candidates cannot enter ordinary Git
integration.

The reproducible registered sequence for an already-realised packet is:

```sh
./bin/usf realise no-change --work WORK_IRI --profile PROFILE_IRI --manifest MANIFEST
./bin/usf check --candidate CANDIDATE_DIGEST --validation VALIDATION_IRI
./bin/usf evidence completion --candidate CANDIDATE_DIGEST --work WORK_IRI --profile PROFILE_IRI --manifest MANIFEST --output EVIDENCE_PATH
./bin/usf prove completion --obligation OBLIGATION_IRI --evidence EVIDENCE_PATH --profile PROFILE_IRI --manifest MANIFEST --output BUNDLE_PATH
./bin/usf publish work-completion --bundle BUNDLE_PATH --profile PROFILE_IRI --manifest MANIFEST --verify
./bin/usf publish work-completion --bundle BUNDLE_PATH --profile PROFILE_IRI --manifest MANIFEST --apply
```

Run every graph-selected validation, not a caller-invented subset. Do not use an
empty generic `call`, `resolve` or `apply` operation to represent no change:
the registered positive no-change command materialises and authenticates the
complete current basis scope. Completion bundles may share one publication
only when their selected work-scoped authority, manifest/source digests and
publication boundaries are compatible; otherwise verify and publish each
bundle independently.

The current tracked transition receipts are:

- `repository-path-scope` construction:
  `evidence/construction-authority/d612320c71976e3e1d4e9b68fac4497e9f3f1300738206699dd47c8434c57818.json`,
  receipt digest
  `sha256:02b54736b1cd28f737fc48c7316e556e9515f6f59bbacf60dc309387803a8779`;
- `repository-path-scope` completion:
  `evidence/work-completion/11bede32d3b63416112d0db226eeca3a832127b364b77b5fd435230f9ddd0dd4.json`,
  receipt digest
  `sha256:fac67f856c3b600c0a426346847fe98465bc74f35e7fd7c8f27ccc2d950a9d31`;
- `file-asset-index` construction:
  `evidence/construction-authority/15736720300d102709d7bbd3ad19a6893be3c3025b654aa086d331a017391d6b.json`,
  receipt digest
  `sha256:fd4a1f8accd527545d7145e1990f3c1f93da23a3b8c32fab9880c80de79fc178`;
- `file-asset-index` completion:
  `evidence/work-completion/195bb00a55534790a11f9220a28b7d51cb16ce4e6dacdb483e8f7ae53d001467.json`,
  receipt digest
  `sha256:60c243edb0ea1bfa104aa6af817db653fd32897b2dad1af5cc6639bd314c792e`;
- `operator-observability` construction under
  `urn:usf:profile:v3-self-host:2`:
  `evidence/construction-authority/22c8c7284f35cdcec0c0088ea825e7d9d1e3d007cc2f0e6ab9efe4e2c283936a.json`,
  receipt digest
  `sha256:cb263ed61a811d78ed65f9738c132500d5d9da4e7dbcbfed7931320eecbfaedd`;
  and
- `operator-observability` completion:
  `evidence/work-completion/6e93007a7acfa1c89097ad1f02f3a17395dc7968657fffc0359b039ee8dd87ee.json`,
  receipt digest
  `sha256:2dfff9fe38fd65036215d93bf7f46e457840d337af7e9ee8032077298c1032fc`.

At that earlier checkpoint, exact `usf work` readback reported all three
packets at `verified-complete` in their then-selected profiles. The integration
profile semantic digest was
`sha256:37d21d45ddbbd8226cecf6cc9cc26ddb613597e42750bbbc73fa2bae8c68260f`;
the provider profile semantic digest is
`sha256:c589342acd9c8c764f6920109dea285ca4b46d1ea92c8464518dc303e63af4ca`.
Their RealisationBasis digests at that checkpoint were respectively
`sha256:7ba2d9687995c4116aaf9789e0fc413d68ef1d9e27ef6d74b1a55fd03805063d`,
`sha256:1d87bcde085c74383d0fbcae6058484793b133a069f6a89a2892bce9fac52140`
and
`sha256:669f4aa9b24aea6ef3f5be89a87479a5e16f22b9727483d4ab0f80b6d8079c69`.
The final TypeScript plus authoritative suite passed 188/188, containment
returned `status: pass`, and `git diff --check` passed after the last functional
change and receipt publication. A handover-only update then left all three
semantic, basis and scoped-dependency digests unchanged and all three stages at
`verified-complete`. These records establish only the local completion
boundary; no provider, ANQR, staging, production, Hermes-Agent or terminal
proof is claimed.

## Current graph authority

The product-neutral Hermes profile/facade packet and isolated ANQR binding are
now derivable through only the registered commands:

```sh
./bin/usf query \
  --iri urn:usf:profile:v3-self-host-hermes:1 \
  --manifest graph/manifests/self-host-hermes.json

./bin/usf query \
  --iri urn:anqr:intent:hermes-bau:1 \
  --manifest graph/products/anqr/hermes-manifest.json

./bin/usf work \
  --selector urn:usf:work:hermes-management-facade \
  --max-items 10 \
  --manifest graph/manifests/self-host-hermes.json

./bin/usf work \
  --selector profile:urn:anqr:profile:hermes-bau:1 \
  --max-items 20 \
  --manifest graph/products/anqr/hermes-manifest.json

./bin/usf work \
  --selector urn:usf:work:hermes-bau-binding \
  --max-items 10 \
  --manifest graph/products/anqr/hermes-manifest.json
```

The profile imports the existing self-host/provider chain and adds
`urn:usf:contract:hermes-autonomous-management:1`. The reusable core manifest
remains product-free. The core packet contains no ANQR read path or objective.
The future tracked Hermes policy binds ANQR through its ordinary exact
`urn:anqr:profile:bau:1`, optional management profile
`urn:anqr:profile:hermes-bau:1`, operating intent and manifest rather than
copying ANQR triples into core. The exact ANQR binding packet refuses through
the core-only manifest.

The two Hermes packets remain authored implementation definitions, but they are
not currently active realisation permissions. Hermes facade work now depends on
`urn:usf:work:semantic-first-lifecycle-admission`; the ANQR binding remains
downstream of the facade. Their projected construction constraints prohibit
provider, credential and Hermes-Agent contact in this hermetic slice. They do
not authorize credential migration, Docker runtime wiring or changes to
provider qualification gates.

Do not treat semantic digests in this checkpoint narrative as authority. Re-derive the
current core and combined ANQR identities from their explicit versioned
profiles and manifests with the registered `usf query` and `usf work`
commands above after every authority change.

## Semantic-first authority boundary

The primary order is now explicit in `GOAL.md`, `AGENTS.md`,
`graph/foundation.nq`, `graph/semantic-first.nq` and decision 0008:

```text
semantic model
  -> deterministic remodel and scoped currentness
  -> admitted evidence
  -> deterministic proof
  -> proof-warranted contract activation
  -> realisation
  -> validation
```

Validation feeds a later evidence, proof or significant remodel cycle; it does
not retroactively authorize build-first work. Every current profile declares
the semantic-order policy. Every current semantic contract separates
pre-realisation construction evidence/proof/permission from post-realisation
completion validation/evidence/proof. A permission never depends on candidate
observations that can exist only after the realisation it authorises.
Product-overlay permissions remain in the product graph and explicitly require
the core permission they narrow.

No existing test result or prior commit has been promoted by narration.
Ordinary permissions therefore remain `proofblocked`; their declared ceiling
grants no authority while inactive. The semantic-first gate has one graph-typed
exception, `urn:usf:exception:semantic-first-bootstrap:1`, bound to exactly its
three packets, deterministic fixtures, isolated writes and a `check` ceiling.
It explicitly prohibits provider/credential contact, integration, runtime
activation and historical-source mutation. Every semantic publication is also
prohibited except one exact self-closing authority-admission delta in
`graph/semantic-first.nq`. That delta is limited to the three named focused
evidence records, one aggregate proof result, activation of the ordinary gate
permission and closure of the exception itself; every extra subject, predicate,
graph, path or sibling effect refuses.
The admission must also emit the one closed tracked transition receipt at
`evidence/semantic-first-bootstrap-admission.json`, outside every semantic
manifest. It binds reversible exact source operations, the immutable pre-state
basis, and the independently recomputed expected post-state source and semantic
currentness. Verification reverses and replays the delta, so the exact admitted
mutation does not stale its own proof; any other relevant movement refuses.
The registered admission selects the graph-declared isolated authority profile,
not the broader self-host consumer profile:

```sh
./bin/usf publish bootstrap-transition \
  --profile urn:usf:profile:v3-semantic-first:1 \
  --manifest graph/manifests/self-host.json \
  --receipt evidence/semantic-first-bootstrap-admission.json \
  --verify
```

The exact packet was first applied in isolated replays, then applied and
verified in the primary repository before commit `846c5bb`. Do not apply it
again. Continue to use `--verify` for currentness readback. The
`urn:usf:profile:v3-self-host:1` and product profiles may consume the same core
currentness receipt through their required core permission, but they cannot
mint it or broaden its basis.
The executable gate, immutable realisation-basis propagation and exact-profile
CLI selection are implemented and focused-tested. At the exact committed
`846c5bb` boundary, its three member packets were
`checked-awaiting-integration`. Later immutable receipts retain that historical
state. Current ordinary work no longer binds handover movement as a functional
dependency. The generic
integration-transition verifier is implemented for isolated candidate
materialisation, graph-derived checks, detached Git integration,
postimage-basis derivation and postimage validation, but remains explicitly
proofblocked as completion authority because evidence admission, proof and
completion publication are separate unfinished stages. Neither the admission
receipt nor the active gate permission is completion proof, and neither unlocks
downstream work by itself.

## Integration and carrier-adoption boundary

The registered `apply`, `check` and `integrate` commands now provide the local
Unix-decomposed observation pipeline. `apply` writes only an ignored isolated
workspace; `check` writes an ignored content-bound receipt; `integrate` uses a
short-lived local Git worktree and a narrow final mutation lock, then emits an
ignored observation. It performs no evidence admission, proof, semantic
publication, push, GitHub, provider, runtime, staging or production effect.

The committed graph packet closes an operational gap in
`urn:usf:algorithm:bootstrap-carrier-adoption-transition:1`. Before this packet
the algorithm and receipt type existed, but no registered command, exact
validation edges, deterministic receipt paths, finite tracked-publication
permission or satisfiable absent-file record semantics existed. The modeled
interface is deliberately explicit:

```sh
./bin/usf bootstrap-carrier verify \
  --adoption ADOPTION_IRI \
  --profile VERSIONED_PROFILE_IRI \
  --manifest graph/manifests/integration.json

./bin/usf bootstrap-carrier adopt \
  --adoption ADOPTION_IRI \
  --profile VERSIONED_PROFILE_IRI \
  --manifest graph/manifests/integration.json
```

The command is implemented but remains proofblocked as completion authority.
`verify` may write only its exact ignored owner-private preparation receipt.
`adopt` repeats every verification without
trusting hidden prior state and may no-replace-create only one graph-declared
tracked `HistoricalCarrierObservation` under `evidence/historical-carriers/`.
That record is categorically not completion Evidence E: it repeats completion
`not-observed`, evidence `not-admitted`, proof `not-evaluated`, ordinary
permission `unchanged` and runtime `unchanged`.

The finite carrier denominator is now three:

- semantic-first gate carrier `846c5bb`, complete 54-path diff, 44 included
  and 10 explicitly excluded;
- repository-path-scope carrier `95bce10`, complete carrier denominator 100
  paths but an exact selected two-path subdiff only; the other 98 effects are
  unselected and unclassified, not silently adopted or called excluded; and
- integration-toolchain carrier `081129f`, complete ten-path diff bound to the
  existing integration-toolchain intent, not to ordinary work completion.

Added/deleted/absent path states are conditional. Added paths forbid fabricated
preimage digests and modes; deleted paths forbid fabricated postimages; an
absent point-in-time current file forbids current digest/mode fields. Historical
carrier identity and point-in-time currentness are separate: later ordinary
file or HEAD movement never rewrites the historical receipt, while consumers
rederive live scoped currentness. Adoption state is derived dynamically from
exact tracked receipt authentication, so no graph edit or commit is required
per receipt.

The adversarial authority repair makes that immutability executable rather
than narrative. Every receipt/set digest now has one exact graph source,
included/excluded projection, complete canonical JSON preimage and unsigned
UTF-8 byte order. This covers scoped path effects, carrier/current postimages,
adopted subjects, validation results, validation dependencies, empty failure
sets, nonclaims, scoped authority and the included-path aggregate currentness
rule. An absent tracked target may create one new observation; an existing
target is authenticated against its recorded historical Git basis and is never
regenerated from current files. Newly derived live currentness appears only in
the command result.

Historical validation is now deliberately smaller than current implementation
qualification. The semantic-first carrier retains its three existing focused
Node test obligations; repository-path-scope and integration-toolchain each
use one closed focused Node test command at the exact carrier commit/tree.
Every historical run is dependency-bound, scrubbed, no-network and may neither
fetch nor install. The full authoritative suite and containment check remain
one-time coherent implementation-checkpoint gates for the future command, not
work repeated per carrier receipt. This is a critical-path/test-economics
decision: it authenticates the three finite carriers needed to reach
`file-asset-index` and provider qualification without adding a per-carrier
suite or unrelated hardening matrix.

The tracked `HistoricalCarrierObservation` is the command's only durable
output. Ignored preparation, raw output, scratch, per-adoption locks and the
detached workspace, plus the matching unavoidable Git worktree
administration/private index, are bounded transient state and are removed
before success; primary refs and the primary index never move. The shared
`.usf/locks/primary-mutation.lock` inode persists so concurrent flock users
cannot split coordination; only its ownership is released. The implementation
intent may minimally reuse or export the existing Git/lock/publication/confinement primitives in
`src/realisation/transition.ts`, but authorizes no generic refactor. Raw Git
verification disables replacement objects and rejects graft, shallow,
alternate, partial-clone, promisor and filter effects; it verifies the exact
single parent, tree and blob bytes locally with no fetch.

The implementation exposed and corrected one semantic defect before receipt
publication. Two historical carriers predate
`graph/manifests/integration.json`, so requiring that later manifest and its
entire source/import closure to exist in each historical tree was impossible
and would have made unrelated graph bytes a perpetual reproof dependency.
Historical `carrier-file` dependencies now contain the exact validation tests
and declared receipt/schema inputs actually present in the carrier. Current
file-based authority remains independently bound by the exact current manifest
path and raw digest plus the finite scoped-authority closure digest. This keeps
historical validation reproducible without weakening current graph authority.

The registered command has successfully verified
`urn:usf:carrier-adoption:repository-path-scope:1` against the explicit
`urn:usf:profile:v3-self-host:1` profile and integration manifest. It derived
an exact content-bound receipt, reported both recorded and live scoped
currentness as `current`, and left the tracked target absent. The
semantic-first carrier also passes its three exact historical validations in
the scrubbed no-network child and truthfully reports `reconstructable` scoped
currentness. The integration-toolchain carrier passes its one exact historical
validation and also reports `reconstructable`; all three finite verify paths
therefore pass from the clean implementation checkpoint. Each was then adopted
and immediately reverified through the same registered command. The exact
tracked receipts and canonical receipt digests are:

- `evidence/historical-carriers/semantic-first-gate-v1.json` —
  `sha256:7305f8fc55cf0015cdefbe7f7dd77fc4985deef0fc3ccb6bd8cfd69ead445ed1`;
- `evidence/historical-carriers/repository-path-scope-v1.json` —
  `sha256:2a6f7b8e38658e7446db2d8903b16724e071d5a15ca64c347dd81c5249df0461`;
  and
- `evidence/historical-carriers/integration-toolchain-repair-v1.json` —
  `sha256:6e90a541b4fb9be2e3d429e6410598fc763f53c00b772de4a9c5275a16fcd18f`.

Repeat verification authenticated each stored target as `matching`. The
repository-path observation was `current` at adoption; the semantic-first and
integration-toolchain observations were truthfully `reconstructable`. These
are historical observations only and still do not establish ordinary
construction authority or completion.

Clean pre-push replay found two confinement defects that were repaired in the
same implementation checkpoint rather than stacked as follow-up patches.
Historical tests must be permitted to read their own scratch writes, multiple
validations must reuse one authenticated synthetic `node_modules` mount point,
and the admitted semantic-first tests require ignored repository-local `.usf`
state. The carrier tree and package closure remain read-only: a fresh empty
scratch child is mounted at `/workspace/.usf`, while Node write permission is
limited to that alias and `/usf-scratch`. No carrier source, credential,
network, package-install or provider permission was added.

The finite schema replay also caught a modeled-lineage mismatch before
publication: the receipt schema admitted only `direct-bootstrap/manual`, while
the already-declared integration-toolchain carrier truthfully uses
`direct-bootstrap/manual-toolchain-repair`. The schema and graph now enumerate
exactly those two current lineage modes. Any later command-implementation
carrier must extend or version that explicit authority when its exact identity
is modeled; it is not admitted through a generic string pattern.

The implementation carrier itself is deliberately not added to the immutable
version-1 publication permission. Adding a fourth path or adoption to that
shared scoped-authority root would invalidate the three receipts that already
bind its exact resource digest. Any later implementation-carrier observation
must therefore use a new versioned copy-on-write permission and transition;
the critical repository-path/file-index chain does not wait on that optional
historical observation.

For the complete working packet, TypeScript compilation passed, the focused
CLI/carrier/schema selection passed 15/15, the full authoritative suite passed
184/184, containment returned `status: pass`, and `git diff --check` passed.
The integration-manifest semantic digest at that implementation checkpoint was
`sha256:37c32b64d2aada135be320d0649d5edcbc1e03fafd728e21296727e12a228349`.
These results qualify the exact implementation bytes at their coherent
checkpoint; they establish command implementation only, not carrier adoption,
evidence, proof or completion.

## Ordinary construction-authority boundary

This semantic packet defines the missing ordinary path before implementing it.
The versioned publication policy now selects
`urn:usf:work:repository-path-scope` and
`urn:usf:work:file-asset-index`, its exact JSON schemas, and their shared
copy-on-write activation-derivation rule. This incoming policy edge is
intentional: it preserves the already-adopted repository-path work resource
digest while the implementation will add the policy and schema files to the
future static scoped basis before any new evidence is formed. The policy
registers this Unix-decomposed interface:

```sh
./bin/usf evidence construction \
  --work WORK_IRI \
  --profile VERSIONED_PROFILE_IRI \
  --manifest graph/manifests/integration.json

./bin/usf prove construction \
  --obligation OBLIGATION_IRI \
  --evidence PATH_OR_STDIN \
  --profile VERSIONED_PROFILE_IRI \
  --manifest graph/manifests/integration.json

./bin/usf publish construction-authority \
  --bundle PATH_OR_STDIN \
  --profile VERSIONED_PROFILE_IRI \
  --manifest graph/manifests/integration.json \
  --verify
```

`evidence construction` is a read-only normalization of the exact current
profile-bound work projection. `prove construction` reauthenticates that
candidate, rederives the current scoped basis and deterministically reports
pass, fail, blocked or unresolved without source mutation. Only
`publish construction-authority --apply` may append the exact admitted
Evidence, passing ProofResult and ConstructionAuthorityGrant N-Quads to
`graph/integration.nq` and no-replace-create one sanitized receipt under
`evidence/construction-authority/`. Verification, staging and candidate output
remain stdout or ignored repository-local state. No stage contacts a provider,
GitHub or a remote, commits, pushes, completes work or activates runtime.

The activation rule does not edit a proofblocked permission in place. It first
derives the static scoped authority basis without dynamic Evidence,
ProofResult or grant subjects, then selects the unique deterministic grant for
that exact work, permission, profile, manifest and basis. Old grants for other
relevant bases remain immutable historical records and are ignored; more than
one current grant is an integrity failure. Consequently unrelated graph or Git
movement cannot force reproof, while movement of any declared dependency does.
This is the ordinary copy-on-write mechanism, not a claim that GitHub itself is
copy-on-write.

The command resources are now graph-declared `implemented`. The CLI derives a
static basis before selecting dynamic records, emits composable canonical JSON,
supports one through thirty-two compatible publication members, validates a
complete isolated postimage before taking the narrow primary mutation lock,
and derives effective permission without rewriting the proofblocked permission
resource. Stale valid records remain historical and are ignored; malformed or
duplicate current records refuse.

The implementation also removed one legacy internal bottleneck: the bootstrap
loop now invokes the graph-derived check rather than a caller-supplied allowlist
checker. A typed incoming validation-runtime closure supplies only the current
construction-authority module when it is absent from an isolated candidate,
and the checked receipt binds its exact path and bytes. Integration rederives
the same finite path set. The incoming edge deliberately leaves the admitted
validation and work resource identities unchanged; it is not a blanket source
tree mount or a reproof bypass.

The coherent command implementation is committed and pushed as `d735ca9`. At
that boundary the focused construction and bootstrap command suite passed
12/12, TypeScript plus the full authoritative suite passed 186/186,
containment returned `status: pass`, and `git diff --check` passed. All three
immutable historical carrier observations then reverified as `matching` from
the clean commit: repository-path currentness was `current`; semantic-first
and integration-toolchain currentness remained truthfully `reconstructable`.

The registered Unix pipeline initially published one exact copy-on-write
construction grant for `repository-path-scope`. Historical receipt
`evidence/construction-authority/937bdbadf9fda27dc413bb1f5c09bdb923d84b95cb77844d8ba208e57a7c3f7c.json`
has receipt digest
`sha256:fa469217c45d92984f3ddfaf8b01b061be557b28f7fea9b07fd75578ec40393f`;
readback projected active construction permission with no completion claim.
At that historical boundary `file-asset-index` was correctly
dependency-blocked because current completion for `repository-path-scope` was
absent. The current checkpoint above supersedes that state.

The next semantic gap is explicit rather than patched around: both predecessor
implementations already exist, while the integrated-candidate path correctly
refuses an empty delta. V3 must first define an exact no-change realisation
disposition, isolated current-byte validation, completion evidence, completion
proof and additive publication semantics. V2's `RESERVED_NO_ACTION` handling
is a relevant adverse-learning guardrail: no action is a separate axis and
must never be promoted to validation satisfaction or completion without exact
current evidence and proof.

That gap next received a model-only, proofblocked definition in
`graph/integration.nq`: `no-change-work-completion:1` selects only
`repository-path-scope` and `file-asset-index`, binds four registered command
stages, six closed repository schemas, seven implementation paths and four
separate algorithms, and publishes only an explicit
`AdmittedNoChangeRealisationReceipt` plus completion Evidence and ProofResult.
The disposition requires an isolated exact-byte snapshot, empty operations,
empty provider lineage and every contract-declared confined check receipt. It
does not change the existing integration proof algorithm or reinterpret an
empty delta. All 14 directly referenced command, algorithm and schema
resources resolve through `usf query`; the policy cardinalities are 2 eligible
works, 4 commands, 6 schemas, 7 tools and 4 algorithms. The full model-boundary
authoritative suite passed 186/186 and containment passed at that historical
model-only checkpoint. The four commands were later implemented and
independently exercised through the current receipts recorded above.

The mathematical/structural review exposed several denominator and topology
issues that must remain visible:

- selected-path coverage had been conflated with complete carrier coverage;
  the two-path/100-path defect above was a concrete unsatisfiable count model;
- file inventory coverage was being confused with parsed RDF relationship
  coverage, leaving the V1/V2 unselected-file denominators described below;
- carrier algorithm, validation and command nodes existed without operational
  edges, leaving a modeled transition with no realizable registered stage;
- one receipt-referenced transition IRI had no subject definition; it is now
  explicitly modeled as a receipt-backed historical identity, not an executable
  transition or source of current authority;
- treating every resource reference as an execution edge produces reciprocal
  metadata strongly connected components. For the carrier slice, only explicit
  work-to-work `dependsOn` predicates are operational predecessor edges;
  authority, command, algorithm, schema, permission and digest bindings remain
  semantic-connectivity edges and cannot be reported as runtime deadlocks;
- proofblocked work can have implementation bytes while still lacking the
  evidence/proof/permission path required for readiness; byte presence and Git
  ancestry are not graph reachability or semantic completion;
- `file-asset-index` was not cyclic when blocked: its refusal came from the
  then-unready `repository-path-scope` predecessor; a true dependency cycle is
  reported separately as `WORK_DEPENDENCY_CYCLE`; and
- the graph defines the required bounded structural qualification—quad/node/IRI
  edge denominators, weak/strong components, typed in/out-degree statistics,
  zero-degree classification, profile reachability, dependency and semantic
  stage cycles, predecessor-first order, longest path, per-level width,
  antichain bounds and write-conflict frontiers—but the registered `usf graph
  inspect` implementation does not yet exist. Therefore no complete numerical
  graph-health report is claimed yet.

## Semantic recovery boundary

`d974570` implements the bounded exact-byte recovery extractor/compiler and its
closed schemas/tests. The current graph-derived packet is:

```sh
./bin/usf work \
  --selector urn:usf:work:semantic-recovery-tooling \
  --max-items 10 \
  --manifest graph/manifests/self-host-semantic-recovery.json
```

It derived at the baseline with semantic digest
`sha256:d690c9b8857ac431dccec8323ff31d2a2d716f40e81b69df2fcecd07d9e445c6`
and scoped dependency digest
`sha256:f5046ae3d5cd692c2bb6aaa65b7d9f7b183c6a4ff73afcfbf4502612e74a00e2`.

The tooling is not the final recovery result. The accepted
`config/semantic-recovery-inventory.json` and reviewed recovery dispositions do
not yet exist; the later final packet correctly refuses. Factory behavior-level
qualification and selective V3 re-expression remain future work. Do not claim
complete historical semantics, final recovery or Factory acceptance.

The operator-directed secondary audit found additional denominator defects
that the next graph-authorized recovery packet must close:

- file coverage is not relationship coverage: the current extractor parses
  semantic candidates only from active manifest-selected RDF;
- the registered `usf graph inventory`/`coverage` result surface and its two
  accepted tracked result artifacts do not exist; manifest-store,
  recovery-tooling and graph-exchange work remains proofblocked;
- the pinned V1 tree has 144 RDF files but only 54 active/derived
  manifest-selected RDF entries, leaving 90 fixture or otherwise unselected
  RDF files at file-level only;
- the pinned V2 tree has 57 RDF files; one manifest-named source is inactive
  and four fixture/defect RDF files are unselected, leaving five files outside
  active relationship parsing;
- the V1 tree contains a mode-`160000` Git link that the closed recovery entry
  model does not yet represent;
- the current source declaration is self-scoping and does not independently
  disposition the authorized operator and proof-cockpit sources;
- the compiler's `RecoveryAuthorityContext` has no independently authenticated
  typed resource in the current graph, so reviewed mappings, licences, layers,
  adverse lessons, BAU ceilings and target connectivity cannot yet be accepted;
- reviewed mappings are not yet proven to bind exact candidates to typed
  authenticated V3 targets or graph-typed rejection/defer reasons;
- one pinned snapshot per repository does not expose removed/intermediate
  semantic definitions for disposition. Read-only Git-object observations found
  additional distinct semantic blobs outside the selected pins, but no
  relevance or incorporation claim is made from those counts;
- ANQR has no historical semantic graph and requires a separate product
  denominator over its source, contracts, ADRs, tests and manifests; and
- the mandated protected Factory path and proof-cockpit remain unreadable under
  the ordinary-user boundary. The two exact configured Factory release
  snapshots are independently byte-readable through their declared historical
  source identities, but using them requires the source-selection contract to
  accept their exact matching commit/tree identities; this does not establish
  equivalence to the protected path.
  Unavailable identities remain explicit unresolved nonclaims without an
  access prompt.

The secondary sweep must distinguish tracked-file, declared-semantic,
parsed-relationship, unmanifested-candidate and bounded-history denominators.
Every candidate needs exactly one reviewed disposition plus a typed V3
connection or graph-typed exclusion/revisit reason. Historical RDF is never
bulk imported; retained meaning is re-expressed in later V3-authored packets.

## Provider and model population

The frozen local models.dev snapshot observes the population below. Re-derive
its exact raw and normalized digests from the tracked snapshot with
`./bin/usf models summary --max-items 1`; do not use digest literals from this
checkpoint narrative as current authority:

- 212 provider routes;
- 7,477 provider-route/model pairs;
- 3,806 underlying models;
- 171 known underlying model families;
- 28 adapter packages, of which 2 are installed; and
- 209 credential names.

The current frozen catalogue reports 7,041 routes with known base price data,
436 with unknown price data and only 10 with exact catalogue-zero price under
the strict applicable-dimension rule. It reports 18 routes through the two
installed adapters. These are metadata denominators, not semantic
qualification, entitlement, zero-paid economics, service-tier or availability
evidence; installed adapter support does not configure or qualify a route.

This catalogue is not a configured roster or availability result. The tracked
provider configuration currently declares only:

- Cerebras `gpt-oss-120b` through `@ai-sdk/cerebras`; and
- Groq `qwen/qwen3.6-27b` through `@ai-sdk/groq`.

Both remain live-ineligible and `UNQUALIFIED`: no trusted current exact-account
zero-paid receipt, live successful probe or authenticated provider-produced
semantic answer set has been admitted. OpenAI/Codex catalogue entries and this
Codex session do not make a Codex route configured or qualified.

The reviewed V2 environment-name denominator (names only, never values) is:
`ARCEE_TOKEN`, `CEREBRAS_API_KEY`, `CLOUDFLARE_API_KEY`, `COHERE_API_KEY`,
`DEEPSEEK_API_KEY`, `FIREWORKS_API_KEY`, `GEMINI_API_KEY`,
`GITHUB_PERSONAL_ACCESS_TOKEN`, `GROQ_API_KEY`, `HF_TOKEN`, `LINEAR_API_KEY`,
`MISTRAL_API_KEY`, `NOUS_API_KEY`, `NVIDIA_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`, `SAMBANOVA_API_KEY`, `TOGETHER_API_KEY`, `ZAI_API_KEY`
and the five Stardog names `STARDOG_DATABASE`, `STARDOG_PASSWORD`,
`STARDOG_SERVER`, `STARDOG_TOKEN`, `STARDOG_USERNAME`. GitHub, Linear and
Stardog names are not automatically AI-provider routes. Name differences such
as `ARCEE_TOKEN` versus models.dev `ARCEE_API_KEY`, and `ZAI_API_KEY` versus
`ZHIPU_API_KEY`, remain reviewed mappings rather than inferred aliases.

Historical provider observations also include distinct `codex-cli`,
`claude-cli` and `antigravity-cli` subscription transports; Codex models
`gpt-5.6-sol` and `gpt-5.5`; OpenRouter
`anthropic/claude-sonnet-4.6`; MiniMax OAuth `MiniMax-M3`; a direct OpenAI API
credit/fallback refusal; and an unresolved Nous identity. These observations
come from the reviewed V1/V2 provider graph, V2 workforce proof and local
operator admissions. They are provenance candidates only, not current V3
configuration, entitlement or qualification. `codex-cli` must remain a host
adapter distinct from `OPENAI_API_KEY`; the absent local Claude CLI remains an
explicit pre-contact unavailable/`UNQUALIFIED` candidate. The protected
root-owned Factory tree remains unreadable, so complete Factory-source coverage
is not claimed and no access prompt is required.

The implemented provider-census packet deterministically unions the fresh frozen
models.dev catalogue, current V3 configuration, this reviewed legacy
denominator and host CLI capabilities. It deduplicates only exact normalized
transport/provider/route/model identities, preserves every source and
direction, assigns one disposition per candidate, and applies capability,
adapter, credential-name, account-receipt, authenticated-answer,
hidden-holdout and routing gates in that order. It must first support the
reasoning + tool-call + structured-output intersection and must not generate a
per-route/model Cartesian test or probe matrix.

The stable census identity is the tuple
`transport/provider/providerRoute/requestedModel/underlyingModel/underlyingFamily/adapterPackage/credentialNames`.
Every row retains all source provenance. Alias candidates such as
`ARCEE_TOKEN`/`ARCEE_API_KEY`, `ZAI_API_KEY`/`ZHIPU_API_KEY`, API/CLI transports
and requested/underlying model names remain separate until an explicit mapping
is reviewed; they are never merged by spelling similarity.

Every candidate has exactly one allocation disposition: `assigned`,
`eligible-unassigned` or `excluded`. Exclusion reasons include
`CATALOGUE_ONLY`, `ADAPTER_UNAVAILABLE`, `CREDENTIAL_NAME_UNMAPPED`,
`ACCOUNT_RECEIPT_MISSING`, `AUTHENTICATED_ANSWER_MISSING`,
`HIDDEN_HOLDOUT_MISSING`, `UNAVAILABLE`, `AMBIGUOUS_IDENTITY`, `UNQUALIFIED`
and `PAID_OR_UNKNOWN_ECONOMICS`. Allocation is separate from the orthogonal
observations `availability = available|unavailable|unknown` and
`qualification = qualified|unqualified`.

The registered deterministic CLI grouping is:

```text
usf models summary
usf models list --capabilities reasoning,tool-call,structured-output
usf providers census --profile PROFILE --manifest MANIFEST
usf providers status --route ROUTE
usf providers aliases
```

The census is linear over indexed candidates, cursor-bounded and JSON/JSONL
composable. It replaces the current single-capability, 1,000-item `usf models`
limit and can produce the complete assigned/excluded/eligible-unassigned table.
Qualification is lazy by candidate and never expands into a
route-by-model-by-prompt test matrix. Gate 2 must not wait for every catalogue
row: first dispose the exact configured candidates needed by the live vertical
slice, then expand the same deterministic census incrementally.

“Full provider/model population” means every currently configured route and
every currently eligible route under the exact frozen inputs, with complete
assigned, excluded and eligible-unassigned dispositions. It never means
blindly invoking all catalogue entries or rebuilding a fixed list from V2
environment files.

## Provider/currentness correction and legacy invariant audit

The first provider pass missed known V2 knowledge. The cause was methodological:
it checked whether legacy topics and terms appeared in V3 prose/graph, rather
than proving each legacy invariant through the composed manifest, exact graph
edge, registered command behaviour and planted currentness movement. A focused
test then parsed only `graph/provider-pipeline.nq`, so it could not see that the
imported operator predecessor and provider census both claimed
`src/cli.ts`/`src/commands/help.ts`. That is the same repair-loop pattern V3 is
required to remove, not an acceptable implementation detail.

The correction is structural:

- provider census no longer owns the predecessor-owned shared CLI registry;
  the one-time top-level `providers` reservation is one coherent operator
  registry integration, while later provider leaves dispatch through the
  already reserved provider module boundary;
- the topology invariant now derives the exact profile-3 selected work set from
  the complete imported provider manifest and rejects successor/currentness
  overlap, independent write collisions and undeclared producer-consumer
  edges. This is a profile-3 result, not a global disjointness claim for older,
  Hermes or product profiles;
- every operational contract is now an explicit scoped dependency of each
  implementing packet, with reciprocal edges and an implementing owner for
  every operational output. Authenticated answers are jointly implemented by
  invocation, hidden evaluation and semantic qualification; invocation and
  evaluation remain parallel and qualification is their true join;
- reusable no-contact capability packets have disjoint tracked write sets;
  route account, adapter, authorization, answer, evaluation, qualification,
  parallel-run and token-comparison movement is immutable ignored operational
  state and does not require a commit or sibling reproof;
- account-source authorization is separate from inference authorization;
  provider-produced answer provenance and producer/evaluator separation are
  explicit; and
- relevant V2 provider posture, typed port/adapter isolation,
  entitlement-before-counting, idempotent/windowed usage and adjustment,
  uncertain-request reconciliation, TLS/fixed-origin transport, bounded retry,
  circuit/bulkhead and no-fallback rules are now explicit semantic requirements
  of the exact capability contracts. They are requirements, not implementation
  or live proof.

OpenRouter `GET /api/v1/key` remains only a candidate account source. Its
authenticated key metadata, limits and usage do not prove that paid use or
automatic top-up is disabled, that a free model is eligible, that provider or
model fallback is impossible, or that a receipt is fresh under a local policy.
The provider-documented `is_free_tier` field is retained only as a paid-credit
history indicator and cannot be promoted to entitlement. The graph therefore
marks this mapping `insufficient-alone-for-zero-paid-account-receipt`; missing
evidence must refuse rather than be supplied by agent inference.

The secondary audit found these still-open obligations. They are recorded so
absence cannot be mistaken for migration or readiness:

- provider mode/lifecycle/readiness fields and transition enforcement are not
  yet implemented in provider configuration;
- the typed provider port, scrubbed adapter child, run-authorization schema,
  provider-answer schema and transport/resilience enforcement do not yet exist;
- exact account receipt field types, nullability, derivations and freshness are
  not yet implemented, and the current OpenRouter candidate cannot fill every
  required field;
- genuine hidden grader material and producer separation are not yet realised;
- aggregate required-family workload readiness and idempotent usage
  reservation/reconciliation are graph-defined but not operational;
- graph-bound provider command surfaces for adapter preflight, authenticated
  answer acquisition, hidden evaluation, live parallel execution and live token
  comparison are not implemented. Existing `probe semantic`, `route` and
  `call` paths remain fixture/replay/fake-only and do not authorize live work;
- no live account receipt, provider answer, route qualification, parallel run
  or semantic-token comparison exists; tracked qualification fixtures are not
  genuine hidden evidence; and
- the complete V1/V2 recovery denominator remains open because
  `config/semantic-recovery-inventory.json` and a reviewed
  `config/semantic-recovery.json` do not exist. Full semantic migration is not
  claimed.

This checkpoint deliberately adds no per-provider/model test matrix. Existing
registry and topology tests were extended to cover the distinct command-state,
profile-selected ownership, operational-contract currentness and true
producer-consumer dependency invariants.

## Provider safe sequence

This order remains mandatory for ordinary USF and Hermes alike:

1. graph-define, prove and activate the exact route-bound account-source
   acquisition permission and its closed economics/service-tier receipt shape;
2. acquire a trusted exact-account tier receipt through that permission;
3. run the maintained adapter in a content-verified scrubbed child that receives
   only the selected credential variable and bounded public input;
4. acquire authenticated provider-produced semantic qualification answers
   through a registered command;
5. perform genuine task/profile hidden-holdout qualification;
6. wire live `route -> call` and the unattended composer;
7. demonstrate live multi-provider parallelism and semantic-token reduction
   only from accepted lineage.

The existing `probe availability` command refuses with
`PROBE_ACCOUNT_TIER_UNVERIFIABLE` before credential/adapter/provider contact.
The local semantic evaluator and route command replay supplied facts; they do
not authenticate provider production of those facts.

After the current prerequisite publications, the registered
`providers receipt acquire` path reaches the more specific handler refusal
`PROVIDERS_RECEIPT_PROOFBLOCKED`. This confirms dispatcher and dynamic-child
currentness without converting the deliberate live acquisition proofblock into
availability evidence. The next safe slice is the semantic remodel/activation
that makes exact route-bound account-source acquisition current. Trusted
account-tier receipt acquisition follows that activation, then a
content-verified scrubbed adapter child, authenticated provider-produced
answers and genuine hidden-holdout qualification. Live parallelism and
semantic-token reduction remain downstream of those gates.

## Hermes-Agent boundary

`usf hermes` is the operator-requested optional management facade. It is not a
second Hermes platform, scheduler, workflow database, daemon, credential plane
or authority source.

The graph-defined future surface is:

```text
usf hermes
usf hermes start [--config config/hermes.json]
usf hermes status [--config config/hermes.json]
usf hermes stop [--config config/hermes.json] [--wait-ms N]
usf hermes doctor [--config config/hermes.json]
```

This surface is not registered in the current CLI: `usf help hermes` refuses
with `HELP_TOPIC_UNKNOWN` and bare `usf hermes` refuses with `COMMAND_UNKNOWN`.
When its graph-defined packet is eventually constructed, bare `usf hermes`
must resolve one exact tracked default BAU intent and start the same foreground
composer. Ordinary `usf start`/`usf stop` already remain usable with Hermes
absent; the future Hermes instance must also be stoppable through ordinary
`usf stop --instance hermes-bau`.

The graph-defined future tracked configuration is only a closed policy envelope directly binding an
exact USF core profile, ordinary ANQR product profile, optional ANQR management
profile, ordinary provider and qualification inputs, `check` ceiling, budgets
and containment policies. AI-tuned resolved instance configuration binds the
exact base plan, ready set, scoped dependencies, prompts, context, output,
tools, skills and optimizer runtime; it is validated and written atomically
owner-only under ignored `.usf/runs/hermes/<digest>`. Status/restart rederive it
from authority. Routine tuning creates no commit or graph publication.

Hermes may asynchronously propose prompt/context compression, agent roles,
route rankings, review/repair, commit cohorts and skill candidates. A future
Hermes model call consumes its own visible ordinary assignment, provider slot
and budgets but cannot reserve unrelated slots or the primary-mutation lock.
Every proposal applies only to still-unclaimed work and is ignored when late,
stale or mismatched; it cannot cancel, duplicate or suppress assignments.
Failure, timeout or absence preserves the deterministic plan. Generated skills
are isolated candidates; they cannot hot-activate or alter authority, tools,
credentials or the profile against which a provider was qualified.

The future initial facade must perform no credential lookup. Later live work must name one
exact repository-relative ignored owner-only credential file, never fall back
to ambient variables, and may release only the selected route's allowlisted
variable through the same future scrubbed-child boundary. Hermes receives no
wholesale environment and cannot invoke providers independently. Docker,
GitHub, a remote runner, external CAS, database, Stardog or historical
repository is not a deterministic lifecycle or verification dependency.

## Git, currentness and batching

GitHub is not copy-on-write and does not own semantic currentness. Candidate
isolation is local; the current fallback copies bounded snapshots and may later
use measured reflinks where supported. No USF CAS is implemented. There is no
tracked GitHub workflow or self-hosted runner requirement.

USF and ANQR retain independent versions and digests. Routing/management binds
core-to-product, product-to-core and composite content identities. A change
invalidates only its declared direction/scope; unrelated Git or graph movement
does not force reproof.

The root currentness correction is intentional and high leverage. An exact
profile resource binds profile identity, version and selected membership, but a
work packet traverses only its own contract/work closure and explicit
`dependsOn` predecessors. It does not traverse the contents of sibling
`selectsContract` members. Therefore a sibling contract change can change that
sibling's basis without invalidating unrelated completed work. Operational
handover text and shared bottleneck notes are likewise excluded from ordinary
functional scopes; historical bootstrap/carrier references remain immutable
history, not current work dependencies.

Commits are coherent durable checkpoints, not prompt, retry, triple or chain
stage records. A batch requires checked candidates, fresh scoped dependencies,
compatible write sets and validation boundaries, no unresolved blocker and one
rollback unit. Every flush is bounded by the selected `through` ceiling and
tracked automation policy. At `check`, stop leaves candidates queued and does
not integrate, commit or publish. At an explicitly authorized higher ceiling,
flush on coherent-unit closure, risk/diff/age ceiling, explicit checkpoint or
stop drain. There is no minimum batch size. Preparation and validation remain
parallel; only the final source mutation is briefly single-writer. Push is
explicit and outside the local lifecycle critical path.

The same compatibility rule applies to work-completion publication. Bundles
with differing work-scoped manifest or source digests are separate additive
publications, not one synthetic cohort. In this checkpoint, operator and
repository completion were published separately, and repository revalidation
after operator publication proved that unrelated copy-on-write movement did
not force reproof or a Git checkpoint between semantic chain boundaries.

## Lifecycle and truthful first implementation

`usf start`, `watch`, `stop` and lifecycle status already provide one
foreground composable process, exact `flock` ownership, bounded drain and
restart from current file/graph facts. The default cycle currently re-observes
its profile and can remain idle; it does not yet autonomously complete the live
provider chain.

Hermes is not required to select ANQR. Ordinary `usf start` can use
`urn:anqr:profile:bau:1` through
`graph/products/anqr/hermes-manifest.json`; USF-only operation selects its core
profile, and a later product selects its own overlay. A product may optionally
add a different versioned Hermes intent/config while using the same facade.

The next implementation is intended to prove:

- ordinary profile-bound start/status/stop still works without Hermes;
- the newly registered Hermes config/help/doctor surfaces are closed and local;
- Hermes bare/start/status/stop then uses the same lifecycle instance and ordinary
  provider readiness/evaluation inputs;
- all configured routes receive explicit local dispositions;
- missing/stale/ambiguous config fails before contact; and
- Hermes unavailability retains deterministic fallback.

That fixture-backed session is not evidence that Hermes-Agent ran, that a live
provider ran, that ANQR changed, that tokens were reduced or that production
BAU exists.

## Test economics and authoritative checks

Retain one test per distinct semantic acceptance/refusal or real process
boundary. Extend the existing table-driven provider, product-overlay and
lifecycle fixtures. Add one Hermes config/command refusal table and one real
start/status/ordinary-stop boundary; do not create per-provider/model/prompt
matrices. Live provider/Hermes execution remains non-default.

Run from `/home/user/src/usf-v3`; the external temporary roots are intentional:

```sh
mkdir -p /tmp/usf-authoritative /tmp/usf-corepack
./scripts/bootstrap.sh
TMPDIR=/tmp/usf-authoritative node --test \
  tests/contract/cli.test.ts \
  tests/integration/bootstrap-carrier.test.ts \
  tests/unit/schema/validator.test.ts \
  tests/contract/provider-census-contained.test.ts
node --test tests/unit/providers/*.test.ts \
  tests/contract/provider-commands.test.ts \
  tests/integration/provider-cli.test.ts \
  tests/unit/graph/product-overlays.test.ts
node --test tests/integration/profile-scoped-authority.test.ts
TMPDIR=/tmp/usf-authoritative \
  COREPACK_HOME=/tmp/usf-corepack \
  corepack pnpm run check
TMPDIR=/tmp/usf-authoritative ./scripts/verify-contained.sh
git diff --check
git status --short
git log -5 --oneline --decorate
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

After implementation also run both graph-defined Hermes validation commands
exactly as emitted by the core and ANQR packets.

## Skills and plugins

- `usf-v3-operator` governs authority recovery, explicit profiles/manifests,
  exact write sets, independent verification and coherent checkpoints.
- `cli-creator` governs the static composable help/JSON surface and bounded
  subcommands.
- `security-best-practices` applies only to an explicitly requested
  TypeScript/Node security review; its existing credential/child-process
  lessons remain captured, but no new security-review claim is made here.
- `linear` is used only for explicit Linear work and is never semantic
  authority.
- No additional plugin was installed. Context7/documentation lookup would not
  close account entitlement, adapter integrity, provider-answer authenticity or
  lifecycle proof. Codex Security is appropriate only for a separately
  requested audit.

## Next exact actions

1. Authenticate current Git and remote state. If the exact six-path closure is
   still dirty, run the complete authoritative and containment checks,
   independently review it, then commit and push once. If it is already clean
   and local `HEAD` equals `origin/main`, run the standalone fresh-clone gate
   and do not add another carrier-only commit. Do not introduce a new CLI
   implementation before that carrier is durable.
2. Resume only from the clean remote-authenticated carrier. Semantically
   remodel, prove and activate exact route-bound account-source acquisition,
   co-designing one bounded dynamic-economics/service-tier receipt and registry
   shape without expanding the tracked graph into one record per catalogue
   row. The packet defines how every frozen provider/model route receives an
   explicit disposition and binds exact route/model/transport, price
   dimensions, account receipt, quota/reset, paid/overage controls, spend cap,
   fallback and expiry. Unknown live facts remain unqualified until acquired;
   the semantic packet must not invent them. Preserve direct SDK, OpenRouter,
   Codex CLI and Claude CLI as distinct transports.
3. Through the graph-defined work and registered commands, acquire trusted
   exact-account zero-paid receipts under separately current immediate
   pre-contact AccountSourceAuthorizations. Include OpenRouter only when current
   evidence closes account identity, eligible free models, quota, exact actual
   model identity and mechanically disabled paid/overage fallback. Do not infer
   any field from V2 history, credential presence or models.dev.
4. Implement and qualify the typed, content-verified scrubbed adapter child so
   it receives only the selected credential and bounded public input. Then
   acquire authenticated provider-produced semantic answers through the
   registered command and perform genuine hidden-holdout qualification for the
   exact task/profile.
5. Repeat qualification for every semantically suitable zero-paid route that
   current account and host evidence actually admits. Claude remains
   authoritatively unavailable here unless exact current evidence changes;
   installed host metadata or subscription assumptions are not entitlement.
6. Only after those gates, run the minimal continuous live loop and demonstrate
   real multi-provider parallelism and semantic-token reduction with accepted
   lineage, exact token/cost/concurrency metrics and mechanically impossible
   paid fallback. Hermes-Agent remains optional and downstream of ordinary
   `usf start`/`usf stop`; it is not needed for the first USF-only vertical
   proof.

Run the full authoritative and containment checks, then commit and push once at
the coherent provider-census completion boundary. GitHub remains outside every
intermediate construction, check, completion and runtime critical path.

The secondary semantic-recovery sweep is an independent bounded lane, not a
serial prerequisite for integration, `file-asset-index` or the provider census.
Before final recovery acceptance it must close the tracked-file,
declared-semantic, parsed-relationship, unmanifested-candidate and bounded-history
denominators, the V1 Git-link representation, independent source universe,
connected reviewed mappings, separate ANQR product denominator and
unresolved-source nonclaims. Re-express accepted V3-relevant candidates through
selective V3-authored graph packets; do not bulk import legacy RDF or copy V1/V2
operational topology. Commit/push that coherent recovery checkpoint only after
complete disposition and hermetic independence evidence.

Do not perform an ad hoc historical inventory, prompt for Factory access,
reintroduce V2 leases/fences/journals/handovers/signatures/state databases, or
claim complete semantic incorporation, full ANQR, staging, production,
production BAU or terminal proof without exact evidence.

## Per-route provider-contact blocker derivation (turn 8)

Derived mechanically from registered state, per configured route, treating each
provider independently. Both configured routes are free-quota, non-paid-fallback:

| route | provider | cost | entitlement | paidFallback | adapter | credential |
|---|---|---|---|---|---|---|
| `cerebras-gpt-oss-120b` | cerebras | free-quota | free-quota | false | `@ai-sdk/cerebras` | `CEREBRAS_API_KEY` |
| `groq-qwen3.6-27b` | groq | free-quota | free-quota | false | `@ai-sdk/groq` | `GROQ_API_KEY` |

### What already supports these providers

- `providerEconomicsRules` (`src/providers/economics.ts:163-186`) carries full
  entries for **both**: `documentedClasses`/`eligibleRecurringClasses`
  `["FREE_RATE_LIMITED"]`, `recurrence: "recurring-quota"`, official hosts.
- `evaluateZeroPaidEconomics` **can allow** (`allowed: true`, economics.ts:547).
- `validateAccountSource` (economics.ts:431) already maps groq to
  `console.groq.com` and cerebras to `cloud.cerebras.ai`, expecting an
  `authenticated-account-observation` whose path contains `account`.
- `probeProvider` names both exactly in its `exactAdapter` check (probe.ts:375).

The four `missingRequiredEvidence` items on the OpenRouter mapping (paid usage /
automatic overage / automatic top-up disabled, free-model route eligibility) are
**OpenRouter-specific**. OpenRouter is a credit marketplace where one key can
spend money; Groq and Cerebras free tiers structurally cannot (both providers
document that no charge occurs until the operator purchases credits or upgrades).
Those items must not be generalised to these two routes.

### Repository-contained blockers (not external)

1. **`trustedAccountTierReceiptAvailable()` is a hardcoded `return false`**
   (`src/commands/probe.ts:218-220`), consulted at `probe.ts:240` *before* any
   route-specific logic. `usf probe availability` is therefore unconditionally
   dead for every route, credential or receipt state notwithstanding.
2. **`verifyAccountTierReceipt` has no allowed return path.** All 8 returns are
   `deniedAccountReceipt`; the final statement is an unconditional
   `ACCOUNT_TIER_MAPPING_INSUFFICIENT` (`economics.ts:1092`).
3. **The v1 receipt verifier is hardwired to OpenRouter.** `economics.ts:859`
   refuses any `trustedResponseMapping.iri` other than `openRouterMappingIri`,
   and the only defined disposition literal is
   `insufficient-alone-for-zero-paid-account-receipt`. A groq/cerebras mapping
   added under protocol:1 would be refused on identity alone.
4. **No `ProviderAccountSourceMapping` exists for groq or cerebras** under either
   protocol. `candidateMapping` covers only `openrouter-current-key:1` (protocol
   1 and 2) and `codex-subscription-host:1` / `claude-subscription-host:1`
   (protocol 2). `mappingForRoute` consequently refuses
   `PROVIDERS_RECEIPT_MAPPING_UNAVAILABLE`.
5. **The v2 lane has zero runtime.** `graph/provider-pipeline.nq` declares
   `account-source-protocol:2`, `command:providers-receipt:2`,
   `provider-operation:account-receipt-acquisition:1` and its activation
   algorithm, and two activation schemas plus
   `account-source-authorization-v2.schema.json` exist — but no `src/` symbol
   matches `V2`/`receipt:2`. Nothing reads them.

### Genuinely external limit

Neither provider publishes a documented **authenticated non-inference HTTP API**
returning account tier or quota. Groq exposes rate-limit state only in
`x-ratelimit-*` response headers on inference calls, with tier and billing on
console web pages; Cerebras documents Analytics/Logs/Limits as Cloud Console
pages and directs programmatic requests to sales. So the evidence class that
`account-source-protocol:1` demands — `provider-owned-non-inference-account-source`,
explicitly refusing `self-authored-receipt-digest` — **cannot be satisfied by
either provider as a matter of external fact, not repository omission.**

This is the crux: the economics layer accepts an operator-performed authenticated
console observation, while the receipt protocol refuses anything the usf process
did not itself fetch from a provider-owned endpoint that does not exist.

### Consequence for the demo

Supplying `GROQ_API_KEY` or `CEREBRAS_API_KEY` changes nothing: blocker 1 throws
before credentials are read. The live-contact demo is not credential-gated.

Precedent for the resolution already exists in the graph: protocol:2's
`codex-subscription-host:1` / `claude-subscription-host:1` sources perform **no
provider contact** and derive a secret-safe host identity locally
(`hostTransports = ["codex-cli","claude-cli"]`, `provider-receipts.ts:395`).
An operator-attested console observation for a spend-incapable free tier is
architecturally consistent with that existing no-contact source class, so
admitting it is an extension of declared precedent rather than a weakening of
containment. It requires a graph authority decision, not a code workaround.

## V3 live execution demonstration (achieved)

`usf execute` carries one work requirement through the V3 chain and returns a
real external model answer with linked evidence. Verified repeatedly:

```
usf execute --prompt "Reply with exactly one short sentence naming the largest ocean on Earth." \
  --env-file .usf/credentials/providers.env --require-capability reasoning --max-output-tokens 4000
```

→ exit 0, `finishReason: stop`, answer "The Pacific Ocean is the largest ocean on
Earth.", route `groq-qwen3.6-27b`, transport `vercel-ai-sdk`, requested model
equals actual model `qwen/qwen3.6-27b`, 256 real tokens, 525 ms.

### Four concerns, separated

1. **Model discovery** — the frozen models.dev projection at
   `.usf/catalog/models-dev.{raw,normalized}.json` (4.4 MB) supplies provider,
   model identity, capability names, context/output limits and list pricing.
   `--require-capability reasoning` filters on catalogue capability. No catalogue
   is duplicated.
2. **Execution transport** — `src/providers/transports.ts` models three
   transports with *different* authentication: `vercel-ai-sdk`
   (`owner-private-credential-file`), `claude-cli` and `codex-cli`
   (`local-agent-session`, verified live as Claude Code 2.1.251 and codex-cli
   0.152.0). A capability observation proves only current usability under an
   authorized local identity and carries no secret value or digest of one.
3. **Economic eligibility** — `src/providers/execution-economics.ts` evaluates
   per transport-and-provider pair against `config/policy.json` plus explicit
   operator authorizations in `config/execution-economics.json`. Fail-closed:
   an absent authorization is ineligible, and one provider's authorization never
   transfers to another provider or transport.
4. **Execution evidence** — `.usf/executions/<digest>.json` records the chain
   `request → selection → invocation → result` as four digests, plus every
   attempt, the transport capability observations, and provider-returned quota
   headers copied verbatim as provider claims.

### What this replaced

The demo does **not** use the v1 account-tier receipt lane, `usf probe
availability`, or the unimplemented receipt-v2 machinery. Those remain in place,
untouched and still honest for their own lanes. The V3 path needs none of them:
economics come from explicit operator authorization plus catalogue metadata,
and authentication is modelled per transport rather than demanding a
provider-owned account-tier endpoint that no provider publishes.

### Live economics corroboration

Cerebras is attempted first under deterministic ordering and returns HTTP 402
`payment_required` on an exhausted free trial. Routing records
`PROVIDER_QUOTA_EXHAUSTED_PAYMENT_REQUIRED` with `costIncurred: false` and
continues to the next eligible route. This is the free tier hard-stopping rather
than billing, exactly as Cerebras documents — real evidence that the zero-paid
posture holds without any account-tier receipt.

### Verification

- `tests/unit/providers/v3-execution.test.ts` — 10/10 (economics authorization,
  non-transfer between providers/transports, fail-closed on paid fallback /
  refused cost class / non-zero budget / entitlement mismatch, malformed
  authorization rejection, credential-name exactness, secret absence,
  per-transport authentication kind, deterministic ordering).
- `npm run test:unit` 159/159, `npm run test:contract` 34/34, `tsc --noEmit`
  clean. `tests/contract/operator-observability.test.ts` pinned command list
  updated for the genuinely added `execute` command.

### Files

- new: `src/commands/execute.ts`, `src/providers/transports.ts`,
  `src/providers/execution-economics.ts`, `config/execution-economics.json`,
  `tests/unit/providers/v3-execution.test.ts`
- changed: `src/cli.ts` (handler), `src/commands/help.ts` (registry),
  `src/commands/probe.ts` (`readTrackedJson` exported),
  `tests/contract/operator-observability.test.ts` (pinned list)
- credential: `.usf/credentials/providers.env`, mode 0600, gitignored,
  materialized from the operator's existing environment. Not committed.
