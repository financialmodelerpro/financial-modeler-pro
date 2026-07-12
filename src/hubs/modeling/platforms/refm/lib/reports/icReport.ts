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

/** The ordered, visible, NON-omitted IC section keys for a given model + inputs.
 *  Both surfaces use this so preview and export show the same set in the same order. */
export function icVisibleSections(model: ICReportModel, inputs: ReportInputs): ICSectionKey[] {
  const cfg = [...(inputs.sectionConfig.ic ?? [])].sort((a, b) => a.order - b.order);
  return cfg
    .filter((s) => s.visible)
    .map((s) => s.key as ICSectionKey)
    .filter((k) => !icSectionOmitted(k, model, inputs));
}
