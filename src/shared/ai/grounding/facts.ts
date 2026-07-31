/**
 * shared/ai/grounding/facts.ts
 *
 * Pure builders for grounding facts, sections and documents.
 *
 * Every adapter (the REFM IC model today, ERM later, a market-data feed after
 * that) constructs facts through THESE helpers rather than hand-writing the
 * shape. That matters for one reason beyond tidiness: the numeric audit
 * (audit.ts) compares generated text against both the raw value and the
 * formatted spelling, so formatting has to be produced in one place or the two
 * halves drift and the audit starts reporting false positives.
 *
 * Formatting deliberately mirrors the deck's makeDeckFmt conventions (comma
 * grouping, parenthesised negatives, one decimal on percents, two on multiples)
 * so a figure reads the same in a narrative as it does on the slide beside it.
 *
 * Pure: no I/O, no clock, no platform import.
 *
 * No em dashes in this file.
 */

import type { FactKind, GroundingDocument, GroundingFact, GroundingSection, GroundingType } from './types';

/** What a null value reads as. One constant, because the model is taught to
 *  repeat this phrase rather than estimate, and the audit must recognise it. */
export const NOT_AVAILABLE = 'not available';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const group = (n: number, decimals: number): string =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);

/** Money reads unscaled with comma grouping; negatives in parentheses, matching
 *  the report convention so a narrative figure ties to the slide. */
export function formatMoney(v: number | null | undefined, decimals = 1): string {
  if (!num(v)) return NOT_AVAILABLE;
  const s = group(Math.abs(v), decimals);
  return v < 0 ? `(${s})` : s;
}

/** A fraction renders as a percent: 0.119 -> '11.9%'. */
export function formatPercent(v: number | null | undefined, decimals = 1): string {
  return num(v) ? `${(v * 100).toFixed(decimals)}%` : NOT_AVAILABLE;
}

/** A multiple renders with an x: 2.404 -> '2.40x'. */
export function formatMultiple(v: number | null | undefined, decimals = 2): string {
  return num(v) ? `${v.toFixed(decimals)}x` : NOT_AVAILABLE;
}

/** Counts and years render without decimals. */
export function formatCount(v: number | null | undefined): string {
  return num(v) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v) : NOT_AVAILABLE;
}

/** A series renders inline. Long series are truncated with an explicit marker,
 *  never silently, so the model can see that it has NOT been given every point. */
export function formatSeries(values: number[] | null | undefined, decimals = 1, max = 24): string {
  if (!Array.isArray(values) || values.length === 0) return NOT_AVAILABLE;
  const shown = values.slice(0, max).map((v) => (num(v) ? group(v, decimals) : NOT_AVAILABLE));
  const tail = values.length > max ? `, ... (${values.length - max} further values not supplied)` : '';
  return `${shown.join(', ')}${tail}`;
}

interface FactOpts {
  unit?: string;
  note?: string;
  decimals?: number;
}

function make(kind: FactKind, key: string, label: string, value: GroundingFact['value'], formatted: string, opts: FactOpts = {}): GroundingFact {
  const f: GroundingFact = { key, label, kind, value, formatted };
  if (opts.unit) f.unit = opts.unit;
  if (opts.note) f.note = opts.note;
  return f;
}

export const moneyFact = (key: string, label: string, v: number | null | undefined, opts: FactOpts = {}): GroundingFact =>
  make('money', key, label, num(v) ? v : null, formatMoney(v, opts.decimals ?? 1), opts);

export const percentFact = (key: string, label: string, v: number | null | undefined, opts: FactOpts = {}): GroundingFact =>
  make('percent', key, label, num(v) ? v : null, formatPercent(v, opts.decimals ?? 1), opts);

export const multipleFact = (key: string, label: string, v: number | null | undefined, opts: FactOpts = {}): GroundingFact =>
  make('multiple', key, label, num(v) ? v : null, formatMultiple(v, opts.decimals ?? 2), opts);

export const countFact = (key: string, label: string, v: number | null | undefined, opts: FactOpts = {}): GroundingFact =>
  make('count', key, label, num(v) ? v : null, formatCount(v), opts);

export const textFact = (key: string, label: string, v: string | null | undefined, opts: FactOpts = {}): GroundingFact => {
  const s = typeof v === 'string' ? v.trim() : '';
  return make('text', key, label, s ? s : null, s ? s : NOT_AVAILABLE, opts);
};

export const seriesFact = (key: string, label: string, v: number[] | null | undefined, opts: FactOpts = {}): GroundingFact => {
  const arr = Array.isArray(v) ? v.filter(num) : [];
  return make('series', key, label, arr.length ? arr : null, formatSeries(arr, opts.decimals ?? 1), opts);
};

/** Build a section, dropping nothing: a null fact is kept on purpose so the
 *  prompt can say a figure is not available instead of leaving a silent hole
 *  the model is tempted to fill. */
export function section(id: string, title: string, facts: Array<GroundingFact | null | undefined>, preamble?: string): GroundingSection {
  const s: GroundingSection = { id, title, facts: facts.filter((f): f is GroundingFact => !!f) };
  if (preamble) s.preamble = preamble;
  return s;
}

/** An available document. Sections with no facts are dropped here (an empty
 *  section is noise, an empty FACT is signal). */
export function document(
  type: GroundingType,
  providerId: string,
  source: string,
  sections: GroundingSection[],
  asOf?: string,
): GroundingDocument {
  const doc: GroundingDocument = {
    type,
    providerId,
    source,
    available: true,
    sections: sections.filter((s) => s.facts.length > 0),
  };
  if (asOf) doc.asOf = asOf;
  if (doc.sections.length === 0) {
    doc.available = false;
    doc.unavailableReason = 'The source supplied no facts.';
  }
  return doc;
}

/** An explicitly empty document. Used by the external and context stubs and by
 *  any adapter handed a payload it does not recognise. Never throw for this:
 *  a visible "not available" beats an exception in a generation path. */
export function unavailableDocument(
  type: GroundingType,
  providerId: string,
  source: string,
  reason: string,
): GroundingDocument {
  return { type, providerId, source, available: false, unavailableReason: reason, sections: [] };
}

/** Every fact in a document, flattened in render order. */
export function documentFacts(doc: GroundingDocument): GroundingFact[] {
  return doc.sections.flatMap((s) => s.facts);
}

/** Every fact across a set of documents, flattened in render order. */
export function allFacts(docs: GroundingDocument[]): GroundingFact[] {
  return docs.flatMap(documentFacts);
}

/** Fact lookup by key, first occurrence wins. Keys are unique per document; a
 *  collision across documents means two sources supplied the same figure, and
 *  the first (model, by ordering) is the authoritative one. */
export function factIndex(docs: GroundingDocument[]): Map<string, GroundingFact> {
  const m = new Map<string, GroundingFact>();
  for (const f of allFacts(docs)) if (!m.has(f.key)) m.set(f.key, f);
  return m;
}
