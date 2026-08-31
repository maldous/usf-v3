# 0005: Subscription host transports

Status: accepted by explicit operator direction on 2026-08-31.

## Decision

Codex CLI authenticated with ChatGPT and Claude Code authenticated with
`claude.ai` are first-class subscription host transports. They are not the
OpenAI or Anthropic metered API routes, and no API SDK fallback may satisfy a
host invocation.

The accepted run cost class is `subscription-zero-marginal`: the subscription
is already held and disclosed, while the run consumes no incremental paid API
budget. A generic subscription or ambiguous authentication mode is not
eligible. Host status must positively identify the subscription control plane;
API keys, alternate clouds, gateways, base-URL overrides and fallback models
must be absent from the child.

Models.dev remains the complete provider/model catalogue denominator and its
provider `npm` field remains the Vercel AI SDK adapter identity for direct API
routes. The host census is joined to that denominator without treating the AI
SDK package, Vercel AI Gateway, an executable, or a catalogue row as current
host availability. Codex models are discovered through the current app-server
`model/list` surface. Claude candidates are the union of the frozen
models.dev Anthropic catalogue and the exact aliases exposed by the installed
CLI; where Claude exposes no exhaustive entitlement-specific list, every
candidate is retained with an explicit unknown or observed disposition rather
than inventing completeness.

Both host adapters implement the same typed answer port as direct AI SDK
adapters. They converge only after exact requested/actual identity, raw output
digest, usage/cache telemetry, subscription authentication, containment and
run authorization have been verified. Qualification remains model-local.

## Operational shape

`usf providers host census` is non-inference and reports authentication,
versions, the joined model denominator and explicit dispositions. `qualify`,
`run` and `compare` require the exact versioned profile, current graph-derived
authorization and public workload input. They launch children concurrently,
disable fallback and custom tools/configuration, retain bounded sanitized
output only, and write operational receipts below ignored `.usf/` state.

The first live slice proves only two authenticated provider families, positive
execution overlap, genuine hidden semantic qualification and measured input
token reduction on equivalent accepted work. It is not the full ANQR,
continuous 100k-useful-token, staging, production or terminal acceptance proof.
