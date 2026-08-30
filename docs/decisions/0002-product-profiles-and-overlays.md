# ADR 0002: product profiles and semantic overlays

Status: accepted for the Gate 1 boundary.

## Context

A cumulative semantic graph may eventually contain reusable knowledge and
contracts for hundreds of products. Loading that history as one implicit work
universe would recreate a V2 failure: an ANQR concept, model capability, asset,
or malformed future product could change or block unrelated USF work.

## Decision

`graph/manifest.json` is the reusable USF foundation bundle and contains no
product contract. Importing manifests construct explicit overlays:

- `graph/manifests/self-host.json` selects USF self-host semantics;
- `graph/products/anqr/manifest.json` selects the ANQR overlay;
- other products provide their own manifests and semantic sources.

Every realisation is steered by a versioned `RealisationProfile`. A profile
names its product, exact selected contract identities, an
`explicit-semantic-delta` adoption policy, and an `exact-closure-or-block`
reconstruction policy. Work projection binds the profile resource and only the
transitive semantic resources relevant to the selected packet. Sibling product
overlays and sibling contracts are not packet dependencies.

A model never discovers authority by searching the accumulated graph. The
deterministic projector selects and freezes the bounded closure; models receive
that context and may propose candidate operations only.

Re-realisation has three governed choices:

1. exact replay uses the original profile, contract versions, semantic closure,
   toolchain and evidence identities;
2. upgrade compares that closure with current reusable knowledge and records an
   explicit accepted semantic delta or migration;
3. fork creates a new profile with explicit selections and exclusions.

Contract and profile identities are immutable/versioned. Later knowledge does
not silently flow into an existing profile. `supersedes`, compatibility and
migration relations may recommend adoption but cannot perform it.

Artifact requirements are product semantics. Their kind, media type, target
path, acceptance, environment applicability and required model capabilities
project into generic work packets. The kernel contains no ANQR or creative
asset branch. Text and binary candidate operations use typed encodings; media-
specific validators remain graph-selected work, not kernel conditionals.

## Operational boundary

Tracked manifests, RDF, schemas, source, evidence and Git commits are durable.
An optional CAS, file index, embedded third-party store, or provider catalogue
is operational state only. It must remain under ignored repository-local
`.usf/`, be rebuildable, and confer no authority.

Content digests provide deterministic identity and currentness. V3 will not add
signatures, witness chains, signing services, or cryptographic ceremony without
a separately demonstrated untrusted-boundary requirement.

## Required invariants

- foundation/kernel source never imports a product module;
- a product imports only explicitly selected reusable knowledge;
- changing or breaking an unselected overlay cannot change or block selected
  work;
- ambient knowledge cannot inject model capabilities into a packet;
- cross-contract work dependencies must be selected by the same profile;
- profile, packet, route, prompt, tool and scoped dependency identities bind
  cache/completion and apply/check transitions;
- a different profile can create and validate materially different typed assets
  without engine changes.

The first four invariants have tracked fixtures. Scheduler/cache identity,
apply/check semantic-currentness, route eligibility, and a complete non-ANQR
asset realisation remain open work.
