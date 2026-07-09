/**
 * reportInputs.ts (REFM Module 7 Reports)
 *
 * Shared types + defaults for per-project Report inputs (migration 191). This is
 * PRESENTATION / NARRATIVE config only: the model engine never reads it, and the
 * IC report pulls every financial figure live from the computed snapshot at
 * render time. Import-safe on both the client tab and the server API route, so it
 * must stay free of client- or server-only imports.
 *
 * No em dashes in this file.
 */

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

export type ICSectionKey = typeof IC_SECTIONS[number]['key'];

export interface SectionSetting {
  key: ICSectionKey;
  visible: boolean;
  order: number;
}

export interface ReportInputs {
  /** Executive summary / investment thesis. */
  executiveSummary: string;
  /** Key risks & mitigants. */
  keyRisks: string;
  /** Recommendation / the ask. */
  recommendation: string;
  /** Disclaimers / confidentiality notes. */
  disclaimers: string;
  headerText: string;
  footerText: string;
  fontBody: string;
  fontHeading: string;
  sectionConfig: SectionSetting[];
}

/** Web-safe font families offered in the picker (plus free text for a client
 *  corporate font). Defaults are Calibri body / Cambria headings. */
export const FONT_CHOICES: readonly string[] = [
  'Calibri', 'Cambria', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Garamond', 'Verdana',
];

export function defaultSectionConfig(): SectionSetting[] {
  return IC_SECTIONS.map((s, i) => ({ key: s.key, visible: true, order: i }));
}

export function defaultReportInputs(): ReportInputs {
  return {
    executiveSummary: '', keyRisks: '', recommendation: '', disclaimers: '',
    headerText: '', footerText: '',
    fontBody: 'Calibri', fontHeading: 'Cambria',
    sectionConfig: defaultSectionConfig(),
  };
}

/**
 * Merge stored section config with the canonical set so newly-added sections
 * always appear (additive), unknown keys are dropped, and order is renormalized
 * to 0..n-1. Tolerates any shape (null / partial / legacy).
 */
export function normalizeSectionConfig(input: unknown): SectionSetting[] {
  const arr = Array.isArray(input) ? input : [];
  const byKey = new Map<string, { visible: boolean; order: number }>();
  arr.forEach((raw, i) => {
    if (raw && typeof raw === 'object') {
      const k = String((raw as { key?: unknown }).key);
      if (IC_SECTIONS.some((s) => s.key === k)) {
        const v = (raw as { visible?: unknown }).visible;
        const o = (raw as { order?: unknown }).order;
        byKey.set(k, { visible: v !== false, order: Number.isFinite(o) ? Number(o) : i });
      }
    }
  });
  const merged = IC_SECTIONS.map((s, i) => {
    const found = byKey.get(s.key);
    return { key: s.key, visible: found ? found.visible : true, order: found ? found.order : i };
  });
  merged.sort((a, b) => a.order - b.order);
  return merged.map((s, i) => ({ key: s.key as ICSectionKey, visible: s.visible, order: i }));
}
