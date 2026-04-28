'use client';

/**
 * Dashboard share modal.
 *
 * Template-driven forwarder around the universal ShareModal. Callers pass a
 * `templateKey` (matching a row in `share_templates`) plus the `vars` needed
 * to substitute placeholders — text, hashtags, and @-mentions all resolve
 * through the same pipeline every other share button uses. Editing copy at
 * /admin/training-hub/share-templates changes what this modal shows too.
 *
 * Prior versions of this file built a hardcoded string and ignored the
 * template system entirely — that bypass is gone.
 */

import { ShareModal as UniversalShareModal } from '@/src/shared/share/components/ShareModal';
import { FMP_TRAINING_URL } from '@/src/shared/share/share';
import { useShareTemplate } from '@/src/shared/share/useShareTemplate';
import { renderShareTemplate, type ShareVars } from '@/src/shared/share/shareTemplates';

interface ShareModalProps {
  /** share_templates.template_key — e.g. `achievement_card`, `certificate_earned`. */
  templateKey: string;
  /** Variables substituted into the template body (studentName, course, etc.). */
  vars: ShareVars;
  title?: string;
  /** URL shared alongside the text. Defaults to the Training Hub landing page. */
  url?: string;
  /** Optional achievement / certificate card preview image. */
  cardImageUrl?: string;
  cardDownloadName?: string;
  onClose: () => void;
  /** Fired when the clipboard copy completes (used by the dashboard toast). */
  onCopyDone?: () => void;
}

export function ShareModal({ templateKey, vars, title, url, cardImageUrl, cardDownloadName, onClose, onCopyDone }: ShareModalProps) {
  const template = useShareTemplate(templateKey);
  const rendered = renderShareTemplate(template, vars);

  return (
    <UniversalShareModal
      isOpen
      onClose={() => { onCopyDone?.(); onClose(); }}
      title={title || '🎉 Share Your Achievement'}
      text={rendered.text}
      url={url || FMP_TRAINING_URL}
      hashtags={rendered.hashtags}
      cardImageUrl={cardImageUrl}
      cardDownloadName={cardDownloadName}
    />
  );
}
