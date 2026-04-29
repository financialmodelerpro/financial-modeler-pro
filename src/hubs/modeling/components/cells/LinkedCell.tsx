'use client';

import React from 'react';
import {
  fastColors, fontFamily, fontSize, fontWeight,
  semanticSpacing, type ThemeMode,
} from '@modeling/design-tokens';

export interface LinkedCellProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string | number | null | undefined;
  /** Right-align. Defaults to true since linked values are usually numeric. */
  numeric?: boolean;
  width?: string | number;
  mode?: ThemeMode;
}

/**
 * LinkedCell — FAST linked cell.
 * Read-only display of a value pulled from a different module. Green text.
 *
 * Use this when Module 4 reads a result computed in Module 1 (e.g. total
 * CapEx pulled into a returns waterfall). The green text signals to the
 * reader "this number originates somewhere else; trace it back to find the
 * upstream formula".
 */
export function LinkedCell({
  value, numeric = true, width, mode = 'light', style, ...rest
}: LinkedCellProps) {
  const c = fastColors[mode];
  return (
    <div
      style={{
        color:      c.linkedText,
        background: c.linkedBg,
        fontFamily: fontFamily.sans,
        fontSize:   fontSize.tableCell,
        fontWeight: fontWeight.semibold,
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
