'use client';
import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Plan {
  id: string; name: string; code: string; tagline: string | null; description: string | null;
  price_monthly: number | null; price_yearly: number | null; price_display: string | null;
  currency: string; billing_period: string; is_featured: boolean; is_active: boolean;
  is_public: boolean; is_custom_client: boolean; client_name: string | null;
  client_user_ids: string[] | null; badge_text: string | null; badge_color: string;
  cta_text: string; cta_url: string; highlight_color: string | null; display_order: number;
  max_users: number | null; notes: string | null;
}

interface Feature {
  id: string; plan_id: string; category: string; feature_text: string;
  tooltip: string | null; is_included: boolean; display_order: number;
}

interface Mod { id: string; name: string; slug: string; icon: string; status: string; }
interface PricingMod { plan_id: string; module_code: string; is_included: boolean; }
interface UserOption { id: string; email: string; name: string | null; }

type Tab = 'plans' | 'features' | 'modules' | 'content';

const BLANK_FORM = {
  name: '', code: '', tagline: '', description: '',
  price_monthly: '0', price_yearly: '', price_display: '',
  currency: 'USD', billing_period: 'month',
  is_featured: false, is_active: true, is_public: true, is_custom_client: false,
  client_name: '', badge_text: '', badge_color: 'green',
  cta_text: 'Get Started', cta_url: '/login', highlight_color: '',
  display_order: '0', max_users: '', notes: '',
  expiry_date: '', contract_notes: '',
};
type FormState = typeof BLANK_FORM & { id?: string; client_user_ids?: UserOption[] };

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPricingPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [tab, setTab]           = useState<Tab>('plans');
  const [plans, setPlans]       = useState<Plan[]>([]);
  const [allMods, setAllMods]   = useState<Mod[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Plans tab
  const [editingPlan, setEditingPlan] = useState<FormState | null>(null);
  const [delConfirm, setDelConfirm]   = useState<string | null>(null);
  const [userSearch, setUserSearch]   = useState('');
  const [userResults, setUserResults] = useState<UserOption[]>([]);

  // Features tab
  const [featPlanId, setFeatPlanId]   = useState<string | null>(null);
  const [features, setFeatures]       = useState<Feature[]>([]);
  const [copyFromPlan, setCopyFromPlan] = useState('');
  const [showMatrix, setShowMatrix]   = useState(false);
  const [matrixFeatures, setMatrixFeatures] = useState<Feature[]>([]);

  // Modules tab
  const [modPlanId, setModPlanId]     = useState<string | null>(null);
  const [planMods, setPlanMods]       = useState<PricingMod[]>([]);

  // Page content tab
  const [cms, setCms]   = useState<Record<string, string>>({});
  const [faqs, setFaqs] = useState<{ question: string; answer: string }[]>([]);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Load initial data ────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/pricing/plans?all=true').then(r => r.json()),
      fetch('/api/admin/modules').then(r => r.json()),
      fetch('/api/admin/content').then(r => r.json()),
    ]).then(([p, m, c]) => {
      setPlans(p.plans ?? []);
      setAllMods(m.modules ?? []);
      const map: Record<string, string> = {};
      for (const row of c.rows ?? []) if (row.section === 'pricing_page') map[row.key] = row.value;
      setCms(map);
      try {
        if (map.faq) setFaqs(JSON.parse(map.faq));
      } catch { /* ignore */ }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // ── Load features when featPlanId changes ────────────────────────────────────

  useEffect(() => {
    if (!featPlanId) return;
    fetch(`/api/admin/pricing/features?plan_id=${featPlanId}`)
      .then(r => r.json()).then(j => setFeatures(j.features ?? []));
  }, [featPlanId]);

  // ── Load plan modules when modPlanId changes ─────────────────────────────────

  useEffect(() => {
    if (!modPlanId) return;
    fetch(`/api/admin/pricing/modules?plan_id=${modPlanId}`)
      .then(r => r.json()).then(j => setPlanMods(j.modules ?? []));
  }, [modPlanId]);

  // ── Styles ───────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties  = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };
  const lbl: React.CSSProperties  = { display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 };
  const fld: React.CSSProperties  = { marginBottom: 16 };
  const saveBtn = (onClick: () => void, label = 'Save Changes') => (
    <button disabled={saving} onClick={onClick} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
      {saving ? 'Saving…' : label}
    </button>
  );

  // ── Plan form helpers ────────────────────────────────────────────────────────

  function planFromRow(p: Plan): FormState {
    return {
      id: p.id, name: p.name, code: p.code, tagline: p.tagline ?? '', description: p.description ?? '',
      price_monthly: p.price_monthly != null ? String(p.price_monthly) : '',
      price_yearly: p.price_yearly != null ? String(p.price_yearly) : '',
      price_display: p.price_display ?? '', currency: p.currency, billing_period: p.billing_period,
      is_featured: p.is_featured, is_active: p.is_active, is_public: p.is_public,
      is_custom_client: p.is_custom_client, client_name: p.client_name ?? '',
      badge_text: p.badge_text ?? '', badge_color: p.badge_color, cta_text: p.cta_text,
      cta_url: p.cta_url, highlight_color: p.highlight_color ?? '',
      display_order: String(p.display_order), max_users: p.max_users != null ? String(p.max_users) : '',
      notes: p.notes ?? '', expiry_date: '', contract_notes: '',
      client_user_ids: p.client_user_ids ? p.client_user_ids.map(id => ({ id, email: id, name: null })) : [],
    };
  }

  function setFld(key: keyof FormState, val: unknown) {
    setEditingPlan(p => p ? { ...p, [key]: val } : p);
  }

  async function savePlan() {
    if (!editingPlan) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: editingPlan.name, code: editingPlan.code, tagline: editingPlan.tagline || null,
        description: editingPlan.description || null,
        price_monthly: editingPlan.price_monthly !== '' ? parseFloat(editingPlan.price_monthly) : null,
        price_yearly: editingPlan.price_yearly !== '' ? parseFloat(editingPlan.price_yearly) : null,
        price_display: editingPlan.price_display || null, currency: editingPlan.currency,
        billing_period: editingPlan.billing_period, is_featured: editingPlan.is_featured,
        is_active: editingPlan.is_active, is_public: editingPlan.is_public,
        is_custom_client: editingPlan.is_custom_client, client_name: editingPlan.client_name || null,
        client_user_ids: editingPlan.client_user_ids?.map(u => u.id) ?? [],
        badge_text: editingPlan.badge_text || null, badge_color: editingPlan.badge_color,
        cta_text: editingPlan.cta_text, cta_url: editingPlan.cta_url,
        highlight_color: editingPlan.highlight_color || null,
        display_order: parseInt(editingPlan.display_order) || 0,
        max_users: editingPlan.max_users !== '' ? parseInt(editingPlan.max_users) : null,
        notes: editingPlan.notes || null,
      };
      const method = editingPlan.id ? 'PATCH' : 'POST';
      if (editingPlan.id) body.id = editingPlan.id;
      const res = await fetch('/api/admin/pricing/plans', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Save failed', 'error'); return; }
      // Refresh list
      const pr = await fetch('/api/admin/pricing/plans?all=true').then(r => r.json());
      setPlans(pr.plans ?? []);
      setEditingPlan(null);
      showToast('Plan saved', 'success');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(id: string) {
    const res = await fetch(`/api/admin/pricing/plans?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setPlans(prev => prev.filter(p => p.id !== id));
      showToast('Plan deleted', 'success');
    } else {
      showToast('Delete failed', 'error');
    }
    setDelConfirm(null);
  }

  function duplicatePlan(p: Plan) {
    const form = planFromRow(p);
    form.id = undefined;
    form.code = p.code + '_copy';
    form.name = p.name + ' (Copy)';
    setEditingPlan(form);
  }

  // ── User search for client plans ─────────────────────────────────────────────

  useEffect(() => {
    if (userSearch.length < 2) { setUserResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/admin/users?search=${encodeURIComponent(userSearch)}&size=10`)
        .then(r => r.json()).then(j => setUserResults(j.users ?? []));
    }, 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  // ── Features CRUD ────────────────────────────────────────────────────────────

  function addFeature() {
    const newF: Feature = { id: `new_${Date.now()}`, plan_id: featPlanId!, category: 'General', feature_text: '', tooltip: null, is_included: true, display_order: features.length };
    setFeatures(prev => [...prev, newF]);
  }

  async function saveFeatures() {
    if (!featPlanId) return;
    setSaving(true);
    try {
      // Delete all existing features for plan, then insert current list
      const existing = features.filter(f => !f.id.startsWith('new_'));
      await Promise.all(existing.map(f => fetch(`/api/admin/pricing/features?id=${f.id}`, { method: 'DELETE' })));
      await Promise.all(features.map((f, i) =>
        fetch('/api/admin/pricing/features', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_id: featPlanId, category: f.category, feature_text: f.feature_text, tooltip: f.tooltip, is_included: f.is_included, display_order: i }),
        })
      ));
      // Reload
      const j = await fetch(`/api/admin/pricing/features?plan_id=${featPlanId}`).then(r => r.json());
      setFeatures(j.features ?? []);
      showToast('Features saved', 'success');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function copyFeaturesFrom() {
    if (!copyFromPlan || !featPlanId) return;
    const j = await fetch(`/api/admin/pricing/features?plan_id=${copyFromPlan}`).then(r => r.json());
    const copied: Feature[] = (j.features ?? []).map((f: Feature, i: number) => ({
      ...f, id: `new_${Date.now()}_${i}`, plan_id: featPlanId,
    }));
    setFeatures(prev => [...prev, ...copied]);
    setCopyFromPlan('');
    showToast('Features copied — click Save to persist', 'success');
  }

  // ── Module access ────────────────────────────────────────────────────────────

  async function toggleModule(moduleCode: string, included: boolean) {
    if (!modPlanId) return;
    await fetch('/api/admin/pricing/modules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: modPlanId, module_code: moduleCode, is_included: included }),
    });
    setPlanMods(prev => {
      const existing = prev.find(m => m.module_code === moduleCode);
      if (existing) return prev.map(m => m.module_code === moduleCode ? { ...m, is_included: included } : m);
      return [...prev, { plan_id: modPlanId, module_code: moduleCode, is_included: included }];
    });
  }

  // ── Page Content save ────────────────────────────────────────────────────────

  async function saveCms() {
    setSaving(true);
    try {
      const keys = ['badge', 'hero_title', 'hero_subtitle', 'show_yearly', 'footer_note', 'comparison_title', 'faq_title'];
      await Promise.all([
        ...keys.map(k => fetch('/api/admin/content', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'pricing_page', key: k, value: cms[k] ?? '' }) })),
        fetch('/api/admin/content', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'pricing_page', key: 'faq', value: JSON.stringify(faqs) }) }),
      ]);
      showToast('Saved', 'success');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Load comparison matrix ───────────────────────────────────────────────────

  async function loadMatrix() {
    const publicPlans = plans.filter(p => p.is_public && !p.is_custom_client);
    const all = await Promise.all(publicPlans.map(p => fetch(`/api/admin/pricing/features?plan_id=${p.id}`).then(r => r.json())));
    setMatrixFeatures(all.flatMap((j, i) => (j.features ?? []).map((f: Feature) => ({ ...f, plan_id: publicPlans[i].id }))));
    setShowMatrix(true);
  }

  if (authLoading || loading) return null;

  const publicPlans = plans.filter(p => p.is_public && !p.is_custom_client);
  const clientPlans = plans.filter(p => p.is_custom_client);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/pricing" />

      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>Pricing Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>Manage plans, features, module access, and public pricing page content.</p>

        {/* Tab Bar */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #E8F0FB', marginBottom: 32 }}>
          {(['plans', 'features', 'modules', 'content'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setEditingPlan(null); }}
              style={{ padding: '10px 22px', fontSize: 13, fontWeight: tab === t ? 700 : 500, color: tab === t ? '#1B4F8A' : '#6B7280', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #1B4F8A' : '2px solid transparent', marginBottom: -2, cursor: 'pointer', textTransform: 'capitalize' }}>
              {t === 'modules' ? 'Module Access' : t === 'content' ? 'Page Content' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ── TAB: PLANS ────────────────────────────────────────────────────────── */}
        {tab === 'plans' && editingPlan === null && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
              <button onClick={() => setEditingPlan({ ...BLANK_FORM, client_user_ids: [] })}
                style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                + Create New Plan
              </button>
              <button onClick={() => setEditingPlan({ ...BLANK_FORM, is_custom_client: true, is_public: false, client_user_ids: [] })}
                style={{ background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                + Create Client Plan
              </button>
            </div>

            {/* Public Plans */}
            <div style={{ marginBottom: 40 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Public Plans</h2>
              {publicPlans.length === 0 ? (
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>No public plans yet.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {publicPlans.map(p => <PlanCard key={p.id} plan={p} onEdit={() => setEditingPlan(planFromRow(p))} onDelete={() => setDelConfirm(p.id)} onDuplicate={() => duplicatePlan(p)} confirmingDelete={delConfirm === p.id} onConfirmDelete={() => deletePlan(p.id)} onCancelDelete={() => setDelConfirm(null)} />)}
                </div>
              )}
            </div>

            {/* Client Plans */}
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Client Plans</h2>
              {clientPlans.length === 0 ? (
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>No client-specific plans yet.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {clientPlans.map(p => <PlanCard key={p.id} plan={p} onEdit={() => setEditingPlan(planFromRow(p))} onDelete={() => setDelConfirm(p.id)} onDuplicate={() => duplicatePlan(p)} confirmingDelete={delConfirm === p.id} onConfirmDelete={() => deletePlan(p.id)} onCancelDelete={() => setDelConfirm(null)} />)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PLAN CREATE/EDIT FORM ─────────────────────────────────────────────── */}
        {tab === 'plans' && editingPlan !== null && (
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '32px 36px', maxWidth: 720 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B', marginBottom: 24 }}>
              {editingPlan.id ? 'Edit Plan' : editingPlan.is_custom_client ? 'Create Client Plan' : 'Create New Plan'}
            </h2>

            <SectionTitle>Basic Info</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fld}><label style={lbl}>Plan Name *</label><input style={inp} value={editingPlan.name} onChange={e => setFld('name', e.target.value)} /></div>
              <div style={fld}><label style={lbl}>Plan Code *</label><input style={inp} value={editingPlan.code} onChange={e => setFld('code', e.target.value.toLowerCase().replace(/\s+/g, '_'))} placeholder="e.g. professional" /></div>
            </div>
            <div style={fld}><label style={lbl}>Tagline</label><input style={inp} value={editingPlan.tagline} onChange={e => setFld('tagline', e.target.value)} placeholder="Short line shown under plan name" /></div>
            <div style={fld}><label style={lbl}>Description</label><textarea style={{ ...inp, resize: 'vertical' }} rows={3} value={editingPlan.description} onChange={e => setFld('description', e.target.value)} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div style={fld}><label style={lbl}>Display Order</label><input style={inp} type="number" value={editingPlan.display_order} onChange={e => setFld('display_order', e.target.value)} /></div>
              <div style={fld}><label style={lbl}>Max Users</label><input style={inp} type="number" value={editingPlan.max_users} onChange={e => setFld('max_users', e.target.value)} placeholder="blank = unlimited" /></div>
            </div>

            <SectionTitle>Pricing</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fld}><label style={lbl}>Monthly Price</label><input style={inp} type="number" value={editingPlan.price_monthly} onChange={e => setFld('price_monthly', e.target.value)} placeholder="Leave blank for Contact Us" /></div>
              <div style={fld}><label style={lbl}>Yearly Price</label><input style={inp} type="number" value={editingPlan.price_yearly} onChange={e => setFld('price_yearly', e.target.value)} placeholder="Optional" /></div>
            </div>
            <div style={fld}><label style={lbl}>Price Display Override</label><input style={inp} value={editingPlan.price_display} onChange={e => setFld('price_display', e.target.value)} placeholder='e.g. "Contact Us" "$29/mo" "Coming Soon"' /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fld}>
                <label style={lbl}>Currency</label>
                <select style={inp} value={editingPlan.currency} onChange={e => setFld('currency', e.target.value)}>
                  {['USD', 'GBP', 'EUR', 'PKR'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={fld}>
                <label style={lbl}>Billing Period</label>
                <select style={inp} value={editingPlan.billing_period} onChange={e => setFld('billing_period', e.target.value)}>
                  {['month', 'year', 'one-time', 'custom'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <SectionTitle>Display</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fld}><label style={lbl}>Badge Text</label><input style={inp} value={editingPlan.badge_text} onChange={e => setFld('badge_text', e.target.value)} placeholder='e.g. "Most Popular"' /></div>
              <div style={fld}>
                <label style={lbl}>Badge Color</label>
                <select style={inp} value={editingPlan.badge_color} onChange={e => setFld('badge_color', e.target.value)}>
                  {['green', 'gold', 'navy', 'grey', 'red'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fld}><label style={lbl}>CTA Button Text</label><input style={inp} value={editingPlan.cta_text} onChange={e => setFld('cta_text', e.target.value)} /></div>
              <div style={fld}><label style={lbl}>CTA Button URL</label><input style={inp} value={editingPlan.cta_url} onChange={e => setFld('cta_url', e.target.value)} /></div>
            </div>
            <div style={fld}><label style={lbl}>Highlight / Border Color</label><input style={inp} value={editingPlan.highlight_color} onChange={e => setFld('highlight_color', e.target.value)} placeholder="#1B4F8A" /></div>
            <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
              {([['is_featured', 'Featured (prominent on /pricing)'], ['is_active', 'Active'], ['is_public', 'Public (show on /pricing page)']] as [keyof FormState, string][]).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
                  <input type="checkbox" checked={editingPlan[key] as boolean} onChange={e => setFld(key, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
            <div style={fld}><label style={lbl}>Internal Notes</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={editingPlan.notes} onChange={e => setFld('notes', e.target.value)} placeholder="Never shown publicly" /></div>

            {/* Client Plan Extra Fields */}
            {editingPlan.is_custom_client && (
              <>
                <SectionTitle>Client Info</SectionTitle>
                <div style={fld}><label style={lbl}>Client / Company Name *</label><input style={inp} value={editingPlan.client_name} onChange={e => setFld('client_name', e.target.value)} /></div>

                <div style={fld}>
                  <label style={lbl}>Assign to Users</label>
                  <input style={inp} value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search by email or name…" />
                  {userResults.length > 0 && (
                    <div style={{ border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {userResults.map(u => (
                        <button key={u.id} onClick={() => { setFld('client_user_ids', [...(editingPlan.client_user_ids ?? []), u]); setUserSearch(''); setUserResults([]); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #F3F4F6' }}>
                          {u.email} {u.name ? `(${u.name})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  {(editingPlan.client_user_ids ?? []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {(editingPlan.client_user_ids ?? []).map(u => (
                        <span key={u.id} style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#4338CA', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {u.email}
                          <button onClick={() => setFld('client_user_ids', (editingPlan.client_user_ids ?? []).filter(x => x.id !== u.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366F1', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={fld}><label style={lbl}>Contract Notes</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={editingPlan.contract_notes} onChange={e => setFld('contract_notes', e.target.value)} placeholder="Contract dates, special terms…" /></div>
                <div style={fld}><label style={lbl}>Plan Expiry Date</label><input style={inp} type="date" value={editingPlan.expiry_date} onChange={e => setFld('expiry_date', e.target.value)} /></div>
              </>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {saveBtn(savePlan, editingPlan.id ? 'Save Plan' : 'Create Plan')}
              <button onClick={() => setEditingPlan(null)} style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: 8, padding: '10px 20px', fontSize: 13, cursor: 'pointer', color: '#374151' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── TAB: FEATURES ─────────────────────────────────────────────────────── */}
        {tab === 'features' && (
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            {/* Plan selector */}
            <div style={{ width: 200, flexShrink: 0, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Select Plan</p>
              {plans.map(p => (
                <button key={p.id} onClick={() => setFeatPlanId(p.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, marginBottom: 2, background: featPlanId === p.id ? '#EEF2FF' : 'none', border: featPlanId === p.id ? '1px solid #C7D2FE' : '1px solid transparent', cursor: 'pointer', fontSize: 13, color: featPlanId === p.id ? '#4338CA' : '#374151', fontWeight: featPlanId === p.id ? 600 : 400 }}>
                  {p.is_custom_client && <span style={{ fontSize: 9, background: '#7C3AED', color: '#fff', borderRadius: 10, padding: '1px 5px', marginRight: 5 }}>CLIENT</span>}
                  {p.name}
                </button>
              ))}
            </div>

            {/* Feature editor */}
            <div style={{ flex: 1, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px' }}>
              {!featPlanId ? (
                <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: '40px 0' }}>Select a plan to manage its features.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', margin: 0 }}>
                      {plans.find(p => p.id === featPlanId)?.name} — Features
                    </h2>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select value={copyFromPlan} onChange={e => setCopyFromPlan(e.target.value)}
                        style={{ padding: '6px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, background: '#fff', cursor: 'pointer' }}>
                        <option value="">Copy features from…</option>
                        {plans.filter(p => p.id !== featPlanId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {copyFromPlan && (
                        <button onClick={copyFeaturesFrom} style={{ padding: '6px 12px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Copy</button>
                      )}
                    </div>
                  </div>

                  {features.length === 0 ? (
                    <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 16 }}>No features yet. Add one below.</p>
                  ) : (
                    <div style={{ marginBottom: 12 }}>
                      {/* Header row */}
                      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 80px 40px', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase' }}>Category</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase' }}>Feature</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', textAlign: 'center' }}>Included</span>
                        <span />
                      </div>
                      {features.map((f, i) => (
                        <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 80px 40px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                          <input value={f.category} onChange={e => setFeatures(prev => prev.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}
                            style={{ padding: '6px 8px', fontSize: 12, border: '1px solid #D1D5DB', borderRadius: 5, background: '#FFFBEB' }} />
                          <input value={f.feature_text} onChange={e => setFeatures(prev => prev.map((x, j) => j === i ? { ...x, feature_text: e.target.value } : x))}
                            style={{ padding: '6px 8px', fontSize: 12, border: '1px solid #D1D5DB', borderRadius: 5, background: '#FFFBEB' }} />
                          <div style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={f.is_included} onChange={e => setFeatures(prev => prev.map((x, j) => j === i ? { ...x, is_included: e.target.checked } : x))} />
                          </div>
                          <button onClick={() => setFeatures(prev => prev.filter((_, j) => j !== i))}
                            style={{ background: 'none', border: '1px solid #FCA5A5', borderRadius: 5, color: '#EF4444', cursor: 'pointer', padding: '4px 8px', fontSize: 11 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={addFeature} style={{ background: 'none', border: '1px dashed #9CA3AF', borderRadius: 7, color: '#6B7280', cursor: 'pointer', padding: '8px 16px', fontSize: 12 }}>+ Add Feature</button>
                    {saveBtn(saveFeatures, 'Save Features')}
                    <button onClick={showMatrix ? () => setShowMatrix(false) : loadMatrix}
                      style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: 7, color: '#374151', cursor: 'pointer', padding: '8px 16px', fontSize: 12 }}>
                      {showMatrix ? 'Hide Matrix' : 'View Comparison Matrix'}
                    </button>
                  </div>

                  {/* Comparison matrix */}
                  {showMatrix && (() => {
                    const pubPlans = plans.filter(p => p.is_public && !p.is_custom_client);
                    const uniq = Array.from(new Set(matrixFeatures.map(f => f.feature_text)));
                    return (
                      <div style={{ marginTop: 32, overflowX: 'auto' }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B', marginBottom: 12 }}>Comparison Matrix</h3>
                        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#1B4F8A' }}>
                              <th style={{ padding: '8px 12px', color: '#fff', textAlign: 'left', fontWeight: 700 }}>Feature</th>
                              {pubPlans.map(p => <th key={p.id} style={{ padding: '8px 12px', color: '#fff', textAlign: 'center', fontWeight: 700 }}>{p.name}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {uniq.map((feat, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 ? '#F9FAFB' : '#fff' }}>
                                <td style={{ padding: '7px 12px', color: '#374151' }}>{feat}</td>
                                {pubPlans.map(p => {
                                  const inc = matrixFeatures.find(f => f.plan_id === p.id && f.feature_text === feat)?.is_included ?? false;
                                  return <td key={p.id} style={{ padding: '7px 12px', textAlign: 'center', color: inc ? '#2EAA4A' : '#D1D5DB' }}>{inc ? '✓' : '✗'}</td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: MODULE ACCESS ─────────────────────────────────────────────────── */}
        {tab === 'modules' && (
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            {/* Plan selector */}
            <div style={{ width: 200, flexShrink: 0, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Select Plan</p>
              {plans.map(p => (
                <button key={p.id} onClick={() => setModPlanId(p.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, marginBottom: 2, background: modPlanId === p.id ? '#EEF2FF' : 'none', border: modPlanId === p.id ? '1px solid #C7D2FE' : '1px solid transparent', cursor: 'pointer', fontSize: 13, color: modPlanId === p.id ? '#4338CA' : '#374151', fontWeight: modPlanId === p.id ? 600 : 400 }}>
                  {p.name}
                </button>
              ))}
            </div>

            {/* Module grid */}
            <div style={{ flex: 1, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px' }}>
              {!modPlanId ? (
                <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: '40px 0' }}>Select a plan to manage module access.</p>
              ) : (
                <>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', marginBottom: 20 }}>
                    {plans.find(p => p.id === modPlanId)?.name} — Module Access
                  </h2>
                  <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 20 }}>Toggle which modules are included in this plan. Changes save immediately.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {allMods.map(mod => {
                      const row = planMods.find(m => m.module_code === mod.slug);
                      const included = row?.is_included ?? false;
                      return (
                        <div key={mod.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid #E5E7EB', borderRadius: 8, background: included ? '#F0FFF4' : '#fff' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 20 }}>{mod.icon}</span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{mod.name}</div>
                              <div style={{ fontSize: 11, color: '#9CA3AF' }}>{mod.status}</div>
                            </div>
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={included} onChange={e => toggleModule(mod.slug, e.target.checked)} />
                            <span style={{ fontSize: 12, color: included ? '#1A7A30' : '#9CA3AF', fontWeight: 600 }}>{included ? 'Included' : 'Excluded'}</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: PAGE CONTENT ─────────────────────────────────────────────────── */}
        {tab === 'content' && (
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '28px 32px', maxWidth: 720 }}>
            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 7 }}>
              📍 Controls the hero text and FAQ on the public <strong>/pricing</strong> page.
            </p>

            <div style={fld}><label style={lbl}>Hero Badge</label><input style={inp} value={cms.badge ?? ''} onChange={e => setCms(p => ({ ...p, badge: e.target.value }))} placeholder="Pricing" /></div>
            <div style={fld}><label style={lbl}>Page Title</label><input style={inp} value={cms.hero_title ?? ''} onChange={e => setCms(p => ({ ...p, hero_title: e.target.value }))} placeholder="Simple, Transparent Pricing" /></div>
            <div style={fld}><label style={lbl}>Page Subtitle</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={cms.hero_subtitle ?? ''} onChange={e => setCms(p => ({ ...p, hero_subtitle: e.target.value }))} /></div>
            <div style={fld}><label style={lbl}>Comparison Table Title</label><input style={inp} value={cms.comparison_title ?? ''} onChange={e => setCms(p => ({ ...p, comparison_title: e.target.value }))} placeholder="Feature Comparison" /></div>
            <div style={fld}><label style={lbl}>FAQ Section Title</label><input style={inp} value={cms.faq_title ?? ''} onChange={e => setCms(p => ({ ...p, faq_title: e.target.value }))} placeholder="Frequently Asked Questions" /></div>
            <div style={fld}><label style={lbl}>Footer Note</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={cms.footer_note ?? ''} onChange={e => setCms(p => ({ ...p, footer_note: e.target.value }))} placeholder="All plans include free training access." /></div>

            {/* FAQ management */}
            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 20, marginTop: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>FAQ Items</p>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>Add frequently asked questions shown in the accordion on the pricing page.</p>
              {faqs.map((faq, i) => (
                <div key={i} style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
                  <div style={fld}><label style={lbl}>Question</label><input style={inp} value={faq.question} onChange={e => setFaqs(prev => prev.map((x, j) => j === i ? { ...x, question: e.target.value } : x))} /></div>
                  <div style={{ marginBottom: 8 }}><label style={lbl}>Answer</label><textarea style={{ ...inp, resize: 'vertical' }} rows={3} value={faq.answer} onChange={e => setFaqs(prev => prev.map((x, j) => j === i ? { ...x, answer: e.target.value } : x))} /></div>
                  <button onClick={() => setFaqs(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: '1px solid #FCA5A5', borderRadius: 6, color: '#EF4444', cursor: 'pointer', padding: '4px 12px', fontSize: 12 }}>Remove</button>
                </div>
              ))}
              {faqs.length < 10 ? (
                <button onClick={() => setFaqs(prev => [...prev, { question: '', answer: '' }])} style={{ background: 'none', border: '1px dashed #9CA3AF', borderRadius: 8, color: '#6B7280', cursor: 'pointer', padding: '10px 20px', fontSize: 13, width: '100%', marginBottom: 16 }}>+ Add FAQ</button>
              ) : (
                <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>Maximum 10 FAQs reached.</p>
              )}
            </div>

            {saveBtn(saveCms, 'Save Page Content')}
          </div>
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

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, fontWeight: 700, color: '#1B4F8A', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '20px 0 12px', paddingBottom: 6, borderBottom: '1px solid #E8F0FB' }}>{children}</p>;
}

interface PlanCardProps {
  plan: Plan;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function PlanCard({ plan, onEdit, onDelete, onDuplicate, confirmingDelete, onConfirmDelete, onCancelDelete }: PlanCardProps) {
  return (
    <div style={{ background: '#fff', border: plan.is_featured ? '2px solid #1B4F8A' : '1px solid #E5E7EB', borderRadius: 12, padding: '20px 20px 16px', position: 'relative' }}>
      {/* Badges */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {plan.is_featured && <span style={{ fontSize: 9, fontWeight: 700, background: '#2EAA4A', color: '#fff', borderRadius: 10, padding: '2px 8px', textTransform: 'uppercase' }}>Featured</span>}
        {plan.is_custom_client && <span style={{ fontSize: 9, fontWeight: 700, background: '#7C3AED', color: '#fff', borderRadius: 10, padding: '2px 8px', textTransform: 'uppercase' }}>Client</span>}
        <span style={{ fontSize: 9, fontWeight: 700, background: plan.is_active ? '#D1FAE5' : '#FEE2E2', color: plan.is_active ? '#065F46' : '#991B1B', borderRadius: 10, padding: '2px 8px', textTransform: 'uppercase' }}>{plan.is_active ? 'Active' : 'Inactive'}</span>
        {!plan.is_public && <span style={{ fontSize: 9, fontWeight: 700, background: '#F3F4F6', color: '#6B7280', borderRadius: 10, padding: '2px 8px', textTransform: 'uppercase' }}>Private</span>}
      </div>

      <div style={{ fontSize: 15, fontWeight: 800, color: '#1B3A6B', marginBottom: 2 }}>{plan.name}</div>
      {plan.is_custom_client && plan.client_name && <div style={{ fontSize: 11, color: '#7C3AED', marginBottom: 4 }}>{plan.client_name}</div>}
      {plan.tagline && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{plan.tagline}</div>}
      <div style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 14 }}>
        {plan.price_display ?? (plan.price_monthly != null ? `$${plan.price_monthly}/mo` : 'Contact Us')}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={onEdit} style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: '1px solid #BDD0F0', background: '#E8F0FB', color: '#1B4F8A', cursor: 'pointer' }}>Edit</button>
        <button onClick={onDuplicate} style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: '1px solid #D1D5DB', background: '#F9FAFB', color: '#374151', cursor: 'pointer' }}>Duplicate</button>
        {confirmingDelete ? (
          <>
            <button onClick={onConfirmDelete} style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: 'none', background: '#DC2626', color: '#fff', cursor: 'pointer' }}>Confirm Delete</button>
            <button onClick={onCancelDelete} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 5, border: '1px solid #D1D5DB', background: 'none', color: '#374151', cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <button onClick={onDelete} style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: '1px solid #FCA5A5', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer' }}>Delete</button>
        )}
      </div>
    </div>
  );
}
