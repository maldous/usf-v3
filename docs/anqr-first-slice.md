# First ANQR slice: decoded-payload content analysis

## Decision

The first ANQR product slice is a clean-room, pure TypeScript package that
classifies an already-decoded QR payload, supplies a stable display label, and
extracts a bounded URL-detail projection without throwing or performing I/O.

This is narrower than the historical analyzer, but it is real QR-domain
behavior rather than a USF administration feature. It is the earliest bounded
slice that satisfies the full semantic-to-tested-package loop.

## Historical evidence

Historical ANQR at Git commit
`a03cee561f2ad7bf9cb83f15eb857925c967e34f` shows this behavior composed from:

- `packages/domain/qr/src/analyze/detect-content-type.ts`;
- `detect-crypto-type.ts` and `detect-payment-type.ts`;
- `format-content-type-label.ts`;
- `parse-url-details.ts`;
- `content.types.ts` and `url-details.ts`;
- the decoded content path in `decoder.ts`.

The observed dependency closure is ECMAScript string/regular-expression logic
and the standard `URL` implementation. It does not require canvas, image data,
workers, QR decoding, React, camera access, logging, telemetry, or network I/O.

The historical repository does not establish a usable root licence for exact
source copying. V3 therefore treats the files above as behavioral evidence and
will implement the declared contract afresh. No historical bytes are admitted
by this decision.

## Callable contract

The package will expose:

```ts
analyzeDecodedPayload(input: unknown): PayloadAnalysisResult
detectContentType(payload: string): ContentType
formatContentTypeLabel(type: ContentType): string
parseHttpUrlDetails(payload: string): UrlDetails | null
```

`PayloadAnalysisResult` is discriminated:

- refusal: `ok: false` with stable reason `INVALID_INPUT` or `RESOURCE_LIMIT`;
- accepted analysis: `ok: true`, content type, stable English label, normalized
  payload length, and URL details or `null`.

The input policy is explicit:

- only JavaScript strings are accepted;
- at most 8,192 UTF-16 code units are accepted;
- classification and URL parsing use the same once-trimmed string;
- empty/whitespace-only strings are accepted as `plain_text`;
- refusal output never contains the input payload.

The declared content types and labels are:

```text
url, wifi, vcard, mecard, email, tel, sms, geo,
crypto_bitcoin, crypto_ethereum, crypto_other,
epc_sepa, upi, emv_qr, swiss_qr_bill,
calendar_event, otp_auth, plain_text, unknown
```

Detection remains intentionally lexical and ordered. `unknown` is a declared
formatting value but is not emitted by successful classification. Broad `bcd*`
and `spc*` prefixes retain their historical labels only under the explicit
non-validation claim below.

URL classification accepts only trimmed case-insensitive `http://` or
`https://` prefixes. URL-detail extraction returns only protocol, host,
pathname, a UTM-presence flag, and optional `utm_source`, `utm_medium`, and
`utm_campaign`; parse failure returns `null`.

## Security and error semantics

- Analysis has no filesystem, environment, clock, randomness, subprocess, or
  network access.
- It never navigates to, resolves, fetches, redirects through, or executes a
  payload destination.
- Only HTTP(S)-prefixed input can be labelled `url`; successful parsing does not
  imply destination safety.
- Credentials, fragments, and non-UTM query parameters are excluded from the
  URL projection.
- Non-string and over-limit inputs fail before classification with exact stable
  reason codes and no echoed payload.
- Accepted strings do not throw; malformed URL details fail closed to `null`.
- Classification labels payment, crypto, contact, Wi-Fi, OTP, and calendar
  syntax. It does not validate the underlying transaction, address, credential,
  contact, network, event, or issuer.

## Acceptance criteria

1. The public result and component interfaces have runtime-validatable JSON
   fixtures and a checked schema.
2. Every declared content type has a stable label fixture; classifier-emitted
   types have positive and near-miss vectors.
3. Tests prove whitespace/case normalization and precedence between URL,
   contact, communication, crypto, payment, calendar, OTP, and plain text.
4. Payment tests cover the exact broad `bcd`/`spc` non-validation behavior and
   positive/negative EMV suffix patterns.
5. URL tests cover valid HTTP(S), host/path projection, each UTM field, missing
   UTM fields, malformed input, and excluded credentials/query/fragment data.
6. Boundary tests cover 8,192 and 8,193 code units plus non-string inputs and
   prove refusal does not echo the payload.
7. Repeated analysis and canonical JSON serialization of the same input are
   byte-identical.
8. Unit tests exercise individual classifiers, labels, and URL parsing; a
   contract/integration test imports only the package public entrypoint.
9. Build and tests pass with every historical source path unavailable.
10. The output is packageable and callable under Node 22+ without production
    deployment or external services.

## Explicit exclusions and nonclaims

This slice does not:

- decode an image, matrix, canvas, file, stream, or camera frame;
- validate QR structure, error correction, quiet zone, contrast, or scannability;
- canonicalize, rewrite, resolve, or navigate payload destinations;
- detect phishing, malware, homographs, harmful content, or transaction fraud;
- prove that a payment, crypto address, OTP seed, contact, Wi-Fi network, URL,
  event, or decoded QR is valid, authentic, safe, or usable;
- migrate historical UI, worker, application-runtime, telemetry, or analyzer
  topology.

## Shortlist disposition

- Full structural/scannability analysis is central but deferred: historical
  functions make unsupported positive claims and ignore important matrix data,
  so a correct clean-room contract and standards-backed fixtures are larger.
- Worker validation and the full web analyzer are deferred because browser and
  application dependencies make them poor first isolation proofs.
- The fallback canonical payload manifest/validator/resolver is not selected:
  it would introduce new canonicalization, destination-safety, and resolver
  semantics not established by the bounded historical evidence.

The next semantic action is to encode this contract, permissions, nonclaims,
write scope, checks, evidence requirements, and proof obligation in the minimal
V3 graph before implementation expands beyond the bootstrap loop.
