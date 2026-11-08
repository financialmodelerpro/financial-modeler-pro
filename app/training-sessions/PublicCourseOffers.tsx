'use client';

/**
 * Published live courses at the top of the public Training Sessions page.
 *
 * A new visitor registers here, which creates the Training Hub account AND
 * enrols them in one step (the course rides through email confirmation). A
 * signed-in student enrols with one click on the course page. An existing
 * account that is signed out uses "Sign in to enrol", and the register form
 * sends a duplicate email to the same place, so no second account is made.
 * Only PUBLISHED courses reach this list (courseSettings.isPubliclyVisible);
 * a published course with enrolment closed shows "Enrolment closed".
 */
import Link from 'next/link';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import { TimeZoneTable } from '@/src/hubs/training/components/sessions/TimeZoneTable';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';

export interface PublicCourseOffer {
  courseCode: string;
  title: string;
  tagline?: string;
  description: string;
  cardImageUrl?: string | null;
  cardImageAlt?: string;
  enrolmentOpen?: boolean;
  timeZones?: string[] | null;
  sessions: { no: number | null; title: string; scheduled_datetime: string | null }[];
}

const NAVY = '#1B4F8A';
const DARK = '#0D2E5A';
const SLATE = '#5A6675';

/** "8 weekly sessions, Tuesdays, from 1 Dec 2026" style summary. */
function scheduleSummary(sessions: PublicCourseOffer['sessions']): string {
  const dated = sessions.filter((s) => s.scheduled_datetime).map((s) => new Date(s.scheduled_datetime!));
  if (!dated.length) return sessions.length ? `${sessions.length} sessions, dates to be announced` : 'Schedule to be announced';
  const days = new Set(dated.map((d) => d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Riyadh' })));
  const weekly = dated.length > 1 && dated.every((d, i) => i === 0 || Math.round((d.getTime() - dated[i - 1].getTime()) / 86_400_000) === 7);
  const from = dated[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' });
  return `${sessions.length} ${weekly ? 'weekly ' : ''}session${sessions.length === 1 ? '' : 's'}${days.size === 1 ? `, ${[...days][0]}s` : ''}, from ${from}`;
}

export function PublicCourseOffers({ courses, isLoggedIn }: { courses: PublicCourseOffer[]; isLoggedIn: boolean }) {
  if (!courses.length) return null;
  return (
    <section style={{ background: '#F5F7FA', padding: 'clamp(28px,4vw,48px) 16px' }}>
      {/* Image beside the text on wide screens, above it on phones; the image box is always 16:9. */}
      <style>{`
        .pco-card { display: grid; grid-template-columns: 1fr; }
        .pco-card--image { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
        .pco-card--image .pco-card__image { align-self: center; }
        @media (max-width: 720px) { .pco-card--image { grid-template-columns: 1fr; } }
      `}</style>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 20 }}>
        {courses.map((c) => {
          const coursePath = coursePagePath(c.courseCode);
          const enrolPath = `${coursePath}?enrol=1`;
          const open = c.enrolmentOpen !== false;
          const registerHref = isLoggedIn ? enrolPath : `/register?course=${encodeURIComponent(c.courseCode)}`;
          const signinHref = `/signin?redirect=${encodeURIComponent(enrolPath)}`;
          const next = c.sessions.find((s) => s.scheduled_datetime && new Date(s.scheduled_datetime).getTime() > Date.now());
          return (
            <div key={c.courseCode} data-testid="public-course-offer" className={c.cardImageUrl ? 'pco-card pco-card--image' : 'pco-card'} style={{ background: '#fff', border: '2px solid #DDE7F3', borderRadius: 16, overflow: 'hidden' }}>
              {c.cardImageUrl && (
                // The box is exactly 16:9, the card image's own shape (1200 x 675),
                // so the whole image shows with no crop at any width. It used to take
                // its height from the text beside it, which cropped the image.
                <Link href={coursePath} className="pco-card__image" style={{ display: 'block', aspectRatio: '16 / 9', background: '#E8EEF7' }}>
                  <img src={c.cardImageUrl} alt={c.cardImageAlt || c.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </Link>
              )}
              <div style={{ padding: '20px 24px 22px' }}>
                <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: SLATE, fontWeight: 700 }}>Live course · Microsoft Teams</div>
                <h2 style={{ fontSize: 'clamp(20px,3vw,26px)', fontWeight: 800, margin: '6px 0 4px', color: DARK }}>
                  <Link href={coursePath} style={{ color: 'inherit', textDecoration: 'none' }}>{c.title}</Link>
                </h2>
                {c.tagline && <p style={{ margin: '0 0 8px', color: '#2A3440', fontSize: 15 }}>{c.tagline}</p>}
                <p data-testid="public-course-schedule" style={{ margin: '0 0 4px', fontSize: 13.5, color: NAVY, fontWeight: 600 }}>{scheduleSummary(c.sessions)}</p>
                {next && <p style={{ margin: '0 0 12px', fontSize: 13.5, color: SLATE }}>Next session: {formatSessionTime(next.scheduled_datetime)}</p>}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                  {open ? (
                    <Link data-testid="public-course-register" href={registerHref} style={{ background: '#2E7D52', color: '#fff', padding: '11px 24px', borderRadius: 8, fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>
                      {isLoggedIn ? 'Enrol in this course →' : 'Register for this course →'}
                    </Link>
                  ) : (
                    <span data-testid="public-course-enrolment-closed" aria-disabled="true" style={{ background: '#F1F3F5', color: SLATE, padding: '11px 24px', borderRadius: 8, fontWeight: 800, fontSize: 14 }}>Enrolment closed</span>
                  )}
                  <Link href={coursePath} style={{ color: NAVY, fontWeight: 700, fontSize: 14 }}>Course details</Link>
                  {open && !isLoggedIn && (
                    <Link data-testid="public-course-signin" href={signinHref} style={{ color: NAVY, fontSize: 13.5 }}>Already have an account? Sign in to enrol</Link>
                  )}
                </div>
                {next && <TimeZoneTable iso={next.scheduled_datetime} zones={c.timeZones} collapsible />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
