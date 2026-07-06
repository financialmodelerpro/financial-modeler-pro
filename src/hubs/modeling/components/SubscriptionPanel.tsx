'use client';

/**
 * SubscriptionPanel.tsx (client)
 *
 * One platform's Subscription & Billing section, rendered by BillingView (one
 * per platform the user has). Reads the platform's subscription + invoices from
 * OUR server routes (which call Paddle server-side; the API key never reaches
 * here) and lets the user:
 *   - see plan, status, next billing date + amount;
 *   - upgrade / downgrade to another plan on this platform (confirm step; calls
 *     Paddle to swap the price id; the webhook keeps the app plan in sync);
 *   - cancel AT PERIOD END (confirm + result; access kept until period end, then
 *     the existing webhook drops to baseline);
 *   - open each invoice in an IN-DASHBOARD viewer (iframe) with an optional
 *     Download button (no forced download);
 *   - open Paddle's secure hosted flow to update the payment method (no card
 *     form here; the card entry happens in Paddle's component).
 *
 * No raw card data is ever handled here. No Paddle API call is ever made from
 * the client. No em dashes in this file.
 */
import { useCallback, useEffect, useState } from 'react';

const NAVY = '#0D2E5A';
const GOLD = '#C9A84C';

interface SubscriptionSummary {
  source?: 'paddle' | 'manual';
  subscriptionId: string;
  status: string;
  nextBilledAt: string | null;
  currentPeriodEndsAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  scheduledCancelAt: string | null;
  canceled: boolean;
  updatePaymentMethodUrl: string | null;
  currentPriceId: string | null;
  billingInterval: 'monthly' | 'annual' | null;
  // Manual (admin-assigned, offline-paid) plans:
  planKey?: string | null;
  startedAt?: string | null;
  expiresAt?: string | null;
  note?: string | null;
}
interface InvoiceSummary {
  id: string;
  source: 'paddle' | 'manual';
  billedAt: string | null;
  number: string | null;
  amountMinor: number | null;
  currency: string | null;
}
interface PlanOption { plan_key: string; label: string }
interface PlanFeatureLine { feature_key: string; label: string; detail: string | null }
interface ChangeDifferential { action: 'charge' | 'credit' | 'none'; amountMinor: number; currency: string | null; billedAt: string | null }
interface NewPrice { amount: number; currency: string | null; interval: 'monthly' | 'annual' }
type ChangeType = 'upgrade' | 'downgrade' | 'lateral' | 'interval';
interface ChangePreviewResult {
  sameAsCurrent: boolean;
  changeType?: ChangeType;
  interval: 'monthly' | 'annual';
  targetLabel: string;
  targetFeatures: PlanFeatureLine[];
  differential: ChangeDifferential | null;
  previewError?: string | null;
  effectiveAt?: string | null;
  currentLabel?: string;
  newPrice?: NewPrice | null;
  /** Label of the discount applied to this change (public promo or typed code). */
  discountLabel?: string | null;
  /** Message when a typed coupon code was invalid (previewed without a discount). */
  couponError?: string | null;
}
interface ScheduledChange { planKey: string; label: string; interval: 'monthly' | 'annual' | null; effectiveAt: string | null }

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtAmount(minor: number | null, currency: string | null): string {
  if (minor === null || currency === null) return '-';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}
// Format a catalog price (MAJOR units, e.g. 49) with its currency + interval.
function fmtPrice(p: NewPrice | null | undefined): string {
  if (!p || p.currency === null) return '-';
  let amt: string;
  try { amt = new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency }).format(p.amount); }
  catch { amt = `${p.amount} ${p.currency}`; }
  return `${amt}/${p.interval === 'annual' ? 'yr' : 'mo'}`;
}
function statusLabel(status: string, canceled: boolean): { label: string; bg: string; fg: string } {
  if (canceled) return { label: 'Canceling at period end', bg: '#FEF3C7', fg: '#92400E' };
  switch (status) {
    case 'active':   return { label: 'Active', bg: '#D1FAE5', fg: '#065F46' };
    case 'trialing': return { label: 'Trialing', bg: '#DBEAFE', fg: '#1E40AF' };
    case 'past_due': return { label: 'Past due', bg: '#FEE2E2', fg: '#991B1B' };
    case 'paused':   return { label: 'Paused', bg: '#F3F4F6', fg: '#374151' };
    case 'canceled': return { label: 'Canceled', bg: '#F3F4F6', fg: '#6B7280' };
    default:         return { label: status || 'Unknown', bg: '#F3F4F6', fg: '#374151' };
  }
}
function titleCase(key: string | null): string | null {
  if (!key) return null;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export default function SubscriptionPanel({
  platform, platformName, dark = false,
}: { platform: string; platformName?: string; dark?: boolean }) {
  const surface = dark ? '#1A222F' : '#FFFFFF';
  const border = dark ? '#2A3543' : '#E5E7EB';
  const heading = dark ? '#F1F5F9' : NAVY;
  const body = dark ? '#D1D5DB' : '#374151';
  const muted = dark ? '#94A3B8' : '#6B7280';

  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubscriptionSummary | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);
  const [currentPlanKey, setCurrentPlanKey] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelResult, setCancelResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Upgrade/downgrade/interval change pending confirmation. `target` carries the
  // plan + chosen interval; `preview` is the catalog feature list + the Paddle
  // proration differential (fetched before the user confirms; preview only).
  const [pendingChange, setPendingChange] = useState<{ planKey: string; label: string; interval: 'monthly' | 'annual' } | null>(null);
  const [preview, setPreview] = useState<ChangePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Coupon in the change flow. `couponInput` is the field; `appliedCoupon` is what
  // is sent to preview/confirm (set on Apply), so the preview does not re-fetch on
  // every keystroke. An active PUBLIC promo auto-applies with no input.
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  // A pending deferred downgrade (mig 178): current plan stays active, switches
  // to this plan on the renewal date. Cancelable before it applies.
  const [scheduledChange, setScheduledChange] = useState<ScheduledChange | null>(null);
  const [cancelingSchedule, setCancelingSchedule] = useState(false);
  // In-dashboard invoice viewer (transaction id being viewed).
  const [viewInvoice, setViewInvoice] = useState<{ id: string; source: 'paddle' | 'manual' } | null>(null);

  const q = `platform=${encodeURIComponent(platform)}`;

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/payments/subscription?${q}`, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
      fetch(`/api/payments/invoices?${q}`, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
    ])
      .then(([s, inv]) => {
        setSub(s?.subscription ?? null);
        setReason(s?.reason ?? null);
        setPlanOptions(Array.isArray(s?.planOptions) ? s.planOptions : []);
        setCurrentPlanKey(s?.currentPlanKey ?? null);
        setScheduledChange(s?.scheduledChange ?? null);
        setInvoices(Array.isArray(inv?.invoices) ? inv.invoices : []);
      })
      .finally(() => setLoading(false));
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const doCancel = useCallback(() => {
    setCanceling(true);
    setError(null);
    fetch(`/api/payments/subscription/cancel?${q}`, { method: 'POST', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok && res.subscription) {
          setSub(res.subscription);
          setCancelResult(res.subscription.scheduledCancelAt ?? res.subscription.currentPeriodEndsAt ?? null);
          setConfirming(false);
        } else {
          setError(res?.reason ? `Could not cancel: ${res.reason}` : 'Could not cancel the subscription. Please try again.');
        }
      })
      .catch(() => setError('Could not cancel the subscription. Please try again.'))
      .finally(() => setCanceling(false));
  }, [q]);

  // Open the confirm step for a target plan + interval, and fetch the preview
  // (full feature list + prorated differential). Nothing is charged here.
  const openChange = useCallback((planKey: string, label: string, interval: 'monthly' | 'annual') => {
    setPendingChange({ planKey, label, interval });
    setCouponInput('');
    setAppliedCoupon('');
    setError(null);
  }, []);

  // Whenever the pending target (plan or interval) changes, refresh the preview.
  useEffect(() => {
    if (!pendingChange) { setPreview(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);
    fetch('/api/payments/subscription/preview-change', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ platform, plan_key: pendingChange.planKey, interval: pendingChange.interval, coupon_code: appliedCoupon || undefined }),
    })
      .then((r) => r.json())
      .then((res: ChangePreviewResult & { ok?: boolean; reason?: string }) => {
        if (cancelled) return;
        if (res?.ok) setPreview(res);
        else setError(res?.reason ? `Could not preview the change: ${res.reason}` : 'Could not preview the change.');
      })
      .catch(() => { if (!cancelled) setError('Could not preview the change. Please try again.'); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [pendingChange, platform, appliedCoupon]);

  const doSwitch = useCallback(() => {
    if (!pendingChange) return;
    setSwitching(true);
    setError(null);
    fetch('/api/payments/subscription/change-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ platform, plan_key: pendingChange.planKey, interval: pendingChange.interval, coupon_code: appliedCoupon || undefined }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok && res.applied === 'scheduled') {
          // Downgrade: nothing changes now. Show the pending change; keep the
          // current plan active.
          setScheduledChange({
            planKey: pendingChange.planKey,
            label: pendingChange.label,
            interval: pendingChange.interval,
            effectiveAt: res.scheduledChange?.effectiveAt ?? null,
          });
          setPendingChange(null);
        } else if (res?.ok && res.subscription) {
          // Upgrade / lateral: applied immediately.
          setSub(res.subscription);
          setCurrentPlanKey(res.planKey ?? pendingChange.planKey);
          setScheduledChange(null);
          setPendingChange(null);
        } else {
          setError(res?.reason ? `Could not change plan: ${res.reason}` : 'Could not change the plan. Please try again.');
        }
      })
      .catch(() => setError('Could not change the plan. Please try again.'))
      .finally(() => setSwitching(false));
  }, [platform, pendingChange, appliedCoupon]);

  const doCancelSchedule = useCallback(() => {
    setCancelingSchedule(true);
    setError(null);
    fetch(`/api/payments/subscription/cancel-scheduled-change?${q}`, { method: 'POST', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok) setScheduledChange(null);
        else setError(res?.reason ? `Could not cancel the scheduled change: ${res.reason}` : 'Could not cancel the scheduled change.');
      })
      .catch(() => setError('Could not cancel the scheduled change. Please try again.'))
      .finally(() => setCancelingSchedule(false));
  }, [q]);

  const card: React.CSSProperties = {
    background: surface, border: `1px solid ${border}`, borderRadius: 14,
    padding: '22px 24px', marginBottom: 22,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 15, fontWeight: 800, color: heading, margin: 0,
  };
  const headerName = platformName ?? 'Subscription';

  if (loading) {
    return (
      <div data-testid="subscription-panel" data-platform={platform} style={card}>
        <h3 style={sectionTitle}>{headerName}</h3>
        <p style={{ fontSize: 13, color: muted, marginTop: 12 }}>Loading subscription...</p>
      </div>
    );
  }

  // No managed subscription for this platform: friendly empty state.
  if (!sub) {
    return (
      <div data-testid="subscription-panel" data-platform={platform} style={card}>
        <h3 style={sectionTitle}>{headerName}</h3>
        <div data-testid="no-subscription-state" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13.5, color: muted, margin: 0, flex: 1, minWidth: 240, lineHeight: 1.6 }}>
            {reason === 'not_configured'
              ? 'Online subscription management is not enabled for this platform yet. Your plan is managed by the team for now.'
              : 'No active subscription for this platform yet. Choose a plan to subscribe online and manage it here.'}
          </p>
          <a href={`/pricing/${encodeURIComponent(platform)}`} style={{ background: GOLD, color: NAVY, fontWeight: 800, fontSize: 13, padding: '9px 18px', borderRadius: 9, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            View plans &rarr;
          </a>
        </div>
      </div>
    );
  }

  const st = statusLabel(sub.status, sub.canceled);
  const planName = titleCase(currentPlanKey);
  // Switchable plans = every active plan for this platform except the current one.
  const otherPlans = planOptions.filter((p) => p.plan_key !== currentPlanKey);

  // Invoice PDF endpoint per source (Paddle-hosted redirect vs signed manual URL).
  const invoiceHref = (inv: { id: string; source: 'paddle' | 'manual' }) =>
    inv.source === 'manual'
      ? `/api/payments/manual-invoice/${encodeURIComponent(inv.id)}?${q}`
      : `/api/payments/invoice/${encodeURIComponent(inv.id)}?${q}`;

  // The combined invoice list (Paddle + manual) + the in-dashboard viewer, shared
  // by BOTH the manual and the Paddle panel so any user with billing history sees
  // their receipts regardless of the current subscription source.
  const invoicesBlock = invoices.length > 0 ? (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Invoices &amp; receipts</div>
      <div data-testid="invoices-list" style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
        {invoices.map((inv, i) => (
          <div
            key={inv.id}
            data-testid="invoice-row"
            data-source={inv.source}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 16px', borderTop: i === 0 ? 'none' : `1px solid ${border}`, background: i % 2 ? (dark ? '#1F2937' : '#F9FAFB') : surface }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: heading }}>{fmtDate(inv.billedAt)}</div>
              <div style={{ fontSize: 11, color: muted }}>
                {inv.number ?? inv.id}{inv.source === 'manual' ? ' · Receipt' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: body }}>{fmtAmount(inv.amountMinor, inv.currency)}</span>
              <button
                type="button"
                data-testid="invoice-view-btn"
                onClick={() => setViewInvoice({ id: inv.id, source: inv.source })}
                style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                View PDF
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const viewerBlock = viewInvoice ? (
    <div
      data-testid="invoice-viewer"
      onClick={() => setViewInvoice(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: surface, borderRadius: 14, width: 'min(900px, 100%)', height: 'min(85vh, 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: heading }}>{viewInvoice.source === 'manual' ? 'Receipt' : 'Invoice'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a
              data-testid="invoice-download-btn"
              href={invoiceHref(viewInvoice)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: NAVY, padding: '7px 14px', borderRadius: 8, textDecoration: 'none' }}
            >
              Download
            </a>
            <button
              type="button"
              onClick={() => setViewInvoice(null)}
              style={{ fontSize: 18, lineHeight: 1, color: muted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        </div>
        <iframe
          data-testid="invoice-viewer-frame"
          title="Invoice PDF"
          src={invoiceHref(viewInvoice)}
          style={{ border: 'none', width: '100%', flex: 1, background: '#fff' }}
        />
      </div>
    </div>
  ) : null;

  // Manual (admin-assigned, offline-paid) plan: show plan + status + start +
  // expiry from the local row. NO Paddle-only actions (no cancel / upgrade /
  // update-card / invoices), since this plan is not billed through Paddle.
  if (sub.source === 'manual') {
    return (
      <div data-testid="subscription-panel" data-platform={platform} data-source="manual" style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <h3 style={sectionTitle}>{headerName}</h3>
          <span data-testid="subscription-source" style={{ fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Managed by your team
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Plan</div>
            <div data-testid="subscription-plan" style={{ fontSize: 16, fontWeight: 800, color: heading }}>{planName ?? '-'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Status</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: heading }}>{titleCase(sub.status) ?? 'Active'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Started</div>
            <div data-testid="manual-started" style={{ fontSize: 16, fontWeight: 800, color: heading }}>{fmtDate(sub.startedAt ?? null)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Expires</div>
            <div data-testid="manual-expires" style={{ fontSize: 16, fontWeight: 800, color: heading }}>{fmtDate(sub.expiresAt ?? null)}</div>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: muted, margin: '16px 0 0', lineHeight: 1.6 }}>
          This plan was set up by the team (offline / bank payment). To change or renew it, contact the team.
        </p>
        {invoicesBlock}
        {viewerBlock}
      </div>
    );
  }

  return (
    <div data-testid="subscription-panel" data-platform={platform} style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <h3 style={sectionTitle}>{headerName}</h3>
        <span data-testid="subscription-status" style={{ fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 999, background: st.bg, color: st.fg, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {st.label}
        </span>
      </div>

      {/* Summary grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 20 }}>
        {planName && (
          <div>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Plan</div>
            <div data-testid="subscription-plan" style={{ fontSize: 16, fontWeight: 800, color: heading }}>{planName}</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Amount</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: heading }}>
            {fmtAmount(sub.amountMinor, sub.currency)}{sub.billingInterval ? <span style={{ fontSize: 12, color: muted, fontWeight: 600 }}> / {sub.billingInterval === 'annual' ? 'yr' : 'mo'}</span> : null}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            {sub.canceled ? 'Access ends' : 'Next billing'}
          </div>
          <div data-testid="subscription-next-billing" style={{ fontSize: 16, fontWeight: 800, color: heading }}>
            {sub.canceled ? fmtDate(sub.scheduledCancelAt ?? sub.currentPeriodEndsAt) : fmtDate(sub.nextBilledAt)}
          </div>
        </div>
      </div>

      {/* Canceled notice */}
      {sub.canceled && (
        <div data-testid="subscription-cancel-result" style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
          <span style={{ fontSize: 13, color: '#92400E', fontWeight: 600 }}>
            Your subscription is set to cancel. You keep full access until {fmtDate(sub.scheduledCancelAt ?? sub.currentPeriodEndsAt)}, after which your plan reverts automatically.
          </span>
        </div>
      )}

      {/* Scheduled downgrade: current plan stays active until the renewal date,
          then switches to the lower plan. Cancelable before it applies. */}
      {scheduledChange && !sub.canceled && (
        <div data-testid="scheduled-change-notice" style={{ background: dark ? '#222B3A' : '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 10, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: body, fontWeight: 600, flex: 1, minWidth: 240, lineHeight: 1.6 }}>
            Scheduled change: your plan switches to <strong style={{ color: heading }}>{scheduledChange.label}</strong>{scheduledChange.interval ? ` (${scheduledChange.interval})` : ''} on <strong style={{ color: heading }}>{fmtDate(scheduledChange.effectiveAt)}</strong>. You keep {planName ?? 'your current plan'} until then. No charge until then.
          </span>
          <button
            data-testid="cancel-scheduled-change"
            type="button"
            onClick={doCancelSchedule}
            disabled={cancelingSchedule}
            style={{ background: 'transparent', border: `1.5px solid ${NAVY}`, color: heading, fontWeight: 700, fontSize: 12.5, padding: '7px 14px', borderRadius: 8, cursor: cancelingSchedule ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {cancelingSchedule ? 'Canceling...' : 'Cancel scheduled change'}
          </button>
        </div>
      )}

      {/* Upgrade / downgrade / interval change. Picking any target opens a
          confirm step that shows the target plan's full feature list + the
          prorated differential (previewed via Paddle; no charge until confirm). */}
      {!sub.canceled && planOptions.length > 0 && (() => {
        const curInterval: 'monthly' | 'annual' = sub.billingInterval ?? 'monthly';
        const otherInterval: 'monthly' | 'annual' = curInterval === 'annual' ? 'monthly' : 'annual';
        const currentLabel = planOptions.find((p) => p.plan_key === currentPlanKey)?.label ?? planName ?? 'current plan';
        const intervalWord = (iv: 'monthly' | 'annual') => (iv === 'annual' ? 'annual' : 'monthly');
        const diff = preview?.differential ?? null;
        return (
          <div data-testid="change-plan" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Change plan or billing</div>
            {!pendingChange ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {otherPlans.map((p) => (
                  <button
                    key={p.plan_key}
                    data-testid={`switch-to-${p.plan_key}`}
                    type="button"
                    onClick={() => openChange(p.plan_key, p.label, curInterval)}
                    style={{ background: 'transparent', border: `1.5px solid ${NAVY}`, color: heading, fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 9, cursor: 'pointer' }}
                  >
                    Switch to {p.label}
                  </button>
                ))}
                {currentPlanKey && (
                  <button
                    data-testid="switch-interval"
                    type="button"
                    onClick={() => openChange(currentPlanKey, currentLabel, otherInterval)}
                    style={{ background: 'transparent', border: `1.5px solid ${GOLD}`, color: heading, fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 9, cursor: 'pointer' }}
                  >
                    Switch to {intervalWord(otherInterval)} billing
                  </button>
                )}
              </div>
            ) : (
              <div data-testid="change-plan-confirm" style={{ background: dark ? '#222B3A' : '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 10, padding: '18px 20px' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: heading, marginBottom: 4 }}>
                  Switch to {pendingChange.label}
                </div>

                {/* Billing interval selector (re-previews the differential). */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 16px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: muted }}>Billing</span>
                  <div role="group" style={{ display: 'inline-flex', border: `1px solid ${border}`, borderRadius: 999, overflow: 'hidden' }}>
                    {(['monthly', 'annual'] as const).map((iv) => {
                      const on = pendingChange.interval === iv;
                      return (
                        <button
                          key={iv}
                          type="button"
                          data-testid={`interval-${iv}`}
                          onClick={() => setPendingChange((pc) => (pc ? { ...pc, interval: iv } : pc))}
                          disabled={switching}
                          style={{ background: on ? NAVY : 'transparent', color: on ? '#fff' : body, fontWeight: 700, fontSize: 12.5, padding: '7px 16px', border: 'none', cursor: 'pointer' }}
                        >
                          {iv === 'annual' ? 'Annual' : 'Monthly'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Full feature list of the target plan (from the pricing catalog). */}
                <div style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  What you get on {pendingChange.label}
                </div>
                {previewLoading && !preview ? (
                  <p style={{ fontSize: 13, color: muted, margin: '0 0 14px' }}>Loading plan details...</p>
                ) : (
                  <ul data-testid="change-plan-features" style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 18px' }}>
                    {(preview?.targetFeatures ?? []).map((f) => (
                      <li key={f.feature_key} style={{ fontSize: 13, color: body, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#16A34A', fontWeight: 800 }}>✓</span>
                        <span>{f.label}{f.detail ? <strong style={{ color: heading }}>{` (${f.detail})`}</strong> : null}</span>
                      </li>
                    ))}
                    {preview && (preview.targetFeatures?.length ?? 0) === 0 && (
                      <li style={{ fontSize: 13, color: muted }}>Feature list unavailable.</li>
                    )}
                  </ul>
                )}

                {/* Timing + differential (preview only, no charge yet). The copy
                    states WHEN the change applies: upgrades immediately (charge
                    now), downgrades at the next billing date (no charge now). */}
                <div data-testid="change-plan-differential" style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                  {previewLoading ? (
                    <span style={{ fontSize: 13, color: muted }}>Calculating...</span>
                  ) : preview?.sameAsCurrent ? (
                    <span style={{ fontSize: 13.5, color: body, fontWeight: 600 }}>This is your current plan and interval. No price change.</span>
                  ) : preview?.changeType === 'downgrade' ? (
                    <span data-testid="timing-downgrade" style={{ fontSize: 13.5, color: body, fontWeight: 600, lineHeight: 1.6 }}>
                      Takes effect on <strong style={{ color: heading }}>{fmtDate(preview.effectiveAt ?? null)}</strong>. You keep <strong style={{ color: heading }}>{preview.currentLabel ?? planName}</strong> until then, then move to <strong style={{ color: heading }}>{preview.targetLabel}</strong>{preview.newPrice ? <> at <strong style={{ color: heading }}>{fmtPrice(preview.newPrice)}</strong></> : null}. <strong style={{ color: heading }}>No charge today.</strong>
                    </span>
                  ) : preview?.changeType === 'interval' ? (
                    <span data-testid="timing-interval" style={{ fontSize: 13.5, color: body, fontWeight: 600, lineHeight: 1.6 }}>
                      Switch to <strong style={{ color: heading }}>{pendingChange.interval === 'annual' ? 'annual' : 'monthly'} billing</strong>{preview.newPrice ? <>, billed <strong style={{ color: heading }}>{fmtPrice(preview.newPrice)}</strong></> : null}. Takes effect <strong style={{ color: heading }}>immediately</strong>{diff && diff.action === 'charge' ? <>, charged <strong style={{ color: heading }}>{fmtAmount(diff.amountMinor, diff.currency)}</strong> now (prorated)</> : null}.
                    </span>
                  ) : diff && diff.action === 'charge' ? (
                    <span data-testid="timing-upgrade" style={{ fontSize: 13.5, color: body, fontWeight: 600 }}>Takes effect immediately. You will be charged <strong style={{ color: heading }}>{fmtAmount(diff.amountMinor, diff.currency)}</strong> today, prorated for the rest of this billing period.</span>
                  ) : diff && diff.action === 'credit' ? (
                    <span data-testid="timing-upgrade" style={{ fontSize: 13.5, color: body, fontWeight: 600 }}>Takes effect immediately. You will receive a <strong style={{ color: heading }}>credit of {fmtAmount(diff.amountMinor, diff.currency)}</strong>, applied to your account.</span>
                  ) : (
                    <span style={{ fontSize: 13, color: muted }}>Takes effect immediately. {preview?.previewError ? 'The exact prorated amount could not be previewed; Paddle will prorate when you confirm.' : 'No charge is due now for this change.'}</span>
                  )}
                </div>

                {/* Coupon for this change. An active public promo auto-applies
                    with no input (shown as "Discount applied"); a customer can also
                    type a code. Hidden for a deferred downgrade (no charge now) and
                    when the target equals the current plan. */}
                {!preview?.sameAsCurrent && preview?.changeType !== 'downgrade' && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: muted, marginBottom: 6 }}>Have a coupon code?</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        data-testid="change-coupon-input"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder="ENTER CODE"
                        disabled={switching}
                        style={{ flex: 1, minWidth: 160, padding: '8px 12px', fontSize: 13, border: `1px solid ${border}`, borderRadius: 8, background: dark ? '#1a2230' : '#fff', color: body, fontFamily: 'monospace', letterSpacing: '0.05em', textTransform: 'uppercase' }}
                      />
                      <button
                        type="button"
                        data-testid="change-coupon-apply"
                        onClick={() => setAppliedCoupon(couponInput.trim())}
                        disabled={switching || previewLoading || (!couponInput.trim() && !appliedCoupon)}
                        style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: NAVY, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: (switching || previewLoading) ? 0.6 : 1 }}
                      >
                        {appliedCoupon && appliedCoupon === couponInput.trim() ? 'Applied' : 'Apply'}
                      </button>
                    </div>
                    {preview?.couponError && (
                      <div data-testid="change-coupon-error" style={{ marginTop: 8, fontSize: 12.5, color: '#DC2626', fontWeight: 600 }}>{preview.couponError}</div>
                    )}
                    {preview?.discountLabel && !preview?.couponError && (
                      <div data-testid="change-discount-applied" style={{ marginTop: 8, fontSize: 12.5, color: '#15803D', fontWeight: 700 }}>Discount applied: {preview.discountLabel} (already reflected in the amount above).</div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    data-testid="change-plan-confirm-yes"
                    type="button"
                    onClick={doSwitch}
                    disabled={switching || previewLoading || preview?.sameAsCurrent}
                    style={{ background: NAVY, border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 9, cursor: (switching || previewLoading || preview?.sameAsCurrent) ? 'default' : 'pointer', opacity: (switching || previewLoading || preview?.sameAsCurrent) ? 0.6 : 1 }}
                  >
                    {switching
                      ? 'Changing...'
                      : preview?.changeType === 'downgrade'
                        ? `Schedule downgrade to ${pendingChange.label}`
                        : preview?.changeType === 'interval'
                          ? `Switch to ${intervalWord(pendingChange.interval)} billing`
                          : `Confirm: ${pendingChange.label}, ${intervalWord(pendingChange.interval)}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingChange(null)}
                    disabled={switching}
                    style={{ background: 'transparent', border: `1.5px solid ${border}`, color: body, fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 9, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: invoices.length ? 22 : 0 }}>
        {sub.updatePaymentMethodUrl && (
          <a
            data-testid="update-payment-btn"
            href={sub.updatePaymentMethodUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1.5px solid ${NAVY}`, color: heading, fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 9, textDecoration: 'none', cursor: 'pointer' }}
          >
            Update payment method
          </a>
        )}
        {!sub.canceled && !confirming && (
          <button
            data-testid="subscription-cancel-btn"
            type="button"
            onClick={() => { setConfirming(true); setError(null); }}
            style={{ background: 'transparent', border: `1.5px solid #DC2626`, color: '#DC2626', fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 9, cursor: 'pointer' }}
          >
            Cancel subscription
          </button>
        )}
      </div>

      {error && <p style={{ fontSize: 12.5, color: '#DC2626', margin: '0 0 14px' }}>{error}</p>}

      {/* Cancel confirmation step */}
      {confirming && !sub.canceled && (
        <div data-testid="subscription-cancel-confirm" style={{ background: dark ? '#222B3A' : '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 10, padding: '16px 18px', marginBottom: 22 }}>
          <p style={{ fontSize: 13.5, color: body, margin: '0 0 14px', lineHeight: 1.6 }}>
            Cancel your subscription? You will <strong>keep full access until {fmtDate(sub.nextBilledAt ?? sub.currentPeriodEndsAt)}</strong> (the end of the period you have paid for). After that your plan reverts automatically. You will not be charged again.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              data-testid="subscription-cancel-confirm-yes"
              type="button"
              onClick={doCancel}
              disabled={canceling}
              style={{ background: '#DC2626', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 9, cursor: canceling ? 'default' : 'pointer', opacity: canceling ? 0.7 : 1 }}
            >
              {canceling ? 'Canceling...' : 'Yes, cancel at period end'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={canceling}
              style={{ background: 'transparent', border: `1.5px solid ${border}`, color: body, fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 9, cursor: 'pointer' }}
            >
              Keep my subscription
            </button>
          </div>
        </div>
      )}

      {cancelResult && !confirming && (
        <p style={{ fontSize: 12.5, color: muted, margin: '0 0 18px' }}>
          Cancellation scheduled. Access ends {fmtDate(cancelResult)}.
        </p>
      )}

      {/* Combined invoices (Paddle + manual) + viewer, shared with the manual panel. */}
      {invoicesBlock}
      {viewerBlock}
    </div>
  );
}
