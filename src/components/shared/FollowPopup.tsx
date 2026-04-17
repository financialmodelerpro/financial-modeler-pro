'use client';

import { useState, useEffect } from 'react';

const LINKEDIN_URL = 'https://www.linkedin.com/showcase/financialmodelerpro/';
const YT_CHANNEL_ID = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? '';
const YT_URL = `https://www.youtube.com/channel/${YT_CHANNEL_ID}?sub_confirmation=1`;

const linkBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 18px', fontSize: 13, fontWeight: 600,
  borderRadius: 6, textDecoration: 'none', color: '#fff',
};

function FollowButtons({ compact }: { compact?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: compact ? 'flex-start' : 'center' }}>
      <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer"
        style={{ ...linkBtnStyle, background: '#0077b5', padding: compact ? '6px 12px' : '8px 18px', fontSize: compact ? 11 : 13 }}>
        LinkedIn
      </a>
      {YT_CHANNEL_ID && (
        <a href={YT_URL} target="_blank" rel="noopener noreferrer"
          style={{ ...linkBtnStyle, background: '#FF0000', padding: compact ? '6px 12px' : '8px 18px', fontSize: compact ? 11 : 13 }}>
          YouTube
        </a>
      )}
    </div>
  );
}

/** Compact buttons for sidebar / footer inline use */
export function FollowButtonsInline({ compact }: { compact?: boolean }) {
  return <FollowButtons compact={compact} />;
}

/** Bottom-right toast popup - configurable heading, auto-dismiss, sessionStorage dedup */
export function FollowPopup({
  heading = 'Stay Connected',
  subtext = 'Follow us for new sessions and training content.',
  storageKey,
  delayMs = 0,
  autoDismissMs,
  show: showProp,
  onClose,
}: {
  heading?: string;
  subtext?: string;
  storageKey?: string;
  delayMs?: number;
  autoDismissMs?: number;
  show?: boolean;
  onClose?: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // If controlled externally
    if (showProp !== undefined) {
      setVisible(showProp);
      return;
    }

    // Check sessionStorage dedup
    if (storageKey && typeof sessionStorage !== 'undefined' && sessionStorage.getItem(storageKey)) return;

    const timer = setTimeout(() => {
      setVisible(true);
      if (storageKey && typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(storageKey, '1');
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [showProp, storageKey, delayMs]);

  useEffect(() => {
    if (!visible || !autoDismissMs) return;
    const t = setTimeout(() => { setVisible(false); onClose?.(); }, autoDismissMs);
    return () => clearTimeout(t);
  }, [visible, autoDismissMs, onClose]);

  function close() {
    setVisible(false);
    onClose?.();
  }

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 300,
      background: '#fff', borderRadius: 14, padding: '20px 24px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.15)', maxWidth: 340,
      border: '1px solid #e5e7eb',
    }}>
      <button onClick={close}
        style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9ca3af' }}>
        ×
      </button>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 6 }}>{heading}</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14, lineHeight: 1.5 }}>{subtext}</div>
      <FollowButtons />
    </div>
  );
}
