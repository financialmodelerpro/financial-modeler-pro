'use client';

import React, { forwardRef } from 'react';
import {
  fastColors, fontFamily, fontSize, fontWeight,
  semanticSpacing, radius, type ThemeMode,
} from '@modeling/design-tokens';

export interface InputCellProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'number' | 'date';
  width?: string | number;
  /** Theme mode. Defaults to 'light'. Threaded explicitly rather than via context for Phase 1 simplicity. */
  mode?: ThemeMode;
}

/**
 * InputCell — FAST input cell.
 * Hardcoded user input. Blue text on white background. Editable.
 *
 * Use <AssumptionCell> instead when the cell is a key driver assumption that
 * should stand out (yellow background).
 */
export const InputCell = forwardRef<HTMLInputElement, InputCellProps>(function InputCell(
  { type = 'text', width, mode = 'light', style, ...rest },
  ref,
) {
  const c = fastColors[mode];
  return (
    <input
      ref={ref}
      type={type}
      style={{
        color:        c.inputText,
        background:   c.inputBg,
        fontFamily:   fontFamily.sans,
        fontSize:     fontSize.tableCell,
        fontWeight:   fontWeight.semibold,
        textAlign:    type === 'number' ? 'right' : 'left',
        padding:      `${semanticSpacing.tablePaddingY}px ${semanticSpacing.tablePaddingX}px`,
        border:       `1px solid ${c.formulaBg}`,
        borderRadius: radius.sm,
        width:        width ?? '100%',
        boxSizing:    'border-box',
        ...style,
      }}
      {...rest}
    />
  );
});
