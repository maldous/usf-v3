# Provider, model, capability, qualification and authentication assurance

Measured 2026-09-04. Read-only throughout except the catalogue refresh, which
makes explicit external contact and writes only ignored snapshots.

## Summary

| surface | state |
|---|---|
| models | **refreshed today**, 12:07 |
| capabilities | **current**, derived from that refresh |
| providers | catalogue current; **2 of 213 routes configured** |
| authentications | **zero API credentials present**; **three** session transports usable |
| semantic qualification | **none held**; suite and policy current and tracked |
| provider contact | **proofblocked**, independently of all the above |

## 1. Models — refreshed

`usf models refresh`, digest `sha256:a83d8764…`, replacing a snapshot four days
stale.

| | before | after |
|---|--:|--:|
| provider routes | 211 | **213** |
| model routes | 7 488 | **7 525** |
| underlying models | 3 834 | 3 829 |
| unknown underlying families | 667 | **652** |

Two providers appeared, `sensenova` and NaN — the latter a real provider at
`api.nan.builders`, not the serialisation defect its name suggests — and 73
models. Adapter packages 28, of which 8 installed. Catalogue credential names
210. Zero-price routes 10, all Chinese coding-plan gateways plus Kilo.

**Why it needed a person to ask:** nothing measures catalogue age. The snapshot
records digests and no timestamp; `usf doctor` reports availability and digests
without a freeze time. A four-day-old snapshot and a four-month-old one are
indistinguishable in every projection. Recorded as a readiness projection for
the packet that owns `doctor`.

## 2. Capabilities — current, and bounded by what a catalogue can know

Derived from the refreshed snapshot: 4 392 model routes with reasoning against
an installed adapter, 4 190 with attachment, 5 683 with temperature control.

The catalogue states its own limits and they matter more than the counts:

```
routeAvailability : not-observed
entitlement       : not-observed
quota             : not-observed
health            : not-observed
credentialData    : names-only-from-public-catalogue
```

with the non-claims `adapter-installation-is-not-working-authentication`,
`catalogue-membership-is-not-current-route-availability`,
`catalogue-models-are-not-a-configured-provider-roster` and
`zero-catalogue-price-is-not-zero-paid-cost-proof`.

So capability facts are **fresh and are not availability**. Nothing here says a
route would answer.

## 3. Providers — the catalogue is current, the roster is deliberately narrow

213 catalogued routes. **Two configured**, in `config/providers.json`:
`cerebras-gpt-oss-120b` and `groq-qwen3.6-27b`, both `free-quota`, both with
`paidFallback: false`, concurrency 2, probe freshness 900 s.

Plus 7 legacy provider observations and 3 observed host transports. 221
candidate credential names, 5 with presence actually checked, 24 reviewed
legacy credential names.

Two of 213 is not staleness. It is a roster the operator chose, and widening it
is an operator decision rather than a refresh.

## 4. Authentications — zero API credentials, two usable session transports

```
CEREBRAS_API_KEY  present: false
GROQ_API_KEY      present: false
```

Both configured routes are therefore unauthenticated. No credential value is
read or exposed by any of this; presence is all that is observed.

The session-authenticated transports are the only ones that could answer, and
they are declared with what they refuse:

| transport | executable | authentication | present |
|---|---|---|---|
| `claude-cli-subscription:1` | `claude` | claude.ai first-party subscription | **yes**, 2.1.251 |
| `codex-cli-subscription:1` | `codex` | ChatGPT subscription | **yes**, codex-cli 0.152.0 |
| Antigravity | `agy` | Google Antigravity subscription | **yes**, 1.1.24 |

Each declares its refusals: the Claude transport refuses `ANTHROPIC_API_KEY`,
auth tokens, Console, Bedrock, Vertex, Foundry, gateways, base URLs, bare mode
and fallback models; the Codex transport refuses `OPENAI_API_KEY`, API-key
login, custom providers, remote hosts and fallback models. Those refusals are
the point: a subscription transport that could fall back to a paid API would
make the zero-paid ceiling unenforceable.

### The Antigravity transport is present, and authority cannot tell

**Three transports are usable, not two.** The Antigravity CLI is `agy` at
`agy` on the operator's PATH, version 1.1.24, and it is a genuine
non-interactive transport: `--print` with `--output-format text|json|stream-json`,
`--input-format stream-json` reading NDJSON per line, `--json-schema` to enforce
structured output, `--model` selection and a `--print-timeout`. No login,
API-key or token flag appears in its interface, which is consistent with the
session authentication its economic authorisation assumes.

`graph/v3-execution.nq` carries that authorisation for `antigravity-cli` on the
basis `operator-declared-subscription` with entitlement
`subscription-included`, and `config/execution-economics.json` declares the
transport.

**What is genuinely missing is the executable name in authority.** Unlike
`claude-cli-subscription:1` and `codex-cli-subscription:1`, which each declare
`executableName`, the Antigravity execution transport declares none. So nothing
in the graph says what to invoke, and nothing can check that what is installed
is the right thing.

That gap is not theoretical, and this record is the demonstration. Searching for
the executable by the transport's own name found `/usr/local/bin/antigravity` →
`/opt/antigravity/antigravity`, an **Electron desktop application** that opens a
DevTools listener and an IDE wizard when invoked. An earlier revision of this
document concluded from that binary that the transport was unusable. It was
wrong: the desktop app and the CLI are different programs with unrelated names,
and only an operator saying "`agy`" resolved it. A declared `executableName`
would have.

The remaining work is therefore one quad per transport, not an installation.

## 5. Semantic qualification — none held, and that is the design

`config/qualification.json` is **tracked authority**, not disposable state:
suite `usf-v3-provider-semantic` v1.0.0, corpus v1.0.0, **16 cases** across four
task classes (`cli-design`, `node-test`, `provider-routing`, `typescript`);
policy `usf-v3-provider-semantic-policy` v1.0.0, default role **`UNQUALIFIED`**,
validity **900 seconds**.

Thresholds: `cli-design → PATCH_PRODUCER`, `node-test → REVIEWER`,
`provider-routing → PLANNER_CANDIDATE`, `typescript → PATCH_PRODUCER`.

**No qualification is currently held.** There is no qualification state at all,
and with 900-second validity any earlier one expired long ago. Every route is
`UNQUALIFIED` right now.

That is not staleness to fix. A 15-minute validity means qualification is
**earned per use, not kept up to date** — the freshness question does not apply
to it the way it applies to a catalogue. What *can* be stale is the suite and
policy, and both are current and tracked.

`usf route` replays supplied work against the unchanged suite and policy with
**no provider contact**, so the qualification machinery is exercisable offline;
what cannot be produced offline is a qualification, because that requires a
probe and an answer.

## 6. The gate that sits above all of this

Provider contact is refused independently of catalogue freshness, credential
presence and qualification. `usf probe availability` states it directly:
provider contact remains disabled until a registered trusted account-tier
receipt exists, and that contract's completion is proofblocked.

So even with credentials supplied and qualification earned, contact would still
refuse. The order to fix things in is: account-tier receipt, then credentials or
a session transport, then qualification — not the reverse.

## Non-claims

- A refreshed catalogue is a snapshot of a public index. It is not availability,
  entitlement, quota or health, and this record claims none of those.
- Credential *presence* was observed. No credential value was read, and no
  statement here implies a credential would authenticate successfully.
- Three host transports are present and report versions. That establishes they
  exist and are the right builds; it does not establish an authenticated
  session, which only an invocation would show.
- This document's first revision reported the Antigravity transport as absent,
  having looked for it under the transport's own name and found a desktop
  application. The correction is recorded rather than overwritten silently,
  because the reason it was wrong is the finding: no `executableName` is
  declared, so the search had nothing authoritative to look for.
- Nothing here was refreshed except the model catalogue. The provider roster,
  the adapter set, the credentials and the qualification suite are unchanged.
