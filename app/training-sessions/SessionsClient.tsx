'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { SessionCard, getEffectiveType, type LiveSessionData } from '@/src/components/sessions/SessionCard';
import { WelcomeModal } from '@/src/components/training/WelcomeModal';

export interface PublicSession {
  id: string; title: string; description: string; youtube_url: string | null;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; instructor_name: string; tags: string[]; is_featured: boolean;
  playlist: { id: string; name: string } | null;
  registration_count: number;
  youtube_embed?: boolean;
  instructor_title?: string | null;
}

export interface HeroContent {
  heading?: string; subtitle?: string; badge?: string;
  cta_primary_text?: string; cta_primary_url?: string;
  cta_secondary_text?: string; cta_secondary_url?: string;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; }
}

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

export function SessionsClient({ sessions, hero }: { sessions: PublicSession[]; hero?: HeroContent }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [filterPlaylist, setFilterPlaylist] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'upcoming' | 'recorded'>('all');

  useEffect(() => {
    if (getTrainingSession()) setIsLoggedIn(true);
  }, []);

  // Filters
  const playlists = [...new Set(sessions.map(s => s.playlist?.name).filter(Boolean))] as string[];
  const categories = [...new Set(sessions.map(s => s.category).filter(Boolean))];

  const filtered = sessions.filter(s => {
    const t = getEffectiveType(s);
    if (filterPlaylist !== 'all' && s.playlist?.name !== filterPlaylist) return false;
    if (filterCategory !== 'all' && s.category !== filterCategory) return false;
    if (filterType === 'upcoming' && t === 'recorded') return false;
    if (filterType === 'recorded' && t !== 'recorded') return false;
    return true;
  });

  const upcoming = filtered.filter(s => { const t = getEffectiveType(s); return t === 'upcoming' || t === 'live'; })
    .sort((a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime());
  const recorded = filtered.filter(s => getEffectiveType(s) === 'recorded')
    .sort((a, b) => new Date(b.scheduled_datetime).getTime() - new Date(a.scheduled_datetime).getTime());
  const nextSession = upcoming[0] ?? null;
  const hasActiveFilter = filterPlaylist !== 'all' || filterCategory !== 'all' || filterType !== 'all';
  const localTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';

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

  function registerUrl(sessionId: string) {
    return isLoggedIn ? `/training/live-sessions/${sessionId}` : `/register?redirect=/training/live-sessions/${sessionId}`;
  }
  function localTime(iso: string): string {
    try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: localTz || undefined }); } catch { return ''; }
  }

  return (
    <>
      <style>{`
        .session-card { transition: box-shadow 0.2s, transform 0.2s; }
        .session-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.12) !important; transform: translateY(-2px); }
        @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      {/* HERO */}
      <section style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 100%)`, padding: 'clamp(48px,8vw,80px) 24px', color: '#fff', textAlign: 'center' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          {hero?.badge && (
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>{hero.badge}</div>
          )}
          <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, margin: '0 0 12px' }}>{hero?.heading || 'FMP Real-World Financial Modeling'}</h1>
          <p style={{ fontSize: 'clamp(14px,2.5vw,17px)', color: 'rgba(255,255,255,0.7)', margin: '0 0 24px', lineHeight: 1.6 }}>
            {hero?.subtitle || 'Live sessions and recorded content. Practitioner-led. Built on real deal work.'}
          </p>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 24, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
            <span>{upcoming.length} Upcoming Session{upcoming.length !== 1 ? 's' : ''}</span>
            <span>{recorded.length} Recording{recorded.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {!isLoggedIn && (
              <Link href={hero?.cta_primary_url || '/register'} style={{ padding: '12px 28px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                {hero?.cta_primary_text || 'Register for Free →'}
              </Link>
            )}
            {recorded.length > 0 && (
              <button onClick={() => document.getElementById('recordings-section')?.scrollIntoView({ behavior: 'smooth' })} style={{ padding: '12px 28px', borderRadius: 8, background: 'rgba(255,255,255,0.1)', color: '#fff', fontWeight: 600, fontSize: 14, border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}>
                {hero?.cta_secondary_text || 'Browse Recordings'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* NEXT SESSION BANNER */}
      {nextSession && (
        <section style={{ background: '#fff', padding: 'clamp(24px,4vw,40px) 24px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ background: '#F0F7FF', border: '2px solid #93C5FD', borderRadius: 16, overflow: 'hidden', display: 'flex', flexWrap: 'wrap' }}>
              {nextSession.banner_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={nextSession.banner_url} alt={nextSession.title} style={{ width: '100%', maxWidth: 480, height: 'auto', maxHeight: 500, objectFit: 'contain', display: 'block', background: '#0D2E5A' }} />
              )}
              <div style={{ flex: 1, minWidth: 280, padding: 'clamp(20px,3vw,32px)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  {nextSession.session_type === 'live' ? 'LIVE NOW' : 'NEXT SESSION'}
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: '0 0 8px', lineHeight: 1.3 }}>{nextSession.title}</h2>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
                  {fmtDate(nextSession.scheduled_datetime)} &middot; {fmtTime(nextSession.scheduled_datetime)} ({nextSession.timezone})
                </div>
                {localTz && localTz !== nextSession.timezone && (
                  <div style={{ fontSize: 12, color: '#1B4F8A', marginBottom: 4 }}>Your time: {localTime(nextSession.scheduled_datetime)}</div>
                )}
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

      {/* FILTERS */}
      <section style={{ background: '#fff', padding: '16px 24px', borderBottom: '1px solid #E5E7EB' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filterPlaylist} onChange={e => setFilterPlaylist(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}>
            <option value="all">All Playlists</option>
            {playlists.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}>
            <option value="all">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'upcoming', 'recorded'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)} style={{
                padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: filterType === t ? 700 : 500,
                background: filterType === t ? NAVY : '#F3F4F6',
                color: filterType === t ? '#fff' : '#6B7280',
              }}>
                {t === 'all' ? 'All' : t === 'upcoming' ? 'Upcoming' : 'Recorded'}
              </button>
            ))}
          </div>
          {hasActiveFilter && (
            <button onClick={() => { setFilterPlaylist('all'); setFilterCategory('all'); setFilterType('all'); }}
              style={{ padding: '7px 14px', borderRadius: 20, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#6B7280' }}>
              ✕ Clear
            </button>
          )}
          <span style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 'auto' }}>
            {filtered.length} session{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </section>

      {/* SESSIONS */}
      <section style={{ background: '#F5F7FA', padding: 'clamp(24px,4vw,48px) 24px clamp(48px,6vw,80px)' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {sessions.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No sessions scheduled yet</div>
              <div style={{ fontSize: 13 }}>Check back soon &mdash; new sessions are added regularly.</div>
            </div>
          )}

          {sessions.length > 0 && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No sessions match your filters</div>
              <div style={{ fontSize: 13 }}>Try adjusting your filters or clear them to see all sessions.</div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div style={{ marginBottom: 40 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>Upcoming Sessions</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 }}>
                {upcoming.map(s => <SessionCard key={s.id} session={s as LiveSessionData} variant="public" />)}
              </div>
            </div>
          )}

          {recorded.length > 0 && (
            <div id="recordings-section">
              <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>Recordings</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 }}>
                {recorded.map(s => <SessionCard key={s.id} session={s as LiveSessionData} variant="public" />)}
              </div>
            </div>
          )}

          {recorded.length === 0 && upcoming.length > 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No recordings yet</div>
              <div style={{ fontSize: 13 }}>Past sessions will appear here once recorded.</div>
            </div>
          )}
        </div>
      </section>
      <WelcomeModal />
    </>
  );
}
