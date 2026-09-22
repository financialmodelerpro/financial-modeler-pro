import { z } from 'zod';
import { codeSchema, idSchema, reviewSchema, textSchema, timestampBefore, timestampSchema, unitSchema, valueSchema } from './primitives';
import { provenanceSchema, sourceLocationSchema } from './lineage';
import { reportingPeriodSchema } from './period';

export const revisionReasons = ['issuer_restatement', 'extraction_correction', 'reviewer_correction', 'taxonomy_remap', 'unit_correction'] as const;
export const revisionSchema = z.strictObject({
  chainId: idSchema, number: z.int().positive(), recordedAt: timestampSchema, effectiveFrom: timestampSchema,
  origin: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('original') }),
    z.strictObject({ kind: z.enum(revisionReasons), previousFactId: idSchema, explanation: textSchema }),
  ]),
  lifecycle: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('current') }),
    z.strictObject({ status: z.literal('superseded'), supersededBy: idSchema, effectiveAt: timestampSchema, reason: z.enum(revisionReasons) }),
  ]),
}).superRefine((revision, ctx) => {
  if ((revision.number === 1) !== (revision.origin.kind === 'original')) ctx.addIssue({ code: 'custom', message: 'Only revision 1 is original; later revisions require a predecessor' });
  if (revision.lifecycle.status === 'superseded' && timestampBefore(revision.lifecycle.effectiveAt, revision.effectiveFrom)) ctx.addIssue({ code: 'custom', message: 'Supersession precedes effective start' });
});

export const scopeSchema = z.strictObject({
  consolidation: z.enum(['consolidated', 'standalone']),
  segmentId: idSchema.optional(), instrumentId: idSchema.optional(),
});

export const reportedFactSchema = z.strictObject({
  id: idSchema, companyId: idSchema, issuerLabel: textSchema,
  value: valueSchema, reportedText: textSchema, reportedUnitLabel: textSchema, unit: unitSchema,
  period: reportingPeriodSchema, scope: scopeSchema,
  sourceDocumentId: idSchema, sourceLocation: sourceLocationSchema, provenance: provenanceSchema,
  revision: revisionSchema, review: reviewSchema,
});

export const normalizedFactSchema = z.strictObject({
  id: idSchema, reportedFactId: idSchema,
  concept: z.strictObject({ code: codeSchema, taxonomyVersion: textSchema }),
  value: valueSchema,
  unit: unitSchema.refine((unit) => unit.kind === 'ratio' ? unit.representation === 'fraction' : unit.scale === 0, 'Normalized units must use base scale or ratio fractions'),
  mapping: z.strictObject({
    version: textSchema, mappedBy: idSchema, mappedAt: timestampSchema,
    transformations: z.array(z.strictObject({
      kind: z.enum(['identity', 'unit_scale', 'sign_change', 'concept_mapping', 'currency_conversion']),
      ruleVersion: textSchema, explanation: textSchema,
    })).min(1),
  }),
  revision: revisionSchema, review: reviewSchema,
});

export type ReportedFact = z.infer<typeof reportedFactSchema>;
export type NormalizedFact = z.infer<typeof normalizedFactSchema>;
export type FactRevision = z.infer<typeof revisionSchema>;
