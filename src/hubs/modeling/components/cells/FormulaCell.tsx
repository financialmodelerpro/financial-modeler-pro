'use client';

import React from 'react';
import {
  fastColors, fontFamily, fontSize, fontWeight,
  semanticSpacing, type ThemeMode,
} from '@modeling/design-tokens';

export interface FormulaCellProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string | number | null | undefined;
  /** Right-align. Defaults to true since formulas are almost always numeric. */
  numeric?: boolean;
  width?: string | number;
  mode?: ThemeMode;
}

/**
 * FormulaCell — FAST formula cell.
 * Read-only display of a calculated value. Black text on light grey bg.
 */
export function FormulaCell({
  value, numeric = true, width, mode = 'light', style, ...rest
}: FormulaCellProps) {
  const c = fastColors[mode];
  return (
    <div
      style={{
        color:      c.formulaText,
        background: c.formulaBg,
        fontFamily: fontFamily.sans,
        fontSize:   fontSize.tableCell,
        fontWeight: fontWeight.normal,
        textAlign:  numeric ? 'right' : 'left',
        padding:    `${semanticSpacing.tablePaddingY}px ${semanticSpacing.tablePaddingX}px`,
        width:      width ?? '100%',
        boxSizing:  'border-box',
        ...style,
      }}
      {...rest}
    >
      {value ?? '—'}
    </div>
  );
}
