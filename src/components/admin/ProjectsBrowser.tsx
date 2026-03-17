'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface ProjectRow {
  id: string;
  name: string;
  platform: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  users: { email: string; name: string | null } | null;
}

export default function ProjectsBrowser() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState<'all' | 'active' | 'archived'>('active');
  const [toast,    setToast]    = useState('');

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/projects');
    if (res.ok) setProjects((await res.json()).projects ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const archive = async (id: string) => {
    await fetch('/api/admin/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setProjects((p) => p.map((r) => r.id === id ? { ...r, is_archived: true } : r));
    showToast('Project archived');
  };

  const hardDelete = async (id: string) => {
    if (!confirm('Permanently delete this project? This cannot be undone.')) return;
    await fetch('/api/admin/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, hard: true }) });
    setProjects((p) => p.filter((r) => r.id !== id));
    showToast('Project deleted');
  };

  const filtered = projects.filter((p) => {
    if (filter === 'active'   && p.is_archived)  return false;
    if (filter === 'archived' && !p.is_archived) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q)
      || (p.users?.email ?? '').toLowerCase().includes(q)
      || (p.users?.name  ?? '').toLowerCase().includes(q);
  });

  const counts = {
    all:      projects.length,
    active:   projects.filter((p) => !p.is_archived).length,
    archived: projects.filter((p) =>  p.is_archived).length,
  };

  return (
    <div style={{ fontFamily: 'Inter,sans-serif' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search project or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '7px 12px', fontSize: 13, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', fontFamily: 'Inter,sans-serif', width: 240, outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {(['active', 'archived', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20,
              border: '1px solid var(--color-border)', cursor: 'pointer', fontFamily: 'Inter,sans-serif',
              background: filter === f ? 'var(--color-primary)' : 'var(--color-grey-white)',
              color:      filter === f ? 'var(--color-grey-white)' : 'var(--color-meta)',
            }}>
              {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
            </button>
          ))}
        </div>
        <button onClick={load} style={{ marginLeft: 'auto', padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-meta)' }}>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table-standard">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Project</th>
                <th style={{ textAlign: 'left' }}>Owner</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={{ textAlign: 'left', fontWeight: 600, color: 'var(--color-heading)', fontSize: 13 }}>
                    {p.name}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-heading)' }}>{p.users?.name ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>{p.users?.email ?? p.user_id}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--color-navy-pale)', color: 'var(--color-navy)', fontWeight: 700 }}>
                      {p.platform.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                      background: p.is_archived ? '#fee2e2' : 'var(--color-green-light)',
                      color:      p.is_archived ? 'var(--color-negative)' : 'var(--color-green-dark)',
                    }}>
                      {p.is_archived ? 'Archived' : 'Active'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--color-meta)', whiteSpace: 'nowrap' }}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--color-meta)', whiteSpace: 'nowrap' }}>
                    {new Date(p.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      {!p.is_archived && (
                        <button onClick={() => archive(p.id)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: '1px solid #fbbf24', background: '#fffbeb', color: '#92400e', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
                          Archive
                        </button>
                      )}
                      <button onClick={() => hardDelete(p.id)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: '1px solid #fca5a5', background: '#fee2e2', color: 'var(--color-negative)', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--color-muted)' }}>No projects found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 99999, background: 'var(--color-green-dark)', color: 'var(--color-grey-white)', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', fontFamily: 'Inter,sans-serif' }}>
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
