'use client';

/**
 * ONE live-course session card (course page; the landing page curriculum).
 *   public    number, title, KSA date and time, overview, and the rest
 *             (what you will learn, by the end, build with Claude) behind
 *             "See what you will learn"; a collapsible time zone table
 *   enrolled  all four content fields open, plus whatever the page passes as
 *             `actions` (Join, recording, progress, certificate) and materials
 * A rescheduled session shows "Rescheduled" with its previous date.
 */
import type { ReactNode } from 'react';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import { TimeZoneTable } from './TimeZoneTable';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';

export interface CourseSessionCardData {
  id: string;
  title: string;
  course_session_no: number | null;
  scheduled_datetime: string | null;
  banner_url?: string | null;
  content_overview?: string | null;
  content_learn?: string[] | null;
  content_outcome?: string | null;
  content_claude?: string | null;
  rescheduled_from?: string | null;
}

export function CourseSessionCard({
  s, expanded, zones, imageUrl, actions, materials,
}: {
  s: CourseSessionCardData;
  /** Enrolled students see every content field open. */
  expanded: boolean;
  zones?: string[] | null;
  /** The card image (session banner, falling back to the course card image); omitted = no image. */
  imageUrl?: string | null;
  actions?: ReactNode;
  materials?: { id: string; fileName: string; url: string | null }[];
}) {
  const learn = (s.content_learn ?? []).filter(Boolean);
  const details = (
    <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
      {learn.length > 0 && (
        <div>
          <div style={{ fontWeight: 800, color: NAVY, fontSize: 13.5, marginBottom: 4 }}>What you will learn</div>
          <ul data-testid="session-learn" style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>{learn.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
      {s.content_outcome && <div><div style={{ fontWeight: 800, color: NAVY, fontSize: 13.5 }}>By the end of this session</div><p style={{ margin: '2px 0 0', fontSize: 14, lineHeight: 1.55 }}>{s.content_outcome}</p></div>}
      {s.content_claude && <div><div style={{ fontWeight: 800, color: NAVY, fontSize: 13.5 }}>Build with Claude</div><p style={{ margin: '2px 0 0', fontSize: 14, lineHeight: 1.55 }}>{s.content_claude}</p></div>}
    </div>
  );
  const hasDetails = learn.length > 0 || !!s.content_outcome || !!s.content_claude;

  return (
    <div data-testid="live-course-session" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 12, overflow: 'hidden' }}>
      {imageUrl && (
        <div style={{ aspectRatio: '16 / 9', background: '#E8EEF7' }}>
          <img data-testid="session-card-image" src={imageUrl} alt={s.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
      )}
      <div style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: NAVY, fontSize: 13 }}>{s.course_session_no != null ? `Session ${s.course_session_no}` : 'Session'}</span>
          <span style={{ fontSize: 13, color: SLATE }}>{formatSessionTime(s.scheduled_datetime)}</span>
          {s.rescheduled_from && (
            <span data-testid="session-rescheduled" style={{ background: '#FFF4E5', color: '#9A5B00', borderRadius: 10, padding: '2px 8px', fontSize: 11.5, fontWeight: 800 }}>
              Rescheduled · was {formatSessionTime(s.rescheduled_from)}
            </span>
          )}
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, margin: '4px 0 0' }}>{s.title}</div>
        {s.content_overview && <p data-testid="session-overview" style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.55, color: '#2A3440' }}>{s.content_overview}</p>}
        {hasDetails && (expanded ? details : (
          <details style={{ marginTop: 8 }}>
            <summary data-testid="session-see-more" style={{ cursor: 'pointer', color: NAVY, fontWeight: 700, fontSize: 13.5 }}>See what you will learn</summary>
            {details}
          </details>
        ))}
        {materials && materials.length > 0 && (
          <div data-testid="session-materials" style={{ marginTop: 10, fontSize: 13.5 }}>
            <span style={{ fontWeight: 800, color: NAVY }}>Materials: </span>
            {materials.map((m, i) => (
              <span key={m.id}>{i ? ' · ' : ''}{m.url
                ? <a href={m.url} style={{ color: NAVY, fontWeight: 600 }}>{m.fileName}</a>
                : <span style={{ color: SLATE }} title="Released after the session ends">{m.fileName} (after the session)</span>}</span>
            ))}
          </div>
        )}
        {actions && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>{actions}</div>}
        {s.scheduled_datetime && <TimeZoneTable iso={s.scheduled_datetime} zones={zones} collapsible />}
      </div>
    </div>
  );
}
