'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useSession } from 'next-auth/react';
import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  subscription_plan: 'free' | 'professional' | 'enterprise';
  subscription_status: 'active' | 'trial' | 'expired' | 'cancelled';
  created_at: string;
  projects?: [{ count: number }];
}

const PLAN_COLORS: Record<string, string> = {
  free:         '#6B7280',
  professional: '#2563EB',
  enterprise:   '#7C3AED',
};

const STATUS_COLORS: Record<string, string> = {
  active:    '#1A7A30',
  trial:     '#D97706',
  expired:   '#DC2626',
  cancelled: '#DC2626',
};

function PlanBadge({ plan }: { plan: string }) {
  const color = PLAN_COLORS[plan] ?? '#6B7280';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 9px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      color: '#fff',
      background: color,
      letterSpacing: '0.03em',
      textTransform: 'capitalize',
    }}>
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#6B7280';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 9px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      color: '#fff',
      background: color,
      letterSpacing: '0.03em',
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

interface PlanOption { code: string; name: string; is_custom_client: boolean; }

export default function AdminUsersPage() {
  const { loading: authLoading } = useRequireAdmin();
  const { data: session } = useSession();
  const [users, setUsers]                   = useState<User[]>([]);
  const [loading, setLoading]               = useState(true);
  const [availablePlans, setAvailablePlans] = useState<PlanOption[]>([]);
  const [search, setSearch]                 = useState('');
  const [planFilter, setPlanFilter]         = useState('all');
  const [roleFilter, setRoleFilter]         = useState('all');
  const [page, setPage]             = useState(0);
  const [total, setTotal]           = useState(0);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [toast, setToast]           = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const PAGE_SIZE = 20;

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    fetch('/api/admin/pricing/plans?all=true')
      .then(r => r.json())
      .then(j => setAvailablePlans((j.plans ?? []).map((p: { code: string; name: string; is_custom_client: boolean }) => ({ code: p.code, name: p.name, is_custom_client: p.is_custom_client }))))
      .catch(() => setAvailablePlans([
        { code: 'free', name: 'Free', is_custom_client: false },
        { code: 'professional', name: 'Professional', is_custom_client: false },
        { code: 'enterprise', name: 'Enterprise', is_custom_client: false },
      ]));
  }, []);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
    if (search)                params.set('search', search);
    if (roleFilter !== 'all')  params.set('role', roleFilter);
    if (planFilter !== 'all')  params.set('plan', planFilter);
    fetch(`/api/admin/users?${params}`)
      .then(r => r.json())
      .then(j => { setUsers(j.users ?? []); setTotal(j.total ?? 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, [page, search, roleFilter, planFilter]);

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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/users" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>User Management</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>{total} total users</p>

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
            {availablePlans.map(p => <option key={p.code} value={p.code}>{p.name}{p.is_custom_client ? ' (Client)' : ''}</option>)}
          </select>
          <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(0); }}
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="all">All Roles</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1B4F8A' }}>
                {['Email', 'Name', 'Role', 'Plan', 'Status', 'Projects', 'Joined', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: '#6B7280' }}>Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: '#6B7280' }}>No users found.</td></tr>
              ) : users.map((u, i) => {
                const isSelf      = u.id === selfId;
                const savingField = updating?.startsWith(u.id) ? updating.split(':')[1] : null;

                return (
                  <tr key={u.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>

                    {/* Email */}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{u.email}</td>

                    {/* Name */}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{u.name ?? '—'}</td>

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

                    {/* Plan dropdown + badge */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          value={u.subscription_plan ?? 'free'}
                          disabled={savingField === 'plan'}
                          onChange={e => patchUser(u.id, { plan: e.target.value })}
                          style={selectStyle}
                        >
                          {availablePlans.length > 0
                            ? availablePlans.map(p => <option key={p.code} value={p.code}>{p.name}{p.is_custom_client ? ' ●' : ''}</option>)
                            : ['free','professional','enterprise'].map(c => <option key={c} value={c}>{c}</option>)
                          }
                        </select>
                        <PlanBadge plan={u.subscription_plan ?? 'free'} />
                        {savingField === 'plan' && <span style={{ fontSize: 11, color: '#6B7280' }}>Saving…</span>}
                      </div>
                    </td>

                    {/* Status dropdown + badge */}
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
                        <StatusBadge status={u.subscription_status ?? 'active'} />
                        {savingField === 'status' && <span style={{ fontSize: 11, color: '#6B7280' }}>Saving…</span>}
                      </div>
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
                        <Link
                          href={`/admin/projects?userId=${u.id}`}
                          style={{ fontSize: 11, fontWeight: 600, color: '#1B4F8A', textDecoration: 'none', padding: '3px 8px', border: '1px solid #BDD0F0', borderRadius: 4, background: '#E8F0FB' }}
                        >
                          Projects
                        </Link>
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
