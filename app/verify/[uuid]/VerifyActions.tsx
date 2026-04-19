'use client';

import { useState } from 'react';
import { shareTo, FMP_HASHTAGS } from '@/src/lib/training/share';

interface Props {
  certId: string;
  fullName: string;
  course: string;
  grade: string;
  issuedLabel: string;
  verifyUrl: string;
  certPdfUrl?: string | null;
  badgeUrl?: string | null;
}

/**
 * Action row for the verify page: downloads + LinkedIn share.
 * Uses the universal `shareTo` helper so the copy-to-clipboard → open-
 * LinkedIn flow matches the Achievement Card pattern everywhere else in
 * the Training Hub.
 */
export function VerifyActions({ certId, fullName, course, grade, issuedLabel, verifyUrl, certPdfUrl, badgeUrl }: Props) {
  const [copied, setCopied] = useState(false);

  const shareText = `I just earned my ${course} Certification from Financial Modeler Pro!

✅ Grade: ${grade || 'Pass'}
📅 Issued: ${issuedLabel}
🎯 Certificate ID: ${certId}

Verify the credential →
${verifyUrl}

Huge thanks to Ahmad Din and the Financial Modeler Pro team for structured, practitioner-led training in real-world financial modeling.`;

  async function handleShare() {
    await shareTo('linkedin', {
      text: shareText,
      url: verifyUrl,
      hashtags: [...FMP_HASHTAGS],
      onCopied: () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 200, position: 'relative' }}>
      {certPdfUrl && (
        <a href={certPdfUrl} target="_blank" rel="noopener noreferrer"
           style={btn('#0D2E5A', '#fff')}>
          ⬇ Download Certificate PDF
        </a>
      )}
      {badgeUrl && (
        <a href={badgeUrl} target="_blank" rel="noopener noreferrer"
           style={btn('#C9A84C', '#fff')}>
          🎖 Download Badge
        </a>
      )}
      {/* Transcript — cached endpoint redirects to stored URL or generates on first click. */}
      <a href={`/api/training/transcript-cached/${certId}`} target="_blank" rel="noopener noreferrer"
         style={btn('#1B4F8A', '#fff')}>
        📄 Download Transcript
      </a>
      <button onClick={handleShare} style={{ ...btn('#0A66C2', '#fff'), border: 'none', cursor: 'pointer' }}>
        🔗 Share on LinkedIn {copied && <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.85 }}>(copied!)</span>}
      </button>

      {copied && (
        <div
          role="status"
          style={{
            position: 'absolute', top: -38, left: '50%', transform: 'translateX(-50%)',
            padding: '7px 14px', background: '#166534', color: '#fff',
            borderRadius: 8, fontSize: 12, fontWeight: 700,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px rgba(22,101,52,0.35)',
          }}
        >
          ✓ Copied — paste it in LinkedIn
        </div>
      )}
    </div>
  );
}

function btn(bg: string, color: string): React.CSSProperties {
  return {
    display: 'block', padding: '10px 18px', borderRadius: 8,
    background: bg, color, textDecoration: 'none',
    fontSize: 13, fontWeight: 600, textAlign: 'center',
  };
}
