'use client';

/**
 * CostPerSqmTables.tsx (2026-09-24)
 *
 * Table 7 of the Capex results: cost per sqm, per line, and for Sell lines what
 * a sqm sells for against what it cost. A RENDERER ONLY: every figure comes
 * from `buildCostPerSqmReport`, which reads the Capex report, the IDC schedule
 * and the engine's Sell results and computes none of them again. It moves no
 * existing number; it divides existing numbers.
 *
 * Per-sqm figures print at FULL scale with no decimals, the way a developer
 * quotes them, whatever the project's display scale. AMOUNTS (the cost column)
 * follow the project's display scale and decimals like every other amount on
 * the tab (founder, 2026-09-24): a cost of 413.6m reads "413.6" under
 * "SAR M", never as nine digits beside the per-sqm figures.
 *
 * No em dashes in this file.
 */
import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatAccounting, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { useModule1Store } from '../../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../../lib/financials-resolvers';
import { buildCostPerSqmReport, COST_BASES, AREA_BASES, type CostPerSqmLine } from '../../../lib/reports/costPerSqmReport';
import { CELL_HEADER, TABLE_TITLE, ROW_DATA, ROW_ASSET_HEADING, ROW_SUBTOTAL } from './tableStyles';

const card: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)',
};
const note: React.CSSProperties = { fontSize: 11, color: 'var(--color-meta)', margin: '4px 0 6px', lineHeight: 1.5 };
const perSqm = (v: number | null): string => (v === null ? 'n/a' : formatAccounting(v, 'full', 0));
/** An amount's column header states its scale, as the tab's other tables do. */
const scaleTag = (currency: string, scale: DisplayScale): string =>
  scale === 'thousands' ? `${currency} '000` : scale === 'millions' ? `${currency} M` : currency;
const sqm = (v: number): string => formatAccounting(v, 'full', 0);

export default function CostPerSqmTables({ assetIds }: {
  /** The assets the Results view is showing, so a phase filter applies here too. */
  assetIds: readonly string[];
}): React.JSX.Element | null {
  const state = useModule1Store(useShallow((s) => ({
    project: s.project, phases: s.phases, assets: s.assets, subUnits: s.subUnits, parcels: s.parcels,
    costLines: s.costLines, costOverrides: s.costOverrides, landAllocationMode: s.landAllocationMode,
    financingTranches: s.financingTranches, equityContributions: s.equityContributions,
  })));
  const report = useMemo(() => {
    try { return buildCostPerSqmReport(computeFinancialsSnapshot(state), state); } catch { return null; }
  }, [state]);
  const shown = useMemo(() => {
    const ids = new Set(assetIds);
    // A line is shown when the view shows any plot of it. The line's figures
    // are still the whole line's: a per-sqm reading of half a line would be a
    // number no other surface states.
    return (report?.lines ?? []).filter((l) => l.memberIds.some((id) => ids.has(id)));
  }, [report, assetIds]);

  if (!report || shown.length === 0) return null;
  const currency = state.project.currency ?? 'SAR';
  const scale: DisplayScale = state.project.displayScale ?? 'thousands';
  const decimals: DisplayDecimals = (state.project.displayDecimals ?? 1) as DisplayDecimals;
  const amount = (v: number): string => formatAccounting(v, scale, decimals);
  const multiPhase = state.phases.length > 1;
  const name = (l: CostPerSqmLine): string => (multiPhase ? `${l.label}, ${l.phaseName}` : l.label);
  const sells = shown.filter((l) => l.sale);

  return (
    <>
      <div style={card} data-testid="capex-cost-per-sqm">
        <h3 style={{ ...TABLE_TITLE, margin: 0 }}>Table 7a - Cost per sqm, by line</h3>
        <div style={note}>
          Cost in {scaleTag(currency, scale)}; per sqm figures in {currency} at full scale. Construction is the hard, soft and pre-opening stages, the platform&apos;s one
          definition of the word; IDC is the interest capitalised to the line; land is the land stage (land value and anything
          charged with it, such as transfer tax). Marketing sits outside all three. Each is divided by the line&apos;s NSA, BUA and GFA (NSA within BUA within GFA).
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...CELL_HEADER, textAlign: 'left' }}>Line and cost base</th>
                <th style={CELL_HEADER}>Cost ({scaleTag(currency, scale)})</th>
                {AREA_BASES.map((a) => <th key={a.key} style={CELL_HEADER}>Per sqm of {a.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <React.Fragment key={l.key}>
                  <tr data-testid={`cost-per-sqm-${l.key}`}>
                    <td style={ROW_ASSET_HEADING.name}>{name(l)}</td>
                    <td style={ROW_ASSET_HEADING.num}></td>
                    {AREA_BASES.map((a) => (
                      <td key={a.key} style={{ ...ROW_ASSET_HEADING.num, fontWeight: 400 }}>{sqm(l.area[a.key])} sqm</td>
                    ))}
                  </tr>
                  {COST_BASES.map((b) => (
                    <tr key={b.key} data-testid={`cost-per-sqm-${l.key}-${b.key}`}>
                      <td style={{ ...ROW_DATA.name, paddingLeft: 18 }}>{b.label}</td>
                      <td style={ROW_DATA.num}>{amount(l.cost[b.key])}</td>
                      {AREA_BASES.map((a) => <td key={a.key} style={ROW_DATA.num}>{perSqm(l.perSqm[b.key][a.key])}</td>)}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sells.length > 0 && (
        <div style={card} data-testid="capex-sale-per-sqm">
          <h3 style={{ ...TABLE_TITLE, margin: 0 }}>Table 7b - Sale price against cost, per sqm of NSA (Sell lines)</h3>
          <div style={note}>
            {currency} per sqm, at full scale. The base price is what the area sold would fetch at the Table 5 prices before
            escalation; the realised price is GDV (what the model sells it for, escalation included) over the area sold. The
            margin is each price less the cost per sqm of NSA on each base, and the gap between the two prices is what
            escalation earned per sqm sold.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...CELL_HEADER, textAlign: 'left' }}>Line and cost base</th>
                  <th style={CELL_HEADER}>Cost per sqm of NSA</th>
                  <th style={CELL_HEADER}>Margin at base price</th>
                  <th style={CELL_HEADER}>Margin at realised price</th>
                </tr>
              </thead>
              <tbody>
                {sells.map((l) => {
                  const s = l.sale!;
                  return (
                    <React.Fragment key={l.key}>
                      <tr data-testid={`sale-per-sqm-${l.key}`}>
                        <td style={ROW_ASSET_HEADING.name}>{name(l)}</td>
                        <td style={{ ...ROW_ASSET_HEADING.num, fontWeight: 400 }}>{sqm(s.areaSold)} sqm sold of {sqm(s.nsa)}</td>
                        <td style={{ ...ROW_ASSET_HEADING.num, fontWeight: 400 }}>Base price {perSqm(s.basePrice)}</td>
                        <td style={{ ...ROW_ASSET_HEADING.num, fontWeight: 400 }}>Realised price {perSqm(s.realisedPrice)}</td>
                      </tr>
                      {COST_BASES.map((b) => (
                        <tr key={b.key} data-testid={`sale-per-sqm-${l.key}-${b.key}`}>
                          <td style={{ ...ROW_DATA.name, paddingLeft: 18 }}>{b.label}</td>
                          <td style={ROW_DATA.num}>{perSqm(s.costPerSqm[b.key])}</td>
                          <td style={ROW_DATA.num}>{perSqm(s.marginAtBase[b.key])}</td>
                          <td style={ROW_DATA.num}>{perSqm(s.marginAtRealised[b.key])}</td>
                        </tr>
                      ))}
                      <tr data-testid={`sale-per-sqm-${l.key}-escalation`}>
                        <td style={{ ...ROW_SUBTOTAL.name, paddingLeft: 18 }}>Escalation earned (realised less base price)</td>
                        <td style={ROW_SUBTOTAL.num}></td>
                        <td style={ROW_SUBTOTAL.num}></td>
                        <td style={ROW_SUBTOTAL.num}>{perSqm(s.escalationPerSqm)}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
