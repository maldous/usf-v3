import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import type { SemanticGraph } from "./index.ts";
import { canonicalQuadDigest } from "./nquads.ts";

export interface CliFieldSpecification {
  readonly id: string; readonly property: string; readonly predicate: string | null; readonly kind: string;
  readonly rule: string;
  readonly minimum: number; readonly maximum: number; readonly collection: boolean;
  readonly minimumLength: number; readonly maximumLength: number;
  readonly minimumValue: number | null; readonly maximumValue: number | null;
  readonly allowedValues: readonly string[];
  readonly record: string | null; readonly dependencies: readonly string[]; readonly explanation: string;
}
export interface CliRecordSpecification {
  readonly id: string; readonly sourceType: string; readonly schemaIdentity: string; readonly fragment: string;
  readonly fields: readonly CliFieldSpecification[];
  readonly alternatives: readonly string[]; readonly discriminator: string | null;
}
export interface CliRecordSpecifications {
  readonly contractIdentity: string; readonly sourceBasis: string;
  readonly records: readonly CliRecordSpecification[];
  readonly gaps: readonly CliTransitionDiagnostic[];
  readonly operationalGaps: readonly CliTransitionDiagnostic[];
  readonly structuralComplete: boolean; readonly executionAuthority: "none";
}

function immutable<TValue>(value: TValue): TValue {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}

export interface CliFieldDerivation {
  readonly recordIdentity: string; readonly subjectIdentity: string; readonly fieldIdentity: string;
  readonly outputPath: readonly string[]; readonly sourcePredicate: string | null; readonly sourceGraphs: readonly string[];
  readonly sourceKind: "subject" | "predicate";
  readonly sourceDigest: string; readonly derivationRule: string;
  readonly dependencies: readonly string[]; readonly explanation: string;
}
export type CliRecordValue = string | number | boolean | { readonly [key: string]: CliRecordValue } | readonly CliRecordValue[];
export interface CliVariantDerivation {
  readonly recordIdentity: string; readonly subjectIdentity: string; readonly selectedRecordIdentity: string;
  readonly outputPath: readonly string[]; readonly sourceGraphs: readonly string[]; readonly sourceDigest: string;
  readonly derivationRule: "urn:usf:cli-field-specification:rule-record-alternatives:1";
}
export interface CliRecordDerivation {
  readonly recordIdentity: string; readonly subjectIdentity: string; readonly sourceBasis: string;
  readonly value: Readonly<Record<string, CliRecordValue>> | null;
  readonly derivations: readonly CliFieldDerivation[]; readonly gaps: readonly CliTransitionDiagnostic[];
  readonly variantDerivations: readonly CliVariantDerivation[];
  readonly operationalGaps: readonly CliTransitionDiagnostic[];
  readonly valid: boolean; readonly complete: boolean; readonly executionAuthority: "none";
}

/** Reauthenticate structural specifications and project values without running operational rules. */
export function deriveCliRecord(
  graph: SemanticGraph,
  selection: { readonly recordIdentity: string; readonly subjectIdentity: string },
  specifications: CliRecordSpecifications,
): CliRecordDerivation {
  if ([selection.recordIdentity, selection.subjectIdentity].some(s => s.length === 0 || s.length > 4096)) throw new RangeError("CLI_RECORD_BOUNDS");
  const current = deriveCliRecordSpecifications(graph, { contractIdentity: specifications.contractIdentity });
  const gaps: CliTransitionDiagnostic[] = [...current.gaps];
  const operationalGaps: CliTransitionDiagnostic[] = [];
  const derivations: CliFieldDerivation[] = [];
  const variantDerivations: CliVariantDerivation[] = [];
  const bad = (subject: string, field: string, reasonCode: string): void => { gaps.push({ subject, field, reasonCode }); };
  if (canonicalJson(current) !== canonicalJson(specifications)) bad(selection.subjectIdentity, "specifications", "CLI_RECORD_SPECIFICATIONS_STALE");
  const records = new Map(current.records.map(r => [r.id, r]));
  const index = new Map<string, typeof graph.quads>();
  for (const q of graph.quads) { const list = index.get(q.subject) ?? []; list.push(q); index.set(q.subject, list); }
  const active = new Set<string>();
  let nodes = 0;
  function read(recordId: string, subject: string, path: readonly string[], depth: number): Record<string, CliRecordValue> | null {
    if (++nodes > 4096 || depth > 32) { bad(subject, recordId, "CLI_RECORD_BOUNDS"); return null; }
    const key = canonicalJson([recordId, subject]);
    if (active.has(key)) { bad(subject, recordId, "CLI_RECORD_CYCLE"); return null; }
    const record = records.get(recordId);
    if (!record) { bad(subject, recordId, "CLI_RECORD_SPECIFICATION_MISSING"); return null; }
    active.add(key);
    const rows = index.get(subject) ?? [];
    if (!rows.some(q => q.predicate === P + "type" && q.objectKind === "iri" && q.object === record.sourceType)) bad(subject, "type", "CLI_RECORD_TYPE_MISMATCH");
    if (record.alternatives.length > 0) {
      const selected = record.alternatives.filter(id => rows.some(q => q.predicate === P + "type" && q.objectKind === "iri" && q.object === records.get(id)!.sourceType));
      if (selected.length !== 1) { bad(subject, recordId, "CLI_RECORD_VARIANT_AMBIGUOUS"); active.delete(key); return null; }
      const source = rows.filter(q => q.predicate === P + "type");
      variantDerivations.push({ recordIdentity: recordId, subjectIdentity: subject, selectedRecordIdentity: selected[0]!, outputPath: path,
        sourceGraphs: sorted(source.map(q => q.graph)), sourceDigest: canonicalQuadDigest(source), derivationRule: "urn:usf:cli-field-specification:rule-record-alternatives:1" });
      const value = read(selected[0]!, subject, path, depth + 1);
      active.delete(key);
      return value;
    }
    const allowed = new Set([P + "type", ...record.fields.map(f => f.predicate)]);
    for (const q of rows) if (!allowed.has(q.predicate)) bad(subject, q.predicate, "CLI_RECORD_FIELD_UNKNOWN");
    const output: Record<string, CliRecordValue> = Object.create(null) as Record<string, CliRecordValue>;
    for (const field of record.fields) {
      const subjectSource = field.rule === "urn:usf:cli-field-specification:rule-subject-identity:1";
      const source = subjectSource ? rows : rows.filter(q => q.predicate === field.predicate);
      const values = [...new Map(source.map(q => [canonicalJson([q.objectKind, q.object]), q])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, q]) => q);
      const outputPath = [...path, field.property];
      derivations.push({ recordIdentity: recordId, subjectIdentity: subject, fieldIdentity: field.id, outputPath,
        sourceKind: subjectSource ? "subject" : "predicate", sourcePredicate: field.predicate, sourceGraphs: sorted(source.map(q => q.graph)), sourceDigest: canonicalQuadDigest(source),
        derivationRule: field.rule, dependencies: field.dependencies, explanation: field.explanation });
      for (const gap of current.operationalGaps.filter(g => g.subject === field.id)) operationalGaps.push(gap);
      if (subjectSource) {
        if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(subject)) bad(subject, field.id, "CLI_RECORD_VALUE_KIND");
        else if ([...subject].length < field.minimumLength || [...subject].length > field.maximumLength) bad(subject, field.id, "CLI_RECORD_VALUE_BOUNDS");
        else if (field.allowedValues.length > 0 && !field.allowedValues.includes(subject)) bad(subject, field.id, "CLI_RECORD_VALUE_NOT_ALLOWED");
        else output[field.property] = subject;
        continue;
      }
      if (values.length < field.minimum || values.length > field.maximum) { bad(subject, field.id, "CLI_RECORD_CARDINALITY"); continue; }
      const converted: CliRecordValue[] = [];
      for (let i = 0; i < values.length; i++) {
        const q = values[i]!;
        if (q.objectKind !== (field.kind === "iri" || field.kind === "record" ? "iri" : "literal")) { bad(subject, field.id, "CLI_RECORD_VALUE_KIND"); continue; }
        const length = [...q.object].length;
        if (length < field.minimumLength || length > field.maximumLength) { bad(subject, field.id, "CLI_RECORD_VALUE_BOUNDS"); continue; }
        if (field.allowedValues.length > 0 && !field.allowedValues.includes(q.object)) { bad(subject, field.id, "CLI_RECORD_VALUE_NOT_ALLOWED"); continue; }
        if (field.kind === "record") {
          const nested = read(field.record!, q.object, field.collection ? [...outputPath, String(i)] : outputPath, depth + 1);
          if (nested !== null) converted.push(nested);
        } else if (field.kind === "integer") {
          const value = Number(q.object);
          if (!/^(0|[1-9][0-9]*)$/.test(q.object) || !Number.isSafeInteger(value) || value < field.minimumValue! || value > field.maximumValue!) bad(subject, field.id, "CLI_RECORD_VALUE_BOUNDS");
          else converted.push(value);
        } else if (field.kind === "boolean") {
          if (q.object !== "true" && q.object !== "false") bad(subject, field.id, "CLI_RECORD_VALUE_KIND");
          else converted.push(q.object === "true");
        } else if (field.kind === "iri" || field.kind === "text") {
          if (field.kind === "iri" && !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(q.object)) bad(subject, field.id, "CLI_RECORD_VALUE_KIND");
          else converted.push(q.object);
        } else bad(subject, field.id, "CLI_RECORD_VALUE_KIND");
      }
      if (field.collection) {
        // Different source identities must not collapse into indistinguishable artifacts.
        if (new Set(converted.map(value => canonicalJson(value))).size !== converted.length) bad(subject, field.id, "CLI_RECORD_PROJECTION_COLLISION");
        output[field.property] = converted;
      }
      else if (converted.length === 1) output[field.property] = converted[0]!;
    }
    active.delete(key);
    return Object.fromEntries(Object.entries(output));
  }
  const value = gaps.length === 0 ? read(selection.recordIdentity, selection.subjectIdentity, [], 0) : null;
  const unique = [...new Map(gaps.map(g => [canonicalJson(g), g])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, g]) => g);
  const uniqueOperational = [...new Map(operationalGaps.map(g => [canonicalJson(g), g])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, g]) => g);
  const valid = unique.length === 0 && value !== null;
  return immutable({ ...selection, sourceBasis: current.sourceBasis, value: valid ? value : null, derivations, variantDerivations, gaps: unique,
    operationalGaps: uniqueOperational, valid, complete: valid && uniqueOperational.length === 0, executionAuthority: "none" as const });
}

/** Interpret field-specification primitives, never domain operational rules or modules. */
export function deriveCliRecordSpecifications(graph: SemanticGraph, selection: { readonly contractIdentity: string }): CliRecordSpecifications {
  const prefix = "urn:usf:cli-field-specification:";
  if (graph.quads.length > 100000 || selection.contractIdentity.length > 4096 || graph.quads.some(q => [q.subject, q.predicate, q.object, q.graph].some(v => v.length > 16384))) throw new RangeError("CLI_SPECIFICATION_BOUNDS");
  const gaps: CliTransitionDiagnostic[] = [], operationalGaps: CliTransitionDiagnostic[] = [];
  const bad = (subject: string, field: string, reasonCode = "CLI_SPECIFICATION_INVALID"): void => { gaps.push({ subject, field, reasonCode }); };
  const index = new Map<string, typeof graph.quads>();
  for (const q of graph.quads) { const list = index.get(q.subject) ?? []; list.push(q); index.set(q.subject, list); }
  const many = (s: string, p: string, kind: "iri" | "literal" = "iri"): string[] => {
    const qs = (index.get(s) ?? []).filter(q => q.predicate === P + p);
    if (qs.some(q => q.objectKind !== kind)) bad(s, p);
    return sorted(qs.filter(q => q.objectKind === kind).map(q => q.object));
  };
  const single = (s: string, p: string, kind: "iri" | "literal" = "iri"): string => { const vs = many(s, p, kind); if (vs.length !== 1) bad(s, p); return vs[0] ?? ""; };
  const typed = (s: string, t: string): void => { if (!many(s, "type").includes(T + t)) bad(s, "type"); };
  const number = (s: string, p: string): number => { const v = single(s, p, "literal"); if (!/^(0|[1-9][0-9]*)$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > 1048576) { bad(s, p); return 0; } return Number(v); };
  typed(selection.contractIdentity, "SemanticContract");
  const roots = [...index.keys()].filter(s => many(s, "forContract").includes(selection.contractIdentity) && many(s, "type").includes(T + "CliFieldSpecificationAmendment"));
  const ids = sorted(roots.flatMap(s => many(s, "recordSpecification")));
  if (ids.length === 0 || ids.length > 64) bad(selection.contractIdentity, "recordSpecification");
  // Reverse amendment discovery must not add schemas outside the required closure.
  const requiredClosure = new Set<string>(), pending = [selection.contractIdentity];
  while (pending.length > 0) {
    const subject = pending.pop()!;
    if (requiredClosure.has(subject)) continue;
    requiredClosure.add(subject);
    for (const q of index.get(subject) ?? []) if (q.objectKind === "iri" && index.has(q.object) && !requiredClosure.has(q.object)) pending.push(q.object);
  }
  for (const id of ids) if (!requiredClosure.has(id)) bad(id, "recordSpecification", "CLI_SPECIFICATION_OUTSIDE_REQUIRED_CLOSURE");
  const records: CliRecordSpecification[] = [];
  let fieldCount = 0;
  for (const id of ids.slice(0, 64)) {
    typed(id, "CliRecordSpecification");
    if (single(id, "version", "literal") !== "1") bad(id, "version");
    if (single(id, "unknownFieldPolicy", "literal") !== "refuse") bad(id, "unknownFieldPolicy");
    const schemaRule = single(id, "schemaDerivationRule");
    if (schemaRule !== prefix + "rule-generate-schema:1") bad(id, "schemaDerivationRule", "CLI_SPECIFICATION_RULE_UNKNOWN");
    typed(schemaRule, "CliFieldDerivationRule");
    const fields: CliFieldSpecification[] = [], properties = new Set<string>();
    const fieldIds = many(id, "fieldSpecification");
    const alternatives = many(id, "recordAlternative");
    const discriminators = many(id, "discriminatorProperty", "literal");
    if (alternatives.length > 0) {
      typed(prefix + "rule-record-alternatives:1", "CliFieldDerivationRule");
      if (alternatives.length < 2 || alternatives.length > 16 || fieldIds.length > 0 || alternatives.some(a => !ids.includes(a))) bad(id, "recordAlternative", "CLI_SPECIFICATION_VARIANT_INVALID");
      if (discriminators.length !== 1 || !/^[A-Za-z][A-Za-z0-9]*$/.test(discriminators[0]!)) bad(id, "discriminatorProperty", "CLI_SPECIFICATION_VARIANT_INVALID");
    } else if (discriminators.length > 0) bad(id, "discriminatorProperty", "CLI_SPECIFICATION_VARIANT_INVALID");
    fieldCount += fieldIds.length;
    if (fieldIds.length === 0 && alternatives.length === 0) bad(id, "fieldSpecification");
    if (fieldCount > 1024) throw new RangeError("CLI_SPECIFICATION_BOUNDS");
    for (const fieldId of fieldIds) {
      typed(fieldId, "CliFieldSpecification");
      if (single(fieldId, "version", "literal") !== "1" || single(fieldId, "sourceRecord") !== id) bad(fieldId, "sourceRecord/version");
      const property = single(fieldId, "outputProperty", "literal");
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(property) || properties.has(property)) bad(fieldId, "outputProperty", "CLI_SPECIFICATION_PROPERTY_CONFLICT");
      properties.add(property);
      const kindId = single(fieldId, "valueKind"); typed(kindId, "CliFieldValueKind");
      const kinds = ["iri", "text", "integer", "boolean", "record"];
      const kind = kinds.find(k => kindId === prefix + "kind-" + k + ":1") ?? "unknown";
      if (kind === "unknown") bad(fieldId, "valueKind", "CLI_SPECIFICATION_KIND_UNKNOWN");
      const rule = single(fieldId, "derivationRule"); typed(rule, "CliFieldDerivationRule");
      const subjectSource = rule === prefix + "rule-subject-identity:1";
      if (rule !== prefix + "rule-predicate-values:1" && !subjectSource) bad(fieldId, "derivationRule", "CLI_SPECIFICATION_RULE_UNKNOWN");
      const collectionValue = single(fieldId, "collection", "literal"), collection = collectionValue === "true";
      if (collectionValue !== "true" && collectionValue !== "false") bad(fieldId, "collection");
      const minimum = number(fieldId, "minimumCardinality"), maximum = number(fieldId, "maximumCardinality");
      const minimumLength = number(fieldId, "minimumLength"), maximumLength = number(fieldId, "maximumLength");
      if (minimum > maximum || maximum > 1024 || (!collection && maximum !== 1) || minimumLength > maximumLength) bad(fieldId, "bounds");
      const allowedValues = many(fieldId, "allowedValue", "literal");
      if (allowedValues.length > 0) {
        typed(prefix + "rule-allowed-values:1", "CliFieldDerivationRule");
        if (!["text", "iri"].includes(kind) || allowedValues.length > 64
          || allowedValues.some(v => v.length === 0 || [...v].length < minimumLength || [...v].length > maximumLength
            || (kind === "iri" && !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(v)))) bad(fieldId, "allowedValue", "CLI_SPECIFICATION_ALLOWED_VALUES_INVALID");
      }
      const minimumValue = kind === "integer" ? number(fieldId, "minimumValue") : null;
      const maximumValue = kind === "integer" ? number(fieldId, "maximumValue") : null;
      if (minimumValue !== null && maximumValue !== null && minimumValue > maximumValue) bad(fieldId, "numericBounds");
      if ((kind === "boolean" && (minimumLength > 4 || maximumLength < 5))
        || (kind === "integer" && minimumValue !== null && maximumValue !== null
          && (minimumLength > String(minimumValue).length || maximumLength < String(maximumValue).length))) {
        bad(fieldId, "lexicalBounds", "CLI_SPECIFICATION_LEXICAL_BOUNDS_INCOMPATIBLE");
      }
      const refs = many(fieldId, "recordSpecification");
      if ((kind === "record" && (refs.length !== 1 || !ids.includes(refs[0]!))) || (kind !== "record" && refs.length > 0)) bad(fieldId, "recordSpecification");
      const dependencies = many(fieldId, "derivationDependency");
      if (dependencies.length === 0) bad(fieldId, "derivationDependency");
      for (const requirement of many(fieldId, "semanticRuleRequirement")) {
        if (requirement !== prefix + "rule-operational-rule-required:1") bad(fieldId, "semanticRuleRequirement", "CLI_SPECIFICATION_RULE_UNKNOWN");
        typed(requirement, "CliFieldDerivationRule");
        operationalGaps.push({ subject: fieldId, field: property, reasonCode: "CLI_OPERATIONAL_RULE_UNRESOLVED" });
      }
      const explanation = single(fieldId, "text", "literal"); if (explanation.length === 0) bad(fieldId, "text");
      const predicate = subjectSource ? null : single(fieldId, "sourcePredicate");
      if (subjectSource) {
        if ((index.get(fieldId) ?? []).some(q => q.predicate === P + "sourcePredicate") || kind !== "iri" || collection || minimum !== 1 || maximum !== 1) bad(fieldId, "sourcePredicate/kind/cardinality", "CLI_SPECIFICATION_SUBJECT_SOURCE_INVALID");
      } else if (predicate === null || !index.has(predicate)) bad(fieldId, "sourcePredicate", "CLI_SPECIFICATION_SOURCE_UNRESOLVED");
      fields.push({ id: fieldId, property, predicate, rule, kind, minimum, maximum, collection, minimumLength, maximumLength, minimumValue, maximumValue, allowedValues, record: refs[0] ?? null, dependencies, explanation });
    }
    records.push({ id, sourceType: single(id, "sourceType"), schemaIdentity: single(id, "schemaIdentity"), fragment: single(id, "schemaFragment", "literal"), alternatives, discriminator: discriminators[0] ?? null, fields: fields.sort((a, b) => a.property < b.property ? -1 : a.property > b.property ? 1 : 0) });
  }
  const links = new Map<string, readonly string[]>();
  const fieldIds = new Set(records.flatMap(r => r.fields.map(f => f.id)));
  for (const r of records) {
    links.set(r.id, [...r.alternatives, ...r.fields.filter(f => f.record !== null).map(f => f.record!)]);
    if (r.alternatives.length > 0) {
      const tags = new Set<string>(), types = new Set<string>();
      for (const id of r.alternatives) {
        const alternative = records.find(record => record.id === id);
        const tag = alternative?.fields.find(f => f.property === r.discriminator);
        if (!alternative || alternative.alternatives.length > 0 || !tag || tag.kind !== "text" || tag.collection || tag.minimum !== 1 || tag.allowedValues.length !== 1
          || tags.has(tag.allowedValues[0]!) || types.has(alternative.sourceType) || alternative.sourceType === r.sourceType) {
          bad(r.id, id, "CLI_SPECIFICATION_VARIANT_INVALID");
        } else { tags.add(tag.allowedValues[0]!); types.add(alternative.sourceType); }
      }
    }
    for (const f of r.fields) {
      for (const dep of f.dependencies) if (!ids.includes(dep) && !fieldIds.has(dep)) bad(f.id, dep, "CLI_SPECIFICATION_DEPENDENCY_MISSING");
      links.set(f.id, f.dependencies.filter(dep => fieldIds.has(dep)));
    }
  }
  const active = new Set<string>(), done = new Set<string>();
  function visit(id: string): void { if (active.has(id)) { bad(id, "dependencies", "CLI_SPECIFICATION_CYCLE"); return; } if (done.has(id)) return; active.add(id); for (const dep of links.get(id) ?? []) visit(dep); active.delete(id); done.add(id); }
  for (const id of links.keys()) visit(id);
  const rootRecords = records.filter(r => r.fragment === "");
  if (rootRecords.length !== 1 || new Set(records.map(r => r.fragment)).size !== records.length || new Set(records.map(r => r.schemaIdentity)).size !== 1) bad(selection.contractIdentity, "schemaIdentity/schemaFragment");
  for (const r of records) if ((r.fragment !== "" && !/^\/\$defs\/[A-Za-z][A-Za-z0-9]*$/.test(r.fragment)) || !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s#]+$/.test(r.schemaIdentity)) bad(r.id, "schemaIdentity/schemaFragment");
  return immutable({ ...selection, sourceBasis: canonicalQuadDigest(graph.quads), records, gaps, operationalGaps, structuralComplete: gaps.length === 0, executionAuthority: "none" as const });
}

export function deriveCliSchemas(specifications: CliRecordSpecifications): Readonly<{
  descriptorSchema: Readonly<Record<string, unknown>> | null; interrogationDescriptorReference: Readonly<{ $ref: string }> | null;
  sourceBasis: string; digest: string | null; gaps: readonly CliTransitionDiagnostic[]; operationalGaps: readonly CliTransitionDiagnostic[]; executionAuthority: "none";
}> {
  const common = { sourceBasis: specifications.sourceBasis, gaps: specifications.gaps, operationalGaps: specifications.operationalGaps, executionAuthority: "none" as const };
  if (!specifications.structuralComplete) return immutable({ ...common, descriptorSchema: null, interrogationDescriptorReference: null, digest: null });
  const records = new Map(specifications.records.map(r => [r.id, r]));
  const shapes = new Map<string, Record<string, unknown>>();
  for (const r of records.values()) {
    if (r.alternatives.length > 0) {
      shapes.set(r.id, { oneOf: r.alternatives.map(id => ({ $ref: "#" + records.get(id)!.fragment })) });
      continue;
    }
    const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const f of r.fields) {
      let shape: Record<string, unknown>;
      if (f.kind === "record") shape = { $ref: "#" + records.get(f.record!)!.fragment };
      else if (f.kind === "integer") shape = { type: "integer", minimum: f.minimumValue, maximum: f.maximumValue };
      else if (f.kind === "boolean") shape = { type: "boolean" };
      else shape = { type: "string", minLength: f.minimumLength, maxLength: f.maximumLength, ...(f.kind === "iri" ? { pattern: "^[A-Za-z][A-Za-z0-9+.-]*:[^\\s]+$" } : {}) };
      if (f.allowedValues.length === 1) shape.const = f.allowedValues[0];
      else if (f.allowedValues.length > 1) shape.enum = f.allowedValues;
      properties[f.property] = f.collection ? { type: "array", minItems: f.minimum, maxItems: f.maximum, uniqueItems: true, items: shape, description: f.explanation } : { ...shape, description: f.explanation };
    }
    shapes.set(r.id, { type: "object", additionalProperties: false, properties, required: r.fields.filter(f => f.collection || f.minimum > 0).map(f => f.property) });
  }
  const root = specifications.records.find(r => r.fragment === "")!;
  const defs = Object.fromEntries(specifications.records.filter(r => r.fragment !== "").map(r => [r.fragment.slice("/$defs/".length), shapes.get(r.id)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  const descriptorSchema = JSON.parse(canonicalJson({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: root.schemaIdentity, ...shapes.get(root.id), $defs: defs })) as Record<string, unknown>;
  return immutable({ ...common, descriptorSchema, interrogationDescriptorReference: { $ref: root.schemaIdentity }, digest: canonicalDigest(descriptorSchema) });
}

export function verifyCliDescriptorSchema(
  graph: SemanticGraph,
  selection: { readonly contractIdentity: string },
  suppliedSchema: unknown,
) {
  const generated = deriveCliSchemas(deriveCliRecordSpecifications(graph, selection));
  let suppliedDigest: string | null = null;
  try { suppliedDigest = canonicalDigest(suppliedSchema); } catch { /* Invalid JSON cannot match generated authority. */ }
  const matches = generated.digest !== null && suppliedDigest === generated.digest;
  return immutable({
    matches,
    reasonCode: generated.digest === null ? "CLI_SPECIFICATION_INCOMPLETE"
      : matches ? "CLI_DESCRIPTOR_SCHEMA_MATCH" : "CLI_DESCRIPTOR_SCHEMA_DRIFT",
    sourceBasis: generated.sourceBasis,
    expectedDigest: generated.digest,
    suppliedDigest,
    gaps: generated.gaps,
    operationalGaps: generated.operationalGaps,
    executionAuthority: "none" as const,
  });
}

export interface CliTransitionInventory {
  readonly leaves: readonly { readonly path: readonly string[]; readonly owner: string | null; readonly parserOwner: string | null }[];
  readonly complete: boolean;
}
export interface CliTransitionAdapter { readonly id: string; readonly effectClass: string }
export type CliParallelSafetyAssessment = Readonly<Record<string, CliRecordValue>> & { readonly state: "unproven" | "blocked" | "proved" };
export interface CliTransitionDiagnostic { readonly reasonCode: string; readonly subject: string; readonly field: string }
interface CliTransitionTopology {
  readonly id: string;
  readonly requiresTransition: readonly string[];
  readonly consumes: readonly string[];
  readonly produces: readonly string[];
}
export interface CliTransitionCoverageReport {
  readonly schema: "urn:usf:cli-transition-interrogation:1";
  readonly rootIdentity: string;
  readonly manifestPath: string;
  readonly graphDigest: string;
  readonly work: string | null;
  readonly contract: string | null;
  readonly profile: string | null;
  readonly profileCandidates: readonly string[];
  readonly requiredGraphRefs: readonly string[];
  readonly descriptors: readonly Readonly<Record<string, CliRecordValue>>[];
  readonly waves: readonly (readonly string[])[];
  readonly topologicalOnly: boolean;
  readonly parallelSafety: CliParallelSafetyAssessment;
  readonly terminalClosure: { readonly declared: readonly string[]; readonly derived: readonly string[]; readonly equal: boolean };
  readonly diagnostics: readonly CliTransitionDiagnostic[];
  readonly complete: boolean;
  readonly reasonCode: "TRANSITION_COVERAGE_COMPLETE" | "TRANSITION_SEMANTICS_INCOMPLETE";
  readonly executionAuthority: "none";
  readonly digest: string;
}

const P = "urn:usf:predicate:";
const T = "urn:usf:type:";
const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort();
const same = (a: readonly string[], b: readonly string[]): boolean => canonicalJson(a) === canonicalJson(b);

export function deriveCliTransitionContext(graph: SemanticGraph, root: string) {
  const diagnostics: CliTransitionDiagnostic[] = [];
  const values = (subject: string, field: string): string[] => {
    const rows = graph.quads.filter(q => q.subject === subject && q.predicate === P + field);
    if (rows.some(q => q.objectKind !== "iri")) diagnostics.push({ reasonCode: "TRANSITION_FIELD_KIND_INVALID", subject, field });
    return sorted(rows.filter(q => q.objectKind === "iri").map(q => q.object));
  };
  const work = values(root, "type").includes(T + "WorkPacket") ? root : null;
  if (work === null) diagnostics.push({ reasonCode: graph.quads.some(q => q.subject === root) ? "TRANSITION_ROOT_UNINTERPRETABLE" : "TRANSITION_ROOT_MISSING", subject: root, field: "type" });
  const contracts = work === null ? [] : values(work, "contract");
  const contract = contracts.length === 1 ? contracts[0]! : null;
  if (work !== null && contract === null) diagnostics.push({ reasonCode: contracts.length > 1 ? "TRANSITION_FIELD_AMBIGUOUS" : "TRANSITION_FIELD_MISSING", subject: root, field: "contract" });
  const candidates = sorted(graph.quads.filter(q => q.predicate === P + "selectsContract" && q.objectKind === "iri" && q.object === contract).map(q => q.subject));
  const profileCandidates = candidates.filter(s => values(s, "type").includes(T + "RealisationProfile"));
  for (const candidate of profileCandidates) values(candidate, "selectsContract");
  const profile = profileCandidates.length === 1 ? profileCandidates[0]! : null;
  if (profile === null) diagnostics.push({ reasonCode: profileCandidates.length > 1 ? "TRANSITION_PROFILE_AMBIGUOUS" : "TRANSITION_PROFILE_MISSING", subject: root, field: "selectsContract" });
  return immutable({ work, contract, profile, profileCandidates, diagnostics, executionAuthority: "none" as const });
}

export function deriveCliTransitionCoverage(
  graph: SemanticGraph,
  selection: { readonly rootIdentity: string; readonly manifestPath: string },
  inventory: CliTransitionInventory,
  adapters: readonly CliTransitionAdapter[],
): CliTransitionCoverageReport {
  const boundedText = (value: string): boolean => typeof value === "string" && value.length > 0 && value.length <= 4096;
  if (!boundedText(selection.rootIdentity) || !boundedText(selection.manifestPath)
    || graph.quads.length > 100000 || inventory.leaves.length > 4096 || adapters.length > 4096
    || inventory.leaves.some(l => l.path.length === 0 || l.path.length > 32 || l.path.some(p => !boundedText(p)) || (l.owner !== null && !boundedText(l.owner)) || (l.parserOwner !== null && !boundedText(l.parserOwner)))
    || adapters.some(a => !boundedText(a.id) || !boundedText(a.effectClass))
    || graph.quads.some(q => [q.subject, q.predicate, q.graph].some(v => !boundedText(v))
      || (q.objectKind === "literal" ? typeof q.object !== "string" || q.object.length > 4096 : q.objectKind !== "iri" || !boundedText(q.object)))) {
    throw new RangeError("TRANSITION_INPUT_BOUNDS_EXCEEDED");
  }
  const diagnostics: CliTransitionDiagnostic[] = [];
  const issue = (reasonCode: string, subject: string, field: string): void => { diagnostics.push({ reasonCode, subject, field }); };
  const rows = new Map<string, typeof graph.quads>();
  for (const quad of graph.quads) {
    const entries = rows.get(quad.subject) ?? [];
    entries.push(quad);
    rows.set(quad.subject, entries);
  }
  const values = (subject: string, field: string, kind: "iri" | "literal" = "iri"): string[] => {
    const found = (rows.get(subject) ?? []).filter(q => q.predicate === P + field);
    if (found.some(q => q.objectKind !== kind)) issue("TRANSITION_FIELD_KIND_INVALID", subject, field);
    return sorted(found.filter(q => q.objectKind === kind).map(q => q.object));
  };
  const one = (subject: string, field: string, kind: "iri" | "literal" = "iri"): string | null => {
    const found = values(subject, field, kind);
    if (found.length !== 1 || found[0] === "") {
      issue(found.length > 1 ? "TRANSITION_FIELD_AMBIGUOUS" : "TRANSITION_FIELD_MISSING", subject, field);
      return null;
    }
    return found[0]!;
  };
  const typed = (subject: string, type: string): boolean => values(subject, "type").includes(T + type);
  const root = selection.rootIdentity;
  const context = deriveCliTransitionContext(graph, root);
  const { work, contract, profile, profileCandidates: profiles } = context;
  diagnostics.push(...context.diagnostics);
  const requiredGraphRefs = sorted([...(contract === null ? [] : [contract, ...values(contract, "requires")]), ...(work === null ? [] : values(work, "validation"))]);
  const reached = new Set(work === null ? [] : values(work, "transition"));
  // Explicit prerequisites remain visible; downstream discovery cannot cross ownership.
  let changed = true;
  while (changed) {
    changed = false;
    for (const subject of rows.keys()) {
      const parents = values(subject, "requiresTransition");
      if (reached.has(subject)) for (const parent of parents) if (!reached.has(parent)) { reached.add(parent); changed = true; }
      if (contract !== null && values(subject, "owner").length === 1
        && values(subject, "owner")[0] === contract
        && parents.some(parent => reached.has(parent)) && !reached.has(subject)) {
        reached.add(subject); changed = true;
      }
    }
    if (reached.size > 1024) throw new RangeError("TRANSITION_DESCRIPTOR_BOUNDS_EXCEEDED");
  }
  const ids = sorted([...reached]);
  if (ids.length === 0) issue("TRANSITION_SEMANTICS_INCOMPLETE", root, "transition");
  if (!inventory.complete) issue("TRANSITION_INVENTORY_INCOMPLETE", root, "inventory");

  const specifications = contract === null ? null : deriveCliRecordSpecifications(graph, { contractIdentity: contract });
  const descriptorRecord = specifications?.records.find(record => record.fragment === "");
  const descriptors: Readonly<Record<string, CliRecordValue>>[] = [];
  const topology: CliTransitionTopology[] = ids.map(id => {
    if (!typed(id, "CliTransitionDescriptor")) issue("TRANSITION_DESCRIPTOR_TYPE_MISSING", id, "type");
    if (one(id, "owner") !== contract) issue("TRANSITION_OWNER_CONFLICT", id, "owner");
    if (specifications === null || descriptorRecord === undefined || descriptorRecord.sourceType !== T + "CliTransitionDescriptor") {
      issue("CLI_SPECIFICATION_INCOMPLETE", id, "recordSpecification");
    } else {
      const projection = deriveCliRecord(graph, { recordIdentity: descriptorRecord.id, subjectIdentity: id }, specifications);
      diagnostics.push(...projection.gaps, ...projection.operationalGaps);
      if (projection.value !== null) descriptors.push(projection.value);
    }
    // Structural projection does not authenticate operational evaluators or adapters.
    issue("TRANSITION_EVALUATORS_UNAUTHENTICATED", id, "operationalRules");
    issue("TRANSITION_ADAPTER_UNMAPPED", id, "adapter");
    return { id, requiresTransition: values(id, "requiresTransition"), consumes: values(id, "consumes"), produces: values(id, "produces") };
  });
  if (specifications !== null) diagnostics.push(...specifications.gaps, ...specifications.operationalGaps);
  // Command binding must be derived by the same semantic rules, not another path parser.
  for (const leaf of inventory.leaves) issue("TRANSITION_IMPLEMENTATION_ONLY_LEAF", canonicalJson(leaf.path), "inventory");
  const producers = new Map<string, string[]>();
  for (const d of topology) for (const a of d.produces) producers.set(a, [...(producers.get(a) ?? []), d.id]);
  const dependencies = new Map(topology.map(d => [d.id, new Set(d.requiresTransition)]));
  for (const d of topology) {
    for (const predecessor of d.requiresTransition) if (!ids.includes(predecessor)) issue("TRANSITION_DANGLING_DEPENDENCY", d.id, predecessor);
    for (const artifact of sorted([...d.consumes, ...d.produces])) {
      if (!typed(artifact, "CliArtifactContract")) issue("TRANSITION_ARTIFACT_TYPE_MISSING", artifact, "type");
      if (!same(values(artifact, "work"), work === null ? [] : [work]) || !same(values(artifact, "profile"), profile === null ? [] : [profile])) issue("TRANSITION_ARTIFACT_SCOPE_CONFLICT", artifact, "work/profile");
      const source = producers.get(artifact) ?? [];
      if (source.length !== 1 || !same(values(artifact, "producer"), source)) issue("TRANSITION_ARTIFACT_PRODUCER_CONFLICT", artifact, "producer");
      if (d.consumes.includes(artifact)) for (const sourceId of source) dependencies.get(d.id)!.add(sourceId);
    }
  }
  // Kahn layers are a deterministic projection, never an execution schedule.
  const remaining = new Set(ids), visited = new Set<string>(), waves: string[][] = [];
  while (remaining.size > 0) {
    const wave = sorted([...remaining].filter(id => [...dependencies.get(id)!].every(dep => visited.has(dep))));
    if (wave.length === 0) { for (const id of remaining) issue("TRANSITION_DAG_BLOCKED", id, "dependencies"); break; }
    waves.push(wave);
    for (const id of wave) { remaining.delete(id); visited.add(id); }
  }
  const declared = work === null ? [] : values(work, "terminalArtifact");
  const consumed = new Set(topology.flatMap(d => [...d.consumes]));
  const derived = sorted([...producers.keys()].filter(id => !consumed.has(id)));
  if (!(declared.length > 0 && same(declared, derived) && visited.size === ids.length && ids.length > 0)) issue("TRANSITION_TERMINAL_CLOSURE_MISMATCH", root, "terminalArtifact");
  // Unconsumed artifacts are only a topological census, not terminal obligation closure.
  const equal = false;
  issue("TRANSITION_TERMINAL_OBLIGATIONS_UNAUTHENTICATED", root, "terminalArtifact/recovery");
  const uniqueDiagnostics = [...new Map(diagnostics.map(d => [canonicalJson(d), d])).values()].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
  // Bind every selected named-source quad, including referenced semantics not projected above.
  const graphDigest = canonicalQuadDigest(graph.quads);
  const body = { schema: "urn:usf:cli-transition-interrogation:1" as const, ...selection, graphDigest, work, contract, profile, profileCandidates: profiles, requiredGraphRefs, descriptors, waves,
    topologicalOnly: true, parallelSafety: { state: "unproven" as const, members: ids, semanticBasis: graphDigest,
      assessmentRule: "urn:usf:cli-field-specification:rule-parallel-assessment-boundary:1",
      missingObligations: ["urn:usf:cli-field-specification:rule-parallel-assessment-boundary:1"],
      reasonCodes: ["TRANSITION_PARALLEL_SAFETY_UNAUTHENTICATED"] },
    terminalClosure: { declared, derived, equal }, diagnostics: uniqueDiagnostics, complete: uniqueDiagnostics.length === 0,
    reasonCode: uniqueDiagnostics.length === 0 ? "TRANSITION_COVERAGE_COMPLETE" as const : "TRANSITION_SEMANTICS_INCOMPLETE" as const, executionAuthority: "none" as const };
  function freeze<TValue>(value: TValue): TValue {
    if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
  }
  return freeze({ ...body, digest: canonicalDigest(body) });
}
