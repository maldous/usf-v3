# Naming, namespace and repository standard

The canonical source. Where anything else disagrees with this document, this
document is wrong or that thing is — resolve it, do not add a third opinion.

Derived from current semantic authority rather than from preference: every rule
below is either already true of the released corpus or is recorded in §9 as a
defect the corpus has, with its exact location.

## 1. The names

| name | expansion | is |
|---|---|---|
| **USF** | Universal Service **Foundation** | the reusable semantic delivery foundation. The graph is authority. |
| **UIF** | Universal Infrastructure **Foundation** | the infrastructure counterpart. Does not exist yet. |
| **UXF** | Universal Experience **Foundation** | the experience counterpart. Does not exist yet. |
| **ANQR** | — | a product. Not a foundation, not a platform, not a layer of USF. |
| **Hermes** | — | a bounded external realisation mechanism. Not authority, not part of any product's identity, and never a synonym for USF. |
| **TID** | Technical Infrastructure Design | a legacy design package used as a semantic-mining lens. Not authority. |

`U_F` expands to *Universal \<concern\> Foundation*. The final letter is always
Foundation. "Framework" is not used, because a document that says Framework in
one place and Foundation in another has already lost the reader.

## 2. Words that mean one thing

Each of these has exactly one meaning. Using one where another belongs is a
defect, not a stylistic choice.

| term | means | does not mean |
|---|---|---|
| **foundation** | reusable authority consumed by products | a product; a layer; "the important part" |
| **product** | an independently versioned authority closure with its own namespace | an application; a deployment; a repository |
| **profile** | a selection of contracts that scopes construction authority | a configuration; a persona; an environment |
| **profile revision** | an immutable version of a *product's* semantic denominator | a release; a build; a branch |
| **foundation revision** | an immutable version of *foundation* authority | the same axis as a profile revision |
| **binding** | an explicit dependency naming one exact profile revision and one exact foundation revision | an import; a merge; a shared graph |
| **capability** | an outcome a product or foundation claims | a module; a function; a file |
| **contract** | what a capability must do and what would make it wrong | an interface; a type; an API |
| **requirement** | an obligation that must hold | a wish; a task |
| **evidence** | normalised observation | an assertion; a claim; a passing test's existence |
| **proof** | deterministic evaluation of exact evidence against exact obligations | a test run; a report |
| **realisation** | an implementation traced to an obligation | code existing |
| **release** | a labelled, reproducible carrier state | a version; a revision; a deployment |
| **environment** | a named runtime posture on the delivery ladder | a profile; a configuration |
| **core** | **never the foundation.** Say *foundation*, or name the manifest. | the reusable authority |
| **platform** | **never the foundation or the product.** Say *foundation*, *product*, or *delivery target*. | either of those |

`core` and `platform` are retired *as names for the foundation*, because both
were used for foundation, for product and for infrastructure in the same
corpus. Neither is banned as an ordinary word: ANQR's `CoreOptions` are the
core QR parameters — payload, error correction, version, mask — which is a
domain term with a precise referent, and renaming it would damage a vocabulary
to satisfy a rule about a different word. Likewise "Factory functions" in a
source comment is the ordinary programming sense and is not the retired V2
Factory component. The test is whether the word names the foundation, not
whether the word appears.

## 3. Namespaces and IRI construction

```
urn:<authority>:<class>:<local-name>[:<version>]
```

- `<authority>` is exactly one of `usf`, `uif`, `uxf`, or a product's own short
  name (`anqr`). It is the same token as the repository name.
- `<class>` is kebab-case, singular: `contract`, `capability`, `work-packet`,
  `delivery-contract`, `experience-action`. Never plural.
- `<local-name>` is kebab-case for instances. A version, where present, is a
  bare integer as the final segment.
- Blank nodes are prohibited.

**Ownership rule.** An identifier's authority segment says who owns the
meaning, not who is interested in it. A foundation identifier may never carry a
product's name in any segment: if it needs one, the concept is not reusable and
belongs in that product's namespace. Correspondingly, a product may reference
foundation identifiers freely and may never declare one.

**Type and predicate names** are PascalCase (`urn:usf:type:DeliveryContract`)
and camelCase (`urn:usf:predicate:requiresDeliveryContract`) respectively.

This is not invented here. `docs/semantic-consolidation-closure.json`, closed
on 2026-09-02, records the convention recovered from V1 and V2 as
`urn:usf:<kind>:<name>[:<version>]` with PascalCase types, camelCase predicates
and kebab-case everything else. §3 restates recovered authority rather than
replacing it.
Predicates a foundation mechanism reads must live in that foundation's
namespace — a predicate in the wrong namespace is invisible to the mechanism
that reads it, and the graph stays internally consistent while meaning nothing.

## 4. Repositories

| repository | holds | may declare |
|---|---|---|
| `usf-v3` | USF foundation authority, CLI, methodology | `urn:usf:*` only |
| `anqr` | ANQR product implementation | no semantic authority; consumes projections |
| `usf-console` | the operator console over the USF CLI and its runtime state | no semantic authority |

The console is an observer:

```
USF semantic authority -> USF CLI and runtime interfaces -> operator console
```

It defines no USF behaviour independently of the graph, the contracts and the
CLI, and nothing in USF depends on it. Its current implementation is narrowly
coupled to today's CLI and runtime model, which is correct for a current
operator artifact and is not the final generalized experience architecture.
Recorded direction, not implemented: it is expected to grow into a general
interface that can *modify* features and capabilities rather than only observe
them, driven by semantic experience contracts rather than hard-coded knowledge
of today's commands.

Three of its identities carried different names — repository `usf-v3-site`,
package and worker `usf-v3-field-guide`, README title "USF V3 state console".
The package is now `usf-console`. The repository and the deployed worker keep
their names, because both are deployment identities and re-pointing either
publishes somewhere new; both are operator decisions.

A repository name carries no major version. `usf-v3-site` bakes V3 into an
identity that tracks USF as it evolves, so a V4 would orphan the name.

Product semantic authority for ANQR lives in `usf-v3` under
`graph/products/anqr/` today. That is a hosting arrangement, not ownership: the
identifiers are `urn:anqr:*` and the version axis is ANQR's.

- Repository name = IRI authority token, so a misplaced quad is visible on
  sight.
- No repository is named for a vendor, a framework or a rendering technology.
- A mining source is never named as though it were authority.

## 5. Paths

- `graph/*.nq` — foundation sources only.
- `graph/products/<product>/*.nq` — one product's sources.
- `graph/manifests/*.json` — source selections. A manifest is named for the
  lane it selects, not for what it imports.
- A filename is unique across the whole graph tree. Two files with the same
  basename in different directories are ambiguous in every log line that names
  one.
- Source, test and fixture filenames are kebab-case. TypeScript modules are
  kebab-case; exported types are PascalCase; exported functions are camelCase.

## 6. Historical material

Historical records keep historical names. `docs/historical-*`,
`docs/v1-v2-lessons.md` and `docs/v3-transition-record.md` may and should say
Factory, Cockpit, lease and journal, because changing them would falsify the
record.

Current documentation must never present a retired name as current
architecture. The distinction is *recorded historical terminology* versus
*current canonical terminology*, and a document that mixes them without saying
which is which is worse than either.

## 7. What ANQR and USF are to each other

```
USF foundation revision  ──── binding ────  ANQR profile revision
   owns reusable                              owns product meaning,
   capabilities and                           requirements, journeys
   universal methodology                      and experiences
        │                                            │
        └──────── separate namespaces, ──────────────┘
                  separate version axes,
                  separate authority closures
```

ANQR consumes an explicitly identified foundation revision. Never "latest".
A binding lets ANQR use USF capabilities without acquiring USF's capability
closure, its lifecycle or its identity.

Hermes performs bounded realisation and validation. Its output is candidate
work until validated and integrated through the ordinary authority path. It
manufactures no authority and appears in no identifier as an owner.

## 8. The invariant this all serves

> Nothing is realised because code exists. It is realised when an exact
> semantic obligation can be traced through implementation and deterministic
> evidence to proof, against identified graph, dependency and artefact
> versions.

## 9. Known defects in the current corpus

Recorded here rather than silently fixed, because each is release-visible and
§4 of the normalisation directive requires an explicit, validated migration.

| # | defect | location | scope |
|---|---|---|---|
| 1 | USF's corpus integrity scope names an ANQR graph as convention-exempt, so foundation authority carries a hardcoded product reference | `graph/v3-convention.nq` | one quad, inside the released foundation closure |
| 2 | `urn:usf:exposure-disposition:not-selected` names a reusable concept after one product | declared under `graph/products/anqr/` | 39 references |
| 3 | An entire ANQR contract lane wears `urn:usf:` — contract, work packets, requirements, acceptance criteria, validations, evidence requirements, proofs, permission and environment applicability | `graph/anqr-first-slice.nq` | 35 identifiers, reachable only from the ANQR manifest |
| 4 | `graph/anqr-first-slice.nq` is a product source at the foundation graph root | `graph/` | one file |
| 5 | `hermes-management.nq` exists at both the foundation root and under `graph/products/anqr/` | `graph/` | two files, one basename |

### Status after the normalisation pass

| # | status |
|---|---|
| 1 | **fixed.** The foundation names no product graph. The exemption was withdrawn and the core verdict digest stayed byte-identical, so the coupling cost nothing to remove. |
| 2 | **fixed.** `urn:usf:exposure-disposition:not-selected`, 40 references migrated. The concept stayed in the foundation; only the product name left it. |
| 3 | **fixed.** 34 identifiers migrated to `urn:anqr:`, and the two product graph identities are now `urn:anqr:graph:decoded-payload` and `urn:anqr:graph:hermes-operation`. |
| 4 | **partially fixed.** The graph *identity* left the foundation namespace; the *filename* `graph/anqr-first-slice.nq` did not, because moving a graph source needs a delete and `usf transact` has none. |
| 5 | **partially fixed.** Same cause: both graph identities are now distinct, both filenames still read `hermes-management.nq`. |

**The blocker for 4 and 5 is a registered tooling gap**, not a decision.
`usf transact` admits `append-quads`, `write-file` and
`derive-economics-projection` — there is no delete — and the postimage
validator correctly refuses any two-copy state, so a move cannot be expressed
as a transaction. Renaming a graph source therefore needs a `delete-file`
operation registered in `transact`, which is a foundation source change through
its own construction-authority lane.

A filename is not a semantic identity, so this is cosmetic debt with a named
cause and a known fix, rather than ambiguity in the graph.

### Debt closed, and one item that replaced it

Defects 4 and 5 are **fixed**. `usf transact` now admits `delete-file`, so a
graph source move is one atomic transaction whose validated postimage contains
neither a missing source nor two copies: existing, plus created, minus deleted.
`graph/anqr-first-slice.nq` is now `graph/products/anqr/decoded-payload.nq` and
the product hermes source is `hermes-operation.nq`. Zero duplicate basenames
across the graph tree and zero product sources at the foundation root.

The CLI prose is **fixed**: the command surface says foundation, not core.

The rename taught two things worth keeping:

- **A source may be selected by more than one manifest.** Updating the one that
  was checked left a second manifest naming a path that no longer existed, and
  the loader caught it.
- **A path's reference surface is wider than its manifests.** A work read path,
  a foundation contract's `permitsWrite` and a gate's `excludedModifiedPath` all
  named the old filename.

Following the rename into those last two moved the live provider lane's semantic
digest from `2e6a4780` to `1869c5c0` and failed fifteen basis-pinned tests. It
was reverted, the lane restored exactly, and the reason is the point: **a
foundation contract naming a product path is a genuine cross-ownership defect,
and fixing it costs a foundation lane.** It belongs in its own measured
migration, not folded into a rename pass. Until then a `permitsWrite` or an
`excludedModifiedPath` naming a path that no longer exists permits and excludes
nothing, so the residue is inert.

### The seed predicate, migrated with a declared alias

`coreDependencySeed` is now `foundationDependencySeed`. It is referenced by
every profile-to-foundation binding including released ones, so §4's aliasing
route was used rather than silent mutation: the reader was taught the canonical
name first, accepting the retired one as a **declared alias**, and only then did
the graph move. There was no moment where the reader and the graph disagreed.

A binding declaring **both** predicates is refused rather than merged. An alias
that silently unioned them would be worse than no alias, because the resulting
closure would depend on which predicate someone happened to use.

Measured after the migration: the core verdict digest is byte-identical, the
live provider lane is unchanged, and `usf profile status` still reports current
with the same fourteen closure resources. **Zero blast radius.**

The alias may be removed once no graph in any repository declares the retired
predicate. Until then it is documented here, which is what distinguishes it from
the undocumented aliases §12 hunts for.

### What is actually left

Three named items are closed. Two remain, and neither is naming debt in the
sense this exercise set out to clear:

1. **`graph/semantic-first.nq` and `graph/integration.nq` name a product path**
   (`graph/products/anqr/hermes-management.nq`, which no longer exists). This is
   **cross-ownership**, the same class as defect 1, and following the rename
   into it moved the live lane and failed fifteen tests. It needs its own
   measured migration. Until then it permits and excludes nothing, so it is
   inert. `graph/profile-authority.nq` also records the old path in a historical
   carrier intent and should keep it under §6.
2. **`src/commands/graph-integrity.ts` holds a hardcoded fallback list** of
   convention-exempt graphs naming a graph identity that no longer exists. The
   naming residue is the symptom; the defect is that a hardcoded fallback is a
   **second source of truth** for something the graph already owns. Correcting
   the string would preserve the defect. Removing the fallback is the right fix
   and is a design change rather than a rename.

### Adversarial sweep outcomes

Deliberately retained, under §6:

- `docs/semantic-consolidation-closure.json` names `urn:usf:graph:anqr-first-slice`.
  It is a record closed on 2026-09-02 of what the corpus was then. Rewriting it
  would falsify the record it exists to be.

Two further items are real and need a foundation source change through its own
construction-authority lane, so they are named rather than half-done:

- **CLI help prose** in `src/commands/help.ts` says "resource-scoped core
  dependency closure" and "core authority profile/manifest", using `core` for
  the foundation in the operator-facing surface. The words are wrong by §2; the
  behaviour is not.
- **The `coreDependencySeed` predicate** carries the same word into semantic
  authority, and it is referenced by every profile-to-foundation binding
  including released ones. Renaming it is a semantic migration across
  release-visible identifiers, which §4 requires be explicit and validated
  rather than folded into a documentation pass. `foundationDependencySeed` is
  the correct name when that migration is run.

The remaining live residue, justified rather than fixed:

- `src/commands/graph-integrity.ts` holds a hardcoded fallback list of
  convention-exempt graphs which still names `urn:usf:graph:anqr-first-slice`,
  a graph identity that no longer exists at all.
  It is reached only when the graph declares no exempt graphs, and the graph
  declares nine, so the current corpus never reads it. Correcting one string
  literal in an unreachable branch would need a foundation source change through
  its own construction-authority lane, which is disproportionate today and
  should happen the next time that file is opened under authority. The deeper
  observation is that the fallback is a second source of truth for something the
  graph already owns, and removing it entirely would be better than correcting
  it.

Three sweep hits are **not** defects, named here so a later sweep does not
chase them:

- `urn:anqr:evidence-source:usf-v1-absence` — ANQR's own evidence source whose
  *subject* is the absence of USF V1 semantics. The authority segment says who
  owns the meaning, and ANQR owns this one.
- `graph/semantic-recovery.nq` mentions the Factory in a `retirementReason`
  explaining what was never built. That is a retirement record.
- `README.md` contains the string `"latest"` inside the sentence forbidding it.

Defect 3's containment matters: those 35 identifiers are invisible to every
foundation manifest, so the foundation's reusable closure and version axis are
not polluted today. The namespace is wrong; the closure is right. Defect 1 is
the one that genuinely reaches into foundation authority.

## 10. Observability gaps found while normalising

Recorded, not fixed here, because each belongs to a packet that owns the
surface it would change.

- **Catalogue staleness is unmeasurable.** The frozen model catalogue records
  digests and no timestamp, and `usf doctor` reports its availability and
  digests without a freeze time or staleness signal. A four-day-old snapshot
  and a four-month-old one are indistinguishable in every projection, which is
  why refreshing it required a person to think of it. Measured on 2026-09-04:
  the snapshot was four days old and two provider routes plus thirty-seven
  model routes behind. The fix is a freeze timestamp in the snapshot and a
  doctor field reporting its age; `doctor` is owned by another packet, so this
  is a readiness projection to route to that owner rather than to smuggle in.
- **Lane policy coverage is 1 of 62.** `usf graph lanes` reports 327 work slots
  with 303 at risk, and every lane created today reads `at-risk` despite
  declaring a disjoint publication policy naming its own work. Whether that is
  a coverage-evaluation defect or a correct reading of a policy that covers
  construction but not completion has not been established, and asserting
  either without measuring would be a guess.

## 11. Non-claims

- A naming standard makes drift visible. It does not prevent it, and this
  document is worth exactly as much as the checks that enforce it.
- Recording a defect is not fixing it. §9 is a list of open work, not a
  disclaimer.
- UIF and UXF are named, not built. Naming a counterpart does not create it.
