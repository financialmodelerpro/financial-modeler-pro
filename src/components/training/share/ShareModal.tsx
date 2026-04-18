'use client';

/**
 * Universal ShareModal for Training Hub.
 *
 * Backed by the shareTo() utility in src/lib/training/share.ts — do not
 * implement custom share logic inside the modal. Any new share dialog in
 * Training Hub should use this component.
 *
 * Behaviour:
 *   - Renders a read-only text preview that the user can still edit before
 *     sharing. Edits are reflected in the final shared/copied payload.
 *   - Each platform button calls shareTo() which auto-copies the final text
 *     to the clipboard first (LinkedIn needs paste, others pre-fill).
 *   - The "Text copied" state toggles for ~1.5s after any share click.
 *   - Optional cardImageUrl renders an achievement card preview above the
 *     textarea with a download link.
 */

import { useState, useEffect } from 'react';
import { shareTo, FMP_HASHTAGS, FMP_TRAINING_URL, type SharePlatform } from '@/src/lib/training/share';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Modal title shown in the header. Defaults to "Share Your Achievement". */
  title?: string;
  /** Initial share text (hashtags appended at share time — don't include them). */
  text: string;
  /** URL shared alongside the text. Defaults to the Training Hub landing page. */
  url?: string;
  /** Hashtags to append. Defaults to the FMP set. Pass [] to disable. */
  hashtags?: string[];
  /** Platforms to offer. Defaults to all four. */
  platforms?: SharePlatform[];
  /** Optional achievement card image to preview + offer as a download. */
  cardImageUrl?: string;
  /** Filename for the downloaded card image. */
  cardDownloadName?: string;
}

const DEFAULT_PLATFORMS: SharePlatform[] = ['linkedin', 'whatsapp', 'twitter', 'copy'];

const PLATFORM_META: Record<SharePlatform, { label: string; icon: string; bg: string; color: string }> = {
  linkedin: { label: 'LinkedIn', icon: '💼', bg: '#0A66C2', color: '#fff' },
  whatsapp: { label: 'WhatsApp', icon: '💬', bg: '#25D366', color: '#fff' },
  twitter:  { label: 'X / Twitter', icon: '𝕏', bg: '#000',    color: '#fff' },
  copy:     { label: 'Copy Text',   icon: '🔗', bg: '#F3F4F6', color: '#374151' },
};

export function ShareModal({
  isOpen,
  onClose,
  title = '🎉 Share Your Achievement',
  text,
  url = FMP_TRAINING_URL,
  hashtags = [...FMP_HASHTAGS],
  platforms = DEFAULT_PLATFORMS,
  cardImageUrl,
  cardDownloadName = 'FMP-Achievement.png',
}: ShareModalProps) {
  const [draft, setDraft] = useState(text);
  const [copiedPlatform, setCopiedPlatform] = useState<SharePlatform | null>(null);

  // Re-seed draft when the caller rotates in a new `text` prop (e.g. opening
  // the same modal for a different session).
  useEffect(() => { setDraft(text); }, [text]);

  if (!isOpen) return null;

  const handleShare = async (platform: SharePlatform) => {
    await shareTo(platform, {
      text: draft,
      url,
      hashtags,
      onCopied: () => {
        setCopiedPlatform(platform);
        setTimeout(() => setCopiedPlatform(null), 1800);
      },
    });
    if (platform === 'copy') {
      // Keep the modal open so the user sees the copied state. Other platforms
      // opened a new tab; leave the modal in place too in case they want to
      // share to another platform as well.
    }
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
          maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px 24px 20px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280', lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* Optional card preview */}
        {cardImageUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardImageUrl}
              alt="Achievement card"
              style={{ width: '100%', borderRadius: 8, border: '1px solid #E5E7EB', marginBottom: 12, display: 'block' }}
            />
            <a
              href={cardImageUrl}
              download={cardDownloadName}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '10px 14px', background: '#1F3864', color: '#fff',
                borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                marginBottom: 12,
              }}
            >
              ⬇️ Download Card
            </a>
          </>
        )}

        {/* Editable text preview */}
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={6}
          style={{
            width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB',
            borderRadius: 8, fontSize: 12, fontFamily: 'Inter, sans-serif',
            resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
            marginBottom: 10, color: '#374151', background: '#F9FAFB',
          }}
        />

        {/* Tip */}
        <div style={{
          fontSize: 12, color: '#6B7280', background: '#F0F9FF', border: '1px solid #BAE6FD',
          borderRadius: 8, padding: '8px 12px', marginBottom: 14, lineHeight: 1.5,
        }}>
          💡 Your text is auto-copied when you click any platform — just paste it (Ctrl/Cmd+V) in the compose window.
        </div>

        {/* Platform buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: platforms.length > 2 ? '1fr 1fr' : '1fr', gap: 8 }}>
          {platforms.map(p => {
            const meta = PLATFORM_META[p];
            const isCopied = copiedPlatform === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => handleShare(p)}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 8, border: 'none',
                  background: isCopied ? '#F0FDF4' : meta.bg,
                  color:      isCopied ? '#16A34A' : meta.color,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  boxShadow: isCopied ? 'inset 0 0 0 1px #86EFAC' : 'none',
                  transition: 'background 0.2s, color 0.2s',
                }}
              >
                {isCopied ? '✓ Copied!' : `${meta.icon} ${meta.label}`}
              </button>
            );
          })}
        </div>

        {/* Close row */}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%', padding: '9px', marginTop: 12, background: '#F9FAFB',
            border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13,
            color: '#6B7280', cursor: 'pointer', fontWeight: 600,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
