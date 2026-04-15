'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { YouTubePlayer } from '../YouTubePlayer';
import { YouTubeComments } from '../YouTubeComments';
import { CourseTopBar } from './CourseTopBar';

export interface SidebarSession {
  id: string;
  title: string;
  duration_minutes?: number;
  type: 'upcoming' | 'recorded' | 'live';
  watched?: boolean;
  href: string;
}

interface CoursePlayerLayoutProps {
  // Top bar
  title: string;
  youtubeUrl: string;
  channelId?: string;
  showLikeButton?: boolean;
  sessionTitle: string;
  sessionDescription?: string;
  sessionUrl: string;
  nextSessionHref?: string;
  isWatched?: boolean;
  onMarkComplete?: () => void;
  // Video
  videoId: string;
  sessionId?: string;
  studentEmail?: string;
  studentRegId?: string;
  // Session info (shown on Screen 1)
  bannerUrl?: string | null;
  instructorName?: string;
  instructorTitle?: string;
  scheduledDatetime?: string;
  timezone?: string;
  durationMinutes?: number | null;
  difficultyLevel?: string;
  tags?: string[];
  // Sidebar
  sessions: SidebarSession[];
  currentSessionId: string;
  backUrl: string;
  backLabel: string;
  // Content below video (description, attachments, etc.)
  children?: React.ReactNode;
}

export function CoursePlayerLayout({
  title, youtubeUrl, channelId, showLikeButton,
  sessionTitle, sessionDescription, sessionUrl,
  nextSessionHref, isWatched, onMarkComplete,
  videoId, sessionId, studentEmail, studentRegId,
  bannerUrl, instructorName, instructorTitle,
  scheduledDatetime, timezone, durationMinutes, difficultyLevel, tags,
  sessions, currentSessionId, backUrl, backLabel,
  children,
}: CoursePlayerLayoutProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const sidebar = (
    <div style={{
      width: isMobile ? '100%' : videoOpen ? '15%' : 300,
      minWidth: isMobile ? undefined : videoOpen ? 200 : 260,
      flexShrink: 0,
      background: '#ffffff',
      borderRight: isMobile ? 'none' : '1px solid #e5e7eb',
      borderTop: isMobile ? '1px solid #e5e7eb' : 'none',
      overflowY: 'auto',
      ...(isMobile ? {} : { position: 'sticky' as const, top: 52, height: 'calc(100vh - 52px)' }),
    }}>
      {/* Back link */}
      <div style={{ padding: 16, borderBottom: '1px solid #f3f4f6' }}>
        <Link
          href={backUrl}
          style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}
        >
          ← {backLabel}
        </Link>
      </div>

      {/* Sessions heading */}
      <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid #f3f4f6' }}>
        <h3 style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
          Sessions
        </h3>
      </div>

      {/* Session list */}
      {sessions.map((session, index) => (
        <Link
          key={session.id}
          href={session.href}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 16px', textDecoration: 'none',
            background: session.id === currentSessionId ? '#eff6ff' : 'transparent',
            borderLeft: session.id === currentSessionId ? '3px solid #2563eb' : '3px solid transparent',
            borderBottom: '1px solid #f9fafb',
            transition: 'background 0.15s',
          }}
        >
          <div style={{
            width: 20, height: 20, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginTop: 1,
            background: session.watched ? '#2563eb' : session.id === currentSessionId ? '#dbeafe' : '#f3f4f6',
            fontSize: 10, fontWeight: 700,
            color: session.watched ? '#ffffff' : session.id === currentSessionId ? '#2563eb' : '#9ca3af',
          }}>
            {session.watched ? '✓' : index + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13,
              fontWeight: session.id === currentSessionId ? 600 : 400,
              color: session.id === currentSessionId ? '#1d4ed8' : '#374151',
              lineHeight: 1.4,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
            }}>
              {session.title}
            </div>
            {session.duration_minutes && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
                {session.duration_minutes} min
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );

  // Format helpers
  const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
  const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f9fafb' }}>
      {/* Top bar */}
      <CourseTopBar
        title={title}
        youtubeUrl={youtubeUrl}
        channelId={channelId}
        showLikeButton={showLikeButton}
        sessionTitle={sessionTitle}
        sessionDescription={sessionDescription}
        sessionUrl={sessionUrl}
        nextSessionHref={nextSessionHref}
        isWatched={isWatched}
        onMarkComplete={onMarkComplete}
      />

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, flexDirection: isMobile ? 'column' : 'row' }}>
        {/* Left sidebar */}
        {!isMobile && sidebar}

        {/* Middle — main content area */}
        <div style={{ flex: videoOpen ? '0 0 60%' : 1, minWidth: 0 }}>
          {/* ── Screen 1: Video NOT open — full session info ── */}
          {!videoOpen && (
            <div style={{ padding: '24px 32px', maxWidth: 860 }}>
              {/* Watch Session button */}
              <button
                onClick={() => setVideoOpen(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '12px 24px', background: '#2563eb', color: '#ffffff',
                  fontSize: 15, fontWeight: 600, borderRadius: 8,
                  border: 'none', cursor: 'pointer', marginBottom: 24,
                }}
              >
                ▶ Watch Session
              </button>

              {/* Banner */}
              {bannerUrl && (
                <div style={{ marginBottom: 20, borderRadius: 12, overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={bannerUrl} alt={title} style={{ width: '100%', height: 'auto', maxHeight: 300, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                </div>
              )}

              {/* Description */}
              {sessionDescription && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>About this session</h3>
                  <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{sessionDescription}</p>
                </div>
              )}

              {/* Instructor */}
              {instructorName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%', background: '#0D2E5A',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 800, color: '#fff', flexShrink: 0,
                  }}>
                    {instructorName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{instructorName}</div>
                    {instructorTitle && <div style={{ fontSize: 12, color: '#6b7280' }}>{instructorTitle}</div>}
                  </div>
                </div>
              )}

              {/* Date, duration, difficulty */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, fontSize: 13, color: '#6b7280' }}>
                {scheduledDatetime && (
                  <span>{fmtDate(scheduledDatetime)} at {fmtTime(scheduledDatetime)}{timezone ? ` (${timezone})` : ''}</span>
                )}
                {durationMinutes && <span>{durationMinutes} min</span>}
                {difficultyLevel && difficultyLevel !== 'All Levels' && <span>{difficultyLevel}</span>}
              </div>

              {/* Tags */}
              {tags && tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20 }}>
                  {tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1B4F8A', fontWeight: 600 }}>{t}</span>)}
                </div>
              )}

              {/* Additional content (attachments, etc.) */}
              {children}
            </div>
          )}

          {/* ── Screen 2: Video OPEN — video + session info below ── */}
          {videoOpen && (
            <>
              <div style={{ maxHeight: 'calc(100vh - 52px)', aspectRatio: '16/9' }}>
                <YouTubePlayer
                  videoId={videoId}
                  title={title}
                  sessionId={sessionId}
                  studentEmail={studentEmail}
                  studentRegId={studentRegId}
                />
              </div>
              <div style={{ padding: '24px 32px', maxWidth: 860 }}>
                {children}
              </div>
            </>
          )}
        </div>

        {/* Right column — YouTube comments (only when video is open, desktop) */}
        {videoOpen && !isMobile && (
          <div style={{
            flex: '0 0 25%', minWidth: 280, maxWidth: 380,
            background: '#ffffff',
            borderLeft: '1px solid #e5e7eb',
            overflowY: 'auto',
            position: 'sticky', top: 52,
            height: 'calc(100vh - 52px)',
            padding: '16px',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              💬 Discussion
            </h3>
            <YouTubeComments videoId={videoId} youtubeUrl={youtubeUrl} />
          </div>
        )}

        {/* Mobile sidebar (below content) */}
        {isMobile && sidebar}

        {/* Mobile comments (below sidebar) */}
        {videoOpen && isMobile && (
          <div style={{ padding: 16, background: '#ffffff', borderTop: '1px solid #e5e7eb' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              💬 Discussion
            </h3>
            <YouTubeComments videoId={videoId} youtubeUrl={youtubeUrl} />
          </div>
        )}
      </div>
    </div>
  );
}
