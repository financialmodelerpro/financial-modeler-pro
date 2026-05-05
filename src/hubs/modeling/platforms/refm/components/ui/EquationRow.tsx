'use client';

/**
 * EquationRow, M1.13d step-as-equation primitive.
 *
 * Renders one calculation step as a horizontal row of boxes that read
 * left-to-right like a math equation:
 *
 *     [FIELD 1]  op  [FIELD 2]  =  [RESULT]
 *
 * Each box has a label above and a unit suffix below so the user
 * sees what each value represents without hovering for help. Two
 * field kinds:
 *
 *   - 'input'   : editable yellow box (FAST navy-pale bg, navy text)
 *                 the user types into. Carries the canonical input
 *                 element id (e.g. plot-${id}-maxFAR) so existing
 *                 selectors keep working.
 *   - 'derived' : read-only box that displays a value computed
 *                 upstream (e.g. Footprint, used as input to Podium
 *                 GFA). Visually distinct (dashed border, grey bg)
 *                 so the user understands it is a chained value, not
 *                 something to type into.
 *
 * The right-hand result box highlights the calculated value with a
 * coloured chip and supports validation state ('ok' / 'warn' /
 * 'error'). When state is not 'ok' and `issue` is set, an issue
 * callout renders below the row.
 *
 * Operator strings between fields use proper Unicode math (× ÷ - +)
 * per the M1.13c brief; the equals sign is a literal "=".
 *
 * Why this primitive over VerifiedResult: the user's mental model
 * for area planning is "Plot Area times FAR equals GFA". A horizontal
 * 3-box layout matches that mental model directly. VerifiedResult's
 * "formula = substitution = result" line is information-dense but
 * does not visually separate inputs from outputs the way an equation
 * row does. EquationRow is the layout for Module 1's Plot Editor
 * envelope chain; VerifiedResult remains the right primitive for
 * narrow contexts (parcel totals, financing summary lines) where
 * inputs are not local to the row.
 *
 * No em-dashes anywhere (CLAUDE.md writing rule, M1.11).
 */

import React from 'react';

export type EquationState = 'ok' | 'warn' | 'error';

export type EquationField =
  | {
      kind: 'input';
      label: string;
      value: number;
      onChange: (v: number) => void;
      suffix?: string;
      inputId?: string;
      step?: number;
      min?: number;
      max?: number;
      disabled?: boolean;
    }
  | {
      kind: 'derived';
      label: string;
      value: number;
      suffix?: string;
      formatValue?: (v: number) => string;
    };

interface EquationRowProps {
  /** 1 to 3 fields on the left side of the equals sign. */
  fields: EquationField[];
  /** Operator between fields. operators.length must equal fields.length - 1. */
  operators: string[];
  /** Result box on the right side. */
  result: {
    label: string;
    value: number;
    suffix?: string;
    state?: EquationState;
    issue?: string;
    formatValue?: (v: number) => string;
    /** Optional data-testid on the result box. */
    testId?: string;
  };
  /** Optional data-testid on the row container. */
  testId?: string;
}

function fmtDefault(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-meta)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const inputBoxStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  fontWeight: 'var(--fw-bold)',
  boxSizing: 'border-box',
  textAlign: 'right',
};

const derivedBoxStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-grey-pale)',
  color: 'var(--color-meta)',
  fontWeight: 'var(--fw-semibold)',
  boxSizing: 'border-box',
  textAlign: 'right',
};

const suffixStyle: React.CSSProperties = {
  fontSize: 'var(--font-micro)',
  color: 'var(--color-meta)',
  display: 'block',
  marginTop: 2,
  textAlign: 'right',
  minHeight: 14,
};

const operatorStyle: React.CSSProperties = {
  fontSize: 'var(--font-h4)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-heading)',
  display: 'flex',
  alignItems: 'center',
  paddingTop: 18,
  flexShrink: 0,
};

const stateChipBg: Record<EquationState, string> = {
  ok:    'color-mix(in srgb, var(--color-positive) 14%, transparent)',
  warn:  'color-mix(in srgb, var(--color-warning) 22%, transparent)',
  error: 'color-mix(in srgb, var(--color-negative) 22%, transparent)',
};

const stateChipColor: Record<EquationState, string> = {
  ok:    'var(--color-heading)',
  warn:  'var(--color-warning-text, var(--color-heading))',
  error: 'var(--color-negative)',
};

const stateChipBorder: Record<EquationState, string> = {
  ok:    '1px solid color-mix(in srgb, var(--color-positive) 40%, transparent)',
  warn:  '1px solid var(--color-warning)',
  error: '1px solid var(--color-negative)',
};

function FieldBox({ field }: { field: EquationField }) {
  const fmt = ('formatValue' in field && field.formatValue) || fmtDefault;
  if (field.kind === 'input') {
    return (
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <span style={labelStyle} title={field.label}>{field.label}</span>
        <input
          type="number"
          value={field.value}
          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
          id={field.inputId}
          disabled={field.disabled}
          step={field.step}
          min={field.min}
          max={field.max}
          style={inputBoxStyle}
        />
        <span style={suffixStyle}>{field.suffix ?? ''}</span>
      </div>
    );
  }
  return (
    <div style={{ flex: '1 1 0', minWidth: 0 }}>
      <span style={labelStyle} title={field.label}>{field.label}</span>
      <div style={derivedBoxStyle} data-derived="true">
        {fmt(field.value)}
      </div>
      <span style={suffixStyle}>{field.suffix ?? ''}</span>
    </div>
  );
}

export default function EquationRow({ fields, operators, result, testId }: EquationRowProps) {
  const state: EquationState = result.state ?? 'ok';
  const fmt = result.formatValue ?? fmtDefault;
  const resultBoxStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-h4)',
    fontFamily: 'Inter, sans-serif',
    background: stateChipBg[state],
    color: stateChipColor[state],
    fontWeight: 'var(--fw-bold)',
    boxSizing: 'border-box',
    textAlign: 'right',
    border: stateChipBorder[state],
  };

  return (
    <div data-testid={testId} data-equation-row="true" data-state={state}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 0',
      }}>
        {fields.map((f, i) => (
          <React.Fragment key={i}>
            <FieldBox field={f} />
            {i < fields.length - 1 && (
              <span style={operatorStyle} aria-hidden="true">{operators[i]}</span>
            )}
          </React.Fragment>
        ))}
        <span style={operatorStyle} aria-hidden="true">=</span>
        <div style={{ flex: '1.2 1 0', minWidth: 0 }}>
          <span style={labelStyle} title={result.label}>{result.label}</span>
          <div
            style={resultBoxStyle}
            data-testid={result.testId}
            data-result-chip="true"
            data-formula="true"
          >
            {fmt(result.value)}
          </div>
          <span style={suffixStyle}>{result.suffix ?? ''}</span>
        </div>
      </div>
      {state !== 'ok' && result.issue && (
        <div
          data-result-issue="true"
          style={{
            fontSize: 'var(--font-micro)',
            color: state === 'error' ? 'var(--color-negative)' : 'var(--color-warning-text, var(--color-heading))',
            fontWeight: 'var(--fw-semibold)',
            padding: '4px 10px 8px',
            marginTop: -4,
          }}
        >
          {state === 'error' ? '✕' : '⚠'} {result.issue}
        </div>
      )}
    </div>
  );
}
