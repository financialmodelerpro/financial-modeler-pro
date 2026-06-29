'use client';

/**
 * BillingView.tsx (client)
 *
 * The "Billing" sidebar tab body. Renders ONE SubscriptionPanel per live
 * platform, driven by the SAME platform source the dashboard uses (passed in as
 * `platforms`, sourced from the modules registry). When a future platform goes
 * live and a user subscribes to it, its section appears here automatically with
 * NO code change: this component just maps over whatever live platforms it is
 * given. Each panel is self-contained (fetches that platform's subscription +
 * invoices from the per-platform server routes).
 *
 * No em dashes in this file.
 */
import SubscriptionPanel from './SubscriptionPanel';

export interface BillingPlatform {
  slug: string;
  name: string;
}

export default function BillingView({
  platforms, dark = false,
}: { platforms: BillingPlatform[]; dark?: boolean }) {
  const heading = dark ? '#F1F5F9' : '#0D2E5A';
  const muted = dark ? '#94A3B8' : '#6B7280';

  return (
    <div data-testid="billing-view">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: heading, margin: '0 0 6px' }}>Subscription & Billing</h1>
        <p style={{ fontSize: 13.5, color: muted, margin: 0, lineHeight: 1.6 }}>
          Manage your plan, payment method, and invoices for each platform.
        </p>
      </div>

      {platforms.length === 0 ? (
        <p style={{ fontSize: 13.5, color: muted }}>No platforms are available yet.</p>
      ) : (
        // One section per live platform. Source-driven: add a live platform and a
        // subscription, and its section renders here with no change to this file.
        platforms.map((p) => (
          <SubscriptionPanel key={p.slug} platform={p.slug} platformName={p.name} dark={dark} />
        ))
      )}
    </div>
  );
}
