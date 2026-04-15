'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { YouTubePlayer } from '../YouTubePlayer';
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
  // Sidebar
  sessions: SidebarSession[];
  currentSessionId: string;
  backUrl: string;
  backLabel: string;
  // Content
  children?: React.ReactNode;
}

export function CoursePlayerLayout({
  title, youtubeUrl, channelId, showLikeButton,
  sessionTitle, sessionDescription, sessionUrl,
  nextSessionHref, isWatched, onMarkComplete,
  videoId, sessionId, studentEmail, studentRegId,
  sessions, currentSessionId, backUrl, backLabel,
  children,
}: CoursePlayerLayoutProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const sidebar = (
    <div style={{
      width: isMobile ? '100%' : 300,
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
          Course Outline
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
          {/* Checkmark or number */}
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

          {/* Info */}
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
        {/* Left sidebar — desktop only (mobile renders below video) */}
        {!isMobile && sidebar}

        {/* Right — video + content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <YouTubePlayer
            videoId={videoId}
            title={title}
            sessionId={sessionId}
            studentEmail={studentEmail}
            studentRegId={studentRegId}
          />

          {/* Content area */}
          <div style={{ padding: '24px 32px', maxWidth: 860 }}>
            {children}
          </div>
        </div>

        {/* Sidebar — mobile only (below video) */}
        {isMobile && sidebar}
      </div>
    </div>
  );
}
