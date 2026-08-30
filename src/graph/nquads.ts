import { createHash } from "node:crypto";

export interface Quad {
  subject: string;
  predicate: string;
  object: string;
  objectKind: "iri" | "literal";
  graph: string;
  canonical: string;
}

const iriPattern = String.raw`((?:[^\u0000-\u0020<>"{}|^\x60\\]|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})+)`;
const literalPattern = String.raw`((?:[^"\\\r\n]|\\[btnfr"'\\]|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})*)`;
const linePattern = new RegExp(String.raw`^<${iriPattern}> <${iriPattern}> (?:<${iriPattern}>|"${literalPattern}") <${iriPattern}> \.$`, "u");

function unescapeUnicode(value: string, permitEchar: boolean): string {
  const pattern = permitEchar
    ? /\\(?:([btnfr"'\\])|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8}))/gu
    : /\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8}))/gu;
  const unescaped = value.replace(pattern, (_all, echarOrU4: string | undefined, u4OrU8: string | undefined, maybeU8: string | undefined) => {
    if (permitEchar && echarOrU4 !== undefined) {
      return ({ b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "'": "'", "\\": "\\" })[echarOrU4] ?? echarOrU4;
    }
    const u4 = permitEchar ? u4OrU8 : echarOrU4;
    const u8 = permitEchar ? maybeU8 : u4OrU8;
    return u4 === undefined ? String.fromCodePoint(Number.parseInt(u8 ?? "", 16)) : String.fromCharCode(Number.parseInt(u4, 16));
  });
  if ([...unescaped].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint >= 0xD800 && codePoint <= 0xDFFF;
  })) throw new Error("NQUADS_INVALID_UNICODE_SCALAR");
  return unescaped;
}

function escapeLiteral(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F"\\]/gu, (character) => {
    const escaped = ({ "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\" })[character];
    return escaped ?? `\\u${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`;
  });
}

function escapeIri(value: string): string {
  return value.replace(/[\u0000-\u0020<>"{}|^`\\]/gu, (character) => `\\u${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`);
}

/** RDFC-1.0-compatible serialization for the accepted blank-node-free profile. */
export function canonicalQuadLine(quad: Readonly<Quad>): string {
  const object = quad.objectKind === "iri" ? `<${escapeIri(quad.object)}>` : `"${escapeLiteral(quad.object)}"`;
  return `<${escapeIri(quad.subject)}> <${escapeIri(quad.predicate)}> ${object} <${escapeIri(quad.graph)}> .`;
}

/** A deliberately narrow parser: bootstrap accepts only blank-node-free IRI/literal N-Quads. */
export function parseStrictNQuads(source: string, expectedGraph: string, maxQuads = Number.MAX_SAFE_INTEGER): Quad[] {
  if (!Number.isSafeInteger(maxQuads) || maxQuads < 0) throw new Error("NQUADS_QUAD_LIMIT_INVALID");
  const rawLines = source.split(/\r\n|\n|\r/u);
  if (rawLines.at(-1) === "") rawLines.pop();
  if (rawLines.length === 0 || rawLines.some((line) => line.length === 0)) throw new Error("NQUADS_EMPTY_OR_BLANK_LINE");
  if (rawLines.length > maxQuads) throw new Error("NQUADS_QUAD_LIMIT_EXCEEDED");
  const lines = rawLines;
  const quads = lines.map((line, index) => {
    const match = linePattern.exec(line);
    if (!match) throw new Error(`NQUADS_UNSUPPORTED_SYNTAX:${index + 1}`);
    const [, subjectValue, predicateValue, iriObjectValue, literalObject, graphValue] = match;
    const subject = unescapeUnicode(subjectValue, false);
    const predicate = unescapeUnicode(predicateValue, false);
    const iriObject = iriObjectValue === undefined ? undefined : unescapeUnicode(iriObjectValue, false);
    const graph = unescapeUnicode(graphValue, false);
    if (graph !== expectedGraph) throw new Error(`NQUADS_GRAPH_MISMATCH:${index + 1}`);
    const quad: Quad = {
      subject,
      predicate,
      object: iriObject ?? unescapeUnicode(literalObject ?? "", true),
      objectKind: (iriObject === undefined ? "literal" : "iri") as "literal" | "iri",
      graph,
      canonical: "",
    };
    quad.canonical = canonicalQuadLine(quad);
    return quad;
  });
  const canonical = quads.map(canonicalQuadLine).sort();
  if (canonical.some((line, index) => index > 0 && line === canonical[index - 1])) throw new Error("NQUADS_DUPLICATE_QUAD");
  return quads;
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalNQuads(quads: readonly Quad[]): string {
  const lines = quads.map(canonicalQuadLine).sort();
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export function canonicalQuadDigest(quads: readonly Quad[]): string {
  return sha256(canonicalNQuads(quads));
}
