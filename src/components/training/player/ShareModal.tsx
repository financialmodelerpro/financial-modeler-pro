'use client';

import { useState } from 'react';

interface ShareModalProps {
  sessionTitle: string;
  sessionDescription?: string;
  sessionUrl: string;
  onClose: () => void;
}

export function ShareModal({ sessionTitle, sessionDescription, sessionUrl, onClose }: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(sessionUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

        <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#374151', wordBreak: 'break-all', border: '1px solid #E5E7EB' }}>
          {sessionUrl}
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
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(sessionUrl)}`}
            target="_blank" rel="noopener noreferrer"
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: '#0A66C2', color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'none', width: '100%', boxSizing: 'border-box' }}
          >
            LinkedIn
          </a>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(sessionTitle + ' - ' + sessionUrl)}`}
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
