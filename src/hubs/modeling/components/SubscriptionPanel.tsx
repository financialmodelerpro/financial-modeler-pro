'use client';

/**
 * SubscriptionPanel.tsx (client)
 *
 * In-dashboard Subscription & Billing panel. Reads the user's subscription and
 * invoices from OUR server routes (which call Paddle server-side; the API key
 * never reaches here) and lets the user:
 *   - see plan, status, next billing date + amount;
 *   - cancel AT PERIOD END (confirm step + clear result; access is kept until
 *     the period ends, then the existing webhook drops them to baseline);
 *   - list invoices / receipts with a link to the Paddle-hosted PDF;
 *   - open Paddle's secure hosted flow to update the payment method (we never
 *     render a card form; the card entry happens in Paddle's component).
 *
 * No raw card data is ever handled here. No Paddle API call is ever made from
 * the client. No em dashes in this file.
 */
import { useCallback, useEffect, useState } from 'react';

const NAVY = '#0D2E5A';
const GOLD = '#C9A84C';

interface SubscriptionSummary {
  subscriptionId: string;
  status: string;
  nextBilledAt: string | null;
  currentPeriodEndsAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  scheduledCancelAt: string | null;
  canceled: boolean;
  updatePaymentMethodUrl: string | null;
}
interface InvoiceSummary {
  transactionId: string;
  status: string;
  billedAt: string | null;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtAmount(minor: number | null, currency: string | null): string {
  if (minor === null || currency === null) return '-';
  // Paddle amounts are in minor units. Most currencies are 2-decimal; format via
  // Intl so the currency symbol + grouping are correct for the sandbox currency.
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
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

export default function SubscriptionPanel({ dark = false, planKey = null }: { dark?: boolean; planKey?: string | null }) {
  const surface = dark ? '#1A222F' : '#FFFFFF';
  const border = dark ? '#2A3543' : '#E5E7EB';
  const heading = dark ? '#F1F5F9' : NAVY;
  const body = dark ? '#D1D5DB' : '#374151';
  const muted = dark ? '#94A3B8' : '#6B7280';

  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubscriptionSummary | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelResult, setCancelResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/payments/subscription', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
      fetch('/api/payments/invoices', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
    ])
      .then(([s, inv]) => {
        setSub(s?.subscription ?? null);
        setReason(s?.reason ?? null);
        setInvoices(Array.isArray(inv?.invoices) ? inv.invoices : []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const doCancel = useCallback(() => {
    setCanceling(true);
    setError(null);
    fetch('/api/payments/subscription/cancel', { method: 'POST', credentials: 'same-origin' })
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
  }, []);

  const card: React.CSSProperties = {
    background: surface, border: `1px solid ${border}`, borderRadius: 14,
    padding: '22px 24px', marginBottom: 28,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 13, fontWeight: 700, color: body, margin: 0,
    textTransform: 'uppercase', letterSpacing: '0.06em',
  };

  if (loading) {
    return (
      <div data-testid="subscription-panel" style={card}>
        <h2 style={sectionTitle}>Subscription & Billing</h2>
        <p style={{ fontSize: 13, color: muted, marginTop: 12 }}>Loading your subscription...</p>
      </div>
    );
  }

  // No managed subscription: friendly empty state (trial / none / not configured).
  if (!sub) {
    return (
      <div data-testid="subscription-panel" style={card}>
        <h2 style={sectionTitle}>Subscription & Billing</h2>
        <div data-testid="no-subscription-state" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13.5, color: muted, margin: 0, flex: 1, minWidth: 240, lineHeight: 1.6 }}>
            {reason === 'not_configured'
              ? 'Online subscription management is not enabled yet. Your plan is managed by the team for now.'
              : 'You do not have a self-managed subscription yet. Choose a plan to subscribe online and manage it here.'}
          </p>
          <a href="/pricing" style={{ background: GOLD, color: NAVY, fontWeight: 800, fontSize: 13, padding: '9px 18px', borderRadius: 9, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            View plans &rarr;
          </a>
        </div>
      </div>
    );
  }

  const st = statusLabel(sub.status, sub.canceled);
  const planName = planKey ? planKey.charAt(0).toUpperCase() + planKey.slice(1) : null;

  return (
    <div data-testid="subscription-panel" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <h2 style={sectionTitle}>Subscription & Billing</h2>
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
          <div style={{ fontSize: 16, fontWeight: 800, color: heading }}>{fmtAmount(sub.amountMinor, sub.currency)}</div>
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

      {/* Confirmation step */}
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
          {error && <p style={{ fontSize: 12.5, color: '#DC2626', margin: '12px 0 0' }}>{error}</p>}
        </div>
      )}

      {cancelResult && !confirming && (
        <p style={{ fontSize: 12.5, color: muted, margin: '0 0 18px' }}>
          Cancellation scheduled. Access ends {fmtDate(cancelResult)}.
        </p>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <div>
          <h3 style={{ ...sectionTitle, fontSize: 12, marginBottom: 12 }}>Invoices & receipts</h3>
          <div data-testid="invoices-list" style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
            {invoices.map((inv, i) => (
              <div
                key={inv.transactionId}
                data-testid="invoice-row"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 16px', borderTop: i === 0 ? 'none' : `1px solid ${border}`, background: i % 2 ? (dark ? '#1F2937' : '#F9FAFB') : surface }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: heading }}>{fmtDate(inv.billedAt)}</div>
                  <div style={{ fontSize: 11, color: muted }}>{inv.invoiceNumber ?? inv.transactionId}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: body }}>{fmtAmount(inv.amountMinor, inv.currency)}</span>
                  <a
                    href={`/api/payments/invoice/${encodeURIComponent(inv.transactionId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    View PDF &rarr;
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
