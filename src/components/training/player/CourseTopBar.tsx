'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, ThumbsUp, MessageCircle, Share2 } from 'lucide-react';
import { SubscribeModal } from '../SubscribeModal';
import { ShareModal } from './ShareModal';
import { FollowPopup } from '@/src/components/shared/FollowPopup';

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
  /** Ghost hint rendered in the action area when the Mark Complete
   *  button isn't active and there's no Completed badge — e.g.
   *  "Watching… 45%" or "Keep watching to finish". Previously the
   *  area collapsed to empty, making it look like nothing was being
   *  tracked. */
  watchHint?: string;
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
  assessmentUrl, assessmentReady, assessmentPassed, watchHint,
}: CourseTopBarProps) {
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCompletePopup, setShowCompletePopup] = useState(false);

  const handleMarkCompleteWithPopup = useCallback(() => {
    onMarkComplete?.();
    setShowCompletePopup(true);
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('fmp_complete_popup_shown', '1');
  }, [onMarkComplete]);

  return (
    <>
      <div style={{
        position: 'sticky', top: 56, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', minHeight: 52,
        background: '#0D2E5A', color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexWrap: 'wrap',
      }}>
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

          {/* Ghost hint — shown when neither the button nor the
              Completed badge is active, but the parent passed a hint
              (e.g. "Watching… 45%"). Prevents the action area from
              collapsing to empty space mid-watch. */}
          {!onMarkComplete && !isCompleted && watchHint && (
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
