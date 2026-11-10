/**
 * Matching a Teams attendee who has NO email to a student, by display name
 * (2026-11-10). Students without a Microsoft account join Teams as guests and
 * the attendance report carries only the name they typed. Pure.
 *
 * Candidates are the students who clicked Join for THAT session (the logged
 * join route), never the whole roster, so a common name cannot pull in someone
 * who was not there.
 *
 *   1. exact    the same name after trimming and collapsing spaces
 *   2. close    the same letters and digits, ignoring case, spaces,
 *               punctuation and accents
 *
 * A record is linked ONLY when exactly one candidate matches at the first step
 * that finds any. Two or more is ambiguous, and none is no match: both leave
 * the record unmatched, with the likely students suggested for the admin.
 */

export interface NameCandidate { email: string; name: string }
export type NameMatchHow = 'exact' | 'close';
export interface NameSuggestion extends NameCandidate { reason: 'exact' | 'close' | 'partial' }
export interface NameMatchResult { studentEmail: string | null; how: NameMatchHow | null; suggestions: NameSuggestion[] }

/** Trimmed, inner whitespace collapsed (case kept): the "exact" form. */
export function exactName(s: string | null | undefined): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

/** Letters and digits only, lower case, accents removed: the "close" form. */
export function looseName(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function tokens(s: string): string[] {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
}

export function matchByName(displayName: string | null | undefined, candidates: NameCandidate[]): NameMatchResult {
  const seen = new Set<string>();
  const pool = candidates.filter((c) => c.email && c.name && exactName(c.name) && !seen.has(c.email.toLowerCase()) && seen.add(c.email.toLowerCase()));
  const name = exactName(displayName);
  if (!name || !looseName(name)) return { studentEmail: null, how: null, suggestions: [] };

  const exact = pool.filter((c) => exactName(c.name) === name);
  if (exact.length === 1) return { studentEmail: exact[0].email.toLowerCase(), how: 'exact', suggestions: [] };
  const close = pool.filter((c) => looseName(c.name) === looseName(name));
  if (!exact.length && close.length === 1) return { studentEmail: close[0].email.toLowerCase(), how: 'close', suggestions: [] };

  // Not one clear match: suggest the likely students, best first.
  const out: NameSuggestion[] = [];
  const add = (c: NameCandidate, reason: NameSuggestion['reason']) => { if (!out.some((o) => o.email === c.email)) out.push({ ...c, reason }); };
  exact.forEach((c) => add(c, 'exact'));
  close.forEach((c) => add(c, 'close'));
  const mine = new Set(tokens(name));
  pool
    .map((c) => ({ c, shared: tokens(c.name).filter((t) => mine.has(t)).length }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .forEach((x) => add(x.c, 'partial'));
  return { studentEmail: null, how: null, suggestions: out.slice(0, 5) };
}

/**
 * Not a student (founder, 2026-11-10): the meeting organizer or a co-organizer
 * (Teams role), or the host account (TEAMS_HOST_USER_EMAIL). Never matched to
 * a student, never on the unmatched list; shown apart as "Host". Pure.
 */
export function isHostAttendee(a: { role?: string | null; email?: string | null }, hostEmail?: string | null): boolean {
  if (a.role && /organi[sz]er/i.test(a.role)) return true;
  const e = (a.email ?? '').trim().toLowerCase();
  const h = (hostEmail ?? '').trim().toLowerCase();
  return !!h && e === h;
}

/** A bot, assistant or note-taker that joined the meeting (e.g. "Ahmad's Assistant"). Pure. */
export const BOT_NAME_PATTERN = /\b(assistant|note[\s-]?taker|copilot|recorder|facilitator|bot)\b/i;
export function isBotAttendee(a: { name?: string | null; email?: string | null }): boolean {
  if (BOT_NAME_PATTERN.test(a.name ?? '')) return true;
  return /(^|[._+-])bot([._+-]|@)/i.test(a.email ?? '');
}

/** Why a record is not a student, or null. */
export function excludedReason(a: { role?: string | null; email?: string | null; name?: string | null }, hostEmail?: string | null): 'host' | 'bot' | null {
  if (isHostAttendee(a, hostEmail)) return 'host';
  if (isBotAttendee(a)) return 'bot';
  return null;
}

/** May a suggestion be pre-selected for the admin? Only an exact or close FULL-name match; a partial match is a hint. */
export function preselectable(s: Pick<NameSuggestion, 'reason'> | undefined): boolean {
  return !!s && (s.reason === 'exact' || s.reason === 'close');
}

/** How a record was matched, as the admin reads it. */
export const MATCHED_BY_LABEL: Record<string, string> = {
  email: 'By email',
  alias: 'By saved match',
  name: 'By name',
  manual: 'By hand',
};
