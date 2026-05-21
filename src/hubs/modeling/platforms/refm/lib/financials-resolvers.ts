/**
 * M4 Pass 2 (2026-05-20): Financial Statements composer.
 *
 * One snapshot resolver that pulls every upstream engine output
 * (revenue / CoS / opex / AP / escrow / fixed assets / financing) and
 * composes the P&L, Direct CF, Indirect CF and BS line items in one
 * place. Each M4 sub-tab reads from this snapshot.
 *
 * Engines stay pure; this resolver is the glue between the M1 Zustand
 * store and the four M4 UI surfaces. No M4 surface reaches into M1 /
 * M2 / M3 engines directly, they all go through here, which keeps
 * the asset-filter logic and the strategy-grouping in one place.
 */

import {
  computeAllSellResults,
  computeAssetCapex,
  computeAssetScheduleBundle,
  computeEscrowSnapshot,
  type ProjectRevenueSnapshot,
  type ProjectEscrowSnapshot,
  type AssetScheduleBundle,
} from './revenue-resolvers';
import {
  computeAllOpexResults,
  computeOpexApSnapshot,
  type ProjectOpexSnapshot,
  type ProjectOpexApSnapshot,
} from './opex-resolvers';
import {
  computeAllFixedAssetResults,
  type ProjectFixedAssetSnapshot,
} from './fixed-assets-resolvers';
import { computeFinancingResult, type FinancingComputation } from '@/src/core/calculations/financing';
import {
  computeAssetFixedAssets,
  type AssetFixedAssetResult,
} from '@/src/core/calculations/depreciation';
import {
  buildAccountsReceivableDSO,
  buildCostOfSales,
  type AccountsReceivableDSOResult,
  type CostOfSalesResult,
} from '@/src/core/calculations/revenue';
import {
  computeAssetLandSqm,
  resolveUsefulLifeYears,
} from '@/src/core/calculations';
import type { Module1Store } from './state/module1-store';
import type { Asset } from './state/module1-types';
import { DEFAULT_PROJECT_FINANCING_CONFIG } from './state/module1-types';

export type FinancialsResolverState = Pick<
  Module1Store,
  | 'project'
  | 'phases'
  | 'assets'
  | 'subUnits'
  | 'parcels'
  | 'costLines'
  | 'costOverrides'
  | 'landAllocationMode'
  | 'financingTranches'
  | 'equityContributions'
>;

// ────────────────────────────────────────────────────────────────────
// Line buckets
// ────────────────────────────────────────────────────────────────────

export interface AssetPL {
  assetId: string;
  assetName: string;
  strategy: Asset['strategy'];
  revenuePerPeriod: number[];
  cosPerPeriod: number[];          // Sell strategies only (else zeros)
  opexPerPeriod: number[];         // Operate + Lease only (else zeros)
  daPerPeriod: number[];           // Depreciation only (Land never depreciates)
  ebitdaPerPeriod: number[];       // Revenue - CoS - Opex
  ebitPerPeriod: number[];         // EBITDA - D&A
}

export interface AssetCF {
  assetId: string;
  assetName: string;
  strategy: Asset['strategy'];
  // Direct method per-asset
  revenueReceivedPerPeriod: number[];
  opexPaidPerPeriod: number[];
  capexPerPeriod: number[];
  /** Residential WIP inventory: Sell strategies only (else zeros). */
  inventoryPerPeriod: number[];
}

export interface ProjectPL {
  // Revenue
  residentialRevenuePerPeriod: number[];
  hospitalityRevenuePerPeriod: number[];
  retailRevenuePerPeriod: number[];
  totalRevenuePerPeriod: number[];
  // Cost of sales
  cosPerPeriod: number[];
  // Operating expenses
  hospitalityOpexPerPeriod: number[];
  retailOpexPerPeriod: number[];
  hqOpexPerPeriod: number[];
  totalOpexPerPeriod: number[];
  // Profit waterfall
  ebitdaPerPeriod: number[];
  daPerPeriod: number[];
  ebitPerPeriod: number[];
  interestExpensePerPeriod: number[];
  interestIncomePerPeriod: number[];   // reserved for future cash-balance interest; zeros today
  pbtPerPeriod: number[];
  taxRate: number;
  taxPerPeriod: number[];
  patPerPeriod: number[];
}

export interface ProjectDirectCF {
  // Operations
  revenueReceivedPerPeriod: number[];
  escrowHeldPerPeriod: number[];           // negative on accumulation
  escrowReleasePerPeriod: number[];        // positive on release
  netRevenueAdjustmentPerPeriod: number[]; // = release - held
  opexPaidPerPeriod: number[];             // negative
  hqOpexPaidPerPeriod: number[];           // negative
  taxPaidPerPeriod: number[];              // negative
  cashFromOperationsPerPeriod: number[];
  // Investment
  capexPerPeriod: number[];                // negative
  cashFromInvestmentPerPeriod: number[];
  // Financing
  equityDrawdownPerPeriod: number[];
  debtDrawdownPerPeriod: number[];
  debtRepaymentPerPeriod: number[];        // negative
  interestPaidPerPeriod: number[];         // negative
  cashFromFinancingPerPeriod: number[];
  // Bottom
  netCashFlowPerPeriod: number[];
  openingCashPerPeriod: number[];
  closingCashPerPeriod: number[];
}

export interface ProjectIndirectCF {
  patPerPeriod: number[];
  daPerPeriod: number[];                   // add-back
  interestExpensePerPeriod: number[];      // add-back (then subtract Interest Paid)
  changeInArPerPeriod: number[];           // -ΔAR (asset = subtract increase)
  changeInInventoryPerPeriod: number[];    // -ΔInv
  changeInApPerPeriod: number[];           // +ΔAP
  changeInUnearnedPerPeriod: number[];     // +ΔUnearned (liability)
  changeInEscrowPerPeriod: number[];       // +ΔEscrow (liability, restricted cash sits on the books)
  cashFromOperationsPerPeriod: number[];
  capexPerPeriod: number[];
  cashFromInvestmentPerPeriod: number[];
  equityDrawdownPerPeriod: number[];
  debtDrawdownPerPeriod: number[];
  debtRepaymentPerPeriod: number[];
  interestPaidPerPeriod: number[];         // actual cash interest
  cashFromFinancingPerPeriod: number[];
  netCashFlowPerPeriod: number[];
}

export interface ProjectBS {
  // Assets
  cashPerPeriod: number[];
  arPerPeriod: number[];                   // operating AR (DSO-based)
  residentialReceivablesPerPeriod: number[]; // milestone-driven (M2)
  inventoryPerPeriod: number[];            // WIP from CoS
  nbvPerPeriod: number[];                  // depreciable closing
  landPerPeriod: number[];                 // pure additive
  totalFixedAssetsPerPeriod: number[];
  totalCurrentAssetsPerPeriod: number[];
  totalAssetsPerPeriod: number[];
  // Liabilities
  apPerPeriod: number[];
  unearnedRevenuePerPeriod: number[];
  escrowLiabilityPerPeriod: number[];
  debtOutstandingPerPeriod: number[];
  totalCurrentLiabilitiesPerPeriod: number[];
  totalLiabilitiesPerPeriod: number[];
  // Equity
  shareCapitalPerPeriod: number[];
  statutoryReservePerPeriod: number[];
  retainedEarningsPerPeriod: number[];
  totalEquityPerPeriod: number[];
  // Check
  totalLiabilitiesAndEquityPerPeriod: number[];
  bsDifferencePerPeriod: number[];
  // M4 Pass 2M-A1 (2026-05-20): opening cash carried into the model at
  // axis start (sum of phase.historicalBaseline.historicalOpeningCash).
  // Used to populate the BS Cash prior-year column + as the seed
  // balance for the Direct CF.
  historicalOpeningCashTotal: number;
}

/**
 * M4 Pass 2f (2026-05-20): Interest During Construction (IDC) allocation
 * snapshot. Project-wide capitalized interest from the financing engine
 * is distributed per asset by land-area share. Land-zero assets
 * (companions and non-land-bearing entries) receive zero IDC. The
 * allocation drives:
 *   - Sell / Sell+Manage assets: cumulative IDC adds to capex basis for
 *     Cost of Sales recognition.
 *   - Operate / Lease assets: per-period IDC adds to depreciable additions
 *     and depreciates over the asset's useful life via a thin extra
 *     computeAssetFixedAssets call.
 */
interface AssetIDCRow {
  assetId: string;
  assetName: string;
  landSqm: number;
  shareOfTotalLand: number;
  /** Per-period IDC capitalised to this asset. */
  idcPerPeriod: number[];
  /** Cumulative IDC capitalised through each period. */
  cumulativeIdcPerPeriod: number[];
  /** Total IDC capitalised across the axis. */
  totalIdc: number;
}

export interface ProjectIDCSnapshot {
  axisLength: number;
  /** Project IDC per period (sum across all assets). */
  totalIdcPerPeriod: number[];
  /** Per-asset IDC row. Empty when total project IDC is zero. */
  byAsset: Map<string, AssetIDCRow>;
  /** Sum of all asset land sqm used for the share calc. */
  totalLandSqm: number;
  /** Depreciation derived from IDC additions on Operate / Lease assets. */
  idcDepreciationPerPeriod: number[];
  /** Cumulative IDC NBV for Operate / Lease assets, project total. */
  idcNbvPerPeriod: number[];
}

export interface ProjectFinancialsSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  // Upstream snapshots (read-through so M4 sub-tabs don't re-resolve)
  revenue: ProjectRevenueSnapshot;
  opex: ProjectOpexSnapshot;
  ap: ProjectOpexApSnapshot;
  escrow: ProjectEscrowSnapshot;
  fixedAssets: ProjectFixedAssetSnapshot;
  financing: FinancingComputation;
  /** IDC allocation by land-area share (Pass 2f). */
  idc: ProjectIDCSnapshot;
  // Per-asset bundles (AR / Unearned / CoS WIP). For Sell assets, the
  // CoS bundle here is IDC-augmented (totalCapex + cumulative IDC).
  byAssetSchedules: Map<string, AssetScheduleBundle>;
  // Composed statements
  perAssetPL: Map<string, AssetPL>;
  perAssetCF: Map<string, AssetCF>;
  pl: ProjectPL;
  directCF: ProjectDirectCF;
  indirectCF: ProjectIndirectCF;
  bs: ProjectBS;
}

const zeros = (n: number): number[] => new Array<number>(n).fill(0);
const cumulative = (arr: number[]): number[] => {
  const out = new Array<number>(arr.length).fill(0);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i] ?? 0;
    out[i] = s;
  }
  return out;
};

export function computeFinancialsSnapshot(state: FinancialsResolverState): ProjectFinancialsSnapshot {
  const { project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode, financingTranches, equityContributions } = state;

  // 1. Upstream snapshots (each pure function call already memoizes via React.useMemo at the call site)
  const revenue = computeAllSellResults({ project, phases, assets, subUnits });
  const opex = computeAllOpexResults({ project, phases, assets, subUnits }, revenue);
  const ap = computeOpexApSnapshot({ project, assets }, opex);
  const escrow = computeEscrowSnapshot({ project, phases, assets, subUnits }, revenue);
  const fixedAssets = computeAllFixedAssetResults({ project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode });
  const financing = computeFinancingResult({
    project, phases, parcels, assets, subUnits, costLines, costOverrides,
    landAllocationMode,
    financingConfig: project.financing ?? DEFAULT_PROJECT_FINANCING_CONFIG,
    tranches: financingTranches,
    equityContributions,
  });

  const N = revenue.axisLength;
  const projectStartYear = revenue.projectStartYear;
  const yearLabels = revenue.yearLabels;

  // 2a. IDC allocation by land-area share (M4 Pass 2f).
  // Project IDC per period comes from the financing engine. We allocate
  // it across visible non-companion assets in proportion to land sqm.
  // Companions (no land) get zero; pure Sell assets, Sell+Manage parents,
  // Operate parents, and Lease assets all participate.
  const idcSource = financing.combined.totalInterestCapitalized;
  // M4 Pass 2N-Fix (2026-05-21): the financing engine emits arrays of
  // length totalPeriods (per axis.ts contract: arr[0] = project year 0,
  // no prior column). The previous slice(1, 1+N) was dropping year-0
  // IDC entirely — user reported financing total 333,761 vs BS
  // Schedules total 317,586, the 16,175 gap was exactly year-0 IDC.
  const totalIdcPerPeriod = idcSource.slice(0, N);
  while (totalIdcPerPeriod.length < N) totalIdcPerPeriod.push(0);

  // M4 Pass 2g (2026-05-20): allocate IDC per period using ACTIVE-
  // construction land share, not total land share. Assets that finished
  // construction in earlier periods no longer accrue IDC; the share
  // collapses to the assets still under construction in period t. This
  // matters for multi-phase projects where Phase 3 is still drawing
  // debt while Phase 1 is already operating.
  const assetLand = new Map<string, number>();
  let totalLandSqm = 0;
  // Per-asset construction window [startIdx, endIdx] on the project axis.
  const constructionWindow = new Map<string, { startIdx: number; endIdx: number }>();
  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    const sqm = Math.max(0, computeAssetLandSqm(a, parcels, assets, subUnits, landAllocationMode));
    assetLand.set(a.id, sqm);
    totalLandSqm += sqm;
    const phase = phases.find((p) => p.id === a.phaseId);
    const phaseStartYear = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const cp = Math.max(0, phase?.constructionPeriods ?? 0);
    // M4 Pass 2g-Fix (2026-05-20): existing operational assets (cp = 0)
    // do not have a construction window, so they must not appear in the
    // active-construction set at all. Previously endIdx = max(0, -1) = 0
    // made cp=0 assets falsely active at period 0, charging them a slice
    // of IDC that economically belongs to the assets actually drawing
    // construction debt. Per Ahmad 2026-05-20: "you charged IDC to
    // Phase 1 which is already operational, why charged to that."
    //
    // Asset still participates in `assetLand` (used by the
    // no-active-asset fallback below) so projects with only existing
    // operational facilities still get IDC distributed sensibly.
    if (cp <= 0) continue;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    const startIdx = Math.max(0, Math.min(N - 1, offset));
    const endIdxRaw = offset + cp - 1;
    if (endIdxRaw < startIdx) continue;
    constructionWindow.set(a.id, {
      startIdx,
      endIdx: Math.min(N - 1, endIdxRaw),
    });
  }

  // Two-pass allocation: pass 1 distributes IDC during each asset's
  // construction window; pass 2 catches any "stray" IDC outside all
  // construction windows (e.g. post-handover finance cost on existing
  // debt that's still capitalising) and falls back to the static
  // land-share split so no IDC is dropped on the floor.
  const byAssetIDC = new Map<string, AssetIDCRow>();
  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    byAssetIDC.set(a.id, {
      assetId: a.id,
      assetName: a.name,
      landSqm: assetLand.get(a.id) ?? 0,
      shareOfTotalLand: totalLandSqm > 0 ? (assetLand.get(a.id) ?? 0) / totalLandSqm : 0,
      idcPerPeriod: zeros(N),
      cumulativeIdcPerPeriod: zeros(N),
      totalIdc: 0,
    });
  }

  for (let t = 0; t < N; t++) {
    const idcAtT = totalIdcPerPeriod[t] ?? 0;
    if (idcAtT === 0) continue;
    // Determine active-construction land at t.
    let activeLand = 0;
    const activeIds: string[] = [];
    for (const [assetId, win] of constructionWindow) {
      if (t < win.startIdx || t > win.endIdx) continue;
      const sqm = assetLand.get(assetId) ?? 0;
      if (sqm <= 0) continue;
      activeLand += sqm;
      activeIds.push(assetId);
    }
    if (activeLand <= 0) {
      // Fallback: no construction-active asset has land at t -> split
      // by total land share (Pass 2f behaviour). Keeps IDC totals
      // reconciled even in edge cases (e.g. existing facilities with
      // post-operational IDC capitalisation).
      if (totalLandSqm <= 0) continue;
      for (const [assetId, row] of byAssetIDC) {
        const sqm = assetLand.get(assetId) ?? 0;
        const slice = idcAtT * (sqm / totalLandSqm);
        row.idcPerPeriod[t] += slice;
      }
    } else {
      for (const assetId of activeIds) {
        const sqm = assetLand.get(assetId) ?? 0;
        const slice = idcAtT * (sqm / activeLand);
        const row = byAssetIDC.get(assetId);
        if (row) row.idcPerPeriod[t] += slice;
      }
    }
  }

  // Finalize cumulative + totals
  for (const row of byAssetIDC.values()) {
    let running = 0;
    for (let t = 0; t < N; t++) {
      running += row.idcPerPeriod[t] ?? 0;
      row.cumulativeIdcPerPeriod[t] = running;
    }
    row.totalIdc = running;
  }

  // 2b. Per-asset Cost-of-Sales + AR + Unearned bundles (Sell strategies).
  // CoS uses the AR + Unearned bundle's standard outputs but the CoS
  // amount is rebuilt below with IDC-augmented capex.
  const byAssetSchedules = new Map<string, AssetScheduleBundle>();
  for (const [assetId, sellResult] of revenue.bySellAsset) {
    const bundle = computeAssetScheduleBundle({ project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode }, sellResult);
    // Augment CoS with cumulative IDC. The total capex base for CoS
    // becomes the original capex + total IDC capitalised to this asset.
    const idc = byAssetIDC.get(assetId);
    if (idc && idc.totalIdc > 0) {
      const baseTotalCapex = bundle.cos.totalCapex;
      const augmentedCapex = baseTotalCapex + idc.totalIdc;
      const augmentedCos: CostOfSalesResult = buildCostOfSales(
        sellResult.recognitionPerPeriod,
        augmentedCapex,
        N,
      );
      byAssetSchedules.set(assetId, { ...bundle, cos: augmentedCos });
    } else {
      byAssetSchedules.set(assetId, bundle);
    }
  }

  // 2c. IDC-driven depreciation for Operate / Lease assets.
  // Each non-Sell asset's per-period IDC becomes a stream of depreciable
  // additions feeding a thin extra computeAssetFixedAssets call. The
  // resulting depreciation adds onto the asset's existing D&A series for
  // the P&L; the closing NBV from this call lands on the BS as a memo
  // line beneath Fixed Assets.
  const idcDeprecPerAsset = new Map<string, AssetFixedAssetResult>();
  const idcDeprecProject = zeros(N);
  const idcNbvProject = zeros(N);
  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    if (a.strategy !== 'Operate' && a.strategy !== 'Lease') continue;
    const idc = byAssetIDC.get(a.id);
    if (!idc || idc.totalIdc <= 0) continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;
    const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const cp = Math.max(0, phase.constructionPeriods ?? 0);
    const handoverIdx = Math.max(0, Math.min(N - 1, (phaseStartYear - projectStartYear) + cp - 1));
    const usefulLife = resolveUsefulLifeYears(a);
    const idcRes = computeAssetFixedAssets({
      assetId: a.id,
      axisLength: N,
      startIdx: handoverIdx,
      additionsPerPeriod: idc.idcPerPeriod,
      usefulLifeYears: usefulLife,
      method: 'straight_line',
    });
    idcDeprecPerAsset.set(a.id, idcRes);
    for (let t = 0; t < N; t++) {
      idcDeprecProject[t] += idcRes.depreciationPerPeriod[t] ?? 0;
      idcNbvProject[t] += idcRes.closingNBVPerPeriod[t] ?? 0;
    }
  }

  // 3. Per-asset P&L + CF rows
  const perAssetPL = new Map<string, AssetPL>();
  const perAssetCF = new Map<string, AssetCF>();
  for (const a of assets) {
    if (a.visible === false) continue;
    const revRow = zeros(N);
    const cosRow = zeros(N);
    const opexRow = zeros(N);
    const daRow = zeros(N);
    const revRcv = zeros(N);
    const opexPaid = zeros(N);
    const capex = zeros(N);

    // Revenue per strategy
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      const sell = revenue.bySellAsset.get(a.id);
      if (sell) {
        for (let t = 0; t < N; t++) {
          revRow[t] = (sell.presalesRevenuePerPeriod[t] ?? 0) + (sell.postSalesRevenuePerPeriod[t] ?? 0);
          revRcv[t] = sell.cashCollectedPerPeriod[t] ?? 0;
        }
        const bundle = byAssetSchedules.get(a.id);
        if (bundle) {
          for (let t = 0; t < N; t++) cosRow[t] = bundle.cos.perPeriod[t] ?? 0;
        }
      }
    }
    if (a.strategy === 'Operate' || a.isCompanion === true) {
      const r = revenue.byHospitalityAsset.get(a.id);
      if (r) {
        for (let t = 0; t < N; t++) {
          revRow[t] += r.totalRevenuePerPeriod[t] ?? 0;
          revRcv[t] += r.totalRevenuePerPeriod[t] ?? 0; // DSO ignored at asset level (project AR uses DSO; per-asset is cash-basis approximation)
        }
      }
    }
    if (a.strategy === 'Lease') {
      const r = revenue.byLeaseAsset.get(a.id);
      if (r) {
        for (let t = 0; t < N; t++) {
          revRow[t] += r.totalRevenuePerPeriod[t] ?? 0;
          revRcv[t] += r.totalRevenuePerPeriod[t] ?? 0;
        }
      }
    }
    // Opex per strategy
    const opexRes = opex.byAsset.get(a.id);
    if (opexRes) {
      for (let t = 0; t < N; t++) opexRow[t] = opexRes.totalOpexPerPeriod[t] ?? 0;
    }
    const apRow = ap.byAsset.get(a.id);
    if (apRow) {
      for (let t = 0; t < N; t++) opexPaid[t] = apRow.result.cashPaidPerPeriod[t] ?? 0;
    }
    // D&A per asset (base) + IDC-derived depreciation for Operate/Lease.
    const faRow = fixedAssets.byAsset.get(a.id);
    if (faRow) {
      for (let t = 0; t < N; t++) daRow[t] = faRow.depreciable.depreciationPerPeriod[t] ?? 0;
    }
    const idcDep = idcDeprecPerAsset.get(a.id);
    if (idcDep) {
      for (let t = 0; t < N; t++) daRow[t] += idcDep.depreciationPerPeriod[t] ?? 0;
    }
    // Capex per asset (sum across construction window)
    // Estimate per-period capex by allocating asset's total capex across its construction period.
    // For exact per-period capex we'd need to recompute computeAssetCost with the year buckets,
    // which is done by aggregateProjectCapex at project level. Here we use a uniform spread
    // across the asset's construction window as a sensible per-asset approximation.
    const phase = phases.find((p) => p.id === a.phaseId);
    if (phase && (a.strategy === 'Operate' || a.strategy === 'Lease' || a.isCompanion === true || a.strategy === 'Sell' || a.strategy === 'Sell + Manage')) {
      const total = computeAssetCapex({ project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode }, a.id);
      const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
      const cp = Math.max(0, phase.constructionPeriods ?? 0);
      const offset = Math.max(0, phaseStartYear - projectStartYear);
      if (cp > 0 && total > 0) {
        const per = total / cp;
        for (let i = 0; i < cp; i++) {
          const idx = offset + i;
          if (idx >= 0 && idx < N) capex[idx] = per;
        }
      }
    }

    const ebitda = zeros(N);
    const ebit = zeros(N);
    for (let t = 0; t < N; t++) {
      ebitda[t] = (revRow[t] ?? 0) - (cosRow[t] ?? 0) - (opexRow[t] ?? 0);
      ebit[t] = ebitda[t] - (daRow[t] ?? 0);
    }

    perAssetPL.set(a.id, {
      assetId: a.id,
      assetName: a.name,
      strategy: a.strategy,
      revenuePerPeriod: revRow,
      cosPerPeriod: cosRow,
      opexPerPeriod: opexRow,
      daPerPeriod: daRow,
      ebitdaPerPeriod: ebitda,
      ebitPerPeriod: ebit,
    });
    // Inventory: only Sell strategies carry WIP.
    //   = cumulative (capex + IDC capitalised) - cumulative CoS, floored at 0.
    // CoS itself is already IDC-augmented in byAssetSchedules above, so
    // the inventory release matches.
    const inventoryRow = zeros(N);
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      const idcRow = byAssetIDC.get(a.id)?.idcPerPeriod ?? zeros(N);
      let cumCapex = 0;
      let cumCos = 0;
      for (let t = 0; t < N; t++) {
        cumCapex += (capex[t] ?? 0) + (idcRow[t] ?? 0);
        cumCos += cosRow[t] ?? 0;
        inventoryRow[t] = Math.max(0, cumCapex - cumCos);
      }
    }

    perAssetCF.set(a.id, {
      assetId: a.id,
      assetName: a.name,
      strategy: a.strategy,
      revenueReceivedPerPeriod: revRcv,
      opexPaidPerPeriod: opexPaid,
      capexPerPeriod: capex,
      inventoryPerPeriod: inventoryRow,
    });
  }

  // 4. Project P&L
  const residentialRev = zeros(N);
  const hospitalityRev = zeros(N);
  const retailRev = zeros(N);
  const totalRev = zeros(N);
  const cosTotal = zeros(N);
  const hospOpex = zeros(N);
  const retailOpex = zeros(N);

  for (const a of assets) {
    if (a.visible === false) continue;
    const pl = perAssetPL.get(a.id);
    if (!pl) continue;
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      for (let t = 0; t < N; t++) residentialRev[t] += pl.revenuePerPeriod[t];
    }
    if ((a.strategy === 'Operate' || a.isCompanion === true)) {
      for (let t = 0; t < N; t++) hospitalityRev[t] += pl.revenuePerPeriod[t];
      for (let t = 0; t < N; t++) hospOpex[t] += pl.opexPerPeriod[t];
    }
    if (a.strategy === 'Lease') {
      for (let t = 0; t < N; t++) retailRev[t] += pl.revenuePerPeriod[t];
      for (let t = 0; t < N; t++) retailOpex[t] += pl.opexPerPeriod[t];
    }
    // Sell+Manage parent revenue counted in residential; companion hospitality. Avoid double-count.
    for (let t = 0; t < N; t++) cosTotal[t] += pl.cosPerPeriod[t];
  }
  for (let t = 0; t < N; t++) totalRev[t] = residentialRev[t] + hospitalityRev[t] + retailRev[t];

  const hqOpex = opex.hq.totalOpexPerPeriod.slice(0, N);
  const totalOpex = zeros(N);
  for (let t = 0; t < N; t++) totalOpex[t] = hospOpex[t] + retailOpex[t] + hqOpex[t];

  // Project D&A = base depreciation + IDC-derived depreciation
  // (Operate/Lease assets only, Sell assets recover IDC via CoS instead).
  const da = fixedAssets.projectTotals.depreciable.depreciationPerPeriod.slice(0, N);
  for (let t = 0; t < N; t++) da[t] += idcDeprecProject[t] ?? 0;
  // Interest expense = combined interest expensed (excludes capitalized IDC which lives on BS)
  // M4 Pass 2N-Fix (2026-05-21): financing arrays are length N with
  // arr[0] = year 0. The prior slice(1, 1+N) was dropping year-0 data.
  const interestExpense = financing.combined.totalInterestExpensed.slice(0, N);
  while (interestExpense.length < N) interestExpense.push(0);

  const ebitda = zeros(N);
  const ebit = zeros(N);
  const pbt = zeros(N);
  for (let t = 0; t < N; t++) {
    ebitda[t] = totalRev[t] - cosTotal[t] - totalOpex[t];
    ebit[t] = ebitda[t] - da[t];
    pbt[t] = ebit[t] - interestExpense[t]; // + interestIncome (zero today)
  }
  const taxRate = Math.max(0, project.tax?.rate ?? 0);
  const taxArr = zeros(N);
  const pat = zeros(N);
  for (let t = 0; t < N; t++) {
    taxArr[t] = Math.max(0, pbt[t]) * taxRate;
    pat[t] = pbt[t] - taxArr[t];
  }

  const pl: ProjectPL = {
    residentialRevenuePerPeriod: residentialRev,
    hospitalityRevenuePerPeriod: hospitalityRev,
    retailRevenuePerPeriod: retailRev,
    totalRevenuePerPeriod: totalRev,
    cosPerPeriod: cosTotal,
    hospitalityOpexPerPeriod: hospOpex,
    retailOpexPerPeriod: retailOpex,
    hqOpexPerPeriod: hqOpex,
    totalOpexPerPeriod: totalOpex,
    ebitdaPerPeriod: ebitda,
    daPerPeriod: da,
    ebitPerPeriod: ebit,
    interestExpensePerPeriod: interestExpense,
    interestIncomePerPeriod: zeros(N),
    pbtPerPeriod: pbt,
    taxRate,
    taxPerPeriod: taxArr,
    patPerPeriod: pat,
  };

  // 4b. Operating AR via DSO (M4 Pass 2g, 2026-05-20).
  // Hospitality + Lease revenue is days-driven (AR closing = revenue ×
  // DSO / 365), not milestone-driven like residential. Cash received
  // for operating revenue = revenue − ΔAR. Residential receivables stay
  // on the M2 milestone-driven path (byAssetSchedules[id].ar).
  const operatingRevenuePerPeriod = zeros(N);
  for (let t = 0; t < N; t++) {
    operatingRevenuePerPeriod[t] = (pl.hospitalityRevenuePerPeriod[t] ?? 0) + (pl.retailRevenuePerPeriod[t] ?? 0);
  }
  const operatingArDays = Math.max(0, project.operatingAr?.dsoDays ?? 0);
  const operatingArDaysPerYear = Math.max(1, project.operatingAr?.daysPerYear ?? 365);
  const operatingAR: AccountsReceivableDSOResult = buildAccountsReceivableDSO({
    revenuePerPeriod: operatingRevenuePerPeriod,
    dsoDays: operatingArDays,
    daysPerYear: operatingArDaysPerYear,
    axisLength: N,
  });

  // 5. Direct Cash Flow
  // Revenue received = sum of M2 cash arrays (Sell + Hospitality + Lease)
  // For Hospitality / Lease, replace the cash-on-receipt approximation
  // with the DSO-adjusted cash (revenue − ΔAR). Residential cash stays
  // as the M2 milestone-driven series.
  const revRcvProject = zeros(N);
  for (const a of assets) {
    if (a.visible === false) continue;
    const cf = perAssetCF.get(a.id);
    if (!cf) continue;
    // For Operate / Lease assets, replace asset-level revenue received
    // with their cash basis approximation; the project-level DSO
    // adjustment below corrects the operating-side cash.
    if (a.strategy === 'Operate' || a.strategy === 'Lease' || a.isCompanion === true) continue;
    for (let t = 0; t < N; t++) revRcvProject[t] += cf.revenueReceivedPerPeriod[t];
  }
  // Add DSO-adjusted operating revenue cash (hospitality + lease).
  for (let t = 0; t < N; t++) {
    revRcvProject[t] += operatingAR.cashReceivedPerPeriod[t] ?? 0;
  }
  const escrowHeld = escrow.projectTotals.heldPerPeriod.slice(0, N);
  const escrowRelease = escrow.projectTotals.releasePerPeriod.slice(0, N);
  const netRevAdj = escrow.projectTotals.cashFlowAdjustmentPerPeriod.slice(0, N);

  // Opex paid: AP snapshot gives per-asset + HQ cash paid
  const opexPaidProject = zeros(N);
  const hqOpexPaid = ap.hq.result.cashPaidPerPeriod.slice(0, N);
  for (const ar of ap.byAsset.values()) {
    for (let t = 0; t < N; t++) opexPaidProject[t] += ar.result.cashPaidPerPeriod[t];
  }

  // Tax paid (cash basis: paid in the period tax is incurred)
  const taxPaidArr = taxArr.slice();

  const cashFromOps = zeros(N);
  for (let t = 0; t < N; t++) {
    cashFromOps[t] = revRcvProject[t] + netRevAdj[t] - opexPaidProject[t] - hqOpexPaid[t] - taxPaidArr[t];
  }

  // Capex: project total per-period from financing engine.
  // M4 Pass 2N-Fix (2026-05-21): financing arrays are length N starting
  // at year 0 (per axis.ts contract). The previous slice(1, 1+N) was
  // dropping year-0 capex AND zero-padding the last year. Fixed below.
  const capexFull = financing.capex.perPeriod.inclAllLand; // length = totalPeriods
  const capexProj = capexFull.slice(0, N);
  while (capexProj.length < N) capexProj.push(0);
  const cashFromInv = capexProj.map((v) => -v);

  // Financing flows from M1 (combined + equity). Same Pass 2N-Fix: no
  // off-by-one shift on engine arrays.
  const equityDraws = financing.equity.totalPerPeriod.slice(0, N);
  while (equityDraws.length < N) equityDraws.push(0);
  const debtDraws = financing.combined.totalDrawdown.slice(0, N);
  while (debtDraws.length < N) debtDraws.push(0);
  const debtRepays = financing.combined.totalPrincipalRepaid.slice(0, N);
  while (debtRepays.length < N) debtRepays.push(0);
  const interestPaidArr = financing.combined.debtServiceCash.slice(0, N).map((v, i) => Math.max(0, v - (debtRepays[i] ?? 0)));
  while (interestPaidArr.length < N) interestPaidArr.push(0);

  const cashFromFin = zeros(N);
  for (let t = 0; t < N; t++) {
    cashFromFin[t] = equityDraws[t] + debtDraws[t] - debtRepays[t] - interestPaidArr[t];
  }

  // M4 Pass 2M-A1 (2026-05-20): seed runningCash with the sum of
  // per-phase historicalOpeningCash on operational phases. Captures
  // pre-existing cash that balances opening Debt + Equity vs Pre-Capex
  // at t=0 so the BS check at project Y0 reconciles.
  const historicalOpeningCashTotal = phases.reduce(
    (s, p) => s + Math.max(0, p.historicalBaseline?.historicalOpeningCash ?? 0),
    0,
  );
  const netCf = zeros(N);
  const openingCash = zeros(N);
  const closingCash = zeros(N);
  let runningCash = historicalOpeningCashTotal;
  for (let t = 0; t < N; t++) {
    netCf[t] = cashFromOps[t] + cashFromInv[t] + cashFromFin[t];
    openingCash[t] = runningCash;
    runningCash += netCf[t];
    closingCash[t] = runningCash;
  }

  const directCF: ProjectDirectCF = {
    revenueReceivedPerPeriod: revRcvProject,
    escrowHeldPerPeriod: escrowHeld.map((v) => -v),
    escrowReleasePerPeriod: escrowRelease,
    netRevenueAdjustmentPerPeriod: netRevAdj,
    opexPaidPerPeriod: opexPaidProject.map((v) => -v),
    hqOpexPaidPerPeriod: hqOpexPaid.map((v) => -v),
    taxPaidPerPeriod: taxPaidArr.map((v) => -v),
    cashFromOperationsPerPeriod: cashFromOps,
    capexPerPeriod: capexProj.map((v) => -v),
    cashFromInvestmentPerPeriod: cashFromInv,
    equityDrawdownPerPeriod: equityDraws,
    debtDrawdownPerPeriod: debtDraws,
    debtRepaymentPerPeriod: debtRepays.map((v) => -v),
    interestPaidPerPeriod: interestPaidArr.map((v) => -v),
    cashFromFinancingPerPeriod: cashFromFin,
    netCashFlowPerPeriod: netCf,
    openingCashPerPeriod: openingCash,
    closingCashPerPeriod: closingCash,
  };

  // 6. Indirect Cash Flow
  // Aggregate working-capital changes: AR (operating + residential milestone), AP, Inventory, Unearned, Escrow
  const arOperatingChange = zeros(N);
  const residentialArChange = zeros(N);
  const inventoryChange = zeros(N);
  const unearnedChange = zeros(N);
  // Residential AR + Unearned changes come from per-asset Sell bundles.
  for (const bundle of byAssetSchedules.values()) {
    for (let t = 0; t < N; t++) {
      residentialArChange[t] += bundle.ar.changePerPeriod[t] ?? 0;
      unearnedChange[t] += bundle.unearned.changePerPeriod[t] ?? 0;
    }
  }
  // Inventory: project-level closing summed across per-asset rows; change = Δclosing.
  const inventoryClosingProject = zeros(N);
  for (const cf of perAssetCF.values()) {
    for (let t = 0; t < N; t++) inventoryClosingProject[t] += cf.inventoryPerPeriod[t] ?? 0;
  }
  for (let t = 0; t < N; t++) {
    inventoryChange[t] = inventoryClosingProject[t] - (t === 0 ? 0 : inventoryClosingProject[t - 1]);
  }
  // Operating AR change for the Indirect CF bridge (Pass 2g).
  for (let t = 0; t < N; t++) {
    arOperatingChange[t] = operatingAR.changePerPeriod[t] ?? 0;
  }
  const apChange = ap.projectTotals.changeApPerPeriod.slice(0, N);
  // Escrow change: cumulative balance increases = cash held (effectively a liability sitting on the BS)
  const escrowBalance = escrow.projectTotals.cumulativeBalancePerPeriod.slice(0, N);
  const escrowChange = zeros(N);
  for (let t = 0; t < N; t++) escrowChange[t] = escrowBalance[t] - (t === 0 ? 0 : escrowBalance[t - 1]);

  const cashFromOpsIndirect = zeros(N);
  for (let t = 0; t < N; t++) {
    cashFromOpsIndirect[t] = pat[t] + da[t] + interestExpense[t]
      - arOperatingChange[t] - residentialArChange[t] - inventoryChange[t]
      + apChange[t] + unearnedChange[t] + escrowChange[t]
      - interestPaidArr[t]; // reverse the add-back of interest expense (we paid the real interest in cash)
  }

  const indirectCF: ProjectIndirectCF = {
    patPerPeriod: pat,
    daPerPeriod: da,
    interestExpensePerPeriod: interestExpense,
    changeInArPerPeriod: arOperatingChange.map((v, i) => -(v + residentialArChange[i])),
    changeInInventoryPerPeriod: inventoryChange.map((v) => -v),
    changeInApPerPeriod: apChange,
    changeInUnearnedPerPeriod: unearnedChange,
    changeInEscrowPerPeriod: escrowChange,
    cashFromOperationsPerPeriod: cashFromOpsIndirect,
    capexPerPeriod: capexProj.map((v) => -v),
    cashFromInvestmentPerPeriod: cashFromInv,
    equityDrawdownPerPeriod: equityDraws,
    debtDrawdownPerPeriod: debtDraws,
    debtRepaymentPerPeriod: debtRepays.map((v) => -v),
    interestPaidPerPeriod: interestPaidArr.map((v) => -v),
    cashFromFinancingPerPeriod: cashFromFin,
    netCashFlowPerPeriod: cashFromOpsIndirect.map((v, i) => v + cashFromInv[i] + cashFromFin[i]),
  };

  // 7. Balance Sheet
  // Assets
  const cashPerPeriod = closingCash;
  const arPerPeriod = operatingAR.perPeriod.slice(0, N);
  const residentialReceivables = zeros(N);
  const inventoryArr = inventoryClosingProject;
  for (const bundle of byAssetSchedules.values()) {
    for (let t = 0; t < N; t++) {
      residentialReceivables[t] += bundle.ar.perPeriod[t] ?? 0;
    }
  }
  const nbvArr = fixedAssets.projectTotals.depreciable.closingNBVPerPeriod.slice(0, N);
  const landArr = fixedAssets.projectTotals.land.closingPerPeriod.slice(0, N);
  const totalFA = zeros(N);
  // BS Fixed Assets = Land + Depreciable NBV + Capitalised IDC NBV.
  // IDC NBV picks up the depreciation lifecycle for Operate/Lease assets
  // (Sell IDC flows through CoS and lands in Inventory before being
  // released, so it's already in inventoryArr below).
  for (let t = 0; t < N; t++) totalFA[t] = nbvArr[t] + landArr[t] + (idcNbvProject[t] ?? 0);
  const totalCA = zeros(N);
  for (let t = 0; t < N; t++) totalCA[t] = cashPerPeriod[t] + arPerPeriod[t] + residentialReceivables[t] + inventoryArr[t];
  const totalAssets = zeros(N);
  for (let t = 0; t < N; t++) totalAssets[t] = totalFA[t] + totalCA[t];

  // Liabilities
  const apClosing = ap.projectTotals.closingApPerPeriod.slice(0, N);
  const unearnedClosing = zeros(N);
  for (const bundle of byAssetSchedules.values()) {
    for (let t = 0; t < N; t++) unearnedClosing[t] += bundle.unearned.perPeriod[t] ?? 0;
  }
  const escrowLiab = escrowBalance;
  const debtOutstanding = zeros(N);
  for (const fac of financing.facilities.values()) {
    // M4 Pass 2N-Fix (2026-05-21): fac.outstanding is project-axis-
    // indexed (length = N), where outstanding[t] is the CLOSING balance
    // at end of year t. The previous code read outstanding[t + 1],
    // assuming a [prior, year0, year1, ..., yearN-1] shape that the
    // engine never produced. That shifted every BS year one slot to the
    // left and zeroed the last year (out-of-bounds read), driving the
    // 2,969,006 BS imbalance the user reported.
    for (let t = 0; t < N; t++) debtOutstanding[t] += fac.outstanding[t] ?? 0;
  }
  const totalCL = zeros(N);
  for (let t = 0; t < N; t++) totalCL[t] = apClosing[t] + unearnedClosing[t] + escrowLiab[t];
  const totalLiab = zeros(N);
  for (let t = 0; t < N; t++) totalLiab[t] = totalCL[t] + debtOutstanding[t];

  // Equity
  // M4 Pass 2N-Fix (2026-05-21): Share Capital must include the
  // pre-axis equity opening (financing.existing.equityTotal) so it
  // matches BS Schedules E1 closing balance. Previously only
  // cumulative new draws were counted, leaving existing equity off
  // the BS — the resulting gap was the user-reported mismatch.
  const priorEquityTotal = financing.existing.equityTotal;
  const equityCumulative = cumulative(equityDraws);
  const shareCapital = zeros(N);
  for (let t = 0; t < N; t++) {
    shareCapital[t] = project.shareCapital != null && project.shareCapital > 0
      ? project.shareCapital
      : priorEquityTotal + equityCumulative[t];
  }
  const reserveRate = Math.max(0, project.statutoryReserve?.transferRate ?? 0);
  const reserveCapPct = Math.max(0, project.statutoryReserve?.capOfShareCapital ?? 0);
  const reserveArr = zeros(N);
  const retained = zeros(N);
  let runningReserve = 0;
  let runningRetained = 0;
  for (let t = 0; t < N; t++) {
    const transfer = reserveRate > 0
      ? Math.max(0, pat[t]) * reserveRate
      : 0;
    const cap = reserveCapPct > 0 ? shareCapital[t] * reserveCapPct : Infinity;
    const allowed = Math.max(0, Math.min(transfer, cap - runningReserve));
    runningReserve += allowed;
    runningRetained += pat[t] - allowed;
    reserveArr[t] = runningReserve;
    retained[t] = runningRetained;
  }
  const totalEquity = zeros(N);
  for (let t = 0; t < N; t++) totalEquity[t] = shareCapital[t] + reserveArr[t] + retained[t];

  const totalLandE = zeros(N);
  const bsDiff = zeros(N);
  for (let t = 0; t < N; t++) {
    totalLandE[t] = totalLiab[t] + totalEquity[t];
    bsDiff[t] = totalAssets[t] - totalLandE[t];
  }

  const bs: ProjectBS = {
    cashPerPeriod,
    arPerPeriod,
    residentialReceivablesPerPeriod: residentialReceivables,
    inventoryPerPeriod: inventoryArr,
    nbvPerPeriod: nbvArr,
    landPerPeriod: landArr,
    totalFixedAssetsPerPeriod: totalFA,
    totalCurrentAssetsPerPeriod: totalCA,
    totalAssetsPerPeriod: totalAssets,
    apPerPeriod: apClosing,
    unearnedRevenuePerPeriod: unearnedClosing,
    escrowLiabilityPerPeriod: escrowLiab,
    debtOutstandingPerPeriod: debtOutstanding,
    totalCurrentLiabilitiesPerPeriod: totalCL,
    totalLiabilitiesPerPeriod: totalLiab,
    shareCapitalPerPeriod: shareCapital,
    statutoryReservePerPeriod: reserveArr,
    retainedEarningsPerPeriod: retained,
    totalEquityPerPeriod: totalEquity,
    totalLiabilitiesAndEquityPerPeriod: totalLandE,
    bsDifferencePerPeriod: bsDiff,
    historicalOpeningCashTotal,
  };

  const idcSnapshot: ProjectIDCSnapshot = {
    axisLength: N,
    totalIdcPerPeriod,
    byAsset: byAssetIDC,
    totalLandSqm,
    idcDepreciationPerPeriod: idcDeprecProject,
    idcNbvPerPeriod: idcNbvProject,
  };

  return {
    axisLength: N,
    projectStartYear,
    yearLabels,
    revenue,
    opex,
    ap,
    escrow,
    fixedAssets,
    financing,
    idc: idcSnapshot,
    byAssetSchedules,
    perAssetPL,
    perAssetCF,
    pl,
    directCF,
    indirectCF,
    bs,
  };
}
