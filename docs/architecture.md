# Bootstrap architecture

USF V3 begins with one repository, one command surface, tracked semantic and
realisation source, and ignored operational artefacts beneath `.usf/`.

The initial critical path is:

```text
semantic model
  -> deterministic remodel and scoped currentness
  -> admitted evidence
  -> deterministic proof
  -> proof-warranted contract activation
  -> bounded semantic query
  -> scoped work packet
  -> fake heterogeneous contributions
  -> deterministic resolution
  -> isolated candidate workspace
  -> focused deterministic check
  -> validation observation
  -> admitted evidence and reproof/remodel when applicable
```

Canonical meaning, implementation, operational observations, admitted evidence,
proof results, and Git checkpoints are separate authority classes. No database,
daemon, external CAS, workflow engine, or semantic service is admitted at this
stage.

The authored contract definition and its active realisation permission are
different resources. Dependency readiness and process readiness are also
different from semantic eligibility. Route, call, resolve, apply and check
carry or rederive one immutable graph-derived realisation basis; proofblocked
or stale work is excluded per item, so an eligible sibling can continue.

Construction evidence and construction proof precede and warrant the active
permission. Completion validation, evidence and proof follow realisation and
cannot be used as the prior authority for that same realisation.

The one-time typed bootstrap exception names only the three gate packets, is
local, hermetic, deterministic-fixture-only, isolated and capped at check. It
explicitly prohibits provider/credential contact, integration, runtime
activation and historical mutation. Every semantic publication is also
prohibited except one exact self-closing authority-admission publication
containing only its three evidence records, aggregate proof result, ordinary
permission activation and exception closure. It cannot publish or activate any
sibling contract.

The activation transition uses one closed tracked receipt at
`evidence/semantic-first-bootstrap-admission.json`, deliberately outside every
semantic manifest. It records reversible exact source operations, the
immutable pre-state basis, and independently recomputable expected post-state
source and semantic digests. Currentness reverses, verifies and replays that
delta; the receipt never hashes itself into the state it attests, and any
unlisted movement refuses.

## Host-policy adaptation

[`docs/goal/04-repository-identity-and-containment.md`](goal/04-repository-identity-and-containment.md)
§ 4.4 shows shell-wide `HOME` redirection. Higher-precedence host safety
policy prohibits reassigning the operator shell's `HOME`, so this repository
uses `USF_PROVIDER_HOME=.usf/home`. Provider subprocesses will receive their
contained home explicitly through the provider invocation boundary. This keeps
mutable provider state contained without changing the operator shell identity.
