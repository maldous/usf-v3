# USF V3 handover

Updated 2026-08-31. This is the durable continuation boundary after bounded
semantic-recovery tooling, optional Hermes-Agent authority, the committed
semantic-first gate, the committed local candidate-integration toolchain and
the committed historical-carrier verification/adoption chain. All three finite
historical carrier observations have now been authenticated, recorded in one
coherent checkpoint and pushed. The next safe slice is the graph-defined,
copy-on-write ordinary construction-evidence/proof/permission path for
`repository-path-scope`, followed by `file-asset-index`. Provider contact
remains downstream of that chain and the trusted live-provider sequence.
Until the operator says otherwise, one operator owns repository mutation; do
not delegate repository work or run concurrent writers.

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
- The later handover update in this integration-model checkpoint is a declared
  dependency of the lifecycle member, so exact receipt replay correctly reports
  `PUBLISH_RECEIPT_CURRENTNESS_MISMATCH` for that member. The receipt remains an
  immutable observation of the admitted `846c5bb` transition; it is not current
  evidence for the changed lifecycle basis. The eligibility and basis-chain
  members remain independently scoped rather than being serialized by this
  documentation movement.
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

Do not copy semantic digests from this self-changing handover. Re-derive the
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
`checked-awaiting-integration`. In this later worktree, eligibility and
basis-chain retain that state, while the lifecycle member is reconstructable
because this handover moves one of its scoped dependencies. The generic
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

The command resources remain graph-declared `planned` and the implementation
intent remains `proofblocked` until the next bounded realization checkpoint.
That implementation is an explicitly recorded
`direct-bootstrap/manual-toolchain-repair` boundary because the commands needed
to process their own ordinary work do not yet exist. It may touch only the
intent's exact paths, reuse existing local canonicalization/containment/atomic
publication primitives, and add one compact test family. After implementation,
rederive the work basis again; do not form repository-path evidence against the
planned-command basis.

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
- `file-asset-index` is not cyclic: its target-labelled aggregate refusal comes
  from the unready `repository-path-scope` predecessor; a true dependency cycle
  must be reported separately as `WORK_DEPENDENCY_CYCLE`; and
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
`./bin/usf models summary --max-items 1`; do not copy digest literals from this
self-changing handover:

- 211 provider routes;
- 7,488 provider-route/model pairs;
- 3,834 underlying models;
- 171 known underlying model families;
- 28 adapter packages, of which 2 are installed; and
- 208 credential names.

The catalogue-only reasoning + tool-call + structured-output intersection is
3,216 route/model pairs across 163 routes, representing 1,391 underlying models
and 84 known families. Only 6 of those pairs currently have an installed
adapter. These are feature declarations, not semantic qualification,
entitlement, economics or availability evidence.

The six installed-adapter catalogue candidates are exactly Cerebras
`gemma-4-31b` and `gpt-oss-120b`, plus Groq
`openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
`openai/gpt-oss-safeguard-20b` and `qwen/qwen3.6-27b`. Only the two configured
members named below are route candidates today; installed adapter support does
not configure or qualify the other four.

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

The provider-census packet must deterministically union the fresh frozen
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

The intended deterministic CLI grouping is:

```text
usf models summary
usf models list --capabilities reasoning,tool-call,structured-output
usf providers census --profile PROFILE --manifest MANIFEST
usf providers status --route ROUTE
usf providers aliases
```

The census is linear over indexed candidates, cursor-bounded and JSON/JSONL
composable. It replaces the current single-capability, 1,000-item `usf models`
limit and produces the complete assigned/excluded/eligible-unassigned table.
Qualification is lazy by candidate and never expands into a
route-by-model-by-prompt test matrix.

“Full provider/model population” means every currently configured route and
every currently eligible route under the exact frozen inputs, with complete
assigned, excluded and eligible-unassigned dispositions. It never means
blindly invoking all catalogue entries or rebuilding a fixed list from V2
environment files.

## Provider safe sequence

This order remains mandatory for ordinary USF and Hermes alike:

1. graph-define and acquire a trusted exact-account tier receipt;
2. run the maintained adapter in a content-verified scrubbed child that receives
   only the selected credential variable and bounded public input;
3. acquire authenticated provider-produced semantic qualification answers
   through a registered command;
4. perform genuine task/profile hidden-holdout qualification;
5. wire live `route -> call` and the unattended composer;
6. demonstrate live multi-provider parallelism and semantic-token reduction
   only from accepted lineage.

The existing `probe availability` command refuses with
`PROBE_ACCOUNT_TIER_UNVERIFIABLE` before credential/adapter/provider contact.
The local semantic evaluator and route command replay supplied facts; they do
not authenticate provider production of those facts.

## Hermes-Agent boundary

`usf hermes` is the operator-requested optional management facade. It is not a
second Hermes platform, scheduler, workflow database, daemon, credential plane
or authority source.

The intended surface is:

```text
usf hermes
usf hermes start [--config config/hermes.json]
usf hermes status [--config config/hermes.json]
usf hermes stop [--config config/hermes.json] [--wait-ms N]
usf hermes doctor [--config config/hermes.json]
```

Bare `usf hermes` resolves one exact tracked default BAU intent and starts the
same foreground composer. Ordinary `usf start`/`usf stop` remain complete with
Hermes absent; ordinary `usf stop --instance hermes-bau` must be able to stop
the configured Hermes instance.

The tracked configuration is only a closed policy envelope directly binding an
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

The initial facade performs no credential lookup. Later live work must name one
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

The next implementation may truthfully prove:

- ordinary profile-bound start/status/stop still works without Hermes;
- the registered Hermes config/help/doctor surfaces are closed and local;
- Hermes bare/start/status/stop uses the same lifecycle instance and ordinary
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

Run from `/home/user/src/usf-v3`:

```sh
./scripts/bootstrap.sh
TMPDIR="$PWD/.usf/tmp" node --test \
  tests/contract/cli.test.ts \
  tests/integration/bootstrap-carrier.test.ts \
  tests/unit/schema/validator.test.ts
node --test tests/unit/providers/*.test.ts \
  tests/contract/provider-commands.test.ts \
  tests/integration/provider-cli.test.ts \
  tests/unit/graph/product-overlays.test.ts
TMPDIR="$PWD/.usf/tmp" \
  COREPACK_HOME="$PWD/.usf/cache/corepack" \
  corepack pnpm run check
TMPDIR="$PWD/.usf/tmp" ./scripts/verify-contained.sh
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

1. Independently review the copy-on-write construction-authority semantic
   packet, run the full authoritative and containment checks, then commit and
   push it as one coherent model checkpoint. On the resulting clean HEAD,
   repeat all three `usf bootstrap-carrier verify` calls to confirm the
   immutable receipts remain authenticated under unrelated graph movement.
2. Implement only the graph-registered `evidence construction`,
   `prove construction` and `publish construction-authority` surface plus the
   copy-on-write grant projection. Keep candidates ignored/stdout, batch one
   through thirty-two compatible bundles, keep full graph validation outside
   the narrow mutation lock except final readback, and use one compact test
   family. Update command resources from `planned` to `implemented` only in
   that qualified realization checkpoint.
3. Use those registered commands to form exact current evidence, proof and a
   copy-on-write grant for `repository-path-scope`; truthfully close its
   already-present realization only through graph-defined no-change semantics
   if the exact source needs no delta. Then complete
   `urn:usf:work:file-asset-index` through the profile-bound isolated V3 chain.
   Do not edit its already-present files merely to manufacture lineage; require
   a real accepted delta or truthfully close it as an exact no-change realization
   only after the graph explicitly defines that disposition and its evidence,
   proof and publication semantics.
4. Model the construction-command implementation's own exact historical
   carrier only in a later copy-on-write versioned authority after its coherent
   implementation commit/tree and complete allowed-path diff exist. Do not
   mutate the immutable version-1 permission, guess, caller-supply or
   retroactively rewrite that identity; it is not a serial prerequisite for
   repository-path-scope or file-asset-index.
5. Build the graph-defined provider census from every models.dev candidate plus
   reviewed V1/V2 credential-name/model provenance and distinct host adapters.
   Produce the full assigned/excluded/eligible-unassigned table before contact,
   then acquire account receipts, run scrubbed adapters, authenticate provider
   answers and perform hidden-holdout qualification. Only afterward demonstrate
   live multi-provider parallelism, semantic-token reduction or Hermes-Agent.

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
