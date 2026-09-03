*Normative. Section 13 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 13. Provider and zero-paid-cost architecture

### 13.1 Availability tuple

`free` is not a timeless model property.

At time `t`, an eligible route is the tuple:

```text
provider route
+ underlying model
+ installed adapter
+ credential or entitlement
+ required capability
+ privacy permission
+ current quota
+ current health
+ zero-paid-cost policy
+ observed actual identity
```

### 13.2 Cost classes

```text
local
zero-price
free-quota
subscription-zero-marginal
subscription
paid
unknown
```

The V3 terminal proof accepts `local`, `zero-price`, `free-quota` and
`subscription-zero-marginal`.

Default policy:

```text
maximum paid cost = 0
paid fallback = prohibited
unknown price = ineligible
router alias capable of paid fallback = ineligible
```

`subscription-zero-marginal` is a host transport backed by an already-held
subscription whose exact authenticated CLI or SDK control plane is distinct
from its metered API. It counts only when the current host authentication mode
and subscription entitlement are observed, all API-key and alternate-cloud
credential paths are absent from the child, model fallback is disabled, the
actual provider/model identity is retained, and the run records zero
incremental paid cost. The recurring subscription itself is disclosed and is
outside the run's incremental-cost ledger; this class never means that the
subscription price is zero. A generic `subscription`, an API-key invocation,
or an ambiguous host route remains ineligible.

A route is zero-paid-cost eligible only when its frozen invocation evidence proves the exact cost basis. Acceptable bases are exact zero-price metadata, a documented free-quota entitlement with remaining allowance, local inference, or the exact `subscription-zero-marginal` host boundary above. Promotional/one-time credit, unknown billing state and a router capable of paid fallback are not accepted unless the operator explicitly classifies that credit as a bounded zero-paid-cost source for a non-terminal experiment; such an experiment does not satisfy the terminal proof. When a provider reports usage cost, observed cost must be zero. When it does not, exact route and entitlement evidence must remain current and no paid credential/fallback may be configured.

### 13.3 Independent provider family

For the terminal proof, an independent provider family is a distinct mandatory inference control plane and credential/entitlement boundary. Multiple models or upstream routes reached only through one gateway count as one provider family. OpenRouter free routes therefore demonstrate model diversity but count as one provider family. A direct Groq route and an OpenRouter route count as two families even if they can serve the same underlying model, because removal of one control plane leaves the other.

The acceptance bundle records both provider-family diversity and underlying-model-family diversity. Neither substitutes for the other.

### 13.4 Dynamic population

Do not hard-code two or three providers.

The candidate population is the union of the complete frozen models.dev
provider/model catalogue and current host-transport model discovery. The
models.dev provider `npm` field identifies the Vercel AI SDK protocol adapter
for direct routes; it is catalogue/translation metadata, not authority to use
Vercel AI Gateway or a paid API. Subscription-host adapters remain distinct
typed transports and converge with direct AI SDK routes only at the common
answer, qualification, routing and observability contracts. Every discovered
model or alias candidate receives an explicit disposition, and aliases never
inflate the model denominator.

For each active work capability set:

1. enumerate every configured route;
2. filter by installed adapter, credential, privacy and catalogue facts;
3. probe every remaining bounded candidate unless a fresh valid probe exists;
4. record exact exclusion reasons;
5. route useful work to every successfully eligible provider/model subject to declared provider/host caps;
6. require at least two independent provider families for the live acceptance proof;
7. repeat after excluding one previously successful provider.

One unavailable or exhausted route removes capacity only. It does not stop unrelated routes.

### 13.5 Adaptive routing without admission bureaucracy

Do not create a permanent admission roster.

Maintain repository-local operational observations of validated task outcomes, latency, token usage, provider errors and cache behaviour.

Routing may use those observations as explicit inputs. It must remain explainable and reproducible from its input snapshot.

Probe lazily. Do not fully qualify the universe before useful work begins.

---
