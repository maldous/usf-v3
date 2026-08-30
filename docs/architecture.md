# Bootstrap architecture

USF V3 begins with one repository, one command surface, tracked semantic and
realisation source, and ignored operational artefacts beneath `.usf/`.

The initial critical path is:

```text
bounded semantic query
  -> scoped work packet
  -> fake heterogeneous contributions
  -> deterministic resolution
  -> isolated candidate workspace
  -> focused deterministic check
```

Canonical meaning, implementation, operational observations, admitted evidence,
proof results, and Git checkpoints are separate authority classes. No database,
daemon, external CAS, workflow engine, or semantic service is admitted at this
stage.

## Host-policy adaptation

`GOAL.md` shows shell-wide `HOME` redirection. Higher-precedence host safety
policy prohibits reassigning the operator shell's `HOME`, so this repository
uses `USF_PROVIDER_HOME=.usf/home`. Provider subprocesses will receive their
contained home explicitly through the provider invocation boundary. This keeps
mutable provider state contained without changing the operator shell identity.
