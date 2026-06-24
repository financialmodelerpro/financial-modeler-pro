'use client';

/**
 * /admin/plans - Admin Plan Builder
 *
 * The single home for a plan end to end: feature coverage + limits + price +
 * marketing badge + the Trial length + coupons, all on the LIVE entitlement
 * tables (features_registry, plan_permissions, entitlement_plans). The old
 * /admin/pricing editor (platform_pricing) is removed; nothing customer-facing
 * reads platform_pricing anymore.
 *
 * No gate changes and no enforcement here: writing plan_permissions does not
 * alter canAccess or any module/export behavior in this unit.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';
import { PlanMatrix, type MatrixFeature, type MatrixPlan, type CellValue } from './PlanMatrix';
import { CouponManager } from './CouponManager';
import { formatLimit } from '@/src/shared/entitlements/moduleCatalog';
import { CREDIBILITY_SECTION, CREDIBILITY_KEY, DEFAULT_CREDIBILITY_LINE } from '@/src/shared/entitlements/pricingPageSettings';

const PLATFORMS = [{ slug: 'real-estate', label: 'Real Estate (REFM)' }];
const cellKey = (planKey: string, featureKey: string) => `${planKey}::${featureKey}`;

export default function AdminPlansPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [platform, setPlatform] = useState('real-estate');
  const [loading, setLoading] = useState(true);
  const [migrationApplied, setMigrationApplied] = useState(true);
  const [features, setFeatures] = useState<MatrixFeature[]>([]);
  const [plans, setPlans] = useState<MatrixPlan[]>([]);
  const [base, setBase] = useState<Map<string, CellValue>>(new Map());
  const [edits, setEdits] = useState<Map<string, CellValue>>(new Map());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [previewPlan, setPreviewPlan] = useState<string | null>(null);
  // Pricing-page credibility band (cms_content row, editable here). Row absent
  // -> show the default in the field; row present (even blank) -> show verbatim.
  const [credibilityLine, setCredibilityLine] = useState('');
  const [savingCred, setSavingCred] = useState(false);
  // Trial approval toggle (cms_content entitlements/trial_requires_approval) +
  // the pending trial-request queue (only used when the toggle is on).
  const [trialApproval, setTrialApproval] = useState(false);
  const [savingApproval, setSavingApproval] = useState(false);
  const [trialRequests, setTrialRequests] = useState<{ id: string; company: string | null; job_title: string | null; created_at: string; users: { email?: string; name?: string } | null }[]>([]);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/entitlements?platform=${encodeURIComponent(platform)}`).then((r) => r.json());
      setMigrationApplied(res.migrationApplied !== false);
      setFeatures(res.features ?? []);
      setPlans(res.plans ?? []);
      const m = new Map<string, CellValue>();
      for (const p of (res.permissions ?? []) as { plan_key: string; feature_key: string; included: boolean; limit_value: number | null }[]) {
        m.set(cellKey(p.plan_key, p.feature_key), { included: p.included, limit_value: p.limit_value });
      }
      setBase(m);
      setEdits(new Map());
      setPreviewPlan((prev) => prev ?? (res.plans?.[0]?.plan_key ?? null));
    } catch {
      showToast('Failed to load entitlements', 'error');
    } finally {
      setLoading(false);
    }
  }, [platform, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Load the current pricing-page credibility line (cms_content). If no row is
  // stored yet, prefill the default so the admin sees what the page renders.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/content?section=${encodeURIComponent(CREDIBILITY_SECTION)}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        const rows = (res.rows ?? []) as { key: string; value: string | null }[];
        const row = rows.find((r) => r.key === CREDIBILITY_KEY);
        setCredibilityLine(row ? (row.value ?? '') : DEFAULT_CREDIBILITY_LINE);
      })
      .catch(() => { if (!cancelled) setCredibilityLine(DEFAULT_CREDIBILITY_LINE); });
    return () => { cancelled = true; };
  }, []);

  const saveCredibility = useCallback(async () => {
    setSavingCred(true);
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: CREDIBILITY_SECTION, key: CREDIBILITY_KEY, value: credibilityLine }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast('Credibility line saved', 'success');
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSavingCred(false);
    }
  }, [credibilityLine, showToast]);

  // Trial approval toggle (cms_content entitlements/trial_requires_approval).
  const loadTrialRequests = useCallback(() => {
    fetch('/api/admin/trial-requests')
      .then((r) => r.json())
      .then((res) => setTrialRequests(res.requests ?? []))
      .catch(() => setTrialRequests([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/content?section=entitlements')
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        const rows = (res.rows ?? []) as { key: string; value: string | null }[];
        const row = rows.find((r) => r.key === 'trial_requires_approval');
        setTrialApproval(row?.value === 'true');
      })
      .catch(() => { if (!cancelled) setTrialApproval(false); });
    loadTrialRequests();
    return () => { cancelled = true; };
  }, [loadTrialRequests]);

  const saveTrialApproval = useCallback(async (next: boolean) => {
    setSavingApproval(true);
    setTrialApproval(next); // optimistic
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'entitlements', key: 'trial_requires_approval', value: next ? 'true' : 'false' }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); setTrialApproval(!next); return; }
      showToast(next ? 'Trial now requires approval' : 'Trial is now self-serve', 'success');
    } catch {
      showToast('Save failed', 'error'); setTrialApproval(!next);
    } finally {
      setSavingApproval(false);
    }
  }, [showToast]);

  const decideRequest = useCallback(async (id: string, action: 'approve' | 'decline') => {
    try {
      const res = await fetch('/api/admin/trial-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast(action === 'approve' ? 'Trial approved' : 'Request declined', 'success');
      loadTrialRequests();
    } catch {
      showToast('Action failed', 'error');
    }
  }, [showToast, loadTrialRequests]);

  const featureType = useMemo(() => {
    const m = new Map<string, MatrixFeature>();
    for (const f of features) m.set(f.feature_key, f);
    return m;
  }, [features]);

  const cell = useCallback((planKey: string, featureKey: string): CellValue => {
    const k = cellKey(planKey, featureKey);
    return edits.get(k) ?? base.get(k) ?? { included: false, limit_value: null };
  }, [edits, base]);

  const onToggle = useCallback((planKey: string, featureKey: string, included: boolean) => {
    setEdits((prev) => {
      const next = new Map(prev);
      const cur = next.get(cellKey(planKey, featureKey)) ?? base.get(cellKey(planKey, featureKey)) ?? { included: false, limit_value: null };
      next.set(cellKey(planKey, featureKey), { included, limit_value: cur.limit_value });
      return next;
    });
  }, [base]);

  const onLimit = useCallback((planKey: string, featureKey: string, value: number | null) => {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(cellKey(planKey, featureKey), { included: value !== null && !Number.isNaN(value), limit_value: value });
      return next;
    });
  }, []);

  // Only cells whose value actually differs from the loaded base are written.
  const changedRows = useMemo(() => {
    const out: { plan_key: string; feature_key: string; included: boolean; limit_value: number | null }[] = [];
    for (const [k, v] of edits) {
      const b = base.get(k) ?? { included: false, limit_value: null };
      if (b.included === v.included && b.limit_value === v.limit_value) continue;
      const [plan_key, feature_key] = k.split('::');
      out.push({ plan_key, feature_key, included: v.included, limit_value: v.limit_value });
    }
    return out;
  }, [edits, base]);

  const save = useCallback(async () => {
    if (changedRows.length === 0) { showToast('No changes to save', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/entitlements/permissions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: changedRows }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast(`Saved ${res.count} cell(s)`, 'success');
      await load();
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [changedRows, load, showToast]);

  // ── Plan CRUD ────────────────────────────────────────────────────────────
  const addPlan = useCallback(async () => {
    if (!newKey.trim() || !newLabel.trim()) { showToast('plan key and label required', 'error'); return; }
    const res = await fetch('/api/admin/entitlements/plans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform_slug: platform, plan_key: newKey, label: newLabel, display_order: plans.length + 1 }),
    }).then((r) => r.json());
    if (res.error) { showToast(res.error, 'error'); return; }
    setNewKey(''); setNewLabel('');
    showToast('Plan created', 'success');
    await load();
  }, [newKey, newLabel, platform, plans.length, load, showToast]);

  const patchPlan = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/entitlements/plans', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json());
    if (res.error) { showToast(res.error, 'error'); return; }
    await load();
  }, [load, showToast]);

  // Customer-facing visibility toggle for a non-module feature (mig 164).
  const toggleVisible = useCallback(async (featureKey: string, visible: boolean) => {
    setFeatures((prev) => prev.map((f) => f.feature_key === featureKey ? { ...f, visible } : f));
    const res = await fetch('/api/admin/entitlements/features', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: featureKey, visible }),
    }).then((r) => r.json());
    if (res.error) { showToast(res.error, 'error'); setFeatures((prev) => prev.map((f) => f.feature_key === featureKey ? { ...f, visible: !visible } : f)); return; }
    showToast(visible ? 'Feature shown to customers' : 'Feature hidden from customers', 'success');
  }, [showToast]);

  // Save a feature's short pricing description (mig 168). Optimistic local
  // update + persist; allowed for module + non-module rows.
  const saveDescription = useCallback(async (featureKey: string, description: string) => {
    setFeatures((prev) => prev.map((f) => f.feature_key === featureKey ? { ...f, description } : f));
    const res = await fetch('/api/admin/entitlements/features', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: featureKey, description }),
    }).then((r) => r.json());
    if (res.error) { showToast(res.error, 'error'); return; }
    showToast('Description saved', 'success');
  }, [showToast]);

  const reorder = useCallback(async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= plans.length) return;
    const a = plans[idx], b = plans[j];
    await Promise.all([
      fetch('/api/admin/entitlements/plans', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, display_order: b.display_order }) }),
      fetch('/api/admin/entitlements/plans', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, display_order: a.display_order }) }),
    ]);
    await load();
  }, [plans, load]);

  // ── Resolved preview for one plan ──────────────────────────────────────────
  const resolved = useMemo(() => {
    if (!previewPlan) return [] as { label: string; detail: string }[];
    const out: { label: string; detail: string }[] = [];
    for (const f of [...features].sort((x, y) => x.display_order - y.display_order)) {
      const v = cell(previewPlan, f.feature_key);
      if (f.feature_type === 'limit') {
        if (v.limit_value !== null) out.push({ label: f.label, detail: formatLimit(v.limit_value) });
      } else if (v.included) {
        out.push({ label: f.label, detail: '' });
      }
    }
    return out;
  }, [previewPlan, features, cell]);

  if (authLoading) return null;

  const planCols: MatrixPlan[] = plans;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/plans" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }} data-testid="admin-plans-page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', margin: 0 }}>Plan Builder</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}>
              {PLATFORMS.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
            </select>
            <button onClick={save} disabled={saving || changedRows.length === 0} data-testid="save-matrix"
              style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: changedRows.length ? 'pointer' : 'default', fontWeight: 700, fontSize: 13, color: '#fff', background: changedRows.length ? '#2EAA4A' : '#9CA3AF' }}>
              {saving ? 'Saving...' : `Save${changedRows.length ? ` (${changedRows.length})` : ''}`}
            </button>
          </div>
        </div>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 0, marginBottom: 20, maxWidth: 880 }}>
          Assign features to each plan by checkbox (gate features) or cap (limit features), and set each plan&apos;s price. This screen owns the live plan end to end: features, limits, and price (entitlement_plans + plan_permissions). The separate Marketing Pricing editor only feeds the public marketing page. Saving here does not change the live gate.
        </p>

        {/* Pricing page settings: the founder credibility band shown on both the
            public and in-app pricing pages. Stored as a cms_content row, so it is
            editable anytime without code. Blank = the band is hidden. */}
        <div data-testid="pricing-page-settings" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20, maxWidth: 880 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 4 }}>Pricing page credibility line</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            Shown in the gold band on the public and in-app pricing pages. Leave blank to hide the band entirely.
          </div>
          <textarea
            data-testid="pricing-credibility-input"
            value={credibilityLine}
            onChange={(e) => setCredibilityLine(e.target.value)}
            rows={2}
            placeholder={DEFAULT_CREDIBILITY_LINE}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button onClick={saveCredibility} disabled={savingCred} data-testid="save-credibility"
              style={{ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: savingCred ? 'default' : 'pointer', fontWeight: 700, fontSize: 13, color: '#fff', background: savingCred ? '#9CA3AF' : '#2EAA4A' }}>
              {savingCred ? 'Saving...' : 'Save credibility line'}
            </button>
            <button onClick={() => setCredibilityLine(DEFAULT_CREDIBILITY_LINE)} data-testid="reset-credibility"
              style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 12.5, color: '#475569' }}>
              Reset to default
            </button>
          </div>
        </div>

        {/* Trial access: the approval toggle + the pending request queue. Both
            grant via the SHARED setUserPlan; OFF (default) is self-serve. */}
        <div data-testid="trial-settings" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20, maxWidth: 880 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 4 }}>Free trial access</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            When OFF (default), clicking Start free trial grants the trial instantly. When ON, it creates a request you approve below.
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" data-testid="trial-approval-toggle" checked={trialApproval} disabled={savingApproval}
              onChange={(e) => saveTrialApproval(e.target.checked)} />
            Trial requires approval {trialApproval ? '(ON, admin approves)' : '(OFF, self-serve)'}
          </label>

          <div style={{ marginTop: 14, borderTop: '1px solid #eef2f7', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }} data-testid="trial-requests-heading">
              Pending trial requests ({trialRequests.length})
            </div>
            {trialRequests.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>No pending requests.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {trialRequests.map((r) => (
                  <div key={r.id} data-testid={`trial-request-${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', border: '1px solid #eef2f7', borderRadius: 7, padding: '8px 10px' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>{r.users?.email ?? r.id}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{[r.company, r.job_title].filter(Boolean).join(' - ') || 'no company/title on file'}</div>
                    </div>
                    <button onClick={() => decideRequest(r.id, 'approve')} data-testid={`trial-approve-${r.id}`}
                      style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: '#fff', background: '#2EAA4A' }}>Approve</button>
                    <button onClick={() => decideRequest(r.id, 'decline')} data-testid={`trial-decline-${r.id}`}
                      style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: '#475569' }}>Decline</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {!migrationApplied && (
          <div style={{ padding: 14, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13, marginBottom: 20, border: '1px solid #fde68a' }}>
            The entitlement tables are not present in this database yet. Apply migrations 158 and 159 via the Supabase dashboard, then reload. The builder UI is functional; it just has no data to read or write until then.
          </div>
        )}

        {loading ? (
          <div style={{ color: '#64748b', fontSize: 14 }}>Loading...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 24, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              {/* Plan management */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 10 }}>Plans</div>
                {plans.map((p, i) => {
                  const setLocal = (patch: Partial<MatrixPlan>) =>
                    setPlans((prev) => prev.map((x) => x.plan_key === p.plan_key ? { ...x, ...patch } : x));
                  const numOrNull = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
                  return (
                  <div key={p.id ?? p.plan_key} data-testid={`plan-row-${p.plan_key}`} style={{ border: '1px solid #eef2f7', borderRadius: 7, padding: '8px 10px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <button onClick={() => reorder(i, -1)} disabled={i === 0} title="Move up" style={arrowBtn}>▲</button>
                        <button onClick={() => reorder(i, 1)} disabled={i === plans.length - 1} title="Move down" style={arrowBtn}>▼</button>
                      </span>
                      <input value={p.label} onChange={(e) => setLocal({ label: e.target.value })}
                        onBlur={(e) => { if (e.target.value !== '' && p.id) patchPlan({ id: p.id, label: e.target.value }); }}
                        style={{ flex: 1, padding: '5px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 5 }} />
                      <code style={{ fontSize: 11, color: '#94a3b8', minWidth: 60 }}>{p.plan_key}</code>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
                        <input type="checkbox" checked={p.active} onChange={() => p.id && patchPlan({ id: p.id, active: !p.active })} /> active
                      </label>
                    </div>
                    {/* Pricing line (mig 162). Trial is typically unpriced; Firm can be Contact sales. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, paddingLeft: 26, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Price</span>
                      <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                        Monthly
                        <input type="number" data-testid={`plan-price-monthly-${p.plan_key}`} value={p.price_monthly ?? ''} disabled={p.contact_sales}
                          onChange={(e) => setLocal({ price_monthly: numOrNull(e.target.value) })}
                          onBlur={() => p.id && patchPlan({ id: p.id, price_monthly: p.price_monthly })}
                          style={{ width: 72, padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5, background: p.contact_sales ? '#f1f5f9' : '#fff' }} />
                      </label>
                      <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                        Annual
                        <input type="number" data-testid={`plan-price-annual-${p.plan_key}`} value={p.price_annual ?? ''} disabled={p.contact_sales}
                          onChange={(e) => setLocal({ price_annual: numOrNull(e.target.value) })}
                          onBlur={() => p.id && patchPlan({ id: p.id, price_annual: p.price_annual })}
                          style={{ width: 72, padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5, background: p.contact_sales ? '#f1f5f9' : '#fff' }} />
                      </label>
                      <input value={p.currency ?? 'SAR'} onChange={(e) => setLocal({ currency: e.target.value })}
                        onBlur={() => p.id && patchPlan({ id: p.id, currency: p.currency ?? 'SAR' })}
                        title="Currency" style={{ width: 52, padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5, textAlign: 'center' }} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
                        <input type="checkbox" data-testid={`plan-contact-sales-${p.plan_key}`} checked={!!p.contact_sales}
                          onChange={() => { const next = !p.contact_sales; setLocal({ contact_sales: next }); if (p.id) patchPlan({ id: p.id, contact_sales: next }); }} />
                        Contact sales
                      </label>
                    </div>
                    {/* Marketing highlight (mig 163): popular flag + optional badge text. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 26, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Badge</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
                        <input type="checkbox" data-testid={`plan-popular-${p.plan_key}`} checked={!!p.popular}
                          onChange={() => { const next = !p.popular; setLocal({ popular: next }); if (p.id) patchPlan({ id: p.id, popular: next }); }} />
                        Most popular (highlight)
                      </label>
                      <input value={p.badge_text ?? ''} placeholder="custom badge (optional)" data-testid={`plan-badge-${p.plan_key}`}
                        onChange={(e) => setLocal({ badge_text: e.target.value })}
                        onBlur={() => p.id && patchPlan({ id: p.id, badge_text: p.badge_text ?? '' })}
                        style={{ width: 170, padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5 }} />
                    </div>
                    {/* Payment provider price / product ids (mig 166). Empty until a
                        provider is approved; read server-side by the checkout handler
                        and mapped back from webhook events. Not secrets. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 26, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Provider IDs</span>
                      <input value={p.paddle_price_id_monthly ?? ''} placeholder="paddle price id (monthly)" data-testid={`plan-paddle-monthly-${p.plan_key}`}
                        onChange={(e) => setLocal({ paddle_price_id_monthly: e.target.value })}
                        onBlur={() => p.id && patchPlan({ id: p.id, paddle_price_id_monthly: p.paddle_price_id_monthly ?? '' })}
                        style={{ width: 168, padding: '4px 6px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 5, fontFamily: 'monospace' }} />
                      <input value={p.paddle_price_id_annual ?? ''} placeholder="paddle price id (annual)" data-testid={`plan-paddle-annual-${p.plan_key}`}
                        onChange={(e) => setLocal({ paddle_price_id_annual: e.target.value })}
                        onBlur={() => p.id && patchPlan({ id: p.id, paddle_price_id_annual: p.paddle_price_id_annual ?? '' })}
                        style={{ width: 168, padding: '4px 6px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 5, fontFamily: 'monospace' }} />
                      <input value={p.paypro_product_id ?? ''} placeholder="paypro product id" data-testid={`plan-paypro-${p.plan_key}`}
                        onChange={(e) => setLocal({ paypro_product_id: e.target.value })}
                        onBlur={() => p.id && patchPlan({ id: p.id, paypro_product_id: p.paypro_product_id ?? '' })}
                        style={{ width: 150, padding: '4px 6px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 5, fontFamily: 'monospace' }} />
                    </div>
                    {/* Trial length (single source, mig 165). Only meaningful on the
                        Trial plan; every consumer (trial approval, marketing + in-app
                        pricing) reads this one value. */}
                    {p.plan_key === 'trial' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 26, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trial</span>
                        <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                          Length (days)
                          <input type="number" min={1} data-testid="plan-trial-days" value={p.trial_days ?? ''} placeholder="14"
                            onChange={(e) => setLocal({ trial_days: e.target.value === '' ? null : Number(e.target.value) })}
                            onBlur={() => p.id && patchPlan({ id: p.id, trial_days: p.trial_days ?? null })}
                            style={{ width: 64, padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5 }} />
                        </label>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>Drives trial approval + the &ldquo;free for N days&rdquo; copy everywhere.</span>
                      </div>
                    )}
                  </div>
                  );
                })}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                  <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="plan_key (e.g. team)" style={{ width: 150, padding: '5px 8px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5 }} />
                  <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (e.g. Team)" style={{ width: 150, padding: '5px 8px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5 }} />
                  <button onClick={addPlan} data-testid="add-plan" style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #0D2E5A', background: 'transparent', color: '#0D2E5A', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>+ Add plan</button>
                </div>
              </div>

              {/* Matrix */}
              {plans.length > 0 && features.length > 0 ? (
                <PlanMatrix features={features} plans={planCols} cell={cell} onToggle={onToggle} onLimit={onLimit} onToggleVisible={toggleVisible} onSaveDescription={saveDescription} />
              ) : (
                <div style={{ color: '#64748b', fontSize: 14 }}>No plans or features to show.</div>
              )}
            </div>

            {/* Resolved preview */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, position: 'sticky', top: 20 }} data-testid="resolved-preview">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>Resolved preview</div>
              <select value={previewPlan ?? ''} onChange={(e) => setPreviewPlan(e.target.value || null)} style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 5, marginBottom: 10 }}>
                {plans.map((p) => <option key={p.plan_key} value={p.plan_key}>{p.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Included features ({resolved.length}) for this plan, reflecting unsaved edits.</div>
              {resolved.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Nothing included yet.</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {resolved.map((r) => (
                    <li key={r.label} style={{ fontSize: 12, color: '#334155', marginBottom: 3 }}>
                      {r.label}{r.detail ? <span style={{ color: '#0D2E5A', fontWeight: 700 }}> {' '}: {r.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Coupons (relocated from the removed /admin/pricing editor). */}
        <CouponManager />

        {toast && (
          <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 18px', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, background: toast.type === 'success' ? '#2EAA4A' : '#DC2626', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 2000 }}>
            {toast.msg}
          </div>
        )}
      </main>
    </div>
  );
}

const arrowBtn: React.CSSProperties = { width: 18, height: 14, fontSize: 8, lineHeight: 1, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', color: '#475569', padding: 0 };
