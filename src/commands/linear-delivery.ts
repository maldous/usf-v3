import { resolve, sep } from "node:path";
import { apply } from "./apply.ts";
import { runGraphDerivedCheck } from "./check.ts";
import { integrateCommandHandler } from "./apply.ts";
import { constructionAwarePublishCommandHandler, evidenceCommandHandler, proveCommandHandler } from "./construction-authority.ts";
import { hermesCommand } from "./hermes.ts";
import {
  observeLinearBinding,
  prepareLinearBinding, withNativeLinearCompletion,
  type LinearBindingResult,
  type LinearBindingSelector,
} from "./linear-binding.ts";
import { resolveCommand } from "./resolve.ts";
import {
  completionAwareEvidenceCommandHandler,
  completionAwareProveCommandHandler,
  completionAwarePublishCommandHandler,
  realiseCommandHandler,
} from "./work-completion.ts";
import { canonicalDigest } from "../core/canonical.ts";
import { contributionFromSettledLinearResult } from "./linear-contribution.ts";
import { readLinearRecord, writeLinearRecord, type LinearRecordObject } from "./linear-state.ts";
import { candidateScope, deriveCandidatePreimages, type CandidateSpec } from "../realisation/index.ts";

export interface LinearDeliveryEvidence {
  readonly bindingIri: string;
  /** Compatibility alias retained for the foreground controller. */
  readonly checkpointPath: string;
  readonly checkpointRecordKey: string;
  readonly preparedStatus: LinearBindingResult["status"];
  readonly settledStatus: LinearBindingResult["status"] | null;
  readonly candidateDigest: string | null;
  readonly checkReceiptPaths: readonly string[];
  readonly integration: unknown | null;
  readonly completion: unknown | null;
}

export type LinearDeliveryOutcome =
  | { readonly status: "completed"; readonly evidence: LinearDeliveryEvidence }
  | { readonly status: "refused"; readonly reasonCode: string; readonly evidence: LinearDeliveryEvidence };

type SettledLinearBinding = { readonly status: "SETTLED"; readonly binding: LinearBindingResult["binding"] };

interface DeliveryCheckpoint {
  readonly schema: "urn:usf:linear-delivery-checkpoint:1";
  readonly bindingIri: string;
  readonly attemptKey: string;
  readonly basisDigest: string;
  readonly phase: string;
  readonly at: string;
  readonly detail: LinearRecordObject;
}

function refusal(
  reasonCode: string,
  evidence: LinearDeliveryEvidence,
): LinearDeliveryOutcome {
  return Object.freeze({ status: "refused", reasonCode, evidence: Object.freeze(evidence) });
}

function reasonCode(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const code = (error as { reasonCode?: unknown; code?: unknown }).reasonCode
      ?? (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_:-]+$/u.test(code)) return code;
  }
  return fallback;
}

function resultObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function containedRoot(root: string): string {
  const canonical = resolve(root);
  if (canonical === resolve(sep)) throw new Error("LINEAR_DELIVERY_ROOT_INVALID");
  return canonical;
}

function checkpointKey(
  binding: Extract<LinearBindingResult, { readonly binding: unknown }>,
  phase: string,
  detail: LinearRecordObject,
): string {
  const digest = canonicalDigest({
    attemptKey: binding.binding.unit.attemptKey,
    basisDigest: binding.binding.unit.basisDigest,
    phase,
    detail,
  });
  return `delivery-${digest.slice("sha256:".length)}`;
}

async function persistCheckpoint(
  root: string,
  binding: Extract<LinearBindingResult, { readonly binding: unknown }>,
  phase: string,
  detail: LinearRecordObject,
): Promise<string> {
  const checkpoint: DeliveryCheckpoint = Object.freeze({
    schema: "urn:usf:linear-delivery-checkpoint:1",
    bindingIri: binding.binding.authority.bindingIri,
    attemptKey: binding.binding.unit.attemptKey,
    basisDigest: binding.binding.unit.basisDigest,
    phase,
    at: new Date().toISOString(),
    detail: Object.freeze({ ...detail }),
  });
  const key = checkpointKey(binding, phase, detail);
  const persisted: LinearRecordObject = {
    schema: checkpoint.schema,
    bindingIri: checkpoint.bindingIri,
    attemptKey: checkpoint.attemptKey,
    basisDigest: checkpoint.basisDigest,
    phase: checkpoint.phase,
    at: checkpoint.at,
    detail: checkpoint.detail,
  };
  await writeLinearRecord(root, key, persisted);
  return key;
}

async function readCheckpoint(
  root: string,
  binding: Extract<LinearBindingResult, { readonly binding: unknown }>,
  phase: string,
  detail: LinearRecordObject,
): Promise<DeliveryCheckpoint | null> {
  const value = await readLinearRecord(root, checkpointKey(binding, phase, detail));
  const record = resultObject(value);
  if (record === null) return null;
  if (record.schema !== "urn:usf:linear-delivery-checkpoint:1"
    || record.bindingIri !== binding.binding.authority.bindingIri
    || record.attemptKey !== binding.binding.unit.attemptKey
    || record.basisDigest !== binding.binding.unit.basisDigest
    || record.phase !== phase
    || typeof record.at !== "string"
    || canonicalDigest(record.detail) !== canonicalDigest(detail)) {
    throw new Error("LINEAR_DELIVERY_CHECKPOINT_INVALID");
  }
  return record as unknown as DeliveryCheckpoint;
}

function evidenceFor(selector: LinearBindingSelector, checkpointRecordKey: string, preparedStatus: LinearBindingResult["status"]): LinearDeliveryEvidence {
  return {
    bindingIri: selector.bindingIri,
    checkpointPath: checkpointRecordKey,
    checkpointRecordKey,
    preparedStatus,
    settledStatus: null,
    candidateDigest: null,
    checkReceiptPaths: Object.freeze([]),
    integration: null,
    completion: null,
  };
}

function completionRefusal(output: unknown, fallback: string): Error {
  const code = reasonCode(output, fallback);
  return Object.assign(new Error(code), { reasonCode: code });
}

async function completeCurrentWork(
  root: string,
  binding: LinearBindingResult,
  candidateDigest: string,
) {
  const { profile, manifestPath, workIri } = binding.binding.unit;
  const selection = ["--work", workIri, "--profile", profile, "--manifest", manifestPath];
  const realised = await realiseCommandHandler({
    command: "realise", repositoryRoot: root,
    args: ["no-change", ...selection],
  });
  const realisedOutput = resultObject(realised.output);
  const noChangeDigest = realisedOutput?.candidateDigest;
  if ((realised.exitCode ?? 0) !== 0
    || realisedOutput?.schema !== "urn:usf:no-change-realisation-result:1"
    || typeof noChangeDigest !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(noChangeDigest)) {
    throw completionRefusal(realised.output, "LINEAR_DELIVERY_NO_CHANGE_REALISATION_REFUSED");
  }
  const authority = binding.binding.unit.packet.realisationAuthority;
  const completionValidationIds = [...new Set(authority?.completionValidationObligations ?? [])].sort();
  if (!completionValidationIds.length) {
    throw completionRefusal(null, "LINEAR_DELIVERY_COMPLETION_VALIDATION_MISSING");
  }
  const obligation = authority?.completionProofObligation;
  if (typeof obligation !== "string" || obligation.length === 0) {
    throw completionRefusal(null, "LINEAR_DELIVERY_COMPLETION_PROOF_OBLIGATION_MISSING");
  }
  const completionReceiptPaths: string[] = [];
  for (const validationId of completionValidationIds) {
    const checked = await runGraphDerivedCheck(root, noChangeDigest, validationId);
    if (checked.status !== "pass" || typeof checked.receiptPath !== "string" || checked.receiptPath.length === 0) {
      throw completionRefusal(checked, "LINEAR_DELIVERY_COMPLETION_CHECK_REFUSED");
    }
    completionReceiptPaths.push(checked.receiptPath);
  }
  const artifactStem = ".usf/candidates/work-completion/" + candidateDigest.slice("sha256:".length);
  const evidencePath = artifactStem + ".evidence.json";
  const evidence = await completionAwareEvidenceCommandHandler({
    command: "evidence", repositoryRoot: root,
    args: ["completion", "--candidate", noChangeDigest, ...selection, "--output", evidencePath],
  });
  if ((evidence.exitCode ?? 0) !== 0 || resultObject(evidence.output)?.schema !== "urn:usf:completion-evidence-candidate:1") {
    throw completionRefusal(evidence.output, "LINEAR_DELIVERY_COMPLETION_EVIDENCE_REFUSED");
  }
  const proofPath = artifactStem + ".proof.json";
  const proof = await completionAwareProveCommandHandler({
    command: "prove", repositoryRoot: root,
    args: ["completion", "--obligation", obligation, "--evidence", evidencePath,
      "--profile", profile, "--manifest", manifestPath, "--output", proofPath],
  });
  if ((proof.exitCode ?? 0) !== 0 || resultObject(proof.output)?.schema !== "urn:usf:completion-proof-bundle:1") {
    throw completionRefusal(proof.output, "LINEAR_DELIVERY_COMPLETION_PROOF_REFUSED");
  }
  const publicationArgs = ["work-completion", "--bundle", proofPath, "--profile", profile, "--manifest", manifestPath];
  const verification = await completionAwarePublishCommandHandler({
    command: "publish", repositoryRoot: root, args: [...publicationArgs, "--verify"],
  });
  const verificationOutput = resultObject(verification.output);
  if ((verification.exitCode ?? 0) !== 0 || verificationOutput?.status !== "verified" || verificationOutput.mode !== "verify") {
    throw completionRefusal(verification.output, "LINEAR_DELIVERY_COMPLETION_VERIFICATION_REFUSED");
  }
  const publication = await completionAwarePublishCommandHandler({
    command: "publish", repositoryRoot: root, args: [...publicationArgs, "--apply"],
  });
  const publicationOutput = resultObject(publication.output);
  if ((publication.exitCode ?? 0) !== 0 || publicationOutput?.status !== "verified" || publicationOutput.mode !== "apply") {
    throw completionRefusal(publication.output, "LINEAR_DELIVERY_COMPLETION_PUBLICATION_REFUSED");
  }
  return Object.freeze({
    realised: realised.output,
    checkReceiptPaths: Object.freeze(completionReceiptPaths),
    evidence: evidence.output, proof: proof.output,
    verification: verification.output, publication: publication.output,
  });
}

async function refreshConstructionAuthority(
  root: string,
  binding: Extract<LinearBindingResult, { readonly binding: unknown }>,
  candidateDigest: string,
): Promise<unknown> {
  const { profile, manifestPath, workIri } = binding.binding.unit;
  const obligation = binding.binding.unit.packet.realisationAuthority?.constructionProofObligation;
  if (typeof obligation !== "string") throw new Error("LINEAR_DELIVERY_CONSTRUCTION_PROOF_OBLIGATION_MISSING");
  const stem = candidateDigest.slice("sha256:".length);
  const evidencePath = `.usf/candidates/construction-authority/${stem}.evidence.json`;
  const evidence = await evidenceCommandHandler({ command: "evidence", repositoryRoot: root, args: ["construction", "--work", workIri, "--profile", profile, "--manifest", manifestPath, "--output", evidencePath] });
  if (resultObject(evidence.output)?.schema !== "urn:usf:construction-evidence-candidate:1") throw new Error("LINEAR_DELIVERY_CONSTRUCTION_EVIDENCE_REFUSED");
  const proofPath = `.usf/candidates/construction-authority/${stem}.proof.json`;
  const proof = await proveCommandHandler({ command: "prove", repositoryRoot: root, args: ["construction", "--obligation", obligation, "--evidence", evidencePath, "--profile", profile, "--manifest", manifestPath, "--output", proofPath] });
  if (resultObject(proof.output)?.schema !== "urn:usf:construction-proof-bundle:1") throw new Error("LINEAR_DELIVERY_CONSTRUCTION_PROOF_REFUSED");
  const publication = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root, args: ["construction-authority", "--bundle", proofPath, "--profile", profile, "--manifest", manifestPath, "--apply"] });
  const output = resultObject(publication.output);
  if (output?.status !== "ok" || output.mode !== "apply") throw new Error("LINEAR_DELIVERY_CONSTRUCTION_PUBLICATION_REFUSED");
  return Object.freeze({ evidence: evidence.output, proof: proof.output, publication: publication.output });
}

/**
 * Deliver exactly one graph-authorised Linear binding through the existing
 * Hermes and realisation handlers. This function never treats a transport
 * report, unknown attempt, or contribution parse as delivery completion.
 */
export async function executeLinearDelivery(root: string, selector: LinearBindingSelector, envFile: string): Promise<LinearDeliveryOutcome> {
  let repositoryRoot: string;
  try {
    repositoryRoot = containedRoot(root);
    if (containedRoot(selector.repositoryRoot) !== repositoryRoot || !envFile || envFile.startsWith("-")) throw new Error("LINEAR_DELIVERY_INPUT_INVALID");
  } catch (error) {
    const evidence = evidenceFor(selector, "", "PREPARED");
    return refusal(reasonCode(error, "LINEAR_DELIVERY_INPUT_INVALID"), evidence);
  }

  let prepared: LinearBindingResult;
  let checkpointRecordKey = "";
  try {
    prepared = await prepareLinearBinding(Object.freeze({ ...selector, repositoryRoot }));
    checkpointRecordKey = await persistCheckpoint(repositoryRoot, prepared, "prepared", { status: prepared.status });
  } catch (error) {
    const evidence = evidenceFor(selector, checkpointRecordKey, "PREPARED");
    return refusal(reasonCode(error, "LINEAR_DELIVERY_PREPARE_REFUSED"), evidence);
  }
  let evidence = evidenceFor(selector, checkpointRecordKey, prepared.status);
  if (prepared.status === "COMPLETED") return Object.freeze({ status: "completed", evidence });
  if (prepared.status === "UNKNOWN") return refusal("LINEAR_BINDING_OUTCOME_UNKNOWN", evidence);
    if (prepared.binding.authority.realisationDisposition === "no-change") {
      if (prepared.status !== "PREPARED") {
        return refusal("LINEAR_BINDING_NATIVE_COMPLETION_REQUIRES_PREPARED", evidence);
      }
      try {
        const native = await withNativeLinearCompletion(
          { ...selector, repositoryRoot },
          prepared.binding.unit.attemptKey,
          current => completeCurrentWork(repositoryRoot, current, current.binding.unit.attemptKey),
        );
        evidence = {
          ...evidence,
          settledStatus: native.binding.status,
          checkReceiptPaths: native.result?.checkReceiptPaths ?? [],
          completion: native.result,
        };
        if (native.binding.status !== "COMPLETED") {
          return refusal("LINEAR_DELIVERY_COMPLETION_READBACK_REFUSED", evidence);
        }
        const completed = await observeLinearBinding({ ...selector, repositoryRoot });
        if (completed.status !== "COMPLETED") {
          return refusal("LINEAR_DELIVERY_COMPLETION_READBACK_REFUSED", evidence);
        }
        return Object.freeze({ status: "completed", evidence: Object.freeze(evidence) });
      } catch (error) {
        return refusal(reasonCode(error, "LINEAR_DELIVERY_NATIVE_COMPLETION_REFUSED"), evidence);
      }
    }


  let settled: SettledLinearBinding;
  let beforeDispatchCheckpoint: DeliveryCheckpoint | null;
  try {
    beforeDispatchCheckpoint = await readCheckpoint(repositoryRoot, prepared, "before-hermes-run", { status: prepared.status });
  } catch (error) {
    return refusal(reasonCode(error, "LINEAR_DELIVERY_CHECKPOINT_READ_REFUSED"), evidence);
  }
  if (prepared.status === "PREPARED" || prepared.status === "STARTED" || prepared.status === "REFUSED") {
    try {
      // Persist before dispatch because Hermes changes an attempt from PREPARED
      // to STARTED before any provider-side invocation can occur.
      if (beforeDispatchCheckpoint === null) {
        checkpointRecordKey = await persistCheckpoint(repositoryRoot, prepared, "before-hermes-run", { status: prepared.status });
      } else {
        checkpointRecordKey = checkpointKey(prepared, "before-hermes-run", { status: prepared.status });
      }
      evidence = { ...evidence, checkpointRecordKey };
      await hermesCommand(repositoryRoot, ["run", "--binding", selector.bindingIri, "--env-file", envFile]);
    } catch (error) {
      return refusal(reasonCode(error, "LINEAR_DELIVERY_HERMES_RUN_REFUSED"), evidence);
    }
  }
  try {
    const observed = await observeLinearBinding(Object.freeze({ ...selector, repositoryRoot }));
    evidence = { ...evidence, settledStatus: observed.status };
    if (observed.status === "COMPLETED") return Object.freeze({ status: "completed", evidence });
    if (observed.status === "REFUSED") return refusal("LINEAR_BINDING_PROVIDER_REFUSED", evidence);
    if (observed.status !== "SETTLED") return refusal("LINEAR_BINDING_OUTCOME_UNKNOWN", evidence);
    settled = { status: "SETTLED", binding: observed.binding };
    if (prepared.status === "PREPARED") {
      checkpointRecordKey = await persistCheckpoint(repositoryRoot, settled, "settled", { status: settled.status, resultDigest: settled.binding.attempt.executionResultDigest });
      evidence = { ...evidence, checkpointRecordKey };
    }
  } catch (error) {
    return refusal(reasonCode(error, "LINEAR_DELIVERY_SETTLEMENT_READBACK_REFUSED"), evidence);
  }

  try {
    const contribution = await contributionFromSettledLinearResult(Object.freeze({ root: repositoryRoot, selector: Object.freeze({ ...selector, repositoryRoot }), binding: settled }));
    const resolution = resolveCommand([contribution]);
    if (resolution.status !== "resolved" || resolution.candidate === null) return refusal("LINEAR_DELIVERY_RESOLUTION_REFUSED", evidence);
    const candidateDigest = resolution.candidate.identity.artifactDigest;
    const operations = resolution.candidate.payload.operations;
    const candidate: CandidateSpec = Object.freeze({
      digest: candidateDigest,
      basis: resolution.candidate.basis,
      operations,
      lineage: resolution.candidate.lineage,
      scope: Object.freeze(candidateScope(resolution.candidate.basis)),
      writeSet: Object.freeze(operations.map((operation) => operation.path).sort()),
      preimages: Object.freeze(await deriveCandidatePreimages(repositoryRoot, resolution.candidate.basis, operations.map((operation) => operation.path).sort())),
    });
    const applied = await apply(repositoryRoot, { candidate });
    if (applied.status !== "applied") return refusal(applied.reasonCode, { ...evidence, candidateDigest });
    const validationIds = [...new Set(settled.binding.unit.packet.validationPlan.map((validation) => validation.id))].sort();
    if (validationIds.length === 0) return refusal("LINEAR_DELIVERY_VALIDATION_MISSING", { ...evidence, candidateDigest });
    const receiptPaths: string[] = [];
    for (const validationId of validationIds) {
      const checked = await runGraphDerivedCheck(repositoryRoot, candidateDigest, validationId);
      if (checked.status !== "pass" || typeof checked.receiptPath !== "string") return refusal(checked.status === "refused" ? checked.reasonCode : "LINEAR_DELIVERY_CHECK_REFUSED", { ...evidence, candidateDigest, checkReceiptPaths: Object.freeze(receiptPaths) });
      receiptPaths.push(checked.receiptPath);
    }
    checkpointRecordKey = await persistCheckpoint(repositoryRoot, settled, "before-integration", { candidateDigest, validations: validationIds });
    evidence = { ...evidence, checkpointRecordKey, candidateDigest, checkReceiptPaths: Object.freeze(receiptPaths) };
    const integration = await integrateCommandHandler({ command: "integrate", repositoryRoot, args: ["--candidate", candidateDigest] });
    if (resultObject(integration.output)?.outcome !== "urn:usf:outcome:integration-success") return refusal(String(resultObject(integration.output)?.reasonCode ?? "LINEAR_DELIVERY_INTEGRATION_REFUSED"), { ...evidence, integration: integration.output });
    checkpointRecordKey = await persistCheckpoint(repositoryRoot, settled, "integrated", { candidateDigest });
    evidence = { ...evidence, checkpointRecordKey, integration: integration.output };
    checkpointRecordKey = await persistCheckpoint(repositoryRoot, settled, "before-construction-refresh", { candidateDigest });
    evidence = { ...evidence, checkpointRecordKey };
    const construction = await refreshConstructionAuthority(repositoryRoot, settled, candidateDigest);
    checkpointRecordKey = await persistCheckpoint(repositoryRoot, settled, "before-completion-publication", { candidateDigest });
    evidence = { ...evidence, checkpointRecordKey };
    const completion = await completeCurrentWork(repositoryRoot, settled, candidateDigest);
    const final = await observeLinearBinding(Object.freeze({ ...selector, repositoryRoot }));
    if (final.status !== "COMPLETED") return refusal("LINEAR_DELIVERY_COMPLETION_READBACK_REFUSED", { ...evidence, completion: Object.freeze({ construction, completion }) });
    return Object.freeze({ status: "completed", evidence: { ...evidence, settledStatus: final.status, completion: Object.freeze({ construction, completion }) } });
  } catch (error) {
    return refusal(reasonCode(error, "LINEAR_DELIVERY_GOVERNED_PATH_REFUSED"), evidence);
  }
}
