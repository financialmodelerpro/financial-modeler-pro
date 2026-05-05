'use client';

/**
 * FormulaCaption, M1.13/1 reusable plain-English formula display.
 *
 * Sits next to (or directly under) a derived output to explain how the
 * value was calculated. Renders a single line of meta-color text in the
 * shape:
 *
 *     <Label> = <Expression> = <Substituted with current values> = <Result Unit>
 *
 * For example:
 *
 *     Max GFA = Plot Area * Max FAR = 100,000 * 3.0 = 300,000 sqm
 *
 * Every value in the substituted expression is live (callers pass the
 * current numbers as a formatted string), so the caption recomputes in
 * place when an input edits without triggering layout reflow. The caller
 * controls formatting because different formulas need different
 * separators (* for multiply, / for divide, + for add, etc.) and the
 * unit varies (sqm, %, currency, periods).
 *
 * FAST color discipline: caption sits on transparent background, uses
 * meta color so it visually recedes behind the output value (which keeps
 * the grey calc-output style from the rest of Module 1).
 *
 * No em-dashes anywhere in the text the caller passes in (CLAUDE.md
 * writing rule, M1.11). The "=" separator is a literal equals sign.
 */

import React from 'react';

interface FormulaCaptionProps {
  /** Plain-English expression with live values already formatted in.
   *  Example: "Plot Area * Max FAR = 100,000 * 3.0 = 300,000 sqm" */
  text: string;
  /** Optional override style. Defaults to small italic meta-color. */
  style?: React.CSSProperties;
  /** Optional data-testid for Playwright targeting. */
  testId?: string;
}

const baseStyle: React.CSSProperties = {
  fontSize: 'var(--font-micro)',
  color: 'var(--color-meta)',
  fontStyle: 'italic',
  fontFamily: 'Inter, sans-serif',
  lineHeight: 1.5,
  display: 'block',
  marginTop: 2,
  whiteSpace: 'normal',
  wordBreak: 'break-word',
};

export default function FormulaCaption({ text, style, testId }: FormulaCaptionProps) {
  return (
    <span
      style={{ ...baseStyle, ...style }}
      data-testid={testId ?? 'formula-caption'}
      data-formula="true"
    >
      = {text}
    </span>
  );
}
