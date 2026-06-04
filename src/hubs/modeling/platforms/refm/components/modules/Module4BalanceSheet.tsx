'use client';

/**
 * Module4BalanceSheet.tsx (M4 Pass 2e, 2026-05-20)
 *
 * Project Balance Sheet composed from every feeder schedule. Mirrors
 * the reference v1.16 BS Plan layout:
 *
 *   ASSETS
 *     Fixed Assets   (NBV + Land)
 *     Current Assets (Cash + AR + Residential Receivables + Inventory)
 *     TOTAL ASSETS
 *
 *   LIABILITIES & EQUITY
 *     Current Liabilities (AP + Unearned). Escrow is restricted cash (asset).
 *     Non-current Liabilities (Debt outstanding)
 *     Shareholders' Equity (Share Capital + Statutory Reserve + Retained
 *       Earnings)
 *     TOTAL LIABILITIES + EQUITY
 *
 *   BS Check Flag + BS Difference (Assets − Liabilities − Equity)
 *
 * Statutory reserve is configurable (rate + cap % of Share Capital);
 * default off (0). When enabled it transfers each year's PAT into the
 * reserve, capped at the configured % of Share Capital (Saudi Companies
 * Law default = 10% transfer, 30% of SC cap).
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { PhaseSection } from './_shared/PhaseSection';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';
import { FAST_INPUT } from './_shared/inputStyles';

export default function Module4BalanceSheet(): React.JSX.Element {
  const state = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
      parcels: s.parcels,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      landAllocationMode: s.landAllocationMode,
      financingTranches: s.financingTranches,
      equityContributions: s.equityContributions,
      setProject: s.setProject,
    })),
  );

  const snap = useMemo(() => computeFinancialsSnapshot(state), [state]);
  const project = state.project;
  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.yearLabels;
  const N = snap.axisLength;
  const bs = snap.bs;

  const transferRatePct = (project.statutoryReserve?.transferRate ?? 0) * 100;
  const capPct = (project.statutoryReserve?.capOfShareCapital ?? 0) * 100;
  const setTransferRate = (pct: number): void => {
    state.setProject({
      statutoryReserve: { ...(project.statutoryReserve ?? {}), transferRate: Math.max(0, pct / 100) },
    });
  };
  const setCapPct = (pct: number): void => {
    state.setProject({
      statutoryReserve: { ...(project.statutoryReserve ?? {}), capOfShareCapital: Math.max(0, pct / 100) },
    });
  };
  const setShareCapital = (v: number | undefined): void => {
    state.setProject({ shareCapital: v });
  };

  // M4 Pass 2g: operating DSO control. Drives the AR closing balance
  // for hospitality + lease revenue (residential receivables stay on
  // the M2 milestone path).
  const setOperatingDsoDays = (v: number | undefined): void => {
    state.setProject({
      operatingAr: { ...(project.operatingAr ?? {}), dsoDays: v },
    });
  };

  // Balance Sheet is consolidated only (per Ahmad 2026-06-04): the phase
  // filter was removed because a BS is a point-in-time statement of the whole
  // entity, and the project-level plug lines (Cash, Share Capital, Reserve,
  // Retained Earnings) cannot be cleanly attributed to a single phase. The
  // per-asset / per-tranche decomposition logic below is retained but always
  // runs over the full project (phaseFiltered is permanently false).
  const filterPhaseId = '__all__';
  const phaseFiltered = false;
  const assetIdsInPhase = useMemo(() => {
    const ids = new Set<string>();
    for (const a of state.assets) {
      if (a.visible === false) continue;
      if (a.phaseId === filterPhaseId) ids.add(a.id);
    }
    return ids;
  }, [state.assets, filterPhaseId]);
  const trancheIdsInPhase = useMemo(() => {
    const ids = new Set<string>();
    for (const t of state.financingTranches) {
      if (t.phaseId === filterPhaseId) ids.add(t.id);
    }
    return ids;
  }, [state.financingTranches, filterPhaseId]);
  // ── Helpers: sum per-period arrays from the snapshot ───────────────
  const N_ = N;
  const zerosN = (): number[] => new Array<number>(N_).fill(0);
  const addInto = (acc: number[], src: number[] | undefined): void => {
    if (!src) return;
    for (let t = 0; t < N_; t++) acc[t] += src[t] ?? 0;
  };
  const sumAssetsBy = (pick: (assetId: string) => number[] | undefined): number[] => {
    const out = zerosN();
    if (phaseFiltered) {
      for (const id of assetIdsInPhase) addInto(out, pick(id));
    } else {
      for (const a of state.assets) {
        if (a.visible === false) continue;
        addInto(out, pick(a.id));
      }
    }
    return out;
  };

  // Per-asset slices.
  const landFiltered = sumAssetsBy((id) => snap.fixedAssets.byAsset.get(id)?.land.closingPerPeriod);
  const nbvFiltered = sumAssetsBy((id) => snap.fixedAssets.byAsset.get(id)?.depreciable.closingNBVPerPeriod);
  const inventoryFiltered = sumAssetsBy((id) => snap.perAssetCF.get(id)?.inventoryPerPeriod);
  const resReceivablesFiltered = sumAssetsBy((id) => snap.byAssetSchedules.get(id)?.ar.perPeriod);
  const unearnedFiltered = sumAssetsBy((id) => snap.byAssetSchedules.get(id)?.unearned.perPeriod);
  // BS reconciliation fix (2026-06-01): Accounts Payable must LINK to the
  // canonical project-wide AP (snap.ap.projectTotals), which includes the
  // HQ / head-office AP. The per-asset sum (snap.ap.byAsset) covers
  // Operate/Lease assets ONLY and OMITS HQ AP. When HQ opex is indexed,
  // the missing HQ AP made this UI's re-summed BS Check drift by
  // (HQ opex × DPO / 365), compounding at the HQ inflation rate, even
  // though the financials snapshot itself balances every period. Under a
  // phase filter HQ AP cannot be attributed to a single phase, so the
  // per-asset sum stays (the BS Check is already flagged approximate when
  // filtered). This mirrors the "link, don't re-calculate" rule the rest
  // of the project-level rows (Cash, AR Operating, Reserve, Retained)
  // already follow.
  const apFiltered = phaseFiltered
    ? sumAssetsBy((id) => snap.ap.byAsset.get(id)?.result.perPeriod)
    : snap.ap.projectTotals.closingApPerPeriod.slice(0, N_);
  const escrowFiltered = sumAssetsBy((id) => snap.escrow.byAsset.get(id)?.result.cumulativeBalancePerPeriod);

  // IDC NBV decomposition: project-only field. When filtered, allocate
  // by phase share of land sqm (mirrors composer's IDC allocation).
  const totalLandSqm = Math.max(0, snap.idc.totalLandSqm);
  const phaseLandSqm = (() => {
    if (!phaseFiltered) return totalLandSqm;
    let s = 0;
    for (const id of assetIdsInPhase) s += snap.idc.byAsset.get(id)?.landSqm ?? 0;
    return s;
  })();
  const phaseShareOfLand = totalLandSqm > 0 ? phaseLandSqm / totalLandSqm : 0;
  const idcNbvFiltered = phaseFiltered
    ? snap.idc.idcNbvPerPeriod.map((v) => v * phaseShareOfLand)
    : snap.idc.idcNbvPerPeriod;

  // Debt: per-tranche outstanding aligned to project axis.
  // M4 Pass 2N-Fix (2026-05-21): fac.outstanding[i] is the CLOSING
  // balance at end of year i. The previous +1 shift dropped the
  // last-year debt to 0 and showed year-t+1 closing in the year-t
  // column, driving the BS imbalance.
  const debtFiltered = (() => {
    if (!phaseFiltered) return bs.debtOutstandingPerPeriod;
    const out = zerosN();
    for (const t of state.financingTranches) {
      if (!trancheIdsInPhase.has(t.id)) continue;
      const fac = snap.financing.facilities.get(t.id);
      if (!fac) continue;
      for (let i = 0; i < N_; i++) out[i] += fac.outstanding[i] ?? 0;
    }
    return out;
  })();

  // Project-level lines stay project-level (annotated when filtered).
  const cashFiltered = bs.cashPerPeriod;
  const arOperatingFiltered = bs.arPerPeriod;
  const shareCapitalFiltered = bs.shareCapitalPerPeriod;
  const reserveFiltered = bs.statutoryReservePerPeriod;
  const retainedFiltered = bs.retainedEarningsPerPeriod;
  const projTag = phaseFiltered ? ' (project)' : '';

  // Subtotals.
  const totalFAFiltered = zerosN();
  const totalCAFiltered = zerosN();
  const totalAssetsFiltered = zerosN();
  const totalCLFiltered = zerosN();
  const totalLiabFiltered = zerosN();
  const totalEquityFiltered = zerosN();
  const totalLandEFiltered = zerosN();
  const bsDiffFiltered = zerosN();
  for (let t = 0; t < N_; t++) {
    totalFAFiltered[t] = landFiltered[t] + nbvFiltered[t] + idcNbvFiltered[t];
    // Escrow = restricted cash (asset), NOT a liability.
    totalCAFiltered[t] = cashFiltered[t] + escrowFiltered[t] + arOperatingFiltered[t] + resReceivablesFiltered[t] + inventoryFiltered[t];
    totalAssetsFiltered[t] = totalFAFiltered[t] + totalCAFiltered[t];
    totalCLFiltered[t] = apFiltered[t] + unearnedFiltered[t];
    totalLiabFiltered[t] = totalCLFiltered[t] + debtFiltered[t];
    totalEquityFiltered[t] = shareCapitalFiltered[t] + reserveFiltered[t] + retainedFiltered[t];
    totalLandEFiltered[t] = totalLiabFiltered[t] + totalEquityFiltered[t];
    bsDiffFiltered[t] = totalAssetsFiltered[t] - totalLandEFiltered[t];
  }

  // M4 Pass 2j (2026-05-20): prior-year column shows opening balances at
  // axis start. Stock lines pick up existing-operations history from
  // financing.existing + fixed-assets snapshot; flow lines stay at 0.
  // M4 Pass 2M-A1 (2026-05-20): Opening Cash now appears in the prior
  // column too so PreCapex + OpeningCash = Debt + Equity at t=-1.
  const priorYear = snap.projectStartYear - 1;
  const priorLand = snap.fixedAssets.projectTotals.land.openingAtAxisStart;
  const priorBuilding = snap.fixedAssets.projectTotals.depreciable.openingNBVPerPeriod[0] ?? 0;
  const priorFA = priorLand + priorBuilding;
  const priorCash = bs.historicalOpeningCashTotal;
  const priorCA = priorCash;
  const priorTotalAssets = priorFA + priorCA;
  const priorDebt = snap.financing.existing.debtOutstandingTotal;
  const priorEquity = snap.financing.existing.equityTotal;
  const priorLandE = priorDebt + priorEquity;

  const rows: M4Row[] = [];
  rows.push({ label: 'ASSETS', values: [], isSection: true });

  // M4 Pass 2S (2026-05-24): merge IDC NBV into "Fixed Assets (NBV)"
  // line since Module 4 Fixed Assets schedules now display the
  // depreciable roll-forward as Capex + IDC combined. Showing IDC as a
  // separate BS line duplicated the disclosure (user feedback). The
  // underlying math still tracks both components; combined value is
  // what hits BS Total Fixed Assets.
  rows.push({ label: 'Fixed Assets', values: [], isSection: true });
  rows.push({ label: 'Land', values: landFiltered, indent: 1, totalOverride: fmt(landFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorLand });
  const nbvCombined = nbvFiltered.map((v, i) => v + (idcNbvFiltered[i] ?? 0));
  const fixedAssetsLabel = idcNbvFiltered.some((v) => v !== 0)
    ? 'Fixed Assets (NBV, incl. capitalised IDC)'
    : 'Fixed Assets (NBV)';
  rows.push({ label: fixedAssetsLabel, values: nbvCombined, indent: 1, totalOverride: fmt(nbvCombined[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorBuilding });
  rows.push({ label: 'Total Fixed Assets', values: totalFAFiltered, isSubtotal: true, totalOverride: fmt(totalFAFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorFA });

  rows.push({ label: 'Current Assets', values: [], isSection: true });
  rows.push({ label: `Cash${projTag}`, values: cashFiltered, indent: 1, totalOverride: fmt(cashFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorCash });
  if (arOperatingFiltered.some((v) => v !== 0)) {
    rows.push({ label: `Accounts Receivable (Operating)${projTag}`, values: arOperatingFiltered, indent: 1, totalOverride: fmt(arOperatingFiltered[N - 1] ?? 0), priorValue: 0 });
  }
  rows.push({ label: 'Residential Sales Receivables', values: resReceivablesFiltered, indent: 1, totalOverride: fmt(resReceivablesFiltered[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Inventory (Residential WIP)', values: inventoryFiltered, indent: 1, totalOverride: fmt(inventoryFiltered[N - 1] ?? 0), priorValue: 0 });
  if (escrowFiltered.some((v) => v !== 0)) {
    rows.push({ label: 'Restricted Cash (Escrow)', values: escrowFiltered, indent: 1, totalOverride: fmt(escrowFiltered[N - 1] ?? 0), priorValue: 0 });
  }
  rows.push({ label: 'Total Current Assets', values: totalCAFiltered, isSubtotal: true, totalOverride: fmt(totalCAFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorCA });

  rows.push({ label: 'TOTAL ASSETS', values: totalAssetsFiltered, isTotal: true, totalOverride: fmt(totalAssetsFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorTotalAssets });

  rows.push({ label: 'LIABILITIES', values: [], isSection: true });
  rows.push({ label: 'Current Liabilities', values: [], isSection: true });
  rows.push({ label: 'Accounts Payable', values: apFiltered, indent: 1, totalOverride: fmt(apFiltered[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Unearned Revenue (Off-plan advances)', values: unearnedFiltered, indent: 1, totalOverride: fmt(unearnedFiltered[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Total Current Liabilities', values: totalCLFiltered, isSubtotal: true, totalOverride: fmt(totalCLFiltered[N - 1] ?? 0), priorValue: 0 });

  rows.push({ label: 'Non-current Liabilities', values: [], isSection: true });
  rows.push({ label: 'Debt (long-term)', values: debtFiltered, indent: 1, totalOverride: fmt(debtFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorDebt });
  rows.push({ label: 'TOTAL LIABILITIES', values: totalLiabFiltered, isTotal: true, totalOverride: fmt(totalLiabFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorDebt });

  rows.push({ label: 'SHAREHOLDERS EQUITY', values: [], isSection: true });
  rows.push({ label: `Share Capital${projTag}`, values: shareCapitalFiltered, indent: 1, totalOverride: fmt(shareCapitalFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorEquity });
  rows.push({ label: `Statutory Reserve${projTag}`, values: reserveFiltered, indent: 1, totalOverride: fmt(reserveFiltered[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: `Retained Earnings${projTag}`, values: retainedFiltered, indent: 1, totalOverride: fmt(retainedFiltered[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Total Equity', values: totalEquityFiltered, isSubtotal: true, totalOverride: fmt(totalEquityFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorEquity });

  rows.push({ label: 'TOTAL LIABILITIES + EQUITY', values: totalLandEFiltered, isTotal: true, totalOverride: fmt(totalLandEFiltered[N - 1] ?? 0), priorValue: phaseFiltered ? 0 : priorLandE });

  // BS Check. Tolerance (2026-06-02, per user): a residual under ~1,000 is
  // rounding noise on a project measured in the billions, so treat it as
  // balanced rather than alarming. A relative floor (1 ppm of total L+E) keeps
  // small projects honest.
  const maxAbsDiff = Math.max(...bsDiffFiltered.map((v) => Math.abs(v)));
  const bsTolerance = Math.max(1000, Math.abs(totalLandEFiltered[N - 1] ?? 0) * 1e-6);
  const balances = maxAbsDiff < bsTolerance;
  rows.push({ label: balances ? 'BS Check: BALANCED' : 'BS Check: OUT OF BALANCE', values: bsDiffFiltered, isTotal: true, totalOverride: fmt(maxAbsDiff), priorValue: phaseFiltered ? 0 : (priorTotalAssets - priorLandE) });

  return (
    <div data-testid="module4-balancesheet" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · Balance Sheet</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Composed from every feeder schedule (AR + Inventory + AP + Unearned + Escrow + Fixed Assets + Debt
          + Equity). Cash is the plug from the Direct Cash Flow Statement. BS Check at the bottom should be
          ~0 each period; if it drifts, a working-capital line is missing on one side of the bridge.
        </p>
      </div>

      <PhaseSection
        phaseId="m4-bs-wc-inputs"
        title="Working Capital Inputs"
        meta="Operating AR Days (hospitality + lease)"
        storageKey="fmp:m4:bs:wc-inputs:collapsed"
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1fr)',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--sp-3)',
        }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Operating AR Days (DSO)
            </label>
            <input
              type="number"
              value={project.operatingAr?.dsoDays ?? ''}
              min={0}
              max={365}
              placeholder="0 (cash basis)"
              onChange={(e) => {
                const v = e.target.value;
                setOperatingDsoDays(v === '' ? undefined : Math.max(0, Number(v)));
              }}
              style={FAST_INPUT}
              data-testid="m4-bs-operating-dso"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Days Sales Outstanding for hospitality + lease revenue. Reference v1.16 default is 60 days. Residential
              receivables stay on the M2 milestone-driven path regardless of this input.
            </div>
          </div>
        </div>
      </PhaseSection>

      <PhaseSection
        phaseId="m4-bs-inputs"
        title="Equity Inputs"
        meta="Statutory reserve + explicit Share Capital override"
        storageKey="fmp:m4:bs:inputs:collapsed"
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(200px, 1fr))',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--sp-3)',
        }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Statutory Reserve Transfer Rate (% of PAT)
            </label>
            <input
              type="number"
              value={transferRatePct}
              min={0}
              max={100}
              step={0.01}
              onChange={(e) => setTransferRate(Number(e.target.value) || 0)}
              style={FAST_INPUT}
              data-testid="m4-bs-reserve-rate"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Saudi Companies Law default: 10%. 0 = disabled (PAT flows entirely to Retained Earnings).
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Reserve Cap (% of Share Capital)
            </label>
            <input
              type="number"
              value={capPct}
              min={0}
              max={100}
              step={0.01}
              onChange={(e) => setCapPct(Number(e.target.value) || 0)}
              style={FAST_INPUT}
              data-testid="m4-bs-reserve-cap"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Saudi default: 30%. Once the reserve hits this fraction of Share Capital, further transfers stop.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Share Capital (optional override)
            </label>
            <input
              type="number"
              value={project.shareCapital ?? ''}
              min={0}
              placeholder="auto: cumulative equity drawdowns"
              onChange={(e) => {
                const v = e.target.value;
                setShareCapital(v === '' ? undefined : Math.max(0, Number(v)));
              }}
              style={FAST_INPUT}
              data-testid="m4-bs-share-capital"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Blank = use cumulative equity drawdowns from M1. Set explicitly to pin a constant Share Capital line.
            </div>
          </div>
        </div>
      </PhaseSection>

      <M4PeriodTable
        title="Balance Sheet: Project"
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rows}
        priorYearLabel={priorYear}
      />

      {!balances && (() => {
        // M4 Pass 2R-Fix (2026-05-24): diagnostic per-period breakdown
        // so users (and developers) can pinpoint where the imbalance
        // first appears + whether it propagates or self-corrects.
        const indexed = bsDiffFiltered.map((v, i) => ({ year: yearLabels[i], diff: v, abs: Math.abs(v) }));
        const offenders = indexed
          .filter((r) => r.abs > 0.5)
          .sort((a, b) => b.abs - a.abs)
          .slice(0, 5);
        return (
          <div style={{
            marginTop: 'var(--sp-2)',
            padding: '8px 12px',
            background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)',
            color: 'var(--color-warning, #92400e)',
            border: '1px solid var(--color-warning, #92400e)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
          }}>
            <strong>BS does not balance.</strong> Max absolute Assets − (Liabilities + Equity) across the axis ={' '}
            {fmt(maxAbsDiff)}. Top imbalance years:{' '}
            {offenders.map((r) => `${r.year}: ${fmt(r.diff)}`).join('  ·  ') || 'all small'}.
            <div style={{ marginTop: 6, fontSize: 11 }}>
              Use the <strong>Reconciliation Bridge</strong> below to localize it: the line whose change is not offset by
              its cash-flow / non-cash pair is the leak.
            </div>
          </div>
        );
      })()}

      {/* M4 (2026-05-25): per-line BS reconciliation bridge. Exact identity
       *  Δ(BS diff) = Net CF − Δ(Liab+Equity) + Δ(non-cash Assets). Localizes
       *  which line drives any imbalance. Project-level (whole-project
       *  identity), so it is hidden under a phase filter. */}
      {!phaseFiltered && (() => {
        const r = snap.bsReconciliation;
        const neg = (a: number[]): number[] => a.map((v) => -v);
        const recRows: M4Row[] = [
          { label: 'Net cash flow (Direct = Indirect)', values: r.netCashFlowPerPeriod },
          { label: '(−) Δ Liabilities + Equity', values: [], isSection: true },
          { label: 'Δ Debt outstanding', values: neg(r.deltaDebtPerPeriod), indent: 1 },
          { label: 'Δ Share capital', values: neg(r.deltaShareCapitalPerPeriod), indent: 1 },
          { label: 'Δ Reserve + Retained earnings', values: neg(r.deltaReserveRetainedPerPeriod), indent: 1 },
          { label: 'Δ Accounts payable', values: neg(r.deltaApPerPeriod), indent: 1 },
          { label: 'Δ Unearned revenue', values: neg(r.deltaUnearnedPerPeriod), indent: 1 },
          { label: '(+) Δ Non-cash assets', values: [], isSection: true },
          { label: 'Δ Restricted cash (escrow)', values: r.deltaEscrowPerPeriod, indent: 1 },
          { label: 'Δ AR (operating)', values: r.deltaArPerPeriod, indent: 1 },
          { label: 'Δ Receivables (residential)', values: r.deltaResidentialReceivablesPerPeriod, indent: 1 },
          { label: 'Δ Inventory', values: r.deltaInventoryPerPeriod, indent: 1 },
          { label: 'Δ Fixed assets NBV', values: r.deltaNbvPerPeriod, indent: 1 },
          { label: 'Δ Land', values: r.deltaLandPerPeriod, indent: 1 },
          { label: 'Δ Capitalised IDC NBV', values: r.deltaIdcNbvPerPeriod, indent: 1 },
          { label: '= Δ BS difference (this period)', values: r.bsDifferenceChangePerPeriod, isTotal: true },
          { label: 'Unexplained (must be 0)', values: r.unexplainedPerPeriod, isSubtotal: true },
          { label: 'BS difference (cumulative)', values: r.bsDifferencePerPeriod, isSubtotal: true },
        ];
        return (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <M4PeriodTable
              title="Balance Check, Reconciliation Bridge (per period)"
              caption="Δ BS difference = Net cash flow − Δ(Liabilities + Equity) + Δ(non-cash Assets). Exact identity: when the BS balances every line nets to zero each year. When it does not, the line whose change is NOT offset by its cash-flow / non-cash counterpart is the leak. Unexplained must be 0 (else a BS line is missing from the bridge)."
              yearLabels={yearLabels}
              currency={currency}
              fmt={fmt}
              rows={recRows}
              priorYearLabel={priorYear}
            />
          </div>
        );
      })()}
    </div>
  );
}
