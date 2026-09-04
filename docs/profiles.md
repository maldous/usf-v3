# Profiles

Three different things in this repository are called a profile. They are not
variants of one idea, and conflating them is how a completion gets attributed
to the wrong denominator.

| kind | IRI shape | type | what it decides | how it is read |
|---|---|---|---|---|
| Core realisation profile | `urn:usf:profile:<name>:<n>` | `urn:usf:type:RealisationProfile` | which **contracts** are in construction/completion scope | `usf work --profile <IRI> --ready` |
| Product realisation profile | `urn:anqr:profile:<name>:<n>` | `urn:usf:type:RealisationProfile` | the same, for a product's own operating lane | `usf work --profile <IRI> --ready` |
| Product profile **revision** | `urn:anqr:profile-revision:<n>` | `urn:usf:type:ProductProfileRevision` | the product's **denominator**: which capabilities, surfaces, domains and exclusions exist at all | `usf profile status --manifest <product manifest>` |

A manifest is a fourth, orthogonal thing: it selects which graph **sources**
load. No manifest names a profile — verified across all twenty manifests. The
manifest decides what is readable; the profile decides what is in scope within
it. That is why the same manifest can be read with no profile (observational)
and refuses `--ready` with `REALISATION_PROFILE_REQUIRED`: reading needs no
authority, and selecting ready work does.

## Core realisation profiles

All seven share the identical four policies:

| policy | value |
|---|---|
| `semanticOrderPolicy` | `urn:usf:policy:semantic-first:1` |
| `directionalCurrentnessPolicy` | `urn:usf:policy:directional-currentness:1` |
| `adoptionPolicy` | `explicit-semantic-delta` |
| `reconstructionPolicy` | `exact-closure-or-block` |

**So a profile is a scope selector, not a behaviour switch.** Nothing about how
currentness, adoption or reconstruction work changes between them; only the
selected contract set does. Two profiles over the same contracts would behave
identically, which is why there are none.

| profile | selected contracts | what the lane is for |
|---|---|---|
| `v3-semantic-first:1` | `semantic-first-order:1` | the ordering axiom alone — model before implementation. The floor every other profile stands on. |
| `v3-self-host:1` | `semantic-first-order:1`, `repository-path-scope:1`, `file-asset-index:1`, `foreground-lifecycle:1`, `operator-observability:1` | USF operating on itself: paths, assets, a foreground process, observability. |
| `v3-self-host:2` | `:1`'s five **+** `provider-semantic-qualification:1` | the same, once a provider can be semantically qualified. |
| `v3-self-host:3` | `repository-path-scope:1`, `file-asset-index:1`, `operator-observability:1`, `provider-semantic-qualification:**2**`, `provider-census:1`, `provider-adapter-preflight:1`, `provider-authenticated-answers:1`, `provider-account-tier-receipt:1`, `provider-hidden-holdout:1`, `provider-live-parallel-run:1`, `provider-parallel-execution:1`, `provider-semantic-token-reduction:1` | the live provider lane. Widest, and **not** a superset: it drops `foreground-lifecycle:1` and `semantic-first-order:1` from its selection and upgrades qualification to `:2`. |
| `v3-self-host-hermes:1` | `:2`'s six **+** `hermes-autonomous-management:1` | autonomous operation of the lifecycle. |
| `v3-semantic-recovery:1` | `semantic-first-order:1`, `semantic-recovery-exchange:1` | recovering semantics from V1/V2 without importing V1/V2 machinery. |
| `v3-transact-integrity:1` | `transact-postimage-integrity:1` | one contract, deliberately alone: the `transact` postimage repair. Its own lane so that widening it reproofs nothing else. |

### Why revisions instead of edits

An explicit profile IRI is part of completion identity. Adding a contract to
`v3-self-host:1` would move the realisation basis of every packet already
complete under it, and each would need rederiving and republishing to say the
same thing it already said. A new revision leaves the old one immutable, so
`:1`, `:2` and `:3` coexist and `:1` is still referenced by completed work.

`adoptionPolicy: explicit-semantic-delta` is the same rule stated from the
other side: a profile takes on new scope only when a declared delta says so,
never because the graph around it grew.

This is also why `v3-transact-integrity:1` exists at all rather than the
integrity contract joining `v3-self-host:3`. Measured, not assumed: adding a
source to `graph/manifests/self-host.json` took the live lane from nine
`verified-complete` to nine blocked. A single-contract profile has no cohort to
disturb.

### Observed lane sizes

Packet counts and lane digests, read back with
`usf work --manifest <m> --max-items 60`:

| manifest | packets | semantic digest |
|---|---|---|
| `self-host.json` | 7 | `de676101…` |
| `self-host-provider.json` | 9 | `b2d6f4a1…` |
| `self-host-provider-v3.json` | 13 | `2e6a4780…` |
| `self-host-hermes.json` | 10 | `6f097f80…` |
| `self-host-semantic-recovery.json` | 13 | `15572b5b…` |
| `transact-postimage-integrity.json` | 8 | `074cf9fa…` |
| `architecture-assurance.json` | 7 | `cd6f84db…` |
| `anqr-experience.json` | 9 | `c3b1b3c0…` |

`self-host-provider-v3.json` at `2e6a4780…` is the live lane. Bound to
`urn:usf:profile:v3-self-host:3`, its construct and integrate ready frontiers
are both **0**: every packet in it is complete.

## Product realisation profiles (ANQR)

| profile | selected contracts |
|---|---|
| `urn:anqr:profile:bau:1` | `semantic-first-order:1`, `repository-path-scope:1`, `file-asset-index:1`, `foreground-lifecycle:1`, `operator-observability:1`, `provider-semantic-qualification:1`, **`anqr-decoded-payload:1`** |
| `urn:anqr:profile:hermes-bau:1` | the above seven **+** `hermes-autonomous-management:1` |
| `urn:anqr:profile:decoded-payload-bootstrap:1` | `anqr-decoded-payload:1` alone — the bootstrap that brings the contract into existence before any lane selects it |

Note what this shows: a product profile selects **core** contracts and adds its
own. It does not fork the foundation. `urn:anqr:contract:decoded-payload:1`
is in the `urn:usf:` namespace because the contract is a foundation obligation
about a product, not a product-local invention.

## Product profile revisions — the denominator

`usf profile status --manifest graph/products/anqr/manifest.json`:

```
profileRevision      urn:anqr:profile-revision:1
foundationRevision   urn:usf:foundation-revision:v3:1
binding              urn:anqr:profile-foundation-binding:1
currentness          current
closureResourceCount 14
closureDigest        sha256:a3a2d8103e71ff0502a4230308e4b94b167900cf7f309e97f9261310c1eb3b52
```

Two revisions exist, and the difference between them is the whole point:

| | revision 1 | revision 2 |
|---|---|---|
| capabilities declared | **0** | **44** |
| UI surfaces | 0 | 14 |
| domains | 0 | 10 |
| exclusions | 0 | 14 |
| opportunities | 0 | 16 |
| bound by | `profile-foundation-binding:1` | `profile-foundation-binding:2`, `architecture:1`, `experience-profile-revision:1` |

Revision 1 carries its emptiness as an explicit assertion rather than as an
absence:

> This revision declares that ANQR exists as a product profile bound to a USF
> foundation. It declares no ANQR capability, facet or requirement: ANQR has no
> recovered semantics yet, and inventing them here would be the conflation this
> separation exists to prevent.

`<urn:anqr:profile-revision:2> supersedesProfileRevision <urn:anqr:profile-revision:1>`.
Revision 2 is the product denominator — architecture facets, the experience
profile and the product opportunities all bind to it. Revision 1 stays
immutable and empty because the completions recorded against it were recorded
against a profile that claimed nothing, and rewriting it now would retroactively
make them claim something.

## Choosing one

- Reading, inspecting, querying → no profile. `usf work --manifest …` without
  `--profile` reports dependency observations and cannot authorise construction.
- Selecting ready work, publishing, completing → the exact versioned profile
  that owns the contract, plus its manifest. A profile from a neighbouring lane
  is not a substitute; it changes the denominator.
- A new obligation → normally a new **revision** of the owning profile, or its
  own single-contract profile when the cohort would otherwise be disturbed.
  Measure the blast radius first; never infer it.

## Non-claims

- Contract selection is read from the graph. This document is a projection of
  it and is not authority: if the two disagree, the graph is right.
- Lane digests and packet counts are point-in-time read-backs at the commit
  that introduced this file, not invariants.
- A profile confers no authority by being named. Construction eligibility still
  requires observed dependency authority, current evidence and a passing proof.
