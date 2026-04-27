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
 * Multi-stop diagonal gradient. Drives every template's default background
 * when the admin hasn't uploaded a custom one. The diagonal stops give the
 * brand color a subtle direction while staying entirely opaque, so it can
 * sit at the bottom of the layer stack. Templates layer a separate radial
 * highlight div on top via `richBrandHighlight()` for the depth-of-field
 * effect (kept as separate div rather than comma-separated background to
 * avoid relying on satori's multi-layer background parser).
 *
 * Stops are kept to 2 colors only - satori's CSS parser can be unreliable
 * with 3+ color stops on linear-gradient. The dark-to-mid range still gives
 * a clear diagonal direction without losing the brand color.
 */
export function richBrandBackground(primaryColor: string, kind: 'banner' | 'thumbnail' = 'banner'): string {
  const dark = darken(primaryColor, 0.25);
  if (kind === 'thumbnail') {
    return `linear-gradient(135deg, ${dark}, ${primaryColor})`;
  }
  return `linear-gradient(135deg, ${dark}, ${primaryColor})`;
}

/**
 * Soft radial highlight CSS, returned as a single-background string. Templates
 * render this on a separate absolute-positioned div over the base gradient
 * so satori never has to parse a multi-layer background. Caller controls
 * positioning + opacity by wrapping in their own div.
 *
 * Uses the simplest radial-gradient form satori parses reliably:
 * `radial-gradient(<shape> at <position>, <stops>)`. Earlier explicit size
 * syntax (`ellipse 60% 70% at 82% 0%`) was dropped because satori's parser
 * silently fails on the size+position combo and skips rendering the layer
 * entirely.
 */
export function richBrandHighlight(kind: 'banner' | 'thumbnail' = 'banner'): string {
  if (kind === 'thumbnail') {
    return 'radial-gradient(ellipse at top right, rgba(255,255,255,0.14), transparent 60%)';
  }
  return 'radial-gradient(ellipse at top right, rgba(255,255,255,0.12), transparent 60%)';
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
