'use client';

/**
 * Universal ShareModal for Training Hub.
 *
 * Backed by the shareTo() utility in src/lib/training/share.ts — do not
 * implement custom share logic inside the modal. Any new share dialog in
 * Training Hub should use this component.
 *
 * Contract:
 *   - The share preview shows the COMPLETE post exactly as it will land
 *     on the clipboard — admin-configured body + hashtags merged inline,
 *     `{@brand}` / `{@founder}` already resolved by renderShareTemplate.
 *   - The preview is READ-ONLY on the student side. Students cannot edit
 *     the message, the hashtags, or reorder anything — the admin's
 *     template is the single source of truth for what goes out. (Admin
 *     tooling that needs editing — e.g. the Share Templates editor —
 *     doesn't use this modal.)
 *   - Clicking any platform button copies the full text to the clipboard
 *     and opens the platform compose window so the student can paste.
 *   - LinkedIn in particular requires paste (its share-offsite endpoint
 *     silently drops pre-filled text when the user isn't logged in); the
 *     copy-first pattern makes every platform reliable.
 */

import { useMemo, useState } from 'react';
import { shareTo, FMP_HASHTAGS, FMP_TRAINING_URL, type SharePlatform } from '@/src/shared/share/share';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Modal title shown in the header. Defaults to "Share Your Achievement". */
  title?: string;
  /** Share body (admin template text with placeholders already resolved). */
  text: string;
  /** URL shared alongside the text. Defaults to the Training Hub landing page. */
  url?: string;
  /** Hashtags to append inside the visible post. Pass [] to disable. */
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

/** Normalize a raw hashtag — strip leading `#` if the admin typed one. */
function cleanTag(h: string): string {
  return h.replace(/^#+/, '').trim();
}

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
  const [copiedPlatform, setCopiedPlatform] = useState<SharePlatform | null>(null);

  // Normalized + deduped hashtags, then the full merged post text. Memoed
  // so the display textarea and the shareTo() payload refer to the same
  // exact string — what the student sees is byte-identical to what lands
  // on their clipboard.
  const cleanedHashtags = useMemo(
    () => Array.from(new Set(hashtags.map(cleanTag).filter(Boolean))),
    [hashtags],
  );

  const fullText = useMemo(() => {
    if (!cleanedHashtags.length) return text;
    const tagLine = cleanedHashtags.map(h => `#${h}`).join(' ');
    return `${text}\n\n${tagLine}`;
  }, [text, cleanedHashtags]);

  if (!isOpen) return null;

  const handleShare = async (platform: SharePlatform) => {
    // `fullText` already has hashtags baked in — pass an empty array so
    // shareTo's buildFullText doesn't double-append.
    await shareTo(platform, {
      text: fullText,
      url,
      hashtags: [],
      onCopied: () => {
        setCopiedPlatform(platform);
        setTimeout(() => setCopiedPlatform(null), 1800);
      },
    });
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

        {/* Read-only post preview.
            Body + hashtags are rendered inline as a single block — this is
            EXACTLY what lands on the clipboard when the student clicks any
            platform. Locked: the admin's template is the single source of
            truth, so there's no way for the student to strip hashtags,
            drop mentions, or edit the brand copy before posting. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 6,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            Share Preview
          </span>
          <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 500 }}>
            🔒 read-only
          </span>
        </div>
        <textarea
          readOnly
          value={fullText}
          rows={8}
          onFocus={e => e.currentTarget.select()}
          style={{
            width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB',
            borderRadius: 8, fontSize: 12, fontFamily: 'Inter, sans-serif',
            resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
            marginBottom: 10, color: '#374151', background: '#F9FAFB',
            cursor: 'text',
          }}
        />

        {/* Tip */}
        <div style={{
          fontSize: 12, color: '#6B7280', background: '#F0F9FF', border: '1px solid #BAE6FD',
          borderRadius: 8, padding: '8px 12px', marginBottom: 14, lineHeight: 1.5,
        }}>
          💡 Click any platform and the full message (including hashtags) is auto-copied to your clipboard — paste (Ctrl/Cmd+V) into the compose window.
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
