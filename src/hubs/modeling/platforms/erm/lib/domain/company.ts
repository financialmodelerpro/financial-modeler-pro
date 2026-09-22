import { z } from 'zod';
import { codeSchema, countrySchema, currencySchema, dateSchema, idSchema, textSchema, webUrlSchema } from './primitives';

export const sectorSchema = z.strictObject({
  id: idSchema, code: codeSchema, name: textSchema,
  classification: textSchema, classificationVersion: textSchema,
  parentId: idSchema.optional(),
});

export const companySchema = z.strictObject({
  id: idSchema, legalName: textSchema, displayName: textSchema, arabicName: textSchema.optional(),
  country: countrySchema, sectorId: idSchema, industry: textSchema.optional(),
  status: z.enum(['active', 'inactive', 'dissolved']),
  fiscalYearEnd: z.strictObject({ month: z.int().min(1).max(12), day: z.int().min(1).max(31) })
    .refine(({ month, day }) => day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1], 'Invalid fiscal year-end day'),
  reportingCurrency: currencySchema, website: webUrlSchema.optional(), investorRelationsUrl: webUrlSchema.optional(),
});

export const instrumentSchema = z.strictObject({
  id: idSchema, companyId: idSchema, ticker: textSchema, exchangeName: textSchema,
  mic: z.string().regex(/^[A-Z0-9]{4}$/), isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/).optional(),
  shareClass: textSchema, tradingCurrency: currencySchema,
  listingDate: dateSchema.optional(), delistingDate: dateSchema.optional(),
  status: z.enum(['active', 'suspended', 'delisted']),
}).superRefine((instrument, ctx) => {
  if (instrument.listingDate && instrument.delistingDate && instrument.delistingDate < instrument.listingDate) {
    ctx.addIssue({ code: 'custom', path: ['delistingDate'], message: 'Delisting precedes listing' });
  }
  if (instrument.delistingDate && instrument.status !== 'delisted') {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'A delisting date requires delisted status' });
  }
});

export const segmentSchema = z.strictObject({
  id: idSchema, companyId: idSchema, issuerCode: textSchema, name: textSchema,
  kind: z.enum(['business', 'geography', 'other']), parentId: idSchema.optional(),
  validFrom: dateSchema, validTo: dateSchema.optional(),
}).superRefine((segment, ctx) => {
  if (segment.id === segment.parentId) ctx.addIssue({ code: 'custom', path: ['parentId'], message: 'Segment cannot parent itself' });
  if (segment.validTo && segment.validTo < segment.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Invalid validity interval' });
});

export type Company = z.infer<typeof companySchema>;
export type ListedInstrument = z.infer<typeof instrumentSchema>;
export type Sector = z.infer<typeof sectorSchema>;
export type Segment = z.infer<typeof segmentSchema>;
