*Normative. Section 6 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 6. V1 and V2 lessons

### 6.1 Retain as hard invariants

V3 MUST retain:

1. semantic meaning precedes implementation;
2. stable semantic identities;
3. bounded model context;
4. realisation maps to actual deliverables or explicit disposition;
5. observation, evidence, validation and proof remain distinct;
6. validation is explicit and fail-closed at the relevant boundary;
7. authority identity is content-only;
8. derived state is deterministic and reproducible;
9. currentness and drift are explicit;
10. model-produced writes are isolated before integration;
11. requested route and observed provider/model identity remain distinct;
12. zero-paid-cost is enforced at invocation, never inferred from a label;
13. positive and adversarial fixtures accompany critical rules;
14. claims and nonclaims remain explicit;
15. no model accepts its own output as truth.

### 6.2 Reject as assumed topology

V3 MUST NOT recreate the following unless a concrete failing V3 fixture proves that no smaller local/compositional mechanism preserves the required invariant:

- separate Graph, Factory, Hermes, Operator or Cockpit platforms;
- a monolithic cycle engine;
- a persistent workflow state machine;
- D0, D1 or D2 handovers;
- PREPARE/COMMIT handovers between subsystems;
- generation reservations;
- coordinator leases or fencing tokens;
- immutable operational journals;
- replay engines or event-sourced projection rebuilding;
- admission databases or fixed rosters;
- enterprise review-board simulation;
- signed inter-agent messages;
- routine cryptographic signatures without a real untrusted boundary;
- one Git commit, branch, PR or merge per intermediate action;
- an external CAS, programme directory, chroot or semantic endpoint;
- a bespoke provider catalogue or protocol translation layer already maintained elsewhere;
- blanket V1/V2 or ANQR migration;
- semantic exhaustiveness as a prerequisite for one bounded deliverable;
- unattended production BAU as a prerequisite for the V3 core proof.

The properties may survive. The historical mechanisms do not survive by default.

`usf hermes` is permitted only as an optional, removable management facade
over the same V3 command contracts and foreground composer. It is not the
rejected separate Hermes platform: it owns no scheduler, provider roster,
credential plane, authority, state database, daemon, lifecycle lock or service
manager. Deterministic `usf start`, `usf watch` and `usf stop` remain complete
without Hermes-Agent.

### 6.3 Component admission test

A new V3 component belongs on the critical path only if removing it prevents at least one of:

- bounded semantic understanding;
- useful provider participation;
- constructive multi-provider work;
- safe iterative realisation;
- deterministic validation;
- evidence or proof;
- fine-grained currentness or drift detection;
- measured continuous throughput.

Otherwise remove, defer or keep it outside the core.

---
