/**
 * deckUpgrade.ts (REFM Module 7, IC Presentation Builder: one-time deck upgrade)
 *
 * A deck is saved per project (migration 199), so a deck seeded before a new
 * template set shipped will not contain the new slides. This module inserts the
 * missing template slides into an EXISTING deck once, gated by the deck's
 * schemaVersion, so opening an old deck auto-gains the new slides without a manual
 * insert and without clobbering the user's own arrangement.
 *
 * Safety:
 *  - Idempotent twice over: a template is inserted only when NO slide already
 *    carries its templateId, AND only while the deck is below DECK_SCHEMA_VERSION.
 *    So a slide the user deletes after the upgrade does not come back (the version
 *    is already current), and a re-run never duplicates.
 *  - Non-destructive: existing slides, objects and order are untouched; new slides
 *    are inserted at sensible anchors and every content chip is renumbered so the
 *    section numbers stay contiguous.
 *  - Collision-safe ids: template ids come off a build-time counter, so each
 *    inserted slide + its objects are re-idded with freshId against the live deck.
 *
 * Pure. No em dashes in this file.
 */

import type { ICReportModel } from '../icReport';
import type { Deck, DeckObject, Slide } from './types';
import { DECK_SCHEMA_VERSION } from './types';
import { TEMPLATE_BY_ID, buildSlidesFromTemplate, type TemplateSeed } from './templates';
import { freshId } from './mutations';

/**
 * Which schema version introduced which templates. A deck is only offered the
 * templates introduced AFTER the version it is on, so a slide the user deleted
 * in an earlier round is never resurrected by a later bump.
 *
 * THIS REGISTRY IS COMPLETE, AND THAT IS THE POINT. Every id in SLIDE_TEMPLATES
 * appears under exactly one key, including the v1 originals that no upgrade will
 * ever offer (`Number(v) > from` is false for key 1 even on a legacy deck with
 * no schemaVersion, which defaults to 1). They are listed so the registry is the
 * record of when every slide entered the library, which is what lets
 * `verify-deck-template-registry` assert that NO template is missing. Before
 * that, a template could be added to the library and simply never registered,
 * and nothing failed: it reached new decks and was invisible to every existing
 * one. The three v4 fund slides are exactly that, and they shipped on 2026-08-13
 * carrying a full fund model that no existing deck could ever render.
 *
 * When adding a template: bump DECK_SCHEMA_VERSION and add the id here under the
 * new number. Both, or the verifier fails.
 */
export const TEMPLATES_BY_VERSION: Record<number, readonly string[]> = {
  // v1: the original library. Never offered by an upgrade; listed for completeness.
  1: [
    'cover', 'executive_summary', 'investment_highlights', 'project_overview',
    'location_analysis', 'development_programme', 'development_timeline', 'capex',
    'revenue', 'operating_performance', 'funding_structure', 'financing_structure',
    'returns', 'exit_optionality', 'sensitivity', 'scenario_comparison',
    'key_risks', 'recommendation', 'appendix',
  ],
  2: ['contents', 'income_statement', 'cash_flow', 'balance_sheet', 'returns_calculation'],
  3: ['is_schedule', 'cf_schedule', 'bs_schedule', 'fcff_schedule', 'fcfe_schedule', 'ddm_schedule'],
  4: ['fund_terms', 'fund_waterfall', 'fund_returns'],
};
/** The "The case" templates the statements should sit BEFORE (the numbers precede the case). */
const CASE_TEMPLATE_IDS = ['returns', 'returns_calculation', 'exit_optionality', 'sensitivity', 'scenario_comparison'];
/** The closing templates the fund slides must sit BEFORE. In the library the
 *  fund block is the tail of "The case", between scenario_comparison and
 *  key_risks, so anchoring on these three puts an upgraded deck in the same
 *  order as a freshly seeded one. Appending instead would strand them after the
 *  Appendix. */
const CLOSING_TEMPLATE_IDS = ['key_risks', 'recommendation', 'appendix'];
/** Each full schedule sits directly after the slide it expands, when present. */
const SCHEDULE_ANCHORS: Record<string, string> = {
  is_schedule: 'income_statement',
  cf_schedule: 'cash_flow',
  bs_schedule: 'balance_sheet',
  fcff_schedule: 'returns_calculation',
  fcfe_schedule: 'fcff_schedule',
  ddm_schedule: 'fcfe_schedule',
};

/** Re-id a freshly built template slide + its objects so nothing collides with the
 *  loaded deck (whose ids came from a different session's counter). */
function reId(slide: Slide): Slide {
  return { ...slide, id: freshId('sld'), objects: slide.objects.map((o) => ({ ...(o as object), id: freshId(o.type.slice(0, 3)) } as DeckObject)) };
}

/** Renumber the section-number chip on every content slide so the chips read
 *  01..N with no gaps after an insertion. Mirrors seedDeck's numbering (cover is
 *  skipped). A slide with no chip (e.g. a section divider) is left untouched. */
function renumber(slides: Slide[]): Slide[] {
  let n = 0;
  return slides.map((s) => {
    if (s.chrome === 'cover') return s;
    n += 1;
    const num = String(n).padStart(2, '0');
    return {
      ...s,
      objects: s.objects.map((o) => (o.type === 'shape' && o.name === 'Section number' ? ({ ...o, text: num } as DeckObject) : o)),
    };
  });
}

export interface DeckUpgradeResult { deck: Deck; changed: boolean; addedTitles: string[] }

/**
 * Insert any missing new-in-v2 template slides into an existing deck and bump its
 * schemaVersion. Returns the (possibly) new deck, whether slides were added, and
 * the titles added (for a user notice). A deck already at the current version with
 * all templates present is returned unchanged (changed=false).
 */
export function upgradeDeckLayout(deck: Deck, model: ICReportModel, seed: TemplateSeed): DeckUpgradeResult {
  // Already current: do nothing. This is what makes a user-deleted slide STAY
  // deleted, the version gate is the record that the new slides were offered.
  const from = deck.schemaVersion ?? 1;
  if (from >= DECK_SCHEMA_VERSION) return { deck, changed: false, addedTitles: [] };

  const present = new Set(deck.slides.map((s) => s.templateId).filter(Boolean) as string[]);
  const candidates = Object.entries(TEMPLATES_BY_VERSION)
    .filter(([v]) => Number(v) > from)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .flatMap(([, ids]) => ids);
  const wanted = candidates.filter((id) => {
    const t = TEMPLATE_BY_ID[id];
    return t && !present.has(id) && t.available(model, seed);
  });

  // Below version but every new template is already present (or unavailable): just
  // lift the version so this is not re-checked.
  if (!wanted.length) return { deck: { ...deck, schemaVersion: DECK_SCHEMA_VERSION }, changed: false, addedTitles: [] };

  // Build with a non-empty placeholder number so titleBlock emits the chip;
  // renumber overwrites it. A paginated template yields several slides at once.
  const build = (id: string): Slide[] =>
    buildSlidesFromTemplate(TEMPLATE_BY_ID[id], model, seed, () => '00').map(reId);
  let slides = [...deck.slides];
  const addedTitles: string[] = [];
  const add = (id: string, at: number): void => {
    const built = build(id);
    built.forEach((s) => addedTitles.push(s.title));
    slides.splice(at, 0, ...built);
  };
  /** Index just after the LAST slide belonging to a template (families span several). */
  const afterTemplate = (id: string): number => {
    let last = -1;
    slides.forEach((sl, i) => { if (sl.templateId === id) last = i; });
    return last >= 0 ? last + 1 : -1;
  };

  // Contents: right after the cover (or at the very front if there is no cover).
  if (wanted.includes('contents')) {
    const coverIdx = slides.findIndex((sl) => sl.chrome === 'cover');
    add('contents', coverIdx >= 0 ? coverIdx + 1 : 0);
  }

  // Statements as a group, in order, just before the first "case" slide (else appended).
  const stmtIds = (['income_statement', 'cash_flow', 'balance_sheet'] as const).filter((id) => wanted.includes(id));
  if (stmtIds.length) {
    const caseIdx = slides.findIndex((sl) => CASE_TEMPLATE_IDS.includes(sl.templateId ?? ''));
    let at = caseIdx >= 0 ? caseIdx : slides.length;
    stmtIds.forEach((id) => { const before = slides.length; add(id, at); at += slides.length - before; });
  }

  // Returns Calculation: right after Returns Analysis (else appended).
  if (wanted.includes('returns_calculation')) {
    const retEnd = afterTemplate('returns');
    add('returns_calculation', retEnd >= 0 ? retEnd : slides.length);
  }

  // Full schedules: each right after the slide it expands, in a fixed order so
  // FCFF, FCFE and DDM stay in that sequence even when all three are new.
  (['is_schedule', 'cf_schedule', 'bs_schedule', 'fcff_schedule', 'fcfe_schedule', 'ddm_schedule'] as const)
    .filter((id) => wanted.includes(id))
    .forEach((id) => {
      const anchorEnd = afterTemplate(SCHEDULE_ANCHORS[id] ?? '');
      add(id, anchorEnd >= 0 ? anchorEnd : slides.length);
    });

  // Fund layer as a group, in library order, at the end of "The case" (before
  // Key Risks / Recommendation / Appendix), which is where seedDeck puts them.
  const fundIds = (['fund_terms', 'fund_waterfall', 'fund_returns'] as const).filter((id) => wanted.includes(id));
  if (fundIds.length) {
    const closeIdx = slides.findIndex((sl) => CLOSING_TEMPLATE_IDS.includes(sl.templateId ?? ''));
    let at = closeIdx >= 0 ? closeIdx : slides.length;
    fundIds.forEach((id) => { const before = slides.length; add(id, at); at += slides.length - before; });
  }

  slides = renumber(slides);
  return { deck: { ...deck, slides, schemaVersion: DECK_SCHEMA_VERSION }, changed: true, addedTitles };
}
