/**
 * excelText.ts (2026-09-27), THE PLATFORM'S NUMBER WORDS AS EXCEL FORMULAS.
 *
 * The Returns sheet prints its ratios the way the screen does ("16.4%", "2.00x",
 * "SAR 1,336.7 m", "n/a"), as text. A live cell must print the same words, so
 * each formatter in buildModelWorkbook (retPct, retMult, retMoney, which reads
 * formatAccounting at millions, one decimal, brackets for a negative and a dash
 * for a figure that rounds to nothing) has its formula twin here, ONE place.
 *
 * No em dashes in this file.
 */

/** Excel's IRR, retried from two further guesses before giving up (the engine
 *  falls back to bisection, so a root far from 10% must still be found). */
// Excel's IRR fails to converge from a guess far from the root: a sale in an early exit
// year can lose three quarters of the equity (-76.5%, 2026-09-28), which neither 0.1 nor
// -0.5 reaches, so the deep negative guesses come before the high one.
export const irrOf = (r: string): string => `IFERROR(IRR(${r}),IFERROR(IRR(${r},-0.5),IFERROR(IRR(${r},-0.8),IFERROR(IRR(${r},-0.95),IRR(${r},1)))))`;
/** retPct: a fraction as a percentage with d decimals. */
export const pctT = (e: string, d = 1): string => `TEXT(${e},"${d > 0 ? `0.${'0'.repeat(d)}` : '0'}%")`;
/** An IRR in words, "n/a" where the stream has none. */
export const irrT = (r: string): string => `IFERROR(${pctT(irrOf(r))},"n/a")`;
/** retMult. */
export const multT = (e: string): string => `TEXT(${e},"0.00")&"x"`;
/** MOIC: money in over money out (0 when nothing went in). */
export const moicOf = (r: string): string => `IF(-SUMIF(${r},"<0")>0,SUMIF(${r},">0")/-SUMIF(${r},"<0"),0)`;
/** retMoney: millions, one decimal, "(x)" when negative, "-" when it rounds to nothing. */
export const moneyT = (cur: string) => (e: string): string =>
  // One TEXT with a negative and a zero section (2026-10-20): "(x)" when negative, "-" when it rounds to nothing.
  `"${cur} "&TEXT(ROUND((${e})/1000000,1),"#,##0.0;(#,##0.0);-")&" m"`;
/** safeRatio then retPct: "n/a" unless the denominator is positive. */
export const ratioT = (num: string, den: string, d = 1): string => `IF(${den}>0,${pctT(`(${num})/(${den})`, d)},"n/a")`;
/** A ratio over a series whose unmeasured years print "-": "n/a" when no year is measured. */
export const seriesT = (fn: 'MIN' | 'MAX' | 'AVERAGE', rng: string, fmt: (e: string) => string): string =>
  `IF(COUNT(${rng})=0,"n/a",${fmt(`${fn}(${rng})`)})`;
/**
 * formatAccounting at a display scale with the label unit (makeLabelMoney): "-" where the
 * figure rounds to nothing, "(x)" when negative, the scale's unit after it.
 */
export const accT = (e: string, scale: 'full' | 'thousands' | 'millions', d: number): string => {
  const div = scale === 'millions' ? 1000000 : scale === 'thousands' ? 1000 : 1;
  const unit = scale === 'millions' ? ' m' : scale === 'thousands' ? ' k' : '';
  const fmt = d > 0 ? `#,##0.${'0'.repeat(d)}` : '#,##0';
  // One TEXT with a negative and a zero section (2026-10-20): "(x)" when negative, "-" when it rounds to nothing.
  return `TEXT(ROUND(${div === 1 ? e : `(${e})/${div}`},${d}),"${fmt};(${fmt});-")${unit ? `&"${unit}"` : ''}`;
};

/**
 * A WORKING ROW'S LABEL IN PLAIN WORDS (2026-10-20, founder): sentence case and short, the
 * longer engine names said more simply. The Guide says what the workings are for.
 */
const WORKING_WORDS: Array<[RegExp, string]> = [
  [/^FCFE before the terminal value and the cash released at the exit$/, 'FCFE before terminal value and released cash'],
  [/^the exit dividend already pays the proceeds out \(1 = yes\)$/, 'Exit dividend pays out the proceeds (1 = yes)'],
  [/^cash from investing: cash capex, before the exit proceeds$/, 'Cash capex, before exit proceeds'],
  [/^stabilisation: consecutive years at the steady growth$/, 'Stabilisation: years in a row at steady growth'],
  [/^operating year \(any phase in its operations window\)$/, 'Operating year (any phase operating)'],
  [/^terminal equity value \(less the debt at the exit\)$/, 'Exit equity value (less exit debt)'],
  [/^terminal enterprise value \(the exit proceeds\)$/, 'Exit enterprise value (exit proceeds)'],
  [/^terminal equity not already paid as a dividend$/, 'Exit equity not paid as a dividend'],
  [/^cash held back at the exit, released to equity$/, 'Cash held back, released at exit'],
  [/^gross development value \(revenue over the hold\)$/, 'Gross development value (revenue over hold)'],
  [/terminal equity plus cash released/, 'exit equity plus cash'],
  [/^Area available while letting, sqm-years$/, 'Area available, sqm-years'],
];
export function workingLabel(s: string): string {
  let out = s;
  for (const [re, to] of WORKING_WORDS) out = out.replace(re, to);
  return out.charAt(0).toUpperCase() + out.slice(1);
}
