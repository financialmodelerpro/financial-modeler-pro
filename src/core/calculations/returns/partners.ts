/**
 * M5 Returns engine, per-partner FCFE + DDM returns (reworked 2026-07-09).
 *
 * Each equity holder's return is now shown on TWO bases, each a clean share of
 * the exact consolidated stream, so the split is math-inert to the total:
 *   - FCFE-based:  partner share x consolidated FCFE  (levered free cash flow)
 *   - DDM-based:   partner share x consolidated Distributed-Equity (dividend)
 *
 * The share that drives both is a single per-partner "agreed shareholding":
 *   agreedShare = manualShareholdingPct (the negotiated final cap-table %),
 *                 or, when not overridden, the TIME-WEIGHTED average capital
 *                 balance ("dollar-years"):
 *
 *     K[i,t]      = existing_i + Sigma(s<=t)( cash_i,s + inKind_i,s )
 *     wavgShare_i = Sigma_t K[i,t]  /  Sigma_t K_total[t]
 *
 *   Because Sigma_i K[i,t] = K_total[t] at every period, Sigma_i wavgShare_i = 1,
 *   so the auto shares always reconcile to 100% and Sigma partner streams equals
 *   the consolidated stream, per period. A partner who puts land in up front is
 *   credited for holding capital longer than one whose cash arrives late, which
 *   a plain amount-weighted headline % ignores.
 *
 * Sign convention: negative = invested, positive = returned. Streams are
 * inception-prefixed (length E+1). The consolidated FCFE stream is passed in
 * (the engine cannot rebuild it from equity inputs alone); the consolidated
 * Distributed-Equity stream is reconstructed here from the same equity inputs.
 *
 * No em dashes in this file.
 */
import { irr, moic } from './irr';

export interface PartnerInput {
  id: string;
  name: string;
  /** New cash equity contributed by this partner (absolute amount). */
  cashContribution: number;
  /** In-kind (land) equity contributed. */
  inKindContribution: number;
  /** Existing equity (funded in an operational phase, in the ground at t=0). */
  existingContribution: number;
  /** Manual shareholding override (0-100) = the negotiated final agreed share. */
  manualShareholdingPct?: number;
}

export interface PartnerResult {
  id: string;
  name: string;
  cashContribution: number;
  inKindContribution: number;
  existingContribution: number;
  /** cash + in-kind + existing. */
  totalEquityInvested: number;
  /** Computed time-weighted average capital share (decimal 0-1), always shown. */
  weightedAvgShareholdingPct: number;
  /** Effective ("agreed") shareholding: manual override or the weighted average. */
  shareholdingPct: number;
  shareholdingIsManual: boolean;
  dividendsReceived: number;
  terminalDistribution: number;
  totalCashReturned: number;
  // ── DDM (Distributed-Equity) basis ──
  /** DDM IRR (= irr of the dividend-basis stream). */
  irr: number | null;
  moic: number;
  /** Distributions / invested (DDM basis). */
  equityMultiple: number;
  /** Inception-prefixed signed DDM stream (length E+1). */
  cashFlowStream: number[];
  // ── FCFE basis (share of consolidated levered free cash flow) ──
  fcfeIrr: number | null;
  fcfeMoic: number;
  fcfeEquityMultiple: number;
  /** Inception-prefixed signed FCFE stream (length E+1); empty if not supplied. */
  fcfeStream: number[];
}

export interface PartnersSnapshot {
  partners: PartnerResult[];
  // Per-type project totals (the reconciliation targets).
  totalCash: number;
  totalInKind: number;
  totalExisting: number;
  totalProjectEquity: number;
  // Per-type allocated sums across partners (Sigma partner contribution of that type).
  allocatedCash: number;
  allocatedInKind: number;
  allocatedExisting: number;
  totalContributions: number;
  // Per-type reconciliation (allocated == total).
  cashReconciles: boolean;
  inKindReconciles: boolean;
  existingReconciles: boolean;
  contributionsReconcile: boolean;
  contributionDelta: number;
  /** Sum of the AGREED shareholdings (the driver). */
  shareholdingSum: number;
  shareholdingReconciles: boolean;
  /** shareholdingSum - 1 (signed), for the reconciliation chip. */
  shareholdingDelta: number;
  /** Sum of the COMPUTED weighted-average shares (auto always sums to 1). */
  weightedAvgSum: number;
  manualMode: boolean;
  /** True when a single 100% "Sponsor" was synthesized as the default. */
  isSynthetic: boolean;
  streamYearLabels: number[];
  /** Sigma partner DDM streams per period (ties to consolidated Distributed-Equity). */
  totalStream: number[];
  /** Sigma partner FCFE streams per period (ties to consolidated FCFE). */
  totalFcfeStream: number[];
}

const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
const reconciles = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-3);
/** Distributions / invested for an inception-prefixed signed stream. */
const streamMultiple = (stream: number[]): number => {
  let inflow = 0;
  let outflow = 0;
  for (const v of stream) { if (v > 0) inflow += v; else outflow -= v; }
  return outflow > 0 ? inflow / outflow : 0;
};

/**
 * @param totalCash/totalInKind/totalExisting  project equity by type (== the
 *        values the project Distributed-Equity stream is built from).
 * @param cashAxisPerPeriod/inKindAxisPerPeriod per-type equity DRAW timing over
 *        the axis (length E); existing equity is booked at inception.
 * @param dividendsPerPeriod  axis dividends through exit (length E).
 * @param exitIdx             axis index of the exit year.
 * @param streamYearLabels    length E+1 (index 0 = inception).
 * @param consolidatedFcfePerPeriod  the consolidated FCFE stream (length E+1,
 *        index 0 = inception). When supplied, each partner gets an FCFE stream =
 *        agreedShare x this. When omitted (direct engine unit tests), the FCFE
 *        fields are left empty and only the DDM basis is produced.
 */
export function computePartnerReturns(args: {
  partners: PartnerInput[];
  totalCash: number;
  totalInKind: number;
  totalExisting: number;
  cashAxisPerPeriod: number[];
  inKindAxisPerPeriod: number[];
  dividendsPerPeriod: number[];
  terminalEquityValue: number;
  exitIdx: number;
  streamYearLabels: number[];
  consolidatedFcfePerPeriod?: number[];
  /** When no explicit partners are set, synthesize a single 100% Sponsor. */
  defaultToSponsor?: boolean;
}): PartnersSnapshot {
  const { totalCash, totalInKind, totalExisting, cashAxisPerPeriod, inKindAxisPerPeriod, dividendsPerPeriod, terminalEquityValue, exitIdx, streamYearLabels, consolidatedFcfePerPeriod, defaultToSponsor } = args;
  const E = Math.max(0, exitIdx + 1);
  const streamLen = E + 1;
  const totalCashPos = Math.max(0, totalCash);
  const totalInKindPos = Math.max(0, totalInKind);
  const totalExistingPos = Math.max(0, totalExisting);
  const totalProjectEquity = totalCashPos + totalInKindPos + totalExistingPos;
  const hasFcfe = Array.isArray(consolidatedFcfePerPeriod) && consolidatedFcfePerPeriod.length > 0;

  let partners = args.partners;
  let isSynthetic = false;
  if (partners.length === 0 && defaultToSponsor && totalProjectEquity > 0) {
    partners = [{ id: '__sponsor__', name: 'Sponsor', cashContribution: totalCashPos, inKindContribution: totalInKindPos, existingContribution: totalExistingPos }];
    isSynthetic = true;
  }

  const manualMode = partners.some((p) => p.manualShareholdingPct !== undefined && Number.isFinite(p.manualShareholdingPct));
  const totalDividends = sum(dividendsPerPeriod.slice(0, E));

  // Consolidated Distributed-Equity (DDM) stream, reconstructed from the same
  // equity inputs: inception = -existing, axis = -(cash + in-kind) + dividends,
  // exit += terminal equity. Sigma partner DDM streams reproduce this exactly.
  const divStream = new Array<number>(streamLen).fill(0);
  divStream[0] = -totalExistingPos;
  for (let t = 0; t < E; t++) {
    divStream[t + 1] = -((cashAxisPerPeriod[t] ?? 0) + (inKindAxisPerPeriod[t] ?? 0)) + (dividendsPerPeriod[t] ?? 0);
  }
  divStream[exitIdx + 1] = (divStream[exitIdx + 1] ?? 0) + terminalEquityValue;

  const fcfeStreamConsolidated = hasFcfe
    ? Array.from({ length: streamLen }, (_, i) => consolidatedFcfePerPeriod![i] ?? 0)
    : [];

  // ── Pass 1: per-partner deployed-capital schedule -> dollar-years CT ──
  type Pre = { p: PartnerInput; cash: number; inKind: number; existing: number; totalInvested: number; capitalTime: number };
  const pre: Pre[] = partners.map((p) => {
    const cash = Math.max(0, p.cashContribution);
    const inKind = Math.max(0, p.inKindContribution);
    const existing = Math.max(0, p.existingContribution);
    const shareCash = totalCashPos > 0 ? cash / totalCashPos : 0;
    const shareInKind = totalInKindPos > 0 ? inKind / totalInKindPos : 0;
    // Deployed capital at each stream index (0 = inception): existing sits in
    // from inception; cash / in-kind accumulate on the project's draw timing.
    let cum = existing;
    let capitalTime = cum; // index 0
    for (let t = 0; t < E; t++) {
      cum += shareCash * (cashAxisPerPeriod[t] ?? 0) + shareInKind * (inKindAxisPerPeriod[t] ?? 0);
      capitalTime += cum;
    }
    return { p, cash, inKind, existing, totalInvested: cash + inKind + existing, capitalTime };
  });
  const totalCapitalTime = pre.reduce((s, x) => s + x.capitalTime, 0);

  const results: PartnerResult[] = pre.map((x) => {
    const { p, cash, inKind, existing, totalInvested, capitalTime } = x;
    // Weighted-average (time-weighted) share; fall back to amount-weighted when
    // there is no capital-time signal (e.g. all draws at t with zero balance).
    const wavgShare = totalCapitalTime > 0
      ? capitalTime / totalCapitalTime
      : (totalProjectEquity > 0 ? totalInvested / totalProjectEquity : 0);
    const isManual = p.manualShareholdingPct !== undefined && Number.isFinite(p.manualShareholdingPct);
    const agreedShare = isManual ? Math.max(0, (p.manualShareholdingPct as number) / 100) : wavgShare;

    const ddmStream = divStream.map((v) => v * agreedShare);
    const fcfeStream = hasFcfe ? fcfeStreamConsolidated.map((v) => v * agreedShare) : [];

    const dividendsReceived = totalDividends * agreedShare;
    const terminalDistribution = terminalEquityValue * agreedShare;
    const totalCashReturned = dividendsReceived + terminalDistribution;

    return {
      id: p.id,
      name: p.name,
      cashContribution: cash,
      inKindContribution: inKind,
      existingContribution: existing,
      totalEquityInvested: totalInvested,
      weightedAvgShareholdingPct: wavgShare,
      shareholdingPct: agreedShare,
      shareholdingIsManual: isManual,
      dividendsReceived,
      terminalDistribution,
      totalCashReturned,
      irr: irr(ddmStream),
      moic: moic(ddmStream),
      equityMultiple: totalInvested > 0 ? totalCashReturned / totalInvested : 0,
      cashFlowStream: ddmStream,
      fcfeIrr: hasFcfe ? irr(fcfeStream) : null,
      fcfeMoic: hasFcfe ? moic(fcfeStream) : 0,
      fcfeEquityMultiple: hasFcfe ? streamMultiple(fcfeStream) : 0,
      fcfeStream,
    };
  });

  const totalStream = new Array<number>(streamLen).fill(0);
  const totalFcfeStream = new Array<number>(streamLen).fill(0);
  for (const r of results) {
    for (let t = 0; t < streamLen; t++) {
      totalStream[t] += r.cashFlowStream[t] ?? 0;
      if (hasFcfe) totalFcfeStream[t] += r.fcfeStream[t] ?? 0;
    }
  }

  const allocatedCash = results.reduce((s, r) => s + r.cashContribution, 0);
  const allocatedInKind = results.reduce((s, r) => s + r.inKindContribution, 0);
  const allocatedExisting = results.reduce((s, r) => s + r.existingContribution, 0);
  const totalContributions = allocatedCash + allocatedInKind + allocatedExisting;
  const shareholdingSum = results.reduce((s, r) => s + r.shareholdingPct, 0);
  const weightedAvgSum = results.reduce((s, r) => s + r.weightedAvgShareholdingPct, 0);

  return {
    partners: results,
    totalCash, totalInKind, totalExisting, totalProjectEquity,
    allocatedCash, allocatedInKind, allocatedExisting, totalContributions,
    cashReconciles: reconciles(allocatedCash, totalCash),
    inKindReconciles: reconciles(allocatedInKind, totalInKind),
    existingReconciles: reconciles(allocatedExisting, totalExisting),
    contributionsReconcile: reconciles(totalContributions, totalProjectEquity),
    contributionDelta: totalContributions - totalProjectEquity,
    shareholdingSum,
    shareholdingReconciles: Math.abs(shareholdingSum - 1) <= 1e-4,
    shareholdingDelta: shareholdingSum - 1,
    weightedAvgSum,
    manualMode,
    isSynthetic,
    streamYearLabels,
    totalStream,
    totalFcfeStream,
  };
}
