'use client';

/**
 * TeamAccessPanel.tsx
 *
 * ADMIN ASSIGNS PROJECTS TO PEOPLE, from the Modeling Hub dashboard, before
 * entering any platform. Module 10 Collaboration, step 2.
 *
 * It lives in `src/hubs/modeling/components/` and NOT inside the REFM platform
 * folder, deliberately. Collaboration is hub level: roles and assignments are
 * the same idea for ERM and BVM, and the panel reads the platform list from
 * `/api/admin/project-members`, which reads `PROJECT_SOURCES`. A new platform
 * appears here by declaring its membership columns in the registry, with no
 * change to this file.
 *
 * ── NON-OWNERS ARE READ-ONLY UNTIL THE EDIT LOCK SHIPS ────────────────────
 *
 * The panel says so, on screen, next to the role picker. Every role below Owner
 * currently grants READ access and nothing more, because there is no
 * server-side edit lock yet and two people autosaving one project would
 * overwrite each other silently. Showing four roles without saying that would
 * promise something the platform does not yet do. The note goes when step 5
 * lands.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PROJECT_ROLE_META, PROJECT_ROLES, type ProjectRole } from '@/src/core/collab/projectRoles';

interface MemberRow {
  projectId: string;
  projectName: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  role: string;
  addedAt: string | null;
  isOwner: boolean;
}

interface AdminProject { platform: string; id: string; name: string; ownerEmail: string | null }
interface AdminUser { id: string; name: string | null; email: string }

export default function TeamAccessPanel({ theme }: {
  theme: { surface: string; border: string; body: string; heading: string; muted: string; bg: string };
}): React.JSX.Element {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [projectId, setProjectId] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<ProjectRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Projects + users, once.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [pr, ur] = await Promise.all([
          fetch('/api/admin/projects?platform=refm', { credentials: 'include' }),
          fetch('/api/admin/users', { credentials: 'include' }),
        ]);
        if (!alive) return;
        if (pr.ok) {
          const j = await pr.json();
          setProjects((j.projects ?? []).map((p: Record<string, unknown>) => ({
            platform: String(p.platform ?? 'refm'), id: String(p.id),
            name: String(p.name ?? ''), ownerEmail: (p.ownerEmail as string) ?? null,
          })));
        }
        if (ur.ok) {
          const j = await ur.json();
          setUsers((j.users ?? []).map((u: Record<string, unknown>) => ({
            id: String(u.id), name: (u.name as string) ?? null, email: String(u.email ?? ''),
          })));
        }
      } catch { if (alive) setErr('Could not load projects and users.'); }
    })();
    return () => { alive = false; };
  }, []);

  const loadMembers = useCallback(async (pid: string) => {
    if (!pid) { setMembers([]); return; }
    setErr(null);
    try {
      const r = await fetch(`/api/admin/project-members?platform=refm&projectId=${encodeURIComponent(pid)}`,
        { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not load members.'); return; }
      setMembers(j.members ?? []);
    } catch { setErr('Could not load members.'); }
  }, []);

  useEffect(() => { void loadMembers(projectId); }, [projectId, loadMembers]);

  async function grant(): Promise<void> {
    if (!projectId || !addUserId) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/admin/project-members', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'refm', projectId, userId: addUserId, role: addRole }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not save.'); return; }
      setMsg('Access updated.');
      setAddUserId('');
      await loadMembers(projectId);
    } catch { setErr('Could not save.'); } finally { setBusy(false); }
  }

  async function revoke(userId: string): Promise<void> {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(
        `/api/admin/project-members?platform=refm&projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not remove.'); return; }
      setMsg('Access removed.');
      await loadMembers(projectId);
    } catch { setErr('Could not remove.'); } finally { setBusy(false); }
  }

  const label = (u: AdminUser): string => `${u.name ?? u.email}${u.name ? ` (${u.email})` : ''}`;
  const sel: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.border}`,
    background: theme.surface, color: theme.body, fontSize: 13, minWidth: 0,
  };

  return (
    <div data-testid="team-access-panel">
      <h2 style={{ fontSize: 20, fontWeight: 800, color: theme.heading, margin: '0 0 4px' }}>Team access</h2>
      <p style={{ color: theme.muted, fontSize: 13, margin: '0 0 16px' }}>
        Assign a project to a colleague. A person can only open a project that is assigned to them.
      </p>

      {/* The honest note. Four roles are offered and only one of them can
          currently write, so the screen says so rather than implying more. */}
      <div
        data-testid="team-access-readonly-note"
        style={{
          border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 12px',
          marginBottom: 16, fontSize: 12.5, color: theme.body, background: theme.bg,
        }}
      >
        <strong>Everyone except the Owner has read-only access for now.</strong>{' '}
        Editor, Reviewer and Viewer can all open the project and see the model; none of them can
        change or save it yet. Editing by more than one person needs the edit lock, which is the
        next piece of this feature. Assign roles now and they take effect when it lands.
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0,2fr) minmax(0,2fr) minmax(0,1fr) auto', alignItems: 'end', marginBottom: 18 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: theme.muted }}>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={sel} data-testid="team-access-project">
            <option value="">Select a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.ownerEmail ? ` - ${p.ownerEmail}` : ''}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: theme.muted }}>
          Person
          <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} style={sel} data-testid="team-access-user">
            <option value="">Select a person</option>
            {users.map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: theme.muted }}>
          Role
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as ProjectRole)} style={sel} data-testid="team-access-role">
            {PROJECT_ROLES.filter((r) => r !== 'owner').map((r) => (
              <option key={r} value={r} title={PROJECT_ROLE_META[r].desc}>{PROJECT_ROLE_META[r].label}</option>
            ))}
          </select>
        </label>
        <button
          type="button" onClick={() => void grant()} disabled={busy || !projectId || !addUserId}
          data-testid="team-access-grant"
          style={{
            padding: '9px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
            background: busy || !projectId || !addUserId ? theme.border : 'var(--color-navy, #0f2744)',
            color: '#fff', cursor: busy || !projectId || !addUserId ? 'not-allowed' : 'pointer',
          }}
        >
          Give access
        </button>
      </div>

      {err && <div data-testid="team-access-error" style={{ color: 'var(--color-negative, #dc2626)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {msg && <div data-testid="team-access-msg" style={{ color: 'var(--color-green-dark, #15803d)', fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      {projectId && (
        <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
          {members.length === 0 && (
            <div style={{ padding: 14, fontSize: 13, color: theme.muted }}>Nobody has access to this project yet.</div>
          )}
          {members.map((m) => (
            <div
              key={m.userId} data-testid={`team-access-row-${m.userId}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: `1px solid ${theme.border}` }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: theme.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.userName ?? m.userEmail ?? m.userId}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {PROJECT_ROLE_META[m.role as ProjectRole]?.label ?? m.role}
              </span>
              {m.isOwner ? (
                // Ownership comes from the project row, not from this table, so
                // it is shown and not editable here. Changing it would create a
                // second answer to "who owns this".
                <span title="Ownership comes from the project itself and cannot be changed here" style={{ fontSize: 11.5, color: theme.muted }}>
                  owner
                </span>
              ) : (
                <button
                  type="button" onClick={() => void revoke(m.userId)} disabled={busy}
                  data-testid={`team-access-revoke-${m.userId}`}
                  style={{ border: 'none', background: 'transparent', color: 'var(--color-negative, #dc2626)', fontSize: 12.5, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
