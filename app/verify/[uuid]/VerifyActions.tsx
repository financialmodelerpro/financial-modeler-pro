'use client';

import { useState } from 'react';
import { ShareModal } from '@/src/components/training/share/ShareModal';
import { useShareTemplate } from '@/src/lib/training/useShareTemplate';
import { renderShareTemplate } from '@/src/lib/training/shareTemplates';

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
 * Action row for the verify page: downloads + share. Share text is pulled
 * from the centralized `certificate_earned` template so admins can edit
 * copy / @-mentions / hashtags from /admin/training-hub/share-templates
 * and every share button across the platform reflects the change.
 */
export function VerifyActions({ certId, fullName, course, grade, issuedLabel, verifyUrl, certPdfUrl, badgeUrl }: Props) {
  const [showShare, setShowShare] = useState(false);

  const template = useShareTemplate('certificate_earned');
  const { text: shareText, hashtags } = renderShareTemplate(template, {
    studentName: fullName,
    course,
    grade: grade || 'Pass',
    date: issuedLabel,
    certId,
    verifyUrl,
  });

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
      <button onClick={() => setShowShare(true)}
        style={{ ...btn('#0A66C2', '#fff'), border: 'none', cursor: 'pointer' }}>
        🔗 Share Certificate
      </button>

      <ShareModal
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        title="🎉 Share Your Certificate"
        text={shareText}
        url={verifyUrl}
        hashtags={hashtags}
        cardImageUrl={`/api/og/certificate/${certId}`}
        cardDownloadName={`FMP-Certificate-${certId}.png`}
      />
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
