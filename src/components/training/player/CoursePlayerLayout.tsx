'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { YouTubePlayer } from '../YouTubePlayer';
import { YouTubeComments } from '../YouTubeComments';
import { StudentNotes } from '../StudentNotes';
import { CourseTopBar } from './CourseTopBar';
import { FollowPopup } from '@/src/components/shared/FollowPopup';

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
  youtubeUrl?: string;
  channelId?: string;
  showLikeButton?: boolean;
  sessionTitle: string;
  sessionDescription?: string;
  sessionUrl: string;
  nextSessionHref?: string;
  isWatched?: boolean;
  onMarkComplete?: () => void;
  // Video (optional — may not have embedded video)
  videoId?: string;
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
  prerequisites?: string;
  category?: string;
  isFeatured?: boolean;
  sessionType?: string;
  liveUrl?: string;
  isLoggedIn?: boolean;
  // Sidebar
  sessions: SidebarSession[];
  currentSessionId: string;
  backUrl: string;
  backLabel: string;
  // Content below video (description, attachments, etc.)
  children?: React.ReactNode;
}

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export function CoursePlayerLayout({
  title, youtubeUrl, channelId, showLikeButton,
  sessionTitle, sessionDescription, sessionUrl,
  nextSessionHref, isWatched, onMarkComplete,
  videoId, sessionId, studentEmail, studentRegId,
  bannerUrl, instructorName, instructorTitle,
  scheduledDatetime, timezone, durationMinutes, difficultyLevel, tags,
  prerequisites, category, isFeatured,
  sessionType, liveUrl, isLoggedIn,
  sessions, currentSessionId, backUrl, backLabel,
  children,
}: CoursePlayerLayoutProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  const [showVideoPopup, setShowVideoPopup] = useState(false);

  const hasVideo = !!videoId && !!youtubeUrl;
  const isUpcoming = sessionType === 'upcoming' || sessionType === 'live';

  // 60s video popup — once per session, skip if post-complete popup was shown
  useEffect(() => {
    if (!videoOpen) return;
    if (typeof sessionStorage !== 'undefined' && (sessionStorage.getItem('fmp_video_popup_shown') || sessionStorage.getItem('fmp_complete_popup_shown'))) return;
    const t = setTimeout(() => {
      setShowVideoPopup(true);
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('fmp_video_popup_shown', '1');
    }, 60000);
    return () => clearTimeout(t);
  }, [videoOpen]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const NAVY = '#0D2E5A';
  const GREEN = '#2EAA4A';

  const sidebar = (
    <div style={{
      width: isMobile ? '100%' : 240,
      flexShrink: 0,
      background: NAVY,
      borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)',
      borderTop: isMobile ? '1px solid rgba(255,255,255,0.08)' : 'none',
      overflowY: 'auto', overflowX: 'hidden',
      ...(isMobile ? {} : { position: 'sticky' as const, top: 108, height: 'calc(100vh - 108px)' }),
    }}>
      <div style={{ padding: '12px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link
          href={backUrl}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', borderRadius: 6 }}
        >
          ← {backLabel}
        </Link>
      </div>
      <div style={{ padding: '10px 12px 4px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)' }}>
          Sessions
        </div>
      </div>
      <div style={{ padding: '4px 8px' }}>
        {sessions.map((session, index) => {
          const active = session.id === currentSessionId;
          return (
            <Link
              key={session.id}
              href={session.href}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 12px', textDecoration: 'none', borderRadius: 6,
                background: active ? '#1B4F8A' : 'transparent',
                borderLeft: `3px solid ${active ? GREEN : 'transparent'}`,
                marginBottom: 2, transition: 'background 0.15s',
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginTop: 1,
                background: session.watched ? '#2563eb' : active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
                fontSize: 9, fontWeight: 700,
                color: session.watched ? '#fff' : active ? '#fff' : 'rgba(255,255,255,0.5)',
              }}>
                {session.watched ? '✓' : index + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: active ? 700 : 600,
                  color: active ? '#fff' : 'rgba(255,255,255,0.7)',
                  lineHeight: 1.3, overflow: 'hidden',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                }}>
                  {session.title}
                </div>
                {session.duration_minutes && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{session.duration_minutes} min</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );

  const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
  const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; } };

  // CTA for sessions without embedded video
  const sessionCta = (() => {
    if (hasVideo) return null; // handled by Watch Session button
    if (isUpcoming && liveUrl) {
      return (
        <a href={liveUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#DC2626', color: '#fff', fontSize: 15, fontWeight: 600, borderRadius: 8, textDecoration: 'none', marginBottom: 24 }}>
          Join Session →
        </a>
      );
    }
    if (isUpcoming && !liveUrl) {
      return (
        <Link href={isLoggedIn ? `/training/live-sessions/${currentSessionId}` : `/register?redirect=/training/live-sessions/${currentSessionId}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#2EAA4A', color: '#fff', fontSize: 15, fontWeight: 600, borderRadius: 8, textDecoration: 'none', marginBottom: 24 }}>
          {isLoggedIn ? 'Register for Session →' : 'Sign Up to Register →'}
        </Link>
      );
    }
    if (youtubeUrl) {
      // Has youtube_url but youtube_embed is false
      return (
        <a href={youtubeUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#DC2626', color: '#fff', fontSize: 15, fontWeight: 600, borderRadius: 8, textDecoration: 'none', marginBottom: 24 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          Watch on YouTube
        </a>
      );
    }
    // No video at all
    return (
      <div style={{ padding: '16px 20px', background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB', marginBottom: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🎬</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#6B7280' }}>Recording Coming Soon</div>
        <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Check back after the session is recorded.</div>
      </div>
    );
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f9fafb' }}>
      {/* Top bar */}
      <CourseTopBar
        title={title}
        youtubeUrl={youtubeUrl || ''}
        channelId={channelId}
        showLikeButton={hasVideo ? showLikeButton : false}
        sessionTitle={sessionTitle}
        sessionDescription={sessionDescription}
        sessionUrl={sessionUrl}
        nextSessionHref={nextSessionHref}
        isWatched={isWatched}
        onMarkComplete={hasVideo ? onMarkComplete : undefined}
      />

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, flexDirection: isMobile ? 'column' : 'row' }}>
        {!isMobile && sidebar}

        {/* Middle content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Screen 1: Video NOT open — full session info */}
          {!videoOpen && (
            <div style={{ padding: '24px 32px', maxWidth: 860 }}>
              {/* Primary CTA at top */}
              {hasVideo ? (
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
              ) : sessionCta}

              {/* Banner */}
              {bannerUrl && (
                <div style={{ marginBottom: 20, borderRadius: 12, overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={bannerUrl} alt={title} style={{ width: '100%', height: 'auto', maxHeight: 300, objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                </div>
              )}

              {/* Session title */}
              <h1 style={{ fontSize: 'clamp(22px,4vw,28px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 10, lineHeight: 1.3 }}>{title}</h1>

              {/* Badges */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                {sessionType && (
                  <span style={{
                    fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
                    background: sessionType === 'live' ? '#FEF2F2' : isUpcoming ? '#EFF6FF' : '#F3F4F6',
                    color: sessionType === 'live' ? '#DC2626' : isUpcoming ? '#1D4ED8' : '#6B7280',
                  }}>
                    {sessionType === 'live' ? 'LIVE NOW' : isUpcoming ? 'UPCOMING' : 'RECORDED'}
                  </span>
                )}
                {difficultyLevel && difficultyLevel !== 'All Levels' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280' }}>{difficultyLevel}</span>
                )}
                {category && <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{category}</span>}
                {isFeatured && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
              </div>

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
              </div>

              {/* Prerequisites */}
              {prerequisites && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>Prerequisites: </span>
                  <span style={{ fontSize: 13, color: '#374151' }}>{prerequisites}</span>
                </div>
              )}

              {/* Tags */}
              {tags && tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20 }}>
                  {tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1B4F8A', fontWeight: 600 }}>{t}</span>)}
                </div>
              )}

              {/* Description */}
              {sessionDescription && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>About this session</h3>
                  <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{sessionDescription}</p>
                </div>
              )}

              {/* Children (attachments, sign-in CTA, etc.) */}
              {children}

              {/* Student notes (logged in only) */}
              {studentEmail && sessionId && (
                <StudentNotes sessionId={sessionId} studentEmail={studentEmail} />
              )}

              {/* Watch Session button at bottom too */}
              {hasVideo && (
                <div style={{ marginTop: 24 }}>
                  <button
                    onClick={() => setVideoOpen(true)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '12px 24px', background: '#2563eb', color: '#ffffff',
                      fontSize: 15, fontWeight: 600, borderRadius: 8,
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    ▶ Watch Session
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Screen 2: Video OPEN */}
          {videoOpen && hasVideo && (
            <>
              <div style={{ maxHeight: 'calc(100vh - 108px)', aspectRatio: '16/9' }}>
                <YouTubePlayer
                  videoId={videoId!}
                  title={title}
                  sessionId={sessionId}
                  studentEmail={studentEmail}
                  studentRegId={studentRegId}
                />
              </div>
              <div style={{ padding: '24px 32px', maxWidth: 860 }}>
                {children}
                {studentEmail && sessionId && (
                  <StudentNotes sessionId={sessionId} studentEmail={studentEmail} />
                )}
              </div>
            </>
          )}
        </div>

        {/* Right column — comments (video open, desktop) */}
        {videoOpen && hasVideo && !isMobile && (
          <div style={{
            flex: '0 0 25%', minWidth: 280, maxWidth: 380,
            background: '#ffffff', borderLeft: '1px solid #e5e7eb',
            overflowY: 'auto', position: 'sticky', top: 108,
            height: 'calc(100vh - 108px)', padding: 16,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              💬 Discussion
            </h3>
            <YouTubeComments videoId={videoId!} youtubeUrl={youtubeUrl!} />
          </div>
        )}

        {isMobile && sidebar}

        {videoOpen && hasVideo && isMobile && (
          <div style={{ padding: 16, background: '#ffffff', borderTop: '1px solid #e5e7eb' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              💬 Discussion
            </h3>
            <YouTubeComments videoId={videoId!} youtubeUrl={youtubeUrl!} />
          </div>
        )}
      </div>

      {/* 60s video popup */}
      <FollowPopup
        heading="Enjoying this session?"
        subtext="Follow us for more financial modeling sessions and training content."
        show={showVideoPopup}
        onClose={() => setShowVideoPopup(false)}
      />
    </div>
  );
}
