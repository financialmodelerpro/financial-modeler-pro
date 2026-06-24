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
import { useState } from 'react';
import LivePlanCards, { type LivePlan, type LiveFeature, type LiveCoverage } from './LivePlanCards';
import { CouponInput } from '@/app/pricing/CouponInput';

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
  shortName: string;
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
