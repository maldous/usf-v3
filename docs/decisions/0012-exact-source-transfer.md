# 0012 — Exact source transfer proposal

USF-1161 is a source-availability decision prerequisite. On 2026-09-06 both source trees are available locally, but a successor without this host cannot obtain the exact intended checkpoints from the advertised remote branches. Publication remains unperformed.

| Owner | Local repository and source | Verified private GitHub repository | Advertised branch state |
| --- | --- | --- | --- |
| USF | `/home/user/src/usf-v3`; commit `76a3adb9f3448ecdcdf0843af2182219b54a2b86`; tree `02add09d12a776937487398e0aa709c3e0833e29` | `maldous/usf-v3` | `anqr-experience-realisation` at `3fedcddfa3400f59df56d07e8813fe97ce0f2445`; main at `8fa2ef7265d39551f4d8704e20feb61ed34c90e1` |
| ANQR | `/home/user/src/anqr`; commit `915e03a14d546cb5e4243f4fb89afa95f7e4e825`; tree `46201ae883c81d000c08dd5ab082fcc1a59e6256` | `maldous/anqr-v3` | main at `1cf44ce093028f77bbf6a4db67ae1d0600570283`; no advertised `anqr-experience-realisation` branch |

Read-only `git ls-remote --heads origin` and GitHub repository privacy read-back succeeded for both. Advertised branch absence establishes an unavailable advertised carrier, not that a commit cannot exist in any hidden remote object. These are dated source observations, not a claim that a later local HEAD has been published.

Physical layout is preserved. All `graph/manifests/*.json` and their source/import paths resolve from the USF repository root, including `graph/products/anqr/`, UIF/UXF foundation definitions and adoption manifests. ANQR application source remains in the separate ANQR repository. Product semantics stored in USF do not transfer ANQR ownership. A successor must retain both roots and explicitly choose the required profile/manifest; the revision-3 application default cannot silently substitute for revision-4 safety intent or unresolved foundation adoption.

The concrete proposed publication creates two new private remote refs from exact immutable commits, without switching either shared checkout or changing existing refs:

```sh
git -C /home/user/src/usf-v3 push origin 76a3adb9f3448ecdcdf0843af2182219b54a2b86:refs/heads/transfer/usf-1161-76a3adb
git -C /home/user/src/anqr push origin 915e03a14d546cb5e4243f4fb89afa95f7e4e825:refs/heads/transfer/anqr-1161-915e03a
```

These commands have not been run. Before each separately approved transfer, verify the target ref is absent, remote identity/privacy is unchanged, the exact commit/tree is present, and the outgoing tracked history has completed a secret-content review. Abort if the ref exists; never force, reset, overwrite, delete a remote ref, change visibility or upload credentials. The current pathname-only sensitive-file inventory is not a secret-content/history clearance. Approval must identify each repository, commit and destination ref; ANQR publication permission is separate. A newer accepted checkpoint requires a new exact proposal rather than silently substituting HEAD.

A successor can then fetch those exact new refs into empty clones, check detached commit and tree equality with `git rev-parse`, run `git fsck`, and verify no tracked modifications. That establishes source identity only. A local bundle/archive, clean clone, package bootstrap, independent validation or remote publication has not been performed in this task. Until transfer, the precise blocker is `EXACT_SOURCE_NOT_ON_ADVERTISED_REMOTE_REF`; request host access or approve the two exact publication targets. This is an operator decision label, not a claimed runtime code.

Ignored prerequisites must be reconstructed, not copied: `.usf/` state and node_modules in both roots, ANQR apps/web/dist, contained provider HOME, caches, credentials, observations, candidate workspaces and process/session state. Exclude `.env` files, key/certificate material, secrets, logs and generated output. USF source includes credential-related implementation/schema filenames; names alone reveal no secret and do not establish a leak. No secret values were inspected or included here. The three uncommitted ANQR files (qrdecoding.ts and the qrdecoding/platformparity conformance tests) are excluded because the proposed immutable commit predates them; preserve their working bytes.

Bootstrap prerequisites: compatible Node (declared >=22; current observed 24.16.0), Git, the repository-pinned package manager and a supported contained Linux runtime. USF README prescribes scripts/bootstrap.sh, a frozen pnpm install, usf init and verify-contained; ANQR prescribes npm ci followed by typecheck/test/architecture/build/delivery. These are references to later separately admitted execution, not commands run in this inventory. USF-1182 remains a precise blocker: package.json omits n3, oxigraph and rdf-validate-shacl while the root lock importer still lists them, so frozen clean bootstrap has not been proved. Do not run pnpm run as a source reader; the installed compiler can be used directly only under current authority, and a missing compiler must refuse rather than fetch. ANQR build requires the separately proposed USF-1170 execution envelope. Node_modules present locally and prior passing checks prove neither clean-clone installation nor successor reproducibility.

This decision closes the inventory/proposal boundary only after independent review. It grants no publication, runtime permission, package network access, credentials, deployment, product completion or production availability. A successor sees exact source identities and explicit transfer/bootstrap blockers instead of an implied reproducibility claim.
