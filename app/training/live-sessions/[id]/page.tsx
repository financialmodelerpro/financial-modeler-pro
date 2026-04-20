'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { FilePreviewModal } from '@/src/components/training/dashboard/FilePreviewModal';
import { TrainingShell } from '@/src/components/training/TrainingShell';
import { CoursePlayerLayout, type SidebarSession } from '@/src/components/training/player/CoursePlayerLayout';
import { WatchProgressBar } from '@/src/components/training/WatchProgressBar';

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
  const [videoEnded, setVideoEnded] = useState(false);

  // Watch-enforcement state (mirrors the 3SFM watch page pattern)
  const [enforcement, setEnforcement] = useState<{ enabled: boolean; threshold: number; sessionBypass: boolean; isAdmin: boolean }>({
    enabled: true, threshold: 70, sessionBypass: false, isAdmin: false,
  });
  const [baselineWatchedSec, setBaselineWatchedSec] = useState(0);
  const [liveWatchSec, setLiveWatchSec] = useState(0);
  const [liveTotalSec, setLiveTotalSec] = useState(0);
  // Tracks the YT player's currentTime — used to evaluate the "last
  // 20 seconds" near-end window. Monotonic-max so seeking backward
  // doesn't collapse the gate once it's open.
  const [liveCurrentPos, setLiveCurrentPos] = useState(0);
  const lastPostedRef = useRef<{ sec: number; at: number }>({ sec: 0, at: 0 });

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/signin'); return; }
    setStudentSession(sess);

    const tk = `LIVE_${params.id}`;
    Promise.all([
      fetch(`/api/training/live-sessions/${params.id}`).then(r => r.json()),
      fetch(`/api/training/live-sessions/${params.id}/register?email=${encodeURIComponent(sess.email)}`).then(r => r.json()),
      fetch(`/api/training/watch-enforcement?tabKeys=${encodeURIComponent(tk)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/training/live-sessions/${params.id}/watched?email=${encodeURIComponent(sess.email)}`).then(r => r.json()).catch(() => null),
    ]).then(([sessionData, regData, enforceJson, watchJson]) => {
      setSession(sessionData.session ?? null);
      setRegistered(regData.registered ?? false);
      setJoinLinkAvailable(regData.joinLinkAvailable ?? false);
      setRegCount(regData.registrationCount ?? 0);

      if (enforceJson) {
        setEnforcement({
          enabled:       enforceJson.enabled !== false,
          threshold:     typeof enforceJson.threshold === 'number' ? enforceJson.threshold : 70,
          sessionBypass: !!enforceJson.sessionBypass?.[tk],
          isAdmin:       !!enforceJson.isAdmin,
        });
      }

      if (watchJson && typeof watchJson === 'object') {
        const base = Math.max(0, Math.round(Number(watchJson.watch_seconds ?? 0)));
        setBaselineWatchedSec(base);
        setLiveWatchSec(base);
        setLiveTotalSec(Math.max(0, Math.round(Number(watchJson.total_seconds ?? 0))));
        if (watchJson.status === 'completed') {
          setIsWatched(true);
          setVideoEnded(true);
        }
      }
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

  // Check watched state — "watched" here means status==='completed'
  // specifically. Without this filter the first progress tick creates
  // an in_progress history row and this effect would then flip
  // isWatched=true, which causes CourseTopBar to hide Mark Complete
  // (the student sees "Completed" text despite never having clicked
  // the button). Issue 1 root cause — in_progress must not masquerade
  // as a completion flag.
  useEffect(() => {
    if (!studentSession?.email || !session?.id) return;
    fetch(`/api/training/watch-history?email=${encodeURIComponent(studentSession.email)}`)
      .then(r => r.json())
      .then((d: { history?: Array<{ session_id: string; status?: string }> }) => {
        const completedIds = new Set(
          (d.history ?? [])
            .filter(h => h.status === 'completed')
            .map(h => h.session_id),
        );
        setIsWatched(completedIds.has(session.id));
        setPlaylistSessions(prev => prev.map(s => ({ ...s, watched: completedIds.has(s.id) })));
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

  // Fires ~every 10s during playback, on pause, and on ended. Persists the
  // interval-merged watched seconds so the 70% gate can survive reloads.
  const handleProgress = useCallback((watchedSec: number, totalSec: number, currentPos: number) => {
    // Monotonic-upward only — mirror the 3SFM watch page. The player's
    // tracker is seeded with baselineWatchedSec captured at mount, which
    // is 0 until the watch-history fetch finishes. Without the max-
    // floor here, a returning student's liveWatchSec gets clobbered
    // below the DB baseline as soon as playback reports in, dropping
    // watchPct below threshold and keeping Mark Complete hidden.
    setLiveWatchSec(prev => Math.max(prev, baselineWatchedSec, watchedSec));
    if (totalSec > 0) setLiveTotalSec(prev => Math.max(prev, totalSec));
    if (currentPos > 0) setLiveCurrentPos(prev => Math.max(prev, currentPos));

    if (!studentSession?.email) return;

    // Throttle: POST every ≥10s OR when value grew by ≥5s, plus always the
    // first one. Keeps request volume sane on active viewers.
    const now = Date.now();
    const last = lastPostedRef.current;
    const delta = watchedSec - last.sec;
    const tooSoon = now - last.at < 9500;
    if (tooSoon && delta < 5 && last.at !== 0) return;
    lastPostedRef.current = { sec: watchedSec, at: now };

    fetch(`/api/training/live-sessions/${params.id}/watched`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: studentSession.email,
        regId: studentSession.registrationId,
        status: isWatched ? 'completed' : 'in_progress',
        watch_seconds: Math.round(watchedSec),
        total_seconds: Math.round(totalSec),
        last_position: Math.round(currentPos),
      }),
    }).catch(() => {});
  }, [studentSession, params.id, isWatched, baselineWatchedSec]);

  const handleVideoEnded = useCallback(() => { setVideoEnded(true); }, []);

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
          <Link href="/training/dashboard?tab=live-sessions" style={{ color: '#1B4F8A', marginTop: 12, display: 'inline-block' }}>Back to Live Sessions</Link>
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
        const res = await fetch(`/api/training/live-sessions/${session.id}/watched`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: studentSession.email,
            regId: studentSession.registrationId,
            status: 'completed',
            watch_seconds: liveWatchSec,
            total_seconds: liveTotalSec,
          }),
        });
        // Don't flip isWatched=true on rejection — the previous code
        // set it unconditionally, so a 403 ("threshold not met") would
        // show "Completed" on the client but the DB row stayed
        // in_progress. Next page-load would then show no button at
        // all (my filter fix). Parsing the JSON gives the student a
        // readable explanation.
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string; current?: number; required?: number };
          const msg = err.current != null && err.required != null
            ? `${err.error ?? 'Not complete yet'} (watched ${err.current}%, need ${err.required}%).`
            : err.error ?? 'Could not mark complete. Please try again.';
          alert(msg);
          return;
        }
        setIsWatched(true);
        setPlaylistSessions(prev => prev.map(s => s.id === session.id ? { ...s, watched: true } : s));
      } catch (e) {
        console.error('[LiveSession] handleMarkComplete failed', e);
        alert('Network error — could not mark complete. Please try again.');
      }
    };

    // Watch-enforcement gate:
    //
    //   nearEnd         = (totalSec > 0) && (pos >= totalSec - 20 || videoEnded)
    //   canMarkComplete = nearEnd && (thresholdMet || bypassActive)
    //
    // Mirrors the 3SFM watch page. Mark Complete unlocks once the
    // student is within the last 20s of the video OR the player signals
    // ended — AND their real-time-tracked watched seconds clear the
    // threshold (or bypass is active). Dragging into the last 20s
    // still leaves watchPct below threshold, so skip-to-end is blocked
    // at the tracker. Server-side /watched re-checks threshold before
    // accepting `status='completed'`.
    const watchPct = liveTotalSec > 0
      ? Math.min(100, Math.round((liveWatchSec / liveTotalSec) * 100))
      : 0;
    const thresholdMet = watchPct >= enforcement.threshold;
    const bypassActive = !enforcement.enabled || enforcement.sessionBypass || enforcement.isAdmin;
    const nearEnd = liveTotalSec > 0 && (liveCurrentPos >= liveTotalSec - 20 || videoEnded);
    const canMarkComplete = nearEnd && (thresholdMet || bypassActive);

    const markCompleteCallback = canMarkComplete && !isWatched ? handleMarkComplete : undefined;

    // Ghost hint shown in the top bar when neither Mark Complete nor
    // the Completed badge is active. Gives the student visual feedback
    // that the session is being tracked instead of an empty toolbar.
    let watchHint: string | undefined;
    if (!markCompleteCallback && !isWatched && liveTotalSec > 0 && liveCurrentPos > 0) {
      if (nearEnd && !thresholdMet && !bypassActive) {
        watchHint = `Watched ${watchPct}% · keep watching to finish`;
      } else if (!nearEnd) {
        watchHint = `Watching… ${watchPct}%`;
      }
    }

    // Diagnostic — surfaces the full state machine in devtools. Lets us
    // pinpoint which gate is failing when a student reports "button
    // never appeared". Dumps on every state change that matters.
    if (typeof window !== 'undefined') {
      console.log('[LiveSession state]', {
        isWatched,
        videoEnded,
        liveWatchSec,
        liveTotalSec,
        liveCurrentPos,
        watchPct,
        threshold: enforcement.threshold,
        thresholdMet,
        bypassActive,
        nearEnd,
        canMarkComplete,
        markCompleteCallback: markCompleteCallback ? 'SET' : 'UNDEFINED',
        watchHint: watchHint ?? 'none',
      });
    }

    // Progress bar sits in the scroll area above Mark Complete (CourseTopBar).
    // Only render while the student is actively watching (not yet completed).
    const progressBar = !isWatched ? (
      <WatchProgressBar
        watchPct={watchPct}
        threshold={enforcement.threshold}
        enforcing={enforcement.enabled}
        adminBypass={enforcement.isAdmin}
        sessionBypass={enforcement.sessionBypass}
      />
    ) : null;

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
        onMarkComplete={markCompleteCallback}
        isCompleted={isWatched}
        watchHint={watchHint}
        videoId={hasVideo ? ytId! : undefined}
        sessionId={session.id}
        studentEmail={studentSession?.email}
        studentRegId={studentSession?.registrationId}
        baselineWatchedSeconds={baselineWatchedSec}
        belowVideoContent={progressBar}
        onVideoProgress={handleProgress}
        onVideoEnded={handleVideoEnded}
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
        backUrl="/training/dashboard?tab=live-sessions"
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

  // Session loaded - show with headerOnly (no sidebar/footer, just the Training Hub header)
  if (session) {
    return (
      <TrainingShell activeNav="live-sessions" headerOnly>
        {content}
      </TrainingShell>
    );
  }

  // Loading/404 - show with full sidebar
  return (
    <TrainingShell activeNav="live-sessions">
      {content}
    </TrainingShell>
  );
}
