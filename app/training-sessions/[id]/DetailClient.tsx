'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { CoursePlayerLayout, type SidebarSession } from '@/src/hubs/training/components/player/CoursePlayerLayout';
import { WelcomeModal } from '@/src/hubs/training/components/WelcomeModal';
import { extractYouTubeId } from '@/src/shared/cms';

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
        <Link href={`${LEARN_URL}/training-sessions`} style={{ color: '#1B4F8A' }}>Back to Live Sessions</Link>
      </div>
    );
  }

  const currentIndex = playlistSessions.findIndex(s => s.id === session.id);
  const nextSession = currentIndex >= 0 ? playlistSessions[currentIndex + 1] : null;

  // ── CoursePlayerLayout for all session types ──
  return (<>
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
      backUrl={`${LEARN_URL}/training-sessions`}
      backLabel="All Sessions"
    >
      {/* Auth-required register CTA (FIX 4, 2026-04-23). The previous
          version was a thin "Sign in to earn points" link in a small
          banner; non-authenticated visitors couldn't tell where the
          actual Register button lived. Now we surface a prominent
          card with two clear paths (existing user vs new user), both
          carrying a redirect back to this same session detail page so
          the visitor lands where they started after auth. */}
      {!isLoggedIn && (
        <div style={{
          marginTop: 20, marginBottom: 4,
          padding: '20px 22px', borderRadius: 12,
          background: '#fff',
          border: '1px solid #BFDBFE',
          boxShadow: '0 2px 12px rgba(13, 46, 90, 0.06)',
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A', marginBottom: 6 }}>
            Sign in to register for this session
          </div>
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.55, marginBottom: 14 }}>
            Registration is free. We will email the join link 30 minutes before the session starts and the recording the next day.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link
              href={`/signin?redirect=/training/live-sessions/${session.id}`}
              style={{
                padding: '10px 20px', borderRadius: 8,
                background: '#0D2E5A', color: '#fff',
                fontSize: 13, fontWeight: 700, textDecoration: 'none',
              }}
            >
              Sign In to Register
            </Link>
            <Link
              href={`/register?redirect=/training/live-sessions/${session.id}`}
              style={{
                padding: '10px 20px', borderRadius: 8,
                background: '#2EAA4A', color: '#fff',
                fontSize: 13, fontWeight: 700, textDecoration: 'none',
              }}
            >
              Create Account to Register
            </Link>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#6B7280' }}>
            Both options bring you back to this page after sign-in.
          </div>
        </div>
      )}
    </CoursePlayerLayout>
    <WelcomeModal />
  </>
  );
}
