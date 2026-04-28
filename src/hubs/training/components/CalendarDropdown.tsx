'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { downloadIcs } from '@/src/hubs/training/lib/liveSessions/calendar';

export interface CalendarEvent {
  title:               string;
  description?:        string;
  scheduled_datetime?: string | null;
  duration_minutes?:   number | null;
  timezone?:           string | null;
  /** Teams / Zoom join URL - used as the event location so the
   *  calendar entry has a one-click join button. */
  live_url?:           string | null;
  organizer?:          string;
}

interface Props {
  event:        CalendarEvent;
  /** Visual variant. `pill` = small icon button (matches the prior
   *  download icon button on cards). `inline` = full-width text button
   *  (used inside the session detail register card). */
  variant?:     'pill' | 'inline';
  /** Tooltip / aria-label override. */
  title?:       string;
  /** Accent color for inline variant background. */
  accentColor?: string;
}

const NAVY = '#0D2E5A';

const ICON_SIZE = 15;

const PILL_BUTTON_STYLE: React.CSSProperties = {
  width: 36, height: 36,
  borderRadius: 8,
  background: '#fff',
  border: `1.5px solid ${NAVY}`,
  color: NAVY,
  display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
};

const ITEM_STYLE: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%',
  padding: '10px 14px',
  fontSize: 13,
  color: '#1F2937',
  background: 'transparent',
  border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};

/**
 * Build a uniform description body that lands inside the calendar
 * event regardless of provider. Calendar URL params don't carry an
 * organizer field, so we surface it inline ("Hosted by ...") plus the
 * join link, so a Google/Outlook/Yahoo event has all the context the
 * student needs without flipping back to the dashboard.
 */
function buildDescription(e: CalendarEvent): string {
  const lines: string[] = [];
  if (e.organizer) lines.push(`Hosted by ${e.organizer}`);
  if (e.description) lines.push(e.description);
  if (e.live_url) lines.push(`Join: ${e.live_url}`);
  return lines.join('\n\n');
}

function googleCalendarUrl(e: CalendarEvent, start: Date, end: Date): string {
  // Google's `dates` param uses naive UTC formatting.
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', e.title);
  url.searchParams.set('dates', `${fmt(start)}/${fmt(end)}`);
  if (e.timezone) url.searchParams.set('ctz', e.timezone);
  const desc = buildDescription(e);
  if (desc) url.searchParams.set('details', desc);
  if (e.live_url) url.searchParams.set('location', e.live_url);
  return url.toString();
}

function outlookCalendarUrl(e: CalendarEvent, start: Date, end: Date): string {
  // Outlook web supports both personal and Office 365; live.com URL
  // covers both via its compose deep-link.
  const url = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  url.searchParams.set('path', '/calendar/action/compose');
  url.searchParams.set('rru', 'addevent');
  url.searchParams.set('subject', e.title);
  url.searchParams.set('startdt', start.toISOString());
  url.searchParams.set('enddt', end.toISOString());
  const desc = buildDescription(e);
  if (desc) url.searchParams.set('body', desc);
  if (e.live_url) url.searchParams.set('location', e.live_url);
  return url.toString();
}

function yahooCalendarUrl(e: CalendarEvent, start: Date, end: Date): string {
  // Yahoo wants `st` (start) + `dur` (HHMM duration). Cap dur at 99h59
  // since Yahoo's format can't express longer.
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const hours = Math.min(99, Math.floor(totalMinutes / 60));
  const mins  = totalMinutes % 60;
  const dur = `${String(hours).padStart(2, '0')}${String(mins).padStart(2, '0')}`;
  const url = new URL('https://calendar.yahoo.com/');
  url.searchParams.set('v', '60');
  url.searchParams.set('title', e.title);
  url.searchParams.set('st', fmt(start));
  url.searchParams.set('dur', dur);
  const desc = buildDescription(e);
  if (desc) url.searchParams.set('desc', desc);
  if (e.live_url) url.searchParams.set('in_loc', e.live_url);
  return url.toString();
}

/**
 * Compute event start/end. Defaults to 90 min duration when
 * `duration_minutes` is missing - matches `downloadIcs` behaviour.
 */
function computeRange(e: CalendarEvent): { start: Date; end: Date } | null {
  if (!e.scheduled_datetime) return null;
  const start = new Date(e.scheduled_datetime);
  if (isNaN(start.getTime())) return null;
  const durationMin = e.duration_minutes && e.duration_minutes > 0 ? e.duration_minutes : 90;
  const end = new Date(start.getTime() + durationMin * 60_000);
  return { start, end };
}

/**
 * Multi-provider calendar dropdown. Replaces the single .ics download
 * button so students can add a session to whichever calendar they
 * actually use without manually importing a file. Closes on outside
 * click + Escape. Renders nothing when the session has no
 * `scheduled_datetime` (defensive - cards/pages should not render
 * this for sessions that are missing a time).
 */
export function CalendarDropdown({ event, variant = 'pill', title, accentColor = NAVY }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape. Declared before the early-return
  // below so the hook count is stable across renders.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const range = computeRange(event);
  if (!range) return null;
  const { start, end } = range;

  const triggerStyle: React.CSSProperties = variant === 'inline' ? {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '10px 16px', borderRadius: 8,
    background: '#fff', color: accentColor,
    border: `1.5px solid ${accentColor}`,
    fontSize: 13, fontWeight: 700,
    cursor: 'pointer',
  } : PILL_BUTTON_STYLE;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        title={title ?? 'Add to calendar'}
        aria-label={title ?? 'Add to calendar'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={triggerStyle}
      >
        <CalendarPlus size={ICON_SIZE} />
        {variant === 'inline' && <span>Add to Calendar</span>}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 220,
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(13,46,90,0.15)',
            overflow: 'hidden',
            zIndex: 200,
          }}
        >
          <a
            href={googleCalendarUrl(event, start, end)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            style={ITEM_STYLE}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            role="menuitem"
          >
            <span style={{ fontSize: 16 }}>📅</span> Google Calendar
          </a>
          <a
            href={outlookCalendarUrl(event, start, end)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            style={ITEM_STYLE}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            role="menuitem"
          >
            <span style={{ fontSize: 16 }}>📨</span> Outlook Calendar
          </a>
          <button
            type="button"
            onClick={() => { downloadIcs(event); setOpen(false); }}
            style={ITEM_STYLE}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            role="menuitem"
          >
            <span style={{ fontSize: 16 }}>🍎</span> Apple Calendar (.ics)
          </button>
          <a
            href={yahooCalendarUrl(event, start, end)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            style={ITEM_STYLE}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            role="menuitem"
          >
            <span style={{ fontSize: 16 }}>🟣</span> Yahoo Calendar
          </a>
          <button
            type="button"
            onClick={() => { downloadIcs(event); setOpen(false); }}
            style={{ ...ITEM_STYLE, borderTop: '1px solid #F3F4F6', color: '#6B7280', fontSize: 12 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            role="menuitem"
          >
            <span style={{ fontSize: 14 }}>⬇️</span> Download .ics (other apps)
          </button>
        </div>
      )}
    </div>
  );
}
