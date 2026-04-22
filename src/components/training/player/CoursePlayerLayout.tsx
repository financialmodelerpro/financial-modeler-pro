'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bell, ThumbsUp, MessageCircle, Share2, X, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { YouTubePlayer } from '../YouTubePlayer';
import { YouTubeComments } from '../YouTubeComments';
import { StudentNotes } from '../StudentNotes';
import { CourseTopBar } from './CourseTopBar';
import { FollowPopup } from '@/src/components/shared/FollowPopup';

const SIDEBAR_COLLAPSED_KEY = 'fmp_player_sidebar_collapsed';

const STORAGE_KEY = 'fmp_support_banner_dismissed';

function SupportBanner({ youtubeUrl, channelId, sessionUrl }: { youtubeUrl: string; channelId?: string; sessionUrl: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(STORAGE_KEY)) setDismissed(true);
  }, []);

  if (dismissed) return null;

  const commentLink = `${youtubeUrl}${youtubeUrl.includes('?') ? '&' : '?'}lc=`;
  const subscribeLink = channelId ? `https://www.youtube.com/channel/${channelId}?sub_confirmation=1` : null;

  const pillStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 12px', borderRadius: 20,
    fontSize: 11, fontWeight: 600, textDecoration: 'none',
    border: '1px solid #E5E7EB', background: '#fff', color: '#374151',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  };

  function handleShareCopy() {
    navigator.clipboard.writeText(sessionUrl).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }

  return (
    <div style={{
      background: '#FFFBF0', border: '1px solid #FDE68A', borderRadius: 10,
      padding: '14px 16px', marginBottom: 12, position: 'relative',
    }}>
      <button
        onClick={() => { setDismissed(true); if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORAGE_KEY, '1'); }}
        style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2 }}
        title="Dismiss"
      >
        <X size={14} />
      </button>
      <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5, marginBottom: 10, paddingRight: 16 }}>
        This certification is completely free - and we&apos;d love to keep it that way. A quick like, comment, or subscribe on YouTube goes a long way.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {subscribeLink && (
          <a href={subscribeLink} target="_blank" rel="noopener noreferrer"
            style={{ ...pillStyle, background: '#FEF2F2', borderColor: '#FECACA', color: '#DC2626' }}>
            <Bell size={12} /> Subscribe
          </a>
        )}
        <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" style={pillStyle}>
          <ThumbsUp size={12} /> Like
        </a>
        <a href={commentLink} target="_blank" rel="noopener noreferrer" style={pillStyle}>
          <MessageCircle size={12} /> Comment
        </a>
        <button onClick={handleShareCopy} style={{ ...pillStyle, ...(shareCopied ? { background: '#DCFCE7', borderColor: '#86EFAC', color: '#166534' } : {}) }}>
          <Share2 size={12} /> {shareCopied ? 'Copied!' : 'Share'}
        </button>
      </div>
    </div>
  );
}

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
  isCompleted?: boolean;
  assessmentUrl?: string;
  assessmentReady?: boolean;
  assessmentPassed?: boolean;
  /** Ghost hint shown in the top bar's action area when neither the
   *  Mark Complete button nor the Completed badge is active. See
   *  CourseTopBar for details. */
  watchHint?: string;
  onVideoPlaying?: () => void;
  onVideoEnded?: () => void;
  onVideoProgress?: (watchedSec: number, totalSec: number, currentPos: number) => void;
  /** Seed the player's tracker with seconds already persisted to DB. */
  baselineWatchedSeconds?: number;
  /** Resume video playback from this position (seconds) — threaded to YouTubePlayer.playerVars.start. */
  resumePositionSeconds?: number;
  /** Optional UI block rendered directly above the Mark Complete area — e.g. watch progress bar. */
  belowVideoContent?: React.ReactNode;
  // Video (optional - may not have embedded video)
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
  nextSessionHref, isWatched, onMarkComplete, isCompleted,
  assessmentUrl, assessmentReady, assessmentPassed, watchHint, onVideoPlaying, onVideoEnded,
  onVideoProgress, baselineWatchedSeconds, resumePositionSeconds, belowVideoContent,
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

  // Sidebar collapse state.
  //   - Desktop: user-toggleable, persisted in localStorage so the
  //     preference survives navigation between sessions.
  //   - Mobile: auto-hidden as an off-canvas drawer so the video has the
  //     full viewport width. The student opens it via the in-content
  //     "Sessions" button and closes it via the backdrop or X.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const hasVideo = !!videoId && !!youtubeUrl;
  const isUpcoming = sessionType === 'upcoming' || sessionType === 'live';

  // 60s video popup - once per session, skip if post-complete popup was shown
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

  // Mobile-first: when there's a video, open it immediately so the
  // student lands on the playable iframe instead of a tap-to-reveal
  // card. Desktop users still see the rich Screen 1 (banner +
  // description + meta) and click "Watch Session" themselves.
  useEffect(() => {
    if (isMobile && hasVideo && !videoOpen) setVideoOpen(true);
  }, [isMobile, hasVideo, videoOpen]);

  // Restore desktop sidebar collapse preference (client-only).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 768 && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true') {
      setSidebarCollapsed(true);
    }
  }, []);

  // Close the mobile drawer whenever the active session changes (the
  // user just navigated, the drawer's job is done).
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [currentSessionId]);

  function toggleSidebarCollapsed() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (typeof window !== 'undefined') localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
  }

  const NAVY = '#0D2E5A';
  const GREEN = '#2EAA4A';
  const sidebarWidth = sidebarCollapsed ? 64 : 240;

  // Sidebar body. Positioning differs between desktop + mobile:
  //   - Desktop: inline flex child with sticky positioning (unchanged
  //     visually when expanded). A collapse toggle shrinks width to 64px
  //     and hides the text labels, leaving only the numbered / ✓ badges.
  //   - Mobile: off-canvas drawer fixed to the left edge, slid out by
  //     default. `mobileSidebarOpen` slides it back in; a backdrop renders
  //     behind it and a close button inside.
  const showLabels = isMobile || !sidebarCollapsed;
  const sidebar = (
    <aside
      style={{
        width: isMobile ? 280 : sidebarWidth,
        flexShrink: 0,
        background: NAVY,
        borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'width 0.2s ease, left 0.25s ease',
        ...(isMobile
          ? {
              position: 'fixed' as const,
              top: 56,
              bottom: 0,
              left: mobileSidebarOpen ? 0 : -300,
              zIndex: 95,
              boxShadow: mobileSidebarOpen ? '4px 0 24px rgba(0,0,0,0.35)' : 'none',
            }
          : { position: 'sticky' as const, top: 108, height: 'calc(100vh - 108px)' }),
      }}
    >
      {/* Header: back link + toggle (collapse on desktop, close on mobile). */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: 4, padding: '10px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <Link
          href={backUrl}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', fontSize: 12, fontWeight: 600,
            color: 'rgba(255,255,255,0.7)', textDecoration: 'none',
            borderRadius: 6, flex: 1, minWidth: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
          title={backLabel}
        >
          <ChevronLeft size={14} style={{ flexShrink: 0 }} />
          {showLabels && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{backLabel}</span>}
        </Link>
        {isMobile ? (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close sessions"
            style={{
              background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff',
              width: 32, height: 32, borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        ) : (
          <button
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'}
            title={sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'}
            style={{
              background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff',
              width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
      </div>

      {showLabels && (
        <div style={{ padding: '10px 12px 4px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)' }}>
            Sessions
          </div>
        </div>
      )}

      <div style={{ padding: showLabels ? '4px 8px' : '8px 6px' }}>
        {sessions.map((session, index) => {
          const active = session.id === currentSessionId;
          return (
            <Link
              key={session.id}
              href={session.href}
              title={session.title}
              style={{
                display: 'flex', alignItems: showLabels ? 'flex-start' : 'center',
                justifyContent: showLabels ? 'flex-start' : 'center',
                gap: 8,
                padding: showLabels ? '8px 12px' : '10px 4px',
                textDecoration: 'none', borderRadius: 6,
                background: active ? '#1B4F8A' : 'transparent',
                borderLeft: `3px solid ${active ? GREEN : 'transparent'}`,
                marginBottom: 2, transition: 'background 0.15s',
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginTop: showLabels ? 1 : 0,
                background: session.watched ? '#2563eb' : active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
                fontSize: 10, fontWeight: 700,
                color: session.watched ? '#fff' : active ? '#fff' : 'rgba(255,255,255,0.5)',
              }}>
                {session.watched ? '✓' : index + 1}
              </div>
              {showLabels && (
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
              )}
            </Link>
          );
        })}
      </div>
    </aside>
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
          {isLoggedIn ? 'Register for Session →' : 'Register Free →'}
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
        isCompleted={isCompleted}
        assessmentUrl={assessmentUrl}
        assessmentReady={assessmentReady}
        assessmentPassed={assessmentPassed}
        watchHint={watchHint}
      />

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, flexDirection: isMobile ? 'column' : 'row', position: 'relative' }}>
        {!isMobile && sidebar}

        {/* Mobile backdrop — only visible while the drawer is open. */}
        {isMobile && mobileSidebarOpen && (
          <div
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
            style={{
              position: 'fixed', top: 56, bottom: 0, left: 0, right: 0,
              background: 'rgba(0,0,0,0.45)', zIndex: 90,
            }}
          />
        )}

        {/* Mobile drawer — same sidebar JSX, off-canvas via fixed positioning. */}
        {isMobile && sidebar}

        {/* Middle content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Mobile-only "Sessions" pill so students can open the drawer
              without losing the video real estate. Hidden on desktop where
              the sidebar lives inline. */}
          {isMobile && (
            <div style={{ padding: '10px 14px 0' }}>
              <button
                onClick={() => setMobileSidebarOpen(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 18,
                  background: '#0D2E5A', color: '#fff',
                  border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                <List size={14} /> Sessions ({sessions.length})
              </button>
            </div>
          )}
          {/* Screen 1: Video NOT open - full session info.
              I11: padding clamps down on narrow phones — 24/32px was
              eating ~64px per side, leaving 256px content on 320px. */}
          {!videoOpen && (
            <div style={{ padding: 'clamp(14px, 4vw, 24px) clamp(14px, 4vw, 32px)', maxWidth: 860 }}>
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
                    fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase',
                    background: sessionType === 'live' ? '#FEF2F2' : isUpcoming ? '#EFF6FF' : '#F3F4F6',
                    color: sessionType === 'live' ? '#DC2626' : isUpcoming ? '#1D4ED8' : '#6B7280',
                  }}>
                    {sessionType === 'live' ? 'Live Now' : isUpcoming ? 'Upcoming' : 'Recorded'}
                  </span>
                )}
                {difficultyLevel && difficultyLevel !== 'All Levels' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280' }}>{difficultyLevel}</span>
                )}
                {category && <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>{category}</span>}
                {isFeatured && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: '#FEF3C7', color: '#B45309', textTransform: 'uppercase' }}>Featured</span>}
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

          {/* Screen 2: Video OPEN.
              The wrapper used to have `aspectRatio: '16/9'` plus YouTubePlayer's
              own padding-bottom 56.25% trick — those compounded with no
              defined width and collapsed the iframe to 0 dimensions on
              mobile (the video appeared "missing"). YouTubePlayer is
              already responsive 16:9 by itself, so we just give it a
              full-width block container and let it render. */}
          {videoOpen && hasVideo && (
            <>
              <div style={{ width: '100%', background: '#000' }}>
                <YouTubePlayer
                  videoId={videoId!}
                  title={title}
                  sessionId={sessionId}
                  studentEmail={studentEmail}
                  studentRegId={studentRegId}
                  baselineWatchedSeconds={baselineWatchedSeconds}
                  startSeconds={resumePositionSeconds}
                  onPlaying={onVideoPlaying}
                  onEnded={onVideoEnded}
                  onProgress={onVideoProgress}
                />
              </div>
              <div style={{ padding: 'clamp(14px, 4vw, 24px) clamp(14px, 4vw, 32px)', maxWidth: 860 }}>
                {belowVideoContent}
                {children}
                {studentEmail && sessionId && (
                  <StudentNotes sessionId={sessionId} studentEmail={studentEmail} />
                )}
              </div>
            </>
          )}
        </div>

        {/* Right column - comments (video open, desktop) */}
        {videoOpen && hasVideo && !isMobile && (
          <div style={{
            flex: '0 0 25%', minWidth: 280, maxWidth: 380,
            background: '#ffffff', borderLeft: '1px solid #e5e7eb',
            overflowY: 'auto', position: 'sticky', top: 108,
            height: 'calc(100vh - 108px)', padding: 16,
          }}>
            <SupportBanner youtubeUrl={youtubeUrl!} channelId={channelId} sessionUrl={sessionUrl} />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              💬 Discussion
            </h3>
            <YouTubeComments videoId={videoId!} youtubeUrl={youtubeUrl!} />
          </div>
        )}

        {videoOpen && hasVideo && isMobile && (
          <div style={{ padding: 16, background: '#ffffff', borderTop: '1px solid #e5e7eb' }}>
            <SupportBanner youtubeUrl={youtubeUrl!} channelId={channelId} sessionUrl={sessionUrl} />
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
