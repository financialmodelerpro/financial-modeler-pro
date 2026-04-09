'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { TrainingShell } from '@/src/components/training/TrainingShell';

interface Attachment { id: string; file_name: string; file_url: string; file_type: string; file_size: number }
interface Session {
  id: string; title: string; description: string; youtube_url: string; live_url: string;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  playlist: { id: string; name: string } | null; attachments: Attachment[];
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; instructor_name: string; tags: string[]; is_featured: boolean;
  registration_url: string | null;
}

function extractYouTubeId(url: string): string | null {
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

function downloadIcs(s: Session) {
  if (!s.scheduled_datetime) return;
  const start = new Date(s.scheduled_datetime);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${s.title}`, `DESCRIPTION:${(s.description || '').replace(/\n/g, '\\n')}${s.live_url ? '\\nJoin: ' + s.live_url : ''}`, s.live_url ? `URL:${s.live_url}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

function CalendarDropdown({ s }: { s: Session }) {
  const [open, setOpen] = useState(false);
  if (!s.scheduled_datetime) return null;
  const start = new Date(s.scheduled_datetime);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const fmtCal = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const title = encodeURIComponent(s.title);
  const desc = encodeURIComponent((s.description || '') + (s.live_url ? '\n\nJoin: ' + s.live_url : ''));
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmtCal(start)}/${fmtCal(end)}&details=${desc}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&startdt=${start.toISOString()}&enddt=${end.toISOString()}&body=${desc}`;
  const yahoo = `https://calendar.yahoo.com/?v=60&title=${title}&st=${fmtCal(start)}&dur=0130&desc=${desc}`;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(!open)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '7px 12px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>
        Calendar &#9662;
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', borderRadius: 8, border: '1px solid #E5E7EB', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 180, overflow: 'hidden' }}>
          {[
            { label: 'Google Calendar', url: gcal },
            { label: 'Outlook', url: outlook },
            { label: 'Yahoo', url: yahoo },
          ].map(opt => (
            <a key={opt.label} href={opt.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '9px 14px', fontSize: 12, color: '#374151', textDecoration: 'none', borderBottom: '1px solid #F3F4F6' }}>
              {opt.label}
            </a>
          ))}
          <button onClick={() => { downloadIcs(s); setOpen(false); }}
            style={{ display: 'block', width: '100%', padding: '9px 14px', fontSize: 12, color: '#374151', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            Apple (.ics)
          </button>
        </div>
      )}
    </div>
  );
}

export default function LiveSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'recorded'>('upcoming');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  function copySessionLink(sessionId: string) {
    const url = `${window.location.origin}/training/live-sessions/${sessionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(sessionId);
      setToast('Link copied!');
      setTimeout(() => { setCopiedId(null); setToast(''); }, 2000);
    });
  }

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/signin'); return; }
    Promise.all([
      fetch('/api/training/live-sessions?type=upcoming').then(r => r.json()),
      fetch('/api/training/live-sessions?type=recorded').then(r => r.json()),
    ]).then(([upRes, recRes]) => {
      setSessions([...(upRes.sessions ?? []), ...(recRes.sessions ?? [])]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [router]);

  const upcoming = sessions.filter(s => s.session_type === 'upcoming' || s.session_type === 'live');
  const recorded = sessions.filter(s => s.session_type === 'recorded');
  const localTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';

  function localTime(iso: string): string {
    try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: localTz || undefined }); } catch { return ''; }
  }

  // Group recordings by playlist
  const groupedRecordings: Record<string, Session[]> = {};
  for (const s of recorded) {
    const key = s.playlist?.name ?? 'Other Sessions';
    if (!groupedRecordings[key]) groupedRecordings[key] = [];
    groupedRecordings[key].push(s);
  }

  return (
    <TrainingShell activeNav="live-sessions">
      <style>{`
        .ls-card { transition: box-shadow 0.2s, transform 0.2s; }
        .ls-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.12) !important; transform: translateY(-2px); }
        @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      {/* ── HERO BANNER ──────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 100%)`,
        borderRadius: 16, padding: 'clamp(24px,5vw,36px) clamp(20px,4vw,36px)',
        marginBottom: 24, color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1 style={{ fontSize: 'clamp(20px,5vw,26px)', fontWeight: 800, margin: '0 0 6px' }}>
            Training Sessions
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: 0, marginBottom: 12 }}>
            Join live sessions or watch recordings at your own pace.
          </p>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
            <span>{upcoming.length} Upcoming</span>
            <span>{recorded.length} Recording{recorded.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* ── TABS ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E5E7EB', marginBottom: 24 }}>
        {([['upcoming', `Upcoming & Live (${upcoming.length})`], ['recorded', `Recordings (${recorded.length})`]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '10px 24px', fontSize: 13, fontWeight: tab === key ? 700 : 400, color: tab === key ? NAVY : '#6B7280', background: 'none', border: 'none', borderBottom: tab === key ? `2px solid ${NAVY}` : '2px solid transparent', cursor: 'pointer', marginBottom: -2 }}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Loading sessions...</div>}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* UPCOMING & LIVE — GRID CARDS                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {!loading && tab === 'upcoming' && (
        upcoming.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#128197;</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No upcoming sessions</div>
            <div style={{ fontSize: 13 }}>Check back soon &mdash; new sessions are added regularly.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
            {upcoming.map(s => {
              const isLive = s.session_type === 'live';
              return (
                <div key={s.id} className="ls-card" style={{
                  background: '#fff', borderRadius: 12, overflow: 'hidden',
                  border: '1px solid #E5E7EB',
                  borderTop: `3px solid ${isLive ? '#DC2626' : '#2E75B6'}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  position: 'relative',
                  display: 'flex', flexDirection: 'column',
                }}>
                  {/* Banner */}
                  {s.banner_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.banner_url} alt={s.title} style={{ width: '100%', height: 220, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                  ) : (
                    <div style={{
                      width: '100%', height: 160,
                      background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 60%, #2563EB 100%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
                    }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>{s.title}</span>
                    </div>
                  )}

                  {/* Share button top-right */}
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); copySessionLink(s.id); }}
                    title="Copy session link"
                    style={{
                      position: 'absolute', top: 10, right: 10, width: 32, height: 32,
                      borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', zIndex: 2,
                    }}>
                    {copiedId === s.id ? '\u2705' : '\u{1F517}'}
                  </button>

                  {/* LIVE pulsing indicator */}
                  {isLive && (
                    <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(220,38,38,0.95)', padding: '4px 10px', borderRadius: 20, zIndex: 2 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'live-pulse 1.5s ease infinite' }} />
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: '0.05em' }}>LIVE</span>
                    </div>
                  )}

                  {/* Card body */}
                  <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* Badges row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      {!isLive && (
                        <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#EFF6FF', color: '#1D4ED8' }}>UPCOMING</span>
                      )}
                      {s.difficulty_level && s.difficulty_level !== 'All Levels' && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
                      )}
                      {s.category && <span style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF' }}>{s.category}</span>}
                      {s.is_featured && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 10, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
                    </div>

                    {/* Title */}
                    <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 4px', lineHeight: 1.3 }}>{s.title}</h2>
                    {s.instructor_name && <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>{s.instructor_name}</div>}

                    {/* Date + time */}
                    {s.scheduled_datetime && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 12, color: '#374151' }}>
                          &#128197; {fmtDate(s.scheduled_datetime)} &middot; {fmtTime(s.scheduled_datetime)} ({s.timezone})
                        </div>
                        {localTz && localTz !== s.timezone && (
                          <div style={{ fontSize: 11, color: '#1B4F8A', marginTop: 2 }}>
                            &#128336; Your time: {localTime(s.scheduled_datetime)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Duration */}
                    {s.duration_minutes && (
                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>&#9201; {s.duration_minutes} min</div>
                    )}

                    {/* Registration count — placeholder (fetched per-card would be expensive) */}
                    {s.max_attendees && (
                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>Limited to {s.max_attendees} seats</div>
                    )}

                    {/* Description */}
                    {s.description && (
                      <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1 }}>
                        {s.description}
                      </p>
                    )}
                    {!s.description && <div style={{ flex: 1 }} />}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 'auto', paddingTop: 4 }}>
                      <Link href={`/training/live-sessions/${s.id}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 7, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none', flex: 1, justifyContent: 'center' }}>
                        View & Register &#8594;
                      </Link>
                      <CalendarDropdown s={s} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* RECORDINGS — GRID CARDS                                              */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {!loading && tab === 'recorded' && (
        recorded.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#127916;</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No recordings yet</div>
            <div style={{ fontSize: 13 }}>Past sessions will appear here once recorded.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {Object.entries(groupedRecordings).map(([playlistName, items]) => (
              <div key={playlistName}>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 14 }}>{playlistName} ({items.length})</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
                  {items.map(s => {
                    const ytId = extractYouTubeId(s.youtube_url);
                    const thumbUrl = s.banner_url || (ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : '');
                    return (
                      <div key={s.id} className="ls-card" style={{
                        background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        display: 'flex', flexDirection: 'column', position: 'relative',
                      }}>
                        {/* Thumbnail with play overlay */}
                        <Link href={`/training/live-sessions/${s.id}`} style={{ display: 'block', position: 'relative' }}>
                          {thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbUrl} alt={s.title}
                              style={{ width: '100%', height: 200, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                          ) : (
                            <div style={{ width: '100%', height: 160, background: `linear-gradient(135deg, ${NAVY}, #1B4F8A)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '0 16px' }}>{s.title}</span>
                            </div>
                          )}
                          {/* Play button overlay */}
                          <div style={{
                            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.15)', transition: 'background 0.2s',
                          }}>
                            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                          </div>
                          {/* RECORDED badge */}
                          <span style={{ position: 'absolute', top: 10, left: 10, fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 10, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>RECORDED</span>
                        </Link>

                        {/* Share button */}
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); copySessionLink(s.id); }}
                          title="Copy session link"
                          style={{
                            position: 'absolute', top: 10, right: 10, width: 30, height: 30,
                            borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', zIndex: 2,
                          }}>
                          {copiedId === s.id ? '\u2705' : '\u{1F517}'}
                        </button>

                        {/* Card body */}
                        <div style={{ padding: '14px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                            {s.category && <span style={{ fontSize: 9, fontWeight: 700, color: '#1B4F8A' }}>{s.category}</span>}
                            {s.difficulty_level && s.difficulty_level !== 'All Levels' && (
                              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4, lineHeight: 1.3 }}>{s.title}</div>
                          {s.instructor_name && <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>{s.instructor_name}</div>}
                          {s.scheduled_datetime && <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 6 }}>{fmtDate(s.scheduled_datetime)}</div>}
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                            {s.duration_minutes && <span style={{ fontSize: 10, color: '#6B7280' }}>&#9201; {s.duration_minutes} min</span>}
                            {s.attachments.length > 0 && <span style={{ fontSize: 10, color: '#6B7280' }}>&#128206; {s.attachments.length} file{s.attachments.length > 1 ? 's' : ''}</span>}
                          </div>
                          <div style={{ marginTop: 'auto' }}>
                            <Link href={`/training/live-sessions/${s.id}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 7, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none', width: '100%', justifyContent: 'center' }}>
                              &#9654; Watch Recording &#8594;
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '11px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 700, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}>
          {toast}
        </div>
      )}
    </TrainingShell>
  );
}
