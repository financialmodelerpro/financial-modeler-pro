/**
 * periodAxis.ts
 *
 * Universal results-table period axis builder. Every results table that
 * has a period axis (Tab 3 Results Tables 1-4, Tab 4 Inputs Capex
 * Breakdown + Debt/Equity Required, Tab 4 Schedules) routes through
 * `buildResultsPeriodAxis()` so the layout is consistent: one prior
 * calendar year at index 0, followed by `numAnnualPeriods` active
 * annual labels.
 *
 * M2.0 Pass 14 (2026-05-13): annual-only basis until M5 Financial
 * Statements introduces a granularity toggle scoped to FS output. The
 * helper no longer takes a `granularity` arg and no longer applies a
 * hard cap (period count is whatever the caller supplies, derived from
 * project duration + active-data extent).
 *
 * Examples:
 *   - Project starts Dec 26 -> [Dec 25, Dec 26, Dec 27, ...]
 *
 * The prior column is always rendered (blank / zero values, no math
 * change). Pure formatting / layout.
 */

import { generatePeriodLabels } from '@/src/core/calculations';

export interface ResultsPeriodAxis {
  /** Calendar period immediately before activeLabels[0]. */
  priorLabel: string;
  /** Active period labels (annual, post any caller-side crop). */
  activeLabels: string[];
  /** [priorLabel, ...activeLabels]. The full axis a table renders. */
  labels: string[];
  /** Total column count: 1 prior + activeLabels.length. */
  count: number;
}

/**
 * Build the annual period axis for a results table.
 *
 * `numAnnualPeriods` is the count of project years rendered. The
 * caller picks the count from project duration + data extent; the
 * helper does NOT apply any cap.
 *
 * `cropAnnualOffset` shifts the active range by N years forward (Tab 3
 * Results uses this to crop leading zero years). The prior label is
 * one annual period BEFORE activeLabels[0], not before project start,
 * so it always sits flush against the rendered range.
 */
export function buildResultsPeriodAxis(opts: {
  startIso: string;
  numAnnualPeriods: number;
  cropAnnualOffset?: number;
}): ResultsPeriodAxis {
  const cropOffset = Math.max(0, opts.cropAnnualOffset ?? 0);
  const allLabels = generatePeriodLabels(
    opts.startIso,
    cropOffset + Math.max(0, opts.numAnnualPeriods),
    'annual',
  );
  const activeLabels = allLabels.slice(cropOffset);
  const start = new Date(opts.startIso);
  const startYear = Number.isNaN(start.getTime())
    ? new Date().getUTCFullYear()
    : start.getUTCFullYear();
  const priorYear = startYear + cropOffset - 1;
  const yy = String(priorYear).slice(-2).padStart(2, '0');
  const priorLabel = `Dec ${yy}`;
  const labels = [priorLabel, ...activeLabels];
  return { priorLabel, activeLabels, labels, count: labels.length };
}
