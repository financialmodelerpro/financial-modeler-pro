/**
 * inputStyles.ts (M4 Pass 2M-B3, 2026-05-20)
 *
 * One source of truth for the FAST input style used across every
 * Module 1-4 surface. Previously each module defined its own
 * constant (M1 = inputStyle, M2 = FAST_INPUT, M4 = FAST_INPUT, M3 =
 * unnamed) producing the same visual but introducing cognitive
 * friction in audits. All modules should import FAST_INPUT from
 * here.
 *
 * Locked rule (feedback_ui_universal_defaults rule 8):
 *   Every number input in M1-M4 uses FAST_INPUT (yellow / navy-pale
 *   background, navy text, 12px font, 4-6px padding). Per-platform
 *   variants live in their own _shared/ module, not inlined.
 */

import type React from 'react';

export const FAST_INPUT: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-navy-pale, color-mix(in srgb, var(--color-navy) 8%, white))',
  color: 'var(--color-navy)',
  fontSize: 12,
};
