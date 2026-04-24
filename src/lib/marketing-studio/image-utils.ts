import sharp from 'sharp';

/**
 * Fetch an image URL and return it as a base64 data URI suitable for satori.
 * SVGs are rasterized to PNG (satori only handles raster). Empty string on failure.
 */
export async function fetchAsBase64(url: string): Promise<string> {
  if (!url) return '';
  try {
    const res = await fetch(url, { cache: 'no-store' });
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
  }
}

/**
 * Lighten a hex color by a 0-1 factor toward white. Used for gradient stops.
 */
export function lighten(hex: string, factor: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * factor);
  const out = (mix(r) << 16) | (mix(g) << 8) | mix(b);
  return `#${out.toString(16).padStart(6, '0')}`;
}

/**
 * Darken a hex color by a 0-1 factor toward black.
 */
export function darken(hex: string, factor: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c * (1 - factor));
  const out = (mix(r) << 16) | (mix(g) << 8) | mix(b);
  return `#${out.toString(16).padStart(6, '0')}`;
}

/**
 * Format an ISO date string for display in banners (en-GB long form).
 * Returns ['Tuesday, 14 March 2026', '14:30 PKT'] tuple.
 */
export function formatSessionDateTime(iso: string, timezone: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: timezone || 'Asia/Karachi',
    });
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: timezone || 'Asia/Karachi',
    });
    const tzAbbr = (timezone || 'Asia/Karachi').split('/').pop()?.replace('_', ' ') ?? '';
    return { date, time: tzAbbr ? `${time} ${tzAbbr}` : time };
  } catch {
    return { date: iso, time: '' };
  }
}
