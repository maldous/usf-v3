# Decision 0004: bounded operator observability

## Status

Accepted for the first operator-facing CLI slice.

## Decision

- Keep `status` as a cheap, broad current summary; expose instance detail as
  `status lifecycle` while preserving the initial `status --instance` spelling.
- Keep `observe` for factual point-in-time observations and use one `metrics`
  group for bounded historical aggregation. Do not add `stats` or top-level
  provider-specific aliases.
- Read explicit JSONL or repository-local ignored `.usf/metrics/` input. Every
  report carries source coverage, filters, truncation and unknown counts.
- Separate requested provider route, actual provider and underlying model.
  Counts name their denominator. Missing identity, usage, cost, quota and
  lineage never become zero.
- Count useful tokens only when exact accepted candidate, review, repair or
  proof-relevant lineage is present. Adapter acceptance alone is not useful
  ANQR lineage.
- Keep one static registry as parsing/help authority. Help works without a Git
  repository or any external service and describes availability, contact,
  history scan, output schema, exit codes and authority effects.
- Keep event validation and aggregation pure. CLI adapters only perform bounded
  repository-relative input and serialization. Metrics are not scanned in the
  continuous composer loop.

## Consequences

No telemetry service, database, OpenTelemetry collector, Prometheus server or
workflow engine enters the core. Those may later consume local events through a
replaceable export adapter. GitHub remains optional transport rather than an
observability dependency or progress lock.

Git's object database is an implementation detail of the tracked source
carrier, not a USF CAS or semantic authority. `.usf/objects` is reserved for a
future optional repository-local content-addressed cache and is currently not
on this slice's execution path. Because it is ignored and disposable, a clean
clone and ordinary GitHub-hosted CI must recreate any needed fixture state; no
self-hosted runner, persistent CAS, GitHub cache or CAS-specific test lane is
required before such an adapter exists.

This slice does not prove a live provider census, live quota, cost avoidance,
useful-token achievement, full ANQR, staging, production or terminal proof.
