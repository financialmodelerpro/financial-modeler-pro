/**
 * core-formatters.ts
 * Formatting utilities extracted from refm-platform.js
 */

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
