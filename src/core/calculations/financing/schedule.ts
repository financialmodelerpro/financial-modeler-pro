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
  /** Conditional IDC (2026-06-02): MUTABLE per-period cash budget shared
   *  across all tranches in the orchestrator loop. When fundingMode is
   *  'conditional', each construction period pays interest in cash up to
   *  the remaining budget (decrementing it) and capitalises the shortfall
   *  to debt. Absent / undefined => behaves like 'debt_drawdown'. */
  remainingIdcBudget?: number[],
  /** Cash-sweep budget (2026-06-02): MUTABLE per-period cash available for
   *  debt repayment, shared across tranches in the orchestrator loop (in
   *  existing-first / priority order). A sweep-eligible tranche repays
   *  principal from this budget each period from its starting year, reducing
   *  the balance so interest follows (no phantom interest on a swept-to-zero
   *  balance). The sweep is now part of the ENGINE schedule (single source of
   *  truth), not a downstream overlay. */
  remainingSweepBudget?: number[],
  /** IDC classification input (2026-08-18): project construction spend per
   *  period. A period with spend is a period whose finance cost is IDC. Taken
   *  from the capex aggregate, which is computed BEFORE the debt schedule and
   *  reads no debt input, so this stays acyclic: IDC does not size capex, it
   *  only asks whether capex is happening. */
  constructionSpendByPeriod?: number[],
): FacilityResult {
  const N = axis.totalPeriods;
  const drawSchedule       = new Array<number>(N).fill(0);
  const outstanding        = new Array<number>(N).fill(0);
  const interestAccrued    = new Array<number>(N).fill(0);
  const interestCapitalized = new Array<number>(N).fill(0);
  const interestCapitalizedCashPaid = new Array<number>(N).fill(0);
  const interestPaid       = new Array<number>(N).fill(0);
  const interestForAssetBasis = new Array<number>(N).fill(0);
  const interestDuringConstruction = new Array<number>(N).fill(0);
  const principalRepaid    = new Array<number>(N).fill(0);
  const sweepRepaid        = new Array<number>(N).fill(0);

  // 2026-08-18: `idcConfig.capitalize` and `idcConfig.fundingMode` are RETIRED.
  // There is one treatment (see the IDC block below), so two projects can no
  // longer behave differently. The fields stay on the type, deprecated, so old
  // snapshots still load; nothing reads them. `allocationBasis` survives and
  // is read in financials-resolvers: it splits IDC ACROSS assets and changes
  // no project-level total, so it is an allocation choice, not a treatment.

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

  // The end of the construction span, as the union over every non-operational
  // phase. 2026-08-18: this NO LONGER GATES IDC, which is now driven by actual
  // construction spend per period (see the IDC block below). It survives only
  // as the default first repayment period and the sweep start, which are
  // genuinely schedule dates rather than a classification of interest.
  let constructionEndProj = 0;
  for (const ph of phases) {
    if (ph.status === 'operational') continue;
    const phOffset = axis.phaseOffsets.get(ph.id) ?? 0;
    const phCp = ph.constructionPeriods ?? 0;
    const phOverlap = ph.overlapPeriods ?? 0;
    const phEnd = phOffset + Math.max(0, phCp - phOverlap);
    if (phEnd > constructionEndProj) constructionEndProj = phEnd;
  }

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

  // Cash sweep (2026-06-02): now applied IN the engine so the balance
  // (and hence interest) follows the sweep. A tranche is sweep-eligible when
  // its repayment method is cash_sweep OR cashSweepConfig.enabled. It repays
  // principal from the shared sweep budget each period from its start year
  // (default: repayment start), capped by sweepRatio and its outstanding.
  const sweepCfg = tranche.cashSweepConfig ?? {};
  const sweepEligible = tranche.repaymentMethod === 'cash_sweep'
    || tranche.repaymentMethod === 'cashsweep_from_period'
    || tranche.repaymentMethod === 'cashsweep_min_cash'
    || sweepCfg.enabled === true;
  // Cash sweep settings are PROJECT-LEVEL (2026-06-03): one Starting Year +
  // Sweep Ratio applied to every sweep loan, instead of three per-loan inputs.
  // Precedence: project-level cashSweep > legacy per-tranche cashSweepConfig
  // (back-compat) > default. The sweep starts AFTER capex by default
  // (constructionEndProj = first post-construction year): you fund construction
  // first, then sweep operating surplus. constructionEndProj is 0 for
  // all-operational projects (no capex window), so they sweep from year 0.
  const projectSweep = project.financing?.cashSweep ?? {};
  const effSweepStartYear = projectSweep.startingYear ?? sweepCfg.startingYear;
  const sweepStartProj = effSweepStartYear !== undefined && Number.isFinite(effSweepStartYear)
    ? Math.max(0, Math.min(N - 1, effSweepStartYear - projectStartYear))
    : Math.max(0, Math.min(N - 1, constructionEndProj));
  const effSweepRatioPct = projectSweep.sweepRatioPct ?? sweepCfg.sweepRatio ?? 100;
  const sweepRatio = Math.max(0, Math.min(1, effSweepRatioPct / 100));

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
  // Annuity methods build repBudget as the LEVEL DEBT SERVICE (principal +
  // interest); the balance loop must therefore book only the PRINCIPAL
  // portion (service − interest) as a repayment, not the whole payment.
  // 'equal_principal' / 'straight_line' / YoY / bullet / balloon already put
  // principal-only amounts in repBudget.
  const equalSubMethod = tranche.equalRepaymentSubMethod ?? 'equal_total';
  const isAnnuity = method === 'equal_periodic_amortization'
    || (method === 'equal_repayment' && equalSubMethod === 'equal_total');
  const repBudget = new Array<number>(N).fill(0);
  if (method === 'manual') {
    // M4 Pass 2h: prefer the year-keyed sibling when present; expand
    // to an axis-indexed array for the engine. Fall back to the legacy
    // axis-indexed array for back-compat.
    let dist: number[];
    if (tranche.repaymentManualDistributionByYear !== undefined) {
      dist = new Array<number>(N).fill(0);
      for (let i = 0; i < N; i++) {
        dist[i] = tranche.repaymentManualDistributionByYear[String(projectStartYear + i)] ?? 0;
      }
    } else {
      dist = tranche.repaymentManualDistribution ?? [];
    }
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
    const subMethod = equalSubMethod;
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
    // ── IDC, ONE TREATMENT (2026-08-18) ───────────────────────────────────
    //
    // THE SPLIT IS DRIVEN BY CONSTRUCTION SPEND, NOT BY A WINDOW OR A FLAG.
    // While construction is running in a period, that period's finance cost is
    // IDC; once it stops, the same facility's interest is an operating finance
    // cost. Previously the test was a phase-date WINDOW, and the two disagree
    // whenever spend runs past the window or a phase's window ends while
    // another phase is still building. Measured on the live project: 2030
    // carried 79,254k of construction spend and 18,933k of interest, and one
    // facility's share of that was already outside its own phase window.
    //
    // IDC IS PAID IN THE PERIOD IT ARISES. Debt is drawn only for the part
    // cash cannot cover, which is IDC less the headroom above the minimum cash
    // target (`remainingIdcBudget`, filled by the orchestrator). That is a
    // funding fact, not a policy: the project pays what it can and borrows the
    // rest. The three old toggles (capitalize / fundingMode / the implicit
    // window) are gone; `capitalizeInterest` is now always true.
    //
    // THE FULL FINANCE COST IS PAID EACH PERIOD. 2026-08-18c, reverting the
    // 2026-08-18b "cash only" change after reading the reference model.
    //
    // The reference settles the whole charge in cash and draws debt for the
    // shortfall, and its closing-cash formula proves it: it subtracts the FULL
    // finance cost and adds the TOTAL drawdown, capex plus IDC. Capitalising is
    // an ACCOUNTING routing (the charge lands in asset cost, cost of sales and
    // fixed assets via `interestForAssetBasis`), NOT a way of avoiding the
    // payment, so the IDC drawdown is a real cash inflow and not a memo.
    //
    // 2026-08-18b went the other way to fix the Finance Cost ledger, which was
    // walking to a stuck negative. That ledger was the thing at fault: it
    // deducted BOTH `Paid` and `Capitalized` from an interest payable, and once
    // the charge is fully paid the capitalised figure is a DEBT DRAWDOWN, not a
    // second settlement. The ledger is fixed where it broke instead.
    //
    // The first version of this block set `interestPaid = interest` (the whole
    // charge) and treated the capitalised slice as a matching drawdown, on the
    // reasoning that the interest is "paid, funded by debt". Cash-neutral, and
    // wrong the same way M4 Pass 2P was wrong about capex and in-kind equity:
    // BOTH gross lines were overstated by the capitalised amount and the error
    // cancelled in closing cash, so nothing caught it. What DID break was the
    // Finance Cost ledger, whose stated invariant is
    //     Opening + Accrued - Capitalised - Paid = Closing
    // and which walked to a stuck -21,525 on the live project, exactly the
    // capitalised total, because that slice was removed twice.
    //
    // The capitalised slice never moves cash: it increases the debt balance and
    // leaves as PRINCIPAL later. So `interestPaid` carries only what actually
    // left the bank, and `interestCapitalized` is a non-cash balance movement.
    // The gross presentation the returns build-up wants (full charge deducted,
    // IDC drawdown added back) is built in the FCFE chain, not here.
    const constructionRunning = !isExisting && (constructionSpendByPeriod?.[i] ?? 0) > 0;
    if (constructionRunning) {
      interestDuringConstruction[i] = interest;
      interestForAssetBasis[i] = interest;
      // Paid in full; debt is drawn only for the part cash cannot cover.
      interestPaid[i] = interest;
      const avail = Math.max(0, remainingIdcBudget?.[i] ?? 0);
      const fromCash = Math.min(interest, avail);
      const drawnForIdc = interest - fromCash;
      if (fromCash > 0) {
        interestCapitalizedCashPaid[i] = fromCash;
        if (remainingIdcBudget) remainingIdcBudget[i] = avail - fromCash;
      }
      if (drawnForIdc > 0) {
        interestCapitalized[i] = drawnForIdc;
        bal += drawnForIdc;
      }
    } else {
      interestPaid[i] = interest;
    }
    // Annuity (level debt service): principal portion = service − interest.
    // All other methods put principal-only amounts in repBudget.
    const scheduled = Math.max(0, repBudget[i] ?? 0);
    let pay = isAnnuity
      ? Math.min(bal, Math.max(0, scheduled - interest))
      : Math.min(bal, scheduled);
    if (sweepsAtMaturity && i === finalRepayIdx && pay < bal) pay = bal;
    principalRepaid[i] = pay;
    bal -= pay;
    // Cash sweep (2026-06-02): repay additional principal from the shared
    // cash-available-for-debt budget, from the tranche's start year, capped
    // by sweepRatio and the remaining balance. Reduces bal so the NEXT
    // period's interest accrues on the swept balance (no phantom interest).
    if (sweepEligible && i >= sweepStartProj && bal > 0 && remainingSweepBudget) {
      const avail = Math.max(0, remainingSweepBudget[i] ?? 0);
      const sweepPay = Math.min(bal, avail * sweepRatio, avail);
      if (sweepPay > 0) {
        sweepRepaid[i] = sweepPay;
        principalRepaid[i] += sweepPay;
        bal -= sweepPay;
        remainingSweepBudget[i] = avail - sweepPay;
      }
    }
    // Pass 28b (2026-05-14): snap the rounding remainder to zero so the
    // closing balance doesn't show stray dust left over from PMT / annuity
    // arithmetic. RELATIVE tolerance (≤ 1000) so it never eats a real
    // outstanding balance on a small facility (2026-06-02 audit).
    const snapTol = Math.max(1, Math.min(1000, (totalDrawn + Math.max(0, openingBalance)) * 1e-4));
    if (Math.abs(bal) < snapTol) bal = 0;
    outstanding[i] = bal;
  }

  return {
    trancheId: tranche.id,
    sharePct,
    drawSchedule,
    outstanding,
    openingBalance,
    interestAccrued,
    interestCapitalized,
    interestCapitalizedCashPaid,
    interestPaid,
    interestForAssetBasis,
    interestDuringConstruction,
    principalRepaid,
    sweepRepaid,
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
  const totalIdcDrawdown       = new Array<number>(N).fill(0);
  const totalDrawdownAll       = new Array<number>(N).fill(0);
  const totalInterestPaid      = new Array<number>(N).fill(0);
  const totalIdc               = new Array<number>(N).fill(0);
  const totalOperatingInterest = new Array<number>(N).fill(0);
  const totalInterestAccrued   = new Array<number>(N).fill(0);
  const totalInterestCapitalized = new Array<number>(N).fill(0);
  const totalInterestCapitalizedCashPaid = new Array<number>(N).fill(0);
  const totalInterestExpensed  = new Array<number>(N).fill(0);
  const totalInterestForAssetBasis = new Array<number>(N).fill(0);
  const totalPrincipalRepaid   = new Array<number>(N).fill(0);
  const totalSweepRepaid       = new Array<number>(N).fill(0);
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
      const capCash = r.interestCapitalizedCashPaid[i] ?? 0;
      const cash = r.interestPaid[i] ?? 0;
      const ab   = r.interestForAssetBasis[i] ?? 0;
      const prin = r.principalRepaid[i] ?? 0;
      const swp  = r.sweepRepaid[i] ?? 0;
      const idcHere = r.interestDuringConstruction[i] ?? 0;
      totalDrawdown[i]               += draw;
      totalIdcDrawdown[i]            += cap;
      totalDrawdownAll[i]            += draw + cap;
      totalInterestPaid[i]           += cash;
      totalIdc[i]                    += idcHere;
      totalOperatingInterest[i]      += Math.max(0, acc - idcHere);
      totalInterestAccrued[i]        += acc;
      totalInterestCapitalized[i]    += cap;
      totalInterestCapitalizedCashPaid[i] += capCash;
      totalInterestForAssetBasis[i]  += ab;
      totalPrincipalRepaid[i]        += prin;
      totalSweepRepaid[i]            += swp;
      // M4 Pass 2O: P&L expense = accrual basis = accrued - asset basis.
      // When capitalize=true (default), construction interest goes to
      // asset basis and the P&L line is 0 during construction. When
      // capitalize=false, all accrued interest hits P&L (whether funded
      // by debt or cash).
      const exp = acc - ab;
      totalInterestExpensed[i] += exp;
      if (isEx) {
        existingInterestAccrued[i]  += acc;
        existingInterestExpensed[i] += exp;
        existingPrincipalRepaid[i]  += prin;
        // Cash debt service = actual cash out for interest + principal.
        existingDebtServiceCash[i]  += cash + prin;
      } else {
        newInterestAccrued[i]  += acc;
        newInterestExpensed[i] += exp;
        newPrincipalRepaid[i]  += prin;
        newDebtServiceCash[i]  += cash + prin;
      }
    }
  }
  const debtServiceCash = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    // 2026-08-18: SUMMED, not derived. This was
    // `(accrued - capitalized) + principal`, which was only correct while
    // capitalised interest was interest that never got paid. IDC is now paid in
    // the period it arises and the capitalised figure is the DRAWDOWN that
    // funds it, so the old derivation would have understated cash interest by
    // exactly the IDC drawdown. Closing cash is unaffected either way, because
    // the drawdown comes back in on the financing line.
    debtServiceCash[i] = totalInterestPaid[i] + totalPrincipalRepaid[i];
  }
  return {
    totalDrawdown,
    totalIdcDrawdown,
    totalDrawdownAll,
    totalInterestPaid,
    totalIdc,
    totalOperatingInterest,
    totalInterestAccrued,
    totalInterestCapitalized,
    totalInterestCapitalizedCashPaid,
    totalInterestExpensed,
    totalInterestForAssetBasis,
    totalPrincipalRepaid,
    totalSweepRepaid,
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

