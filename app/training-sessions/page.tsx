'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';

interface Session {
  id: string; title: string; description: string; youtube_url: string | null;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; instructor_name: string; tags: string[]; is_featured: boolean;
  playlist: { id: string; name: string } | null;
  registration_count: number;
}

function extractYouTubeId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; }
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

export default function PublicTrainingSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    const sess = getTrainingSession();
    if (sess) setIsLoggedIn(true);
    fetch('/api/public/training-sessions')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { sessions?: Session[] }) => {
        setSessions(j.sessions ?? []);
      })
      .catch((err) => {
        console.error('[training-sessions] Fetch error:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  const upcoming = sessions.filter(s => { const t = getEffectiveType(s); return t === 'upcoming' || t === 'live'; });
  const recorded = sessions.filter(s => getEffectiveType(s) === 'recorded');
  const nextSession = upcoming[0] ?? null;
  const localTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';

  // Countdown for next session
  useEffect(() => {
    if (!nextSession?.scheduled_datetime) return;
    const update = () => {
      const diff = new Date(nextSession.scheduled_datetime).getTime() - Date.now();
      if (diff <= 0) { setCountdown('Starting now!'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setCountdown(`${d > 0 ? d + 'd ' : ''}${h}h ${m}m`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [nextSession]);

  function sessionUrl(s: Session) {
    return isLoggedIn ? `/training/live-sessions/${s.id}` : `/training-sessions/${s.id}`;
  }

  function registerUrl(sessionId: string) {
    return isLoggedIn ? `/training/live-sessions/${sessionId}` : `/register?redirect=/training/live-sessions/${sessionId}`;
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      <style>{`
        .pts-card { transition: box-shadow 0.2s, transform 0.2s; }
        .pts-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.12) !important; transform: translateY(-2px); }
        @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 100%)`, padding: 'clamp(48px,8vw,80px) 24px', color: '#fff', textAlign: 'center' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, margin: '0 0 12px' }}>
            Training Sessions
          </h1>
          <p style={{ fontSize: 'clamp(14px,2.5vw,17px)', color: 'rgba(255,255,255,0.7)', margin: '0 0 24px', lineHeight: 1.6 }}>
            Join our free live training sessions or watch recordings at your own pace.
          </p>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 24, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
            <span>{upcoming.length} Upcoming Session{upcoming.length !== 1 ? 's' : ''}</span>
            <span>{recorded.length} Recording{recorded.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {!isLoggedIn && (
              <Link href="/register" style={{ padding: '12px 28px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                Register for Free &#8594;
              </Link>
            )}
            {recorded.length > 0 && (
              <button onClick={() => document.getElementById('recordings-section')?.scrollIntoView({ behavior: 'smooth' })} style={{ padding: '12px 28px', borderRadius: 8, background: 'rgba(255,255,255,0.1)', color: '#fff', fontWeight: 600, fontSize: 14, border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}>
                Browse Recordings
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── NEXT SESSION BANNER ───────────────────────────────────────────── */}
      {nextSession && (
        <section style={{ background: '#fff', padding: 'clamp(24px,4vw,40px) 24px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ background: '#F0F7FF', border: '2px solid #93C5FD', borderRadius: 16, overflow: 'hidden', display: 'flex', flexWrap: 'wrap' }}>
              {nextSession.banner_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={nextSession.banner_url} alt={nextSession.title}
                  style={{ width: '100%', maxWidth: 400, height: 'auto', maxHeight: 240, objectFit: 'cover', objectPosition: 'top' }} />
              )}
              <div style={{ flex: 1, minWidth: 280, padding: 'clamp(20px,3vw,32px)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  {nextSession.session_type === 'live' ? 'LIVE NOW' : 'NEXT SESSION'}
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: '0 0 8px', lineHeight: 1.3 }}>{nextSession.title}</h2>
                {nextSession.instructor_name && <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 10 }}>{nextSession.instructor_name}</div>}
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
                  {fmtDate(nextSession.scheduled_datetime)} &middot; {fmtTime(nextSession.scheduled_datetime)} ({nextSession.timezone})
                </div>
                {nextSession.duration_minutes && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
                    {nextSession.duration_minutes} min{nextSession.difficulty_level && nextSession.difficulty_level !== 'All Levels' ? ` \u00B7 ${nextSession.difficulty_level}` : ''}
                  </div>
                )}
                {countdown && <div style={{ fontSize: 14, fontWeight: 700, color: '#1D4ED8', marginBottom: 14 }}>Countdown: {countdown}</div>}
                {nextSession.registration_count > 0 && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>{nextSession.registration_count} people registered</div>
                )}
                <Link href={registerUrl(nextSession.id)}
                  style={{ display: 'inline-flex', padding: '10px 24px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                  {isLoggedIn ? 'View & Register' : 'Register to Join'} &#8594;
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── SESSIONS ─────────────────────────────────────────────────────── */}
      <section style={{ background: '#F5F7FA', padding: 'clamp(24px,4vw,48px) 24px clamp(48px,6vw,80px)' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {loading && <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Loading sessions...</div>}

          {!loading && sessions.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{'\u{1F4C5}'}</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No sessions scheduled yet</div>
              <div style={{ fontSize: 13 }}>Check back soon &mdash; new sessions are added regularly.</div>
            </div>
          )}

          {/* ── UPCOMING SESSIONS ──────────────────────────────────────────── */}
          {!loading && upcoming.length > 0 && (
            <div style={{ marginBottom: 40 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>Upcoming Sessions</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {upcoming.map(s => {
                const effType = getEffectiveType(s);
                const isLive = effType === 'live';
                const isRecorded = effType === 'recorded';
                const ytId = extractYouTubeId(s.youtube_url);
                const thumbUrl = s.banner_url || (isRecorded && ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : null);

                return (
                  <div key={s.id} className="pts-card" style={{
                    background: '#fff', borderRadius: 12, overflow: 'hidden',
                    border: '1px solid #E5E7EB',
                    borderTop: isLive ? '3px solid #DC2626' : !isRecorded ? '3px solid #2E75B6' : undefined,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    display: 'flex', flexDirection: 'column', position: 'relative',
                  }}>
                    {/* Banner / Thumbnail */}
                    <Link href={sessionUrl(s)} style={{ display: 'block', position: 'relative' }}>
                      {thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl} alt={s.title}
                          style={{ width: '100%', height: 200, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: 160, background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 60%, #2563EB 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>{s.title}</span>
                        </div>
                      )}
                      {/* Play overlay for recorded */}
                      {isRecorded && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.15)' }}>
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                          </div>
                        </div>
                      )}
                      {/* LIVE indicator */}
                      {isLive && (
                        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(220,38,38,0.95)', padding: '4px 10px', borderRadius: 20, zIndex: 2 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'live-pulse 1.5s ease infinite' }} />
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>LIVE</span>
                        </div>
                      )}
                    </Link>

                    {/* Card body */}
                    <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                      {/* Badges */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                        {!isLive && (
                          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: isRecorded ? '#F3F4F6' : '#EFF6FF', color: isRecorded ? '#6B7280' : '#1D4ED8' }}>
                            {isRecorded ? 'RECORDED' : 'UPCOMING'}
                          </span>
                        )}
                        {s.difficulty_level && s.difficulty_level !== 'All Levels' && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
                        )}
                        {s.is_featured && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 10, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
                      </div>

                      <h3 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 4px', lineHeight: 1.3 }}>{s.title}</h3>
                      {s.instructor_name && <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>{s.instructor_name}</div>}

                      {s.scheduled_datetime && (
                        <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                          {fmtDate(s.scheduled_datetime)} &middot; {fmtTime(s.scheduled_datetime)}
                        </div>
                      )}
                      {s.duration_minutes && <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 6 }}>{s.duration_minutes} min</div>}

                      {s.registration_count > 0 && !isRecorded && (
                        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>{s.registration_count} registered</div>
                      )}

                      {s.description && (
                        <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1 }}>
                          {s.description}
                        </p>
                      )}
                      {!s.description && <div style={{ flex: 1 }} />}

                      {/* CTA */}
                      <Link href={isRecorded ? sessionUrl(s) : registerUrl(s.id)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '9px 16px', borderRadius: 7, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none', width: '100%', marginTop: 'auto' }}>
                        {isRecorded ? '\u25B6 Watch Recording \u2192' : (isLoggedIn ? 'View & Register \u2192' : 'Register to Join \u2192')}
                      </Link>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          )}

          {/* ── RECORDINGS ─────────────────────────────────────────────────── */}
          {!loading && recorded.length > 0 && (
            <div id="recordings-section">
              <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>Recordings</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {recorded.map(s => {
                  const ytId = extractYouTubeId(s.youtube_url);
                  const thumbUrl = s.banner_url || (ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : null);
                  return (
                    <div key={s.id} className="pts-card" style={{
                      background: '#fff', borderRadius: 12, overflow: 'hidden',
                      border: '1px solid #E5E7EB', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      display: 'flex', flexDirection: 'column', position: 'relative',
                    }}>
                      <Link href={sessionUrl(s)} style={{ display: 'block', position: 'relative' }}>
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbUrl} alt={s.title} style={{ width: '100%', height: 200, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', height: 160, background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 60%, #2563EB 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>{s.title}</span>
                          </div>
                        )}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.15)' }}>
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                          </div>
                        </div>
                        <span style={{ position: 'absolute', top: 10, left: 10, fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 10, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>RECORDED</span>
                      </Link>
                      <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 4px', lineHeight: 1.3 }}>{s.title}</h3>
                        {s.instructor_name && <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>{s.instructor_name}</div>}
                        {s.scheduled_datetime && <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>{fmtDate(s.scheduled_datetime)}</div>}
                        {s.duration_minutes && <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 6 }}>{s.duration_minutes} min</div>}
                        {s.description && (
                          <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1 }}>{s.description}</p>
                        )}
                        {!s.description && <div style={{ flex: 1 }} />}
                        <Link href={sessionUrl(s)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '9px 16px', borderRadius: 7, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none', width: '100%', marginTop: 'auto' }}>
                          {'\u25B6'} Watch Recording {'\u2192'}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && recorded.length === 0 && upcoming.length > 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No recordings yet</div>
              <div style={{ fontSize: 13 }}>Past sessions will appear here once recorded.</div>
            </div>
          )}
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <SharedFooter
        company="Financial Modeler Pro"
        founder="Ahmad Din"
        copyright={`\u00A9 ${new Date().getFullYear()} Financial Modeler Pro`}
        height="compact"
      />
    </div>
  );
}
