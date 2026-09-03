*Normative. Section 20 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 20. Selective reuse and provenance

Do not perform blanket migration.

For every reused V1, V2 or ANQR component record in `provenance/reuse.json` and `docs/v1-v2-lessons.md`:

- logical and remote source;
- exact commit/tree or stable source identity;
- licence and ownership;
- specific V3 requirement;
- copied/adapted files;
- destination;
- retained/new tests;
- removed historical topology assumptions;
- removed external path/CAS/state/Factory/Hermes/Operator coupling;
- validation and containment result;
- treatment: keep, simplify, replace or reject.

Good reuse candidates:

- stable ontology/vocabulary fragments;
- SHACL/SPARQL/integrity logic;
- content digest algorithms after review;
- bounded query logic;
- provider probes and response adversarial tests;
- workspace/path/patch isolation;
- validation runners;
- evidence/proof schemas and distinctions;
- drift checks;
- actual ANQR domain code and tests.

Poor candidates:

- whole repositories;
- external CAS layouts;
- hard-coded host paths;
- cycle engines, state databases, leases, reservations and handovers;
- operational authorization ceremonies;
- signatures without a current trust requirement;
- generated runtime state;
- manually maintained provider catalogues.

After incorporation, prove the V3 component works with historical paths unavailable.

---
