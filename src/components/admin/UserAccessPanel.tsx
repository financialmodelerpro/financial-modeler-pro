'use client';

/**
 * UserAccessPanel
 *
 * Per-user entitlement panel: effective entitlements (plan coverage + per-user
 * overrides, override wins, expired ignored), grant/revoke any feature, assign
 * a plan, and the trial shortcut. Driven by a `userId` prop (no internal user
 * search) so it can be embedded in the consolidated Users detail view
 * (/admin/users/[id]).
 *
 * Extracted verbatim from the former /admin/access page so the consolidation
 * keeps identical behavior + data-testids. Writes user_permissions + the user
 * plan/trial columns via the shared endpoints; it does NOT touch the gate.
 *
 * No em dashes in this file.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatLimit } from '@/src/shared/entitlements/moduleCatalog';
import {
  resolveEffectiveFeatures,
  type ResolveFeature,
  type PlanCell,
  type UserOverride,
} from '@/src/shared/entitlements/resolveOverrides';

const PLATFORMS = [{ slug: 'real-estate', label: 'Real Estate (REFM)' }];

interface FullUser { id: string; email: string; name: string | null; subscription_plan: string; subscription_status: string; trial_ends_at: string | null }
interface FeatureRow extends ResolveFeature { build_status?: string }

interface EditState { mode: '' | 'grant' | 'revoke'; valueStr: string; unlimited: boolean; expires: string; reason: string }
const EMPTY_EDIT: EditState = { mode: '', valueStr: '', unlimited: false, expires: '', reason: '' };

const isoToDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

const MODULE_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  live:        { label: 'Live',        bg: '#dcfce7', fg: '#166534' },
  coming_soon: { label: 'Coming soon', bg: '#fef3c7', fg: '#92400e' },
  pro:         { label: 'Pro',         bg: '#ede9fe', fg: '#6d28d9' },
  enterprise:  { label: 'Enterprise',  bg: '#e0e7ff', fg: '#3730a3' },
};

export function UserAccessPanel({ userId }: { userId: string }) {
  const [platform, setPlatform] = useState('real-estate');

  const [loading, setLoading] = useState(true);
  const [migrationApplied, setMigrationApplied] = useState(true);
  const [user, setUser] = useState<FullUser | null>(null);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [planCells, setPlanCells] = useState<Map<string, PlanCell>>(new Map());
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [serverKeys, setServerKeys] = useState<Set<string>>(new Set());
  const [trialDays, setTrialDays] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadUser = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/entitlements/user?userId=${userId}&platform=${encodeURIComponent(platform)}`).then((r) => r.json());
      setMigrationApplied(res.migrationApplied !== false);
      setUser(res.user ?? null);
      setFeatures(res.features ?? []);
      setTrialDays(res.trialDays ?? 0);
      const pc = new Map<string, PlanCell>();
      for (const p of (res.permissions ?? []) as { feature_key: string; included: boolean; limit_value: number | null }[]) {
        pc.set(p.feature_key, { included: p.included, limit_value: p.limit_value });
      }
      setPlanCells(pc);
      const ed: Record<string, EditState> = {};
      const keys = new Set<string>();
      for (const o of (res.overrides ?? []) as { feature_key: string; mode: 'grant' | 'revoke'; override_value: number | null; reason: string | null; expires_at: string | null }[]) {
        keys.add(o.feature_key);
        ed[o.feature_key] = {
          mode: o.mode,
          valueStr: o.override_value !== null && o.override_value !== -1 ? String(o.override_value) : '',
          unlimited: o.override_value === -1,
          expires: isoToDateInput(o.expires_at),
          reason: o.reason ?? '',
        };
      }
      setEdits(ed);
      setServerKeys(keys);
    } catch {
      showToast('Failed to load user entitlements', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, platform, showToast]);

  useEffect(() => { void loadUser(); }, [loadUser]);

  const editFor = useCallback((key: string): EditState => edits[key] ?? EMPTY_EDIT, [edits]);
  const setEditFor = useCallback((key: string, patch: Partial<EditState>) => {
    setEdits((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_EDIT), ...patch } }));
  }, []);

  const liveOverrides = useMemo<UserOverride[]>(() => {
    const out: UserOverride[] = [];
    for (const [feature_key, e] of Object.entries(edits)) {
      if (e.mode !== 'grant' && e.mode !== 'revoke') continue;
      const override_value = e.unlimited ? -1 : (e.valueStr.trim() === '' ? null : parseInt(e.valueStr, 10));
      out.push({
        feature_key,
        mode: e.mode,
        override_value: Number.isNaN(override_value as number) ? null : override_value,
        reason: e.reason.trim() || null,
        expires_at: e.expires ? new Date(e.expires).toISOString() : null,
      });
    }
    return out;
  }, [edits]);

  const resolved = useMemo(
    () => resolveEffectiveFeatures(features, planCells, liveOverrides, Date.now()),
    [features, planCells, liveOverrides],
  );

  const includedCount = resolved.filter((r) => r.included).length;
  const activeOverrideCount = resolved.filter((r) => r.override && !r.override.expired).length;

  const saveOverride = useCallback(async (featureKey: string) => {
    if (!user) return;
    const e = editFor(featureKey);
    if (e.mode !== 'grant' && e.mode !== 'revoke') { showToast('Choose grant or revoke first', 'error'); return; }
    setBusyKey(featureKey);
    try {
      const override_value = e.unlimited ? -1 : (e.valueStr.trim() === '' ? null : parseInt(e.valueStr, 10));
      const res = await fetch('/api/admin/entitlements/user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id, feature_key: featureKey, mode: e.mode,
          override_value: Number.isNaN(override_value as number) ? null : override_value,
          reason: e.reason.trim() || null,
          expires_at: e.expires || null,
        }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast('Override saved', 'success');
      await loadUser();
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setBusyKey(null);
    }
  }, [user, editFor, loadUser, showToast]);

  const removeOverride = useCallback(async (featureKey: string) => {
    if (!user) return;
    setBusyKey(featureKey);
    try {
      if (serverKeys.has(featureKey)) {
        const res = await fetch(`/api/admin/entitlements/user?userId=${user.id}&featureKey=${featureKey}`, { method: 'DELETE' }).then((r) => r.json());
        if (res.error) { showToast(res.error, 'error'); return; }
      }
      setEdits((prev) => { const n = { ...prev }; delete n[featureKey]; return n; });
      showToast('Override removed', 'success');
      if (serverKeys.has(featureKey)) await loadUser();
    } catch {
      showToast('Remove failed', 'error');
    } finally {
      setBusyKey(null);
    }
  }, [user, serverKeys, loadUser, showToast]);

  const approveTrial = useCallback(async () => {
    if (!user) return;
    setBusyKey('__trial__');
    try {
      const res = await fetch('/api/admin/entitlements/user/trial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, platform }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast('Trial approved', 'success');
      await loadUser();
    } catch {
      showToast('Trial approval failed', 'error');
    } finally {
      setBusyKey(null);
    }
  }, [user, platform, loadUser, showToast]);

  const [entPlans, setEntPlans] = useState<{ plan_key: string; label: string }[]>([]);
  useEffect(() => {
    fetch(`/api/admin/entitlements?platform=${encodeURIComponent(platform)}`)
      .then((r) => r.json())
      .then((j) => setEntPlans((j.plans ?? []).filter((p: { active: boolean }) => p.active).map((p: { plan_key: string; label: string }) => ({ plan_key: p.plan_key, label: p.label }))))
      .catch(() => setEntPlans([]));
  }, [platform]);

  const assignPlan = useCallback(async (planKey: string) => {
    if (!user || !planKey) return;
    setBusyKey('__plan__');
    try {
      const res = await fetch('/api/admin/entitlements/user/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, plan_key: planKey, platform }),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast(`Plan set to ${planKey}`, 'success');
      await loadUser();
    } catch {
      showToast('Plan assignment failed', 'error');
    } finally {
      setBusyKey(null);
    }
  }, [user, platform, loadUser, showToast]);

  return (
    <div data-testid="user-access-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0D2E5A', margin: 0 }}>Access &amp; entitlements</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}>
            {PLATFORMS.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
          </select>
        </div>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0, marginBottom: 20, maxWidth: 920 }}>
        Effective entitlements (plan coverage plus per-user overrides, override wins, expired overrides ignored). Grant or revoke any single feature, assign a plan, or approve a trial. Writes user_permissions and the user plan/trial columns only; it does not change the live gate.
      </p>

      {!migrationApplied && (
        <div style={{ padding: 14, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13, marginBottom: 20, border: '1px solid #fde68a' }}>
          The entitlement tables are not present in this database yet. Apply the entitlement migrations via the Supabase dashboard, then reload.
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading...</div>
      ) : !user ? (
        <div style={{ color: '#94a3b8', fontSize: 14 }}>User not found.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 24, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }} data-testid="resolved-table">
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', fontSize: 13, fontWeight: 700, color: '#0D2E5A', display: 'flex', justifyContent: 'space-between' }}>
                <span>Effective entitlements</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{includedCount} included · {activeOverrideCount} active override(s)</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Feature', 'Effective', 'Override'].map((h) => (
                      <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#475569', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows: React.JSX.Element[] = [];
                    let lastCat = '';
                    for (const r of resolved) {
                      if (r.category !== lastCat) {
                        lastCat = r.category;
                        rows.push(
                          <tr key={`cat-${r.category}`}>
                            <td colSpan={3} style={{ padding: '5px 12px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', background: '#f1f5f9', borderBottom: '1px solid #e5e7eb' }}>{r.category}</td>
                          </tr>,
                        );
                      }
                      const e = editFor(r.feature_key);
                      const mod = r.moduleStatus ? MODULE_TAG[r.moduleStatus] : null;
                      rows.push(
                        <tr key={r.feature_key} data-testid={`resolved-row-${r.feature_key}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px', fontSize: 12, verticalAlign: 'top' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600, color: '#0f172a' }}>{r.label}</span>
                              {mod && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: mod.bg, color: mod.fg }}>{mod.label}</span>}
                            </div>
                            <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.feature_key} ({r.feature_type})</div>
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 12, verticalAlign: 'top', whiteSpace: 'nowrap' }} data-testid={`effective-${r.feature_key}`}>
                            {r.feature_type === 'limit' ? (
                              <span style={{ fontWeight: 700, color: r.included ? '#166534' : '#94a3b8' }}>{r.included ? formatLimit(r.value) : 'none'}</span>
                            ) : (
                              <span style={{ fontWeight: 700, color: r.included ? '#166534' : '#b91c1c' }}>{r.included ? 'Yes' : 'No'}</span>
                            )}
                            <span style={{ display: 'block', fontSize: 9, color: r.source === 'override' ? '#6d28d9' : '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
                              via {r.source}{r.override?.expired ? ' (override expired)' : ''}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                              <select
                                data-testid={`override-mode-${r.feature_key}`}
                                value={e.mode}
                                onChange={(ev) => setEditFor(r.feature_key, { mode: ev.target.value as EditState['mode'] })}
                                style={{ padding: '3px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5 }}
                              >
                                <option value="">No override</option>
                                <option value="grant">Grant</option>
                                <option value="revoke">Revoke</option>
                              </select>
                              {r.feature_type === 'limit' && e.mode === 'grant' && (
                                <>
                                  <input
                                    type="number"
                                    data-testid={`override-value-${r.feature_key}`}
                                    value={e.unlimited ? '' : e.valueStr}
                                    disabled={e.unlimited}
                                    placeholder={e.unlimited ? 'Unlimited' : 'value'}
                                    onChange={(ev) => setEditFor(r.feature_key, { valueStr: ev.target.value })}
                                    style={{ width: 64, padding: '3px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5, background: e.unlimited ? '#f1f5f9' : '#fff' }}
                                  />
                                  <label style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <input type="checkbox" checked={e.unlimited} onChange={(ev) => setEditFor(r.feature_key, { unlimited: ev.target.checked })} /> Unltd
                                  </label>
                                </>
                              )}
                              {e.mode !== '' && (
                                <>
                                  <input
                                    type="date"
                                    title="Optional expiry"
                                    data-testid={`override-expires-${r.feature_key}`}
                                    value={e.expires}
                                    onChange={(ev) => setEditFor(r.feature_key, { expires: ev.target.value })}
                                    style={{ padding: '3px 6px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 5 }}
                                  />
                                  <input
                                    type="text"
                                    placeholder="reason"
                                    value={e.reason}
                                    onChange={(ev) => setEditFor(r.feature_key, { reason: ev.target.value })}
                                    style={{ width: 110, padding: '3px 6px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 5 }}
                                  />
                                  <button
                                    data-testid={`override-save-${r.feature_key}`}
                                    onClick={() => saveOverride(r.feature_key)}
                                    disabled={busyKey === r.feature_key}
                                    style={{ padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#fff', background: '#2EAA4A', border: 'none', borderRadius: 5, cursor: 'pointer' }}
                                  >Save</button>
                                </>
                              )}
                              {(e.mode !== '' || serverKeys.has(r.feature_key)) && (
                                <button
                                  data-testid={`override-remove-${r.feature_key}`}
                                  onClick={() => removeOverride(r.feature_key)}
                                  disabled={busyKey === r.feature_key}
                                  style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fff', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer' }}
                                >Remove</button>
                              )}
                            </div>
                          </td>
                        </tr>,
                      );
                    }
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }} data-testid="user-card">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 6 }}>{user.email}</div>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 2 }}>{user.name ?? 'No name'}</div>
              <div style={{ fontSize: 12, color: '#475569' }}>Plan: <b style={{ color: '#0f172a' }}>{user.subscription_plan}</b></div>
              <div style={{ fontSize: 12, color: '#475569' }}>Status: <b style={{ color: '#0f172a' }}>{user.subscription_status}</b></div>
              <div style={{ fontSize: 12, color: '#475569' }}>Trial ends: <b style={{ color: '#0f172a' }} data-testid="trial-ends">{user.trial_ends_at ? new Date(user.trial_ends_at).toLocaleDateString() : 'n/a'}</b></div>
              {planCells.size === 0 && (
                <div style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', borderRadius: 5, padding: '5px 7px', marginTop: 8 }}>
                  No entitlement plan_permissions for plan key &quot;{user.subscription_plan}&quot;. Baseline is empty; overrides still apply.
                </div>
              )}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }} data-testid="plan-assign-card">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 6 }}>Assign plan</div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Set this user&apos;s plan. Paid plans clear the trial expiry and set status active; Trial sets a fresh expiry from config.</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  data-testid="plan-assign-select"
                  value={user.subscription_plan}
                  onChange={(e) => assignPlan(e.target.value)}
                  disabled={busyKey === '__plan__'}
                  style={{ flex: 1, padding: '7px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 }}
                >
                  {!entPlans.some((p) => p.plan_key === user.subscription_plan) && (
                    <option value={user.subscription_plan} disabled>{user.subscription_plan || 'unassigned'}</option>
                  )}
                  {entPlans.map((p) => <option key={p.plan_key} value={p.plan_key}>{p.label}</option>)}
                </select>
                {busyKey === '__plan__' && <span style={{ fontSize: 11, color: '#64748b' }}>Saving...</span>}
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }} data-testid="trial-card">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 6 }}>Trial approval</div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Shortcut: place on the Trial plan with a {trialDays}-day expiry (from config).</div>
              <button
                data-testid="approve-trial"
                onClick={approveTrial}
                disabled={busyKey === '__trial__'}
                style={{ width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 700, color: '#fff', background: '#0D2E5A', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >{busyKey === '__trial__' ? 'Approving...' : `Approve trial (${trialDays}d)`}</button>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }} data-testid="current-overrides">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>Current overrides</div>
              {resolved.filter((r) => r.override).length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>None.</div>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {resolved.filter((r) => r.override).map((r) => (
                    <li key={r.feature_key} style={{ fontSize: 11, color: '#334155', borderLeft: `3px solid ${r.override!.mode === 'grant' ? '#2EAA4A' : '#b91c1c'}`, paddingLeft: 8 }}>
                      <b>{r.override!.mode}</b> {r.label}
                      {r.feature_type === 'limit' && r.override!.override_value !== null ? ` = ${formatLimit(r.override!.override_value)}` : ''}
                      {r.override!.expires_at ? <span style={{ color: r.override!.expired ? '#b91c1c' : '#64748b' }}> · {r.override!.expired ? 'expired' : 'exp'} {isoToDateInput(r.override!.expires_at)}</span> : ''}
                      {r.override!.reason ? <span style={{ color: '#94a3b8' }}> · {r.override!.reason}</span> : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 18px', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, background: toast.type === 'success' ? '#2EAA4A' : '#DC2626', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 2000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
