'use client';
import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useSession } from 'next-auth/react';

interface User { id: string; email: string; name: string | null; role: string; created_at: string }

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const PAGE_SIZE = 20;

  const fetchUsers = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (roleFilter !== 'all') params.set('role', roleFilter);
    fetch(`/api/admin/users?${params}`)
      .then(r => r.json())
      .then(j => { setUsers(j.users ?? []); setTotal(j.total ?? 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, [page, search, roleFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function changeRole(userId: string, newRole: string) {
    if (userId === (session?.user as any)?.id) return;
    setUpdating(userId);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, role: newRole }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
        setToast({ msg: 'Role updated', type: 'success' });
        setTimeout(() => setToast(null), 2500);
      }
    } catch { setToast({ msg: 'Update failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
    finally { setUpdating(null); }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/users" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>User Management</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>{total} total users</p>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <input
            placeholder="Search by email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            style={{ padding: '8px 14px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, width: 260, background: '#fff' }}
          />
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
                {['Email', 'Name', 'Role', 'Joined', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: '#6B7280' }}>Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: '#6B7280' }}>No users found.</td></tr>
              ) : users.map((u, i) => {
                const isSelf = u.id === (session?.user as any)?.id;
                return (
                  <tr key={u.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{u.email}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{u.name ?? '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <select
                        value={u.role ?? 'user'}
                        disabled={isSelf || updating === u.id}
                        onChange={e => changeRole(u.id, e.target.value)}
                        style={{ padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 12, background: '#fff', cursor: isSelf ? 'not-allowed' : 'pointer' }}
                        title={isSelf ? 'Cannot change your own role' : undefined}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {isSelf && <span style={{ fontSize: 11, color: '#9CA3AF' }}>You</span>}
                      {updating === u.id && <span style={{ fontSize: 11, color: '#6B7280' }}>Saving…</span>}
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
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 13 }}>← Prev</button>
            <span style={{ padding: '7px 16px', fontSize: 13, color: '#6B7280' }}>Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Next →</button>
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
