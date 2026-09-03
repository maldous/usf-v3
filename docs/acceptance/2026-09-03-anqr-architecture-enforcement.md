# ANQR clean-clone reproducibility and architecture enforcement

Priority 2 evidence. Recorded after the landed transaction-integrity repair and
without disturbing `hermetic-release-1` or any released verdict digest.

## Original defects

The released product repository could not validate itself.

1. **`typecheck` was declared and unrunnable.** `package.json` named
   `tsc --noEmit` and declared no dependencies at all. There is no global
   TypeScript on this host and `tsc` is not on `PATH`, which is how the gap
   stayed invisible: the script had never executed in the released baseline.
2. **No lockfile**, so no install was reproducible from a clean clone.
3. **The test script enumerated only `tests/**`**, so the eleven codec tests
   under `packages/artefact/tests/` were invisible to the declared test
   authority. This is the same incomplete-enumeration class as the Priority 1
   transaction defect.
4. **Six ports were declared at exact paths that did not exist**, which is a
   defect in the architecture declaration rather than in the implementation.

A fifth was introduced and caught during the work: unquoted globs made the
**shell** expand them, so the result depended on `globstar`. Quoted, and proven
by running with `globstar` off and still collecting every file.

## Clean-clone chain

From a clone with no `node_modules`, no lockfile-free install, `tsc` absent from
`PATH` and `NODE_PATH` unset:

```text
git clone --no-hardlinks <repo> && git checkout anqr-experience-realisation
npm ci            # 4 packages from package-lock.json, lockfileVersion 3
npm run typecheck # 0 errors
npm test          # 200 tests, 200 pass, 0 fail
npm run architecture
```

`npm run validate` chains typecheck, test and architecture.

**Negative control:** with `node_modules` moved aside, `npm run typecheck`
reports `sh: 1: tsc: not found` — the original defect exactly — and passes again
once restored. The declared dependency is load-bearing rather than incidental.

## Typecheck authority

| | |
|---|---|
| Compiler | `typescript` **7.0.2**, exact, no caret |
| Types | `@types/node` **26.4.1**, exact |
| Lockfile | `package-lock.json`, `lockfileVersion` 3, integrity-pinned |
| Command | `tsc --noEmit` |
| Configuration | `tsconfig.json`: `strict`, `module`/`moduleResolution` NodeNext, `target` ES2024, `allowImportingTsExtensions`, `skipLibCheck`, `types: ["node"]` |
| Include | `src/**`, `tests/**`, `packages/*/src/**`, `packages/*/tests/**` |

Declaring the dependencies took typecheck from unrunnable, to 125 errors, to 1.
The 125 were almost entirely cascades: without `@types/node` the assertion
signatures on `node:assert` do not narrow, so 87 unresolved-name errors dragged
21 property-access and 15 possibly-undefined errors behind them. The one real
error was in `reed-solomon.ts`, where the initialiser inferred
`Uint8Array<ArrayBuffer>` while `polyMultiply` returns
`Uint8Array<ArrayBufferLike>`; annotated, not cast. **The released capability
modules and conformance tests needed no change.**

## Facet enforcement map

`packages/architecture/rules.json` is generated from the USF semantic graph and
carries the layers, components, ports, adapters, dependency rules, isolation,
cycle, dependency-scope, generated-code and module-boundary rules, and all
fifteen facets with verification class, severity and stage. The checker knows
how to check, never what is true. Every finding carries its facet IRI.

| facet | verification class | verdict | findings | mechanism / why not |
|---|---|---|---|---|
| `accessibilityconformance` | accessibility-conformance | not decided here | 0 | No rendered surface exists, so there is nothing to evaluate for accessible name, role, state, focus order or keyboard operability. |
| `artefactroundtrip` | integration-behaviour | not decided here | 0 | decided by node --test over the codec round-trip matrix; a runtime behaviour rather than a source property |
| `buildcorrectness` | build-correctness | not decided here | 0 | No delivery surface is realised, so there is no declared build command to run. The facet stays unsatisfied rather than vacuously satisfied. |
| `declareddependenciesagree` | dependency-declaration-integrity | satisfied | 0 | architecture checker: package manifest, lockfile presence and resolved import agreement |
| `dependencydirection` | dependency-boundary | satisfied | 0 | architecture checker: layer edge evaluation over recursive source enumeration |
| `deterministicartefact` | reproducible-build | not decided here | 0 | decided by node --test over repeated production of one specification |
| `domainhasnoruntimedependency` | dependency-declaration-integrity | satisfied | 0 | architecture checker: non-relative, non-stdlib specifiers beneath domain components |
| `frameworkisolation` | dependency-boundary | satisfied | 0 | architecture checker: forbidden technology specifiers in isolated layers |
| `importsresolve` | import-resolution | satisfied | 0 | architecture checker: relative specifier resolution over every enumerated source |
| `localeparity` | contract-compatibility | not decided here | 0 | No locale resource exists in the product repository yet, so there is no key set to compare against a reference. The 86-locale denominator is declared  |
| `nodependencycycles` | circular-dependency | satisfied | 0 | architecture checker: iterative three-colour depth-first search over the module graph |
| `parameterjoinadmissibility` | unit-behaviour | not decided here | 0 | The 23 declared conditional-joining rules have no implemented validator, so no specification can be admitted or refused yet. |
| `portimplementationconformance` | interface-conformance | **violated** | 5 | architecture checker: port contract existence and port-to-adapter pairing |
| `statictypecorrectness` | static-type | not decided here | 0 | decided by tsc --noEmit under the repository's declared strict configuration; a separate mechanism because a type checker is the only thing that can d |
| `surfaceparity` | contract-compatibility | not decided here | 0 | One delivery surface is realised. A parity obligation over a single surface is trivially true and would prove nothing. |

Nine facets are satisfied: six by the checker, three by the mechanisms they are
delegated to, all of which pass. One is truthfully violated. Five are
undecidable because their subject does not exist.

`portimplementationconformance` is violated with five findings: four declared
adapters and the `image-source` port have no realisation. `npm run architecture`
therefore exits non-zero. That is not weakened to obtain a green chain.

## Planted violations

Eighteen cases, all passing, each running known-good, plant, fail for the
intended code, restore, pass.

| planted condition | code produced |
|---|---|
| domain module imports a delivery module | `FORBIDDEN_LAYER_DEPENDENCY` |
| component imports the released capability convention | `MODULE_BOUNDARY_CROSSED` |
| framework import inside an isolated layer | `FRAMEWORK_IMPORT_IN_ISOLATED_LAYER` |
| third-party runtime import in the domain | `THIRD_PARTY_IMPORT_IN_DOMAIN` |
| two modules importing each other | `DEPENDENCY_CYCLE` |
| relative import to a missing file | `IMPORT_UNRESOLVED` |
| import of an undeclared package | `UNDECLARED_DEPENDENCY` |
| lockfile deleted | `LOCKFILE_ABSENT` |
| declared port contract deleted | `PORT_CONTRACT_ABSENT` |

Blind spots, attacking the Priority 1 failure classes directly:

| blind spot | assertion |
|---|---|
| novelty | a file created since the last run is discovered and rejected |
| depth | a violation five directories down is still found |
| attribution | a file in no declared component is reported, never skipped |
| import forms | dynamic, re-export, side-effect and `require` forms are all read |

Controls:

| control | purpose |
|---|---|
| permitted cross-layer edge | must not be reported, or the checker rejects shape rather than direction |
| `node:` import in the domain | the standard library is admissible |
| one planted violation | must move only the facets that observe that property |

One violation is planted in the real repository and removed, proving the same
machinery sees real novelty and leaves nothing behind.

**Two proofs initially failed and the checker was right both times.** The
synthetic fixture was not known-good, because the architecture *requires*
adapters to depend on ports and the fixture's adapter imported none; the fixture
was fixed, not the rule. And a blind-spot test contained import syntax inside a
string, which a regex scanner cannot distinguish from a real import.

## Structural blind spots found and repaired

| blind spot | repair |
|---|---|
| test script enumerated one root, hiding eleven codec tests | both roots enumerated; 171 to 200 tests |
| shell-expanded globs depended on `globstar` | quoted so Node expands; proven with `globstar` off |
| 78 released-convention sources belonged to no component, so a dependency check comparing only assigned components could never see a violation among them | `ModuleBoundaryRule` declared in the graph; crossing it is a planted-proven finding |
| unassigned sources would have been silently skipped | reported, with `sources == assigned + unassigned` asserted |
| a declared dependency judged used by matching the package name against script text falsely flagged `typescript`, which provides `tsc` | binary names read from the installed package; undecidable without an install and stated as such |
| regex import scanning cannot distinguish an import expression from a string containing one | recorded in the checker: it over-reports and never under-reports, the safe direction for a boundary check |

## Release boundary

Verified after every change: `hermetic-release-1` remains the annotated tag at
`9e6239e`, reachable from HEAD, and the released verdict digests are
byte-identical.

| lane | digest |
|---|---|
| `v3-delivery` | `sha256:e958768a3ba88f5e2efb45c983668fb4e7dce3c1d5deb95f6397bb8412d7f306` |
| `anqr` | `sha256:17d52953f7217e8acb6d9818c67c45eedef40e92d7e2963140925f5284df09cf` |
| `anqr-with-foundation` | `sha256:3a9fa0d63031954f8f701f1aa0ae3694390315fa9a46bebdb16afefba674f0ac` |

The live provider lane stayed at nine `verified-complete` packets with an
unchanged semantic digest throughout, including across the `ModuleBoundaryRule`
transaction.

## Priority 1 formal completion debt

**It cannot be closed through the normal mechanism, and the reason is
structural rather than a defect in the repair.**

A work that lands a real byte delta completes through
`urn:usf:proof-algorithm:semantic-work-completion:1`, which binds
`integrationTransitionVerifier` to `urn:usf:algorithm:work-integration-transition`.
Every declared version of that verifier — 1, 2 and 3 — carries
`implementation-state:proofblocked`, and the work projection at
`src/graph/work.ts:752` *requires* exactly that state before emitting
`COMPLETION_POSTIMAGE_VERIFIER_PROOFBLOCKED`. So the byte-delta completion route
is deliberately proofblocked in the Foundation.

The only implemented completion route is
`urn:usf:proof-algorithm:semantic-no-change-completion:1`, whose realisation
verifier `no-change-workspace-materialisation:1` is `implemented`. It requires a
genuine no-change realisation, which this work cannot claim: it changed 58 lines
of `transact.ts` and added a test file.

Closing the chain would therefore require implementing and proving the postimage
transition verifier — a Foundation capability left proofblocked by design — or
falsely asserting no-change for a real byte delta. Both are excluded, so this is
**recorded as formal publication debt**: the repair is landed, integrated and
adversarially proven; its formal completion is not published, and the packet
correctly reports `COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT` alongside the
proofblocked verifier.

## Honest gaps

- `portimplementationconformance` is violated: four adapters and the
  `image-source` port are declared and unrealised.
- Five facets are undecidable: no build, no locale resource, no rendered
  surface, no join-rule validator, one realised surface where parity needs two.
- The checker is a regex scanner rather than a parse over the TypeScript AST.
- The rules-drift check is a manual regeneration and byte comparison
  (`sha256:f3e5bd8088223730df0f3186e4cec5c72c0e06cc16360d5627a1c9360bb4f90e`
  on both sides), not yet a registered recurring check.
- Eighty-one of ninety-three sources belong to no declared component. That is
  reported, and the module boundary makes it a named exclusion rather than
  silence.
- No enforcement runs in continuous integration; there is no CI configuration in
  the product repository.
