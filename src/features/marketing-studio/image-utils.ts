/**
 * Server-only image helpers - DO NOT import from a client module.
 *
 * `sharp` is a Node-native binding (uses node:child_process, node:crypto, fs)
 * and webpack will fail to bundle it for the browser. The pure helpers
 * (lighten / darken / formatSessionDateTime) live in `style-utils.ts` so
 * templates - which are imported by both the server render route AND the
 * client studio editors via their LAYOUT exports - can pull those without
 * dragging sharp into the client bundle.
 */
import sharp from 'sharp';

// Per-fetch timeout. The Marketing Studio render route loads logo + each
// instructor photo + optional uploaded background in parallel; if any one
// fetch hangs the whole render hangs with it. Vercel Hobby caps server
// functions at 10s, so we want individual fetches to fail fast and return
// empty (templates already render gracefully without the asset) rather than
// stretching to the function-level timeout.
const FETCH_TIMEOUT_MS = 6000;

/**
 * Fetch an image URL and return it as a base64 data URI suitable for satori.
 * SVGs are rasterized to PNG (satori only handles raster). Empty string on
 * failure (network error, non-OK status, or timeout).
 */
export async function fetchAsBase64(url: string): Promise<string> {
  if (!url) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 50) return '';
    const ct = res.headers.get('content-type') || '';
    const isSvg = ct.includes('svg') || ct.includes('xml') || url.toLowerCase().endsWith('.svg');
    if (isSvg) {
      try {
        const png = await sharp(buf).resize({ height: 400, withoutEnlargement: false }).png().toBuffer();
        return `data:image/png;base64,${png.toString('base64')}`;
      } catch {
        return `data:image/svg+xml;base64,${buf.toString('base64')}`;
      }
    }
    const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
