/**
 * core-formatters.ts
 * Formatting utilities extracted from refm-platform.js
 *
 * M2.0g (2026-05-06): adds DisplayScale-aware formatting. Storage stays
 * full value always; only the display layer divides by 1,000 or
 * 1,000,000 based on the project's displayScale. formatScaled and
 * formatScaledCurrency are the canonical helpers; legacy formatNumber
 * / formatCurrency stay for callers that haven't migrated yet.
 *
 * M2.0j Fix 4 + 5 (2026-05-07): export consideration. The "K" / "M"
 * suffix appended in formatScaled is intentional for the platform UI
 * (helps the user visually scan magnitudes). For PDF / Excel exports
 * (handled by a future Export module, not this module), the export
 * layer should:
 *   - Render the scale ONCE in a header / sheet caption (e.g.
 *     "All figures in SAR '000 unless stated"), via currencyHeaderLine.
 *   - Render individual cells WITHOUT the K / M suffix - just the
 *     scaled-and-formatted number with thousand separators. Use
 *     formatScaledForExport (added below) to strip the suffix while
 *     keeping the scale division + decimal formatting.
 *
 * Percentages should always render with 2 decimals regardless of the
 * project's displayDecimals setting (Fix 5). Use formatPercent and
 * pass decimals = 2 (the new default).
 *
 * Areas (sqm) follow a different convention: they are NEVER scaled by
 * thousands / millions even when project.displayScale = 'thousands'.
 * Use formatArea (added below) which formats with thousand separators
 * + the project's displayDecimals but no K / M suffix.
 */

export type DisplayScale = 'full' | 'thousands' | 'millions';

// M2.0i Fix 3 (2026-05-07): companion type for project-level
// displayDecimals. Format helpers default to 2 when omitted.
export type DisplayDecimals = 0 | 1 | 2 | 3;

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

// M2.0j Fix 5 (2026-05-07): percentages always render with 2 decimals
// regardless of project.displayDecimals. Default flipped from 1 to 2.
export function formatPercent(num: number, decimals = 2): string {
  if (num === null || num === undefined || isNaN(num as number)) return '0.00%';
  return `${(num as number).toFixed(decimals)}%`;
}

// M2.0j Fix 5 (2026-05-07): area formatter. Areas (sqm) are NEVER scaled
// by thousands / millions, but they DO follow the project's
// displayDecimals setting and use thousand separators. Used for parcel
// area, asset BUA, sub-unit area, etc. Negative values render in
// parentheses to match accounting convention.
export function formatArea(num: number | null | undefined, decimals: DisplayDecimals = 2): string {
  if (num === null || num === undefined || isNaN(num as number)) {
    return (0).toFixed(decimals);
  }
  if (num === 0) return (0).toFixed(decimals);
  const abs = Math.abs(num as number);
  const text = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (num as number) < 0 ? `(${text})` : text;
}

// M2.0j Fix 4 (2026-05-07): export-friendly formatter. Same scale
// division + decimal handling as formatScaled, but WITHOUT the K / M
// suffix. The export module renders scale once in the sheet header.
export function formatScaledForExport(num: number | null | undefined, scale: DisplayScale = 'full', decimals?: number): string {
  if (num === null || num === undefined || isNaN(num as number)) {
    const d = decimals ?? SCALE_DECIMALS[scale];
    return (0).toFixed(d);
  }
  const divisor = SCALE_DIVISOR[scale];
  const scaled = (num as number) / divisor;
  const abs = Math.abs(scaled);
  const d = decimals ?? SCALE_DECIMALS[scale];
  const text = abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (scaled < 0) return `(${text})`;
  return text;
}

// M2.0h Fix 2 (2026-05-07): currency header line text used at the top
// of every Module 1 tab. Cells stay free of currency suffix to keep the
// table visually clean; this single line tells the user what unit /
// scale every number in the tab is rendered at. Format:
//   full        -> "All figures in SAR"
//   thousands   -> "All figures in SAR '000"
//   millions    -> "All figures in SAR M"
// currency replaces SAR with whatever ISO code is on the project.
export function currencyHeaderLine(currency: string, scale: DisplayScale): string {
  if (scale === 'thousands') return `All figures in ${currency} '000`;
  if (scale === 'millions') return `All figures in ${currency} M`;
  return `All figures in ${currency}`;
}

// M2.0i Fix 3 (2026-05-07): convenience helper that pulls both
// displayScale and displayDecimals from a project-shaped object and
// returns a formatter function. Lets each component declare a single
// `const fmt = makeProjectFormatter(project);` and then call `fmt(n)`
// without repeating the scale/decimals plumbing.
export interface ProjectFormatPrefs {
  displayScale?: DisplayScale;
  displayDecimals?: DisplayDecimals;
}

export function makeProjectFormatter(prefs: ProjectFormatPrefs): (n: number | null | undefined) => string {
  const scale = prefs.displayScale ?? 'full';
  const decimals = prefs.displayDecimals ?? 2;
  return (n) => formatScaled(n, scale, decimals);
}
