'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { CoursePlayerLayout, type SidebarSession } from '@/src/components/training/player/CoursePlayerLayout';

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

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export function DetailClient({ session }: { session: DetailSession | null }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [playlistSessions, setPlaylistSessions] = useState<SidebarSession[]>([]);

  useEffect(() => {
    if (getTrainingSession()) setIsLoggedIn(true);
  }, []);

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
            href: `${LEARN_URL}/training-sessions/${s.id}`,
          }));
        setPlaylistSessions(filtered);
      })
      .catch(() => {});
  }, [session?.playlist?.id]);

  const ytId = extractYouTubeId(session?.youtube_url ?? null);
  const hasVideo = session?.youtube_embed && !!ytId;

  if (!session) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>404</div>
        <div style={{ color: '#6B7280', marginBottom: 12 }}>Session not found</div>
        <Link href={`${LEARN_URL}/training-sessions`} style={{ color: '#1B4F8A' }}>Back to Training Sessions</Link>
      </div>
    );
  }

  const currentIndex = playlistSessions.findIndex(s => s.id === session.id);
  const nextSession = currentIndex >= 0 ? playlistSessions[currentIndex + 1] : null;

  // ── CoursePlayerLayout for all session types ──
  return (
    <CoursePlayerLayout
      title={session.title}
      youtubeUrl={hasVideo ? session.youtube_url! : undefined}
      channelId={process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}
      showLikeButton={session.show_like_button}
      sessionTitle={session.title}
      sessionDescription={session.description}
      sessionUrl={`${LEARN_URL}/training-sessions/${session.id}`}
      nextSessionHref={nextSession?.href}
      isWatched={false}
      videoId={hasVideo ? ytId! : undefined}
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
      sessionType={session.session_type}
      isLoggedIn={isLoggedIn}
      sessions={playlistSessions}
      currentSessionId={session.id}
      backUrl={`${LEARN_URL}/training-sessions`}
      backLabel="All Sessions"
    >
      {/* Sign in CTA */}
      {!isLoggedIn && (
        <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, background: '#EFF6FF', border: '1px solid #93C5FD', textAlign: 'center', fontSize: 12, color: '#1D4ED8' }}>
          <Link href={`/register?redirect=/training/live-sessions/${session.id}`} style={{ fontWeight: 700, color: '#1D4ED8', textDecoration: 'none' }}>
            Sign in to earn points and badges for watching!
          </Link>
        </div>
      )}
    </CoursePlayerLayout>
  );
}
