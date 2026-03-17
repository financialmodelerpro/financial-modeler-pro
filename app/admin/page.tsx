'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useBrandingStore } from '@/src/core/core-state';
import PermissionsManager    from '@/src/components/admin/PermissionsManager';
import ProjectsBrowser        from '@/src/components/admin/ProjectsBrowser';
import AuditLogViewer         from '@/src/components/admin/AuditLogViewer';
import SystemHealth           from '@/src/components/admin/SystemHealth';
import AnnouncementsManager   from '@/src/components/admin/AnnouncementsManager';

// ── Types ─────────────────────────────────────────────────────────────────────
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  subscription_plan: 'free' | 'professional' | 'enterprise';
  subscription_status: 'active' | 'trial' | 'expired' | 'cancelled';
  projects_limit: number;
  admin_notes: string | null;
  last_login_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
}
type EditMap = Record<string, Partial<UserRow>>;
type AdminTab = 'users' | 'permissions' | 'projects' | 'audit' | 'announcements' | 'whitelabel' | 'health';

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'users',         label: 'Users',         icon: '👥' },
  { id: 'permissions',   label: 'Permissions',   icon: '🔐' },
  { id: 'projects',      label: 'Projects',      icon: '📁' },
  { id: 'audit',         label: 'Audit Log',     icon: '📋' },
  { id: 'announcements', label: 'Announcements', icon: '📢' },
  { id: 'whitelabel',    label: 'White-Label',   icon: '🏷️' },
  { id: 'health',        label: 'System Health', icon: '❤️' },
];

const PLAN_COLORS: Record<string, string>   = { free: 'var(--color-grey-mid)', professional: 'var(--color-navy-mid)', enterprise: '#7c3aed' };
const STATUS_COLORS: Record<string, string> = { active: 'var(--color-green-dark)', trial: '#92400e', expired: 'var(--color-negative)', cancelled: 'var(--color-grey-dark)' };
const ROLE_COLORS: Record<string, string>   = { admin: 'var(--color-negative)', user: 'var(--color-navy-mid)' };

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // Users state
  const [users,   setUsers]   = useState<UserRow[]>([]);
  const [edits,   setEdits]   = useState<EditMap>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [toast,   setToast]   = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPlan, setBulkPlan] = useState('');

  // White-label state
  const { branding, setBranding } = useBrandingStore();
  const [wlScope,   setWlScope]   = useState<string>('global');
  const [wlDraft,   setWlDraft]   = useState(() => ({ ...branding.whiteLabel }));
  const [wlSaving,  setWlSaving]  = useState(false);
  const [wlSaved,   setWlSaved]   = useState(false);
  const [wlLoading, setWlLoading] = useState(false);

  // Guard — admin only
  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && session.user.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    if (res.ok) setUsers((await res.json()).users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const loadWlBranding = useCallback(async (scope: string) => {
    setWlLoading(true);
    const res = await fetch(`/api/branding?scope=${encodeURIComponent(scope)}`);
    if (res.ok) {
      const json = await res.json();
      const cfg  = json.config;
      setWlDraft(cfg?.whiteLabel ?? { enabled: false, clientName: '', clientLogo: null, clientPrimaryColor: null });
    }
    setWlLoading(false);
  }, []);

  const handleWlScopeChange = async (scope: string) => {
    setWlScope(scope);
    if (scope === 'global') {
      setWlDraft({ ...branding.whiteLabel });
    } else {
      await loadWlBranding(scope);
    }
  };

  const saveWlBranding = async () => {
    setWlSaving(true);
    const configToSave = wlScope === 'global'
      ? { ...branding, whiteLabel: wlDraft }
      : { whiteLabel: wlDraft };
    const res = await fetch('/api/branding', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ config: configToSave, scope: wlScope }),
    });
    if (res.ok) {
      if (wlScope === 'global') setBranding({ ...branding, whiteLabel: wlDraft });
      setWlSaved(true);
      setTimeout(() => setWlSaved(false), 2500);
    } else {
      showToast('Failed to save branding');
    }
    setWlSaving(false);
  };

  const setEdit = (userId: string, field: keyof UserRow, value: unknown) =>
    setEdits((p) => ({ ...p, [userId]: { ...p[userId], [field]: value } }));

  const saveUser = async (userId: string) => {
    const changes = edits[userId];
    if (!changes || !Object.keys(changes).length) return;
    setSaving((s) => ({ ...s, [userId]: true }));
    const res = await fetch('/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, ...changes }),
    });
    setSaving((s) => ({ ...s, [userId]: false }));
    if (res.ok) {
      const json = await res.json();
      setUsers((p) => p.map((u) => u.id === userId ? { ...u, ...json.user } : u));
      setEdits((p) => { const e = { ...p }; delete e[userId]; return e; });
      showToast('User updated');
    } else {
      showToast('Save failed');
    }
  };

  const extendTrial = async (userId: string) => {
    const ends = new Date();
    ends.setDate(ends.getDate() + 30);
    const res = await fetch('/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, subscription_status: 'trial', trial_ends_at: ends.toISOString() }),
    });
    if (res.ok) { await fetchUsers(); showToast('Trial extended 30 days'); }
  };

  const saveNotes = async (userId: string, notes: string) => {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, admin_notes: notes }),
    });
    if (res.ok) { setUsers((p) => p.map((u) => u.id === userId ? { ...u, admin_notes: notes } : u)); showToast('Notes saved'); }
  };

  const bulkUpdate = async () => {
    if (!bulkPlan || !selected.size) return;
    for (const id of selected) {
      await fetch('/api/admin/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, subscription_plan: bulkPlan }),
      });
    }
    await fetchUsers();
    setSelected(new Set());
    setBulkPlan('');
    showToast(`Updated ${selected.size} users to ${bulkPlan}`);
  };

  const filteredUsers = users.filter((u) =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) || (u.name ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const stats = {
    total:        users.length,
    admins:       users.filter((u) => u.role === 'admin').length,
    active:       users.filter((u) => u.subscription_status === 'active').length,
    trial:        users.filter((u) => u.subscription_status === 'trial').length,
    expired:      users.filter((u) => u.subscription_status === 'expired').length,
    free:         users.filter((u) => u.subscription_plan === 'free').length,
    professional: users.filter((u) => u.subscription_plan === 'professional').length,
    enterprise:   users.filter((u) => u.subscription_plan === 'enterprise').length,
  };

  if (status === 'loading' || loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <div className="state-loading">Loading admin panel…</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>

      {/* ── Topbar ── */}
      <header style={{
        background: 'var(--color-primary-deep)', borderBottom: '1px solid rgba(255,255,255,0.08)',
        height: 52, display: 'flex', alignItems: 'center', padding: '0 var(--sp-4)',
        gap: 'var(--sp-2)', position: 'sticky', top: 0, zIndex: 100, flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>🛡️</span>
        <span style={{ color: 'white', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Admin Panel
        </span>
        <div style={{ flex: 1 }} />
        <a href="/refm"   style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', marginRight: 8 }}>← Platform</a>
        <a href="/portal" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', marginRight: 16 }}>← Portal</a>
        <button onClick={() => signOut({ callbackUrl: '/portal' })}
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
          Sign Out
        </button>
      </header>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 52px)' }}>

        {/* ── Sidebar nav ── */}
        <nav style={{ width: 200, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', padding: '16px 0', flexShrink: 0, position: 'sticky', top: 52, height: 'calc(100vh - 52px)', overflowY: 'auto' }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 18px', border: 'none', cursor: 'pointer',
              background: activeTab === t.id ? 'rgba(var(--color-primary-rgb, 30,58,138),0.08)' : 'transparent',
              borderLeft: activeTab === t.id ? '3px solid var(--color-primary)' : '3px solid transparent',
              color: activeTab === t.id ? 'var(--color-primary)' : 'var(--color-heading)',
              fontWeight: activeTab === t.id ? 700 : 500,
              fontSize: 13, textAlign: 'left', fontFamily: 'Inter,sans-serif',
              transition: 'var(--transition)',
            }}>
              <span style={{ fontSize: 15 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {/* ── Main content ── */}
        <main style={{ flex: 1, padding: 'var(--sp-4)', overflowY: 'auto' }}>

          {/* ═══════════════════════════════════════════════════ USERS */}
          {activeTab === 'users' && (
            <>
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
                {[
                  { label: 'Total Users',  value: stats.total,        accent: 'var(--color-navy-mid)' },
                  { label: 'Admins',       value: stats.admins,       accent: 'var(--color-negative)' },
                  { label: 'Active',       value: stats.active,       accent: 'var(--color-green-dark)' },
                  { label: 'Trial',        value: stats.trial,        accent: '#92400e' },
                  { label: 'Expired',      value: stats.expired,      accent: 'var(--color-negative)' },
                  { label: 'Free',         value: stats.free,         accent: 'var(--color-grey-mid)' },
                  { label: 'Professional', value: stats.professional,  accent: 'var(--color-navy-mid)' },
                  { label: 'Enterprise',   value: stats.enterprise,   accent: '#7c3aed' },
                ].map((s) => (
                  <div key={s.label} className="kpi-card">
                    <div className="kpi-card__accent" style={{ background: s.accent }} />
                    <div className="kpi-card__body">
                      <div className="kpi-card__label">{s.label}</div>
                      <div className="kpi-card__value">{s.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  placeholder="Search by email or name…"
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  style={{ padding: '7px 12px', fontSize: 13, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', fontFamily: 'Inter,sans-serif', width: 240, outline: 'none' }}
                />
                {selected.size > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--color-navy-light)', border: '1px solid var(--color-navy-pale)', borderRadius: 'var(--radius-sm)', padding: '5px 12px' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-navy-mid)' }}>{selected.size} selected</span>
                    <select value={bulkPlan} onChange={(e) => setBulkPlan(e.target.value)} style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--color-navy-pale)', borderRadius: 4, background: 'var(--color-grey-white)', fontFamily: 'Inter,sans-serif' }}>
                      <option value="">Change plan…</option>
                      <option value="free">Free</option>
                      <option value="professional">Professional</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                    <button onClick={bulkUpdate} disabled={!bulkPlan} style={{ fontSize: 11, padding: '3px 10px', background: 'var(--color-navy-mid)', color: 'var(--color-grey-white)', border: 'none', borderRadius: 20, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700 }}>
                      Apply
                    </button>
                    <button onClick={() => setSelected(new Set())} style={{ fontSize: 11, padding: '3px 8px', background: 'none', border: '1px solid var(--color-navy-pale)', borderRadius: 20, cursor: 'pointer', color: 'var(--color-navy-mid)', fontFamily: 'Inter,sans-serif' }}>
                      Clear
                    </button>
                  </div>
                )}
                <button onClick={fetchUsers} style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                  ↻ Refresh
                </button>
              </div>

              {/* Table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table-standard">
                    <thead>
                      <tr>
                        <th style={{ width: 36, textAlign: 'center' }}>
                          <input type="checkbox" checked={selected.size === filteredUsers.length && filteredUsers.length > 0}
                            onChange={(e) => setSelected(e.target.checked ? new Set(filteredUsers.map((u) => u.id)) : new Set())} />
                        </th>
                        <th style={{ textAlign: 'left' }}>User</th>
                        <th>Role</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th>Proj. Limit</th>
                        <th>Last Login</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user) => {
                        const e     = edits[user.id] ?? {};
                        const role  = (e.role ?? user.role) as string;
                        const plan  = (e.subscription_plan ?? user.subscription_plan) as string;
                        const stat  = (e.subscription_status ?? user.subscription_status) as string;
                        const lim   = e.projects_limit ?? user.projects_limit ?? 3;
                        const notes = e.admin_notes ?? user.admin_notes ?? '';
                        const dirty = !!edits[user.id] && Object.keys(edits[user.id]!).length > 0;
                        const isSelf = user.id === session?.user?.id;
                        const isSel  = selected.has(user.id);

                        return (
                          <React.Fragment key={user.id}>
                            <tr style={{ background: isSel ? 'var(--color-navy-light)' : undefined }}>
                              <td style={{ textAlign: 'center' }}>
                                <input type="checkbox" checked={isSel} onChange={(e) => {
                                  const s = new Set(selected);
                                  e.target.checked ? s.add(user.id) : s.delete(user.id);
                                  setSelected(s);
                                }} />
                              </td>
                              <td style={{ textAlign: 'left', minWidth: 200 }}>
                                <div style={{ fontWeight: 600, color: 'var(--color-heading)', fontSize: 13 }}>
                                  {user.name ?? '—'}
                                  {isSelf && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--color-navy-pale)', color: 'var(--color-navy-mid)', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>YOU</span>}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>{user.email}</div>
                              </td>
                              <td>
                                <select value={role} onChange={(e) => setEdit(user.id, 'role', e.target.value)} disabled={isSelf} style={selectStyle(ROLE_COLORS[role] ?? '#6b7280')}>
                                  <option value="user">User</option>
                                  <option value="admin">Admin</option>
                                </select>
                              </td>
                              <td>
                                <select value={plan} onChange={(e) => setEdit(user.id, 'subscription_plan', e.target.value)} style={selectStyle(PLAN_COLORS[plan] ?? '#6b7280')}>
                                  <option value="free">Free</option>
                                  <option value="professional">Professional</option>
                                  <option value="enterprise">Enterprise</option>
                                </select>
                              </td>
                              <td>
                                <select value={stat} onChange={(e) => setEdit(user.id, 'subscription_status', e.target.value)} style={selectStyle(STATUS_COLORS[stat] ?? '#6b7280')}>
                                  <option value="active">Active</option>
                                  <option value="trial">Trial</option>
                                  <option value="expired">Expired</option>
                                  <option value="cancelled">Cancelled</option>
                                </select>
                              </td>
                              <td>
                                <input type="number" value={Number.isNaN(lim) ? '' : lim} min={-1}
                                  onChange={(e) => { const n = parseInt(e.target.value, 10); setEdit(user.id, 'projects_limit', Number.isNaN(n) ? 0 : n); }}
                                  style={{ width: 70, textAlign: 'center', padding: '5px 6px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-grey-white)', fontFamily: 'Inter,sans-serif' }}
                                  title="-1 = unlimited"
                                />
                              </td>
                              <td style={{ fontSize: 11, color: 'var(--color-meta)', whiteSpace: 'nowrap' }}>
                                {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : '—'}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                                  <button onClick={() => saveUser(user.id)} disabled={!dirty || saving[user.id]} style={{
                                    padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: 'none',
                                    cursor: dirty ? 'pointer' : 'default',
                                    background: dirty ? 'var(--color-primary)' : 'var(--color-border)',
                                    color: dirty ? 'white' : 'var(--color-muted)',
                                    fontFamily: 'Inter,sans-serif',
                                  }}>{saving[user.id] ? '…' : dirty ? 'Save' : 'Saved'}</button>
                                  {user.subscription_status === 'trial' && (
                                    <button onClick={() => extendTrial(user.id)} title="Extend trial by 30 days" style={{ padding: '4px 8px', fontSize: 10, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: '1px solid #fbbf24', background: '#fffbeb', color: '#92400e', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                                      +30d
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {/* Admin notes row */}
                            <tr style={{ background: 'var(--color-grey-pale)', borderBottom: '2px solid var(--color-border)' }}>
                              <td />
                              <td colSpan={7} style={{ paddingBottom: 8, paddingTop: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>📝 Notes</span>
                                  <input
                                    value={notes}
                                    onChange={(e) => setEdit(user.id, 'admin_notes', e.target.value)}
                                    onBlur={(e) => { if (e.target.value !== (user.admin_notes ?? '')) saveNotes(user.id, e.target.value); }}
                                    placeholder="Internal admin notes (not visible to user)…"
                                    style={{ flex: 1, padding: '4px 8px', fontSize: 11, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-grey-white)', fontFamily: 'Inter,sans-serif', outline: 'none', color: 'var(--color-grey-dark)' }}
                                  />
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                      {filteredUsers.length === 0 && (
                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: 'var(--sp-4)', color: 'var(--color-muted)' }}>No users found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 'var(--sp-2)' }}>
                Proj. limit: <strong>-1</strong> = unlimited. Changes take effect on next sign-in.
              </p>
            </>
          )}

          {/* ═══════════════════════════════════════════════════ PERMISSIONS */}
          {activeTab === 'permissions' && (
            <div className="card" style={{ padding: 'var(--sp-3)' }}>
              <h2 className="section-header" style={{ marginBottom: 6 }}>🔐 Feature Permissions</h2>
              <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
                Configure which features each plan can access, and set per-user overrides. Changes apply instantly.
              </p>
              <PermissionsManager users={users.map((u) => ({ id: u.id, email: u.email, name: u.name, subscription_plan: u.subscription_plan }))} />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ PROJECTS */}
          {activeTab === 'projects' && (
            <div className="card" style={{ padding: 'var(--sp-3)' }}>
              <h2 className="section-header" style={{ marginBottom: 6 }}>📁 Projects Browser</h2>
              <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
                View all projects across all users. Archive or delete orphaned/oversized projects.
              </p>
              <ProjectsBrowser />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ AUDIT LOG */}
          {activeTab === 'audit' && (
            <div className="card" style={{ padding: 'var(--sp-3)' }}>
              <h2 className="section-header" style={{ marginBottom: 6 }}>📋 Audit Log</h2>
              <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
                Complete record of every admin action — who changed what and when.
              </p>
              <AuditLogViewer />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ ANNOUNCEMENTS */}
          {activeTab === 'announcements' && (
            <div className="card" style={{ padding: 'var(--sp-3)' }}>
              <h2 className="section-header" style={{ marginBottom: 6 }}>📢 Announcements</h2>
              <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
                Push system-wide banners to all users. No code deploy needed.
              </p>
              <AnnouncementsManager />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ WHITE-LABEL */}
          {activeTab === 'whitelabel' && (
            <div className="card" style={{ padding: 'var(--sp-3)' }}>
              <h2 className="section-header" style={{ marginBottom: 6 }}>🏷️ White-Label Settings</h2>
              <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 'var(--sp-3)', marginTop: 0 }}>
                Configure branding globally or per-user. Per-user settings override the global defaults for that user.
              </p>

              {/* Scope selector */}
              <div style={{ marginBottom: 20, background: 'var(--color-grey-pale)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '14px 16px' }}>
                <label style={{ ...wlLabel, marginBottom: 8 }}>Apply branding to</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleWlScopeChange('global')}
                    style={{
                      padding: '6px 16px', fontSize: 12, fontWeight: 700, borderRadius: 20, cursor: 'pointer', fontFamily: 'Inter,sans-serif',
                      border: wlScope === 'global' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      background: wlScope === 'global' ? 'var(--color-navy-pale)' : 'var(--color-grey-white)',
                      color: wlScope === 'global' ? 'var(--color-navy-mid)' : 'var(--color-meta)',
                    }}
                  >
                    🌐 Global (all users)
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>or select a user:</span>
                  <select
                    value={wlScope === 'global' ? '' : wlScope}
                    onChange={(e) => e.target.value && handleWlScopeChange(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-grey-white)', fontFamily: 'Inter,sans-serif', minWidth: 220, outline: 'none' }}
                  >
                    <option value="">— Pick a user —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email} {u.subscription_plan !== 'free' ? `(${u.subscription_plan})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {wlScope !== 'global' && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#92400e', background: '#fef3c7', padding: '5px 10px', borderRadius: 6, display: 'inline-block' }}>
                    ⚠️ Editing branding for: <strong>{users.find((u) => u.id === wlScope)?.email ?? wlScope}</strong> — overrides global settings for this user only
                  </div>
                )}
              </div>

              {wlLoading ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-meta)' }}>Loading branding config…</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" id="wl-enabled" checked={!!wlDraft?.enabled} onChange={(e) => setWlDraft((d) => ({ ...d, enabled: e.target.checked }))} />
                    <label htmlFor="wl-enabled" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', cursor: 'pointer' }}>
                      Enable white-label mode {wlScope !== 'global' ? 'for this user' : 'globally'}
                    </label>
                  </div>
                  <div>
                    <label style={wlLabel}>Client Name</label>
                    <input style={wlInput} value={wlDraft?.clientName ?? ''} placeholder="e.g. Acme Capital" onChange={(e) => setWlDraft((d) => ({ ...d, clientName: e.target.value }))} />
                  </div>
                  <div>
                    <label style={wlLabel}>Primary Colour</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="color" value={wlDraft?.clientPrimaryColor ?? '#1E3A8A'} onChange={(e) => setWlDraft((d) => ({ ...d, clientPrimaryColor: e.target.value }))} style={{ width: 40, height: 32, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4 }} />
                      <input style={{ ...wlInput, flex: 1 }} value={wlDraft?.clientPrimaryColor ?? ''} placeholder="#1E3A8A" onChange={(e) => setWlDraft((d) => ({ ...d, clientPrimaryColor: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={wlLabel}>Client Logo URL <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(image URL or data-URL)</span></label>
                    <input style={wlInput} value={wlDraft?.clientLogo ?? ''} placeholder="https://example.com/logo.png" onChange={(e) => setWlDraft((d) => ({ ...d, clientLogo: e.target.value || null }))} />
                  </div>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
                    {wlScope !== 'global' && (
                      <button
                        onClick={() => loadWlBranding(wlScope)}
                        style={{ padding: '7px 14px', background: 'var(--color-grey-white)', color: 'var(--color-meta)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, fontFamily: 'Inter,sans-serif' }}
                      >
                        ↺ Reset
                      </button>
                    )}
                    <button
                      onClick={saveWlBranding}
                      disabled={wlSaving}
                      style={{ padding: '7px 20px', background: wlSaved ? 'var(--color-green-dark)' : 'var(--color-primary)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', transition: 'background 0.2s', opacity: wlSaving ? 0.7 : 1 }}
                    >
                      {wlSaving ? '…' : wlSaved ? '✓ Saved!' : '💾 Save White-Label'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ HEALTH */}
          {activeTab === 'health' && (
            <div className="card" style={{ padding: 'var(--sp-3)' }}>
              <h2 className="section-header" style={{ marginBottom: 6 }}>❤️ System Health</h2>
              <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
                Live status of API endpoints, environment variables, and browser storage.
              </p>
              <SystemHealth />
            </div>
          )}

        </main>
      </div>

      {/* ── Toast ── */}
      {toast && <div className="pm-toast">✓ {toast}</div>}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function selectStyle(accentColor: string): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 20,
    border: `1px solid ${accentColor}40`, background: `${accentColor}18`,
    color: accentColor, cursor: 'pointer', fontFamily: 'Inter,sans-serif',
    outline: 'none', appearance: 'none' as const,
  };
}

const wlLabel: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--color-muted)', marginBottom: 4,
};

const wlInput: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  background: 'var(--color-warning-bg)', fontFamily: 'Inter,sans-serif',
  boxSizing: 'border-box', outline: 'none',
};
