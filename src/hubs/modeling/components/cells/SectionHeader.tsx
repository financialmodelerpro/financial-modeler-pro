'use client';

import React from 'react';
import {
  chromeColors, fontFamily, fontSize, fontWeight,
  letterSpacing, semanticSpacing, type ThemeMode,
} from '@modeling/design-tokens';

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Section title. Rendered as uppercase. */
  children: React.ReactNode;
  /** Right-side trailing content (count, badge, action). */
  trailing?: React.ReactNode;
  mode?: ThemeMode;
}

/**
 * SectionHeader — navy band used for table section headers and module
 * sub-headings. White uppercase text on a chrome navy background.
 */
export function SectionHeader({
  children, trailing, mode = 'light', style, ...rest
}: SectionHeaderProps) {
  const c = chromeColors[mode];
  return (
    <div
      style={{
        background:    c.sectionHeader,
        color:         c.sectionHeaderText,
        fontFamily:    fontFamily.sans,
        fontSize:      fontSize.label,
        fontWeight:    fontWeight.bold,
        letterSpacing: letterSpacing.uppercase,
        textTransform: 'uppercase',
        padding:       `${semanticSpacing.tablePaddingY}px ${semanticSpacing.tablePaddingX}px`,
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        gap:           semanticSpacing.inlineGap,
        ...style,
      }}
      {...rest}
    >
      <span>{children}</span>
      {trailing != null && <span>{trailing}</span>}
    </div>
  );
}
