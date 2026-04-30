'use client';

import React, { useState } from 'react';
import type {
  FinancingMode, ModelType, RepaymentMethod, CostItem, CostInputMode,
} from '@/src/core/types/project.types';
import type { FinancingResult } from '@/src/core/types/project.types';
import { formatCurrency, formatNumber, formatPercent } from '@/src/core/formatters';
import { ASSET_COLOR, ASSET_BG, ASSET_LABEL, PHASE_COLOR, SCHEDULE_TITLE_BG, KPI_ACCENT } from '@/src/styles/tokens';

// ── Interface ─────────────────────────────────────────────────────────────────

interface Module1FinancingProps {
  interestRate: number; setInterestRate: (v: number) => void;
  financingMode: FinancingMode; setFinancingMode: (v: FinancingMode) => void;
  globalDebtPct: number; setGlobalDebtPct: (v: number) => void;
  capitalizeInterest: boolean; setCapitalizeInterest: (v: boolean) => void;
  repaymentPeriods: number; setRepaymentPeriods: (v: number) => void;
  repaymentMethod: RepaymentMethod; setRepaymentMethod: (v: RepaymentMethod) => void;
  lineRatios: Record<string, number>; setLineRatios: (v: Record<string, number>) => void;
  currency: string;
  modelType: ModelType;
  constructionPeriods: number;
  operationsPeriods: number;
  totalCapex: number;
  totalDebt: number;
  totalEquity: number;
  totalLandValue: number;
  residentialCosts: CostItem[];
  hospitalityCosts: CostItem[];
  retailCosts: CostItem[];
  costInputMode: CostInputMode;
  calculateItemTotal: (cost: CostItem, assetType: string, costsArr?: CostItem[]) => number;
  readOnly: boolean;
  // Per-asset financing results
  finRes: FinancingResult | null;
  finHosp: FinancingResult | null;
  finRet: FinancingResult | null;
  // Line-level debt control
  getLineDebtPct: (name: string) => number;
  setLineDebtPct: (name: string, val: number) => void;
  // Asset visibility
  showResidential: boolean;
  showHospitality: boolean;
  showRetail: boolean;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  fontWeight: 600,
};

const calcOutputStyle: React.CSSProperties = {
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  fontWeight: 'var(--fw-semibold)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  fontWeight: 600,
  color: 'var(--color-body)',
  marginBottom: '5px',
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

// ── Period label helper ────────────────────────────────────────────────────────

function getPeriodHeader(idx: number, constructionPeriods: number): string {
  if (idx === 0) return 'P0 (Pre)';
  if (idx <= constructionPeriods) return `C${idx}`;
  return `O${idx - constructionPeriods}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Module1Financing({
  interestRate, setInterestRate,
  financingMode, setFinancingMode,
  globalDebtPct, setGlobalDebtPct,
  capitalizeInterest, setCapitalizeInterest,
  repaymentPeriods, setRepaymentPeriods,
  repaymentMethod, setRepaymentMethod,
  lineRatios, setLineRatios,
  currency, modelType,
  constructionPeriods, operationsPeriods,
  totalCapex, totalDebt, totalEquity,
  totalLandValue,
  residentialCosts, hospitalityCosts, retailCosts,
  costInputMode, calculateItemTotal,
  readOnly,
  finRes, finHosp, finRet,
  getLineDebtPct, setLineDebtPct,
  showResidential, showHospitality, showRetail,
}: Module1FinancingProps) {

  // ── Local state ──
  const [activeFinView, setActiveFinView] = useState<'summary' | 'schedules'>('summary');
  // fsFilter: combined = full project schedule; asset key = per-asset schedule
  const [fsFilter, setFsFilter] = useState<string>('combined');

  const periodLabel = modelType === 'monthly' ? 'mo' : 'yr';
  const equityPct   = 100 - globalDebtPct;

  // ── Determine active fin result ──
  const getFinResult = (asset: string): FinancingResult | null => {
    if (asset === 'residential') return finRes;
    if (asset === 'hospitality') return finHosp;
    if (asset === 'retail')      return finRet;
    return null;
  };

  // ── Asset tabs ──
  const assetTabs = [
    ...(showResidential ? [{ key: 'residential', label: 'Residential', color: 'var(--color-navy)' }] : []),
    ...(showHospitality ? [{ key: 'hospitality',  label: 'Hospitality',  color: 'var(--color-navy-mid)' }] : []),
    ...(showRetail      ? [{ key: 'retail',        label: 'Retail',        color: 'var(--color-navy-dark)' }] : []),
  ];

  // ── Totals across all assets ──
  const totalInterestAll = [finRes, finHosp, finRet].filter(Boolean).reduce((s, f) => s + (f?.totalInterest || 0), 0);

  const totalPeriods = constructionPeriods + operationsPeriods;
  const periodHeaders = Array.from({ length: totalPeriods + 1 }, (_, i) => getPeriodHeader(i, constructionPeriods));

  // ── Financing Summary view (legacy-matching) ──
  const renderFinancingSummary = () => {
    const visibleAssets = [
      ...(showResidential ? ['residential'] : []),
      ...(showHospitality ? ['hospitality'] : []),
      ...(showRetail      ? ['retail']      : []),
    ];
    if (visibleAssets.length === 0) {
      return <div style={{ padding: 'var(--sp-3)', color: 'var(--color-muted)' }}>No assets configured.</div>;
    }

    const finMap: Record<string, FinancingResult | null> = { residential: finRes, hospitality: finHosp, retail: finRet };
    const numP = constructionPeriods + 1;

    // Collect unique cost names from all visible asset lineDistributions
    const seenNames = new Set<string>();
    const costNames: string[] = [];
    visibleAssets.forEach(a => {
      finMap[a]?.lineDistributions.forEach(({ name }) => {
        if (!seenNames.has(name)) { seenNames.add(name); costNames.push(name); }
      });
    });

    // Build fsLines: per-name combined + per-asset distributions
    const fsLines = costNames.map(name => {
      const assetDists: Record<string, number[]> = {};
      const combDist = Array(numP).fill(0) as number[];
      visibleAssets.forEach(a => {
        const raw = finMap[a]?.lineDistributions.find(l => l.name === name)?.dist || [];
        const d = Array.from({ length: numP }, (_, i) => raw[i] || 0);
        assetDists[a] = d;
        d.forEach((v, i) => { combDist[i] += v; });
      });
      return { name, combDist, assetDists, total: combDist.reduce((s, v) => s + v, 0) };
    }).filter(l => l.total > 0);

    const fsAssetTotals: Record<string, number> = {};
    visibleAssets.forEach(a => {
      fsAssetTotals[a] = fsLines.reduce((s, l) => s + (l.assetDists[a]?.reduce((x, v) => x + v, 0) || 0), 0);
    });
    const fsGrandTotal = fsLines.reduce((s, l) => s + l.total, 0);
    const allDebt = fsLines.reduce((s, l) => s + l.total * getLineDebtPct(l.name) / 100, 0);
    const allEq   = fsLines.reduce((s, l) => s + l.total * (100 - getLineDebtPct(l.name)) / 100, 0);

    const filterBtns = [
      { key: 'combined', label: 'Combined Total' },
      ...visibleAssets.map(a => ({ key: a, label: `↳ ${ASSET_LABEL[a]}` })),
    ];

    // Drawdown computations
    const fsLineDrawdowns = fsLines.map(line => {
      const dPct = getLineDebtPct(line.name) / 100;
      const ePct = 1 - dPct;
      const combDebt = line.combDist.map(v => v * dPct);
      const combEq   = line.combDist.map(v => v * ePct);
      const assetDebt: Record<string, number[]> = {};
      const assetEq:   Record<string, number[]> = {};
      visibleAssets.forEach(a => {
        const d = line.assetDists[a] || Array(numP).fill(0);
        assetDebt[a] = d.map(v => v * dPct);
        assetEq[a]   = d.map(v => v * ePct);
      });
      return { name: line.name, combDebt, combEq, assetDebt, assetEq,
        totalDebt: combDebt.reduce((s, v) => s + v, 0),
        totalEq:   combEq.reduce((s, v) => s + v, 0) };
    });

    const assetDebtPeriod: Record<string, number[]> = {};
    const assetEqPeriod:   Record<string, number[]> = {};
    visibleAssets.forEach(a => {
      assetDebtPeriod[a] = Array(numP).fill(0);
      assetEqPeriod[a]   = Array(numP).fill(0);
      fsLineDrawdowns.forEach(l => {
        l.assetDebt[a]?.forEach((v, p) => { assetDebtPeriod[a][p] += v; });
        l.assetEq[a]?.forEach((v, p) => { assetEqPeriod[a][p] += v; });
      });
    });

    const dpLabel = (i: number) => modelType === 'monthly' ? `Month ${i}` : `Year ${i}`;
    const PD_DEEP = 'var(--color-navy)';
    const PD_DARK = SCHEDULE_TITLE_BG.debt;

    const DrawdownByPeriod = ({ isDebt }: { isDebt: boolean }) => {
      const titleBg = isDebt ? SCHEDULE_TITLE_BG.debt : SCHEDULE_TITLE_BG.equity;
      const titleLabel = isDebt ? '🏦 Debt Drawdown by Period' : '💰 Equity Drawdown by Period';
      const isCombined = fsFilter === 'combined';
      const filtGrandDist = Array(numP).fill(0) as number[];
      fsLineDrawdowns.forEach(line => {
        const dist = isCombined
          ? (isDebt ? line.combDebt : line.combEq)
          : (isDebt ? line.assetDebt[fsFilter] : line.assetEq[fsFilter]) || Array(numP).fill(0);
        dist.forEach((v, p) => { filtGrandDist[p] += v; });
      });
      const filtGrandTotal = filtGrandDist.reduce((s, v) => s + v, 0);
      return (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
            <div style={{ padding: '7px 14px', borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: '12px', background: titleBg, color: 'var(--color-on-primary-navy)' }}>{titleLabel}</div>
            <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>Period-wise drawdowns follow cost phasing - construction periods only</span>
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 'var(--font-meta)', width: '100%', minWidth: `${Math.max(600, (numP + 2) * 100)}px` }}>
              <thead>
                <tr style={{ background: PD_DEEP, color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', minWidth: '220px', position: 'sticky', left: 0, background: PD_DEEP, zIndex: 2 }}>Cost Item / Asset</th>
                  <th style={{ padding: '9px 8px', textAlign: 'right', minWidth: '110px' }}>Total</th>
                  {Array.from({ length: numP }, (_, i) => (
                    <th key={i} style={{ padding: '9px 7px', textAlign: 'right', minWidth: '90px', fontSize: '11px' }}>{dpLabel(i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fsLineDrawdowns.map((line, ni) => {
                  if (isCombined) {
                    const combDist  = isDebt ? line.combDebt : line.combEq;
                    const combTotal = isDebt ? line.totalDebt : line.totalEq;
                    if (combTotal === 0) return null;
                    const subRows = visibleAssets.map(a => ({
                      a, dist: isDebt ? line.assetDebt[a] : line.assetEq[a],
                      total: ((isDebt ? line.assetDebt[a] : line.assetEq[a]) || []).reduce((s, v) => s + v, 0),
                    })).filter(r => r.total > 0);
                    return (
                      <React.Fragment key={line.name}>
                        <tr style={{ background: 'var(--color-grey-pale)', borderTop: '2px solid var(--color-grey-light)' }}>
                          <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--color-primary)', position: 'sticky', left: 0, background: 'var(--color-grey-pale)', zIndex: 1 }}>{line.name}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{combTotal > 0 ? formatNumber(combTotal) : '-'}</td>
                          {combDist.map((v, i) => <td key={i} style={{ padding: '9px 7px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{v > 0 ? formatNumber(v) : '-'}</td>)}
                        </tr>
                        {subRows.map(({ a, dist, total }) => (
                          <tr key={a} style={{ background: ASSET_BG[a] }}>
                            <td style={{ padding: '5px 12px 5px 26px', fontSize: 'var(--font-meta)', fontWeight: 500, color: ASSET_COLOR[a], position: 'sticky', left: 0, background: ASSET_BG[a], zIndex: 1 }}>↳ {ASSET_LABEL[a]}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 'var(--font-meta)', fontWeight: 600, color: ASSET_COLOR[a] }}>{formatNumber(total)}</td>
                            {(dist || Array(numP).fill(0)).map((v, i) => <td key={i} style={{ padding: '5px 7px', textAlign: 'right', fontSize: 'var(--font-meta)', color: ASSET_COLOR[a], borderBottom: '1px solid var(--color-grey-light)' }}>{v > 0 ? formatNumber(v) : '-'}</td>)}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  } else {
                    const dist  = (isDebt ? line.assetDebt[fsFilter] : line.assetEq[fsFilter]) || Array(numP).fill(0);
                    const total = dist.reduce((s, v) => s + v, 0);
                    if (total === 0) return null;
                    const rowBg = ni % 2 === 0 ? 'var(--color-surface)' : 'var(--color-bg)';
                    return (
                      <tr key={line.name} style={{ background: rowBg }}>
                        <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--color-body)', position: 'sticky', left: 0, background: rowBg, zIndex: 1 }}>{line.name}</td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700 }}>{formatNumber(total)}</td>
                        {dist.map((v, i) => <td key={i} style={{ padding: '9px 7px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--color-grey-light)' }}>{v > 0 ? formatNumber(v) : '-'}</td>)}
                      </tr>
                    );
                  }
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: PD_DEEP, color: 'var(--color-on-primary-navy)', borderTop: '3px solid var(--color-green-dark)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, position: 'sticky', left: 0, background: PD_DEEP, color: 'var(--color-on-primary-navy)' }}>GRAND TOTAL</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--color-on-primary-navy)' }}>{formatNumber(filtGrandTotal)}</td>
                  {filtGrandDist.map((v, i) => <td key={i} style={{ padding: '10px 7px', textAlign: 'right', fontWeight: 700, color: 'var(--color-on-primary-navy)' }}>{v > 0 ? formatNumber(v) : '-'}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    };

    const DrawdownByAsset = ({ isDebt }: { isDebt: boolean }) => {
      const titleBg = isDebt ? SCHEDULE_TITLE_BG.debt : SCHEDULE_TITLE_BG.equity;
      const titleLabel = isDebt ? '🏦 Debt Summary by Asset' : '💰 Equity Summary by Asset';
      const isCombined = fsFilter === 'combined';
      const assetsToShow = isCombined ? visibleAssets : visibleAssets.filter(a => a === fsFilter);
      const filtGrandDist = Array(numP).fill(0) as number[];
      assetsToShow.forEach(a => {
        (isDebt ? assetDebtPeriod[a] : assetEqPeriod[a])?.forEach((v, p) => { filtGrandDist[p] += v; });
      });
      const filtGrandTotal = filtGrandDist.reduce((s, v) => s + v, 0);
      return (
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <div style={{ padding: '7px 14px', borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: '12px', background: titleBg, color: 'var(--color-on-primary-navy)', display: 'inline-block', marginBottom: '10px' }}>{titleLabel}</div>
          <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 'var(--font-meta)', width: '100%', minWidth: `${Math.max(500, (numP + 2) * 100)}px` }}>
              <thead>
                <tr style={{ background: PD_DEEP, color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', minWidth: '180px', position: 'sticky', left: 0, background: PD_DEEP, zIndex: 2 }}>Asset</th>
                  <th style={{ padding: '9px 8px', textAlign: 'right', minWidth: '110px' }}>Total</th>
                  {Array.from({ length: numP }, (_, i) => <th key={i} style={{ padding: '9px 7px', textAlign: 'right', minWidth: '90px', fontSize: '11px' }}>{dpLabel(i)}</th>)}
                </tr>
              </thead>
              <tbody>
                {assetsToShow.map(a => {
                  const dist = isDebt ? assetDebtPeriod[a] : assetEqPeriod[a];
                  const total = dist?.reduce((s, v) => s + v, 0) || 0;
                  return (
                    <tr key={a} style={{ background: ASSET_BG[a] }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: ASSET_COLOR[a], position: 'sticky', left: 0, background: ASSET_BG[a], zIndex: 1 }}>{ASSET_LABEL[a]}</td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: ASSET_COLOR[a] }}>{formatNumber(total)}</td>
                      {(dist || Array(numP).fill(0)).map((v, i) => <td key={i} style={{ padding: '8px 7px', textAlign: 'right', color: ASSET_COLOR[a], borderBottom: '1px solid var(--color-grey-light)' }}>{v > 0 ? formatNumber(v) : '-'}</td>)}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: PD_DEEP, color: 'var(--color-on-primary-navy)', borderTop: '3px solid var(--color-green-dark)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, position: 'sticky', left: 0, background: PD_DEEP, color: 'var(--color-on-primary-navy)' }}>TOTAL</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--color-on-primary-navy)' }}>{formatNumber(filtGrandTotal)}</td>
                  {filtGrandDist.map((v, i) => <td key={i} style={{ padding: '10px 7px', textAlign: 'right', fontWeight: 700, color: 'var(--color-on-primary-navy)' }}>{v > 0 ? formatNumber(v) : '-'}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    };

    return (
      <div>
        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: 'var(--sp-3)' }}>
          {([
            ['Total Dev Cost (All Assets)', fsGrandTotal, 'var(--color-navy-dark)',              'var(--color-border)'],
            ['Total Debt',                  allDebt,       'var(--color-primary)',               'var(--color-primary)'],
            ['Total Equity',               allEq,         'var(--color-green-dark)',              'var(--color-green-dark)'],
          ] as [string, number, string, string][]).map(([lbl, val, textClr, accentClr]) => (
            <div key={lbl} style={{ background: 'var(--color-grey-white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-grey-light)', overflow: 'hidden', boxShadow: 'var(--shadow-1)', textAlign: 'center' }}>
              <div style={{ height: '3px', background: accentClr }} />
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>{lbl}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, color: textClr }}>{formatNumber(val)}</div>
                <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-muted)', marginTop: '2px' }}>{currency}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Section 1: fsLines table with filter buttons */}
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h4 style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-heading)', margin: '0 0 4px' }}>Development Costs - All Assets by Line Item</h4>
              <p style={{ fontSize: '11px', color: 'var(--color-muted)', margin: 0 }}>Linked from Combined Cost Summary · Excluding Land In-Kind · Source of all financing calculations</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {filterBtns.map(fb => (
                <button key={fb.key} onClick={() => setFsFilter(fb.key)} style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif', border: '1px solid',
                  background: fsFilter === fb.key ? 'var(--color-primary)' : 'var(--color-grey-white)',
                  color: fsFilter === fb.key ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  borderColor: fsFilter === fb.key ? 'var(--color-primary)' : 'var(--color-border)',
                }}>{fb.label}</button>
              ))}
              <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-grey-pale)', fontWeight: 600, color: 'var(--color-grey-mid)' }}>{currency}</span>
            </div>
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 'var(--font-body)', width: '100%' }}>
              <thead>
                <tr style={{ background: PD_DEEP, color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', minWidth: '220px', position: 'sticky', left: 0, background: PD_DEEP, zIndex: 2 }}>Cost Item / Asset</th>
                  <th style={{ padding: '10px 10px', textAlign: 'right', minWidth: '120px' }}>Total</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', minWidth: '90px' }}>Debt %</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', minWidth: '90px' }}>Equity %</th>
                  <th style={{ padding: '10px 10px', textAlign: 'right', minWidth: '120px' }}>Total Debt</th>
                  <th style={{ padding: '10px 10px', textAlign: 'right', minWidth: '120px' }}>Total Equity</th>
                </tr>
              </thead>
              <tbody>
                {fsLines.map((line, ni) => {
                  const dPct = getLineDebtPct(line.name);
                  const ePct = 100 - dPct;
                  const debtInput = (
                    financingMode === 'line'
                      ? <input style={{ ...inputStyle, padding: '3px 6px', width: '60px', textAlign: 'right', fontSize: '12px' }}
                          type="number" min={0} max={100} step={1} value={dPct}
                          onChange={e => setLineDebtPct(line.name, Number(e.target.value))} disabled={readOnly} />
                      : <>{dPct}%</>
                  );
                  if (fsFilter !== 'combined') {
                    const assetTotal = line.assetDists[fsFilter]?.reduce((s, v) => s + v, 0) || 0;
                    if (assetTotal === 0) return null;
                    const rowBg = ni % 2 === 0 ? 'var(--color-grey-white)' : 'var(--color-row-alt)';
                    return (
                      <tr key={line.name} style={{ background: rowBg }}>
                        <td style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--color-body)', position: 'sticky', left: 0, background: rowBg, zIndex: 1 }}>{line.name}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>{formatNumber(assetTotal)}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'center' }}>{debtInput}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'center' }}>{ePct}%</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: 'var(--color-negative)', fontWeight: 600 }}>{formatNumber(assetTotal * dPct / 100)}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: 'var(--color-green-dark)', fontWeight: 600 }}>{formatNumber(assetTotal * ePct / 100)}</td>
                      </tr>
                    );
                  }
                  // Combined: header row + per-asset sub-rows
                  return (
                    <React.Fragment key={line.name}>
                      <tr style={{ background: 'var(--color-grey-pale)', borderTop: '2px solid var(--color-grey-light)' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--color-primary)', position: 'sticky', left: 0, background: 'var(--color-grey-pale)', zIndex: 1 }}>{line.name}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{formatNumber(line.total)}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>{debtInput}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>{ePct}%</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--color-negative)' }}>{formatNumber(line.total * dPct / 100)}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--color-positive)' }}>{formatNumber(line.total * ePct / 100)}</td>
                      </tr>
                      {visibleAssets.map(a => {
                        const at = line.assetDists[a]?.reduce((s, v) => s + v, 0) || 0;
                        if (at === 0) return null;
                        return (
                          <tr key={a} style={{ background: ASSET_BG[a] }}>
                            <td style={{ padding: '5px 12px 5px 26px', fontSize: 'var(--font-meta)', fontWeight: 500, color: ASSET_COLOR[a], position: 'sticky', left: 0, background: ASSET_BG[a], zIndex: 1 }}>↳ {ASSET_LABEL[a]}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 'var(--font-meta)', fontWeight: 600, color: ASSET_COLOR[a] }}>{formatNumber(at)}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'center', fontSize: 'var(--font-meta)', color: ASSET_COLOR[a] }}>-</td>
                            <td style={{ padding: '5px 10px', textAlign: 'center', fontSize: 'var(--font-meta)', color: ASSET_COLOR[a] }}>-</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 'var(--font-meta)', color: 'var(--color-negative)' }}>{formatNumber(at * dPct / 100)}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 'var(--font-meta)', color: 'var(--color-green-dark)' }}>{formatNumber(at * ePct / 100)}</td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: PD_DEEP, color: 'var(--color-on-primary-navy)', borderTop: '3px solid var(--color-green-dark)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, position: 'sticky', left: 0, background: PD_DEEP, color: 'var(--color-on-primary-navy)' }}>GRAND TOTAL</td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700 }}>
                    {formatNumber(fsFilter === 'combined' ? fsGrandTotal : (fsAssetTotals[fsFilter] || 0))}
                  </td>
                  <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700 }}>-</td>
                  <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700 }}>-</td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--color-negative)' }}>
                    {formatNumber(fsFilter === 'combined' ? allDebt : fsLines.reduce((s, l) => s + (l.assetDists[fsFilter]?.reduce((a, b) => a + b, 0) || 0) * getLineDebtPct(l.name) / 100, 0))}
                  </td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--color-positive)' }}>
                    {formatNumber(fsFilter === 'combined' ? allEq : fsLines.reduce((s, l) => s + (l.assetDists[fsFilter]?.reduce((a, b) => a + b, 0) || 0) * (100 - getLineDebtPct(l.name)) / 100, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Section 2: Drawdown tables */}
        <div>
          <h4 style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-heading)', margin: '0 0 4px' }}>Debt & Equity Drawdown Schedules</h4>
          <p style={{ fontSize: '11px', color: 'var(--color-muted)', margin: '0 0 var(--sp-2)' }}>Period-by-period drawdowns derived from cost phasing above · Construction periods only</p>
          <DrawdownByPeriod isDebt={true} />
          <DrawdownByAsset isDebt={true} />
          <DrawdownByPeriod isDebt={false} />
          <DrawdownByAsset isDebt={false} />
        </div>
      </div>
    );
  };

  // ── Shared schedule table renderer ──
  const rowColors: Record<string, string> = {
    addition:  'var(--color-green-dark)',
    deduction: 'var(--color-negative)',
    normal:    'var(--color-body)',
    total:     'var(--color-heading)',
  };

  const renderSchedTable = (
    title: string,
    titleBg: string,
    note: string,
    rows: Array<{ label: string; data: number[]; style: 'addition' | 'deduction' | 'normal' | 'total'; isBalance: boolean }>
  ) => (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <div style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: '12px', background: titleBg, color: 'var(--color-on-primary-navy)' }}>
          {title}
        </div>
        {note && (
          <div style={{ fontSize: '10px', color: 'var(--color-muted)', padding: '4px 8px', background: 'var(--color-grey-pale)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
            {note}
          </div>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table-standard" style={{ minWidth: `${210 + (totalPeriods + 1) * 76}px` }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', minWidth: 210 }}>Description</th>
              <th style={{ textAlign: 'right', minWidth: 100 }}>Total</th>
              {periodHeaders.map((h, i) => (
                <th key={i} style={{
                  textAlign: 'right', minWidth: 76,
                  background: i === 0 ? PHASE_COLOR.preBg : i <= constructionPeriods ? PHASE_COLOR.constructionBg : PHASE_COLOR.operationsBg,
                  color: i === 0 ? PHASE_COLOR.pre : i <= constructionPeriods ? PHASE_COLOR.construction : PHASE_COLOR.operations,
                  fontSize: '10px', fontWeight: 700,
                  borderLeft: i === constructionPeriods + 1 ? '2px solid var(--color-border)' : undefined,
                }}>
                  {h}
                  <div style={{ fontSize: '8px', opacity: 0.7, fontWeight: 400 }}>
                    {i === 0 ? 'Pre' : i <= constructionPeriods ? 'Con' : 'Ops'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const rowTotal = row.isBalance ? null : row.data.reduce((s, v) => s + (v || 0), 0);
              const isTotalRow = row.style === 'total';
              return (
                <tr key={ri} style={{
                  background: isTotalRow ? 'color-mix(in srgb, var(--color-primary) 5%, transparent)' : ri % 2 === 0 ? 'var(--color-grey-white)' : 'color-mix(in srgb, var(--color-heading) 1%, transparent)',
                }}>
                  <td style={{ fontWeight: isTotalRow ? 700 : 400, fontSize: '12px', color: rowColors[row.style] }}>
                    {row.label}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: rowColors[row.style] }}>
                    {row.isBalance ? '-' : (rowTotal !== null ? formatNumber(Math.abs(rowTotal)) : '-')}
                  </td>
                  {Array.from({ length: totalPeriods + 1 }, (_, i) => {
                    const v = row.data[i] || 0;
                    return (
                      <td key={i} style={{
                        textAlign: 'right', fontSize: '11px',
                        color: v !== 0 ? rowColors[row.style] : 'var(--color-muted)',
                        fontWeight: isTotalRow ? 700 : 400,
                        borderLeft: i === constructionPeriods + 1 ? '2px solid var(--color-border)' : undefined,
                      }}>
                        {v !== 0 ? formatNumber(Math.abs(v)) : row.isBalance ? '0' : '-'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginTop: '4px' }}>
        ■ Pre &nbsp;|&nbsp; <span style={{ color: 'var(--color-primary)' }}>■</span> Construction &nbsp;|&nbsp; <span style={{ color: 'var(--color-green-dark)' }}>■</span> Operations &nbsp;|&nbsp; │ = Boundary
      </div>
    </div>
  );

  // ── Build three schedule tables from a FinancingResult ──
  const renderAssetSchedules = (fin: FinancingResult, label: string, periodicRate: number) => {
    // capitalize=ON:  construction interest → rolled into debt (Capitalized row), NOT cash paid
    //                 operations interest   → paid in cash
    // capitalize=OFF: all interest → paid in cash every period
    const finCapitalized = Array.from({ length: totalPeriods + 1 }, (_, p) =>
      capitalizeInterest && p >= 1 && p <= constructionPeriods ? (fin.interest[p] || 0) : 0
    );
    const finCashPaid = Array.from({ length: totalPeriods + 1 }, (_, p) =>
      capitalizeInterest
        ? (p > constructionPeriods ? (fin.interest[p] || 0) : 0)
        : (fin.interest[p] || 0)
    );
    const finTotalSettled = Array.from({ length: totalPeriods + 1 }, (_, p) => finCapitalized[p] + finCashPaid[p]);
    const finCostOpen  = Array(totalPeriods + 1).fill(0) as number[];
    const finCostClose = Array(totalPeriods + 1).fill(0) as number[];
    for (let p = 0; p <= totalPeriods; p++) {
      finCostOpen[p]  = p === 0 ? 0 : finCostClose[p - 1];
      finCostClose[p] = finCostOpen[p] + (fin.interest[p] || 0) - finTotalSettled[p];
    }
    const repNote = `Grace: ${constructionPeriods} ${periodLabel} construction · ${repaymentMethod === 'fixed' ? `Fixed principal · ${Math.min(repaymentPeriods, operationsPeriods)} ${periodLabel} repayment` : 'Cash Sweep (Return Analysis)'} · ${capitalizeInterest ? 'Interest capitalized' : 'Interest expensed'}`;
    return (
      <>
        {renderSchedTable(
          `🏦 Debt Schedule${label ? ` - ${label}` : ''}`,
          SCHEDULE_TITLE_BG.debt,
          repNote,
          [
            { label: 'Opening Balance',                    style: 'normal',    isBalance: true,  data: fin.debtOpen },
            { label: '(+) Drawdowns',                      style: 'addition',  isBalance: false, data: fin.debtAdd },
            { label: '(+) Capitalized Interest (Con.)',    style: 'addition',  isBalance: false,
              data: Array.from({ length: totalPeriods + 1 }, (_, p) =>
                capitalizeInterest && p >= 1 && p <= constructionPeriods ? (fin.interest[p] || 0) : 0) },
            { label: '(-) Repayment',                      style: 'deduction', isBalance: false, data: fin.debtRep },
            { label: 'Closing Balance',                    style: 'total',     isBalance: true,  data: fin.debtClose },
          ]
        )}
        {renderSchedTable(
          `💰 Equity Schedule${label ? ` - ${label}` : ''}`,
          SCHEDULE_TITLE_BG.equity,
          'Equity drawn same period as costs incurred',
          [
            { label: 'Opening Balance',          style: 'normal',   isBalance: true,  data: fin.eqOpen },
            { label: '(+) Equity Contributions', style: 'addition', isBalance: false, data: fin.equityAdd },
            { label: 'Closing Balance',          style: 'total',    isBalance: true,  data: fin.eqClose },
          ]
        )}
        {renderSchedTable(
          `📈 Finance Cost Schedule${label ? ` - ${label}` : ''}`,
          'var(--color-gold-dark)',
          `${interestRate}% p.a. → ${(periodicRate * 100).toFixed(4)}% per ${modelType === 'monthly' ? 'month' : 'year'} on Opening Debt Balance`,
          [
            { label: 'Opening Balance',                          style: 'normal',    isBalance: true,  data: finCostOpen },
            { label: '(+) Charge for the Period',                style: 'addition',  isBalance: false, data: fin.interest },
            { label: '(-) Capitalized into Debt (Con.)',         style: 'deduction', isBalance: false, data: finCapitalized },
            { label: '(-) Paid in Cash',                         style: 'deduction', isBalance: false, data: finCashPaid },
            { label: 'Closing Balance',                          style: 'total',     isBalance: true,  data: finCostClose },
          ]
        )}
      </>
    );
  };

  // ── Combined schedule: sum all visible assets period by period ──
  const renderCombinedSchedules = () => {
    const visibleFins: FinancingResult[] = [
      ...(showResidential && finRes  ? [finRes]  : []),
      ...(showHospitality && finHosp ? [finHosp] : []),
      ...(showRetail      && finRet  ? [finRet]  : []),
    ];
    if (visibleFins.length === 0) return null;

    const sum = (arr: number[][]): number[] =>
      Array.from({ length: totalPeriods + 1 }, (_, i) =>
        arr.reduce((s, a) => s + (a[i] || 0), 0)
      );

    const combDebtOpen  = sum(visibleFins.map(f => f.debtOpen));
    const combDebtAdd   = sum(visibleFins.map(f => f.debtAdd));
    const combDebtRep   = sum(visibleFins.map(f => f.debtRep));
    const combDebtClose = sum(visibleFins.map(f => f.debtClose));
    const combEqOpen    = sum(visibleFins.map(f => f.eqOpen));
    const combEqAdd     = sum(visibleFins.map(f => f.equityAdd));
    const combEqClose   = sum(visibleFins.map(f => f.eqClose));
    const combInt       = sum(visibleFins.map(f => f.interest));

    // capitalize=ON:  construction → rolled into debt (not cash); ops → paid in cash
    // capitalize=OFF: all periods → paid in cash
    const combCapitalized = Array.from({ length: totalPeriods + 1 }, (_, p) =>
      capitalizeInterest && p >= 1 && p <= constructionPeriods ? combInt[p] : 0
    );
    const combCashPaid = Array.from({ length: totalPeriods + 1 }, (_, p) =>
      capitalizeInterest
        ? (p > constructionPeriods ? combInt[p] : 0)
        : (combInt[p] || 0)
    );
    const combTotalSettled = Array.from({ length: totalPeriods + 1 }, (_, p) => combCapitalized[p] + combCashPaid[p]);
    const combFCOpen  = Array(totalPeriods + 1).fill(0) as number[];
    const combFCClose = Array(totalPeriods + 1).fill(0) as number[];
    for (let p = 0; p <= totalPeriods; p++) {
      combFCOpen[p]  = p === 0 ? 0 : combFCClose[p - 1];
      combFCClose[p] = combFCOpen[p] + combInt[p] - combTotalSettled[p];
    }

    const totalDebtComb    = visibleFins.reduce((s, f) => s + f.totalDebt,    0);
    const totalEquityComb  = visibleFins.reduce((s, f) => s + f.totalEquity,  0);
    const totalInterestComb= visibleFins.reduce((s, f) => s + f.totalInterest,0);
    const periodicRate     = (interestRate / 100) / (modelType === 'monthly' ? 12 : 1);
    const repNote = `Grace: ${constructionPeriods} ${periodLabel} construction · ${repaymentMethod === 'fixed' ? `Fixed principal · ${Math.min(repaymentPeriods, operationsPeriods)} ${periodLabel} repayment` : 'Cash Sweep'} · ${capitalizeInterest ? 'Interest capitalized' : 'Interest expensed'}`;

    return (
      <div>
        {/* KPI strip */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
          {[
            ['Total Debt',    totalDebtComb,     'var(--color-primary-dark)', 'var(--color-on-primary-navy)'],
            ['Total Equity',  totalEquityComb,   'var(--color-green-dark)',    'var(--color-on-primary-navy)'],
            ['Finance Cost',  totalInterestComb, 'var(--color-gold-dark)',                   'var(--color-on-primary-navy)'],
          ].map(([l, v, bg, c]) => (
            <span key={String(l)} style={{ padding: '4px 12px', borderRadius: 'var(--radius-sm)', background: String(bg), color: String(c), fontSize: '12px', fontWeight: 700 }}>
              {l}: {currency} {formatNumber(Number(v))}
            </span>
          ))}
        </div>
        {renderSchedTable(
          '🏦 Debt Schedule - Full Project',
          SCHEDULE_TITLE_BG.debt,
          repNote,
          [
            { label: 'Opening Balance',          style: 'normal',    isBalance: true,  data: combDebtOpen },
            { label: '(+) Drawdowns',             style: 'addition',  isBalance: false, data: combDebtAdd },
            { label: '(+) Capitalized Interest (Con.)', style: 'addition', isBalance: false, data: combCapitalized },
            { label: '(-) Repayment',             style: 'deduction', isBalance: false, data: combDebtRep },
            { label: 'Closing Balance',           style: 'total',     isBalance: true,  data: combDebtClose },
          ]
        )}
        {renderSchedTable(
          '💰 Equity Schedule - Full Project',
          SCHEDULE_TITLE_BG.equity,
          'Equity drawn same period as costs incurred',
          [
            { label: 'Opening Balance',          style: 'normal',   isBalance: true,  data: combEqOpen },
            { label: '(+) Equity Contributions', style: 'addition', isBalance: false, data: combEqAdd },
            { label: 'Closing Balance',          style: 'total',    isBalance: true,  data: combEqClose },
          ]
        )}
        {renderSchedTable(
          '📈 Finance Cost Schedule - Full Project',
          'var(--color-gold-dark)',
          `${interestRate}% p.a. → ${(periodicRate * 100).toFixed(4)}% per ${modelType === 'monthly' ? 'month' : 'year'} on Opening Debt Balance`,
          [
            { label: 'Opening Balance',                  style: 'normal',    isBalance: true,  data: combFCOpen },
            { label: '(+) Charge for the Period',        style: 'addition',  isBalance: false, data: combInt },
            { label: '(-) Capitalized into Debt (Con.)', style: 'deduction', isBalance: false, data: combCapitalized },
            { label: '(-) Paid in Cash',                 style: 'deduction', isBalance: false, data: combCashPaid },
            { label: 'Closing Balance',                  style: 'total',     isBalance: true,  data: combFCClose },
          ]
        )}
      </div>
    );
  };

  // ── Schedule view: 3 separate tables (Debt, Equity, Finance Cost) ──
  const renderScheduleView = (fin: FinancingResult | null) => {
    if (!fin) {
      return (
        <div style={{ padding: 'var(--sp-3)', color: 'var(--color-muted)', fontSize: '13px' }}>
          No schedule data available.
        </div>
      );
    }
    const periodicRate = fin.periodicRate;
    return renderAssetSchedules(fin, '', periodicRate);
  };


  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 4px' }}>
          Financing Structure
        </h2>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', margin: 0 }}>
          Define debt/equity split, interest capitalization, and repayment schedule per asset
        </p>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }}>
        {[
          { label: 'Total CapEx',    value: formatCurrency(totalCapex, currency),      color: 'var(--color-navy)' },
          { label: 'Total Debt',     value: formatCurrency(totalDebt, currency),        color: 'var(--color-negative)' },
          { label: 'Total Equity',   value: formatCurrency(totalEquity, currency),      color: 'var(--color-green-dark)' },
          { label: 'Total Interest', value: formatCurrency(totalInterestAll, currency), color: 'var(--color-gold-dark)' },
          { label: 'LTV',            value: formatPercent(globalDebtPct),               color: 'var(--color-navy)' },
          { label: 'Interest Rate',  value: formatPercent(interestRate),                color: 'var(--color-gold)' },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-card__accent" style={{ background: kpi.color }} />
            <div className="kpi-card__body">
              <div className="kpi-card__label">{kpi.label}</div>
              <div className="kpi-card__value" style={{ fontSize: '16px' }}>{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>

        {/* Left - Structure */}
        <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            Financing Structure
          </h3>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Financing Mode</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['fixed', 'line'] as FinancingMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => !readOnly && setFinancingMode(mode)}
                  disabled={readOnly}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)',
                    border: financingMode === mode ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: financingMode === mode ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'var(--color-surface)',
                    cursor: readOnly ? 'not-allowed' : 'pointer',
                    fontWeight: financingMode === mode ? 700 : 400,
                    color: financingMode === mode ? 'var(--color-primary)' : 'var(--color-body)',
                    fontSize: 'var(--font-body)', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {mode === 'fixed' ? 'Fixed Debt' : 'Line of Credit'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Debt % of CapEx (LTV)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                  style={{ ...inputStyle, flex: 1 }}
                type="range"
                min={0} max={100} step={1}
                value={globalDebtPct}
                onChange={e => setGlobalDebtPct(Number(e.target.value))}
                disabled={readOnly}
              />
              <input
                  style={{ ...inputStyle, width: '70px', flex: 'none' }}
                type="number"
                min={0} max={100} step={1}
                value={globalDebtPct}
                onChange={e => setGlobalDebtPct(Number(e.target.value))}
                disabled={readOnly}
              />
              <span style={{ color: 'var(--color-muted)', fontSize: 'var(--font-meta)' }}>%</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <div style={{ flex: globalDebtPct, background: 'var(--color-negative)', height: '6px', borderRadius: '3px' }} />
              <div style={{ flex: equityPct, background: 'var(--color-green-dark)', height: '6px', borderRadius: '3px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--color-negative)', fontWeight: 700 }}>Debt {globalDebtPct}%</span>
              <span style={{ fontSize: '10px', color: 'var(--color-green-dark)', fontWeight: 700 }}>Equity {equityPct}%</span>
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Interest Rate (% p.a.)</label>
            <input
              style={inputStyle}
              type="number"
              min={0} max={30} step={0.1}
              value={interestRate}
              onChange={e => setInterestRate(Number(e.target.value))}
              disabled={readOnly}
            />
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: readOnly ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={capitalizeInterest}
                onChange={e => !readOnly && setCapitalizeInterest(e.target.checked)}
                disabled={readOnly}
                style={{ width: '16px', height: '16px', cursor: readOnly ? 'not-allowed' : 'pointer' }}
              />
              <span style={{ ...labelStyle, margin: 0, cursor: 'inherit' }}>Capitalize Interest During Construction</span>
            </label>
          </div>
        </div>

        {/* Right - Repayment */}
        <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            Repayment Terms
          </h3>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Repayment Method</label>
            <select
              style={inputStyle}
              value={repaymentMethod}
              onChange={e => setRepaymentMethod(e.target.value as RepaymentMethod)}
              disabled={readOnly}
            >
              <option value="fixed">Fixed Equal Installments</option>
              <option value="cashsweep">Cash Sweep</option>
            </select>
            {repaymentMethod === 'cashsweep' && (
              <div style={{
                marginTop: '8px', padding: '8px 12px',
                background: 'color-mix(in srgb, var(--color-gold) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-gold-dark) 20%, transparent)',
                borderRadius: 'var(--radius-sm)', fontSize: '11px', color: 'var(--color-gold-dark)', lineHeight: '1.5',
              }}>
                ⚠️ <strong>Pending Module 5 link</strong> - Once Financial Statements are finalized (Module 5),
                Cash Sweep will automatically pull available cash from the period cash flow to repay debt
                as fast as liquidity allows. Currently showing fixed schedule as a placeholder.
              </div>
            )}
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Repayment Period ({periodLabel})</label>
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={operationsPeriods}
              value={repaymentPeriods}
              onChange={e => setRepaymentPeriods(Number(e.target.value))}
              disabled={readOnly}
            />
            <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px' }}>
              Max: {operationsPeriods} {periodLabel} (operations period)
            </div>
          </div>

          {/* Summary box */}
          <div style={{
            background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-primary) 12%, transparent)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Debt Summary
            </div>
            {[
              { label: 'Total CapEx',                   value: formatCurrency(totalCapex, currency) },
              { label: `Debt (${globalDebtPct}%)`,      value: formatCurrency(totalDebt, currency) },
              { label: `Equity (${equityPct}%)`,        value: formatCurrency(totalEquity, currency) },
              { label: 'Estimated Interest',            value: formatCurrency(totalInterestAll, currency) },
              { label: 'All-in Cost of Debt',           value: formatCurrency(totalDebt + totalInterestAll, currency) },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-meta)' }}>{row.label}</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-heading)' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Financing Summary / Schedules ── */}
      {assetTabs.length > 0 && (
        <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
          {/* Top bar: view toggle only */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 'var(--sp-2)' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['summary', 'schedules'] as const).map(v => (
                <button key={v} onClick={() => setActiveFinView(v)} style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-sm)', fontSize: '11px',
                  border: activeFinView === v ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: activeFinView === v ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'var(--color-surface)',
                  cursor: 'pointer', fontWeight: activeFinView === v ? 700 : 400,
                  color: activeFinView === v ? 'var(--color-primary)' : 'var(--color-body)',
                  fontFamily: 'Inter, sans-serif',
                }}>
                  {v === 'summary' ? 'Summary' : 'Schedules'}
                </button>
              ))}
            </div>
          </div>

          {/* View content */}
          {activeFinView === 'summary' ? (
            renderFinancingSummary()
          ) : (
            /* Schedules view */
            <div>
              {/* Filter context banner - only when a specific asset is selected */}
              {fsFilter !== 'combined' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--sp-2)', padding: '8px 16px', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: 600, background: 'var(--color-grey-pale)', color: 'var(--color-primary)', border: '1px solid var(--color-grey-light)' }}>
                  <span>🔍 Filtered:</span>
                  <span style={{ padding: '2px 12px', borderRadius: '20px', color: 'var(--color-on-primary-navy)', fontSize: '12px', fontWeight: 700, background: 'var(--color-navy)' }}>
                    {{ residential: 'Residential', hospitality: 'Hospitality', retail: 'Retail' }[fsFilter]}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--color-muted)', marginLeft: '4px' }}>· Change filter in Financing Summary tab</span>
                </div>
              )}

              {/* ── Full Project Combined Schedules ── */}
              {fsFilter === 'combined' && renderCombinedSchedules()}

              {/* ── PER ASSET SCHEDULES divider ── */}
              {fsFilter === 'combined' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 'var(--sp-3) 0 var(--sp-2)' }}>
                  <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 4px' }}>
                    Per Asset Schedules
                  </span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
                </div>
              )}

              {/* ── Per-asset sections ── */}
              {(fsFilter === 'combined' ? assetTabs : assetTabs.filter(t => t.key === fsFilter)).map(tab => {
                const fin = getFinResult(tab.key);
                if (!fin) return null;
                const periodicRate = fin.periodicRate;
                return (
                  <div key={tab.key} style={{ marginBottom: 'var(--sp-3)' }}>
                    {/* Asset section header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 16px', borderRadius: 'var(--radius-sm)',
                      background: tab.color, marginBottom: 'var(--sp-2)',
                    }}>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-on-primary-navy)' }}>
                        {tab.label}
                      </span>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {[
                          [`Total Debt`,    fin.totalDebt],
                          [`Total Equity`,  fin.totalEquity],
                          [`Finance Cost`,  fin.totalInterest],
                        ].map(([lbl, val]) => (
                          <span key={String(lbl)} style={{
                            padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                            background: 'color-mix(in srgb, var(--color-on-primary-navy) 18%, transparent)', color: 'var(--color-on-primary-navy)',
                          }}>
                            {lbl}: {currency} {formatNumber(Number(val))}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Asset 3 schedule tables */}
                    {renderAssetSchedules(fin, tab.label, periodicRate)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Combined financing summary across all assets ── */}
      <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
        <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
          Combined Financing Summary - All Assets
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="table-standard">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 140 }}>Asset</th>
                <th style={{ textAlign: 'right', minWidth: 120 }}>Total Cost</th>
                <th style={{ textAlign: 'right', minWidth: 80 }}>Debt %</th>
                <th style={{ textAlign: 'right', minWidth: 120 }}>Total Debt</th>
                <th style={{ textAlign: 'right', minWidth: 120 }}>Total Equity</th>
                <th style={{ textAlign: 'right', minWidth: 120 }}>Interest</th>
                <th style={{ textAlign: 'right', minWidth: 120 }}>Total incl. Interest</th>
              </tr>
            </thead>
            <tbody>
              {[
                showResidential && finRes  ? { label: 'Residential', fin: finRes  } : null,
                showHospitality && finHosp ? { label: 'Hospitality',  fin: finHosp } : null,
                showRetail      && finRet  ? { label: 'Retail',        fin: finRet  } : null,
              ].filter((r): r is { label: string; fin: FinancingResult } => r !== null).map((row, i) => {
                const costTotal = row.fin.lineItems.reduce((s, l) => s + l.total, 0);
                const debtPct   = costTotal > 0 ? (row.fin.totalDebt / costTotal) * 100 : 0;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, fontSize: '12px' }}>{row.label}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(costTotal)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPercent(debtPct)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--color-negative)', fontWeight: 600 }}>{formatNumber(row.fin.totalDebt)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--color-green-dark)', fontWeight: 600 }}>{formatNumber(row.fin.totalEquity)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--color-gold-dark)' }}>{formatNumber(row.fin.totalInterest)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(row.fin.totalDebt + row.fin.totalInterest)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700 }}>TOTAL</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(totalCapex, currency)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatPercent(globalDebtPct)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-negative)' }}>{formatCurrency(totalDebt, currency)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-green-dark)' }}>{formatCurrency(totalEquity, currency)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-gold-dark)' }}>{formatCurrency(totalInterestAll, currency)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(totalDebt + totalInterestAll, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
