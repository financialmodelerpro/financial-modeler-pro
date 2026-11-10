/**
 * Live-course times. Every REFM session is stated in KSA, so the one display
 * zone is Asia/Riyadh, and an admin's typed wall-clock time is converted to UTC
 * in the SESSION's zone, never the admin browser's (that was bug 4: 7:00 PM
 * typed on a Pakistan machine was stored as 5:00 PM KSA).
 */

export const KSA_TZ = 'Asia/Riyadh';

/** "Tue, 1 Dec 2026, 7:00 PM KSA" (or the zone's own abbreviation label). */
export function formatSessionTime(iso: string | null | undefined, timeZone = KSA_TZ, label = 'KSA'): string {
  if (!iso) return 'Date to be announced';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date to be announced';
  const s = d.toLocaleString('en-GB', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${s.replace(' am', ' AM').replace(' pm', ' PM')} ${label}`;
}

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
export function zonedDate(iso: string | Date, timeZone = KSA_TZ): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-CA', { timeZone });
}

/** The wall-clock "YYYY-MM-DD" and "HH:mm" of an instant in a zone. */
export function utcToZonedParts(iso: string, timeZone = KSA_TZ): { date: string; time: string } {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Offset of a zone from UTC at an instant, in minutes (KSA = +180). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * A wall-clock date and time IN `timeZone` to a UTC ISO string.
 * `date` is YYYY-MM-DD, `time` is HH:mm. Returns null when malformed.
 */
export function zonedWallTimeToUtc(date: string, time: string, timeZone = KSA_TZ): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!dm || !tm) return null;
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  // Two passes settle any DST edge; KSA has none, but the zone is a field.
  let utc = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  utc = guess - zoneOffsetMinutes(new Date(utc), timeZone) * 60000;
  return new Date(utc).toISOString();
}

// ── Course session time labels (2026-11-10, founder): KSA first, everywhere ──

const clockIn = (d: Date, timeZone: string) =>
  d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/[  ]/g, ' ');
const dayIn = (d: Date, timeZone: string) =>
  d.toLocaleDateString('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');

/** "Tue 1 Dec, 7:00 PM KSA": a course session's time, KSA first. */
export function courseTimeLabel(iso: string | null | undefined): string {
  if (!iso) return 'Date to be announced';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date to be announced';
  return `${dayIn(d, KSA_TZ)}, ${clockIn(d, KSA_TZ)} KSA`;
}

/**
 * The viewer's own time, when their zone shows a different clock at that
 * instant: "(9:00 PM your time)", or with the day when it differs too,
 * "(Wed 2 Dec, 1:00 AM your time)". Empty when the viewer is on KSA time.
 */
export function viewerTimeSuffix(iso: string | null | undefined, viewerTz: string | null | undefined): string {
  if (!iso || !viewerTz) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let mine: string, ksa: string, myDay: string;
  try { mine = clockIn(d, viewerTz); myDay = dayIn(d, viewerTz); ksa = clockIn(d, KSA_TZ); } catch { return ''; }
  if (mine === ksa && myDay === dayIn(d, KSA_TZ)) return '';
  return myDay === dayIn(d, KSA_TZ) ? `(${mine} your time)` : `(${myDay}, ${mine} your time)`;
}
