export interface IcsInput {
  title: string;
  scheduled_datetime?: string | null;
  duration_minutes?: number | null;
  description?: string;
  live_url?: string | null;
  /** Surfaced as ORGANIZER:CN=... in the event AND prepended to
   *  DESCRIPTION as "Hosted by ..." so it shows up in Apple Calendar
   *  even when the client ignores ORGANIZER for non-invite events. */
  organizer?: string;
  /** RFC 5545 needs RFC 822 quote-pairs in TEXT values; we only
   *  escape the bare minimum (newlines, commas, semicolons,
   *  backslashes) per the spec. */
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Triggers a download of an .ics file for the given session. Defaults to 90 min
 * when `duration_minutes` isn't provided. No-op when `scheduled_datetime` is
 * missing or invalid.
 */
export function downloadIcs(session: IcsInput): void {
  if (typeof window === 'undefined' || !session.scheduled_datetime) return;
  const start = new Date(session.scheduled_datetime);
  if (isNaN(start.getTime())) return;
  const durationMin = session.duration_minutes && session.duration_minutes > 0 ? session.duration_minutes : 90;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const descParts: string[] = [];
  if (session.organizer)   descParts.push(`Hosted by ${session.organizer}`);
  if (session.description) descParts.push(session.description);
  if (session.live_url)    descParts.push(`Join: ${session.live_url}`);
  const desc = icsEscape(descParts.join('\n\n'));

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Financial Modeler Pro//Live Sessions//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@financialmodelerpro.com`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${icsEscape(session.title)}`,
    `DESCRIPTION:${desc}`,
    session.live_url ? `LOCATION:${icsEscape(session.live_url)}` : '',
    session.live_url ? `URL:${session.live_url}` : '',
    session.organizer ? `ORGANIZER;CN=${icsEscape(session.organizer)}:MAILTO:noreply@financialmodelerpro.com` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([lines], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${session.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}
