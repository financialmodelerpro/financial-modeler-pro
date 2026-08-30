'use client';

/**
 * DeleteUserModal - the ONE admin confirmation dialog for deleting a user,
 * shared by the users list and the user detail panel so the two doors show the
 * same facts and hit the same endpoint.
 *
 * It loads the deletion preview (GET /api/admin/users/[id]), NAMES the user and
 * exactly what will be removed vs retained, warns about a live paid
 * subscription (cancelled immediately at Paddle before the delete), takes an
 * optional message that is emailed to the user, and requires the admin to TYPE
 * THE USER'S EMAIL before the button arms. DELETE /api/admin/users/[id] then
 * performs and audits the deletion.
 *
 * No em dashes in this file.
 */
import { useState, useEffect } from 'react';

interface Preview {
  email: string;
  name: string | null;
  planKey: string | null;
  projects: number;
  versions: number;
  trialRequests: number;
  subscriptionRows: number;
  liveSubscriptions: Array<{ platform: string; planKey: string | null; status: string | null }>;
  isAdmin: boolean;
}

export function DeleteUserModal({ userId, onClose, onDeleted }: {
  userId: string;
  onClose: () => void;
  onDeleted: (email: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${userId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.preview) setPreview(j.preview as Preview);
        else setLoadError(j.error ?? 'Could not load the user.');
      })
      .catch(() => { if (!cancelled) setLoadError('Could not load the user.'); });
    return () => { cancelled = true; };
  }, [userId]);

  const armed = !!preview && confirmEmail.trim().toLowerCase() === preview.email.toLowerCase() && !preview.isAdmin;

  async function performDelete() {
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, message: message.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? 'Deletion failed'); return; }
      onDeleted(preview!.email);
    } catch {
      setError('Deletion failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const S = {
    label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 5 },
    input: { width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, fontFamily: 'inherit' },
  };

  return (
    <div
      data-testid="delete-user-modal"
      style={{ position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '26px 28px' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#991B1B', marginBottom: 4 }}>Delete user</div>

        {loadError && <div style={{ fontSize: 13, color: '#991B1B', padding: '12px 0' }}>{loadError}</div>}
        {!preview && !loadError && <div style={{ fontSize: 13, color: '#6B7280', padding: '12px 0' }}>Loading what this deletion would remove…</div>}

        {preview && (
          <>
            <p style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6, margin: '0 0 14px' }}>
              This permanently deletes <strong>{preview.name ?? preview.email}</strong> ({preview.email})
              {preview.planKey ? <> on the <strong>{preview.planKey}</strong> plan</> : null}. It cannot be undone.
            </p>

            {preview.isAdmin && (
              <div style={{ fontSize: 13, color: '#991B1B', fontWeight: 700, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                This is an ADMIN account and cannot be deleted. Change the role to user first.
              </div>
            )}

            <div data-testid="delete-user-removes" style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#991B1B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Will be removed</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#374151', lineHeight: 1.7 }}>
                <li><strong>{preview.projects}</strong> project{preview.projects === 1 ? '' : 's'} with <strong>{preview.versions}</strong> saved version{preview.versions === 1 ? '' : 's'} (decks, fund terms, change history included)</li>
                <li>{preview.trialRequests} trial request{preview.trialRequests === 1 ? '' : 's'}, {preview.subscriptionRows} subscription record{preview.subscriptionRows === 1 ? '' : 's'}, feature overrides, trusted devices, email log</li>
                <li>The account itself: profile, password, avatar</li>
              </ul>
            </div>
            <div data-testid="delete-user-retains" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Retained</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#6B7280', lineHeight: 1.7 }}>
                <li>Payment ledger and issued invoices (financial records)</li>
                <li>An audit record of this deletion: you, the time, and your message</li>
              </ul>
            </div>

            {preview.liveSubscriptions.length > 0 && (
              <div data-testid="delete-user-live-sub" style={{ fontSize: 12.5, color: '#92400E', fontWeight: 600, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', marginBottom: 14, lineHeight: 1.6 }}>
                This user has an ACTIVE PAID subscription ({preview.liveSubscriptions.map((s) => `${s.planKey ?? 'plan'} on ${s.platform}`).join(', ')}).
                It will be cancelled at Paddle immediately before the account is deleted. If the cancellation fails, nothing is deleted.
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Optional message to the user (emailed with the deletion notice)</label>
              <textarea
                data-testid="delete-user-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Why this account is being deleted (optional)…"
                style={{ ...S.input, resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Type the user&apos;s email to confirm</label>
              <input
                data-testid="delete-user-confirm-email"
                type="text"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={preview.email}
                style={{ ...S.input, background: '#FFF5F5', border: '1px solid #FECACA' }}
              />
            </div>

            {error && <div data-testid="delete-user-error" style={{ fontSize: 12.5, color: '#991B1B', fontWeight: 600, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} disabled={busy}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button
                data-testid="delete-user-confirm"
                onClick={performDelete}
                disabled={!armed || busy}
                style={{
                  padding: '9px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 800, fontFamily: 'inherit',
                  background: armed ? '#DC2626' : '#9CA3AF', color: '#fff', cursor: armed && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Deleting…' : 'Delete this user'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
