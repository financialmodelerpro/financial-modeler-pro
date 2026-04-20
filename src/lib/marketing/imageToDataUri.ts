import sharp from 'sharp';

/** Max time allowed per image fetch. If the remote host hangs, we give up
 *  and return '' so the renderer keeps rolling with a placeholder rather
 *  than stalling the whole /render call past Vercel's serverless timeout —
 *  which was the actual failure mode surfacing as "Failed to fetch" on the
 *  client (connection terminated mid-stream). */
const FETCH_TIMEOUT_MS = 5_000;

/** Fetch an image URL and return a base64 data URI. SVG is rasterized via
 *  sharp. Returns empty string on any failure (timeout, network, non-2xx,
 *  or suspiciously small buffer). */
export async function imageToDataUri(url: string | null | undefined): Promise<string> {
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
        const png = await sharp(buf).resize({ height: 400 }).png().toBuffer();
        return `data:image/png;base64,${png.toString('base64')}`;
      } catch {
        return `data:image/svg+xml;base64,${buf.toString('base64')}`;
      }
    }
    const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    // Timeout lands here as AbortError. Only log unexpected failures so a
    // dead image URL doesn't spam logs on every render.
    if ((e as { name?: string })?.name !== 'AbortError') {
      console.warn('[imageToDataUri] fetch failed:', url, e);
    }
    return '';
  } finally {
    clearTimeout(timer);
  }
}
