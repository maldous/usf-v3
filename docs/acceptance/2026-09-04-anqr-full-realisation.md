# ANQR full realisation — acceptance record

Date: 2026-09-04.
USF carrier: `anqr-experience-realisation`, clean, not pushed.
ANQR carrier: `dde40c738` on `anqr-experience-realisation`, clean, not pushed.
Release boundary: `hermetic-release-1` = `9e6239e`, untouched.

## 1. Measured starting identities

Measured, not taken from the prompt: USF `2dde496`, ANQR `f7c92a58c`, both on
`anqr-experience-realisation`, both clean, one worktree each. Tags
`hermetic-release-1` (= `9e6239e`) and `semantic-realisation-1`. 20 manifests.
Hermes: no supervisor running, superseded cycle recorded from 2026-09-03.
Clean clone at `f7c92a58c`: `npm ci` → typecheck 0 → **289/289** → architecture
conforming, 121 sources, 0 unaccounted → build 48 494 bytes → `validate` exit 0.

## 2. Profile taxonomy confirmed

Confirmed and used as documented in [`profiles.md`](../profiles.md): core
realisation profile (Foundation contract scope), product realisation profile
(product contract scope), product profile revision (capability denominator),
manifest (source selection). **No environment was modelled as a profile.**
Environments are `urn:usf:environment:*` bound to `urn:usf:delivery-rung:*`,
which is a separate axis with its own posture and evidence semantics.

## 3. Legacy application actions discovered

Derived from observable behaviour, never from file counts:

| evidence | measure |
|---|---|
| central creation store | 126 actions over 284 state keys, in 13 control groups |
| payload kinds | 33 serialisers, 30 type helpers |
| public API | **185** distinct query parameters in a published 60 KB OpenAPI 3.1 document |
| client routes | 12 (editor, analyze, gallery, guide, learn, examples, translate, about, privacy, terms, contact) |
| serverless functions | 4 (`qr`, `api-qr`, `mcp`, `qr-render-background`) |
| edge functions | 1 (`seo`) |
| MCP surface | 2 tools, 1 prompt, 1 resource, JWT-authorised, rate-limited, audited |
| locales | 88 files: **86 locales at exactly 1676 keys each**, plus a template and a translation-tooling file |
| installability | a PWA manifest and a service worker in the built output |
| accounts | **none** — no auth, no session, no user record anywhere |

## 4. Harness excluded

Twelve areas named and excluded, each with the reason it is not product
behaviour: AST and density auditing, contract and docs checks, issue-tracker
integration, notification routing, model proxying, symphony orchestration,
evidence-closure gates, nightly operations, provider probing, temp and archive
maintenance, testing infrastructure, and asset tooling.

The evidence-closure gates deserve their own note: the legacy root carries
`evidence-closure-gate-force.mjs` and `force-close-with-incomplete-evidence.mjs`.
The existence of a force-close script is itself the argument that this was
automation machinery and not product behaviour.

Asset tooling is excluded while its **outputs** are product: the gallery, the
locale resources and the platform shells are ANQR; the generators are not.

## 5. Final ApplicationAction count

**60 actions.** 56 own at least one capability; every capability owns at least
one action or is declared cross-cutting. Zero unclassified product behaviour.

| exposure | actions |
|---|--:|
| user-visible | 39 |
| background-system | 10 |
| api-integration | 6 |
| admin-visible | 2 |
| no-direct-surface | 3 |

Parameter mutation is collapsed into one action per control group, each
enumerating the store actions it governs. The 13 groups sum to exactly 126, and
a closure check asserts that sum rather than trusting it — which is how the
payload group being claimed twice was found.

## 6. Capability denominator: 44 → 58

Revision 2's forty-four were correct and incomplete. Fourteen behaviours the
application demonstrably had were owned by no capability:

| capability | the evidence that had no owner |
|---|---|
| `artefactmetadataembedding` | a creation panel and eight API parameters writing into container metadata chunks |
| `accessentitlement` | premium activation, tier state, a request-access route, a tier-gated payload category |
| `advertisingmonetisation` | ad facades, a page rail, a gallery interstitial, an allowlisted ad origin |
| `regulatoryconsent` | a consent platform, autoblocking, a privacy-string stub, four allowlisted origins |
| `asynchronousrendering` | a background render function documented in the published API as an async helper |
| `renderedartefactcaching` | a cache store, a declared non-cache parameter set, disabled-store sentinels |
| `abusecontrol` | per-route rate limiters and bounds on bytes, pixels, redirects, frames, duration |
| `accessauditing` | an audit store, event types, an outcome taxonomy, a route policy |
| `runtimeobservability` | a 74-file logging, telemetry and error-reporting package |
| `crawlablepresentation` | an edge function injecting metadata ahead of the static response |
| `installableoffline` | an installable manifest and a service worker |
| `geolocationassistance` | a place lookup and plus-code display; the only external service in the creation path |
| `controlsurfacesearch` | a search provider over a surface of 185 parameters |
| `deviceimagecapture` | camera acquisition shared by creation and analysis, with three classified refusal causes |

## 7. New product profile revision

`urn:anqr:profile-revision:3`, declaring 58 capabilities, 10 domains, 14 UI
surfaces, 5 UI supplies, 16 opportunities and 26 exclusions. It supersedes
revision 2, which **stays immutable at 44**: completions recorded against it
were recorded against that denominator and rewriting it would retroactively
change what they claimed.

## 8. Capability → USF dependency

| ownership | capabilities |
|---|--:|
| ANQR-local | 39 |
| USF-backed | 16 |
| external-through-USF-contract | 1 (`geolocationassistance`) |
| cross-cutting | 2 |

No Foundation dependency was manufactured. Creation, preview and export remain
ANQR-local, as the first slice established. The 16 USF-backed capabilities
depend on named capability ports: `apiruntime`, `objectstore`, `auditledger`,
`observabilitysink`, `operationaljobport`, `secretresolver`, `configlayerprovider`.

## 9. ANQR ↔ USF version binding

`urn:anqr:profile-foundation-binding:3` binds revision 3 to Foundation revision
`v3.1` and an exact fifteen-member seed closure. Adoption is
`explicit-semantic-delta`: a later Foundation revision does not reach this
product revision until a new binding adopts it deliberately, and Foundation
movement outside the seed closure leaves the product current. The axes stay
independent — the binding names Foundation authority by path and imports none
of it.

## 10. Experience coverage

Every one of the 47 exposed actions (user-visible, admin-visible,
api-integration) resolves through action → capability → exposure → evidence
mechanism. Background and no-direct-surface actions have no invented screens,
and API and MCP actions have no invented buttons: 13 actions are declared
`background-system` or `no-direct-surface` and carry no experience exposure by
design.

Full experience realisation — journey, states, roles, bindings, rendered
evidence — exists for **one** journey, `create-and-export-artefact`, proven in
the previous boundary. The other exposed actions have semantic coverage and no
implementation.

## 11. Future Use Pattern coverage

Unchanged at five product-neutral patterns under the neutrality invariant. No
speculative pattern was added: the new capabilities are modelled as behaviour,
and a pattern is only justified once a second product would select it.

## 12. Background and API capabilities have no invented UI

Ten background-system and six api-integration actions carry no design role, no
experience state and no implementation binding, and the closure checks do not
require them to. `present-to-crawler`, `cache-rendered-artefact`,
`enforce-request-rate-limit` and `emit-runtime-telemetry` have no surface
because they have no user.

## 13. Infrastructure and delivery requirements discovered

**24 required, 35 explicitly not required.** The negatives are the substance:

- Not required: relational storage, migrations, RLS, authentication platform,
  user identity, RBAC, ABAC, sub-organisations, tenant groups, tenant
  isolation, tenant lifecycle, tenant data import/export, tenant domains,
  delegated administration, break-glass access, durable queues, workflow
  engine, scheduled jobs, server-side search index, notifications, webhooks,
  backup and restore, PITR and data residency, data governance, usage
  metering, subscriptions and billing, product catalogue, support tickets,
  compliance reports, API keys, history projections, end-user profiles,
  branding and theming.

Each states why in the product's own terms — and a closure check rejects a
reason too thin to review, which is how nineteen of them were rewritten.

## 14. USF delivery contracts introduced

Reconciliation first: **67 delivery contracts and 25 capability ports already
existed.** The directive's premise that USF lacked delivery semantics was
wrong, and twelve candidates reduced to **nine genuinely absent**:

`staticassetruntime`, `edgeruntime`, `networkingress`, `responseheaderpolicy`,
`cdncachepolicy`, `healthreadiness`, `deploymentmechanism`, `rollbackmechanism`,
`releaseprovenance`.

Each names what it does **not** duplicate, because a near-duplicate contract is
worse than a missing one: it splits the binding and neither half is complete.
Three candidates were withdrawn — function runtime, DNS and TLS were already
covered.

## 15. Infrastructure and provider bindings

The historical target was **discovered, not chosen**: a platform configuration
declaring publish directory, build command, function and edge-function
directories; four function routes and one edge route with public path
redirects; a per-path response header and content-security policy; a blob-store
cache; and a published OpenAPI document naming the background route as
internal.

| rung | environments | status |
|---|---|---|
| development | hermetic, localdev | **bound** |
| testing | ci, integrationtest | **bound** |
| staging | productionshaped, staging | **unresolved** — 4 named decisions |
| production | productionlive | **unresolved** — 7 named decisions |

The unresolved decisions are recorded in full in §36.

## 16. Canonical realisation-basis identity

`urn:usf:realisation-identity:v2:1`, **18 axes**, superseding v1's four. Each
axis names its source of truth and what its movement changes. Invalidation is
narrow and per-axis: a build digest moving invalidates deployment, runtime,
browser-render and provenance evidence and leaves implementation conformance
alone; an external fact snapshot invalidates nothing.

A closure check refuses any axis that invalidates every evidence class, because
a verdict that is always stale is never trusted.

## 17. Hermes work derivation

Against `graph/manifests/anqr-application.json`, Hermes resolves the basis and
derives: **104 capabilities, 922 facets, 72 NOT_ASSESSED, 9 capabilities with
remaining work, a ready frontier of 1** —
`urn:usf:workunit:implementation-platformparity`, targeting a derived path in
the product repository. It infers nothing; every identity is resolved from the
manifest lane.

One controller defect was found and fixed on the way: the manifest declared one
graph IRI twice, which the loader correctly refuses as
`MANIFEST_DUPLICATE_SOURCE_OR_GRAPH`. A second, unfixed, is recorded in §34.

## 18. Development evidence

Current. ANQR 297/297 tests over three consecutive clean runs, typecheck 0,
architecture conforming with 122 sources and **zero unaccounted**, build 48 494
bytes, `validate` exit 0. USF 470/470.

## 19. Testing evidence

Partial and honestly so. The `ci` environment is now bound and automated (§26).
The `integrationtest` environment is bound in semantics and **not instantiated**:
no composed provider stack has been stood up, so no capability holds a
testing-rung verdict.

## 20. Staging deployment evidence

**None.** The staging binding is unresolved; no deployment has occurred.

## 21. Production deployment evidence

**None.** The production binding is unresolved; no deployment has occurred.
Production-ready is not production-deployed, and neither is claimed.

## 22. Browser render and visual evidence

The viewport classes (`compact`, `regular`, `wide`) and the `browser-render`
evidence class are declared, with the rule that a device is an evidence fixture
and never semantic authority. Rendered evidence exists for the one realised
journey through a document implementation; **no screenshot evidence has been
captured**, because a screenshot pinned to a build that has never been deployed
would be evidence about nothing.

## 23. Accessibility

Eleven executed assertions over the rendered surface, unchanged and current at
the development rung. `accessibleinteraction` is now declared cross-cutting
over every exposed action, so the obligation is stated for all 47 and evidenced
for the actions of one journey.

## 24. Locale parity disposition

**Required and unrealised** — no longer undecidable. The declared 86 locales
match the legacy language table exactly, including the same seven right-to-left
locales, and 86 resource files exist at exactly 1676 keys each. The gap is
delivery, with a verified denominator. Generating translations to satisfy a
count would be worse than the gap.

## 25. Surface parity disposition

**Required and undecidable.** The denominator commits to web, mobile, HTTP API
and MCP delivery; one surface is realised. A second cosmetic surface would
satisfy the count and prove nothing.

## 26. Automated validation

A workflow runs the canonical six-command chain on a clean checkout with a
pinned runtime and a timeout. Eight checks hold it to the local chain: the step
list must equal the canonical chain in order, every script must exist, and
`validate` must genuinely compose the parts. Three are planted — a removed
step, a reordered chain, and a real framework-import violation run through the
gate's own architecture step, which fails with
`FRAMEWORK_IMPORT_IN_ISOLATED_LAYER` and passes again once removed.

## 27. Adversarial plants and reason codes

Twenty-eight closure checks in USF, ten of them planted:

| planted | observed |
|---|---|
| action naming an undeclared capability | dangling capability reference |
| capability with no action and no cross-cutting declaration | orphan reported |
| action stripped of an attribute | missing attribute observable, not defaulted |
| secret value in authority | credential-shaped literal caught by the scan |
| vendor name in a generic delivery contract | vendor fact located in the wrong hop |
| rung promoting past the next | ordering violation observable |
| production gate without an approval authority | authority absent |
| axis invalidating every evidence class | blanket invalidation observable |
| contract in both required and not-required lists | overlap reported |
| CI step removed / chain reordered / real violation run | `FRAMEWORK_IMPORT_IN_ISOLATED_LAYER` |

**Three real defects in this work were found by these checks**, not by review:
the payload control group was claimed twice and double-counted 37 store
actions; the requirement summary still said 25 after deduplication made it 24;
and nineteen exclusion reasons were too thin for a reviewer to evaluate.

## 28. Build and deployment artefact provenance

The chain is declared — source, dependency lock, build command, build digest,
semantic basis, environment binding, configuration identity — as
`urn:usf:delivery-contract:releaseprovenance` and as a basis axis. Source,
lock, command and digest are currently produced; basis is resolvable; binding
and configuration identity do not exist because no environment above testing is
bound.

## 29. Rollback and recovery

`rollbackmechanism` is declared, provider-neutral, and explicitly distinguished
from backup and restore: it recovers the running artefact, and a rebuild is not
a rollback. **Unproven** — rehearsing it requires a staging binding.

## 30. Source accounting

ANQR: 122 = 32 assigned + 90 declared-excluded + **0 unaccounted**. The
invariant caught a new file at the repository root during this work, which is
what it is for.

## 31. Clean-clone reproduction

At `f7c92a58c`: all six steps pass, 289/289 three times. The subsequent commit
adds the CI parity tests; the primary tree at `dde40c738` runs 297/297 three
times with `validate` exit 0.

## 32. Release boundary

Re-verified by recomputation after every transaction: core `e958768a`, anqr
`17d52953`, composed `3a9fa0d6` — all byte-identical throughout. Live provider
lane `2e6a4780` with construct and integrate frontiers both 0.
`hermetic-release-1` still the annotated tag at `9e6239e`.

Four transactions landed, each in its own manifest lane, each measured after
applying. **Zero blast radius on every one.**

## 33. Priority 1 publication debt

Unchanged and not worked around. `COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT`
and `COMPLETION_POSTIMAGE_VERIFIER_PROOFBLOCKED:work-integration-transition:1`
still stand.

## 34. Remaining honest gaps

- **Staging and production are unbound.** Eleven named decisions require an
  authority this repository does not have.
- **No capability is implemented against revision 3.** 58 capabilities carry
  `realisationStatus not-started`; 72 facets are NOT_ASSESSED. A larger
  denominator is a larger obligation, not a larger achievement.
- **The integration-test environment is not instantiated.**
- **86 locale resources exist as legacy evidence and are not in the product.**
- **One surface is realised**; parity needs two.
- **A CLI observability defect is open and unfixed**: `errorOutput` flattens
  any non-`UsfError` to `INTERNAL_ERROR` with no reason code, so a
  `GraphLoadError` carrying a perfectly good
  `MANIFEST_DUPLICATE_SOURCE_OR_GRAPH` reached the operator as "Unexpected
  internal error." It is recorded rather than fixed because `src/` is outside
  the transaction's authorised paths and the repair belongs in its own packet.
- **No screenshot or human-review evidence exists**, by choice.
- **A timed integration test became marginal because of this work.** The
  loaded corpus grew from about 33 000 quads to about 41 700; a profile-bound
  provider census measures 2.9 to 3.1 seconds and its five-second hang guard
  intermittently failed under parallel load. The guard was raised to twenty
  seconds with the measurement recorded, because the cause was headroom rather
  than a regression. Four consecutive clean runs afterwards.
- Nothing is pushed.

## 35. Repository and worktree cleanliness

Both worktrees clean, one worktree each, nothing pushed.

## 36. Requires human or external authority

**Staging (4):** which account or team owns the staging site; the staging site
identifier; a deploy credential, which no work here may create; whether a
distinct staging hostname is provisioned or a platform-generated preview name
is accepted.

**Production (7):** which account or team owns the production site; the
production site identifier; the production hostname and control of its DNS
zone; a deploy credential; the advertising and consent platform account
identifiers the delivered header policy allowlists; the error-reporting project
the observability facades send to; **a named human approval authority for
production mutation**.

Four secret requirements are modelled as name, resolver and consequence, with
no value and no format hint: agent-surface credential, deploy credential,
telemetry sink key, geocoding service key.

## Closure matrix

Capability × actions × experience × USF dependency × delivery requirement ×
DEV × TEST × STAGING × PROD.

`prereq` — this rung can establish prerequisites but cannot make this
capability's full claim, which needs the named minimum rung.
`unrealised` — the rung is bound and the capability is not implemented.
`unbound` — the environment binding is unresolved, so no verdict is possible.
No cell is `N/A`: nothing here is semantically inapplicable, it is missing.

| capability | actions | experience | ownership | delivery | min rung | DEV | TEST | STAGING | PROD |
|---|--:|---|---|--:|---|---|---|---|---|
| `abusecontrol` | 1 | background-system | ANQR-local | 1 | STAGING | prereq | prereq | unbound | unbound |
| `accessauditing` | 1 | background-system | USF-backed | 1 | TEST | prereq | unrealised | unbound | unbound |
| `accessentitlement` | 2 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `accessibleinteraction` | cross-cutting | constrains others | cross-cutting | 0 | per-action | prereq | prereq | unbound | unbound |
| `advertisingmonetisation` | 1 | no-direct-surface | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `animatedartefact` | 2 | user-visible | USF-backed | 4 | STAGING | prereq | prereq | unbound | unbound |
| `anonymousgeneration` | 1 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `artefactexport` | 3 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `artefactmetadataembedding` | 1 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `asynchronousrendering` | 1 | background-system | USF-backed | 4 | STAGING | prereq | prereq | unbound | unbound |
| `authenticatedserviceconsumption` | 3 | api-integration | USF-backed | 3 | STAGING | prereq | prereq | unbound | unbound |
| `bidirectionaltextsupport` | 1 | user-visible | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `brandoverlay` | 2 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `capabilitygallery` | 2 | user-visible | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `communitytranslationcontribution` | 1 | user-visible | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `controlsurfacesearch` | 1 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `crawlablepresentation` | 1 | background-system | ANQR-local | 2 | STAGING | prereq | prereq | unbound | unbound |
| `custompayloaddefinition` | 4 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `deterministicoutput` | 2 | background-system | USF-backed | 2 | STAGING | prereq | prereq | unbound | unbound |
| `deviceimagecapture` | 2 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `encodingcontrolsurface` | 1 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `geolocationassistance` | 1 | user-visible | external-through-USF-contract | 2 | STAGING | prereq | prereq | unbound | unbound |
| `guidedonboarding` | 1 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `httpapidelivery` | 3 | user-visible | USF-backed | 4 | STAGING | prereq | prereq | unbound | unbound |
| `installableoffline` | 2 | user-visible | ANQR-local | 1 | STAGING | prereq | prereq | unbound | unbound |
| `interfacelocalisation` | 1 | user-visible | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `localenegotiation` | 1 | user-visible | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `localetypography` | 1 | user-visible | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `localisedstaticcontent` | 1 | user-visible | ANQR-local | 1 | TEST | prereq | unrealised | unbound | unbound |
| `mcpdelivery` | 4 | api-integration | USF-backed | 3 | STAGING | prereq | prereq | unbound | unbound |
| `mobileapplication` | 1 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `multilingualdiscoverability` | 2 | user-visible | ANQR-local | 2 | STAGING | prereq | prereq | unbound | unbound |
| `outputrendering` | 3 | user-visible | USF-backed | 4 | STAGING | prereq | prereq | unbound | unbound |
| `payloadclassification` | 2 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `payloadconfidentiality` | 1 | user-visible | ANQR-local | 1 | DEV | unrealised | unrealised | unbound | unbound |
| `paymentpayloadrepresentation` | 1 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `performancebudget` | 1 | background-system | USF-backed | 3 | STAGING | prereq | prereq | unbound | unbound |
| `platformparity` | cross-cutting | constrains others | cross-cutting | 0 | per-action | prereq | prereq | unbound | unbound |
| `policyboundarycontrol` | 1 | admin-visible | ANQR-local | 1 | STAGING | prereq | prereq | unbound | unbound |
| `productidentitypayload` | 1 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `programmaticgeneration` | 3 | user-visible | USF-backed | 4 | STAGING | prereq | prereq | unbound | unbound |
| `qrartefactcreation` | 3 | api-integration | USF-backed | 5 | STAGING | prereq | prereq | unbound | unbound |
| `qrartwork` | 5 | user-visible | USF-backed | 3 | STAGING | prereq | prereq | unbound | unbound |
| `qrdecoding` | 4 | user-visible | ANQR-local | 1 | STAGING | prereq | prereq | unbound | unbound |
| `regulatoryconsent` | 1 | user-visible | ANQR-local | 1 | DEV | unrealised | unrealised | unbound | unbound |
| `remoteassetsafety` | 3 | user-visible | ANQR-local | 1 | STAGING | prereq | prereq | unbound | unbound |
| `renderedartefactcaching` | 1 | background-system | USF-backed | 2 | STAGING | prereq | prereq | unbound | unbound |
| `responsivewebdelivery` | 2 | user-visible | ANQR-local | 5 | STAGING | prereq | prereq | unbound | unbound |
| `roundtripcorrectness` | 1 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `runtimeobservability` | 1 | background-system | USF-backed | 3 | STAGING | prereq | prereq | unbound | unbound |
| `scansafeoutput` | 2 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `scansafetyvalidation` | 1 | user-visible | ANQR-local | 0 | DEV | unrealised | unrealised | unbound | unbound |
| `selfhostedoperation` | 1 | admin-visible | USF-backed | 5 | PROD | prereq | prereq | prereq | unbound |
| `shareablerepresentation` | 3 | user-visible | ANQR-local | 1 | DEV | unrealised | unrealised | unbound | unbound |
| `structuralinspection` | 4 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `structuredpayloadrepresentation` | 2 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `unsafecustomisationdiagnosis` | 2 | user-visible | ANQR-local | 0 | TEST | prereq | unrealised | unbound | unbound |
| `visualcustomisation` | 2 | user-visible | USF-backed | 3 | STAGING | prereq | prereq | unbound | unbound |
