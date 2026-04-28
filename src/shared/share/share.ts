/**
 * Universal Share Utility (cross-hub)
 *
 * Usage:
 *   import { shareTo, FMP_HASHTAGS, FMP_TRAINING_URL } from '@/src/shared/share/share';
 *   import { ShareModal } from '@/src/shared/share/components/ShareModal';
 *
 *   // Direct share (button handler)
 *   shareTo('linkedin', { text: 'My achievement', url: FMP_TRAINING_URL });
 *
 *   // Modal-based share
 *   <ShareModal
 *     isOpen={showShare}
 *     onClose={() => setShowShare(false)}
 *     title="Share Your Win"
 *     text="I just passed..."
 *     hashtags={['Session10']}
 *   />
 *
 * To add share to a new feature:
 *   1. Import shareTo() for buttons or <ShareModal> for a standalone dialog.
 *   2. Build the share text string.
 *   3. Pass it along with optional url/hashtags/onCopied.
 *
 * DO NOT implement custom share logic — use this utility.
 *
 * Why the auto-copy pattern: LinkedIn's sharing endpoint ignores any
 * pre-filled text when the user isn't already logged in OR when the URL
 * hasn't been verified via LinkedIn's post-inspector. Copying the full
 * share text to the clipboard first lets the user paste it into the
 * compose box that LinkedIn opens. WhatsApp/Twitter DO support pre-fill
 * via URL params, so we pass the text there anyway.
 */

export type SharePlatform = 'linkedin' | 'whatsapp' | 'twitter' | 'copy';

export interface ShareOptions {
  /** Main share message with context (e.g. "I just passed Session 1..."). */
  text: string;
  /** Optional URL to share. Defaults to the Training Hub landing page. */
  url?: string;
  /** Optional hashtags appended to the share text (no # prefix needed). */
  hashtags?: string[];
  /** Callback fired when text is successfully copied to clipboard. */
  onCopied?: () => void;
}

/** Default hashtags for every Training Hub share. */
export const FMP_HASHTAGS = ['FinancialModeling', 'CorporateFinance', 'FinancialModelerPro'] as const;

/** Default URL for Training Hub shares. */
export const FMP_TRAINING_URL = 'https://learn.financialmodelerpro.com/training';

function buildFullText(text: string, hashtags: readonly string[]): string {
  if (!hashtags.length) return text;
  const tagLine = hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
  return `${text}\n\n${tagLine}`;
}

/**
 * Share to a platform. Always copies the full text (with hashtags) to
 * the clipboard first — LinkedIn's compose window can only reliably
 * receive content via paste, so the copy-first pattern is the stable
 * cross-platform workaround.
 */
export async function shareTo(platform: SharePlatform, options: ShareOptions): Promise<void> {
  const { text, url = FMP_TRAINING_URL, hashtags = [], onCopied } = options;
  const fullText = buildFullText(text, hashtags);

  // Copy to clipboard first — makes every platform's compose dialog usable
  // even when the platform itself drops the pre-filled text.
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(fullText);
      onCopied?.();
    } catch {
      // Clipboard failure is non-fatal; keep going and open the share window.
    }
  }

  if (typeof window === 'undefined') return;

  switch (platform) {
    case 'linkedin': {
      // Always open the plain feed composer — never `share-offsite`. The
      // share-offsite endpoint auto-attaches a link preview card, which
      // collapses any @-mentions the user's about to type back into plain
      // text. The composer approach keeps paste-to-post clean: the full
      // text (including the verify/session URL inline and hashtags) lands
      // in the clipboard for the user to paste, and LinkedIn's @ menu
      // still works when the user retypes @Financial… → @FMP.
      window.open('https://www.linkedin.com/feed/?shareActive=true', '_blank', 'noopener,noreferrer');
      break;
    }
    case 'whatsapp': {
      const target = `https://wa.me/?text=${encodeURIComponent(fullText)}`;
      window.open(target, '_blank', 'noopener,noreferrer');
      break;
    }
    case 'twitter': {
      const urlParam = url ? `&url=${encodeURIComponent(url)}` : '';
      const target = `https://twitter.com/intent/tweet?text=${encodeURIComponent(fullText)}${urlParam}`;
      window.open(target, '_blank', 'noopener,noreferrer');
      break;
    }
    case 'copy':
      // Nothing to open — the clipboard write above is the action.
      break;
  }
}

/** Resolve the text a caller should share, with hashtags merged in. Useful
 *  for previewing the exact string inside a ShareModal textarea. */
export function composeShareText(options: ShareOptions): string {
  return buildFullText(options.text, options.hashtags ?? []);
}
