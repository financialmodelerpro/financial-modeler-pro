/**
 * disposalReport.ts
 *
 * THE EXIT, WORKED THROUGH (2026-09-15, founder: "a working in the Returns at
 * the end where we calculate the terminal value and then the gain or loss, so
 * everywhere it flows properly and the terminal value moves with the basis").
 *
 * Nothing here computes: every figure is read from the disposal the financials
 * composer booked (`snap.disposal`) and the statements it booked it into, so the
 * working and the P&L, the cash flow, the balance sheet and the Returns streams
 * are one set of numbers. The tie-out rows at the foot say so period by period.
 *
 * Pure. No em dashes in this file.
 */
import type { ProjectFinancialsSnapshot } from '../financials-resolvers';
import type { computeReturnsSnapshot } from '../returns-resolvers';

type ReturnsSnap = ReturnType<typeof computeReturnsSnapshot>;

export type DisposalValueFormat = 'money' | 'pct' | 'mult' | 'text';

export interface DisposalWorkingRow {
  label: string;
  value?: number;
  text?: string;
  format?: DisposalValueFormat;
  kind?: 'section' | 'subtotal' | 'total' | 'note' | 'check';
  indent?: number;
}

export interface DisposalAssetRow {
  assetId: string;
  label: string;
  building: number;
  land: number;
  capitalisedInterest: number;
  total: number;
}

export interface DisposalWorking {
  booked: boolean;
  rows: DisposalWorkingRow[];
  byAsset: DisposalAssetRow[];
}

const METHOD_LABEL: Record<string, string> = {
  cap_rate: 'Exit cap rate',
  exit_multiple: 'Exit multiple',
  perpetuity: 'Perpetuity (Gordon)',
  none: 'None',
};

export function buildDisposalWorking(
  snap: Pick<ProjectFinancialsSnapshot, 'disposal' | 'pl' | 'directCF' | 'bs' | 'yearLabels'>,
  rs: Pick<ReturnsSnap, 'config' | 'terminalEnterpriseValue'>,
  labelOf: (assetId: string) => string,
): DisposalWorking {
  const d = snap.disposal;
  const years = snap.yearLabels;
  const X = d.exitIdx;
  const M = d.metricIdx;
  const exitYear = String(years[X] ?? X);
  const metricYear = String(years[M] ?? M);
  const rows: DisposalWorkingRow[] = [];

  if (!d.booked) {
    rows.push({ label: 'No terminal value is set', kind: 'note', text: 'The terminal value method is None, so nothing is sold at the exit and the fixed assets stay on the balance sheet.' });
    return { booked: false, rows, byAsset: [] };
  }

  const cfg = rs.config;
  const pl = snap.pl;
  const hospitalityEbitda = (pl.hospitalityRevenuePerPeriod[M] ?? 0) - (pl.hospitalityOpexPerPeriod[M] ?? 0);
  const retailNoi = (pl.retailRevenuePerPeriod[M] ?? 0) - (pl.retailOpexPerPeriod[M] ?? 0);

  // ── 1. The terminal value ──
  rows.push({ label: '1. Terminal value', kind: 'section' });
  rows.push({ label: 'Exit year', text: exitYear, format: 'text', indent: 1 });
  rows.push({
    label: 'Basis', format: 'text', indent: 1,
    text: d.basis === 'exit_year' ? `Exit year income (${metricYear})` : `Income of the year before the exit (${metricYear})`,
  });
  if (cfg.terminalMethod === 'perpetuity') {
    rows.push({ label: `Unlevered free cash flow, ${metricYear}`, value: d.exitMetric, format: 'money', indent: 1, kind: 'subtotal' });
  } else {
    rows.push({ label: `Hospitality EBITDA, ${metricYear}`, value: hospitalityEbitda, format: 'money', indent: 1 });
    rows.push({ label: `Retail NOI, ${metricYear}`, value: retailNoi, format: 'money', indent: 1 });
    rows.push({ label: 'Income capitalised', value: d.exitMetric, format: 'money', indent: 1, kind: 'subtotal' });
  }
  rows.push({ label: 'Method', text: METHOD_LABEL[cfg.terminalMethod] ?? cfg.terminalMethod, format: 'text', indent: 1 });
  if (cfg.terminalMethod === 'cap_rate') rows.push({ label: 'Exit cap rate', value: cfg.capRate, format: 'pct', indent: 1 });
  if (cfg.terminalMethod === 'exit_multiple') rows.push({ label: 'Exit multiple', value: cfg.exitMultiple, format: 'mult', indent: 1 });
  if (cfg.terminalMethod === 'perpetuity') {
    rows.push({ label: 'Discount rate', value: cfg.discountRate, format: 'pct', indent: 1 });
    rows.push({ label: 'Growth', value: cfg.perpetuityGrowth, format: 'pct', indent: 1 });
  }
  if (cfg.applyGrowthToTerminal && cfg.terminalMethod !== 'perpetuity') {
    rows.push({ label: 'Income grown by (1 + g) before capitalising', value: cfg.perpetuityGrowth, format: 'pct', indent: 1 });
  }
  rows.push({ label: 'Terminal value, booked as proceeds from disposal', value: d.proceeds, format: 'money', kind: 'total' });

  // ── 2. What was sold ──
  rows.push({ label: '2. Net book value disposed at the exit', kind: 'section' });
  rows.push({ label: 'Building', value: d.netBookValue.building, format: 'money', indent: 1 });
  rows.push({ label: 'Land', value: d.netBookValue.land, format: 'money', indent: 1 });
  rows.push({ label: 'Capitalised interest', value: d.netBookValue.capitalisedInterest, format: 'money', indent: 1 });
  rows.push({ label: 'Total net book value', value: d.netBookValue.total, format: 'money', kind: 'subtotal' });

  // ── 3. The gain ──
  const taxOnGain = d.taxOnGainPerPeriod[X] ?? 0;
  const debtRepaid = d.debtRepaidPerPeriod[X] ?? 0;
  rows.push({ label: '3. Gain on disposal', kind: 'section' });
  rows.push({ label: 'Proceeds from disposal', value: d.proceeds, format: 'money', indent: 1 });
  rows.push({ label: 'Less net book value disposed', value: -d.netBookValue.total, format: 'money', indent: 1 });
  rows.push({ label: d.gain >= 0 ? 'Gain on disposal' : 'Loss on disposal', value: d.gain, format: 'money', kind: 'total' });
  rows.push(d.gainTaxed
    ? { label: 'Zakat charged on the gain', value: -taxOnGain, format: 'money', indent: 1 }
    : { label: 'Zakat on the gain', text: 'Excluded (the setting is on the P&L tab)', format: 'text', indent: 1 });
  rows.push({ label: 'Debt repaid from the proceeds', value: -debtRepaid, format: 'money', indent: 1 });
  rows.push({ label: 'Proceeds left after debt', value: d.proceeds - debtRepaid, format: 'money', kind: 'subtotal' });

  // ── 4. Where it is booked ──
  const plGain = pl.gainOnDisposalPerPeriod[X] ?? 0;
  const cfProceeds = snap.directCF.proceedsFromDisposalPerPeriod[X] ?? 0;
  rows.push({ label: `4. Where it is booked, ${exitYear}`, kind: 'section' });
  rows.push({ label: 'P&L: Gain on Disposal of Operating Assets', value: plGain, format: 'money', indent: 1 });
  rows.push({ label: 'Cash flow: Proceeds from Disposal of Operating Assets', value: cfProceeds, format: 'money', indent: 1 });
  rows.push({ label: 'Returns: terminal enterprise value', value: rs.terminalEnterpriseValue, format: 'money', indent: 1 });
  rows.push({ label: 'Balance sheet: fixed assets after the exit', value: snap.bs.totalFixedAssetsPerPeriod[X] ?? 0, format: 'money', indent: 1 });
  rows.push({
    label: 'Check, every booking against this working (should be 0)', format: 'money', kind: 'check',
    value: Math.abs(plGain - d.gain) + Math.abs(cfProceeds - d.proceeds) + Math.abs(rs.terminalEnterpriseValue - d.proceeds) + Math.abs(snap.bs.totalFixedAssetsPerPeriod[X] ?? 0),
  });

  const byAsset = d.byAsset
    .map((a) => ({
      assetId: a.assetId,
      label: labelOf(a.assetId),
      building: a.building,
      land: a.land,
      capitalisedInterest: a.capitalisedInterest,
      total: a.building + a.land + a.capitalisedInterest,
    }))
    .filter((a) => Math.abs(a.total) > 0.005);
  return { booked: true, rows, byAsset };
}
