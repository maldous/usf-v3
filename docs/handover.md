# USF V3 handover

Updated 2026-08-30. This is the durable continuation boundary after the file
asset index, restart-safe foreground lifecycle, bounded operator observability,
and provider semantic-qualification foundation slices.

## Verified state

- `d12cc89` realised the deterministic file asset index.
- `2bb9826` added the restart-safe foreground lifecycle.
- `a636cb4` and `bbb0c33` established the operator-observability boundary and
  kept point-in-time observation separate from metrics aggregation.
- `9dc87f1` graph-defined `urn:usf:work:provider-semantic-qualification`.
- `1c894fa` completed that graph contract before implementation. This preserves
  the rule that work does not authorize the semantic source that created it.
- `baea79d` extended that contract before changing the launcher, authorizing the
  smallest `bin/usf` containment repair needed to keep Node from consuming USF
  options such as `--env-file`.
- The implementation commit carrying this handover realises the graph-defined
  provider work. Resolve its exact identifier with `git rev-parse HEAD` and
  require `HEAD == origin/main` before continuing.
- The authoritative provider lane passed 71 tests, 71 pass, 0 fail. The full
  no-force-exit repository check passed 156 tests, 156 pass, 0 fail; the latest
  test-runner portion was 5.23 seconds and the full command took 7.95 seconds.
  These are single observations, not a ten-run p95 measurement.
- Independent routing review passed 14/14 focused tests plus typecheck and
  found no remaining blocker in its reviewed route/schema/test slice.

Derive the exact current work packet rather than copying an older scoped
dependency digest:

```sh
./bin/usf work \
  --selector urn:usf:work:provider-semantic-qualification \
  --max-items 10 \
  --manifest graph/manifests/self-host-provider.json
```

The packet authorizes only its explicit read/write sets. Product overlays stay
isolated and the reusable `graph/manifest.json` remains product-free.

## Provider and qualification boundary

The tracked provider configuration currently declares two candidate direct
routes:

- Cerebras `gpt-oss-120b` through `@ai-sdk/cerebras`, with service tier
  `default` at probe time.
- Groq `qwen/qwen3.6-27b` through `@ai-sdk/groq`, with service tier
  `on_demand` at probe time.

They are candidate declarations, not availability or semantic-qualification
claims. Both routes remain live-ineligible and semantically unqualified at this
handover because no current exact-account zero-paid evidence, live successful
probe, or provider-produced semantic answer set has been admitted.

The implemented boundary has two deliberately separate layers:

1. Mechanical availability and economics: the pure probe contract requires a
   frozen raw/normalized catalogue pair, current adapter package/version plus
   lockfile-artifact observation,
   explicit owner-only untracked credential file, three independent current
   economics facts, positive request and token headroom, paid use and overage
   disabled, hard zero spend, a fixed public-safe prompt, explicit service tier,
   no retries, bounded output/time, and exact requested/actual identity. The
   registered availability command currently refuses before credentials,
   adapters, or provider contact because no trusted exact-account tier receipt
   acquisition path exists.
2. Semantic task qualification: one task class is scored against an exact
   versioned suite/corpus/policy. Missing answers score zero and the default is
   `UNQUALIFIED`. Results bind provider, requested/actual model, route,
   catalogue, effective policy, provider configuration, successful probe,
   answers, adapter version/lock, auth mode, and tool/prompt/context/output
   version plus content digests. Results are time-bounded and derived role
   labels grant no authority.

The V3 suite is an original clean TypeScript implementation. The inspected V2
Factory release is readable but all rights reserved; no V2 Factory source or
corpus bytes were copied. `provenance/reuse.json` therefore remains empty.

## Registered operator commands

Use the registered CLI rather than rediscovering operational shell recipes:

```sh
./bin/usf doctor [--env-file PATH]
./bin/usf models summary [filters]
./bin/usf models list [filters]
./bin/usf models refresh [filters] [--timeout-ms N] [--max-bytes N]
./bin/usf probe availability \
  --route ROUTE_ID \
  --env-file PATH \
  --economics .usf/inputs/FILE.json \
  --allow-inference \
  --max-cost-usd 0 \
  [--timeout-ms N]
./bin/usf probe semantic --input .usf/inputs/FILE.json
producer | ./bin/usf probe semantic --input -
./bin/usf route --input .usf/inputs/FILE.json [bounded overrides]
producer | ./bin/usf route --input -
```

`doctor`, local model views, semantic evaluation, routing, and the current
availability preflight do not contact a provider. `models refresh` contacts only
the fixed models.dev origin and writes only ignored private catalogue snapshots.
`probe availability` validates bounded intent/economics inputs and then returns
`PROBE_ACCOUNT_TIER_UNVERIFIABLE` with exit 4. It cannot contact a provider until
a graph-defined registered command acquires a trusted exact-account tier receipt.
The pure probe core and tests retain injected transports for deterministic
qualification mechanics; that is not a live command path.

`.env.example` names `GROQ_API_KEY` and `CEREBRAS_API_KEY` without values. A
historical V2 environment file was inspected only through the registered
read-only `doctor` boundary for credential-name presence. Do not copy, print,
digest, persist, or wholesale export its values. Normal V3 operation must use
an explicitly selected owner-only mode-0600 untracked credential file.

`usf --help`, command-local `--help`, and `usf help ... --json` work outside a
Git repository. The static registry documents synopsis, bounded options,
output schema, exit codes, availability, external contact, history scan, and
authority effect. `query` documents all three selectors (`--selector`, `--iri`,
`--contract`); `work` documents `--ready`, `--stream`, and `--shard`. The shell
launcher uses Node's `--` option terminator, so every following option belongs
to USF rather than the Node runtime. Repository inspection children receive a
minimal environment and fixed `/usr/bin:/bin` executable search path; caller
Git controls, credential helpers, secrets, and planted PATH shims are absent.

`usf route` separately loads the unchanged indexed
`config/qualification.json` suite and policy. The route envelope carries only
bounded replay sources and digest references; it cannot supply its own suite or
policy. Routing recomputes each semantic result and refuses absent, mismatched,
dirty, or self-defined qualification authority. This is file-based deterministic
authority, not a signature or proof that supplied answers came from a provider.

## Core/product directionality and currentness

USF core and each product profile evolve independently. Routing carries the
exact version and digest of both axes, constructs separate core-to-product and
product-to-core digests, and binds them into a composite digest. This makes the
dependency direction explicit:

- a core change can identify which product interpretation must be reconsidered;
- a product change can identify which core contract it is asking to satisfy;
- unrelated movement does not invalidate a route or force global reproof; and
- a product that is not applicable is represented explicitly rather than
  silently inheriting ANQR.

The digests are deterministic currentness identities, not signatures. GitHub
does not create or own them.

## Lifecycle, CAS and GitHub boundary

- `usf start`, `watch`, `stop`, and lifecycle status retain the Unix ceiling:
  one foreground composable process, exact named `flock` ownership, bounded
  drain, restart from current file/graph facts, and optional external commodity
  supervision. Deliverables have explicit `usf start` and `usf stop` surfaces.
- The current lifecycle cycle re-observes its selected profile and can remain
  idle; it does not yet drive the live provider qualification/call pipeline or
  autonomously complete unattended work.
- No USF CAS is implemented or invoked. Git's object database is ordinary
  source history, not semantic or runtime authority. `.usf/objects` is an
  ignored disposable reserved cache location; no CAS-specific test or hosted
  runner is justified until an adapter exists.
- There is no tracked `.github` workflow and no self-hosted GitHub runner
  requirement. Optional hosted CI may later execute the same clean-clone local
  gate, but GitHub cannot become a cache, proof, scheduler, progress, provider,
  or currentness prerequisite.
- GitHub is not copy-on-write. Candidate isolation is local `usf apply`, using
  the bounded copied-snapshot fallback today. A measured repository-contained
  reflink adapter may be added later where supported.

## Authoritative checks

Run these from `/home/user/src/usf-v3` before continuing or publishing:

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

The default tests are hermetic and fixture-backed. Live provider calls and
GitHub calls are not part of the gate. Keep table-driven pure tests and one
fixture-backed command chain; add a test only for a distinct semantic
acceptance/refusal, serialization invariant, or true process boundary.

## Deliberate nonclaims

- No live provider call was made in this slice.
- Groq and Cerebras have not been semantically qualified for any V3 task class.
- Credential presence, catalogue membership, adapter installation, and a
  successful mechanical probe do not establish semantic usefulness.
- The current adapter observation binds package, version, and pnpm integrity
  metadata; it does not hash the installed adapter, AI SDK, or transitive bytes.
  It cannot support live contact until a clean/content-verified runtime boundary
  is implemented.
- Evidence source digests bind operator-supplied fact content for deterministic
  replay; they do not authenticate those facts or replace provider signatures.
- The local semantic evaluator scores supplied answer records. It does not yet
  acquire or authenticate provider-produced answers itself.
- Its tracked suite is deterministic fixture material. Cases marked `holdout`
  are not confidential while stored in the repository and do not establish a
  V2 hidden-holdout qualification lane.
- The route CLI derives its suite/policy authority from unchanged indexed
  `config/qualification.json` and rejects a self-defined suite/policy envelope.
  Replay still consumes supplied answer records; it does not authenticate their
  acquisition or make its assignment evidence, proof, or semantic publication.
- Fixture routing proves deterministic partition and multi-family selection,
  not live two-provider parallel execution.
- No useful-token or semantic-token reduction has been demonstrated with live
  accepted lineage.
- Operational metrics, lifecycle state, and route results are not evidence,
  proof, semantic authority, or completion.
- No full ANQR, staging, production-shaped, production-live, enterprise-complete,
  or terminal proof claim exists.

## Next safe work

Do not restart historical inventory and do not prompt for Factory access.

1. Verify the exact handover commit, checks, containment, and graph-derived work
   packet. Preserve the graph write set and explicit V3 profile/manifest.
2. Use `usf doctor` and local `usf models` views for readiness. Refresh the
   catalogue only through explicit `usf models refresh`; do not infer
   availability from catalogue data.
3. Graph-define and implement a registered trusted exact-account tier receipt
   acquisition path. The receipt must bind the provider, route/model, account or
   organization reference, credential-reference name, acquisition mechanism and
   version, raw source digest, observation/expiry times, paid-use and overage
   state, hard-zero cap, quota headroom, and economics digest. Operator-authored
   assertions cannot unlock contact. Only after this exists may the availability
   command invoke a provider.
4. Before removing the availability refusal, run provider adapters in a scrubbed
   child boundary that receives only the selected credential variable and
   bounded public input. Verify installed adapter, AI SDK, and relevant
   transitive bytes against the accepted package artefacts; package/version and
   lock integrity metadata alone are insufficient.
5. Before calling either candidate semantically qualified, graph-define and
   implement the smallest registered command that acquires every qualification
   answer through the exact route/profile/tool/prompt/context/output tuple. The
   current evaluator must not be paired with ad-hoc provider calls.
6. Evaluate the complete task-scoped answer sets, route only exact current
   qualified profiles, and retain complete included/excluded/eligible-unassigned
   dispositions.
7. Graph-define the live call/answer-acquisition and unattended composer slice
   so `work -> route -> call -> resolve -> apply -> check` runs through
   composable foreground USF commands with `start`/`stop`, provider caps,
   accepted-lineage token accounting, and no GitHub/CAS dependency.
8. Demonstrate two independent live provider families and semantic token
   reduction only after the exact records support those claims. Continue the
   remaining ANQR and production posture denominator separately.

The next slice must not reintroduce V2 leases, fences, journals, handovers,
signatures, state databases, global checkpoints, fixed provider rosters, or
GitHub/CAS authority. Restart must reconstruct from current files and graph
facts; external Unix supervision owns backgrounding, restart, and forced
termination.

## Skills and plugins

- `cli-creator` guided the stable JSON, local-first, composable command surface.
- `security-best-practices` guided the explicit TypeScript/Node credential,
  child-process environment, fixed-origin, bounded-input, and fail-closed
  review. No language-specific plugin beyond that installed skill was needed.
- `plugin-management` confirmed that the local CLI, Git, Node test runner, and
  installed security skill already cover this slice; no external app closes the
  missing trusted provider/account evidence boundary.
- `linear` remains available only for explicit Linear issue operations and is
  never semantic authority.
- No additional plugin was installed. Context7 is not installed and would only
  help documentation lookup, not runtime qualification, supervision,
  parallelisation, CAS, or proof. Codex Security should be considered only for
  a separately requested security audit.

## Follow-up prompt

> Read `/home/user/src/usf-v3/GOAL.md` and
> `/home/user/src/usf-v3/docs/handover.md` completely. Inspect Git status/log,
> require `HEAD == origin/main`, run the exact authoritative provider, full and
> containment checks, and derive
> `urn:usf:work:provider-semantic-qualification` through
> `graph/manifests/self-host-provider.json`. Continue from the recorded safe
> boundary; do not restart inventory or prompt for Factory access. Use
> registered `usf` commands rather than ad-hoc operational commands. First
> close exact provider-produced semantic answer acquisition, then establish
> current zero-paid availability and task/profile qualification before live
> multi-provider routing. Preserve product-overlay isolation, explicit
> versioned profiles, bidirectional core/product digests, scoped currentness,
> Unix foreground `start`/`stop`, file-based authority, ignored optional local
> CAS/database state, GitHub independence, test economics, and the
> no-signatures/no-V2-operational-ceremony boundary. Do not claim live
> parallelism, useful-token reduction, full ANQR, staging, production or
> terminal proof without exact evidence.
