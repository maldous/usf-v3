# Decision 0005: provider qualification and parallel execution boundary

## Status

Accepted as the V3 design boundary for provider discovery and qualification.

## Decision

- Reimplement the provider path in TypeScript/Node using the two currently
  frozen maintained direct AI SDK adapters: `@ai-sdk/groq` and
  `@ai-sdk/cerebras`. Additional providers or gateways require separate
  graph-defined work and cannot enter the active denominator by documentation
  alone.
- Use models.dev only as a frozen, digest-bound catalogue source. Its fixed
  `/api.json` output describes model and
  serving metadata; they do not prove credentials, live health, quota, account
  tier, or zero cost.
- Separate mechanical availability/economics qualification from semantic task
  qualification. A route is mechanically eligible only when its declared
  adapter, credential source, model, capability, privacy posture, explicit
  service tier, observed identity, quota and cost policy all pass. A successful
  call does not establish semantic usefulness or accepted ANQR lineage.
- Bind semantic qualification to one exact, versioned agent-profile tuple:
  provider, requested and actual model, adapter version and lock digest, auth
  mode, and the content digests of its tool, prompt, context and output
  configurations. Version labels alone are insufficient. The suite, corpus,
  qualification policy, effective zero-paid/privacy policy, provider
  configuration, route, catalogue pair, probe and answer set are separate
  exact inputs. Missing answers score zero and the default is `UNQUALIFIED`.
- Require explicit service-tier pins for probes and calls: Groq `on_demand` and
  Cerebras `default`. `auto`, flex, paid, subscription, unknown-price, and
  gateway fallback routes are refused by the zero-paid-cost lane.
- Preserve provider-specific concurrency caps and run independent assignments
  in parallel. The probe records requested route separately from the observed
  provider/model, normalized usage when reported, a quota classification, and
  elapsed time. Future live call/metrics work must add raw usage, cache status,
  and accepted lineage before making useful-token claims. Missing values remain
  unknown, never zero.
- Make probes explicit and bounded: no implicit fallback, no retries by
  default, short timeout, no request/response persistence, redacted errors, and
  no secret or prompt output. A direct response may expose documented quota
  headers, but those headers are not billing-tier or semantic-qualification
  proof.
- Keep roster selection, semantic admission, CAS, signatures, and GitHub
  transport outside this qualification boundary. Provider output grants no
  semantic, mutation, evidence, proof, commit, or publication authority.
- Keep USF core and product semantics separately versioned. Routing constructs
  distinct core-to-product and product-to-core digests plus a composite digest;
  the two directions expose which dependency moved without turning GitHub or a
  whole-graph revision into a reproof gate. Product non-applicability is an
  explicit value, not an omitted or inherited product profile.

## Evidence and nonclaims

Groq documents rate-limit response headers and Free-plan model limits at
`https://console.groq.com/docs/rate-limits`. Cerebras documents Free-plan
limits and quota headers at
`https://inference-docs.cerebras.ai/support/rate-limits` and pricing at
`https://inference-docs.cerebras.ai/support/pricing`. Neither provider
documents an authenticated read-only API that proves billing tier before an
inference. Therefore account tier and zero cost remain unknown unless an
approved independent account evidence source establishes them. Quota headers
are observations, not billing classification.

This decision does not claim live provider access, two-family live proof,
continuous execution, useful-token achievement, full ANQR, staging,
production, terminal proof, or an account-level guarantee against billing.
Content-bound evidence digests bind operator-supplied fact content for
deterministic replay but are not provider signatures or proof that an account
observation is authentic.
The current local semantic evaluator scores supplied answer records; it does
not itself contact a provider or authenticate how those answers were produced.
Its tracked fixture corpus exposes grader definitions, including cases marked
for future holdout invocation. That flag is an execution instruction, not a
claim that the tracked bytes are confidential or equivalent to V2's hidden
holdout lane. A live acquisition command must withhold graders and repository
access from the evaluated model and bind the resulting answers before any live
V2-style qualification claim.

The registered `probe availability` command is intentionally hard-disabled at
the account-tier boundary. Operator-supplied economics records can exercise
binding/refusal logic but cannot unlock provider contact. A later graph-defined
receipt acquisition path must independently bind the exact account/organization,
credential reference, route/model, billing controls, quota, observation time,
expiry, acquisition mechanism/version, raw source digest, and economics digest.

Before live contact is enabled, provider/AI SDK execution must move to a
scrubbed child boundary receiving only the selected credential and bounded
public request. The current package/version/pnpm-integrity observation does not
hash installed adapter or transitive bytes; live work therefore also requires a
clean or content-verified installation check.

`usf route` obtains the suite and policy from unchanged indexed
`config/qualification.json`, separately from its replay input, and recomputes
the exact semantic result. This prevents a route envelope from self-authoring
its own suite/policy or rehashing forged scores and roles. Supplied answer
records remain fixture/replay inputs, not authenticated provider answers.

## Consequences

The command boundary is deterministic and reusable: `usf doctor` reports local
adapter and credential readiness; `usf models summary|list|refresh` freezes and
reads catalogue facts; `usf probe availability` performs bounded local preflight
and then fails closed pending trusted account-tier receipt acquisition; `usf
probe semantic` evaluates one stored, exact profile-bound answer set locally;
`usf route` performs pure eligibility matching against separate indexed
suite/policy authority; and `usf call` executes only explicit assignments.
Metrics consume the resulting bounded records rather than rediscovering state
through ad-hoc shell commands. Tests use fixtures and injected transports by
default. No registered live provider path exists in this slice; a future live
evidence lane must be explicit and can never enter the default gate.
