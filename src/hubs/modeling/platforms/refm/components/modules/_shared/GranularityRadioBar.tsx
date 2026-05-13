'use client';

/**
 * GranularityRadioBar
 *
 * Universal radio pill bar that lets the user toggle the period
 * granularity (Annual / Quarterly / Monthly) on any results-table
 * surface. Writes to `project.outputGranularity` via the store so all
 * tables on the page re-render at the same axis. Used on Tab 3 Costs
 * Results, Tab 4 Schedules, and Tab 4 Inputs Capex Breakdown.
 *
 * Caller passes the current `granularity` and an `onChange` that
 * patches the project. A `radioName` is required so multiple bars on
 * the same page do not interfere with each other's selection (a
 * common pitfall when extracting a shared radio component).
 */

import React from 'react';
import { OUTPUT_GRANULARITIES, OUTPUT_GRANULARITY_LABELS } from '../../../lib/state/module1-types';
import type { OutputGranularity } from '../../../lib/state/module1-types';

export interface GranularityRadioBarProps {
  granularity: OutputGranularity;
  onChange: (g: OutputGranularity) => void;
  /** Required: html name attr so multiple bars on the same page stay independent. */
  radioName: string;
  /** Optional label prefix, default "View as:". */
  label?: string;
  /** Optional trailing helper text (right-aligned). */
  helper?: React.ReactNode;
  /** Optional data-testid for the wrapper. */
  dataTestid?: string;
}

export function GranularityRadioBar({
  granularity,
  onChange,
  radioName,
  label = 'View as:',
  helper,
  dataTestid,
}: GranularityRadioBarProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        padding: 'var(--sp-1) var(--sp-2)',
        marginBottom: 'var(--sp-2)',
        background: 'var(--color-grey-pale)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
      }}
      data-testid={dataTestid}
    >
      <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>
        {label}
      </strong>
      {OUTPUT_GRANULARITIES.map((g) => (
        <label
          key={g}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 'var(--font-small)' }}
          data-testid={`${radioName}-${g}`}
        >
          <input
            type="radio"
            name={radioName}
            value={g}
            checked={granularity === g}
            onChange={() => onChange(g)}
          />
          {OUTPUT_GRANULARITY_LABELS[g]}
        </label>
      ))}
      {helper ? (
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-meta)' }}>{helper}</span>
      ) : null}
    </div>
  );
}
