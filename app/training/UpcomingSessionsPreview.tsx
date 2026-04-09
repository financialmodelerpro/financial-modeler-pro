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
  youtube_url?: string | null;
}

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

function getEffectiveType(s: { session_type: string; scheduled_datetime?: string }): string {
  if (s.session_type === 'recorded') return 'recorded';
  if (s.session_type === 'live') {
    if (!s.scheduled_datetime) return 'live';
    const endTime = new Date(s.scheduled_datetime);
    endTime.setHours(endTime.getHours() + 3);
    return new Date() > endTime ? 'recorded' : 'live';
  }
  if (s.session_type === 'upcoming' && s.scheduled_datetime) {
    return new Date() > new Date(s.scheduled_datetime) ? 'recorded' : 'upcoming';
  }
  return s.session_type;
}

export function UpcomingSessionsPreview() {
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Fetch all sessions (not just upcoming) so we can mix in recordings
    fetch('/api/public/training-sessions?limit=20')
      .then(r => r.json())
      .then((j: { sessions?: Session[] }) => setAllSessions(j.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  // Split by effective type
  const upcoming = allSessions
    .filter(s => { const t = getEffectiveType(s); return t === 'upcoming' || t === 'live'; })
    .sort((a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime());
  const recorded = allSessions
    .filter(s => getEffectiveType(s) === 'recorded')
    .sort((a, b) => new Date(b.scheduled_datetime).getTime() - new Date(a.scheduled_datetime).getTime());

  // Priority: upcoming first, fill remaining with recordings, max 3
  const display: Session[] = [];
  for (const s of upcoming) { if (display.length < 3) display.push(s); }
  for (const s of recorded) { if (display.length < 3) display.push(s); }

  // Hide if empty
  if (display.length === 0) return null;

  return (
    <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
      <style>{`
        @media (max-width: 767px) {
          .tsp-grid { display: flex !important; overflow-x: auto !important; gap: 12px !important; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
          .tsp-grid > * { min-width: 260px !important; max-width: 300px !important; flex-shrink: 0 !important; scroll-snap-align: start; }
        }
      `}</style>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: GREEN, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            Live Learning
          </div>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: NAVY, margin: 0 }}>
            Training Sessions
          </h2>
          <p style={{ fontSize: 14, color: '#6B7280', marginTop: 10 }}>
            Join live sessions or watch recordings at your own pace
          </p>
        </div>

        <div className="tsp-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {display.map(s => {
            const effType = getEffectiveType(s);
            const isRec = effType === 'recorded';
            const isLive = effType === 'live';

            return (
              <div key={s.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column' }}>
                {/* Banner */}
                {s.banner_url ? (
                  <div style={{ height: 120, background: `url(${s.banner_url}) top/cover`, position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: isLive ? '#EF4444' : isRec ? 'rgba(0,0,0,0.6)' : '#3B82F6', color: '#fff' }}>
                      {isLive ? 'LIVE' : isRec ? 'RECORDED' : 'UPCOMING'}
                    </span>
                  </div>
                ) : (
                  <div style={{ height: 80, background: `linear-gradient(135deg, ${NAVY}, #1B4F8A)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: isLive ? '#EF4444' : isRec ? 'rgba(0,0,0,0.6)' : '#3B82F6', color: '#fff' }}>
                      {isLive ? 'LIVE' : isRec ? 'RECORDED' : 'UPCOMING'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '0 8px' }}>{s.title}</span>
                  </div>
                )}
                {/* Body */}
                <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 3, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>{s.title}</div>
                  {s.scheduled_datetime && (
                    <div style={{ fontSize: 12, color: '#374151', marginBottom: 2 }}>
                      {new Date(s.scheduled_datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {` \u00B7 ${new Date(s.scheduled_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                    </div>
                  )}
                  {s.duration_minutes && <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>{s.duration_minutes} min</div>}
                  <div style={{ marginTop: 'auto' }}>
                    {isRec && s.youtube_url ? (
                      <a href={s.youtube_url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', textAlign: 'center', padding: '7px 12px', borderRadius: 7, background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
                        Watch on YouTube &#8594;
                      </a>
                    ) : isRec ? (
                      <Link href={`/training-sessions/${s.id}`}
                        style={{ display: 'block', textAlign: 'center', padding: '7px 12px', borderRadius: 7, background: NAVY, color: '#fff', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
                        View Session &#8594;
                      </Link>
                    ) : (
                      <Link href={`/register?redirect=/training-sessions/${s.id}`}
                        style={{ display: 'block', textAlign: 'center', padding: '7px 12px', borderRadius: 7, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
                        Register to Join &#8594;
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/training-sessions" style={{ fontSize: 14, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none' }}>
            View All Training Sessions &#8594;
          </Link>
        </div>
      </div>
    </section>
  );
}
