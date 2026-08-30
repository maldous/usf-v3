import { createHash } from "node:crypto";

export interface Quad {
  subject: string;
  predicate: string;
  object: string;
  objectKind: "iri" | "literal";
  graph: string;
  canonical: string;
}

const linePattern = /^<([^<>\s]+)> <([^<>\s]+)> (?:<([^<>\s]+)>|"((?:[^"\\]|\\["\\nrt])*)") <([^<>\s]+)> \.$/;

function unescapeLiteral(value: string): string {
  return value.replace(/\\(["\\nrt])/g, (_all, escape: string) => ({ "n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"' })[escape] ?? escape);
}

/** A deliberately narrow parser: bootstrap accepts only blank-node-free IRI/literal N-Quads. */
export function parseStrictNQuads(source: string, expectedGraph: string): Quad[] {
  const lines = source.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0 || source.endsWith("\n\n")) throw new Error("NQUADS_EMPTY_OR_BLANK_LINE");
  const quads = lines.map((line, index) => {
    const match = linePattern.exec(line);
    if (!match) throw new Error(`NQUADS_UNSUPPORTED_SYNTAX:${index + 1}`);
    const [, subject, predicate, iriObject, literalObject, graph] = match;
    if (graph !== expectedGraph) throw new Error(`NQUADS_GRAPH_MISMATCH:${index + 1}`);
    return {
      subject,
      predicate,
      object: iriObject ?? unescapeLiteral(literalObject ?? ""),
      objectKind: (iriObject === undefined ? "literal" : "iri") as "literal" | "iri",
      graph,
      canonical: line,
    };
  });
  const canonical = quads.map((quad) => quad.canonical).slice().sort();
  if (canonical.some((line, index) => index > 0 && line === canonical[index - 1])) throw new Error("NQUADS_DUPLICATE_QUAD");
  return quads;
}

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalQuadDigest(quads: readonly Quad[]): string {
  return sha256(`${quads.map((quad) => quad.canonical).slice().sort().join("\n")}\n`);
}
