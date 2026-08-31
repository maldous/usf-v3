# USF V3 handover

Updated 2026-09-01. The live continuation updates immediately below supersede
older next-action and carrier statements where they differ. The durable pushed
boundary is still `2b0c85b2d3da95cd542f29b1e34e36c3d29aae81`; no GitHub contact
or push occurred in this continuation. Local `main` is
`89c3ba9298ddb5fdfeae156abfbcf6f27c6b9085`, the committed profile-policy and
typed host-runtime-closure carrier. It includes the truthful historical
operator construction receipt; no source implementation from the isolated
operator draft has been materialised. Registered `usf status` reports current
profile semantic digest
`sha256:8ecd8e56e85f0bb7d66b1ee9464dd905cfaba8e68c3761492bd67652798865e0`.
Focused graph/provider validation passes 19/19 and `git diff --check` passes.

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

1. Commit the compatible two-member construction publication locally, then
   materialise the isolated operator dispatcher/help candidate only through
   registered `usf call`, `resolve`, `apply` and graph-selected `check`. It must
   select the unique typed production closure, authenticate all 17 host members
   and exclude unrelated packet dependencies. Independently verify, integrate
   and republish operator completion before dependent source work.
2. Materialise the dependent `urn:usf:work:provider-census` absence-isolation
   and doctor-readiness correction without rewriting operator-owned registry
   paths. Its host leaf must use the explicit provider-state root and a
   Bubblewrap `--unshare-net` projection, validate both closed result schemas,
   exercise the registered production handler, and preserve
   installed/authenticated/catalogued/entitled/qualified as distinct facts.
3. After independent provider-census completion, run the registered no-network
   host census against the explicit owner-controlled provider root. Report the
   complete bounded Codex and Claude host candidate surfaces plus frozen
   models.dev denominators and dispositions without inference. Installed host
   metadata and login state do not prove entitlement or semantic qualification.
4. Through `urn:usf:work:provider-account-tier-receipt`, implement the exact
   closed authorization/receipt schemas, field types, nullability, derivations,
   freshness and local verification plus the already registered
   `usf providers receipt acquire|verify` handler. Realise the explicit provider
   posture and entitlement/metering requirements needed by this capability.
   Keep construction and validation fixture-only and no-contact. The current
   OpenRouter mapping is insufficient alone and must refuse unless separate
   current evidence closes every zero-paid field.
5. Only after independent construction/completion proof, acquire one trusted
   exact-account zero-paid receipt under a separate immediate pre-contact
   AccountSourceAuthorization. Then implement and qualify the typed,
   content-verified scrubbed adapter child with only the selected credential and
   bounded public input. Refuse before contact if receipt, provider posture,
   adapter integrity, transport, credential mapping, privacy, metering or
   no-fallback controls are absent.
6. Acquire authenticated provider-produced semantic answers through the
   registered command and perform genuine hidden-holdout qualification for the
   exact task/profile. Repeat for a second independent provider family when the
   environment actually permits it; Claude must remain authoritatively
   unavailable here unless exact current evidence changes.
7. Only after those gates, run the minimal continuous live loop and demonstrate
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
