'use client';

import React from 'react';
import {
  chromeColors, fontFamily, fontSize, fontWeight,
  letterSpacing, semanticSpacing, type ThemeMode,
} from '@modeling/design-tokens';

export interface TableHeaderProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-align numeric headers. Default false (left). */
  numeric?: boolean;
  mode?: ThemeMode;
}

/**
 * TableHeader — `<th>` cell for data tables. Navy chrome, white uppercase
 * text. Designed to be used inside a <thead><tr>.
 */
export function TableHeader({
  numeric = false, mode = 'light', style, children, ...rest
}: TableHeaderProps) {
  const c = chromeColors[mode];
  return (
    <th
      style={{
        background:    c.tableHeader,
        color:         c.tableHeaderText,
        fontFamily:    fontFamily.sans,
        fontSize:      fontSize.label,
        fontWeight:    fontWeight.bold,
        letterSpacing: letterSpacing.uppercase,
        textTransform: 'uppercase',
        textAlign:     numeric ? 'right' : 'left',
        padding:       `${semanticSpacing.tablePaddingY}px ${semanticSpacing.tablePaddingX}px`,
        whiteSpace:    'nowrap',
        ...style,
      }}
      {...rest}
    >
      {children}
    </th>
  );
}
