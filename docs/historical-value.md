# Historical semantic value and delivery evolution

This note records what the inspected histories add to USF V3. It is an
observation document, not semantic authority, source-reuse provenance, or a
claim that a historical deployment is live. The machine-readable companion is
`provenance/historical-observations.json`.

## Evidence boundary

| Snapshot | Repository | Branch | HEAD | Observed working state |
| --- | --- | --- | --- | --- |
| ANQR | `maldous/anqr` | `symphony/integration` | `a03cee561f2ad7bf9cb83f15eb857925c967e34f` | Dirty: tracked `MEMORY.md` modified |
| USF V1 | `maldous/usf` | `main` | `028a9f964fd25c2fd774c1b4fde6ea1cebdf8312` | Dirty: tracked `v2/.gitignore`, `v2/etc/profile.d/stardog.sh`, and `v2/usf` deleted; `TID-Draft.pdf` untracked |
| USF V2 Graph | `maldous/usf-graph` | `graph/v2-bau-protected-2d7eb31` | `2d7eb31f0d586b32008ba854dfca0fa8437054cf` | Tracked tree clean; ignored local state existed |

These are local snapshots. A local remote-tracking ref, commit subject, tag, or
PR number does not prove that the corresponding remote state is still current,
that a pull request was accepted with the locally implied semantics, or that
software was deployed. The protected Factory and proof-cockpit sources were not
readable, so no claim about their current contents is made.

The inspected repository remotes identify GitHub repositories, not GitLab
projects. No live GitLab merge-request authority was available in this pass;
the review numbers below are recorded only where the local commit subject names
them.

## Value sequence

The historical proposition is cumulative, not substitutive:

1. ANQR supplies the product requirements and real implementation pressure.
2. V1 turns the complete product/platform denominator into explicit semantic
   authority: capabilities, contracts, providers, environments, realisation
   states, validation, evidence, proof, dispositions, claims, and nonclaims.
3. V2 makes work derived from that authority safely parallel: candidates can be
   produced independently, converged under exact authority/currentness checks,
   and published without making orchestration state a second semantic source.
4. V3 must preserve the semantic and convergence value while removing the
   historical operational topology. ANQR is the first enterprise-service proof;
   a different semantic source must be able to drive a different service.

The current decoded-payload graph is therefore a bootstrap contract, not the
ANQR denominator and not the complete historical value proposition.

## V1: complete denominator and authority model

V1's durable contribution was not merely an ontology vocabulary. It expressed
the product and service denominator as a governed graph and kept requirement,
contract, provider, environment, implementation, observation, evidence, proof,
and disposition as different authority classes. That makes absence and deferral
explicit, allows a requirement to be traced to a realiser and its acceptance
evidence, and prevents implementation or a status label from silently becoming
semantic truth.

The local chronology shows the denominator widening and closing:

| Commit | PR evidence in local history | Historical value |
| --- | --- | --- |
| `72bb80f15ebc4f588263fe0489ee9d8919924280` | #68 | Complete semantic coverage of every React capability (USF-97) |
| `b62549bc71015cd19bb74269fc708c3ffae9652c` / `c084b88029e3952eaf826269f71a291e20f97e46` | #181 | Final semantic-completeness audit |
| `28aa03456007e550f84d1b5128d9c0c5ef83a81b` | #240 | External HTTP semantics gate |
| `16537455213b01e7da122005bafe52d138bc9e20` | #258 | Re-founded USF as self-defined authority rather than inherited React lineage |
| `cd5e977afe9e840608004a65345cadcc17c0e37b` | #299 | App-surface, optimisation, and Linear delivery closure |
| `a5b9e1a036f6c10cf1a9f632bd3fa6bf5d8bc9c4` | #336 | Parallel validate aggregator with fail-closed family authority |
| `417fdde39fcf3d8e0834772fe1be05b1d2965e1d` | #352 | Dev-realisation exhaustion before the test proof ladder |

"Complete semantic coverage" is a denominator claim, not evidence that every
capability was implemented, deployed, production-ready, or current at the
inspected HEAD. Likewise, dev-realisation exhaustion is a disciplined gate in
an environment ladder; it does not promote development evidence into staging
or production evidence.

The environment model is part of the denominator, not deployment decoration.
Stable postures distinguish local development, hermetic checking, integration
test, CI, production-shaped, staging, production-live, and authority-control
contexts. Applicability distinguishes required, not-required, conditional,
reserved, and unresolved work. Realisation distinguishes contract-only,
implementable, deferred, not-claimed, and deprecated states. Reserved remains
in scope but is not satisfiable; unresolved cannot pass; a completed
realisation needs a realiser and accepted evaluation/evidence in its declared
environment and mode.

## V2: safe parallel convergence and publication closure

V2 did not provide a replacement product denominator. It extracted the graph
authority into a standalone history and developed the mechanics needed to let
many workers act on derived work without confusing their state with authority.
Its important value is exact identity and dependency binding, isolated
materialisation, brokered execution, deterministic validation, proof
currentness, conflict handling, restart/recovery, and narrow publication.

| Commit | PR evidence in local history | Historical value |
| --- | --- | --- |
| `c21e2dccbbaa303192b3447eaa85ad41e6e8b0e9` | none in subject | Standalone USF V2 semantic-authority repository |
| `65ddc51a8965332318de2a8de9a4c6304e1e86d8` | #1 | External materialisation history merged |
| `5243c1656145971b9e4f62c7ff5e281c1176994f` | none in subject | Initial USF realisation programme completed |
| `219e05b2906ac89b4017ce70be16d37a95cc6a76` | #1 | Routing-driven brokered runtime foundation |
| `4cf1b99243bb7566913a4788293c722dfe0fc1ee` | #2 | Factory delivery aligned with graph authority |
| `68355537a01a03c979ab6530b5d5cb4d2f74ba15` | #3 | Canonical authority digest history |
| `8c4335ddb24ea7baf839337d25ba5c95e11a3cc0` | #4 | Factory runtime-readiness hardening history |
| `8f5d468e8a49197f286ed799c924358f3fbbbb39` | #3 | Deterministic materialisation-validation producer history |
| `e6d4e199f1215754190a4ada8d0ac0ed5ce9743b` | #75 | Proof-obligation bijection SHACL closure |
| `25083996d2126ee6f40fbab50b0947ed3fb1870c` | none in subject | Final V1/V2 source scope completed |
| `f486979043cdd7ad0e78de95cc4c0ab9cf8c8d98` | none in subject | V2 production publication adapter added |
| `2d7eb31f0d586b32008ba854dfca0fa8437054cf` | #169 | Closure executor rebound to the accepted D1 recovery release |

Repeated PR numbers in the locally composed history are recorded exactly as
commit-subject evidence; local Git alone does not establish which remote
repository owned each numbered review.

The V2 semantics worth retaining are the ones that make concurrency safe:

- work is derived from a semantic requirement with exact read, write, and
  dependency sets;
- disjoint candidates may execute concurrently, but provider output grants no
  mutation, evidence, proof, or publication authority;
- candidate bytes, relevant pre-images, semantic dependencies, toolchain, and
  accepted evidence bind currentness;
- convergence rejects conflicts and stale inputs, preserves contributor
  lineage, and admits only deterministically checked materialisation;
- proof and publication are separate, fail-closed transitions;
- conflict resolution is bound across publication, and restart derives state
  from durable artefacts rather than trusting a mutable coordinator flag.

The V2 history also documents a cost: much of the implementation became coupled
to Stardog, external CAS/programme paths, chroot ownership, Graph/Factory role
splits, coordinators, fences, handovers, journals, and witness ceremony. Those
mechanisms are not the semantic value and are not V3 authority.

## ANQR: product evolution before orchestration evolution

ANQR demonstrates why product and delivery machinery must remain separate. Its
product history established a broad QR service before the later orchestration
history:

| Commit | Historical value |
| --- | --- |
| `62581f045fa7784edaa727b50875983c0f0fe862` | Comprehensive React QR-generator UI |
| `563ade695516d8941f90df5f32e0b9d8c189a124` | Support for 87 Google Play languages |
| `814879a792a6596c4cceb3357d18369b8ff25fd8` | First-party QR decoder replacing `jsQR` |
| `ec717e4fa7de1a7bff2b18ac83da04fae9b4ceb9` | ANQR 1.0 Product OS bootstrap |

The later history adds delivery/orchestration learning:

| Commit | Historical value |
| --- | --- |
| `3d5ec22e7544a1264ff8c637bc98d74390d617ab` | Symphony autonomous runner, feeder, and self-feeding infrastructure |
| `386355e1752593894b38601640e7ff3db7b70a1b` | Parallel startup exploration through the Symphony bridge |
| `7dfc0484afc2516715fcafb1a70f0f11247cb203` | Continuous parallel provider probing and reevaluation |
| `28b7521061e3e65634d1ceda483ed24f55e3af9f` | Harness phase-eight documentation closure |
| `e825da499f953fe6da39f77820812788d6976bf2` | Six live lifecycle end-to-end harness scenarios |
| `d7fcff39d62549f4ae8b12463990540cb9a39a1a` | Web frame-colour wiring and explicit deferrals |

The Symphony infrastructure commit exists in the local object database but is
not reachable from the inspected advertised refs. It remains useful local
history evidence, but its reachability and remote status are explicit
nonclaims.

The lesson is not to reproduce Symphony around the bootstrap payload analyser.
The full ANQR denominator must direct construction of an enterprise service,
while the delivery engine stays generic enough that a subsequent non-ANQR
graph produces a materially different service without ANQR-specific branches
in USF core.

## Retained V3 meaning and rejected topology

### Required now

- A graph-defined, enumerated ANQR product/platform denominator, with explicit
  exclusions and nonclaims, above the bootstrap contract.
- Traceability from each applicable requirement through contract, work,
  realiser, environment/runtime posture, deterministic validation, evidence,
  proof, and disposition.
- Stable semantic identity independent of Git and operational location.
- An explicit distinction between a construction-intelligence route and a
  target service runtime provider.
- Scoped dependency currentness and conflict-safe parallel candidate
  convergence, with a narrow integration/publication mutation boundary.
- Development, test, production-shaped, staging, and production-live
  applicability kept distinct. A lower environment cannot prove a higher one.
- A complete production-shaped ANQR enterprise-service delivery with explicit
  evidence for applicable service, persistence, security, observability,
  backup/restore, upgrade, and rollback obligations.
- A second non-ANQR semantic fixture proving that the engine is graph-generic.

### Hardening later

- Additional live provider adapters and larger provider populations.
- Broader ANQR historical-feature dispositions after the denominator is
  explicit.
- External staging or production execution when separately authorised and when
  credentials, risk, and acceptance ownership are established.

### Rejected or unrelated topology

- Stardog or another network semantic database as canonical authority.
- External CAS/programme directories, chroot roots, or preserved ownership as
  runtime prerequisites.
- Factory/operator/proof-cockpit services as hidden authority planes.
- Coordinator databases, system services, sockets, leases, fences, handovers,
  signatures, and PREPARE/COMMIT ceremony as the default path for one host.
- Per-edit Git branches, commits, or semantic publications.
- Historical environment/provider bindings whose semantics were internally
  inconsistent; concepts must be re-expressed and revalidated, not copied.
- Any inference that repository history proves external production deployment,
  current remote authority, legal ownership, security certification, or human
  acceptance.

No historical source bytes are claimed as reused by this observation. Any later
reuse still requires the exact source, licence, provenance, removed couplings,
new validation, and containment result in `provenance/reuse.json`.
