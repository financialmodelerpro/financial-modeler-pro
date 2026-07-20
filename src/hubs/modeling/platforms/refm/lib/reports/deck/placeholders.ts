/**
 * placeholders.ts (REFM Module 7, IC Presentation Builder)
 *
 * Editor-only placeholder / prompt text. The seed templates drop these into
 * empty narrative blocks so an author sees a "click to edit" hint on the
 * canvas. They are EDITOR-ONLY: placeholder text must NEVER reach the exported
 * PPTX / PDF or the read-only preview. The export contract (exportModel.ts) and
 * the preview renderer (SlideObjectView, when in preview mode) both call
 * `isPlaceholderText` to omit any block/line still holding a placeholder, so an
 * empty FORM field renders as nothing, not a bracketed prompt.
 *
 * One source of truth: `PLACEHOLDER` builds the string, `isPlaceholderText`
 * detects it, so seeding and omission can never drift.
 *
 * Pure + browser-safe. No em dashes.
 */

/** The stable editor-only marker every placeholder carries. */
const PLACEHOLDER_MARKER = 'Click to edit, or use Generate Commentary';

/** Build an editor-only placeholder line. */
export const PLACEHOLDER = (what: string): string => `[Add ${what}. ${PLACEHOLDER_MARKER}.]`;

/** True when a string is (still) an unedited editor placeholder. Editing the
 *  block replaces the text, so a real edit never matches. Precise enough that
 *  ordinary authored content cannot collide with it. */
export function isPlaceholderText(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  return t.startsWith('[Add ') && t.includes(PLACEHOLDER_MARKER);
}
