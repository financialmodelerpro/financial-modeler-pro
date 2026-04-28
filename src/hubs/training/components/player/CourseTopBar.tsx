'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, ThumbsUp, MessageCircle, Share2, ArrowLeft } from 'lucide-react';
import { SubscribeModal } from '../SubscribeModal';
import { ShareModal } from './ShareModal';
import { FollowPopup } from '@/src/shared/components/FollowPopup';

interface CourseTopBarProps {
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
  /** Manual override callback. Surfaces a checkbox + Mark Complete
   *  button when the student has watched at least 50 percent but
   *  hasn't cleared the auto-unlock threshold. The checkbox is the
   *  explicit confirmation; the button only enables once it's
   *  checked. Phase 3 / migration 147 -- belt for students whose
   *  tracker undershot for legitimate reasons. Server-side validates
   *  pct >= 50 AND wall-clock elapsed >= total_seconds * 0.8. */
  onManualComplete?: () => void;
  isCompleted?: boolean;
  assessmentUrl?: string;
  assessmentReady?: boolean;
  assessmentPassed?: boolean;
  /** Ghost hint rendered in the action area when the Mark Complete
   *  button isn't active and there's no Completed badge - e.g.
   *  "Watching… 45%" or "Keep watching to finish". Previously the
   *  area collapsed to empty, making it look like nothing was being
   *  tracked. */
  watchHint?: string;
  /** Back-to-course link. Replaces the per-page sidebar that used to
   *  hold the session list - the sidebar was a distraction during
   *  watching and the student naturally returns to the course view
   *  after marking complete + taking the assessment. */
  backUrl?: string;
  backLabel?: string;
  /** Top offset in pixels - measured at runtime by CoursePlayerLayout
   *  from the actual TrainingShell nav so we sit cleanly underneath
   *  even if the main nav grows above its 56px baseline. */
  topOffset?: number;
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  textDecoration: 'none',
  color: 'rgba(255,255,255,0.8)',
  whiteSpace: 'nowrap',
};

export function CourseTopBar({
  title, youtubeUrl, channelId, showLikeButton,
  sessionTitle, sessionDescription, sessionUrl,
  nextSessionHref, isWatched, onMarkComplete, onManualComplete, isCompleted,
  assessmentUrl, assessmentReady, assessmentPassed, watchHint,
  backUrl, backLabel, topOffset = 56,
}: CourseTopBarProps) {
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCompletePopup, setShowCompletePopup] = useState(false);
  // Manual override checkbox state. Resets when the override path goes
  // away (auto-unlock arrives, or the row flips to completed). Only
  // matters when `onManualComplete` is set AND `onMarkComplete` is not.
  const [manualConfirmed, setManualConfirmed] = useState(false);

  const handleMarkCompleteWithPopup = useCallback(() => {
    onMarkComplete?.();
    setShowCompletePopup(true);
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('fmp_complete_popup_shown', '1');
  }, [onMarkComplete]);

  const handleManualCompleteWithPopup = useCallback(() => {
    onManualComplete?.();
    setShowCompletePopup(true);
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('fmp_complete_popup_shown', '1');
  }, [onManualComplete]);

  // Sub-header is fixed (not sticky) so it stays visible regardless of
  // ancestor `overflow`/`transform` chains. The 56px top offset clears
  // TrainingShell's main NAV bar above it. CoursePlayerLayout renders
  // a matching-height spacer below this bar so the body isn't hidden
  // underneath it on first paint.
  return (
    <>
      <div style={{
        position: 'fixed', top: topOffset, left: 0, right: 0, zIndex: 140,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', minHeight: 52,
        background: '#0D2E5A', color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        flexWrap: 'wrap',
      }}>
        {/* Back to course - replaces the per-page sidebar */}
        {backUrl && (
          <Link
            href={backUrl}
            title={backLabel ? `Back to ${backLabel}` : 'Back'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 6,
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.9)',
              fontSize: 12, fontWeight: 600, textDecoration: 'none',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <ArrowLeft size={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
              {backLabel ?? 'Back'}
            </span>
          </Link>
        )}

        {/* Session title */}
        <div style={{
          flex: '1 1 200px', minWidth: 0,
          fontSize: 14, fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </div>

        {/* Action icons. flexWrap so the row wraps cleanly on narrow
            viewports instead of overflowing horizontally and pushing
            buttons off-screen. overflowX:auto is a fallback for the
            edge case where a single button is wider than the viewport. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          maxWidth: '100%', overflowX: 'auto',
        }}>
          {channelId && (
            <button
              onClick={() => setShowSubscribeModal(true)}
              title="Subscribe to our YouTube channel"
              style={{ ...iconBtnStyle, background: 'rgba(255,0,0,0.12)', color: '#FF4444', fontWeight: 600 }}
            >
              <Bell size={14} /> Subscribe
            </button>
          )}

          {showLikeButton !== false && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Like on YouTube"
              style={iconBtnStyle}
            >
              <ThumbsUp size={14} /> Like
            </a>
          )}

          <a
            href={`${youtubeUrl}${youtubeUrl.includes('?') ? '&' : '?'}lc=`}
            target="_blank"
            rel="noopener noreferrer"
            title="Ask a question on YouTube - get a quick answer"
            style={iconBtnStyle}
          >
            <MessageCircle size={14} /> Ask Question
          </a>

          <button
            onClick={() => setShowShareModal(true)}
            title="Share this session"
            style={iconBtnStyle}
          >
            <Share2 size={14} /> Share
          </button>

          {/* Divider */}
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 8px' }} />

          {/* Step 1 - Mark Complete button (video ended, not yet complete) */}
          {onMarkComplete && !isCompleted && (
            <button
              onClick={handleMarkCompleteWithPopup}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                color: '#ffffff', background: '#16a34a',
                border: 'none', borderRadius: 6,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              ✓ Mark Complete
            </button>
          )}

          {/* Manual override path. Surfaces when the parent has wired
              up `onManualComplete` (watch% in the [50, threshold) band)
              but not `onMarkComplete` (which is the auto path at
              threshold+). Checkbox + button render side-by-side; the
              button only enables once the checkbox is ticked. Server
              validates pct >= 50 AND wall-clock elapsed >= 80% of
              video duration before honoring the request. */}
          {!onMarkComplete && !isCompleted && onManualComplete && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              maxWidth: '100%',
            }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11.5, color: 'rgba(255,255,255,0.85)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                <input
                  type="checkbox"
                  checked={manualConfirmed}
                  onChange={e => setManualConfirmed(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span>I confirm I have watched this video</span>
              </label>
              <button
                onClick={handleManualCompleteWithPopup}
                disabled={!manualConfirmed}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', fontSize: 12, fontWeight: 600,
                  color: '#ffffff',
                  background: manualConfirmed ? '#16a34a' : 'rgba(22,163,74,0.4)',
                  border: 'none', borderRadius: 6,
                  cursor: manualConfirmed ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap',
                  opacity: manualConfirmed ? 1 : 0.6,
                }}
              >
                ✓ Mark Complete
              </button>
            </div>
          )}

          {/* Ghost hint -- shown when no Mark Complete path is active
              and the row isn't completed, but the parent passed a hint
              (e.g. "Watching… 45%"). Prevents the action area from
              collapsing to empty space mid-watch. */}
          {!onMarkComplete && !onManualComplete && !isCompleted && watchHint && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              color: 'rgba(255,255,255,0.55)',
              whiteSpace: 'nowrap',
            }}>
              {watchHint}
            </span>
          )}

          {/* Step 2 - Completed indicator */}
          {isCompleted && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              color: '#ffffff', background: '#16a34a',
              borderRadius: 6, whiteSpace: 'nowrap',
            }}>
              ✓ Completed
            </span>
          )}

          {/* Step 3 - Assessment button (after complete) */}
          {assessmentUrl && assessmentReady && (
            <Link
              href={assessmentUrl}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                color: '#ffffff', background: '#2563eb',
                border: 'none', borderRadius: 6,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Take Assessment →
            </Link>
          )}

          {/* Assessment already passed */}
          {assessmentPassed && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              color: '#ffffff', background: '#15803D',
              borderRadius: 6, whiteSpace: 'nowrap',
            }}>
              ✓ Assessment Done
            </span>
          )}

          {/* Assessment locked hint */}
          {assessmentUrl && !assessmentReady && !isCompleted && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              color: 'rgba(255,255,255,0.4)',
              whiteSpace: 'nowrap',
            }}>
              Watch video to unlock assessment
            </span>
          )}

          {/* Continue / Next */}
          {nextSessionHref && (
            <Link
              href={nextSessionHref}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                color: '#ffffff', background: '#2563eb',
                border: 'none', borderRadius: 6,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Continue →
            </Link>
          )}
        </div>
      </div>

      {showSubscribeModal && channelId && (
        <SubscribeModal channelId={channelId} onClose={() => setShowSubscribeModal(false)} />
      )}
      {showShareModal && (
        <ShareModal
          sessionTitle={sessionTitle}
          sessionDescription={sessionDescription}
          sessionUrl={sessionUrl}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Post-complete popup */}
      <FollowPopup
        heading="✅ Session Complete!"
        subtext="Stay connected for more financial modeling content."
        show={showCompletePopup}
        autoDismissMs={5000}
        onClose={() => setShowCompletePopup(false)}
      />
    </>
  );
}
