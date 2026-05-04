'use client';

/**
 * InputLabel — M1.10b/3 reusable label-with-tooltip primitive.
 *
 * Renders a uppercase-style field label (matches the existing labelStyle
 * tokens used across Module1Area / Module1Timeline / Module1AreaProgram /
 * etc.) followed by a small ⓘ icon button. Hover or keyboard focus on
 * the icon reveals a plain-English tooltip explaining what the input
 * does.
 *
 * Accessibility:
 *   - Trigger is a real <button> so it joins the tab order naturally.
 *   - Tooltip is identified by aria-describedby on the trigger so AT
 *     announces it on focus.
 *   - Esc key while focused dismisses the tooltip.
 *   - Tooltip is absolutely-positioned (lifts out of layout flow) so
 *     opening it never reflows the surrounding form.
 *
 * Light + dark mode work via the same CSS custom properties already in
 * globals.css. No external tooltip library — Radix would be a heavier
 * add than this primitive justifies.
 */

import React, { useEffect, useRef, useState } from 'react';

interface InputLabelProps {
  label: string;
  help?: string;
  /** Optional id for the input the label decorates. Forwarded to the
   *  underlying span via data-input-id so consumers can wire htmlFor
   *  manually if needed (this primitive doesn't render a <label> to keep
   *  click-through behaviour predictable across the existing inline +
   *  modal layouts). */
  inputId?: string;
  /** Optional override style for the label text (e.g. smaller font in
   *  the wizard's dense grids). */
  textStyle?: React.CSSProperties;
}

const defaultTextStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function InputLabel({ label, help, inputId, textStyle }: InputLabelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = inputId ? `tt_${inputId}` : `tt_${label.replace(/[^a-zA-Z0-9]/g, '_')}`;

  // Esc closes; click-outside closes; focus-out closes.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    function handleClickOutside(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,
        position: 'relative',
        ...defaultTextStyle,
        ...textStyle,
      }}
      data-testid={`input-label-${tooltipId}`}
    >
      <span data-input-id={inputId}>{label}</span>
      {help && (
        <>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            aria-label={`Help: ${label}`}
            aria-describedby={open ? tooltipId : undefined}
            aria-expanded={open}
            style={{
              width: 14,
              height: 14,
              padding: 0,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-meta)',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'help',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1,
            }}
            data-testid={`input-help-${tooltipId}`}
          >
            ⓘ
          </button>
          {open && (
            <span
              role="tooltip"
              id={tooltipId}
              data-testid={`input-tooltip-${tooltipId}`}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                padding: '8px 10px',
                background: 'var(--color-heading)',
                color: 'var(--color-surface)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 11,
                fontWeight: 'var(--fw-normal)',
                lineHeight: 1.5,
                letterSpacing: 'normal',
                textTransform: 'none',
                width: 260,
                maxWidth: 'calc(100vw - 32px)',
                zIndex: 50,
                boxShadow: '0 8px 16px rgba(0,0,0,0.15)',
                pointerEvents: 'none',
              }}
            >
              {help}
            </span>
          )}
        </>
      )}
    </span>
  );
}
