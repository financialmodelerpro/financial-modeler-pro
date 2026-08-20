/**
 * drawWatermark.ts (2026-08-20)
 *
 * Stamps a resolved WatermarkSpec onto EVERY page of a finished pdf-lib
 * document. Used by the full report, the summary report and the IC deck PDF,
 * so the three surfaces cannot drift.
 *
 * WHY IT RUNS OVER THE FINISHED DOCUMENT AND NOT PER PAGE AS PAGES ARE MADE.
 * The full report adds pages from a dozen different builders and the deck adds
 * one per slide. A per-page call is a thing every future page type has to
 * remember, and the one that forgets produces a clean page in a watermarked
 * document, which is worse than no watermark at all because it looks
 * deliberate. `doc.getPages()` is the complete list by construction, so a new
 * page type is covered the day it is written and nobody has to know this file
 * exists.
 *
 * The stamp is drawn LAST, so it sits over the content rather than under it.
 * It cannot be removed by the user in the sense of the app offering a way to
 * turn it off, and the decision is made server side (see the resolver route);
 * the honest limit is recorded in the note by the call sites.
 *
 * No em dashes in this file.
 */
import { degrees, rgb, StandardFonts, type PDFDocument } from 'pdf-lib';
import type { WatermarkSpec } from '@/src/shared/entitlements/exportWatermark';

/** Pale grey. Legible as a stamp, faint enough to read figures through. */
const STAMP = rgb(0.62, 0.66, 0.72);
const STAMP_OPACITY = 0.22;
/** The footer line is darker and small: it is meant to be READ, not glanced
 *  at, so it does not share the diagonal's opacity. */
const FOOTER = rgb(0.42, 0.47, 0.55);
const FOOTER_SIZE = 7;
const FOOTER_MARGIN = 14;

/**
 * Draw the stamp on every page.
 *
 * A no-op when `spec` is null, which is the paid-plan path: a paid export must
 * be byte-identical to what it was before this existed, and the way that is
 * guaranteed is that this function touches nothing at all rather than drawing
 * something transparent.
 */
export async function applyExportWatermark(doc: PDFDocument, spec: WatermarkSpec | null): Promise<void> {
  if (!spec) return;
  const text = spec.text.trim();
  if (text === '') return;

  // A standard font, deliberately. The reports embed Inter as a CID font and
  // the deck embeds its own; reaching into either would couple this to two
  // different embedding schemes for no gain, and Helvetica-Bold is present in
  // every PDF reader without being embedded at all.
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const footerFont = await doc.embedFont(StandardFonts.Helvetica);

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();

    // SIZE THE TEXT TO THE PAGE, not to a fixed point size. These documents
    // are A4 landscape, the deck is 16:9, and a size that reads well on one
    // runs off the edge of the other. Target the diagonal at roughly 70% of
    // the page diagonal and solve for the size that gets there.
    const diagonal = Math.sqrt(width * width + height * height);
    const widthAt100 = font.widthOfTextAtSize(text, 100);
    const size = Math.max(18, Math.min(140, (diagonal * 0.7) / widthAt100 * 100));

    const textW = font.widthOfTextAtSize(text, size);
    const textH = font.heightAtSize(size);
    // Rotate about the page centre. The angle follows the page's own
    // proportions so the stamp lies along the diagonal rather than at a fixed
    // 45 degrees that would look tilted on a wide page.
    const angle = Math.atan2(height, width) * (180 / Math.PI);
    const rad = (angle * Math.PI) / 180;
    // Step back from the centre by half the text length along the rotated
    // axis, so the stamp is centred rather than starting at the middle.
    const x = width / 2 - (textW / 2) * Math.cos(rad) + (textH / 2) * Math.sin(rad);
    const y = height / 2 - (textW / 2) * Math.sin(rad) - (textH / 2) * Math.cos(rad);

    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: STAMP,
      opacity: STAMP_OPACITY,
      rotate: degrees(angle),
    });

    // The footer sentence, centred at the very bottom. It is drawn at full
    // opacity: a reader handed this file with no context needs to be able to
    // read WHY it is marked, and a faint sentence is a sentence nobody reads.
    const fw = footerFont.widthOfTextAtSize(spec.footer, FOOTER_SIZE);
    page.drawText(spec.footer, {
      x: Math.max(4, (width - fw) / 2),
      y: FOOTER_MARGIN / 2,
      size: FOOTER_SIZE,
      font: footerFont,
      color: FOOTER,
    });
  }
}
