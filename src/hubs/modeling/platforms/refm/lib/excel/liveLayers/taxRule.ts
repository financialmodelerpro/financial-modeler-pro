/**
 * taxRule.ts (2026-10-11), THE TAX CHARGE AS EXCEL FORMULAS, ONE PLACE.
 *
 * The formula twin of `chargeTax` (core/calculations/taxCharge.ts), read by the
 * P&L (stage 5) and by both financing solves (stage 6), which each carry their
 * own P&L down to tax.
 *
 *   zakat  tax = MAX(0, base) x rate: each year on its own.
 *   cit    a loss goes into a pool; in a profit year the relief is the smaller
 *          of the pool and 25% of the profit; tax = MAX(0, base - relief) x rate.
 *          Three rows a year: relief, the pool at the close, and the tax.
 *
 * `base` is the taxable profit: profit before tax, less the disposal gain unless
 * the project taxes it.
 *
 * No em dashes in this file.
 */
import { CIT_LOSS_RELIEF_CAP } from '@/src/core/calculations/taxCharge';

/** The relief taken this year from the pool brought forward. */
export const citReliefF = (base: string, poolBefore: string): string => `IF(${base}>0,MIN(${poolBefore},${base}*${CIT_LOSS_RELIEF_CAP}),0)`;
/** The pool at the close: brought forward, plus this year's loss, less the relief. */
export const citPoolF = (base: string, poolBefore: string, relief: string): string => `${poolBefore}+MAX(0,-${base})-${relief}`;
/** The charge: on zakat `relief` is omitted. */
export const taxF = (base: string, rate: string, relief?: string): string => `MAX(0,${base}${relief ? `-${relief}` : ''})*${rate}`;
