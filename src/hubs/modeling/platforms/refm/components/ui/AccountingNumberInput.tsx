'use client';

/**
 * AccountingNumberInput (universal blur-format rewrite, 2026-05-13)
 *
 * Universal numeric input across REFM Module 1. Renders the value in
 * accounting format while idle (commas, parens for negatives, "-" for
 * zero) and a raw editable string while focused. Format on blur.
 *
 * Implementation avoids the v2-era bugs that caused the previous rewrite:
 *   (a) `readOnly` look on the unfocused state - we never toggle readOnly.
 *   (b) React reusing the input element when swapping
 *       `type="text"` <-> `type="number"` - we stay on `type="text"` +
 *       `inputMode="decimal"` so the soft keyboard still surfaces the
 *       numeric pad on mobile while the input element never re-mounts.
 *
 * Editable string parses commas, parentheses (negative), and a leading
 * minus sign. Empty string parses to 0.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { formatAccounting, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';

export interface AccountingNumberInputProps {
  value: number;
  onChange: (n: number) => void;
  scale?: DisplayScale;
  decimals?: DisplayDecimals;
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
  /** When true, renders an empty string instead of "0" when value is zero. */
  blankWhenZero?: boolean;
}

// Parse a user-typed accounting string. Strips commas; treats wrapping
// parentheses as a negative sign; trims whitespace. Returns null when
// the string cannot be interpreted as a number; the caller falls back
// to the prior value rather than mutating to NaN.
function parseAccounting(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return 0;
  const negParen = /^\((.*)\)$/.exec(trimmed);
  const sign = negParen ? -1 : 1;
  const core = (negParen ? negParen[1] : trimmed).replace(/,/g, '').trim();
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

export function AccountingNumberInput(props: AccountingNumberInputProps): React.JSX.Element {
  const {
    value, onChange,
    scale = 'full',
    decimals,
    min, max, step, disabled, style, className, placeholder,
    'data-testid': testId,
    'aria-invalid': ariaInvalid,
    title, id, blankWhenZero,
  } = props;

  const formatForDisplay = useCallback((n: number): string => {
    if (blankWhenZero && (n === 0 || !Number.isFinite(n))) return '';
    return formatAccounting(n, scale, decimals);
  }, [scale, decimals, blankWhenZero]);

  const [focused, setFocused] = useState(false);
  const [text, setText] = useState<string>(() => formatForDisplay(value));

  // When external value (or scale/decimals) changes while the input is
  // not focused, refresh the displayed text. While focused we leave the
  // user's typing alone.
  useEffect(() => {
    if (!focused) {
      setText(formatForDisplay(value));
    }
  }, [value, focused, formatForDisplay]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    if (blankWhenZero && (value === 0 || !Number.isFinite(value))) {
      setText('');
    } else {
      setText(String(value));
    }
    const el = e.currentTarget;
    requestAnimationFrame(() => {
      try { el.select(); } catch { /* noop */ }
    });
  }, [value, blankWhenZero]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    const parsed = parseAccounting(text);
    if (parsed === null) {
      // Reject NaN-like input; revert to last good value.
      setText(formatForDisplay(value));
      return;
    }
    const clamped = clamp(parsed, min, max);
    if (clamped !== value) {
      onChange(clamped);
    }
    setText(formatForDisplay(clamped));
  }, [text, value, min, max, onChange, formatForDisplay]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    // Live-parse: when the partial string is a valid number, propagate
    // upward so derived calculations update as the user types. Invalid
    // partials (e.g. lone "-" or "1,") just update local text and the
    // blur handler will commit or revert.
    const parsed = parseAccounting(raw);
    if (parsed !== null) {
      onChange(clamp(parsed, min, max));
    }
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
      // `step` retained for API back-compat; type=text ignores it, but
      // tests / callers may pass it for documentation.
      data-step={step}
      data-min={min}
      data-max={max}
    />
  );
}
