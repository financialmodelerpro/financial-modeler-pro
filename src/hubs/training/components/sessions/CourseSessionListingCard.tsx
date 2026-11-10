'use client';

/**
 * A live course session on the public Training Sessions page: the whole
 * 16:9 session image (never cropped, no text over it), then "Session X of N",
 * the title, the KSA date and time, a Rescheduled label, and "Part of
 * <CODE> Live Series" linking to the course. The main button is the course's
 * (liveCourse/publicListing.courseCardAction), never single-session
 * registration.
 */
import Link from 'next/link';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { courseCardAction, seriesLabel } from '@/src/hubs/training/lib/liveCourse/publicListing';
import { CourseTime } from '@/src/hubs/training/components/sessions/CourseTime';

const NAVY = '#0D2E5A';
const BLUE = '#1B4F8A';
const SLATE = '#5A6675';
const GREEN = '#2E7D52';

export interface CourseListingSession {
  id: string;
  title: string;
  scheduled_datetime: string;
  banner_url: string | null;
  banner_alt?: string | null;
  course_code: string;
  course_session_no: number | null;
  course_short_title?: string | null;
  rescheduled_from?: string | null;
  youtube_url?: string | null;
}

export function CourseSessionListingCard({ s, total, enrolled, signedIn, enrolmentOpen, recorded }: {
  s: CourseListingSession;
  total: number;
  enrolled: boolean;
  signedIn: boolean;
  enrolmentOpen: boolean;
  recorded: boolean;
}) {
  const action = courseCardAction({ courseCode: s.course_code, sessionId: s.id, enrolled, signedIn, enrolmentOpen });
  const label = recorded && action.kind === 'view' ? 'Watch recording' : action.label;
  return (
    <div data-testid="course-session-listing" className="session-card" style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {s.banner_url && (
        <div style={{ aspectRatio: '16 / 9', background: '#E8EEF7' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-testid="course-session-listing-image" src={s.banner_url} alt={s.banner_alt || s.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
      )}
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {s.course_session_no != null && (
            <span style={{ fontSize: 11, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: 0.5 }}>Session {s.course_session_no} of {total}</span>
          )}
          {s.rescheduled_from && (
            <span data-testid="course-session-listing-rescheduled" style={{ background: '#FFF4E5', color: '#9A5B00', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>Rescheduled</span>
          )}
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, color: NAVY, lineHeight: 1.35 }}>{s.title}</div>
        <div style={{ fontSize: 13, color: SLATE }}><CourseTime iso={s.scheduled_datetime} /></div>
        <Link data-testid="course-session-listing-series" href={coursePagePath(s.course_code)} style={{ fontSize: 12.5, fontWeight: 700, color: BLUE, textDecoration: 'none' }}>
          Part of {seriesLabel(s.course_short_title, s.course_code)} →
        </Link>
        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <Link data-testid="course-session-listing-action" data-action={action.kind} href={action.href}
            style={{ display: 'inline-flex', padding: '9px 18px', borderRadius: 8, background: action.kind === 'view' ? BLUE : GREEN, color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            {label}
          </Link>
        </div>
      </div>
    </div>
  );
}
