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
import { computeFinancingResult, type FinancingComputation, type FundingGapInputs } from '@/src/core/calculations/financing';
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
import { collectionsForAsset, collectionsTotalForAsset, phaseLocalToProjectIndex } from '@/src/core/calculations/capexPhasing';
import type { Module1Store } from './state/module1-store';
import type { Asset, Phase, FinancingTranche } from './state/module1-types';
import { DEFAULT_PROJECT_FINANCING_CONFIG } from './state/module1-types';
import { resolveFundTerms } from './fundTerms';
import { computeFundFeeSchedule, emptyFundFeeSchedule, resolveFacilityLimit, resolveFundSize, type FundFeeSchedule } from './fundFees';

/** Lifetime sum of a per-period series. Local to the fund-size resolution. */
const sumSeries = (a: readonly number[] | undefined): number =>
  (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

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
  /** POSITIVE cost magnitude. Note this is the OPPOSITE sign to the
   *  project-level `DirectCashFlow.capexPerPeriod`, which is negative. */
  capexPerPeriod: number[];
  /** The slice of `capexPerPeriod` that is land contributed IN KIND, and is
   *  therefore NOT a cash outflow (it is recognised as equity in kind on the
   *  other side of the Balance Sheet). POSITIVE, same sign and same axis as
   *  `capexPerPeriod`, so the CASH capex of an asset is
   *  `capexPerPeriod - landInKindPerPeriod`.
   *
   *  Kept as its own series rather than netted out of `capexPerPeriod`
   *  because the asset's CARRYING value (inventory, fixed assets, per-asset
   *  returns, the IC report) is the full cost including in-kind land; only
   *  the CASH FLOW statement wants the cash slice. Summed across every
   *  visible asset this equals `financing.capex.perPeriod.landInKind`, which
   *  is what lets the Cash Flow's asset rows foot to its Total Capex. */
  landInKindPerPeriod: number[];
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
  /** EBITDA, struck AFTER the fund fees (2026-08-05, reference alignment).
   *  Identical to `ebitdaBeforeFundFeesPerPeriod` on every standalone project,
   *  because the fees are then all zero. */
  ebitdaPerPeriod: number[];
  /** Revenue less cost of sales less operating expenses, BEFORE fund fees.
   *  The phase-level P&L uses this: fund fees are project level and carry no
   *  phase allocation, so a per-phase EBITDA cannot be struck after them. */
  ebitdaBeforeFundFeesPerPeriod: number[];
  /** Fund layer Step 3 (2026-08-04): total fund fees charged this period.
   *  Positive = an expense. Zero on every standalone project, which is every
   *  project with the fund toggle off. Totals into the P&L's "Total Fund
   *  Management Fee" line, ABOVE EBITDA (2026-08-05, reference alignment), so
   *  it reduces EBITDA and everything below it. */
  fundFeesPerPeriod: number[];
  /** DEPRECATED ALIAS of `ebitdaPerPeriod`, retained so a caller written
   *  against Step 3 still finds the after-fee figure under the name it used.
   *  EBITDA is now struck after the fees, so the two are the same array of
   *  values by construction. Prefer `ebitdaPerPeriod`. */
  ebitdaAfterFundFeesPerPeriod: number[];
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
  /** Fund layer Step 3 (2026-08-04): fund fees PAID, negative. Paid in the
   *  period charged (no payable), which is what keeps the balance sheet
   *  balanced by construction: the expense reduces retained earnings through
   *  PAT and the cash reduces by the same amount in the same period. Zero on
   *  every project with the fund toggle off. This line is inside operating
   *  cash, which is how the fee reaches the funding requirement. */
  fundFeesPaidPerPeriod: number[];         // negative
  taxPaidPerPeriod: number[];              // negative
  cashFromOperationsPerPeriod: number[];
  // Investment
  capexPerPeriod: number[];                // negative
  /** Debt drawn to fund CAPEX (2026-08-18). Positive. */
  capexDrawdownPerPeriod: number[];
  /** Debt drawn to fund IDC. Positive. Sums with the above to debtDrawdown. */
  idcDrawdownPerPeriod: number[];
  /** The FULL IDC charge arising in a period with construction spend, whether
   *  settled in cash or funded by drawing debt. Positive magnitude. This is what
   *  the FCFE chain deducts; the drawdown is added back beside it. */
  idcAccruedPerPeriod: number[];
  /** The CASH half of the IDC charge: what actually left the bank. Positive.
   *  `idcAccrued = idcPaid + idcDrawdown`. */
  idcPaidPerPeriod: number[];
  /** Interest arising with no construction spend: the operating finance cost.
   *  Positive magnitude. `idcPaid + operatingInterestPaid = interestPaid`. */
  operatingInterestPaidPerPeriod: number[];
  /** THE CASH EQUITY DRAW, SPLIT BY WHAT IT IS (2026-08-19). Development is
   *  the equity share of the selected method's requirement; the management fee
   *  is drawn from equity directly, outside the ratio, when the fund terms say
   *  so. The two sum to `equityDrawdownPerPeriod` exactly and are the engine's
   *  own split (`financing.equity.developmentPerPeriod` /
   *  `managementFeePerPeriod`), not an estimate. */
  equityDevelopmentDrawdownPerPeriod: number[];
  equityManagementFeeDrawdownPerPeriod: number[];
  /** True when `fundTerms.managementFeeFunding === 'equity'`. */
  managementFeeFundedByEquity: boolean;
  cashFromInvestmentPerPeriod: number[];
  // Financing
  /** M4 Pass 2P (2026-05-24): cash equity only, what actually moves
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
  costOfSalesAddBackPerPeriod: number[];   // +CoS add-back (capex funded via investing CFI, so CoS is non-cash in operations)
  changeInApPerPeriod: number[];           // +ΔAP
  changeInUnearnedPerPeriod: number[];     // +ΔUnearned (liability)
  changeInEscrowPerPeriod: number[];       // −ΔEscrow (restricted-cash asset build consumes cash)
  cashFromOperationsPerPeriod: number[];
  capexPerPeriod: number[];
  /** Same four IDC / drawdown series the direct method carries, so a reader
   *  switching methods sees the same lines (2026-08-18). */
  capexDrawdownPerPeriod: number[];
  idcDrawdownPerPeriod: number[];
  idcAccruedPerPeriod: number[];
  idcPaidPerPeriod: number[];
  operatingInterestPaidPerPeriod: number[];
  /** THE CASH EQUITY DRAW, SPLIT BY WHAT IT IS (2026-08-19). Development is
   *  the equity share of the selected method's requirement; the management fee
   *  is drawn from equity directly, outside the ratio, when the fund terms say
   *  so. The two sum to `equityDrawdownPerPeriod` exactly and are the engine's
   *  own split (`financing.equity.developmentPerPeriod` /
   *  `managementFeePerPeriod`), not an estimate. */
  equityDevelopmentDrawdownPerPeriod: number[];
  equityManagementFeeDrawdownPerPeriod: number[];
  /** True when `fundTerms.managementFeeFunding === 'equity'`. */
  managementFeeFundedByEquity: boolean;
  cashFromInvestmentPerPeriod: number[];
  /** M4 Pass 2P (2026-05-24): cash equity only, what actually moves
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
  /** M4 Pass 2O: Operate/Lease only, depreciation derived from this
   *  asset's IDC additions (straight-line over useful life from handover).
   *  Zero for Sell / Sell+Manage (IDC there unwinds through CoS instead). */
  depreciationPerPeriod: number[];
  /** M4 Pass 2O: Operate/Lease only, closing NBV of capitalised IDC. */
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
  fundingMode: 'debt_drawdown' | 'cash' | 'conditional';
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
  /** Fund layer Step 3 (2026-08-04): the per-fee schedule this snapshot was
   *  computed with, including the basis each fee charged on. `active: false`
   *  on every standalone project, with every array zero. Surfaced so a reader
   *  can see WHAT was charged, not only the total the P&L shows. */
  fundFees: FundFeeSchedule;
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
    // 2026-08-18: constants, not settings. One treatment: IDC is always
    // capitalised into asset cost and always funded cash-first, borrowing
    // only the shortfall. Reported on the snapshot so the panels keep a
    // field to render, and so a stale saved toggle can never resurface.
    capitalize: true,
    fundingMode: 'conditional' as const,
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
 *   Method A, Capex vs Pre-Sales (gross feasibility view):
 *     gap[t] = capex[t] − (preSalesCash[t] − escrowHeld[t])
 *     i.e. cash capex less the portion of pre-sales actually
 *     available (Pre-Sales received minus the amount held in escrow).
 *     Simple. Ignores opex, AR, AP, tax, interest. Useful as a
 *     sanity check + a baseline for early feasibility.
 *
 *   Method B, Pre-financing CF deficit (full waterfall):
 *     gap[t] = −(cashFromOps[t] + cashFromInv[t]) when negative
 *              0                                  otherwise.
 *     I.e. whatever the operations + investing CF can't fund itself
 *     becomes the period's funding requirement. Accounts for opex,
 *     AR/AP timing, tax, interest paid, escrow movement, the
 *     "true" feasibility gap.
 *
 * Both methods produce per-period + cumulative + grand total. The
 * UI's "Funding Gap" sub-tab in Module 1 Financing renders them
 * side-by-side. Wiring these gaps into actual debt drawdown sizing
 * (Methods 2 + 3 in computeFundingRequirement) is a follow-up pass.
 */
/**
 * M4 Pass 2U (2026-05-24): Method 3 detailed waterfall snapshot.
 * Per-period cash waterfall arriving at "Net Cash Required", the
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
  /** Cash finance cost per period (negative): the FULL charge, IDC and
   *  operating, exactly what the Direct CF pays. NOT in the sizing (2026-08-18g),
   *  carried so the cash waterfall below the sizing block can pay it. */
  financeCostPaidPerPeriod: number[];
  // ── THE REFERENCE FUNDING SCHEDULE (2026-08-19, Schedules R105 to R124) ──
  /** The fund management fee charged in the period, POSITIVE magnitude. */
  fundFeesPerPeriod: number[];
  /** True when the fund terms fund the fee by a direct equity draw. */
  feeFundedByEquity: boolean;
  /** R111 total operating inflows AS SIZED: cash from operations, with the fee
   *  ADDED BACK when it is equity funded (it is then not a deficit driver). */
  operatingInflowsPerPeriod: number[];
  /** R112: operating inflows less cash capex. */
  preFinancingNetCashPerPeriod: number[];
  /** THE FEE EQUITY DRAW (positive). Zero on the deficit path. On the equity
   *  path it is drawn ONLY while construction is spending (the R116 gate) and
   *  ONLY as far as keeps cash at the minimum after the base funding has been
   *  drawn: `min(fee, max(0, min - (cash after base funding - fee)))`. After
   *  construction the fee is paid from cash. */
  managementFeeEquityDrawPerPeriod: number[];
  /** Cash above the minimum AFTER the base funding and the fee draw, BEFORE any
   *  finance cost: the pre-interest headroom the IDC may be paid from (R123). */
  idcHeadroomPerPeriod: number[];
  /** Cash after funding, before finance cost, sweep and dividends. */
  closingCashAfterFundingPerPeriod: number[];
  /** Memo line: per-period IDC capitalised = new debt drawdown to fund
   *  the construction interest. Does NOT move cash (interest is added
   *  to debt balance directly). Shown for transparency. */
  idcDrawdownPerPeriod: number[];
  /** Conditional IDC (2026-06-02): per-period construction interest PAID
   *  IN CASH (idcConfig.fundingMode === 'conditional'). Zero under the
   *  default debt-drawdown mode. This is a real cash outflow already
   *  reflected in financeCostPaidPerPeriod / Direct CF; surfaced
   *  separately so the Funding Requirement schedule can show the
   *  cash-vs-debt split of IDC. */
  idcCashPaidPerPeriod: number[];
  /** Before-sweep dividends paid per period (negative, Phase 1
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
 * the lower post-sweep balance, the snapshot's interestAccrued curve
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
  /** Cash available at the START of each period's distribution waterfall =
   *  preSweepClosingCash[t] − cumulative prior-period (sweep + dividend)
   *  allocations. This is the figure the period's min-cash floor + excess
   *  are measured against, so excessAvailablePerPeriod = max(0, this − min).
   *  Use it (not preSweepClosingCash) for the "cash before sweep" row so the
   *  schedule foots once any earlier period has swept / paid dividends. */
  cashBeforeAllocationPerPeriod: number[];
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
   *  DISPLAY-ONLY (V1 limitation, see the CashSweepSnapshot doc above): the
   *  composer does NOT yet re-derive P&L / CF interest from the lower
   *  post-sweep balance, so this is surfaced as an informational memo and is
   *  not folded into totalInterestExpensed or cash interest paid. */
  interestSavingsPerPeriod: number[];
  totalInterestSavings: number;
}

/**
 * M4 Pass 2T (2026-05-24): Dividend snapshot. Driven by per-phase
 * Phase.dividendPolicy. Per period:
 *   excess = preSweepClosingCash − minCashReserve − cumPriorAllocations
 *   1. before_sweep dividends paid first (priority over cash sweep,  *      typical for operational phases that already produce cash and
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
  /** 2026-06-01: dividend sizing basis (see Phase.dividendPolicy.mode). */
  mode: 'cash_above_min' | 'pct_of_ebitda';
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
  /** Per-period total dividends (sum across all phases, before + after,
   *  INCLUDING any terminal 100% payout). */
  totalDividendsPerPeriod: number[];
  totalDividends: number;
  /** Terminal 100% payout per period (2026-06-02): the liquidating
   *  distribution booked in the exit period that releases all cash above the
   *  opening-cash floor (no minimum cash retained at exit). Already included
   *  in totalDividendsPerPeriod; surfaced separately for transparency. */
  terminalPayoutPerPeriod: number[];
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
  /** Cash sweep (2026-06-02): when the sweep has ALREADY been applied in the
   *  financing engine (pass-2 of the two-pass), this maps trancheId → the
   *  engine's sweep-repaid per period. computeCashWaterfall then does NOT
   *  re-sweep: it reads these amounts + the (already post-sweep)
   *  facilityOutstanding for display, and only the dividends consume excess.
   *  Absent => legacy overlay behaviour (the waterfall computes the sweep). */
  engineSweepByTranche?: Map<string, number[]>;
  /** Terminal 100% payout (2026-06-02). When dividends are enabled, in the
   *  terminalPayoutPeriod the model retains NO minimum cash and distributes
   *  all cash above terminalCashFloor (the opening-cash seed) as a liquidating
   *  dividend, so the cash-sweep dividend ties to FCFE / Distributed Equity in
   *  the Returns module. Undefined period => no terminal payout. */
  terminalPayoutPeriod?: number;
  terminalCashFloor?: number;
  /** Project-level dividend start year (2026-06-02): the first year ANY
   *  dividend is distributed, applied to every phase. Unset => default to the
   *  year after the last construction period ends. */
  dividendStartYear?: number;
  /** Project-level dividend policy (2026-06-02): one enabled / payoutRatio /
   *  mode applied to EVERY phase. When provided it is authoritative; when
   *  undefined the engine falls back to the legacy per-phase
   *  Phase.dividendPolicy (back-compat). */
  projectDividendPolicy?: { enabled?: boolean; payoutRatio?: number; mode?: 'cash_above_min' | 'pct_of_ebitda' };
  /** Project-level cash-sweep settings (2026-06-03): one Starting Year + Sweep
   *  Ratio for every sweep loan (precedence over the legacy per-tranche cfg). */
  projectSweep?: { startingYear?: number; sweepRatioPct?: number };
}): { cashSweep: CashSweepSnapshot; dividends: DividendSnapshot } {
  const { axisLength: N, projectStartYear, tranches, phases, facilityOutstanding, preSweepClosingCash, minCashReserve, phaseEbitdaPerPeriod, engineSweepByTranche, terminalPayoutPeriod, terminalCashFloor, dividendStartYear, projectDividendPolicy, projectSweep } = args;
  const sweepInEngine = engineSweepByTranche !== undefined;

  // Build sweep-eligible tranches.
  const eligible: CashSweepRow[] = [];
  for (const t of tranches) {
    const cfg = t.cashSweepConfig ?? {};
    const useSweep = (t.repaymentMethod === 'cash_sweep') || (t.repaymentMethod === 'cashsweep_from_period') || (t.repaymentMethod === 'cashsweep_min_cash') || (cfg.enabled === true);
    if (!useSweep) continue;
    const fac = facilityOutstanding.get(t.id);
    if (!fac) continue;
    const phase = phases.find((p) => p.id === t.phaseId);
    const phaseStartYear = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const cp = Math.max(0, phase?.constructionPeriods ?? 0);
    const defaultStartingYear = phaseStartYear + cp;
    // Project-level cash-sweep settings win over the legacy per-tranche cfg.
    const startingYear = projectSweep?.startingYear ?? cfg.startingYear ?? defaultStartingYear;
    const startingYearAxisIdx = Math.max(0, Math.min(N - 1, startingYear - projectStartYear));
    const priority = cfg.priority ?? 100;
    const sweepRatio = Math.max(0, Math.min(1, (projectSweep?.sweepRatioPct ?? cfg.sweepRatio ?? 100) / 100));
    // When the engine already swept, `fac` IS the post-sweep balance; the
    // sweep amounts come from the engine and the pre-sweep balance is the
    // post-sweep balance plus the cumulative sweep already applied.
    const engSweep = engineSweepByTranche?.get(t.id);
    let preSweepOutstanding: number[];
    let postSweepOutstanding: number[];
    let sweepPerPeriod: number[];
    if (sweepInEngine && engSweep) {
      postSweepOutstanding = fac.slice(0, N);
      sweepPerPeriod = engSweep.slice(0, N);
      while (sweepPerPeriod.length < N) sweepPerPeriod.push(0);
      // Pre-sweep opening = the balance entering THIS period before its own
      // sweep = post-sweep closing + this period's sweep. (Bug fix 2026-06-02:
      // previously added the CUMULATIVE sweep, so a fully-repaid tranche kept
      // showing its original opening forever instead of rolling to zero.)
      preSweepOutstanding = new Array<number>(N).fill(0);
      for (let t2 = 0; t2 < N; t2++) preSweepOutstanding[t2] = (postSweepOutstanding[t2] ?? 0) + (sweepPerPeriod[t2] ?? 0);
    } else {
      preSweepOutstanding = fac.slice(0, N);
      postSweepOutstanding = fac.slice(0, N);
      sweepPerPeriod = new Array<number>(N).fill(0);
    }
    eligible.push({
      trancheId: t.id,
      trancheName: t.name,
      origin: t.origin === 'existing' ? 'existing' : 'new',
      priority,
      startingYear,
      startingYearAxisIdx,
      sweepRatio,
      preSweepOutstanding,
      postSweepOutstanding,
      sweepPerPeriod,
      totalSwept: sweepPerPeriod.reduce((s, v) => s + v, 0),
    });
  }
  // Sweep order (2026-06-02): EXISTING loans are repaid before NEW ones;
  // within each origin, lower priority number is paid first. Matches the
  // user's "first loan priority then new" rule and the conditional-IDC
  // budget-consumption order in the financing orchestrator.
  eligible.sort((a, b) =>
    a.origin === b.origin
      ? a.priority - b.priority
      : a.origin === 'existing' ? -1 : 1,
  );

  // Dividends are paid AFTER debt (2026-06-02, per user): every phase pays
  // after the cash sweep, so debt is always serviced before any distribution
  // and the surplus above the minimum reserve is what's distributed (with the
  // exit year paying 100%). The before-sweep tier is retired; the legacy
  // per-phase policy.priority field stays on schema for back-compat but is
  // ignored. (`_phase` kept for signature parity with buildPhaseRow.)
  const statusPriority = (_phase: Phase): 'before_sweep' | 'after_sweep' => 'after_sweep';
  // Project-level dividend start year (2026-06-02): one start year for every
  // phase. Default = the year after the LAST construction period ends (the
  // latest first-operating-year across phases), so dividends begin only once
  // the whole development is operational. The user can override it.
  const projectDividendDefaultYear = Math.max(
    projectStartYear,
    ...phases.map((ph) => {
      const psy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : projectStartYear;
      const cp = Math.max(0, ph.constructionPeriods ?? 0);
      return ph.status === 'operational' ? projectStartYear : psy + cp;
    }),
  );
  const effectiveDividendStartYear = dividendStartYear ?? projectDividendDefaultYear;
  const buildPhaseRow = (phase: Phase, priority: 'before_sweep' | 'after_sweep'): DividendPhaseRow | null => {
    // Project-level policy is authoritative when provided (one rule for every
    // phase); otherwise fall back to the legacy per-phase policy (back-compat).
    const useProject = projectDividendPolicy !== undefined;
    const policy = useProject ? (projectDividendPolicy ?? {}) : (phase.dividendPolicy ?? {});
    if (policy.enabled !== true) return null;
    if (statusPriority(phase) !== priority) return null;
    const startingYear = effectiveDividendStartYear;
    const startingYearAxisIdx = Math.max(0, Math.min(N - 1, startingYear - projectStartYear));
    const payoutRatio = Math.max(0, Math.min(1, (policy.payoutRatio ?? 0) / 100));
    const mode: 'cash_above_min' | 'pct_of_ebitda' = policy.mode === 'pct_of_ebitda' ? 'pct_of_ebitda' : 'cash_above_min';
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
      mode,
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
  const cashBeforeAllocationPerPeriod = new Array<number>(N).fill(0);
  const totalSweepPerPeriod = new Array<number>(N).fill(0);
  const totalDividendsPerPeriod = new Array<number>(N).fill(0);
  const terminalPayoutPerPeriod = new Array<number>(N).fill(0);
  const dividendsEnabled = beforeSweepPhases.length > 0 || afterSweepPhases.length > 0;
  const adjustedClosingCash = preSweepClosingCash.slice(0, N);
  while (adjustedClosingCash.length < N) adjustedClosingCash.push(0);

  // When the engine applied the sweep, seed the per-period sweep total from
  // the engine result (the forward pass below will NOT re-sweep).
  if (sweepInEngine) {
    for (const row of eligible) {
      for (let t = 0; t < N; t++) totalSweepPerPeriod[t] += row.sweepPerPeriod[t] ?? 0;
    }
  }

  // Forward pass with the full waterfall.
  let cumAllocation = 0;
  for (let t = 0; t < N; t++) {
    const cashBefore = (preSweepClosingCash[t] ?? 0) - cumAllocation;
    cashBeforeAllocationPerPeriod[t] = cashBefore;
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
      // 2026-06-01: pct_of_ebitda sizes the dividend off THIS period's EBITDA;
      // cash_above_min (default) sizes it off the cash above the min reserve.
      // Both stay bounded by `excess` (cash available) + the EBITDA budget cap.
      const desired = row.mode === 'pct_of_ebitda'
        ? Math.max(0, row.phaseEbitdaPerPeriod[t] ?? 0) * row.payoutRatio
        : excess * row.payoutRatio;
      const div = Math.min(desired, excess, budget);
      if (div <= 0) continue;
      row.dividendsPerPeriod[t] = (row.dividendsPerPeriod[t] ?? 0) + div;
      row.totalDividends += div;
      totalDividendsPerPeriod[t] += div;
      excess -= div;
    }
    // 2. Cash sweep on debt. Skipped when the engine already applied the
    //    sweep (sweepInEngine): the sweep is already reflected in
    //    preSweepClosingCash + the per-tranche post-sweep balances, and
    //    totalSweepPerPeriod is taken from the engine result. `excess` here is
    //    therefore the cash remaining for dividends (post-sweep).
    if (!sweepInEngine) {
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
      // 2026-06-01: pct_of_ebitda sizes the dividend off THIS period's EBITDA;
      // cash_above_min (default) sizes it off the cash above the min reserve.
      // Both stay bounded by `excess` (cash available) + the EBITDA budget cap.
      const desired = row.mode === 'pct_of_ebitda'
        ? Math.max(0, row.phaseEbitdaPerPeriod[t] ?? 0) * row.payoutRatio
        : excess * row.payoutRatio;
      const div = Math.min(desired, excess, budget);
      if (div <= 0) continue;
      row.dividendsPerPeriod[t] = (row.dividendsPerPeriod[t] ?? 0) + div;
      row.totalDividends += div;
      totalDividendsPerPeriod[t] += div;
      excess -= div;
    }
    // 4. Terminal 100% payout (2026-06-02). In the exit/terminal period the
    //    model retains NO minimum cash: distribute every remaining unit above
    //    the opening-cash floor as a liquidating dividend (bypasses the
    //    per-phase EBITDA cap). Booked into totalDividendsPerPeriod so it flows
    //    as a real dividend through the Direct CF, the BS (retained earnings),
    //    and the Returns module, the cash-sweep dividend then ties to FCFE /
    //    Distributed Equity. Only when dividends are enabled for the project.
    if (dividendsEnabled && terminalPayoutPeriod !== undefined && t === terminalPayoutPeriod) {
      const floor = Math.max(0, terminalCashFloor ?? 0);
      const allocSoFar = (sweepInEngine ? 0 : totalSweepPerPeriod[t]) + totalDividendsPerPeriod[t];
      const terminalExtra = Math.max(0, cashBefore - allocSoFar - floor);
      if (terminalExtra > 0) {
        totalDividendsPerPeriod[t] += terminalExtra;
        terminalPayoutPerPeriod[t] += terminalExtra;
      }
    }
    // When the engine applied the sweep, it is ALREADY reflected in
    // preSweepClosingCash (via debtRepays), so only the dividends reduce cash
    // here; otherwise both the (overlay) sweep + dividends reduce it.
    const allocThisPeriod = (sweepInEngine ? 0 : totalSweepPerPeriod[t]) + totalDividendsPerPeriod[t];
    cumAllocation += allocThisPeriod;
    adjustedClosingCash[t] = cashBefore - allocThisPeriod;
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
  // doesn't happen on the post-sweep balance. Aggregate across tranches.
  // DISPLAY-ONLY (V1 limitation): surfaced as an informational memo; the
  // composer does NOT subtract it from P&L interest or CF (so no asymmetric
  // BS adjustment). Folding it in is a follow-up pass.
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
    cashBeforeAllocationPerPeriod,
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
    enabled: dividendsEnabled,
    beforeSweepPhases,
    afterSweepPhases,
    totalDividendsPerPeriod,
    totalDividends: totalDividendsPerPeriod.reduce((s, v) => s + v, 0),
    terminalPayoutPerPeriod,
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
  // year", so the cash available to fund THIS year's capex is the
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
  // lag as Method A, this year's capex is funded by LAST year's
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
  // An EQUITY-FUNDED management fee is not a deficit driver (2026-08-18f).
  // The fee is still paid inside cash from operations; adding the same amount
  // back here before the gap is measured means the deficit does not size
  // debt-and-equity for it, and the engine draws it as dedicated equity
  // instead. Zero unless the fund terms say the fee is equity funded.
  const feeFundedByEquity = snap.directCF.managementFeeFundedByEquity === true;
  const fundFeesPerPeriod = (snap.directCF.fundFeesPaidPerPeriod ?? []).slice(0, N).map((v) => Math.max(0, -(v ?? 0)));
  while (fundFeesPerPeriod.length < N) fundFeesPerPeriod.push(0);

  const existingEquityDrawdownPerPeriod = zeros(N);
  const existingDebtDrawdownPerPeriod = zeros(N);
  // existingPrincipalRepaid covers principal cash out on existing facilities.
  const existingDebtRepaymentPerPeriod = (fin.combined.existingPrincipalRepaid ?? new Array<number>(N).fill(0)).slice(0, N).map((v) => -v);
  while (existingDebtRepaymentPerPeriod.length < N) existingDebtRepaymentPerPeriod.push(0);
  // Finance cost paid: the REAL cash interest = accrued − capitalised
  // (negative). This is exactly interestPaidArr in the Direct CF
  // (debtServiceCash − principal), so the waterfall's Closing Cash ties to
  // directCF.closingCash. Under conditional IDC this INCLUDES the
  // construction interest paid in cash (which totalInterestExpensed would
  // omit, since that interest is capitalised to the asset basis). Existing +
  // new ops-period interest are included identically.
  // Since 2026-08-18 the full interest charge is paid in cash and the
  // capitalised figure is the drawdown funding it, so the cash finance cost is
  // the summed interest paid, the same series the Direct CF carries.
  const financeCostPaidPerPeriod = (fin.combined.totalInterestPaid ?? new Array<number>(N).fill(0)).slice(0, N).map((v) => -(v ?? 0));
  while (financeCostPaidPerPeriod.length < N) financeCostPaidPerPeriod.push(0);
  const capitalizedArr = fin.combined.totalInterestCapitalized ?? new Array<number>(N).fill(0);
  // IDC drawdown: capitalised interest growing debt (funded by drawing).
  const idcDrawdownPerPeriod = capitalizedArr.slice(0, N);
  while (idcDrawdownPerPeriod.length < N) idcDrawdownPerPeriod.push(0);
  // Conditional IDC (2026-06-02): construction interest paid in cash.
  const idcCashPaidPerPeriod = (fin.combined.totalInterestCapitalizedCashPaid ?? new Array<number>(N).fill(0)).slice(0, N);
  while (idcCashPaidPerPeriod.length < N) idcCashPaidPerPeriod.push(0);
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
  const operatingInflowsPerPeriod = zeros(N);
  const preFinancingNetCashPerPeriod = zeros(N);
  const managementFeeEquityDrawPerPeriod = zeros(N);
  const idcHeadroomPerPeriod = zeros(N);
  const closingCashAfterFundingPerPeriod = zeros(N);
  let openingC = snap.bs.historicalOpeningCashTotal;
  for (let t = 0; t < N; t++) {
    openingCashPerPeriod[t] = openingC;
    // Existing debt repayment is DELIBERATELY EXCLUDED from the funding gap
    // (2026-06-02, per user): the rule is "for new drawdowns we don't count
    // repayment, repayment only happens once drawdown stops." Subtracting
    // existing-debt repayment here drained cash below the minimum and raised
    // NEW debt purely to service the OLD debt, i.e. churn (borrowing to repay).
    // Repayment is serviced from cash on hand / operations, never from a fresh
    // drawdown, so it does not size the gap. (The real outflow still hits the
    // actual Direct CF and the consolidated cash waterfall.)
    // THE REFERENCE SIZING RULE (2026-08-18g, read from Schedules R112 to
    // R116 and applied on instruction, superseding the 18b hold):
    //
    //   R112  pre-financing net cash = operating inflows - cash capex
    //   R115  cash before financing  = opening + R112
    //   R116  funding need           = IF(cash capex > 0, MAX(0, min - R115), 0)
    //
    // NO FINANCE COST OF ANY KIND enters the sizing, not the operating half and
    // not the IDC half. Interest is paid from the cash the project has, and
    // where construction cash cannot cover the IDC the shortfall is drawn as a
    // separate IDC drawdown (R123, computed AGAINST this pre-interest cash) and
    // never sized into the development need. Before this, cash finance cost was
    // subtracted here, so on a project carrying a large existing loan the
    // sizing raised CONSTRUCTION funding to service that loan's interest:
    // measured on FMP RE HUB, 420,532k against 263,780k under this rule, the
    // gap being the existing hotel loan. Construction capital does not service
    // an existing operating loan, and if removing it deepens a shortfall that
    // is the honest number.
    //
    // Before-sweep dividends stay out for the same reason: a distribution is
    // not a development funding need.
    //
    // THE MANAGEMENT FEE (2026-08-19). On the DEFICIT path the fee is inside
    // cash from operations and sizes the requirement like any other outflow
    // (R110 feeds R111). On the EQUITY path it is ADDED BACK here so the base
    // debt / equity is sized without it, and it is drawn from equity directly
    // AFTER the base funding, below.
    const fee = fundFeesPerPeriod[t] ?? 0;
    const opsForSizing = (cashFromOpsPerPeriod[t] ?? 0) + (feeFundedByEquity ? fee : 0);
    operatingInflowsPerPeriod[t] = opsForSizing;
    preFinancingNetCashPerPeriod[t] = opsForSizing + (cashFromInvPerPeriod[t] ?? 0);
    const cashAvail = openingC
      + preFinancingNetCashPerPeriod[t]
      + (existingEquityDrawdownPerPeriod[t] ?? 0)
      + (existingDebtDrawdownPerPeriod[t] ?? 0);
    cashAvailableBeforeNewDebtPerPeriod[t] = cashAvail;
    // R116's gate: a development funding need exists only in a period that is
    // spending on construction. Once the spend stops, no construction funding
    // is raised, whatever cash does. Reads the CASH capex (R105 is construction
    // + land cash + RETT), which is what `cashFromInvPerPeriod` carries.
    const spendingThisPeriod = (cashFromInvPerPeriod[t] ?? 0) < -0.005;
    const netReq = spendingThisPeriod ? Math.max(0, minCashReserve - cashAvail) : 0;
    netCashRequiredPerPeriod[t] = netReq;
    const afterBase = cashAvail + netReq;
    // THE FEE EQUITY DRAW: only while construction is spending, and only as
    // far as keeps cash at the minimum once the fee has been paid out of the
    // cash the base funding left. Never more than the fee, never after the
    // spend stops (the fee is then paid from cash, which may fall below the
    // floor: that is the honest number, not a reason to raise equity).
    let feeDraw = 0;
    if (feeFundedByEquity && spendingThisPeriod && fee > 0) {
      feeDraw = Math.min(fee, Math.max(0, minCashReserve - (afterBase - fee)));
    }
    managementFeeEquityDrawPerPeriod[t] = feeDraw;
    const afterFee = feeFundedByEquity ? afterBase - fee + feeDraw : afterBase;
    // R123: the IDC is paid from what sits above the minimum BEFORE any
    // interest, and the rest is drawn.
    idcHeadroomPerPeriod[t] = Math.max(0, afterFee - minCashReserve);
    closingCashAfterFundingPerPeriod[t] = afterFee;
    // In a spending period the base funding plugs cash to the floor; in a
    // non-spending period nothing is raised and the walk carries the true
    // (possibly lower) cash, which is what R143 does. R114 = prior R143.
    openingC = afterFee;
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
    fundFeesPerPeriod,
    feeFundedByEquity,
    operatingInflowsPerPeriod,
    preFinancingNetCashPerPeriod,
    managementFeeEquityDrawPerPeriod,
    idcHeadroomPerPeriod,
    closingCashAfterFundingPerPeriod,
    idcDrawdownPerPeriod,
    idcCashPaidPerPeriod,
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

/**
 * Single-pass snapshot computation. Threads the supplied fundingGap +
 * idcCashBudget into the financing engine and returns the resulting
 * statements WITHOUT any re-run. The exported `computeFinancialsSnapshot`
 * wraps this in an iterative fixed-point loop (see below) to resolve the
 * gap-sizing + conditional-IDC circularity.
 */
function computeFinancialsSnapshotOnce(
  state: FinancialsResolverState,
  opts?: {
    fundingGap?: FundingGapInputs; idcCashBudget?: number[]; sweepBudget?: number[];
    /** Fund layer Step 3: the FROZEN fee schedule. Computed once, before the
     *  iterative solver, from a fee-free pass, and passed unchanged into every
     *  iteration. It is an INPUT here and is never derived from this pass, so
     *  no fee can feed its own base. Absent = no fund fees at all. */
    fundFees?: FundFeeSchedule;
  },
): ProjectFinancialsSnapshot {
  const { project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode, financingTranches, equityContributions } = state;

  // 1. Upstream snapshots (each pure function call already memoizes via React.useMemo at the call site)
  const revenue = computeAllSellResults({ project, phases, assets, subUnits });
  const opex = computeAllOpexResults({ project, phases, assets, subUnits }, revenue);
  const ap = computeOpexApSnapshot({ project, assets }, opex);
  const escrow = computeEscrowSnapshot({ project, phases, assets, subUnits }, revenue);
  // 2026-08-16: `revenue` threaded so capitalised capex is built on the same
  // curve the P&L spends it, for any line that follows collections.
  const fixedAssets = computeAllFixedAssetResults({ project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode, revenue });
  const financing = computeFinancingResult({
    project, phases, parcels, assets, subUnits, costLines, costOverrides,
    landAllocationMode,
    financingConfig: project.financing ?? DEFAULT_PROJECT_FINANCING_CONFIG,
    tranches: financingTranches,
    equityContributions,
    // 2026-08-16: `revenue` is computed on the line above, before this call, so
    // the financing capex schedule phases collections-following cost lines the
    // same way the P&L does. One-way: the revenue engine reads no cost input.
    revenue,
    // M5 / funding (2026-06-01): Methods 2 + 3 size debt/equity to the
    // per-period funding gap. The gap needs a full snapshot to compute, so
    // it is fed back via a guarded second pass (see the end of this
    // function); opts.fundingGap is set only on that second pass.
    fundingGap: opts?.fundingGap,
    // Conditional IDC (2026-06-02): per-period surplus-cash budget for
    // paying construction interest in cash. Also fed only on the second
    // pass (derived from pass-1's Method 3 waterfall).
    idcCashBudget: opts?.idcCashBudget,
    // Cash sweep (2026-06-02): per-period cash-available-for-debt budget;
    // sweep-eligible tranches repay from it IN the engine so interest follows
    // the swept balance. Fed by the snapshot two-pass (deriveCircularInputs).
    sweepBudget: opts?.sweepBudget,
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
    const landInKind = zeros(N);

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
      const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
      const offset = Math.max(0, phaseStartYear - projectStartYear);
      // 2026-08-16: routed through the shared helper. The offset arithmetic and
      // the slot count used to be written out here and nowhere else, which is
      // exactly how a second site copying it by hand lands a curve one period
      // out. Every call site now calls collectionsForAsset or passes nothing.
      const collections = collectionsForAsset(revenue, a.id, phase, projectStartYear);
      const breakdown = computeAssetCost({
        asset: a, project, phase, parcels, assets, subUnits, costLines, costOverrides,
        landAllocationMode,
        parcelFunding: project.financing?.parcelFunding,
        collectionsPerPeriod: collections,
        collectionsTotal: collectionsTotalForAsset(revenue, a.id),
      });
      const per = breakdown.perPeriod ?? [];
      const perInK = breakdown.perPeriodLandInKind ?? [];
      for (let i = 0; i < Math.max(per.length, perInK.length); i++) {
        // M4 Pass 2W (2026-05-24) rescues phase 1's i=0 lump. 2026-08-18: this
        // site used to spell that rule out again by hand; it now calls the one
        // definition `aggregateProjectCapex` uses, so the per-asset rows and
        // the project total cannot land a period apart (TRAPS 7.12).
        const projIdx = phaseLocalToProjectIndex(i, offset);
        if (projIdx >= 0 && projIdx < N) {
          capex[projIdx] += per[i] ?? 0;
          landInKind[projIdx] += perInK[i] ?? 0;
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
    //   = cumulative (capex + IDC capitalised) - cumulative CoS.
    // CoS itself is already IDC-augmented in byAssetSchedules above, so
    // the inventory release matches.
    //
    // 2026-06-01 (BS identity fix): NO `max(0, ...)` floor. When the sale is
    // recognised (point-in-time at handover) but a slice of construction capex
    // is still scheduled to be spent AFTER handover (a cost line whose
    // endPeriod runs past the handover year), CoS recognises the full cost
    // base while that capex slice has not been placed yet. Flooring inventory
    // to 0 dropped that slice and threw the Balance Sheet out by exactly the
    // post-handover capex amount for the handover period. Letting inventory
    // CARRY the (transient, negative) slice past handover lets it settle back
    // to 0 once the remaining capex is placed, so the BS balances every period.
    // Inventory only goes negative in this capex-past-handover edge; with capex
    // inside the construction window it stays >= 0 exactly as before.
    const inventoryRow = zeros(N);
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      const idcRow = byAssetIDC.get(a.id)?.idcPerPeriod ?? zeros(N);
      let cumCapex = 0;
      let cumCos = 0;
      for (let t = 0; t < N; t++) {
        cumCapex += (capex[t] ?? 0) + (idcRow[t] ?? 0);
        cumCos += cosRow[t] ?? 0;
        inventoryRow[t] = cumCapex - cumCos;
      }
    }

    perAssetCF.set(a.id, {
      assetId: a.id,
      assetName: a.name,
      strategy: a.strategy,
      revenueReceivedPerPeriod: revRcv,
      opexPaidPerPeriod: opexPaid,
      capexPerPeriod: capex,
      landInKindPerPeriod: landInKind,
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

  // Fund fees (Step 3). A FROZEN input: the schedule was computed once, before
  // the iterative solver, from a fee-free snapshot, so it cannot move while the
  // funding requirement is being solved. All zeros when the fund toggle is off.
  const fundFeeSchedule = opts?.fundFees ?? emptyFundFeeSchedule(N);
  const fundFees = zeros(N);
  for (let t = 0; t < N; t++) fundFees[t] = fundFeeSchedule.totalPerPeriod[t] ?? 0;

  // ── EBITDA IS STRUCK AFTER THE FUND FEES (2026-08-05) ────────────────────
  //
  // Step 3 originally placed the fees BELOW EBITDA and above the tax line, so
  // EBITDA stayed a pre-fee operating measure and a second "EBITDA after fund
  // fees" line carried the net figure. The reference model does it the other
  // way: the fees total into their own line and EBITDA is struck AFTER them,
  // so there is ONE EBITDA and it is already net of fund fees. Changed to
  // match, because two EBITDA rows in one statement is exactly the kind of
  // thing a reader quotes the wrong one of.
  //
  // The pre-fee measure is still computed and exposed, because the phase-level
  // P&L needs it: fund fees are PROJECT level and carry no phase allocation,
  // so a per-phase EBITDA cannot be struck after them.
  //
  // On every standalone project fundFees is all zeros, so ebitda,
  // ebitdaBeforeFundFees and ebitdaAfterFundFees are the same numbers and
  // nothing downstream moves. That is what the toggle-off guard pins.
  //
  // KNOWN CONSEQUENCE, deliberate: ICR and DSCR read `ebitdaPerPeriod`, so on a
  // fund project they are now measured on after-fee EBITDA. That follows from
  // the reference's definition rather than being a side effect of it.
  const ebitdaBeforeFundFees = zeros(N);
  const ebitda = zeros(N);
  const ebitdaAfterFundFees = zeros(N);
  const ebit = zeros(N);
  const pbt = zeros(N);
  for (let t = 0; t < N; t++) {
    ebitdaBeforeFundFees[t] = totalRev[t] - cosTotal[t] - totalOpex[t];
    ebitda[t] = ebitdaBeforeFundFees[t] - fundFees[t];
    // Retained as an alias of `ebitda`, not as a second definition. Kept so a
    // reader or a caller written against Step 3 still finds the after-fee
    // figure under the name it used, and finds the RIGHT number.
    ebitdaAfterFundFees[t] = ebitda[t];
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
    ebitdaBeforeFundFeesPerPeriod: ebitdaBeforeFundFees,
    fundFeesPerPeriod: fundFees,
    ebitdaAfterFundFeesPerPeriod: ebitdaAfterFundFees,
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

  // HOW THE MANAGEMENT FEE IS FUNDED (2026-08-18f, rebuilt AT THE ENGINE).
  //
  // The first build (18b) added an equity draw to the equity series AFTER the
  // engine had run, so the engine never saw it, the deficit still sized
  // funding for the fee, and the fee was funded twice. Now:
  //
  //  'deficit' (default, every existing project): the fee stays inside cash
  //     from operations, lowers cash available, and the deficit funds it at the
  //     project debt/equity ratio like any other outflow.
  //  'equity': the fee is REMOVED from the deficit sizing (the waterfall adds
  //     it back to cash available before measuring the gap) and handed to the
  //     financing engine as `dedicatedEquityByPeriod`, which it draws as equity
  //     only, on top of the ratio split. The fee is then funded exactly once,
  //     by equity, and the equity series the engine returns already carries it.
  //
  // `managementFeeEquityDraw` is now a REPORTING series: the fee that was
  // funded that way this period, for the memo and the attribution.
  const feeFundedByEquity = (project.fundTerms?.managementFeeFunding ?? 'deficit') === 'equity';

  const cashFromOps = zeros(N);
  for (let t = 0; t < N; t++) {
    // Fund fees are an operating outflow, paid in the period charged. Being
    // inside cashFromOps is what makes them reach the funding requirement:
    // computeFundingGap builds Method 3's cash-available line from these
    // arrays, so a fee lowers available cash and the gap sizes more funding to
    // keep the minimum reserve. No extra plumbing, and no way to book the fee
    // in the P&L while forgetting the cash.
    cashFromOps[t] = revRcvProject[t] + netRevAdj[t] - opexPaidProject[t] - hqOpexPaid[t] - fundFees[t] - taxPaidArr[t];
  }

  // Capex: project total per-period from financing engine.
  // M4 Pass 2N-Fix (2026-05-21): financing arrays are length N starting
  // M4 Pass 2P (2026-05-24): CF Capex uses CASH-basis capex
  // (perPeriod.exclLandInKind), not inclAllLand. In-kind land is a
  // non-cash equity contribution recognised on BS as Land + Share
  // Capital simultaneously; it does NOT flow through Cash from
  // Investment. Previously this was the larger inclAllLand which
  // washed against in-kind equity in cashFromFin, both sides wrong,
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
  //, both sides individually wrong, BS Cash accidentally correct.
  // Now cashFromInv uses capex.exclLandInKind and cashFromFin uses
  // equityCashArr. Net BS Cash unchanged; both lines individually right.
  // equityDraws kept as the cumulative basis for Share Capital roll-up
  // (cash + in-kind both recognised on BS via Land + Share Capital).
  // The engine's equity series ALREADY carries the dedicated fee draw when the
  // fee is equity funded (it was handed in as `dedicatedEquityByPeriod`), so
  // nothing is added here. 18b added it here, after the engine, and funded the
  // fee twice.
  const equityCashArr = financing.equity.cashPerPeriod.slice(0, N);
  while (equityCashArr.length < N) equityCashArr.push(0);
  // The engine's own split of that draw (2026-08-19): development equity (the
  // equity share of the requirement) and the fee drawn from equity directly.
  const equityDevelopmentArr = financing.equity.developmentPerPeriod.slice(0, N);
  while (equityDevelopmentArr.length < N) equityDevelopmentArr.push(0);
  const equityManagementFeeArr = financing.equity.managementFeePerPeriod.slice(0, N);
  while (equityManagementFeeArr.length < N) equityManagementFeeArr.push(0);
  const equityInKindArr = financing.equity.inKindPerPeriod.slice(0, N);
  while (equityInKindArr.length < N) equityInKindArr.push(0);
  const equityExistingArr = financing.equity.existingEquityPerPeriod.slice(0, N);
  while (equityExistingArr.length < N) equityExistingArr.push(0);
  const equityDraws = equityCashArr.map((v, i) => v + (equityInKindArr[i] ?? 0));

  // BOTH DRAWDOWNS ARE CASH (2026-08-18c, matching the reference, whose closing
  // cash adds the TOTAL drawdown and subtracts the FULL finance cost). They are
  // carried separately as well so the schedule can show each.
  const capexDrawArr = financing.combined.totalDrawdown.slice(0, N);
  while (capexDrawArr.length < N) capexDrawArr.push(0);
  const idcDrawArr = financing.combined.totalIdcDrawdown.slice(0, N);
  while (idcDrawArr.length < N) idcDrawArr.push(0);
  const debtDraws = capexDrawArr.map((v, i) => v + (idcDrawArr[i] ?? 0));
  const debtRepays = financing.combined.totalPrincipalRepaid.slice(0, N);
  while (debtRepays.length < N) debtRepays.push(0);
  // 2026-08-18: read the SUMMED cash interest rather than backing it out of
  // debt service. The old derivation (`debtServiceCash - principal`) equalled
  // accrued less capitalised, which was right only while capitalised interest
  // was interest nobody paid. IDC is now paid in the period it arises and the
  // capitalised figure is the drawdown funding it, so the derivation would
  // have understated the outflow by exactly the IDC drawdown.
  const interestPaidArr = financing.combined.totalInterestPaid.slice(0, N);
  while (interestPaidArr.length < N) interestPaidArr.push(0);

  // The IDC charge is PAID IN FULL, so accrued and paid are the same series.
  // Both names are kept because the FCFE chain reads the charge and the cash
  // statement reads the payment, and they are the same number by construction.
  const idcAccruedArr = financing.combined.totalIdc.slice(0, N);
  while (idcAccruedArr.length < N) idcAccruedArr.push(0);
  const idcPaidArr = idcAccruedArr.slice();
  const opInterestArr = interestPaidArr.map((v, i) => Math.max(0, v - (idcPaidArr[i] ?? 0)));

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
  const unearnedChange = zeros(N);
  // Residential AR + Unearned changes come from per-asset Sell bundles.
  for (const bundle of byAssetSchedules.values()) {
    for (let t = 0; t < N; t++) {
      residentialArChange[t] += bundle.ar.changePerPeriod[t] ?? 0;
      unearnedChange[t] += bundle.unearned.changePerPeriod[t] ?? 0;
    }
  }
  // Inventory / Cost of Sales (2026-06-01): a Sell asset's Inventory (WIP)
  // is BUILT by construction capex and RELEASED to Cost of Sales. The capex
  // cash already sits in the Investing section (cashFromInv, shared with the
  // Direct method), so subtracting the full inventory change here would
  // count that capex a SECOND time and pull Indirect CFO below Direct CFO by
  // the inventory build. The correct operating-cash treatment when capex is
  // classified as investing is to ADD COST OF SALES BACK (a non-cash expense
  // in the period it is booked, exactly like depreciation): PAT carries
  // -CoS, the capex carries the cash in Investing, so adding CoS back nets
  // the inventory cycle to zero in operations and makes Indirect tie Direct.
  // `cosTotal` (project Cost of Sales per period, Sell strategies only) is
  // computed with the P&L above. The Inventory CLOSING balance is still
  // summed here for the Balance Sheet (it is a real BS asset); only the
  // operating-cash *change* line is replaced by the CoS add-back.
  const inventoryClosingProject = zeros(N);
  for (const cf of perAssetCF.values()) {
    for (let t = 0; t < N; t++) inventoryClosingProject[t] += cf.inventoryPerPeriod[t] ?? 0;
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
    cashFromOpsIndirect[t] = pat[t] + da[t] + interestExpense[t] + cosTotal[t]
      - arOperatingChange[t] - residentialArChange[t]
      + apChange[t] + unearnedChange[t] - escrowChange[t];
    // Interest is a FINANCING item in this model: the Direct CF shows interest
    // paid in the financing block (not operations). The +interestExpense
    // add-back above already removes the accrued interest from operating cash,
    // so interest paid must NOT be subtracted here as well: it lives in the
    // financing section (cashFromFinAdj), exactly as in the Direct method.
    // Subtracting it here too (2026-06-01 Finding 1b) double-counted interest
    // paid across operations + financing and pulled Indirect closing cash
    // below Direct by the cash interest once operations began.
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
  // When opts.sweepBudget was fed, the engine ALREADY applied the sweep
  // (fac.outstanding is post-sweep, fac.sweepRepaid holds the amounts). The
  // cash waterfall then reads the engine sweep instead of re-computing it.
  const sweepInEngine = !!opts?.sweepBudget;
  const engineSweepByTranche = sweepInEngine ? new Map<string, number[]>() : undefined;
  for (const [trancheId, fac] of financing.facilities) {
    facilityOutstandingForSweep.set(trancheId, fac.outstanding.slice(0, N));
    if (engineSweepByTranche) engineSweepByTranche.set(trancheId, fac.sweepRepaid.slice(0, N));
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
    engineSweepByTranche,
    // Terminal 100% payout in the exit period (default last axis year): no
    // minimum cash retained, distribute down to the opening-cash seed so the
    // dividend ties to FCFE / Distributed Equity in Returns.
    terminalPayoutPeriod: Math.max(0, Math.min(N - 1, project.returns?.exitYearOffset ?? (N - 1))),
    terminalCashFloor: historicalOpeningCashTotal,
    dividendStartYear: project.dividendStartYear,
    projectDividendPolicy: project.dividendPolicy,
    projectSweep: project.financing?.cashSweep,
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
  // When the sweep is in the engine, it is ALREADY in debtRepays (=
  // totalPrincipalRepaid) → cashFromFin → closingCash, so do NOT fold it again
  // here (that would double-count). Only the dividends remain to fold. When
  // the sweep is the overlay (no engine sweep), fold both as before.
  const sweepFold = sweepInEngine ? new Array<number>(N).fill(0) : sweepPerPeriodPos;
  const debtRepaysAdj = debtRepays.map((v, i) => v + (sweepFold[i] ?? 0));
  const cashFromFinAdj = cashFromFin.map((v, i) => v - (sweepFold[i] ?? 0) - (dividendsPerPeriodPos[i] ?? 0));
  const netCfAdj = netCf.map((v, i) => v - (sweepFold[i] ?? 0) - (dividendsPerPeriodPos[i] ?? 0));
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
    fundFeesPaidPerPeriod: fundFees.map((v) => -v),
    taxPaidPerPeriod: taxPaidArr.map((v) => -v),
    cashFromOperationsPerPeriod: cashFromOps,
    capexPerPeriod: capexProj.map((v) => -v),
    capexDrawdownPerPeriod: capexDrawArr,
    idcDrawdownPerPeriod: idcDrawArr,
    idcAccruedPerPeriod: idcAccruedArr,
    idcPaidPerPeriod: idcPaidArr,
    operatingInterestPaidPerPeriod: opInterestArr,
    equityDevelopmentDrawdownPerPeriod: equityDevelopmentArr,
    equityManagementFeeDrawdownPerPeriod: equityManagementFeeArr,
    managementFeeFundedByEquity: feeFundedByEquity,
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
    costOfSalesAddBackPerPeriod: cosTotal.slice(),
    changeInApPerPeriod: apChange,
    changeInUnearnedPerPeriod: unearnedChange,
    changeInEscrowPerPeriod: escrowChange.map((v) => -v),
    cashFromOperationsPerPeriod: cashFromOpsIndirect,
    capexPerPeriod: capexProj.map((v) => -v),
    capexDrawdownPerPeriod: capexDrawArr,
    idcDrawdownPerPeriod: idcDrawArr,
    idcAccruedPerPeriod: idcAccruedArr,
    idcPaidPerPeriod: idcPaidArr,
    operatingInterestPaidPerPeriod: opInterestArr,
    equityDevelopmentDrawdownPerPeriod: equityDevelopmentArr,
    equityManagementFeeDrawdownPerPeriod: equityManagementFeeArr,
    managementFeeFundedByEquity: feeFundedByEquity,
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
  // the BS, the resulting gap was the user-reported mismatch.
  const priorEquityTotal = financing.existing.equityTotal;
  const equityCumulative = cumulative(equityDraws);
  // A user-entered project.shareCapital is treated as the OPENING / base
  // share capital (replacing the derived prior-equity opening); new equity
  // draws still roll in on top, so the equity side matches the equity cash
  // that flowed through the Cash Flow into BS Cash. Pinning it to a flat
  // constant (the prior behaviour) left BS Cash growing with equity draws
  // while Equity stayed flat, breaking the BS balance (2026-06-02 audit).
  const openingShareCapital = project.shareCapital != null && project.shareCapital > 0
    ? project.shareCapital
    : priorEquityTotal;
  const shareCapital = zeros(N);
  for (let t = 0; t < N; t++) {
    shareCapital[t] = openingShareCapital + equityCumulative[t];
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

  const snapResult: ProjectFinancialsSnapshot = {
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
    fundFees: fundFeeSchedule,
    cashSweep,
    dividends,
    bsReconciliation,
  };

  return snapResult;
}

/**
 * Derive the funding gap (Methods 2/3) + conditional-IDC cash budget from a
 * computed snapshot. These are the two circular inputs that feed back into
 * the financing engine: the gap sizes external funding to the net cash
 * requirement, and the IDC budget is the surplus cash above the minimum
 * reserve available in each construction period to pay interest in cash
 * (rather than drawing more debt). Pure derivation, no recomputation.
 */
function deriveCircularInputs(
  snap: ProjectFinancialsSnapshot,
  fundingMethod: number,
  idcConditional: boolean,
  hasSweep: boolean,
): { fundingGap?: FundingGapInputs; idcCashBudget?: number[]; sweepBudget?: number[] } {
  const N = snap.axisLength;
  const gap = computeFundingGap(snap);

  // (a) Method 2 / 3 gap-sized drawdown.
  let fundingGap: FundingGapInputs | undefined;
  {
    const candidate: FundingGapInputs = {
      method2PerPeriod: gap.methodAGapPerPeriod,
      method3PerPeriod: gap.method3Waterfall.netCashRequiredPerPeriod,
      // The management fee drawn from equity directly (2026-08-19): outside
      // the requirement, outside the ratio, sized by the waterfall's rule.
      // Applies under EVERY funding method, since the fee is funded the same
      // way whichever method sizes the development requirement.
      dedicatedEquityByPeriod: gap.method3Waterfall.managementFeeEquityDrawPerPeriod,
    };
    const relevant = fundingMethod === 2 ? candidate.method2PerPeriod : fundingMethod === 3 ? candidate.method3PerPeriod : [];
    const gapTotal = relevant.reduce((s, v) => s + Math.max(0, v ?? 0), 0);
    const feeTotal = candidate.dedicatedEquityByPeriod?.reduce((s, v) => s + Math.max(0, v ?? 0), 0) ?? 0;
    if (gapTotal > 0 || feeTotal > 0) fundingGap = candidate;
  }

  // (b) The IDC cash budget: how much of the period's IDC the project can pay
  // from cash before it has to draw for the rest. THE REFERENCE RULE (R123):
  //
  //   IDC drawdown = MAX(0, IDC - MAX(0, (R115 + R116) - min cash))
  //
  // so the headroom is measured on cash BEFORE ANY FINANCE COST (R115 carries
  // none, since 2026-08-18g neither does ours) PLUS the development draw
  // (R116, which plugs cash to the floor in a spending period). Before this
  // the surplus was read from a cash-available figure that had already had
  // the cash interest subtracted, so the interest fed back into its own
  // headroom and the drawn slice was overstated on every construction period.
  // Handed to the schedule as the per-period cash it may consume for IDC.
  let idcCashBudget: number[] | undefined;
  if (idcConditional) {
    const w = gap.method3Waterfall;
    const minCash = w.minCashReserve;
    const budget = new Array<number>(N).fill(0);
    let hasBudget = false;
    // The headroom is the waterfall's own `idcHeadroomPerPeriod` (2026-08-19):
    // cash above the minimum after the base funding AND the fee equity draw,
    // before any interest, so there is ONE definition of it.
    void minCash;
    for (let t = 0; t < N; t++) {
      const surplus = Math.max(0, w.idcHeadroomPerPeriod[t] ?? 0);
      if (surplus > 0) { budget[t] = surplus; hasBudget = true; }
    }
    if (hasBudget) idcCashBudget = budget;
  }

  // (c) Cash-sweep budget = the per-period cash available for debt + dividend
  // (surplus above the minimum reserve, net of prior-period allocations) from
  // THIS pass's cash waterfall. The engine's sweep-eligible tranches repay
  // from it (existing-first / priority), so the balance, and the interest on
  // it, follows the sweep. Fed back via the two-pass; converges as paying
  // debt lowers interest, which frees more cash to sweep.
  let sweepBudget: number[] | undefined;
  if (hasSweep && snap.cashSweep.enabled) {
    // Budget = the PRE-distribution cash available above the minimum reserve,
    // reconstructed sweep-independently from the authoritative closing cash:
    //   preDist[t] = directCF.closing[t] + sweep[t] + dividend[t]
    // (adds this period's distributions back to the real closing). This is
    // stable across iterations, it depends only on ops / financing / interest
    // (which converge), NOT on the sweep amount itself, so feeding it back as
    // the sweep budget converges instead of oscillating.
    const minCash = snap.cashSweep.minCashReserve;
    const closing = snap.directCF.closingCashPerPeriod;
    const sweepArr = snap.cashSweep.totalSweepPerPeriod;
    const divArr = snap.dividends.totalDividendsPerPeriod;
    const budget = new Array<number>(N).fill(0);
    let hasBudget = false;
    for (let t = 0; t < N; t++) {
      const preDist = (closing[t] ?? 0) + (sweepArr[t] ?? 0) + (divArr[t] ?? 0);
      const v = Math.max(0, preDist - minCash);
      budget[t] = v;
      if (v > 0) hasBudget = true;
    }
    if (hasBudget) sweepBudget = budget;
  }

  return { fundingGap, idcCashBudget, sweepBudget };
}

/** Max absolute per-period difference between two (possibly undefined) arrays. */
function maxArrDelta(a: number[] | undefined, b: number[] | undefined): number {
  const len = Math.max(a?.length ?? 0, b?.length ?? 0);
  let m = 0;
  for (let i = 0; i < len; i++) m = Math.max(m, Math.abs((a?.[i] ?? 0) - (b?.[i] ?? 0)));
  return m;
}

/**
 * Public snapshot entry point with an ITERATIVE fixed-point solver for the
 * gap-sizing + conditional-IDC circularity (2026-06-02).
 *
 * The circularity (exactly the one Excel resolves with iterative calc
 * enabled): the IDC / funding drawdown depends on the finance cost, which
 * depends on the debt balance, which depends on the drawdown. Method 2/3
 * gap-sizing has the same loop (debt sized to the cash deficit, which moves
 * once the debt service changes).
 *
 * We recompute the snapshot feeding back the derived (fundingGap,
 * idcCashBudget) until they stop changing (max per-period delta < TOL) or a
 * safety iteration cap is hit. Each step is internally consistent, so the BS
 * balances + Direct == Indirect at every iteration; convergence just pins the
 * drawdown + finance cost to their self-consistent values.
 *
 * When called WITH explicit opts (tests / internal), a single pass runs with
 * those inputs honoured verbatim, so existing callers keep their behaviour.
 */
export function computeFinancialsSnapshot(
  state: FinancialsResolverState,
  opts?: {
    fundingGap?: FundingGapInputs; idcCashBudget?: number[]; sweepBudget?: number[];
    fundFees?: FundFeeSchedule;
  },
): ProjectFinancialsSnapshot {
  // Explicit-opts call (e.g. a verifier feeding a fixed gap/budget): one pass.
  if (opts?.fundingGap || opts?.idcCashBudget || opts?.sweepBudget || opts?.fundFees) {
    return computeFinancialsSnapshotOnce(state, opts);
  }

  // ── Fund layer Step 3: the fee schedule is resolved BEFORE the solver ────
  //
  // The funding requirement is solved iteratively below. If the fees were
  // computed inside that loop from anything the solver moves, a bigger
  // drawdown could produce a bigger fee, which is the circular dependency the
  // guideline forbids. So the schedule is built ONCE here, from a fee-free
  // pass, and then handed to every iteration as a constant.
  //
  // The cost is one extra full snapshot when the fund toggle is ON. When it is
  // off, `resolveFundTerms` reports disabled, this whole block is skipped, and
  // the function behaves exactly as it did before the fund layer existed,
  // which is what scripts/verify-fund-layer-guard.ts pins.
  const fundTerms = resolveFundTerms(state.project);
  if (fundTerms.enabled) {
    // The fee-free pass goes straight to the solver, NOT back through this
    // function: recursing here would re-enter this branch and never terminate.
    const feeFree = computeFinancialsSnapshotSolved(state, undefined);
    const baseRequirement = Math.max(0, feeFree.financing.funding.selectedWithMinCash ?? 0);
    const baseDebtRequirement = baseRequirement * Math.max(0, feeFree.financing.funding.debtPct ?? 0) / 100;
    const baseEquityRequirement = baseRequirement * Math.max(0, feeFree.financing.funding.equityPct ?? 0) / 100;
    const schedule = computeFundFeeSchedule({
      terms: fundTerms,
      axisLength: feeFree.axisLength,
      // NAV is NET assets, so a debt drawdown does not move it: cash and debt
      // rise together. Belt and braces on top of the freeze above.
      closingNavPerPeriod: feeFree.bs.totalEquityPerPeriod,
      // The facility limit comes from the model's stated facilities, never from
      // the drawn balance. Both sources are inputs: `principal` and `ltvPct`
      // are typed on the tranche, and capex comes from the cost lines and
      // carries no IDC, so neither moves with the funding solve.
      facilityLimit: resolveFacilityLimit({
        tranches: state.financingTranches,
        capexTotal: feeFree.financing.capex.totals.exclLandInKind,
        manualLimit: fundTerms.facilityLimit,
        override: fundTerms.facilityLimitOverride,
      }),
      // FUND SIZE = THE SELECTED METHOD'S FUNDING REQUIREMENT, split at its
      // base debt / equity ratio (2026-08-19, matching the reference, whose
      // fee bases are "Base Requirement" x the debt or equity share). This
      // REPLACES the 2026-08-05 rule that summed every draw the model made
      // (equity cash + in kind + existing, debt including capitalised IDC):
      // the fee is now charged on the capital the development REQUIRES, not on
      // what the solve happened to draw, so IDC drawdowns, the fee's own equity
      // draw, land in kind and pre-existing capital are all outside the base.
      //
      // Still resolved HERE, from the fee-free pass, and FROZEN before the
      // solver: on the deficit path the fee raises the requirement, so reading
      // it inside the loop would let the fee feed its own base. `fund_size_solved`
      // stays in CIRCULAR_FEE_BASES and stays forbidden.
      //
      // `selectedWithMinCash` is the requirement of whichever method is
      // selected: Method 3 is the deficit total (the minimum cash is inside it),
      // Methods 1 / 2 / 4 add the minimum cash buffer, which is what the
      // reference's Base Requirement (capex + land + minimum cash) does.
      fundSize: resolveFundSize({
        equityTotal: baseEquityRequirement,
        debtTotal: baseDebtRequirement,
        manualSize: fundTerms.fundSize,
        override: fundTerms.fundSizeOverride,
      }),
      // The two components as bases in their own right (2026-08-10): the annual
      // fees charge on equity alone, the arranging fee on debt alone. Read from
      // the SAME fee-free pass and frozen with everything else, and resolved
      // independently of `fundSize` so a fundSizeOverride cannot zero them.
      totalEquity: {
        amount: Math.max(0, baseEquityRequirement),
        source: baseEquityRequirement > 0 ? 'model' : 'none',
        explanation: `From your model: the equity share (${feeFree.financing.funding.equityPct.toFixed(0)}%) of the selected method's funding requirement, frozen before the solve. Excludes in-kind and existing equity.`,
      },
      debtFacility: {
        amount: Math.max(0, baseDebtRequirement),
        source: baseDebtRequirement > 0 ? 'model' : 'none',
        explanation: `From your model: the debt share (${feeFree.financing.funding.debtPct.toFixed(0)}%) of the selected method's funding requirement, frozen before the solve. Not the facility ceiling.`,
      },
    });
    return computeFinancialsSnapshotSolved(state, schedule);
  }

  return computeFinancialsSnapshotSolved(state, undefined);
}

/**
 * The iterative fixed-point solve, with an optional FROZEN fund fee schedule.
 *
 * Split out of `computeFinancialsSnapshot` so the fee schedule can be resolved
 * first and then held constant across every iteration. `fundFees` is threaded
 * into each pass unchanged and is never re-derived from a pass, which is the
 * structural guarantee that funding cannot raise the fees.
 */
function computeFinancialsSnapshotSolved(
  state: FinancialsResolverState,
  fundFees: FundFeeSchedule | undefined,
): ProjectFinancialsSnapshot {
  const finCfg = state.project.financing ?? DEFAULT_PROJECT_FINANCING_CONFIG;
  const fundingMethod = finCfg.fundingMethod;
  // Always true since 2026-08-18: IDC is funded cash-first and borrows only
  // the shortfall, so the iterative pass that computes the surplus-cash
  // budget is always required. The toggle that could switch it off is gone.
  const idcConditional = true;
  // Cash sweep (2026-06-02): a sweep-eligible tranche means the sweep repayment
  // (and the interest that follows the swept balance) must be resolved by the
  // iterative two-pass, the sweep needs cumulative cash, computed in the cash
  // waterfall, then fed back to the engine so interest accrues on the swept
  // balance (no phantom interest).
  const hasSweep = state.financingTranches.some((t) =>
    t.repaymentMethod === 'cash_sweep'
    || t.repaymentMethod === 'cashsweep_from_period'
    || t.repaymentMethod === 'cashsweep_min_cash'
    || t.cashSweepConfig?.enabled === true);
  const needsIteration = fundingMethod === 2 || fundingMethod === 3 || idcConditional || hasSweep;

  // No circular input => single pass (Methods 1 + 4, no conditional IDC, no sweep).
  // `fundFees` rides along on every pass as a constant, here and below.
  let snap = computeFinancialsSnapshotOnce(state, fundFees ? { fundFees } : undefined);
  if (!needsIteration) return snap;

  // Iterate to a fixed point. TOL is in currency units; MAX_ITERS caps the
  // work (convergence is geometric for sub-100% interest rates, so a handful
  // of passes is typical). The last accepted inputs produced `snap`.
  const TOL = 1;
  const MAX_ITERS = 25;
  let applied: { fundingGap?: FundingGapInputs; idcCashBudget?: number[]; sweepBudget?: number[] } = {};
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const derived = deriveCircularInputs(snap, fundingMethod, idcConditional, hasSweep);
    // Converged when the newly-derived inputs match the inputs that produced
    // the current snapshot (treat undefined as all-zero).
    const gapDelta = Math.max(
      maxArrDelta(derived.fundingGap?.method2PerPeriod, applied.fundingGap?.method2PerPeriod),
      maxArrDelta(derived.fundingGap?.method3PerPeriod, applied.fundingGap?.method3PerPeriod),
    );
    const idcDelta = maxArrDelta(derived.idcCashBudget, applied.idcCashBudget);
    const sweepDelta = maxArrDelta(derived.sweepBudget, applied.sweepBudget);
    if (iter > 0 && gapDelta < TOL && idcDelta < TOL && sweepDelta < TOL) break;
    if (!derived.fundingGap && !derived.idcCashBudget && !derived.sweepBudget) break; // nothing to feed
    applied = derived;
    // The fee schedule is passed through UNCHANGED. It is never part of
    // `derived`, so no iteration can revise it: the solver may raise funding to
    // cover the fees, and that higher funding cannot come back as a bigger fee.
    snap = computeFinancialsSnapshotOnce(state, fundFees ? { ...derived, fundFees } : derived);
  }
  return snap;
}
