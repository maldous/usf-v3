import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { canonicalJson } from "../core/canonical.ts";

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
  | "SCHEMA_REGISTRY_BOUNDS"
  | "SCHEMA_ID_INVALID"
  | "SCHEMA_ID_DUPLICATE"
  | "SCHEMA_PATH_INVALID"
  | "SCHEMA_FRAGMENT_INVALID"
  | "SCHEMA_REGISTRY_UNKNOWN"
  | "SCHEMA_REGISTRY_DUPLICATE"
  | "SCHEMA_REF_UNRESOLVED"
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
  readonly dependencySchemas?: readonly unknown[];
}

/** Metadata is graph-derived; this module never opens the declared repository path. */
export interface RegisteredSchemaReference {
  readonly identity: string;
  readonly schemaIdentity: string;
  readonly repositoryPath: string;
  readonly schemaFragment: string;
}

export interface RegisteredSchemaDocument extends RegisteredSchemaReference {
  readonly document: unknown;
}

export interface RegisteredValidatorOptions {
  readonly maxErrors?: number;
  readonly externalSchemas: readonly RegisteredSchemaReference[];
  readonly registry: readonly RegisteredSchemaDocument[];
  /**
   * Already authenticated command-local dependencies, such as the generated
   * descriptor schema. They share the ordinary bounded registry with the
   * graph-selected external documents.
   */
  readonly dependencySchemas?: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchemaIdentity(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:[^\s#]+$/.test(value);
}

function isRepositoryPath(value: string): boolean {
  return /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    && !value.split("/").some(segment => segment === "." || segment === "..");
}

function isSchemaFragment(value: string): boolean {
  return value === "" || /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(value);
}

function assertReference(reference: RegisteredSchemaReference): void {
  if (!isSchemaIdentity(reference.identity) || !isSchemaIdentity(reference.schemaIdentity)) {
    throw new SchemaPolicyError("SCHEMA_ID_INVALID", "#/externalSchemas");
  }
  if (!isRepositoryPath(reference.repositoryPath)) throw new SchemaPolicyError("SCHEMA_PATH_INVALID", "#/externalSchemas");
  if (!isSchemaFragment(reference.schemaFragment)) throw new SchemaPolicyError("SCHEMA_FRAGMENT_INVALID", "#/externalSchemas");
}

function schemaFragmentExists(document: unknown, fragment: string): boolean {
  if (fragment === "") return typeof document === "boolean" || isRecord(document);
  let current: unknown = document;
  for (const segment of fragment.slice(1).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return typeof current === "boolean" || isRecord(current);
}

function canonicalSchemaDocument(document: unknown): string {
  try { return canonicalJson(document); }
  catch { throw new SchemaPolicyError("SCHEMA_NOT_JSON", "#/registry"); }
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

function assertSchemaNode(schema: unknown, path: string, registry?: ReadonlySet<string>): void {
  if (typeof schema === "boolean") return;
  if (!isRecord(schema)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", path);

  for (const [keyword, value] of Object.entries(schema)) {
    const keywordPath = childPath(path, keyword);
    if (!ALLOWED_KEYWORDS.has(keyword)) {
      throw new SchemaPolicyError("SCHEMA_KEYWORD_UNSUPPORTED", keywordPath);
    }

    if (keyword === "$ref") {
      if (typeof value !== "string" || (value !== "#" && !value.startsWith("#/"))) {
        if (registry === undefined) throw new SchemaPolicyError("SCHEMA_REF_EXTERNAL", keywordPath);
        const [id, fragment, ...extra] = typeof value === "string" ? value.split("#") : [];
        if (!id || !registry.has(id) || extra.length > 0 || (fragment !== undefined && fragment !== "" && !fragment.startsWith("/"))) {
          throw new SchemaPolicyError("SCHEMA_REF_UNRESOLVED", keywordPath);
        }
      }
      continue;
    }

    if (keyword === "$id" && registry !== undefined && path !== "#") {
      throw new SchemaPolicyError("SCHEMA_ID_INVALID", keywordPath);
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
        assertSchemaNode(child, childPath(keywordPath, name), registry);
      }
      continue;
    }

    if (SCHEMA_ARRAY_KEYWORDS.has(keyword)) {
      if (!Array.isArray(value)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", keywordPath);
      for (let index = 0; index < value.length; index += 1) {
        assertSchemaNode(value[index], childPath(keywordPath, String(index)), registry);
      }
      continue;
    }

    if (SCHEMA_VALUE_KEYWORDS.has(keyword) && typeof value !== "boolean") {
      assertSchemaNode(value, keywordPath, registry);
    }
  }
}

function assertSchemaPolicy(schema: unknown, registry?: ReadonlySet<string>): asserts schema is AnySchema {
  assertJsonValue(schema, "#");
  if (!isRecord(schema)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", "#");
  if (schema.$schema !== DIALECT) {
    throw new SchemaPolicyError("SCHEMA_DIALECT_UNSUPPORTED", "#/$schema");
  }
  assertSchemaNode(schema, "#", registry);
}

/** Bound and snapshot the entire supplied registry before recursive policy checks or AJV. */
function registryDocuments(schema: unknown, dependencies: readonly unknown[]): AnySchema[] {
  if (!Array.isArray(dependencies) || dependencies.length > 32) throw new SchemaPolicyError("SCHEMA_REGISTRY_BOUNDS", "#");
  let nodes = 0, textBytes = 0;
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (++nodes > 100000 || depth > 64) throw new SchemaPolicyError("SCHEMA_REGISTRY_BOUNDS", "#");
    if (typeof value === "string") textBytes += Buffer.byteLength(value, "utf8");
    if (value !== null && typeof value === "object") {
      if (ancestors.has(value)) throw new SchemaPolicyError("SCHEMA_NOT_JSON", "#");
      ancestors.add(value);
      for (const [key, child] of Object.entries(value)) { textBytes += Buffer.byteLength(key, "utf8"); visit(child, depth + 1); }
      ancestors.delete(value);
    }
    if (textBytes > 1048576) throw new SchemaPolicyError("SCHEMA_REGISTRY_BOUNDS", "#");
  }
  const documents = [schema, ...dependencies];
  for (const document of documents) visit(document, 0);
  const ids = new Set<string>();
  for (const document of documents) {
    assertJsonValue(document, "#");
    if (!isRecord(document) || typeof document.$id !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s#]+$/.test(document.$id)) throw new SchemaPolicyError("SCHEMA_ID_INVALID", "#/$id");
    if (ids.has(document.$id)) throw new SchemaPolicyError("SCHEMA_ID_DUPLICATE", "#/$id");
    ids.add(document.$id);
  }
  for (const document of documents) assertSchemaPolicy(document, ids);
  return JSON.parse(JSON.stringify(documents)) as AnySchema[];
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

function compile(schema: AnySchema, documents?: readonly AnySchema[]): ValidateFunction {
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
    if (documents !== undefined) {
      for (const document of documents) ajv.addSchema(document);
      // Compile even unused dependencies: unresolved references cannot hide in the registry.
      for (const document of documents) ajv.getSchema((document as { $id: string }).$id);
      return ajv.getSchema((schema as { $id: string }).$id)!;
    }
    return ajv.compile(schema);
  } catch (error) {
    if (documents !== undefined && typeof error === "object" && error !== null && "missingRef" in error) throw new SchemaPolicyError("SCHEMA_REF_UNRESOLVED", "#/$ref");
    throw new SchemaPolicyError("SCHEMA_COMPILE_FAILED", "#");
  }
}

/**
 * Compile an in-memory JSON Schema through the deliberately narrow V3 profile.
 * The adapter exposes no asynchronous compilation or loader hook; references
 * resolve locally, or within an explicitly supplied bounded in-memory registry.
 */
export function createJsonSchemaValidator<T = unknown>(
  schema: unknown,
  options: ValidatorOptions = {},
): JsonSchemaValidator<T> {
  const documents = options.dependencySchemas === undefined ? undefined : registryDocuments(schema, options.dependencySchemas);
  if (documents === undefined) assertSchemaPolicy(schema);
  const validate = compile(documents?.[0] ?? schema as AnySchema, documents);
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

/**
 * Compose graph-selected external references against an already authenticated
 * in-memory registry. Repository paths remain provenance metadata, never I/O.
 */
export function createRegisteredJsonSchemaValidator<T = unknown>(
  schema: unknown,
  options: RegisteredValidatorOptions,
): JsonSchemaValidator<T> {
  if (!Array.isArray(options.externalSchemas) || !Array.isArray(options.registry)
    || options.externalSchemas.length > 32 || options.registry.length > 32) {
    throw new SchemaPolicyError("SCHEMA_REGISTRY_BOUNDS", "#/externalSchemas");
  }
  const registry = new Map<string, RegisteredSchemaDocument>();
  const documentsByIdentity = new Map<string, { readonly document: unknown; readonly content: string }>();
  for (const entry of options.registry) {
    assertReference(entry);
    if (registry.has(entry.identity)) throw new SchemaPolicyError("SCHEMA_REGISTRY_DUPLICATE", "#/registry");
    if (!isRecord(entry.document) || entry.document.$id !== entry.schemaIdentity) {
      throw new SchemaPolicyError("SCHEMA_ID_INVALID", "#/registry");
    }
    let content: string;
    try { content = JSON.stringify(entry.document); }
    catch { throw new SchemaPolicyError("SCHEMA_NOT_JSON", "#/registry"); }
    const existing = documentsByIdentity.get(entry.schemaIdentity);
    if (existing !== undefined && existing.content !== content) throw new SchemaPolicyError("SCHEMA_REGISTRY_DUPLICATE", "#/registry");
    registry.set(entry.identity, entry);
    documentsByIdentity.set(entry.schemaIdentity, existing ?? { document: entry.document, content });
  }
  const selected: RegisteredSchemaDocument[] = [];
  const references = new Set<string>();
  for (const reference of options.externalSchemas) {
    assertReference(reference);
    if (references.has(reference.identity)) throw new SchemaPolicyError("SCHEMA_REGISTRY_DUPLICATE", "#/externalSchemas");
    references.add(reference.identity);
    const entry = registry.get(reference.identity);
    if (entry === undefined
      || entry.schemaIdentity !== reference.schemaIdentity
      || entry.repositoryPath !== reference.repositoryPath
      || entry.schemaFragment !== reference.schemaFragment) {
      throw new SchemaPolicyError("SCHEMA_REGISTRY_UNKNOWN", "#/externalSchemas");
    }
    if (!schemaFragmentExists(entry.document, reference.schemaFragment)) {
      throw new SchemaPolicyError("SCHEMA_REF_UNRESOLVED", "#/externalSchemas");
    }
    selected.push(entry);
  }
  const rootIdentity = isRecord(schema) && typeof schema.$id === "string" ? schema.$id : null;
  const documents = [...new Set(selected.map(entry => entry.schemaIdentity))].flatMap(identity => {
    const document = documentsByIdentity.get(identity)!.document;
    if (identity !== rootIdentity) return [document];
    if (canonicalSchemaDocument(schema) !== canonicalSchemaDocument(document)) {
      throw new SchemaPolicyError("SCHEMA_REGISTRY_DUPLICATE", "#/$id");
    }
    return [];
  });
  return createJsonSchemaValidator<T>(schema, {
    maxErrors: options.maxErrors,
    dependencySchemas: [...documents, ...(options.dependencySchemas ?? [])],
  });
}
