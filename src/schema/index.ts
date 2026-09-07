import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";
const DEFAULT_MAX_ERRORS = 8;
const MAX_ERROR_TEXT = 256;

const ALLOWED_KEYWORDS = new Set([
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
  "uniqueItems",
]);

const SCHEMA_MAP_KEYWORDS = new Set(["$defs", "properties"]);
const SCHEMA_ARRAY_KEYWORDS = new Set(["anyOf", "oneOf"]);
const SCHEMA_VALUE_KEYWORDS = new Set(["additionalProperties", "items"]);

export type SchemaPolicyReason =
  | "SCHEMA_NOT_JSON"
  | "SCHEMA_DIALECT_UNSUPPORTED"
  | "SCHEMA_KEYWORD_UNSUPPORTED"
  | "SCHEMA_REF_EXTERNAL"
  | "SCHEMA_FORMAT_UNSUPPORTED"
  | "SCHEMA_COMPILE_FAILED";

export class SchemaPolicyError extends Error {
  readonly reasonCode: SchemaPolicyReason;
  readonly schemaPath: string;

  constructor(reasonCode: SchemaPolicyReason, schemaPath: string) {
    super(`${reasonCode} at ${schemaPath}`);
    this.name = "SchemaPolicyError";
    this.reasonCode = reasonCode;
    this.schemaPath = schemaPath;
  }
}

export interface ValidationIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly schemaPath: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T; readonly errors: readonly []; readonly truncatedErrors: 0 }
  | { readonly valid: false; readonly errors: readonly ValidationIssue[]; readonly truncatedErrors: number };

export interface JsonSchemaValidator<T = unknown> {
  readonly schemaId: string | null;
  validate(value: unknown): ValidationResult<T>;
}

export interface ValidatorOptions {
  readonly maxErrors?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(parent: string, segment: string): string {
  return `${parent}/${pointerSegment(segment)}`;
}

function assertJsonValue(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertJsonValue(value[index], childPath(path, String(index)));
    }
    return;
  }

  if (!isRecord(value)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", path);
  for (const [key, child] of Object.entries(value)) {
    assertJsonValue(child, childPath(path, key));
  }
}

function assertSchemaNode(schema: unknown, path: string): void {
  if (typeof schema === "boolean") return;
  if (!isRecord(schema)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", path);

  for (const [keyword, value] of Object.entries(schema)) {
    const keywordPath = childPath(path, keyword);
    if (!ALLOWED_KEYWORDS.has(keyword)) {
      throw new SchemaPolicyError("SCHEMA_KEYWORD_UNSUPPORTED", keywordPath);
    }

    if (keyword === "$ref") {
      if (typeof value !== "string" || (value !== "#" && !value.startsWith("#/"))) {
        throw new SchemaPolicyError("SCHEMA_REF_EXTERNAL", keywordPath);
      }
      continue;
    }

    if (keyword === "format") {
      if (value !== "date-time") {
        throw new SchemaPolicyError("SCHEMA_FORMAT_UNSUPPORTED", keywordPath);
      }
      continue;
    }

    if (SCHEMA_MAP_KEYWORDS.has(keyword)) {
      if (!isRecord(value)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", keywordPath);
      for (const [name, child] of Object.entries(value)) {
        assertSchemaNode(child, childPath(keywordPath, name));
      }
      continue;
    }

    if (SCHEMA_ARRAY_KEYWORDS.has(keyword)) {
      if (!Array.isArray(value)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", keywordPath);
      for (let index = 0; index < value.length; index += 1) {
        assertSchemaNode(value[index], childPath(keywordPath, String(index)));
      }
      continue;
    }

    if (SCHEMA_VALUE_KEYWORDS.has(keyword) && typeof value !== "boolean") {
      assertSchemaNode(value, keywordPath);
    }
  }
}

function assertSchemaPolicy(schema: unknown): asserts schema is AnySchema {
  assertJsonValue(schema, "#");
  if (!isRecord(schema)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", "#");
  if (schema.$schema !== DIALECT) {
    throw new SchemaPolicyError("SCHEMA_DIALECT_UNSUPPORTED", "#/$schema");
  }
  assertSchemaNode(schema, "#");
}

function bounded(value: string): string {
  return value.length <= MAX_ERROR_TEXT ? value : `${value.slice(0, MAX_ERROR_TEXT - 1)}…`;
}

function stableMessage(keyword: string): string {
  switch (keyword) {
    case "additionalProperties": return "unexpected property";
    case "anyOf": return "must match an allowed schema";
    case "const": return "must equal the required constant";
    case "enum": return "must equal an allowed value";
    case "format": return "must match the required format";
    case "maxLength": return "must not exceed the maximum length";
    case "maximum": return "must not exceed the maximum";
    case "maxItems": return "must not contain more than the maximum number of items";
    case "maxProperties": return "must not contain more than the maximum number of properties";
    case "minItems": return "must contain at least the minimum number of items";
    case "minLength": return "must satisfy the minimum length";
    case "minimum": return "must not be below the minimum";
    case "oneOf": return "must match exactly one allowed schema";
    case "pattern": return "must match the required pattern";
    case "required": return "missing required property";
    case "type": return "must match the required type";
    case "uniqueItems": return "must contain unique items";
    default: return "schema validation failed";
  }
}

function normalizeErrors(errors: readonly ErrorObject[]): ValidationIssue[] {
  return errors
    .map((error) => ({
      instancePath: bounded(error.instancePath),
      keyword: bounded(error.keyword),
      schemaPath: bounded(error.schemaPath),
      message: stableMessage(error.keyword),
    }))
    .sort((left, right) =>
      left.instancePath.localeCompare(right.instancePath) ||
      left.schemaPath.localeCompare(right.schemaPath) ||
      left.keyword.localeCompare(right.keyword),
    );
}

function compile(schema: AnySchema): ValidateFunction {
  const ajv = new Ajv2020({
    allErrors: true,
    coerceTypes: false,
    logger: false,
    messages: false,
    ownProperties: true,
    removeAdditional: false,
    strictNumbers: true,
    strictRequired: false,
    strictSchema: true,
    strictTuples: true,
    strictTypes: true,
    useDefaults: false,
    validateFormats: false,
  });

  try {
    return ajv.compile(schema);
  } catch {
    throw new SchemaPolicyError("SCHEMA_COMPILE_FAILED", "#");
  }
}

/**
 * Compile an in-memory JSON Schema through the deliberately narrow V3 profile.
 * The adapter exposes no asynchronous compilation or loader hook; references
 * must resolve within the supplied document.
 */
export function createJsonSchemaValidator<T = unknown>(
  schema: unknown,
  options: ValidatorOptions = {},
): JsonSchemaValidator<T> {
  assertSchemaPolicy(schema);
  const validate = compile(schema);
  const requestedLimit = options.maxErrors ?? DEFAULT_MAX_ERRORS;
  const maxErrors = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? requestedLimit
    : DEFAULT_MAX_ERRORS;
  const schemaId = typeof schema === "object" && schema !== null && "$id" in schema && typeof schema.$id === "string"
    ? schema.$id
    : null;

  return Object.freeze({
    schemaId,
    validate(value: unknown): ValidationResult<T> {
      if (validate(value)) {
        const errors = Object.freeze([]) as readonly [];
        return Object.freeze({ valid: true as const, value: value as T, errors, truncatedErrors: 0 as const });
      }

      const normalized = normalizeErrors(validate.errors ?? []);
      const errors = Object.freeze(normalized.slice(0, maxErrors));
      return Object.freeze({
        valid: false,
        errors,
        truncatedErrors: Math.max(0, normalized.length - errors.length),
      });
    },
  });
}
