'use client';

/**
 * CouponManager (Discounts, auto-linked to Paddle)
 *
 * Discounts are created and managed in PADDLE (the single source of truth). This
 * screen reads the live Paddle discount list (via /api/admin/payments/discounts,
 * server-side) and does NOT re-enter discount data. The admin's only action here
 * is choosing which Paddle discount is the PUBLIC auto-apply promo (applied
 * automatically at checkout by id, no code, and shown on the marketing + pricing
 * pages). Discounts that carry a checkout code are private codes customers type.
 *
 * No em dashes in this file.
 */
import { useState, useEffect, useCallback } from 'react';

interface Discount {
  id: string; status: string; description: string | null; type: string;
  amount: string | null; currencyCode: string | null; code: string | null;
  enabledForCheckout: boolean; recur: boolean; usageLimit: number | null;
  timesUsed: number | null; expiresAt: string | null; restrictToPriceIds: string[];
}
interface Featured { discountId: string; label: string | null }

const PLATFORM = 'real-estate';

function amountText(d: Discount): string {
  const v = Number(d.amount);
  if (!Number.isFinite(v)) return '-';
  return d.type === 'percentage' ? `${v}%` : `${d.currencyCode ? d.currencyCode.toUpperCase() + ' ' : ''}${(v / 100).toLocaleString()}`;
}

export function CouponManager() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [paddleReady, setPaddleReady] = useState(true);
  const [labelInput, setLabelInput] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const j = await fetch(`/api/admin/payments/discounts?platform=${PLATFORM}`).then((r) => r.json());
      setDiscounts(j.discounts ?? []);
      setFeatured(j.featured ?? null);
      setPaddleReady(j.paddleReady !== false);
      setLabelInput((j.featured?.label as string | undefined) ?? '');
    } catch { showToast('Failed to load discounts', 'error'); }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const feature = useCallback(async (discountId: string | null, label: string | null) => {
    setSaving(discountId ?? 'clear');
    try {
      const res = await fetch('/api/admin/payments/discounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: PLATFORM, discountId, label }),
      });
      if (res.ok) { showToast(discountId ? 'Public promo updated' : 'Public promo cleared', 'success'); await load(); }
      else { showToast('Failed to update promo', 'error'); }
    } catch { showToast('Failed', 'error'); }
    finally { setSaving(null); }
  }, [load, showToast]);

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 24 }} data-testid="coupon-manager">
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A' }}>Discounts</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          Created and managed in Paddle (single source of truth). This list reads live from Paddle: create a discount once in Paddle and it appears here with its real percentage, code, expiry, and limits. Pick one as the <strong>public auto-apply promo</strong> (applied automatically at checkout, no code). Discounts that have a code are private codes customers type at checkout.
        </div>
      </div>

      {!paddleReady && (
        <div data-testid="discounts-not-ready" style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: 12, fontSize: 12.5, color: '#92400E' }}>
          Paddle is not configured (no server API key, or Paddle is not the active provider). Set the Paddle API key in Admin &gt; Payments to load discounts.
        </div>
      )}

      {paddleReady && (
        <>
          {/* Featured public promo summary + label + clear */}
          <div style={{ background: '#F9FAFB', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A', marginBottom: 6 }}>Public auto-apply promo</div>
            {featured ? (
              <div data-testid="featured-promo" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: '#374151' }}>Featured discount: <strong style={{ fontFamily: 'monospace' }}>{featured.discountId}</strong></span>
                <input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} placeholder="Display label (e.g. Launch offer)"
                  data-testid="featured-label" style={{ ...INP, maxWidth: 240 }} />
                <button onClick={() => feature(featured.discountId, labelInput.trim() || null)} disabled={saving !== null} data-testid="featured-save-label"
                  style={{ ...BTN, background: '#1B4F8A', color: '#fff' }}>Save label</button>
                <button onClick={() => feature(null, null)} disabled={saving !== null} data-testid="featured-clear"
                  style={{ ...BTN, background: '#fff', color: '#DC2626', border: '1px solid #FECACA' }}>Clear promo</button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#6B7280' }} data-testid="featured-none">No public promo is active. Choose one below to auto-apply it at checkout and show it on the site.</div>
            )}
          </div>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0D2E5A' }}>
                  {['Code', 'Amount', 'Checkout', 'Expiry', 'Uses', 'Status', 'Public promo'].map((h) => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {discounts.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }} data-testid="discounts-empty">No active discounts in Paddle yet. Create one in Paddle and it will appear here.</td></tr>
                ) : discounts.map((d, i) => {
                  const isFeatured = featured?.discountId === d.id;
                  return (
                    <tr key={d.id} data-testid={`discount-row-${d.id}`} style={{ borderTop: '1px solid #f1f5f9', background: isFeatured ? '#EAF2FB' : (i % 2 === 0 ? '#fff' : '#F9FAFB') }}>
                      <td style={{ padding: '9px 12px', fontSize: 13 }}>
                        {d.code
                          ? <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#0D2E5A' }}>{d.code}</span>
                          : <span style={{ fontSize: 11, color: '#94a3b8' }}>no code (auto-apply only)</span>}
                        {d.description ? <div style={{ fontSize: 10, color: '#94a3b8' }}>{d.description}</div> : null}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600, color: '#374151' }}>{amountText(d)}{d.recur ? <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>recurring</span> : null}</td>
                      <td style={{ padding: '9px 12px', fontSize: 11 }}>{d.enabledForCheckout ? <span style={{ color: '#1A7A30', fontWeight: 700 }}>Enabled</span> : <span style={{ color: '#DC2626', fontWeight: 700 }}>Disabled</span>}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#6B7280' }}>{d.expiresAt ? new Date(d.expiresAt).toLocaleDateString() : 'Never'}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#6B7280' }}>{d.timesUsed ?? 0}{d.usageLimit ? `/${d.usageLimit}` : ''}</td>
                      <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: d.status === 'active' ? '#E8F7EC' : '#F3F4F6', color: d.status === 'active' ? '#1A7A30' : '#6B7280' }}>{d.status}</span></td>
                      <td style={{ padding: '9px 12px' }}>
                        {isFeatured ? (
                          <span data-testid={`discount-featured-${d.id}`} style={{ fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 10, background: '#1B4F8A', color: '#fff' }}>Public promo</span>
                        ) : (
                          <button onClick={() => feature(d.id, labelInput.trim() || d.description || null)} disabled={saving !== null} data-testid={`discount-feature-${d.id}`}
                            style={{ ...BTN, background: '#fff', color: '#1B4F8A', border: '1px solid #1B4F8A' }}>Feature</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 18px', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, background: toast.type === 'success' ? '#2EAA4A' : '#DC2626', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 2000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const INP: React.CSSProperties = { padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' };
const BTN: React.CSSProperties = { fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer' };
