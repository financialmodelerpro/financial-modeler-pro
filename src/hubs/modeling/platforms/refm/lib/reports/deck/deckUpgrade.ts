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
import { TEMPLATE_BY_ID, buildSlideFromTemplate, type TemplateSeed } from './templates';
import { freshId } from './mutations';

/** New-in-v2 templates, in the order they should appear when several are missing. */
const NEW_TEMPLATE_IDS = ['contents', 'income_statement', 'cash_flow', 'balance_sheet', 'returns_calculation'] as const;
/** The "The case" templates the statements should sit BEFORE (the numbers precede the case). */
const CASE_TEMPLATE_IDS = ['returns', 'returns_calculation', 'exit_optionality', 'sensitivity', 'scenario_comparison'];

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
  if ((deck.schemaVersion ?? 1) >= DECK_SCHEMA_VERSION) return { deck, changed: false, addedTitles: [] };

  const present = new Set(deck.slides.map((s) => s.templateId).filter(Boolean) as string[]);
  const wanted = NEW_TEMPLATE_IDS.filter((id) => {
    const t = TEMPLATE_BY_ID[id];
    return t && !present.has(id) && t.available(model, seed);
  });

  // Below version but every new template is already present (or unavailable): just
  // lift the version so this is not re-checked.
  if (!wanted.length) return { deck: { ...deck, schemaVersion: DECK_SCHEMA_VERSION }, changed: false, addedTitles: [] };

  // Build with a non-empty placeholder number so titleBlock emits the chip; renumber overwrites it.
  const build = (id: string): Slide => reId(buildSlideFromTemplate(TEMPLATE_BY_ID[id], model, seed, '00'));
  let slides = [...deck.slides];
  const addedTitles: string[] = [];

  // Contents: right after the cover (or at the very front if there is no cover).
  if (wanted.includes('contents')) {
    const s = build('contents'); addedTitles.push(s.title);
    const coverIdx = slides.findIndex((sl) => sl.chrome === 'cover');
    slides.splice(coverIdx >= 0 ? coverIdx + 1 : 0, 0, s);
  }

  // Statements as a group, in order, just before the first "case" slide (else appended).
  const stmtSlides = (['income_statement', 'cash_flow', 'balance_sheet'] as const)
    .filter((id) => wanted.includes(id)).map((id) => { const s = build(id); addedTitles.push(s.title); return s; });
  if (stmtSlides.length) {
    const caseIdx = slides.findIndex((sl) => CASE_TEMPLATE_IDS.includes(sl.templateId ?? ''));
    slides.splice(caseIdx >= 0 ? caseIdx : slides.length, 0, ...stmtSlides);
  }

  // Returns Calculation: right after Returns Analysis (else appended).
  if (wanted.includes('returns_calculation')) {
    const s = build('returns_calculation'); addedTitles.push(s.title);
    const retIdx = slides.findIndex((sl) => sl.templateId === 'returns');
    slides.splice(retIdx >= 0 ? retIdx + 1 : slides.length, 0, s);
  }

  slides = renumber(slides);
  return { deck: { ...deck, slides, schemaVersion: DECK_SCHEMA_VERSION }, changed: true, addedTitles };
}
