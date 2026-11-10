/**
 * The course calendar file (.ics), one VEVENT per session. Pure.
 *
 * Each event's UID is fixed per session (`live-session-<id>@...`), and its
 * SEQUENCE is the session's ics_sequence, bumped on every reschedule, so a
 * calendar that already holds the event MOVES it instead of adding another.
 * The meeting link is never written into the file (it only lives behind the
 * logged join route); the event points at the course page, where Join opens.
 */
import { DEFAULT_DURATION_MINUTES } from './joinWindow';
import { coursePagePath } from './paths';
import { overviewText, type SessionContentRow } from './sessionContent';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const DOMAIN = 'financialmodelerpro.com';

export interface IcsSession extends SessionContentRow {
  id: string;
  title: string;
  course_session_no: number | null;
  scheduled_datetime: string | null;
  duration_minutes: number | null;
  content_overview?: string | null;
  ics_sequence?: number | null;
}

export function eventUid(sessionId: string): string {
  return `live-session-${sessionId}@${DOMAIN}`;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545 text escaping. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Fold lines over 75 octets (RFC 5545 3.1). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i ? ' ' : '') + line.slice(i, i + 73));
  return out.join('\r\n');
}

export function buildCourseIcs(
  course: { courseCode: string; title: string },
  sessions: IcsSession[],
  now: Date = new Date(),
): string {
  const page = `${LEARN_URL}${coursePagePath(course.courseCode)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Financial Modeler Pro//Live Course//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(course.title)}`,
  ];
  for (const s of sessions) {
    if (!s.scheduled_datetime) continue;
    const start = new Date(s.scheduled_datetime);
    const end = new Date(start.getTime() + (s.duration_minutes && s.duration_minutes > 0 ? s.duration_minutes : DEFAULT_DURATION_MINUTES) * 60_000);
    const label = s.course_session_no != null ? `Session ${s.course_session_no}: ${s.title}` : s.title;
    const overview = overviewText(s);
    const desc = `${overview ? `${overview}\n\n` : ''}Join from your course page (the Join live button opens shortly before the start): ${page}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(s.id)}`,
      `SEQUENCE:${Math.max(0, s.ics_sequence ?? 0)}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${course.title}: ${label}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      `LOCATION:${esc('Microsoft Teams (join from your course page)')}`,
      `URL:${page}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** As an email attachment (base64). */
export function icsAttachment(ics: string, courseCode: string): { name: string; content: string } {
  return { name: `${courseCode}-live-sessions.ics`, content: Buffer.from(ics, 'utf8').toString('base64') };
}
