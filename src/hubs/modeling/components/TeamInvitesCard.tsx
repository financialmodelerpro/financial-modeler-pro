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
import { getPlatform, platformPricingSegment } from '@/src/hubs/modeling/config/platforms';

interface OpenInvite { id: string; email: string; expires_at: string; expired: boolean }
interface TeamState {
  eligible: boolean;
  /** Server-computed with the SAME seat arithmetic the create enforces: a
   *  Pro holder sees the tab but not the invite box. */
  canInvite?: boolean;
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
interface DeleteRequestRow {
  id: string;
  projectName: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  requesterStillMember: boolean;
  createdAt: string;
  projectDeletedAt: string | null;
}

export default function TeamInvitesCard({ theme }: {
  theme: { surface: string; border: string; body: string; heading: string; muted: string; bg: string };
}): React.JSX.Element | null {
  const [state, setState] = useState<TeamState | null>(null);
  const [team, setTeam] = useState<TeamAccess | null>(null);
  const [delReqs, setDelReqs] = useState<DeleteRequestRow[]>([]);
  /** Which request is mid-decision: armed approve, or an open decline box. */
  const [deciding, setDeciding] = useState<{ id: string; mode: 'approve' | 'decline'; reason: string } | null>(null);
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ri, rt, rd] = await Promise.all([
        fetch('/api/account/invites', { credentials: 'include' }),
        fetch('/api/account/team?platform=refm', { credentials: 'include' }),
        fetch('/api/account/delete-requests', { credentials: 'include' }),
      ]);
      setState(ri.ok ? (await ri.json() as TeamState) : { eligible: false });
      setTeam(rt.ok ? (await rt.json() as TeamAccess) : { eligible: false });
      if (rd.ok) {
        const j = await rd.json() as { rows?: DeleteRequestRow[] };
        setDelReqs(j.rows ?? []);
      } else setDelReqs([]);
    } catch { setState({ eligible: false }); setTeam({ eligible: false }); setDelReqs([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A pending delete request must reach the holder even when the invites
  // half says there is nothing to show (e.g. every member was removed from
  // the account after asking).
  if (!state?.eligible && delReqs.length === 0) return null;
  const seats = state?.seats ?? { used: 0, reserved: 0, limit: null };
  const invites = state?.invites ?? [];
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

  async function decideRequest(id: string, action: 'approve' | 'decline', reason?: string): Promise<void> {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/account/delete-requests', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: id, action, ...(reason ? { reason } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? 'Could not decide the request.'); return; }
      setMsg(action === 'approve'
        ? `Deleted${j.projectName ? ` "${j.projectName}"` : ''}. It can be restored within 30 days.`
        : 'Request declined; the requester sees your reason on their project card.');
      setDeciding(null);
      await load();
    } catch { setErr('Could not decide the request.'); } finally { setBusy(false); }
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
        {state?.eligible && (
          <span data-testid="team-invites-seats" style={{ fontSize: 12.5, color: theme.muted }}>
            {seats.used} of {limitLabel} seat{seats.limit === 1 ? '' : 's'} in use
            {seats.reserved > 0 ? `, ${seats.reserved} reserved by open invite${seats.reserved === 1 ? '' : 's'}` : ''}
          </span>
        )}
      </div>

      {/* Delete requests (step 7): an Editor asked to delete one of YOUR
          projects; you own it and hold the plan, so the decision is yours.
          Approve is armed then confirmed; a decline REQUIRES a reason, which
          is the only thing the requester will see. The admin queue still
          shows everything, the operator fallback. */}
      {delReqs.length > 0 && (
        <div data-testid="team-delete-requests" style={{ margin: '10px 0 14px', border: '1px solid #C9A84C', background: '#FDF6E3', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0D2E5A', marginBottom: 6 }}>
            Delete request{delReqs.length === 1 ? '' : 's'} awaiting your decision
          </div>
          {delReqs.map((rq) => (
            <div key={rq.id} data-testid={`team-delreq-${rq.id}`} style={{ padding: '7px 0', borderTop: '1px solid rgba(201,168,76,0.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: '#0D2E5A' }}>
                  <strong>{rq.projectName ?? 'Unknown project'}</strong>
                  {' '}requested by {rq.requesterName ?? rq.requesterEmail ?? 'a former member'}
                  {!rq.requesterStillMember && ' (no longer a member)'}
                  {' '}on {new Date(rq.createdAt).toLocaleDateString()}
                  {rq.projectDeletedAt && ' (project already deleted elsewhere; decline to close it)'}
                </span>
                {deciding?.id === rq.id && deciding.mode === 'approve' ? (
                  <button type="button" disabled={busy} onClick={() => void decideRequest(rq.id, 'approve')}
                    data-testid={`team-delreq-confirm-${rq.id}`}
                    style={{ border: 'none', borderRadius: 7, padding: '7px 12px', fontSize: 12, fontWeight: 800, background: 'var(--color-negative, #dc2626)', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer' }}>
                    Confirm delete
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setDeciding({ id: rq.id, mode: 'approve', reason: '' })}
                    data-testid={`team-delreq-approve-${rq.id}`}
                    style={{ border: '1px solid var(--color-negative, #dc2626)', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'transparent', color: 'var(--color-negative, #dc2626)', cursor: busy ? 'not-allowed' : 'pointer' }}>
                    Approve
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => setDeciding({ id: rq.id, mode: 'decline', reason: '' })}
                  data-testid={`team-delreq-decline-${rq.id}`}
                  style={{ border: `1px solid ${theme.border}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, background: theme.surface, color: theme.body, cursor: busy ? 'not-allowed' : 'pointer' }}>
                  Decline
                </button>
              </div>
              {deciding?.id === rq.id && deciding.mode === 'decline' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text" value={deciding.reason} placeholder="Reason (the requester will see this)"
                    onChange={(e) => setDeciding({ id: rq.id, mode: 'decline', reason: e.target.value })}
                    data-testid={`team-delreq-reason-${rq.id}`}
                    style={{ flex: 1, minWidth: 220, padding: '7px 10px', borderRadius: 7, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.body, fontSize: 12.5 }}
                  />
                  <button type="button" disabled={busy || !deciding.reason.trim()}
                    onClick={() => void decideRequest(rq.id, 'decline', deciding.reason.trim())}
                    data-testid={`team-delreq-decline-send-${rq.id}`}
                    style={{ border: 'none', borderRadius: 7, padding: '7px 12px', fontSize: 12, fontWeight: 800, background: busy || !deciding.reason.trim() ? theme.border : 'var(--color-navy, #0f2744)', color: '#fff', cursor: busy || !deciding.reason.trim() ? 'not-allowed' : 'pointer' }}>
                    Send decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {err && <div data-testid="team-invites-error" style={{ color: 'var(--color-negative, #dc2626)', fontSize: 12.5, margin: '4px 0 8px' }}>{err}</div>}
      {msg && <div data-testid="team-invites-msg" style={{ color: 'var(--color-green-dark, #15803d)', fontSize: 12.5, margin: '4px 0 8px' }}>{msg}</div>}

      {state?.eligible && (<>
      <p style={{ fontSize: 12.5, color: theme.muted, margin: '0 0 12px' }}>
        Invite a colleague by email. They sign up through the invite and join your account; your
        subscription covers them. Once they join, give them access to your projects below.
      </p>

      {state.canInvite ? (
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
      ) : (seats.limit ?? 0) <= 1 && seats.limit !== -1 ? (
        // A one-seat plan (Pro / Solo / Trial): the owner IS the seat. The
        // path to a team is the SAME upgrade path used everywhere else, the
        // source-derived per-platform pricing page.
        <div data-testid="team-invites-upgrade" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 10, background: '#FDF6E3', border: '1px solid #C9A84C', marginBottom: invites.length ? 14 : 0 }}>
          <span style={{ flex: 1, minWidth: 220, fontSize: 13, color: '#0D2E5A', fontWeight: 600 }}>
            Your plan includes one seat, which you hold. Upgrade to Firm to add team members.
          </span>
          <a
            href={`/pricing/${platformPricingSegment(getPlatform('real-estate') ?? { slug: 'real-estate', shortName: 'REFM' })}`}
            data-testid="team-invites-upgrade-link"
            style={{ background: '#C9A84C', color: '#0D2E5A', fontWeight: 800, fontSize: 13, padding: '9px 18px', borderRadius: 9, textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            Upgrade to Firm →
          </a>
        </div>
      ) : (
        <div data-testid="team-invites-full" style={{ fontSize: 12.5, color: theme.muted, marginBottom: invites.length ? 14 : 0 }}>
          All seats are in use. Revoke an open invite or remove a member to free one, or contact us for more seats.
        </div>
      )}

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
      </>)}

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
