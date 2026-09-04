# Provider and model surface: what Hermes can see, and what it actually uses

Evaluation lane, 2026-09-04, at `329ad58`. **No routing policy, qualification
threshold, provider configuration or semantic authority was changed.** Every
number below is measured; nothing is inferred from configuration.

## 1. Provider denominator

| population | count | how established |
|---|---|---|
| catalogue provider routes | 213 | frozen models.dev snapshot |
| catalogue adapter packages | 28 | snapshot |
| adapter packages installed | 8 | resolved inside the repository |
| configured routes (`config/providers.json`) | 2 | cerebras, groq |
| host CLI transports declared | 3 | claude-cli, codex-cli, antigravity-cli |
| host CLI executables observed | 3 | `claude`, `codex`, `agy` all on PATH |
| operator credential names supplied | 13 | `.usf/credentials/providers.env`, mode 0600 |
| economic authorizations declared | **5 pairs** | graph `urn:usf:economic-authorization:*` |
| providers in the routable universe | **8** | measured by `deriveRouteUniverse` |

The five declared authorizations are `claude-cli`, `codex-cli`,
`antigravity-cli`, `vercel-ai-sdk:cerebras` and `vercel-ai-sdk:groq`. **No
commit in tracked history has ever authorized openrouter, cohere, mistral or
nvidia** (`git log -S` over `graph/` and `config/` returns nothing for any of
them).

`usf providers census` reports `credentialPresent: false` for both configured
routes unless `--env-file` is supplied. With the operator's file supplied both
report `true`. A census run without it under-reports the denominator, and
nothing in the output says so.

## 2. Model denominator

| population | count |
|---|---|
| catalogue model routes | 7 525 |
| catalogue underlying models | 3 829 |
| catalogue underlying families | 171 |
| catalogue models with known price | 7 091 |
| catalogue models with unknown price | 434 |
| catalogue zero-price models (census counter) | 10 |
| models declared per host transport (graph `selectedModel`) | **13** |
| configured API models | 2 |

The 13 graph-declared transport models are the only models Hermes may request
through a host CLI: claude-cli 3, codex-cli 4, antigravity-cli 6.

## 3. Routable provider:model population

Derived by calling `deriveRouteUniverse` with the real catalogue, the real
authorizations, the real credential names and all three transports
authenticated: **45 candidates across 8 providers.**

| provider | candidates | economic basis |
|---|---|---|
| openrouter | 19 | catalogue-declared-zero-price |
| groq | 14 | operator-declared-free-tier |
| claude-cli | 3 | operator-declared-subscription |
| codex-cli | 3 | operator-declared-subscription |
| antigravity-cli | 2 | operator-declared-subscription |
| cerebras | 2 | operator-declared-free-tier |
| cohere | 1 | catalogue-declared-zero-price |
| mistral | 1 | catalogue-declared-zero-price |

**21 of the 45 (47%) are admitted on `catalogue-declared-zero-price` and belong
to no authorized transport-provider pair.** See finding D1.

The reduction from 7 525 model routes to 45 is accounted for by: adapter not
installed (8 of 28 packages), cost class outside `acceptedCostClasses`, unknown
price (434 models, ineligible by policy), non-text output modality, and absent
credential. The census counter `catalogueZeroPriceModels: 10` does not
reconcile with the 21 candidates admitted on zero price; that discrepancy is
recorded and not explained here.

## 4. Qualified population by task class

**Zero.** The qualification store `.usf/qualifications/` holds exactly one
record: `cohere:north-mini-code-1-0`, task class `node-test`, role
`UNQUALIFIED`, expired `2026-09-04T05:48:53Z`. `observeQualifiedTaskClasses`
returns `recordCount=1, routesWithTaskClass=0`.

No provider:model holds a role for any task class. The qualified population is
empty for `cli-design`, `node-test`, `provider-routing` and `typescript` alike.

### The task taxonomy, and where it stops

Three different sets are in play and they do not agree:

| set | size | members |
|---|---|---|
| `modelCapability` values declared on work packets | **12** | typescript(29), node-test(27), provider-routing(10), rdf-semantics(9), cli-design(6), semantic-evaluation(2), process-lifecycle(2), vector-illustration(1), technical-writing(1), semantic-review(1), design-token-authoring(1), copywriting(1) |
| closed task-class set in `capabilities.ts` | **9** | the above minus vector-illustration, design-token-authoring, copywriting |
| task classes with suite cases and thresholds | **4** | cli-design, node-test, provider-routing, typescript |

So **five task classes declared on real work can never be earned**, because the
suite grades no case for them: `rdf-semantics` (9 work packets, including
`semantic-authority-path`, `semantic-first-eligibility`,
`integration-validation-set` and `architecture-conformance`),
`semantic-evaluation` (2), `process-lifecycle` (2), `semantic-review` (1),
`technical-writing` (1).

The three names outside the code's closed set belong only to
`urn:fixture:asset:*` subjects, so they are a fixture artefact rather than a
live defect — `capabilityKind` silently reclassifies them as model features,
which would refuse every candidate under `CAPABILITY_MISSING` if a real work
packet ever declared one.

## 5. Models tested successfully

Twenty routes probed live today with a bounded single-turn prompt.

| transport | reachable | routes |
|---|---|---|
| claude-cli | **3 of 3** | haiku-4-5, sonnet-5, fable-5 |
| codex-cli | **0 of 4** | all `TRANSPORT_USAGE_LIMIT_EXCEEDED` |
| antigravity-cli | **1 of 6** | only `gpt-oss-120b-medium`; five Gemini models usage-limited |
| vercel-ai-sdk | **7 of 7 attempted answered, 4 of 7 by credential** | groq ×2, openrouter ×4, cohere ×1 answered; cerebras, mistral, togetherai refused |

**11 of 20 probed routes answered.**

## 6. Models failing, with exact reasons

| route | reason | detail |
|---|---|---|
| codex-cli, all 4 models | `TRANSPORT_USAGE_LIMIT_EXCEEDED` | subscription window exhausted; refuses in 3–6 s |
| antigravity-cli, 5 Gemini models | `TRANSPORT_USAGE_LIMIT_EXCEEDED` | refuses in 8–14 s |
| cerebras:gpt-oss-120b | `PROVIDER_QUOTA_EXHAUSTED_PAYMENT_REQUIRED` | "Payment required to access this resource" — this is a **configured** route |
| mistral:labs-devstral-small-2512 | same | "Payment Required" — was 72.8% ok over 530 historical attempts |
| togetherai:openai/gpt-oss-120b | same | "Credit limit exceeded" |
| groq:qwen/qwen3.6-27b | invocation ok, **output unusable** | emits a raw `<think>` block into the answer; 2 693 chars of leaked reasoning; 0 of 4 benchmark tasks accepted |
| antigravity-cli:gpt-oss-120b-medium | invocation ok, **output structurally unusable** | see D2 |

A separate measurement artefact is recorded honestly: an initial probe capped
output at 64 tokens and three routes returned empty answers. Re-probed at 2 048
tokens **all** of them answered correctly. The first reading was wrong and the
corrected one is used throughout.

## 7. Benchmark workload and results

Four graded tasks built from real repository material, run against the six
economically authorized routes that were live. Nothing authoritative was
mutated: TypeScript answers were compiled and tested in a `mkdtemp` scratch
tree, N-Quads were parsed by the repository's own `parseStrictNQuads`.

- **T1 narrow code repair** — `src/core/scope.ts` with one planted defect (the
  `..` traversal segment rejection removed). Accepted iff the module's own real
  unit test passes.
- **T2 test failure diagnosis** — same defect, but the model sees only the
  failing test and must diagnose it. Same acceptance.
- **T3 semantic graph construction** — emit conforming N-Quads for one
  resource. Accepted iff `parseStrictNQuads` accepts it and the convention
  checks pass.
- **T4 large-context synthesis** — 45 930 characters of real dependency-rule
  quads; name the layers `operations` is forbidden to depend on. Accepted iff
  the set is exactly right.

| route | T1 | T2 | T3 | T4 | accepted |
|---|---|---|---|---|---|
| claude-cli:claude-haiku-4-5 | ✔ 31.7 s | ✔ 54.1 s | ✔ 15.9 s | ✔ 8.9 s | **4/4** |
| claude-cli:claude-sonnet-5 | ✔ 19.7 s | ✔ 31.1 s | ✔ 14.4 s | ✔ 7.9 s | **4/4** |
| claude-cli:claude-fable-5 | ✔ 17.0 s | ✔ 38.0 s | ✔ 12.9 s | ✔ 10.8 s | **4/4** |
| groq:openai/gpt-oss-120b | ✔ **2.2 s** | ✔ **4.9 s** | ✘ out-of-profile | ✘ prompt refused in 49 ms | **2/4** |
| antigravity-cli:gpt-oss-120b-medium | ✘ no artefact | ✘ no artefact | ✘ no artefact | ✔ 8.0 s | **1/4** |
| groq:qwen/qwen3.6-27b | ✘ does not load | ✘ failed | ✘ failed | ✘ failed | **0/4** |

**15 of 24 cells accepted.**

Two results deserve their own reading.

**Haiku matches Sonnet and Fable on every task.** There is no measured evidence
in this benchmark that the larger Claude models produce work Haiku does not.

**groq:openai/gpt-oss-120b is 8–14× faster than any Claude route on code
repair** — 2.2 s and 4.9 s against 17–54 s — at 797 and 2 101 output tokens,
and its answers pass the real test. On the 45 930-character prompt it refuses
in 49 ms.

### Determinism, measured rather than assumed

T3 was re-run repeatedly. `groq:openai/gpt-oss-120b` returned a
**byte-identical answer on 4 of 4 consecutive samples** at temperature 0, and
5 of 7 samples overall were refused by USF. `claude-cli:haiku` conformed on 2 of
3. The single-sample T3 column above therefore overstates reliability for both:
this class of work needs retries, and USF's admission gate is what catches the
failures.

The dominant refusal cause is worth naming exactly, because it is **not a model
defect**. The refused answers emit
`"3600"^^<http://www.w3.org/2001/XMLSchema#integer>` — a typed literal, which
is valid RDF 1.1 N-Quads. USF's `bootstrap-nquads-v1` profile is deliberately
narrower and admits only plain IRI/literal quads. The prompt never said so. A
model that knows RDF will produce out-of-profile output and be refused, and the
fix is in the prompt surface, not the model.

## 8. Accepted-work rate by provider:model

From the live route store `.usf/hermes/route-deferrals.json`, which records
downstream admission verdicts — the only measure of *useful* work.

Totals: 408 attempts, 209 invocation successes, **1 001 outputs accepted, 106
refused, 13 076 731 output tokens = 13 063 tokens per accepted unit.**

| route | attempts | invocation ok | accepted | refused | tokens/accepted |
|---|---|---|---|---|---|
| openrouter:minimax/minimax-m3:free | 158 | 155 | **897** | 65 | 11 246 |
| codex-cli:gpt-5.3-codex-spark | 8 | 5 | 25 | 3 | 25 751 |
| openrouter:dots-3-note-preview | 14 | 7 | 18 | 3 | 7 258 |
| cohere:north-mini-code-1-0 | 33 | 1 | 15 | 1 | 23 698 |
| claude-cli:claude-haiku-4-5 | 31 | 15 | 13 | 9 | 31 181 |
| openrouter:poolside/laguna-xs-2.1:free | 5 | 1 | 13 | 4 | 32 078 |
| claude-cli:claude-fable-5 | 12 | 0 | 7 | 1 | 27 775 |
| claude-cli:claude-sonnet-5 | 12 | 0 | 2 | 2 | 42 955 |
| **antigravity-cli:gpt-oss-120b-medium** | **20** | **20 (100%)** | **0** | **13** | **606 619 spent, none kept** |

Across the wider 308-cycle execution history (2 026-09-01 → 09-02): 2 055 work
units, 95.3% unit success, mean 2.13 attempts per unit, median 75 candidates
considered per unit, 4 383 attempts over 10 providers.

## 9. Latency, token and attempt characteristics

Identical 10-character answer, same prompt, measured today:

| route | latency | output tokens | of which reasoning |
|---|---|---|---|
| groq:qwen/qwen3.6-27b | 1 240 ms | 603 | leaked into the answer text |
| openrouter:minimax/minimax-m3:free | 6 609 ms | **2** | 0 |
| groq:openai/gpt-oss-120b | 588 ms | 137 | 127 |
| cohere:north-mini-code-1-0 | 6 081 ms | 159 | 0 |
| openrouter:dots-3-note-preview:free | 6 053 ms | 542 | 661 (reports `textTokens: -119`) |
| openrouter:liquid/lfm-2.5-2.6b:free | 4 147 ms | 589 | 585 |
| openrouter:poolside/laguna-xs-2.1:free | 7 786 ms | 855 | 853 |

**A 400× spread in output tokens for the same useful answer.** One provider
reports a negative token count.

No host CLI transport returned usage or cost figures on any invocation
(`usage: null`, `costUsd: null` for all 13 host probes), so per-invocation token
accounting exists only for API routes.

## 10. Current routing behaviour

`hermes implement` writes a work graph and dispatches through
`graphExecuteCommand`. That command derives the candidate universe, applies the
economics gate, drops currently deferred routes to the back, orders candidates
by measured productivity and interleaves providers round-robin in bursts of 4.

`routeRank` is already evidence-driven and already correct: it ranks on
admission rate first, then tokens per accepted unit ascending, then latency, and
falls back to transport success only when no admission verdict exists. Its own
comment records the antigravity case — "one such route absorbed 86 percent of a
session's tokens with zero admissions while its perfect transport record kept it
at the top of its provider". **That defect is fixed.** The comparator directions
were checked and are right.

## 11. Underused qualified capacity

None, in the strict sense: the qualified population is empty, so no qualified
route is being starved.

Underused *capable* capacity is real:

- **`groq:openai/gpt-oss-120b`** scores 2/4 on the benchmark including both code
  repair tasks, at 2–5 s and under 2 101 output tokens. Its live history is 6
  attempts, 0 successes, 0 acceptances. It is authorized, free-tier, fast and
  effectively unused.
- **`claude-cli:claude-haiku-4-5`** scores 4/4 and holds 13 acceptances against
  31 attempts. It is the only route measured to complete every task class tried.

## 12. Incorrectly trusted capacity

1. **`antigravity-cli:gpt-oss-120b-medium`** — 20 of 20 invocations succeed,
   0 of 13 outputs accepted, 606 619 output tokens spent. Cause found (D2).
2. **`groq:qwen/qwen3.6-27b`** — a *configured* route in `providers.json`,
   0/4 on the benchmark, leaks chain-of-thought into the answer body.
3. **`cerebras:gpt-oss-120b`** — the other configured route; payment-exhausted.
   Both configured API routes are currently useless.
4. **21 of 45 routable candidates** trusted on catalogue price alone (D1).
5. **The census's own verdict fields.** `qualification: "UNQUALIFIED"`,
   `allocation: "excluded"` and the reasons `ACCOUNT_RECEIPT_MISSING`,
   `AUTHENTICATED_ANSWER_MISSING`, `HIDDEN_HOLDOUT_MISSING` are **unconditional
   string literals** in `src/commands/providers.ts` (lines 466–469, 537,
   551–553). They are computed from nothing. No census row can ever report a
   qualified route, and `AMBIGUOUS_IDENTITY` is emitted for every *installed*
   host transport purely for being installed.

## 13. Incorrectly excluded capacity

- **`ACCOUNT_RECEIPT_MISSING` as a qualification bar** contradicts the graph.
  `urn:usf:requirement:qualification-carries-no-commercial-claim` states plainly:
  "the qualification requirement never asked for quota or cost, and the
  evaluator demanded them anyway." The graph retired that coupling; the census
  code still asserts it, and `usf probe availability` still refuses all contact
  "until a registered trusted account-tier receipt exists". The entire
  qualification lane is therefore unreachable by design, which is why the store
  holds one expired `UNQUALIFIED` record.
- **The five unqualifiable task classes** in §4, `rdf-semantics` most of all.
- **`claude-cli:claude-sonnet-5` and `claude-fable-5`** carry 0 recorded
  invocation successes against 12 attempts each in the live store, yet both
  scored 4/4 today. Their history is stale relative to observed behaviour.

## 14. Concurrency constraints

Measured across 170 cycles that recorded utilisation:

- `peakObserved` reached `target` in **170 of 170 cycles**. Concurrency is never
  provider- or account-limited in the record.
- target: median 5, max 8 — matching the graph's declared
  `defaultConcurrency "5"`, so the derivation reads authority correctly.
- parallel utilisation: min 0.414, median 0.700, mean 0.718, max 1.000.
  **24 of 170 cycles (14%) fell below the declared 0.60 floor.**
- peak reached 8 in only 10 cycles.

The binding constraint is **ready independent work**, not providers, accounts,
host resources or policy. The graph's own non-claim anticipates this: "a target
derived from ready independent work legitimately sits below the default when
less work is ready." Raising concurrency would not help.

## 15. Provider-loss resilience

Observational only — no configuration was changed. Candidates recomputed with
each provider removed from the runtime:

| scenario | candidates | providers remaining |
|---|---|---|
| baseline | 45 | 8 |
| lose claude-cli | 42 | 7 |
| lose codex-cli | 42 | 7 |
| lose antigravity-cli | 43 | 7 |
| lose cerebras | 43 | 7 |
| lose groq | 31 | 7 |
| lose every API provider (authorized ones) | 29 | 6 |
| lose every CLI transport | 37 | 5 |

By candidate count Hermes is well diversified and no single loss is fatal.
**By capability it is not.** Semantic graph construction (T3) was passed only by
claude-cli routes: both non-Claude producers emitted out-of-profile N-Quads.
Losing claude-cli would leave `rdf-semantics`-shaped work — 9 work packets —
with no measured producer. That is the one true single-provider dependency
found, and it is invisible in the candidate counts.

## 16. Qualification-system adversarial results

Thirteen properties planted against the real functions in an isolated root.
**13 of 13 hold.**

- a catalogue feature (`reasoning`, `structured-output`, `tool-call`) can never
  classify as a task class
- a requirement splits by vocabulary and never merges
- a catalogue feature present does not satisfy a same-named task class
- missing qualification fails closed
- a held task class satisfies only itself
- qualification binds to the exact `provider:model` pair
- the same underlying model on another provider earns nothing
  (`groq:openai/gpt-oss-120b` qualified ⇏ `cerebras:gpt-oss-120b`)
- a sibling model on the same provider earns nothing
- an expired record grants nothing (counted as expired, not honoured)
- an `UNQUALIFIED` role grants nothing
- a `failed` status grants nothing
- a record naming a model feature as its task class grants nothing
- exactly one of five planted records was admitted

**The qualification model is sound. It is simply never consulted.**
`graph-execute.ts` — the only path `hermes implement` dispatches through —
contains no reference to `observeQualifiedTaskClasses` or
`qualifiedTaskClassesByRoute`. Only `usf execute` and `usf status` pass them.
Even if a route earned a task class tomorrow, Hermes would not see it.

Separately, 2 043 of 2 055 recorded work units carried an **empty**
`requiredCapabilities`, so the model-feature gate almost never fires either.
Nine units required `reasoning`; three required a planted `quantum-telepathy`
and were correctly refused.

On freshness: the policy sets `validitySeconds: 900`. A qualification expires
**fifteen minutes** after it is earned. Combined with a suite whose four
`exact`-string graders include "group by operator intent" and "smallest
graph-authorized change", and thresholds requiring a minimum of 1 in every one
of four dimensions, this is why no qualification has ever been held.

## 17. Recommended changes, ranked by benefit against risk

Only where repeated evidence supports them. Every recommendation prefers a
semantic or policy change over a hard-coded model name.

**D1 — separate authorization from spend permission, and stop inferring either
from catalogue price.** *Semantic defect. Highest benefit, low risk.* 21 of 45
candidates are currently admitted on the catalogue's own price claim, which the
economics file's own non-claim forbids: "Absence of an authorization for a
transport and provider pair makes that pair economically ineligible; eligibility
is never inferred" and "Catalogue list prices … are not evidence that an
authorized execution incurs cost." A catalogue refresh can silently add routes
today.

The repair is **not** to exclude the three providers currently entering that
way. The operator has since declared the intended economic state, recorded in
§21 below: openrouter, cohere and mistral are all authorized. They were simply
never declared, and Hermes was inferring their permission from price instead of
reading it.

Two axes are being conflated and must be modelled separately:

| axis | question | today |
|---|---|---|
| authorization | may Hermes use this provider account at all? | inferred from price for 21 candidates |
| spend permission | which cost classes may that authorized account use? | one global `acceptedCostClasses` list |

`zero-price` becomes a **cost property** of a model, never an admission
mechanism. Permission becomes per-authorization: an authorized prepaid account
may be restricted to zero-price routes, and an authorized trial account may be
authorized without Hermes being entitled to walk silently onto paid usage when
the trial ends. Both are statements the current model cannot make, because
`acceptedCostClasses` is global and an authorization carries no cost scope.

**D2 — stop invoking `agy` in `--mode plan`.** *Provider/runtime defect. High
benefit, low risk, one flag.* `invokeAntigravityCli` passes
`--print … --sandbox --mode plan`. Captured output: *"The implementation plan
has been created as an artifact … Please review the plan and let me know if you
approve it."* The route cannot emit a generation artefact at all. This fully
explains 20/20 invocation success with 0/13 acceptance and 606 619 wasted
tokens, and it explains why the same route passed T4 (a short factual answer
needs no plan). The transport is not incapable; it is invoked in the wrong mode.

**D3 — pass `qualifiedTaskClassesByRoute` into `graph-execute`.** *Routing
defect. High benefit, low risk.* One argument, already computed by
`observeQualifiedTaskClasses` and already accepted by `deriveRouteUniverse`.
Until it is passed, every property proved in §16 protects a gate Hermes does not
use. Do this **before** D5, so qualifications have somewhere to bind.

**D4 — state the `bootstrap-nquads-v1` profile in the prompt for
`rdf-semantics` work.** *Semantic gap. High benefit, no risk.* Models emit valid
RDF 1.1 typed literals that USF's narrow parser refuses. This is the dominant
refusal for graph construction and it is a prompt defect, not a model defect.
Adding "plain literals only; no datatype IRIs, no language tags" is expected to
convert most refusals into acceptances.

**D5 — decouple qualification from the account-tier receipt, and raise
`validitySeconds`.** *Qualification defect. High benefit, medium risk.* The
graph already requires this decoupling and names the entanglement as an
implementation accident. Fifteen-minute validity is not a modelled drift
property; it is a number. Establish what actually drifts — provider-side model
substitution behind a stable name is the real risk, and today's
`claude-sonnet-5` request returning `actualModel: "claude-haiku-4-5+claude-sonnet-5"`
shows it is not hypothetical — then set the lifetime from that, not from habit.

**D6 — make the census verdicts computed.** *Reporting defect. Medium benefit,
low risk.* Remove the unconditional literals in `src/commands/providers.ts` and
derive `qualification`/`allocation` from the same observers routing uses.

**D7 — route narrow code repair to `groq:openai/gpt-oss-120b` first, Claude on
escalation.** *Performance optimisation. Medium benefit, medium risk.* Supported
by T1/T2: correct, test-passing repairs in 2.2 s and 4.9 s against 17–54 s. This
needs no code change if D3 lands and the route earns `typescript` — the existing
`routeRank` will promote it on measured acceptance. **Recommended as a
qualification outcome, not as a hard-coded preference.**

**D8 — declare suite cases for `rdf-semantics` at minimum.** *Semantic gap.
Medium benefit, medium effort.* Nine real work packets declare a task class the
suite cannot grade. The T3 grader built for this evaluation — parse under
`parseStrictNQuads` plus convention checks — is a working starting point.

## 18. Changes that should explicitly NOT be made

- **Do not raise concurrency.** Peak reached target in 170 of 170 cycles. The
  constraint is ready work.
- **Do not change `routeRank`.** It already ranks admission over invocation
  success and its comparator directions are correct.
- **Do not demote `claude-sonnet-5` or `claude-fable-5` on their 0-success
  history.** Both scored 4/4 today; the recorded history is stale, and the
  stale-history repair is D3/D5, not a demotion.
- **Do not promote Haiku over Sonnet on this evidence.** Haiku matched Sonnet on
  4 of 4 tasks — that is a tie on one sample each, not a demonstrated advantage.
- **Do not delete `groq:qwen/qwen3.6-27b` from `providers.json` yet.** It fails
  by leaking reasoning into the answer body, which is a parsing/prompting
  question first. Establish that before retiring a configured route.
- **Do not add an expiry model merely because 900 seconds looks short.** Show
  the drift first.
- **Do not build a second qualification or capability model.** The existing one
  passes all 13 adversarial properties.

## 19. Semantic gaps discovered

1. **Catalogue price grants economic eligibility** despite the corpus stating it
   must not, and **authorization carries no spend scope**: `acceptedCostClasses`
   is global, so the model cannot say "this account is authorized, for zero-price
   routes only" or "authorized on a trial that must not roll onto paid" (D1).
2. **The capability→task-class mapping has no producer.** `RoutingWork.semanticRequirements`
   is documented as "Graph-defined mapping; routing never infers qualification
   task classes from capability labels", and no production code path builds it —
   it appears only in tests. `usf route` takes it from the caller.
3. **Five declared task classes have no suite case**, so they are unqualifiable
   by construction.
4. **Qualification lifetime is a number, not a modelled property.**
5. **Composite model identity.** `claude-cli` returned
   `actualModel: "claude-haiku-4-5-20251001+claude-sonnet-5"` and
   `"claude-fable-5+claude-haiku-4-5-20251001"`. `qualification-scope-is-exact-route`
   requires one exact pair; a concatenated, order-varying identity cannot bind
   one, and nothing in the corpus models a composite answering identity.
6. **Two disjoint provider regimes.** `usf providers`/`usf probe` require an
   account-tier receipt and admit nothing; `usf execute`/`graph execute`/`hermes`
   use V3 economics and produced 2 055 work units. Both are current; they
   disagree about every route.

## 20. Repository and test status

Working tree clean at `329ad58`. No routing policy, qualification threshold,
provider configuration or semantic authority was changed. The evaluation harness
lived under ignored `.usf/tmp/` and has been removed; the only durable artefact
is this document. Benchmark answers were compiled and tested in `mkdtemp`
scratch trees and discarded. The live route store is unchanged at 64 recorded
routes. No stray processes remain.

Provider contact performed: 13 host CLI probes, 7 API reachability probes,
24 benchmark invocations, 10 determinism samples, 2 failure captures — all under
the operator's declared zero-marginal-cost authorizations, except the openrouter,
cohere and mistral probes, which are free-tier models admitted by the
catalogue-price hole D1 identifies and which incurred no charge.

## 21. Operator-declared intended economic state

Supplied by the operator after the measurement above, and recorded here as the
input D1 is repaired against rather than as something this evaluation observed.

| provider | authorized | account basis | intended spend permission |
|---|---|---|---|
| claude-cli | yes | subscription | subscription-included |
| codex-cli | yes | subscription | subscription-included |
| antigravity-cli | yes | subscription | subscription-included |
| openrouter | yes | prepaid | free-model routes only unless separately permitted |
| cerebras | yes | trial/free | free-quota; no silent transition to paid |
| groq | yes | trial/free | free-quota; no silent transition to paid |
| cohere | yes | trial/free | free-quota; no silent transition to paid |
| mistral | yes | trial/free | free-quota; no silent transition to paid |

This does not weaken the finding. Every one of these was already reachable, and
three of them were reachable **without being declared** — the authorization was
correct in the operator's head and absent from the graph, which is precisely the
condition under which a catalogue refresh changes what Hermes may do.

---

# Programme: provider-routing assurance

Landed 2026-09-04 after the evaluation above, at the operator's direction, as one
bounded programme with a separate proof per defect. Model ranking was
deliberately not tuned: Haiku, Groq and the rest earn routing position through
the qualification mechanism this programme connected, not through a manual
preference.

## What landed

| defect | repair | proof |
|---|---|---|
| **D1** authorization inferred from price | authorization and spend permission separated; all eight accounts declared | `v3-classification.test.ts` — a three-way separation, plus fail-closed cases in `economics-projection.test.ts` and `economics.test.ts` |
| **D2** antigravity in plan mode | worker turn pins `accept-edits`; argv extracted so it is assertable | `provider-capability-universe.test.ts` — mode pinned, `plan` absent, exactly one `--mode` |
| **D3** qualification never consulted | passed into `graph execute`; the input made **required** | `provider-capability-universe.test.ts` — a task class constrains the universe, and wrong-class and wrong-model earn nothing |

**D4 was withdrawn, not deferred.** Its premise is false. Hermes's entire
dispatch surface is three prompt shapes — `deriveImplementationPrompt` and
`deriveConformancePrompt` (TypeScript) and `deriveSemanticPrompt` (Markdown,
JSON, YAML or plain text) — and none of them asks a model for N-Quads. No
delivery artefact carries a `.nq` canonical path. The typed-literal refusal the
evaluation measured came from a task *this evaluation* wrote, not from anything
Hermes dispatches, so "put the profile in the prompt" had no site. The related
fence-and-preamble defect the recorded admission failures show (three TS1434
errors at line 1, column 1) was already fixed: `implementation-work.ts` extracts
a fenced block wherever it sits, and its comment records the same lesson.

The real finding in D4's place is larger and is not repaired here: **`rdf-semantics`
is declared on nine work packets, is unqualifiable because the suite grades no
case for it, and is never dispatched.** All three facts say the same thing —
semantic-graph work is done by the operator, not by Hermes.

## D1, as landed

Two axes where there was one:

| axis | predicate | declared for |
|---|---|---|
| may Hermes use this account at all? | one authorization per transport-provider pair | all 8 accounts |
| what may that account be used for? | `permittedCostClass` | per authorization |
| may it reach anything chargeable? | `paidSpendPermitted` | all 8, false |
| what kind of account is it? | `accountBasis` | subscription, prepaid, trial |

`zero-price` is now a property of a model and admits nothing. The measured
effect, before and after, on the same catalogue and credentials:

| | before | after |
|---|---|---|
| routable candidates | 45 | **81** |
| admitted on catalogue price alone | **21** | **0** |
| providers with no declaration | 3 | 0 |
| groq candidates | 14 | **10** |

Groq narrows because four of its models have no known price at all, and an
unknown price may be a paid one. OpenRouter, Cohere and Mistral are re-admitted
*by declaration* — they were refused entirely by the intermediate commit, which
is the fail-closed direction working in both directions.

### The migration was two-sided, and that shaped the sequence

Committing the graph authority alone left the tracked projector refusing the
tracked projection — verified, not assumed: `ECONOMICS_PROJECTION_DIVERGED`. The
graph, the derived projection and the reader are one coupled unit, and the staged
chain moves code while `usf transact` moves graph and config, necessarily in
different commits.

So the reader landed first, accepting the retired shape under a documented
transitional default, which is the aliasing route `naming.md` §4 prescribes and
the same one the `coreDependencySeed` rename used: there is no commit in this
sequence where the reader and the graph disagree. A half-declared axis is an
error rather than a legacy shape and is refused; only an authorization carrying
none of the three is read as retired. The default is removable in one change to
`retiredShapePermittedClasses` once no graph omits the axis.

One claim about that default was written and then corrected rather than left:
it does **not** reproduce the retired reach exactly. The retired reading admitted
four unknown-price groq models; the spend flag now refuses them. The narrowing is
intentional, so it is stated.

## D3, as landed

`graph execute` now reads `observeQualifiedTaskClasses` once per run and passes
it into the universe. More importantly the input was made **required**, and the
compiler immediately found a second production caller with the same defect:
`usf probe availability` had also never passed it, so the availability preflight
reported a universe that ignored qualification entirely. Two of three production
callers were wrong; the omission is no longer expressible.

**The gate is now real and currently binds nothing**, which is worth stating
plainly. `hermes implement` and `hermes realise` both set
`requiredCapabilities: []` explicitly, so no unit Hermes dispatches today asks
for a task class, and D3 cannot stall dispatch. It binds the moment a supplied
work graph declares `requiredCapability`, or the moment `modelCapability` is
propagated into dispatched units — which is a separate decision and is not made
here.

## Cost, priced before the change rather than discovered after it

Editing the economics evaluator, the classification ladder, the capability
vocabulary and the route universe moves the scoped dependency digest of every
work that reads them. Measured before the first edit: three of the four affected
works were already blocked, and exactly one was verified-complete —
`provider-task-qualification`. It went to blocked as predicted and was restored
through its own chain. `semantic-authority-path`, `architecture-conformance`,
`repository-path-scope` and `file-asset-index` are untouched and still
verified-complete.

One closure defect surfaced and is recorded because its diagnosis is reusable:
widening the adversarial validation's imports pulled `src/core/canonical.ts` and
`src/graph/nquads.ts` into its runtime closure, and the confined check failed
with an opaque `CHECK_FAILED`. Deriving the closure from the primary *preimage*
returned two members and missed both, because the preimage test file does not
carry the imports that widened it. Derived from the postimage it returned
thirteen, named the two exactly, and the same immutable candidate was rechecked
rather than rematerialised.

## Chain and identity

`transact` (ownership) → construction evidence → proof → twice-verified publish →
`call` → `resolve` → `apply` → `check` → `integrate --dry-run` → `integrate` →
`transact` (economics, atomic with its projection) → restore the stale lane →
second grant → `realise no-change` → `check` → completion evidence → proof →
twice-verified publish.

Eight commits from `5e48582` to `0ceb6db`. Both affected works
**verified-complete**. 566/566 tests, integrity gate conforming with zero owned
violations, containment pass, working tree clean.

## Still open, unchanged by this programme

- **D5** qualification is decoupled from the account receipt in the graph and
  still coupled in `src/commands/providers.ts`; `validitySeconds` is still 900,
  and the suite's four `exact`-string graders are still why nothing has ever
  qualified. Until D5 lands, D3's gate has nothing to admit.
- **D6** the census verdicts are still unconditional literals.
- **D7** narrow code repair should reach `groq:openai/gpt-oss-120b` first — as a
  qualification outcome once D5 lands, never as a hard-coded preference.
- **D8** `rdf-semantics` has no suite case, and no dispatch path either.
- `src/commands/classify.ts` still builds a classification input without
  qualification, so its report differs from routing. Same family as D6; it was
  left out rather than widening this programme's write set.
