import { z } from 'zod';

// IDs are opaque application identifiers. Storage-specific UUIDs are deferred.
export const idSchema = z.string().min(1).refine((s) => s.trim() === s && s.length > 0, 'Nonblank ID required');
export const textSchema = z.string().refine((s) => s.trim().length > 0, 'Nonblank text required');
export const dateSchema = z.iso.date();
export const timestampSchema = z.iso.datetime().regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/); // UTC, up to milliseconds.
export const timestampBefore = (a: string, b: string): boolean => Date.parse(a) < Date.parse(b);
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const countrySchema = z.string().regex(/^[A-Z]{2}$/);
export const codeSchema = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/);
export const webUrlSchema = z.string().url().refine((s) => /^https?:\/\//.test(s), 'HTTP(S) URL required');

// No Number(), coercion, implicit rounding, or null-to-zero conversion at ingestion.
export const decimalSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Plain decimal string required');
export const valueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('known'), decimal: decimalSchema }),
  z.strictObject({ kind: z.literal('missing'), reason: z.enum(['not_reported', 'not_applicable', 'unreadable', 'withheld']) }),
]);

export const unitSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('money'), currency: currencySchema, scale: z.int().min(-12).max(12) }),
  z.strictObject({ kind: z.literal('money_per_share'), currency: currencySchema, scale: z.int().min(-12).max(12) }),
  z.strictObject({ kind: z.literal('shares'), scale: z.int().min(-12).max(12) }),
  z.strictObject({ kind: z.literal('ratio'), representation: z.enum(['fraction', 'percent', 'basis_points']) }),
  z.strictObject({ kind: z.literal('quantity'), code: codeSchema, scale: z.int().min(-12).max(12) }),
]);

export const reviewSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('draft') }),
  z.strictObject({ status: z.literal('submitted'), submittedBy: idSchema, submittedAt: timestampSchema }),
  z.strictObject({ status: z.literal('approved'), reviewedBy: idSchema, reviewedAt: timestampSchema, note: textSchema.optional() }),
  z.strictObject({ status: z.literal('rejected'), reviewedBy: idSchema, reviewedAt: timestampSchema, reason: textSchema }),
]);

export type FactValue = z.infer<typeof valueSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Review = z.infer<typeof reviewSchema>;
