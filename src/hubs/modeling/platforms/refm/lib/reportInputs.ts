/**
 * reportInputs.ts (REFM Module 7 Reports)
 *
 * Shared types + defaults for per-project Report inputs (migs 191 + 192 + 193).
 * This is PRESENTATION / NARRATIVE config only: the model engine never reads it,
 * and every financial figure is pulled live from the computed snapshot at render
 * time. Import-safe on both the client tab and the server API route (no client- or
 * server-only imports).
 *
 * Phase 2 (2026-07-09): three report types (IC / Lender / One-Pager).
 * A+B rebuild (2026-07-12): the IC Report is rebuilt to full IC-grade depth
 * (21 sections). Lender + One-Pager are PARKED (hidden from the report-type
 * selector, code + fields kept). The IC narrative gains structured fields
 * (mig 193): development concept, market context (stats + points + sources),
 * key gates, returns / exit / scenario commentary, a structured risk table, a
 * regulatory & tax repeater (with an OPTIONAL loadable KSA preset, never a
 * hardcoded jurisdiction default), conditions precedent, next steps, and
 * optional executive-summary points. Existing free-text fields stay as
 * fallbacks. Section show/hide + order is PER report type.
 *
 * No em dashes in this file.
 */

export type ReportType = 'ic' | 'lender' | 'onepager';
export const REPORT_TYPES: ReadonlyArray<{ key: ReportType; label: string }> = [
  { key: 'ic', label: 'IC Report' },
  { key: 'lender', label: 'Lender Package' },
  { key: 'onepager', label: 'Investor One-Pager' },
];

/**
 * PARKED report types (A+B rebuild, 2026-07-12): hidden from the selector, code
 * and fields fully retained. Un-park by removing a key from this list.
 */
export const PARKED_REPORT_TYPES: ReadonlyArray<ReportType> = ['lender', 'onepager'];
export const ACTIVE_REPORT_TYPES: ReadonlyArray<{ key: ReportType; label: string }> =
  REPORT_TYPES.filter((rt) => !PARKED_REPORT_TYPES.includes(rt.key));

/** Canonical IC section set, in default order (A+B full model-driven structure). */
export const IC_SECTIONS = [
  { key: 'cover', label: 'Cover' },
  { key: 'executive_summary', label: 'Executive Summary' },
  { key: 'investment_recommendation', label: 'Investment Recommendation' },
  { key: 'project_overview', label: 'Project Overview' },
  { key: 'master_plan', label: 'Master Plan & Phasing' },
  { key: 'asset_mix', label: 'Asset Mix' },
  { key: 'market_context', label: 'Market Context' },
  { key: 'development_programme', label: 'Development Programme' },
  { key: 'development_costs', label: 'Development Costs' },
  { key: 'value_economics', label: 'Value & Development Economics' },
  { key: 'sources_uses', label: 'Sources & Uses' },
  { key: 'financing_structure', label: 'Financing Structure' },
  { key: 'returns_analysis', label: 'Returns Analysis' },
  { key: 'exit_optionality', label: 'Exit-Year Optionality' },
  { key: 'scenario_cases', label: 'Scenario Analysis: Cases' },
  { key: 'scenario_economics', label: 'Scenario Analysis: Economics' },
  { key: 'sensitivity', label: 'Sensitivity' },
  { key: 'risk_assessment', label: 'Risk Assessment' },
  { key: 'regulatory_tax', label: 'Regulatory & Tax' },
  { key: 'recommendation_approvals', label: 'Recommendation & Approvals' },
  { key: 'disclaimers', label: 'Disclaimers' },
] as const;

/** Lender Package section set (PARKED; retained). */
export const LENDER_SECTIONS = [
  { key: 'cover', label: 'Cover' },
  { key: 'executive_summary', label: 'Executive Summary' },
  { key: 'facility_terms', label: 'Facility Terms' },
  { key: 'capital_structure', label: 'Capital Structure' },
  { key: 'sources_uses', label: 'Sources & Uses / Funding Gap' },
  { key: 'repayment_schedule', label: 'Repayment & Cash-Sweep Schedule' },
  { key: 'covenant_analysis', label: 'Covenant Analysis' },
  { key: 'key_cash_flows', label: 'Key Cash Flows' },
  { key: 'security_collateral', label: 'Security & Collateral' },
  { key: 'covenant_commentary', label: 'Covenant Commentary' },
  { key: 'disclaimers', label: 'Disclaimers' },
] as const;

/** Investor One-Pager section set (PARKED; retained). */
export const ONEPAGER_SECTIONS = [
  { key: 'deal_at_a_glance', label: 'Deal at a Glance' },
  { key: 'headline_returns', label: 'Headline Returns' },
  { key: 'capital_ask', label: 'Capital Ask' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'asset_mix', label: 'Asset Mix' },
  { key: 'thesis_contact', label: 'Thesis & Contact' },
] as const;

export const SECTIONS: Record<ReportType, ReadonlyArray<{ key: string; label: string }>> = {
  ic: IC_SECTIONS,
  lender: LENDER_SECTIONS,
  onepager: ONEPAGER_SECTIONS,
};

export type ICSectionKey = typeof IC_SECTIONS[number]['key'];
export type LenderSectionKey = typeof LENDER_SECTIONS[number]['key'];
export type OnePagerSectionKey = typeof ONEPAGER_SECTIONS[number]['key'];

export interface SectionSetting {
  key: string;
  visible: boolean;
  order: number;
}

export type SectionConfigMap = Record<ReportType, SectionSetting[]>;

// ── Structured narrative sub-types (mig 193) ──
/** A market-context headline stat (e.g. "~9.5m" / "Riyadh population, 2030"). */
export interface MarketStat { label: string; value: string }
/** A market-context narrative point (title + body). */
export interface MarketPoint { title: string; body: string }
export interface MarketContext { stats: MarketStat[]; points: MarketPoint[]; sourcesNote: string }
/** One structured risk + its mitigant. */
export interface RiskItem { risk: string; mitigant: string }
/** One regulatory / tax line (label + body). */
export interface RegulatoryItem { label: string; body: string }
/** One executive-summary point (title + body). */
export interface ExecPoint { title: string; body: string }

export interface ReportInputs {
  // ── Narrative (shared across report types) ──
  /** Executive summary / investment thesis (IC + Lender exec summary). */
  executiveSummary: string;
  /** Key risks & mitigants (IC, legacy free-text fallback for `risks`). */
  keyRisks: string;
  /** Recommendation / the ask (IC). */
  recommendation: string;
  /** Disclaimers (IC + Lender). */
  disclaimers: string;
  /** Security & collateral notes (Lender, mig 192). */
  securityCollateral: string;
  /** Covenant commentary (Lender, mig 192). */
  covenantCommentary: string;
  /** Short thesis line (One-Pager, mig 192). */
  thesisLine: string;
  // ── IC structured narrative (mig 193) ──
  /** Development concept (Project Overview). */
  developmentConcept: string;
  /** Market context: headline stats + narrative points + a sources note. */
  marketContext: MarketContext;
  /** Key gates / milestones (Development Programme). */
  keyGates: string;
  /** "Reading the returns" commentary (Returns Analysis). */
  returnsCommentary: string;
  /** Exit-year optionality commentary (Exit-Year Optionality). */
  exitCommentary: string;
  /** Scenario takeaway (Scenario Economics). */
  scenarioTakeaway: string;
  /** Structured risk + mitigant rows (Risk Assessment); `keyRisks` is fallback. */
  risks: RiskItem[];
  /** Regulatory & tax rows (optional loadable KSA preset; never a default). */
  regulatoryTax: RegulatoryItem[];
  /** Conditions precedent (Recommendation & Approvals). */
  conditionsPrecedent: string[];
  /** Next steps (Recommendation & Approvals). */
  nextSteps: string;
  /** Optional executive-summary points; when empty the free-text summary shows. */
  execPoints: ExecPoint[];
  // ── Chrome (shared) ──
  headerText: string;
  footerText: string;
  fontBody: string;
  fontHeading: string;
  // ── Per-report-type section show/hide + order ──
  sectionConfig: SectionConfigMap;
}

/** Web-safe font families offered in the picker (plus free text for a client
 *  corporate font). Defaults are Calibri body / Cambria headings. */
export const FONT_CHOICES: readonly string[] = [
  'Calibri', 'Cambria', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Garamond', 'Verdana',
];

/**
 * OPTIONAL, loadable KSA regulatory & tax preset. NOT a default (the default is
 * empty, so no jurisdiction is ever hardcoded into a project). The report form
 * offers a one-click "Load KSA preset" that copies these rows into the editable
 * `regulatoryTax` list; the user can then edit, remove, or replace them.
 */
export const KSA_REGULATORY_PRESET: readonly RegulatoryItem[] = [
  { label: 'Wafi off-plan sales', body: 'Off-plan committee licence and a dedicated escrow account govern pre-sales receipts.' },
  { label: 'Real Estate Transaction Tax', body: 'Transaction tax on land and property transfers, modelled on acquisitions and strata sales.' },
  { label: 'Zakat', body: 'Zakat on Saudi / GCC ownership; foreign ownership modelled under income tax as applicable.' },
  { label: 'IFRS 15 revenue', body: 'Over-time vs. point-in-time recognition assessed per contract for off-plan residential.' },
  { label: 'Lease registration', body: 'Retail and residential leases registered with the regulator; income terms compliant.' },
  { label: 'National programme alignment', body: 'National housing programmes and tourism targets support demand and financing appetite.' },
];

export function defaultSectionConfig(reportType: ReportType): SectionSetting[] {
  return SECTIONS[reportType].map((s, i) => ({ key: s.key, visible: true, order: i }));
}

export function defaultSectionConfigMap(): SectionConfigMap {
  return { ic: defaultSectionConfig('ic'), lender: defaultSectionConfig('lender'), onepager: defaultSectionConfig('onepager') };
}

export function defaultMarketContext(): MarketContext {
  return { stats: [], points: [], sourcesNote: '' };
}

export function defaultReportInputs(): ReportInputs {
  return {
    executiveSummary: '', keyRisks: '', recommendation: '', disclaimers: '',
    securityCollateral: '', covenantCommentary: '', thesisLine: '',
    developmentConcept: '', marketContext: defaultMarketContext(), keyGates: '',
    returnsCommentary: '', exitCommentary: '', scenarioTakeaway: '',
    risks: [], regulatoryTax: [], conditionsPrecedent: [], nextSteps: '', execPoints: [],
    headerText: '', footerText: '',
    fontBody: 'Calibri', fontHeading: 'Cambria',
    sectionConfig: defaultSectionConfigMap(),
  };
}

// ── Defensive coercion for the structured narrative fields (schema tolerant) ──
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function coerceMarketContext(v: unknown): MarketContext {
  const o = obj(v);
  return {
    stats: asArr(o.stats).map((s) => ({ label: asStr(obj(s).label), value: asStr(obj(s).value) })).filter((s) => s.label || s.value),
    points: asArr(o.points).map((p) => ({ title: asStr(obj(p).title), body: asStr(obj(p).body) })).filter((p) => p.title || p.body),
    sourcesNote: asStr(o.sourcesNote),
  };
}
export function coerceRisks(v: unknown): RiskItem[] {
  return asArr(v).map((r) => ({ risk: asStr(obj(r).risk), mitigant: asStr(obj(r).mitigant) })).filter((r) => r.risk || r.mitigant);
}
export function coerceRegulatory(v: unknown): RegulatoryItem[] {
  return asArr(v).map((r) => ({ label: asStr(obj(r).label), body: asStr(obj(r).body) })).filter((r) => r.label || r.body);
}
export function coerceExecPoints(v: unknown): ExecPoint[] {
  return asArr(v).map((p) => ({ title: asStr(obj(p).title), body: asStr(obj(p).body) })).filter((p) => p.title || p.body);
}
export function coerceStringList(v: unknown): string[] {
  return asArr(v).map(asStr).filter((s) => s.trim().length > 0);
}

/**
 * Merge an arbitrary partial (client body OR a stored row's parsed columns) with
 * defaults, coercing the structured narrative fields. Tolerant of any shape:
 * missing fields fall back to the default, wrong shapes are dropped. Section
 * config is normalized separately by the caller (needs the report-type set).
 */
export function coerceNarrativeExtras(raw: Record<string, unknown>): Pick<ReportInputs,
  'developmentConcept' | 'marketContext' | 'keyGates' | 'returnsCommentary' | 'exitCommentary' |
  'scenarioTakeaway' | 'risks' | 'regulatoryTax' | 'conditionsPrecedent' | 'nextSteps' | 'execPoints'> {
  return {
    developmentConcept: asStr(raw.developmentConcept),
    marketContext: coerceMarketContext(raw.marketContext),
    keyGates: asStr(raw.keyGates),
    returnsCommentary: asStr(raw.returnsCommentary),
    exitCommentary: asStr(raw.exitCommentary),
    scenarioTakeaway: asStr(raw.scenarioTakeaway),
    risks: coerceRisks(raw.risks),
    regulatoryTax: coerceRegulatory(raw.regulatoryTax),
    conditionsPrecedent: coerceStringList(raw.conditionsPrecedent),
    nextSteps: asStr(raw.nextSteps),
    execPoints: coerceExecPoints(raw.execPoints),
  };
}

/**
 * Merge stored section config for ONE report type with its canonical set so
 * newly-added sections always appear (additive), unknown keys are dropped, and
 * order is renormalized to 0..n-1. Tolerates any shape.
 */
export function normalizeSectionConfig(input: unknown, reportType: ReportType = 'ic'): SectionSetting[] {
  const canonical = SECTIONS[reportType];
  const arr = Array.isArray(input) ? input : [];
  const byKey = new Map<string, { visible: boolean; order: number }>();
  arr.forEach((raw, i) => {
    if (raw && typeof raw === 'object') {
      const k = String((raw as { key?: unknown }).key);
      if (canonical.some((s) => s.key === k)) {
        const v = (raw as { visible?: unknown }).visible;
        const o = (raw as { order?: unknown }).order;
        byKey.set(k, { visible: v !== false, order: Number.isFinite(o) ? Number(o) : i });
      }
    }
  });
  const merged = canonical.map((s, i) => {
    const found = byKey.get(s.key);
    return { key: s.key, visible: found ? found.visible : true, order: found ? found.order : i, provided: !!found, ci: i };
  });
  // Sort by explicit order; on a tie, sections that WERE provided (an explicit
  // reorder) win over defaulted ones, then fall back to canonical index. This
  // makes a partial config (only some keys carried over) behave intuitively.
  merged.sort((a, b) => (a.order - b.order) || (Number(b.provided) - Number(a.provided)) || (a.ci - b.ci));
  return merged.map((s, i) => ({ key: s.key, visible: s.visible, order: i }));
}

/**
 * Normalize the FULL per-report-type section config. Accepts the new object shape
 * { ic, lender, onepager } OR a legacy bare array (Phase 1 stored the IC config as
 * a bare array); a legacy array is migrated to `ic` with lender/onepager defaulted.
 */
export function normalizeAllSectionConfigs(input: unknown): SectionConfigMap {
  const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input as Record<string, unknown> : {};
  const legacyArray = Array.isArray(input) ? input : undefined;
  return {
    ic: normalizeSectionConfig(legacyArray ?? o.ic, 'ic'),
    lender: normalizeSectionConfig(o.lender, 'lender'),
    onepager: normalizeSectionConfig(o.onepager, 'onepager'),
  };
}
