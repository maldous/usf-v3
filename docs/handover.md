# USF V3 handover

Updated 2026-08-30. This is the durable continuation boundary after bounded
semantic-recovery tooling and the graph authority for optional Hermes-Agent
autonomous management.

## Verified carrier and gate

- The pre-authority baseline was clean and pushed at
  `d974570dbe608503ffd94ccbf9ede9eeb06f4d18`
  (`feat: add bounded semantic recovery tooling`).
- `HEAD == origin/main` held before the authority change.
- The focused provider lane passed 71 tests, 71 pass, 0 fail; the observed
  runner duration was 1.963 seconds.
- The full no-force-exit check passed 165 tests, 165 pass, 0 fail; the observed
  runner duration was 5.132 seconds and full command wall time 8.183 seconds.
- Containment passed and no provider was contacted.
- These are single observations, not a ten-run p95 baseline.
- After the authority corrections, the focused provider/product lane passed 72
  tests, 72 pass, 0 fail; the observed runner duration was 2.038 seconds. The
  full no-force-exit check passed 166 tests, 166 pass, 0 fail; the observed
  latest runner duration was 5.643 seconds and full command wall time 8.656
  seconds.
  Bootstrap again reported `providerContacted:false`, containment passed and
  `git diff --check` passed.
- The commit carrying this handover deliberately amends `GOAL.md`, adds
  `graph/hermes-management.nq` and
  `graph/manifests/self-host-hermes.json`, plus the isolated ANQR intent overlay
  under `graph/products/anqr/`, and documents the exact management boundary
  before implementation. Resolve its final identity with
  `git rev-parse HEAD` and require `HEAD == origin/main` before continuing.

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

The two packets are the implementation authority. Respect each exact read/write
set: the core packet authorizes only the product-neutral facade; the product
packet authorizes the ANQR config and overlay proof. Their projected
construction constraints prohibit provider, credential and Hermes-Agent
contact in this hermetic slice. They do not authorize credential migration,
Docker runtime wiring or changes to provider qualification gates.

The corrected core manifest semantic digest is
`sha256:3ac817ca9f981ff90bf54cc745fa50fd1627f6bb4cc7e2021e150759b1063595`;
the combined ANQR manifest semantic digest is
`sha256:ef0134f2d75c383093370ac1c2297500b9bb5f692dd885515ae896cfd49fb10b`.
Scoped packet digests include this handover and must be re-derived after the
authority commit rather than copied from this self-changing document.

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

## Provider and model population

The frozen local models.dev snapshot currently observes, at raw digest
`sha256:cf152b9edf266b2caf567f2d8d92735a6d5976ccf7e69f44f97e769f93ec1d6b`
and normalized digest
`sha256:21d809321eb0a31a8b346c686dac206cf3fd9026274d5e83a0b5525de3de9e6a`:

- 211 provider routes;
- 7,488 provider-route/model pairs;
- 3,834 underlying models;
- 171 known underlying model families;
- 28 adapter packages, of which 2 are installed; and
- 208 credential names.

This catalogue is not a configured roster or availability result. The tracked
provider configuration currently declares only:

- Cerebras `gpt-oss-120b` through `@ai-sdk/cerebras`; and
- Groq `qwen/qwen3.6-27b` through `@ai-sdk/groq`.

Both remain live-ineligible and `UNQUALIFIED`: no trusted current exact-account
zero-paid receipt, live successful probe or authenticated provider-produced
semantic answer set has been admitted. OpenAI/Codex catalogue entries and this
Codex session do not make a Codex route configured or qualified.

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

Two independent lanes are available; optional Hermes work must not delay the
provider-critical lane.

Provider-critical lane:

1. Continue trusted account receipt acquisition, the scrubbed
   content-verified adapter child, authenticated answers and genuine
   hidden-holdout qualification before any live-parallel or token-reduction
   demonstration.

Explicitly requested optional facade lane:

1. Validate, independently review, commit and push this graph/documentation
   authority packet.
2. Re-derive `urn:usf:work:hermes-management-facade` and the profile-selected
   `urn:usf:work:hermes-bau-binding` from the committed manifests; obey the
   union of their exact write sets.
3. Implement the smallest closed config/schema and registered
   bare/start/status/stop/doctor facade over the existing lifecycle and provider
   readiness result, with no provider, credential or Hermes-Agent contact.
4. Run ordinary USF, ordinary ANQR and Hermes fixture-backed start/stop, both
   graph-defined test commands, full check and containment; independently
   adversarially review the exact diff.
5. Commit/push the coherent implementation and update this handover with exact
   evidence and nonclaims.

Do not restart historical inventory, prompt for Factory access, reintroduce V2
leases/fences/journals/handovers/signatures/state databases, or claim full ANQR,
staging, production, production BAU or terminal proof without exact evidence.
