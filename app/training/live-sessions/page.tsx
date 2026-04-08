'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getTrainingSession } from '@/src/lib/training/training-session';

interface Attachment { id: string; file_name: string; file_url: string; file_type: string; file_size: number }
interface Session {
  id: string; title: string; description: string; youtube_url: string; live_url: string;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  playlist: { id: string; name: string } | null; attachments: Attachment[];
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; instructor_name: string; tags: string[]; is_featured: boolean;
}

function extractYouTubeId(url: string): string | null {
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

function buildGcalUrl(s: Session): string {
  if (!s.scheduled_datetime) return '';
  const start = new Date(s.scheduled_datetime);
  const end = new Date(start.getTime() + 90 * 60 * 1000); // 90 min default
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(s.title)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent((s.description || '') + (s.live_url ? '\n\nJoin: ' + s.live_url : ''))}&location=${encodeURIComponent(s.live_url || '')}`;
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

export default function LiveSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'recorded'>('upcoming');

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
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={{ background: NAVY, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 14, height: 56, position: 'sticky', top: 0, zIndex: 100 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
          <div style={{ width: 26, height: 26, borderRadius: 5, background: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>F</div>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Financial Modeler Pro</span>
        </Link>
        <span style={{ color: '#475569' }}>|</span>
        <Link href="/training/dashboard" style={{ color: '#94A3B8', fontSize: 13, textDecoration: 'none' }}>Dashboard</Link>
        <span style={{ color: '#475569' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Live Sessions</span>
      </nav>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px 64px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Live Sessions</h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 24 }}>Join live training sessions or watch recordings at your own pace.</p>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E5E7EB', marginBottom: 28 }}>
          {([['upcoming', `Upcoming & Live (${upcoming.length})`], ['recorded', `Recordings (${recorded.length})`]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ padding: '10px 24px', fontSize: 14, fontWeight: tab === key ? 700 : 400, color: tab === key ? NAVY : '#6B7280', background: 'none', border: 'none', borderBottom: tab === key ? `2px solid ${NAVY}` : '2px solid transparent', cursor: 'pointer', marginBottom: -2 }}>
              {label}
            </button>
          ))}
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Loading sessions...</div>}

        {/* Upcoming & Live */}
        {!loading && tab === 'upcoming' && (
          upcoming.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No upcoming sessions scheduled</div>
              <div style={{ fontSize: 13 }}>Check back soon or browse recordings.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {upcoming.map(s => (
                <div key={s.id} style={{ background: '#fff', borderRadius: 12, border: `1.5px solid ${s.session_type === 'live' ? '#DC2626' : '#3B82F6'}`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  {/* Banner */}
                  {s.banner_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.banner_url} alt={s.title} style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                  )}
                  <div style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: s.session_type === 'live' ? '#FEF2F2' : '#EFF6FF', color: s.session_type === 'live' ? '#DC2626' : '#1D4ED8' }}>
                      {s.session_type === 'live' ? 'LIVE NOW' : 'UPCOMING'}
                    </span>
                    {s.difficulty_level && s.difficulty_level !== 'All Levels' && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280' }}>{s.difficulty_level}</span>
                    )}
                    {s.category && <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{s.category}</span>}
                    {s.is_featured && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
                  </div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 8px' }}>{s.title}</h2>
                  {s.instructor_name && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{s.instructor_name}</div>}
                  {s.scheduled_datetime && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 13, color: '#374151' }}>
                        {fmtDate(s.scheduled_datetime)} at {fmtTime(s.scheduled_datetime)} ({s.timezone})
                      </div>
                      {localTz && localTz !== s.timezone && (
                        <div style={{ fontSize: 12, color: '#1B4F8A', marginTop: 2 }}>Your local time: {localTime(s.scheduled_datetime)} ({localTz})</div>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    {s.duration_minutes && <span style={{ fontSize: 11, color: '#6B7280' }}>{s.duration_minutes} min</span>}
                    {s.max_attendees && <span style={{ fontSize: 11, color: '#6B7280' }}>Limited to {s.max_attendees} seats</span>}
                  </div>
                  {s.tags?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                      {s.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1B4F8A', fontWeight: 600 }}>{t}</span>)}
                    </div>
                  )}
                  {s.description && <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, marginBottom: 16 }}>{s.description}</p>}
                  {s.attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                      {s.attachments.map(a => (
                        <a key={a.id} href={a.file_url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 11, color: '#374151', textDecoration: 'none' }}>
                          {a.file_type === 'pdf' ? '📄' : '📎'} {a.file_name}
                        </a>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {s.live_url && (
                      <a href={s.live_url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 24px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                        Join Session
                      </a>
                    )}
                    {s.scheduled_datetime && (
                      <>
                        <a href={buildGcalUrl(s)} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                          Google Calendar
                        </a>
                        <button onClick={() => downloadIcs(s)}
                          style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                          Download .ics
                        </button>
                      </>
                    )}
                  </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Recordings */}
        {!loading && tab === 'recorded' && (
          recorded.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎬</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>No recordings available yet</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
              {Object.entries(groupedRecordings).map(([playlistName, items]) => (
                <div key={playlistName}>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 12 }}>{playlistName} ({items.length})</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                    {items.map(s => {
                      const ytId = extractYouTubeId(s.youtube_url);
                      return (
                        <Link key={s.id} href={`/training/live-sessions/${s.id}`} style={{ textDecoration: 'none' }}>
                          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                            {/* Banner or YouTube thumbnail */}
                            {(s.banner_url || ytId) && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.banner_url || `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt={s.title}
                                style={{ width: '100%', height: 160, objectFit: 'cover' }} />
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
                                {s.attachments.length > 0 && <span style={{ fontSize: 10, color: '#6B7280' }}>📎 {s.attachments.length}</span>}
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
      </div>
    </div>
  );
}
