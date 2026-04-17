'use client';

import { useState } from 'react';
import { SubscribeModal } from './SubscribeModal';

interface EngagementBarProps {
  youtubeUrl: string;
  channelId?: string;
  showLike?: boolean;
  sessionTitle?: string;
  sessionDescription?: string;
}

export function EngagementBar({ youtubeUrl, channelId, showLike = true, sessionTitle, sessionDescription }: EngagementBarProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);

  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

  function copyLink() {
    navigator.clipboard.writeText(pageUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8,
    background: '#F3F4F6', color: '#374151',
    border: '1px solid #E5E7EB',
    fontSize: 13, fontWeight: 600,
    textDecoration: 'none', cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {/* Subscribe - opens modal with YouTube widget */}
        {channelId && (
          <button
            onClick={() => setShowSubscribeModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: 600,
              color: '#ffffff',
              background: '#FF0000',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#cc0000')}
            onMouseLeave={e => (e.currentTarget.style.background = '#FF0000')}
          >
            🔔 Subscribe
          </button>
        )}

        {/* Like */}
        {showLike && (
          <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" style={btn}>
            👍 Like
          </a>
        )}

        {/* Ask a Question */}
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={btn}
          title="Have a question or query? Ask it on YouTube - get a quick answer from our team"
        >
          💬 Ask a Question
        </a>

        {/* Share */}
        <button onClick={() => setShareOpen(true)} style={btn}>
          📤 Share
        </button>
      </div>

      {/* Share Modal */}
      {shareOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShareOpen(false); }}
        >
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0D2E5A', margin: 0 }}>Share this session</h3>
              <button onClick={() => setShareOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280', padding: 4 }}>✕</button>
            </div>

            {sessionTitle && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 4 }}>{sessionTitle}</div>
                {sessionDescription && (
                  <div style={{
                    fontSize: 13, color: '#6B7280', lineHeight: 1.5,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
                  }}>
                    {sessionDescription}
                  </div>
                )}
              </div>
            )}

            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#374151', wordBreak: 'break-all', border: '1px solid #E5E7EB' }}>
              {pageUrl}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={copyLink} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10,
                background: copied ? '#DCFCE7' : '#F3F4F6', border: `1px solid ${copied ? '#86EFAC' : '#E5E7EB'}`,
                cursor: 'pointer', fontSize: 14, fontWeight: 600, color: copied ? '#166534' : '#374151', width: '100%',
              }}>
                {copied ? '✓ Link Copied!' : '🔗 Copy Link'}
              </button>

              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`}
                target="_blank" rel="noopener noreferrer"
                onClick={() => setShareOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: '#0A66C2', color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'none', width: '100%', boxSizing: 'border-box' }}
              >
                LinkedIn
              </a>

              <a
                href={`https://wa.me/?text=${encodeURIComponent((sessionTitle || 'Training Session') + ' - ' + pageUrl)}`}
                target="_blank" rel="noopener noreferrer"
                onClick={() => setShareOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: '#25D366', color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'none', width: '100%', boxSizing: 'border-box' }}
              >
                WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Subscribe Modal */}
      {showSubscribeModal && channelId && (
        <SubscribeModal
          channelId={channelId}
          onClose={() => setShowSubscribeModal(false)}
        />
      )}
    </>
  );
}
