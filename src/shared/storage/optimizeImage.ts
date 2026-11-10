/**
 * Uploaded images, compressed (2026-11-10). Server only (sharp).
 *
 * The founder photo was a 2.6 MB PNG and every session image about 960 KB,
 * shown in boxes a few hundred pixels wide. Every image upload now goes
 * through `storeImage`:
 *
 *   - the ORIGINAL is kept, untouched, at `originals/<path>`;
 *   - the SERVED copy is WebP, resized to the display width at 2x (never
 *     enlarged, never cropped, aspect kept), quality stepped down until it is
 *     about 250 KB or less (and the width eased down only if quality alone
 *     cannot get there).
 *
 * Left as uploaded: SVG, GIF (may be animated), ICO, anything sharp cannot
 * read, and an image already small enough in a web format.
 */
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';

export const TARGET_MAX_BYTES = 250 * 1024;
const SKIP_TYPES = new Set(['image/svg+xml', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']);
const WEB_TYPES = new Set(['image/jpeg', 'image/webp']);

export interface OptimizedImage { buffer: Buffer; contentType: string; ext: string; optimized: boolean; width: number | null; bytesBefore: number }

/**
 * Compress one image for the web. `maxWidth` is the largest width it is shown
 * at, times 2 for high-density screens.
 */
export async function optimizeImage(input: Buffer, contentType: string, opts: { maxWidth: number }): Promise<OptimizedImage> {
  const keep = (): OptimizedImage => ({ buffer: input, contentType, ext: extFor(contentType), optimized: false, width: null, bytesBefore: input.length });
  if (SKIP_TYPES.has(contentType) || !contentType.startsWith('image/')) return keep();
  let meta: sharp.Metadata;
  try { meta = await sharp(input).metadata(); } catch { return keep(); }
  if (!meta.width) return keep();
  if (input.length <= TARGET_MAX_BYTES && WEB_TYPES.has(contentType) && meta.width <= opts.maxWidth) return keep();

  let width = Math.min(meta.width, opts.maxWidth);
  let best: Buffer | null = null;
  for (let pass = 0; pass < 4; pass++) {
    for (const quality of [82, 74, 66, 58]) {
      const out = await sharp(input).rotate().resize({ width, withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer();
      if (!best || out.length < best.length) best = out;
      if (out.length <= TARGET_MAX_BYTES) return done(out, width);
    }
    width = Math.round(width * 0.85); // quality alone was not enough: ease the width down
  }
  // Never serve something larger than what was uploaded.
  return best && best.length < input.length ? done(best, width) : keep();

  function done(buf: Buffer, w: number): OptimizedImage {
    return { buffer: buf, contentType: 'image/webp', ext: 'webp', optimized: true, width: w, bytesBefore: input.length };
  }
}

function extFor(contentType: string): string {
  return contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : contentType === 'image/gif' ? 'gif'
    : contentType === 'image/svg+xml' ? 'svg' : contentType.includes('icon') ? 'ico' : 'jpg';
}

/** `dir/name.png` -> `dir/name.webp`. */
export function withExt(path: string, ext: string): string {
  return /\.[a-z0-9]+$/i.test(path) ? path.replace(/\.[a-z0-9]+$/i, `.${ext}`) : `${path}.${ext}`;
}

/**
 * Store an uploaded image: the original at `originals/<path>`, the compressed
 * copy at `<path>` with its own extension. Returns the served path. An image
 * left as uploaded is stored once, at `<path>`.
 */
export async function storeImage(
  sb: SupabaseClient,
  p: { bucket: string; path: string; buffer: Buffer; contentType: string; maxWidth: number; cacheControl?: string; upsert?: boolean },
): Promise<{ path: string; optimized: boolean; bytes: number; bytesBefore: number; error: string | null }> {
  const img = await optimizeImage(p.buffer, p.contentType, { maxWidth: p.maxWidth });
  const store = sb.storage.from(p.bucket);
  if (img.optimized) {
    const { error: oErr } = await store.upload(`originals/${p.path}`, p.buffer, { contentType: p.contentType, upsert: true, cacheControl: p.cacheControl });
    if (oErr) return { path: p.path, optimized: false, bytes: 0, bytesBefore: p.buffer.length, error: `keeping the original failed: ${oErr.message}` };
  }
  const served = img.optimized ? withExt(p.path, img.ext) : p.path;
  const { error } = await store.upload(served, img.buffer, { contentType: img.contentType, upsert: p.upsert ?? true, cacheControl: p.cacheControl });
  return { path: served, optimized: img.optimized, bytes: img.buffer.length, bytesBefore: p.buffer.length, error: error?.message ?? null };
}

/** Display widths at 2x, one place. */
export const IMAGE_WIDTH = {
  /** Course banner (1920 x 640 slot) and session images (shown up to about 860 px wide). */
  banner: 1920,
  card: 1600,
  session: 1600,
  /** CMS media library (founder photos, article images, page images). */
  media: 1600,
  avatar: 512,
} as const;
