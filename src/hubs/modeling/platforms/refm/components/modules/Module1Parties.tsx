'use client';

/**
 * Module1Parties.tsx (REFM Module 1, tab 2, migration 190)
 *
 * Per-project Parties: each party is entered ONCE with a Name, an optional
 * Identifier, and one or more Roles from the fixed set. Identity data only, the
 * model engine never reads it, so this tab is independent of the version snapshot
 * and the save/version flow. Loads/saves via /api/refm/projects/[id]/parties.
 * Projects with no parties (incl. all pre-existing ones) show an empty tab.
 *
 * No em dashes in this file.
 */

import { useState, useEffect, useCallback } from 'react';
import { PARTY_ROLES, type Party } from '../../lib/parties';
import { listParties, createParty, updateParty, deleteParty } from '../../lib/persistence/client';

const NAVY = '#1B3A6B';
const BLUE = '#1B4F8A';
const BORDER = '#E8F0FB';

const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 7,
  fontSize: 13, color: NAVY, background: '#FFFBEB', boxSizing: 'border-box', fontFamily: "'Inter', sans-serif",
};

interface Draft { name: string; identifier: string; roles: string[] }
const EMPTY: Draft = { name: '', identifier: '', roles: [] };

export default function Module1Parties({ projectId }: { projectId: string | null }): React.JSX.Element {
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const notify = (text: string, type: 'success' | 'error') => { setToast({ text, type }); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(async () => {
    if (!projectId) { setParties([]); return; }
    setLoading(true);
    const { data } = await listParties(projectId);
    if (data) setParties(data.parties);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  function startAdd() { setDraft(EMPTY); setEditingId('new'); }
  function startEdit(p: Party) { setDraft({ name: p.name, identifier: p.identifier ?? '', roles: [...p.roles] }); setEditingId(p.id); }
  function cancel() { setEditingId(null); setDraft(EMPTY); }
  function toggleRole(r: string) {
    setDraft(d => ({ ...d, roles: d.roles.includes(r) ? d.roles.filter(x => x !== r) : [...d.roles, r] }));
  }
  const orderedRoles = (roles: string[]) => PARTY_ROLES.filter(r => roles.includes(r));

  async function save() {
    if (!projectId || !draft.name.trim() || busy) { if (!draft.name.trim()) notify('Name is required.', 'error'); return; }
    setBusy(true);
    const payload = { name: draft.name.trim(), identifier: draft.identifier.trim() || null, roles: orderedRoles(draft.roles) };
    const res = editingId === 'new'
      ? await createParty(projectId, payload)
      : await updateParty(projectId, { partyId: editingId as string, ...payload });
    setBusy(false);
    if (res.error) { notify(res.error, 'error'); return; }
    notify(editingId === 'new' ? 'Party added.' : 'Party updated.', 'success');
    cancel();
    await load();
  }

  async function remove(p: Party) {
    if (!projectId) return;
    if (!confirm(`Remove "${p.name}" from this project's parties?`)) return;
    const res = await deleteParty(projectId, p.id);
    if (res.error) { notify(res.error, 'error'); return; }
    notify('Party removed.', 'success');
    await load();
  }

  if (!projectId) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#6B7280', fontSize: 14 }}>
        Open or save a project first to manage its parties.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="m1-parties">
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: 0 }}>Parties</h2>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0' }}>
              People and organizations related to this project. Identity only, not used in any calculation.
            </p>
          </div>
          {editingId === null && (
            <button type="button" onClick={startAdd} data-testid="party-add"
              style={{ background: BLUE, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Add party
            </button>
          )}
        </div>
      </div>

      {/* Add / edit form */}
      {editingId !== null && (
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {editingId === 'new' ? 'New party' : 'Edit party'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Name *</label>
              <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Ahmad Din / PaceMakers" style={field} data-testid="party-name" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Identifier <span style={{ color: '#9CA3AF', fontWeight: 500 }}>(optional)</span></label>
              <input value={draft.identifier} onChange={e => setDraft(d => ({ ...d, identifier: e.target.value }))} placeholder="e.g. LLP reg, license, email" style={field} data-testid="party-identifier" />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>Roles <span style={{ color: '#9CA3AF', fontWeight: 500 }}>(one or more)</span></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-testid="party-roles">
              {PARTY_ROLES.map(r => {
                const on = draft.roles.includes(r);
                return (
                  <button key={r} type="button" onClick={() => toggleRole(r)}
                    style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: on ? 700 : 500, cursor: 'pointer',
                      border: `1px solid ${on ? BLUE : '#D1D5DB'}`, background: on ? BLUE : '#fff', color: on ? '#fff' : '#374151' }}>
                    {on ? '✓ ' : ''}{r}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={save} disabled={busy || !draft.name.trim()} data-testid="party-save"
              style={{ background: '#1A7A30', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy || !draft.name.trim() ? 0.6 : 1 }}>
              {busy ? 'Saving…' : editingId === 'new' ? 'Add party' : 'Save changes'}
            </button>
            <button type="button" onClick={cancel} style={{ background: '#fff', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Parties list */}
      <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>Loading…</div>
        ) : parties.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>No parties yet. Use “+ Add party” to add the first one.</div>
        ) : parties.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '14px 18px', borderTop: i ? `1px solid ${BORDER}` : 'none', background: i % 2 ? '#F9FAFB' : '#fff' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{p.name}</div>
              {p.identifier && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{p.identifier}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {orderedRoles(p.roles).length === 0
                  ? <span style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>No roles</span>
                  : orderedRoles(p.roles).map(r => (
                      <span key={r} style={{ fontSize: 11, fontWeight: 600, color: BLUE, background: '#E8F0FB', padding: '3px 8px', borderRadius: 20 }}>{r}</span>
                    ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
              <button type="button" onClick={() => startEdit(p)} style={{ fontSize: 12, color: BLUE, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} data-testid="party-edit">Edit</button>
              <span style={{ color: '#E5E7EB' }}>|</span>
              <button type="button" onClick={() => remove(p)} style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} data-testid="party-delete">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.text}
        </div>
      )}
    </div>
  );
}
