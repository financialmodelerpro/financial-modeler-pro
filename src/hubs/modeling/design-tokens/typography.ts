/**
 * Modeling Hub — Typography Tokens
 *
 * Inter is the canonical font for the entire FMP platform; this file just
 * defines the modeling-hub-specific scale, weights, and line heights. Sizes
 * are in pixels rather than rem/em so they translate cleanly to the Excel
 * and PDF exporters which operate in absolute units.
 */

export const fontFamily = {
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
} as const;

export const fontWeight = {
  normal:    400,
  medium:    500,
  semibold:  600,
  bold:      700,
  extrabold: 800,
} as const;

export const fontSize = {
  caption:    11,  // micro footnotes, legend labels
  label:      12,  // form labels, table column headers
  tableCell:  12,  // numeric and text cells inside data tables
  body:       13,  // primary body copy
  kpiLabel:   11,  // tile label above a KPI value
  kpiNumber:  20,  // KPI value
  h4:         13,  // sub-section heading
  h3:         15,  // section heading
  h2:         18,  // module heading
  h1:         24,  // page heading
} as const;

export const lineHeight = {
  tight:    1.2,   // headings
  normal:   1.45,  // body, table cells
  relaxed:  1.6,   // long-form paragraphs (rare in modeling UI)
} as const;

export const letterSpacing = {
  uppercase: '0.06em',  // section headers, eyebrow labels
  normal:    '0',
  tight:     '-0.02em', // h1 only
} as const;
