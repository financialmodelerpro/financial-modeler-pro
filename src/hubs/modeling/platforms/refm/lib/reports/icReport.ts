/**
 * icReport.ts (REFM Module 7 Reports, IC rebuild A+B)
 *
 * Pure assembler for the Investment Committee (IC) report MODEL, rebuilt to full
 * IC-grade depth. It reads the already-computed returns + financials snapshots,
 * project inputs, phases, assets, sub-units, parties and (optionally) a case
 * comparison, and returns a structured, display-ready object. It NEVER recomputes
 * engine math: every financial figure is pulled straight from the snapshot.
 * Formatting (currency scale / %) is applied by the renderer, so this stays
 * framework-free and unit-testable.
 *
 * AUTO sections feed from verified snapshot paths. The `icSectionOmitted`
 * predicate is the SINGLE source of truth for auto-omit: a section renders only
 * when its model data exists and is non-trivial (or its FORM field is non-empty),
 * shared by BOTH the on-screen preview and the PPT export so they never diverge.
 *
 * No em dashes in this file.
 */

import type { Project, Asset, Phase, ProjectCase, SubUnit } from '../state/module1-types';
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import type { ReturnsSnapshot } from '../returns-resolvers';
import type { ProjectFinancialsSnapshot } from '../financials-resolvers';
import type { Party } from '../parties';
import type { CaseComparisonReport } from './caseComparisonReport';
import type { ReportInputs, ICSectionKey } from '../reportInputs';

export interface ICPartyRef { name: string; identifier: string | null }
export interface ICKeyValue { label: string; value: number }
export interface ICBridgeRow { label: string; value: number; emphasis?: boolean }
export interface ICAssetRow { name: string; strategy: string; phaseName: string; bua: number; units: number }
export interface ICStrategyShare { strategy: string; bua: number; pct: number }
export interface ICPhaseRow { name: string; startYear: number | null; strategies: string; assetNames: string[]; assetCount: number; capex: number }
export interface ICExitRow { year: number; equityValue: number; projectIrr: number | null; equityIrr: number | null; equityMoic: number; selected: boolean }
/** One swimlane in the development-programme Gantt: a phase's construction and
 *  (optional) operations windows in calendar years, across the model horizon. */
export interface ICProgrammeLane {
  name: string;
  strategies: string;
  constructionStart: number;
  constructionEnd: number;
  operationsStart: number | null;
  operationsEnd: number | null;
}

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
    landAreaSqm: number;
    totalBua: number;
    strategyMix: string;
    fundingMethodLabel: string;
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
    terminalEquity: number;
  };
  /** Investment recommendation: the ask, driven by the model. */
  ask: {
    equityCommitment: number;
    existingEquity: number;
    inKindEquity: number;
    peakDebt: number;
    existingDebt: number;
    newDebt: number;
    paydownPct: number | null;
    projectIrr: number | null;
    equityIrr: number | null;
    equityMoic: number;
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
  valueBridge: ICBridgeRow[];
  costStack: ICBridgeRow[];
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
  sourcesUses: {
    sources: ICKeyValue[];
    uses: ICKeyValue[];
    totalSources: number;
    totalUses: number;
  };
  financing: {
    hasDebt: boolean;
    fundingMethodLabel: string;
    existingDebt: number;
    newDebt: number;
    peakDebt: number;
    tenorYears: number | null;
    paydownPct: number | null;
    remainingDebtAtExit: number;
    customerCollections: number;
    minCashReserve: number;
  };
  reMetrics: {
    yieldOnCost: number | null;
    capRateAtExit: number | null;
    profitOnCost: number | null;
    cashOnCashAvg: number | null;
    dscrMin: number | null;
    ltvAtExit: number | null;
  };
  assetMix: {
    rows: ICAssetRow[];
    byStrategy: ICStrategyShare[];
    totalBua: number;
    totalUnits: number;
  };
  phasing: ICPhaseRow[];
  exitYears: ICExitRow[];
  sensitivity: {
    xVariable: string;
    yVariable: string;
    xValues: number[];
    yValues: number[];
    irr: (number | null)[][];
    baseEquityIrr: number | null;
    hasData: boolean;
  };
  /** Chart-ready series (Phase C). Both the preview (Recharts) and the PPT export
   *  (native Office charts) read these SAME numbers so the two never diverge.
   *  Each series carries a hasData flag that mirrors the section auto-omit. */
  charts: {
    costStack: { land: number; construction: number; financing: number };
    revenueRecognition: { yearLabels: number[]; sales: number[]; hospitality: number[]; retail: number[]; hasData: boolean };
    debtBalance: { yearLabels: number[]; values: number[]; peak: number; hasData: boolean };
    exitMoic: { years: number[]; moic: number[]; hasData: boolean };
  };
  /** Development-programme Gantt (Phase D): phase windows + key markers. */
  programme: {
    startYear: number;
    exitYear: number;
    debtRepaidYear: number | null;
    lanes: ICProgrammeLane[];
  };
  /** null when there is only the base case (nothing to compare). */
  scenarios: CaseComparisonReport | null;
}

const byRole = (parties: Party[], role: string): ICPartyRef[] =>
  parties.filter((p) => Array.isArray(p.roles) && p.roles.includes(role)).map((p) => ({ name: p.name, identifier: p.identifier ?? null }));

const assetBua = (a: Asset): number => (a.buaTotal ?? a.buaSqm ?? 0);
const yearOf = (iso: string | undefined, fallback: number): number => {
  if (!iso) return fallback;
  const y = Number(String(iso).slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : fallback;
};

export function buildICReportModel(input: {
  project: Project;
  phases: Phase[];
  assets: Asset[];
  subUnits?: SubUnit[];
  rs: ReturnsSnapshot;
  snap: ProjectFinancialsSnapshot;
  parties: Party[];
  asOf: string;
  scenarios?: CaseComparisonReport | null;
  cases?: ProjectCase[];
}): ICReportModel {
  const { project, phases, assets, subUnits = [], rs, snap, parties, asOf } = input;
  const r = rs.result;
  const de = rs.developmentEconomics;
  const su = rs.sourcesUses;
  const fm = rs.fundingMix;
  const ee = rs.equityExposure;
  const da = rs.debtAnalytics;
  const reMx = r.realEstate;

  const startYear = rs.yearLabels[0] ?? snap.projectStartYear;
  const exitYear = rs.exitYearLabel;
  const durationYears = Math.max(1, exitYear - startYear + 1);
  const hasScenarios = (input.cases?.length ?? 0) > 1;

  const visibleAssets = assets.filter((a) => a.visible);
  const phaseName = (phaseId: string): string => phases.find((p) => p.id === phaseId)?.name ?? '';
  const subUnitsForAsset = (assetId: string): number => subUnits.filter((su2) => su2.assetId === assetId).length;

  // ── Asset mix ──
  const assetRows: ICAssetRow[] = visibleAssets.map((a) => ({
    name: a.name,
    strategy: String(a.strategy),
    phaseName: phaseName(a.phaseId),
    bua: assetBua(a),
    units: subUnitsForAsset(a.id),
  }));
  const totalBua = assetRows.reduce((s, x) => s + x.bua, 0);
  const totalUnits = assetRows.reduce((s, x) => s + x.units, 0);
  const stratMap = new Map<string, number>();
  for (const a of visibleAssets) stratMap.set(String(a.strategy), (stratMap.get(String(a.strategy)) ?? 0) + assetBua(a));
  const byStrategy: ICStrategyShare[] = [...stratMap.entries()]
    .map(([strategy, bua]) => ({ strategy, bua, pct: totalBua > 0 ? bua / totalBua : 0 }))
    .sort((x, y) => y.bua - x.bua);
  // Strategy mix summary string "3 Operate, 2 Sell, ...".
  const stratCount = new Map<string, number>();
  for (const a of visibleAssets) stratCount.set(String(a.strategy), (stratCount.get(String(a.strategy)) ?? 0) + 1);
  const strategyMix = [...stratCount.entries()].map(([s, n]) => `${n} ${s}`).join(', ');

  // ── Phasing (per-phase capex from per-asset CF, abs cash) ──
  const assetCapex = (assetId: string): number => {
    const cf = snap.perAssetCF && typeof snap.perAssetCF.get === 'function' ? snap.perAssetCF.get(assetId) : undefined;
    if (!cf || !Array.isArray(cf.capexPerPeriod)) return 0;
    return cf.capexPerPeriod.reduce((s, v) => s + Math.abs(v ?? 0), 0);
  };
  const phasing: ICPhaseRow[] = phases.map((ph) => {
    const phaseAssets = visibleAssets.filter((a) => a.phaseId === ph.id);
    const strategies = [...new Set(phaseAssets.map((a) => String(a.strategy)))].join(', ');
    return {
      name: ph.name,
      startYear: yearOf(ph.startDate, startYear + Math.max(0, (ph.constructionStart ?? 1) - 1)),
      strategies,
      assetNames: phaseAssets.map((a) => a.name),
      assetCount: phaseAssets.length,
      capex: phaseAssets.reduce((s, a) => s + assetCapex(a.id), 0),
    };
  });

  // ── Sources & uses (verified rs.sourcesUses paths) ──
  const sourcesUses = {
    sources: [
      { label: 'Existing equity', value: su.existingEquity },
      { label: 'In-kind equity (land)', value: su.inKindEquity },
      { label: 'Existing debt', value: su.existingDebt },
      { label: 'New debt', value: su.newDebt },
      { label: 'Customer collections', value: su.customerCollections },
    ] as ICKeyValue[],
    uses: [
      { label: 'Land', value: su.land },
      { label: 'Construction', value: su.construction },
      { label: 'Interest during construction (IDC)', value: su.idc },
      { label: 'Reserves / distributions', value: su.reservesDistributions },
    ] as ICKeyValue[],
    totalSources: su.totalSources,
    totalUses: su.totalUses,
  };

  // ── Value bridge + cost stack ──
  const valueBridge: ICBridgeRow[] = [
    { label: 'Gross development value', value: de.gdv },
    { label: 'less Total development cost', value: -de.totalDevelopmentCost },
    { label: 'Profit before financing', value: de.profitBeforeFinancing, emphasis: true },
    { label: 'less Financing cost', value: -de.totalFinancingCost },
    { label: 'Profit after financing', value: de.profitAfterFinancing, emphasis: true },
  ];
  const costStack: ICBridgeRow[] = [
    { label: 'Construction (excl. land)', value: su.construction },
    { label: 'Land', value: su.land },
    { label: 'Total development cost', value: de.totalDevelopmentCost, emphasis: true },
    { label: 'Financing cost (below margin)', value: de.totalFinancingCost },
  ];

  // ── Financing ──
  const fundingMethodLabel = FUNDING_METHOD_LABELS[(project.financing?.fundingMethod ?? 1) as FundingMethodId] ?? 'n/a';
  const minCashReserve = Math.max(0, project.financing?.minimumCashReserve ?? 0);
  const financing = {
    hasDebt: da.peakDebt > 0.5 || su.existingDebt > 0.5 || su.newDebt > 0.5,
    fundingMethodLabel,
    existingDebt: su.existingDebt,
    newDebt: su.newDebt,
    peakDebt: da.peakDebt,
    tenorYears: da.tenorYears,
    paydownPct: da.paydownPct,
    remainingDebtAtExit: da.remainingDebtAtExit,
    customerCollections: su.customerCollections,
    minCashReserve,
  };

  // ── Exit-year optionality ──
  const exitYears: ICExitRow[] = (rs.exitYears ?? []).map((row) => ({
    year: row.exitYearLabel,
    equityValue: row.equityValue,
    projectIrr: row.fcffIrr,
    equityIrr: row.fcfeIrr,
    equityMoic: row.equityMoic,
    selected: row.isSelected,
  }));

  // ── Sensitivity (two-way Equity IRR grid) ──
  const sens = rs.sensitivity;
  const sensHasData = Array.isArray(sens?.irr) && sens.irr.some((row) => row.some((v) => v != null && Number.isFinite(v)));

  const totalEquity = rs.totalEquityInvested;
  const equityCommitment = su.existingEquity + su.inKindEquity;

  // ── Chart series (Phase C). Read straight from the snapshot; no recompute. ──
  const yearLabels = rs.yearLabels ?? [];
  // Revenue recognition: sales = residual (total less hospitality less retail),
  // which equals the residential/sell component by construction but is computed
  // as a residual to stay robust to any Sell+Manage companion double-count.
  const pl = snap.pl;
  const totalRev = pl?.totalRevenuePerPeriod ?? [];
  const hospRev = pl?.hospitalityRevenuePerPeriod ?? [];
  const retailRev = pl?.retailRevenuePerPeriod ?? [];
  const salesRev = totalRev.map((t, i) => (t ?? 0) - (hospRev[i] ?? 0) - (retailRev[i] ?? 0));
  const revHasData = [salesRev, hospRev, retailRev].some((arr) => arr.some((v) => (v ?? 0) > 0.5));

  // Senior-debt outstanding balance per period.
  const debtSeries = snap.bs?.debtOutstandingPerPeriod ?? [];
  let debtRepaidYear: number | null = null;
  let debtWasPositive = false;
  for (let i = 0; i < debtSeries.length; i++) {
    const v = debtSeries[i] ?? 0;
    if (v > 0.5) debtWasPositive = true;
    else if (debtWasPositive && v <= 0.5) { debtRepaidYear = yearLabels[i] ?? null; break; }
  }

  // Development-programme lanes: construction + operations windows per phase.
  const lanes: ICProgrammeLane[] = phases.map((ph) => {
    const cs = yearOf(ph.startDate, startYear + Math.max(0, (ph.constructionStart ?? 1) - 1));
    const ce = cs + Math.max(1, ph.constructionPeriods ?? 1) - 1;
    const opPeriods = Math.max(0, ph.operationsPeriods ?? 0);
    const overlap = Math.max(0, ph.overlapPeriods ?? 0);
    const opStart = opPeriods > 0 ? Math.max(cs, ce + 1 - overlap) : null;
    const opEnd = opStart != null ? Math.min(exitYear, opStart + opPeriods - 1) : null;
    const phaseAssets = visibleAssets.filter((a) => a.phaseId === ph.id);
    const strategies = [...new Set(phaseAssets.map((a) => String(a.strategy)))].join(', ');
    return { name: ph.name, strategies, constructionStart: cs, constructionEnd: ce, operationsStart: opStart, operationsEnd: opEnd };
  });

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
      assetMix: visibleAssets.map((a) => ({ name: a.name, strategy: String(a.strategy) })),
      startYear,
      exitYear,
      durationYears,
      landAreaSqm: visibleAssets.reduce((s, a) => s + (a.landAreaSqm ?? 0), 0),
      totalBua,
      strategyMix,
      fundingMethodLabel,
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
      equityMultiple: reMx.equityMultiple,
      terminalEquity: rs.terminalEquityValue,
    },
    ask: {
      equityCommitment,
      existingEquity: su.existingEquity,
      inKindEquity: su.inKindEquity,
      peakDebt: da.peakDebt,
      existingDebt: su.existingDebt,
      newDebt: su.newDebt,
      paydownPct: da.paydownPct,
      projectIrr: r.fcff.irr,
      equityIrr: r.fcfe.irr,
      equityMoic: r.fcfe.moic,
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
    valueBridge,
    costStack,
    capital: {
      debtPct: fm.debtPct,
      cashEquityPct: fm.cashEquityPct,
      inKindEquityPct: fm.inKindEquityPct,
      customerFundingPct: fm.customerFundingPct,
      peakEquity: ee.equityAtRisk,
      totalEquity,
      peakDebt: da.peakDebt,
      remainingDebtAtExit: da.remainingDebtAtExit,
      totalSources: su.totalSources,
      totalUses: su.totalUses,
    },
    sourcesUses,
    financing,
    reMetrics: {
      yieldOnCost: reMx.yieldOnCost,
      capRateAtExit: reMx.capRateAtExit,
      profitOnCost: reMx.profitOnCost,
      cashOnCashAvg: reMx.cashOnCashAvg,
      dscrMin: reMx.dscrMin,
      ltvAtExit: reMx.ltvAtExit,
    },
    assetMix: { rows: assetRows, byStrategy, totalBua, totalUnits },
    phasing,
    exitYears,
    sensitivity: {
      xVariable: sens?.xVariable ?? '',
      yVariable: sens?.yVariable ?? '',
      xValues: sens?.xValues ?? [],
      yValues: sens?.yValues ?? [],
      irr: sens?.irr ?? [],
      baseEquityIrr: sens?.baseEquityIrr ?? null,
      hasData: sensHasData,
    },
    charts: {
      costStack: { land: su.land, construction: su.construction, financing: de.totalFinancingCost },
      revenueRecognition: { yearLabels, sales: salesRev, hospitality: hospRev, retail: retailRev, hasData: revHasData },
      debtBalance: { yearLabels, values: debtSeries, peak: da.peakDebt, hasData: da.peakDebt > 0.5 },
      exitMoic: { years: exitYears.map((r) => r.year), moic: exitYears.map((r) => r.equityMoic), hasData: exitYears.length > 1 },
    },
    programme: { startYear, exitYear, debtRepaidYear, lanes },
    scenarios: hasScenarios ? (input.scenarios ?? null) : null,
  };
}

/**
 * AUTO-OMIT: the single predicate shared by the preview + the PPT export. A
 * section is omitted (rendered nowhere in the output) when its model data is
 * absent / trivial, or (for pure FORM sections) when the form field is empty.
 * The cover is never omitted. Disclaimers always render (they carry a standing
 * confidentiality boilerplate, so are never truly blank).
 */
export function icSectionOmitted(key: ICSectionKey, model: ICReportModel, inputs: ReportInputs): boolean {
  const blank = (s: string): boolean => !s || !s.trim();
  const mc = inputs.marketContext;
  switch (key) {
    case 'cover': return false;
    case 'executive_summary': return inputs.execPoints.length === 0 && blank(inputs.executiveSummary);
    case 'investment_recommendation': return false; // AUTO ask always present
    case 'project_overview': return false;
    case 'master_plan': return model.phasing.length === 0;
    case 'asset_mix': return model.assetMix.rows.length === 0;
    case 'market_context': return mc.stats.length === 0 && mc.points.length === 0 && blank(mc.sourcesNote);
    case 'development_programme': return model.phasing.length === 0 && blank(inputs.keyGates);
    case 'development_costs': return model.devEconomics.tdc <= 0.5;
    case 'value_economics': return model.devEconomics.gdv <= 0.5;
    case 'sources_uses': return model.sourcesUses.totalSources <= 0.5;
    case 'financing_structure': return !model.financing.hasDebt;
    case 'returns_analysis': return false;
    case 'exit_optionality': return model.exitYears.length <= 1;
    case 'scenario_cases': return !model.scenarios;
    case 'scenario_economics': return !model.scenarios;
    case 'sensitivity': return !model.sensitivity.hasData;
    case 'risk_assessment': return inputs.risks.length === 0 && blank(inputs.keyRisks);
    case 'regulatory_tax': return inputs.regulatoryTax.length === 0;
    case 'recommendation_approvals': return inputs.conditionsPrecedent.length === 0 && blank(inputs.nextSteps) && blank(inputs.recommendation);
    case 'disclaimers': return false;
    default: return false;
  }
}

/** Brand chart palette (Phase C), shared verbatim by the preview (Recharts) and
 *  the PPT export (native Office charts). Hex WITH '#'; the PPT side strips it. */
export const IC_CHART_PALETTE = {
  navy: '#1B4F8A',
  mid: '#7FA8D9',
  green: '#2E7D52',
  neg: '#B23A3A',
  pale: '#DDE7F3',
} as const;

export interface ICScenarioChartRow { name: string; role: string; projectIrr: number | null; equityIrr: number | null; npv: number | null }

/** Scenario chart rows (one per case), read from the case-comparison columns so
 *  the preview and the PPT charts plot the SAME per-case IRR / NPV values. */
export function icScenarioChartRows(scenarios: CaseComparisonReport | null): ICScenarioChartRow[] {
  if (!scenarios) return [];
  return scenarios.columns.map((c) => ({
    name: c.name,
    role: c.role,
    projectIrr: c.values['Project IRR (FCFF)'] ?? null,
    equityIrr: c.values['Equity IRR (FCFE)'] ?? null,
    npv: c.values['NPV (FCFF)'] ?? null,
  }));
}

/** Formatter trio injected into the finding-line builder so each surface applies
 *  its own money / percent / multiple formatting while sharing the copy. */
export interface ICFindingFmt {
  money: (v: number | null | undefined) => string;
  pct: (v: number | null | undefined) => string;
  mult: (v: number | null | undefined) => string;
}

/** The italic "finding" subtitle for a section (states the finding, never a unit
 *  note). Shared by the preview and the PPT so both read identically. Returns ''
 *  for sections that carry no subtitle. */
export function icFindingLine(key: ICSectionKey, m: ICReportModel, inputs: ReportInputs, f: ICFindingFmt): string {
  const o = m.overview, h = m.headline, d = m.devEconomics;
  const { money, pct: p, mult: x } = f;
  const num = (v: number): string => Math.round(v).toLocaleString('en-US');
  switch (key) {
    case 'executive_summary':
      return inputs.execPoints[0]?.title ? `${inputs.execPoints[0].title}.`
        : `Prime ${o.strategyMix || 'mixed-use'} development; ${p(h.equityIrr)} equity IRR and ${x(h.equityMultiple)} equity multiple over a ${o.durationYears}-year hold.`;
    case 'investment_recommendation':
      return `The ask: ${money(m.ask.equityCommitment)} equity${m.ask.peakDebt > 0.5 ? ` alongside ${money(m.ask.peakDebt)} peak senior debt` : ''} to target a ${p(m.ask.equityIrr)} equity IRR.`;
    case 'project_overview':
      return `${[o.location, o.country].filter(Boolean).join(', ') || 'Location tbc'} · ${o.totalBua > 0 ? `${num(o.totalBua)} sqm BUA` : (o.strategyMix || 'mixed-use')} across ${o.phaseCount} ${o.phaseCount === 1 ? 'phase' : 'phases'}.`;
    case 'master_plan':
      return `${m.phasing.length} ${m.phasing.length === 1 ? 'phase' : 'phases'} sequenced from ${o.startYear} to ${o.exitYear}${o.strategyMix ? `; ${o.strategyMix}` : ''}.`;
    case 'asset_mix': {
      const t = m.assetMix.byStrategy[0];
      return t ? `${t.strategy} leads the ${num(m.assetMix.totalBua)} sqm programme at ${p(t.pct)} of built-up area.` : 'Asset mix by strategy.';
    }
    case 'market_context': return 'Demand drivers underpinning the business plan.';
    case 'development_programme':
      return `Construction and lease-up span ${o.startYear} to ${o.exitYear}${m.programme.debtRepaidYear ? `, with senior debt repaid by ${m.programme.debtRepaidYear}` : ''}.`;
    case 'development_costs':
      return `Total development cost of ${money(d.tdc)}: land ${money(m.charts.costStack.land)}, construction ${money(m.charts.costStack.construction)}.`;
    case 'value_economics':
      return `GDV ${money(d.gdv)} against ${money(d.tdc)} cost delivers a ${p(d.developmentMargin)} development margin.`;
    case 'sources_uses':
      return `Sources and uses balance at ${money(m.sourcesUses.totalSources)}.`;
    case 'financing_structure':
      return `Senior debt peaks at ${money(m.financing.peakDebt)}${m.financing.paydownPct != null ? ` and pays down ${p(m.financing.paydownPct)} by exit` : ''}.`;
    case 'returns_analysis':
      return `Project IRR ${p(h.projectIrr)}, equity IRR ${p(h.equityIrr)}, ${x(h.equityMultiple)} equity multiple.`;
    case 'exit_optionality':
      return `Returns hold across exit years; the ${o.exitYear} exit is selected.`;
    case 'scenario_cases': {
      const irrs = m.scenarios ? m.scenarios.columns.map((c) => c.values['Equity IRR (FCFE)']).filter((v): v is number => v != null) : [];
      const lo = irrs.length ? Math.min(...irrs) : null;
      return lo != null ? `Returns are resilient; even the weakest case holds a ${p(lo)} equity IRR.` : 'Headline returns by case.';
    }
    case 'scenario_economics': return 'Value by case: NPV and margin under each scenario.';
    case 'sensitivity': {
      const flat = m.sensitivity.irr.flat().filter((v): v is number => v != null && Number.isFinite(v));
      const mn = flat.length ? Math.min(...flat) : 0, mx = flat.length ? Math.max(...flat) : 1;
      return `Equity IRR ranges ${p(mn)} to ${p(mx)} across the sensitivity band and stays return-accretive throughout.`;
    }
    case 'risk_assessment': return 'Key risks and the mitigants in place.';
    case 'regulatory_tax': return 'Regulatory and tax considerations.';
    case 'recommendation_approvals': return 'The Committee is asked to approve the transaction as set out.';
    default: return '';
  }
}

/** The ordered, visible, NON-omitted IC section keys for a given model + inputs.
 *  Both surfaces use this so preview and export show the same set in the same order. */
export function icVisibleSections(model: ICReportModel, inputs: ReportInputs): ICSectionKey[] {
  const cfg = [...(inputs.sectionConfig.ic ?? [])].sort((a, b) => a.order - b.order);
  return cfg
    .filter((s) => s.visible)
    .map((s) => s.key as ICSectionKey)
    .filter((k) => !icSectionOmitted(k, model, inputs));
}
