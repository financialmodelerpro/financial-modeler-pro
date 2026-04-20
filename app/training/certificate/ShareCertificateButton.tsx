'use client';

/**
 * Client button for the public /training/certificate page.
 *
 * Replaces the old hardcoded `<a href="linkedin.com/sharing/share-offsite">`
 * link with a template-driven ShareModal — every share entry point across
 * the platform resolves its copy through the `share_templates` table, this
 * one included. Admins edit text / hashtags / @-mentions once and changes
 * flow through here automatically.
 */

import { useState } from 'react';
import { ShareModal } from '@/src/components/training/share/ShareModal';
import { useShareTemplate } from '@/src/lib/training/useShareTemplate';
import { renderShareTemplate, formatShareDate } from '@/src/lib/training/shareTemplates';

interface Props {
  certId:      string;
  studentName: string;
  course:      string;   // full display title
  issuedAt:    string;
  verifyUrl:   string;
}

export function ShareCertificateButton({ certId, studentName, course, issuedAt, verifyUrl }: Props) {
  const [open, setOpen] = useState(false);
  const template = useShareTemplate('certificate_earned');
  const rendered = renderShareTemplate(template, {
    studentName,
    course,
    grade:    'Pass',             // legacy sheet-backed cert has no grade field
    date:     formatShareDate(issuedAt),
    certId,
    verifyUrl,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '11px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: '#0A66C2', color: '#fff', border: 'none', cursor: 'pointer',
        }}
      >
        🔗 Share Certificate →
      </button>
      <ShareModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="🎉 Share Your Certificate"
        text={rendered.text}
        url={verifyUrl}
        hashtags={rendered.hashtags}
        cardImageUrl={certId ? `/api/og/certificate/${certId}` : undefined}
        cardDownloadName={certId ? `FMP-Certificate-${certId}.png` : undefined}
      />
    </>
  );
}
