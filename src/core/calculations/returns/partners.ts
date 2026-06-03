/**
 * M5 Returns engine, Pass 2 (rebuilt 2026-06-03): multi-partner equity returns.
 *
 * Equity is allocated to partners BY TYPE (new cash / in-kind / existing), so
 * each type reconciles to its project total. Each partner's IRR is computed on
 * a YEARLY signed stream built exactly like the project's FCFE / Distributed-
 * Equity (DDM) stream, scaled per partner:
 *   inception (index 0): − the partner's existing equity (in the ground at t=0)
 *   axis year t:         − (cash + in-kind the partner injects that year, timed
 *                          by the project's per-type equity draw curve)
 *                        + the partner's share of dividends distributed that year
 *   exit year:           + the partner's share of the terminal equity value
 * Contributions are therefore spread over the years they actually happen (not
 * lumped at inception), so the per-partner IRR is a true equity IRR.
 *
 * Σ of all partner streams === the project Distributed-Equity stream when every
 * type is fully allocated. Sign convention: negative = invested, positive =
 * returned. Streams are inception-prefixed (length E+1).
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
  /** Manual shareholding override (0-100). Unset => auto from contributions. */
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
  /** Effective shareholding (decimal 0-1): manual override or total / project equity. */
  shareholdingPct: number;
  shareholdingIsManual: boolean;
  dividendsReceived: number;
  terminalDistribution: number;
  totalCashReturned: number;
  irr: number | null;
  moic: number;
  equityMultiple: number;
  /** Inception-prefixed signed yearly stream (length E+1). */
  cashFlowStream: number[];
}

export interface PartnersSnapshot {
  partners: PartnerResult[];
  // Per-type project totals (the reconciliation targets).
  totalCash: number;
  totalInKind: number;
  totalExisting: number;
  totalProjectEquity: number;
  // Per-type allocated sums across partners (Σ partner contribution of that type).
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
  shareholdingSum: number;
  shareholdingReconciles: boolean;
  manualMode: boolean;
  /** True when a single 100% "Sponsor" was synthesized as the default. */
  isSynthetic: boolean;
  streamYearLabels: number[];
  /** Σ partner streams per period (the table's Total row). */
  totalStream: number[];
}

const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
const reconciles = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-3);

/**
 * @param totalCash/totalInKind/totalExisting  project equity by type (== the
 *        values the project Distributed-Equity stream is built from).
 * @param cashAxisPerPeriod/inKindAxisPerPeriod per-type equity DRAW timing over
 *        the axis (length E); existing equity is booked at inception.
 * @param dividendsPerPeriod  axis dividends through exit (length E).
 * @param exitIdx             axis index of the exit year.
 * @param streamYearLabels    length E+1 (index 0 = inception).
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
  /** When no explicit partners are set, synthesize a single 100% Sponsor. */
  defaultToSponsor?: boolean;
}): PartnersSnapshot {
  const { totalCash, totalInKind, totalExisting, cashAxisPerPeriod, inKindAxisPerPeriod, dividendsPerPeriod, terminalEquityValue, exitIdx, streamYearLabels, defaultToSponsor } = args;
  const E = Math.max(0, exitIdx + 1);
  const streamLen = E + 1;
  const totalProjectEquity = Math.max(0, totalCash) + Math.max(0, totalInKind) + Math.max(0, totalExisting);

  let partners = args.partners;
  let isSynthetic = false;
  if (partners.length === 0 && defaultToSponsor && totalProjectEquity > 0) {
    partners = [{ id: '__sponsor__', name: 'Sponsor', cashContribution: Math.max(0, totalCash), inKindContribution: Math.max(0, totalInKind), existingContribution: Math.max(0, totalExisting) }];
    isSynthetic = true;
  }

  const manualMode = partners.some((p) => p.manualShareholdingPct !== undefined && Number.isFinite(p.manualShareholdingPct));
  const totalDividends = sum(dividendsPerPeriod.slice(0, E));

  const results: PartnerResult[] = partners.map((p) => {
    const cash = Math.max(0, p.cashContribution);
    const inKind = Math.max(0, p.inKindContribution);
    const existing = Math.max(0, p.existingContribution);
    const totalInvested = cash + inKind + existing;
    const shareCash = totalCash > 0 ? cash / totalCash : 0;
    const shareInKind = totalInKind > 0 ? inKind / totalInKind : 0;
    const autoShare = totalProjectEquity > 0 ? totalInvested / totalProjectEquity : 0;
    const isManual = p.manualShareholdingPct !== undefined && Number.isFinite(p.manualShareholdingPct);
    const shareDiv = isManual ? Math.max(0, (p.manualShareholdingPct as number) / 100) : autoShare;

    // Yearly FCFE / DDM-style stream, scaled per partner.
    const stream = new Array<number>(streamLen).fill(0);
    stream[0] = -existing; // existing equity is in the ground at inception
    for (let t = 0; t < E; t++) {
      const contribThisYear = (cashAxisPerPeriod[t] ?? 0) * shareCash + (inKindAxisPerPeriod[t] ?? 0) * shareInKind;
      stream[t + 1] = -contribThisYear + (dividendsPerPeriod[t] ?? 0) * shareDiv;
    }
    stream[exitIdx + 1] = (stream[exitIdx + 1] ?? 0) + terminalEquityValue * shareDiv;

    const dividendsReceived = totalDividends * shareDiv;
    const terminalDistribution = terminalEquityValue * shareDiv;
    const totalCashReturned = dividendsReceived + terminalDistribution;

    return {
      id: p.id,
      name: p.name,
      cashContribution: cash,
      inKindContribution: inKind,
      existingContribution: existing,
      totalEquityInvested: totalInvested,
      shareholdingPct: shareDiv,
      shareholdingIsManual: isManual,
      dividendsReceived,
      terminalDistribution,
      totalCashReturned,
      irr: irr(stream),
      moic: moic(stream),
      equityMultiple: totalInvested > 0 ? totalCashReturned / totalInvested : 0,
      cashFlowStream: stream,
    };
  });

  const totalStream = new Array<number>(streamLen).fill(0);
  for (const r of results) for (let t = 0; t < streamLen; t++) totalStream[t] += r.cashFlowStream[t] ?? 0;

  const allocatedCash = results.reduce((s, r) => s + r.cashContribution, 0);
  const allocatedInKind = results.reduce((s, r) => s + r.inKindContribution, 0);
  const allocatedExisting = results.reduce((s, r) => s + r.existingContribution, 0);
  const totalContributions = allocatedCash + allocatedInKind + allocatedExisting;
  const shareholdingSum = results.reduce((s, r) => s + r.shareholdingPct, 0);

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
    manualMode,
    isSynthetic,
    streamYearLabels,
    totalStream,
  };
}
