# USF V3 handover

Updated 2026-08-30. This is the durable continuation boundary after the file
asset index, restart-safe foreground lifecycle and bounded operator
observability slices.

## Verified state

- `d12cc89` realised the deterministic file asset index.
- `2bb9826` added the restart-safe foreground lifecycle and was pushed before
  this slice.
- `a636cb4` is the separately validated authored semantic boundary for
  `urn:usf:work:operator-observability`. Keeping that graph commit separate
  avoids claiming that a work packet authorized the semantic source that
  created the packet.
- `bbb0c33` clarifies that point-in-time `observe` remains distinct planned
  graph work; this slice implements help, broad status and bounded metrics.
- The implementation commit containing this handover adds repository-free
  static help, broad bounded status and local bounded metrics. At handover,
  verify its exact carrier with `git rev-parse HEAD` and require
  `HEAD == origin/main` before continuing.
- The authoritative no-force-exit check passed with 94 tests, 94 pass, 0 fail;
  the latest test-runner portion was 2.72 seconds and the full command took 4.6
  seconds. Containment and `git diff --check` also passed. This is not a
  ten-run p95 measurement.
- The self-host profile derives four isolated work packets from
  `graph/manifests/self-host.json`: repository path scope, file asset index,
  foreground lifecycle and operator observability. The reusable
  `graph/manifest.json` remains product-free.
- `usf --help`, `usf help ... --json` and command-local `--help` work outside a
  Git repository. One static registry reports purpose, synopsis, bounded
  options, output schema, exit codes, availability, external contact, history
  scan and authority effect.
- Bare `usf status` is again a broad cheap local summary. Semantic status
  requires both an explicit versioned profile and explicit product manifest;
  no product overlay is selected implicitly. `status lifecycle` and the
  initial `status --instance NAME` spelling remain available.
- `usf metrics summary|providers|models|tokens|runs|cache|failures|concurrency`
  reads only explicit bounded JSONL or ignored `.usf/metrics/` input. Reports
  use closed schemas, exact source digests, explicit coverage/denominators,
  bounded labels and unknown values distinct from zero.
- Requested route/provider/model and actual provider/model are separate.
  Useful tokens require exact accepted candidate, review, repair or proof
  lineage. Cost is never summed across currencies. Cache and concurrency
  ratios expose their denominators.
- `usf start`, `watch`, `stop` and lifecycle status use an exact named Linux
  `flock` boundary, foreground JSONL, bounded drain and restart from current
  facts. `start` and `watch` require both `--profile` and `--manifest`.

Run the authoritative checks before continuing:

```sh
./scripts/bootstrap.sh
TMPDIR="$PWD/.usf/tmp" COREPACK_HOME="$PWD/.usf/cache/corepack" corepack pnpm run check
TMPDIR="$PWD/.usf/tmp" ./scripts/verify-contained.sh
git status --short
git log -5 --oneline --decorate
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Derive the current self-host boundary explicitly:

```sh
./bin/usf work \
  --selector profile:urn:usf:profile:v3-self-host:1 \
  --manifest graph/manifests/self-host.json \
  --max-items 20
```

## CAS, GitHub and copy-on-write boundary

- No USF CAS is implemented or invoked. Git's internal object database is only
  the ordinary tracked source carrier/history, not semantic or runtime
  authority.
- `.usf/objects` is an empty/reserved, ignored, disposable repository-local
  content-addressed cache location. `scripts/bootstrap.sh` recreates it. No
  CAS-specific test lane is justified until an adapter exists.
- There is no tracked `.github` workflow and no self-hosted runner requirement.
  Optional GitHub-hosted CI may later run the same clean-clone local gate, but
  must start correctly with an empty `.usf/`; GitHub cannot become a cache,
  proof, scheduler or progress prerequisite.
- GitHub itself is not copy-on-write. Candidate isolation is local `usf apply`;
  the current implementation uses the bounded copied-snapshot fallback. The
  design permits a repository-contained reflink/copy-on-write adapter where it
  is measured and supported. Scoped semantic dependency digests—not GitHub—
  prevent unrelated graph movement from forcing whole-run reproof.

## Deliberate nonclaims

- The foreground lifecycle is a real unattended process-control shell, but its
  default cycle currently re-observes the selected profile and returns `idle`.
  It does not yet derive/dispatch work through live agents. Do not claim
  autonomous agent delivery or processed unattended batches.
- Operational metric events are not yet emitted by a complete live composer;
  the command aggregates explicit local records and fixtures only.
- Live zero-cost provider qualification/routing/calls are not implemented.
  Configured route count is not eligibility, availability, quota or capacity.
- Scheduler/cache completion is not yet bound to exact profile, packet, route,
  prompt, tool and scoped dependency identity.
- Apply/check does not yet recompute semantic currentness after derivation, and
  route eligibility does not yet enforce packet capability/privacy/cost.
- Evidence, prove, drift, publish, observe and doctor remain planned or
  incomplete. Status/metrics are observations, never evidence or proof.
- The complete V1/ANQR semantic denominator is not yet encoded. No full ANQR,
  staging, production-shaped, production-live, enterprise-complete or terminal
  proof claim exists.

## Next safe work

Do not restart historical inventory and do not prompt for Factory access.

1. Re-run the exact checks above and derive the current self-host profile.
2. Author and validate a new graph contract/work packet for the smallest real
   foreground composer cycle: `work -> route/call -> resolve -> apply -> check`
   using the current fake-provider boundary first. Keep each command a
   composable foreground process and keep systemd/s6/runit optional outside
   USF.
3. Bind scheduler completion/cache and workspace/apply/check to exact profile,
   packet, route, prompt, tool and semantic dependency identities before live
   providers.
4. Enforce dynamic capability, privacy and zero-paid-cost route eligibility,
   then add explicit live probes separately from local status.
5. Make a different profile produce and validate materially different text and
   binary assets without a product-specific engine branch.
6. Complete the V1/ANQR denominator and V2 convergence/currentness semantics,
   then proceed to evidence/proof/drift and production-shaped work.

The next composer contract must not reintroduce V2 leases, fences, journals,
handovers, signatures, state databases, global lifecycle checkpoints or
GitHub/CAS dependencies. Restart rescans current file/graph facts. External Unix
supervision owns backgrounding, restart and forced termination.

## Test portfolio boundary

- Keep the current Node test runner and named unit, contract, integration,
  lifecycle, adversarial and scale lanes.
- Run the smallest risk-owning lane while iterating, but retain the full local
  gate at integration/publication/acceptance boundaries.
- Add a test only for a unique semantic acceptance/refusal, serialization
  invariant or true process boundary. Prune a duplicate in the same change.
- Do not use `--test-force-exit`, wall-clock sleeps, flaky retries, provider or
  GitHub calls. Keep temporary state beneath `.usf/tmp`.
- If a local object-store adapter is later implemented, test immutable digest
  writes, containment, corruption/refusal and cold-cache reconstruction. Do not
  require a warm cache or self-hosted runner.

## Skills and plugins

- `cli-creator` was used for the operator CLI boundary.
- `security-best-practices` is installed for an explicit TypeScript security
  review; its trigger did not apply merely because this was general hardening.
- `linear` is only for explicit issue operations and is never semantic
  authority.
- No additional plugin was installed. Context7 is not present and would only
  assist documentation lookup, not runtime composition, supervision, CAS or
  proof. Codex Security may be considered only for a separately requested
  security audit.

## Follow-up prompt

Use this prompt in a new session:

> Read `/home/user/src/usf-v3/GOAL.md` and
> `/home/user/src/usf-v3/docs/handover.md` completely. Inspect Git status/log,
> verify `HEAD == origin/main`, run the exact authoritative and containment
> checks recorded in the handover, and derive the explicit self-host profile
> from `graph/manifests/self-host.json`. Continue from the recorded safe
> boundary; do not restart inventory or prompt for Factory access. Use installed
> skills only when their trigger rules apply. First graph-define and realise the
> smallest unattended foreground composer cycle through the existing fake
> provider and isolated apply/check boundaries. Preserve Unix CLI composition,
> explicit profile plus manifest selection, product-overlay isolation, scoped
> semantic currentness, file-based authority, cold-start reconstruction,
> optional ignored local CAS/database state, GitHub independence, test
> economics and the no-signatures/no-V2-operational-ceremony boundary. Do not
> claim autonomous live-agent delivery, full ANQR, staging, production or
> terminal proof without exact evidence.
