# V1/V2 lessons applied to V3

The historical systems are evidence, not topology. Gate 0 inspection supports
the invariants in `GOAL.md` while also showing why a direct migration would put
coordination infrastructure ahead of ANQR delivery.

## Retained properties

- Stable meaning and content-derived identity precede implementation history.
- Semantic source, derived projections, implementation, observations, evidence,
  proof, and operational state remain distinct.
- Validation is explicit and fail-closed; negative fixtures test the intended
  stable reason, not merely a parser failure.
- Context, paths, mutations, provider input, and result envelopes are bounded.
- Requested and observed provider/model identities remain separate.
- Candidate writes are isolated; traversal, symlink, control-path, secret, and
  stale-preimage attempts are rejected.
- Evidence/proof currentness binds exact material inputs rather than trusting a
  status flag.
- Provider or model prose cannot establish authority or acceptance.

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

## Selective-reuse status

V1 has an Apache-2.0 licence and contains patterns worth consulting, especially
manifest registration, deterministic digests, bounded results, and adversarial
filesystem checks. V2 graph, historical ANQR, and accessible operator material
do not establish copying terms. Factory and proof-cockpit sources are not
readable at their mandated paths. Therefore no historical source bytes have
been incorporated at Gate 0; `provenance/reuse.json` remains empty.

Future reuse must name the exact commit/tree, source files, licence, V3
requirement, removed couplings, retained or new tests, and containment result.
