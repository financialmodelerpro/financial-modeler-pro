'use client';

/**
 * PercentageInput (universal percent input, 2026-05-13)
 *
 * Mirrors AccountingNumberInput but applies the universal percent
 * format on blur: 2 decimals, trailing "%", negatives in parentheses.
 * Zero renders as "0.00%" (percentages never collapse to a dash; users
 * still want to see the explicit value).
 *
 * Implementation stays on type="text" + inputMode="decimal" so the
 * input element never re-mounts (avoids the v2-era focus-loss bug
 * AccountingNumberInput documents). Parses commas and parentheses
 * (negative); ignores a trailing "%" so the user can paste a
 * formatted value and have it interpreted correctly.
 *
 * Values are stored as the raw percentage (e.g. 12.5 for 12.5%); the
 * format helper appends the "%" suffix on display only.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { formatPercent } from '@/src/core/formatters';

export interface PercentageInputProps {
  value: number;
  onChange: (n: number) => void;
  decimals?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  placeholder?: string;
  'data-testid'?: string;
  'aria-invalid'?: boolean;
  title?: string;
  id?: string;
}

// Parse a user-typed percent string. Strips commas, trailing "%",
// and wrapping parentheses (negative). Empty string parses to 0.
// Returns null when the string cannot be interpreted.
function parsePercent(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return 0;
  const negParen = /^\((.*)\)$/.exec(trimmed);
  const sign = negParen ? -1 : 1;
  let core = (negParen ? negParen[1] : trimmed).replace(/,/g, '').trim();
  if (core.endsWith('%')) core = core.slice(0, -1).trim();
  if (core === '' || core === '.') return 0;
  const n = Number(core);
  if (!Number.isFinite(n)) return null;
  return sign * n;
}

function clamp(n: number, min?: number, max?: number): number {
  let out = n;
  if (typeof min === 'number' && out < min) out = min;
  if (typeof max === 'number' && out > max) out = max;
  return out;
}

export function PercentageInput(props: PercentageInputProps): React.JSX.Element {
  const {
    value, onChange,
    decimals = 2,
    min, max, step, disabled, style, className, placeholder,
    'data-testid': testId,
    'aria-invalid': ariaInvalid,
    title, id,
  } = props;

  const formatForDisplay = useCallback((n: number): string => formatPercent(n, decimals), [decimals]);

  const [focused, setFocused] = useState(false);
  const [text, setText] = useState<string>(() => formatForDisplay(value));

  useEffect(() => {
    if (!focused) setText(formatForDisplay(value));
  }, [value, focused, formatForDisplay]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    setText(String(value));
    const el = e.currentTarget;
    requestAnimationFrame(() => {
      try { el.select(); } catch { /* noop */ }
    });
  }, [value]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    const parsed = parsePercent(text);
    if (parsed === null) {
      setText(formatForDisplay(value));
      return;
    }
    const clamped = clamp(parsed, min, max);
    if (clamped !== value) onChange(clamped);
    setText(formatForDisplay(clamped));
  }, [text, value, min, max, onChange, formatForDisplay]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    const parsed = parsePercent(raw);
    if (parsed !== null) onChange(clamp(parsed, min, max));
  }, [onChange, min, max]);

  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      style={{ ...style, cursor: disabled ? 'not-allowed' : 'text' }}
      className={className}
      placeholder={placeholder}
      data-testid={testId}
      aria-invalid={ariaInvalid}
      title={title}
      data-step={step}
      data-min={min}
      data-max={max}
    />
  );
}
