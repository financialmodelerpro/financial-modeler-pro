/**
 * valueText.ts (2026-09-24)
 *
 * THE ONE WAY A LOGGED OR OVERRIDDEN VALUE IS WRITTEN FOR A READER.
 *
 * A reviewer reading the log should understand what someone did without
 * knowing how the model stores anything. So a value is described in words,
 * never printed as it is stored:
 *
 *   - ABSENT reads "not set", and where a badge already says the value
 *     appeared or went away the absent side is not printed at all
 *     (`valueSides`). Never "null", never a glyph.
 *   - A STRING prints without quotes. A stored option code ("yoy_compound")
 *     reads as the words the screen offers, and a REFERENCE ("parcel_17...")
 *     reads as the name of what it points at.
 *   - A BOOLEAN reads "Yes" or "No" ("On" or "Off" for a switch).
 *   - A LIST is counted in the singular where it is one ("1 item"), short
 *     lists of numbers are listed, and a list whose CONTENTS changed is
 *     described ONCE, as what changed inside it, rather than printing the same
 *     count on both sides (`describeChange`).
 *   - A RECORD is described by its stated values in words, never as JSON.
 *
 * Used by the Activity log, the Version modal's change list and the scenario
 * override list, so the three cannot word the same value differently.
 *
 * Pure. No em dashes in this file.
 */
import { humaniseField, nameReference, nameListItem, type NamingContext } from './changeLabel';
import {
  COST_METHOD_LABELS, TERMINAL_METHOD_LABELS, FUNDING_METHOD_LABELS, CAPEX_PHASING_SOURCE_LABELS,
} from '../state/module1-types';
import { PARKING_RATIO_BASIS_LABELS } from '../state/assetTypeStandards';

/** What an absent value reads as. */
export const NOT_SET = 'not set';

export const isAbsent = (v: unknown): boolean => v === null || v === undefined;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * STORED OPTION CODES IN THE SCREEN'S WORDS, keyed by the FIELD that holds
 * them, because one code can mean different things in different fields.
 * Wherever the screen has a label map it is IMPORTED, never copied, so a label
 * renamed on screen is renamed here; the pills with no map object are quoted
 * from where they render (Module2Revenue indexation pills, Module1Assets
 * "Sells by", Module1Costs PHASING_LABELS). A code no map knows is humanised,
 * so an option added tomorrow still reads as words.
 */
const INDEXATION_WORDS: Record<string, string> = {
  none: 'None', yoy_compound: 'YoY Compound', step: 'Step', yoy_per_period: 'Per-Year',
};
const PHASING_WORDS: Record<string, string> = {
  even: 'Even', frontloaded: 'Front-loaded', backloaded: 'Back-loaded', sCurve: 'S-curve',
  manual: 'Manual %', phase_aligned: 'Phase-aligned',
};
export const FIELD_OPTIONS: Record<string, Record<string, string>> = {
  method: { ...(COST_METHOD_LABELS as Record<string, string>), ...INDEXATION_WORDS },
  terminalMethod: TERMINAL_METHOD_LABELS as Record<string, string>,
  fundingMethod: Object.fromEntries(Object.entries(FUNDING_METHOD_LABELS).map(([k, v]) => [k, `Method ${k}, ${v}`])),
  parkingRatioBasis: PARKING_RATIO_BASIS_LABELS as Record<string, string>,
  phasing: PHASING_WORDS,
  source: CAPEX_PHASING_SOURCE_LABELS as Record<string, string>,
  metric: { area: 'Area (sqm)', units: 'Units' },
  subUnitMetric: { area: 'Area (sqm)', units: 'Units' },
  instalmentsStopAtHandover: { true: 'Must finish by handover', false: 'May run past handover' },
};

/** Fields that are ON / OFF switches rather than yes / no answers. */
const SWITCH_FIELD = /(^enabled$|Enabled$|^linked$)/;

/** Keys a reader never needs inside a described record: identity and
 *  bookkeeping. */
const QUIET_KEYS = /^(id|.*Id|.*Ids|origin|priceStated|rateStated|stampedAt|sortOrder|changedAt)$/;

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** A stored option code, if the string is one ("per_sqm", "yoy_compound",
 *  "Sell"); a user's typed text is left exactly as typed. */
function optionWords(s: string, field: string): string | undefined {
  const byField = FIELD_OPTIONS[field]?.[s];
  if (byField !== undefined) return byField;
  if (/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/.test(s)) return humaniseField(s).toLowerCase();
  return undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export interface ValueOpts {
  /** The field the value belongs to (the last path segment), which decides
   *  how a string or a boolean reads. */
  field?: string;
  /** Names for references. */
  ctx?: NamingContext;
}

/** A value in words. Never "null", never quotes, never JSON. */
export function formatValue(raw: unknown, opts: ValueOpts = {}): string {
  const { field = '', ctx = {} } = opts;
  if (isAbsent(raw)) return NOT_SET;
  if (typeof raw === 'boolean') {
    const worded = FIELD_OPTIONS[field]?.[String(raw)];
    if (worded !== undefined) return worded;
    return SWITCH_FIELD.test(field) ? (raw ? 'On' : 'Off') : (raw ? 'Yes' : 'No');
  }
  if (typeof raw === 'number') return FIELD_OPTIONS[field]?.[String(raw)] ?? formatNumber(raw);
  if (typeof raw === 'string') {
    if (raw.trim() === '') return NOT_SET;
    const ref = nameReference(field, raw, ctx);
    if (ref !== undefined) return ref;
    if (ISO_DATE.test(raw)) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
    return optionWords(raw, field) ?? raw.replace(/\s+/g, ' ');
  }
  if (Array.isArray(raw)) return describeList(raw, ctx, field);
  if (isRec(raw)) return describeRecord(raw, ctx);
  return String(raw);
}

/** A list field that holds REFERENCES, and the reference field each element
 *  is, so "selectedLineIds" reads as the lines' names. */
const LIST_OF_REFERENCES: Record<string, string> = {
  selectedLineIds: 'lineId', parcelIds: 'parcelId', assetIds: 'assetId', subUnitIds: 'subUnitId', phaseIds: 'phaseId',
};

function describeList(list: unknown[], ctx: NamingContext, field = ''): string {
  if (list.length === 0) return 'none';
  const allScalar = list.every((v) => !isRec(v) && !Array.isArray(v));
  const itemField = LIST_OF_REFERENCES[field] ?? '';
  if (allScalar && itemField) return list.map((v) => formatValue(v, { field: itemField, ctx })).join(', ');
  if (allScalar && list.length <= 12) return list.map((v) => formatValue(v, { ctx })).join(', ');
  if (allScalar) return plural(list.length, 'value');
  const names = list.map((v) => (isRec(v) ? nameListItem(v, ctx) : undefined)).filter((n): n is string => !!n);
  if (names.length === list.length && list.length <= 4) return names.join(', ');
  return plural(list.length, 'item');
}

/** A record's STATED values in words: "Value 5, Method percent of selected".
 *  Identity and bookkeeping keys are left out; so is anything absent. */
function describeRecord(rec: Rec, ctx: NamingContext): string {
  const own = nameListItem(rec, ctx);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (QUIET_KEYS.test(k) || isAbsent(v) || k === 'name' || k === 'label') continue;
    if (isRec(v)) continue; // nested sections are not a summary
    parts.push(`${humaniseField(k)} ${Array.isArray(v) ? describeList(v, ctx) : formatValue(v, { field: k, ctx })}`);
  }
  const shown = parts.slice(0, 4);
  const more = parts.length - shown.length;
  const body = shown.join(', ') + (more > 0 ? `, and ${plural(more, 'other value')}` : '');
  if (own && body) return `${own}: ${body}`;
  return own ?? (body || 'no values');
}

/* ───────────────────────── a change, described once ───────────────────────── */

export interface DescribedChange {
  /** Printed on the "before" chip, when there is one. */
  before?: string;
  /** Printed on the "after" chip, when there is one. */
  after?: string;
  /** ONE description of the change, used instead of a before/after pair
   *  where printing both would say the same thing twice. */
  single?: string;
}

/**
 * WHICH SIDES OF A CHANGE TO PRINT. The badge carries the verb, so a side the
 * verb already accounts for is noise: "Added" does not need "from not set",
 * "Cleared" and "Removed" do not need "to not set". An UPDATE keeps both sides,
 * printing an absent one as "not set", because there the badge does not say
 * which side was empty.
 */
export function valueSides(kind: string, before: unknown, after: unknown): { before: boolean; after: boolean } {
  if (kind === 'add' && isAbsent(before)) return { before: false, after: !isAbsent(after) };
  if ((kind === 'clear' || kind === 'remove') && isAbsent(after)) return { before: !isAbsent(before), after: false };
  return { before: true, after: true };
}

const LIST_KEYS = ['id', 'subUnitId', 'parcelId', 'partyId', 'lineId', 'assetId'];
const keyOfItem = (r: Rec): string | undefined => {
  for (const k of LIST_KEYS) if (typeof r[k] === 'string') return `${k}:${r[k] as string}`;
  return undefined;
};

/** Order-blind equality, the differ's own comparison, restated locally so this
 *  file stays free of the differ. */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (isRec(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** What changed inside a list of RECORDS, said once: "2 BR: pre-sales velocity;
 *  added Rooms direct". */
function describeRecordListChange(before: Rec[], after: Rec[], ctx: NamingContext): string | undefined {
  const bk = before.map(keyOfItem);
  const ak = after.map(keyOfItem);
  if (bk.some((k) => k === undefined) || ak.some((k) => k === undefined)) return undefined;
  const bMap = new Map(before.map((r, i) => [bk[i] as string, r]));
  const aMap = new Map(after.map((r, i) => [ak[i] as string, r]));
  const name = (r: Rec): string => nameListItem(r, ctx) ?? 'an item';
  const parts: string[] = [];
  for (const [k, a] of aMap) {
    const b = bMap.get(k);
    if (!b) { parts.push(`added ${name(a)}`); continue; }
    if (same(a, b)) continue;
    const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((f) => !QUIET_KEYS.test(f) && !same(a[f], b[f]))
      .map((f) => humaniseField(f).toLowerCase());
    parts.push(`${name(a)}: ${fields.length ? fields.join(', ') : 'changed'}`);
  }
  for (const [k, b] of bMap) if (!aMap.has(k)) parts.push(`removed ${name(b)}`);
  if (parts.length === 0) return before.length === after.length ? 'order changed' : undefined;
  const shown = parts.slice(0, 3);
  return shown.join('; ') + (parts.length > 3 ? `; and ${plural(parts.length - 3, 'other change')}` : '');
}

/**
 * A CHANGE IN WORDS: the pair of chips to print, or one description where a
 * pair would repeat itself. `kind` is the badge's verb.
 */
export function describeChange(kind: string, before: unknown, after: unknown, opts: ValueOpts = {}): DescribedChange {
  const ctx = opts.ctx ?? {};
  const show = valueSides(kind, before, after);
  if (Array.isArray(before) && Array.isArray(after)) {
    const scalar = [...before, ...after].every((v) => !isRec(v) && !Array.isArray(v));
    if (scalar && LIST_OF_REFERENCES[opts.field ?? ''] !== undefined) {
      // A list of references is a SET of named things: say what joined and
      // what left, once, rather than printing both lists.
      const itemField = LIST_OF_REFERENCES[opts.field ?? ''];
      const nm = (v: unknown): string => formatValue(v, { field: itemField, ctx });
      const added = after.filter((v) => !before.includes(v)).map(nm);
      const removed = before.filter((v) => !after.includes(v)).map(nm);
      const parts = [...added.map((n) => `added ${n}`), ...removed.map((n) => `removed ${n}`)];
      return { single: parts.length ? parts.join('; ') : 'order changed' };
    }
    if (scalar) {
      // Short lists are listed on both sides: the two sides DIFFER, so the
      // pair is information. A long list of the same length is summarised once.
      if (before.length <= 12 && after.length <= 12) return { before: formatValue(before, opts), after: formatValue(after, opts) };
      if (before.length === after.length) {
        const changed = before.filter((v, i) => !same(v, after[i])).length;
        return { single: `${changed.toLocaleString()} of ${plural(before.length, 'value')} changed` };
      }
      return { before: plural(before.length, 'value'), after: plural(after.length, 'value') };
    }
    const said = describeRecordListChange(before.filter(isRec), after.filter(isRec), ctx);
    if (said !== undefined) return { single: said };
    if (before.length !== after.length) return { before: plural(before.length, 'item'), after: plural(after.length, 'item') };
    const changed = before.filter((v, i) => !same(v, after[i])).length;
    return { single: `${changed.toLocaleString()} of ${plural(before.length, 'item')} changed` };
  }
  return {
    before: show.before ? formatValue(before, opts) : undefined,
    after: show.after ? formatValue(after, opts) : undefined,
  };
}
