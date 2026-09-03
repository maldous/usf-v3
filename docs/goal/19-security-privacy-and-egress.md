*Normative. Section 19 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 19. Security, privacy and egress

Every work packet declares one classification:

```text
public
private-metadata
private-source
restricted
```

Tracked provider policy declares what each route may receive.

Default:

- external free routes: `public` only;
- explicitly approved routes: `public` and possibly `private-metadata` or `private-source` according to recorded terms;
- local routes: policy-defined;
- `restricted`: local-only.

The first live multi-provider ANQR slice MUST be public-safe or use routes explicitly approved for its classification. Repository privacy does not automatically mean every source byte may be sent externally.

Prompt construction sends only exact permitted excerpts. It never sends `.env`, full repository archives, full graph, unrelated source, previous transcripts or secret-bearing logs.

Real credentials exist only in `.env` mode `0600` or isolated `.usf/home`, are gitignored, allowlisted, never printed and never passed wholesale to provider subprocesses.

All provider input and output receives secret-pattern scanning and path/provenance recording sufficient to audit egress without exposing secret values.

### 19.1 Two-trust execution boundary

Provider invocation and candidate execution are separate processes with separate authority:

- the provider-invocation process may receive only the credential variables required by the selected route and may not execute candidate code;
- the candidate-validation process receives no provider credentials, no `.env`, no provider home and no unrestricted network or filesystem access.

`usf check` MUST execute model-produced code through a proven confinement adapter. The initial implementation SHOULD use the Node.js permission model for Node-only commands when it can deny filesystem access outside the worktree/run temporary directory, deny credential paths and deny network/child-process access except explicit allowlists. If the required command cannot be confined by the selected adapter, automatic execution is refused until a proven local sandbox is available or the command is explicitly reviewed and allowlisted.

Sanitizing environment variables alone is not sufficient confinement because candidate code runs as the same host user.

Adversarial validation MUST attempt to:

- read `.env`;
- read `.usf/home`;
- read historical source paths;
- write outside the candidate worktree;
- access the network when not allowed;
- spawn an unapproved child process;
- exfiltrate secret-shaped canary values.

All attempts must fail without weakening unrelated validation.

### 19.2 Dependency and install safety

A model may propose dependency changes but may not install arbitrary dependencies directly.

Dependency candidates must declare package, version/range, purpose and licence. Integration checks lockfile reproducibility, registry provenance, licence policy, known security findings where available and install-script posture. Default installation uses ignored scripts; a package requiring an install script needs explicit tracked approval and a confined test.

No package manager process executing candidate-controlled hooks receives provider credentials.

---
