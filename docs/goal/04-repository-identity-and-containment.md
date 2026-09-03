*Normative. Section 4 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 4. Repository identity and containment

### 4.1 Repository

Create or use:

```text
maldous/usf-v3
```

Initial visibility is private. Public release requires a later operator decision after secret, licence, provenance and egress review.

Do not overwrite or repurpose:

```text
maldous/usf
maldous/usf-graph
maldous/usf-factory
```

### 4.2 Root identity

Every command resolves the repository root with:

```bash
git rev-parse --show-toplevel
```

The resolved root is `USF_ROOT`.

No tracked source, graph statement, schema, receipt or test may depend on the absolute checkout path.

Semantic IRIs remain stable and unversioned:

```text
urn:usf:...
```

Version representations and schemas, not meaning.

### 4.3 Repository-local operating boundary

Everything needed to build, run, realise, validate, prove and audit V3 MUST exist beneath `USF_ROOT`, except:

- the Git remote;
- package registries during dependency installation;
- models.dev catalogue endpoints;
- explicitly configured provider endpoints;
- minimal host executables listed in Section 8.

No external location is semantic authority.

All untracked runtime state lives beneath:

```text
.usf/
```

Required initial layout:

```text
.usf/
├── bin/                  project-local helper executables
├── cache/
│   ├── graph/
│   ├── models/
│   ├── prompts/
│   ├── routing/
│   ├── validation/
│   ├── npm/
│   ├── corepack/
│   └── pnpm-store/
├── catalog/              raw and normalized models.dev snapshots
├── chains/               explicit chain manifests and stage artefacts
├── claims/               transient local work claims; never authority
├── home/                 isolated HOME for supported provider clients
├── logs/                 complete process logs
├── metrics/              throughput, token and cache observations
├── objects/              repository-local content-addressed working objects
├── runs/                 human-oriented run groupings and summaries
├── store/                disposable compiled semantic projections
├── tmp/                  child-process temporary files
├── workspaces/           candidate source trees; no branch or commit required
├── integration/          short-lived Git integration worktrees/checkouts
├── backups/              local atomic-apply rollback material
├── xdg/
│   ├── cache/
│   ├── config/
│   ├── data/
│   └── state/
└── lineage/              optional ignored historical inspection copies
```

The complete `.usf/` tree is gitignored.

Tracked source MUST NOT depend on any ignored generated output.

Deleting `.usf/` MUST NOT destroy semantic source, integrated implementation, accepted evidence or proof algorithms. It may delete operational history and caches. The accepted proof bundle required for the terminal claim is promoted into tracked, sanitized evidence as defined in Section 23.

### 4.4 Environment redirection

Initial GitHub repository inspection/creation MAY use the operator's existing user-level `gh` and Git authentication before V3 redirects `HOME`. Once inside normal V3 commands, mutable tool state is redirected beneath `USF_ROOT`; existing external authentication files are not copied into the repository unless the selected adapter has an explicit safe import mechanism. During initialization, copy only non-secret Git author identity into repository-local Git configuration so ordinary commits do not depend on the original user HOME. Remote authentication may continue through the host Git credential/SSH agent boundary, which is external transport rather than V3 state.

Tracked `scripts/env.sh` derives and exports at least:

```bash
export USF_ROOT="$(git rev-parse --show-toplevel)"
export HOME="$USF_ROOT/.usf/home"
export TMPDIR="$USF_ROOT/.usf/tmp"
export XDG_CACHE_HOME="$USF_ROOT/.usf/xdg/cache"
export XDG_CONFIG_HOME="$USF_ROOT/.usf/xdg/config"
export XDG_DATA_HOME="$USF_ROOT/.usf/xdg/data"
export XDG_STATE_HOME="$USF_ROOT/.usf/xdg/state"
export npm_config_cache="$USF_ROOT/.usf/cache/npm"
export COREPACK_HOME="$USF_ROOT/.usf/cache/corepack"
export PNPM_HOME="$USF_ROOT/.usf/bin"
```

`.npmrc` keeps the package store under `.usf/cache/pnpm-store`.

A provider adapter that cannot keep its mutable authentication or cache state beneath `USF_ROOT`, or accept credentials only through an allowlisted environment, is ineligible for the V3 core until isolated safely.

### 4.5 Containment invariants

A shared path library MUST:

- resolve outputs against `USF_ROOT`;
- reject absolute output paths;
- reject `..` traversal;
- reject symlink escapes;
- reject writes into `.git/`, `.env`, credential material and historical paths;
- use repository-relative paths in all durable envelopes;
- verify containment immediately before and after mutation.

`usf doctor`, CI and the final proof MUST fail on prohibited absolute USF paths, sibling runtime dependencies or writes outside `USF_ROOT`.

---
