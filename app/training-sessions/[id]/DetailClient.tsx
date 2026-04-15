'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { YouTubePlayer } from '@/src/components/training/YouTubePlayer';
import { EngagementBar } from '@/src/components/training/EngagementBar';
import { PlaylistSidebar } from '@/src/components/training/PlaylistSidebar';
import { YouTubeComments } from '@/src/components/training/YouTubeComments';

export interface DetailSession {
  id: string; title: string; description: string; youtube_url: string | null;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; prerequisites: string; instructor_name: string; instructor_title?: string; tags: string[];
  is_featured: boolean; playlist: { id: string; name: string } | null;
  registration_count: number; youtube_embed?: boolean; show_like_button?: boolean;
  attachments: { file_name: string; file_type: string; file_size: number }[];
  related: { id: string; title: string; banner_url: string | null; session_type: string; scheduled_datetime: string; duration_minutes: number | null; instructor_name: string; difficulty_level: string; youtube_url: string | null }[];
}

function extractYouTubeId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; }
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; }
}

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

export function DetailClient({ session }: { session: DetailSession | null }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [countdown, setCountdown] = useState('');
  const localTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';

  useEffect(() => {
    if (getTrainingSession()) setIsLoggedIn(true);
  }, []);

  // Countdown
  useEffect(() => {
    if (!session?.scheduled_datetime || session.session_type === 'recorded') return;
    const update = () => {
      const diff = new Date(session.scheduled_datetime).getTime() - Date.now();
      if (diff <= 0) { setCountdown('Starting now!'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${d > 0 ? d + 'd ' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [session]);

  const isUpcoming = session?.session_type === 'upcoming' || session?.session_type === 'live';
  const isRecorded = session?.session_type === 'recorded';
  const ytId = extractYouTubeId(session?.youtube_url ?? null);
  const hasVideoPlayer = isRecorded && session?.youtube_embed && !!ytId;
  const hasSidebar = hasVideoPlayer && !!session?.playlist;

  if (!session) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>404</div>
        <div style={{ color: '#6B7280', marginBottom: 12 }}>Session not found</div>
        <Link href={`${LEARN_URL}/training-sessions`} style={{ color: '#1B4F8A' }}>Back to Training Sessions</Link>
      </div>
    );
  }

  return (
    <>
      {/* Responsive grid CSS */}
      <style>{`
        .course-player-grid { display: grid; grid-template-columns: 1fr 300px; gap: 24px; }
        @media (max-width: 767px) { .course-player-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Banner — hide when video player is active */}
      {session.banner_url && !hasVideoPlayer && (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={session.banner_url} alt={session.title} style={{ width: '100%', height: 'auto', maxHeight: 320, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
        </div>
      )}

      {/* Session info header */}
      <div style={{ maxWidth: hasSidebar ? 1100 : 800, margin: '0 auto', padding: 'clamp(20px,4vw,36px) clamp(16px,3vw,24px) 0' }}>
        <Link href={`${LEARN_URL}/training-sessions`} style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
          &larr; Back to Training Sessions
        </Link>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
            background: session.session_type === 'live' ? '#FEF2F2' : isUpcoming ? '#EFF6FF' : '#F3F4F6',
            color: session.session_type === 'live' ? '#DC2626' : isUpcoming ? '#1D4ED8' : '#6B7280',
          }}>
            {session.session_type === 'live' ? 'LIVE NOW' : isUpcoming ? 'UPCOMING' : 'RECORDED'}
          </span>
          {session.difficulty_level && session.difficulty_level !== 'All Levels' && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280' }}>{session.difficulty_level}</span>
          )}
          {session.category && <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{session.category}</span>}
          {session.is_featured && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
        </div>

        <h1 style={{ fontSize: 'clamp(22px,5vw,30px)', fontWeight: 800, color: NAVY, marginBottom: 8, lineHeight: 1.3 }}>{session.title}</h1>
        {session.instructor_name && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 14, color: '#374151' }}><span style={{ color: '#9CA3AF' }}>Trainer:</span> <strong>{session.instructor_name}</strong></div>
            {session.instructor_title && <div style={{ fontSize: 13, color: '#6B7280' }}><span style={{ color: '#9CA3AF' }}>Title:</span> {session.instructor_title}</div>}
          </div>
        )}

        {/* Date/time */}
        {session.scheduled_datetime && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: '#374151' }}>
              {fmtDate(session.scheduled_datetime)} at {fmtTime(session.scheduled_datetime)} ({session.timezone})
            </div>
            {localTz && localTz !== session.timezone && (
              <div style={{ fontSize: 13, color: '#1B4F8A', marginTop: 2 }}>
                Your local time: {new Date(session.scheduled_datetime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: localTz })} ({localTz})
              </div>
            )}
          </div>
        )}

        {/* Meta */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {session.duration_minutes && <span style={{ fontSize: 13, color: '#6B7280' }}>{session.duration_minutes} min</span>}
          {session.max_attendees && <span style={{ fontSize: 13, color: '#6B7280' }}>Limited to {session.max_attendees} seats</span>}
        </div>
        {session.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
            {session.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1B4F8A', fontWeight: 600 }}>{t}</span>)}
          </div>
        )}

        {/* ── UPCOMING CTA (not logged in) ──────────────────────────────── */}
        {isUpcoming && !isLoggedIn && (
          <div style={{ background: '#F0F7FF', border: '2px solid #93C5FD', borderRadius: 14, padding: 'clamp(20px,3vw,28px)', marginBottom: 24 }}>
            {countdown && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Starts in</div>
                <div style={{ fontSize: 'clamp(22px,5vw,32px)', fontWeight: 800, color: NAVY, fontFamily: 'monospace' }}>{countdown}</div>
              </div>
            )}
            <div style={{ textAlign: 'center' }}>
              <Link href={`/register?redirect=/training/live-sessions/${session.id}`}
                style={{ display: 'inline-flex', padding: '14px 32px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', marginBottom: 12 }}>
                Register for Free to Join &#8594;
              </Link>
              <div style={{ fontSize: 13, color: '#6B7280' }}>
                Already registered?{' '}
                <Link href={`/signin?redirect=/training/live-sessions/${session.id}`} style={{ color: '#1B4F8A', fontWeight: 600 }}>Sign In to Your Account &#8594;</Link>
              </div>
            </div>
            {session.registration_count > 0 && (
              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: '#6B7280' }}>
                {session.registration_count} {session.registration_count === 1 ? 'person' : 'people'} registered
              </div>
            )}
          </div>
        )}

        {/* ── UPCOMING CTA (logged in) ──────────────────────────────────── */}
        {isUpcoming && isLoggedIn && (
          <div style={{ background: '#F0F7FF', border: '2px solid #93C5FD', borderRadius: 14, padding: 24, marginBottom: 24, textAlign: 'center' }}>
            {countdown && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Starts in</div>
                <div style={{ fontSize: 'clamp(22px,5vw,32px)', fontWeight: 800, color: NAVY, fontFamily: 'monospace' }}>{countdown}</div>
              </div>
            )}
            <Link href={`/training/live-sessions/${session.id}`}
              style={{ display: 'inline-flex', padding: '14px 32px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
              View & Register &#8594;
            </Link>
            {session.registration_count > 0 && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#6B7280' }}>{session.registration_count} people registered</div>
            )}
          </div>
        )}
      </div>

      {/* ── RECORDED — two-column video player + sidebar ────────────── */}
      {hasVideoPlayer && (
        <div style={{ maxWidth: hasSidebar ? 1100 : 800, margin: '0 auto', padding: '0 clamp(16px,3vw,24px)', marginBottom: 24 }}>
          <div className={hasSidebar ? 'course-player-grid' : undefined}>
            <div>
              <YouTubePlayer videoId={ytId!} title={session.title} />
              <EngagementBar
                youtubeUrl={session.youtube_url!}
                channelId={process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}
                showLike={session.show_like_button !== false}
                sessionTitle={session.title}
                sessionDescription={session.description}
              />
              {!isLoggedIn && (
                <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#EFF6FF', border: '1px solid #93C5FD', textAlign: 'center', fontSize: 12, color: '#1D4ED8' }}>
                  <Link href={`/register?redirect=/training/live-sessions/${session.id}`} style={{ fontWeight: 700, color: '#1D4ED8', textDecoration: 'none' }}>
                    Sign in to earn points and badges for watching!
                  </Link>
                </div>
              )}
              <div id="yt-comments" style={{ marginTop: 24 }}>
                <YouTubeComments videoId={ytId!} youtubeUrl={session.youtube_url!} />
              </div>
            </div>
            {session.playlist && (
              <div style={{ position: 'sticky', top: 80, alignSelf: 'start' }}>
                <PlaylistSidebar
                  playlistId={session.playlist.id}
                  playlistName={session.playlist.name}
                  currentSessionId={session.id}
                  variant="public"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* RECORDED — non-embed fallback (external YouTube link) */}
      {isRecorded && session.youtube_url && !hasVideoPlayer && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 clamp(16px,3vw,24px)', marginBottom: 24 }}>
          <div style={{ background: '#fff', border: '2px solid #E5E7EB', borderRadius: 14, padding: 24 }}>
            <div style={{ textAlign: 'center', padding: 20 }}>
              <a href={session.youtube_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px', borderRadius: 10, background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', boxShadow: '0 4px 12px rgba(220,38,38,0.3)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                Watch on YouTube
              </a>
            </div>
            {!isLoggedIn && (
              <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: '#EFF6FF', border: '1px solid #93C5FD', textAlign: 'center', fontSize: 12, color: '#1D4ED8' }}>
                <Link href={`/register?redirect=/training/live-sessions/${session.id}`} style={{ fontWeight: 700, color: '#1D4ED8', textDecoration: 'none' }}>
                  Sign in to earn points and badges for watching!
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RECORDED — no URL */}
      {isRecorded && !session.youtube_url && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 clamp(16px,3vw,24px)', marginBottom: 24 }}>
          <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 14, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#6B7280' }}>Recording not yet available. Check back soon.</div>
          </div>
        </div>
      )}

      {/* Below-video content */}
      <div style={{ maxWidth: hasSidebar ? 1100 : 800, margin: '0 auto', padding: '0 clamp(16px,3vw,24px) 64px' }}>
        {/* Prerequisites */}
        {session.prerequisites && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>Prerequisites: </span>
            <span style={{ fontSize: 13, color: '#374151' }}>{session.prerequisites}</span>
          </div>
        )}

        {/* Description */}
        {session.description && (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 10 }}>About this session</h3>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{session.description}</p>
          </div>
        )}

        {/* Attachments (names only) */}
        {session.attachments.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 10 }}>Session Materials</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {session.attachments.map((att, i) => {
                const size = att.file_size ? att.file_size > 1048576 ? `${(att.file_size / 1048576).toFixed(1)} MB` : `${(att.file_size / 1024).toFixed(0)} KB` : '';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                    <span style={{ fontSize: 16 }}>{att.file_type === 'pdf' ? '\u{1F4C4}' : '\u{1F4CE}'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{att.file_name}</div>
                      <div style={{ fontSize: 10, color: '#9CA3AF' }}>{att.file_type.toUpperCase()}{size ? ` \u00B7 ${size}` : ''}</div>
                    </div>
                    {!isLoggedIn && <span style={{ fontSize: 10, color: '#9CA3AF' }}>Login to download</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Instructor */}
        {session.instructor_name && (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Instructor</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                {session.instructor_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{session.instructor_name}</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>{session.instructor_title || 'Financial Modeling Expert'}</div>
                <Link href="/about/ahmad-din" style={{ fontSize: 12, color: '#1B4F8A', textDecoration: 'none', marginTop: 4, display: 'inline-block' }}>View Profile &#8594;</Link>
              </div>
            </div>
          </div>
        )}

        {/* Related sessions */}
        {session.related.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>More Sessions You Might Like</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {session.related.map(r => {
                const rYtId = extractYouTubeId(r.youtube_url);
                const rThumb = r.banner_url || (rYtId ? `https://img.youtube.com/vi/${rYtId}/mqdefault.jpg` : null);
                return (
                  <Link key={r.id} href={`${LEARN_URL}/training-sessions/${r.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
                      {rThumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={rThumb} alt={r.title} style={{ width: '100%', height: 120, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: 100, background: `linear-gradient(135deg, ${NAVY}, #1B4F8A)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>{r.title}</span>
                        </div>
                      )}
                      <div style={{ padding: '10px 12px' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, lineHeight: 1.3, marginBottom: 4 }}>{r.title}</div>
                        {r.instructor_name && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{r.instructor_name}</div>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Final CTA */}
        {!isLoggedIn && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Ready to start your financial modeling journey?</div>
            <Link href="/register" style={{ display: 'inline-flex', padding: '14px 32px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
              Register for Free &#8594;
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
