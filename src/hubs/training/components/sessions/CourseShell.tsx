'use client';

/**
 * The live course layout (2026-11-08): a left sidebar on every course page
 * (overview and each session) beside the page content. Visual reference: the
 * Articles series sidebar (navy card, numbered circles, "You are here",
 * Hide / Show). Sticky on desktop; on phones a "Sessions" button opens the
 * list as a drawer. Rules (status, order) come from liveCourse/courseNav.ts.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { coursePagePath, courseSessionPath } from '@/src/hubs/training/lib/liveCourse/paths';
import { navStatus, orderSessions, STATUS_LABEL, type NavSession, type NavStatus } from '@/src/hubs/training/lib/liveCourse/courseNav';

const NAVY = '#0D2E5A';
const ACCENT = '#9EC3E8';
const GOLD = '#C9A84C';
const HIDE_KEY = 'fmp-course-sidebar-hidden';

const STATUS_COLOR: Record<NavStatus, string> = {
  upcoming: 'rgba(255,255,255,0.55)', rescheduled: '#FBBF24', live: '#4ADE80', recorded: ACCENT, ended: 'rgba(255,255,255,0.55)',
};

function shortDate(iso: string | null): string {
  if (!iso) return 'Date to be announced';
  try { return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh', weekday: 'short', day: 'numeric', month: 'short' }); } catch { return ''; }
}

export interface CourseShellProps {
  courseCode: string;
  courseTitle: string;
  sessions: NavSession[];
  /** 'overview' or the current session id. */
  current: string;
  /** Sessions the signed-in student has completed (attendance or recording rule met). */
  completed?: Set<string>;
  /** Server time, so the status labels render the same on server and browser. */
  now: number;
  children: ReactNode;
}

export function CourseSidebarList({ courseCode, courseTitle, sessions, current, completed, now, onNavigate }: Omit<CourseShellProps, 'children'> & { onNavigate?: () => void }) {
  const here = (k: string) => k === current;
  return (
    <nav data-testid="course-sidebar" aria-label={`${courseTitle} sessions`} style={{ background: NAVY, borderRadius: 14, padding: '14px 12px 16px', color: '#fff' }}>
      <Link href={coursePagePath(courseCode)} onClick={onNavigate} data-testid="course-sidebar-overview" aria-current={here('overview') ? 'page' : undefined}
        style={{ display: 'block', padding: '9px 10px', borderRadius: 8, textDecoration: 'none', fontSize: 13.5, fontWeight: 800, color: '#fff', background: here('overview') ? 'rgba(158,195,232,0.18)' : 'transparent', borderLeft: here('overview') ? `3px solid ${GOLD}` : '3px solid transparent' }}>
        Course overview
      </Link>
      <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '12px 10px 8px' }}>Sessions</div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {orderSessions(sessions).map((s, i) => {
          const isHere = here(s.id);
          const st = navStatus(s, now);
          const done = completed?.has(s.id);
          return (
            <li key={s.id}>
              <Link href={courseSessionPath(courseCode, s.id)} onClick={onNavigate} data-testid="course-sidebar-session" data-current={isHere ? 'true' : undefined} data-status={st} aria-current={isHere ? 'page' : undefined}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 8px', borderRadius: 8, textDecoration: 'none', background: isHere ? 'rgba(158,195,232,0.16)' : 'transparent' }}>
                <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 800, background: done ? '#2E7D52' : isHere ? ACCENT : 'rgba(255,255,255,0.1)', color: done ? '#fff' : isHere ? NAVY : 'rgba(255,255,255,0.8)' }}>
                  {done ? <span data-testid="course-sidebar-done" aria-label="Completed">✓</span> : (s.course_session_no ?? i + 1)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: isHere ? 700 : 500, color: isHere ? '#fff' : 'rgba(255,255,255,0.82)', lineHeight: 1.35 }}>{s.title}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                    {shortDate(s.scheduled_datetime)} · <span data-testid="course-sidebar-status" style={{ color: STATUS_COLOR[st], fontWeight: 700 }}>{STATUS_LABEL[st]}</span>
                  </span>
                  {isHere && <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, color: ACCENT, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>You are here</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function CourseShell(props: CourseShellProps) {
  const { children, ...nav } = props;
  const [hidden, setHidden] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // Per-viewer convenience only: remember Hide / Show.
  useEffect(() => {
    const t = setTimeout(() => { try { setHidden(localStorage.getItem(HIDE_KEY) === '1'); } catch { /* private window */ } }, 0);
    return () => clearTimeout(t);
  }, []);
  const setHide = (v: boolean) => { setHidden(v); try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

  return (
    <div data-testid="course-shell" className={`cs-shell${hidden ? ' cs-shell--hidden' : ''}`}>
      <style>{`
        .cs-shell { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 28px; align-items: start; }
        .cs-shell--hidden { grid-template-columns: minmax(0, 1fr); }
        .cs-aside { position: sticky; top: 84px; max-height: calc(100vh - 100px); overflow-y: auto; }
        .cs-mobile-btn { display: none; }
        @media (max-width: 900px) {
          .cs-shell, .cs-shell--hidden { grid-template-columns: minmax(0, 1fr); }
          .cs-aside, .cs-show { display: none !important; }
          .cs-mobile-btn { display: inline-flex; }
        }
      `}</style>

      {!hidden && (
        <aside className="cs-aside">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button type="button" onClick={() => setHide(true)} data-testid="course-sidebar-hide" aria-label="Hide sessions"
              style={{ background: '#fff', border: '1px solid #DDE7F3', color: '#5A6675', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✕ Hide</button>
          </div>
          <CourseSidebarList {...nav} />
        </aside>
      )}

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {hidden && (
            <button type="button" className="cs-show" onClick={() => setHide(false)} data-testid="course-sidebar-show"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: NAVY, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>☰ Show sessions</button>
          )}
          <button type="button" className="cs-mobile-btn" onClick={() => setDrawer(true)} data-testid="course-sidebar-mobile"
            style={{ alignItems: 'center', gap: 8, background: NAVY, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>☰ Sessions</button>
        </div>
        {children}
      </div>

      {drawer && (
        <div role="dialog" aria-modal="true" aria-label="Sessions" data-testid="course-sidebar-drawer" onClick={() => setDrawer(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(13,46,90,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 'min(320px, 86vw)', overflowY: 'auto', background: '#fff', padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button type="button" onClick={() => setDrawer(false)} style={{ background: '#fff', border: '1px solid #DDE7F3', color: '#5A6675', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✕ Close</button>
            </div>
            <CourseSidebarList {...nav} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** The overview's compact sessions table (a Page sections item). */
export function CourseSessionsTable({ courseCode, sessions, completed, now }: { courseCode: string; sessions: NavSession[]; completed?: Set<string>; now: number }) {
  if (!sessions.length) return <div style={{ color: '#5A6675', fontSize: 14 }}>The schedule will appear here as sessions are announced.</div>;
  return (
    <div style={{ border: '1px solid #E8EEF7', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      {orderSessions(sessions).map((s, i) => {
        const st = navStatus(s, now);
        return (
          <Link key={s.id} href={courseSessionPath(courseCode, s.id)} data-testid="course-sessions-row"
            style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '12px 14px', textDecoration: 'none', color: '#2A3440', borderTop: i ? '1px solid #E8EEF7' : 'none' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: completed?.has(s.id) ? '#2E7D52' : '#EEF3FA', color: completed?.has(s.id) ? '#fff' : '#1B4F8A', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12.5 }}>
              {completed?.has(s.id) ? '✓' : (s.course_session_no ?? i + 1)}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 800, color: '#0D2E5A', fontSize: 14.5, lineHeight: 1.35 }}>{s.title}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: '#5A6675', marginTop: 2 }}>{s.scheduled_datetime ? new Date(s.scheduled_datetime).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' KSA' : 'Date to be announced'}</span>
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: st === 'live' ? '#2E7D52' : st === 'rescheduled' ? '#9A5B00' : '#1B4F8A', background: st === 'live' ? '#E7F4EC' : st === 'rescheduled' ? '#FFF4E5' : '#EEF3FA', borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap' }}>{STATUS_LABEL[st]}</span>
          </Link>
        );
      })}
    </div>
  );
}
