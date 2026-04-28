'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';

interface Entry {
  id:       string;
  email:    string;
  note:     string | null;
  added_by: string | null;
  added_at: string;
}

interface Toggles {
  signin:   { enabled: boolean; launchDate: string };
  register: { enabled: boolean; launchDate: string };
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

function formatWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function ModelingAccessPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [toggles, setToggles] = useState<Toggles | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote]   = useState('');
  const [adding, setAdding]     = useState(false);
  const [error, setError]       = useState('');
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [listRes, signinRes, registerRes] = await Promise.all([
        fetch('/api/admin/modeling-access'),
        fetch('/api/admin/modeling-signin-coming-soon'),
        fetch('/api/admin/modeling-register-coming-soon'),
      ]);
      const listJson     = await listRes.json();
      const signinJson   = await signinRes.json();
      const registerJson = await registerRes.json();
      setEntries(listJson.entries ?? []);
      setToggles({
        signin:   { enabled: !!signinJson.enabled,   launchDate: signinJson.launchDate ?? '' },
        register: { enabled: !!registerJson.enabled, launchDate: registerJson.launchDate ?? '' },
      });
    } catch {
      showToast('Failed to load whitelist', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading) void loadAll();
  }, [authLoading]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!newEmail.trim()) { setError('Email is required.'); return; }
    setAdding(true);
    try {
      const res = await fetch('/api/admin/modeling-access', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: newEmail.trim(), note: newNote.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? 'Failed to add entry.');
        setAdding(false);
        return;
      }
      setEntries(prev => [j.entry as Entry, ...prev]);
      setNewEmail('');
      setNewNote('');
      showToast('Added to whitelist');
    } catch {
      setError('Network error. Try again.');
    } finally {
      setAdding(false);
    }
  }

  async function revoke(id: string, email: string) {
    if (!confirm(`Revoke whitelist access for ${email}?`)) return;
    try {
      const res = await fetch(`/api/admin/modeling-access/${id}`, { method: 'DELETE' });
      if (!res.ok) { showToast('Failed to revoke', 'error'); return; }
      setEntries(prev => prev.filter(e => e.id !== id));
      showToast('Access revoked');
    } catch {
      showToast('Failed to revoke', 'error');
    }
  }

  if (authLoading) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: 13,
    border: '1.5px solid #D1D5DB', borderRadius: 7,
    outline: 'none', boxSizing: 'border-box',
    fontFamily: "'Inter', sans-serif", background: '#fff',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: '#6B7280', marginBottom: 5, letterSpacing: '0.05em',
  };

  const togglePill = (on: boolean) => (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px',
      borderRadius: 20,
      background: on ? '#FEF3C7' : '#E8F7EC',
      color:      on ? '#92400E' : '#1A7A30',
    }}>
      {on ? 'COMING SOON' : 'LIVE'}
    </span>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/modeling-access" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
          Modeling Hub Access
        </h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>
          Whitelisted emails bypass the Coming Soon toggles below and can
          register and sign in as if the hub were already live. Admins are
          always allowed regardless of this list.
        </p>

        {/* ── Current toggle state summary ────────────────────────────── */}
        <div style={{
          background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12,
          padding: '16px 20px', marginBottom: 24,
          display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 4 }}>
              SIGN-IN TOGGLE
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {toggles ? togglePill(toggles.signin.enabled) : <span style={{ color: '#9CA3AF', fontSize: 12 }}>loading…</span>}
              <span style={{ fontSize: 12, color: '#6B7280' }}>
                {toggles?.signin.enabled ? 'Only admins + whitelist can sign in.' : 'Anyone with an account can sign in.'}
              </span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 4 }}>
              REGISTER TOGGLE
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {toggles ? togglePill(toggles.register.enabled) : <span style={{ color: '#9CA3AF', fontSize: 12 }}>loading…</span>}
              <span style={{ fontSize: 12, color: '#6B7280' }}>
                {toggles?.register.enabled ? 'Only admins + whitelist can register.' : 'Anyone can register.'}
              </span>
            </div>
          </div>
          <Link
            href="/admin/modules"
            style={{
              marginLeft: 'auto', padding: '8px 14px', fontSize: 12, fontWeight: 700,
              borderRadius: 7, border: '1px solid #1B4F8A',
              background: '#fff', color: '#1B4F8A', textDecoration: 'none',
            }}
          >
            Manage Toggles →
          </Link>
        </div>

        {/* ── Add new entry ───────────────────────────────────────────── */}
        <div style={{
          background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12,
          padding: '20px 24px', marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: '#1B3A6B', margin: 0, marginBottom: 14 }}>
            Add email to whitelist
          </h2>
          <form onSubmit={addEntry} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={labelStyle}>EMAIL</label>
              <input
                type="email" required
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="friend@example.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>NOTE (optional)</label>
              <input
                type="text"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Beta tester, colleague, pilot customer…"
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              disabled={adding}
              style={{
                padding: '9px 22px', fontSize: 13, fontWeight: 700,
                background: adding ? '#93C5FD' : '#1B4F8A',
                color: '#fff', border: 'none', borderRadius: 7,
                cursor: adding ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {adding ? 'Adding…' : 'Add Access'}
            </button>
          </form>
          {error && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#DC2626', fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>

        {/* ── List ────────────────────────────────────────────────────── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1B4F8A' }}>
                {['Email', 'Note', 'Added By', 'Added', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#6B7280' }}>Loading whitelist…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
                  No entries yet. Add an email above to grant pre-launch access.
                </td></tr>
              ) : entries.map((e, i) => (
                <tr key={e.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#1B3A6B', fontWeight: 600 }}>
                    {e.email}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#374151' }}>
                    {e.note || <span style={{ color: '#9CA3AF' }}>-</span>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280' }}>
                    {e.added_by || 'system'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap' }}>
                    {formatWhen(e.added_at)}
                  </td>
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => revoke(e.id, e.email)}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: '6px 14px',
                        borderRadius: 6, border: '1px solid #FECACA',
                        background: '#fff', color: '#DC2626', cursor: 'pointer',
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: '#9CA3AF' }}>
          Preview sign-in: <a href={`${APP_URL}/signin`} target="_blank" rel="noopener noreferrer" style={{ color: '#1B4F8A' }}>{APP_URL}/signin ↗</a>
          {' '}·{' '}
          Preview register: <a href={`${APP_URL}/register`} target="_blank" rel="noopener noreferrer" style={{ color: '#1B4F8A' }}>{APP_URL}/register ↗</a>
        </div>
      </main>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.type === 'success' ? '#1A7A30' : '#DC2626',
          color: '#fff', fontWeight: 700, fontSize: 13,
          padding: '12px 22px', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999,
        }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
