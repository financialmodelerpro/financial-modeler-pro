import type {
  Project,
  Phase,
  FinancingTranche,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type {
  CombinedDebtService,
  DebtEquitySplit,
  FacilityResult,
  ProjectAxis,
} from './types';

function equalPeriodicPayment(principal: number, rate: number, n: number): number {
  if (n <= 0 || principal <= 0) return 0;
  if (rate <= 0) return principal / n;
  const pw = Math.pow(1 + rate, n);
  return principal * (rate * pw) / (pw - 1);
}

function normaliseYoY(raw: number[], n: number): number[] {
  if (n <= 0) return [];
  const padded = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) padded[i] = Math.max(0, raw[i] ?? 0);
  const s = padded.reduce((a, v) => a + v, 0);
  if (s < 1e-9) return new Array(n).fill(100 / n);
  const k = 100 / s;
  return padded.map((v) => v * k);
}

export function computeFacilitySchedule(
  tranche: FinancingTranche,
  project: Project,
  phases: Phase[],
  axis: ProjectAxis,
  debtPerPeriod: number[],
  sharePct: number,
): FacilityResult {
  const N = axis.totalPeriods;
  const drawSchedule       = new Array<number>(N).fill(0);
  const outstanding        = new Array<number>(N).fill(0);
  const interestAccrued    = new Array<number>(N).fill(0);
  const interestCapitalized = new Array<number>(N).fill(0);
  const interestPaid       = new Array<number>(N).fill(0);
  const principalRepaid    = new Array<number>(N).fill(0);

  const periodicRate =
    project.modelType === 'monthly'
      ? Math.max(0, tranche.interestRatePct) / 100 / 12
      : Math.max(0, tranche.interestRatePct) / 100;

  const isExisting = tranche.origin === 'existing';
  const openingBalance = isExisting ? Math.max(0, tranche.openingBalance ?? 0) : 0;
  const rawRepay = isExisting
    ? Math.max(0, tranche.remainingRepaymentPeriods ?? 0)
    : Math.max(0, tranche.repaymentPeriods ?? 0);

  // Pass 24 (2026-05-14): drawdown auto-starts at project Y1 (capex
  // start). The user-facing Drawdown Start Period field is removed;
  // engine always begins draws at index 0.
  if (!isExisting) {
    const frac = sharePct / 100;
    for (let i = 0; i < N; i++) {
      drawSchedule[i] = Math.max(0, debtPerPeriod[i] ?? 0) * frac;
    }
  }

  const totalDrawn = isExisting
    ? openingBalance
    : drawSchedule.reduce((s, v) => s + v, 0);

  const phase = phases.find((p) => p.id === tranche.phaseId) ?? phases[0];
  const phaseOffset = phase ? (axis.phaseOffsets.get(phase.id) ?? 0) : 0;
  const cp = phase?.constructionPeriods ?? 0;
  const overlap = phase?.overlapPeriods ?? 0;
  // Construction window: [phaseOffset, phaseOffset + cp - overlap).
  // No-prior-column convention (2026-05-14): arr[0] = first active year,
  // construction spans cp columns starting at phaseOffset.
  const constructionStartProj = phaseOffset;
  const constructionEndProj = phaseOffset + Math.max(0, cp - overlap);

  const grace = Math.max(0, tranche.gracePeriods ?? 0);
  // Pass 24 (2026-05-14): explicit Repayment Start Year (calendar)
  // from the tranche, translated to project axis index. Falls back to
  // `constructionEnd + grace` when unset (legacy snapshots).
  const projectStartYear = new Date(project.startDate).getUTCFullYear();
  const repayStartProj = isExisting
    ? 0
    : tranche.repaymentStartYear && Number.isFinite(tranche.repaymentStartYear)
      ? Math.max(0, Math.min(N, tranche.repaymentStartYear - projectStartYear))
      : constructionEndProj + grace;

  // Pass 24b (2026-05-14): for fixed-count methods (straight_line,
  // equal_periodic_amortization, balloon, bullet), fall back to the
  // remaining axis tail when the user leaves Repayment Periods at 0.
  // Without this, new tranches produced no principal repayment at all
  // (effRepay === 0 short-circuited every fixed-count branch below).
  const fixedCountMethods = ['straight_line', 'equal_periodic_amortization', 'balloon', 'bullet'];
  const effRepay = rawRepay > 0
    ? rawRepay
    : (!isExisting && fixedCountMethods.includes(tranche.repaymentMethod))
      ? Math.max(0, N - repayStartProj)
      : rawRepay;

  const graceInterestTreatment = tranche.graceInterestTreatment ?? 'capitalize';
  const graceWindowStart = constructionEndProj;
  const graceWindowEnd = constructionEndProj + grace;

  const method = tranche.repaymentMethod;
  const repBudget = new Array<number>(N).fill(0);
  if (method === 'manual') {
    const dist = tranche.repaymentManualDistribution ?? [];
    const dsum = dist.reduce((s, v) => s + Math.max(0, v ?? 0), 0);
    if (dsum > 0) {
      for (let i = 0; i < N; i++) {
        const w = Math.max(0, dist[i] ?? 0) / dsum;
        repBudget[i] = totalDrawn * w;
      }
    }
  } else if (method === 'straight_line' && effRepay > 0) {
    const slice = totalDrawn / effRepay;
    for (let i = 0; i < effRepay && (repayStartProj + i) < N; i++) {
      repBudget[repayStartProj + i] = slice;
    }
  } else if (method === 'equal_periodic_amortization' && effRepay > 0) {
    const pmt = equalPeriodicPayment(totalDrawn, periodicRate, effRepay);
    for (let i = 0; i < effRepay && (repayStartProj + i) < N; i++) {
      repBudget[repayStartProj + i] = pmt;
    }
  } else if (method === 'bullet') {
    const maturity = Math.min(N - 1, repayStartProj + Math.max(0, effRepay) - 1);
    if (maturity >= 0) repBudget[maturity] = totalDrawn;
  } else if (method === 'balloon' && effRepay > 0) {
    const balloonPct = Math.max(0, Math.min(100, tranche.balloonPct ?? 0));
    const balloonAmt = totalDrawn * (balloonPct / 100);
    const remainder = Math.max(0, totalDrawn - balloonAmt);
    const slice = effRepay > 0 ? remainder / effRepay : 0;
    for (let i = 0; i < effRepay && (repayStartProj + i) < N; i++) {
      repBudget[repayStartProj + i] = slice;
    }
    const maturity = Math.min(N - 1, repayStartProj + effRepay - 1);
    if (maturity >= 0) repBudget[maturity] += balloonAmt;
  } else if (method === 'year_on_year_pct') {
    // Pass 24 (2026-05-14): YoY span = repaymentStart through operations
    // end (project axis tail). Repayment Periods field no longer
    // constrains the span for this method; the schedule fills every
    // year from repayStart to N - 1.
    const yoyLen = Math.max(0, N - repayStartProj);
    if (yoyLen > 0) {
      const schedule = normaliseYoY(tranche.yearOnYearPctSchedule ?? [], yoyLen);
      for (let i = 0; i < yoyLen; i++) {
        repBudget[repayStartProj + i] = totalDrawn * (schedule[i] / 100);
      }
    }
  }

  // Pass 24 (2026-05-14): YoY span runs through operations end so its
  // final index is N - 1 regardless of repaymentPeriods. Other methods
  // continue to honour effRepay.
  const finalRepayIdx = method === 'year_on_year_pct'
    ? N - 1
    : effRepay > 0
      ? Math.min(N - 1, repayStartProj + effRepay - 1)
      : N - 1;
  const sweepsAtMaturity =
    method === 'straight_line'
    || method === 'equal_periodic_amortization'
    || method === 'year_on_year_pct'
    || method === 'balloon'
    || method === 'bullet';

  let bal = openingBalance;
  for (let i = 0; i < N; i++) {
    bal += drawSchedule[i];
    const interest = bal * periodicRate;
    interestAccrued[i] = interest;
    const inConstructionWindow = !isExisting && i >= constructionStartProj && i < constructionEndProj;
    const inGraceWindow = !isExisting && i >= graceWindowStart && i < graceWindowEnd;
    let capitalise = false;
    if (inConstructionWindow) {
      capitalise = true;
    } else if (inGraceWindow) {
      capitalise = graceInterestTreatment === 'capitalize' || graceInterestTreatment === 'raise_as_debt';
    }
    if (capitalise) {
      interestCapitalized[i] = interest;
      bal += interest;
    } else {
      interestPaid[i] = interest;
    }
    let pay = Math.min(bal, Math.max(0, repBudget[i] ?? 0));
    if (sweepsAtMaturity && i === finalRepayIdx && pay < bal) pay = bal;
    principalRepaid[i] = pay;
    bal -= pay;
    outstanding[i] = bal;
  }

  return {
    trancheId: tranche.id,
    sharePct,
    drawSchedule,
    outstanding,
    interestAccrued,
    interestCapitalized,
    interestPaid,
    principalRepaid,
    totalDrawn,
    totalInterest: interestAccrued.reduce((s, v) => s + v, 0),
    totalPrincipal: principalRepaid.reduce((s, v) => s + v, 0),
  };
}

export function combineDebtService(
  facilities: Map<string, FacilityResult>,
  axis: ProjectAxis,
): CombinedDebtService {
  const N = axis.totalPeriods;
  const totalDrawdown          = new Array<number>(N).fill(0);
  const totalInterestAccrued   = new Array<number>(N).fill(0);
  const totalInterestCapitalized = new Array<number>(N).fill(0);
  const totalInterestExpensed  = new Array<number>(N).fill(0);
  const totalPrincipalRepaid   = new Array<number>(N).fill(0);
  for (const r of facilities.values()) {
    for (let i = 0; i < N; i++) {
      totalDrawdown[i]            += r.drawSchedule[i] ?? 0;
      totalInterestAccrued[i]     += r.interestAccrued[i] ?? 0;
      totalInterestCapitalized[i] += r.interestCapitalized[i] ?? 0;
      totalInterestExpensed[i]    += r.interestPaid[i] ?? 0;
      totalPrincipalRepaid[i]     += r.principalRepaid[i] ?? 0;
    }
  }
  const debtServiceCash = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    debtServiceCash[i] = totalInterestExpensed[i] + totalPrincipalRepaid[i];
  }
  return {
    totalDrawdown,
    totalInterestAccrued,
    totalInterestCapitalized,
    totalInterestExpensed,
    totalPrincipalRepaid,
    debtServiceCash,
  };
}

