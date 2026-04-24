/**
 * Pure styling helpers - safe to import from CLIENT modules.
 *
 * Lives separately from `image-utils.ts` because that file imports `sharp`
 * (Node-only native module). The Marketing Studio editor components are
 * 'use client' and re-export template files for their LAYOUT constants;
 * if these helpers lived alongside `fetchAsBase64` in the same file,
 * webpack would try to bundle `sharp` for the browser and fail with
 * `Module not found: Can't resolve 'child_process'`.
 *
 * Rule: anything in this file must be pure JS / TS with no Node built-ins
 * and no native deps. Templates may import freely.
 */

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
 * Returns { date: 'Tuesday, 14 March 2026', time: '14:30 Karachi' }.
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
