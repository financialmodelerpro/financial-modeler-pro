'use client';

/**
 * LivePlanCards.tsx
 *
 * Client island for the PUBLIC marketing pricing page. Receives the live plan
 * catalog (loaded + customer-filtered server-side via loadPricingCatalog +
 * visibleForCustomers) and renders FOUR plan cards (Trial first), a
 * monthly/annual billing toggle, and the comparison table.
 * Single source of truth = entitlement_plans (NOT platform_pricing).
 *
 * DESIGN: FMP navy primary + the brand gold token (#C9A84C, app/globals.css
 * --color-fmp-gold) as the only accent. No orange anywhere. The card row and
 * the comparison table share ONE grid template (a left feature-label column
 * outside the plan lanes + four equal plan lanes), so every plan column lines
 * up exactly under its card and the two can never drift apart. Data is
 * unchanged; visual + layout only. Reuses the shared display helpers
 * (formatPlanPrice + comparisonCellText) so the public and in-app pricing pages
 * render prices/cells identically.
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

// ── FMP brand: navy primary, gold accent (the existing brand token) ──────────
const NAVY = '#0D2E5A';
const NAVY_MID = '#1B4F8A';
const GOLD = '#C9A84C';                       // --color-fmp-gold
const GOLD_DARK = '#92400E';                  // --color-fmp-gold-dark
const GOLD_LIGHT = '#FDF6E3';                 // --color-fmp-gold-light
const GOLD_GLOW = 'rgba(201,168,76,0.40)';    // alpha of GOLD, featured shadow
const GOLD_TINT = 'rgba(201,168,76,0.12)';    // featured comparison lane wash
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#E8EDF4';
const GREEN = '#16A34A';

// ── Shared column geometry (drives BOTH the cards and the comparison) ────────
const LABEL_W = 200;                          // feature-label column, outside the lanes
const GAP = 16;                               // column gap, identical in both grids

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

  // ONE ordered plan list used by the cards AND the comparison columns, so they
  // are one-to-one and cannot drift. Trial is forced first; the rest keep their
  // catalog (display_order) order.
  const trial = plans.find((p) => p.plan_key === 'trial');
  const rest = plans.filter((p) => p.plan_key !== 'trial');
  const displayPlans = trial ? [trial, ...rest] : rest;

  const N = displayPlans.length;
  const GRID = `${LABEL_W}px repeat(${N}, minmax(0, 1fr))`;
  const INNER_MIN = LABEL_W + N * 188; // keeps four lanes readable; scrolls if narrower

  const ordered = [...features].sort((a, b) => a.display_order - b.display_order);

  // Honest, data-driven savings hint: best % saved by paying annually.
  let maxSavePct = 0;
  for (const p of displayPlans) {
    if (p.price_monthly && p.price_annual && p.price_annual < p.price_monthly * 12) {
      maxSavePct = Math.max(maxSavePct, Math.round((1 - p.price_annual / (p.price_monthly * 12)) * 100));
    }
  }

  const rowGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: GRID, columnGap: GAP };

  return (
    <div data-testid="live-plan-cards">
      {/* Billing toggle (active state = navy) */}
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
          <div style={{ fontSize: 12.5, color: GOLD_DARK, fontWeight: 700 }}>Save up to {maxSavePct}% with annual billing</div>
        )}
      </div>

      {/* Cards + comparison live in ONE horizontal scroll context that shares the
          same grid template, so the four plan columns stay locked under the four
          cards at every width (the whole block scrolls together when narrow). */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 6 }}>
        <div style={{ minWidth: INNER_MIN, paddingTop: 22 }}>

          {/* ── Card row: empty spacer over the feature-label column, then 4 cards ── */}
          <div style={{ ...rowGrid, alignItems: 'stretch' }}>
            <div aria-hidden />
            {displayPlans.map((p) => {
              const featured = !!p.popular;
              const isTrial = p.plan_key === 'trial';
              const badge = p.badge_text || (p.popular ? 'Most Popular' : null);
              const pt = formatPlanPrice(p, interval);
              return (
                <div key={p.plan_key} data-testid={`pricing-card-${p.plan_key}`}
                  style={{
                    background: '#fff', borderRadius: 18, padding: '32px 22px 26px', position: 'relative',
                    display: 'flex', flexDirection: 'column',
                    border: featured ? `2px solid ${GOLD}` : `1px solid ${LINE}`,
                    boxShadow: featured ? `0 20px 48px -16px ${GOLD_GLOW}` : '0 2px 14px rgba(13,46,90,0.06)',
                    transform: featured ? 'translateY(-8px)' : 'none',
                  }}>
                  {/* Top accent bar on the popular card (gold) */}
                  {featured && <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, borderRadius: '18px 18px 0 0', background: GOLD }} />}
                  {badge && (
                    <div data-testid={`pricing-badge-${p.plan_key}`}
                      style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: featured ? GOLD : NAVY_MID, color: featured ? NAVY : '#fff', fontSize: 10.5, fontWeight: 800, padding: '5px 16px', borderRadius: 999, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: featured ? '0 6px 16px rgba(201,168,76,0.45)' : 'none' }}>
                      {badge}
                    </div>
                  )}

                  <div style={{ fontSize: 12, fontWeight: 800, color: featured ? GOLD_DARK : NAVY_MID, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{p.label}</div>

                  {isTrial ? (
                    // Trial: no price. Show the single-source trial length + a clear
                    // request-access call to action (the gated /register path).
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span data-testid="trial-days-label" style={{ fontSize: 34, fontWeight: 900, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{trialDays} days</span>
                        <span style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>free</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: GOLD_DARK, fontWeight: 700, marginTop: 6 }}>No credit card required</div>
                      <div style={{ height: 1, background: LINE, margin: '20px 0' }} />
                      <Link href="/register" aria-label={`Start a free ${trialDays}-day trial`}
                        style={{
                          display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto', padding: '13px 0', borderRadius: 10, fontWeight: 800, fontSize: 14.5,
                          background: GOLD_LIGHT, color: GOLD_DARK, border: `1.5px solid ${GOLD}`,
                        }}>
                        Start free trial
                      </Link>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span data-testid={`pricing-amount-${p.plan_key}`} style={{ fontSize: 34, fontWeight: 900, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{pt.big}</span>
                        {pt.sub && <span style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>{pt.sub}</span>}
                      </div>
                      <div style={{ height: 1, background: LINE, margin: '20px 0' }} />
                      <Link href="/register" aria-label={`${p.contact_sales ? 'Contact sales about' : 'Choose'} the ${p.label} plan`}
                        style={{
                          display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto', padding: '13px 0', borderRadius: 10, fontWeight: 800, fontSize: 14.5,
                          background: featured ? GOLD : '#fff',
                          color: featured ? NAVY : NAVY,
                          border: featured ? `1.5px solid ${GOLD}` : `1.5px solid ${NAVY}`,
                          boxShadow: featured ? `0 8px 20px -6px ${GOLD_GLOW}` : 'none',
                        }}>
                        {p.contact_sales ? 'Contact sales' : `Choose ${p.label}`}
                      </Link>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Comparison: same grid template, so columns sit under their cards ── */}
          <div style={{ marginTop: 56 }}>
            <h2 style={{ fontSize: 26, fontWeight: 900, color: NAVY, textAlign: 'center', marginBottom: 6, letterSpacing: '-0.01em' }}>Compare every plan</h2>
            <p style={{ fontSize: 14, color: MUTED, textAlign: 'center', marginTop: 0, marginBottom: 28 }}>Everything included, side by side.</p>

            <div data-testid="comparison-table" role="table" aria-label="Compare every plan"
              style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 14px rgba(13,46,90,0.06)' }}>
              {/* Header row */}
              <div role="row" style={{ ...rowGrid, background: NAVY }}>
                <div role="columnheader" style={{ padding: '15px 22px', textAlign: 'left', fontSize: 12, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Feature</div>
                {displayPlans.map((p) => {
                  const featured = !!p.popular;
                  return (
                    <div key={p.plan_key} role="columnheader" data-testid={`compare-col-${p.plan_key}`}
                      style={{ padding: '15px 12px', textAlign: 'center', fontSize: 12, fontWeight: 800, color: featured ? GOLD : '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', boxShadow: featured ? `inset 0 -3px 0 ${GOLD}` : 'none' }}>
                      {p.label}
                    </div>
                  );
                })}
              </div>

              {/* Body */}
              {(() => {
                const rows: React.JSX.Element[] = [];
                let lastCat = '';
                let rowInCat = 0;
                ordered.forEach((f) => {
                  if (f.category !== lastCat) {
                    lastCat = f.category;
                    rowInCat = 0;
                    rows.push(
                      <div key={`cat-${f.category}`} role="row" style={{ display: 'grid', gridTemplateColumns: '1fr' }}>
                        <div style={{ gridColumn: '1 / -1', padding: '12px 22px 8px', fontSize: 11, fontWeight: 800, color: NAVY_MID, textTransform: 'uppercase', letterSpacing: '0.1em', background: '#F1F5FB', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
                          {CATEGORY_LABELS[f.category] || f.category}
                        </div>
                      </div>,
                    );
                  }
                  const zebra = rowInCat % 2 === 1;
                  rowInCat++;
                  const mod = f.moduleStatus && f.moduleStatus !== 'live' ? MODULE_TAG[f.moduleStatus] : null;
                  rows.push(
                    <div key={f.feature_key} role="row" data-testid={`compare-row-${f.feature_key}`}
                      style={{ ...rowGrid, borderBottom: `1px solid #F2F5F9`, background: zebra ? '#FBFCFE' : '#fff' }}>
                      <div role="cell" style={{ padding: '13px 22px', fontSize: 13.5, color: '#334155', fontWeight: 500 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {f.label}
                          {mod && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: mod.bg, color: mod.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{mod.label}</span>}
                        </span>
                      </div>
                      {displayPlans.map((p) => {
                        const c = cov.get(`${p.plan_key}::${f.feature_key}`);
                        const included = c?.included ?? false;
                        const txt = comparisonCellText(f.feature_type, included, c?.limit_value ?? null);
                        const isCheck = txt === '✓';
                        const isDash = txt === '–';
                        const featured = !!p.popular;
                        return (
                          <div key={p.plan_key} role="cell" data-testid={`compare-cell-${p.plan_key}-${f.feature_key}`}
                            style={{ padding: '13px 12px', textAlign: 'center', fontSize: isCheck ? 17 : 13.5, fontWeight: 700, background: featured ? GOLD_TINT : 'transparent', color: isCheck ? GREEN : isDash ? '#CBD5E1' : NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {txt}
                          </div>
                        );
                      })}
                    </div>,
                  );
                });
                return rows;
              })()}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
