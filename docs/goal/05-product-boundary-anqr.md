*Normative. Section 5 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 5. Product boundary: ANQR

ANQR is the product that proves USF V3 has practical value.

USF tooling lives in the repository to deliver ANQR; ANQR does not exist to justify more USF infrastructure.

ANQR is a **versioned profile realised against the foundation**, not a directory
inside it. The boundary is now mechanical rather than advisory:

- USF Core owns reusable foundation semantics and realises its own platform
  capabilities as first-class USF source.
- ANQR owns product semantics in a `ProductProfileRevision`, and its
  implementation belongs in the **ANQR repository**, declared in the graph by
  identity and layout and mapped to a local checkout through ignored operator
  state. The graph never contains a path to it.
- A profile binds an exact `FoundationRevision` through a resource-scoped
  dependency closure. Foundation movement outside that closure is not staleness.
- A capability the product does not claim carries a disposition that produces no
  work, so an aspiration can never be dispatched or reported as delivery.
- Generic service requirements bind foundation **ports**. A product owns the
  requirement and the reason for it; the foundation owns the provider. Requiring
  durable persistence never makes a database an ANQR capability.

Do not blanket-copy the historical ANQR repository. Legacy ANQR source is
behavioural reference and evidence; it is never semantic authority, and its
architecture carries no obligation.

QR implementation mathematics is not product semantics. The contract may state
observable invariants — an artefact decodes to the payload requested,
customisation stays within a declared scan-safety acceptance — and must not
prescribe the algorithm that achieves them.

The historical ANQR Harness/Symphony machinery — provider routing, worker
scheduling, autonomous issue handling, worktree orchestration, evidence
admission, integration orchestration, self-feeding loops, host supervision — is
delivery machinery that evolved into USF and Hermes. It is programme provenance
and must not be recreated as ANQR product capability.
