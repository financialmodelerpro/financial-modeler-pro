/**
 * Modeling Hub — Spacing Tokens (8px grid)
 *
 * Numeric values in pixels so the same scale can be consumed by web (CSS-in-JS
 * inline styles, Tailwind utility classes), Excel column widths, and PDF
 * layout boxes. Half-step (`0.5`, `1.5`) is permitted at the small end where
 * 8px granularity is too coarse for table padding.
 */

export const spacing = {
  px:  1,
  0:   0,
  0.5: 4,
  1:   8,
  1.5: 12,
  2:   16,
  3:   24,
  4:   32,
  5:   40,
  6:   48,
  8:   64,
  10:  80,
  12:  96,
  16:  128,
  20:  160,
} as const;

export const radius = {
  none: 0,
  sm:   4,
  md:   6,
  lg:   8,
  xl:   12,
  full: 9999,
} as const;

/**
 * Semantic spacing — components reference these so the meaning lives in the
 * name rather than a magic number. Adding a new use case? Define a semantic
 * token here rather than reaching for a raw spacing index in component code.
 */
export const semanticSpacing = {
  cardPadding:   spacing[3],   // 24px
  cardRadius:    radius.lg,    //  8px
  tablePaddingX: spacing[1.5], // 12px
  tablePaddingY: spacing[1],   //  8px
  cellPadding:   spacing[1],   //  8px
  sectionGap:    spacing[3],   // 24px between sections
  rowGap:        spacing[1.5], // 12px between adjacent rows
  inlineGap:     spacing[1],   //  8px between inline siblings (icon + label)
} as const;
