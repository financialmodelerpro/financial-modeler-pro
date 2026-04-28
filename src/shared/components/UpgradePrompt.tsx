'use client';

import React from 'react';

type SubscriptionPlan = 'free' | 'professional' | 'enterprise';

// ── Human-readable labels for every feature key ───────────────────────────────
const FEATURE_LABELS: Record<string, string> = {
  module_1:           'Module 1 - Project Setup',
  module_2:           'Module 2 - Revenue Analysis',
  module_3:           'Module 3 - Operating Expenses',
  module_4:           'Module 4 - Returns & Valuation',
  module_5:           'Module 5 - Financial Statements',
  module_6:           'Module 6 - Reports & Export',
  module_7:           'Module 7 - Scenario Analysis',
  module_8:           'Module 8 - Portfolio Dashboard',
  module_9:           'Module 9 - Market Data',
  module_10:          'Module 10 - Collaboration',
  module_11:          'Module 11 - API Access',
  module_8_full:      'Portfolio Full Edit',
  module_9_full:      'Market Data Full Metrics',
  ai_contextual:      'AI Contextual Assist',
  ai_research:        'AI Research Agent',
  pdf_basic:          'PDF Export',
  pdf_full:           'Full PDF Export',
  pdf_whitelabel:     'White-Label PDF Export',
  excel_static:       'Excel Export',
  excel_formula:      'Formula Excel Export',
  admin_panel:        'Admin Panel',
  projects_10:        'Up to 10 Projects',
  projects_unlimited: 'Unlimited Projects',
};

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free:         'Free',
  professional: 'Professional',
  enterprise:   'Enterprise',
};

const PLAN_COLOR: Record<SubscriptionPlan, string> = {
  free:         '#6b7280',
  professional: '#2563EB',
  enterprise:   '#7C3AED',
};

// ── Props ─────────────────────────────────────────────────────────────────────
export interface UpgradePromptProps {
  /** The feature key that is locked */
  featureKey: string;
  /** The minimum plan that unlocks it */
  requiredPlan: SubscriptionPlan;
  /** Optional: render inline (compact banner) vs card (larger) */
  variant?: 'card' | 'inline' | 'overlay';
  /** Optional: custom message */
  message?: string;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function UpgradePrompt({
  featureKey,
  requiredPlan,
  variant = 'card',
  message,
  className,
}: UpgradePromptProps) {
  const featureLabel = FEATURE_LABELS[featureKey] ?? featureKey;
  const planLabel    = PLAN_LABELS[requiredPlan];
  const planColor    = PLAN_COLOR[requiredPlan];

  if (variant === 'inline') {
    return (
      <div
        className={className}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          background: `${planColor}12`,
          border: `1px solid ${planColor}30`,
          borderRadius: 6,
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <span style={{ fontSize: 14 }}>🔒</span>
        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>
          {message ?? `${featureLabel} requires the`}{' '}
          <strong style={{ color: planColor }}>{planLabel}</strong> plan.
        </span>
        <a
          href="/settings"
          style={{
            fontSize: 11, fontWeight: 700, color: '#fff',
            background: planColor, padding: '3px 10px', borderRadius: 20,
            textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Upgrade →
        </a>
      </div>
    );
  }

  if (variant === 'overlay') {
    return (
      <div
        className={className}
        style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'inherit',
        }}
      >
        <div style={{ textAlign: 'center', padding: '20px 24px', maxWidth: 320 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
            {featureLabel}
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16, lineHeight: 1.6 }}>
            {message ?? `This feature is available on the ${planLabel} plan and above.`}
          </div>
          <a
            href="/settings"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 20px', borderRadius: 6, textDecoration: 'none',
              background: planColor, color: '#fff',
              fontSize: 13, fontWeight: 700, fontFamily: 'Inter, sans-serif',
            }}
          >
            Upgrade to {planLabel} →
          </a>
        </div>
      </div>
    );
  }

  // Default: card
  return (
    <div
      className={className}
      style={{
        background: '#fff',
        border: `1.5px solid ${planColor}30`,
        borderLeft: `4px solid ${planColor}`,
        borderRadius: 8,
        padding: '20px 24px',
        fontFamily: 'Inter, sans-serif',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        {/* Lock icon */}
        <div style={{
          width: 40, height: 40, borderRadius: 8, flexShrink: 0,
          background: `${planColor}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>
          🔒
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
              {featureLabel}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: `${planColor}18`, color: planColor,
              border: `1px solid ${planColor}30`, letterSpacing: '0.06em',
              textTransform: 'uppercase' as const,
            }}>
              {planLabel}
            </span>
          </div>

          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 14px', lineHeight: 1.6 }}>
            {message ?? `This feature is included in the ${planLabel} plan. Upgrade to unlock it.`}
          </p>

          <a
            href="/settings"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 6, textDecoration: 'none',
              background: planColor, color: '#fff',
              fontSize: 13, fontWeight: 700,
            }}
          >
            Upgrade to {planLabel} →
          </a>
        </div>
      </div>
    </div>
  );
}
