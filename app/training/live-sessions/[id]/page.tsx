'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { FilePreviewModal } from '@/src/components/training/dashboard/FilePreviewModal';
import { TrainingShell } from '@/src/components/training/TrainingShell';
import { YouTubePlayer } from '@/src/components/training/YouTubePlayer';
import { CoursePlayerLayout, type SidebarSession } from '@/src/components/training/player/CoursePlayerLayout';

interface Attachment { id: string; file_name: string; file_url: string; file_type: string; file_size: number }
interface Session {
  id: string; title: string; description: string; youtube_url: string; live_url: string;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  playlist: { id: string; name: string } | null; attachments: Attachment[];
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; prerequisites: string; instructor_name: string; tags: string[];
  is_featured: boolean; live_password: string; registration_url: string | null;
  youtube_embed?: boolean; instructor_title?: string; show_like_button?: boolean;
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

function downloadIcs(title: string, desc: string, liveUrl: string, dt: string) {
  const start = new Date(dt);
  const end = new Date(start.getTime() + 90 * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT',`DTSTART:${fmt(start)}`,`DTEND:${fmt(end)}`,`SUMMARY:${title}`,`DESCRIPTION:${(desc||'').replace(/\n/g,'\\n')}${liveUrl?'\\nJoin: '+liveUrl:''}`,liveUrl?`URL:${liveUrl}`:'','END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics],{type:'text/calendar'})); a.download = `${title.replace(/[^a-zA-Z0-9]/g,'_')}.ics`; a.click(); URL.revokeObjectURL(a.href);
}

function DetailCalendarDropdown({ title, desc, liveUrl, dt }: { title: string; desc: string; liveUrl: string; dt: string }) {
  const [open, setOpen] = useState(false);
  const start = new Date(dt);
  const end = new Date(start.getTime() + 90 * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const t = encodeURIComponent(title);
  const d2 = encodeURIComponent((desc||'') + (liveUrl?'\n\nJoin: '+liveUrl:''));
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${t}&dates=${fmt(start)}/${fmt(end)}&details=${d2}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${t}&startdt=${start.toISOString()}&enddt=${end.toISOString()}&body=${d2}`;
  const yahoo = `https://calendar.yahoo.com/?v=60&title=${t}&st=${fmt(start)}&dur=0130&desc=${d2}`;
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(!open)} style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Add to Calendar &#9662;</button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', borderRadius: 8, border: '1px solid #E5E7EB', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 200, overflow: 'hidden' }}>
          {[{label:'Google Calendar',url:gcal},{label:'Outlook Calendar',url:outlook},{label:'Yahoo Calendar',url:yahoo}].map(o=>(
            <a key={o.label} href={o.url} target="_blank" rel="noopener noreferrer" onClick={()=>setOpen(false)} style={{display:'block',padding:'10px 16px',fontSize:13,color:'#374151',textDecoration:'none',borderBottom:'1px solid #F3F4F6'}}>{o.label}</a>
          ))}
          <button onClick={()=>{downloadIcs(title,desc,liveUrl,dt);setOpen(false);}} style={{display:'block',width:'100%',padding:'10px 16px',fontSize:13,color:'#374151',background:'none',border:'none',cursor:'pointer',textAlign:'left'}}>Apple Calendar (.ics)</button>
        </div>
      )}
    </div>
  );
}

export default function LiveSessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [previewFile, setPreviewFile] = useState<Attachment | null>(null);
  const [countdown, setCountdown] = useState('');
  const localTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';

  // Registration state
  const [studentSession, setStudentSession] = useState<{ email: string; registrationId: string } | null>(null);
  const [registered, setRegistered] = useState(false);
  const [joinLinkAvailable, setJoinLinkAvailable] = useState(false);
  const [regCount, setRegCount] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [playlistSessions, setPlaylistSessions] = useState<SidebarSession[]>([]);
  const [isWatched, setIsWatched] = useState(false);

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/signin'); return; }
    setStudentSession(sess);

    Promise.all([
      fetch(`/api/training/live-sessions/${params.id}`).then(r => r.json()),
      fetch(`/api/training/live-sessions/${params.id}/register?email=${encodeURIComponent(sess.email)}`).then(r => r.json()),
    ]).then(([sessionData, regData]) => {
      setSession(sessionData.session ?? null);
      setRegistered(regData.registered ?? false);
      setJoinLinkAvailable(regData.joinLinkAvailable ?? false);
      setRegCount(regData.registrationCount ?? 0);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [params.id, router]);

  // Fetch playlist sessions for sidebar
  useEffect(() => {
    if (!session?.playlist?.id) return;
    const pid = session.playlist.id;
    fetch('/api/public/training-sessions?limit=50')
      .then(r => r.json())
      .then((d: { sessions?: Array<{ id: string; title: string; duration_minutes: number | null; session_type: string; scheduled_datetime?: string; playlist?: { id: string } | { id: string }[] | null }> }) => {
        const filtered = (d.sessions ?? [])
          .filter(s => {
            const p = Array.isArray(s.playlist) ? s.playlist[0] : s.playlist;
            return p?.id === pid;
          })
          .sort((a, b) => new Date(a.scheduled_datetime ?? 0).getTime() - new Date(b.scheduled_datetime ?? 0).getTime())
          .map(s => ({
            id: s.id,
            title: s.title,
            duration_minutes: s.duration_minutes ?? undefined,
            type: (s.session_type === 'recorded' ? 'recorded' : s.session_type === 'live' ? 'live' : 'upcoming') as SidebarSession['type'],
            watched: false,
            href: `/training/live-sessions/${s.id}`,
          }));
        setPlaylistSessions(filtered);
      })
      .catch(() => {});
  }, [session?.playlist?.id]);

  // Check watched state
  useEffect(() => {
    if (!studentSession?.email || !session?.id) return;
    fetch(`/api/training/watch-history?email=${encodeURIComponent(studentSession.email)}`)
      .then(r => r.json())
      .then((d: { history?: Array<{ session_id: string }> }) => {
        const watchedIds = new Set((d.history ?? []).map(h => h.session_id));
        setIsWatched(watchedIds.has(session.id));
        setPlaylistSessions(prev => prev.map(s => ({ ...s, watched: watchedIds.has(s.id) })));
      })
      .catch(() => {});
  }, [studentSession?.email, session?.id]);

  // Refresh join link availability every 30 seconds
  useEffect(() => {
    if (!studentSession || !session || session.session_type === 'recorded' || !registered) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/training/live-sessions/${params.id}/register?email=${encodeURIComponent(studentSession.email)}`);
        const d = await r.json();
        setJoinLinkAvailable(d.joinLinkAvailable ?? false);
      } catch {}
    }, 30000);
    return () => clearInterval(id);
  }, [params.id, studentSession, session, registered]);

  async function handleRegister() {
    if (!studentSession) return;
    setRegistering(true);
    try {
      const r = await fetch(`/api/training/live-sessions/${params.id}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regId: studentSession.registrationId, name: studentSession.registrationId, email: studentSession.email }),
      });
      const d = await r.json();
      if (d.success) { setRegistered(true); setRegCount(prev => prev + 1); }
    } catch {}
    setRegistering(false);
  }

  async function handleCancelRegistration() {
    if (!studentSession || !confirm('Cancel your registration for this session?')) return;
    setCancelling(true);
    try {
      await fetch(`/api/training/live-sessions/${params.id}/register`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: studentSession.email }),
      });
      setRegistered(false); setJoinLinkAvailable(false); setRegCount(prev => Math.max(0, prev - 1));
    } catch {}
    setCancelling(false);
  }

  // Countdown timer
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

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  // Content to render inside the shell
  const content = (() => {
    if (loading) {
      return <div style={{ textAlign: 'center', padding: 80, color: '#9CA3AF' }}>Loading...</div>;
    }

    if (!session) {
      return (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>404</div>
          <div style={{ color: '#6B7280' }}>Session not found</div>
          <Link href="/training/live-sessions" style={{ color: '#1B4F8A', marginTop: 12, display: 'inline-block' }}>Back to Live Sessions</Link>
        </div>
      );
    }

    const effType = getEffectiveType(session);
    const ytId = extractYouTubeId(session.youtube_url);
    const hasVideo = session.youtube_embed && !!ytId;

    const currentIndex = playlistSessions.findIndex(s => s.id === session.id);
    const nextSess = currentIndex >= 0 ? playlistSessions[currentIndex + 1] : null;

    const handleMarkComplete = async () => {
      if (!studentSession?.email) return;
      try {
        await fetch(`/api/training/live-sessions/${session.id}/watched`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: studentSession.email, regId: studentSession.registrationId }),
        });
        setIsWatched(true);
        setPlaylistSessions(prev => prev.map(s => s.id === session.id ? { ...s, watched: true } : s));
      } catch {}
    };

    return (
      <CoursePlayerLayout
        title={session.title}
        youtubeUrl={hasVideo ? session.youtube_url : undefined}
        channelId={process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}
        showLikeButton={session.show_like_button}
        sessionTitle={session.title}
        sessionDescription={session.description}
        sessionUrl={typeof window !== 'undefined' ? window.location.href : ''}
        nextSessionHref={nextSess?.href}
        isWatched={isWatched}
        onMarkComplete={handleMarkComplete}
        videoId={hasVideo ? ytId! : undefined}
        sessionId={session.id}
        studentEmail={studentSession?.email}
        studentRegId={studentSession?.registrationId}
        bannerUrl={session.banner_url}
        instructorName={session.instructor_name}
        instructorTitle={session.instructor_title}
        scheduledDatetime={session.scheduled_datetime}
        timezone={session.timezone}
        durationMinutes={session.duration_minutes}
        difficultyLevel={session.difficulty_level}
        tags={session.tags}
        prerequisites={session.prerequisites}
        category={session.category}
        isFeatured={session.is_featured}
        sessionType={effType}
        liveUrl={session.live_url}
        isLoggedIn={true}
        sessions={playlistSessions}
        currentSessionId={session.id}
        backUrl="/training/live-sessions"
        backLabel="Live Sessions"
      >
        {/* Attachments */}
        {session.attachments.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24, marginTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Session Materials</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {session.attachments.map(att => {
                const icon = att.file_type === 'pdf' ? '&#128196;' : att.file_type === 'docx' ? '&#128221;' : att.file_type === 'pptx' ? '&#128202;' : att.file_type === 'xlsx' ? '&#128215;' : '&#128444;';
                const size = att.file_size ? att.file_size > 1048576 ? `${(att.file_size / 1048576).toFixed(1)} MB` : `${(att.file_size / 1024).toFixed(0)} KB` : '';
                return (
                  <button key={att.id} onClick={() => setPreviewFile(att)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                    <span style={{ fontSize: 20 }} dangerouslySetInnerHTML={{ __html: icon }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D2E5A' }}>{att.file_name}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF' }}>{att.file_type.toUpperCase()}{size ? ` - ${size}` : ''}</div>
                    </div>
                    <span style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 700 }}>View</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {previewFile && (
          <FilePreviewModal
            fileName={previewFile.file_name}
            fileUrl={previewFile.file_url}
            fileType={previewFile.file_type}
            fileSize={previewFile.file_size}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </CoursePlayerLayout>
    );
  })();

  // CoursePlayerLayout is a full-page layout — bypass TrainingShell for all session detail views
  // TrainingShell only used for loading/404 states
  if (session) {
    return <>{content}</>;
  }

  return (
    <TrainingShell activeNav="live-sessions">
      {content}
    </TrainingShell>
  );
}
