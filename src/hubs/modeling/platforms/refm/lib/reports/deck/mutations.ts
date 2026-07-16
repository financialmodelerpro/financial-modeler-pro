/**
 * mutations.ts (REFM Module 7, IC Presentation Builder: pure deck edits)
 *
 * Every structural change to a deck goes through one of these pure functions:
 * they take a Deck and return a NEW Deck, touching nothing else. That is what
 * lets the editor keep an undo history as a stack of whole-deck snapshots (a
 * mutation never aliases the previous state) and lets a verifier exercise the
 * edit logic with no React and no DOM.
 *
 * Object order in a slide's `objects` array IS z-order (index 0 paints first,
 * furthest back), so the z-order operations are array moves, not a separate
 * z field to keep in sync.
 *
 * Runtime ids must not collide with the deterministic ids the templates emit
 * (txt_0, kpi_1, ...), because a duplicated object created after a deck was
 * loaded from the database would otherwise clash with a seeded id. freshId
 * carries a random suffix for exactly that reason; the templates keep their
 * deterministic deckId() so verifier output stays diffable.
 *
 * No em dashes in this file.
 */

import type { Deck, DeckObject, Slide, SlideChrome } from './types';
import { clampToCanvas, GRID } from './types';

/** A collision-safe id for a runtime-created object or slide. */
let runtimeSeq = 0;
export function freshId(prefix: string): string {
  runtimeSeq += 1;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${runtimeSeq.toString(36)}${rand}`;
}

/** A patch may set any object field except id / type, which stay fixed so a
 *  bound KPI can never be mutated into a chart by a stray patch. */
export type ObjectPatch = Record<string, unknown>;

const mergeObject = (o: DeckObject, patch: ObjectPatch): DeckObject =>
  ({ ...(o as object), ...patch, id: o.id, type: o.type } as DeckObject);

// ── Slide-scoped object edits ───────────────────────────────────────────────

export function mapSlide(deck: Deck, slideId: string, fn: (s: Slide) => Slide): Deck {
  return { ...deck, slides: deck.slides.map((s) => (s.id === slideId ? fn(s) : s)) };
}

export function updateObject(deck: Deck, slideId: string, objId: string, patch: ObjectPatch): Deck {
  return mapSlide(deck, slideId, (s) => ({
    ...s,
    objects: s.objects.map((o) => (o.id === objId ? mergeObject(o, patch) : o)),
  }));
}

/** Apply a different patch to each of several objects in one pass. The editor
 *  uses this for a multi-select drag, so the whole group moves as one history
 *  step rather than one per object. */
export function updateObjects(deck: Deck, slideId: string, patches: Record<string, ObjectPatch>): Deck {
  return mapSlide(deck, slideId, (s) => ({
    ...s,
    objects: s.objects.map((o) => (patches[o.id] ? mergeObject(o, patches[o.id]) : o)),
  }));
}

export function addObject(deck: Deck, slideId: string, obj: DeckObject): Deck {
  return mapSlide(deck, slideId, (s) => ({ ...s, objects: [...s.objects, obj] }));
}

export function removeObjects(deck: Deck, slideId: string, ids: ReadonlySet<string> | string[]): Deck {
  const set = ids instanceof Set ? ids : new Set(ids);
  return mapSlide(deck, slideId, (s) => ({ ...s, objects: s.objects.filter((o) => !set.has(o.id)) }));
}

/** Duplicate the given objects, offset by a grid step so the copy is visible,
 *  appended on top (so the copy is selected and in front). Returns the new ids
 *  in the same order, so the caller can select them. */
export function duplicateObjects(deck: Deck, slideId: string, ids: string[]): { deck: Deck; newIds: string[] } {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return { deck, newIds: [] };
  const originals = slide.objects.filter((o) => ids.includes(o.id));
  const newIds: string[] = [];
  const copies: DeckObject[] = originals.map((o) => {
    const id = freshId(o.type.slice(0, 3));
    newIds.push(id);
    const geo = clampToCanvas({ x: o.x + GRID * 2, y: o.y + GRID * 2, w: o.w, h: o.h });
    return { ...o, id, x: geo.x, y: geo.y, groupId: null } as DeckObject;
  });
  return { deck: mapSlide(deck, slideId, (s) => ({ ...s, objects: [...s.objects, ...copies] })), newIds };
}

export type ZDir = 'front' | 'back' | 'forward' | 'backward';

/** Reorder objects within a slide's paint order. Multi-select keeps the moved
 *  objects contiguous and in their original relative order. */
export function reorderObjects(deck: Deck, slideId: string, ids: string[], dir: ZDir): Deck {
  return mapSlide(deck, slideId, (s) => {
    const moving = s.objects.filter((o) => ids.includes(o.id));
    const rest = s.objects.filter((o) => !ids.includes(o.id));
    if (!moving.length) return s;
    if (dir === 'front') return { ...s, objects: [...rest, ...moving] };
    if (dir === 'back') return { ...s, objects: [...moving, ...rest] };
    // forward / backward: shift the block by one relative to `rest`.
    const firstIdx = s.objects.findIndex((o) => ids.includes(o.id));
    const restBefore = s.objects.slice(0, firstIdx).filter((o) => !ids.includes(o.id)).length;
    const target = dir === 'forward' ? restBefore + 1 : Math.max(0, restBefore - 1);
    const out = [...rest];
    out.splice(target, 0, ...moving);
    return { ...s, objects: out };
  });
}

/** Nudge selected objects by an EXACT delta (keyboard arrows), clamped to
 *  canvas. Deliberately does NOT grid-snap: a 1px arrow nudge is how a user does
 *  fine positioning, and snapping would swallow it. Drag gestures snap; nudges
 *  do not. */
export function nudgeObjects(deck: Deck, slideId: string, ids: string[], dx: number, dy: number): Deck {
  const patches: Record<string, ObjectPatch> = {};
  const slide = deck.slides.find((s) => s.id === slideId);
  slide?.objects.forEach((o) => {
    if (!ids.includes(o.id) || o.locked) return;
    const geo = clampToCanvas({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h });
    patches[o.id] = { x: geo.x, y: geo.y };
  });
  return updateObjects(deck, slideId, patches);
}

// ── Slide-level edits ───────────────────────────────────────────────────────

export function updateSlide(deck: Deck, slideId: string, patch: Partial<Slide>): Deck {
  return mapSlide(deck, slideId, (s) => ({ ...s, ...patch, id: s.id }));
}

export function moveSlide(deck: Deck, from: number, to: number): Deck {
  if (from === to || from < 0 || from >= deck.slides.length) return deck;
  const slides = [...deck.slides];
  const [moved] = slides.splice(from, 1);
  slides.splice(Math.max(0, Math.min(to, slides.length)), 0, moved);
  return { ...deck, slides };
}

export function duplicateSlide(deck: Deck, slideId: string): { deck: Deck; newId: string } {
  const idx = deck.slides.findIndex((s) => s.id === slideId);
  if (idx < 0) return { deck, newId: '' };
  const src = deck.slides[idx];
  const newId = freshId('sld');
  const copy: Slide = {
    ...src,
    id: newId,
    title: `${src.title} (copy)`,
    objects: src.objects.map((o) => ({ ...o, id: freshId(o.type.slice(0, 3)) } as DeckObject)),
  };
  const slides = [...deck.slides];
  slides.splice(idx + 1, 0, copy);
  return { deck: { ...deck, slides }, newId };
}

/** A blank content slide, appended after `afterId` (or at the end). */
export function addBlankSlide(deck: Deck, afterId: string | null, chrome: SlideChrome = 'content'): { deck: Deck; newId: string } {
  const newId = freshId('sld');
  const slide: Slide = { id: newId, title: 'Blank slide', chrome, finding: '', objects: [], templateId: null };
  const slides = [...deck.slides];
  const idx = afterId ? deck.slides.findIndex((s) => s.id === afterId) : deck.slides.length - 1;
  slides.splice((idx < 0 ? deck.slides.length : idx) + 1, 0, slide);
  return { deck: { ...deck, slides }, newId };
}

export function removeSlide(deck: Deck, slideId: string): Deck {
  if (deck.slides.length <= 1) return deck; // never leave a deck with zero slides
  return { ...deck, slides: deck.slides.filter((s) => s.id !== slideId) };
}

// ── Deck-level ──────────────────────────────────────────────────────────────

export function updateBranding(deck: Deck, patch: Partial<Deck['branding']>): Deck {
  return { ...deck, branding: { ...deck.branding, ...patch } };
}

export function updateSettings(deck: Deck, patch: Partial<Deck['settings']>): Deck {
  return { ...deck, settings: { ...deck.settings, ...patch } };
}
