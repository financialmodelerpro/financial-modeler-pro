/**
 * valueText.ts (2026-09-24)
 *
 * THE ONE WAY A LOGGED OR OVERRIDDEN VALUE IS WRITTEN FOR A READER.
 *
 * A stored value that is absent comes back as SQL NULL (or `undefined` in the
 * model), and every chip on the platform printed it raw: "null", or the glyph
 * "∅". A reader should never see either. Absent reads as "not set", and where
 * a badge already says the value appeared or went away ("Added", "Cleared",
 * "Removed"), the absent side is not printed at all: see `valueSides`.
 *
 * Used by the Activity log, the Version modal's change list and the scenario
 * override list, so the three cannot word the same value differently.
 *
 * Pure. No em dashes in this file.
 */

/** What an absent value reads as. */
export const NOT_SET = 'not set';

export const isAbsent = (v: unknown): boolean => v === null || v === undefined;

/** A value in words. Never "null", never "undefined", never a glyph. */
export function formatValue(raw: unknown): string {
  if (isAbsent(raw)) return NOT_SET;
  if (typeof raw === 'string') return JSON.stringify(raw);
  if (typeof raw === 'number') return raw.toLocaleString();
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (Array.isArray(raw)) return `[${raw.length} items]`;
  if (typeof raw === 'object') {
    // A key holding NULL is a value nobody stated, so it is left out rather
    // than printed as "null" inside the object.
    try { return JSON.stringify(raw, (_k, v: unknown) => (v === null ? undefined : v)); } catch { return '[object]'; }
  }
  return String(raw);
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
