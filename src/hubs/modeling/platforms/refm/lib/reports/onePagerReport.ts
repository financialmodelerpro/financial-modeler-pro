/**
 * onePagerReport.ts (REFM Module 7 Reports, Phase 2)
 *
 * Pure assembler for the Investor One-Pager report MODEL. Compact deal summary:
 * deal-at-a-glance, headline returns, capital ask, timeline, asset mix, and a
 * short thesis line plus prepared-by / contact from the parties. NEVER recomputes
 * engine math: every figure is read from the snapshot (mostly the same Overview
 * sources as the IC report).
 *
 * No em dashes in this file.
 */

import type { Project, Asset, Phase } from '../state/module1-types';
import type { ReturnsSnapshot } from '../returns-resolvers';
import type { ProjectFinancialsSnapshot } from '../financials-resolvers';
import type { Party } from '../parties';

export interface OnePagerPartyRef { name: string; identifier: string | null }

export interface OnePagerReportModel {
  dealAtAGlance: {
    projectName: string;
    location: string;
    phaseCount: number;
    assetMix: Array<{ name: string; strategy: string }>;
  };
  headline: {
    projectIrr: number | null;
    equityIrr: number | null;
    equityMultiple: number;
    projectMoic: number;
  };
  capitalAsk: {
    totalEquity: number;
    peakEquity: number;
    peakDebt: number;
    debtPct: number | null;
    equityPct: number | null;
  };
  timeline: { startYear: number; exitYear: number; durationYears: number };
  assetMix: Array<{ name: string; strategy: string }>;
  thesisLine: string;
  preparedBy: OnePagerPartyRef[];
  contacts: OnePagerPartyRef[];
}

const byRole = (parties: Party[], role: string): OnePagerPartyRef[] =>
  parties.filter((p) => Array.isArray(p.roles) && p.roles.includes(role)).map((p) => ({ name: p.name, identifier: p.identifier ?? null }));

export function buildOnePagerReportModel(input: {
  project: Project;
  phases: Phase[];
  assets: Asset[];
  rs: ReturnsSnapshot;
  snap: ProjectFinancialsSnapshot;
  parties: Party[];
  thesisLine: string;
  asOf: string;
}): OnePagerReportModel {
  const { project, phases, assets, rs, parties, thesisLine } = input;
  const r = rs.result;
  const fm = rs.fundingMix;
  const startYear = rs.yearLabels[0] ?? input.snap.projectStartYear;
  const exitYear = rs.exitYearLabel;
  const assetMix = assets.filter((a) => a.visible).map((a) => ({ name: a.name, strategy: String(a.strategy) }));
  const equityPct = (fm.cashEquityPct ?? 0) + (fm.inKindEquityPct ?? 0);

  return {
    dealAtAGlance: {
      projectName: project.name,
      location: [project.location, project.country].filter(Boolean).join(', '),
      phaseCount: phases.length,
      assetMix,
    },
    headline: {
      projectIrr: r.fcff.irr,
      equityIrr: r.fcfe.irr,
      equityMultiple: r.realEstate.equityMultiple,
      projectMoic: r.fcff.moic,
    },
    capitalAsk: {
      totalEquity: rs.totalEquityInvested,
      peakEquity: rs.equityExposure.equityAtRisk,
      peakDebt: rs.debtAnalytics.peakDebt,
      debtPct: fm.debtPct,
      equityPct: Number.isFinite(equityPct) ? equityPct : null,
    },
    timeline: { startYear, exitYear, durationYears: Math.max(1, exitYear - startYear + 1) },
    assetMix,
    thesisLine,
    preparedBy: byRole(parties, 'Prepared-by'),
    contacts: byRole(parties, 'Contact'),
  };
}
