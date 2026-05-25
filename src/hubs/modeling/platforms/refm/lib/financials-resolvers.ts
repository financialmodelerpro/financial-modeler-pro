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
} from '@/src/core/calculations/depreciation';
import {
  buildAccountsReceivableDSO,
  buildCostOfSales,
  type AccountsReceivableDSOResult,
  type CostOfSalesResult,
} from '@/src/core/calculations/revenue';
import {
  computeAssetLandSqm,
  computeAssetBua,
  computeAssetCost,
  resolveUsefulLifeYears,
} from '@/src/core/calculations';
import type { Module1Store } from './state/module1-store';
import type { Asset, Phase, FinancingTranche } from './state/module1-types';
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
  /** M4 Pass 2P (2026-05-24): cash equity only — what actually moves
   *  through CF. In-kind equity is captured in equityInKindDrawdownPerPeriod
   *  as a memo. */
  equityDrawdownPerPeriod: number[];
  /** M4 Pass 2P (2026-05-24): in-kind equity (land in-kind) memo. NOT
   *  included in cashFromFinancingPerPeriod. */
  equityInKindDrawdownPerPeriod: number[];
  debtDrawdownPerPeriod: number[];
  debtRepaymentPerPeriod: number[];        // negative
  interestPaidPerPeriod: number[];         // negative
  /** M4 Pass 2T (2026-05-24): dividends paid per period (negative). */
  dividendsPaidPerPeriod: number[];
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
  changeInEscrowPerPeriod: number[];       // −ΔEscrow (restricted-cash asset build consumes cash)
  cashFromOperationsPerPeriod: number[];
  capexPerPeriod: number[];
  cashFromInvestmentPerPeriod: number[];
  /** M4 Pass 2P (2026-05-24): cash equity only — what actually moves
   *  through CF. In-kind equity is captured in equityInKindDrawdownPerPeriod
   *  as a memo (NOT included in cashFromFinancingPerPeriod). */
  equityDrawdownPerPeriod: number[];
  /** M4 Pass 2P (2026-05-24): in-kind equity (land in-kind) memo. Does
   *  NOT flow through cash; mirrors the in-kind land already on BS as a
   *  Land asset + Share Capital recognition. Surfaced so BS Equity
   *  Schedule and audit views can render the split. */
  equityInKindDrawdownPerPeriod: number[];
  debtDrawdownPerPeriod: number[];
  debtRepaymentPerPeriod: number[];        // negative; INCLUDES cash-sweep repayments
  interestPaidPerPeriod: number[];         // actual cash interest
  /** M4 (2026-05-25): dividends paid per period (negative). Mirrors the
   *  Direct CF so both methods reconcile to the same closing cash. */
  dividendsPaidPerPeriod: number[];
  cashFromFinancingPerPeriod: number[];
  netCashFlowPerPeriod: number[];
  /** M4 (2026-05-25): opening / closing cash, identical to the Direct CF
   *  series (post sweep + dividend). Both methods MUST close to the same
   *  balance; exposing it here lets the Indirect surface show it too. */
  openingCashPerPeriod: number[];
  closingCashPerPeriod: number[];
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
  /** Escrow modeled as RESTRICTED CASH (asset), not a liability:
   *  developer's pre-sales cash held in escrow and released back per
   *  milestones. Offsets the operating-cash reduction so the BS balances. */
  escrowRestrictedCashPerPeriod: number[];
  debtOutstandingPerPeriod: number[];
  totalCurrentLiabilitiesPerPeriod: number[];
  totalLiabilitiesPerPeriod: number[];
  // Equity
  shareCapitalPerPeriod: number[];
  statutoryReservePerPeriod: number[];
  retainedEarningsPerPeriod: number[];
  totalEquityPerPeriod: number[];
  /** M4 Pass 2P (2026-05-24): per-period STATUTORY-RESERVE TRANSFER (not
   *  cumulative). Used by the Retained Earnings Schedule to show the
   *  (-) transfer line; statutoryReservePerPeriod above is cumulative. */
  statutoryReserveTransferPerPeriod: number[];
  /** M4 Pass 2P (2026-05-24): per-period DIVIDEND distribution. Zero
   *  today (Dividend policy lands in a follow-up pass); field present
   *  so the RE Schedule and downstream consumers can wire to it without
   *  schema churn. */
  dividendsPerPeriod: number[];
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
export interface AssetIDCRow {
  assetId: string;
  assetName: string;
  /** Asset strategy (used by UI to route the row to Sell/CoS or Op-Lease/FA). */
  strategy: Asset['strategy'];
  /** Share basis value for this asset (land sqm OR BUA sqm depending on
   *  ProjectIDCSnapshot.allocationBasis). Name retained for back-compat. */
  landSqm: number;
  /** This asset's share of the total share-basis denominator (0..1).
   *  Name retained for back-compat; means "share of total" regardless of
   *  whether the basis is land or BUA. */
  shareOfTotalLand: number;
  /** M4 Pass 2Q (2026-05-24): physical land sqm for this asset
   *  (always the actual land area regardless of active basis). For
   *  display alongside the basis-share so users can verify the
   *  percentage math. */
  physicalLandSqm: number;
  /** M4 Pass 2Q (2026-05-24): physical BUA sqm for this asset
   *  (always the actual built-up area regardless of active basis). */
  physicalBuaSqm: number;
  /** Per-period IDC capitalised to this asset. */
  idcPerPeriod: number[];
  /** Cumulative IDC capitalised through each period. */
  cumulativeIdcPerPeriod: number[];
  /** Total IDC capitalised across the axis. */
  totalIdc: number;
  /** M4 Pass 2O: Operate/Lease only — depreciation derived from this
   *  asset's IDC additions (straight-line over useful life from handover).
   *  Zero for Sell / Sell+Manage (IDC there unwinds through CoS instead). */
  depreciationPerPeriod: number[];
  /** M4 Pass 2O: Operate/Lease only — closing NBV of capitalised IDC. */
  closingNbvPerPeriod: number[];
}

export interface ProjectIDCSnapshot {
  axisLength: number;
  /** M4 Pass 2O (2026-05-24): basis used for the per-asset share calc.
   *  Mirrors project.idcConfig.allocationBasis ('land' default). */
  allocationBasis: 'land' | 'bua';
  /** M4 Pass 2O (2026-05-24): whether interest was capitalised this run.
   *  When false, totalIdcPerPeriod is zero and all construction interest
   *  flowed through P&L Finance Cost instead. */
  capitalize: boolean;
  /** M4 Pass 2O (2026-05-24): funding mode used this run. */
  fundingMode: 'debt_drawdown' | 'cash';
  /** Total interest accrued during construction window (P&L+asset basis
   *  combined). Always populated regardless of capitalize flag, so the
   *  Summary panel can show the underlying interest stream and contrast
   *  with the capitalised/expensed split. M4 Pass 2O. */
  totalConstructionInterestPerPeriod: number[];
  /** Project IDC per period actually routed to asset basis (sum across
   *  all assets). Equal to totalConstructionInterestPerPeriod when
   *  capitalize=true; zero when capitalize=false. */
  totalIdcPerPeriod: number[];
  /** Per-asset IDC row. Empty when total project IDC is zero. */
  byAsset: Map<string, AssetIDCRow>;
  /** Sum of share-basis values (land sqm OR BUA sqm) across all
   *  participating assets. Name retained for back-compat. */
  totalLandSqm: number;
  /** Depreciation derived from IDC additions on Operate / Lease assets. */
  idcDepreciationPerPeriod: number[];
  /** Cumulative IDC NBV for Operate / Lease assets, project total. */
  idcNbvPerPeriod: number[];
}

/**
 * M4 (2026-05-25): Balance-sheet reconciliation diagnostic.
 *
 * The BS difference (Assets − (Liabilities + Equity)) equals
 * (cash-flow-derived cash) − (plug cash). Differentiating period-over-
 * period gives an EXACT identity:
 *
 *   Δ(BS diff)[t] = NetCashFlow[t]
 *                   − Δ(Debt + Share + Reserve+Retained + AP + Unearned + Escrow)[t]
 *                   + Δ(AR + ResAR + Inventory + NBV + Land + IDC NBV)[t]
 *
 * Every term below is one piece of that bridge. When the BS balances,
 * the pieces net to zero each period. When it does not, the piece whose
 * stock change is NOT offset by a matching cash-flow line is the leak.
 * For t >= 1 all opening balances cancel, so the bridge is clean; the
 * t = 0 column also carries pre-axis openings (existing debt / equity /
 * fixed assets) and is informational.
 */
export interface BsReconciliation {
  /** Assets − (Liab + Equity), cumulative. Mirrors bs.bsDifferencePerPeriod. */
  bsDifferencePerPeriod: number[];
  /** Period change of the cumulative BS difference. Equals the signed
   *  sum of every component below (exact identity). */
  bsDifferenceChangePerPeriod: number[];
  /** Direct/Indirect net cash flow (they are equal). Drives the bridge. */
  netCashFlowPerPeriod: number[];
  /** Liabilities + Equity period changes (each REDUCES Δ BS diff). */
  deltaDebtPerPeriod: number[];
  deltaShareCapitalPerPeriod: number[];
  deltaReserveRetainedPerPeriod: number[];
  deltaApPerPeriod: number[];
  deltaUnearnedPerPeriod: number[];
  /** Non-cash asset period changes (each INCREASES Δ BS diff).
   *  deltaEscrowPerPeriod is restricted cash (an asset), not a liability. */
  deltaEscrowPerPeriod: number[];
  deltaArPerPeriod: number[];
  deltaResidentialReceivablesPerPeriod: number[];
  deltaInventoryPerPeriod: number[];
  deltaNbvPerPeriod: number[];
  deltaLandPerPeriod: number[];
  deltaIdcNbvPerPeriod: number[];
  /** Residual that the named components do NOT explain. EXACT identity =>
   *  this is ~0 everywhere; a nonzero value means a line is missing from
   *  the BS or the bridge (a coding gap), not a wiring leak. */
  unexplainedPerPeriod: number[];
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
  /** M4 Pass 2S (2026-05-24): cash sweep schedule + adjusted BS Cash /
   *  Debt curves. Always present; sweep.enabled === false when no
   *  tranche has sweep configured. */
  cashSweep: CashSweepSnapshot;
  /** M4 Pass 2T (2026-05-24): dividend distribution per phase. Always
   *  present; .enabled === false when no phase has dividendPolicy.enabled. */
  dividends: DividendSnapshot;
  /** M4 (2026-05-25): per-line BS reconciliation bridge. Localizes which
   *  line drives any Assets vs (Liab + Equity) imbalance. */
  bsReconciliation: BsReconciliation;
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

/**
 * M4 Pass 2O (2026-05-24): standalone IDC snapshot helper.
 * Extracted from computeFinancialsSnapshot so Module 1 Financing can
 * render the IDC Settings + per-asset Summary + routing breakdown
 * without re-composing the full FS pipeline.
 *
 * Inputs: state + a computed financing result. Output: ProjectIDCSnapshot
 * with per-asset rows including Operate/Lease depreciation + closing NBV
 * embedded directly on each AssetIDCRow.
 */
export function computeIdcSnapshot(
  state: Pick<FinancialsResolverState, 'project' | 'phases' | 'assets' | 'subUnits' | 'parcels' | 'landAllocationMode'>,
  financing: FinancingComputation,
  ctx: { axisLength: number; projectStartYear: number },
): ProjectIDCSnapshot {
  const { project, phases, assets, subUnits, parcels, landAllocationMode } = state;
  const { axisLength: N, projectStartYear } = ctx;

  const idcSource = financing.combined.totalInterestForAssetBasis;
  const totalIdcPerPeriod = idcSource.slice(0, N);
  while (totalIdcPerPeriod.length < N) totalIdcPerPeriod.push(0);

  const allocationBasis = project.idcConfig?.allocationBasis ?? 'land';
  const assetShare = new Map<string, number>();
  // M4 Pass 2Q: capture BOTH physical land sqm + physical BUA sqm per
  // asset (independent of active basis) so the UI can display them
  // side-by-side for verification.
  const physicalLand = new Map<string, number>();
  const physicalBua = new Map<string, number>();
  let totalShareDenom = 0;
  const constructionWindow = new Map<string, { startIdx: number; endIdx: number }>();
  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    const landSqm = Math.max(0, computeAssetLandSqm(a, parcels, assets, subUnits, landAllocationMode));
    const buaSqm = Math.max(0, computeAssetBua(a, subUnits));
    physicalLand.set(a.id, landSqm);
    physicalBua.set(a.id, buaSqm);
    const sqm = allocationBasis === 'bua' ? buaSqm : landSqm;
    assetShare.set(a.id, sqm);
    totalShareDenom += sqm;
    const phase = phases.find((p) => p.id === a.phaseId);
    const phaseStartYear = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const cp = Math.max(0, phase?.constructionPeriods ?? 0);
    if (cp <= 0) continue;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    const startIdx = Math.max(0, Math.min(N - 1, offset));
    const endIdxRaw = offset + cp - 1;
    if (endIdxRaw < startIdx) continue;
    constructionWindow.set(a.id, { startIdx, endIdx: Math.min(N - 1, endIdxRaw) });
  }

  const byAssetIDC = new Map<string, AssetIDCRow>();
  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    const sqm = assetShare.get(a.id) ?? 0;
    byAssetIDC.set(a.id, {
      assetId: a.id,
      assetName: a.name,
      strategy: a.strategy,
      landSqm: sqm,
      shareOfTotalLand: totalShareDenom > 0 ? sqm / totalShareDenom : 0,
      physicalLandSqm: physicalLand.get(a.id) ?? 0,
      physicalBuaSqm: physicalBua.get(a.id) ?? 0,
      idcPerPeriod: zeros(N),
      cumulativeIdcPerPeriod: zeros(N),
      totalIdc: 0,
      depreciationPerPeriod: zeros(N),
      closingNbvPerPeriod: zeros(N),
    });
  }

  for (let t = 0; t < N; t++) {
    const idcAtT = totalIdcPerPeriod[t] ?? 0;
    if (idcAtT === 0) continue;
    let activeDenom = 0;
    const activeIds: string[] = [];
    for (const [assetId, win] of constructionWindow) {
      if (t < win.startIdx || t > win.endIdx) continue;
      const sqm = assetShare.get(assetId) ?? 0;
      if (sqm <= 0) continue;
      activeDenom += sqm;
      activeIds.push(assetId);
    }
    if (activeDenom <= 0) {
      if (totalShareDenom <= 0) continue;
      for (const [assetId, row] of byAssetIDC) {
        const sqm = assetShare.get(assetId) ?? 0;
        const slice = idcAtT * (sqm / totalShareDenom);
        row.idcPerPeriod[t] += slice;
      }
    } else {
      for (const assetId of activeIds) {
        const sqm = assetShare.get(assetId) ?? 0;
        const slice = idcAtT * (sqm / activeDenom);
        const row = byAssetIDC.get(assetId);
        if (row) row.idcPerPeriod[t] += slice;
      }
    }
  }

  for (const row of byAssetIDC.values()) {
    let running = 0;
    for (let t = 0; t < N; t++) {
      running += row.idcPerPeriod[t] ?? 0;
      row.cumulativeIdcPerPeriod[t] = running;
    }
    row.totalIdc = running;
  }

  // IDC-driven depreciation for Operate / Lease assets (Sell/Sell+Manage
  // recover IDC via CoS unwinding, handled in the composer instead).
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
    for (let t = 0; t < N; t++) {
      idc.depreciationPerPeriod[t] = idcRes.depreciationPerPeriod[t] ?? 0;
      idc.closingNbvPerPeriod[t] = idcRes.closingNBVPerPeriod[t] ?? 0;
      idcDeprecProject[t] += idc.depreciationPerPeriod[t];
      idcNbvProject[t] += idc.closingNbvPerPeriod[t];
    }
  }

  const totalConstructionInterestPerPeriod = zeros(N);
  for (const fac of financing.facilities.values()) {
    const dc = fac.interestDuringConstruction ?? [];
    for (let t = 0; t < N; t++) totalConstructionInterestPerPeriod[t] += dc[t] ?? 0;
  }

  return {
    axisLength: N,
    allocationBasis,
    capitalize: project.idcConfig?.capitalize !== false,
    fundingMode: project.idcConfig?.fundingMode ?? 'debt_drawdown',
    totalConstructionInterestPerPeriod,
    totalIdcPerPeriod,
    byAsset: byAssetIDC,
    totalLandSqm: totalShareDenom,
    idcDepreciationPerPeriod: idcDeprecProject,
    idcNbvPerPeriod: idcNbvProject,
  };
}

/**
 * M4 Pass 2R (2026-05-24): Funding Gap snapshot.
 *
 * Two methods for sizing the project's required external funding
 * (debt + equity to be raised within the project axis):
 *
 *   Method A — Capex vs Pre-Sales (gross feasibility view):
 *     gap[t] = capex[t] − (preSalesCash[t] − escrowHeld[t])
 *     i.e. cash capex less the portion of pre-sales actually
 *     available (Pre-Sales received minus the amount held in escrow).
 *     Simple. Ignores opex, AR, AP, tax, interest. Useful as a
 *     sanity check + a baseline for early feasibility.
 *
 *   Method B — Pre-financing CF deficit (full waterfall):
 *     gap[t] = −(cashFromOps[t] + cashFromInv[t]) when negative
 *              0                                  otherwise.
 *     I.e. whatever the operations + investing CF can't fund itself
 *     becomes the period's funding requirement. Accounts for opex,
 *     AR/AP timing, tax, interest paid, escrow movement — the
 *     "true" feasibility gap.
 *
 * Both methods produce per-period + cumulative + grand total. The
 * UI's "Funding Gap" sub-tab in Module 1 Financing renders them
 * side-by-side. Wiring these gaps into actual debt drawdown sizing
 * (Methods 2 + 3 in computeFundingRequirement) is a follow-up pass.
 */
/**
 * M4 Pass 2U (2026-05-24): Method 3 detailed waterfall snapshot.
 * Per-period cash waterfall arriving at "Net Cash Required" — the
 * funding-gap output that NEW debt drawdown should cover. Matches the
 * user's reference layout (Opening Cash → ... → Cash Available Before
 * New Debt → vs Minimum Cash → Net Cash Required).
 */
export interface Method3WaterfallSnapshot {
  axisLength: number;
  openingCashPerPeriod: number[];
  cashFromOpsPerPeriod: number[];
  cashFromInvPerPeriod: number[];
  /** Existing equity contributions per period (typically a lump at t=0 from
   *  pre-axis operational phase equity). */
  existingEquityDrawdownPerPeriod: number[];
  /** Existing debt drawdowns per period (typically a lump at t=0 or
   *  the originationYear of an existing tranche raised inside the axis). */
  existingDebtDrawdownPerPeriod: number[];
  /** Existing debt principal repayments per period (negative). */
  existingDebtRepaymentPerPeriod: number[];
  /** Cash-paid finance cost per period (existing + new ops-period; negative).
   *  Does NOT include capitalised IDC (which doesn't move cash). */
  financeCostPaidPerPeriod: number[];
  /** Memo line: per-period IDC capitalised = new debt drawdown to fund
   *  the construction interest. Does NOT move cash (interest is added
   *  to debt balance directly). Shown for transparency. */
  idcDrawdownPerPeriod: number[];
  /** Before-sweep dividends paid per period (negative — Phase 1
   *  operational dividends pay before debt sweep). */
  dividendsBeforeSweepPerPeriod: number[];
  /** Cash available BEFORE any new debt drawdown is added. */
  cashAvailableBeforeNewDebtPerPeriod: number[];
  /** Minimum cash reserve floor (project-wide). */
  minCashReserve: number;
  /** Net cash required to maintain min cash = max(0, minCash − Cash Available). */
  netCashRequiredPerPeriod: number[];
  totalNetCashRequired: number;
}

export interface FundingGapSnapshot {
  axisLength: number;
  yearLabels: number[];
  // Method 2 inputs (Net Funding Requirement, Capex vs Pre-Sales)
  capexPerPeriod: number[];
  /** Pre-sales cash received from customers, gross of escrow. */
  preSalesGrossPerPeriod: number[];
  /** Cash held back into escrow (inaccessible to project) per period. */
  escrowHeldPerPeriod: number[];
  /** Escrow release back to project per period (becomes accessible). */
  escrowReleasePerPeriod: number[];
  /** Pre-sales net of escrow movement = gross − held + release. */
  preSalesNetPerPeriod: number[];
  /** Funding requirement fulfilled by pre-sales = min(capex, preSalesNet[t-1]).
   *  Lagged one period per Pass 2T-Fix. */
  fulfilledByPreSalesPerPeriod: number[];
  /** Method 2 funding gap per period: MAX(0, capex_t − preSalesNet_{t-1}).
   *  Lagged one period per Pass 2T-Fix. */
  methodAGapPerPeriod: number[];
  methodAGapCumulative: number[];
  methodATotalGap: number;
  /** @deprecated Kept for legacy V1 callers; equal to preSalesGrossPerPeriod. */
  preSalesCashPerPeriod: number[];
  // Method B inputs
  cashFromOpsPerPeriod: number[];
  cashFromInvPerPeriod: number[];
  /** Method 3 simple-form pre-financing net CF (legacy): ops + investing
   *  per period (lagged ops). Kept for back-compat; the detailed
   *  method3Waterfall below is the canonical Method 3 view. */
  preFinancingNetCfPerPeriod: number[];
  methodBGapPerPeriod: number[];
  methodBGapCumulative: number[];
  methodBTotalGap: number;
  /** M4 Pass 2U (2026-05-24): detailed Method 3 cash-deficit waterfall. */
  method3Waterfall: Method3WaterfallSnapshot;
}

/**
 * M4 Pass 2S (2026-05-24): Cash Sweep snapshot.
 *
 * Forward-pass post-processor on the financing engine output. For each
 * period:
 *   excess[t] = preSweepClosingCash[t] − minCashReserve (only counted
 *               from each tranche's sweep startingYear onward)
 *   if excess > 0, distribute across sweep-enabled tranches in priority
 *   order (lower priority = paid first), limited by each tranche's
 *   remaining outstanding balance and its sweepRatio.
 *
 * V1 limitation: this iteration does NOT re-derive future interest from
 * the lower post-sweep balance — the snapshot's interestAccrued curve
 * stays as the financing engine emitted it. This means an actual sweep
 * would save more interest than this display shows, leaving a small
 * residual excess cash in later years. Tighter iteration lands in a
 * follow-up pass; current view is accurate for the sweep schedule and
 * the BS adjustment (cash − debt, both sides reduce equally).
 */
export interface CashSweepRow {
  trancheId: string;
  trancheName: string;
  origin: 'existing' | 'new';
  priority: number;
  startingYear: number;
  startingYearAxisIdx: number;
  sweepRatio: number;
  preSweepOutstanding: number[];
  postSweepOutstanding: number[];
  sweepPerPeriod: number[];
  totalSwept: number;
}

export interface CashSweepSnapshot {
  axisLength: number;
  enabled: boolean;
  /** Project minimum cash reserve consumed by the sweep floor. */
  minCashReserve: number;
  /** Sorted list of sweep-eligible tranches (priority ascending). */
  eligibleTranches: CashSweepRow[];
  /** Pre-sweep closing cash per period (mirrors directCF before sweep). */
  preSweepClosingCash: number[];
  /** Excess available per period before sweep (capped at 0 from below). */
  excessAvailablePerPeriod: number[];
  /** Total sweep applied per period (sum across all tranches). */
  totalSweepPerPeriod: number[];
  totalSweep: number;
  /** Closing cash per period AFTER sweep AND dividends. */
  adjustedClosingCash: number[];
  /** Project total debt outstanding per period AFTER sweep. */
  adjustedDebtOutstanding: number[];
  /** M4 Pass 2Y (2026-05-24): interest savings per period from the
   *  reduced post-sweep balance. interest_savings[t] = sum over
   *  sweep-enabled tranches of (preSweep[t-1] − postSweep[t-1]) × rate.
   *  Composer subtracts from both totalInterestExpensed (P&L) and the
   *  cash interest paid (CF) so BS stays balanced AND the model
   *  captures the real-world benefit of sweeping. */
  interestSavingsPerPeriod: number[];
  totalInterestSavings: number;
}

/**
 * M4 Pass 2T (2026-05-24): Dividend snapshot. Driven by per-phase
 * Phase.dividendPolicy. Per period:
 *   excess = preSweepClosingCash − minCashReserve − cumPriorAllocations
 *   1. before_sweep dividends paid first (priority over cash sweep —
 *      typical for operational phases that already produce cash and
 *      want to distribute before new-debt sweep).
 *   2. cash sweep on debt facilities (priority order across tranches).
 *   3. after_sweep dividends paid last (new phases, after debt repays).
 * Each step respects the project minimum cash reserve floor.
 */
export interface DividendPhaseRow {
  phaseId: string;
  phaseName: string;
  priority: 'before_sweep' | 'after_sweep';
  startingYear: number;
  startingYearAxisIdx: number;
  payoutRatio: number;
  dividendsPerPeriod: number[];
  totalDividends: number;
  /** M4 Pass 2T-Fix (2026-05-24): per-phase EBITDA per period (sum of
   *  per-asset EBITDA for assets in this phase). Used as the dividend
   *  cap: cumulative dividends ≤ cumulative EBITDA. */
  phaseEbitdaPerPeriod: number[];
  /** Cumulative EBITDA through each period (project axis). */
  cumulativeEbitdaPerPeriod: number[];
  /** Remaining EBITDA budget BEFORE this period's dividend = cum EBITDA[t]
   *  − cum dividends[t−1]. Negative values mean cap is exhausted. */
  ebitdaBudgetPerPeriod: number[];
  /** Total cumulative EBITDA across the axis (the lifetime dividend cap). */
  totalPhaseEbitda: number;
  /** M4 Pass 2U-Fix (2026-05-24): per-period cash available to pay this
   *  phase's dividend, AFTER prior waterfall steps (min reserve floor +
   *  any before-sweep dividends paid earlier + cash sweep if this is an
   *  after-sweep phase). If 0, no dividend can be paid this period
   *  regardless of EBITDA budget. */
  cashAvailableForDividendPerPeriod: number[];
}

export interface DividendSnapshot {
  axisLength: number;
  enabled: boolean;
  beforeSweepPhases: DividendPhaseRow[];
  afterSweepPhases: DividendPhaseRow[];
  /** Per-period total dividends (sum across all phases, before + after). */
  totalDividendsPerPeriod: number[];
  totalDividends: number;
}

/**
 * Combined Cash Waterfall (M4 Pass 2T, 2026-05-24): forward pass that
 * interleaves before-sweep dividends → cash sweep → after-sweep
 * dividends per period. Returns both CashSweepSnapshot and
 * DividendSnapshot so the composer + UI can render each tier separately.
 */
export function computeCashWaterfall(args: {
  axisLength: number;
  projectStartYear: number;
  tranches: FinancingTranche[];
  phases: Phase[];
  facilityOutstanding: Map<string, number[]>;
  preSweepClosingCash: number[];
  minCashReserve: number;
  /** M4 Pass 2T-Fix (2026-05-24): per-phase EBITDA per period, used to
   *  cap cumulative dividends per phase. Phases not in the map are
   *  treated as zero EBITDA (no dividend allowed). */
  phaseEbitdaPerPeriod?: Map<string, number[]>;
}): { cashSweep: CashSweepSnapshot; dividends: DividendSnapshot } {
  const { axisLength: N, projectStartYear, tranches, phases, facilityOutstanding, preSweepClosingCash, minCashReserve, phaseEbitdaPerPeriod } = args;

  // Build sweep-eligible tranches.
  const eligible: CashSweepRow[] = [];
  for (const t of tranches) {
    const cfg = t.cashSweepConfig ?? {};
    const useSweep = (t.repaymentMethod === 'cash_sweep') || (cfg.enabled === true);
    if (!useSweep) continue;
    const fac = facilityOutstanding.get(t.id);
    if (!fac) continue;
    const phase = phases.find((p) => p.id === t.phaseId);
    const phaseStartYear = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const cp = Math.max(0, phase?.constructionPeriods ?? 0);
    const defaultStartingYear = phaseStartYear + cp;
    const startingYear = cfg.startingYear ?? defaultStartingYear;
    const startingYearAxisIdx = Math.max(0, Math.min(N - 1, startingYear - projectStartYear));
    const priority = cfg.priority ?? 100;
    const sweepRatio = Math.max(0, Math.min(1, (cfg.sweepRatio ?? 100) / 100));
    eligible.push({
      trancheId: t.id,
      trancheName: t.name,
      origin: t.origin === 'existing' ? 'existing' : 'new',
      priority,
      startingYear,
      startingYearAxisIdx,
      sweepRatio,
      preSweepOutstanding: fac.slice(0, N),
      postSweepOutstanding: fac.slice(0, N),
      sweepPerPeriod: new Array<number>(N).fill(0),
      totalSwept: 0,
    });
  }
  eligible.sort((a, b) => a.priority - b.priority);

  // Build dividend-enabled phases (before-sweep first, then after-sweep).
  // M4 Pass 2U-Fix (2026-05-24): priority is forced by phase.status —
  // operational phases pay BEFORE the cash sweep (Phase 1 first claim
  // on cash); non-operational (construction) phases pay AFTER sweep.
  // User no longer toggles this in the UI; the legacy policy.priority
  // field stays on schema for back-compat but is ignored.
  const statusPriority = (phase: Phase): 'before_sweep' | 'after_sweep' =>
    phase.status === 'operational' ? 'before_sweep' : 'after_sweep';
  const buildPhaseRow = (phase: Phase, priority: 'before_sweep' | 'after_sweep'): DividendPhaseRow | null => {
    const policy = phase.dividendPolicy ?? {};
    if (policy.enabled !== true) return null;
    if (statusPriority(phase) !== priority) return null;
    const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const cp = Math.max(0, phase.constructionPeriods ?? 0);
    const defaultStartingYear = phase.status === 'operational' ? projectStartYear : phaseStartYear + cp;
    const startingYear = policy.startingYear ?? defaultStartingYear;
    const startingYearAxisIdx = Math.max(0, Math.min(N - 1, startingYear - projectStartYear));
    const payoutRatio = Math.max(0, Math.min(1, (policy.payoutRatio ?? 0) / 100));
    // M4 Pass 2T-Fix: EBITDA cap. Cumulative EBITDA defines the lifetime
    // cap on cumulative dividends (per Ahmad 2026-05-24: "Phase 1
    // dividend will be Max of EBITDA of Phase 1, not more than this").
    const rawEbitda = phaseEbitdaPerPeriod?.get(phase.id) ?? new Array<number>(N).fill(0);
    const ebitda = new Array<number>(N).fill(0);
    for (let t = 0; t < N; t++) ebitda[t] = rawEbitda[t] ?? 0;
    const cumEbitda = new Array<number>(N).fill(0);
    {
      let s = 0;
      for (let t = 0; t < N; t++) { s += ebitda[t]; cumEbitda[t] = s; }
    }
    return {
      phaseId: phase.id,
      phaseName: phase.name,
      priority,
      startingYear,
      startingYearAxisIdx,
      payoutRatio,
      dividendsPerPeriod: new Array<number>(N).fill(0),
      totalDividends: 0,
      phaseEbitdaPerPeriod: ebitda,
      cumulativeEbitdaPerPeriod: cumEbitda,
      ebitdaBudgetPerPeriod: new Array<number>(N).fill(0),
      totalPhaseEbitda: cumEbitda[N - 1] ?? 0,
      cashAvailableForDividendPerPeriod: new Array<number>(N).fill(0),
    };
  };
  const beforeSweepPhases: DividendPhaseRow[] = [];
  const afterSweepPhases: DividendPhaseRow[] = [];
  for (const ph of phases) {
    const before = buildPhaseRow(ph, 'before_sweep');
    if (before) beforeSweepPhases.push(before);
    const after = buildPhaseRow(ph, 'after_sweep');
    if (after) afterSweepPhases.push(after);
  }

  const excessAvailablePerPeriod = new Array<number>(N).fill(0);
  const totalSweepPerPeriod = new Array<number>(N).fill(0);
  const totalDividendsPerPeriod = new Array<number>(N).fill(0);
  const adjustedClosingCash = preSweepClosingCash.slice(0, N);
  while (adjustedClosingCash.length < N) adjustedClosingCash.push(0);

  // Forward pass with the full waterfall.
  let cumAllocation = 0;
  for (let t = 0; t < N; t++) {
    const cashBefore = (preSweepClosingCash[t] ?? 0) - cumAllocation;
    let excess = Math.max(0, cashBefore - minCashReserve);
    excessAvailablePerPeriod[t] = excess;
    if (excess <= 0) {
      adjustedClosingCash[t] = cashBefore;
      continue;
    }
    // 1. Before-sweep dividends. Capped by remaining EBITDA budget:
    //    budget[t] = cumEbitda[t] − cumDividendsPaid[t−1]. Per Ahmad
    //    2026-05-24: "Phase 1 dividend will be Max of EBITDA of Phase 1,
    //    not more than this".
    // M4 Pass 2U-Fix (2026-05-24): also record cashAvailableForDividend
    //    so UI can show the gate explicitly. excess is already the cash
    //    above the min reserve floor; if 0 → no dividend possible.
    for (const row of beforeSweepPhases) {
      if (t < row.startingYearAxisIdx || row.payoutRatio <= 0) continue;
      row.cashAvailableForDividendPerPeriod[t] = excess;
      if (excess <= 0) continue;
      const cumEb = row.cumulativeEbitdaPerPeriod[t] ?? 0;
      const cumDivPriorPeriods = row.totalDividends; // through t-1 (this period's not added yet)
      const budget = Math.max(0, cumEb - cumDivPriorPeriods);
      row.ebitdaBudgetPerPeriod[t] = budget;
      const desired = excess * row.payoutRatio;
      const div = Math.min(desired, excess, budget);
      if (div <= 0) continue;
      row.dividendsPerPeriod[t] = (row.dividendsPerPeriod[t] ?? 0) + div;
      row.totalDividends += div;
      totalDividendsPerPeriod[t] += div;
      excess -= div;
    }
    // 2. Cash sweep on debt.
    for (const row of eligible) {
      if (t < row.startingYearAxisIdx || excess <= 0) continue;
      const remaining = Math.max(0, row.postSweepOutstanding[t] ?? 0);
      if (remaining <= 0) continue;
      const sweepable = Math.min(excess * row.sweepRatio, remaining, excess);
      if (sweepable <= 0) continue;
      row.sweepPerPeriod[t] = (row.sweepPerPeriod[t] ?? 0) + sweepable;
      row.totalSwept += sweepable;
      totalSweepPerPeriod[t] += sweepable;
      excess -= sweepable;
      for (let u = t; u < N; u++) {
        row.postSweepOutstanding[u] = Math.max(0, row.postSweepOutstanding[u] - sweepable);
      }
    }
    // 3. After-sweep dividends. Same EBITDA cap. Cash available at this
    //    point is whatever remains after debt sweep.
    for (const row of afterSweepPhases) {
      if (t < row.startingYearAxisIdx || row.payoutRatio <= 0) continue;
      row.cashAvailableForDividendPerPeriod[t] = excess;
      if (excess <= 0) continue;
      const cumEb = row.cumulativeEbitdaPerPeriod[t] ?? 0;
      const cumDivPriorPeriods = row.totalDividends;
      const budget = Math.max(0, cumEb - cumDivPriorPeriods);
      row.ebitdaBudgetPerPeriod[t] = budget;
      const desired = excess * row.payoutRatio;
      const div = Math.min(desired, excess, budget);
      if (div <= 0) continue;
      row.dividendsPerPeriod[t] = (row.dividendsPerPeriod[t] ?? 0) + div;
      row.totalDividends += div;
      totalDividendsPerPeriod[t] += div;
      excess -= div;
    }
    const totalAllocatedThisPeriod = totalSweepPerPeriod[t] + totalDividendsPerPeriod[t];
    cumAllocation += totalAllocatedThisPeriod;
    adjustedClosingCash[t] = cashBefore - totalAllocatedThisPeriod;
  }

  // Adjusted debt outstanding = post-sweep eligible + raw non-eligible.
  const eligibleIds = new Set(eligible.map((e) => e.trancheId));
  const adjustedDebtOutstanding = new Array<number>(N).fill(0);
  for (const row of eligible) {
    for (let t = 0; t < N; t++) adjustedDebtOutstanding[t] += row.postSweepOutstanding[t] ?? 0;
  }
  for (const [trancheId, outArr] of facilityOutstanding) {
    if (eligibleIds.has(trancheId)) continue;
    for (let t = 0; t < N; t++) adjustedDebtOutstanding[t] += outArr[t] ?? 0;
  }

  // M4 Pass 2Y (2026-05-24): interest savings from sweep. For each
  // tranche, the per-period balance reduction (preSweep[t-1] −
  // postSweep[t-1]) × periodic rate is the interest payment that
  // doesn't happen on the post-sweep balance. Aggregate across
  // tranches; composer subtracts from totalInterestExpensed (P&L)
  // AND from cash interest paid (CF), symmetric BS adjustment.
  const interestSavingsPerPeriod = new Array<number>(N).fill(0);
  for (const row of eligible) {
    const tranche = tranches.find((t) => t.id === row.trancheId);
    if (!tranche) continue;
    const hasComponents = tranche.interbankRatePct !== undefined || tranche.creditSpreadPct !== undefined;
    const annualRatePct = hasComponents
      ? Math.max(0, (tranche.interbankRatePct ?? 0) + (tranche.creditSpreadPct ?? 0))
      : Math.max(0, tranche.interestRatePct ?? 0);
    const periodicRate = annualRatePct / 100;
    if (periodicRate <= 0) continue;
    for (let t = 1; t < N; t++) {
      const reduction = (row.preSweepOutstanding[t - 1] ?? 0) - (row.postSweepOutstanding[t - 1] ?? 0);
      if (reduction > 0) interestSavingsPerPeriod[t] += reduction * periodicRate;
    }
  }

  const cashSweep: CashSweepSnapshot = {
    axisLength: N,
    enabled: eligible.length > 0,
    minCashReserve,
    eligibleTranches: eligible,
    preSweepClosingCash: preSweepClosingCash.slice(0, N),
    excessAvailablePerPeriod,
    totalSweepPerPeriod,
    totalSweep: totalSweepPerPeriod.reduce((s, v) => s + v, 0),
    adjustedClosingCash,
    adjustedDebtOutstanding,
    interestSavingsPerPeriod,
    totalInterestSavings: interestSavingsPerPeriod.reduce((s, v) => s + v, 0),
  };
  const dividends: DividendSnapshot = {
    axisLength: N,
    enabled: beforeSweepPhases.length > 0 || afterSweepPhases.length > 0,
    beforeSweepPhases,
    afterSweepPhases,
    totalDividendsPerPeriod,
    totalDividends: totalDividendsPerPeriod.reduce((s, v) => s + v, 0),
  };
  return { cashSweep, dividends };
}

/** @deprecated M4 Pass 2T: use computeCashWaterfall. Thin shim for back-compat. */
export function computeCashSweep(args: {
  axisLength: number;
  projectStartYear: number;
  tranches: FinancingTranche[];
  phases: Phase[];
  facilityOutstanding: Map<string, number[]>;
  preSweepClosingCash: number[];
  minCashReserve: number;
}): CashSweepSnapshot {
  return computeCashWaterfall(args).cashSweep;
}

export function computeFundingGap(snap: ProjectFinancialsSnapshot): FundingGapSnapshot {
  const N = snap.axisLength;
  const yearLabels = snap.yearLabels;
  // M4 Pass 2S (2026-05-24): Method A reshaped to a 6-row pre-sales
  // waterfall per the user's reference layout:
  //   Capex
  //   Pre-sales gross
  //   − Inaccessible funds locked (escrow held)
  //   + Release of inaccessible funds (escrow release)
  //   Pre-sales net
  //   Funding requirement fulfilled by pre-sales = MIN(capex, preSalesNet)
  //   Funding gap = MAX(0, capex − preSalesNet)   ← floored, no surplus carry
  const capexPerPeriod = snap.financing.capex.perPeriod.exclLandInKind.slice(0, N);
  while (capexPerPeriod.length < N) capexPerPeriod.push(0);
  const preSalesGrossPerPeriod = snap.revenue.projectTotals.presalesCashPerPeriod.slice(0, N);
  while (preSalesGrossPerPeriod.length < N) preSalesGrossPerPeriod.push(0);
  const escrowHeldPerPeriod = snap.escrow.projectTotals.heldPerPeriod.slice(0, N);
  while (escrowHeldPerPeriod.length < N) escrowHeldPerPeriod.push(0);
  const escrowReleasePerPeriod = snap.escrow.projectTotals.releasePerPeriod.slice(0, N);
  while (escrowReleasePerPeriod.length < N) escrowReleasePerPeriod.push(0);
  const preSalesNetPerPeriod = zeros(N);
  const fulfilledByPreSalesPerPeriod = zeros(N);
  const methodAGapPerPeriod = zeros(N);
  for (let t = 0; t < N; t++) {
    preSalesNetPerPeriod[t] = (preSalesGrossPerPeriod[t] ?? 0)
      - (escrowHeldPerPeriod[t] ?? 0)
      + (escrowReleasePerPeriod[t] ?? 0);
  }
  // M4 Pass 2T-Fix (2026-05-24): pre-sales are LAGGED by one period in
  // the funding gap formula. Per Ahmad 2026-05-24 (Excel formula
  // =IF((I52-H57)>0,I52-H57,0)): "we are not received on day 1 of the
  // year" — so the cash available to fund THIS year's capex is the
  // PREVIOUS year's collected pre-sales (net), not this year's.
  // First-period gap = full capex (no prior-year pre-sales).
  for (let t = 0; t < N; t++) {
    const presLagged = t === 0 ? 0 : (preSalesNetPerPeriod[t - 1] ?? 0);
    fulfilledByPreSalesPerPeriod[t] = Math.min(capexPerPeriod[t] ?? 0, Math.max(0, presLagged));
    methodAGapPerPeriod[t] = Math.max(0, (capexPerPeriod[t] ?? 0) - presLagged);
  }
  const methodAGapCumulative = cumulative(methodAGapPerPeriod);
  const methodATotalGap = methodAGapPerPeriod.reduce((s, v) => s + v, 0);

  // Method B inputs. M4 Pass 2T-Fix #2 (2026-05-24): same one-period
  // lag as Method A — this year's capex is funded by LAST year's
  // operating cash flow (we don't receive ops cash on Day 1 of the
  // year). preFinancingNetCfLagged[t] = cashFromInv[t] + cashFromOps[t-1].
  // First period gap = full |cashFromInv[0]| (no prior-year ops).
  const cashFromOpsPerPeriod = snap.directCF.cashFromOperationsPerPeriod.slice(0, N);
  while (cashFromOpsPerPeriod.length < N) cashFromOpsPerPeriod.push(0);
  const cashFromInvPerPeriod = snap.directCF.cashFromInvestmentPerPeriod.slice(0, N);
  while (cashFromInvPerPeriod.length < N) cashFromInvPerPeriod.push(0);
  const preFinancingNetCfPerPeriod = zeros(N);
  const methodBGapPerPeriod = zeros(N);
  for (let t = 0; t < N; t++) {
    const opsLagged = t === 0 ? 0 : (cashFromOpsPerPeriod[t - 1] ?? 0);
    // Lagged net CF carried on the snapshot for display (and so the
    // verifier can pin the formula). Same-period net CF stays available
    // via the directCF arrays the UI also reads.
    preFinancingNetCfPerPeriod[t] = opsLagged + (cashFromInvPerPeriod[t] ?? 0);
    methodBGapPerPeriod[t] = Math.max(0, -preFinancingNetCfPerPeriod[t]);
  }
  const methodBGapCumulative = cumulative(methodBGapPerPeriod);
  const methodBTotalGap = methodBGapPerPeriod.reduce((s, v) => s + v, 0);

  // M4 Pass 2U (2026-05-24): Method 3 detailed waterfall.
  // Builds the per-period funding-gap view per Ahmad's reference layout:
  //   Opening Cash + CFO + CFI + Existing Equity + Existing Debt Drawdown
  //   − Existing Debt Repayment − Finance Cost Paid − Dividends (before
  //   sweep) = Cash Available Before New Debt; Net Cash Required =
  //   max(0, minCashReserve − Cash Available).
  const fin = snap.financing;
  // M4 Pass 2U-Fix (2026-05-24): existing equity + existing debt OPENING
  // are pre-axis events (they happened before axis t=0 and are ALREADY
  // captured in historicalOpeningCashTotal which seeds the waterfall's
  // opening cash). Adding them here as t=0 inflows would double-count.
  // The Method 3 waterfall now shows ONLY in-axis financing items.
  // For audit clarity we still surface the existing equity / existing
  // debt opening as a prior-year MEMO via the "Prior Year" column
  // (when the table renderer supports it; see follow-up pass).
  const existingEquityDrawdownPerPeriod = zeros(N);
  const existingDebtDrawdownPerPeriod = zeros(N);
  // existingPrincipalRepaid covers principal cash out on existing facilities.
  const existingDebtRepaymentPerPeriod = (fin.combined.existingPrincipalRepaid ?? new Array<number>(N).fill(0)).slice(0, N).map((v) => -v);
  while (existingDebtRepaymentPerPeriod.length < N) existingDebtRepaymentPerPeriod.push(0);
  // Finance cost paid: existing + new ops-period cash interest (negative).
  const financeCostPaidPerPeriod = (fin.combined.totalInterestExpensed ?? new Array<number>(N).fill(0)).slice(0, N).map((v) => -v);
  while (financeCostPaidPerPeriod.length < N) financeCostPaidPerPeriod.push(0);
  // IDC drawdown memo: capitalised interest growing debt (no cash move).
  const idcDrawdownPerPeriod = (fin.combined.totalInterestCapitalized ?? new Array<number>(N).fill(0)).slice(0, N);
  while (idcDrawdownPerPeriod.length < N) idcDrawdownPerPeriod.push(0);
  // Before-sweep dividends only (Phase 1 operational). After-sweep
  // dividends are driven by the cash sweep waterfall after debt is
  // repaid, so they're not part of the "Net Cash Required" pre-debt
  // gap; only the before-sweep payments reduce cash available for new
  // debt drawdown.
  const dividendsBeforeSweepPerPeriod = zeros(N);
  for (const row of snap.dividends.beforeSweepPhases) {
    for (let t = 0; t < N; t++) dividendsBeforeSweepPerPeriod[t] -= row.dividendsPerPeriod[t] ?? 0;
  }
  // Forward-walk the waterfall.
  const minCashReserve = Math.max(0, snap.cashSweep.minCashReserve ?? 0);
  const openingCashPerPeriod = zeros(N);
  const cashAvailableBeforeNewDebtPerPeriod = zeros(N);
  const netCashRequiredPerPeriod = zeros(N);
  let openingC = snap.bs.historicalOpeningCashTotal;
  for (let t = 0; t < N; t++) {
    openingCashPerPeriod[t] = openingC;
    const cashAvail = openingC
      + (cashFromOpsPerPeriod[t] ?? 0)
      + (cashFromInvPerPeriod[t] ?? 0)
      + (existingEquityDrawdownPerPeriod[t] ?? 0)
      + (existingDebtDrawdownPerPeriod[t] ?? 0)
      + (existingDebtRepaymentPerPeriod[t] ?? 0) // already negative
      + (financeCostPaidPerPeriod[t] ?? 0)       // already negative
      + (dividendsBeforeSweepPerPeriod[t] ?? 0); // already negative
    cashAvailableBeforeNewDebtPerPeriod[t] = cashAvail;
    const netReq = Math.max(0, minCashReserve - cashAvail);
    netCashRequiredPerPeriod[t] = netReq;
    // Assume new debt drawdown = netReq is sized to plug the gap; closing
    // cash thus = max(minCash, cashAvail).
    openingC = Math.max(minCashReserve, cashAvail);
  }
  const method3Waterfall: Method3WaterfallSnapshot = {
    axisLength: N,
    openingCashPerPeriod,
    cashFromOpsPerPeriod,
    cashFromInvPerPeriod,
    existingEquityDrawdownPerPeriod,
    existingDebtDrawdownPerPeriod,
    existingDebtRepaymentPerPeriod,
    financeCostPaidPerPeriod,
    idcDrawdownPerPeriod,
    dividendsBeforeSweepPerPeriod,
    cashAvailableBeforeNewDebtPerPeriod,
    minCashReserve,
    netCashRequiredPerPeriod,
    totalNetCashRequired: netCashRequiredPerPeriod.reduce((s, v) => s + v, 0),
  };

  return {
    axisLength: N,
    yearLabels,
    capexPerPeriod,
    preSalesGrossPerPeriod,
    escrowHeldPerPeriod,
    escrowReleasePerPeriod,
    preSalesNetPerPeriod,
    fulfilledByPreSalesPerPeriod,
    methodAGapPerPeriod,
    methodAGapCumulative,
    methodATotalGap,
    preSalesCashPerPeriod: preSalesGrossPerPeriod, // back-compat alias
    cashFromOpsPerPeriod,
    cashFromInvPerPeriod,
    preFinancingNetCfPerPeriod,
    methodBGapPerPeriod,
    methodBGapCumulative,
    methodBTotalGap,
    method3Waterfall,
  };
}

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

  // 2a. IDC snapshot (M4 Pass 2O, 2026-05-24). Allocation + per-asset
  // Op-Lease depreciation extracted into computeIdcSnapshot so Module 1
  // Financing can render the same data.
  const idcSnapshot = computeIdcSnapshot(
    { project, phases, assets, subUnits, parcels, landAllocationMode },
    financing,
    { axisLength: N, projectStartYear },
  );
  const byAssetIDC = idcSnapshot.byAsset;

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

  // 2c. IDC-driven depreciation for Operate / Lease assets: now embedded
  // on each AssetIDCRow via computeIdcSnapshot. Project totals available
  // on idcSnapshot.idcDepreciationPerPeriod + idcNbvPerPeriod.
  const idcDeprecProject = idcSnapshot.idcDepreciationPerPeriod;

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
          // P&L revenue is RECOGNISED revenue, not sale-value timing. For
          // pre-sales that means the recognition profile (handover / custom
          // / over-time), the SAME series the Unearned schedule drains;
          // using sale-value timing here made PAT disagree with Unearned,
          // so Direct (milestone cash) and Indirect (PAT + ΔUnearned)
          // diverged and the BS drifted. Post-sales (sales during
          // operation) recognise in-period, so their revenue == recognition.
          revRow[t] = (sell.presalesRecognitionPerPeriod[t] ?? 0) + (sell.postSalesRevenuePerPeriod[t] ?? 0);
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
    const idcRow = byAssetIDC.get(a.id);
    if (idcRow) {
      for (let t = 0; t < N; t++) daRow[t] += idcRow.depreciationPerPeriod[t] ?? 0;
    }
    // Capex per asset, per period. M4 Pass 2R-Fix (2026-05-24): switch
    // from uniform spread across construction window to the actual cost-
    // line distribution via computeAssetCost.breakdown.perPeriod.
    // Previously the uniform spread diverged from financing.capex's
    // cost-line-derived per-period values, leaking BS imbalance in
    // mid-axis years (totals matched, per-period didn't). Sell asset
    // Inventory build-up now mirrors the financing engine's capex curve
    // for that asset exactly. Projection rule matches fixed-assets-
    // resolvers::projectOntoAxis: local i=0 -> projIdx=offset-1
    // (Y0 lump for new-construction land); local i>=1 -> projIdx=offset+i-1.
    const phase = phases.find((p) => p.id === a.phaseId);
    if (phase && (a.strategy === 'Operate' || a.strategy === 'Lease' || a.isCompanion === true || a.strategy === 'Sell' || a.strategy === 'Sell + Manage')) {
      const breakdown = computeAssetCost(
        a, project, phase, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode,
        project.financing?.parcelFunding,
      );
      const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
      const offset = Math.max(0, phaseStartYear - projectStartYear);
      const per = breakdown.perPeriod ?? [];
      for (let i = 0; i < per.length; i++) {
        // M4 Pass 2W (2026-05-24): rescue Phase 1's i=0 lump (see capex.ts).
        const projIdx = i === 0 ? Math.max(0, offset - 1) : offset + i - 1;
        if (projIdx >= 0 && projIdx < N) {
          capex[projIdx] += per[i] ?? 0;
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
  // M4 Pass 2P (2026-05-24): CF Capex uses CASH-basis capex
  // (perPeriod.exclLandInKind), not inclAllLand. In-kind land is a
  // non-cash equity contribution recognised on BS as Land + Share
  // Capital simultaneously; it does NOT flow through Cash from
  // Investment. Previously this was the larger inclAllLand which
  // washed against in-kind equity in cashFromFin — both sides wrong,
  // net BS Cash accidentally right. Now both sides clean.
  const capexFull = financing.capex.perPeriod.exclLandInKind; // length = totalPeriods
  const capexProj = capexFull.slice(0, N);
  while (capexProj.length < N) capexProj.push(0);
  const cashFromInv = capexProj.map((v) => -v);

  // Financing flows from M1 (combined + equity).
  // M4 Pass 2P (2026-05-24): cash CF uses CASH equity only; in-kind
  // (land contributed in-kind by parcel owners) is a non-cash equity
  // recognition. Previously cashFromFin summed cash + in-kind, which
  // washed against an over-stated capex outflow (capex.inclAllLand)
  // — both sides individually wrong, BS Cash accidentally correct.
  // Now cashFromInv uses capex.exclLandInKind and cashFromFin uses
  // equityCashArr. Net BS Cash unchanged; both lines individually right.
  // equityDraws kept as the cumulative basis for Share Capital roll-up
  // (cash + in-kind both recognised on BS via Land + Share Capital).
  const equityCashArr = financing.equity.cashPerPeriod.slice(0, N);
  while (equityCashArr.length < N) equityCashArr.push(0);
  const equityInKindArr = financing.equity.inKindPerPeriod.slice(0, N);
  while (equityInKindArr.length < N) equityInKindArr.push(0);
  const equityExistingArr = financing.equity.existingEquityPerPeriod.slice(0, N);
  while (equityExistingArr.length < N) equityExistingArr.push(0);
  const equityDraws = equityCashArr.map((v, i) => v + (equityInKindArr[i] ?? 0));
  const debtDraws = financing.combined.totalDrawdown.slice(0, N);
  while (debtDraws.length < N) debtDraws.push(0);
  const debtRepays = financing.combined.totalPrincipalRepaid.slice(0, N);
  while (debtRepays.length < N) debtRepays.push(0);
  const interestPaidArr = financing.combined.debtServiceCash.slice(0, N).map((v, i) => Math.max(0, v - (debtRepays[i] ?? 0)));
  while (interestPaidArr.length < N) interestPaidArr.push(0);

  const cashFromFin = zeros(N);
  for (let t = 0; t < N; t++) {
    cashFromFin[t] = equityCashArr[t] + debtDraws[t] - debtRepays[t] - interestPaidArr[t];
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

  // M4 Pass 2S (2026-05-24): when cash sweep is enabled, fold sweep
  // amounts into the financing block as an additional debt repayment
  // line, so cashFromFin / closingCash reflect the sweep. This is
  // defined HERE (above directCF construction) but populated AFTER
  // the cashSweep snapshot is computed (further below in the function).
  // The directCF arrays referenced below pull from these adjusted vars.

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
  // Escrow = RESTRICTED CASH (an asset the developer still owns, released
  // back per construction milestones), NOT a liability. Building the
  // escrow balance therefore CONSUMES available cash (a working-capital
  // asset increase), exactly mirroring the Direct CF's netRevAdj
  // (= release − held = −escrowChange). Both methods now agree on escrow.
  const escrowBalance = escrow.projectTotals.cumulativeBalancePerPeriod.slice(0, N);
  const escrowChange = zeros(N);
  for (let t = 0; t < N; t++) escrowChange[t] = escrowBalance[t] - (t === 0 ? 0 : escrowBalance[t - 1]);

  const cashFromOpsIndirect = zeros(N);
  for (let t = 0; t < N; t++) {
    cashFromOpsIndirect[t] = pat[t] + da[t] + interestExpense[t]
      - arOperatingChange[t] - residentialArChange[t] - inventoryChange[t]
      + apChange[t] + unearnedChange[t] - escrowChange[t]
      - interestPaidArr[t]; // reverse the add-back of interest expense (we paid the real interest in cash)
  }

  // M4 (2026-05-25): the indirectCF object is built AFTER the cash
  // waterfall below, so it can mirror the same sweep + dividend
  // adjustments as the Direct CF (cashFromFinAdj / debtRepaysAdj /
  // dividends / closingCashAdj). Building it here, before the waterfall,
  // left Indirect closing diverging from Direct by the dividends + sweep.
  // cashFromOpsIndirect + all working-capital change arrays above stay
  // valid (operating cash is independent of the financing waterfall).

  // M4 Pass 2S (2026-05-24): Cash Sweep post-pass. Walks period-by-
  // period; for each period computes excess cash (closingCash − minCash)
  // and distributes across sweep-enabled tranches in priority order. The
  // adjusted closing cash (post-sweep) feeds BS Cash; adjusted facility
  // outstandings feed BS Debt. BS check stays balanced (both sides
  // reduce by the same total sweep amount each period). This iteration
  // does NOT re-derive future interest from the lower post-sweep
  // balance, so a tighter follow-up will close any residual.
  const facilityOutstandingForSweep = new Map<string, number[]>();
  for (const [trancheId, fac] of financing.facilities) {
    facilityOutstandingForSweep.set(trancheId, fac.outstanding.slice(0, N));
  }
  // M4 Pass 2T-Fix (2026-05-24): per-phase EBITDA = sum across assets in
  // the phase. Caps cumulative dividends per phase at cumulative EBITDA.
  const phaseEbitdaForWaterfall = new Map<string, number[]>();
  for (const phase of phases) {
    const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible !== false);
    const ebitdaArr = new Array<number>(N).fill(0);
    for (const a of phaseAssets) {
      const pl = perAssetPL.get(a.id);
      if (!pl) continue;
      for (let t = 0; t < N; t++) ebitdaArr[t] += pl.ebitdaPerPeriod[t] ?? 0;
    }
    phaseEbitdaForWaterfall.set(phase.id, ebitdaArr);
  }
  const waterfall = computeCashWaterfall({
    axisLength: N,
    projectStartYear,
    tranches: financingTranches,
    phases,
    facilityOutstanding: facilityOutstandingForSweep,
    preSweepClosingCash: closingCash,
    minCashReserve: Math.max(0, (project.financing ?? DEFAULT_PROJECT_FINANCING_CONFIG).minimumCashReserve ?? 0),
    phaseEbitdaPerPeriod: phaseEbitdaForWaterfall,
  });
  const cashSweep = waterfall.cashSweep;
  const dividends = waterfall.dividends;

  // Build adjusted Direct CF arrays. Sweep adds to debt repayment;
  // dividends become their own financing-block line. Both reduce
  // cashFromFinancing / netCashFlow / closingCash.
  const sweepPerPeriodPos = cashSweep.totalSweepPerPeriod.slice(0, N);
  while (sweepPerPeriodPos.length < N) sweepPerPeriodPos.push(0);
  const dividendsPerPeriodPos = dividends.totalDividendsPerPeriod.slice(0, N);
  while (dividendsPerPeriodPos.length < N) dividendsPerPeriodPos.push(0);
  const debtRepaysAdj = debtRepays.map((v, i) => v + (sweepPerPeriodPos[i] ?? 0));
  const cashFromFinAdj = cashFromFin.map((v, i) => v - (sweepPerPeriodPos[i] ?? 0) - (dividendsPerPeriodPos[i] ?? 0));
  const netCfAdj = netCf.map((v, i) => v - (sweepPerPeriodPos[i] ?? 0) - (dividendsPerPeriodPos[i] ?? 0));
  // Direct CF closing = explicit running sum of the Direct net cash flow
  // (every line item summed period by period), seeded with pre-existing
  // operational cash. This is the single source of truth for BS Cash, so
  // the statement's own lines provably add up to its closing balance and
  // the BS ties to it. With sweep / dividends enabled this equals the
  // waterfall's adjustedClosingCash, because netCfAdj nets out the same
  // per-period sweep + dividend amounts the waterfall applied.
  const openingCashAdj = zeros(N);
  const closingCashAdj = zeros(N);
  {
    let runC = historicalOpeningCashTotal;
    for (let t = 0; t < N; t++) {
      openingCashAdj[t] = runC;
      runC += netCfAdj[t] ?? 0;
      closingCashAdj[t] = runC;
    }
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
    equityDrawdownPerPeriod: equityCashArr,
    equityInKindDrawdownPerPeriod: equityInKindArr,
    debtDrawdownPerPeriod: debtDraws,
    debtRepaymentPerPeriod: debtRepaysAdj.map((v) => -v),
    interestPaidPerPeriod: interestPaidArr.map((v) => -v),
    dividendsPaidPerPeriod: dividendsPerPeriodPos.map((v) => -v),
    cashFromFinancingPerPeriod: cashFromFinAdj,
    netCashFlowPerPeriod: netCfAdj,
    openingCashPerPeriod: openingCashAdj,
    closingCashPerPeriod: closingCashAdj,
  };

  // Indirect CF: each subtotal is summed from the Indirect method's OWN
  // line items (CFO from the working-capital bridge; CFI and CFF share
  // the same financing/investing flows as Direct because those ARE the
  // same cash movements). The closing balance below is an INDEPENDENT
  // running sum of the Indirect net cash flow, NOT a copy of the Direct
  // closing. Both methods land on the same balance only because both are
  // computed correctly: Direct net = revenue received − cash costs;
  // Indirect net = PAT + non-cash add-backs − working-capital build.
  // Any divergence between the two closing curves is therefore a real
  // signal that the operating-cash bridge (CFO_indirect vs CFO_direct,
  // pinned by verifier H) has drifted, not an artefact of linking.
  const indirectNetCf = cashFromOpsIndirect.map((v, i) => v + cashFromInv[i] + cashFromFinAdj[i]);
  const indirectOpeningCash = zeros(N);
  const indirectClosingCash = zeros(N);
  {
    let runI = historicalOpeningCashTotal;
    for (let t = 0; t < N; t++) {
      indirectOpeningCash[t] = runI;
      runI += indirectNetCf[t] ?? 0;
      indirectClosingCash[t] = runI;
    }
  }
  const indirectCF: ProjectIndirectCF = {
    patPerPeriod: pat,
    daPerPeriod: da,
    interestExpensePerPeriod: interestExpense,
    changeInArPerPeriod: arOperatingChange.map((v, i) => -(v + residentialArChange[i])),
    changeInInventoryPerPeriod: inventoryChange.map((v) => -v),
    changeInApPerPeriod: apChange,
    changeInUnearnedPerPeriod: unearnedChange,
    changeInEscrowPerPeriod: escrowChange.map((v) => -v),
    cashFromOperationsPerPeriod: cashFromOpsIndirect,
    capexPerPeriod: capexProj.map((v) => -v),
    cashFromInvestmentPerPeriod: cashFromInv,
    // CASH equity only on CF. In-kind kept as a memo field.
    equityDrawdownPerPeriod: equityCashArr,
    equityInKindDrawdownPerPeriod: equityInKindArr,
    debtDrawdownPerPeriod: debtDraws,
    debtRepaymentPerPeriod: debtRepaysAdj.map((v) => -v),
    interestPaidPerPeriod: interestPaidArr.map((v) => -v),
    dividendsPaidPerPeriod: dividendsPerPeriodPos.map((v) => -v),
    cashFromFinancingPerPeriod: cashFromFinAdj,
    netCashFlowPerPeriod: indirectNetCf,
    openingCashPerPeriod: indirectOpeningCash,
    closingCashPerPeriod: indirectClosingCash,
  };

  // 7. Balance Sheet
  // Assets
  // M4 Pass 2T: closingCashAdj already incorporates sweep + dividends.
  const cashPerPeriod = closingCashAdj;
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
  for (let t = 0; t < N; t++) totalFA[t] = nbvArr[t] + landArr[t] + (idcSnapshot.idcNbvPerPeriod[t] ?? 0);
  // Escrow = restricted cash (asset). Operating cash (cashPerPeriod) was
  // already reduced by escrow held via the CF; the held amount now sits
  // here as a restricted-cash asset, so total cash-side assets are
  // unaffected by escrow and the BS stays balanced (no escrow liability).
  const escrowRestrictedCash = escrowBalance;
  const totalCA = zeros(N);
  for (let t = 0; t < N; t++) totalCA[t] = cashPerPeriod[t] + escrowRestrictedCash[t] + arPerPeriod[t] + residentialReceivables[t] + inventoryArr[t];
  const totalAssets = zeros(N);
  for (let t = 0; t < N; t++) totalAssets[t] = totalFA[t] + totalCA[t];

  // Liabilities (escrow is NOT a liability; it is restricted cash above).
  const apClosing = ap.projectTotals.closingApPerPeriod.slice(0, N);
  const unearnedClosing = zeros(N);
  for (const bundle of byAssetSchedules.values()) {
    for (let t = 0; t < N; t++) unearnedClosing[t] += bundle.unearned.perPeriod[t] ?? 0;
  }
  const debtOutstanding = zeros(N);
  if (cashSweep.enabled) {
    // M4 Pass 2S: use sweep-adjusted outstandings.
    for (let t = 0; t < N; t++) debtOutstanding[t] = cashSweep.adjustedDebtOutstanding[t] ?? 0;
  } else {
    for (const fac of financing.facilities.values()) {
      // M4 Pass 2N-Fix (2026-05-21): fac.outstanding is project-axis-
      // indexed (length = N), where outstanding[t] is the CLOSING balance
      // at end of year t.
      for (let t = 0; t < N; t++) debtOutstanding[t] += fac.outstanding[t] ?? 0;
    }
  }
  const totalCL = zeros(N);
  for (let t = 0; t < N; t++) totalCL[t] = apClosing[t] + unearnedClosing[t];
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
  const reserveTransferArr = zeros(N); // M4 Pass 2P: per-period transfer
  // M4 Pass 2T (2026-05-24): dividends from the cash-waterfall flow
  // through to BS / RE. The waterfall already took dividends out of
  // closingCash; here we mirror it on the equity side so BS balances.
  const dividendsArr = dividends.totalDividendsPerPeriod.slice(0, N);
  while (dividendsArr.length < N) dividendsArr.push(0);
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
    runningRetained += pat[t] - allowed - (dividendsArr[t] ?? 0);
    reserveArr[t] = runningReserve;
    reserveTransferArr[t] = allowed;
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
    escrowRestrictedCashPerPeriod: escrowRestrictedCash,
    debtOutstandingPerPeriod: debtOutstanding,
    totalCurrentLiabilitiesPerPeriod: totalCL,
    totalLiabilitiesPerPeriod: totalLiab,
    shareCapitalPerPeriod: shareCapital,
    statutoryReservePerPeriod: reserveArr,
    retainedEarningsPerPeriod: retained,
    totalEquityPerPeriod: totalEquity,
    statutoryReserveTransferPerPeriod: reserveTransferArr,
    dividendsPerPeriod: dividendsArr,
    totalLiabilitiesAndEquityPerPeriod: totalLandE,
    bsDifferencePerPeriod: bsDiff,
    historicalOpeningCashTotal,
  };

  // ── BS reconciliation bridge (2026-05-25) ──────────────────────────
  // Δ(BS diff) = NetCashFlow − Δ(Liab+Equity) + Δ(non-cash Assets), an
  // exact identity. For t >= 1 every opening cancels; the t = 0 column
  // carries pre-axis openings (existing debt / equity / fixed assets).
  // unexplainedPerPeriod must be ~0; a nonzero value means a BS line is
  // missing from this bridge (a coding gap to fix), not a wiring leak.
  const reserveRetained = reserveArr.map((v, i) => v + (retained[i] ?? 0));
  const depAdd0 = fixedAssets.projectTotals.depreciable.additionsPerPeriod[0] ?? 0;
  const depDep0 = fixedAssets.projectTotals.depreciable.depreciationPerPeriod[0] ?? 0;
  const landAdd0 = fixedAssets.projectTotals.land.additionsPerPeriod[0] ?? 0;
  const openNbv = (nbvArr[0] ?? 0) - depAdd0 + depDep0; // pre-axis opening NBV
  const openLand = (landArr[0] ?? 0) - landAdd0;          // pre-axis opening Land
  const idcNbvP = idcSnapshot.idcNbvPerPeriod;
  const deltaWithOpen = (arr: number[], t: number, open: number): number =>
    (arr[t] ?? 0) - (t === 0 ? open : (arr[t - 1] ?? 0));
  const recoNetCf = directCF.netCashFlowPerPeriod.slice(0, N);
  while (recoNetCf.length < N) recoNetCf.push(0);
  const dDebt = zeros(N), dShare = zeros(N), dRR = zeros(N), dAp = zeros(N), dUn = zeros(N), dEsc = zeros(N);
  const dAr = zeros(N), dResAr = zeros(N), dInv = zeros(N), dNbv = zeros(N), dLand = zeros(N), dIdc = zeros(N);
  const bsDiffChange = zeros(N), unexplained = zeros(N);
  for (let t = 0; t < N; t++) {
    dDebt[t] = deltaWithOpen(debtOutstanding, t, financing.existing.debtOutstandingTotal);
    dShare[t] = deltaWithOpen(shareCapital, t, priorEquityTotal);
    dRR[t] = deltaWithOpen(reserveRetained, t, 0);
    dAp[t] = deltaWithOpen(apClosing, t, 0);
    dUn[t] = deltaWithOpen(unearnedClosing, t, 0);
    // Escrow is a restricted-cash ASSET (not a liability).
    dEsc[t] = deltaWithOpen(escrowRestrictedCash, t, 0);
    dAr[t] = deltaWithOpen(arPerPeriod, t, 0);
    dResAr[t] = deltaWithOpen(residentialReceivables, t, 0);
    dInv[t] = deltaWithOpen(inventoryArr, t, 0);
    dNbv[t] = deltaWithOpen(nbvArr, t, openNbv);
    dLand[t] = deltaWithOpen(landArr, t, openLand);
    dIdc[t] = deltaWithOpen(idcNbvP, t, 0);
    bsDiffChange[t] = (bsDiff[t] ?? 0) - (t === 0 ? 0 : (bsDiff[t - 1] ?? 0));
    const bridged = (recoNetCf[t] ?? 0)
      - (dDebt[t] + dShare[t] + dRR[t] + dAp[t] + dUn[t])
      + (dAr[t] + dResAr[t] + dInv[t] + dNbv[t] + dLand[t] + dIdc[t] + dEsc[t]);
    unexplained[t] = bsDiffChange[t] - bridged;
  }
  const bsReconciliation: BsReconciliation = {
    bsDifferencePerPeriod: bsDiff,
    bsDifferenceChangePerPeriod: bsDiffChange,
    netCashFlowPerPeriod: recoNetCf,
    deltaDebtPerPeriod: dDebt,
    deltaShareCapitalPerPeriod: dShare,
    deltaReserveRetainedPerPeriod: dRR,
    deltaApPerPeriod: dAp,
    deltaUnearnedPerPeriod: dUn,
    deltaEscrowPerPeriod: dEsc,
    deltaArPerPeriod: dAr,
    deltaResidentialReceivablesPerPeriod: dResAr,
    deltaInventoryPerPeriod: dInv,
    deltaNbvPerPeriod: dNbv,
    deltaLandPerPeriod: dLand,
    deltaIdcNbvPerPeriod: dIdc,
    unexplainedPerPeriod: unexplained,
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
    cashSweep,
    dividends,
    bsReconciliation,
  };
}
