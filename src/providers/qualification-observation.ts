/**
 * Qualification observations, re-exported.
 *
 * The implementation lives in `qualification.ts` because several works declare
 * that path in their read scope or validation runtime closure, and admitting a
 * new peer module into each of them would require editing graph sources pinned
 * by the immutable bootstrap admission and a historical carrier postimage.
 * This module is the name a reader would look for; it adds no behaviour of its
 * own and must never grow any, or the two would drift.
 */
export {
  answerDigest,
  answersFromObservations,
  assertObservationSet,
  earliestObservedAt,
  observationSetDigest,
  promptDigest,
  qualificationObservationDigest,
  QualificationObservationError,
  sealQualificationObservation,
  type ObservationSetExpectation,
  type QualificationObservation,
  type QualificationObservationReason,
  type QualificationObservationUsage,
} from "./qualification.ts";
