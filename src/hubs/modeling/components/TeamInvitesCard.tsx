'use client';

/**
 * TeamInvitesCard.tsx
 *
 * THE CLIENT'S OWN TEAM SURFACE, account model step 5: invite a colleague by
 * email, see open invites, revoke one. Renders on the main dashboard view and
 * decides NOTHING itself: GET /api/account/invites says whether the caller is
 * eligible to see it (an account holder whose plan carries more than one
 * seat, or who already has people or invites), what the seat numbers are and
 * which invites are open. A member, a one-seat holder with nobody else, or an
 * error all render as nothing at all.
 *
 * The seat is reserved when the invite is CREATED (engine rule, stated in
 * src/shared/account/invites.ts); this card just shows the arithmetic.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useState } from 'react';

interface OpenInvite { id: string; email: string; expires_at: string; expired: boolean }
interface TeamState {
  eligible: boolean;
  accountName?: string;
  seats?: { used: number; reserved: number; limit: number | null };
  invites?: OpenInvite[];
}

export default function TeamInvitesCard({ theme }: {
  theme: { surface: string; border: string; body: string; heading: string; muted: string; bg: string };
}): React.JSX.Element | null {
  const [state, setState] = useState<TeamState | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/account/invites', { credentials: 'include' });
      if (!r.ok) { setState({ eligible: false }); return; }
      setState(await r.json() as TeamState);
    } catch { setState({ eligible: false }); }
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
        subscription covers them. Ask us to assign them to your projects, or manage access once they join.
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
    </div>
  );
}
