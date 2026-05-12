'use client';

/**
 * AccountingNumberInput (M2.0j Fix 7, 2026-05-07)
 *
 * Drop-in replacement for `<input type="number">` that displays
 * accounting-format text on blur (1,234.00 / 47,800.00) and switches to
 * the raw editable number when focused. The wrapped value stays a
 * regular number end-to-end; only the displayed string changes by
 * focus state.
 *
 * Usage:
 *   <AccountingNumberInput
 *     value={line.value}
 *     onChange={(n) => writeValue(n)}
 *     scale={project.displayScale ?? 'full'}
 *     decimals={project.displayDecimals ?? 2}
 *     data-testid={`...`}
 *   />
 *
 * Notes:
 *   - When focused, renders a real <input type="number"> so HTML up/down
 *     arrows + step still work.
 *   - When unfocused, renders a styled <input type="text"> with the
 *     formatted value. Clicking it focuses + flips to numeric mode.
 *   - `decimals` follows project displayDecimals; `scale` follows project
 *     displayScale. The displayed string DOES apply scale (so 1,234,567
 *     at scale=thousands shows as "1,234.57 K"). But the input value
 *     stays full magnitude on focus so the user types raw numbers.
 */

import React, { useCallback, useRef, useState } from 'react';
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
  const [focused, setFocused] = useState(false);
  const numberInputRef = useRef<HTMLInputElement | null>(null);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  if (focused || disabled) {
    // While focused, show raw editable number. Disabled also shows raw
    // (no formatted display since user can't interact anyway).
    // T3-edit-runtime UX softener (2026-05-12): select-all on focus so
    // typing replaces the existing value rather than appending. Removes
    // the surprise where users typed "5500" expecting it to replace
    // "4500" but got "45005500".
    return (
      <input
        ref={numberInputRef}
        type="number"
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        onFocus={(e) => {
          handleFocus();
          if (!disabled) e.currentTarget.select();
        }}
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        style={style}
        className={className}
        placeholder={placeholder}
        data-testid={testId}
        aria-invalid={ariaInvalid}
        title={title}
        autoFocus={focused && !disabled}
      />
    );
  }
  // Unfocused: show formatted display in a text input. Click to focus.
  // T3-edit-runtime UX softener (2026-05-12): aria-readonly="false" +
  // explicit "Click to edit" title so DOM inspectors see this is an
  // editable cell that's just in formatted-display mode. The native
  // `readOnly` attribute stays so the text field doesn't accept
  // keystrokes in the formatted-display state; the click handler swaps
  // it for the type=number input on first interaction.
  const display = blankWhenZero && (value === 0 || !Number.isFinite(value))
    ? ''
    : formatScaled(value, scale, decimals);
  return (
    <input
      type="text"
      id={id}
      readOnly
      aria-readonly="false"
      value={display}
      onFocus={handleFocus}
      onClick={handleFocus}
      style={{ ...style, cursor: 'text' }}
      className={className}
      placeholder={placeholder}
      data-testid={testId}
      aria-invalid={ariaInvalid}
      title={title ?? `Click to edit. Raw: ${value}`}
    />
  );
}
