/**
 * generate-pwa-icons.ts (2026-09-24)
 *
 * Draws the Modeling Hub's installable-app icons from ONE vector mark, so the
 * sizes cannot drift from each other. The mark is SHAPES ONLY (three rising
 * bars on the brand navy), never text: text in an SVG rasterises with whatever
 * font the machine has, so a glyph icon would differ between machines.
 *
 * Writes public/pwa/:
 *   icon-192.png, icon-512.png          "any" purpose (the mark fills the tile)
 *   icon-maskable-512.png               "maskable" (the mark inside the 80%
 *                                       safe zone, full-bleed background, so a
 *                                       launcher's circle or squircle crop
 *                                       never cuts the bars)
 *   apple-touch-icon.png (180)          iOS home screen (opaque, no rounding:
 *                                       iOS rounds it itself)
 *
 * Run: npx tsx scripts/generate-pwa-icons.ts
 *
 * No em dashes in this file.
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const NAVY = '#1B3A6B';      // --color-navy-dark in app/globals.css
const ACCENT = '#FFFFFF';

/** The mark on a 100 x 100 grid. `inset` shrinks it toward the centre. */
function markSvg(size: number, opts: { rounded: boolean; inset: number }): string {
  const s = 100;
  const k = 1 - opts.inset * 2;                 // scale of the mark
  const o = opts.inset * s;                     // offset of the mark
  const bar = (x: number, h: number): string =>
    `<rect x="${o + x * k}" y="${o + (78 - h) * k}" width="${14 * k}" height="${h * k}" rx="${2.5 * k}" fill="${ACCENT}"/>`;
  const radius = opts.rounded ? 22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${radius}" fill="${NAVY}"/>
  ${bar(22, 26)}${bar(43, 40)}${bar(64, 56)}
  <rect x="${o + 18 * k}" y="${o + 81 * k}" width="${64 * k}" height="${3.5 * k}" rx="${1.75 * k}" fill="${ACCENT}" opacity="0.85"/>
</svg>`;
}

async function png(file: string, size: number, opts: { rounded: boolean; inset: number }): Promise<void> {
  await sharp(Buffer.from(markSvg(size, opts))).resize(size, size).png().toFile(file);
  console.log(`  wrote ${file} (${size}x${size})`);
}

(async () => {
  const dir = 'public/pwa';
  mkdirSync(dir, { recursive: true });
  await png(`${dir}/icon-192.png`, 192, { rounded: true, inset: 0 });
  await png(`${dir}/icon-512.png`, 512, { rounded: true, inset: 0 });
  await png(`${dir}/icon-maskable-512.png`, 512, { rounded: false, inset: 0.1 });
  await png(`${dir}/apple-touch-icon.png`, 180, { rounded: false, inset: 0 });
})();
