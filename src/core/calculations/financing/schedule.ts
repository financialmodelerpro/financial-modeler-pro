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
  const N = axis.totalPeriods + 1;
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
  const effRepay = isExisting
    ? Math.max(0, tranche.remainingRepaymentPeriods ?? 0)
    : Math.max(0, tranche.repaymentPeriods ?? 0);

  const drawStart = Math.max(0, Math.floor(tranche.drawdownStartPeriod ?? 0));
  if (!isExisting) {
    const frac = sharePct / 100;
    for (let i = drawStart; i < N; i++) {
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
  const constructionEndProj = phaseOffset + Math.max(0, cp - overlap);

  const grace = Math.max(0, tranche.gracePeriods ?? 0);
  const repayStartProj = isExisting ? 0 : constructionEndProj + grace;

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
  } else if (method === 'year_on_year_pct' && effRepay > 0) {
    const schedule = normaliseYoY(tranche.yearOnYearPctSchedule ?? [], effRepay);
    for (let i = 0; i < effRepay && (repayStartProj + i) < N; i++) {
      repBudget[repayStartProj + i] = totalDrawn * (schedule[i] / 100);
    }
  }

  const finalRepayIdx = effRepay > 0
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
    const inConstructionWindow = !isExisting && i < constructionEndProj;
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
  const N = axis.totalPeriods + 1;
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

