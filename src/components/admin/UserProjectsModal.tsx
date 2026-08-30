'use client';

/**
 * UserProjectsModal - READ-ONLY list of one user's REFM projects, opened from
 * the Projects button on the admin user list. Shows name, created date, last
 * modified, and version count. No open, no edit, no delete: an admin does not
 * touch a user's model from here, and the modal says so.
 *
 * No em dashes in this file.
 */
import { useState, useEffect } from 'react';

interface ProjectRow {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
}

export function UserProjectsModal({ userId, email, onClose }: {
  userId: string;
  email: string;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${userId}/projects`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (Array.isArray(j.projects)) setProjects(j.projects as ProjectRow[]);
        else setError(j.error ?? 'Could not load projects.');
      })
      .catch(() => { if (!cancelled) setError('Could not load projects.'); });
    return () => { cancelled = true; };
  }, [userId]);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div
      data-testid="user-projects-modal"
      style={{ position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: 'min(640px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B' }}>Projects</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 18, color: '#6B7280', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, color: '#6B7280', marginBottom: 14 }}>
          {email} · read-only: models are not opened or edited from here.
        </div>

        {error && <div style={{ fontSize: 13, color: '#991B1B', padding: '10px 0' }}>{error}</div>}
        {!projects && !error && <div style={{ fontSize: 13, color: '#6B7280', padding: '10px 0' }}>Loading…</div>}

        {projects && projects.length === 0 && (
          <div data-testid="user-projects-empty" style={{ fontSize: 13, color: '#6B7280', padding: '14px 0' }}>
            This user has no projects.
          </div>
        )}

        {projects && projects.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="user-projects-table">
            <thead>
              <tr style={{ background: '#1B4F8A' }}>
                {['Name', 'Created', 'Last modified', 'Versions'].map((h) => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Versions' ? 'right' : 'left', fontSize: 10.5, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={p.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    {p.name}
                    {p.archived && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#6B7280', background: '#F3F4F6', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Archived
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12.5, color: '#6B7280', whiteSpace: 'nowrap' }}>{fmt(p.createdAt)}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12.5, color: '#6B7280', whiteSpace: 'nowrap' }}>{fmt(p.updatedAt)}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151', textAlign: 'right' }}>{p.versionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
