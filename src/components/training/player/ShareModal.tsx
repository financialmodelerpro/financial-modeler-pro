'use client';

import { useState, useRef } from 'react';

interface ShareModalProps {
  sessionTitle: string;
  sessionDescription?: string;
  sessionUrl: string;
  onClose: () => void;
}

export function ShareModal({ sessionTitle, sessionDescription, sessionUrl, onClose }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [linkedInCopied, setLinkedInCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const shareText = `I'm learning ${sessionTitle} on Financial Modeler Pro - a 100% free professional certification program.\n\nStart your free certification: ${sessionUrl}`;

  function copyLink() {
    navigator.clipboard.writeText(sessionUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleLinkedIn() {
    navigator.clipboard.writeText(shareText).then(() => {
      setLinkedInCopied(true);
      setTimeout(() => { setLinkedInCopied(false); onClose(); }, 1500);
      window.open('https://www.linkedin.com/feed/?shareActive=true', '_blank', 'noopener,noreferrer');
    });
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0D2E5A', margin: 0 }}>Share this session</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280', padding: 4 }}>✕</button>
        </div>

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

        {/* Share text preview */}
        <textarea
          ref={textRef}
          readOnly
          value={shareText}
          style={{
            width: '100%', minHeight: 80, padding: '10px 14px', borderRadius: 8,
            background: '#F9FAFB', border: '1px solid #E5E7EB', fontSize: 12,
            color: '#374151', lineHeight: 1.5, resize: 'none', fontFamily: 'inherit',
            boxSizing: 'border-box', marginBottom: 16,
          }}
          onFocus={e => e.target.select()}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={copyLink} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10,
            background: copied ? '#DCFCE7' : '#F3F4F6', border: `1px solid ${copied ? '#86EFAC' : '#E5E7EB'}`,
            cursor: 'pointer', fontSize: 14, fontWeight: 600, color: copied ? '#166534' : '#374151', width: '100%',
          }}>
            {copied ? '✓ Link Copied!' : '🔗 Copy Link'}
          </button>

          <button
            onClick={handleLinkedIn}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10,
              background: linkedInCopied ? '#DCFCE7' : '#0A66C2', color: linkedInCopied ? '#166534' : '#fff',
              border: linkedInCopied ? '1px solid #86EFAC' : 'none',
              fontWeight: 600, fontSize: 14, width: '100%', cursor: 'pointer', boxSizing: 'border-box',
            }}
          >
            {linkedInCopied ? '✓ Copied! Opening LinkedIn...' : '🔗 LinkedIn - copies text, opens feed'}
          </button>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank" rel="noopener noreferrer"
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: '#25D366', color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'none', width: '100%', boxSizing: 'border-box' }}
          >
            WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
