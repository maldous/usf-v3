# Linear historical review

Linear was reviewed as provenance and lessons-learned evidence only. It is not
semantic authority and must not be used to reconstruct the graph from tickets.

## Historical value

V1 established the semantic completeness denominator: capabilities, contracts,
facets, obligations and explicit nonclaims. Completion of that denominator did
not imply runtime, staging or production readiness.

V2 added a convergence/realisation operating model: freeze an authority digest,
partition exact semantic scope, derive bounded packets, execute independent
work, read results back independently, bind evidence to commit, provider and
environment, and accept only after closure. Parallelisation is therefore a
deterministic convergence protocol, not merely concurrent calls.

The V2 Graph Authority and Semantic Authority/Compiler Readiness projects are
marked Completed. Linear itself states that these are retained historical
outcomes and that tickets, source, tests and reports do not establish semantic
truth.

## Environment realisation

USF-614 is Done but explicitly discovery/design only. It defines promotion as
an evidence-bound transition across Dev, Test and Staging. A promotion envelope
must carry source/target environment, artifact and commit identity, provider
mode, proof level, evidence references, content basis, freshness, validation,
nonclaims, approval, retention and supersession. Missing, stale, ambiguous or
overclaimed evidence fails closed. This is required policy input, not evidence
that a promotion pipeline or production service exists.

## Stardog and operating bootstrap

USF-1154 is Canceled. It records useful intended behavior: semantic-first
ordering, bounded digest-scoped context, read-only workers, coordinator-only
mutation, fail-closed consistency and explicit decisions. A comment reports a
partial chroot/Stardog slice and also lists major unfinished operations and
tests. Stardog is therefore an optional measured adapter, not mandatory V3
authority or readiness evidence.

## V3 implications

USF supplies reusable semantic knowledge; ANQR adds an explicit product overlay
and versioned profile. Another product selects a different closure without
changing the engine. Every required capability must distinguish semantic
requirement, concrete realiser, environment/provider applicability, validation,
evidence/proof currentness, accepted disposition and nonclaims. Linear status
cannot satisfy any of those dimensions.
