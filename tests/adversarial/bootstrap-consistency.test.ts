import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

type DependencyClass = "dependencies" | "devDependencies" | "optionalDependencies";
type DependencyEntry = string | { readonly specifier?: unknown; readonly version?: unknown };
type DependencyMap = Record<string, DependencyEntry>;
type LockRecord = {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
};
type PnpmLock = {
  readonly importers?: Record<string, Partial<Record<DependencyClass, DependencyMap>>>;
  readonly packages?: Record<string, unknown>;
  readonly snapshots?: Record<string, LockRecord>;
};

const dependencyClasses: readonly DependencyClass[] = ["dependencies", "devDependencies", "optionalDependencies"];
// Derived from primary preimage sha256:c97833c5... after independently removing
// exactly the three approved roots and the resulting 33 unreachable records.
// The candidate lockfile is never an input to this expected value.
const expectedRetainedLockIdentity = "sha256:f5010feafa40d2ac499d11a70c60e7a455c016573a6dd4ecf85aabae22d46fc0";
const intendedDependencies = Object.freeze({
  "@ai-sdk/cerebras": "3.0.40",
  "@ai-sdk/cohere": "4.0.35",
  "@ai-sdk/groq": "4.0.34",
  "@ai-sdk/mistral": "4.0.37",
  "@ai-sdk/openai": "4.0.52",
  "@ai-sdk/openai-compatible": "3.0.41",
  "@ai-sdk/togetherai": "3.0.42",
  "@apidevtools/swagger-parser": "12.1.0",
  "@openrouter/ai-sdk-provider": "3.0.0",
  "@traqula/parser-sparql-1-1": "1.2.1",
  ai: "7.0.84",
  ajv: "8.20.0",
  graphql: "17.0.2",
  "rdf-canonize": "5.0.0",
  yaml: "2.9.0",
});
const intendedDevDependencies = Object.freeze({
  "@types/node": "24.10.1",
  typescript: "5.9.3",
});

class ConsistencyRefusal extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "ConsistencyRefusal";
    this.reasonCode = reasonCode;
  }
}

function refuse(reasonCode: string): never {
  throw new ConsistencyRefusal(reasonCode);
}

function exactStringMap(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, specifier]) => typeof specifier !== "string")) return null;
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))) as Record<string, string>;
}

function assertIntendedManifest(manifest: Record<string, unknown>): void {
  assert.deepEqual(exactStringMap(manifest.dependencies), intendedDependencies, "PACKAGE_MANIFEST_DEPENDENCIES_CHANGED");
  assert.deepEqual(exactStringMap(manifest.devDependencies), intendedDevDependencies, "PACKAGE_MANIFEST_DEV_DEPENDENCIES_CHANGED");
  assert.deepEqual(exactStringMap(manifest.optionalDependencies ?? {}), {}, "PACKAGE_MANIFEST_OPTIONAL_DEPENDENCIES_CHANGED");
}

function manifestClasses(manifest: Record<string, unknown>): Map<string, { className: DependencyClass; specifier: string }> {
  const result = new Map<string, { className: DependencyClass; specifier: string }>();
  for (const className of dependencyClasses) {
    const dependencies = exactStringMap(manifest[className] ?? {});
    if (dependencies === null) refuse(`PACKAGE_MANIFEST_${className.toUpperCase()}_MALFORMED`);
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (result.has(name)) refuse(`PACKAGE_MANIFEST_CLASS_CONFLICT:${name}`);
      result.set(name, { className, specifier });
    }
  }
  return result;
}

function lockClasses(lock: PnpmLock): Map<string, { className: DependencyClass; specifier: string; version: string }> {
  const root = lock.importers?.["."];
  if (root === undefined) refuse("LOCK_ROOT_IMPORTER_MISSING");
  const result = new Map<string, { className: DependencyClass; specifier: string; version: string }>();
  for (const className of dependencyClasses) {
    const dependencies = root[className] ?? {};
    if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) refuse(`LOCK_IMPORTER_${className.toUpperCase()}_MALFORMED`);
    for (const [name, entry] of Object.entries(dependencies)) {
      if (result.has(name)) refuse(`LOCK_IMPORTER_CLASS_CONFLICT:${name}`);
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)
        || typeof entry.specifier !== "string" || typeof entry.version !== "string") {
        refuse(`LOCK_IMPORTER_ENTRY_MALFORMED:${className}:${name}`);
      }
      result.set(name, { className, specifier: entry.specifier, version: entry.version });
    }
  }
  return result;
}

function assertImporterConsistency(manifest: Record<string, unknown>, lock: PnpmLock): void {
  const expected = manifestClasses(manifest);
  const actual = lockClasses(lock);
  for (const [name, dependency] of expected) {
    const locked = actual.get(name);
    if (locked === undefined) refuse(`LOCK_IMPORTER_MISSING:${dependency.className}:${name}`);
    if (locked.className !== dependency.className) refuse(`LOCK_IMPORTER_CLASS_MISMATCH:${name}:${dependency.className}:${locked.className}`);
    if (locked.specifier !== dependency.specifier) refuse(`LOCK_IMPORTER_SPECIFIER_MISMATCH:${dependency.className}:${name}`);
  }
  for (const [name, dependency] of actual) {
    if (!expected.has(name)) refuse(`LOCK_IMPORTER_EXTRA:${dependency.className}:${name}`);
  }
}

function dependencyKey(name: string, reference: unknown): string | null {
  if (typeof reference !== "string" || /^(?:file|link|workspace):/u.test(reference)) return null;
  if (!reference.startsWith("npm:")) return `${name}@${reference}`;
  const alias = /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(reference);
  if (alias === null) refuse(`LOCK_ALIAS_MALFORMED:${name}`);
  return `${alias[1]}@${alias[2]}`;
}

function basePackageKey(snapshotKey: string): string {
  return snapshotKey.replace(/\(.+$/u, "");
}

function canonicalLockJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) refuse("LOCK_IDENTITY_VALUE_MALFORMED");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalLockJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalLockJson(record[key])}`).join(",")}}`;
}

function assertRetainedLockIdentity(lock: PnpmLock): void {
  const actual = `sha256:${createHash("sha256").update(canonicalLockJson(lock)).digest("hex")}`;
  if (actual !== expectedRetainedLockIdentity) refuse("LOCK_IDENTITY_FINGERPRINT_MISMATCH");
}

function assertFullyReachable(lock: PnpmLock): void {
  const snapshots = lock.snapshots ?? {};
  const packages = lock.packages ?? {};
  const roots: string[] = [];
  for (const importer of Object.values(lock.importers ?? {})) {
    for (const className of dependencyClasses) {
      for (const [name, entry] of Object.entries(importer[className] ?? {})) {
        const reference = typeof entry === "string" ? entry : entry.version;
        const key = dependencyKey(name, reference);
        if (key !== null) roots.push(key);
      }
    }
  }

  const reachable = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const key = pending.shift()!;
    if (reachable.has(key)) continue;
    const snapshot = snapshots[key];
    if (snapshot === undefined) refuse(`LOCK_SNAPSHOT_MISSING:${key}`);
    reachable.add(key);
    for (const className of ["dependencies", "optionalDependencies"] as const) {
      for (const [name, reference] of Object.entries(snapshot[className] ?? {})) {
        const child = dependencyKey(name, reference);
        if (child !== null && !reachable.has(child)) pending.push(child);
      }
    }
  }

  const orphanSnapshots = Object.keys(snapshots).filter((key) => !reachable.has(key)).sort();
  if (orphanSnapshots.length > 0) refuse(`LOCK_ORPHAN_SNAPSHOTS:${orphanSnapshots.join(",")}`);
  const reachablePackages = new Set([...reachable].map(basePackageKey));
  const missingPackages = [...reachablePackages].filter((key) => !(key in packages)).sort();
  if (missingPackages.length > 0) refuse(`LOCK_PACKAGE_MISSING:${missingPackages.join(",")}`);
  const orphanPackages = Object.keys(packages).filter((key) => !reachablePackages.has(key)).sort();
  if (orphanPackages.length > 0) refuse(`LOCK_ORPHAN_PACKAGES:${orphanPackages.join(",")}`);
}

function expectRefusal(action: () => void, reasonCode: string): void {
  assert.throws(action, (error: unknown) => error instanceof ConsistencyRefusal && error.reasonCode === reasonCode);
}

function expectIdentityDriftRefusal(manifest: Record<string, unknown>, lock: PnpmLock): void {
  // These assertions establish that the older specifier/reachability checks
  // would accept the planted drift before the retained-identity guard refuses.
  assertImporterConsistency(manifest, lock);
  assertFullyReachable(lock);
  expectRefusal(() => assertRetainedLockIdentity(lock), "LOCK_IDENTITY_FINGERPRINT_MISMATCH");
}

async function currentInputs(): Promise<{ manifest: Record<string, unknown>; lock: PnpmLock }> {
  const [packageBytes, lockBytes] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8"),
  ]);
  return {
    manifest: JSON.parse(packageBytes) as Record<string, unknown>,
    lock: parse(lockBytes) as PnpmLock,
  };
}

test("the intended package set and complete lock closure are exact", async () => {
  const { manifest, lock } = await currentInputs();
  assertIntendedManifest(manifest);
  assertImporterConsistency(manifest, lock);
  assertFullyReachable(lock);
  assertRetainedLockIdentity(lock);
  for (const stale of ["n3", "oxigraph", "rdf-validate-shacl"]) {
    assert.equal(lockClasses(lock).has(stale), false, `${stale} must not remain a direct importer`);
  }
});

test("a missing direct importer entry refuses", async () => {
  const { manifest, lock } = await currentInputs();
  delete lock.importers!["."]!.dependencies!.ai;
  expectRefusal(() => assertImporterConsistency(manifest, lock), "LOCK_IMPORTER_MISSING:dependencies:ai");
});

test("an extra direct importer entry refuses", async () => {
  const { manifest, lock } = await currentInputs();
  lock.importers!["."]!.dependencies!.n3 = { specifier: "2.0.1", version: "2.0.1" };
  expectRefusal(() => assertImporterConsistency(manifest, lock), "LOCK_IMPORTER_EXTRA:dependencies:n3");
});

test("a dependency moved between importer classes refuses", async () => {
  const { manifest, lock } = await currentInputs();
  const typescript = lock.importers!["."]!.devDependencies!.typescript;
  delete lock.importers!["."]!.devDependencies!.typescript;
  lock.importers!["."]!.dependencies!.typescript = typescript;
  expectRefusal(() => assertImporterConsistency(manifest, lock), "LOCK_IMPORTER_CLASS_MISMATCH:typescript:devDependencies:dependencies");
});

test("a wrong importer specifier refuses", async () => {
  const { manifest, lock } = await currentInputs();
  lock.importers!["."]!.dependencies!.yaml = { specifier: "2.8.0", version: "2.9.0" };
  expectRefusal(() => assertImporterConsistency(manifest, lock), "LOCK_IMPORTER_SPECIFIER_MISMATCH:dependencies:yaml");
});

test("a change to the intended package set refuses independently of lock agreement", async () => {
  const { manifest, lock } = await currentInputs();
  (manifest.dependencies as Record<string, string>).yaml = "2.8.0";
  lock.importers!["."]!.dependencies!.yaml = { specifier: "2.8.0", version: "2.8.0" };
  assertImporterConsistency(manifest, lock);
  assert.throws(() => assertIntendedManifest(manifest), /PACKAGE_MANIFEST_DEPENDENCIES_CHANGED/u);
});

test("an unreachable lock closure refuses", async () => {
  const { lock } = await currentInputs();
  lock.packages!["orphan@1.0.0"] = {};
  lock.snapshots!["orphan@1.0.0"] = {};
  expectRefusal(() => assertFullyReachable(lock), "LOCK_ORPHAN_SNAPSHOTS:orphan@1.0.0");
});

test("a synchronized resolved-version and closure change refuses", async () => {
  const { manifest, lock } = await currentInputs();
  const entry = lock.importers!["."]!.dependencies!.yaml as { specifier: string; version: string };
  entry.version = "2.9.1";
  lock.packages!["yaml@2.9.1"] = lock.packages!["yaml@2.9.0"];
  lock.snapshots!["yaml@2.9.1"] = lock.snapshots!["yaml@2.9.0"]!;
  delete lock.packages!["yaml@2.9.0"];
  delete lock.snapshots!["yaml@2.9.0"];
  expectIdentityDriftRefusal(manifest, lock);
});

test("a retained resolution locator change refuses", async () => {
  const { manifest, lock } = await currentInputs();
  const yaml = lock.packages!["yaml@2.9.0"] as { resolution: Record<string, string> };
  yaml.resolution.tarball = "https://registry.invalid/yaml-2.9.0.tgz";
  expectIdentityDriftRefusal(manifest, lock);
});

test("a retained peer contract change refuses", async () => {
  const { manifest, lock } = await currentInputs();
  const openai = lock.packages!["@ai-sdk/openai@4.0.52"] as { peerDependencies: Record<string, string> };
  openai.peerDependencies.zod = "^4.5.3";
  expectIdentityDriftRefusal(manifest, lock);
});

test("a retained integrity change refuses", async () => {
  const { manifest, lock } = await currentInputs();
  const yaml = lock.packages!["yaml@2.9.0"] as { resolution: Record<string, string> };
  yaml.resolution.integrity = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  expectIdentityDriftRefusal(manifest, lock);
});
