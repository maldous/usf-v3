Classification: USF-PROVENANCE-DOCUMENT. This section names the historical
evidence paths inspected at Gate 0, which is why it is exempt from the
containment rule that forbids them. It describes lineage; nothing in V3 reads
it at build, test, validation, realisation or runtime.

*Normative. Section 3 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 3. Starting environment and historical sources

### 3.1 Exact starting environment

The initial host state is:

```text
user:              user
starting directory: /home/user/src
source goal:        /home/user/src/GOAL.md
new checkout:       /home/user/src/usf-v3
remote repository:  maldous/usf-v3
```

Run as the ordinary user `user`.

Do not use `sudo`, create root-owned files or place V3 state under `/root`, `/var/lib`, `/opt`, host `/tmp`, a chroot or a sibling runtime directory.

If the local checkout or remote repository already exists, inspect and continue safely. Do not overwrite, reinitialise, delete or repurpose existing work.

Copy the source goal into the new repository root as `GOAL.md`; preserve the original file.

### 3.2 Historical source corpus

The following historical paths are operator-authorised for read-only inspection:

```text
/home/user/src/bak/anqr
    Original QR-code application that USF is ultimately intended to deliver.

/home/user/src/bak/usf
    USF V1 source.

/home/user/src/bak/v2/usf
    USF V2 semantic graph source.

/home/user/src/bak/v2/root/usf-factory
    USF V2 Factory source.

/home/user/.local/share/usf-operator
    USF V2 operator source and artefacts.

/home/user/.local/share/usf-proof-cockpit
    USF V2 proof-cockpit source and artefacts.
```

These are historical evidence and selective implementation sources. They are not V3 runtime dependencies and do not establish V3 authority.

Do not modify, clean, reset, stash, commit, rename, move, delete or change ownership in those locations.

At initial orientation, record a compact inventory of each source:

- purpose;
- Git repository identity, remote, branch, HEAD and tree where available;
- cleanliness without mutation;
- licence and ownership information;
- relevant graph, provider, CLI, validation, proof, isolation and ANQR code;
- external paths, external CAS, Stardog, Factory, Hermes, Operator or state-machine coupling;
- generated, secret-bearing or environment-specific content that must not be copied.

Do not perform an exhaustive historical audit before starting V3. Inspect the minimum needed to identify useful components and the first ANQR vertical slice. Deep inspection occurs only when a current work item requires it.

### 3.3 Historical independence test

Normal V3 build, tests, runtime, semantic compilation and demonstration MUST succeed when all historical paths are unavailable.

Tracked V3 content may refer to historical repository URLs, commits and logical source identities for provenance. It MUST NOT depend on the host absolute paths above.

---
