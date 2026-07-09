/**
 * icReport.ts (REFM Module 7 Reports, Phase 1)
 *
 * Pure assembler for the Investment Committee (IC) report MODEL. It reads the
 * already-computed returns snapshot, financials snapshot, project inputs, phases,
 * assets, parties and (optionally) a case comparison, and returns a structured,
 * display-ready object. It NEVER recomputes engine math: every financial figure
 * is pulled straight from the snapshot. Formatting (currency scale / %) is applied
 * by the renderer, so this stays framework-free and unit-testable.
 *
 * No em dashes in this file.
 */

import type { Project, Asset, Phase, ProjectCase } from '../state/module1-types';
import type { ReturnsSnapshot } from '../returns-resolvers';
import type { ProjectFinancialsSnapshot } from '../financials-resolvers';
import type { Party } from '../parties';
import type { CaseComparisonReport } from './caseComparisonReport';

export interface ICPartyRef { name: string; identifier: string | null }

export interface ICReportModel {
  cover: {
    projectName: string;
    location: string;
    preparedBy: ICPartyRef[];
    asOf: string; // ISO date, stamped by the caller (kept out of this pure fn)
  };
  overview: {
    name: string;
    location: string;
    country: string;
    phaseCount: number;
    phaseNames: string[];
    assetMix: Array<{ name: string; strategy: string }>;
    startYear: number;
    exitYear: number;
    durationYears: number;
    sponsors: ICPartyRef[];
    developers: ICPartyRef[];
    investors: ICPartyRef[];
    contacts: ICPartyRef[];
  };
  headline: {
    projectIrr: number | null;
    projectMoic: number;
    equityIrr: number | null;
    equityMoic: number;
    distributedEquityIrr: number | null;
    equityMultiple: number;
  };
  devEconomics: {
    gdv: number;
    tdc: number;
    financingCost: number;
    profitBeforeFinancing: number;
    profitAfterFinancing: number;
    developmentMargin: number | null;
    costToValue: number | null;
  };
  capital: {
    debtPct: number | null;
    cashEquityPct: number | null;
    inKindEquityPct: number | null;
    customerFundingPct: number | null;
    peakEquity: number;
    totalEquity: number;
    peakDebt: number;
    remainingDebtAtExit: number;
    totalSources: number;
    totalUses: number;
  };
  /** null when there is only the base case (nothing to compare). */
  scenarios: CaseComparisonReport | null;
}

const byRole = (parties: Party[], role: string): ICPartyRef[] =>
  parties.filter((p) => Array.isArray(p.roles) && p.roles.includes(role)).map((p) => ({ name: p.name, identifier: p.identifier ?? null }));

export function buildICReportModel(input: {
  project: Project;
  phases: Phase[];
  assets: Asset[];
  rs: ReturnsSnapshot;
  snap: ProjectFinancialsSnapshot;
  parties: Party[];
  asOf: string;
  scenarios?: CaseComparisonReport | null;
  cases?: ProjectCase[];
}): ICReportModel {
  const { project, phases, assets, rs, parties, asOf } = input;
  const r = rs.result;
  const de = rs.developmentEconomics;
  const su = rs.sourcesUses;
  const fm = rs.fundingMix;
  const ee = rs.equityExposure;
  const da = rs.debtAnalytics;

  const startYear = rs.yearLabels[0] ?? input.snap.projectStartYear;
  const exitYear = rs.exitYearLabel;
  const durationYears = Math.max(1, exitYear - startYear + 1);

  // Scenario comparison only makes sense with more than the base case.
  const hasScenarios = (input.cases?.length ?? 0) > 1;

  return {
    cover: {
      projectName: project.name,
      location: [project.location, project.country].filter(Boolean).join(', '),
      preparedBy: byRole(parties, 'Prepared-by'),
      asOf,
    },
    overview: {
      name: project.name,
      location: project.location ?? '',
      country: project.country ?? '',
      phaseCount: phases.length,
      phaseNames: phases.map((p) => p.name),
      assetMix: assets.filter((a) => a.visible).map((a) => ({ name: a.name, strategy: String(a.strategy) })),
      startYear,
      exitYear,
      durationYears,
      sponsors: byRole(parties, 'Sponsor'),
      developers: byRole(parties, 'Developer'),
      investors: byRole(parties, 'Investor/Equity Partner'),
      contacts: byRole(parties, 'Contact'),
    },
    headline: {
      projectIrr: r.fcff.irr,
      projectMoic: r.fcff.moic,
      equityIrr: r.fcfe.irr,
      equityMoic: r.fcfe.moic,
      distributedEquityIrr: r.dividends.irr,
      equityMultiple: r.realEstate.equityMultiple,
    },
    devEconomics: {
      gdv: de.gdv,
      tdc: de.totalDevelopmentCost,
      financingCost: de.totalFinancingCost,
      profitBeforeFinancing: de.profitBeforeFinancing,
      profitAfterFinancing: de.profitAfterFinancing,
      developmentMargin: de.developmentMargin,
      costToValue: de.costToValue,
    },
    capital: {
      debtPct: fm.debtPct,
      cashEquityPct: fm.cashEquityPct,
      inKindEquityPct: fm.inKindEquityPct,
      customerFundingPct: fm.customerFundingPct,
      peakEquity: ee.equityAtRisk,
      totalEquity: rs.totalEquityInvested,
      peakDebt: da.peakDebt,
      remainingDebtAtExit: da.remainingDebtAtExit,
      totalSources: su.totalSources,
      totalUses: su.totalUses,
    },
    scenarios: hasScenarios ? (input.scenarios ?? null) : null,
  };
}
