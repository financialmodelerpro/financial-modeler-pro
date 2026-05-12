'use client';

/**
 * AccountingNumberInput (T3-edit-runtime v2 rewrite, 2026-05-12)
 *
 * Direct numeric input. No focus-flip, no readOnly intermediate
 * state, no formatted-text overlay. Click goes straight to typing,
 * keystroke updates the parent on every valid parse.
 *
 * The legacy two-state design (formatted text on blur, type=number on
 * focus) caused two bugs:
 *   (a) DevTools showed readOnly=true on the unfocused state, looking
 *       permanently locked.
 *   (b) Click-to-flip lost focus on some browsers because React reused
 *       the same input element when swapping type=text -> type=number.
 *
 * This rewrite drops both behaviors. Numbers display raw (no thousand
 * separators) directly in the input. Less polished visually, but the
 * editability is unambiguous and the click handler is the browser's
 * native focus handler.
 */

import React, { useCallback } from 'react';
import type { DisplayScale, DisplayDecimals } from '@/src/core/formatters';

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
  /** When true, renders an empty string instead of "0". */
  blankWhenZero?: boolean;
}

export function AccountingNumberInput(props: AccountingNumberInputProps): React.JSX.Element {
  const {
    value, onChange,
    min, max, step, disabled, style, className, placeholder,
    'data-testid': testId,
    'aria-invalid': ariaInvalid,
    title, id, blankWhenZero,
    // scale / decimals retained on the interface for back-compat but no
    // longer consumed; the input renders raw numbers.
  } = props;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Empty string -> 0. Otherwise parse via Number; reject NaN.
    if (raw === '') {
      onChange(0);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  }, [onChange]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (!disabled) e.currentTarget.select();
  }, [disabled]);

  const displayValue = blankWhenZero && (value === 0 || !Number.isFinite(value))
    ? ''
    : String(value);

  return (
    <input
      type="number"
      id={id}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      style={{ ...style, cursor: disabled ? 'not-allowed' : 'text' }}
      className={className}
      placeholder={placeholder}
      data-testid={testId}
      aria-invalid={ariaInvalid}
      title={title}
    />
  );
}
