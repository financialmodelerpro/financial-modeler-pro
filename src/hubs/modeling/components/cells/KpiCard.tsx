'use client';

import React from 'react';
import {
  chromeColors, fastColors, fontFamily, fontSize, fontWeight,
  letterSpacing, semanticSpacing, radius, type ThemeMode,
} from '@modeling/design-tokens';

/**
 * KpiCard supports a small palette of value-colour intents:
 *   'formula' — calculated number, neutral chrome (default)
 *   'input'   — derived directly from a user input (blue)
 *   'linked'  — pulled cross-module (green)
 *   'positive'/'negative' — for variance + return KPIs that benefit from
 *                            sign signalling
 */
export type KpiTone = 'formula' | 'input' | 'linked' | 'positive' | 'negative';

export interface KpiCardProps {
  label:    string;
  value:    string | number;
  /** Optional sub-line beneath the value (e.g. "vs last quarter"). */
  sub?:     string;
  /** Colour intent for the value. Defaults to 'formula'. */
  tone?:    KpiTone;
  mode?:    ThemeMode;
  style?:   React.CSSProperties;
}

/**
 * KpiCard — corporate chrome card with a FAST-coloured value.
 * Used on Dashboard / Overview / Module 1 Financing / Module 9 Market Data
 * for at-a-glance numbers.
 */
export function KpiCard({
  label, value, sub, tone = 'formula', mode = 'light', style,
}: KpiCardProps) {
  const chrome = chromeColors[mode];
  const fast   = fastColors[mode];

  const valueColor = (() => {
    switch (tone) {
      case 'input':    return fast.inputText;
      case 'linked':   return fast.linkedText;
      case 'positive': return fast.linkedText;
      case 'negative': return fast.externalText;
      case 'formula':
      default:         return chrome.textHeading;
    }
  })();

  return (
    <div
      style={{
        background:   chrome.surface,
        border:       `1px solid ${chrome.border}`,
        borderRadius: radius.lg,
        padding:      semanticSpacing.cardPadding,
        boxShadow:    '0 1px 3px rgba(0,0,0,0.04)',
        fontFamily:   fontFamily.sans,
        ...style,
      }}
    >
      <div style={{
        fontSize:      fontSize.kpiLabel,
        fontWeight:    fontWeight.semibold,
        color:         chrome.textMuted,
        textTransform: 'uppercase',
        letterSpacing: letterSpacing.uppercase,
        marginBottom:  semanticSpacing.rowGap / 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize:   fontSize.kpiNumber,
        fontWeight: fontWeight.bold,
        color:      valueColor,
        lineHeight: 1.2,
      }}>
        {value}
      </div>
      {sub != null && (
        <div style={{
          fontSize:   fontSize.caption,
          color:      chrome.textMuted,
          marginTop:  semanticSpacing.rowGap / 2,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}
