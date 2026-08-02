/**
 * houseStyle.ts (platform-wide writing rules applied to text, not just asked for)
 *
 * The no-em-dash rule is a house style for everything a user reads: articles,
 * emails, UI copy, report and deck text, and AI generated narrative. Until now
 * it was enforced in two places only: a per-file sweep inside individual
 * verifier scripts (opt in, so a new file was unguarded until someone
 * remembered to add it), and `sanitizeNarrativeText` in the REFM AI narrative
 * path. Nothing covered static content or anything read back out of the
 * database.
 *
 * This module is the shared primitive both of those now build on, so there is
 * ONE definition of what an em dash is and ONE substitution rule.
 *
 * The characters are written as escapes rather than literals, so the module
 * that hunts for em dashes contains none itself. That matters: the alternative
 * is exempting this file from the check, and an exemption is how a rule quietly
 * stops being enforced.
 *
 *   U+2014  em dash
 *   U+2015  horizontal bar (renders as an em dash in prose)
 *
 * The en dash U+2013 is deliberately NOT included. It is legitimate in numeric
 * ranges ("0 to 100" written as a range) and is used as a deliberate "not
 * included" glyph in the pricing comparison table, where replacing it with a
 * comma would be meaningless.
 *
 * No em dashes in this file.
 */

const EM_DASH = /[\u2014\u2015]/g;
const EM_DASH_SPACED = /\s*[\u2014\u2015]\s*/g;

/** True when a string still carries an em dash. */
export function containsEmDash(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  EM_DASH.lastIndex = 0;
  return EM_DASH.test(s);
}

/**
 * Apply the house rule to a string.
 *
 * A dash with spaces around it is a clause break and becomes a comma plus a
 * space. A dash sitting tight between two words is doing the same job without
 * the spaces, so it becomes a comma plus a space too. Nothing else about the
 * sentence is touched: this is a punctuation substitution, not a rewrite.
 */
export function stripEmDashes(s: string): string {
  if (typeof s !== 'string') return '';
  return s.replace(EM_DASH_SPACED, ', ').replace(EM_DASH, ', ');
}

/**
 * Apply the rule across every string in a plain object or array, in place of
 * hand-patching each field at each call site.
 *
 * Used where a whole record of user-visible text arrives at once (seeded report
 * narrative, for instance). Non-string values pass through untouched, so this
 * is safe to run over a mixed record.
 */
export function stripEmDashesDeep<T>(value: T): T {
  if (typeof value === 'string') return stripEmDashes(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripEmDashesDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripEmDashesDeep(v);
    return out as unknown as T;
  }
  return value;
}
