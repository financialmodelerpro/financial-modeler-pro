'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SessionCard, getEffectiveType, type LiveSessionData } from '@/src/components/sessions/SessionCard';

interface Attachment { id: string; file_name: string; file_url: string; file_type: string; file_size: number }
interface Session {
  id: string; title: string; description: string; youtube_url: string; live_url: string;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  playlist: { id: string; name: string } | null; attachments: Attachment[];
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; instructor_name: string; tags: string[]; is_featured: boolean;
  registration_url: string | null;
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
          {[{ label: 'Google Calendar', url: gcal }, { label: 'Outlook', url: outlook }, { label: 'Yahoo', url: yahoo }].map(opt => (
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

interface LiveSessionsContentProps {
  studentEmail: string;
}

export function LiveSessionsContent({ studentEmail }: LiveSessionsContentProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [regStatus, setRegStatus] = useState<Record<string, { registered: boolean; joinLinkAvailable: boolean }>>({});
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!studentEmail) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const [upRes, recRes, watchRes] = await Promise.all([
          fetch('/api/training/live-sessions?type=upcoming').then(r => r.json()),
          fetch('/api/training/live-sessions?type=recorded').then(r => r.json()),
          fetch(`/api/training/watch-history?email=${encodeURIComponent(studentEmail)}`).then(r => r.json()),
        ]);
        const all = [...(upRes.sessions ?? []), ...(recRes.sessions ?? [])];
        setSessions(all);
        const history = (watchRes.history ?? []) as { session_id: string }[];
        setWatchedIds(new Set(history.map(h => h.session_id)));
        const upcomingIds = all.filter(s => s.session_type === 'upcoming' || s.session_type === 'live').map(s => s.id);
        if (upcomingIds.length > 0) {
          try {
            const r = await fetch('/api/training/live-sessions/registration-status-batch', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionIds: upcomingIds, email: studentEmail }),
            });
            const d = await r.json();
            setRegStatus(d.registrations ?? {});
          } catch {}
        }
      } catch {
        // Ensure sessions show even on partial failure
      } finally {
        setLoading(false);
      }
    })();
  }, [studentEmail]);

  const upcoming = sessions.filter(s => { const t = getEffectiveType(s); return t === 'upcoming' || t === 'live'; });
  const recorded = sessions.filter(s => getEffectiveType(s) === 'recorded');
  const groupedRecordings: Record<string, Session[]> = {};
  for (const s of recorded) {
    const key = s.playlist?.name ?? 'Other Sessions';
    if (!groupedRecordings[key]) groupedRecordings[key] = [];
    groupedRecordings[key].push(s);
  }

  return (
    <>
      <style>{`
        .session-card { transition: box-shadow 0.2s, transform 0.2s; }
        .session-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.12) !important; transform: translateY(-2px); }
        @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1B4F8A 100%)`,
        borderRadius: 16, padding: 'clamp(24px,5vw,36px) clamp(20px,4vw,36px)',
        marginBottom: 24, color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1 style={{ fontSize: 'clamp(20px,5vw,26px)', fontWeight: 800, margin: '0 0 6px' }}>Training Sessions</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: 0, marginBottom: 12 }}>Join live sessions or watch recordings at your own pace.</p>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
            <span>{upcoming.length} Upcoming</span>
            <span>{recorded.length} Recording{recorded.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Loading sessions...</div>}

      {/* Upcoming */}
      {!loading && upcoming.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>Upcoming Sessions</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 }}>
            {upcoming.map(s => (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SessionCard session={s as unknown as LiveSessionData} variant="student"
                  isRegistered={regStatus[s.id]?.registered} joinLinkAvailable={regStatus[s.id]?.joinLinkAvailable} />
                {s.scheduled_datetime && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}><CalendarDropdown s={s} /></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recordings */}
      {!loading && recorded.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 16px' }}>Recordings</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {Object.entries(groupedRecordings).map(([playlistName, items]) => (
              <div key={playlistName}>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 14 }}>{playlistName} ({items.length})</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 }}>
                  {items.map(s => (
                    <SessionCard key={s.id} session={s as unknown as LiveSessionData} variant="student" watched={watchedIds.has(s.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && recorded.length === 0 && upcoming.length > 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No recordings yet</div>
          <div style={{ fontSize: 13 }}>Past sessions will appear here once recorded.</div>
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No sessions scheduled yet</div>
          <div style={{ fontSize: 13 }}>Check back soon.</div>
        </div>
      )}
    </>
  );
}
