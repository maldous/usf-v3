# ADR 0001: repository-contained semantic store boundary

Status: accepted for the bounded Gate 1 capability spike.

## Decision

The canonical semantic source remains the manifest-selected tracked RDF files. The compiled store is disposable and has no authority of its own.

No persistent database is required. The default adapter constructs its dataset
in memory from tracked files on each run. If measured scale later justifies an
Oxigraph, Stardog, or other maintained persistent index, every database file
must live beneath ignored repository-local `.usf/`, be safely deletable, and
rebuild to equivalent query results from the selected tracked manifests. It
must never become semantic authority or a fresh-clone prerequisite.

The initial `SemanticStore` adapter composes maintained libraries behind one narrow interface:

- N3 parses repository-local RDF into manifest-assigned named graphs;
- `rdf-canonize` produces bounded RDFC-1.0 canonical dataset bytes;
- Oxigraph provides an in-memory, repository-contained SPARQL query engine;
- `rdf-validate-shacl` validates selected local data and shapes graphs;
- Ajv validates the closed local manifest contract.

All dependencies are exactly pinned by the repository lockfile. The adapter accepts only local manifest paths, canonicalizes blank-node datasets, and exposes read-only bounded `SELECT`, `ASK` and `CONSTRUCT`. It refuses SPARQL Update, `SERVICE`, dataset-loading clauses, missing result bounds and bounds above policy before invoking Oxigraph. SHACL reports stop after a bounded number of findings. Normal tests need no network or runtime service.

The implementation is deliberately replaceable: callers depend on `SemanticStore`, not Oxigraph, N3, Stardog or a server protocol. A package API or typing gap does not justify rebuilding the dependency. N3 2.0.1 currently ships without TypeScript declarations, so V3 contains only the minimal declaration surface it uses.

Oxigraph 0.5.9 and transitive SHACL packages also publish declaration files
that TypeScript 5.9 cannot check cleanly (`UInt8Array` typos and missing
transitive declarations). `skipLibCheck` is therefore enabled only at the
third-party declaration boundary; strict checking remains enabled for every
V3 source and test. Runtime fixtures exercise the exact imported APIs. This is
an upstream compatibility gap, not permission to duplicate the engines.

## Stardog reconsideration

Stardog is a valid optional integration or performance adapter behind `SemanticStore`; it is not rejected categorically. The official distribution is server-oriented through Docker or a marketplace, with CLI and HTTP clients. Starting it requires a valid Stardog licence. Free licences exist, but licence acquisition and terms become additional reproducibility dependencies.

It can run locally, but compared with the in-process core it adds an external process, image/runtime, port and licence prerequisites. It therefore cannot be canonical authority or a required bootstrap/test path. A future Stardog adapter is admissible only for a measured query, scale or integration requirement and must preserve content-derived authority. Normal V3 tests must continue to run without Stardog, Docker, network, Java, Rust or a native compiler.

## Consequences and evidence

This decision keeps semantic coordination differentiated while delegating RDF syntax, canonicalization, SPARQL and SHACL mechanics to maintained projects. It eliminates the historical mandatory externally administered semantic-service deadlock without prohibiting a useful optional adapter.

The focused fixtures plant:

- reordered RDF and changed blank-node labels with identical RDFC-1.0 identity;
- valid and invalid SHACL data;
- path traversal;
- SPARQL Update, `SERVICE` and remote dataset loading;
- unbounded and over-policy query limits.

Deferred hardening: complete W3C conformance suites, SHACL-SPARQL support (not supplied by the selected SHACL library), persistent large-dataset storage, and a measured Stardog adapter. These are not required by the current bounded fixture profile.
