import { z } from 'zod';
import { dateSchema, idSchema, textSchema, timestampSchema, webUrlSchema } from './primitives';
import { reportingPeriodSchema } from './period';

export const sourceDocumentSchema = z.strictObject({
  id: idSchema, companyId: idSchema, title: textSchema,
  documentType: z.enum(['annual_report', 'interim_report', 'announcement', 'spreadsheet', 'manual_record', 'provider_record', 'other']),
  reportingPeriod: reportingPeriodSchema, publicationDate: dateSchema,
  retrievedAt: timestampSchema.optional(), sourceUrl: webUrlSchema.optional(),
  language: textSchema, assurance: z.enum(['audited', 'reviewed', 'unaudited', 'unknown']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  classification: z.enum(['official_filing', 'issuer_publication', 'licensed_provider', 'analyst_record', 'advisory_confidential']),
  rights: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('public_reference'), basis: textSchema }),
    z.strictObject({ kind: z.literal('licensed'), licenseReference: textSchema }),
    z.strictObject({ kind: z.literal('internal_only'), restriction: textSchema }),
    z.strictObject({ kind: z.literal('unknown') }),
  ]),
  version: z.int().positive(), replacesDocumentId: idSchema.optional(),
}).superRefine((document, ctx) => {
  if (document.id === document.replacesDocumentId) ctx.addIssue({ code: 'custom', message: 'Document cannot replace itself' });
  if ((document.version === 1) === Boolean(document.replacesDocumentId)) ctx.addIssue({ code: 'custom', message: 'Replacement versions require a predecessor; version 1 has none' });
  if (document.retrievedAt && document.retrievedAt.slice(0, 10) < document.publicationDate) ctx.addIssue({ code: 'custom', message: 'Retrieval precedes publication' });
  if (document.classification === 'advisory_confidential' && document.rights.kind !== 'internal_only') ctx.addIssue({ code: 'custom', message: 'Confidential documents must retain internal-only restrictions' });
});

export const sourceLocationSchema = z.strictObject({
  page: z.int().positive().optional(), table: textSchema.optional(), statement: textSchema.optional(),
  note: textSchema.optional(), reference: textSchema.optional(),
}).refine((location) => Object.values(location).some((value) => value !== undefined), 'At least one source locator is required');

export const provenanceSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('manual'), enteredBy: idSchema, enteredAt: timestampSchema }),
  z.strictObject({ method: z.literal('excel_import'), enteredBy: idSchema, enteredAt: timestampSchema, batchId: idSchema, sheet: textSchema, cell: textSchema }),
  z.strictObject({ method: z.literal('csv_import'), enteredBy: idSchema, enteredAt: timestampSchema, batchId: idSchema, row: z.int().positive(), column: textSchema }),
  z.strictObject({ method: z.literal('filing_extraction'), enteredBy: idSchema, enteredAt: timestampSchema, runId: idSchema, extractor: textSchema, extractorVersion: textSchema }),
  z.strictObject({ method: z.literal('provider_api'), enteredBy: idSchema, enteredAt: timestampSchema, provider: textSchema, requestReference: textSchema }),
]);

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type SourceLocation = z.infer<typeof sourceLocationSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
