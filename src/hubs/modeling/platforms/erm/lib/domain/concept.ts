import { z } from 'zod';
import { codeSchema, idSchema, textSchema, type Unit } from './primitives';

// Concepts describe dimensions. Currency belongs to observations, so a revenue
// concept can serve Saudi and other GCC issuers without currency-specific copies.
export const conceptUnitSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('money') }),
  z.strictObject({ kind: z.literal('money_per_share') }),
  z.strictObject({ kind: z.literal('shares') }),
  z.strictObject({ kind: z.literal('ratio') }),
  z.strictObject({ kind: z.literal('quantity'), code: codeSchema }),
]);

export const conceptSchema = z.strictObject({
  code: codeSchema, taxonomyVersion: textSchema, label: textSchema, definition: textSchema,
  statement: z.enum(['income_statement', 'balance_sheet', 'cash_flow', 'per_share', 'kpi']),
  periodKind: z.enum(['instant', 'duration']),
  canonicalUnit: conceptUnitSchema,
  signConvention: z.enum(['positive', 'negative', 'either']),
  applicability: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('general') }),
    z.strictObject({ kind: z.literal('sector'), sectorId: idSchema }),
    z.strictObject({ kind: z.literal('company'), companyId: idSchema }),
  ]),
});

export type FinancialConcept = z.infer<typeof conceptSchema>;
export function conceptAcceptsUnit(concept: FinancialConcept, unit: Unit): boolean {
  return unit.kind === concept.canonicalUnit.kind &&
    (unit.kind !== 'quantity' || concept.canonicalUnit.kind !== 'quantity' || unit.code === concept.canonicalUnit.code);
}
// KPIs use exactly the same value, period, source and revision contracts as financial facts.
export type KpiDefinition = FinancialConcept & { statement: 'kpi' };
