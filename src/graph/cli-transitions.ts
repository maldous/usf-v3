import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import type { SemanticGraph } from "./index.ts";
import { canonicalQuadDigest } from "./nquads.ts";
import { deriveLinearBindingDeclaration, LinearBindingError, type LinearBindingAuthority } from "./linear-binding.ts";

const EXTERNAL_SCHEMA_RULE = "urn:usf:rule:ordinary-boundary-external-schema:1";

function boundedBindingPrompt(graph: SemanticGraph, quad: SemanticGraph["quads"][number]): boolean {
  if (quad.objectKind !== "literal" || quad.predicate !== "urn:usf:predicate:fixedPrompt") return false;
  try { return deriveLinearBindingDeclaration(graph, quad.subject).fixedPrompt === quad.object; }
  catch (error) { if (error instanceof LinearBindingError) return false; throw error; }
}

export interface CliExternalSchemaReference {
  readonly identity: string;
  readonly schemaIdentity: string;
  readonly repositoryPath: string;
  readonly schemaFragment: string;
}

export interface CliFieldSpecification {
  readonly id: string; readonly property: string; readonly predicate: string | null; readonly kind: string;
  readonly rule: string;
  readonly minimum: number; readonly maximum: number; readonly collection: boolean;
  readonly collectionOrderingRule?: string;
  readonly minimumLength: number; readonly maximumLength: number;
  readonly minimumValue: number | null; readonly maximumValue: number | null;
  readonly allowedValues: readonly string[];
  readonly record: string | null; readonly externalSchemas: readonly CliExternalSchemaReference[];
  readonly dependencies: readonly string[]; readonly explanation: string;
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
      if (field.collectionOrderingRule !== undefined) {
        bad(subject, field.id, "CLI_RECORD_ORDERED_SOURCE_UNAVAILABLE");
        continue;
      }
      if (field.kind === "external-schema") {
        bad(subject, field.id, "CLI_RECORD_EXTERNAL_SCHEMA_UNAVAILABLE");
        continue;
      }
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
  if (graph.quads.length > 100000 || selection.contractIdentity.length > 4096 || graph.quads.some(q => [q.subject, q.predicate, q.graph].some(v => v.length > 16384) || (q.object.length > 16384 && !boundedBindingPrompt(graph, q)))) throw new RangeError("CLI_SPECIFICATION_BOUNDS");
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
  const number = (s: string, p: string, maximum = 1048576): number => { const v = single(s, p, "literal"); if (!/^(0|[1-9][0-9]*)$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > maximum) { bad(s, p); return 0; } return Number(v); };
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
      const kinds = ["iri", "text", "integer", "boolean", "record", "external-schema"];
      const kind = kinds.find(k => kindId === prefix + "kind-" + k + ":1") ?? "unknown";
      if (kind === "unknown") bad(fieldId, "valueKind", "CLI_SPECIFICATION_KIND_UNKNOWN");
      const rule = single(fieldId, "derivationRule"); typed(rule, "CliFieldDerivationRule");
      const subjectSource = rule === prefix + "rule-subject-identity:1";
      const externalSchema = kind === "external-schema";
      if (externalSchema ? rule !== EXTERNAL_SCHEMA_RULE : rule !== prefix + "rule-predicate-values:1" && !subjectSource) {
        bad(fieldId, "derivationRule", "CLI_SPECIFICATION_RULE_UNKNOWN");
      }
      const collectionValue = single(fieldId, "collection", "literal"), collection = collectionValue === "true";
      if (collectionValue !== "true" && collectionValue !== "false") bad(fieldId, "collection");
      const orderingRules = many(fieldId, "collectionOrderingRule");
      if (orderingRules.length > 0) {
        if (orderingRules.length !== 1 || !collection || subjectSource
          || ![prefix + "rule-native-trace-sequence:1", prefix + "rule-native-ordered-sequence:1"].includes(orderingRules[0]!)) {
          bad(fieldId, "collectionOrderingRule", "CLI_SPECIFICATION_RULE_UNKNOWN");
        } else {
          typed(orderingRules[0]!, "CliFieldDerivationRule");
          if (single(orderingRules[0]!, "version", "literal") !== "1") bad(fieldId, "collectionOrderingRule");
        }
      }
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
      const minimumValue = kind === "integer" ? number(fieldId, "minimumValue", 16_777_216) : null;
      const maximumValue = kind === "integer" ? number(fieldId, "maximumValue", 16_777_216) : null;
      if (minimumValue !== null && maximumValue !== null && minimumValue > maximumValue) bad(fieldId, "numericBounds");
      if ((kind === "boolean" && (minimumLength > 4 || maximumLength < 5))
        || (kind === "integer" && minimumValue !== null && maximumValue !== null
          && (minimumLength > String(minimumValue).length || maximumLength < String(maximumValue).length))) {
        bad(fieldId, "lexicalBounds", "CLI_SPECIFICATION_LEXICAL_BOUNDS_INCOMPATIBLE");
      }
      const refs = many(fieldId, "recordSpecification");
      if ((kind === "record" && (refs.length !== 1 || !ids.includes(refs[0]!))) || (kind !== "record" && refs.length > 0)) bad(fieldId, "recordSpecification");
      const externalSchemas: CliExternalSchemaReference[] = [];
      const externalIds = many(fieldId, "externalSchema");
      if (externalSchema !== (externalIds.length > 0)) bad(fieldId, "externalSchema", "CLI_SPECIFICATION_EXTERNAL_SCHEMA_INVALID");
      if (externalIds.length > 32 || new Set(externalIds).size !== externalIds.length) bad(fieldId, "externalSchema", "CLI_SPECIFICATION_EXTERNAL_SCHEMA_INVALID");
      for (const externalId of externalIds) {
        if (!requiredClosure.has(externalId)) bad(fieldId, "externalSchema", "CLI_SPECIFICATION_EXTERNAL_SCHEMA_UNRESOLVED");
        typed(externalId, "SemanticRecordSchema");
        if (single(externalId, "version", "literal") !== "1") bad(externalId, "version", "CLI_SPECIFICATION_EXTERNAL_SCHEMA_INVALID");
        const schemaIdentity = single(externalId, "schemaIdentity");
        const repositoryPath = single(externalId, "repositoryPath", "literal");
        const schemaFragment = single(externalId, "schemaFragment", "literal");
        if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s#]+$/.test(schemaIdentity)
          || !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repositoryPath)
          || repositoryPath.split("/").some(segment => segment === "." || segment === "..")
          || !(schemaFragment === "" || /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(schemaFragment))) {
          bad(externalId, "schemaIdentity/repositoryPath/schemaFragment", "CLI_SPECIFICATION_EXTERNAL_SCHEMA_INVALID");
        }
        externalSchemas.push({ identity: externalId, schemaIdentity, repositoryPath, schemaFragment });
      }
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
      fields.push({ id: fieldId, property, predicate, rule, kind, minimum, maximum, collection,
        ...(orderingRules.length === 1 ? { collectionOrderingRule: orderingRules[0]! } : {}),
        minimumLength, maximumLength, minimumValue, maximumValue, allowedValues, record: refs[0] ?? null,
        externalSchemas, dependencies, explanation });
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
      if (f.kind === "external-schema") {
        const references = f.externalSchemas.map(reference => ({ $ref: reference.schemaIdentity + (reference.schemaFragment === "" ? "" : "#" + reference.schemaFragment) }));
        shape = references.length === 1 ? references[0]! : { oneOf: references };
      }
      else if (f.kind === "record") shape = { $ref: "#" + records.get(f.record!)!.fragment };
      else if (f.kind === "integer") shape = { type: "integer", minimum: f.minimumValue, maximum: f.maximumValue };
      else if (f.kind === "boolean") shape = { type: "boolean" };
      else shape = { type: "string", minLength: f.minimumLength, maxLength: f.maximumLength, ...(f.kind === "iri" ? { pattern: "^[A-Za-z][A-Za-z0-9+.-]*:[^\\s]+$" } : {}) };
      if (f.allowedValues.length === 1) shape.const = f.allowedValues[0];
      else if (f.allowedValues.length > 1) shape.enum = f.allowedValues;
      properties[f.property] = f.collection ? { type: "array", minItems: f.minimum, maxItems: f.maximum,
        ...(f.collectionOrderingRule === undefined ? { uniqueItems: true } : {}),
        items: shape, description: f.explanation } : { ...shape, description: f.explanation };
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
  readonly parserSource?: CliCanonicalParserSource;
}
export interface CliCanonicalParserBinding {
  readonly identity: string;
  readonly version: string;
  readonly namedCommand: string;
  readonly adapterIdentity: string;
  readonly canonicalSelectorTokens: readonly string[];
  readonly forwardedArgumentOffset: number;
  readonly fallbackRegion: Readonly<{ identity: string; sourceDispatchSurfaceToken: string; complementOf: string }>;
}
export interface CliCanonicalParserSource {
  readonly contracts: readonly CliCanonicalParserBinding[];
  readonly sourcePath: string;
  readonly parserExport: string;
}
export function canonicalParserCommandPath(binding: CliCanonicalParserBinding): string {
  return binding.canonicalSelectorTokens.slice(0, binding.forwardedArgumentOffset + 1).join(" ");
}
export interface CliParserCoverage {
  readonly sourceBasis: string;
  readonly status: "partial" | "unavailable";
  readonly matchedSelectors: readonly (CliCanonicalParserBinding & Readonly<{ sourcePath: string; parserExport: string }>)[];
  readonly unresolvedRegions: readonly string[];
  readonly diagnostics: readonly CliTransitionDiagnostic[];
}

export function deriveCliParserCoverage(graph: SemanticGraph, contract: string | null, source?: CliCanonicalParserSource,
  specifications = contract === null ? null : deriveCliRecordSpecifications(graph, { contractIdentity: contract })): CliParserCoverage {
  const p = "urn:usf:predicate:", t = "urn:usf:type:";
  const diagnostics: CliTransitionDiagnostic[] = [];
  const matchedSelectors: Array<CliCanonicalParserBinding & { sourcePath: string; parserExport: string }> = [];
  const values = (subject: string, field: string, kind: "iri" | "literal" = "iri") =>
    graph.quads.filter(q => q.subject === subject && q.predicate === p + field && q.objectKind === kind).map(q => q.object);
  const issue = (subject: string, field: string, reasonCode = "CLI_PARSER_CONTRACT_MISMATCH") => diagnostics.push({ subject, field, reasonCode });
  const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;
  const exact = (subject: string, field: string, kind: "iri" | "literal", expected: string) => {
    const rows = graph.quads.filter(q => q.subject === subject && q.predicate === p + field);
    const distinct = new Map(rows.map(row => [canonicalJson([row.objectKind, row.object]), row]));
    if (distinct.size !== 1 || rows.some(row => row.objectKind !== kind || row.object !== expected)) issue(subject, field);
  };
  const ids = sorted(graph.quads.filter(q => q.predicate === p + "type" && q.objectKind === "iri"
    && q.object === t + "CliCanonicalParserContract" && contract !== null && values(q.subject, "forContract").includes(contract)).map(q => q.subject));
  const sourceBasis = canonicalQuadDigest(graph.quads);
  const record = specifications?.records.find(item => item.fragment === "/$defs/parserCoverage");
  const selectorField = record?.fields.find(field => field.property === "matchedSelectors");
  const regionField = record?.fields.find(field => field.property === "unresolvedRegions");
  const diagnosticField = record?.fields.find(field => field.property === "diagnostics");
  const selectorRecord = specifications?.records.find(item => item.id === selectorField?.record);
  const tokenField = selectorRecord?.fields.find(field => field.property === "canonicalSelectorTokens");
  const offsetField = selectorRecord?.fields.find(field => field.property === "forwardedArgumentOffset");
  const versionField = selectorRecord?.fields.find(field => field.property === "version");
  const fallbackField = selectorRecord?.fields.find(field => field.property === "fallbackRegion");
  const fallbackRecord = specifications?.records.find(item => item.id === fallbackField?.record);
  const surfaceField = fallbackRecord?.fields.find(field => field.property === "sourceDispatchSurfaceToken");
  if (!specifications || specifications.gaps.length > 0 || !selectorField || !regionField || !diagnosticField || !tokenField || !offsetField || !versionField
    || !surfaceField || selectorField.maximum < 1 || diagnosticField.maximum < 1 || offsetField.minimumValue === null || offsetField.maximumValue === null) {
    return immutable({ sourceBasis, status: "unavailable", matchedSelectors: [], unresolvedRegions: [],
      diagnostics: [{ subject: contract ?? "urn:usf:cli", field: "parserCoverage", reasonCode: "CLI_PARSER_CENSUS_SCHEMA_UNAVAILABLE" }] });
  }
  if (ids.length > selectorField.maximum || (source !== undefined && (source === null || !Array.isArray(source.contracts) || source.contracts.length > selectorField.maximum))) {
    return immutable({ sourceBasis, status: "unavailable", matchedSelectors: [], unresolvedRegions: [],
      diagnostics: [{ subject: contract ?? "urn:usf:cli", field: "parserContracts", reasonCode: "CLI_PARSER_CENSUS_BOUNDS_EXCEEDED" }] });
  }
  const unresolvedRegions = sorted(ids.flatMap(id => values(id, "fallbackRegion")));
  if (unresolvedRegions.length > regionField.maximum) return immutable({ sourceBasis, status: "unavailable", matchedSelectors: [], unresolvedRegions: [],
    diagnostics: [{ subject: contract ?? "urn:usf:cli", field: "fallbackRegion", reasonCode: "CLI_PARSER_CENSUS_BOUNDS_EXCEEDED" }] });
  if (ids.length === 0 || source === undefined || !text(source.sourcePath) || !text(source.parserExport)) {
    issue(contract ?? "urn:usf:cli", "parserContracts", "CLI_PARSER_CENSUS_UNAVAILABLE");
  } else {
    const seen = new Set<string>(), selectors = new Set<string>();
    const selectorSequences: Array<readonly string[]> = [];
    for (const binding of source.contracts) {
      if (!binding || !text(binding.identity) || !text(binding.version) || !text(binding.namedCommand) || !text(binding.adapterIdentity)
        || !Array.isArray(binding.canonicalSelectorTokens) || binding.canonicalSelectorTokens.length < tokenField.minimum || binding.canonicalSelectorTokens.length > tokenField.maximum
        || binding.canonicalSelectorTokens.some(token => !text(token) || token.length < tokenField.minimumLength || token.length > tokenField.maximumLength || /\s/.test(token))
        || !Number.isSafeInteger(binding.forwardedArgumentOffset) || binding.forwardedArgumentOffset < offsetField.minimumValue
        || binding.forwardedArgumentOffset > offsetField.maximumValue || binding.forwardedArgumentOffset >= binding.canonicalSelectorTokens.length
        || (versionField.allowedValues.length > 0 && !versionField.allowedValues.includes(binding.version))
        || binding.version.length < versionField.minimumLength || binding.version.length > versionField.maximumLength
        || !binding.fallbackRegion || !text(binding.fallbackRegion.identity) || !text(binding.fallbackRegion.sourceDispatchSurfaceToken)
        || binding.fallbackRegion.complementOf !== binding.identity
        || binding.fallbackRegion.sourceDispatchSurfaceToken.length < surfaceField.minimumLength || binding.fallbackRegion.sourceDispatchSurfaceToken.length > surfaceField.maximumLength
        || binding.fallbackRegion.sourceDispatchSurfaceToken !== binding.canonicalSelectorTokens[0]) {
        issue(contract!, "parserContracts", "CLI_PARSER_SOURCE_INVALID");
        continue;
      }
      const before = diagnostics.length;
      const selector = canonicalJson(binding.canonicalSelectorTokens);
      if (seen.has(binding.identity) || selectors.has(selector)) issue(binding.identity, "canonicalSelectorTokens", "CLI_PARSER_SOURCE_DUPLICATE");
      if (selectorSequences.some(tokens => tokens.slice(0, Math.min(tokens.length, binding.canonicalSelectorTokens.length))
        .every((token, index) => token === binding.canonicalSelectorTokens[index]))) issue(binding.identity, "canonicalSelectorTokens", "CLI_PARSER_SELECTOR_OVERLAP");
      seen.add(binding.identity);
      selectors.add(selector);
      selectorSequences.push(binding.canonicalSelectorTokens);
      if (!ids.includes(binding.identity)) issue(binding.identity, "forContract", "CLI_PARSER_SOURCE_UNADMITTED");
      exact(binding.identity, "type", "iri", t + "CliCanonicalParserContract");
      exact(binding.identity, "forContract", "iri", contract!);
      exact(binding.identity, "version", "literal", binding.version);
      exact(binding.identity, "registeredCommand", "iri", binding.namedCommand);
      exact(binding.identity, "adapterIdentity", "iri", binding.adapterIdentity);
      exact(binding.identity, "canonicalSelectorTokens", "literal", selector);
      exact(binding.identity, "forwardedArgumentOffset", "literal", String(binding.forwardedArgumentOffset));
      exact(binding.identity, "sourcePath", "literal", source.sourcePath);
      exact(binding.identity, "canonicalParserExport", "literal", source.parserExport);
      exact(binding.identity, "fallbackRegion", "iri", binding.fallbackRegion.identity);
      exact(binding.namedCommand, "type", "iri", t + "RegisteredCliCommand");
      exact(binding.namedCommand, "forContract", "iri", contract!);
      exact(binding.namedCommand, "adapterIdentity", "iri", binding.adapterIdentity);
      exact(binding.namedCommand, "commandPath", "literal", canonicalParserCommandPath(binding));
      exact(binding.fallbackRegion.identity, "type", "iri", t + "CliCanonicalParserFallbackRegion");
      exact(binding.fallbackRegion.identity, "sourceDispatchSurfaceToken", "literal", binding.fallbackRegion.sourceDispatchSurfaceToken);
      exact(binding.fallbackRegion.identity, "complementOf", "iri", binding.identity);
      if (diagnostics.length === before) matchedSelectors.push({ identity: binding.identity, version: binding.version,
        namedCommand: binding.namedCommand, adapterIdentity: binding.adapterIdentity,
        canonicalSelectorTokens: [...binding.canonicalSelectorTokens], forwardedArgumentOffset: binding.forwardedArgumentOffset,
        sourcePath: source.sourcePath, parserExport: source.parserExport,
        fallbackRegion: { identity: binding.fallbackRegion.identity, sourceDispatchSurfaceToken: binding.fallbackRegion.sourceDispatchSurfaceToken,
          complementOf: binding.fallbackRegion.complementOf } });
    }
    for (const id of ids) if (!seen.has(id)) issue(id, "parserExport", "CLI_PARSER_SOURCE_MISSING");
  }
  if (diagnostics.length > diagnosticField.maximum) return immutable({ sourceBasis, status: "unavailable", matchedSelectors: [], unresolvedRegions,
    diagnostics: [{ subject: contract ?? "urn:usf:cli", field: "diagnostics", reasonCode: "CLI_PARSER_CENSUS_BOUNDS_EXCEEDED" }] });
  const ordered = [...new Map(diagnostics.map(d => [canonicalJson(d), d])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, d]) => d);
  return immutable({ sourceBasis, status: ordered.length === 0 ? "partial" : "unavailable",
    matchedSelectors: ordered.length === 0 ? matchedSelectors.sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0) : [],
    unresolvedRegions, diagnostics: ordered });
}
export interface CliTransitionAdapter {
  readonly id: string; readonly effectClass: string;
  readonly operationalSupportDefinition?: CliOperationalSupportDefinition;
  /** Trusted compiled inspection only; serialized adapter declarations cannot authenticate support. */
  readonly inspect?: (graph: SemanticGraph, selection: { readonly rootIdentity: string; readonly manifestPath: string }, transitionIdentity: string) => readonly CliTransitionDiagnostic[];
  /** Native observations are prepared by the command kernel, never by schema projection. */
  readonly operationalSupport?: (graph: SemanticGraph, selection: { readonly rootIdentity: string; readonly manifestPath: string }, projection: CliRecordDerivation) => CliOperationalSupport | null;
}
export type CliOperationalFact = Readonly<{ factKind: string; identity: string; digest: string }>;
export type CliOperationalSupport = Readonly<{
  readonly sourceBasis: string;
  readonly transitionIdentity: string;
  readonly implementation: "authenticated";
  readonly lockAvailability: "not-observed";
  readonly derivations: readonly Readonly<{
    fieldIdentity: string;
    outputPath: readonly string[];
    sourceDigest: string;
    authenticatedFacts: readonly CliOperationalFact[];
  }>[];
}> & (
  | Readonly<{ outcome: "current" }>
  | Readonly<{ outcome: "missing-prerequisite"; unavailableInputs: readonly Readonly<{
      factKind: string; identity: string; state: string; reasonCode: string;
    }>[] }>
  | Readonly<{ outcome: "refused"; refusalClass: "stale" | "unsafe" | "mixed" | "unclassified"; refusalCode: string }>
);
export type CliParallelSafetyAssessment = Readonly<Record<string, CliRecordValue>> & { readonly state: "unproven" | "blocked" | "proved" };
export interface CliTransitionDiagnostic { readonly reasonCode: string; readonly subject: string; readonly field: string }
export interface CliOperationalSupportDefinition {
  readonly identity: string;
  readonly version: string;
  readonly recordIdentity: string;
  readonly outputSchema: string;
  readonly implementationPaths: readonly string[];
}

/** Shared admission for native observation and its later coverage projection. */
export function inspectCliOperationalSupportAdmission(
  graph: SemanticGraph, adapterIdentity: string, definition: CliOperationalSupportDefinition | undefined,
): readonly CliTransitionDiagnostic[] {
  const refused = (field: string): CliTransitionDiagnostic => ({
    reasonCode: "TRANSITION_OPERATIONAL_SUPPORT_UNADMITTED", subject: adapterIdentity, field,
  });
  if (definition === undefined || !Array.isArray(definition.implementationPaths)
    || definition.implementationPaths.length === 0 || definition.implementationPaths.length > 64) {
    return [refused("operationalSatisfactionRule")];
  }
  const diagnostics: CliTransitionDiagnostic[] = [];
  const expect = (subject: string, predicate: string, kind: "iri" | "literal", expected: readonly string[]) => {
    const rows = graph.quads.filter(row => row.subject === subject && row.predicate === `urn:usf:predicate:${predicate}`);
    const actual = [...new Set(rows.map(row => row.object))].sort();
    if (rows.some(row => row.objectKind !== kind)
      || canonicalJson(actual) !== canonicalJson([...new Set(expected)].sort())) diagnostics.push(refused(predicate));
  };
  expect(adapterIdentity, "operationalSatisfactionRule", "iri", [definition.identity]);
  expect(definition.identity, "type", "iri", ["urn:usf:type:OperationalSatisfactionRule"]);
  expect(definition.identity, "version", "literal", [definition.version]);
  expect(definition.identity, "operationalOutputSchema", "iri", [definition.outputSchema]);
  expect(definition.identity, "recordSpecification", "iri", [definition.recordIdentity]);
  expect(definition.identity, "implementationPath", "literal", definition.implementationPaths);
  return diagnostics;
}
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
  readonly operationalSupport: readonly CliOperationalSupport[];
  readonly parserCoverage: CliParserCoverage;
  readonly waves: readonly (readonly string[])[];
  readonly topologicalOnly: boolean;
  readonly parallelSafety: CliParallelSafetyAssessment;
  readonly terminalClosure: { readonly declared: readonly string[]; readonly derived: readonly string[]; readonly equal: boolean; readonly assessment: CliTerminalAssessment };
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
export const consistentArtifactProducer = (declared: readonly string[], observed: readonly string[]): boolean => observed.length === 1 && same(sorted(declared), sorted(observed));

/** Shared structural reachability; this never authenticates execution or artifact state. */
export function deriveCliTransitionIds(subjects: readonly string[], values: (subject: string, field: string) => string[], work: string | null, contract: string | null): readonly string[] {
  const reached = new Set(work === null ? [] : values(work, "transition"));
  let changed = true;
  while (changed) {
    changed = false;
    for (const subject of subjects) {
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
  return Object.freeze(sorted([...reached]));
}

export function deriveCliTransitionContext(graph: SemanticGraph, root: string) {
  const diagnostics: CliTransitionDiagnostic[] = [];
  const values = (subject: string, field: string): string[] => {
    const rows = graph.quads.filter(q => q.subject === subject && q.predicate === P + field);
    if (rows.some(q => q.objectKind !== "iri")) diagnostics.push({ reasonCode: "TRANSITION_FIELD_KIND_INVALID", subject, field });
    return sorted(rows.filter(q => q.objectKind === "iri").map(q => q.object));
  };
  const types = values(root, "type");
  let binding: LinearBindingAuthority | null = null;
  let work: string | null = types.includes(T + "WorkPacket") ? root : null;
  if (types.includes(T + "LinearIssueWorkBinding")) {
    if (work !== null) {
      work = null;
      diagnostics.push({ reasonCode: "TRANSITION_ROOT_AMBIGUOUS", subject: root, field: "type" });
    } else {
      try {
        binding = deriveLinearBindingDeclaration(graph, root);
        work = values(binding.workIri, "type").includes(T + "WorkPacket") ? binding.workIri : null;
        if (work === null) diagnostics.push({ reasonCode: "TRANSITION_BOUND_WORK_MISSING", subject: binding.workIri, field: "type" });
      } catch (error) {
        if (!(error instanceof LinearBindingError)) throw error;
        diagnostics.push({ reasonCode: error.reasonCode, subject: root, field: "binding" });
      }
    }
  }
  if (work === null) diagnostics.push({ reasonCode: graph.quads.some(q => q.subject === root) ? "TRANSITION_ROOT_UNINTERPRETABLE" : "TRANSITION_ROOT_MISSING", subject: root, field: "type" });
  const contracts = work === null ? [] : values(work, "contract");
  const contract = contracts.length === 1 ? contracts[0]! : null;
  if (work !== null && contract === null) diagnostics.push({ reasonCode: contracts.length > 1 ? "TRANSITION_FIELD_AMBIGUOUS" : "TRANSITION_FIELD_MISSING", subject: work, field: "contract" });
  const candidates = sorted(graph.quads.filter(q => q.predicate === P + "selectsContract" && q.objectKind === "iri" && q.object === contract).map(q => q.subject));
  const profileCandidates = candidates.filter(s => values(s, "type").includes(T + "RealisationProfile"));
  for (const candidate of profileCandidates) values(candidate, "selectsContract");
  const profile = binding === null
    ? profileCandidates.length === 1 ? profileCandidates[0]! : null
    : profileCandidates.includes(binding.profile) ? binding.profile : null;
  if (profile === null) diagnostics.push({ reasonCode: binding !== null ? "TRANSITION_BINDING_PROFILE_MISMATCH" : profileCandidates.length > 1 ? "TRANSITION_PROFILE_AMBIGUOUS" : "TRANSITION_PROFILE_MISSING", subject: root, field: "selectsContract" });
  return immutable({ work, contract, profile, profileCandidates, binding, diagnostics, executionAuthority: "none" as const });
}

export interface CliTerminalDiagnostic {
  readonly reasonCode: string;
  readonly subject: string;
  readonly property?: string;
  readonly predicate?: string;
  readonly rule?: string;
  readonly expectedType?: string;
  readonly scope?: string;
  readonly sourceDigest: string;
  readonly ruleDigest?: string;
  readonly observedTargets: readonly string[];
}

export interface CliTerminalAssessment {
  /** Present only when the selected generated terminal record declares the native attachment field. */
  readonly authenticatedArtifacts?: readonly CliRecordValue[];
  /** Present only when the selected generated terminal record declares branch assessments. */
  readonly branchAssessments?: readonly CliRecordValue[];
  readonly declarations: readonly string[];
  readonly semanticBasis: string;
  readonly diagnostics: readonly CliTerminalDiagnostic[];
  readonly nodes: readonly { readonly identity: string; readonly semanticType: string; readonly sourceDigest: string; readonly state: "unverified" | "missing-semantics" }[];
  readonly edges: readonly { readonly source: string; readonly predicate: string; readonly target: string; readonly rule: string }[];
  readonly requiredTransitions: readonly string[];
  readonly terminalArtifacts: readonly string[];
  readonly structuralComplete: boolean;
  readonly satisfaction: "unverified";
  readonly reasonCodes: readonly string[];
}

/** Read declared obligation relationships only; source declarations never authenticate satisfaction. */
export function deriveCliTerminalAssessment(graph: SemanticGraph, root: string): CliTerminalAssessment {
  const context = deriveCliTransitionContext(graph, root);
  const diagnostics = new Map<string, CliTerminalDiagnostic>();
  const nodes = new Map<string, CliTerminalAssessment["nodes"][number]>();
  const edges = new Map<string, CliTerminalAssessment["edges"][number]>();
  const semanticBasis = canonicalQuadDigest(graph.quads);
  const rows = new Map<string, typeof graph.quads>();
  if (graph.quads.length > 100000) throw new RangeError("TRANSITION_INPUT_BOUNDS_EXCEEDED");
  for (const quad of graph.quads) { const list = rows.get(quad.subject) ?? []; list.push(quad); rows.set(quad.subject, list); }
  type Details = Partial<Omit<CliTerminalDiagnostic, "reasonCode" | "subject" | "sourceDigest" | "ruleDigest">>;
  const note = (reasonCode: string, subject: string = root, details: Details = {}): void => {
    const diagnostic: CliTerminalDiagnostic = { ...details, reasonCode, subject,
      sourceDigest: canonicalQuadDigest(rows.get(subject) ?? []),
      ...(details.rule === undefined ? {} : { ruleDigest: canonicalQuadDigest(rows.get(details.rule) ?? []) }),
      observedTargets: sorted(details.observedTargets ?? []) };
    if (diagnostic.observedTargets.length > 1024) throw new RangeError("TRANSITION_INPUT_BOUNDS_EXCEEDED");
    const key = canonicalJson(diagnostic);
    if (!diagnostics.has(key) && diagnostics.size >= 1024) throw new RangeError("TRANSITION_INPUT_BOUNDS_EXCEEDED");
    diagnostics.set(key, diagnostic);
  };
  for (const diagnostic of context.diagnostics) note(diagnostic.reasonCode, diagnostic.subject, { property: diagnostic.field });
  const values = (subject: string, predicate: string, details: Details = {}): string[] => {
    const found = (rows.get(subject) ?? []).filter(q => q.predicate === predicate);
    if (found.some(q => q.objectKind !== "iri")) note("TRANSITION_TERMINAL_EDGE_KIND_INVALID", subject, { ...details, predicate, observedTargets: found.filter(q => q.objectKind === "iri").map(q => q.object) });
    return sorted(found.filter(q => q.objectKind === "iri").map(q => q.object));
  };
  const typed = (id: string, type: string) => values(id, P + "type").includes(type);
  const declarations = context.contract === null ? [] : values(context.contract, P + "requires")
    .filter(id => typed(id, T + "CliTerminalClosureDeclaration"));
  const specifications = context.contract === null ? null : deriveCliRecordSpecifications(graph, { contractIdentity: context.contract });
  const terminalRecord = specifications?.records.find(record => record.fragment === "/$defs/terminalAssessment");
  const attachmentCandidates = terminalRecord?.fields.filter(field => field.predicate === P + "authenticatedTerminalArtifact") ?? [];
  const detachedAttachment = attachmentCandidates.length === 1
    && attachmentCandidates[0]!.collection && attachmentCandidates[0]!.minimum === 0
    && attachmentCandidates[0]!.kind === "record" && attachmentCandidates[0]!.record !== null
    ? attachmentCandidates[0]!.property : null;
  const branchAssessmentCandidates = terminalRecord?.fields.filter(field => field.predicate === P + "terminalBranchAssessment") ?? [];
  const branchAssessmentProperty = branchAssessmentCandidates.length === 1
    && branchAssessmentCandidates[0]!.property === "branchAssessments"
    && branchAssessmentCandidates[0]!.collection && branchAssessmentCandidates[0]!.minimum === 0
    && branchAssessmentCandidates[0]!.kind === "record" && branchAssessmentCandidates[0]!.record !== null
    ? branchAssessmentCandidates[0]!.property : null;
  if (branchAssessmentCandidates.length > 0 && branchAssessmentProperty === null) {
    note("TRANSITION_TERMINAL_BRANCH_ASSESSMENT_FIELD_INVALID", terminalRecord?.id ?? root, { property: "branchAssessments" });
  }
  let terminalArtifacts: string[] = [], branchTerminalArtifacts: string[] = [], branchProofObligations: string[] = [], requiredTransitions: string[] = [];
  let branchAssessments: CliRecordValue[] = [];
  const finish = (): CliTerminalAssessment => immutable({ declarations, semanticBasis,
    ...(detachedAttachment === null ? {} : { [detachedAttachment]: [] }),
    ...(branchAssessmentProperty === null ? {} : { [branchAssessmentProperty]: branchAssessments }),
    nodes: [...nodes.values()].sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0),
    edges: [...edges.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, edge]) => edge),
    terminalArtifacts, requiredTransitions, structuralComplete: diagnostics.size === 0,
    diagnostics: [...diagnostics.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, diagnostic]) => diagnostic),
    satisfaction: "unverified", reasonCodes: sorted([...diagnostics.values()].map(diagnostic => diagnostic.reasonCode)) });
  if (context.contract === null || context.work === null || context.profile === null || specifications === null) return finish();
  if (declarations.length !== 1) { note("TRANSITION_TERMINAL_DECLARATION_MISSING_OR_AMBIGUOUS", context.contract, { predicate: P + "requires", expectedType: T + "CliTerminalClosureDeclaration", observedTargets: declarations }); return finish(); }
  const read = (fragment: string, subject: string): Readonly<Record<string, CliRecordValue>> | null => {
    const records = specifications.records.filter(r => r.fragment === "/$defs/" + fragment);
    if (records.length !== 1) { note("TRANSITION_TERMINAL_SPECIFICATION_MISSING", subject, { property: fragment, expectedType: T + "CliRecordSpecification" }); return null; }
    const result = deriveCliRecord(graph, { recordIdentity: records[0]!.id, subjectIdentity: subject }, specifications);
    for (const gap of result.gaps) note(gap.reasonCode, gap.subject, { property: gap.field, rule: records[0]!.id });
    return result.valid ? result.value : null;
  };
  const iris = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(v));
  const declaration = read("terminalDeclaration", declarations[0]!);
  if (!declaration || declaration.work !== context.work || declaration.profile !== context.profile
    || typeof declaration.closureRule !== "string" || !iris(declaration.roots)
    || !iris(declaration.transitions) || !iris(declaration.terminalArtifacts)) {
    note("TRANSITION_TERMINAL_DECLARATION_INVALID", declarations[0]!, { property: "terminalDeclaration" }); return finish();
  }
  terminalArtifacts = sorted(declaration.terminalArtifacts);
  if (branchAssessmentProperty !== null) {
    if (!Array.isArray(declaration.branches)) {
      note("TRANSITION_TERMINAL_BRANCH_DECLARATION_INVALID", declarations[0]!, { property: "branches" });
      return finish();
    }
    const branchTransitions = new Set<string>(), branchArtifacts = new Set<string>(), branchProofs = new Set<string>();
    for (const candidate of declaration.branches) {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
        note("TRANSITION_TERMINAL_BRANCH_DECLARATION_INVALID", declarations[0]!, { property: "branches" });
        continue;
      }
      const branch = candidate as Readonly<Record<string, CliRecordValue>>;
      const transitions = iris(branch.transitions) ? branch.transitions : null;
      const artifacts = iris(branch.terminalArtifacts) ? branch.terminalArtifacts : null;
      if (typeof branch.identity !== "string" || typeof branch.work !== "string" || typeof branch.profile !== "string"
        || typeof branch.proofObligation !== "string" || typeof branch.terminalAssessmentRule !== "string"
        || transitions === null || artifacts === null || artifacts.length === 0
        || branch.work !== context.work || branch.profile !== context.profile) {
        note("TRANSITION_TERMINAL_BRANCH_DECLARATION_INVALID", typeof branch.identity === "string" ? branch.identity : declarations[0]!, { property: "branches" });
        continue;
      }
      for (const transition of transitions) branchTransitions.add(transition);
      for (const artifact of artifacts) branchArtifacts.add(artifact);
      branchProofs.add(branch.proofObligation);
      const branchSourceDigest = canonicalQuadDigest(rows.get(branch.identity) ?? []);
      const evaluatorDigest = canonicalQuadDigest(rows.get(branch.terminalAssessmentRule) ?? []);
      const reasonCodes = ["TERMINAL_BRANCH_EVALUATOR_UNAVAILABLE"];
      const obligations: CliRecordValue[] = [
        { obligationIdentity: branch.proofObligation, obligationKind: "proof", outcome: "unknown", sourceDigest: branchSourceDigest, reasonCodes },
        ...artifacts.map(artifact => ({ obligationIdentity: artifact, obligationKind: "artifact", outcome: "unknown", sourceDigest: branchSourceDigest, artifactIdentity: artifact, reasonCodes })),
      ];
      branchAssessments.push({ branchIdentity: branch.identity, work: branch.work, profile: branch.profile,
        semanticBasis, branchSourceDigest, derivationRule: branch.terminalAssessmentRule, evaluatorDigest,
        applicability: "unknown", outcome: "unknown", obligations, nativeFactDigests: [], reasonCodes });
    }
    branchAssessments = branchAssessments.sort((left, right) => {
      const a = String((left as Readonly<Record<string, CliRecordValue>>).branchIdentity);
      const b = String((right as Readonly<Record<string, CliRecordValue>>).branchIdentity);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    branchTerminalArtifacts = sorted([...branchArtifacts]);
    branchProofObligations = sorted([...branchProofs]);
    if (branchAssessments.length !== declaration.branches.length
      || !same(sorted([...branchTransitions]), sorted(declaration.transitions))
      || !same(sorted([...branchTransitions]), values(context.work, P + "transition"))) {
      note("TRANSITION_TERMINAL_BRANCH_CLOSURE_MISMATCH", declarations[0]!, { property: "branches" });
    }
  }
  if (!same(sorted(declaration.roots), sorted([context.work, context.contract]))) note("TRANSITION_TERMINAL_ROOT_SCOPE_CONFLICT", declarations[0]!, { predicate: P + "closureRoot", observedTargets: declaration.roots });
  if (!same(sorted(declaration.transitions), values(context.work, P + "transition"))) note("TRANSITION_TERMINAL_TRANSITION_DENOMINATOR_CONFLICT", declarations[0]!, { predicate: P + "transition", observedTargets: declaration.transitions });
  if (terminalArtifacts.length === 0) note("TRANSITION_TERMINAL_ARTIFACT_DECLARATION_MISSING", declarations[0]!, { predicate: P + "terminalArtifact", expectedType: T + "CliArtifactContract", rule: declaration.closureRule });
  const policy = read("terminalPolicy", declaration.closureRule);
  const bound = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
  if (!policy || !Array.isArray(policy.edges) || !bound(policy.maxNodes, 1024) || !bound(policy.maxEdges, 1024) || !bound(policy.maxDepth, 32)) {
    note("TRANSITION_TERMINAL_POLICY_INVALID", declaration.closureRule, { property: "terminalPolicy" }); return finish();
  }
  interface EdgeRule { identity: string; sourceType: string; predicate: string; targetType: string; scope: string; required: boolean }
  const rules: EdgeRule[] = [];
  const ruleKeys = new Set<string>();
  for (const value of policy.edges) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) { note("TRANSITION_TERMINAL_POLICY_INVALID", declaration.closureRule, { property: "terminalPolicy" }); continue; }
    const rule = value as Readonly<Record<string, CliRecordValue>>;
    if (![rule.identity, rule.sourceType, rule.predicate, rule.targetType, rule.scope].every(v => typeof v === "string")
      || typeof rule.required !== "boolean" || !["owner", "work-profile", "contract", "reference"].includes(String(rule.scope))) {
      note("TRANSITION_TERMINAL_POLICY_INVALID", declaration.closureRule, { property: "terminalPolicy" }); continue;
    }
    const typedRule = rule as unknown as EdgeRule, key = canonicalJson([rule.sourceType, rule.predicate]);
    if (ruleKeys.has(key)) note("TRANSITION_TERMINAL_EDGE_RULE_AMBIGUOUS", declaration.closureRule, { predicate: typedRule.predicate, rule: typedRule.identity, expectedType: typedRule.sourceType });
    ruleKeys.add(key); rules.push(typedRule);
  }
  if (rules.length !== policy.edges.length || rules.length === 0 || ruleKeys.size !== rules.length) return finish();
  const pending: { identity: string; semanticType: string; depth: number; rule?: EdgeRule }[] = [
    { identity: context.work, semanticType: T + "WorkPacket", depth: 0 },
    { identity: context.contract, semanticType: T + "SemanticContract", depth: 0 },
    ...declaration.transitions.map(identity => ({ identity, semanticType: T + "CliTransitionDescriptor", depth: 0 })),
    ...terminalArtifacts.map(identity => ({ identity, semanticType: T + "CliArtifactContract", depth: 0 })),
    ...branchTerminalArtifacts.map(identity => ({ identity, semanticType: T + "CliArtifactContract", depth: 0 })),
    ...branchProofObligations.map(identity => ({ identity, semanticType: T + "ProofObligation", depth: 0 })),
  ];
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index]!;
    const previous = nodes.get(current.identity);
    if (previous) { if (previous.semanticType !== current.semanticType) note("TRANSITION_TERMINAL_TYPE_CONFLICT", current.identity, { predicate: P + "type", expectedType: current.semanticType, rule: current.rule?.identity, observedTargets: [previous.semanticType] }); continue; }
    if (nodes.size >= policy.maxNodes || current.depth > policy.maxDepth) { note("TRANSITION_TERMINAL_BOUNDS_EXCEEDED", current.identity, { property: nodes.size >= policy.maxNodes ? "maximumNodes" : "maximumDepth", rule: declaration.closureRule }); break; }
    const valid = typed(current.identity, current.semanticType);
    nodes.set(current.identity, { identity: current.identity, semanticType: current.semanticType,
      sourceDigest: canonicalQuadDigest(rows.get(current.identity) ?? []), state: valid ? "unverified" : "missing-semantics" });
    if (!valid) { note("TRANSITION_TERMINAL_NODE_MISSING_OR_WRONG_TYPE", current.identity, { predicate: P + "type", expectedType: current.semanticType, rule: current.rule?.identity, observedTargets: values(current.identity, P + "type") }); continue; }
    if ((current.semanticType === T + "CliArtifactContract"
      && (!same(values(current.identity, P + "work"), [context.work]) || !same(values(current.identity, P + "profile"), [context.profile])))
      || (current.semanticType === T + "CliTransitionDescriptor" && !same(values(current.identity, P + "owner"), [context.contract]))) {
      note("TRANSITION_TERMINAL_NODE_SCOPE_CONFLICT", current.identity, { property: "nodeScope", scope: current.semanticType === T + "CliArtifactContract" ? "work-profile" : "owner", rule: current.rule?.identity });
    }
    for (const rule of rules.filter(r => r.sourceType === current.semanticType)) {
      const details = { predicate: rule.predicate, rule: rule.identity, expectedType: rule.targetType, scope: rule.scope };
      const targets = values(current.identity, rule.predicate, details);
      if (rule.required && targets.length === 0) note("TRANSITION_TERMINAL_REQUIRED_EDGE_MISSING", current.identity, details);
      for (const target of targets) {
        const edge = { source: current.identity, predicate: rule.predicate, target, rule: rule.identity };
        if (edges.size >= policy.maxEdges) { note("TRANSITION_TERMINAL_BOUNDS_EXCEEDED", current.identity, { ...details, property: "maximumEdges", observedTargets: [target] }); return finish(); }
        edges.set(canonicalJson(edge), edge);
        const scoped = rule.scope === "reference"
          || (rule.scope === "owner" && same(values(target, P + "owner"), [context.contract]))
          || (rule.scope === "contract" && same(values(target, P + "forContract"), [context.contract]))
          || (rule.scope === "work-profile" && same(values(target, P + "work"), [context.work]) && same(values(target, P + "profile"), [context.profile]));
        if (!scoped) note("TRANSITION_TERMINAL_NODE_SCOPE_CONFLICT", current.identity, { ...details, property: "targetScope", observedTargets: [target] });
        pending.push({ identity: target, semanticType: rule.targetType, depth: current.depth + 1, rule });
      }
    }
  }
  requiredTransitions = sorted([...nodes.values()].filter(n => n.semanticType === T + "CliTransitionDescriptor").map(n => n.identity));
  for (const node of nodes.values()) if (node.semanticType === T + "CliArtifactContract") {
    const producers = requiredTransitions.filter(id => values(id, P + "produces").includes(node.identity));
    if (!consistentArtifactProducer(values(node.identity, P + "producer"), producers)) note("TRANSITION_ARTIFACT_PRODUCER_CONFLICT", node.identity, { predicate: P + "producer", property: "producerLineage", observedTargets: sorted([...values(node.identity, P + "producer"), ...producers]) });
  }
  // Producer is a reverse lineage assertion, not a dependency ordering edge.
  const successors = new Map<string, string[]>();
  for (const edge of edges.values()) if (edge.predicate !== P + "producer") successors.set(edge.source, [...(successors.get(edge.source) ?? []), edge.target]);
  const indegree = new Map([...nodes.keys()].map(id => [id, 0]));
  for (const targets of successors.values()) for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
  const ready = sorted([...indegree.keys()].filter(id => indegree.get(id) === 0));
  const depth = new Map<string, number>();
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]!; visited++;
    for (const target of successors.get(id) ?? []) {
      const nextDepth = Math.max(depth.get(target) ?? 0, (depth.get(id) ?? 0) + 1);
      depth.set(target, nextDepth);
      if (nextDepth > policy.maxDepth) note("TRANSITION_TERMINAL_BOUNDS_EXCEEDED", target, { property: "maximumDepth", rule: declaration.closureRule });
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) ready.push(target);
    }
  }
  if (visited !== indegree.size) note("TRANSITION_TERMINAL_CYCLE", declaration.closureRule, { property: "unresolvedDependencyNodes", observedTargets: [...indegree.keys()].filter(id => indegree.get(id)! > 0) });
  return finish();
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
      || (q.objectKind === "literal" ? typeof q.object !== "string" || (q.object.length > 4096 && !boundedBindingPrompt(graph, q)) : q.objectKind !== "iri" || !boundedText(q.object)))) {
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
  // Explicit prerequisites remain visible; downstream discovery cannot cross ownership.
  const ids = deriveCliTransitionIds([...rows.keys()], values, work, contract);
  if (ids.length === 0) issue("TRANSITION_SEMANTICS_INCOMPLETE", root, "transition");
  if (!inventory.complete) issue("TRANSITION_INVENTORY_INCOMPLETE", root, "inventory");

  const specifications = contract === null ? null : deriveCliRecordSpecifications(graph, { contractIdentity: contract });
  const parserCoverage = deriveCliParserCoverage(graph, contract, inventory.parserSource, specifications);
  diagnostics.push(...parserCoverage.diagnostics);
  const descriptorRecord = specifications?.records.find(record => record.fragment === "");
  const descriptors: Readonly<Record<string, CliRecordValue>>[] = [];
  const operationalUsers = new Map<string, Set<string>>();
  const operationalSupporters = new Map<string, Set<string>>();
  const authenticatedEvaluators = new Set<string>();
  const operationalObservations: CliOperationalSupport[] = [];
  let allDescriptorsValid = true;
  const topology: CliTransitionTopology[] = ids.map(id => {
    let projection: CliRecordDerivation | null = null;
    if (!typed(id, "CliTransitionDescriptor")) issue("TRANSITION_DESCRIPTOR_TYPE_MISSING", id, "type");
    if (one(id, "owner") !== contract) issue("TRANSITION_OWNER_CONFLICT", id, "owner");
    if (specifications === null || descriptorRecord === undefined || descriptorRecord.sourceType !== T + "CliTransitionDescriptor") {
      allDescriptorsValid = false;
      issue("CLI_SPECIFICATION_INCOMPLETE", id, "recordSpecification");
    } else {
      projection = deriveCliRecord(graph, { recordIdentity: descriptorRecord.id, subjectIdentity: id }, specifications);
      allDescriptorsValid &&= projection.valid;
      diagnostics.push(...projection.gaps, ...projection.operationalGaps);
      if (projection.value !== null) descriptors.push(projection.value);
      for (const gap of projection.operationalGaps) {
        const users = operationalUsers.get(gap.subject) ?? new Set<string>();
        users.add(id);
        operationalUsers.set(gap.subject, users);
      }
    }
    // Structural projection does not authenticate operational evaluators or adapters.
    issue("TRANSITION_EVALUATORS_UNAUTHENTICATED", id, "operationalRules");
    const commands = values(id, "command");
    const bindings = commands.length === 1 ? values(commands[0]!, "adapterIdentity") : [];
    const matching = bindings.length === 1 ? adapters.filter(adapter => adapter.id === bindings[0]) : [];
    const projectedEffect = descriptors.find(descriptor => descriptor.identity === id)?.effect;
    const effectClass = projectedEffect !== null && typeof projectedEffect === "object" && !Array.isArray(projectedEffect)
      ? (projectedEffect as Readonly<Record<string, CliRecordValue>>).effectClass : null;
    const adapter = matching.length === 1 ? matching[0] : undefined;
    if (adapter === undefined || typeof adapter.inspect !== "function" || adapter.effectClass !== effectClass) {
      issue("TRANSITION_ADAPTER_UNMAPPED", id, "adapter");
    } else {
      const inspected = adapter.inspect(graph, selection, id);
      if (!Array.isArray(inspected) || inspected.length > 4096 || inspected.some(d => !d || !boundedText(d.reasonCode) || !boundedText(d.subject) || !boundedText(d.field))) {
        issue("TRANSITION_ADAPTER_INSPECTION_INVALID", id, "adapter");
      } else {
        diagnostics.push(...inspected);
        if (inspected.length === 0 && projection?.valid && adapter.operationalSupport !== undefined) {
          try {
            const admission = inspectCliOperationalSupportAdmission(graph, adapter.id, adapter.operationalSupportDefinition);
            diagnostics.push(...admission);
            const support = admission.length === 0 ? adapter.operationalSupport(graph, selection, projection) : null;
            if (support !== null) {
              const key = (value: { fieldIdentity: string; outputPath: readonly string[]; sourceDigest: string }) =>
                canonicalJson([value.fieldIdentity, value.outputPath, value.sourceDigest]);
              const requiredFields = new Set(projection.operationalGaps.map(gap => gap.subject));
              const required = projection.derivations.filter(value => requiredFields.has(value.fieldIdentity));
              const requiredKeys = new Set(required.map(key));
              const observed = new Set<string>();
              const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
              if (support.sourceBasis !== projection.sourceBasis || support.transitionIdentity !== id || support.implementation !== "authenticated"
                || support.lockAvailability !== "not-observed"
                || !["current", "missing-prerequisite", "refused"].includes(support.outcome)
                || (support.outcome === "missing-prerequisite" && (!Array.isArray(support.unavailableInputs)
                  || support.unavailableInputs.length === 0 || support.unavailableInputs.length > 4096
                  || support.unavailableInputs.some(value => !value
                    || !boundedText(value.factKind) || !boundedText(value.identity) || value.state !== "missing" || !boundedText(value.reasonCode))))
                || (support.outcome === "refused" && (!["stale", "unsafe", "mixed", "unclassified"].includes(support.refusalClass)
                  || !/^[A-Z][A-Z0-9_]{0,255}$/.test(support.refusalCode)))
                || !Array.isArray(support.derivations) || support.derivations.length > 4096
                || (support.outcome !== "refused" && support.derivations.length === 0)
                || support.derivations.some(value => {
                  if (value === null || typeof value !== "object" || !Array.isArray(value.outputPath)
                    || value.outputPath.length > 32 || value.outputPath.some((part: unknown) => typeof part !== "string" || !boundedText(part))
                    || !boundedText(value.fieldIdentity) || !digest(value.sourceDigest)
                    || !Array.isArray(value.authenticatedFacts) || value.authenticatedFacts.length === 0
                    || value.authenticatedFacts.length > 4096 || value.authenticatedFacts.some((fact: CliOperationalFact | null) => !fact
                      || !boundedText(fact.factKind) || !boundedText(fact.identity) || !digest(fact.digest))) return true;
                  const identity = key(value);
                  if (!requiredKeys.has(identity) || observed.has(identity)) return true;
                  observed.add(identity);
                  return false;
                })) {
                issue("TRANSITION_OPERATIONAL_SUPPORT_INVALID", id, "operationalRules");
              } else {
                operationalObservations.push({
                  sourceBasis: support.sourceBasis,
                  transitionIdentity: support.transitionIdentity,
                  implementation: support.implementation,
                  lockAvailability: support.lockAvailability,
                  derivations: support.derivations.map(value => ({
                    fieldIdentity: value.fieldIdentity,
                    outputPath: [...value.outputPath],
                    sourceDigest: value.sourceDigest,
                    authenticatedFacts: value.authenticatedFacts.map((fact: CliOperationalFact) => ({
                      factKind: fact.factKind, identity: fact.identity, digest: fact.digest,
                    })).sort((a: CliOperationalFact, b: CliOperationalFact) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0),
                  })).sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0),
                  ...(support.outcome === "missing-prerequisite" ? {
                    outcome: support.outcome,
                    unavailableInputs: support.unavailableInputs.map(value => ({
                      factKind: value.factKind, identity: value.identity,
                      state: value.state, reasonCode: value.reasonCode,
                    })).sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0),
                  } : support.outcome === "refused" ? {
                    outcome: support.outcome, refusalClass: support.refusalClass, refusalCode: support.refusalCode,
                  } : { outcome: support.outcome }),
                });
                if (support.outcome === "refused") issue(support.refusalCode, id, "operationalRules");
                if (support.outcome !== "refused" && requiredKeys.size > 0
                  && required.every(value => observed.has(key(value)))) authenticatedEvaluators.add(id);
                for (const field of requiredFields) {
                  if (support.outcome === "refused") continue;
                  const instances = required.filter(value => value.fieldIdentity === field);
                  if (instances.length === 0 || !instances.every(value => observed.has(key(value)))) continue;
                  const supporters = operationalSupporters.get(field) ?? new Set<string>();
                  supporters.add(id);
                  operationalSupporters.set(field, supporters);
                }
              }
            }
          } catch {
            issue("TRANSITION_OPERATIONAL_SUPPORT_REFUSED", id, "operationalRules");
          }
        }
      }
    }
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
      if (!consistentArtifactProducer(values(artifact, "producer"), source)) issue("TRANSITION_ARTIFACT_PRODUCER_CONFLICT", artifact, "producer");
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
  const assessment = deriveCliTerminalAssessment(graph, root);
  const declaredBranchClosure = assessment.branchAssessments !== undefined
    && assessment.branchAssessments.length > 0 && assessment.structuralComplete;
  const legacySinkClosure = declared.length > 0 && same(declared, derived) && visited.size === ids.length && ids.length > 0;
  if (!(declaredBranchClosure || legacySinkClosure)) issue("TRANSITION_TERMINAL_CLOSURE_MISMATCH", root, "terminalArtifact");
  // Neither a graph branch declaration nor an unconsumed-artifact census authenticates obligations.
  const equal = declaredBranchClosure;
  issue("TRANSITION_TERMINAL_OBLIGATIONS_UNAUTHENTICATED", root, "terminalArtifact/recovery");
  for (const reasonCode of assessment.reasonCodes) issue(reasonCode, root, "terminalClosure");
  // A shared field is supported only when every selected descriptor instance is covered.
  const remainingDiagnostics = diagnostics.filter(diagnostic => {
    if (diagnostic.reasonCode === "TRANSITION_EVALUATORS_UNAUTHENTICATED") return !authenticatedEvaluators.has(diagnostic.subject);
    if (diagnostic.reasonCode !== "CLI_OPERATIONAL_RULE_UNRESOLVED" || !allDescriptorsValid || ids.length === 0) return true;
    const users = operationalUsers.get(diagnostic.subject), supporters = operationalSupporters.get(diagnostic.subject);
    return users === undefined || users.size === 0 || supporters === undefined || [...users].some(id => !supporters.has(id));
  });
  const uniqueDiagnostics = [...new Map(remainingDiagnostics.map(d => [canonicalJson(d), d])).values()].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
  // Bind every selected named-source quad, including referenced semantics not projected above.
  const graphDigest = canonicalQuadDigest(graph.quads);
  const body = { schema: "urn:usf:cli-transition-interrogation:1" as const, ...selection, graphDigest, work, contract, profile, profileCandidates: profiles, requiredGraphRefs, descriptors, waves,
    topologicalOnly: true, parallelSafety: { state: "unproven" as const, members: ids, semanticBasis: graphDigest,
      assessmentRule: "urn:usf:cli-field-specification:rule-parallel-assessment-boundary:1",
      missingObligations: ["urn:usf:cli-field-specification:rule-parallel-assessment-boundary:1"],
      reasonCodes: ["TRANSITION_PARALLEL_SAFETY_UNAUTHENTICATED"] },
    terminalClosure: { declared, derived, equal, assessment }, operationalSupport: operationalObservations, parserCoverage,
    diagnostics: uniqueDiagnostics, complete: uniqueDiagnostics.length === 0,
    reasonCode: uniqueDiagnostics.length === 0 ? "TRANSITION_COVERAGE_COMPLETE" as const : "TRANSITION_SEMANTICS_INCOMPLETE" as const, executionAuthority: "none" as const };
  function freeze<TValue>(value: TValue): TValue {
    if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
  }
  return freeze({ ...body, digest: canonicalDigest(body) });
}
