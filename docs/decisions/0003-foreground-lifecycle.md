# Decision 0003: foreground lifecycle control

## Status

Accepted for the first unattended-process slice.

## Context

USF must eventually run outside a conversational AI session and invoke bounded
AI-agent work through its own command contracts. The existing continuous
scheduler is a deterministic in-memory harness; it does not establish an
operating-system process lifecycle. The historical V2 work demonstrates useful
properties—exact identity, atomic records, bounded drain and restart from
durable facts—but also demonstrates the repair cost of lifecycle databases,
leases, journals, handovers, sockets and service-manager topology.

The command surface must remain Unix-composable. A process supervisor may
background or restart USF, but USF must not require a hidden supervisor to
advance semantic work.

## Decision

- `usf watch` is the only continuous composer.
- `usf start` runs that composer in the foreground. On the supported unattended
  host it acquires an instance-scoped Linux kernel lock through util-linux
  `flock`, validates an explicit versioned profile and tracked automation
  policy, emits JSONL readiness, and then remains attached to the caller. The
  open descriptor is retained while the instance owns admitted work, so process
  death releases ownership without a lease, heartbeat or stale timeout.
- `usf stop` writes an instance- and nonce-bound stop intent and waits for a
  bounded acknowledgement. Normal stop never signals a PID.
- SIGINT and SIGTERM enter the same drain path as a stop intent.
- A drain timeout is an observation for the bounded `stop` caller, not permission
  to overlap a replacement. The foreground process retains the owner record and
  kernel lock until admitted work actually settles. A configured external
  supervisor may force-terminate it; kernel descriptor closure then releases the
  lock and restart quarantines the stale record.
- Runtime records live only beneath ignored `.usf/runs/watch/`, use restrictive
  modes, contain no secret or absolute path, and bind process identity plus the
  profile selector, manifest selector, through boundary, policy and lifecycle
  tool identity. Global semantic revision and per-work scoped dependencies are
  observations, not process-wide invalidation keys.
- Graph or product-overlay movement rederives the selected work projection
  without restarting the composer or forcing whole-run reproof. Copy-on-write
  candidates and proof inputs are invalidated only by movement in their own
  declared scope.
- Start, watch, stop and all through-check activity perform no GitHub or remote
  lookup. Local Git commit/tree identity is a carrier observation only. Commit
  batching and an explicit later push remain outside the semantic lifecycle, so
  remote unavailability cannot become a local scheduling or validation lock.
- A valid dead or identity-mismatched instance is quarantined as stale. A
  malformed or ambiguous instance fails closed. Restart rescans current graph,
  repository and explicit chain artefacts; it never replays a lifecycle log.
- Lifecycle state is operational observation. It cannot establish work
  completion, acceptance, evidence, proof, integration or semantic publication.
- Executable and continuous deliverables declare start, readiness, drain and
  stop behavior. Libraries and static/file artefacts declare lifecycle not
  applicable.

## Consequences

The initial implementation proves local process control and restart safety
without creating a daemon protocol or a second workflow engine. Linux procfs
and util-linux `flock` are explicit conditional prerequisites for these
lifecycle commands. Ordinary shell backgrounding or a commodity supervisor
(for example a systemd user service, s6 or runit) remains outside the core and
owns restart, process-group cleanup and forced termination. No supervisor is
required by pure USF commands, and supervisor state never becomes semantic,
scheduling, integration or proof authority.

Live provider discovery, zero-cost qualification, route selection and agent
invocation remain separate unfinished command boundaries. A lifecycle-ready
process is therefore not evidence of autonomous live-agent delivery, staging,
production operation or terminal proof.

No V2 source bytes are reused: its copying terms are unresolved. The retained
properties are reimplemented from the V3 authority and tested against new
failure fixtures.
