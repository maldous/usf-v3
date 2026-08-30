import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_TYPES,
  analyzeDecodedPayload,
  detectContentType,
  formatContentTypeLabel,
  parseHttpUrlDetails,
  type ContentType,
} from "../index.ts";

const labelFixtures: Readonly<Record<ContentType, string>> = {
  url: "URL",
  wifi: "WiFi Network",
  vcard: "vCard Contact",
  mecard: "MeCard Contact",
  email: "Email",
  tel: "Phone Number",
  sms: "SMS",
  geo: "Geographic Location",
  crypto_bitcoin: "Bitcoin Payment",
  crypto_ethereum: "Ethereum Payment",
  crypto_other: "Cryptocurrency",
  epc_sepa: "SEPA Payment",
  upi: "UPI Payment",
  emv_qr: "EMV Payment QR",
  swiss_qr_bill: "Swiss QR Bill",
  calendar_event: "Calendar Event",
  otp_auth: "2FA/OTP Setup",
  plain_text: "Plain Text",
  unknown: "Unknown",
};

const positiveVectors: ReadonlyArray<readonly [string, ContentType]> = [
  ["https://example.test/path", "url"],
  ["WIFI:T:WPA;", "wifi"],
  ["BEGIN:VCARD\nVERSION:3.0", "vcard"],
  ["MECARD:N:Example;", "mecard"],
  ["mailto:hello@example.test", "email"],
  ["tel:+611234", "tel"],
  ["SMSTO:+611234:hello", "sms"],
  ["geo:-37.8,144.9", "geo"],
  ["bitcoin:address", "crypto_bitcoin"],
  ["ethereum:address", "crypto_ethereum"],
  ["dogecoin:address", "crypto_other"],
  ["bcd-not-a-payment", "epc_sepa"],
  ["upi://pay?pa=merchant", "upi"],
  ["000212arbitrary6304aBcD", "emv_qr"],
  ["spc-not-a-bill", "swiss_qr_bill"],
  ["BEGIN:VEVENT\nSUMMARY:Meeting", "calendar_event"],
  ["otpauth://totp/service", "otp_auth"],
  ["ordinary prose", "plain_text"],
];

test("every declared type has the documented stable label", () => {
  assert.deepEqual(Object.keys(labelFixtures), CONTENT_TYPES);
  for (const type of CONTENT_TYPES) {
    assert.equal(formatContentTypeLabel(type), labelFixtures[type]);
  }
});

test("classifier recognizes each emitted type", () => {
  for (const [payload, expected] of positiveVectors) {
    assert.equal(detectContentType(payload), expected, payload);
  }
});

test("near misses remain text and lexical precedence is stable", () => {
  const nearMisses = [
    "httpx://example.test",
    "wi-fi:T:WPA",
    "begin vcard",
    "me card:Name",
    "mail:hello@example.test",
    "telephone:+611234",
    "smstoish:+611234",
    "geolocation:-37,144",
    "bitcoins:address",
    "ethereumx:address",
    "litecoins:address",
    "bc-not-epc",
    "upis://pay",
    "000212arbitrary6304ZZZZ",
    "s pc-not-bill",
    "begin:calendar",
    "otpauths://totp/service",
  ];
  for (const payload of nearMisses) assert.equal(detectContentType(payload), "plain_text", payload);

  assert.equal(detectContentType("  HTTPS://example.test  "), "url");
  assert.equal(detectContentType("  MAILTO:bitcoin:address"), "email");
  assert.equal(detectContentType("  SMS:bitcoin:address"), "sms");
  assert.equal(detectContentType("  BEGIN:VCARD\nTEL:+61"), "vcard");
  assert.equal(detectContentType("  BITCOIN:upi://pay"), "crypto_bitcoin");
  assert.equal(detectContentType("  UPI://pay?pa=spc"), "upi");
  assert.equal(detectContentType("  BEGIN:VEVENT\notpauth://totp/x"), "calendar_event");
});

test("bcd and spc intentionally classify by broad prefix, while EMV needs both patterns", () => {
  assert.equal(detectContentType("BCD"), "epc_sepa");
  assert.equal(detectContentType("SPC"), "swiss_qr_bill");
  assert.equal(detectContentType("0002126304ABCD"), "emv_qr");
  assert.equal(detectContentType("0001126304ABCD"), "plain_text");
  assert.equal(detectContentType("0002126304ABC"), "plain_text");
  assert.equal(detectContentType("0002126304ZZZZ"), "plain_text");
});

test("HTTP URL projection is bounded and excludes sensitive or irrelevant fields", () => {
  assert.deepEqual(
    parseHttpUrlDetails(
      " HTTPS://name:secret@example.test:8443/a/b?keep=no&utm_source=news&utm_medium=email&utm_campaign=spring#fragment ",
    ),
    {
      protocol: "https",
      host: "example.test:8443",
      pathname: "/a/b",
      hasUtmParams: true,
      utmSource: "news",
      utmMedium: "email",
      utmCampaign: "spring",
    },
  );
  assert.deepEqual(parseHttpUrlDetails("http://example.test"), {
    protocol: "http",
    host: "example.test",
    pathname: "/",
    hasUtmParams: false,
  });
  assert.deepEqual(parseHttpUrlDetails("https://example.test/?utm_medium=social"), {
    protocol: "https",
    host: "example.test",
    pathname: "/",
    hasUtmParams: true,
    utmMedium: "social",
  });
  assert.equal(parseHttpUrlDetails("https://"), null);
  assert.equal(parseHttpUrlDetails("ftp://example.test"), null);
});

test("analysis validates unknown input, code-unit resource bounds, and never echoes refused data", () => {
  for (const input of [null, undefined, 1, {}, [], true]) {
    assert.deepEqual(analyzeDecodedPayload(input), { ok: false, reason: "INVALID_INPUT" });
  }
  assert.equal(analyzeDecodedPayload("x".repeat(8_192)).ok, true);
  const rejected = analyzeDecodedPayload(`SECRET-${"x".repeat(8_186)}`);
  assert.deepEqual(rejected, { ok: false, reason: "RESOURCE_LIMIT" });
  assert.equal(JSON.stringify(rejected).includes("SECRET"), false);
});

test("analysis uses one trimmed representation and is canonically repeatable", () => {
  const input = "  HTTPS://example.test/path?utm_source=one  ";
  const first = analyzeDecodedPayload(input);
  const second = analyzeDecodedPayload(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first, {
    ok: true,
    contentType: "url",
    label: "URL",
    payloadLength: "HTTPS://example.test/path?utm_source=one".length,
    urlDetails: {
      protocol: "https",
      host: "example.test",
      pathname: "/path",
      hasUtmParams: true,
      utmSource: "one",
    },
  });
  assert.equal(analyzeDecodedPayload("  \n\t ").ok, true);
  assert.equal(detectContentType("  \n\t "), "plain_text");
});
