/**
 * core-formatters.ts
 * Formatting utilities extracted from refm-platform.js
 *
 * M2.0g (2026-05-06): adds DisplayScale-aware formatting. Storage stays
 * full value always; only the display layer divides by 1,000 or
 * 1,000,000 based on the project's displayScale. formatScaled and
 * formatScaledCurrency are the canonical helpers; legacy formatNumber
 * / formatCurrency stay for callers that haven't migrated yet.
 */

export type DisplayScale = 'full' | 'thousands' | 'millions';

const SCALE_DIVISOR: Record<DisplayScale, number> = {
  full: 1,
  thousands: 1_000,
  millions: 1_000_000,
};

const SCALE_SUFFIX: Record<DisplayScale, string> = {
  full: '',
  thousands: ' K',
  millions: ' M',
};

const SCALE_DECIMALS: Record<DisplayScale, number> = {
  full: 2,
  thousands: 2,
  millions: 2,
};

// Accounting format helper. Used by formatScaled / formatScaledCurrency.
// Negatives in parentheses (CLAUDE.md rule: no em-dashes; zero -> "0.00").
function formatScaledRaw(num: number, scale: DisplayScale, decimals?: number): string {
  if (num === 0) {
    const d = decimals ?? SCALE_DECIMALS[scale];
    return (0).toFixed(d) + SCALE_SUFFIX[scale];
  }
  const divisor = SCALE_DIVISOR[scale];
  const scaled = num / divisor;
  const abs = Math.abs(scaled);
  const d = decimals ?? SCALE_DECIMALS[scale];
  const text = abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const suffix = SCALE_SUFFIX[scale];
  if (scaled < 0) return `(${text}${suffix})`;
  return `${text}${suffix}`;
}

// Public canonical formatter.
export function formatScaled(num: number | null | undefined, scale: DisplayScale = 'full', decimals?: number): string {
  if (num === null || num === undefined || isNaN(num as number)) {
    const d = decimals ?? SCALE_DECIMALS[scale];
    return (0).toFixed(d);
  }
  return formatScaledRaw(num as number, scale, decimals);
}

export function formatScaledCurrency(num: number | null | undefined, currency: string, scale: DisplayScale = 'full', decimals?: number): string {
  return `${formatScaled(num, scale, decimals)} ${currency}`;
}

// Compact formatter for sub-unit area, parking bays, etc. (integer
// counts) - never scales, always full integer with thousand separators.
// Use this for sqm, count, percent values that shouldn't get the K/M
// scale treatment.
export function formatInteger(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num as number)) return '0';
  if (num === 0) return '0';
  const abs = Math.abs(Math.round(num as number));
  const text = abs.toLocaleString('en-US');
  return (num as number) < 0 ? `(${text})` : text;
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || num === 0 || isNaN(num)) return '-';
  return Math.round(num).toLocaleString('en-US');
}

/**
 * Formats a financial number and returns the value + CSS color.
 * - Negative → red (#DC2626)
 * - Zero     → em dash in grey (#6B7280)
 * - Positive → dark grey (#374151)
 *
 * Usage:
 *   const { text, color } = formatFinancialNumber(value, 'USD');
 *   <td style={{ color }}>{text}</td>
 */
export function formatFinancialNumber(
  num: number | null | undefined,
  currency?: string,
): { text: string; color: string } {
  if (num === null || num === undefined || isNaN(num as number)) {
    return { text: '-', color: '#6B7280' };
  }
  if (num === 0) {
    return { text: '-', color: '#6B7280' };
  }
  const abs      = Math.abs(Math.round(num));
  const formatted = abs.toLocaleString('en-US');
  const prefix    = currency ? `${currency} ` : '';
  if (num < 0) {
    return { text: `(${prefix}${formatted})`, color: '#DC2626' };
  }
  return { text: `${prefix}${formatted}`, color: '#374151' };
}

export function formatInput(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num as number)) return '0';
  return Math.round(num as number).toLocaleString('en-US');
}

export function formatCurrency(num: number | null | undefined, currency: string): string {
  if (!num || num === 0) return `${currency} 0`;
  return `${currency} ${Math.round(num).toLocaleString('en-US')}`;
}

export function formatPercent(num: number, decimals = 1): string {
  return `${num.toFixed(decimals)}%`;
}
