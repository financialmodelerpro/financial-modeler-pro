'use client';

import React from 'react';

type SubscriptionPlan = 'free' | 'professional' | 'enterprise';

// ── Human-readable labels for NON-MODULE feature keys ────────────────────────
//
// MODULE KEYS ARE DELIBERATELY ABSENT. They used to live here, hand-written,
// and they went stale twice: migration 157 swapped reports and scenarios and
// this map never followed, so it called module_4 "Returns & Valuation" and
// module_5 "Financial Statements" when the registry says the opposite, and
// module_6 / module_7 were crossed the same way. A user clicking a locked
// Module 4 was told to buy a module that is not the one they clicked.
//
// A module's name and number now arrive as the `label` prop, resolved by the
// platform from the LIVE platform_modules registry, so this file cannot fall
// out of date a third time. It is not a shortcut: `shared` may import only
// core / shared / integ (eslint boundaries), and the registry lives under
// src/hubs/modeling/platforms/refm, so a shared component CANNOT read it. The
// only correct direction is for the platform, which already holds the derived
// list for its sidebar, to pass the answer in.
//
// module_8_full / module_9_full stay: they are separate entitlement keys, not
// module rows (they do not match /^module_\d+$/), so the registry has no
// opinion about them.
const FEATURE_LABELS: Record<string, string> = {
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
  /** The resolved display label. For a MODULE this is derived from the live
   *  registry by the platform and is the only correct source (see the map
   *  above); for anything else the map below answers. */
  label?: string;
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
  label,
  featureKey,
  requiredPlan,
  variant = 'card',
  message,
  className,
}: UpgradePromptProps) {
  // The passed label WINS. A module always supplies one; the map is for the
  // non-module keys it still owns, and the raw key is the last resort.
  const featureLabel = label ?? FEATURE_LABELS[featureKey] ?? featureKey;
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
