'use client';

/**
 * Live courses open for registration on the public Training Sessions page.
 *
 * A new visitor registers here, which creates the Training Hub account AND
 * enrols them in the course in one step (the course rides through email
 * confirmation). A signed-in student enrols with one click on the course page.
 * An existing account that is signed out uses "Sign in to enrol", and the
 * register form sends a duplicate email to the same place, so no second
 * account is ever made.
 */
import Link from 'next/link';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';

export interface PublicCourseOffer {
  courseCode: string;
  title: string;
  description: string;
  sessions: { no: number | null; title: string; scheduled_datetime: string | null }[];
}

const NAVY = '#1B4F8A';
const DARK = '#0D2E5A';
const SLATE = '#5A6675';

export function PublicCourseOffers({ courses, isLoggedIn }: { courses: PublicCourseOffer[]; isLoggedIn: boolean }) {
  if (!courses.length) return null;
  return (
    <section style={{ background: '#F5F7FA', padding: 'clamp(28px,4vw,48px) 16px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 20 }}>
        {courses.map((c) => {
          const coursePath = `/training/live-course/${encodeURIComponent(c.courseCode)}`;
          const enrolPath = `${coursePath}?enrol=1`;
          const registerHref = isLoggedIn ? enrolPath : `/register?course=${encodeURIComponent(c.courseCode)}`;
          const signinHref = `/signin?redirect=${encodeURIComponent(enrolPath)}`;
          const first = c.sessions.find((s) => s.scheduled_datetime);
          return (
            <div key={c.courseCode} data-testid="public-course-offer" style={{ background: '#fff', border: '2px solid #DDE7F3', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ background: `linear-gradient(135deg, ${DARK}, ${NAVY})`, color: '#fff', padding: '22px 26px' }}>
                <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.85 }}>Live course · Microsoft Teams</div>
                <h2 style={{ fontSize: 'clamp(20px,3vw,26px)', fontWeight: 800, margin: '6px 0 6px' }}>{c.title}</h2>
                <p style={{ margin: 0, opacity: 0.92, fontSize: 14, lineHeight: 1.5 }}>{c.description}</p>
                {first && <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.9 }}>Starts {formatSessionTime(first.scheduled_datetime)}</p>}
              </div>
              <div style={{ padding: '18px 26px 22px' }}>
                {c.sessions.length > 0 && (
                  <ol style={{ margin: '0 0 16px', paddingLeft: 18, color: '#2A3440', fontSize: 14, lineHeight: 1.8 }}>
                    {c.sessions.map((s, i) => (
                      <li key={i}><strong>{s.title}</strong> <span style={{ color: SLATE }}>· {formatSessionTime(s.scheduled_datetime)}</span></li>
                    ))}
                  </ol>
                )}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Link data-testid="public-course-register" href={registerHref} style={{ background: '#2E7D52', color: '#fff', padding: '12px 26px', borderRadius: 8, fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>
                    {isLoggedIn ? 'Enrol in this course →' : 'Register for this course →'}
                  </Link>
                  {!isLoggedIn && (
                    <Link data-testid="public-course-signin" href={signinHref} style={{ color: NAVY, fontWeight: 700, fontSize: 14 }}>
                      Already have an account? Sign in to enrol
                    </Link>
                  )}
                </div>
                <p style={{ margin: '12px 0 0', fontSize: 12.5, color: SLATE }}>
                  Free. Certification by attending live or watching the recordings, plus an approved model.
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
