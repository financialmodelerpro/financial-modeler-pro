'use client';

import React from 'react';

interface PlanBadgeProps {
  requiredPlan: 'professional' | 'enterprise';
}

const PLAN_COLOR: Record<string, string> = {
  professional: '#2563EB',
  enterprise:   '#7C3AED',
};
const PLAN_LABEL: Record<string, string> = {
  professional: 'PRO',
  enterprise:   'ENTERPRISE',
};

export default function PlanBadge({ requiredPlan }: PlanBadgeProps) {
  const color = PLAN_COLOR[requiredPlan] ?? '#2563EB';
  const label = PLAN_LABEL[requiredPlan] ?? 'PRO';
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 800,
      letterSpacing: '0.07em',
      padding: '2px 6px',
      borderRadius: 4,
      background: `${color}1A`,
      color,
      border: `1px solid ${color}40`,
      textTransform: 'uppercase',
      flexShrink: 0,
      fontFamily: 'Inter, sans-serif',
      lineHeight: 1.5,
    }}>
      {label}
    </span>
  );
}
