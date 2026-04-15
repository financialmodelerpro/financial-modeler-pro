'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface SidebarSession {
  id: string;
  title: string;
  banner_url: string | null;
  youtube_url: string | null;
  duration_minutes: number | null;
  session_type: string;
  scheduled_datetime?: string;
  playlist?: { id: string; name: string } | { id: string; name: string }[] | null;
}

interface PlaylistSidebarProps {
  playlistId: string;
  playlistName: string;
  currentSessionId: string;
  variant: 'public' | 'student';
}

function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const NAVY = '#0D2E5A';

export function PlaylistSidebar({ playlistId, playlistName, currentSessionId, variant }: PlaylistSidebarProps) {
  const [sessions, setSessions] = useState<SidebarSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/public/training-sessions?limit=50')
      .then(r => r.json())
      .then((d: { sessions?: SidebarSession[] }) => {
        const filtered = (d.sessions ?? [])
          .filter(s => {
            const p = Array.isArray(s.playlist) ? s.playlist[0] : s.playlist;
            return p?.id === playlistId;
          })
          .sort((a, b) =>
            new Date(a.scheduled_datetime ?? 0).getTime() - new Date(b.scheduled_datetime ?? 0).getTime()
          );
        setSessions(filtered);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [playlistId]);

  function detailUrl(id: string) {
    return variant === 'student'
      ? `/training/live-sessions/${id}`
      : `${LEARN_URL}/training-sessions/${id}`;
  }

  if (loading) {
    return (
      <div style={{ background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>{playlistName}</div>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 56, background: '#E5E7EB', borderRadius: 8, marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  if (sessions.length <= 1) return null;

  return (
    <div style={{ background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>
        {playlistName} <span style={{ fontWeight: 500, color: '#9CA3AF' }}>({sessions.length})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflowY: 'auto' }}>
        {sessions.map((s, i) => {
          const isCurrent = s.id === currentSessionId;
          const ytId = extractYouTubeId(s.youtube_url);
          const thumb = s.banner_url || (ytId ? `https://img.youtube.com/vi/${ytId}/default.jpg` : null);
          return (
            <Link key={s.id} href={detailUrl(s.id)} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8,
                background: isCurrent ? '#EFF6FF' : '#fff',
                border: isCurrent ? '1.5px solid #3B82F6' : '1px solid #E5E7EB',
                transition: 'background 0.15s',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: isCurrent ? '#3B82F6' : '#9CA3AF', width: 16, flexShrink: 0, paddingTop: 4, textAlign: 'center' }}>
                  {i + 1}
                </div>
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: isCurrent ? 700 : 500,
                    color: isCurrent ? '#1D4ED8' : NAVY,
                    lineHeight: 1.3,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
                  }}>
                    {s.title}
                  </div>
                  {s.duration_minutes && (
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{s.duration_minutes} min</div>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
