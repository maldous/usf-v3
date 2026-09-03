*Normative. Section 11 of the USF V3 programme directive. [`GOAL.md`](../../GOAL.md) is the index and carries the terminal criteria and the nonclaims. Section and subsection numbers are stable and are cited by the semantic graph.*

## 11. Shared artefact contract

All command outputs use schema-defined canonical JSON or JSONL.

The minimum common envelope is conceptually:

```json
{
  "schema": "urn:usf:envelope:1",
  "kind": "work-packet",
  "producer": {
    "command": "usf work",
    "version": "..."
  },
  "identity": {
    "artifactDigest": "sha256:...",
    "chainDigest": "sha256:..."
  },
  "semantic": {
    "globalRevisionDigest": "sha256:...",
    "dependencyDigest": "sha256:...",
    "dependencies": []
  },
  "repository": {
    "carrierCommit": "...",
    "carrierTree": "...",
    "pathDependencies": []
  },
  "inputs": [],
  "payload": {},
  "metrics": {},
  "claims": [],
  "nonclaims": [],
  "createdAt": "RFC3339 UTC"
}
```

Rules:

- `createdAt`, local path and human run labels do not participate in semantic/artifact identity;
- every digestable structure uses canonical JSON;
- secrets and absolute paths are prohibited;
- requested and actual provider/model identity are separate;
- cost class, observed cost and usage are present for provider calls;
- failures use stable reason codes;
- raw provider responses are mode `0600`, secret-scanned and stored beneath `.usf/objects` or `.usf/chains`, never treated as authority.

Recommended exit codes:

```text
0 success
1 domain refusal, validation failure or proof failure
2 invalid CLI input or configuration
3 external catalogue/provider unavailable
4 currentness, integrity or drift failure
5 containment, privacy or security refusal
6 no eligible zero-paid-cost route
7 integration conflict
8 continuous supervisor degraded with no unsafe effect
```

---
