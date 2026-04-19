'use client';

/**
 * Watch-page share modal.
 *
 * Thin forwarder around the universal ShareModal. Prop shape kept stable so
 * existing callers (CourseTopBar) don't need to change. Share text resolves
 * through the centralized `session_shared` template — admins edit it at
 * /admin/training-hub/share-templates.
 */

import { ShareModal as UniversalShareModal } from '@/src/components/training/share/ShareModal';
import { useShareTemplate } from '@/src/lib/training/useShareTemplate';
import { renderShareTemplate } from '@/src/lib/training/shareTemplates';

interface ShareModalProps {
  sessionTitle: string;
  sessionDescription?: string;
  sessionUrl: string;
  onClose: () => void;
}

export function ShareModal({ sessionTitle, sessionDescription, sessionUrl, onClose }: ShareModalProps) {
  const template = useShareTemplate('session_shared');
  const rendered = renderShareTemplate(template, {
    sessionName:        sessionTitle,
    sessionDescription: sessionDescription ?? '',
    sessionUrl,
  });

  return (
    <UniversalShareModal
      isOpen
      onClose={onClose}
      title="Share this session"
      text={rendered.text}
      url={sessionUrl}
      hashtags={rendered.hashtags}
    />
  );
}
