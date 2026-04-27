'use client';
import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlatPlan {
  id: string; platform_slug: string; plan_name: string; plan_label: string;
  price_monthly: number | null; price_label: string | null; description: string | null;
  is_featured: boolean; is_custom: boolean; badge_text: string | null; badge_color: string | null;
  cta_text: string; cta_url: string; features: string[]; display_order: number;
  is_active: boolean; trial_days: number; max_projects: number | null;
}
interface PlatFeature { id: string; platform_slug: string; feature_key: string; feature_text: string; feature_category: string; display_order: number; }
interface FeatAccess { plan_id: string; feature_id: string; is_included: boolean; override_text: string | null; }
interface Coupon { id: string; code: string; discount_type: string; discount_value: number; applicable_plans: string[]; applicable_platforms: string[]; max_uses: number | null; used_count: number; expires_at: string | null; is_active: boolean; }

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPricingPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Platform pricing
  const [platPlans, setPlatPlans]     = useState<PlatPlan[]>([]);
  const [platFeatures, setPlatFeatures] = useState<PlatFeature[]>([]);
  const [platAccess, setPlatAccess]   = useState<FeatAccess[]>([]);
  const [coupons, setCoupons]         = useState<Coupon[]>([]);
  const [platLoading, setPlatLoading] = useState(true);
  const [selectedPlatPlan, setSelectedPlatPlan] = useState<string | null>(null);
  const [platEdits, setPlatEdits]     = useState<Record<string, unknown>>({});
  const [accessEdits, setAccessEdits] = useState<Map<string, { is_included: boolean; override_text: string }>>(new Map());
  const [showCouponForm, setShowCouponForm] = useState(false);
  const [couponForm, setCouponForm]   = useState({ code: '', discount_type: 'percentage', discount_value: '20', max_uses: '100', expires_at: '' });

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Load platform data on mount ──────────────────────────────────────────────

  const loadPlatformData = useCallback(async () => {
    setPlatLoading(true);
    try {
      const [pp, pf, cp] = await Promise.all([
        fetch('/api/admin/pricing/platform').then(r => r.json()),
        fetch('/api/admin/pricing/features?platform=real-estate').then(r => r.json()),
        fetch('/api/admin/pricing/coupons').then(r => r.json()),
      ]);
      setPlatPlans(pp.plans ?? []);
      setPlatFeatures(pf.features ?? []);
      setPlatAccess(pf.access ?? []);
      setCoupons(cp.coupons ?? []);
    } catch { showToast('Failed to load platform data', 'error'); }
    finally { setPlatLoading(false); }
  }, [showToast]);

  useEffect(() => { void loadPlatformData(); }, [loadPlatformData]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function selectPlatPlan(plan: PlatPlan) {
    setSelectedPlatPlan(plan.id);
    setPlatEdits({ plan_label: plan.plan_label, price_monthly: plan.price_monthly ?? '', price_label: plan.price_label ?? '', description: plan.description ?? '', trial_days: plan.trial_days, max_projects: plan.max_projects ?? '', badge_text: plan.badge_text ?? '', badge_color: plan.badge_color ?? '#1ABC9C', cta_text: plan.cta_text, cta_url: plan.cta_url, is_featured: plan.is_featured, is_active: plan.is_active, is_custom: plan.is_custom });
    const am = new Map<string, { is_included: boolean; override_text: string }>();
    for (const a of platAccess.filter(x => x.plan_id === plan.id)) {
      am.set(a.feature_id, { is_included: a.is_included, override_text: a.override_text ?? '' });
    }
    setAccessEdits(am);
  }

  async function savePlatPlan() {
    if (!selectedPlatPlan) return;
    setSaving(true);
    try {
      const featureAccess = [...accessEdits.entries()].map(([fid, v]) => ({ feature_id: fid, is_included: v.is_included, override_text: v.override_text || null }));
      const res = await fetch('/api/admin/pricing/platform', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedPlatPlan, ...platEdits, featureAccess }) });
      if (res.ok) { showToast('Plan saved', 'success'); await loadPlatformData(); } else { showToast('Save failed', 'error'); }
    } catch { showToast('Save failed', 'error'); }
    finally { setSaving(false); }
  }

  async function createCoupon() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/pricing/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: couponForm.code.toUpperCase(), discount_type: couponForm.discount_type, discount_value: parseFloat(couponForm.discount_value), max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses) : null, expires_at: couponForm.expires_at || null }) });
      if (res.ok) { showToast('Coupon created', 'success'); setShowCouponForm(false); setCouponForm({ code: '', discount_type: 'percentage', discount_value: '20', max_uses: '100', expires_at: '' }); await loadPlatformData(); } else { showToast('Failed to create coupon', 'error'); }
    } catch { showToast('Failed', 'error'); }
    finally { setSaving(false); }
  }

  async function toggleCoupon(id: string, active: boolean) {
    await fetch('/api/admin/pricing/coupons', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_active: !active }) });
    await loadPlatformData();
  }

  async function deleteCoupon(id: string) {
    if (!confirm('Delete this coupon?')) return;
    await fetch(`/api/admin/pricing/coupons?id=${id}`, { method: 'DELETE' });
    await loadPlatformData();
  }

  if (authLoading) return null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/pricing" />

      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>Pricing Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>
          Per-platform pricing plans, feature access, and coupon codes. Hero text and FAQ for the public <strong>/pricing</strong> page are edited in <strong>Page Builder &rarr; Pricing</strong>.
        </p>

        {platLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading...</div> : (
          <>
            {/* Plan Cards */}
            <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Platform Plans &mdash; Real Estate</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
              {platPlans.filter(p => p.platform_slug === 'real-estate').map(plan => (
                <button key={plan.id} onClick={() => selectPlatPlan(plan)} style={{
                  padding: '16px 14px', borderRadius: 10, border: selectedPlatPlan === plan.id ? '2px solid #1B4F8A' : '2px solid #E5E7EB',
                  background: selectedPlatPlan === plan.id ? '#EFF6FF' : '#fff', cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{plan.plan_label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', marginTop: 4 }}>{plan.price_label ?? 'Free'}</div>
                  {!plan.is_active && <span style={{ fontSize: 9, color: '#DC2626', fontWeight: 700 }}>INACTIVE</span>}
                </button>
              ))}
            </div>

            {/* Plan Edit */}
            {selectedPlatPlan && (() => {
              const pe = platEdits;
              const set = (k: string, v: unknown) => setPlatEdits(prev => ({ ...prev, [k]: v }));
              const IS2: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' };
              const LS2: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3, display: 'block' };
              const categories = [...new Set(platFeatures.map(f => f.feature_category))];

              return (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 32 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Edit Plan</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <div><label style={LS2}>Label</label><input style={IS2} value={(pe.plan_label as string) ?? ''} onChange={e => set('plan_label', e.target.value)} /></div>
                    <div><label style={LS2}>Price ($/mo)</label><input type="number" style={IS2} value={pe.price_monthly as string ?? ''} onChange={e => set('price_monthly', e.target.value ? parseFloat(e.target.value) : null)} /></div>
                    <div><label style={LS2}>Price Label</label><input style={IS2} value={(pe.price_label as string) ?? ''} onChange={e => set('price_label', e.target.value)} /></div>
                  </div>
                  <div style={{ marginBottom: 16 }}><label style={LS2}>Description</label><textarea style={{ ...IS2, minHeight: 48, resize: 'vertical' }} value={(pe.description as string) ?? ''} onChange={e => set('description', e.target.value)} /></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <div><label style={LS2}>Trial Days</label><input type="number" style={IS2} value={pe.trial_days as number ?? 0} onChange={e => set('trial_days', parseInt(e.target.value) || 0)} /></div>
                    <div><label style={LS2}>Max Projects</label><input type="number" style={IS2} value={pe.max_projects as string ?? ''} onChange={e => set('max_projects', e.target.value ? parseInt(e.target.value) : null)} placeholder="∞" /></div>
                    <div><label style={LS2}>CTA Text</label><input style={IS2} value={(pe.cta_text as string) ?? ''} onChange={e => set('cta_text', e.target.value)} /></div>
                    <div><label style={LS2}>CTA URL</label><input style={IS2} value={(pe.cta_url as string) ?? ''} onChange={e => set('cta_url', e.target.value)} /></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <div><label style={LS2}>Badge Text</label><input style={IS2} value={(pe.badge_text as string) ?? ''} onChange={e => set('badge_text', e.target.value)} /></div>
                    <div><label style={LS2}>Badge Color</label><div style={{ display: 'flex', gap: 6 }}><input type="color" value={(pe.badge_color as string) || '#1ABC9C'} onChange={e => set('badge_color', e.target.value)} style={{ width: 32, height: 32, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer' }} /><input style={IS2} value={(pe.badge_color as string) ?? ''} onChange={e => set('badge_color', e.target.value)} /></div></div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}><input type="checkbox" checked={!!pe.is_featured} onChange={e => set('is_featured', e.target.checked)} /> Featured</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}><input type="checkbox" checked={!!pe.is_active} onChange={e => set('is_active', e.target.checked)} /> Active</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}><input type="checkbox" checked={!!pe.is_custom} onChange={e => set('is_custom', e.target.checked)} /> Custom (hide price)</label>
                  </div>

                  {/* Feature Toggles */}
                  <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#1B3A6B', marginBottom: 12 }}>Feature Access</div>
                    {categories.map(cat => (
                      <div key={cat} style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{cat}</div>
                        {platFeatures.filter(f => f.feature_category === cat).map(feat => {
                          const a = accessEdits.get(feat.id) ?? { is_included: false, override_text: '' };
                          return (
                            <div key={feat.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, padding: '6px 8px', borderRadius: 6, background: a.is_included ? '#F0FFF4' : '#F9FAFB' }}>
                              <input type="checkbox" checked={a.is_included} onChange={e => { const n = new Map(accessEdits); n.set(feat.id, { ...a, is_included: e.target.checked }); setAccessEdits(n); }} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                              <span style={{ fontSize: 13, color: a.is_included ? '#1B3A6B' : '#9CA3AF', flex: 1, fontWeight: a.is_included ? 600 : 400 }}>{feat.feature_text}</span>
                              <input style={{ width: 120, padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: 11, color: '#6B7280' }} value={a.override_text} onChange={e => { const n = new Map(accessEdits); n.set(feat.id, { ...a, override_text: e.target.value }); setAccessEdits(n); }} placeholder="Override text" />
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <button onClick={savePlatPlan} disabled={saving} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving...' : 'Save Plan'}
                  </button>
                </div>
              );
            })()}

            {/* Coupon Codes */}
            <div style={{ borderTop: '2px solid #E8F0FB', paddingTop: 32, marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', margin: 0 }}>Coupon Codes</h2>
                <button onClick={() => setShowCouponForm(!showCouponForm)} style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #1B4F8A', background: showCouponForm ? '#1B4F8A' : '#fff', color: showCouponForm ? '#fff' : '#1B4F8A', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {showCouponForm ? 'Cancel' : '+ Create Coupon'}
                </button>
              </div>

              {showCouponForm && (
                <div style={{ background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB', padding: 20, marginBottom: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div><label style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Code</label><input style={{ width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, textTransform: 'uppercase', fontFamily: 'monospace', boxSizing: 'border-box' }} value={couponForm.code} onChange={e => setCouponForm(f => ({ ...f, code: e.target.value }))} placeholder="LAUNCH20" /></div>
                    <div><label style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Type</label><select style={{ width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} value={couponForm.discount_type} onChange={e => setCouponForm(f => ({ ...f, discount_type: e.target.value }))}><option value="percentage">Percentage</option><option value="fixed">Fixed Amount</option></select></div>
                    <div><label style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Value</label><input type="number" style={{ width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} value={couponForm.discount_value} onChange={e => setCouponForm(f => ({ ...f, discount_value: e.target.value }))} /></div>
                    <div><label style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Max Uses</label><input type="number" style={{ width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} value={couponForm.max_uses} onChange={e => setCouponForm(f => ({ ...f, max_uses: e.target.value }))} placeholder="0 = unlimited" /></div>
                  </div>
                  <button onClick={createCoupon} disabled={saving || !couponForm.code.trim()} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: '#2EAA4A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Create Coupon</button>
                </div>
              )}

              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#1B4F8A' }}>
                      {['Code', 'Type', 'Value', 'Used', 'Expires', 'Active', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.length === 0 ? (
                      <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No coupons yet</td></tr>
                    ) : coupons.map((c, i) => (
                      <tr key={c.id} style={{ borderTop: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#F9FAFB' }}>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#1B3A6B' }}>{c.code}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#6B7280' }}>{c.discount_type === 'percentage' ? '%' : '$'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151' }}>{c.discount_type === 'percentage' ? `${c.discount_value}%` : `$${c.discount_value}`}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#6B7280' }}>{c.used_count}{c.max_uses ? `/${c.max_uses}` : ''}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#6B7280' }}>{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}</td>
                        <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: c.is_active ? '#E8F7EC' : '#F3F4F6', color: c.is_active ? '#1A7A30' : '#6B7280' }}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => toggleCoupon(c.id, c.is_active)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer' }}>{c.is_active ? 'Deactivate' : 'Activate'}</button>
                            <button onClick={() => deleteCoupon(c.id)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
