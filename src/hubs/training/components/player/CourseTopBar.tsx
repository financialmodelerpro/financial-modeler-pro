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
  isCompleted?: boolean;
  assessmentUrl?: string;
  assessmentReady?: boolean;
  assessmentPassed?: boolean;
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
  nextSessionHref, isWatched, onMarkComplete, isCompleted,
  assessmentUrl, assessmentReady, assessmentPassed,
  backUrl, backLabel, topOffset = 56,
}: CourseTopBarProps) {
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCompletePopup, setShowCompletePopup] = useState(false);

  const handleMarkCompleteWithPopup = useCallback(() => {
    onMarkComplete?.();
    setShowCompletePopup(true);
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('fmp_complete_popup_shown', '1');
  }, [onMarkComplete]);

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

          {/* Step 1 - Mark Complete button. Parent wires this up only
              when the video has ended (or fallback `currentTime >= duration - 1`
              fired); see the watch pages. The button itself is
              dumb -- if it's rendered, clicking it commits completion. */}
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
