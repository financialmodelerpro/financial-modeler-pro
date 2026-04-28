'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bell, ThumbsUp, MessageCircle, Share2, X } from 'lucide-react';
import { YouTubePlayer, type WatchProgressPayload } from '../YouTubePlayer';
import type { Interval } from '@/src/hubs/training/lib/watch/watchTracker';
import { YouTubeComments } from '../YouTubeComments';
import { StudentNotes } from '../StudentNotes';
import { CourseTopBar } from './CourseTopBar';
import { FollowPopup } from '@/src/shared/components/FollowPopup';

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
  /** Manual override path (Phase 3 / migration 147). Surfaces a
   *  checkbox + Mark Complete button in CourseTopBar when watch% is
   *  in the [50, threshold) band -- safety valve for students whose
   *  tracker undershot. Server validates pct >= 50 AND wall-clock
   *  elapsed >= total_seconds * 0.8 before honouring. */
  onManualComplete?: () => void;
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
  /** Fires periodically with the full progress payload (interval-merged
   *  watched seconds + the snapshot intervals + a `force` flag set on
   *  real close events). The watch page POSTs the snapshot intervals so
   *  cross-session watch% accumulates correctly (migration 146). */
  onVideoProgress?: (payload: WatchProgressPayload) => void;
  /** Seed the player's tracker with seconds already persisted to DB. */
  baselineWatchedSeconds?: number;
  /** Seed the player's tracker with the JSONB watch_intervals from the
   *  DB so a returning student's prior watch is union-merged with the
   *  current session. Without this the tracker stays anchored at the
   *  largest single contiguous run forever. */
  initialIntervals?: Interval[];
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
  // The per-page session list sidebar was removed 2026-04-23. Navigation
  // back to the course is now a single button in the top bar driven by
  // backUrl + backLabel.
  backUrl: string;
  backLabel: string;
  /** Optional content rendered at the TOP of Screen 1 (before banner +
   *  title + meta). Used by the live-session detail page to put the
   *  Register / Join card front-and-centre - students see the
   *  registration CTA the instant the page loads instead of having
   *  to scroll past description + attachments. */
  topContent?: React.ReactNode;
  // Content below video (description, attachments, etc.)
  children?: React.ReactNode;
}

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export function CoursePlayerLayout({
  title, youtubeUrl, channelId, showLikeButton,
  sessionTitle, sessionDescription, sessionUrl,
  nextSessionHref, isWatched, onMarkComplete, onManualComplete, isCompleted,
  assessmentUrl, assessmentReady, assessmentPassed, watchHint, onVideoPlaying, onVideoEnded,
  onVideoProgress, baselineWatchedSeconds, initialIntervals, resumePositionSeconds, belowVideoContent,
  videoId, sessionId, studentEmail, studentRegId,
  bannerUrl, instructorName, instructorTitle,
  scheduledDatetime, timezone, durationMinutes, difficultyLevel, tags,
  prerequisites, category, isFeatured,
  sessionType, liveUrl, isLoggedIn,
  backUrl, backLabel,
  topContent,
  children,
}: CoursePlayerLayoutProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  const [showVideoPopup, setShowVideoPopup] = useState(false);

  // Measure the main TrainingShell nav so the fixed sub-header (CourseTopBar)
  // can sit cleanly below it without overlap, even if the nav grows above
  // its 56px baseline (mobile, font fallback, etc.). Falls back to 56 when
  // the nav element isn't in the DOM yet (early render).
  const [mainNavHeight, setMainNavHeight] = useState(56);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const measure = () => {
      const el = document.querySelector('[data-fmp-main-nav]') as HTMLElement | null;
      if (!el) return;
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0 && h !== mainNavHeight) setMainNavHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    const el = document.querySelector('[data-fmp-main-nav]');
    if (el) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
  const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return ''; } };

  // CTA for sessions without embedded video.
  //
  // Upcoming-session CTAs (Register / Join) are intentionally NOT
  // rendered here anymore. The previous behaviour was buggy on two
  // fronts: the "Register for Session" Link just bounced back to the
  // same detail page (no API call, no row, no email) and the "Join
  // Session" Link exposed live_url to anyone who hit the page,
  // bypassing registration entirely. The caller (live-session detail
  // page) now renders its own registration card via `children` that
  // POSTs to /api/training/live-sessions/[id]/register and only
  // surfaces the join link AFTER the server confirms a row exists
  // AND we're inside the join-window (joinLinkAvailable=true).
  const sessionCta = (() => {
    if (hasVideo) return null; // handled by Watch Session button
    if (isUpcoming) return null; // caller renders the Register UI
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
      {/* Top bar - now hosts the "Back to Course" button (the per-page
          sidebar was dropped 2026-04-23). It is `position: fixed` so it
          survives any ancestor `overflow`/`transform` that would defeat
          `sticky`; the spacer below reserves the same vertical space so
          the body doesn't slip under it on first paint. */}
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
        onManualComplete={hasVideo ? onManualComplete : undefined}
        isCompleted={isCompleted}
        assessmentUrl={assessmentUrl}
        assessmentReady={assessmentReady}
        assessmentPassed={assessmentPassed}
        watchHint={watchHint}
        backUrl={backUrl}
        backLabel={backLabel}
        topOffset={mainNavHeight}
      />
      <div aria-hidden="true" style={{ minHeight: 52 }} />

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, flexDirection: isMobile ? 'column' : 'row', position: 'relative' }}>
        {/* Middle content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Screen 1: Video NOT open - full session info.
              I11: padding clamps down on narrow phones — 24/32px was
              eating ~64px per side, leaving 256px content on 320px. */}
          {!videoOpen && (
            <div style={{ padding: 'clamp(14px, 4vw, 24px) clamp(14px, 4vw, 32px)', maxWidth: 860 }}>
              {/* TOP slot - renders before banner + title so callers can
                  surface registration / join CTAs as the first thing the
                  student sees. */}
              {topContent && (
                <div style={{ marginBottom: 20 }}>{topContent}</div>
              )}

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
              YouTubePlayer renders 16:9 via padding-bottom trick on its
              own width. We cap the wrapper width by viewport HEIGHT so
              the resulting 16:9 video stays inside the viewport without
              scrolling. After the sidebar was removed (2026-04-23) the
              video was free to grow to full content width and ended up
              taller than the viewport on standard desktops; clamping
              max-width to (visible-height * 16/9) keeps it visible.
              The 200px subtracts main header (56) + sub-header (52) +
              comfortable padding (~92) so the video sits inside the
              first scroll. Falls back to full width on mobile via the
              `min(...)` so a portrait phone is never width-clamped
              below its actual viewport. */}
          {videoOpen && hasVideo && (
            <>
              <div style={{
                width: '100%',
                maxWidth: 'min(100%, calc((100vh - 200px) * 16 / 9))',
                margin: '0 auto',
                background: '#000',
              }}>
                <YouTubePlayer
                  videoId={videoId!}
                  title={title}
                  sessionId={sessionId}
                  studentEmail={studentEmail}
                  studentRegId={studentRegId}
                  baselineWatchedSeconds={baselineWatchedSeconds}
                  initialIntervals={initialIntervals}
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
