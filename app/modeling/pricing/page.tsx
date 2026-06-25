'use client';

/**
 * /modeling/pricing - In-app REFM pricing page (logged-in view)
 *
 * Renders from the LIVE entitlement tables via /api/refm/pricing
 * (entitlement_plans + prices from mig 162, plan_permissions coverage) and the
 * merged catalog (serverCatalog). It does NOT read the marketing platform_pricing
 * table (that powers the separate public marketing page).
 *
 * Plan cards (Solo / Pro / Firm) show real prices with a monthly/annual toggle;
 * Trial is the request-access path, not a paid card. The comparison table
 * mirrors the live module list (active + coming-soon, coming-soon tagged, same
 * order) plus the non-module features. Plan select is a CHECKOUT STUB only
 * (no payment provider approved yet) -- it is clearly a placeholder.
 */
import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatPlanPrice, comparisonCellText, planCardMode, type BillingInterval } from '@/src/shared/entitlements/pricingDisplay';
import { FeatureInfoLabel } from '@/src/shared/components/pricing/FeatureInfoLabel';
import { parsePlanIntent, readPlanIntent, clearPlanIntent } from '@/src/hubs/modeling/lib/planIntent';

interface PricePlan {
  id: string; plan_key: string; label: string; display_order: number; active: boolean;
  price_monthly: number | null; price_annual: number | null; currency: string | null; contact_sales: boolean;
  popular?: boolean; badge_text?: string | null;
}
interface PriceFeature {
  feature_key: string; label: string; category: string; feature_type: 'gate' | 'limit' | 'metered';
  display_order: number; moduleStatus?: 'live' | 'coming_soon' | 'pro' | 'enterprise';
  description?: string | null;
}
interface Coverage { plan_key: string; feature_key: string; included: boolean; limit_value: number | null }

const MODULE_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  coming_soon: { label: 'Coming soon', bg: '#fef3c7', fg: '#92400e' },
  pro: { label: 'Pro', bg: '#ede9fe', fg: '#6d28d9' },
  enterprise: { label: 'Enterprise', bg: '#e0e7ff', fg: '#3730a3' },
};

const priceText = formatPlanPrice;

function RefmPricingInner() {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [migrationApplied, setMigrationApplied] = useState(true);
  const [plans, setPlans] = useState<PricePlan[]>([]);
  const [features, setFeatures] = useState<PriceFeature[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [checkoutPlan, setCheckoutPlan] = useState<PricePlan | null>(null);
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null);
  const [trialDays, setTrialDays] = useState(0);
  const [credibilityLine, setCredibilityLine] = useState('');
  const [trialMsg, setTrialMsg] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const resumedRef = useRef(false);

  useEffect(() => {
    fetch('/api/refm/pricing', { credentials: 'same-origin' })
      .then((r) => { if (r.status === 401) { setAuthed(false); return null; } return r.json(); })
      .then((j) => {
        if (!j) return;
        setMigrationApplied(j.migrationApplied !== false);
        setPlans(j.plans ?? []);
        setFeatures(j.features ?? []);
        setCoverage(j.coverage ?? []);
        setTrialDays(j.trialDays ?? 0);
        setCredibilityLine(j.credibilityLine ?? '');
      })
      .catch(() => setAuthed(true))
      .finally(() => setLoading(false));
  }, []);

  // Checkout routing: ask the server which provider is active and what to do.
  // With no provider activated the server returns the placeholder message, so
  // behavior is unchanged from today (no fake checkout, no charge). Contact
  // sales plans skip checkout entirely.
  const startCheckout = useCallback((p: PricePlan) => {
    setCheckoutPlan(p);
    if (p.contact_sales) { setCheckoutMsg(null); return; }
    setCheckoutMsg('Checking availability...');
    fetch('/api/payments/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ plan_key: p.plan_key, interval }),
    })
      .then((r) => r.json())
      .then(async (res) => {
        // Provider-hosted redirect (e.g. a redirect-style adapter).
        if (res?.status === 'redirect' && res.url) { window.location.href = res.url; return; }
        // Paddle.js overlay: load Paddle.js with the publishable client token and
        // open the hosted checkout for the plan's price id. No secret reaches here.
        if (res?.status === 'open_overlay' && res.clientToken && res.priceId) {
          try {
            const { openPaddleCheckout } = await import('@/src/shared/payments/paddleBrowser');
            await openPaddleCheckout({
              clientToken: res.clientToken,
              priceId: res.priceId,
              sandbox: res.sandbox !== false,
              email: res.email ?? null,
              customData: res.customData,
            });
            setCheckoutPlan(null);
            setCheckoutMsg(null);
          } catch (err) {
            // Surface the SPECIFIC Paddle failure (price not found, environment
            // mismatch, etc.) instead of a generic message, so it is diagnosable.
            const msg = err instanceof Error && err.message ? err.message : null;
            setCheckoutMsg(msg ?? 'Could not open the checkout. Please try again, or contact the team to set your plan.');
          }
          return;
        }
        setCheckoutMsg(res?.message ?? 'Online payment is not enabled yet. No charge has been made.');
      })
      .catch(() => setCheckoutMsg('Online payment is not enabled yet. No charge has been made.'));
  }, [interval]);

  // Start free trial (self-serve grant or admin-approval request, server-driven
  // via /api/refm/trial which reuses setUserPlan). Granted -> into the platform.
  const startTrial = useCallback(async () => {
    setTrialMsg('Starting your free trial...');
    try {
      const res = await fetch('/api/refm/trial', { method: 'POST', credentials: 'same-origin' }).then((r) => r.json());
      if (res.status === 'granted') { window.location.href = '/refm'; return; }
      if (res.status === 'requested') { setTrialMsg('Your free trial request has been submitted. An admin will review it shortly.'); return; }
      setTrialMsg(res.error ? `Could not start the trial: ${res.error}` : 'Could not start the trial. Please try again.');
    } catch {
      setTrialMsg('Could not start the trial. Please try again.');
    }
  }, []);

  // Resume a remembered plan choice (logged-out pricing click). Once plans are
  // loaded, run the matching action ONCE: trial -> startTrial, checkout -> the
  // Paddle flow for the chosen plan. Then clear the saved intent.
  useEffect(() => {
    if (resumedRef.current || loading || plans.length === 0) return;
    const intent = parsePlanIntent(searchParams) ?? readPlanIntent();
    if (!intent) return;
    resumedRef.current = true;
    clearPlanIntent();
    if (intent.interval === 'annual' || intent.interval === 'monthly') setInterval(intent.interval);
    if (intent.intent === 'trial' || intent.plan === 'trial') { void startTrial(); return; }
    const target = plans.find((p) => p.plan_key === intent.plan && p.plan_key !== 'trial');
    if (target) startCheckout(target);
  }, [loading, plans, searchParams, startTrial, startCheckout]);

  const cov = useMemo(() => {
    const m = new Map<string, Coverage>();
    for (const c of coverage) m.set(`${c.plan_key}::${c.feature_key}`, c);
    return m;
  }, [coverage]);
  const cellFor = useCallback((planKey: string, f: PriceFeature): { included: boolean; value: number | null } => {
    const c = cov.get(`${planKey}::${f.feature_key}`);
    return { included: c?.included ?? false, value: c?.limit_value ?? null };
  }, [cov]);

  // Paid cards = every active plan except trial (trial is the request-access path).
  const cardPlans = plans.filter((p) => p.plan_key !== 'trial');
  const trialPlan = plans.find((p) => p.plan_key === 'trial');
  const orderedFeatures = useMemo(() => [...features].sort((a, b) => a.display_order - b.display_order), [features]);

  if (loading) return <div style={{ padding: 40, fontFamily: 'Inter, sans-serif', color: '#64748b' }}>Loading pricing...</div>;
  if (!authed) return (
    <div style={{ padding: 40, fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ color: '#0D2E5A' }}>Pricing</h1>
      <p style={{ color: '#475569' }}>Please <a href="/signin" style={{ color: '#2563EB', fontWeight: 700 }}>sign in</a> to view plans and pricing.</p>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#F4F7FC', fontFamily: 'Inter, sans-serif', padding: '40px 24px' }} data-testid="refm-pricing-page">
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0D2E5A', margin: 0 }}>Plans &amp; Pricing</h1>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>Choose the plan that fits your modeling needs. Prices are live from the platform plan catalog.</p>
        </div>

        {!migrationApplied && (
          <div style={{ padding: 14, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13, margin: '0 auto 20px', border: '1px solid #fde68a', maxWidth: 720, textAlign: 'center' }}>
            The entitlement plan catalog is not present in this database yet.
          </div>
        )}

        {/* Billing toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 0, margin: '18px 0 28px' }} data-testid="billing-toggle">
          {(['monthly', 'annual'] as const).map((iv) => (
            <button key={iv} onClick={() => setInterval(iv)} data-testid={`billing-${iv}`}
              style={{ padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: '1px solid #cbd5e1', background: interval === iv ? '#0D2E5A' : '#fff', color: interval === iv ? '#fff' : '#475569',
                borderRadius: iv === 'monthly' ? '8px 0 0 8px' : '0 8px 8px 0' }}>
              {iv === 'monthly' ? 'Monthly' : 'Annual'}
            </button>
          ))}
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cardPlans.length, 3)}, 1fr)`, gap: 16, marginBottom: 16 }}>
          {cardPlans.map((p) => {
            // Data-driven action: dual (price + checkout + contact) / contact-only
            // / self-checkout. Same rule as the public page (shared helper).
            const mode = planCardMode(p, interval);
            const pt = priceText(mode === 'dual' ? { ...p, contact_sales: false } : p, interval);
            const featured = !!p.popular;
            const badge = p.badge_text || (p.popular ? 'MOST POPULAR' : null);
            return (
              <div key={p.plan_key} data-testid={`pricing-card-${p.plan_key}`}
                style={{ background: '#fff', border: featured ? '2px solid #2563EB' : '1px solid #e5e7eb', borderRadius: 12, padding: '22px 20px', position: 'relative', boxShadow: featured ? '0 6px 20px rgba(37,99,235,0.12)' : '0 1px 3px rgba(0,0,0,0.05)' }}>
                {badge && <div data-testid={`pricing-badge-${p.plan_key}`} style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: '#2563EB', color: '#fff', fontSize: 10, fontWeight: 800, padding: '3px 12px', borderRadius: 20, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{badge}</div>}
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0D2E5A' }}>{p.label}</div>
                <div style={{ margin: '12px 0 4px', fontSize: 26, fontWeight: 800, color: '#0f172a' }} data-testid={`pricing-amount-${p.plan_key}`}>{pt.big}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', minHeight: 16 }}>{pt.sub}</div>
                {mode === 'contact_only' ? (
                  <a href="/contact" data-testid={`pricing-contact-${p.plan_key}`}
                    style={{ display: 'block', textAlign: 'center', width: '100%', marginTop: 16, padding: '10px', borderRadius: 8, fontWeight: 700, fontSize: 14, color: '#fff', background: featured ? '#2563EB' : '#0D2E5A', textDecoration: 'none' }}>
                    Contact sales
                  </a>
                ) : (
                  <>
                    <button data-testid={`pricing-select-${p.plan_key}`} onClick={() => startCheckout(p)}
                      style={{ width: '100%', marginTop: 16, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, color: '#fff', background: featured ? '#2563EB' : '#0D2E5A' }}>
                      Choose {p.label}
                    </button>
                    {mode === 'dual' && (
                      <a href="/contact" data-testid={`pricing-contact-${p.plan_key}`}
                        style={{ display: 'block', textAlign: 'center', marginTop: 8, fontSize: 12.5, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none' }}>
                        or contact sales
                      </a>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Trial = self-serve (or admin-approval) action, not a paid card */}
        {trialPlan && (
          <div data-testid="pricing-trial-strip" style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: trialMsg ? 10 : 32 }}>
            <div style={{ fontSize: 13, color: '#475569' }}><b style={{ color: '#0D2E5A' }}>Just exploring?</b> Start a free {trialDays}-day {trialPlan.label} to try the core modules. No card required.</div>
            <button onClick={startTrial} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: '#0D2E5A', border: '1px solid #0D2E5A', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit' }} data-testid="pricing-trial-cta">Start free trial</button>
          </div>
        )}
        {trialMsg && (
          <div data-testid="pricing-trial-message" style={{ fontSize: 13, color: '#0D2E5A', background: '#FDF6E3', border: '1px solid #C9A84C', borderRadius: 10, padding: '10px 14px', marginBottom: 32 }}>{trialMsg}</div>
        )}

        {/* Founder credibility band: same editable pricing-page setting as the
            public page (Plan Builder). Blank value renders nothing. */}
        {credibilityLine.trim() !== '' && (
          <div data-testid="founder-credibility" style={{ maxWidth: 720, margin: '0 auto 28px', padding: '13px 20px', background: '#FDF6E3', border: '1px solid #C9A84C', borderRadius: 12, textAlign: 'center' }}>
            <span style={{ fontSize: 13, color: '#0D2E5A', fontWeight: 600, lineHeight: 1.6 }}>{credibilityLine}</span>
          </div>
        )}

        {/* Comparison table mirroring the live module list + non-module features */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }} data-testid="comparison-table">
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', fontSize: 15, fontWeight: 800, color: '#0D2E5A' }}>Compare plans</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr style={{ background: '#0D2E5A' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, color: '#fff', position: 'sticky', left: 0, background: '#0D2E5A' }}>Feature</th>
                  {plans.map((p) => <th key={p.plan_key} data-testid={`compare-col-${p.plan_key}`} style={{ padding: '10px 14px', fontSize: 12, color: '#fff', textAlign: 'center', whiteSpace: 'nowrap' }}>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const rows: React.JSX.Element[] = [];
                  let lastCat = '';
                  for (const f of orderedFeatures) {
                    if (f.category !== lastCat) {
                      lastCat = f.category;
                      rows.push(
                        <tr key={`cat-${f.category}`}><td colSpan={plans.length + 1} style={{ padding: '6px 14px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569', background: '#f1f5f9' }}>{f.category}</td></tr>,
                      );
                    }
                    const mod = f.moduleStatus && f.moduleStatus !== 'live' ? MODULE_TAG[f.moduleStatus] : null;
                    rows.push(
                      <tr key={f.feature_key} data-testid={`compare-row-${f.feature_key}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 14px', fontSize: 12, color: '#334155', position: 'sticky', left: 0, background: '#fff' }}>
                          <FeatureInfoLabel
                            label={f.label}
                            description={f.description}
                            testidPrefix={`feature-info-${f.feature_key}`}
                            tag={mod ? <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: mod.bg, color: mod.fg, whiteSpace: 'nowrap' }}>{mod.label}</span> : undefined}
                          />
                        </td>
                        {plans.map((p) => {
                          const c = cellFor(p.plan_key, f);
                          return (
                            <td key={p.plan_key} style={{ padding: '8px 14px', textAlign: 'center', fontSize: 12, color: c.included ? '#166534' : '#cbd5e1', fontWeight: 700 }}>
                              {comparisonCellText(f.feature_type, c.included, c.value)}
                            </td>
                          );
                        })}
                      </tr>,
                    );
                  }
                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Checkout handoff STUB (no payment provider approved yet) */}
      {checkoutPlan && (
        <div role="dialog" aria-modal="true" onClick={() => { setCheckoutPlan(null); setCheckoutMsg(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} data-testid="checkout-stub"
            style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, fontFamily: 'Inter, sans-serif' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A', marginBottom: 6 }}>{checkoutPlan.contact_sales ? 'Contact sales' : 'Checkout'}</div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 8px' }}>
              You selected <b>{checkoutPlan.label}</b>{checkoutPlan.contact_sales ? '' : ` (${priceText(checkoutPlan, interval).big} ${priceText(checkoutPlan, interval).sub})`}.
            </p>
            <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 14 }}>
              {checkoutPlan.contact_sales
                ? 'This plan is sold via contact sales. Reach out to the team and an admin will set up your plan.'
                : (checkoutMsg ?? 'Online payment is not enabled yet (no provider approved). No charge has been made and no checkout has started. To upgrade today, contact the team and an admin will set your plan in User Access.')}
            </div>
            <div style={{ textAlign: 'right' }}>
              <button onClick={() => { setCheckoutPlan(null); setCheckoutMsg(null); }} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// useSearchParams (resume-after-login) requires a Suspense boundary at the
// route level for static prerender.
export default function RefmPricingPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, fontFamily: 'Inter, sans-serif', color: '#64748b' }}>Loading pricing...</div>}>
      <RefmPricingInner />
    </Suspense>
  );
}
