export interface IcsInput {
  title: string;
  scheduled_datetime?: string | null;
  duration_minutes?: number | null;
  description?: string;
  live_url?: string | null;
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
  const desc = (session.description ?? '').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${session.title}`,
    `DESCRIPTION:${desc}${session.live_url ? '\\nJoin: ' + session.live_url : ''}`,
    session.live_url ? `URL:${session.live_url}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([lines], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${session.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}
