/**
 * Modeling Hub — Design Tokens (barrel)
 *
 * Public entry point. Consumers do:
 *
 *   import { chromeColors, fastColors, fontSize, spacing, getFast } from '@modeling/design-tokens';
 *
 * The directory holds:
 *   colors.ts      — chromeColors (skeleton) + fastColors (FAST cell convention)
 *   typography.ts  — font family, sizes, weights, line heights
 *   spacing.ts     — 8px grid + semantic spacing
 *   tokens.css     — optional CSS-vars + @theme bridge for Tailwind v4 utility classes
 *   README.md      — usage rules, FAST cell rules, examples
 */

export * from './colors';
export * from './typography';
export * from './spacing';

import { chromeColors, fastColors, type ChromePalette, type FastPalette } from './colors';

/** Resolved theme mode. Web UI threads this through context; exporters always pass 'light'. */
export type ThemeMode = 'light' | 'dark';

/**
 * Pick a chrome palette by mode. Web UI threads the active mode through React
 * context; Excel + PDF always pass `'light'` because the canonical export
 * deliverable uses the FAST/chrome conventions regardless of which theme the
 * user happened to be viewing in the browser.
 */
export function getChrome(mode: ThemeMode = 'light'): ChromePalette {
  return chromeColors[mode];
}

export function getFast(mode: ThemeMode = 'light'): FastPalette {
  return fastColors[mode];
}
