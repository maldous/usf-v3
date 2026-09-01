import { canonicalDigest } from "../core/canonical.ts";

/**
 * The boundary between graph authority and model output.
 *
 * Authority decides the target path, filename, artefact kind, schema dialect and
 * persistence class. A model is responsible only for the semantic content the
 * artefact contract requires. Output is parsed and checked against the declared
 * type before it is accepted, because a model that emits the wrong format into a
 * declared path produces a syntactically wrong artefact -- the defect class that
 * withdrew five projections.
 */
export type ArtefactValidationCode =
  | "accepted"
  | "empty-output"
  | "json-unparseable"
  | "yaml-unparseable"
  | "not-an-object"
  | "unsupported-schema-dialect"
  | "declares-additional-path"
  | "extension-content-mismatch";

export interface ArtefactValidation {
  readonly accepted: boolean;
  readonly code: ArtefactValidationCode;
  readonly detail: string | null;
  /** Content after any safe normalization, otherwise the input unchanged. */
  readonly content: string;
  readonly contentDigest: string;
  readonly evaluated: true;
}

const supportedSchemaDialects: readonly string[] = Object.freeze([
  "https://json-schema.org/draft/2020-12/schema",
  "http://json-schema.org/draft-07/schema#",
]);

/** A model must not smuggle extra repository effects into its content. */
const additionalPathPattern = /(?:^|\n)\s*(?:```[a-z]*\s*)?(?:\/\/\s*)?(?:file|path|write)\s*:\s*[^\n]*\.(?:ts|json|md|ya?ml|graphql|mjs)\b/iu;

/**
 * A reasoning model emits its deliberation before the answer. That scaffolding
 * is not artefact content, so it is removed before the format check rather than
 * causing a spurious refusal.
 */
function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/giu, "").replace(/^[\s\S]*?<\/think>/iu, "");
}

function stripCodeFence(text: string): string {
  // A model often wraps structured output in a fence. Removing it is safe
  // normalization; anything else about the content is left untouched.
  const fenced = /^\s*```(?:[a-z0-9]+)?\s*\n([\s\S]*?)\n?\s*```\s*$/u.exec(text);
  return fenced === null ? text : fenced[1]!;
}

export interface ArtefactExpectation {
  /** Canonical path from authority, used only for its declared extension. */
  readonly canonicalPath: string;
  /** Declared artefact kind from authority. */
  readonly artefactKind: string | null;
}

export function validateArtefactOutput(
  raw: string,
  expectation: ArtefactExpectation,
): ArtefactValidation {
  const refuse = (code: ArtefactValidationCode, detail: string, content: string): ArtefactValidation =>
    Object.freeze({ accepted: false, code, detail, content, contentDigest: canonicalDigest(content), evaluated: true as const });

  const content = stripCodeFence(stripReasoning(raw)).trim();
  if (content.length === 0) return refuse("empty-output", "the model returned no content", content);
  if (additionalPathPattern.test(content)) {
    return refuse("declares-additional-path",
      "the content declares a file path of its own; repository topology comes from authority, not from output", content);
  }

  const path = expectation.canonicalPath;
  const kind = expectation.artefactKind?.split(":").pop() ?? null;

  if (path.endsWith(".json")) {
    let parsed: unknown;
    try { parsed = JSON.parse(content) as unknown; }
    catch (error) { return refuse("json-unparseable", error instanceof Error ? error.message.slice(0, 160) : "invalid JSON", content); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return refuse("not-an-object", "a declared JSON artefact must be one object", content);
    }
    if (path.endsWith(".schema.json") || kind === "schema") {
      const dialect = (parsed as { $schema?: unknown }).$schema;
      if (typeof dialect !== "string" || !supportedSchemaDialects.includes(dialect)) {
        return refuse("unsupported-schema-dialect",
          `a schema artefact must declare a supported dialect; got ${typeof dialect === "string" ? dialect : "none"}`, content);
      }
    }
    return Object.freeze({
      accepted: true, code: "accepted" as const, detail: null,
      content: `${JSON.stringify(parsed, null, 2)}\n`,
      contentDigest: canonicalDigest(`${JSON.stringify(parsed, null, 2)}\n`), evaluated: true as const,
    });
  }

  if (path.endsWith(".yml") || path.endsWith(".yaml")) {
    // Structural sanity only: a mapping at the root, no tab indentation.
    if (/^\t/mu.test(content)) return refuse("yaml-unparseable", "tab indentation is invalid in YAML", content);
    if (!/^[A-Za-z_][\w-]*\s*:/mu.test(content)) {
      return refuse("yaml-unparseable", "no root mapping key found", content);
    }
    return Object.freeze({
      accepted: true, code: "accepted" as const, detail: null, content: `${content}\n`,
      contentDigest: canonicalDigest(`${content}\n`), evaluated: true as const,
    });
  }

  if (path.endsWith(".md")) {
    if (content.startsWith("{") || content.startsWith("[")) {
      return refuse("extension-content-mismatch", "a document artefact received structured data", content);
    }
    return Object.freeze({
      accepted: true, code: "accepted" as const, detail: null, content: `${content}\n`,
      contentDigest: canonicalDigest(`${content}\n`), evaluated: true as const,
    });
  }

  // A format with no registered checker is refused rather than accepted blind.
  return refuse("extension-content-mismatch",
    `no output checker is registered for this declared path, so the artefact is not accepted: ${path}`, content);
}
