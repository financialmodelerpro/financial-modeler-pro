/**
 * appIcon.ts (2026-09-26)
 *
 * Draws one installed-app icon from the site favicon. Server only (sharp).
 *
 *   any:      the favicon, centred on a transparent tile with a small margin,
 *             so it looks exactly like the browser tab's icon.
 *   maskable: a full-bleed white tile with the favicon inside the central 56%,
 *             the largest square the 80% safe-zone circle holds (0.8 / sqrt 2),
 *             so whatever shape the favicon is, a launcher's circle or squircle
 *             crop never cuts the mark.
 *   apple:    opaque white (iOS draws transparency as black), favicon at 80%;
 *             iOS rounds the corners itself.
 *
 * No em dashes in this file.
 */
import sharp from 'sharp';
import { APP_ICON_FILES, type AppIconFile } from './appManifest';

const SHARE: Record<'any' | 'maskable' | 'apple', number> = { any: 0.9, maskable: 0.56, apple: 0.8 };

export async function renderAppIcon(source: Buffer, file: AppIconFile): Promise<Buffer> {
  const { size, purpose } = APP_ICON_FILES[file];
  const inner = Math.round(size * SHARE[purpose]);
  const mark = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const background = purpose === 'any'
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 };
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
}
