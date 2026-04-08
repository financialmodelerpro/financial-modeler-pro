'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { FilePreviewModal } from '@/src/components/training/dashboard/FilePreviewModal';

interface Attachment { id: string; file_name: string; file_url: string; file_type: string; file_size: number }
interface Session {
  id: string; title: string; description: string; youtube_url: string; live_url: string;
  session_type: string; scheduled_datetime: string; timezone: string; category: string;
  playlist: { id: string; name: string } | null; attachments: Attachment[];
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

export default function LiveSessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [previewFile, setPreviewFile] = useState<Attachment | null>(null);
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/signin'); return; }
    fetch(`/api/training/live-sessions/${params.id}`)
      .then(r => r.json())
      .then(d => setSession(d.session ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.id, router]);

  // Countdown timer for upcoming sessions
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

  if (loading) return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>
      <nav style={{ background: NAVY, height: 56 }} />
      <div style={{ textAlign: 'center', padding: 80, color: '#9CA3AF' }}>Loading...</div>
    </div>
  );

  if (!session) return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>
      <nav style={{ background: NAVY, height: 56 }} />
      <div style={{ textAlign: 'center', padding: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>404</div>
        <div style={{ color: '#6B7280' }}>Session not found</div>
        <Link href="/training/live-sessions" style={{ color: '#1B4F8A', marginTop: 12, display: 'inline-block' }}>Back to Live Sessions</Link>
      </div>
    </div>
  );

  const isUpcoming = session.session_type === 'upcoming' || session.session_type === 'live';
  const ytId = extractYouTubeId(session.youtube_url);

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={{ background: NAVY, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 14, height: 56, position: 'sticky', top: 0, zIndex: 100 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
          <div style={{ width: 26, height: 26, borderRadius: 5, background: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>F</div>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Financial Modeler Pro</span>
        </Link>
        <span style={{ color: '#475569' }}>|</span>
        <Link href="/training/live-sessions" style={{ color: '#94A3B8', fontSize: 13, textDecoration: 'none' }}>Live Sessions</Link>
        <span style={{ color: '#475569' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
      </nav>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 64px' }}>
        {/* Breadcrumb */}
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
          {session.category && <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{session.category}</span>}
          {session.playlist && <span style={{ fontSize: 11, color: '#9CA3AF' }}>{session.playlist.name}</span>}
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 800, color: NAVY, marginBottom: 8, lineHeight: 1.3 }}>{session.title}</h1>

        {session.scheduled_datetime && (
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 16 }}>
            {fmtDate(session.scheduled_datetime)} at {fmtTime(session.scheduled_datetime)} ({session.timezone})
          </div>
        )}

        {/* Countdown for upcoming */}
        {isUpcoming && countdown && (
          <div style={{ background: '#EFF6FF', border: '2px solid #3B82F6', borderRadius: 12, padding: '20px 24px', marginBottom: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Starts in</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: NAVY, fontFamily: 'monospace' }}>{countdown}</div>
          </div>
        )}

        {/* Video embed for recorded */}
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

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {session.live_url && isUpcoming && (
            <a href={session.live_url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '12px 28px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
              Join Session
            </a>
          )}
          {session.scheduled_datetime && isUpcoming && (
            <>
              <a href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(session.title)}&dates=${new Date(session.scheduled_datetime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}/${new Date(new Date(session.scheduled_datetime).getTime() + 5400000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}&details=${encodeURIComponent(session.description || '')}`}
                target="_blank" rel="noopener noreferrer"
                style={{ padding: '12px 20px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                Google Calendar
              </a>
            </>
          )}
          <button onClick={copyLink}
            style={{ padding: '12px 20px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>

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
                const icon = att.file_type === 'pdf' ? '📄' : att.file_type === 'docx' ? '📝' : att.file_type === 'pptx' ? '📊' : att.file_type === 'xlsx' ? '📗' : '🖼️';
                const size = att.file_size ? att.file_size > 1048576 ? `${(att.file_size / 1048576).toFixed(1)} MB` : `${(att.file_size / 1024).toFixed(0)} KB` : '';
                return (
                  <button key={att.id} onClick={() => setPreviewFile(att)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                    <span style={{ fontSize: 20 }}>{icon}</span>
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
      </div>

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
}
