*Normative. Section 8 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 8. Technology and third-party boundary

### 8.1 Host prerequisites

Keep host requirements minimal:

```text
Git
GitHub CLI for remote setup only
Node.js 22 or later
Corepack / pnpm
POSIX-compatible shell
Linux procfs and util-linux `flock` for unattended `start` / `stop` / `watch`
```

The Linux and `flock` requirement is conditional on the process-lifecycle
commands; pure graph, query, work, validation and artefact commands do not gain
that dependency. Do not require Docker, systemd, Java, Stardog, chroot,
external database or external CAS for the V3 core. A commodity supervisor such
as a systemd user service, s6 or runit MAY own backgrounding, restart and forced
termination outside USF, but it is never semantic, scheduling or proof
authority.

### 8.2 Primary implementation

Use TypeScript, Node.js and pnpm.

Use a pnpm workspace only when multiple actual packages/apps exist; do not create speculative package boundaries.

### 8.3 Commodity infrastructure

USF owns semantics, work projection, collaboration, realisation, validation, evidence and proof.

It does not own the general provider ecosystem.

Use maintained third-party capabilities behind narrow replaceable interfaces:

- models.dev for model and provider-route metadata;
- Vercel AI SDK and maintained provider packages for protocol translation;
- OpenAI-compatible provider support where appropriate;
- Oxigraph JavaScript as the initial repository-contained RDF/SPARQL implementation, replaceable if the capability spike fails;
- a maintained SHACL implementation meeting the required fixture profile;
- a maintained RDF Dataset Canonicalization implementation;
- JSON Schema validation;
- standard Git for source history and integration.

At Gate 1, run a bounded dependency capability spike and pin exact current package versions in `pnpm-lock.yaml`. If a selected package does not satisfy the required fixture profile, replace it with the smallest maintained alternative and record the decision.

The initial provider adapter surface SHOULD cover OpenAI-compatible routes plus direct Google, Groq, Cerebras, Mistral and OpenRouter routes when corresponding zero-cost credentials/entitlements exist. Install only adapters needed by current configured routes; do not make this list a semantic roster or a completion denominator. Add other maintained AI SDK adapters dynamically when credentials and active work justify them.

Do not introduce LiteLLM, Portkey, Bifrost or another provider gateway/control plane unless direct AI SDK integration fails a recorded requirement and the gateway is demonstrably smaller than custom replacement work.

### 8.4 No semantic provider catalogue

The canonical graph expresses required model capabilities, privacy and cost constraints. It does not copy the global provider/model catalogue.

Provider catalogues, health and quota are operational observations beneath `.usf/`.

---
