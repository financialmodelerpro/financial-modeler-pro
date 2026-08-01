/**
 * reports/deck/narrativeTargets.ts
 *
 * Where an AI-generated narrative draft lands in the deck (AI foundation
 * Unit 8). Pure: no I/O, no React, no SDK, so the mapping is verifiable without
 * a browser or a key.
 *
 * WHY THIS EXISTS AT ALL. The six narrative fields on ReportInputs no longer
 * have an editing surface: the old report form was deleted in the 2026-07-16
 * deck rebuild and saveReportInputs has had no caller since. Those fields are
 * read at exactly one moment, deck seed time, after which the authored text
 * lives in deck OBJECTS. So a Generate button belongs on the deck block, not on
 * a form field that no longer exists. The seed placeholders have said so all
 * along: "Click to edit, or use Generate Commentary".
 *
 * HOW A BLOCK IS FOUND, without a schema change. Object ids are random
 * (deckId('bul')), so they cannot be mapped. Slides carry a stable templateId
 * that survives in saved decks, so the mapping is templateId -> field, plus a
 * structural rule for which object on that slide holds the prose. That means
 * this works on decks that were seeded months ago, with no migration and no
 * DECK_SCHEMA_VERSION bump.
 *
 * WHEN A BLOCK CANNOT BE FOUND (the user deleted or replaced it), the target is
 * simply absent and the UI says so. It does NOT fall back to "the biggest text
 * object", because guessing would eventually write a draft over a slide title.
 *
 * No em dashes in this file.
 */

import type { IcNarrativeFieldKey } from '../../ai/icNarrative';
import { isPlaceholderText } from './placeholders';
import type { Deck, DeckObject, Slide } from './types';

/** How the prose block is located within its slide. */
type Pick =
  /** The slide's only bullets list. */
  | { kind: 'bullets' }
  /** The slide's only risk register. */
  | { kind: 'riskMatrix' }
  /** The body text of the caption box with this heading. */
  | { kind: 'caption'; heading: string };

interface TemplateMapping {
  field: IcNarrativeFieldKey;
  pick: Pick;
}

/**
 * Slide template to narrative field.
 *
 * The headings are the ones the templates pass to captionBlock, which stamps
 * `name: "Caption: <heading>"` onto the caption shape. Keeping them here as
 * data (rather than re-deriving them) means a template heading change shows up
 * as a target that stops resolving, which the verifier catches, instead of a
 * silent mis-target.
 */
export const NARRATIVE_TEMPLATE_MAP: Record<string, TemplateMapping> = {
  executive_summary:   { field: 'executiveSummary',  pick: { kind: 'bullets' } },
  returns:             { field: 'returnsCommentary', pick: { kind: 'caption', heading: 'Reading the returns' } },
  exit_optionality:    { field: 'exitCommentary',    pick: { kind: 'caption', heading: 'Timing is optionality' } },
  scenario_comparison: { field: 'scenarioTakeaway',  pick: { kind: 'caption', heading: 'Takeaway' } },
  key_risks:           { field: 'risks',             pick: { kind: 'riskMatrix' } },
  recommendation:      { field: 'recommendation',    pick: { kind: 'caption', heading: 'The Committee is asked to approve' } },
};

export interface NarrativeTarget {
  field: IcNarrativeFieldKey;
  slideId: string;
  /** Zero-based position in the deck, for "go to slide". */
  slideIndex: number;
  slideTitle: string;
  objectId: string;
  objectKind: 'text' | 'bullets' | 'riskMatrix';
  /** What the block says today, so the review can show a before and after. */
  current: string;
  /** True when the block still holds seed placeholder text, which means
   *  generating cannot destroy anything the user wrote. */
  isPlaceholder: boolean;
}

const box = (o: DeckObject) => ({ x: o.x, y: o.y, w: o.w, h: o.h });

/** Is `inner` positioned inside `outer`, allowing for a nudge? Caption bodies
 *  are laid out inside the caption shape, and a small tolerance keeps a manual
 *  drag from breaking resolution. */
function isInside(inner: DeckObject, outer: DeckObject, tol = 24): boolean {
  const a = box(inner);
  const b = box(outer);
  return a.x >= b.x - tol && a.y >= b.y - tol
    && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
}

/** The readable text a block currently holds, for the review diff. */
export function objectNarrativeText(o: DeckObject): string {
  if (o.type === 'text') return o.text ?? '';
  if (o.type === 'bullets') return (o.items ?? []).join('\n');
  if (o.type === 'riskMatrix') {
    return (o.rows ?? []).map((r) => `Risk: ${r.risk}\nMitigant: ${r.mitigation}`).join('\n\n');
  }
  return '';
}

/**
 * Is this block still showing seed placeholders, meaning generating cannot
 * destroy anything a user wrote?
 *
 * Checked against the block's OWN FIELDS, not against objectNarrativeText. The
 * rendered form prefixes each risk with "Risk: ", and isPlaceholderText
 * requires the marker at the START of the string, so reading the rendered text
 * would report a freshly seeded risk register as authored content and warn the
 * user they were about to overwrite work that does not exist.
 *
 * Note what this deliberately does NOT treat as empty: several templates seed a
 * generic default SENTENCE rather than a placeholder (the returns and exit
 * captions, for instance). Those carry no placeholder marker, so they count as
 * written. That is the honest answer: they are real prose sitting on the slide,
 * and replacing them is a change the user should see in the review.
 */
function blockIsPlaceholder(o: DeckObject): boolean {
  if (o.type === 'riskMatrix') {
    const rows = o.rows ?? [];
    if (rows.length === 0) return true;
    return rows.every((r) => isPlaceholderText(r.risk) || !r.risk.trim());
  }
  if (o.type === 'bullets') {
    const items = o.items ?? [];
    if (items.length === 0) return true;
    return items.every((i) => isPlaceholderText(i) || !i.trim());
  }
  if (o.type === 'text') {
    const t = o.text ?? '';
    return !t.trim() || isPlaceholderText(t);
  }
  return false;
}

/** Locate the prose block on one slide, or null when it is not there. */
function resolveObject(slide: Slide, pick: Pick): DeckObject | null {
  const objects = slide.objects ?? [];

  if (pick.kind === 'bullets') {
    const all = objects.filter((o) => o.type === 'bullets');
    // Only when unambiguous. The executive summary slide has exactly one list;
    // if a user added another, targeting either would be a guess.
    return all.length === 1 ? all[0] : null;
  }

  if (pick.kind === 'riskMatrix') {
    const all = objects.filter((o) => o.type === 'riskMatrix');
    return all.length === 1 ? all[0] : null;
  }

  // Caption: find the shape the layout named, then the body text inside it.
  const shape = objects.find((o) => o.type === 'shape' && o.name === `Caption: ${pick.heading}`);
  if (!shape) return null;

  const texts = objects.filter((o): o is Extract<DeckObject, { type: 'text' }> => o.type === 'text' && isInside(o, shape));
  if (texts.length === 0) return null;

  // The heading text is also inside the box. The body is the other one, and
  // when both remain it is the lower of the two.
  const body = texts
    .filter((t) => (t.text ?? '').trim() !== pick.heading)
    .sort((a, b) => b.y - a.y)[0];
  return body ?? null;
}

/**
 * Every narrative block the deck currently exposes, in slide order.
 *
 * A slide whose template is not a narrative slide, or whose block has been
 * removed, contributes nothing. Deliberately silent about the absent ones: the
 * UI reports availability from the SERVER status (which knows about the model
 * data and the cap), and this function reports only what it can actually write
 * to.
 */
export function findNarrativeTargets(deck: Deck | null | undefined): NarrativeTarget[] {
  if (!deck?.slides?.length) return [];
  const out: NarrativeTarget[] = [];

  deck.slides.forEach((slide, slideIndex) => {
    const mapping = slide.templateId ? NARRATIVE_TEMPLATE_MAP[slide.templateId] : undefined;
    if (!mapping) return;
    const obj = resolveObject(slide, mapping.pick);
    if (!obj) return;
    const current = objectNarrativeText(obj);
    out.push({
      field: mapping.field,
      slideId: slide.id,
      slideIndex,
      slideTitle: slide.title,
      objectId: obj.id,
      objectKind: obj.type as 'text' | 'bullets' | 'riskMatrix',
      current,
      isPlaceholder: blockIsPlaceholder(obj),
    });
  });

  return out;
}

/** The target for one field, or null. */
export function findNarrativeTarget(deck: Deck | null | undefined, field: IcNarrativeFieldKey): NarrativeTarget | null {
  return findNarrativeTargets(deck).find((t) => t.field === field) ?? null;
}

export interface GeneratedNarrative {
  draft: string;
  risks?: Array<{ risk: string; mitigant: string }>;
}

/**
 * The object patch that applies a draft to its block.
 *
 * Shape follows the block: a bullets list takes lines, a text block takes the
 * paragraph, the risk register takes rows.
 *
 * Likelihood and impact are NOT invented from the draft. The generation is
 * grounded in figures and says nothing about probability, so guessing a rating
 * here would be exactly the fabrication the whole feature is built to avoid.
 * A new row inherits the rating already on the row it replaces, and anything
 * beyond the existing rows defaults to the template's own Medium / Medium for
 * the author to set.
 */
export function buildNarrativePatch(
  target: NarrativeTarget,
  generated: GeneratedNarrative,
  existing?: DeckObject | null,
): Record<string, unknown> | null {
  const draft = (generated.draft ?? '').trim();

  if (target.objectKind === 'riskMatrix') {
    const rows = generated.risks ?? [];
    if (rows.length === 0) return null;
    const prior = existing && existing.type === 'riskMatrix' ? existing.rows ?? [] : [];
    return {
      rows: rows.map((r, i) => ({
        risk: r.risk,
        mitigation: r.mitigant,
        likelihood: prior[i]?.likelihood ?? 'Medium',
        impact: prior[i]?.impact ?? 'Medium',
      })),
    };
  }

  if (!draft) return null;

  if (target.objectKind === 'bullets') {
    const items = draft.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
    return items.length ? { items } : null;
  }

  return { text: draft };
}
