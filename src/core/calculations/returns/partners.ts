/**
 * M5 Returns engine, Pass 2: multi-partner equity returns.
 *
 * Splits the project's equity cash flows (operating distributions + terminal
 * equity proceeds) across partners by shareholding, and computes each
 * partner's IRR / MOIC / Equity Multiple. Pure: the resolver feeds the
 * project-level dividend stream + terminal equity + the partner inputs.
 *
 * Sign convention matches the rest of the engine: NEGATIVE = invested,
 * POSITIVE = returned. Each partner's stream is inception-prefixed (index 0 =
 * the inception period, projectStartYear − 1), matching the project streams:
 *   index 0      : − total equity contributed (lumped at inception)
 *   index 1..E   : + dividends_project[t] × shareholding
 *   index 1+exit : + terminal equity value × shareholding (added at exit)
 */
import { irr, moic } from './irr';

export interface PartnerInput {
  id: string;
  name: string;
  /** New cash equity contributed. */
  cashContribution: number;
  /** In-kind (land) equity contributed. */
  inKindContribution: number;
  /** Equity funded in an operational/existing phase. */
  existingContribution: number;
  /** Manual shareholding override (0-100). Undefined => auto from contributions. */
  manualShareholdingPct?: number;
}

export interface PartnerResult {
  id: string;
  name: string;
  /** New cash + existing contribution (the "cash" column the UI shows). */
  cashContribution: number;
  inKindContribution: number;
  /** cash + in-kind + existing. */
  totalEquityInvested: number;
  /** Effective shareholding as a decimal (0-1). */
  shareholdingPct: number;
  /** True when this partner's shareholding came from a manual override. */
  shareholdingIsManual: boolean;
  dividendsReceived: number;
  terminalDistribution: number;
  totalCashReturned: number;
  irr: number | null;
  moic: number;
  equityMultiple: number;
  /** Inception-prefixed signed stream (length E+1). */
  cashFlowStream: number[];
}

export interface PartnersSnapshot {
  partners: PartnerResult[];
  /** Σ partner totalEquityInvested. */
  totalContributions: number;
  /** The reconciliation target (project existing + new cash + in-kind). */
  totalProjectEquity: number;
  /** totalContributions − totalProjectEquity. */
  contributionDelta: number;
  contributionsReconcile: boolean;
  /** Σ effective shareholding (decimal; 1.0 when balanced). */
  shareholdingSum: number;
  shareholdingReconciles: boolean;
  /** Whether ANY partner used a manual shareholding (override mode). */
  manualMode: boolean;
  /** True when no explicit partners were set and a single 100% "Sponsor"
   *  holding the project's full equity was synthesized as the default. */
  isSynthetic: boolean;
  streamYearLabels: number[];
  /** Σ partner streams per period (the table's Total column). */
  totalStream: number[];
}

const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

/**
 * Compute per-partner returns from the project equity cash flows.
 *
 * @param dividendsPerPeriod  axis-indexed dividends through exit (length E).
 * @param terminalEquityValue project terminal equity value (added at exit).
 * @param exitIdx             axis index of the exit year (0-based).
 * @param totalProjectEquity  reconciliation target (equity grandTotal).
 * @param streamYearLabels    length E+1 (index 0 = inception).
 */
export function computePartnerReturns(args: {
  partners: PartnerInput[];
  dividendsPerPeriod: number[];
  terminalEquityValue: number;
  exitIdx: number;
  totalProjectEquity: number;
  streamYearLabels: number[];
  /** When no explicit partners are set, seed a single 100% "Sponsor" holding
   *  the project's full equity (new cash + in-kind + existing) so the section
   *  shows the actual equity injections by default; the user then splits it. */
  defaultBreakdown?: { cash: number; inKind: number; existing: number };
}): PartnersSnapshot {
  const { dividendsPerPeriod, terminalEquityValue, exitIdx, totalProjectEquity, streamYearLabels, defaultBreakdown } = args;
  let partners = args.partners;
  let isSynthetic = false;
  if (partners.length === 0 && defaultBreakdown) {
    const cash = Math.max(0, defaultBreakdown.cash);
    const inKind = Math.max(0, defaultBreakdown.inKind);
    const existing = Math.max(0, defaultBreakdown.existing);
    if (cash + inKind + existing > 0) {
      partners = [{ id: '__sponsor__', name: 'Sponsor', cashContribution: cash, inKindContribution: inKind, existingContribution: existing }];
      isSynthetic = true;
    }
  }
  const E = Math.max(0, exitIdx + 1);
  const streamLen = E + 1; // inception + axis 0..exit

  const totals = partners.map((p) =>
    Math.max(0, p.cashContribution) + Math.max(0, p.inKindContribution) + Math.max(0, p.existingContribution));
  const totalContributions = sum(totals);
  const manualMode = partners.some((p) => p.manualShareholdingPct !== undefined && Number.isFinite(p.manualShareholdingPct));

  const totalDividends = sum(dividendsPerPeriod.slice(0, E));

  const results: PartnerResult[] = partners.map((p, i) => {
    const totalInvested = totals[i];
    const autoShare = totalContributions > 0 ? totalInvested / totalContributions : 0;
    const isManual = p.manualShareholdingPct !== undefined && Number.isFinite(p.manualShareholdingPct);
    const share = isManual ? Math.max(0, (p.manualShareholdingPct as number) / 100) : autoShare;

    const stream = new Array<number>(streamLen).fill(0);
    stream[0] = -totalInvested;
    for (let t = 0; t < E; t++) stream[t + 1] = (dividendsPerPeriod[t] ?? 0) * share;
    stream[exitIdx + 1] = (stream[exitIdx + 1] ?? 0) + terminalEquityValue * share;

    const dividendsReceived = totalDividends * share;
    const terminalDistribution = terminalEquityValue * share;
    const totalCashReturned = dividendsReceived + terminalDistribution;
    const eqMult = totalInvested > 0 ? totalCashReturned / totalInvested : 0;

    return {
      id: p.id,
      name: p.name,
      cashContribution: Math.max(0, p.cashContribution) + Math.max(0, p.existingContribution),
      inKindContribution: Math.max(0, p.inKindContribution),
      totalEquityInvested: totalInvested,
      shareholdingPct: share,
      shareholdingIsManual: isManual,
      dividendsReceived,
      terminalDistribution,
      totalCashReturned,
      irr: irr(stream),
      moic: moic(stream),
      equityMultiple: eqMult,
      cashFlowStream: stream,
    };
  });

  const totalStream = new Array<number>(streamLen).fill(0);
  for (const r of results) for (let t = 0; t < streamLen; t++) totalStream[t] += r.cashFlowStream[t] ?? 0;

  const contributionDelta = totalContributions - totalProjectEquity;
  const contribTol = Math.max(1, Math.abs(totalProjectEquity) * 1e-3);
  const shareholdingSum = results.reduce((s, r) => s + r.shareholdingPct, 0);

  return {
    partners: results,
    totalContributions,
    totalProjectEquity,
    contributionDelta,
    contributionsReconcile: Math.abs(contributionDelta) <= contribTol,
    shareholdingSum,
    shareholdingReconciles: Math.abs(shareholdingSum - 1) <= 1e-4,
    manualMode,
    isSynthetic,
    streamYearLabels,
    totalStream,
  };
}
