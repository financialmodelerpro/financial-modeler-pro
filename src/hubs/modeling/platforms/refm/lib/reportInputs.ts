/**
 * reportInputs.ts (REFM Module 7 Reports)
 *
 * Shared types + defaults for per-project Report inputs (mig 191 + 192). This is
 * PRESENTATION / NARRATIVE config only: the model engine never reads it, and every
 * financial figure is pulled live from the computed snapshot at render time.
 * Import-safe on both the client tab and the server API route (no client- or
 * server-only imports).
 *
 * Phase 2 (2026-07-09): three report types (IC / Lender / One-Pager). Narrative +
 * header/footer + fonts are SHARED across types; the section show/hide + order is
 * PER report type, held in sectionConfig as { ic, lender, onepager }.
 *
 * No em dashes in this file.
 */

export type ReportType = 'ic' | 'lender' | 'onepager';
export const REPORT_TYPES: ReadonlyArray<{ key: ReportType; label: string }> = [
  { key: 'ic', label: 'IC Report' },
  { key: 'lender', label: 'Lender Package' },
  { key: 'onepager', label: 'Investor One-Pager' },
];

/** Canonical IC section set, in default order. */
export const IC_SECTIONS = [
  { key: 'cover', label: 'Cover' },
  { key: 'executive_summary', label: 'Executive Summary' },
  { key: 'project_overview', label: 'Project Overview' },
  { key: 'headline_returns', label: 'Headline Returns' },
  { key: 'development_economics', label: 'Development Economics' },
  { key: 'capital_structure', label: 'Capital Structure' },
  { key: 'scenario_comparison', label: 'Scenario Comparison' },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'disclaimers', label: 'Disclaimers' },
] as const;

/** Lender Package section set. */
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

/** Investor One-Pager section set. */
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

export interface ReportInputs {
  // ── Narrative (shared across report types) ──
  /** Executive summary / investment thesis (IC + Lender exec summary). */
  executiveSummary: string;
  /** Key risks & mitigants (IC). */
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

export function defaultSectionConfig(reportType: ReportType): SectionSetting[] {
  return SECTIONS[reportType].map((s, i) => ({ key: s.key, visible: true, order: i }));
}

export function defaultSectionConfigMap(): SectionConfigMap {
  return { ic: defaultSectionConfig('ic'), lender: defaultSectionConfig('lender'), onepager: defaultSectionConfig('onepager') };
}

export function defaultReportInputs(): ReportInputs {
  return {
    executiveSummary: '', keyRisks: '', recommendation: '', disclaimers: '',
    securityCollateral: '', covenantCommentary: '', thesisLine: '',
    headerText: '', footerText: '',
    fontBody: 'Calibri', fontHeading: 'Cambria',
    sectionConfig: defaultSectionConfigMap(),
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
  const obj = (input && typeof input === 'object' && !Array.isArray(input)) ? input as Record<string, unknown> : {};
  const legacyArray = Array.isArray(input) ? input : undefined;
  return {
    ic: normalizeSectionConfig(legacyArray ?? obj.ic, 'ic'),
    lender: normalizeSectionConfig(obj.lender, 'lender'),
    onepager: normalizeSectionConfig(obj.onepager, 'onepager'),
  };
}
