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
import { formatPlanPrice, comparisonCellText, planCardMode, type BillingInterval } from '@/src/shared/entitlements/pricingDisplay';
import { FeatureInfoLabel } from '@/src/shared/components/pricing/FeatureInfoLabel';

export interface LivePlan {
  plan_key: string; label: string;
  price_monthly: number | null; price_annual: number | null; currency: string | null;
  contact_sales: boolean; popular: boolean; badge_text: string | null;
}
export interface LiveFeature {
  feature_key: string; label: string; category: string;
  feature_type: 'gate' | 'limit' | 'metered'; display_order: number;
  moduleStatus?: 'live' | 'coming_soon' | 'pro' | 'enterprise';
  description?: string | null;
}
export interface LiveCoverage { plan_key: string; feature_key: string; included: boolean; limit_value: number | null }

/**
 * Optional in-app action behavior. When PROVIDED (logged-in, in-app context) the
 * card buttons trigger real in-app checkout / trial instead of the logged-out
 * register handoff. When OMITTED (public marketing / logged-out) the cards keep
 * the original `<Link>` handoff to /register, so the same component serves both
 * contexts with no design change.
 */
export interface PricingActions {
  /** plan_key (or 'trial') currently being processed, to show a busy state. */
  busyKey?: string | null;
  /** A status / error line shown under the cards. */
  message?: string | null;
  onCheckout: (planKey: string, interval: BillingInterval) => void;
  onTrial: (interval: BillingInterval) => void;
}

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

// The app subdomain hosts register + the in-app checkout/trial. A logged-out
// pricing click hands the chosen plan + interval + intent to /register, which
// persists it and resumes the action after the user is signed in (no dead ends).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

// ── Shared column geometry (drives BOTH the cards and the comparison) ────────
// Wide enough that the longest feature names (e.g. "Module 8: Collaborate" with
// a Coming-soon tag) sit on ONE line with no wrap. Used by every row, so cards
// and comparison columns stay perfectly aligned at any width.
const LABEL_W = 320;                          // feature-label column, outside the lanes
const GAP = 16;                               // column gap, identical in both grids

const MODULE_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  coming_soon: { label: 'Coming soon', bg: '#FEF3C7', fg: '#92400E' },
  pro: { label: 'Pro', bg: '#EDE9FE', fg: '#6D28D9' },
  enterprise: { label: 'Enterprise', bg: '#E0E7FF', fg: '#3730A3' },
};
const CATEGORY_LABELS: Record<string, string> = {
  module: 'Modules', export: 'Exports', analysis: 'Analysis', platform: 'Platform', limits: 'Limits', admin: 'Admin', branding: 'Branding', ai: 'AI', general: 'General',
};

/** Active public promo for display (Model 1: references a real Paddle discount,
 *  which is applied at checkout server-side; the discount id is NOT needed here). */
export interface PromoInfo {
  code: string;
  label: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

export default function LivePlanCards({
  plans, features, coverage, trialDays = 0, credibilityLine = '', actions, promo = null,
}: { plans: LivePlan[]; features: LiveFeature[]; coverage: LiveCoverage[]; trialDays?: number; credibilityLine?: string; actions?: PricingActions; promo?: PromoInfo | null }) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');

  // Discounted headline for a priced plan when a PERCENTAGE public promo is active
  // (the common launch promo). Mirrors formatPlanPrice's currency formatting.
  // Fixed-amount promos show the label chip only (their currency/scope can differ),
  // so we never display a mis-computed number. Returns null when nothing applies.
  const discountedBig = (p: LivePlan): string | null => {
    if (!promo || promo.discountType !== 'percentage' || promo.discountValue <= 0) return null;
    const v = interval === 'monthly' ? p.price_monthly : p.price_annual;
    if (v == null || v <= 0) return null;
    const cur = p.currency || 'SAR';
    const off = Math.round(v * (1 - promo.discountValue / 100));
    return `${cur} ${off.toLocaleString()}`;
  };

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
  // Disclosure uses the real annual discount when available, else a safe static.
  const annualSavePct = maxSavePct > 0 ? maxSavePct : 17;

  const rowGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: GRID, columnGap: GAP };

  return (
    <div data-testid="live-plan-cards">
      {/* Active public promo banner (auto-applied at checkout). Only shows when a
          promo referencing a real Paddle discount is active, so the "X% off" here
          always matches what applies at checkout. */}
      {promo && (
        <div data-testid="promo-banner"
          style={{ maxWidth: 640, margin: '0 auto 24px', textAlign: 'center', background: GOLD_LIGHT, border: `1px solid ${GOLD}`, borderRadius: 12, padding: '12px 20px', color: GOLD_DARK, fontSize: 14, fontWeight: 800 }}>
          {promo.label}
          <span style={{ fontWeight: 600, color: MUTED, marginLeft: 8 }}>
            applied automatically at checkout{promo.code ? ` (code ${promo.code})` : ''}
          </span>
        </div>
      )}

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
              // Data-driven card action: trial / dual (price + checkout + contact)
              // / contact-only / self-checkout. Not hardcoded to any plan.
              const mode = isTrial ? 'trial' : planCardMode(p, interval);
              // In dual mode the price IS shown (so formatPlanPrice must not be
              // overridden to "Contact sales"); the helper stays unchanged.
              const pt = formatPlanPrice(mode === 'dual' ? { ...p, contact_sales: false } : p, interval);
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
                      style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: featured ? GOLD : NAVY_MID, color: featured ? NAVY : '#fff', fontSize: 10.5, fontWeight: 800, padding: '5px 16px', borderRadius: 999, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: featured ? '0 4px 12px rgba(13,46,90,0.20)' : 'none' }}>
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
                      {(() => {
                        const trialStyle: React.CSSProperties = {
                          display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'auto', padding: '13px 0', borderRadius: 10, fontWeight: 800, fontSize: 14.5,
                          background: GOLD_LIGHT, color: GOLD_DARK, border: `1.5px solid ${GOLD}`,
                        };
                        // In-app (logged-in): start the trial directly. Public
                        // (logged-out): hand off to the gated /register flow.
                        return actions ? (
                          <button type="button" data-testid="pricing-trial-cta" onClick={() => actions.onTrial(interval)} disabled={actions.busyKey === 'trial'}
                            style={{ ...trialStyle, width: '100%', cursor: actions.busyKey === 'trial' ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                            {actions.busyKey === 'trial' ? 'Starting...' : 'Start free trial'}
                          </button>
                        ) : (
                          <Link href={`${APP_URL}/register?plan=trial&interval=${interval}&intent=trial`} data-testid="pricing-trial-cta" aria-label={`Start a free ${trialDays}-day trial`}
                            style={trialStyle}>
                            Start free trial
                          </Link>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      {(() => {
                        // Discounted headline when a percentage promo applies to
                        // this priced, self-checkout/dual plan; original struck out.
                        const disc = mode !== 'contact_only' ? discountedBig(p) : null;
                        return disc ? (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                              <span data-testid={`pricing-amount-${p.plan_key}`} style={{ fontSize: 34, fontWeight: 900, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{disc}</span>
                              {pt.sub && <span style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>{pt.sub}</span>}
                            </div>
                            <div style={{ marginTop: 4, fontSize: 13, color: MUTED, fontWeight: 600 }}>
                              <span style={{ textDecoration: 'line-through' }} data-testid={`pricing-was-${p.plan_key}`}>{pt.big}</span>
                              {promo && <span style={{ marginLeft: 8, color: GOLD_DARK, fontWeight: 800 }}>{promo.discountValue}% off</span>}
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                            <span data-testid={`pricing-amount-${p.plan_key}`} style={{ fontSize: 34, fontWeight: 900, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{pt.big}</span>
                            {pt.sub && <span style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>{pt.sub}</span>}
                          </div>
                        );
                      })()}
                      <div style={{ height: 1, background: LINE, margin: '20px 0' }} />
                      <div style={{ marginTop: 'auto' }}>
                        {mode === 'contact_only' ? (
                          // Unpriced contact plan: the single Contact sales action.
                          <Link href="/contact" data-testid={`pricing-contact-${p.plan_key}`} aria-label={`Contact sales about the ${p.label} plan`}
                            style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '13px 0', borderRadius: 10, fontWeight: 800, fontSize: 14.5, background: featured ? GOLD : '#fff', color: NAVY, border: featured ? `1.5px solid ${GOLD}` : `1.5px solid ${NAVY}`, boxShadow: featured ? `0 8px 20px -6px ${GOLD_GLOW}` : 'none' }}>
                            Contact sales
                          </Link>
                        ) : (
                          // Self-checkout primary. In-app (logged-in) runs the
                          // real checkout; public (logged-out) hands off to
                          // /register. In dual mode, also a Contact sales link.
                          <>
                            {(() => {
                              const checkoutStyle: React.CSSProperties = { display: 'block', textAlign: 'center', textDecoration: 'none', padding: '13px 0', borderRadius: 10, fontWeight: 800, fontSize: 14.5, background: featured ? GOLD : '#fff', color: NAVY, border: featured ? `1.5px solid ${GOLD}` : `1.5px solid ${NAVY}`, boxShadow: featured ? `0 8px 20px -6px ${GOLD_GLOW}` : 'none' };
                              return actions ? (
                                <button type="button" data-testid={`pricing-checkout-${p.plan_key}`} onClick={() => actions.onCheckout(p.plan_key, interval)} disabled={actions.busyKey === p.plan_key}
                                  style={{ ...checkoutStyle, width: '100%', cursor: actions.busyKey === p.plan_key ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                                  {actions.busyKey === p.plan_key ? 'Starting...' : `Choose ${p.label}`}
                                </button>
                              ) : (
                                <Link href={`${APP_URL}/register?plan=${p.plan_key}&interval=${interval}&intent=checkout`} data-testid={`pricing-checkout-${p.plan_key}`} aria-label={`Choose the ${p.label} plan`}
                                  style={checkoutStyle}>
                                  Choose {p.label}
                                </Link>
                              );
                            })()}
                            {mode === 'dual' && (
                              <Link href="/contact" data-testid={`pricing-contact-${p.plan_key}`} aria-label={`Contact sales about the ${p.label} plan`}
                                style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 10, fontSize: 13, fontWeight: 700, color: NAVY_MID }}>
                                or contact sales
                              </Link>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Billing disclosure + subscription terms (below the cards) */}
      <div style={{ maxWidth: 720, margin: '22px auto 0', textAlign: 'center' }}>
        <p data-testid="billing-disclosure" style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0 }}>
          Prices are exclusive of applicable taxes. Annual plans save up to {annualSavePct}%. Cancel anytime.
        </p>
        <p data-testid="subscription-terms" style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: '4px 0 0' }}>
          Subscriptions renew automatically unless cancelled before the next billing cycle.
        </p>
      </div>

      {/* In-app action status / error (checkout + trial). Public render has no
          actions, so this never appears on the logged-out marketing page. */}
      {actions?.message && (
        <div data-testid="pricing-action-message" style={{ maxWidth: 560, margin: '16px auto 0', padding: '11px 16px', background: GOLD_LIGHT, border: `1px solid ${GOLD}`, borderRadius: 10, textAlign: 'center', fontSize: 13, color: NAVY, fontWeight: 600, lineHeight: 1.55 }}>
          {actions.message}
        </div>
      )}

      {/* Founder credibility band: editable in the Plan Builder (pricing-page
          setting). Blank value renders nothing (no broken band). */}
      {credibilityLine.trim() !== '' && (
        <div data-testid="founder-credibility" style={{ maxWidth: 720, margin: '20px auto 0', padding: '13px 20px', background: GOLD_LIGHT, border: `1px solid ${GOLD}`, borderRadius: 12, textAlign: 'center' }}>
          <span style={{ fontSize: 13, color: NAVY, fontWeight: 600, lineHeight: 1.6 }}>
            {credibilityLine}
          </span>
        </div>
      )}

      {/* ── Comparison: same grid template + min width, so columns stay aligned under their cards ── */}
      <div style={{ marginTop: 56 }}>
        <h2 style={{ fontSize: 26, fontWeight: 900, color: NAVY, textAlign: 'center', marginBottom: 6, letterSpacing: '-0.01em' }}>Compare every plan</h2>
        <p style={{ fontSize: 14, color: MUTED, textAlign: 'center', marginTop: 0, marginBottom: 28 }}>Everything included, side by side.</p>

        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 6 }}>
          <div style={{ minWidth: INNER_MIN }}>
            <div data-testid="comparison-table" role="table" aria-label="Compare every plan"
              style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 14px rgba(13,46,90,0.06)' }}>
              {/* Header row */}
              <div role="row" style={{ ...rowGrid, background: NAVY }}>
                <div role="columnheader" style={{ padding: '15px 18px', textAlign: 'left', fontSize: 12, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Feature</div>
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
                        <div style={{ gridColumn: '1 / -1', padding: '12px 18px 8px', fontSize: 11, fontWeight: 800, color: NAVY_MID, textTransform: 'uppercase', letterSpacing: '0.1em', background: '#F1F5FB', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
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
                      <div role="cell" style={{ padding: '13px 18px', fontSize: 13.5, color: '#334155', fontWeight: 500 }}>
                        <FeatureInfoLabel
                          label={f.label}
                          description={f.description}
                          testidPrefix={`feature-info-${f.feature_key}`}
                          tag={mod ? <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: mod.bg, color: mod.fg, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{mod.label}</span> : undefined}
                        />
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
