# USF V3 handover

Updated 2026-08-31. The live continuation updates immediately below supersede
older next-action and carrier statements where they differ. The durable pushed
boundary is still `2b0c85b2d3da95cd542f29b1e34e36c3d29aae81`; later provider and registry
work remains in the primary workspace. Under exact profile
`urn:usf:profile:v3-self-host:3`, the earlier operator and provider completion
receipts are historical observations and are not current completion authority
for the live packet. The provider census remains blocked behind the deliberately
reopened predecessor-owned operator registry. Earlier `repository-path-scope`
and `file-asset-index` completion receipts likewise remain historical
profile observations and are not claimed current in profile 3. Routine
checkpoint documentation and unrelated tests are not functional work
dependencies. Full-universe provider qualification is not a prerequisite for
the earliest trusted provider vertical slice: discovery and qualification stay
lazy, bounded and candidate-driven. Until the operator says otherwise, one
operator owns repository mutation; delegated review is read-only and no
concurrent writer is permitted.

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

The refreshed operator construction publication is
`evidence/construction-authority/4fb034212ea2734dac12a279428dcf351fc1e4ac4ebb3b04f3a989118906c237.json`,
receipt digest
`sha256:0a4f60c47bc2553c84750320322b15b54be45615ed8f9f726e6ab6ae43cdf6af`.
The isolated candidate
`sha256:bc19a02c6d064762fd4e73d26c9cd7f78cc9ce2adb331327ac91794a78cd9095`
adds both `usf help providers host` and the graph-gated
`usf help providers host census` leaf plus one existing-registry assertion. Its
graph-selected operator check passed. Integration correctly refused with
`INTEGRATION_DETACHED_BASIS_MISMATCH` because the candidate basis includes the
current uncommitted semantic/provider carrier while detached integration starts
from pushed `HEAD`. Finish the coherent reviewed semantic carrier checkpoint,
commit and push it, then rederive the operator candidate against that exact
carrier; do not weaken detached-basis authentication.

The account-receipt schema finding is corrected in the primary packet by
removing unsupported `format: uri` while retaining bounded HTTPS patterns and
the runtime's exact endpoint validation. The focused provider topology test is
11/11 after replacing the false “every operational contract is a profile root”
assertion with exact implementing-work reachability and reciprocal scoped
dependency checks.

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

## Current provider-profile checkpoint

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

1. Resume only from the clean pushed provider/currentness checkpoint and use
   the explicit `urn:usf:profile:v3-self-host:3` plus
   `graph/manifests/self-host-provider-v3.json`. Re-read registered `usf work`,
   provider status and command help; do not create another historical carrier
   observation or reinterpret census, Git, tests or this handover as live
   provider authority.
2. Through `urn:usf:work:provider-account-tier-receipt`, implement the exact
   closed authorization/receipt schemas, field types, nullability, derivations,
   freshness and local verification plus the already registered
   `usf providers receipt acquire|verify` handler. Realise the explicit provider
   posture and entitlement/metering requirements needed by this capability.
   Keep construction and validation fixture-only and no-contact. The current
   OpenRouter mapping is insufficient alone and must refuse unless separate
   current evidence closes every zero-paid field.
3. Only after independent construction/completion proof, acquire one trusted
   exact-account zero-paid receipt under a separate immediate pre-contact
   AccountSourceAuthorization. Then implement and qualify the typed,
   content-verified scrubbed adapter child with only the selected credential and
   bounded public input. Refuse before contact if receipt, provider posture,
   adapter integrity, transport, credential mapping, privacy, metering or
   no-fallback controls are absent.
4. Acquire authenticated provider-produced semantic answers through the
   registered command and perform genuine hidden-holdout qualification for the
   exact task/profile. Repeat for a second independent provider family when the
   environment actually permits it; Claude must remain authoritatively
   unavailable here unless exact current evidence changes.
5. Only after those gates, run the minimal continuous live loop and demonstrate
   real multi-provider parallelism and semantic-token reduction with accepted
   lineage, exact token/cost/concurrency metrics and mechanically impossible
   paid fallback. Hermes-Agent remains optional and downstream of ordinary
   `usf start`/`usf stop`; it is not needed for the first USF-only vertical
   proof.

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
