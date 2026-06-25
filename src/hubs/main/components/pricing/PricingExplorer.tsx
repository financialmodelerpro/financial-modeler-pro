'use client';

/**
 * PricingExplorer.tsx
 *
 * Two-step public pricing surface, all on ONE page (no navigation):
 *   Step 1 - a platform PICKER built from config (PLATFORMS). Live platforms are
 *            clickable with an "Available now" treatment; coming-soon platforms
 *            render disabled with a "Coming soon" tag. New platforms added to the
 *            config appear here automatically, no edit to this file.
 *   Step 2 - selecting a live platform reveals THAT platform's plans + comparison
 *            in place (LivePlanCards), scoped to the selection, with a clear
 *            back-to-platforms control. Everything already built (Trial /
 *            Professional / Firm cards, billing toggle, Firm dual-action,
 *            disclosure + subscription-terms lines, credibility band, Coming Soon
 *            modules in the comparison, three-column alignment) is preserved.
 *
 * DESIGN: FMP navy primary + the brand gold token (#C9A84C). No orange; platform
 * accent colours from config are intentionally NOT used as fills so the page
 * stays on the navy/gold palette. No course or free-training content lives here.
 *
 * No em dashes in this file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import LivePlanCards, { type LivePlan, type LiveFeature, type LiveCoverage, type PricingActions } from './LivePlanCards';
import { CouponInput } from '@/app/pricing/CouponInput';
import type { BillingInterval } from '@/src/shared/entitlements/pricingDisplay';
import { parsePlanIntent, readPlanIntent, clearPlanIntent } from '@/src/hubs/modeling/lib/planIntent';

const NAVY = '#0D2E5A';
const NAVY_MID = '#1B4F8A';
const GOLD = '#C9A84C';
const GOLD_DARK = '#92400E';
const GOLD_LIGHT = '#FDF6E3';
const MUTED = '#64748b';
const LINE = '#E8EDF4';

export interface PickerPlatform {
  slug: string;
  name: string;
  shortName?: string;
  icon: string;
  status: 'live' | 'coming_soon';
  tagline: string;
}

export interface PlatformPricing {
  plans: LivePlan[];
  features: LiveFeature[];
  coverage: LiveCoverage[];
  trialDays: number;
  credibilityLine: string;
}

export default function PricingExplorer({
  platforms, pricingByPlatform,
}: { platforms: PickerPlatform[]; pricingByPlatform: Record<string, PlatformPricing> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: session, status } = useSession();
  const authed = status === 'authenticated' && !!session?.user;

  // In-app checkout / trial state (only used when logged in). The same APIs the
  // former standalone in-app pricing page used; the webhook still owns plan
  // changes, this only opens checkout / requests a trial.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const resumedRef = useRef(false);

  // The first live platform whose catalog carries a given plan_key (used to
  // resume a remembered plan choice onto the right platform). Falls back to the
  // first live platform.
  const platformForPlan = useCallback((planKey: string): string | null => {
    for (const [slug, pricing] of Object.entries(pricingByPlatform)) {
      if (pricing.plans.some((p) => p.plan_key === planKey)) return slug;
    }
    return Object.keys(pricingByPlatform)[0] ?? null;
  }, [pricingByPlatform]);

  const startCheckout = useCallback((planKey: string, interval: BillingInterval) => {
    setBusyKey(planKey);
    setMessage('Checking availability...');
    fetch('/api/payments/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ plan_key: planKey, interval }),
    })
      .then((r) => r.json())
      .then(async (res) => {
        // Provider-hosted redirect (e.g. a redirect-style adapter).
        if (res?.status === 'redirect' && res.url) { window.location.href = res.url; return; }
        // Paddle.js overlay: open the hosted checkout for the plan's price id.
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
            setMessage(null);
          } catch (err) {
            // Surface the specific failure (price not found, env mismatch, etc.).
            const msg = err instanceof Error && err.message ? err.message : null;
            setMessage(msg ?? 'Could not open the checkout. Please try again, or contact the team to set your plan.');
          }
          return;
        }
        setMessage(res?.message ?? 'Online payment is not enabled yet. No charge has been made.');
      })
      .catch(() => setMessage('Online payment is not enabled yet. No charge has been made.'))
      .finally(() => setBusyKey((k) => (k === planKey ? null : k)));
  }, []);

  const startTrial = useCallback(async (_interval: BillingInterval) => {
    setBusyKey('trial');
    setMessage('Starting your free trial...');
    try {
      const res = await fetch('/api/refm/trial', { method: 'POST', credentials: 'same-origin' }).then((r) => r.json());
      if (res.status === 'granted') { window.location.href = '/refm'; return; }
      if (res.status === 'requested') { setMessage('Your free trial request has been submitted. An admin will review it shortly.'); return; }
      setMessage(res.error ? `Could not start the trial: ${res.error}` : 'Could not start the trial. Please try again.');
    } catch {
      setMessage('Could not start the trial. Please try again.');
    } finally {
      setBusyKey((k) => (k === 'trial' ? null : k));
    }
  }, []);

  // Deep-link: /pricing?platform=<slug> pre-selects that platform's plans,
  // skipping the picker. The dashboard "Get access" card uses this (the user
  // already chose a platform, so it should not be asked again). Runs once on
  // mount, independent of auth, so it works for both logged-in (in-app actions)
  // and logged-out (register handoff) visitors. A missing / unknown slug leaves
  // `selected` null, so a cold visitor still lands on the picker.
  const platformAppliedRef = useRef(false);
  useEffect(() => {
    if (platformAppliedRef.current) return;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const slug = (params.get('platform') ?? '').trim().toLowerCase();
    if (!slug) return;
    platformAppliedRef.current = true;
    if (platforms.some((p) => p.slug === slug)) setSelected(slug);
  }, [platforms]);

  // Resume a remembered plan choice (logged-out pricing click handed to
  // /register, persisted to localStorage; or a ?plan= query forwarded from
  // choose-plan). Once, when authed: select the matching platform and run the
  // action (checkout -> Paddle, trial -> trial request). No dead ends.
  useEffect(() => {
    if (!authed || resumedRef.current) return;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const intent = parsePlanIntent(params) ?? readPlanIntent();
    if (!intent) return;
    resumedRef.current = true;
    clearPlanIntent();
    const slug = platformForPlan(intent.plan);
    if (slug) setSelected(slug);
    if (intent.intent === 'trial' || intent.plan === 'trial') { void startTrial(intent.interval); return; }
    startCheckout(intent.plan, intent.interval);
  }, [authed, platformForPlan, startCheckout, startTrial]);

  // Only hand action callbacks to the cards when logged in. Logged-out keeps the
  // original /register handoff (actions === undefined), so the SAME cards serve
  // both the public marketing page and the in-app pricing page.
  const actions: PricingActions | undefined = useMemo(
    () => (authed ? { busyKey, message, onCheckout: startCheckout, onTrial: startTrial } : undefined),
    [authed, busyKey, message, startCheckout, startTrial],
  );

  const selectedPlatform = selected ? platforms.find((p) => p.slug === selected) ?? null : null;
  const selectedPricing = selected ? pricingByPlatform[selected] : undefined;

  // ── Step 2: plans for the selected platform, in place ──────────────────────
  if (selectedPlatform) {
    return (
      <div data-testid="pricing-plans-view">
        <button type="button" data-testid="back-to-platforms" onClick={() => setSelected(null)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700, color: NAVY, cursor: 'pointer', marginBottom: 24 }}>
          <span aria-hidden>&larr;</span> All platforms
        </button>

        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 8 }} aria-hidden>{selectedPlatform.icon}</div>
          <h2 data-testid="selected-platform-name" style={{ fontSize: 26, fontWeight: 900, color: NAVY, margin: 0, letterSpacing: '-0.01em' }}>{selectedPlatform.name}</h2>
          <p style={{ fontSize: 14, color: MUTED, maxWidth: 620, margin: '8px auto 0', lineHeight: 1.6 }}>{selectedPlatform.tagline}</p>
        </div>

        {selectedPricing && selectedPricing.plans.length > 0 ? (
          <>
            <LivePlanCards
              plans={selectedPricing.plans}
              features={selectedPricing.features}
              coverage={selectedPricing.coverage}
              trialDays={selectedPricing.trialDays}
              credibilityLine={selectedPricing.credibilityLine}
              actions={actions}
            />
            <CouponInput />
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: MUTED }}>
            <p style={{ fontSize: 16 }}>Plans for this platform are coming soon. Check back shortly.</p>
          </div>
        )}
      </div>
    );
  }

  // ── Step 1: platform picker (config-driven) ─────────────────────────────────
  return (
    <div data-testid="platform-picker">
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <h2 style={{ fontSize: 26, fontWeight: 900, color: NAVY, margin: 0, letterSpacing: '-0.01em' }}>Choose your platform</h2>
        <p style={{ fontSize: 14, color: MUTED, marginTop: 8 }}>Select a platform to see its plans and pricing.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 18 }}>
        {platforms.map((p) => {
          const isLive = p.status === 'live';
          const common: React.CSSProperties = {
            textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: 10,
            background: '#fff', borderRadius: 16, padding: '22px 20px',
            border: isLive ? `1.5px solid ${GOLD}` : `1px solid ${LINE}`,
            boxShadow: isLive ? '0 8px 24px -12px rgba(201,168,76,0.45)' : '0 1px 3px rgba(13,46,90,0.05)',
            opacity: isLive ? 1 : 0.62,
          };
          const inner = (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>{p.icon}</span>
                {isLive ? (
                  <span data-testid={`platform-status-${p.slug}`} style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: GOLD_DARK, background: GOLD_LIGHT, border: `1px solid ${GOLD}`, borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' }}>Available now</span>
                ) : (
                  <span data-testid={`platform-status-${p.slug}`} style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, background: '#F1F5F9', border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' }}>Coming soon</span>
                )}
              </div>
              <div style={{ fontSize: 16.5, fontWeight: 800, color: NAVY, lineHeight: 1.25 }}>{p.name}</div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>{p.tagline}</div>
              {isLive && (
                <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 13, fontWeight: 800, color: NAVY_MID }}>View plans &rarr;</div>
              )}
            </>
          );

          return isLive ? (
            <button key={p.slug} type="button" data-testid={`platform-card-${p.slug}`} onClick={() => setSelected(p.slug)}
              aria-label={`View plans for ${p.name}`} style={{ ...common, cursor: 'pointer' }}>
              {inner}
            </button>
          ) : (
            <div key={p.slug} data-testid={`platform-card-${p.slug}`} aria-disabled="true" style={{ ...common, cursor: 'default' }}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
