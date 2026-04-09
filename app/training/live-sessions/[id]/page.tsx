'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { FilePreviewModal } from '@/src/components/training/dashboard/FilePreviewModal';
import { TrainingShell } from '@/src/components/training/TrainingShell';

interface Attachment { id: string; file_name: string; file_url: string; file_type: string; file_size: number }
interface Session {
  id: string; title: string; description: string; youtube_url: string; live_url: string;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  playlist: { id: string; name: string } | null; attachments: Attachment[];
  banner_url: string | null; duration_minutes: number | null; max_attendees: number | null;
  difficulty_level: string; prerequisites: string; instructor_name: string; tags: string[];
  is_featured: boolean; live_password: string; registration_url: string | null;
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

    const isUpcoming = session.session_type === 'upcoming' || session.session_type === 'live';
    const ytId = extractYouTubeId(session.youtube_url);

    return (
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Banner hero */}
        {session.banner_url && (
          <div style={{ marginBottom: 20, borderRadius: 14, overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={session.banner_url} alt={session.title} style={{ width: '100%', height: 'auto', maxHeight: 300, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
          </div>
        )}

        <Link href="/training/live-sessions" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
          &larr; Back to Live Sessions
        </Link>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
            background: session.session_type === 'live' ? '#FEF2F2' : isUpcoming ? '#EFF6FF' : '#F3F4F6',
            color: session.session_type === 'live' ? '#DC2626' : isUpcoming ? '#1D4ED8' : '#6B7280' }}>
            {session.session_type === 'live' ? 'LIVE NOW' : isUpcoming ? 'UPCOMING' : 'RECORDED'}
          </span>
          {session.difficulty_level && session.difficulty_level !== 'All Levels' && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280' }}>{session.difficulty_level}</span>
          )}
          {session.category && <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{session.category}</span>}
          {session.playlist && <span style={{ fontSize: 11, color: '#9CA3AF' }}>{session.playlist.name}</span>}
          {session.is_featured && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
        </div>

        <h1 style={{ fontSize: 'clamp(20px,5vw,28px)', fontWeight: 800, color: NAVY, marginBottom: 8, lineHeight: 1.3 }}>{session.title}</h1>
        {session.instructor_name && <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 8 }}>{session.instructor_name}</div>}

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

        {/* Meta info */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {session.duration_minutes && <span style={{ fontSize: 13, color: '#6B7280' }}>{session.duration_minutes} min</span>}
          {session.max_attendees && <span style={{ fontSize: 13, color: '#6B7280' }}>Limited to {session.max_attendees} seats</span>}
        </div>
        {session.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
            {session.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1B4F8A', fontWeight: 600 }}>{t}</span>)}
          </div>
        )}

        {/* Countdown */}
        {isUpcoming && countdown && (
          <div style={{ background: '#EFF6FF', border: '2px solid #3B82F6', borderRadius: 12, padding: '20px 24px', marginBottom: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Starts in</div>
            <div style={{ fontSize: 'clamp(24px,6vw,36px)', fontWeight: 800, color: NAVY, fontFamily: 'monospace' }}>{countdown}</div>
          </div>
        )}

        {/* Video embed */}
        {!isUpcoming && ytId && (
          <div style={{ marginBottom: 24, borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '16/9' }}>
            <iframe
              src={`https://www.youtube.com/embed/${ytId}`}
              width="100%" height="100%" style={{ border: 'none', display: 'block' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {/* Registration */}
        {isUpcoming && (
          <div style={{ marginBottom: 24 }}>
            {!registered ? (
              <div style={{ background: '#F0F7FF', border: '1.5px solid #93C5FD', borderRadius: 12, padding: 20, marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1B4F8A', marginBottom: 8 }}>Register to join this session</div>
                <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>The join link will be available 30 minutes before the session starts.</div>
                <button onClick={handleRegister} disabled={registering}
                  style={{ padding: '12px 32px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 'clamp(13px,3.5vw,15px)', border: 'none', cursor: registering ? 'not-allowed' : 'pointer', opacity: registering ? 0.6 : 1, width: '100%', maxWidth: 320 }}>
                  {registering ? 'Registering...' : 'Register for This Session'}
                </button>
                {regCount > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#6B7280' }}>{regCount} {regCount === 1 ? 'person' : 'people'} registered</div>}
              </div>
            ) : joinLinkAvailable ? (
              <div style={{ background: '#F0FFF4', border: '1.5px solid #86EFAC', borderRadius: 12, padding: 20, marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#166534', marginBottom: 12 }}>Session Starting Soon!</div>
                {session.live_url && (
                  <a href={session.live_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 16, textDecoration: 'none', marginBottom: 10 }}>
                    Join Session Now
                  </a>
                )}
                <div style={{ marginTop: 8 }}>
                  <button onClick={handleCancelRegistration} disabled={cancelling}
                    style={{ fontSize: 12, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    Cancel Registration
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ background: '#F0FFF4', border: '1.5px solid #86EFAC', borderRadius: 12, padding: 20, marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#166534', marginBottom: 8 }}>You're registered!</div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Join link will be available 30 minutes before the session.</div>
                {countdown && <div style={{ fontSize: 13, color: '#1B4F8A', fontWeight: 600, marginBottom: 12 }}>Starts in: {countdown}</div>}
                {regCount > 0 && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>{regCount} {regCount === 1 ? 'person' : 'people'} registered</div>}
                <button onClick={handleCancelRegistration} disabled={cancelling}
                  style={{ fontSize: 12, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Cancel Registration
                </button>
              </div>
            )}
          </div>
        )}

        {/* Share + Calendar buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {session.scheduled_datetime && isUpcoming && (
            <DetailCalendarDropdown title={session.title} desc={session.description || ''} liveUrl={session.live_url || ''} dt={session.scheduled_datetime} />
          )}
          <button onClick={copyLink}
            style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {copied ? '\u2705 Copied!' : '\u{1F517} Copy Link'}
          </button>
          <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`}
            target="_blank" rel="noopener noreferrer"
            style={{ padding: '10px 16px', borderRadius: 8, background: '#0A66C2', color: '#fff', fontWeight: 600, fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            LinkedIn
          </a>
          <a href={`https://wa.me/?text=${encodeURIComponent(session.title + ' - ' + (typeof window !== 'undefined' ? window.location.href : ''))}`}
            target="_blank" rel="noopener noreferrer"
            style={{ padding: '10px 16px', borderRadius: 8, background: '#25D366', color: '#fff', fontWeight: 600, fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            WhatsApp
          </a>
        </div>

        {/* Password */}
        {session.live_password && isUpcoming && (
          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>Session Password: </span>
            <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#B45309' }}>{session.live_password}</span>
          </div>
        )}

        {/* Prerequisites */}
        {session.prerequisites && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>Prerequisites: </span>
            <span style={{ fontSize: 13, color: '#374151' }}>{session.prerequisites}</span>
          </div>
        )}

        {/* Description */}
        {session.description && (
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 10 }}>About this session</h3>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{session.description}</p>
          </div>
        )}

        {/* Attachments */}
        {session.attachments.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24 }}>
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
      </div>
    );
  })();

  return (
    <TrainingShell activeNav="live-sessions">
      {content}
    </TrainingShell>
  );
}
