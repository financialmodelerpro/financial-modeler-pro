'use client';

/**
 * ProjectsBrowser - admin browser over the REAL per-platform project tables,
 * REBUILT 2026-08-30 (it used to query the empty legacy `projects` table, so
 * it always showed nothing). The platform list, badges and filter come from
 * the API's registry-driven `sources`, so a new platform (ERM, BVM) appears
 * here with zero component changes, side by side or filtered.
 *
 * Actions: Archive / Unarchive (reversible, the platform's own archived flag),
 * and a hard Delete behind a modal that names the project, its owner and its
 * version count, states what the cascade destroys, and arms only when the
 * project's NAME is typed back (the server independently demands the same).
 *
 * No em dashes in this file.
 */
import React, { useCallback, useEffect, useState } from 'react';

interface ProjectRow {
  platform: string;
  platformLabel: string;
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  userId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  versionCount: number;
  /** Soft-delete stamp (mig 224); null when live. */
  deletedAt: string | null;
  /** Days before the purge hard deletes it; null when live. */
  daysLeft: number | null;
}

interface SourceInfo { key: string; label: string; shortLabel: string; supportsArchive: boolean; supportsRestore: boolean; }

export default function ProjectsBrowser() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sources,  setSources]  = useState<SourceInfo[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  // 'all' means every LIVE project. A soft-deleted project sits in its own
  // 'deleted' bin and never appears in the other three views.
  const [filter,   setFilter]   = useState<'all' | 'active' | 'archived' | 'deleted'>('active');
  const [retentionDays, setRetentionDays] = useState(30);
  const [platform, setPlatform] = useState<string>('all');
  const [toast,    setToast]    = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const [confirmName, setConfirmName]   = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/projects');
    if (res.ok) {
      const j = await res.json();
      setProjects(j.projects ?? []);
      setSources(j.sources ?? []);
      if (typeof j.retentionDays === 'number') setRetentionDays(j.retentionDays);
      if ((j.sourceErrors ?? []).length) showToast('Some platforms could not be read: ' + j.sourceErrors.join('; '));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setArchived = async (p: ProjectRow, archive: boolean) => {
    const res = await fetch('/api/admin/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: archive ? 'archive' : 'unarchive', platform: p.platform, id: p.id }),
    });
    if (!res.ok) { showToast('Failed: ' + ((await res.json()).error ?? 'error')); return; }
    setProjects((rows) => rows.map((r) => (r.id === p.id && r.platform === p.platform ? { ...r, archived: archive } : r)));
    showToast(archive ? 'Project archived' : 'Project restored to active');
  };

  // Restore a soft-deleted project to its owner. The project returns in
  // whatever archived state it had; if it was active it can put the owner at
  // cap + 1, which is deliberate (see restoreDeletedProject) and stated below.
  const restore = async (p: ProjectRow) => {
    const res = await fetch('/api/admin/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', platform: p.platform, id: p.id }),
    });
    if (!res.ok) { showToast('Restore failed: ' + ((await res.json()).error ?? 'error')); return; }
    setProjects((rows) => rows.map((r) => (r.id === p.id && r.platform === p.platform ? { ...r, deletedAt: null, daysLeft: null } : r)));
    showToast('Project restored to its owner');
  };

  const performDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/projects', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: deleteTarget.platform, id: deleteTarget.id, confirmName }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? 'Deletion failed'); return; }
      setProjects((rows) => rows.filter((r) => !(r.id === deleteTarget.id && r.platform === deleteTarget.platform)));
      setDeleteTarget(null);
      setConfirmName('');
      showToast('Project permanently deleted');
    } catch {
      setError('Deletion failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = projects.filter((p) => {
    if (platform !== 'all' && p.platform !== platform) return false;
    const isDeleted = !!p.deletedAt;
    if (filter === 'deleted') { if (!isDeleted) return false; }
    else if (isDeleted) return false;
    if (filter === 'active'   && p.archived)  return false;
    if (filter === 'archived' && !p.archived) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q)
      || (p.ownerEmail ?? '').toLowerCase().includes(q)
      || (p.ownerName  ?? '').toLowerCase().includes(q);
  });

  const inPlatform = projects.filter((p) => platform === 'all' || p.platform === platform);
  const live = inPlatform.filter((p) => !p.deletedAt);
  const counts = {
    all:      live.length,
    active:   live.filter((p) => !p.archived).length,
    archived: live.filter((p) =>  p.archived).length,
    deleted:  inPlatform.filter((p) => !!p.deletedAt).length,
  };

  const armed = !!deleteTarget && confirmName === deleteTarget.name;

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
        {/* Platform filter, registry-driven: shows only when there is more than
            one platform to choose between. */}
        {sources.length > 1 && (
          <select
            data-testid="projects-platform-filter"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', fontFamily: 'Inter,sans-serif', cursor: 'pointer' }}
          >
            <option value="all">All platforms</option>
            {sources.map((s) => <option key={s.key} value={s.key}>{s.shortLabel}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['active', 'archived', 'all', 'deleted'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20,
              border: '1px solid var(--color-border)', cursor: 'pointer', fontFamily: 'Inter,sans-serif',
              background: filter === f ? 'var(--color-primary)' : 'var(--color-grey-white)',
              color:      filter === f ? 'var(--color-grey-white)' : 'var(--color-meta)',
            }}>
              {f === 'deleted' ? 'Deleted' : f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
            </button>
          ))}
        </div>
        <button onClick={load} style={{ marginLeft: 'auto', padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
          ↻ Refresh
        </button>
      </div>

      {filter === 'deleted' && (
        <div data-testid="projects-deleted-note" style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: '#FDF6E3', border: '1px solid #C9A84C', fontSize: 12.5, color: '#0D2E5A', lineHeight: 1.6 }}>
          Projects the owner deleted. They are hidden from the owner and do not count against their project limit, but every version still exists: Restore hands one back. After {retentionDays} days the daily purge deletes them permanently, with all their versions. A restored project returns in the state it had, which can briefly put the owner one over their plan limit.
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-meta)' }}>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table-standard" data-testid="projects-browser-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Project</th>
                <th style={{ textAlign: 'left' }}>Owner</th>
                <th>Platform</th>
                <th>Versions</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={`${p.platform}:${p.id}`}>
                  <td style={{ textAlign: 'left', fontWeight: 600, color: 'var(--color-heading)', fontSize: 13 }}>
                    {p.name}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-heading)' }}>{p.ownerName ?? '-'}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>{p.ownerEmail ?? p.userId}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--color-navy-pale)', color: 'var(--color-navy)', fontWeight: 700 }}>
                      {p.platformLabel}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-heading)' }}>{p.versionCount}</td>
                  <td>
                    {p.deletedAt ? (
                      <span
                        data-testid={`deleted-badge-${p.id}`}
                        title={`Deleted ${new Date(p.deletedAt).toLocaleDateString()}. Hard deleted with all its versions when the window runs out.`}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 700, background: '#fee2e2', color: 'var(--color-negative)', whiteSpace: 'nowrap' }}
                      >
                        Deleted · {p.daysLeft === 0 ? 'purges today' : `${p.daysLeft}d left`}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                        background: p.archived ? '#fffbeb' : 'var(--color-green-light)',
                        color:      p.archived ? '#92400e' : 'var(--color-green-dark)',
                      }}>
                        {p.archived ? 'Archived' : 'Active'}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--color-meta)', whiteSpace: 'nowrap' }}>
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--color-meta)', whiteSpace: 'nowrap' }}>
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      {p.deletedAt ? (
                        <button
                          onClick={() => restore(p)}
                          data-testid={`restore-${p.id}`}
                          title="Clear the deletion and hand this project back to its owner"
                          style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: '1px solid var(--color-green-dark)', background: 'var(--color-green-light)', color: 'var(--color-green-dark)', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700 }}
                        >
                          Restore
                        </button>
                      ) : (
                      <>
                      {sources.find((s) => s.key === p.platform)?.supportsArchive !== false && (
                        p.archived ? (
                          <button onClick={() => setArchived(p, false)} data-testid={`unarchive-${p.id}`} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-grey-white)', color: 'var(--color-heading)', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
                            Unarchive
                          </button>
                        ) : (
                          <button onClick={() => setArchived(p, true)} data-testid={`archive-${p.id}`} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: '1px solid #fbbf24', background: '#fffbeb', color: '#92400e', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
                            Archive
                          </button>
                        )
                      )}
                      <button onClick={() => { setDeleteTarget(p); setConfirmName(''); setError(null); }} data-testid={`delete-${p.id}`} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: '1px solid #fca5a5', background: '#fee2e2', color: 'var(--color-negative)', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
                        Delete…
                      </button>
                      </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--color-muted)' }}>No projects found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Hard-delete confirmation: names the project, its owner and what the
          cascade destroys; arms only when the project name is typed back. */}
      {deleteTarget && (
        <div
          data-testid="project-delete-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setDeleteTarget(null); }}
        >
          <div style={{ background: '#fff', borderRadius: 14, width: 'min(520px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px 26px' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#991B1B', marginBottom: 8 }}>Permanently delete project</div>
            <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 12px' }}>
              This deletes <strong>{deleteTarget.name}</strong> ({deleteTarget.platformLabel}), owned
              by <strong>{deleteTarget.ownerEmail ?? deleteTarget.userId}</strong>, with all{' '}
              <strong>{deleteTarget.versionCount}</strong> saved version{deleteTarget.versionCount === 1 ? '' : 's'} and
              their change history, report decks, fund terms and parties. It cannot be undone.
              If the goal is to get it out of the way, Archive is reversible.
            </p>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
              Type the project name to confirm
            </label>
            <input
              data-testid="project-delete-confirm-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={deleteTarget.name}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #FECACA', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: '#FFF5F5', marginBottom: 12 }}
            />
            {error && <div style={{ fontSize: 12.5, color: '#991B1B', fontWeight: 600, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} disabled={busy}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button
                data-testid="project-delete-confirm"
                onClick={performDelete}
                disabled={!armed || busy}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', background: armed ? '#DC2626' : '#9CA3AF', color: '#fff', cursor: armed && !busy ? 'pointer' : 'not-allowed' }}
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
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
