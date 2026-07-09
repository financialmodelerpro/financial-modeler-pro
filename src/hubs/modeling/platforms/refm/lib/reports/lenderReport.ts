/**
 * lenderReport.ts (REFM Module 7 Reports, Phase 2)
 *
 * Pure assembler for the Lender Package report MODEL. Reads the already-computed
 * returns + financials snapshots plus project facility terms and covenant
 * thresholds, and returns a structured, display-ready object. NEVER recomputes
 * engine math: facility terms, sources & uses, the repayment / cash-sweep
 * schedule, key cash flows and the covenant per-period series are all pulled
 * straight from the snapshot. The covenant evaluation reuses the SAME pure
 * lib/covenants.ts the RE Metrics tab uses, so verdicts cannot drift.
 *
 * No em dashes in this file.
 */

import type { Project, FinancingTranche } from '../state/module1-types';
import { DEFAULT_COVENANTS, type CovenantThreshold } from '../state/module1-types';
import type { ReturnsSnapshot } from '../returns-resolvers';
import type { ProjectFinancialsSnapshot } from '../financials-resolvers';
import type { Party } from '../parties';
import { evaluateCovenant, type CovenantInputs } from '../covenants';

export interface LenderFacility {
  name: string;
  interestRatePct: number;
  ltvPct: number;
  facilitySharePct: number | null;
  sweepRatioPct: number | null;
}

export interface LenderCovenantRow {
  id: string;
  label: string;
  metric: string;
  operator: 'min' | 'max';
  threshold: number;
  unit: 'x' | 'pct';
  seriesPerPeriod: Array<number | null>;
  worst: number | null;
  avg: number | null;
  pass: boolean | null;
  basisLabel?: string;
  exitOnly: boolean;
}

export interface LenderReportModel {
  cover: { projectName: string; location: string; asOf: string };
  yearLabels: number[];
  facilities: LenderFacility[];
  capital: {
    debtPct: number | null;
    cashEquityPct: number | null;
    inKindEquityPct: number | null;
    customerFundingPct: number | null;
    peakDebt: number;
    remainingDebtAtExit: number;
    tenorYears: number | null;
    totalEquity: number;
    peakEquity: number;
  };
  sourcesUses: {
    sources: Array<{ label: string; value: number }>;
    uses: Array<{ label: string; value: number }>;
    totalSources: number;
    totalUses: number;
  };
  repayment: {
    drawdown: number[];
    interest: number[];
    principal: number[];
    sweep: number[];
    debtOutstanding: number[];
  };
  keyCashFlows: {
    cfo: number[];
    cfi: number[];
    cff: number[];
    closing: number[];
  };
  covenants: LenderCovenantRow[];
}

export function buildLenderReportModel(input: {
  project: Project;
  financingTranches: FinancingTranche[];
  rs: ReturnsSnapshot;
  snap: ProjectFinancialsSnapshot;
  parties: Party[];
  asOf: string;
}): LenderReportModel {
  const { project, financingTranches, rs, snap, asOf } = input;
  const su = rs.sourcesUses;
  const fm = rs.fundingMix;
  const da = rs.debtAnalytics;
  const ee = rs.equityExposure;
  const m = rs.result.realEstate;
  const dcf = snap.directCF;
  const bs = snap.bs;

  const covenantInputs: CovenantInputs = {
    dscrPerPeriod: m.dscrPerPeriod,
    icrPerPeriod: m.icrPerPeriod,
    noiPerPeriod: rs.noiPerPeriod,
    debtOutstandingPerPeriod: bs.debtOutstandingPerPeriod,
    gdvValue: rs.developmentEconomics.gdv,
    ltvAtExit: m.ltvAtExit,
  };
  const covenants = (project.covenants ?? DEFAULT_COVENANTS).map((cov: CovenantThreshold): LenderCovenantRow => {
    const ev = evaluateCovenant(cov, covenantInputs);
    return {
      id: cov.id, label: cov.label, metric: cov.metric, operator: cov.operator, threshold: cov.threshold,
      unit: ev.unit, seriesPerPeriod: ev.seriesPerPeriod, worst: ev.worst, avg: ev.avg, pass: ev.pass,
      basisLabel: ev.basisLabel, exitOnly: ev.exitOnly,
    };
  });

  const facilities: LenderFacility[] = (financingTranches ?? []).map((t) => ({
    name: t.name,
    interestRatePct: t.interestRatePct ?? 0,
    ltvPct: t.ltvPct ?? 0,
    facilitySharePct: Number.isFinite(t.facilitySharePct) ? (t.facilitySharePct as number) : null,
    sweepRatioPct: Number.isFinite(t.sweepRatio) ? (t.sweepRatio as number) : null,
  }));

  return {
    cover: { projectName: project.name, location: [project.location, project.country].filter(Boolean).join(', '), asOf },
    yearLabels: rs.yearLabels,
    facilities,
    capital: {
      debtPct: fm.debtPct, cashEquityPct: fm.cashEquityPct, inKindEquityPct: fm.inKindEquityPct, customerFundingPct: fm.customerFundingPct,
      peakDebt: da.peakDebt, remainingDebtAtExit: da.remainingDebtAtExit, tenorYears: da.tenorYears,
      totalEquity: rs.totalEquityInvested, peakEquity: ee.equityAtRisk,
    },
    sourcesUses: {
      sources: [
        { label: 'Existing Equity', value: su.existingEquity },
        { label: 'New Cash Equity', value: su.newEquityCash },
        { label: 'In-Kind Equity', value: su.inKindEquity },
        { label: 'Existing Debt', value: su.existingDebt },
        { label: 'New Debt', value: su.newDebt },
        { label: 'Customer Collections', value: su.customerCollections },
        { label: 'Operating Cash', value: su.operatingCash },
      ],
      uses: [
        { label: 'Land', value: su.land },
        { label: 'Construction', value: su.construction },
        { label: 'IDC (capitalised)', value: su.idc },
        { label: 'Reserves / Distributions', value: su.reservesDistributions },
      ],
      totalSources: su.totalSources,
      totalUses: su.totalUses,
    },
    repayment: {
      drawdown: dcf.debtDrawdownPerPeriod ?? [],
      interest: dcf.interestPaidPerPeriod ?? [],
      principal: dcf.debtRepaymentPerPeriod ?? [],
      sweep: snap.cashSweep?.totalSweepPerPeriod ?? [],
      debtOutstanding: bs.debtOutstandingPerPeriod ?? [],
    },
    keyCashFlows: {
      cfo: dcf.cashFromOperationsPerPeriod ?? [],
      cfi: dcf.cashFromInvestmentPerPeriod ?? [],
      cff: dcf.cashFromFinancingPerPeriod ?? [],
      closing: dcf.closingCashPerPeriod ?? [],
    },
    covenants,
  };
}
