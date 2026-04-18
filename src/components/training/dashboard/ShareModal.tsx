'use client';

/**
 * Dashboard share modal.
 *
 * Thin forwarder around the universal ShareModal. Prop shape kept stable so
 * existing callers (dashboard banner, SessionCard) don't need to change.
 * New code should import `ShareModal` directly from
 * '@/src/components/training/share/ShareModal' and use the universal API.
 */

import { ShareModal as UniversalShareModal } from '@/src/components/training/share/ShareModal';
import { FMP_TRAINING_URL } from '@/src/lib/training/share';

interface ShareModalProps {
  label: string;
  certUrl?: string;
  cmsTitle?: string;
  cmsMessageTemplate?: string;
  onClose: () => void;
  onCopyDone: () => void;
}

export function ShareModal({ label, certUrl, cmsTitle, cmsMessageTemplate, onClose, onCopyDone }: ShareModalProps) {
  const trainingUrl = FMP_TRAINING_URL;
  const shareUrl    = certUrl || trainingUrl;
  const defaultMsg  = `I just ${label} at Financial Modeler Pro!\n\nBuilding institutional-grade financial models - Free certification program: ${trainingUrl}${certUrl ? `\n\nVerify certificate: ${certUrl}` : ''}`;
  const initialText = cmsMessageTemplate
    ? cmsMessageTemplate.replace('{action}', label) + (certUrl ? `\n\nVerify certificate: ${certUrl}` : '')
    : defaultMsg;

  return (
    <UniversalShareModal
      isOpen
      onClose={() => { onCopyDone(); onClose(); }}
      title={cmsTitle || '🎉 Share Your Achievement'}
      text={initialText}
      url={shareUrl}
    />
  );
}
