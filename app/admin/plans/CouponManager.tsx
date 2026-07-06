'use client';

/**
 * CouponManager
 *
 * Discount management in the Plan Builder. Model 1: each entry REFERENCES a real
 * Paddle discount (created in Paddle) by its discount id; the platform stores the
 * code, a display label/percentage for marketing text, a kind (public auto-apply
 * promo / private code), an active toggle, and validity dates. It does NOT create
 * the Paddle discount. A code reduces the actual charge ONLY when its Paddle
 * discount id is set (the checkout passes it to Paddle, which validates + applies).
 * Talks to /api/admin/pricing/coupons.
 *
 * No em dashes in this file.
 */
import { useState, useEffect, useCallback } from 'react';

interface Coupon {
  id: string; code: string; discount_type: string; discount_value: number;
  max_uses: number | null; used_count: number; expires_at: string | null; is_active: boolean;
  paddle_discount_id: string | null; kind: string | null; display_label: string | null; starts_at: string | null;
}

const EMPTY_FORM = { code: '', discount_type: 'percentage', discount_value: '20', max_uses: '100', expires_at: '', paddle_discount_id: '', kind: 'private', display_label: '', starts_at: '' };

export function CouponManager() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/admin/pricing/coupons').then((r) => r.json());
      setCoupons(j.coupons ?? []);
    } catch { showToast('Failed to load coupons', 'error'); }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const createCoupon = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/pricing/coupons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code.toUpperCase(), discount_type: form.discount_type,
          discount_value: parseFloat(form.discount_value),
          max_uses: form.max_uses ? parseInt(form.max_uses) : null,
          expires_at: form.expires_at || null,
          paddle_discount_id: form.paddle_discount_id.trim() || null,
          kind: form.kind === 'public' ? 'public' : 'private',
          display_label: form.display_label.trim() || null,
          starts_at: form.starts_at || null,
        }),
      });
      if (res.ok) { showToast('Coupon created', 'success'); setShowForm(false); setForm(EMPTY_FORM); await load(); }
      else { showToast('Failed to create coupon', 'error'); }
    } catch { showToast('Failed', 'error'); }
    finally { setSaving(false); }
  }, [form, load, showToast]);

  const toggleCoupon = useCallback(async (id: string, active: boolean) => {
    await fetch('/api/admin/pricing/coupons', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_active: !active }) });
    await load();
  }, [load]);

  const deleteCoupon = useCallback(async (id: string) => {
    if (!confirm('Delete this coupon?')) return;
    await fetch(`/api/admin/pricing/coupons?id=${id}`, { method: 'DELETE' });
    await load();
  }, [load]);

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 24 }} data-testid="coupon-manager">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A' }}>Discount codes</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Each code REFERENCES a Paddle discount. Create the discount in Paddle first, then paste its discount id here to make the code actually reduce the charge.</div>
        </div>
        <button onClick={() => setShowForm(!showForm)} data-testid="coupon-toggle-form"
          style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #1B4F8A', background: showForm ? '#1B4F8A' : '#fff', color: showForm ? '#fff' : '#1B4F8A', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {showForm ? 'Cancel' : '+ Create coupon'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#F9FAFB', borderRadius: 8, border: '1px solid #e5e7eb', padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div><label style={LBL}>Code</label><input data-testid="coupon-code" style={{ ...INP, textTransform: 'uppercase', fontFamily: 'monospace' }} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="LAUNCH20" /></div>
            <div><label style={LBL}>Kind</label><select data-testid="coupon-kind" style={INP} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}><option value="private">Private (customer enters it)</option><option value="public">Public (auto-apply + shown)</option></select></div>
            <div><label style={LBL}>Type</label><select style={INP} value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></div>
            <div><label style={LBL}>Value (for display)</label><input type="number" style={INP} value={form.discount_value} onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))} /></div>
            <div><label style={LBL}>Display label</label><input style={INP} value={form.display_label} onChange={(e) => setForm((f) => ({ ...f, display_label: e.target.value }))} placeholder="Launch offer" /></div>
            <div><label style={LBL}>Max uses</label><input type="number" style={INP} value={form.max_uses} onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))} placeholder="blank = unlimited" /></div>
            <div><label style={LBL}>Starts</label><input type="date" style={INP} value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} /></div>
            <div><label style={LBL}>Expires</label><input type="date" style={INP} value={form.expires_at} onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))} /></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={LBL}>Paddle discount id</label>
            <input data-testid="coupon-paddle-id" style={{ ...INP, fontFamily: 'monospace' }} value={form.paddle_discount_id} onChange={(e) => setForm((f) => ({ ...f, paddle_discount_id: e.target.value }))} placeholder="dsc_..." />
            <div style={{ fontSize: 11, color: '#B45309', marginTop: 4 }}>The discount MUST already exist in Paddle (Paddle owns the discount). Without a Paddle discount id this code will NOT reduce the charge, it will only display.</div>
          </div>
          <button onClick={createCoupon} disabled={saving || !form.code.trim()} data-testid="coupon-create"
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#2EAA4A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Create discount</button>
        </div>
      )}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0D2E5A' }}>
              {['Code', 'Kind', 'Value', 'Paddle', 'Used', 'Expires', 'Active', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }} data-testid="coupon-empty">No discounts yet</td></tr>
            ) : coupons.map((c, i) => (
              <tr key={c.id} data-testid={`coupon-row-${c.code}`} style={{ borderTop: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#F9FAFB' }}>
                <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#0D2E5A' }}>{c.code}{c.display_label ? <div style={{ fontSize: 10, fontWeight: 600, fontFamily: 'inherit', color: '#94a3b8' }}>{c.display_label}</div> : null}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, fontWeight: 700 }}><span style={{ padding: '3px 8px', borderRadius: 10, background: c.kind === 'public' ? '#EAF2FB' : '#F3F4F6', color: c.kind === 'public' ? '#1B4F8A' : '#6B7280' }}>{c.kind === 'public' ? 'Public' : 'Private'}</span></td>
                <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600, color: '#374151' }}>{c.discount_type === 'percentage' ? `${c.discount_value}%` : c.discount_value}</td>
                <td style={{ padding: '9px 12px', fontSize: 11 }} data-testid={`coupon-paddle-${c.code}`}>{c.paddle_discount_id
                  ? <span style={{ fontFamily: 'monospace', color: '#1A7A30' }} title={c.paddle_discount_id}>Linked</span>
                  : <span style={{ fontWeight: 700, color: '#DC2626' }} title="No Paddle discount id: this code will not reduce the charge">Not wired</span>}</td>
                <td style={{ padding: '9px 12px', fontSize: 12, color: '#6B7280' }}>{c.used_count}{c.max_uses ? `/${c.max_uses}` : ''}</td>
                <td style={{ padding: '9px 12px', fontSize: 12, color: '#6B7280' }}>{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}</td>
                <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: c.is_active ? '#E8F7EC' : '#F3F4F6', color: c.is_active ? '#1A7A30' : '#6B7280' }}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => toggleCoupon(c.id, c.is_active)} data-testid={`coupon-toggle-${c.code}`} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer' }}>{c.is_active ? 'Deactivate' : 'Activate'}</button>
                    <button onClick={() => deleteCoupon(c.id)} data-testid={`coupon-delete-${c.code}`} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 18px', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, background: toast.type === 'success' ? '#2EAA4A' : '#DC2626', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 2000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const LBL: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 3 };
const INP: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' };
