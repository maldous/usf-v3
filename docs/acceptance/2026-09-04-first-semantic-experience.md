# First semantic experience — acceptance record

Date: 2026-09-04.
USF carrier: `560c22d` on `anqr-experience-realisation`, clean, not pushed.
ANQR carrier: `f7c92a58c` on `anqr-experience-realisation`, clean, not pushed.
Release boundary: `hermetic-release-1` = `9e6239e`, untouched.

## 1. The journey realised

`urn:anqr:product-journey:create-and-export-artefact` — the product's central
outcome, performed by `anonymous-creator` with no account and no prior state.

| | |
|---|---|
| Entry | the creation surface |
| Success | the actor holds a file that decodes to exactly what they stated |
| Failure | the actor is told which of their choices made the artefact unusable, keeps everything they entered, and can change that one choice |
| Anonymity | required (`requiresAnonymity: true`) |

| step | objective | ANQR capabilities | Foundation capabilities |
|---|---|---|---|
| 1 `describe-payload` | state what the code should carry | `anonymousgeneration`, `custompayloaddefinition` | none |
| 2 `adjust-encoding` | choose how it is encoded | `encodingcontrolsurface` | none |
| 3 `review-artefact` | see what will be produced | `outputrendering`, `qrartefactcreation`, `roundtripcorrectness`, `scansafetyvalidation` | none |
| 4 `export-artefact` | take the file away | `artefactexport`, `deterministicoutput`, `scansafeoutput` | none |

## 2. Semantic identities introduced

| authority | IRI |
|---|---|
| experience profile | `urn:anqr:experience-profile-revision:1` |
| design profile | `urn:anqr:design-profile-revision:1` |
| implementation pack | `urn:anqr:ui-implementation-pack:preact:1` |
| pattern catalogue | `urn:usf:future-use-pattern-catalogue:1` |
| product denominator | `urn:anqr:profile-revision:2` |
| manifest | `graph/manifests/anqr-experience.json` |

Graph sources added: `graph/future-use-patterns.nq`,
`graph/products/anqr/experience.nq`, and the manifests naming them. Ten
predicates were declared before use (`actorRole`, `bindsDesignProfileRevision`,
`catalogueRevision`, `contrastRequirement`, `designCharacter`,
`journeyBusinessPurpose`, `journeyEntryPoint`, `journeySuccessOutcome`,
`journeyFailureOutcome`, `requiresAnonymity`) — found because `transact`
refused the postimage, and found completely only after noticing that its
violation list caps at eight.

## 3. Future Use Patterns

Five, all revision 1, all product-neutral:
`input-and-preview`, `validation-feedback`, `action-result-feedback`,
`progressive-disclosure`, `export-download`.

Neutrality is an executable invariant, `urn:usf:pattern-neutrality-rule:1`: no
pattern text may name a product, a UI framework, a markup or styling language,
a repository path, or a file format the pattern does not itself concern. The
rationale is in the rule — "a pattern that names its first consumer is not
reusable by a second."

## 4–5. Capability and Foundation bindings

Every step is ANQR-local. **No USF dependency was manufactured**: generation,
preview and export are ANQR capabilities, and the journey declares zero
foundation capabilities rather than routing through USF to demonstrate
integration. USF's role here is authority and assurance, not runtime service.

## 6. States and transitions

Seven states — `empty`, `input-invalid`, `generating`, `ready`, `exporting`,
`exported`, `failed` — with 16 declared transitions and eight actions:
`set-payload`, `set-error-correction`, `set-output-format`,
`set-symbol-version`, `set-foreground-colour`, `toggle-encoding-options`,
`export-artefact`, `dismiss-failure`.

The model lives in `apps/web/src/experience/machine.ts` and imports nothing
from Preact. `moveTo` throws `EXPERIENCE_TRANSITION_FORBIDDEN` on an undeclared
transition, so an invalid transition is a runtime refusal and not merely an
untested path. No component holds a state boolean of its own.

## 7. Design semantic roles

Eleven: `content-heading`, `supporting-text`, `input-label`, `input-surface`,
`option-control`, `preview-surface`, `validation-message`, `status-message`,
`primary-action`, `secondary-action`, `export-action`. Styling selects on
`data-design-role`, so CSS cannot invent a role that authority does not declare.

## 8. Preact implementation bindings

Twenty bindings over eight components, each resolved in **both** directions:
every declared action reaches a component that demonstrably renders its
identity, and every rendered identity resolves to a declared action or role.
`h()` is used throughout rather than JSX, because Node's type stripping cannot
transform JSX and a build step that only tests can see is a blind spot.

## 9. Dependencies

| package | kind | why |
|---|---|---|
| `preact` 10.29.8 | dependency | the only production dependency; the rendering mechanism |
| `typescript` 7.0.2 | dev | `statictypecorrectness` has no other decider |
| `@types/node` 26.4.1 | dev | without it the assertion signatures do not resolve and typecheck cascades |
| `esbuild` 0.28.2 | dev | resolves every production import and fails the build when one breaks |
| `happy-dom` 20.13.2 | dev | a document implementation, so accessibility is asserted over a rendered tree |

## 10. Build structure

`npm run build` → `apps/web/tools/build.mjs` → `apps/web/dist/`:
`main.js` 48 494 bytes from 27 inputs, plus `index.html` and `styles.css`.
No global tool is required; `tsc` absent from `PATH` does not affect it.

## 11. Adversarial proof

Eighty-two planted and control cases across five files. Each runs known-good →
plant → fail for the intended reason → restore → pass. All twelve required
categories are covered:

| required case | where | observed failure |
|---|---|---|
| Preact in an isolated layer | experience, architecture | `FRAMEWORK_IMPORT_IN_ISOLATED_LAYER` |
| binding to an unknown element | experience | binding rejected, unknown identity named |
| journey selecting an unknown pattern | experience | rejected at both journey-step and profile level |
| contaminated pattern | experience | three cases: product name, framework/markup, format assumption |
| rendered action with no binding | experience | `RENDERED_ACTION_UNBOUND` + `RENDERED_ROLE_UNKNOWN`, new file discovered |
| declared action with no implementation | experience | rejected |
| invalid state transition | experience | declared-level rejection **and** runtime `EXPERIENCE_TRANSITION_FORBIDDEN` |
| invalid parameter join | artefact | refused at the join and again by the producer |
| inaccessible interaction | experience | accessibility assertions fail |
| broken production build/import | experience | esbuild `Could not resolve` |
| export bypassing the port | architecture | `an adapter that bypasses its port is rejected` |
| source omitted by discovery | architecture | four blind-spot cases: novelty, depth, unowned file, dynamic/re-export specifiers |

Two planted proofs failed on first run and the checker was right both times:
the synthetic fixture's adapter imported no port (the architecture *requires*
adapters → ports), and a blind-spot test contained import syntax inside a
string.

**One unsound test was found and fixed.** Two files planted into the shared
working tree; Node runs each test file as its own process, so the plants
interleaved with the sibling file's known-good assertion. The suite passed
twice and failed once with the failing test moving between runs, and a fresh
clone reporting 288/289 against the primary tree's 289/289 is what exposed it.
Planting now happens in a disposable copy of the real tree
(`packages/architecture/tests/isolated-tree.ts`) with nothing weakened. Ten
consecutive clean runs in the primary tree, three in the clone.

## 12. Accessibility evidence

Eleven assertions over a rendered tree, testing semantic properties rather than
DOM snapshots: landmark and heading outline, accessible name for every control,
resolving `describedby` references, an export action **disabled with a stated
reason rather than hidden**, programmatic invalidity with its reason associated,
a live-region preview carrying a meaningful alternative, disclosure state
governing a region, keyboard reachability with no fake buttons, distinguishable
urgency for outcome versus failure, focus not stolen while the preview updates,
and export becoming operable and delivering once an artefact exists.

## 13. Parameter-join evidence

`joinArtefactSpecification` in
`packages/artefact/src/model/artefact-specification.ts` is the only route from
supplied values to a capability request. Eleven parameters, four join rules,
three of them genuinely cross-parameter:

- `constrains payload → symbolVersion`
- `constrains errorCorrectionLevel → symbolVersion`
- `constrains foregroundColour → minimumContrastRatio` (floor 4.5:1)

Each prohibited combination is built from individually valid values, so a
per-field validator would miss it, and is refused twice — at the join and again
by the producer when called directly. The declared rule set is read from the
projection by the test, so a rule removed from authority cannot silently stop
being tested.

## 14. Traceability

Both directions are executable, not commented. From a rendered element:
`data-experience-action` / `data-design-role` → binding → action or role →
journey step → pattern → capability → contract. From authority: profile →
selected pattern → journey → binding → the component that renders the identity
→ the test that asserts it. `experiencetraceability` checks 36 subjects and
fails if either direction breaks.

## 15. Clean-clone results

`git clone --no-hardlinks` at `f7c92a58c`, `node_modules` absent,
`apps/web/dist` absent, `tsc` not on `PATH`:

| step | result |
|---|---|
| `npm ci` | 0 vulnerabilities |
| `npm run typecheck` | 0 errors |
| `npm test` ×3 | 289/289, 289/289, 289/289 |
| `npm run architecture` | 121 sources, conforming, exit 0 |
| `npm run build` | `main.js` 48 494 bytes from 27 inputs |
| `npm run validate` | exit 0 |

## 16. Facet verdicts — 16, not 15

`experiencetraceability` was added by this work, so the count moved from 15.

**Eight statically satisfied**, zero violated:

| facet | subjects | mechanism |
|---|---|---|
| `importsresolve` | 121 | relative specifier resolution over every enumerated source |
| `nodependencycycles` | 121 | iterative three-colour depth-first search |
| `experiencetraceability` | 36 | bindings resolved in both directions |
| `dependencydirection` | 27 | layer edge evaluation |
| `frameworkisolation` | 14 | forbidden technology specifiers in isolated layers |
| `portimplementationconformance` | 11 | per-adapter resolution, ownership, port-contract import |
| `declareddependenciesagree` | 8 | manifest, lockfile and resolved import agreement |
| `domainhasnoruntimedependency` | 7 | non-relative, non-stdlib specifiers beneath domain |

**Six not statically checkable, each naming the executed mechanism that decides
it** — all six run inside `npm run validate`:

| facet | decided by |
|---|---|
| `statictypecorrectness` | `tsc --noEmit`; a type checker is the only thing that can decide it |
| `buildcorrectness` | `npm run build`; fails on any unresolved production import |
| `accessibilityconformance` | `node --test` over the rendered surface in a document implementation |
| `parameterjoinadmissibility` | `node --test` over the admissible-join validator |
| `artefactroundtrip` | `node --test` over the codec round-trip matrix |
| `deterministicartefact` | `node --test` over repeated production of one specification |

**Two left undecidable, deliberately:**

- `surfaceparity` — one surface is realised. A parity obligation over a single
  subject is trivially true, and a second cosmetic surface would be worse than
  an undecidable verdict.
- `localeparity` — no locale resource exists here. The eighty-six-locale
  denominator is declared in the graph and unrealised, and a string table
  created to satisfy the count would prove nothing.

Nothing was promoted because Preact rendered.

## 17. Source accounting

121 = 32 assigned + 89 declared-excluded + **0 unaccounted**. An unaccounted
source is a blocking exit, not a warning.

## 18. Release boundary

Re-verified after this work, by recomputation rather than by reading a record:

| lane | digest | state |
|---|---|---|
| `v3-delivery` (core) | `sha256:e958768a…` | 64/64, 0/0/0/0, byte-identical |
| `anqr` (product) | `sha256:17d52953…` | 39/39, 0/0/0/0, byte-identical |
| `anqr-with-foundation` (composed) | `sha256:3a9fa0d6…` | 103/103, 0/0/0/0, byte-identical |

`hermetic-release-1` is still the annotated tag at `9e6239e`. The live provider
lane is unchanged at `sha256:2e6a4780…` with construct and integrate ready
frontiers both **0**. USF: 442/442 tests.

## 19. Priority 1 publication debt

Unchanged and not worked around. The packet still reports
`COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT` and
`COMPLETION_POSTIMAGE_VERIFIER_PROOFBLOCKED:work-integration-transition:1`.
All three declared versions of that Foundation verifier are proofblocked, so
the byte-delta completion route cannot be published without implementing the
verifier or falsely claiming a no-change completion. Neither was done.

## 20. Cleanliness

Both worktrees clean at the carriers named above. Nothing pushed. 1.3 GB of
temporary clone lanes removed; the isolated-tree tests leaked no temporary
directories.

## 21. Honest gaps

- Two facets undecidable, as above.
- The architecture checker is a regex scanner, not an AST parse. It
  over-reports and never under-reports; conformance is the compiler's call.
- ANQR's rules-integrity check cannot catch a coordinated edit that stays
  internally consistent; only the USF-side authority comparison can.
- No continuous integration in the product repository, which is why the
  order-dependence above was found by hand.
- One surface. Android, iPhone, API and MCP realisations are modelled and
  unrealised, so the MCP goal of identical primitives across realisations is
  declared and unproven.
- The 86-locale i18n model is declared with no locale resource behind it.
- Priority 1 publication debt stands.

## Non-claims

- This records the first journey, not ANQR's UX. 39/39 remains the capability
  baseline.
- A satisfied facet is a claim about the mechanism named beside it and nothing
  wider.
- Clean-clone results are point-in-time observations at `f7c92a58c`.
