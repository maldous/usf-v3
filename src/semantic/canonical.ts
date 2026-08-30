import { createHash } from "node:crypto";
import { Writer, type Quad } from "n3";
import { canonize } from "rdf-canonize";
import { SemanticStoreError, semanticReasonCodes } from "./types.ts";

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeNQuads(quads: Iterable<Quad>): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "N-Quads" });
    writer.addQuads(quads);
    writer.end((error, output) => error === null ? resolve(output) : reject(error));
  });
}

export async function canonicalizeDataset(
  quads: Iterable<Quad>,
  options: { readonly timeoutMs: number },
): Promise<{ readonly canonicalNQuads: string; readonly semanticDigest: string }> {
  try {
    const input = await writeNQuads(quads);
    const canonicalNQuads = await canonize(input, {
      algorithm: "RDFC-1.0",
      inputFormat: "application/n-quads",
      maxWorkFactor: 1,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return { canonicalNQuads, semanticDigest: sha256(canonicalNQuads) };
  } catch (error) {
    throw new SemanticStoreError(
      semanticReasonCodes.CANONICALIZATION_FAILED,
      "The RDF dataset could not be canonicalized within its configured bounds.",
      { cause: error instanceof Error ? error.message : "unknown" },
    );
  }
}
