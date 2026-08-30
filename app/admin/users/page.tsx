'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useSession } from 'next-auth/react';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';
import { DeleteUserModal } from '@/src/components/admin/DeleteUserModal';
import { UserProjectsModal } from '@/src/components/admin/UserProjectsModal';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  // Data-driven plan key (trial/solo/pro/firm post-reconciliation; legacy values
  // may still appear until reconciled). Display-only here; changed in /admin/access.
  subscription_plan: string;
  subscription_status: 'active' | 'trial' | 'expired' | 'cancelled';
  created_at: string;
  projects?: [{ count: number }];
  // Auto-computed (by date) on the server from the plan's access-expiry anchor.
  // accessExpiresAt = the lapse anchor (ISO) or null when the plan does not
  // expire; accessStatus = the live date-driven state (active / grace / lapsed)
  // or the stored status when there is no expiry. lapseState is the raw state.
  accessExpiresAt?: string | null;
  accessStatus?: string;
  // Signup qualification (mig 216). undefined = the column is absent (migration
  // not applied); null = the user registered before the question existed. Those
  // are different and the column says so rather than showing a blank.
  works_in_real_estate?: boolean | null;
  real_estate_role_note?: string | null;
  lapseState?: 'active' | 'grace' | 'lapsed';
  // Cancellation state from the durable scheduled_cancel_at marker (mig 183):
  // 'canceling' = cancel scheduled, access not yet ended; 'canceled' = the
  // scheduled date has passed. cancelAt is the date access ends.
  cancelState?: 'canceling' | 'canceled' | null;
  cancelAt?: string | null;
}

// Cancellation badge meta: canceling (still has access) vs canceled (ended).
const CANCEL_STATUS_META: Record<string, { color: string; label: string }> = {
  canceling: { color: '#B45309', label: 'canceling' },
  canceled:  { color: '#B91C1C', label: 'canceled' },
};

function CancelBadge({ state }: { state: 'canceling' | 'canceled' }) {
  const meta = CANCEL_STATUS_META[state];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 12,
      fontSize: 11, fontWeight: 700, color: '#fff', background: meta.color,
      letterSpacing: '0.03em', textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active:    '#1A7A30',
  trial:     '#D97706',
  expired:   '#DC2626',
  cancelled: '#DC2626',
};

// Auto-computed (date-driven) access state colors. 'grace' = read-only window,
// 'lapsed' = grace elapsed (no access). 'active' falls through to green.
const ACCESS_STATUS_META: Record<string, { color: string; label: string }> = {
  active: { color: '#1A7A30', label: 'active' },
  grace:  { color: '#D97706', label: 'grace (read-only)' },
  lapsed: { color: '#DC2626', label: 'expired (lapsed)' },
};

function AccessStatusBadge({ status }: { status: string }) {
  const meta = ACCESS_STATUS_META[status] ?? { color: STATUS_COLORS[status] ?? '#6B7280', label: status };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 12,
      fontSize: 11, fontWeight: 700, color: '#fff', background: meta.color,
      letterSpacing: '0.03em', textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

// PlanBadge / StatusBadge are gone deliberately (2026-08-30): each merely
// repeated the value of the dropdown beside it, so a row said the same thing
// twice. The dropdowns are the single statement of plan and status.

export default function AdminUsersPage() {
  const { loading: authLoading } = useRequireAdmin();
  const { data: session } = useSession();
  const [users, setUsers]                   = useState<User[]>([]);
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState('');
  const [planFilter, setPlanFilter]         = useState('all');
  const [roleFilter, setRoleFilter]         = useState('all');
  const [cancelFilter, setCancelFilter]     = useState('all');
  // Signup qualification (mig 216): filter and sort, so every active real
  // estate user reads at a glance rather than being hunted for one by one.
  const [reFilter, setReFilter]             = useState('all');
  const [sortByRe, setSortByRe]             = useState(false);
  const [page, setPage]             = useState(0);
  const [total, setTotal]           = useState(0);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [toast, setToast]           = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [projectsTarget, setProjectsTarget] = useState<{ id: string; email: string } | null>(null);
  // Live lockdown flags (mig 136): the pre-launch banner renders ONLY when a
  // surface is actually closed, worded for whichever one is. Both false (the
  // launched hub) means no banner at all; null = not yet loaded (no banner).
  const [lockdown, setLockdown] = useState<{ signin: boolean; register: boolean } | null>(null);
  const PAGE_SIZE = 20;

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // Live entitlement plans (trial/solo/pro/firm) for the inline plan control.
  const [entPlans, setEntPlans] = useState<{ plan_key: string; label: string }[]>([]);
  useEffect(() => {
    fetch('/api/admin/entitlements?platform=real-estate')
      .then(r => r.json())
      .then(j => setEntPlans((j.plans ?? []).filter((p: { active: boolean }) => p.active).map((p: { plan_key: string; label: string }) => ({ plan_key: p.plan_key, label: p.label }))))
      .catch(() => setEntPlans([]));
  }, []);

  // Read the ACTUAL lockdown state so the banner cannot go stale again: the
  // same flags the sign-in / register pages enforce (mig 136).
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/modeling-signin-coming-soon').then(r => r.json()).catch(() => ({ enabled: false })),
      fetch('/api/admin/modeling-register-coming-soon').then(r => r.json()).catch(() => ({ enabled: false })),
    ]).then(([s, r]) => setLockdown({ signin: !!s.enabled, register: !!r.enabled }))
      .catch(() => setLockdown({ signin: false, register: false }));
  }, []);

  // Assign a plan via THE shared plan-setting endpoint (same path as /admin/access).
  async function assignPlan(userId: string, planKey: string) {
    setUpdating(userId + ':plan');
    try {
      const res = await fetch('/api/admin/entitlements/user/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, plan_key: planKey, platform: 'real-estate' }),
      });
      const j = await res.json();
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId
          ? { ...u, subscription_plan: planKey, subscription_status: (j.subscriptionStatus ?? u.subscription_status) as User['subscription_status'] }
          : u));
        showToast('Plan updated', 'success');
      } else {
        showToast(j.error ?? 'Plan update failed', 'error');
      }
    } catch {
      showToast('Plan update failed', 'error');
    } finally {
      setUpdating(null);
    }
  }

  const fetchUsers = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
    if (search)                 params.set('search', search);
    if (roleFilter !== 'all')   params.set('role', roleFilter);
    if (planFilter !== 'all')   params.set('plan', planFilter);
    if (cancelFilter !== 'all') params.set('cancel', cancelFilter);
    if (reFilter !== 'all')     params.set('real_estate', reFilter);
    if (sortByRe)               params.set('sort', 'real_estate');
    fetch(`/api/admin/users?${params}`)
      .then(r => r.json())
      .then(j => { setUsers(j.users ?? []); setTotal(j.total ?? 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, [page, search, roleFilter, planFilter, cancelFilter, reFilter, sortByRe]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function patchUser(userId: string, patch: { role?: string; plan?: string; status?: string }) {
    setUpdating(userId + ':' + Object.keys(patch)[0]);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, reason: '', ...patch }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => {
          if (u.id !== userId) return u;
          const next = { ...u };
          if (patch.role)   next.role = patch.role;
          if (patch.plan)   next.subscription_plan   = patch.plan as User['subscription_plan'];
          if (patch.status) next.subscription_status = patch.status as User['subscription_status'];
          return next;
        }));
        showToast('Saved', 'success');
      } else {
        showToast('Update failed', 'error');
      }
    } catch {
      showToast('Update failed', 'error');
    } finally {
      setUpdating(null);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const selfId = (session?.user as { id?: string } | undefined)?.id;

  const selectStyle: React.CSSProperties = {
    padding: '4px 8px',
    border: '1px solid #D1D5DB',
    borderRadius: 5,
    fontSize: 12,
    background: '#fff',
    cursor: 'pointer',
  };

  if (authLoading) return null;

  // ACCESS is the date-driven state (grace / lapsed / canceling), which the
  // stored STATUS dropdown cannot express: it diverges when a plan's expiry
  // date has passed while the stored status still reads active (the gate
  // enforces by date; the stored value only moves via cron or an admin), and
  // during the one-month read-only grace window. On every other row it merely
  // mirrors STATUS, so the whole column renders ONLY when at least one row on
  // the page genuinely diverges.
  const accessDiverges = (u: User) =>
    (u.lapseState === 'grace' || u.lapseState === 'lapsed') || !!u.cancelState;
  const showAccessCol = users.some(accessDiverges);
  const colCount = showAccessCol ? 11 : 10;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/users" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>User Management</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>{total} total users</p>

        {/* Modeling Hub lockdown banner (migration 136): shown ONLY while a
            surface is actually closed, and worded for whichever one is. The
            previous banner was static and claimed pre-launch lockdown forever;
            with the hub live it was simply false, so it now reads the same
            flags the sign-in / register pages enforce. */}
        {lockdown && (lockdown.signin || lockdown.register) && (
          <div data-testid="lockdown-banner" style={{
            background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10,
            padding: '14px 18px', marginBottom: 24,
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 20 }}>🔒</span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', marginBottom: 2 }}>
                Modeling Hub {lockdown.signin && lockdown.register ? 'registration and sign-in are' : lockdown.register ? 'registration is' : 'sign-in is'} closed
              </div>
              <div style={{ fontSize: 12, color: '#1B4F8A' }}>
                Only admins and whitelisted emails can {lockdown.signin && lockdown.register ? 'register or sign in' : lockdown.register ? 'register' : 'sign in'} right now. Adding a user here does NOT grant Modeling Hub access - use the Access Whitelist.
              </div>
            </div>
            <Link
              href="/admin/modeling-access"
              style={{
                fontSize: 12, fontWeight: 700, padding: '8px 16px',
                borderRadius: 7, border: '1px solid #1B4F8A',
                background: '#fff', color: '#1B4F8A', textDecoration: 'none',
              }}
            >
              Manage Whitelist →
            </Link>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <input
            placeholder="Search by email or name…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, width: 280, background: '#fff' }}
          />
          <select value={planFilter} onChange={e => { setPlanFilter(e.target.value); setPage(0); }}
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="all">All Plans</option>
            <option value="none">No access</option>
            {entPlans.map(p => <option key={p.plan_key} value={p.plan_key}>{p.label}</option>)}
          </select>
          <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(0); }}
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="all">All Roles</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          {/* Cancellation filter (retention outreach): find users who are canceling
              or have canceled, read from the durable scheduled_cancel_at marker. */}
          <select value={cancelFilter} onChange={e => { setCancelFilter(e.target.value); setPage(0); }}
            data-testid="cancel-filter"
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="all">All subscriptions</option>
            <option value="canceling">Canceling (access not ended)</option>
            <option value="canceled">Canceled</option>
          </select>
          {/* Qualification filter + sort. 'Not asked' is offered deliberately:
              the users who registered before the question existed are a real
              cohort to chase, not a gap to hide. */}
          <select value={reFilter} onChange={e => { setReFilter(e.target.value); setPage(0); }}
            data-testid="real-estate-filter"
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="all">All industries</option>
            <option value="yes">In real estate</option>
            <option value="no">Not in real estate</option>
            <option value="unknown">Not asked</option>
          </select>
          <button type="button" onClick={() => { setSortByRe(v => !v); setPage(0); }}
            data-testid="real-estate-sort"
            aria-pressed={sortByRe}
            style={{
              padding: '8px 14px', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 700,
              border: sortByRe ? '1px solid #1B4F8A' : '1px solid #D1D5DB',
              background: sortByRe ? '#1B4F8A' : '#fff',
              color: sortByRe ? '#fff' : '#374151',
            }}>
            Sort by real estate
          </button>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1B4F8A' }}>
                {['Email', 'Name', 'Role', 'Real estate', 'Plan', 'Status', ...(showAccessCol ? ['Access'] : []), 'Expires', 'Projects', 'Joined', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={colCount} style={{ padding: '40px 16px', textAlign: 'center', color: '#6B7280' }}>Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={colCount} style={{ padding: '40px 16px', textAlign: 'center', color: '#6B7280' }}>No users found.</td></tr>
              ) : users.map((u, i) => {
                const isSelf      = u.id === selfId;
                const savingField = updating?.startsWith(u.id) ? updating.split(':')[1] : null;

                return (
                  <tr key={u.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>

                    {/* Email */}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{u.email}</td>

                    {/* Name */}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{u.name ?? '-'}</td>

                    {/* Role dropdown */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          value={u.role ?? 'user'}
                          disabled={isSelf || savingField === 'role'}
                          onChange={e => patchUser(u.id, { role: e.target.value })}
                          style={{ ...selectStyle, cursor: isSelf ? 'not-allowed' : 'pointer' }}
                          title={isSelf ? 'Cannot change your own role' : undefined}
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                        {savingField === 'role' && <span style={{ fontSize: 11, color: '#6B7280' }}>Saving…</span>}
                      </div>
                    </td>

                    {/* Signup qualification. THREE states shown as three
                        different things: yes, no, and a dash for a user who
                        registered before the question existed. A blank for the
                        third would read as "no", which is an answer they never
                        gave. The note is the cell's tooltip, so the detail is
                        one hover away without widening the table. */}
                    <td style={{ padding: '12px 16px' }} data-testid={'user-real-estate-' + u.id}>
                      {u.works_in_real_estate === true ? (
                        <span title={u.real_estate_role_note ?? undefined} style={{ fontSize: 11, fontWeight: 800, color: '#166534', background: '#DCFCE7', padding: '3px 8px', borderRadius: 999 }}>Yes</span>
                      ) : u.works_in_real_estate === false ? (
                        <span title={u.real_estate_role_note ?? undefined} style={{ fontSize: 11, fontWeight: 800, color: '#92400e', background: '#FEF3C7', padding: '3px 8px', borderRadius: 999 }}>No</span>
                      ) : (
                        <span
                          title="Never asked: this user registered before the real estate question existed"
                          style={{ fontSize: 12, color: '#9CA3AF', cursor: 'help', borderBottom: '1px dotted #9CA3AF', paddingBottom: 1 }}
                        >-</span>
                      )}
                    </td>

                    {/* Plan: read-only resolved plan + link to the single write path
                        (/admin/access). The plan dropdown here used to write legacy
                        names (free/professional/enterprise) to subscription_plan,
                        creating a second write path; that is removed. */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-testid={`user-plan-${u.id}`}>
                        <select
                          value={u.subscription_plan ?? ''}
                          disabled={savingField === 'plan'}
                          onChange={e => assignPlan(u.id, e.target.value)}
                          data-testid={`user-plan-select-${u.id}`}
                          style={selectStyle}
                        >
                          {/* No-access state (foundation). Selecting it writes the
                              'none' value the gate treats as zero access, via the
                              SAME shared plan path (setUserPlan) as the real plans. */}
                          <option value="none">No access</option>
                          {/* A legacy / unassigned current value (e.g. an old "free")
                              shows as a disabled placeholder so the true value is
                              visible without offering it for re-selection. 'none' is
                              a real selectable option above, so it is excluded here. */}
                          {(u.subscription_plan ?? '') !== 'none' && !entPlans.some(p => p.plan_key === (u.subscription_plan ?? '')) && (
                            <option value={u.subscription_plan ?? ''} disabled>{u.subscription_plan ?? 'unassigned'}</option>
                          )}
                          {entPlans.map(p => <option key={p.plan_key} value={p.plan_key}>{p.label}</option>)}
                        </select>
                        {savingField === 'plan' && <span style={{ fontSize: 11, color: '#6B7280' }}>Saving…</span>}
                        <Link href={`/admin/users/${u.id}`} title="Manage plan, entitlements and per-user overrides"
                          style={{ fontSize: 11, fontWeight: 600, color: '#1B4F8A', textDecoration: 'none', padding: '2px 7px', border: '1px solid #BDD0F0', borderRadius: 4, background: '#E8F0FB', whiteSpace: 'nowrap' }}>
                          Manage access →
                        </Link>
                      </div>
                    </td>

                    {/* Status dropdown */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          value={u.subscription_status ?? 'active'}
                          disabled={savingField === 'status'}
                          onChange={e => patchUser(u.id, { status: e.target.value })}
                          style={selectStyle}
                        >
                          <option value="active">active</option>
                          <option value="trial">trial</option>
                          <option value="expired">expired</option>
                          <option value="cancelled">cancelled</option>
                        </select>
                        {savingField === 'status' && <span style={{ fontSize: 11, color: '#6B7280' }}>Saving…</span>}
                      </div>
                    </td>

                    {/* Access: rendered only when at least one row on the page
                        diverges from STATUS (see accessDiverges above). A row
                        that does not diverge shows a dash; a diverging row shows
                        the date-driven state (grace / lapsed) and/or the durable
                        Canceling / Canceled marker, which STATUS cannot express. */}
                    {showAccessCol && (
                      <td style={{ padding: '12px 16px' }} data-testid={`user-access-${u.id}`}>
                        {accessDiverges(u) ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            {(u.lapseState === 'grace' || u.lapseState === 'lapsed') && (
                              <AccessStatusBadge status={u.accessStatus ?? 'active'} />
                            )}
                            {u.cancelState && <span data-testid={`user-cancel-${u.id}`}><CancelBadge state={u.cancelState} /></span>}
                          </div>
                        ) : (
                          <span title="Access matches the stored status" style={{ fontSize: 12, color: '#9CA3AF' }}>-</span>
                        )}
                      </td>
                    )}

                    {/* Expires: the cancel-ends date when canceling/canceled, else the
                        plan's access-expiry anchor (blank when it does not expire). */}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap' }} data-testid={`user-expiry-${u.id}`}>
                      {u.cancelAt
                        ? new Date(u.cancelAt).toLocaleDateString()
                        : (u.accessExpiresAt ? new Date(u.accessExpiresAt).toLocaleDateString() : 'n/a')}
                    </td>

                    {/* Projects */}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151', textAlign: 'center' }}>
                      {u.projects?.[0]?.count ?? 0}
                    </td>

                    {/* Joined */}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280' }}>
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {/* Read-only list of this user's projects (name, dates,
                            version count). Used to link /admin/projects?userId=...,
                            which ignored the param and queried the empty legacy
                            projects table, so it always showed nothing. */}
                        <button
                          data-testid={`user-projects-${u.id}`}
                          onClick={() => setProjectsTarget({ id: u.id, email: u.email })}
                          style={{ fontSize: 11, fontWeight: 600, color: '#1B4F8A', padding: '3px 8px', border: '1px solid #BDD0F0', borderRadius: 4, background: '#E8F0FB', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Projects
                        </button>
                        {/* Delete: not for yourself, not for admin accounts
                            (the endpoint refuses both; the button just does not
                            offer a dead end). */}
                        {!isSelf && u.role !== 'admin' && (
                          <button
                            data-testid={`delete-user-${u.id}`}
                            onClick={() => setDeleteTarget(u.id)}
                            title="Delete this user"
                            style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', padding: '3px 8px', border: '1px solid #FECACA', borderRadius: 4, background: '#FFF5F5', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Delete
                          </button>
                        )}
                        {isSelf && <span style={{ fontSize: 11, color: '#9CA3AF' }}>You</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
              ← Prev
            </button>
            <span style={{ padding: '7px 16px', fontSize: 13, color: '#6B7280' }}>Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
              Next →
            </button>
          </div>
        )}
      </main>

      {/* Read-only projects list for one user. */}
      {projectsTarget && (
        <UserProjectsModal
          userId={projectsTarget.id}
          email={projectsTarget.email}
          onClose={() => setProjectsTarget(null)}
        />
      )}

      {/* Delete confirmation: the shared modal (same one the detail panel uses). */}
      {deleteTarget && (
        <DeleteUserModal
          userId={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(email) => {
            setDeleteTarget(null);
            showToast(`${email} deleted`, 'success');
            fetchUsers();
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.type === 'success' ? '#1A7A30' : '#DC2626',
          color: '#fff', fontWeight: 700, fontSize: 13,
          padding: '12px 24px', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999,
        }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
