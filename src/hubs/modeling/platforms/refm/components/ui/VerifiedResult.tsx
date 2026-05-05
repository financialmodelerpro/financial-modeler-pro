'use client';

/**
 * VerifiedResult, M1.13c step-by-step verification primitive.
 *
 * Renders a single verification step that visually binds three things
 * the user needs to see together to verify a calculation:
 *
 *   1. The formula being applied (plain English with proper math
 *      operators: × ÷ ± ≤ ≥).
 *   2. The substituted values (live, formatted with thousands
 *      separators).
 *   3. The result with units, rendered as a chip so the eye lands on
 *      it first.
 *
 * Sits directly under the input(s) that drive the calculation. The
 * caller is responsible for placing it adjacent to its driving input;
 * the m113c-step-flow spec asserts a < 200 px proximity contract via
 * bounding-box distance.
 *
 * Validation states tint the row and the result chip:
 *
 *   - 'ok'    : transparent bg, grey-pale chip. Default.
 *   - 'warn'  : amber tint, amber chip. Use for soft-fail (e.g. floors
 *               sanity mismatch, allocation off-100, overlap exceeds
 *               window).
 *   - 'error' : red tint, red chip. Use for hard-fail (e.g. utilization
 *               > 100 %, parking deficit > 0, repayment > operations
 *               window). When state != 'ok' and `issue` is set, an
 *               icon + message renders to the right of the result chip.
 *
 * Internal data attributes (data-formula="true", data-state) keep ASCII
 * so M1.13b's bounding-box test + the m113c spec can target them
 * without dealing with Unicode in selectors. The display text uses
 * proper math operators per the M1.13c brief (× not *, ÷ not /).
 *
 * No em-dashes anywhere (CLAUDE.md writing rule, M1.11). The "="
 * separator is a literal equals sign.
 */

import React from 'react';

export type VerifiedState = 'ok' | 'warn' | 'error';

interface VerifiedResultProps {
  /** Plain-English formula expression, e.g. "Plot Area × Max FAR". */
  formula: string;
  /** Live substitution with current values, e.g. "100,000 × 3.0". */
  substitution: string;
  /** Result with units, e.g. "300,000 sqm". */
  result: string;
  /** Validation state. Default 'ok'. */
  state?: VerifiedState;
  /** Issue message shown to the right of the result chip when not ok. */
  issue?: string;
  /** Optional data-testid for Playwright targeting. */
  testId?: string;
  /** Optional style override (rare, prefer state for tinting). */
  style?: React.CSSProperties;
}

const stateBg: Record<VerifiedState, string> = {
  ok:    'transparent',
  warn:  'color-mix(in srgb, var(--color-warning) 8%, transparent)',
  error: 'color-mix(in srgb, var(--color-negative) 10%, transparent)',
};

const stateBorder: Record<VerifiedState, string> = {
  ok:    '1px solid var(--color-border)',
  warn:  '1px solid var(--color-warning)',
  error: '1px solid var(--color-negative)',
};

const chipBg: Record<VerifiedState, string> = {
  ok:    'var(--color-grey-pale)',
  warn:  'color-mix(in srgb, var(--color-warning) 22%, transparent)',
  error: 'color-mix(in srgb, var(--color-negative) 22%, transparent)',
};

const chipColor: Record<VerifiedState, string> = {
  ok:    'var(--color-heading)',
  warn:  'var(--color-warning-text, var(--color-heading))',
  error: 'var(--color-negative)',
};

const issueIcon: Record<VerifiedState, string> = {
  ok:    '',
  warn:  '⚠',
  error: '✕',
};

export default function VerifiedResult({
  formula, substitution, result,
  state = 'ok', issue,
  testId, style,
}: VerifiedResultProps) {
  return (
    <div
      data-testid={testId ?? 'verified-result'}
      data-formula="true"
      data-state={state}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        padding: '6px 10px',
        marginTop: 4,
        marginBottom: 8,
        background: stateBg[state],
        border: stateBorder[state],
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--font-meta)',
        fontFamily: 'Inter, sans-serif',
        lineHeight: 1.5,
        ...style,
      }}
    >
      <span style={{ color: 'var(--color-meta)', fontStyle: 'italic' }}>
        {formula}
      </span>
      <span style={{ color: 'var(--color-meta)' }}>=</span>
      <span style={{ color: 'var(--color-body)', fontWeight: 'var(--fw-semibold)' }}>
        {substitution}
      </span>
      <span style={{ color: 'var(--color-meta)' }}>=</span>
      <span style={{
        padding: '2px 10px',
        borderRadius: 4,
        background: chipBg[state],
        color: chipColor[state],
        fontWeight: 'var(--fw-bold)',
        whiteSpace: 'nowrap',
      }} data-result-chip="true">
        {result}
      </span>
      {state !== 'ok' && issue && (
        <span style={{
          marginLeft: 'auto',
          color: state === 'error' ? 'var(--color-negative)' : 'var(--color-warning-text, var(--color-heading))',
          fontWeight: 'var(--fw-semibold)',
          fontSize: 'var(--font-micro)',
        }} data-result-issue="true">
          {issueIcon[state]} {issue}
        </span>
      )}
    </div>
  );
}
