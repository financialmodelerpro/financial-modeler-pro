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
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
        Add to Calendar &#9662;
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', borderRadius: 8, border: '1px solid #E5E7EB', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 200, overflow: 'hidden' }}>
          {[
            { label: 'Google Calendar', url: gcal },
            { label: 'Outlook Calendar', url: outlook },
            { label: 'Yahoo Calendar', url: yahoo },
          ].map(opt => (
            <a key={opt.label} href={opt.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '10px 16px', fontSize: 13, color: '#374151', textDecoration: 'none', borderBottom: '1px solid #F3F4F6' }}>
              {opt.label}
            </a>
          ))}
          <button onClick={() => { downloadIcs(s); setOpen(false); }}
            style={{ display: 'block', width: '100%', padding: '10px 16px', fontSize: 13, color: '#374151', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            Apple Calendar (.ics)
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

      {/* ── UPCOMING & LIVE ────────────────────────────────────────────────── */}
      {!loading && tab === 'upcoming' && (
        upcoming.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#128197;</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No upcoming sessions scheduled</div>
            <div style={{ fontSize: 13 }}>Check back soon or browse recordings.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {upcoming.map(s => (
              <div key={s.id} style={{
                background: '#fff', borderRadius: 14, overflow: 'hidden',
                border: `1.5px solid ${s.session_type === 'live' ? '#DC2626' : '#E5E7EB'}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                transition: 'box-shadow 0.2s',
                position: 'relative',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)')}
              >
                {/* Banner */}
                {s.banner_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.banner_url} alt={s.title} style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    width: '100%', height: 200,
                    background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 60%, #2563EB 100%)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: 400 }}>{s.title}</span>
                  </div>
                )}

                {/* Share button top-right */}
                <button onClick={(e) => { e.preventDefault(); copySessionLink(s.id); }}
                  title="Copy session link"
                  style={{
                    position: 'absolute', top: 12, right: 12, width: 34, height: 34,
                    borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 2,
                  }}>
                  {copiedId === s.id ? '\u2705' : '\u{1F517}'}
                </button>

                <div style={{ padding: '20px 24px' }}>
                  {/* Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
                      background: s.session_type === 'live' ? '#FEF2F2' : '#EFF6FF',
                      color: s.session_type === 'live' ? '#DC2626' : '#1D4ED8',
                    }}>
                      {s.session_type === 'live' ? 'LIVE NOW' : 'UPCOMING'}
                    </span>
                    {s.difficulty_level && s.difficulty_level !== 'All Levels' && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
                    )}
                    {s.category && <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF' }}>{s.category}</span>}
                    {s.is_featured && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
                  </div>

                  {/* Title + instructor */}
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 6px', lineHeight: 1.3 }}>{s.title}</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                    {s.instructor_name && <span style={{ fontSize: 12, color: '#6B7280' }}>{s.instructor_name}</span>}
                    {s.duration_minutes && <span style={{ fontSize: 11, color: '#9CA3AF' }}>{s.duration_minutes} min</span>}
                  </div>

                  {/* Date + time */}
                  {s.scheduled_datetime && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                        &#128197; {fmtDate(s.scheduled_datetime)} at {fmtTime(s.scheduled_datetime)} ({s.timezone})
                      </div>
                      {localTz && localTz !== s.timezone && (
                        <div style={{ fontSize: 12, color: '#1B4F8A', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          &#128336; Your time: {localTime(s.scheduled_datetime)} ({localTz})
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tags */}
                  {s.tags?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                      {s.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1B4F8A', fontWeight: 600 }}>{t}</span>)}
                    </div>
                  )}

                  {/* Description (truncated to 2 lines) */}
                  {s.description && (
                    <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.5, marginBottom: 14, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {s.description}
                    </p>
                  )}

                  {/* Attachments */}
                  {s.attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                      {s.attachments.map(a => (
                        <a key={a.id} href={a.file_url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 11, color: '#374151', textDecoration: 'none' }}>
                          {a.file_type === 'pdf' ? '&#128196;' : '&#128206;'} {a.file_name}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Link href={`/training/live-sessions/${s.id}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 22px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      View & Register &#8594;
                    </Link>
                    <CalendarDropdown s={s} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── RECORDINGS ─────────────────────────────────────────────────────── */}
      {!loading && tab === 'recorded' && (
        recorded.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#127916;</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No recordings available yet</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {Object.entries(groupedRecordings).map(([playlistName, items]) => (
              <div key={playlistName}>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 12 }}>{playlistName} ({items.length})</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 14 }}>
                  {items.map(s => {
                    const ytId = extractYouTubeId(s.youtube_url);
                    return (
                      <Link key={s.id} href={`/training/live-sessions/${s.id}`} style={{ textDecoration: 'none' }}>
                        <div style={{
                          background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.04)', cursor: 'pointer', transition: 'box-shadow 0.2s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
                        onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)')}
                        >
                          {(s.banner_url || ytId) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.banner_url || `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt={s.title}
                              style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: 160, background: `linear-gradient(135deg, ${NAVY}, #1B4F8A)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '0 16px' }}>{s.title}</span>
                            </div>
                          )}
                          <div style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                              {s.category && <span style={{ fontSize: 10, fontWeight: 700, color: '#1B4F8A' }}>{s.category}</span>}
                              {s.difficulty_level && s.difficulty_level !== 'All Levels' && (
                                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4, lineHeight: 1.3 }}>{s.title}</div>
                            {s.instructor_name && <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>{s.instructor_name}</div>}
                            {s.scheduled_datetime && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{fmtDate(s.scheduled_datetime)}</div>}
                            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                              {s.duration_minutes && <span style={{ fontSize: 10, color: '#6B7280' }}>{s.duration_minutes} min</span>}
                              {s.attachments.length > 0 && <span style={{ fontSize: 10, color: '#6B7280' }}>&#128206; {s.attachments.length}</span>}
                            </div>
                          </div>
                        </div>
                      </Link>
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
