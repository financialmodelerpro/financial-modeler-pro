'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type {
  FeatureRegistryRow,
  SubscriptionPlan,
} from '@/src/types/subscription.types';

interface UserOption {
  id: string;
  email: string;
  name: string | null;
  subscription_plan: string;
}

interface MatrixData {
  features: FeatureRegistryRow[];
  matrix: Record<SubscriptionPlan, Record<string, boolean>>;
  userOverrides: Record<string, boolean>;
}

const PLANS: SubscriptionPlan[] = ['free', 'professional', 'enterprise'];

const PLAN_COLOR: Record<SubscriptionPlan, string> = {
  free:         'var(--color-grey-mid)',
  professional: 'var(--color-navy-mid)',
  enterprise:   '#7C3AED',
};

const CATEGORY_LABELS: Record<string, string> = {
  modules:        '📦 Modules',
  module_quality: '⭐ Module Quality',
  ai:             '🤖 AI Features',
  export:         '📤 Export',
  admin:          '🛡️ Admin & Branding',
  limits:         '📊 Project Limits',
};

const CATEGORY_ORDER = ['modules', 'module_quality', 'ai', 'export', 'admin', 'limits'];

// ── Toggle cell ───────────────────────────────────────────────────────────────
function Toggle({
  checked,
  disabled,
  saving,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => !disabled && !saving && onChange(!checked)}
      disabled={disabled || saving}
      title={checked ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: saving ? '#d1d5db' : checked ? '#22c55e' : '#d1d5db',
        position: 'relative', transition: 'background 0.18s', flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2,
        left: saving ? 18 : checked ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: 'var(--color-grey-white)', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.18s',
      }} />
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PermissionsManager({ users, initialTab = 'plans' }: { users: UserOption[], initialTab?: 'plans' | 'users' }) {
  const [data,    setData]    = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [toast,   setToast]   = useState('');
  const [tab,     setTab]     = useState<'plans' | 'users'>(initialTab);

  // User override tab state
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [userOverrides,  setUserOverrides]  = useState<Record<string, boolean>>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Load matrix
  const loadMatrix = useCallback(async (userId?: string) => {
    setLoading(true);
    const url = userId ? `/api/admin/permissions?userId=${userId}` : '/api/admin/permissions';
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json() as MatrixData;
      setData(json);
      if (userId) setUserOverrides(json.userOverrides ?? {});
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  // Toggle a plan permission
  const togglePlan = async (plan: SubscriptionPlan, featureKey: string, enabled: boolean) => {
    const key = `${plan}:${featureKey}`;
    setSaving((s) => ({ ...s, [key]: true }));
    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        matrix: {
          ...prev.matrix,
          [plan]: { ...prev.matrix[plan], [featureKey]: enabled },
        },
      };
    });
    const res = await fetch('/api/admin/permissions', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'plan', plan, feature_key: featureKey, enabled }),
    });
    setSaving((s) => ({ ...s, [key]: false }));
    if (res.ok) showToast(`${plan} / ${featureKey} → ${enabled ? 'enabled' : 'disabled'}`);
    else        showToast('Save failed — check console');
  };

  // Toggle a user override
  const toggleUserOverride = async (featureKey: string, value: boolean | null) => {
    if (!selectedUserId) return;
    const key = `user:${featureKey}`;
    setSaving((s) => ({ ...s, [key]: true }));
    // Optimistic update
    setUserOverrides((prev) => {
      if (value === null) {
        const next = { ...prev };
        delete next[featureKey];
        return next;
      }
      return { ...prev, [featureKey]: value };
    });
    const res = await fetch('/api/admin/permissions', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'user', user_id: selectedUserId, feature_key: featureKey, override_value: value }),
    });
    setSaving((s) => ({ ...s, [key]: false }));
    if (res.ok) showToast(value === null ? `Override removed for ${featureKey}` : `Override set: ${featureKey} → ${value}`);
    else        showToast('Save failed');
  };

  const handleUserSelect = async (userId: string) => {
    setSelectedUserId(userId);
    if (userId) {
      const res = await fetch(`/api/admin/permissions?userId=${userId}`);
      if (res.ok) {
        const json = await res.json() as MatrixData;
        setUserOverrides(json.userOverrides ?? {});
      }
    } else {
      setUserOverrides({});
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--color-meta)', fontSize: 13 }}>Loading permissions…</div>;
  }
  if (!data) {
    return <div style={{ padding: 24, color: 'var(--color-negative)', fontSize: 13 }}>Failed to load permission matrix.</div>;
  }

  // Group features by category
  const grouped = CATEGORY_ORDER.reduce<Record<string, FeatureRegistryRow[]>>((acc, cat) => {
    acc[cat] = data.features.filter((f) => f.category === cat);
    return acc;
  }, {});

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--color-border)', paddingBottom: 0 }}>
        {(['plans', 'users'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px', border: 'none', cursor: 'pointer', borderRadius: '6px 6px 0 0',
              fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif',
              background: tab === t ? 'var(--color-primary)' : 'transparent',
              color:      tab === t ? 'var(--color-grey-white)' : 'var(--color-meta)',
              borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -2,
              transition: 'var(--transition)',
            }}
          >
            {t === 'plans' ? '📋 Plan Defaults' : '👤 User Overrides'}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════ PLAN MATRIX */}
      {tab === 'plans' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 16 }}>
            These are the <strong>default permissions for each plan</strong>.
            Changes take effect for all users on that plan on their next request.
            User overrides (see User Overrides tab) take precedence over these defaults.
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, color: 'var(--color-heading)', width: '45%' }}>
                    Feature
                  </th>
                  {PLANS.map((plan) => (
                    <th key={plan} style={{
                      padding: '8px 12px', textAlign: 'center', fontWeight: 700,
                      color: PLAN_COLOR[plan], width: '18%',
                    }}>
                      {plan.charAt(0).toUpperCase() + plan.slice(1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATEGORY_ORDER.map((cat) => {
                  const rows = grouped[cat];
                  if (!rows?.length) return null;
                  return (
                    <React.Fragment key={cat}>
                      {/* Category header row */}
                      <tr>
                        <td colSpan={4} style={{
                          padding: '12px 12px 4px',
                          fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
                          letterSpacing: '0.08em', color: 'var(--color-meta)',
                          background: 'var(--color-bg)',
                        }}>
                          {CATEGORY_LABELS[cat] ?? cat}
                        </td>
                      </tr>
                      {rows.map((feature, idx) => (
                        <tr key={feature.feature_key} style={{
                          borderBottom: '1px solid var(--color-border)',
                          background: idx % 2 === 0 ? 'var(--color-grey-white)' : '#fafafa',
                        }}>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--color-heading)' }}>
                              {feature.display_name}
                            </div>
                            {feature.description && (
                              <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 1 }}>
                                {feature.description}
                              </div>
                            )}
                          </td>
                          {PLANS.map((plan) => {
                            const key   = `${plan}:${feature.feature_key}`;
                            const value = data.matrix[plan]?.[feature.feature_key] ?? false;
                            return (
                              <td key={plan} style={{ textAlign: 'center', padding: '8px 12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                  <Toggle
                                    checked={value}
                                    saving={saving[key]}
                                    onChange={(v) => togglePlan(plan, feature.feature_key, v)}
                                  />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ USER OVERRIDES */}
      {tab === 'users' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 16 }}>
            Set <strong>per-user overrides</strong> that supersede their plan defaults.
            A green override grants a feature beyond their plan; red overrides restrict it.
            Remove an override to revert to the plan default.
          </p>

          {/* User selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-heading)', flexShrink: 0 }}>
              Select User:
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => handleUserSelect(e.target.value)}
              style={{
                padding: '7px 12px', fontSize: 13, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)', background: 'white',
                fontFamily: 'Inter,sans-serif', minWidth: 280, outline: 'none',
              }}
            >
              <option value="">— choose a user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email} ({u.subscription_plan})
                </option>
              ))}
            </select>
            {selectedUser && (
              <span style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20,
                background: 'var(--color-navy-pale)', color: 'var(--color-navy)', fontWeight: 700,
              }}>
                Plan: {selectedUser.subscription_plan}
              </span>
            )}
          </div>

          {selectedUserId && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, color: 'var(--color-heading)', width: '50%' }}>Feature</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--color-meta)' }}>Plan Default</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--color-heading)' }}>User Override</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--color-meta)' }}>Effective</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--color-meta)' }}>Remove Override</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORY_ORDER.map((cat) => {
                    const rows = grouped[cat];
                    if (!rows?.length) return null;
                    return (
                      <React.Fragment key={cat}>
                        <tr>
                          <td colSpan={5} style={{
                            padding: '12px 12px 4px',
                            fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
                            letterSpacing: '0.08em', color: 'var(--color-meta)',
                            background: 'var(--color-bg)',
                          }}>
                            {CATEGORY_LABELS[cat] ?? cat}
                          </td>
                        </tr>
                        {rows.map((feature, idx) => {
                          const plan        = selectedUser?.subscription_plan as SubscriptionPlan ?? 'free';
                          const planDefault = data.matrix[plan]?.[feature.feature_key] ?? false;
                          const hasOverride = feature.feature_key in userOverrides;
                          const overrideVal = userOverrides[feature.feature_key];
                          const effective   = hasOverride ? overrideVal : planDefault;
                          const saveKey     = `user:${feature.feature_key}`;

                          return (
                            <tr key={feature.feature_key} style={{
                              borderBottom: '1px solid var(--color-border)',
                              background: idx % 2 === 0 ? 'var(--color-grey-white)' : '#fafafa',
                            }}>
                              <td style={{ padding: '8px 12px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--color-heading)' }}>
                                  {feature.display_name}
                                </div>
                              </td>

                              {/* Plan default (read-only) */}
                              <td style={{ textAlign: 'center', padding: '8px 12px' }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                  background: planDefault ? 'var(--color-green-light)' : '#fee2e2',
                                  color:      planDefault ? 'var(--color-green-dark)' : 'var(--color-negative)',
                                }}>
                                  {planDefault ? 'Yes' : 'No'}
                                </span>
                              </td>

                              {/* User override toggle */}
                              <td style={{ textAlign: 'center', padding: '8px 12px' }}>
                                {hasOverride ? (
                                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <Toggle
                                      checked={overrideVal}
                                      saving={saving[saveKey]}
                                      onChange={(v) => toggleUserOverride(feature.feature_key, v)}
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => toggleUserOverride(feature.feature_key, !planDefault)}
                                    style={{
                                      fontSize: 10, padding: '3px 8px', borderRadius: 10, cursor: 'pointer',
                                      border: '1px solid var(--color-grey-light)', background: 'var(--color-grey-pale)',
                                      color: 'var(--color-grey-mid)', fontFamily: 'Inter,sans-serif',
                                    }}
                                  >
                                    + Add
                                  </button>
                                )}
                              </td>

                              {/* Effective value */}
                              <td style={{ textAlign: 'center', padding: '8px 12px' }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                  background: effective ? 'var(--color-green-light)' : '#fee2e2',
                                  color:      effective ? 'var(--color-green-dark)' : 'var(--color-negative)',
                                  outline: hasOverride ? '2px solid #f59e0b' : 'none',
                                  outlineOffset: 1,
                                }}>
                                  {effective ? 'Yes' : 'No'}
                                </span>
                                {hasOverride && (
                                  <div style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700, marginTop: 2 }}>OVERRIDE</div>
                                )}
                              </td>

                              {/* Remove override */}
                              <td style={{ textAlign: 'center', padding: '8px 12px' }}>
                                {hasOverride ? (
                                  <button
                                    onClick={() => toggleUserOverride(feature.feature_key, null)}
                                    disabled={saving[saveKey]}
                                    style={{
                                      fontSize: 10, padding: '3px 8px', borderRadius: 10, cursor: 'pointer',
                                      border: '1px solid #fca5a5', background: '#fee2e2',
                                      color: 'var(--color-negative)', fontFamily: 'Inter,sans-serif',
                                    }}
                                  >
                                    Remove
                                  </button>
                                ) : (
                                  <span style={{ color: 'var(--color-grey-light)', fontSize: 16 }}>—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!selectedUserId && (
            <div style={{
              padding: '40px 24px', textAlign: 'center',
              background: '#fafafa', borderRadius: 8,
              border: '2px dashed var(--color-border)',
              color: 'var(--color-meta)', fontSize: 13,
            }}>
              Select a user above to view and edit their permission overrides.
            </div>
          )}
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
          background: 'var(--color-green-dark)', color: 'var(--color-grey-white)', padding: '10px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)', fontFamily: 'Inter,sans-serif',
        }}>
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
