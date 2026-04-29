'use client';

import React, { forwardRef } from 'react';
import {
  fastColors, fontFamily, fontSize, fontWeight,
  semanticSpacing, radius, type ThemeMode,
} from '@modeling/design-tokens';

export interface AssumptionCellProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'number' | 'date';
  width?: string | number;
  mode?: ThemeMode;
}

/**
 * AssumptionCell — FAST key-driver assumption cell.
 * Yellow background plus blue text. Still an editable input — yellow signals
 * "this is one of the small set of inputs that drives the model" (e.g. Land
 * Cash on Module 1 Costs, RETT %, Royal Commission Premium).
 *
 * Use <InputCell> for the long tail of editable inputs that are not flagged
 * as primary drivers.
 */
export const AssumptionCell = forwardRef<HTMLInputElement, AssumptionCellProps>(function AssumptionCell(
  { type = 'text', width, mode = 'light', style, ...rest },
  ref,
) {
  const c = fastColors[mode];
  return (
    <input
      ref={ref}
      type={type}
      style={{
        color:        c.assumptionText,
        background:   c.assumptionBg,
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
