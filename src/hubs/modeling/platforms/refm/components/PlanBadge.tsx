'use client';

import React from 'react';
import { PLAN_COLOR as TOKEN_PLAN_COLOR } from '@/src/styles/tokens';

interface PlanBadgeProps {
  requiredPlan: 'professional' | 'enterprise';
}

// Plan tier base colour. Professional flows through the brand navy CSS var
// so the badge follows the REFM workspace dark-mode override; enterprise
// pulls the brand-locked purple from tokens.ts (intentionally off-canon —
// see PLAN_COLOR comment in src/styles/tokens.ts). bg + border are derived
// from the base via color-mix so the original 10% / 25% alpha relationship
// is preserved without inline hex suffixes.
const PLAN_COLOR: Record<string, string> = {
  professional: 'var(--color-navy)',
  enterprise:   TOKEN_PLAN_COLOR.enterprise.color,
};
const PLAN_LABEL: Record<string, string> = {
  professional: 'PRO',
  enterprise:   'ENTERPRISE',
};

export default function PlanBadge({ requiredPlan }: PlanBadgeProps) {
  const color = PLAN_COLOR[requiredPlan] ?? PLAN_COLOR.professional;
  const label = PLAN_LABEL[requiredPlan] ?? 'PRO';
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 800,
      letterSpacing: '0.07em',
      padding: '2px 6px',
      borderRadius: 4,
      background: `color-mix(in srgb, ${color} 10%, transparent)`,
      color,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      textTransform: 'uppercase',
      flexShrink: 0,
      fontFamily: 'Inter, sans-serif',
      lineHeight: 1.5,
    }}>
      {label}
    </span>
  );
}
