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
export const irrOf = (r: string): string => `IFERROR(IRR(${r}),IFERROR(IRR(${r},-0.5),IRR(${r},1)))`;
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
  `"${cur} "&IF(ROUND(ABS(${e})/1000000,1)=0,"-",IF(${e}<0,"("&TEXT(ABS(${e})/1000000,"#,##0.0")&")",TEXT(ABS(${e})/1000000,"#,##0.0")))&" m"`;
/** safeRatio then retPct: "n/a" unless the denominator is positive. */
export const ratioT = (num: string, den: string, d = 1): string => `IF(${den}>0,${pctT(`(${num})/(${den})`, d)},"n/a")`;
/** A ratio over a series whose unmeasured years print "-": "n/a" when no year is measured. */
export const seriesT = (fn: 'MIN' | 'MAX' | 'AVERAGE', rng: string, fmt: (e: string) => string): string =>
  `IF(COUNT(${rng})=0,"n/a",${fmt(`${fn}(${rng})`)})`;
