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

  // Pass 27 (2026-05-14): effective interest rate = Interbank Rate +
  // Credit Spread when both are present; otherwise fall back to the
  // legacy single interestRatePct field for back-compat.
  const hasComponents = tranche.interbankRatePct !== undefined || tranche.creditSpreadPct !== undefined;
  const annualRatePct = hasComponents
    ? Math.max(0, (tranche.interbankRatePct ?? 0) + (tranche.creditSpreadPct ?? 0))
    : Math.max(0, tranche.interestRatePct);
  const periodicRate =
    project.modelType === 'monthly'
      ? annualRatePct / 100 / 12
      : annualRatePct / 100;

  const isExisting = tranche.origin === 'existing';
  const projectStartYear = new Date(project.startDate).getUTCFullYear();
  const openingBalanceRaw = isExisting ? Math.max(0, tranche.openingBalance ?? 0) : 0;
  const rawRepay = isExisting
    ? Math.max(0, tranche.remainingRepaymentPeriods ?? 0)
    : Math.max(0, tranche.repaymentPeriods ?? 0);

  // Pass 36 (2026-05-14): existing facilities can be raised inside
  // the project axis. When originationYear >= projectStartYear, the
  // Opening Balance is drawn as a cash inflow at that period instead
  // of carrying as a pre-existing opening balance at i=0.
  const origYear = tranche.originationYear;
  const origIdxRaw = (isExisting && origYear && Number.isFinite(origYear))
    ? origYear - projectStartYear
    : -1;
  const drawAsInflow = isExisting && origIdxRaw >= 0 && origIdxRaw < N;
  const openingBalance = drawAsInflow ? 0 : openingBalanceRaw;

  // Pass 24 (2026-05-14): drawdown auto-starts at project Y1 (capex
  // start). The user-facing Drawdown Start Period field is removed;
  // engine always begins draws at index 0.
  if (!isExisting) {
    const frac = sharePct / 100;
    for (let i = 0; i < N; i++) {
      drawSchedule[i] = Math.max(0, debtPerPeriod[i] ?? 0) * frac;
    }
  } else if (drawAsInflow) {
    // Existing loan raised inside the project axis = cash inflow.
    drawSchedule[origIdxRaw] = openingBalanceRaw;
  }

  const totalDrawn = isExisting
    ? openingBalanceRaw
    : drawSchedule.reduce((s, v) => s + v, 0);

  // Pass 28 (2026-05-14): Tab 4 is project-wide, so the IDC window
  // must be project-wide too. Derive [start, end) as the union of
  // every non-operational phase's construction span. Using a single
  // phase (tranche.phaseId) caused IDC to miss capex happening in
  // other phases - the bank still funded those drawdowns, so their
  // interest is also IDC.
  let constructionStartProj = Number.POSITIVE_INFINITY;
  let constructionEndProj = 0;
  for (const ph of phases) {
    if (ph.status === 'operational') continue;
    const phOffset = axis.phaseOffsets.get(ph.id) ?? 0;
    const phCp = ph.constructionPeriods ?? 0;
    const phOverlap = ph.overlapPeriods ?? 0;
    const phEnd = phOffset + Math.max(0, phCp - phOverlap);
    if (phOffset < constructionStartProj) constructionStartProj = phOffset;
    if (phEnd > constructionEndProj) constructionEndProj = phEnd;
  }
  if (!Number.isFinite(constructionStartProj)) constructionStartProj = 0;

  // Pass 27 (2026-05-14): grace period concept retired; engine treats
  // gracePeriods as 0 unconditionally. Field stays on the schema for
  // legacy snapshot compatibility but no longer affects the schedule.
  const grace = 0;
  // Pass 24 (2026-05-14): explicit Repayment Start Year (calendar)
  // from the tranche, translated to project axis index. Falls back to
  // constructionEnd when unset (legacy snapshots).
  // Pass 36 (2026-05-14): existing facilities now use the same
  // repaymentStartYear field as new debt (was hard-coded to 0).
  // Falls back to project Y0 for legacy existing snapshots.
  const repayStartProj = isExisting
    ? (tranche.repaymentStartYear && Number.isFinite(tranche.repaymentStartYear)
        ? Math.max(0, Math.min(N, tranche.repaymentStartYear - projectStartYear))
        : 0)
    : tranche.repaymentStartYear && Number.isFinite(tranche.repaymentStartYear)
      ? Math.max(0, Math.min(N, tranche.repaymentStartYear - projectStartYear))
      : constructionEndProj + grace;

  // Pass 36 (2026-05-14): existing facility's interestStartYear gates
  // interest accrual. Periods before interestStartYear accrue zero
  // interest. Defaults to projectStartYear when unset.
  const interestStartProj = (isExisting && tranche.interestStartYear && Number.isFinite(tranche.interestStartYear))
    ? Math.max(0, tranche.interestStartYear - projectStartYear)
    : 0;

  // Pass 24b (2026-05-14): for fixed-count methods, fall back to the
  // remaining axis tail when the user leaves Repayment Periods at 0.
  // Without this, new tranches produced no principal repayment at all
  // (effRepay === 0 short-circuited every fixed-count branch below).
  // Pass 28b (2026-05-14): added the user-facing 'equal_repayment'
  // method (with sub-mode equal_total / equal_principal) to the list.
  const fixedCountMethods = [
    'equal_repayment',
    'straight_line',
    'equal_periodic_amortization',
    'balloon',
    'bullet',
  ];
  const effRepay = rawRepay > 0
    ? rawRepay
    : (!isExisting && fixedCountMethods.includes(tranche.repaymentMethod))
      ? Math.max(0, N - repayStartProj)
      : rawRepay;

  // Pass 27 (2026-05-14): grace interest treatment retired. With
  // grace = 0 the grace window is empty, so this block is a no-op.

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
  } else if (method === 'equal_repayment' && effRepay > 0) {
    // Pass 28b (2026-05-14): user-facing Equal Repayment method.
    //   equal_total     = annuity (PMT) - same maths as legacy
    //                     equal_periodic_amortization
    //   equal_principal = straight-line - same as legacy straight_line
    // Default sub-mode is equal_total when unset.
    const subMethod = tranche.equalRepaymentSubMethod ?? 'equal_total';
    if (subMethod === 'equal_principal') {
      const slice = totalDrawn / effRepay;
      for (let i = 0; i < effRepay && (repayStartProj + i) < N; i++) {
        repBudget[repayStartProj + i] = slice;
      }
    } else {
      const pmt = equalPeriodicPayment(totalDrawn, periodicRate, effRepay);
      for (let i = 0; i < effRepay && (repayStartProj + i) < N; i++) {
        repBudget[repayStartProj + i] = pmt;
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
    method === 'equal_repayment'
    || method === 'straight_line'
    || method === 'equal_periodic_amortization'
    || method === 'year_on_year_pct'
    || method === 'balloon'
    || method === 'bullet';

  let bal = openingBalance;
  for (let i = 0; i < N; i++) {
    bal += drawSchedule[i];
    // Pass 36 (2026-05-14): for existing facilities, only accrue
    // interest from interestStartYear onward (defaults to project Y0).
    const accrueInterest = !isExisting || i >= interestStartProj;
    const interest = accrueInterest ? bal * periodicRate : 0;
    interestAccrued[i] = interest;
    const inConstructionWindow = !isExisting && i >= constructionStartProj && i < constructionEndProj;
    const capitalise = inConstructionWindow;
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
    // Pass 28b (2026-05-14): snap rounding remainder to zero so the
    // closing balance UI doesn't show stray ±100s left over from
    // PMT / annuity arithmetic. Threshold ±1000 (raw currency units)
    // per user request - tight enough to catch rounding, loose enough
    // to not mask a real residual.
    if (Math.abs(bal) < 1000) bal = 0;
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
  tranches: FinancingTranche[],
): CombinedDebtService {
  const N = axis.totalPeriods;
  const totalDrawdown          = new Array<number>(N).fill(0);
  const totalInterestAccrued   = new Array<number>(N).fill(0);
  const totalInterestCapitalized = new Array<number>(N).fill(0);
  const totalInterestExpensed  = new Array<number>(N).fill(0);
  const totalPrincipalRepaid   = new Array<number>(N).fill(0);
  // Pass 31 (2026-05-14): existing vs new origin breakdowns.
  const existingInterestAccrued  = new Array<number>(N).fill(0);
  const existingInterestExpensed = new Array<number>(N).fill(0);
  const existingPrincipalRepaid  = new Array<number>(N).fill(0);
  const existingDebtServiceCash  = new Array<number>(N).fill(0);
  const newInterestAccrued       = new Array<number>(N).fill(0);
  const newInterestExpensed      = new Array<number>(N).fill(0);
  const newPrincipalRepaid       = new Array<number>(N).fill(0);
  const newDebtServiceCash       = new Array<number>(N).fill(0);
  const originById = new Map<string, 'existing' | 'new'>();
  for (const t of tranches) {
    originById.set(t.id, t.origin === 'existing' ? 'existing' : 'new');
  }
  for (const r of facilities.values()) {
    const isEx = originById.get(r.trancheId) === 'existing';
    for (let i = 0; i < N; i++) {
      const draw = r.drawSchedule[i] ?? 0;
      const acc  = r.interestAccrued[i] ?? 0;
      const cap  = r.interestCapitalized[i] ?? 0;
      const exp  = r.interestPaid[i] ?? 0;
      const prin = r.principalRepaid[i] ?? 0;
      totalDrawdown[i]            += draw;
      totalInterestAccrued[i]     += acc;
      totalInterestCapitalized[i] += cap;
      totalInterestExpensed[i]    += exp;
      totalPrincipalRepaid[i]     += prin;
      if (isEx) {
        existingInterestAccrued[i]  += acc;
        existingInterestExpensed[i] += exp;
        existingPrincipalRepaid[i]  += prin;
        existingDebtServiceCash[i]  += exp + prin;
      } else {
        newInterestAccrued[i]  += acc;
        newInterestExpensed[i] += exp;
        newPrincipalRepaid[i]  += prin;
        newDebtServiceCash[i]  += exp + prin;
      }
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
    existingInterestAccrued,
    existingInterestExpensed,
    existingPrincipalRepaid,
    existingDebtServiceCash,
    newInterestAccrued,
    newInterestExpensed,
    newPrincipalRepaid,
    newDebtServiceCash,
  };
}

