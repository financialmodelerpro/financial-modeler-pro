'use client';

/**
 * Watch-page share modal.
 *
 * Thin forwarder around the universal ShareModal. Prop shape kept stable so
 * existing callers (CourseTopBar) don't need to change. New code should
 * import `ShareModal` directly from
 * '@/src/components/training/share/ShareModal'.
 */

import { ShareModal as UniversalShareModal } from '@/src/components/training/share/ShareModal';

interface ShareModalProps {
  sessionTitle: string;
  sessionDescription?: string;
  sessionUrl: string;
  onClose: () => void;
}

export function ShareModal({ sessionTitle, sessionUrl, onClose }: ShareModalProps) {
  const shareText = `I'm learning ${sessionTitle} on Financial Modeler Pro — a 100% free professional certification program.\n\nStart your free certification: ${sessionUrl}`;

  return (
    <UniversalShareModal
      isOpen
      onClose={onClose}
      title="Share this session"
      text={shareText}
      url={sessionUrl}
    />
  );
}
