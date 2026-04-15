'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
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
  assessmentUrl?: string;
  assessmentReady?: boolean;
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
  nextSessionHref, isWatched, onMarkComplete,
  assessmentUrl, assessmentReady,
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
        padding: '0 20px', height: 52,
        background: '#0D2E5A', color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexWrap: 'wrap',
      }}>
        {/* Session title */}
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 14, fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </div>

        {/* Action icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {channelId && (
            <button
              onClick={() => setShowSubscribeModal(true)}
              title="Subscribe to our YouTube channel"
              style={iconBtnStyle}
            >
              🔔 Subscribe
            </button>
          )}

          {showLikeButton !== false && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Like this video on YouTube"
              style={iconBtnStyle}
            >
              👍 Like
            </a>
          )}

          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Ask a question on YouTube — get a quick answer"
            style={iconBtnStyle}
          >
            💬 Ask Question
          </a>

          <button
            onClick={() => setShowShareModal(true)}
            title="Share this session"
            style={iconBtnStyle}
          >
            📤 Share
          </button>

          {/* Divider */}
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 8px' }} />

          {/* Mark Complete */}
          {onMarkComplete && (
            <button
              onClick={isWatched ? undefined : handleMarkCompleteWithPopup}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                color: isWatched ? '#ffffff' : '#ffffff',
                background: isWatched ? '#16a34a' : 'rgba(255,255,255,0.12)',
                border: 'none', borderRadius: 6,
                cursor: isWatched ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isWatched ? '✓ Completed' : 'Mark Complete'}
            </button>
          )}

          {/* Assessment */}
          {assessmentUrl && assessmentReady && (
            <Link
              href={assessmentUrl}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                color: '#ffffff', background: '#16a34a',
                border: 'none', borderRadius: 6,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Take Assessment →
            </Link>
          )}
          {assessmentUrl && !assessmentReady && (
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
