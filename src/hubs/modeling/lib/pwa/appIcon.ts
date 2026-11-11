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

/**
 * A coloured TILE (2026-11-11, the Training Hub app: the same mark on a green
 * tile, so the two apps are told apart on a home screen). With a tile every
 * icon is full-bleed in that colour, the mark a little smaller for 'any' and
 * 'apple' so it sits inside the tile rather than touching its edges.
 */
export interface IconTile { r: number; g: number; b: number }
/** The Training Hub app's tile (deep green, chosen 2026-11-11 so the shield's silver rim and green arrow stay distinct). */
export const TRAINING_ICON_TILE: IconTile = { r: 0x1B, g: 0x5E, b: 0x20 };
/** An icon file name with this prefix is the Training Hub's version of the same file. */
export const TRAINING_ICON_PREFIX = 'training-';
const TILE_SHARE: Record<'any' | 'maskable' | 'apple', number> = { any: 0.74, maskable: 0.56, apple: 0.74 };

export async function renderAppIcon(source: Buffer, file: AppIconFile, tile?: IconTile): Promise<Buffer> {
  const { size, purpose } = APP_ICON_FILES[file];
  const inner = Math.round(size * (tile ? TILE_SHARE : SHARE)[purpose]);
  const mark = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const background = tile
    ? { ...tile, alpha: 1 }
    : purpose === 'any'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 };
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
}
