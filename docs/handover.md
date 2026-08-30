# USF V3 handover

Updated 2026-08-30. This is the durable continuation boundary after the first
bootstrap and dynamic-product architecture pass.

## Verified state

- Authoritative TypeScript and Node check: 64 tests, 64 pass, 0 fail.
- Gate 0 repository/bootstrap/containment is committed and pushed.
- The minimal query → work → fake call → resolve → isolated apply → graph-
  selected focused-check path works.
- A graph-defined USF path-scope change was produced by two deterministic fake
  provider families, checked outside the primary tree, integrated as exact
  candidate bytes, and rechecked under the current profile boundary.
- The reusable default manifest contains no product contracts. USF self-host,
  ANQR and a non-authoritative Orchard creative-asset fixture are isolated
  overlays with a shared foundation import.
- Versioned profiles select exact contracts. Scoped self-host identity is byte-
  identical with or without unrelated product overlays.
- Work packets now carry requirements, typed artifact projections, decision
  boundary, environment posture, privacy, acceptance, validation, proof and
  model capabilities into provider assignments.
- Text and base64 candidate file operations are represented; media-specific
  validation is not yet complete.
- The default semantic adapter is file-derived and in memory. Any optional CAS
  or persistent third-party index/database must be disposable under ignored
  `.usf/`. No signatures or signing ceremony are planned.

Run the authoritative check before continuing:

```sh
COREPACK_HOME="$PWD/.usf/cache/corepack" corepack pnpm run check
```

## Deliberate nonclaims

- The complete V1/ANQR semantic denominator is not yet encoded.
- The Orchard graph proves different product/asset projection, not end-to-end
  creative asset delivery.
- Live zero-cost provider qualification and calls are not implemented.
- Scheduler/cache completion is not yet bound to profile, route, prompt, tool
  and scoped dependency identity.
- Apply/check does not yet recompute semantic currentness after derivation.
- Route eligibility does not yet enforce packet capability/privacy constraints.
- Evidence, prove, drift, publish, status and doctor are incomplete.
- No staging, production-shaped, production-live, enterprise-complete or
  terminal-proof claim exists.

## Next safe work

The self-host profile now declares a second ready contract,
`urn:usf:contract:file-asset-index:1`, with work
`urn:usf:work:file-asset-index`. Its intended output is a small deterministic
file metadata index and tests; it must be realised through the profile-bound
V3 chain, not manually. The graph explicitly keeps database/CAS state optional,
ignored and non-authoritative.

After that chain:

1. bind scheduler completion/cache and workspace/apply/check to exact profile,
   packet, route, prompt, tool and semantic dependency identities;
2. enforce dynamic route capability/privacy/cost eligibility;
3. make one different profile create and validate materially different text and
   binary assets end to end without a product-specific recipe;
4. finish the full V1/ANQR denominator and V2 convergence/currentness model;
5. proceed to live providers, evidence/proof/drift and production-shaped ANQR.

## Historical/user constraints to preserve

- V1 value is complete semantic authority/denominator; V2 value is safe
  parallel convergence, currentness and environment realisation.
- ANQR builds upon USF but is not embedded in the kernel. New products reuse
  only knowledge explicitly adopted by their versioned profile.
- Dev, hermetic, integration, CI, production-shaped, staging and production-
  live are distinct; lower-environment evidence cannot promote itself.
- Prefer maintained third parties (models.dev, Vercel AI SDK/provider packages,
  RDF/SHACL/schema/Git libraries) behind narrow replaceable adapters.
- Stardog may be reconsidered as an optional measured adapter.
- Do not copy a provider catalogue into the graph or rebuild commodity provider
  translation.
- No external CAS, sibling runtime, required database, cryptographic signing
  ceremony, Factory/Graph split, leases, fences, handovers or witness protocol.
- Historical Factory remains inaccessible because the host enforces no-new-
  privileges despite the path requiring root; do not prompt again.
- Linear is provenance only, never semantic authority.

## Session tooling

The curated `cli-creator`, `security-best-practices` and `linear` skills were
installed in `~/.codex/skills` at this boundary and become available on the
next turn/session. No new deployment or database plugin was installed.

## Follow-up prompt

Use this prompt in a new session:

> Read `/home/user/src/usf-v3/GOAL.md` and
> `/home/user/src/usf-v3/docs/handover.md` completely, inspect Git status/log,
> and run the authoritative check. Continue from the recorded safe boundary;
> do not restart inventory or prompt for Factory access. Use the newly installed
> `cli-creator`, `security-best-practices`, and `linear` skills when their
> trigger rules apply. First finish the graph-defined
> `urn:usf:work:file-asset-index` through the profile-bound isolated V3 chain,
> then independently verify and commit/push it. Preserve product-overlay
> isolation, explicit versioned profile selection, scoped semantic currentness,
> file-based authority, ignored repository-local optional CAS/database state,
> and the no-signatures/no-V2-operational-ceremony boundary. Do not claim full
> ANQR, staging, production or terminal proof without exact evidence.
