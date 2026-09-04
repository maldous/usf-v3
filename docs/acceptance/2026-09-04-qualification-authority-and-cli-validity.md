# Qualification authority, freshness, and CLI syntax validity

Two bounded concerns closed together at `3877f53`, because they meet in the same
place: the live qualification command was invisible in the help that presents it.

Landed: the freshness repair and the CLI corrections, with proofs.
**Analysed and not landed: the grader repair.** Its design and the evidence for
it are in §4; it is the next step and it is stated as such rather than half-done.

---

## 1. What currently grants a task class

Six facts are involved and only one grants:

| fact | grants a task class? | where decided |
|---|---|---|
| economic authorization | no | `evaluateExecutionEconomics` |
| invocation availability | no | route deferral / observed routes |
| catalogue model features | no | `capabilityKind` — a closed task-class set, everything else is a feature |
| **qualification evidence** | **input** | `.usf/qualification-invocations/`, one record per graded case |
| **qualification verdict** | **yes** | `qualifySemanticProfile` → `.usf/qualifications/` |
| routing eligibility | no | consumes the verdict, never produces one |

The verdict is earned only by `usf probe qualify`, which runs the suite's cases
for one task class against one route and stores the result. Thirteen adversarial
properties proving no borrowing across providers, models, routes or vocabularies
were established in the previous lane and still hold; this lane adds five more
(§8).

## 2. The 900-second lifetime: origin and rationale

**There is no rationale.** `validitySeconds: 900` was introduced in commit
`17dabf5`, *the same commit* that set `probeFreshnessSeconds: 900` on both
configured routes. The decision record that commit added,
`docs/decisions/0005-provider-qualification.md`, justifies neither number and
does not mention either.

The two are different kinds of fact:

| | probe freshness | qualification validity |
|---|---|---|
| asks | is this route answering right now? | did this model demonstrate competence at this task class? |
| decays with the clock | yes | no |

A model does not get worse at TypeScript because fifteen minutes passed, a
process restarted, an account receipt aged or a provider rate-limited. A
liveness window was reused for a competence claim.

### What actually invalidates competence

Established by reading what the routing replay already does. `routeWork`
compares `inputs.corpusDigest`, `inputs.qualificationPolicyDigest`,
`inputs.effectivePolicyDigest`, and the requested and actual provider and model,
and **never once consults the clock**. It has decided this by identity all along.

| event | invalidates | why |
|---|---|---|
| suite or corpus identity changes | **yes** | what the task class means changed — and this covers every grader, prompt and case, because they are inside the corpus digest |
| policy or threshold changes | **yes** | what a score earns changed |
| provider:model route identity differs | **yes** | it is a different subject; evidence for one is not evidence for another |
| actual model differs from requested | **yes** | something else answered |
| process restart | no | |
| account receipt ageing | no | |
| rate limit or provider outage | no | availability, decided at dispatch |
| **elapsed wall-clock time alone** | **no** | this is the repair |

No time-based requalification interval was derived, because no drift evidence
exists for these routes. Inventing an interval to replace an unexplained one
would repeat the original mistake. What would justify adding one is now
measurable: re-running the suite at unchanged identity and getting a different
verdict.

## 3. The repair, and where it was needed

The two consumers of a stored qualification disagreed, and only one was wrong.
`routeWork` was already identity-based; `observeQualifiedTaskClasses` — the path
D3 wired into Hermes last lane — enforced the wall clock. The newer consumer was
made to agree with the established one rather than a third rule being invented.

`observeQualifiedTaskClasses` now:

- admits a record whose `inputs.corpusDigest` and `inputs.qualificationPolicyDigest`
  match the authority in force, and whose requested and actual route both match
  the key it is filed under;
- counts a mismatch as `supersededCount`, never `expiredCount`;
- refuses a record carrying no bound identity at all — inadmissible rather than
  superseded, because there is nothing to compare and a writable file must not
  decide the outcome. This is also what retires every record written under the
  old shape;
- admits nothing when `config/qualification.json` is absent, while still
  reporting itself evaluated so an empty answer is never read as unknown;
- **takes no time parameter.** Removing it is what makes wall-clock expiry
  unrepresentable here rather than merely absent — and the compiler then found
  all four production call sites.

`usf status` reports `supersededRecords` and the admitted `basis`, so what a
record was required to match is inspectable.

## 4. Grader audit — 16 of 16, with live evidence

The suite was run for real against `groq:openai/gpt-oss-120b`: four invocations,
four answered, **one passed**, `taskScore 0.25`, `UNQUALIFIED`. The one that
passed was the `json-schema` case. Both `exact` cases failed. That is the whole
finding in one run.

| grader kind | cases | disposition |
|---|---|---|
| `json-schema` | 2 | **sound** — parses the answer and validates a real contract |
| `choice` | 2 | **sound** — tokenises the answer, so prose around it is tolerated, and both options are in the prompt |
| `uncertainty` | 1 | **sound** — mechanical marker check |
| `exact` | 4 | **brittle** — whole-answer equality after case and whitespace normalisation |
| `contains` | 6 | **brittle** — demands exact substrings |
| `set-equal` | 1 | **brittle** — splits on `,;\n`, so a prose answer cannot pass |

**Eleven of sixteen are brittle, and the dominant defect is not strictness — it
is benchmark answer leakage.** Eight cases require the model to reproduce USF's
own internal vocabulary, none of which the prompt supplies:

- `"group by operator intent"`, `"smallest graph-authorized change"`
- `"registered usf command"` / `"no ad hoc command"`
- `"probe is not semantic qualification"` / `"assignment is not proof"` — verbatim
  strings from USF's own source
- `"eligible-unassigned"` — a `RouteDisposition` union member
- `"focused test"` / `"full gate"`, `"deterministic fixture"` / `"failure reason"`,
  `"runtime validation"` / `"type checking"`

The suite measures whether a model has memorised USF's phrasing, not whether it
can do the task class. Two observed answers make the point exactly:

- `typescript-readonly-contract` asked for the TypeScript modifier for immutable
  fields. The model answered **"The modifier is `readonly`."** — correct — and
  scored 0, because the grader wanted the bare token.
- `node-test-runner` answered ```` ```bash\nnode --test\n``` ```` — correct — and
  scored 0 on the fence, while Hermes's own admission path strips fences before
  judging.
- `typescript-authorized-scope` asked to "state the change-size rule", inviting a
  sentence, and graded by exact equality against a four-word private phrase. The
  prompt and the grader disagree; no model can pass it.

### The repair, designed and not yet landed

A hard constraint shapes it: `routeWork` **replays** grading through
`qualifySemanticProfile`, synchronously and purely, precisely so a route envelope
cannot self-author its own score. Graders therefore cannot compile or execute
anything, and the ideal "code repair → apply patch + compile/test" is not
available here. That constraint is worth more than the ideal.

So the repair is not to make grading heavier but to make every expected answer
**derivable from the prompt**, and to grade by the tokenised and structural
means that already exist:

| case | from | to |
|---|---|---|
| `typescript-readonly-contract` | `exact` | `choice` over prompt-supplied options — the observed correct answer then passes |
| `node-test-runner` | `exact` | `regex` on the invocation — fence- and prose-tolerant, still measures the real answer |
| `cli-plan-operator-intent`, `typescript-authorized-scope` | `exact` on private phrases | `choice` over four candidate rules stated in the prompt |
| the six `contains` cases | private phrasing | `set-equal` over labelled options supplied in the prompt |
| `route-complete-partition` | `set-equal` on unguessable terms | same grader, with the six candidate terms listed in the prompt to select from |
| `route-noncompletion-boundary` | `contains` on verbatim nonclaims | `json-schema` with `const: false` on two named booleans |

No new grader kind is required: the narrow schema validator already admits
`const` and `enum`. **This is not making graders more permissive.** Supplying the
vocabulary makes a case answerable; it does not lower what counts as a pass, and
the two `json-schema` cases keep their contracts unchanged.

This touches `config/qualification.json`, owned by `provider-semantic-qualification`
— a different chain from everything landed here, which is why it is a separate
step rather than a rushed addition to this one.

## 5. Task-class denominator

| task class | in code's closed set | suite cases | threshold | declared on work | consumer |
|---|---|---|---|---|---|
| typescript | yes | 4 | PATCH_PRODUCER | 29 | none |
| node-test | yes | 4 | REVIEWER | 27 | none |
| provider-routing | yes | 4 | PLANNER_CANDIDATE | 10 | none |
| cli-design | yes | 4 | PATCH_PRODUCER | 6 | none |
| rdf-semantics | yes | **0** | — | 9 | none |
| semantic-evaluation | yes | 0 | — | 2 | none |
| process-lifecycle | yes | 0 | — | 2 | none |
| semantic-review | yes | 0 | — | 1 | none |
| technical-writing | yes | 0 | — | 1 | none |
| copywriting, design-token-authoring, vector-illustration | **no** | 0 | — | 1 each | fixture subjects only |

**No task class has a consumer.** Every Hermes entry point —
`hermes implement` and `hermes realise`, at three call sites — sets
`requiredCapabilities: []` explicitly. Four classes have cases and no consumer;
five are in the vocabulary with no cases; three are fixture-only and are silently
read as model features, which would refuse every candidate if a real packet
declared one.

### `rdf-semantics`, treated explicitly

**Legitimately outside Hermes, and no grader should be added for it.**

`modelCapability` on a work packet and `requiredCapability` on a dispatched unit
are different predicates. The first says what a *realiser* needs; the realiser
may be Hermes or an operator working the staged chain. All nine `rdf-semantics`
packets were realised the second way — `semantic-authority-path` and
`architecture-conformance` among them, both through `call → resolve → apply →
check → integrate`. Hermes has three prompt shapes and none asks for N-Quads; no
delivery artefact carries a `.nq` path.

So the nine packets are not stale, not a backlog, and not evidence of a gap in
qualification. Whether semantic-graph work should ever be dispatched through
Hermes is a separate architectural question, deliberately not opened here.

## 6. Reproducible stored qualification

A record already carried suite, corpus, policy and effective-policy digests, the
observation-set digest and the qualification digest. Per-case invocation evidence
is stored separately under `.usf/qualification-invocations/` with provider,
requested and actual model, transport, adapter package, version and lock digest,
case id, prompt, answer, timings, usage and its own evidence digest.

What was missing was not the identity but its *use*: nothing compared it on
admission. It is compared now, and the digests are the invalidation basis. Raw
transcripts stay out of the verdict record and remain referenced evidence.

## 7. Tested population

Not completed, and deliberately not faked. One route was run through the real
mechanism to establish that the path works end to end and to obtain the grader
evidence in §4:

| route | invocations | answered | passed | verdict |
|---|---|---|---|---|
| `groq:openai/gpt-oss-120b` (typescript) | 4 | 4 | 1 | UNQUALIFIED |

Running the remaining population before the graders are repaired would spend the
operator's subscriptions to re-measure a suite already known to be unpassable for
reasons that have nothing to do with the models. **No model was promoted from the
previous evaluation's results**; the only verdict on record was earned through
the mechanism.

## 8. Adversarial invalidation results

Eight properties planted against the real observer, all holding:

| planted | result |
|---|---|
| a record long past the old fifteen-minute window | **admitted** — age is not supersession |
| corpus digest changed | superseded, counted |
| policy digest changed | superseded, counted |
| record with no bound identity | inadmissible, not superseded |
| evidence whose actual model differs from the filed route | refused |
| `UNQUALIFIED` role | grants nothing |
| `failed` status, malformed record, partial route | grants nothing |
| a model feature named as a task class | grants nothing |

Plus, from the previous lane and still holding: a catalogue feature cannot become
a task class; the same underlying model on another provider earns nothing; a
sibling model on the same provider earns nothing; missing qualification fails
closed; economic authorization is decided separately and its removal prevents
dispatch without touching qualification history.

**Provider outage does not erase competence** by construction: availability is
not consulted by the observer at all, and a deferred route keeps whatever it has
earned.

## 9. D3, kept honest

Both paths demonstrated:

- **No task-class requirement** → 81 routable candidates across 8 providers,
  unchanged. No qualification requirement is invented.
- **A genuine task-class requirement** → only candidates holding valid
  qualification for that exact class. Proven mechanically in
  `provider-capability-universe.test.ts`: with the map empty the candidate is
  refused; with `groq:m` holding `typescript` it is admitted; a different class on
  the same route and the same class on a sibling model both earn nothing.

Against the live store the requirement yields **zero** candidates, because zero
routes are qualified. That is the gate working, not a defect — and it is why the
graders come next.

**Current production work asks for no task class at all.** Whether to propagate
`modelCapability` into dispatched `requiredCapability` is the next architectural
decision. It should not be taken until the graders are repaired, because turning
it on today would stop dispatch entirely.

---

# CLI syntax validity

## Authorities and how they were compared

Three statements of one surface: the dispatcher (what parses), the graph's
`RegisteredCliCommand` subjects (what is declared), and `help.ts` (what is
presented). Compared mechanically, then **exercised** — every argv was run
through the real CLI in a disposable clone, never validated by string inspection.

| population | count |
|---|---|
| top-level commands in help | 32 |
| top-level commands in the dispatcher | 28 |
| documented subcommands | 42 |
| documented options | 131 |
| `RegisteredCliCommand` subjects in the graph | 27 |
| distinct `usf …` references across docs, prompts, graph, tests, scripts and the operator skill | 205 (183 plausible after prose filtering) |
| source files carrying a reference | 64 |

## Results

**Every one of the 42 documented subcommands parses.** Each returns an
argument-level refusal, never an unknown-operation refusal. The four top-level
commands in help but not in the dispatcher — `drift`, `observe`, `review` — are
all marked `availability: superseded`, and `help` is handled by the launcher, so
the top level reconciles once availability is honoured.

**Four implemented subcommands were absent from help**, all confirmed by
exercising them:

| subcommand | status | disposition |
|---|---|---|
| `probe qualify` | implemented, reachable, **absent from help** | **fixed** — added with its real options |
| `profile build`, `export`, `import` | implemented, registered in the graph, **absent from help** | **fixed** — added with their real semantics |
| `hermes supervise` | implemented, absent from help | **not a defect** — `docs/hermes-management.md` states it is the loop `start` owns and not an operator entry point |

`probe qualify` is the sharpest case: the command's own refusal message reads
*"Probe requires exactly one of availability, qualify or semantic"* while help
offered two of the three. **The error message was more accurate than the help**,
and the live qualification path was undiscoverable from the CLI that carries it.

The reason codes do not distinguish an unknown subcommand from bad arguments —
`probe answer` and `probe --bad-flag` both return `PROBE_ARGUMENTS_INVALID` and
differ only in the message. That is recorded, not repaired.

**One adapter documentation defect, fixed.** `claudeCliArguments` carried a doc
comment saying `--max-turns 1` bounds the agentic loop, three lines above an
inline comment saying that flag does not exist and had been removed as stale
knowledge. Two comments in one function disagreeing is worse than either: an
agent reading the first would reintroduce a flag the binary rejects, failing the
whole route as a usage error.

## Provider adapters, validated against the installed CLIs

| transport | version | constructed flags | absent from help | values |
|---|---|---|---|---|
| claude-cli | 2.1.251 | `-p --output-format --model` | none | `json` ∈ {text, json, stream-json} ✔ |
| codex-cli | 0.152.0 | `exec --json -s --skip-git-repo-check -c -m -o` | none | `read-only` ∈ {read-only, workspace-write, danger-full-access} ✔ |
| antigravity-cli | 1.1.26 | `--print --output-format --sandbox --mode --model` | none | `accept-edits` ∈ {accept-edits, plan} ✔, `stream-json` ✔ |

All three are currently valid. The recorded claim that claude has no
turn-bounding flag was re-verified against 2.1.251 and still holds.

Version drift is now detected rather than assumed: the argv is asserted in
`provider-capability-universe.test.ts` against the exact shape each CLI
documents, with the observed versions recorded in the test. The antigravity
`--mode plan` defect is the class this catches — the flag existed and the *value*
made the route useless.

## The single authority relationship

`help.ts` is a hand-maintained table. Turning it into a derived projection is a
redesign and was explicitly out of scope, so instead the second statement is now
**provably consistent with the first**: a test reads what each handler accepts —
preferring an explicit `operations` allowlist where one exists, because scraping
the equality chain cannot see a fallthrough default — and asserts it against what
help presents, in both directions.

Reconciling all 32 commands is corpus-scope work and is deliberately not done in
a confined candidate, where each further command inspected adds a closure member.
That is the same scope boundary the architecture assurance draws. The check
covers the two commands whose surfaces actually disagreed.

## Found and not repaired

| finding | why not |
|---|---|
| `src/cli.ts` graph handler refuses with *"exactly one of: execute, integrity"* while also accepting `lanes` | `cli.ts` belongs to five other contracts, none of them this lane's |
| `docs/hermes-management.md` lists `doctor` among read-only subcommands while its own "remaining planned surface" block marks it unimplemented | same owner boundary; the ambiguity is real but small |
| `graph/semantic-recovery.nq` describes `graph inspect / inventory / coverage / export / import` | all belong to **retired** works; declarations of retired intent, not current promises |
| 27 of ~74 surface points carry a `RegisteredCliCommand` | closing that gap is a large declaration exercise, not a syntax defect |
| unknown-subcommand and bad-argument share one reason code | a refusal-taxonomy change with its own blast radius |

## Tests, gates and blast radius

574 of 574 tests, typecheck clean, integrity gate conforming with zero owned
violations, containment pass. Eight source files changed, all under one owner.

Blast radius priced before the edit and matched exactly: `provider-task-qualification`
is the one verified-complete lane reading the capability vocabulary; it went
blocked and was restored through its own chain. `semantic-authority-path`,
`architecture-conformance`, `repository-path-scope` and `file-asset-index` were
untouched throughout.

`provider-capability-universe` and `provider-task-qualification` are both
**verified-complete**. Working tree clean at `3877f53`.
