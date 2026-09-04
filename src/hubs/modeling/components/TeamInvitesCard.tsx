'use client';

/**
 * TeamInvitesCard.tsx
 *
 * THE CLIENT'S OWN TEAM SURFACE, account model steps 5 + 6: invite a
 * colleague by email, see open invites, revoke one, and ASSIGN team members
 * to the holder's own projects with a role. Renders on the main dashboard
 * view and decides NOTHING itself: GET /api/account/invites says whether the
 * caller may see the card at all, and GET /api/account/team supplies the
 * holder's projects, people and memberships (a member, or an account with
 * nobody else on it, gets no assignment section). A member, a one-seat
 * holder with nobody else, or an error all render as nothing at all.
 *
 * The seat is reserved when the invite is CREATED (src/shared/account/
 * invites.ts); assignment is seat-free by construction, since the person
 * picker can only name people already on the account (src/shared/account/
 * team.ts). The UI is a courtesy; the engine refusals are the boundary.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PROJECT_ROLE_META, PROJECT_ROLES, type ProjectRole } from '@/src/core/collab/projectRoles';

interface OpenInvite { id: string; email: string; expires_at: string; expired: boolean }
interface TeamState {
  eligible: boolean;
  accountName?: string;
  seats?: { used: number; reserved: number; limit: number | null };
  invites?: OpenInvite[];
}
interface TeamProject { id: string; name: string; archived: boolean }
interface TeamPerson { id: string; name: string | null; email: string }
interface TeamMembership { projectId: string; userId: string; role: string }
interface TeamAccess {
  eligible: boolean;
  projects?: TeamProject[];
  people?: TeamPerson[];
  memberships?: TeamMembership[];
}

export default function TeamInvitesCard({ theme }: {
  theme: { surface: string; border: string; body: string; heading: string; muted: string; bg: string };
}): React.JSX.Element | null {
  const [state, setState] = useState<TeamState | null>(null);
  const [team, setTeam] = useState<TeamAccess | null>(null);
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ri, rt] = await Promise.all([
        fetch('/api/account/invites', { credentials: 'include' }),
        fetch('/api/account/team?platform=refm', { credentials: 'include' }),
      ]);
      setState(ri.ok ? (await ri.json() as TeamState) : { eligible: false });
      setTeam(rt.ok ? (await rt.json() as TeamAccess) : { eligible: false });
    } catch { setState({ eligible: false }); setTeam({ eligible: false }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!state?.eligible) return null;
  const seats = state.seats ?? { used: 0, reserved: 0, limit: null };
  const invites = state.invites ?? [];
  const limitLabel = seats.limit === -1 ? 'unlimited' : String(seats.limit ?? 0);

  async function invite(): Promise<void> {
    if (!email.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/account/invites', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not send the invite.'); return; }
      setMsg(`Invite sent to ${j.email}.`);
      setEmail('');
      await load();
    } catch { setErr('Could not send the invite.'); } finally { setBusy(false); }
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/account/invites?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include',
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not revoke.'); return; }
      setMsg('Invite revoked; the seat is free again.');
      await load();
    } catch { setErr('Could not revoke.'); } finally { setBusy(false); }
  }

  async function giveAccess(): Promise<void> {
    if (!projectId || !personId) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/account/team', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'refm', projectId, userId: personId, role }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not give access.'); return; }
      setMsg('Access updated.');
      setPersonId('');
      await load();
    } catch { setErr('Could not give access.'); } finally { setBusy(false); }
  }

  async function removeAccess(targetUserId: string): Promise<void> {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(
        `/api/account/team?platform=refm&projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(targetUserId)}`,
        { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not remove access.'); return; }
      setMsg('Access removed.');
      await load();
    } catch { setErr('Could not remove access.'); } finally { setBusy(false); }
  }

  return (
    <div
      data-testid="team-invites-card"
      style={{ marginBottom: 28, padding: '18px 20px', borderRadius: 12, background: theme.surface, border: `1px solid ${theme.border}` }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: theme.heading, margin: 0 }}>Your team</h2>
        <span data-testid="team-invites-seats" style={{ fontSize: 12.5, color: theme.muted }}>
          {seats.used} of {limitLabel} seat{seats.limit === 1 ? '' : 's'} in use
          {seats.reserved > 0 ? `, ${seats.reserved} reserved by open invite${seats.reserved === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: theme.muted, margin: '0 0 12px' }}>
        Invite a colleague by email. They sign up through the invite and join your account; your
        subscription covers them. Once they join, give them access to your projects below.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: invites.length ? 14 : 0 }}>
        <input
          type="email" value={email} placeholder="colleague@company.com"
          onChange={(e) => setEmail(e.target.value)}
          data-testid="team-invites-email"
          style={{
            flex: 1, minWidth: 220, padding: '8px 10px', borderRadius: 8,
            border: `1px solid ${theme.border}`, background: theme.bg, color: theme.body, fontSize: 13,
          }}
        />
        <button
          type="button" onClick={() => void invite()} disabled={busy || !email.trim()}
          data-testid="team-invites-send"
          style={{
            padding: '9px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
            background: busy || !email.trim() ? theme.border : 'var(--color-navy, #0f2744)',
            color: '#fff', cursor: busy || !email.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Send invite
        </button>
      </div>

      {err && <div data-testid="team-invites-error" style={{ color: 'var(--color-negative, #dc2626)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      {msg && <div data-testid="team-invites-msg" style={{ color: 'var(--color-green-dark, #15803d)', fontSize: 12.5, marginTop: 8 }}>{msg}</div>}

      {invites.length > 0 && (
        <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 6 }}>
          {invites.map((inv) => (
            <div key={inv.id} data-testid={`team-invite-row-${inv.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: theme.body, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {inv.email}
              </span>
              <span style={{ fontSize: 11.5, color: inv.expired ? 'var(--color-negative, #dc2626)' : theme.muted }}>
                {inv.expired ? 'expired' : `expires ${new Date(inv.expires_at).toLocaleDateString()}`}
              </span>
              <button
                type="button" onClick={() => void revoke(inv.id)} disabled={busy}
                data-testid={`team-invite-revoke-${inv.id}`}
                style={{ border: 'none', background: 'transparent', color: 'var(--color-negative, #dc2626)', fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
              >
                {inv.expired ? 'Remove' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Project access (step 6): appears once the account has PEOPLE. The
          person list is the account's members only; the server refuses
          anyone else, this section just never offers them. */}
      {team?.eligible && (
        <div data-testid="team-access-section" style={{ borderTop: `1px solid ${theme.border}`, marginTop: 14, paddingTop: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: theme.heading, marginBottom: 8 }}>Project access</div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0,2fr) minmax(0,2fr) minmax(0,1fr) auto', alignItems: 'end', marginBottom: 8 }}>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="team-assign-project"
              style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.body, fontSize: 13, minWidth: 0 }}>
              <option value="">Select a project</option>
              {(team.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>
              ))}
            </select>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} disabled={!projectId} data-testid="team-assign-person"
              style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.body, fontSize: 13, minWidth: 0 }}>
              <option value="">{projectId ? 'Select a person' : 'Select a project first'}</option>
              {(team.people ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
              ))}
            </select>
            <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} data-testid="team-assign-role"
              style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.body, fontSize: 13, minWidth: 0 }}>
              {PROJECT_ROLES.filter((r) => r !== 'owner').map((r) => (
                <option key={r} value={r} title={PROJECT_ROLE_META[r].desc}>{PROJECT_ROLE_META[r].label}</option>
              ))}
            </select>
            <button
              type="button" onClick={() => void giveAccess()} disabled={busy || !projectId || !personId}
              data-testid="team-assign-grant"
              style={{
                padding: '9px 14px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
                background: busy || !projectId || !personId ? theme.border : 'var(--color-navy, #0f2744)',
                color: '#fff', cursor: busy || !projectId || !personId ? 'not-allowed' : 'pointer',
              }}
            >
              Give access
            </button>
          </div>

          {projectId && (
            <div>
              {(team.memberships ?? []).filter((m) => m.projectId === projectId).length === 0 && (
                <div style={{ fontSize: 12.5, color: theme.muted, padding: '6px 0' }}>Nobody else has access to this project yet.</div>
              )}
              {(team.memberships ?? []).filter((m) => m.projectId === projectId).map((m) => {
                const person = (team.people ?? []).find((u) => u.id === m.userId);
                const isOwnerRow = m.role === 'owner';
                return (
                  <div key={m.userId} data-testid={`team-assign-row-${m.userId}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: `1px solid ${theme.border}` }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: theme.body, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {isOwnerRow ? 'You' : (person ? (person.name ?? person.email) : m.userId)}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {PROJECT_ROLE_META[m.role as ProjectRole]?.label ?? m.role}
                    </span>
                    {isOwnerRow ? (
                      <span style={{ fontSize: 11.5, color: theme.muted }}>owner</span>
                    ) : (
                      <button
                        type="button" onClick={() => void removeAccess(m.userId)} disabled={busy}
                        data-testid={`team-assign-remove-${m.userId}`}
                        style={{ border: 'none', background: 'transparent', color: 'var(--color-negative, #dc2626)', fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
