# V1/V2 lessons applied to V3

The historical systems are evidence, not topology. Their value is cumulative:
ANQR supplies the product pressure, V1 defines the complete semantic
denominator and authority model, and V2 develops safe parallel convergence,
currentness, and publication closure over work derived from that authority.
V2 is not a replacement semantic source. See `docs/historical-value.md` for the
snapshot identities and commit/PR chronology.

The current decoded-payload graph is deliberately a bootstrap fixture. It does
not satisfy the later `ANQR_PLATFORM_REALISATION_COMPLETE` denominator and must
not be mistaken for the complete V1 proposition.

## Retained properties

- The complete product/platform requirement denominator is graph-defined. ANQR
  builds on USF; USF core contains no ANQR-specific scheduling or realisation
  branch, so a different graph can direct a different service.
- Stable meaning and content-derived identity precede implementation history.
- Semantic source, derived projections, implementation, observations, evidence,
  proof, and operational state remain distinct.
- Requirement, contract, realiser, environment/runtime posture, validation,
  evidence, proof, disposition, claim, and nonclaim remain traceable rather than
  collapsing into one completion flag.
- Validation is explicit and fail-closed; negative fixtures test the intended
  stable reason, not merely a parser failure.
- Context, paths, mutations, provider input, and result envelopes are bounded.
- Requested and observed provider/model identities remain separate.
- Candidate writes are isolated; traversal, symlink, control-path, secret, and
  stale-preimage attempts are rejected.
- Evidence/proof currentness binds exact semantic dependencies, material
  pre-images, candidate bytes, algorithms, toolchain, and accepted evidence
  rather than trusting a status flag.
- Independent work uses explicit read/write/dependency sets and may converge in
  parallel only when those scopes remain compatible and current.
- Integration and significant semantic publication are separate, narrow,
  fail-closed authority transitions.
- Provider or model prose cannot establish authority or acceptance.

## Environment and realisation semantics

The historical environment ladder is part of the semantic denominator.
`localdev`, `hermetic`, `integrationtest`, `ci`, `productionshaped`, `staging`,
`productionlive`, and `authoritycontrol` express different postures; they are
not aliases for one successful local test. Applicability states distinguish
`required`, `notrequired`, `conditional`, `reserved`, and `unresolved`.
Reserved work remains in scope but cannot be counted as satisfied, while an
unresolved obligation cannot pass.

Historical realisation states distinguish `contractonly`, `implementable`,
`deferred`, `notclaimed`, and `deprecated`. A completed claim requires a
realiser plus an accepted decision/evaluation and current evidence in the
declared environment and execution mode. Construction AI routes are also
separate from target-runtime providers: using a model to construct source does
not make that model an ANQR service dependency.

V3 retains these meanings but does not inherit historical environment bindings
that were internally inconsistent. It must re-express and validate the
applicable environment/service obligations in repository-contained source.

## Simplified or rejected mechanisms

- Repository-contained files replace external CAS/programme stores for working
  objects; accepted source and evidence remain tracked.
- A local disposable graph projection replaces Stardog as a required authority
  service.
- Scoped dependency digests replace whole-graph and whole-tree invalidation.
- Isolated copied/reflink candidate trees replace per-edit Git branches,
  commits, reservations, and handovers.
- One narrow primary-mutation lock replaces coordinator leases, fencing,
  PREPARE/COMMIT protocols, and multiple mutation planes.
- Explicit chain artefacts replace lifecycle databases and replay engines.
- A foreground composer with short local claims replaces Hermes/operator state
  machinery, daemons, sockets, ACL choreography, and service units.
- Maintained provider adapters and models.dev replace fixed provider rosters and
  bespoke protocol/catalogue control planes.
- Deterministic checks and exact proof inputs replace signatures and ceremony
  where there is no current untrusted boundary requiring them.
- The TypeScript/Node bootstrap does not inherit Java, Maven, chroot, external
  database, production compose, or multi-service prerequisites.

This simplification does not waive enterprise-service requirements. The full
ANQR denominator still needs explicit service, persistence, security,
observability, backup/restore, upgrade, rollback, and environment dispositions.
Repository-contained production-shaped evidence may prove only its declared
posture; it does not establish an external staging or production deployment.

## Selective-reuse status

V1 has an Apache-2.0 licence and contains patterns worth consulting, especially
manifest registration, deterministic digests, bounded results, and adversarial
filesystem checks. The inspected V2 Factory release is readable but its
`LICENSE-NOTICE.md` is all rights reserved; historical ANQR and operator
material also do not establish copying terms. Therefore no historical source
or corpus bytes have been incorporated and `provenance/reuse.json` remains
empty. The chronology in `provenance/historical-observations.json` records
observations only and is not a reuse declaration.

Future reuse must name the exact commit/tree, source files, licence, V3
requirement, removed couplings, retained or new tests, and containment result.

## Provider and process lessons carried into V3

V2 demonstrated useful parallel convergence and bounded provider observation,
but its Factory release carries an all-rights-reserved `LICENSE-NOTICE`.
Consequently V3 is a clean TypeScript reimplementation informed by observed
behaviour and documented requirements; no V2 source bytes, corpus bytes, or
Factory implementation have been copied. The lesson retained is the boundary
between derived parallel work and semantic authority, not the historical
Factory topology.

Provider qualification must be two separate questions: can this exact adapter,
credential, model, capability, quota and explicitly pinned service tier be
used under the cost/privacy policy; and does its output satisfy the semantic
task and accepted lineage? Neither a catalogue entry nor a successful probe
answers the second question. Unknown account tier, unknown pricing, implicit
fallback, and missing actual identity remain refusals for a zero-cost claim.
Semantic evaluation binds the full agent profile, including adapter lock and
the content digests behind tool, prompt, context and output versions; labels
alone would recreate V2's stale-profile repair loop. Missing answers score zero
and the default remains `UNQUALIFIED`.

USF core and product semantics each retain their own version and digest because
their dependencies run both ways. Separate core-to-product and product-to-core
digests show which interpretation moved, while a composite digest binds the
exact pair. This prevents unrelated product or core movement from turning
GitHub, a global graph revision, or a whole-programme reproof into the critical
path.

The external process must be able to run unattended between invocations. That
requires registered, composable `usf` commands with stable JSON, bounded
inputs, explicit `usf start` and `usf stop` lifecycle records, and deliverables
that carry their own start/stop boundary. Shell inspection is permitted only
while closing a missing command boundary; it is not the operating interface.

Test growth is governed by semantic ownership: retain one test per distinct
acceptance/refusal or process boundary, replace duplicates, prefer injected
clocks/transports and fixture data, and keep live-provider work out of default
lanes. This preserves V2's safety properties without repeating its iterative
governance bottleneck.
