import { z } from 'zod';
import { reportedFactSchema, type ReportedFact } from '../domain/facts';
import { codeSchema, idSchema, textSchema, timestampSchema } from '../domain/primitives';
import { conceptAcceptsUnit, conceptSchema } from '../domain/concept';
import { report, validateContract, validateReportedFact, type ConceptContext, type ValidationResult } from '../data/validation';

export const manualEntrySchema = reportedFactSchema.omit({ id: true, revision: true, review: true, provenance: true }).extend({
  proposedConcept: z.strictObject({ code: codeSchema, taxonomyVersion: textSchema }),
});
export type ManualEntryInput = z.infer<typeof manualEntrySchema>;

// Future authenticated service supplies these, never the editable UI payload.
export const submissionContextSchema = z.strictObject({
  factId: idSchema, chainId: idSchema, actorId: idSchema, at: timestampSchema,
});
export type SubmissionContext = z.infer<typeof submissionContextSchema>;
export interface ManualSubmission {
  reported: ReportedFact;
  proposedConcept: ManualEntryInput['proposedConcept'];
}

/** Pure preparation only. Does not save, authorize, map values, or grant approval. */
export function prepareManualSubmission(input: unknown, submission: SubmissionContext, context: ConceptContext): ValidationResult<ManualSubmission> {
  const parsed = validateContract(manualEntrySchema, input);
  if (!parsed.ok) return parsed;
  const actor = validateContract(submissionContextSchema, submission);
  if (!actor.ok) return actor;
  const concept = validateContract(conceptSchema, context.concept);
  if (!concept.ok) return concept;
  const { proposedConcept, ...fields } = parsed.value;
  const fact = validateReportedFact({
    ...fields, id: submission.factId,
    provenance: { method: 'manual', enteredBy: submission.actorId, enteredAt: submission.at },
    revision: { chainId: submission.chainId, number: 1, recordedAt: submission.at, effectiveFrom: submission.at, origin: { kind: 'original' }, lifecycle: { status: 'current' } },
    review: { status: 'submitted', submittedBy: submission.actorId, submittedAt: submission.at },
  }, { company: context.company, document: context.document, segments: context.segments, instruments: context.instruments });
  if (!fact.ok) return fact;
  const definition = concept.value;
  if (proposedConcept.code !== definition.code || proposedConcept.taxonomyVersion !== definition.taxonomyVersion ||
      fields.period.kind !== definition.periodKind || !conceptAcceptsUnit(definition, fields.unit) ||
      (definition.applicability.kind === 'company' && definition.applicability.companyId !== fields.companyId) ||
      (definition.applicability.kind === 'sector' && definition.applicability.sectorId !== context.company.sectorId)) {
    return { ok: false, report: report([{ code: 'concept_selection', path: 'proposedConcept', severity: 'error', message: 'Selected concept must resolve and match this issuer, period and unit dimension' }]) };
  }
  return { ok: true, value: { reported: fact.value, proposedConcept }, report: report([]) };
}
