'use client';

/**
 * LivePlanCards.tsx
 *
 * Client island for the PUBLIC marketing pricing page. Receives the live plan
 * catalog (already loaded + customer-filtered server-side via loadPricingCatalog
 * + visibleForCustomers) and renders the plan cards with a monthly/annual
 * billing toggle plus the comparison table. Single source of truth =
 * entitlement_plans (NOT the old platform_pricing). Hero + FAQ stay on the
 * server page (Page Builder), this island is only the cards + comparison.
 *
 * Reuses the shared display helpers (formatPlanPrice + comparisonCellText) so
 * the public and in-app pricing pages render prices/cells identically.
 *
 * No em dashes in this file.
 */
import { useState } from 'react';
import Link from 'next/link';
import { formatPlanPrice, comparisonCellText, type BillingInterval } from '@/src/shared/entitlements/pricingDisplay';

export interface LivePlan {
  plan_key: string; label: string;
  price_monthly: number | null; price_annual: number | null; currency: string | null;
  contact_sales: boolean; popular: boolean; badge_text: string | null;
}
export interface LiveFeature {
  feature_key: string; label: string; category: string;
  feature_type: 'gate' | 'limit' | 'metered'; display_order: number;
  moduleStatus?: 'live' | 'coming_soon' | 'pro' | 'enterprise';
}
export interface LiveCoverage { plan_key: string; feature_key: string; included: boolean; limit_value: number | null }

const MODULE_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  coming_soon: { label: 'Coming soon', bg: '#fef3c7', fg: '#92400e' },
  pro: { label: 'Pro', bg: '#ede9fe', fg: '#6d28d9' },
  enterprise: { label: 'Enterprise', bg: '#e0e7ff', fg: '#3730a3' },
};
const CATEGORY_LABELS: Record<string, string> = {
  module: 'Modules', export: 'Exports', analysis: 'Analysis', platform: 'Platform', limits: 'Limits', admin: 'Admin', branding: 'Branding', ai: 'AI', general: 'General',
};

export default function LivePlanCards({ plans, features, coverage }: { plans: LivePlan[]; features: LiveFeature[]; coverage: LiveCoverage[] }) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');

  const cov = new Map<string, LiveCoverage>();
  for (const c of coverage) cov.set(`${c.plan_key}::${c.feature_key}`, c);
  const cardPlans = plans.filter((p) => p.plan_key !== 'trial');
  const trial = plans.find((p) => p.plan_key === 'trial');
  const ordered = [...features].sort((a, b) => a.display_order - b.display_order);

  return (
    <div data-testid="live-plan-cards">
      {/* Billing toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }} data-testid="billing-toggle">
        {(['monthly', 'annual'] as const).map((iv) => (
          <button key={iv} onClick={() => setInterval(iv)} data-testid={`billing-${iv}`}
            style={{ padding: '9px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid #cbd5e1',
              background: interval === iv ? '#0D2E5A' : '#fff', color: interval === iv ? '#fff' : '#475569',
              borderRadius: iv === 'monthly' ? '8px 0 0 8px' : '0 8px 8px 0' }}>
            {iv === 'monthly' ? 'Monthly' : 'Annual'}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 24, maxWidth: 1080, margin: '0 auto' }}>
        {cardPlans.map((p) => {
          const pt = formatPlanPrice(p, interval);
          const featured = !!p.popular;
          const badge = p.badge_text || (p.popular ? 'Most Popular' : null);
          return (
            <div key={p.plan_key} data-testid={`pricing-card-${p.plan_key}`}
              style={{ background: featured ? '#1B4F8A' : '#fff', border: `2px solid ${featured ? 'transparent' : '#E5E7EB'}`, borderRadius: 16, padding: '34px 26px', position: 'relative', boxShadow: featured ? '0 12px 48px rgba(27,79,138,0.3)' : '0 2px 12px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
              {badge && <div data-testid={`pricing-badge-${p.plan_key}`} style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: '#1ABC9C', color: '#fff', fontSize: 10, fontWeight: 700, padding: '4px 16px', borderRadius: 20, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{badge}</div>}
              <div style={{ fontSize: 12, fontWeight: 700, color: featured ? 'rgba(255,255,255,0.6)' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{p.label}</div>
              <div data-testid={`pricing-amount-${p.plan_key}`} style={{ fontSize: 26, fontWeight: 800, color: featured ? '#fff' : '#1B3A6B', marginBottom: 2 }}>{pt.big}</div>
              <div style={{ fontSize: 12, color: featured ? 'rgba(255,255,255,0.55)' : '#94a3b8', minHeight: 16, marginBottom: 20 }}>{pt.sub}</div>
              <Link href="/register" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto', padding: '12px 0', borderRadius: 8, fontWeight: 700, fontSize: 14, background: featured ? 'rgba(255,255,255,0.18)' : '#1B4F8A', color: '#fff', border: featured ? '1px solid rgba(255,255,255,0.3)' : 'none' }}>
                {p.contact_sales ? 'Contact sales' : `Choose ${p.label}`}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Trial = request-access path */}
      {trial && (
        <div data-testid="pricing-trial-strip" style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', maxWidth: 1080, margin: '24px auto 0' }}>
          <div style={{ fontSize: 14, color: '#475569' }}><b style={{ color: '#0D2E5A' }}>New here?</b> Start a free {trial.label} to try the core modules. No credit card required.</div>
          <Link href="/register" style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', border: '1px solid #0D2E5A', borderRadius: 8, padding: '10px 20px', textDecoration: 'none' }}>Start free {trial.label}</Link>
        </div>
      )}

      {/* Comparison table */}
      <div style={{ marginTop: 56, maxWidth: 1080, marginLeft: 'auto', marginRight: 'auto' }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', textAlign: 'center', marginBottom: 32 }}>Feature Comparison</h2>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden', overflowX: 'auto', boxShadow: 'inset -24px 0 18px -24px rgba(13,46,90,0.25)' }} data-testid="comparison-table">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ background: '#1B4F8A' }}>
                <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                {plans.map((p) => <th key={p.plan_key} data-testid={`compare-col-${p.plan_key}`} style={{ padding: '14px 16px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const rows: React.JSX.Element[] = [];
                let lastCat = '';
                ordered.forEach((f, fi) => {
                  if (f.category !== lastCat) {
                    lastCat = f.category;
                    rows.push(
                      <tr key={`cat-${f.category}`}><td colSpan={plans.length + 1} style={{ padding: '10px 20px 6px', fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>{CATEGORY_LABELS[f.category] || f.category}</td></tr>,
                    );
                  }
                  const mod = f.moduleStatus && f.moduleStatus !== 'live' ? MODULE_TAG[f.moduleStatus] : null;
                  rows.push(
                    <tr key={f.feature_key} data-testid={`compare-row-${f.feature_key}`} style={{ borderBottom: '1px solid #F3F4F6', background: fi % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                      <td style={{ padding: '12px 20px', fontSize: 13, color: '#374151' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{f.label}{mod && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: mod.bg, color: mod.fg }}>{mod.label}</span>}</span>
                      </td>
                      {plans.map((p) => {
                        const c = cov.get(`${p.plan_key}::${f.feature_key}`);
                        const txt = comparisonCellText(f.feature_type, c?.included ?? false, c?.limit_value ?? null);
                        return <td key={p.plan_key} data-testid={`compare-cell-${p.plan_key}-${f.feature_key}`} style={{ padding: '12px 16px', textAlign: 'center', fontSize: txt === '✓' ? 16 : 13, fontWeight: 600, color: c?.included ? '#2EAA4A' : '#D1D5DB' }}>{txt}</td>;
                      })}
                    </tr>,
                  );
                });
                return rows;
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
