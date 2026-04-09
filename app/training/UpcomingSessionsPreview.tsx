'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Session {
  id: string;
  title: string;
  scheduled_datetime: string;
  timezone: string;
  duration_minutes: number | null;
  difficulty_level: string;
  instructor_name: string;
  banner_url: string | null;
  session_type: string;
}

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; }
}

export function UpcomingSessionsPreview() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/public/training-sessions?type=upcoming&limit=3')
      .then(r => r.json())
      .then((j: { sessions?: Session[] }) => setSessions(j.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Hide section entirely if no upcoming sessions
  if (loaded && sessions.length === 0) return null;
  if (!loaded) return null;

  return (
    <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: GREEN, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            Live Learning
          </div>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: NAVY, margin: 0 }}>
            Upcoming Training Sessions
          </h2>
          <p style={{ fontSize: 14, color: '#6B7280', marginTop: 10 }}>
            Join our free live sessions or watch at your own pace
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sessions.map(s => (
            <Link key={s.id} href={`/training-sessions/${s.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden', textDecoration: 'none', color: '#374151', transition: 'box-shadow 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              {s.banner_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.banner_url} alt={s.title}
                  style={{ width: 160, height: 100, objectFit: 'cover', objectPosition: 'top', flexShrink: 0, display: 'block' }} />
              )}
              <div style={{ padding: '14px 16px 14px 0', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: s.session_type === 'live' ? '#FEF2F2' : '#EFF6FF', color: s.session_type === 'live' ? '#DC2626' : '#1D4ED8' }}>
                    {s.session_type === 'live' ? 'LIVE NOW' : 'UPCOMING'}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>
                  {fmtDate(s.scheduled_datetime)} &middot; {fmtTime(s.scheduled_datetime)}
                  {s.duration_minutes ? ` \u00B7 ${s.duration_minutes} min` : ''}
                  {s.difficulty_level && s.difficulty_level !== 'All Levels' ? ` \u00B7 ${s.difficulty_level}` : ''}
                </div>
              </div>
              <div style={{ paddingRight: 20, flexShrink: 0 }}>
                <span style={{ display: 'inline-flex', padding: '8px 16px', borderRadius: 7, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
                  Register &#8594;
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Link href="/training-sessions" style={{ fontSize: 14, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none' }}>
            View All Training Sessions &#8594;
          </Link>
        </div>
      </div>
    </section>
  );
}
