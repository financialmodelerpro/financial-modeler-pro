'use client';

/**
 * LivePlanCards.tsx
 *
 * Client island for the PUBLIC marketing pricing page. Receives the live plan
 * catalog (loaded + customer-filtered server-side via loadPricingCatalog +
 * visibleForCustomers) and renders the plan cards, a monthly/annual billing
 * toggle, the Trial strip (real trial length), and the comparison table.
 * Single source of truth = entitlement_plans (NOT platform_pricing).
 *
 * DESIGN: FMP navy + orange. Data is unchanged; visual only. Reuses the shared
 * display helpers (formatPlanPrice + comparisonCellText) so the public and
 * in-app pricing pages render prices/cells identically.
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

// ── FMP brand ──────────────────────────────────────────────────────────────
const NAVY = '#0D2E5A';
const NAVY_MID = '#1B4F8A';
const ORANGE = '#F97316';
const ORANGE_DARK = '#EA580C';
const ORANGE_SOFT = '#FFF7ED';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#E8EDF4';
const GREEN = '#16A34A';

const MODULE_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  coming_soon: { label: 'Coming soon', bg: '#FEF3C7', fg: '#92400E' },
  pro: { label: 'Pro', bg: '#EDE9FE', fg: '#6D28D9' },
  enterprise: { label: 'Enterprise', bg: '#E0E7FF', fg: '#3730A3' },
};
const CATEGORY_LABELS: Record<string, string> = {
  module: 'Modules', export: 'Exports', analysis: 'Analysis', platform: 'Platform', limits: 'Limits', admin: 'Admin', branding: 'Branding', ai: 'AI', general: 'General',
};

export default function LivePlanCards({
  plans, features, coverage, trialDays = 0,
}: { plans: LivePlan[]; features: LiveFeature[]; coverage: LiveCoverage[]; trialDays?: number }) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');

  const cov = new Map<string, LiveCoverage>();
  for (const c of coverage) cov.set(`${c.plan_key}::${c.feature_key}`, c);
  const cardPlans = plans.filter((p) => p.plan_key !== 'trial');
  const trial = plans.find((p) => p.plan_key === 'trial');
  const ordered = [...features].sort((a, b) => a.display_order - b.display_order);

  // Honest, data-driven savings hint: best % saved by paying annually.
  let maxSavePct = 0;
  for (const p of cardPlans) {
    if (p.price_monthly && p.price_annual && p.price_annual < p.price_monthly * 12) {
      maxSavePct = Math.max(maxSavePct, Math.round((1 - p.price_annual / (p.price_monthly * 12)) * 100));
    }
  }

  return (
    <div data-testid="live-plan-cards">
      {/* Billing toggle */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 36 }}>
        <div role="group" aria-label="Billing interval" data-testid="billing-toggle"
          style={{ display: 'inline-flex', padding: 4, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, boxShadow: '0 1px 2px rgba(13,46,90,0.06)' }}>
          {(['monthly', 'annual'] as const).map((iv) => {
            const active = interval === iv;
            return (
              <button key={iv} onClick={() => setInterval(iv)} data-testid={`billing-${iv}`} aria-pressed={active}
                style={{ padding: '8px 22px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', border: 'none', borderRadius: 999,
                  background: active ? NAVY : 'transparent', color: active ? '#fff' : MUTED, transition: 'background 0.15s, color 0.15s' }}>
                {iv === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            );
          })}
        </div>
        {maxSavePct > 0 && (
          <div style={{ fontSize: 12.5, color: ORANGE_DARK, fontWeight: 700 }}>Save up to {maxSavePct}% with annual billing</div>
        )}
      </div>

      {/* Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 24, maxWidth: 1100, margin: '0 auto', alignItems: 'stretch', paddingTop: 16 }}>
        {cardPlans.map((p) => {
          const pt = formatPlanPrice(p, interval);
          const featured = !!p.popular;
          const badge = p.badge_text || (p.popular ? 'Most Popular' : null);
          return (
            <div key={p.plan_key} data-testid={`pricing-card-${p.plan_key}`}
              style={{
                background: '#fff', borderRadius: 18, padding: '32px 26px 28px', position: 'relative',
                display: 'flex', flexDirection: 'column',
                border: featured ? `2px solid ${ORANGE}` : `1px solid ${LINE}`,
                boxShadow: featured ? `0 20px 48px -16px rgba(234,88,12,0.45)` : '0 2px 14px rgba(13,46,90,0.06)',
                transform: featured ? 'translateY(-8px)' : 'none',
              }}>
              {/* Top accent bar on the popular card */}
              {featured && <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, borderRadius: '18px 18px 0 0', background: `linear-gradient(90deg, ${ORANGE}, ${ORANGE_DARK})` }} />}
              {badge && (
                <div data-testid={`pricing-badge-${p.plan_key}`}
                  style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: featured ? `linear-gradient(90deg, ${ORANGE}, ${ORANGE_DARK})` : NAVY_MID, color: '#fff', fontSize: 10.5, fontWeight: 800, padding: '5px 16px', borderRadius: 999, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: featured ? '0 6px 16px rgba(234,88,12,0.4)' : 'none' }}>
                  {badge}
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 800, color: featured ? ORANGE_DARK : NAVY_MID, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{p.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <span data-testid={`pricing-amount-${p.plan_key}`} style={{ fontSize: 34, fontWeight: 900, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{pt.big}</span>
                {pt.sub && <span style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>{pt.sub}</span>}
              </div>
              <div style={{ height: 1, background: LINE, margin: '20px 0' }} />
              <Link href="/register" aria-label={`${p.contact_sales ? 'Contact sales about' : 'Choose'} the ${p.label} plan`}
                style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto', padding: '13px 0', borderRadius: 10, fontWeight: 800, fontSize: 14.5,
                  background: featured ? `linear-gradient(90deg, ${ORANGE}, ${ORANGE_DARK})` : '#fff',
                  color: featured ? '#fff' : NAVY,
                  border: featured ? 'none' : `1.5px solid ${NAVY}`,
                  boxShadow: featured ? '0 8px 20px -6px rgba(234,88,12,0.5)' : 'none',
                }}>
                {p.contact_sales ? 'Contact sales' : `Choose ${p.label}`}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Trial strip with the real trial length */}
      {trial && (
        <div data-testid="pricing-trial-strip"
          style={{ background: ORANGE_SOFT, border: `1px solid #FED7AA`, borderRadius: 16, padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', maxWidth: 1100, margin: '40px auto 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span aria-hidden style={{ fontSize: 26, flexShrink: 0 }}>🚀</span>
            <div style={{ fontSize: 14.5, color: '#7C2D12', lineHeight: 1.5 }}>
              <b style={{ color: ORANGE_DARK }}>New to Financial Modeler Pro?</b> Start a free{' '}
              <b data-testid="trial-days-label">{trialDays}-day</b> {trial.label} and explore the core modules. No credit card required.
            </div>
          </div>
          <Link href="/register" style={{ flexShrink: 0, fontSize: 14, fontWeight: 800, color: '#fff', background: NAVY, borderRadius: 10, padding: '11px 22px', textDecoration: 'none' }}>
            Start free {trial.label}
          </Link>
        </div>
      )}

      {/* Comparison table */}
      <div style={{ marginTop: 64, maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto' }}>
        <h2 style={{ fontSize: 26, fontWeight: 900, color: NAVY, textAlign: 'center', marginBottom: 6, letterSpacing: '-0.01em' }}>Compare every plan</h2>
        <p style={{ fontSize: 14, color: MUTED, textAlign: 'center', marginTop: 0, marginBottom: 28 }}>Everything included, side by side.</p>
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, overflow: 'hidden', overflowX: 'auto', boxShadow: '0 2px 14px rgba(13,46,90,0.06), inset -24px 0 18px -24px rgba(13,46,90,0.18)' }} data-testid="comparison-table">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: NAVY }}>
                <th scope="col" style={{ padding: '15px 22px', textAlign: 'left', fontSize: 12, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', position: 'sticky', left: 0, background: NAVY, zIndex: 1 }}>Feature</th>
                {plans.map((p) => {
                  const featured = !!p.popular;
                  return (
                    <th key={p.plan_key} scope="col" data-testid={`compare-col-${p.plan_key}`}
                      style={{ padding: '15px 16px', textAlign: 'center', fontSize: 12, fontWeight: 800, color: featured ? '#FFE7D1' : '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', borderBottom: featured ? `3px solid ${ORANGE}` : 'none' }}>
                      {p.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const rows: React.JSX.Element[] = [];
                let lastCat = '';
                let rowInCat = 0;
                ordered.forEach((f) => {
                  if (f.category !== lastCat) {
                    lastCat = f.category;
                    rowInCat = 0;
                    rows.push(
                      <tr key={`cat-${f.category}`}>
                        <td colSpan={plans.length + 1} style={{ padding: '12px 22px 8px', fontSize: 11, fontWeight: 800, color: NAVY_MID, textTransform: 'uppercase', letterSpacing: '0.1em', background: '#F1F5FB', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, position: 'sticky', left: 0 }}>
                          {CATEGORY_LABELS[f.category] || f.category}
                        </td>
                      </tr>,
                    );
                  }
                  const zebra = rowInCat % 2 === 1;
                  rowInCat++;
                  const mod = f.moduleStatus && f.moduleStatus !== 'live' ? MODULE_TAG[f.moduleStatus] : null;
                  rows.push(
                    <tr key={f.feature_key} data-testid={`compare-row-${f.feature_key}`} style={{ borderBottom: `1px solid #F2F5F9`, background: zebra ? '#FBFCFE' : '#fff' }}>
                      <td style={{ padding: '13px 22px', fontSize: 13.5, color: '#334155', fontWeight: 500, position: 'sticky', left: 0, background: zebra ? '#FBFCFE' : '#fff' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {f.label}
                          {mod && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: mod.bg, color: mod.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{mod.label}</span>}
                        </span>
                      </td>
                      {plans.map((p) => {
                        const c = cov.get(`${p.plan_key}::${f.feature_key}`);
                        const included = c?.included ?? false;
                        const txt = comparisonCellText(f.feature_type, included, c?.limit_value ?? null);
                        const isCheck = txt === '✓';
                        const isDash = txt === '–';
                        const featured = !!p.popular;
                        return (
                          <td key={p.plan_key} data-testid={`compare-cell-${p.plan_key}-${f.feature_key}`}
                            style={{ padding: '13px 16px', textAlign: 'center', fontSize: isCheck ? 17 : 13.5, fontWeight: 700, background: featured ? 'rgba(249,115,22,0.05)' : 'transparent', color: isCheck ? GREEN : isDash ? '#CBD5E1' : NAVY }}>
                            {txt}
                          </td>
                        );
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
