import { canonicalParserCommandPath, type CliCanonicalParserBinding, type CliCanonicalParserSource } from "../graph/cli-transitions.ts";

export { canonicalParserCommandPath };

export type CanonicalParserContract = CliCanonicalParserBinding;

const sourcePath = "src/cli.ts" as const;
const exportIdentity = "src/commands/canonical-parser-contracts.ts#canonicalParserContracts" as const;

const contracts: readonly CanonicalParserContract[] = Object.freeze([
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:ordinary-resolve:1",
    canonicalSelectorTokens: Object.freeze(["resolve", "ordinary", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:ordinary-resolve:1",
      sourceDispatchSurfaceToken: "resolve",
      complementOf: "urn:usf:cli-canonical-parser-contract:ordinary-resolve:1",
    }),
    namedCommand: "urn:usf:command:ordinary-resolve:1",
    adapterIdentity: "urn:usf:cli-adapter:ordinary-resolve:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:ordinary-apply:1",
    canonicalSelectorTokens: Object.freeze(["apply", "ordinary", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:ordinary-apply:1",
      sourceDispatchSurfaceToken: "apply",
      complementOf: "urn:usf:cli-canonical-parser-contract:ordinary-apply:1",
    }),
    namedCommand: "urn:usf:command:ordinary-apply:1",
    adapterIdentity: "urn:usf:cli-adapter:ordinary-apply:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:ordinary-check:1",
    canonicalSelectorTokens: Object.freeze(["check", "ordinary", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:ordinary-check:1",
      sourceDispatchSurfaceToken: "check",
      complementOf: "urn:usf:cli-canonical-parser-contract:ordinary-check:1",
    }),
    namedCommand: "urn:usf:command:ordinary-check:1",
    adapterIdentity: "urn:usf:cli-adapter:ordinary-check:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:check-diagnose:1",
    canonicalSelectorTokens: Object.freeze(["check", "diagnose", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:check-diagnose:1",
      sourceDispatchSurfaceToken: "check",
      complementOf: "urn:usf:cli-canonical-parser-contract:check-diagnose:1",
    }),
    namedCommand: "urn:usf:command:check:1",
    adapterIdentity: "urn:usf:cli-adapter:completion-check-receipts:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:ordinary-integrate:1",
    canonicalSelectorTokens: Object.freeze(["integrate", "ordinary", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:ordinary-integrate:1",
      sourceDispatchSurfaceToken: "integrate",
      complementOf: "urn:usf:cli-canonical-parser-contract:ordinary-integrate:1",
    }),
    namedCommand: "urn:usf:command:ordinary-integrate:1",
    adapterIdentity: "urn:usf:cli-adapter:ordinary-integrate:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:realise-no-change:1",
    canonicalSelectorTokens: Object.freeze(["realise", "no-change", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:realise:1",
      sourceDispatchSurfaceToken: "realise",
      complementOf: "urn:usf:cli-canonical-parser-contract:realise-no-change:1",
    }),
    namedCommand: "urn:usf:command:realise-no-change:1",
    adapterIdentity: "urn:usf:cli-adapter:no-change-workspace:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:check-input:1",
    canonicalSelectorTokens: Object.freeze(["check", "--input"]),
    forwardedArgumentOffset: 0,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:check:1",
      sourceDispatchSurfaceToken: "check",
      complementOf: "urn:usf:cli-canonical-parser-contract:check-input:1",
    }),
    namedCommand: "urn:usf:command:check:1",
    adapterIdentity: "urn:usf:cli-adapter:completion-check-receipts:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:completion-evidence:1",
    canonicalSelectorTokens: Object.freeze(["evidence", "completion", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:evidence:1",
      sourceDispatchSurfaceToken: "evidence",
      complementOf: "urn:usf:cli-canonical-parser-contract:completion-evidence:1",
    }),
    namedCommand: "urn:usf:command:evidence-completion:1",
    adapterIdentity: "urn:usf:cli-adapter:completion-evidence:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:completion-proof:1",
    canonicalSelectorTokens: Object.freeze(["prove", "completion", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:prove:1",
      sourceDispatchSurfaceToken: "prove",
      complementOf: "urn:usf:cli-canonical-parser-contract:completion-proof:1",
    }),
    namedCommand: "urn:usf:command:prove-completion:1",
    adapterIdentity: "urn:usf:cli-adapter:completion-proof:1",
  }),
  Object.freeze({
    version: "1",
    identity: "urn:usf:cli-canonical-parser-contract:completion-publication:1",
    canonicalSelectorTokens: Object.freeze(["publish", "work-completion", "--input"]),
    forwardedArgumentOffset: 1,
    fallbackRegion: Object.freeze({
      identity: "urn:usf:cli-canonical-parser-fallback:publish:1",
      sourceDispatchSurfaceToken: "publish",
      complementOf: "urn:usf:cli-canonical-parser-contract:completion-publication:1",
    }),
    namedCommand: "urn:usf:command:publish-work-completion:1",
    adapterIdentity: "urn:usf:cli-adapter:completion-publication:1",
  }),
]);

export const canonicalParserContracts: CliCanonicalParserSource = Object.freeze({
  contracts,
  sourcePath,
  parserExport: exportIdentity,
});

export function matchCanonicalParserContract(command: string, args: readonly string[]): CanonicalParserContract | undefined {
  const tokens = [command, ...args];
  return canonicalParserContracts.contracts.find((contract) => contract.canonicalSelectorTokens.every((token, index) => tokens[index] === token));
}

export function forwardedCanonicalParserArgs(contract: CanonicalParserContract, args: readonly string[]): readonly string[] {
  return args.slice(contract.forwardedArgumentOffset);
}
