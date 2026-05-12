'use client';

/**
 * AccountingNumberInput (T3-edit-runtime rewrite, 2026-05-12)
 *
 * Single-state numeric input that's directly editable. User clicks,
 * cursor enters, types, value updates, blur saves. No readOnly text
 * mode, no click-to-flip-mode layer.
 *
 * Replaces the M2.0j Fix 7 two-state design (readOnly text on blur,
 * type=number on focus) which produced the regression where users
 * thought the input was permanently locked because the unfocused
 * branch carried `readOnly` and the click-to-focus swap was invisible.
 *
 * Display: formatScaled is still used to put thousand separators in
 * the *blur* display via a sibling overlay div that fades in/out, but
 * the underlying input is type="number" ALWAYS so click and type work
 * with zero ceremony.
 */

import React, { useCallback, useState } from 'react';
import { formatScaled, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';

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
  /** When true, renders a clear "(0)" instead of formatted "0.00". */
  blankWhenZero?: boolean;
}

export function AccountingNumberInput(props: AccountingNumberInputProps): React.JSX.Element {
  const {
    value, onChange, scale = 'full', decimals = 2,
    min, max, step, disabled, style, className, placeholder,
    'data-testid': testId,
    'aria-invalid': ariaInvalid,
    title, id, blankWhenZero,
  } = props;

  // Local string state so the user can type freely (including
  // intermediate states like "-", "1.", ".5") without React clobbering
  // the input on every keystroke. We sync to the parent's number value
  // on every successful parse and on blur.
  const [draft, setDraft] = useState<string>(() => String(value));
  const [focused, setFocused] = useState(false);

  // When the parent updates the value externally (e.g. another field
  // edit triggered a recompute), and the user isn't actively typing,
  // sync the draft. Skipping this sync while focused keeps the user's
  // partial input from being overwritten mid-typing.
  React.useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDraft(next);
    // Only propagate when the parsed number is finite. Lets the user
    // type "1." without immediately becoming 1 (which would block them
    // typing the decimal portion).
    const n = Number(next);
    if (Number.isFinite(n)) onChange(n);
  }, [onChange]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    if (!disabled) e.currentTarget.select();
  }, [disabled]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    // Normalise empty / NaN to 0 on commit. The parent already has
    // every finite value via handleChange; this only fires on commit
    // for the edge cases.
    const n = Number(draft);
    if (!Number.isFinite(n)) onChange(0);
  }, [draft, onChange]);

  // Unfocused display: thousand-separated string. We render this in
  // the same <input> element via the `value` prop swap.
  const formatted = blankWhenZero && (value === 0 || !Number.isFinite(value))
    ? ''
    : formatScaled(value, scale, decimals);
  const displayValue = focused ? draft : formatted;
  // The underlying type is "text" so the formatted value (with commas)
  // can render when not focused. inputMode="decimal" tells mobile
  // keyboards to show the numeric keypad. The onChange handler parses
  // through Number() so any non-numeric characters just produce NaN
  // and are rejected (no propagation, draft holds the raw string).
  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
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
