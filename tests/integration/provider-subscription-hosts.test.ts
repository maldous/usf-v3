import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createProviderHostsCommandHandler } from "../../src/commands/provider-hosts.ts";
import type { CatalogueModel, ModelCatalogueSnapshot } from "../../src/providers/catalogue.ts";
import {
  observeSubscriptionHosts,
  observeCodexSubscriptionHost,
  parseClaudeAuthStatus,
  parseCodexAppServerModelSurface,
  SubscriptionHostContainmentError,
  type HostCommandRunner,
  type TrustedSystemIdentityObserver,
} from "../../src/providers/subscription-hosts.ts";

const digestText = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const model = (provider: string, id: string, family: string): CatalogueModel => ({
  route: { provider, model: id }, underlying: { family, model: id }, name: id, nameSource: "catalogue",
  capabilities: { attachment: null, reasoning: true, structuredOutput: null, temperature: null, toolCall: null },
  capabilityNames: ["reasoning"], modalities: { input: ["text"], output: ["text"] }, openWeights: null,
  cost: { currency: "USD", unit: "per-million-tokens", input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null, inputAudio: null, outputAudio: null },
  limits: { context: 8192, input: null, output: 1024 },
});

const snapshot: ModelCatalogueSnapshot = {
  schema: "urn:usf:model-catalogue:1", source: "models.dev/api.json",
  rawDigest: `sha256:${"a".repeat(64)}`, normalizedDigest: `sha256:${"b".repeat(64)}`,
  denominators: { providerRoutes: 2, modelRoutes: 3, underlyingModels: 3, underlyingFamilies: 2, unknownUnderlyingFamilies: 0, adapterPackages: 2, installedAdapterPackages: 0, credentialNames: 2, cataloguePriceKnownModels: 0, cataloguePriceUnknownModels: 3, catalogueZeroPriceModels: 0 },
  providers: [
    { providerRoute: "openai", name: "OpenAI", adapter: { package: "@ai-sdk/openai", installedVersion: null }, credentialNames: ["OPENAI_API_KEY"], models: [model("openai", "gpt-catalogue-only", "gpt"), model("openai", "gpt-test", "gpt")] },
    { providerRoute: "anthropic", name: "Anthropic", adapter: { package: "@ai-sdk/anthropic", installedVersion: null }, credentialNames: ["ANTHROPIC_API_KEY"], models: [model("anthropic", "claude-test", "claude")] },
  ],
  nonclaims: ["fixture-catalogue-is-not-live-authority"],
};

const codexModels = [
  JSON.stringify({ id: "usf-initialize", result: { userAgent: "fixture" } }),
  JSON.stringify({ id: "usf-model-list", result: { data: [
    { id: "gpt-test", model: "gpt-test", displayName: "GPT Test", hidden: false },
    { id: "gpt-hidden", model: "gpt-hidden", displayName: "GPT Hidden", hidden: true },
  ], nextCursor: null } }),
  "",
].join("\n");
const claudeHelp = "  --model <model>  Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a\n                    model's full name (e.g. 'claude-fable-5').\n";
const fixtureSystemIdentity: TrustedSystemIdentityObserver = (path, mode, includeBytes) => Object.freeze({
  currentness: Object.freeze({ fixtureIdentityDigest: digestText(JSON.stringify({ path, mode })) }),
  bytesDigest: includeBytes ? digestText(path) : null,
});

async function providerRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "usf-provider-state-"));
  await chmod(root, 0o700);
  await mkdir(join(root, ".codex"), { mode: 0o700 });
  await mkdir(join(root, ".claude"), { mode: 0o700 });
  await writeFile(join(root, ".codex/auth.json"), "{}", { mode: 0o600 });
  await writeFile(join(root, ".claude/.credentials.json"), "{}", { mode: 0o600 });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function innerCommand(arguments_: readonly string[]): string {
  const separator = arguments_.lastIndexOf("--");
  assert.notEqual(separator, -1);
  return arguments_.slice(separator + 1).join(" ");
}

test("subscription host census uses exact no-network Bubblewrap commands and validates both closed schemas", async (t) => {
  const root = await providerRoot(t);
  const launches: Array<{ arguments: readonly string[]; stdin: unknown }> = [];
  const identityPaths = new Set<string>();
  const systemIdentityObserver: TrustedSystemIdentityObserver = (path, mode, includeBytes) => {
    identityPaths.add(`${path}:${mode}:${String(includeBytes)}`);
    return fixtureSystemIdentity(path, mode, includeBytes);
  };
  const runner: HostCommandRunner = async (executable, arguments_, options) => {
    assert.equal(executable, "/usr/bin/bwrap");
    assert.deepEqual(options.environment, {});
    assert.deepEqual(arguments_.slice(0, 6), ["--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent", "--tmpfs", "/"]);
    assert.equal(arguments_.includes("--clearenv"), true);
    assert.equal(arguments_.includes(root), false);
    assert.equal(arguments_.some((argument) => argument.includes("API_KEY") || argument.includes("TOKEN") || argument.includes("PROXY")), false);
    const authSources = arguments_.filter((argument) => argument === join(root, ".codex/auth.json") || argument === join(root, ".claude/.credentials.json"));
    assert.equal(authSources.length, 1);
    launches.push({ arguments: arguments_, stdin: options.stdin });
    const command = innerCommand(arguments_);
    const stdout = new Map([
      ["/usr/bin/codex --version", "codex-cli 0.151.0\n"],
      ["/usr/bin/codex login status", "Logged in using ChatGPT\n"],
      ["/usr/bin/codex app-server --stdio", codexModels],
      ["/usr/bin/claude --version", "2.1.251 (Claude Code)\n"],
      ["/usr/bin/claude auth status --json", JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "team", email: "must-not-survive@example.test", organizationName: "must-not-survive" })],
      ["/usr/bin/claude --help", claudeHelp],
    ]).get(command);
    if (stdout === undefined) throw new Error("unexpected confined fixture command");
    if (command === "/usr/bin/codex app-server --stdio") {
      assert.match(options.stdin?.initial ?? "", /"method":"initialize"/u);
      assert.equal(options.stdin?.afterResponse?.responseId, "usf-initialize");
      assert.match(options.stdin?.afterResponse?.input ?? "", /"method":"initialized"/u);
      assert.match(options.stdin?.afterResponse?.input ?? "", /"method":"model\/list"/u);
      assert.match(options.stdin?.afterResponse?.input ?? "", /"includeHidden":true/u);
    } else assert.equal(options.stdin, null);
    return { stdout };
  };
  const census = await observeSubscriptionHosts(snapshot, { providerRoot: root, now: "2026-08-31T00:00:00.000Z", runner, systemIdentityObserver });

  assert.equal(launches.length, 6);
  assert.deepEqual([...identityPaths].sort(), [
    "/lib:projection:false", "/lib64:projection:false", "/usr:projection:false",
    "/usr/bin/bwrap:regular:false", "/usr/bin/bwrap:regular:true",
    "/usr/bin/claude:executable:false", "/usr/bin/claude:executable:true",
    "/usr/bin/codex:executable:false", "/usr/bin/codex:executable:true",
  ].sort());
  assert.deepEqual(census.source, {
    modelsDevRawDigest: snapshot.rawDigest,
    modelsDevNormalizedDigest: snapshot.normalizedDigest,
    codexModelSurface: "no-network-app-server-complete-page-union-frozen-modelsdev-not-live-entitlement",
    claudeModelSurface: "no-network-installed-cli-help-aliases-union-frozen-modelsdev-non-exhaustive",
  });
  assert.deepEqual(census.hosts.map((host) => [host.provider, host.catalogueProvider, host.status]), [
    ["claude-cli", "anthropic", "authenticated"], ["codex-cli", "openai", "authenticated"],
  ]);
  assert.deepEqual(census.denominators, {
    hostTransports: 2, authenticatedHosts: 2, candidateRecords: 7, modelCandidates: 4, aliasCandidates: 3,
    hostEnumeratedCandidates: 2, catalogueOnlyCandidates: 2, exactCatalogueMatches: 3, unmatchedCandidates: 4, authorizations: 2,
  });
  assert.equal(census.candidates.find((candidate) => candidate.model === "gpt-catalogue-only")?.visibility, "not-enumerated-by-host");
  assert.equal(census.candidates.find((candidate) => candidate.model === "gpt-hidden")?.discoveryDisposition, "hidden-unverified");
  assert.deepEqual(census.candidates.filter((candidate) => candidate.kind === "alias").map((candidate) => candidate.model), ["fable", "opus", "sonnet"]);
  assert.equal(census.authorizations.every((item) => item.inferenceAuthorized === false && item.containmentDigest.startsWith("sha256:")), true);
  assert.equal(JSON.stringify(census).includes(root) || JSON.stringify(census).includes("must-not-survive"), false);
  const scope = {
    status: "selected" as const, profile: "urn:usf:profile:v3-self-host:3", profileVersion: "3",
    product: "urn:usf:product:v3", foundation: "urn:usf:foundation:v3", manifest: "graph/manifests/self-host-provider-v3.json",
    semanticDigest: `sha256:${"c".repeat(64)}`, work: "urn:usf:work:provider-census" as const,
    contract: "urn:usf:contract:provider-census:1" as const, scopedDependencyDigest: `sha256:${"d".repeat(64)}`,
    capabilityStage: "verified-complete" as const, completionProofResult: "urn:usf:proof-result:fixture",
  };
  const handler = createProviderHostsCommandHandler({
    resolveRequest: async () => ({ scope, maxItems: 1, providerHome: root, catalogue: snapshot }),
    observe: async () => census,
  });
  const commandResult = await handler({ command: "providers", args: [], repositoryRoot: new URL("../..", import.meta.url).pathname });
  const result = commandResult.output as Record<string, unknown>;
  assert.equal(result.externalContact, "none");
  assert.equal(result.observationDigest, census.digest);
  assert.deepEqual(result.authorizations, census.authorizations);
  assert.deepEqual(result.truncation, { maxItems: 1, matchedItems: 7, returnedItems: 1, truncated: true });
  assert.equal((result.denominators as Record<string, unknown>).matchedCandidates, 7);
  assert.equal((result.denominators as Record<string, unknown>).returnedCandidates, 1);
  assert.equal((result.candidates as unknown[]).length, 1);
});

test("authenticated no-network model-discovery failure retains frozen denominators and census-only authorization", async (t) => {
  const root = await providerRoot(t);
  const runner: HostCommandRunner = async (_executable, arguments_) => {
    const command = innerCommand(arguments_);
    if (command === "/usr/bin/codex --version") return { stdout: "codex-cli 0.151.0\n" };
    if (command === "/usr/bin/codex login status") return { stdout: "Logged in using ChatGPT\n" };
    if (command === "/usr/bin/codex app-server --stdio") throw new Error("fixture no-network discovery failure");
    throw Object.assign(new Error("fixture unavailable"), { code: "ENOENT" });
  };
  const census = await observeSubscriptionHosts(snapshot, { providerRoot: root, now: "2026-08-31T00:00:00.000Z", runner, systemIdentityObserver: fixtureSystemIdentity });
  const codex = census.hosts.find((host) => host.transport === "codex-cli-subscription");
  assert.equal(census.source.codexModelSurface, "frozen-modelsdev-only-app-server-unavailable");
  assert.deepEqual({
    status: codex?.status, failureCode: codex?.failureCode, authenticated: codex?.authentication.authenticated,
    candidateSurface: codex?.candidateSurface, models: codex?.candidates.map((candidate) => candidate.model),
    completeness: codex?.authorization?.modelSurfaceCompleteness, inferenceAuthorized: codex?.authorization?.inferenceAuthorized,
  }, {
    status: "authenticated", failureCode: "COMMAND_FAILED", authenticated: true, candidateSurface: "frozen-catalogue-only",
    models: ["gpt-catalogue-only", "gpt-test"], completeness: "frozen-catalogue-only-not-live-entitlement", inferenceAuthorized: false,
  });
});

test("parsers and provider-state metadata fail closed without exposing account or secret bytes", async (t) => {
  assert.deepEqual(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "team", email: "private@example.test" })), {
    authenticated: true, authenticationMode: "claude.ai", apiProvider: "firstParty", subscriptionType: "present", failureCode: null, accountIdentityRetained: false,
  });
  assert.deepEqual(
    parseCodexAppServerModelSurface(`${JSON.stringify({ id: "usf-model-list", result: { data: [], nextCursor: "more" } })}\n`, snapshot),
    { candidates: parseCodexAppServerModelSurface(`${JSON.stringify({ id: "usf-model-list", result: { data: [], nextCursor: null } })}\n`, snapshot).candidates, complete: false },
  );
  const root = await providerRoot(t);
  const auth = join(root, ".codex/auth.json");
  let changed = false;
  const runner: HostCommandRunner = async () => {
    if (!changed) { changed = true; await chmod(auth, 0o400); }
    return { stdout: "codex-cli 0.151.0\n" };
  };
  await assert.rejects(
    observeCodexSubscriptionHost({ catalogue: snapshot, providerRoot: root, observedAt: "2026-08-31T00:00:00.000Z", runner, systemIdentityObserver: fixtureSystemIdentity }),
    (error: unknown) => error instanceof SubscriptionHostContainmentError && error.reasonCode === "PROVIDER_HOST_CONTAINMENT_DRIFT",
  );
});
