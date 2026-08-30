/**
 * A deliberately small, pure analysis surface for content that has already
 * been decoded from a QR code. It performs lexical recognition only.
 */

export const CONTENT_TYPES = [
  "url",
  "wifi",
  "vcard",
  "mecard",
  "email",
  "tel",
  "sms",
  "geo",
  "crypto_bitcoin",
  "crypto_ethereum",
  "crypto_other",
  "epc_sepa",
  "upi",
  "emv_qr",
  "swiss_qr_bill",
  "calendar_event",
  "otp_auth",
  "plain_text",
  "unknown",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export interface UrlDetails {
  protocol: "http" | "https";
  host: string;
  pathname: string;
  hasUtmParams: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export type PayloadAnalysisResult =
  | { ok: false; reason: "INVALID_INPUT" | "RESOURCE_LIMIT" }
  | {
      ok: true;
      contentType: ContentType;
      label: string;
      payloadLength: number;
      urlDetails: UrlDetails | null;
    };

const MAX_PAYLOAD_CODE_UNITS = 8_192;

const CONTENT_LABELS: Readonly<Record<ContentType, string>> = {
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

const PREFIX_CLASSIFIERS: ReadonlyArray<readonly [string, ContentType]> = [
  ["http://", "url"],
  ["https://", "url"],
  ["wifi:", "wifi"],
  ["begin:vcard", "vcard"],
  ["mecard:", "mecard"],
  ["mailto:", "email"],
  ["tel:", "tel"],
  ["sms:", "sms"],
  ["smsto:", "sms"],
  ["geo:", "geo"],
  ["bitcoin:", "crypto_bitcoin"],
  ["ethereum:", "crypto_ethereum"],
  ["litecoin:", "crypto_other"],
  ["dogecoin:", "crypto_other"],
  ["bcd", "epc_sepa"],
  ["upi://", "upi"],
  ["spc", "swiss_qr_bill"],
  ["begin:vcalendar", "calendar_event"],
  ["begin:vevent", "calendar_event"],
  ["otpauth://", "otp_auth"],
];

/** Returns the contract's stable English display label. */
export function formatContentTypeLabel(type: ContentType): string {
  return CONTENT_LABELS[type] ?? "Unknown";
}

/**
 * Lexically classifies a payload. The caller owns validation and any semantic
 * validation of the selected format; this function intentionally does neither.
 */
export function detectContentType(payload: string): ContentType {
  const trimmed = payload.trim();
  const lower = trimmed.toLowerCase();

  for (const [prefix, type] of PREFIX_CLASSIFIERS) {
    if (lower.startsWith(prefix)) return type;
  }

  if (/^0002\d{2}/.test(trimmed) && /6304[a-f0-9]{4}$/i.test(trimmed)) {
    return "emv_qr";
  }

  return "plain_text";
}

/**
 * Projects a HTTP(S) URL into display-safe details. It retains no credentials,
 * fragment, or arbitrary query parameter, and reports malformed values as null.
 */
export function parseHttpUrlDetails(payload: string): UrlDetails | null {
  const trimmed = payload.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const utmSource = parsed.searchParams.get("utm_source") ?? undefined;
    const utmMedium = parsed.searchParams.get("utm_medium") ?? undefined;
    const utmCampaign = parsed.searchParams.get("utm_campaign") ?? undefined;

    return {
      protocol: parsed.protocol === "http:" ? "http" : "https",
      host: parsed.host,
      pathname: parsed.pathname,
      hasUtmParams:
        utmSource !== undefined || utmMedium !== undefined || utmCampaign !== undefined,
      ...(utmSource === undefined ? {} : { utmSource }),
      ...(utmMedium === undefined ? {} : { utmMedium }),
      ...(utmCampaign === undefined ? {} : { utmCampaign }),
    };
  } catch {
    return null;
  }
}

/**
 * Validates an unknown decoded value and returns a deterministic, pure result.
 * No value from a refused input is included in the result.
 */
export function analyzeDecodedPayload(input: unknown): PayloadAnalysisResult {
  if (typeof input !== "string") return { ok: false, reason: "INVALID_INPUT" };
  if (input.length > MAX_PAYLOAD_CODE_UNITS) {
    return { ok: false, reason: "RESOURCE_LIMIT" };
  }

  const payload = input.trim();
  const contentType = detectContentType(payload);
  return {
    ok: true,
    contentType,
    label: formatContentTypeLabel(contentType),
    payloadLength: payload.length,
    urlDetails: contentType === "url" ? parseHttpUrlDetails(payload) : null,
  };
}
