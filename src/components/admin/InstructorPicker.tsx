'use client';

import { useEffect, useState, useCallback } from 'react';

export interface PickerInstructor {
  id: string;
  name: string;
  title: string;
  credentials?: string | null;
  is_default: boolean;
  active: boolean;
}

interface Props {
  value: string;                      // instructor_id, '' when unset
  onChange: (id: string, instructor: PickerInstructor | null) => void;
  onMessage?: (msg: string, type: 'success' | 'error') => void;
}

const NAVY = '#1B3A6B';
const BLUE = '#1B4F8A';
const GREEN = '#2EAA4A';
const BORDER = '#E5E7EB';
const LIGHT_BG = '#F9FAFB';

const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: NAVY, background: '#fff', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
};
const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 700, background: bg, color: fg, cursor: 'pointer',
});

export function InstructorPicker({ value, onChange, onMessage }: Props) {
  const [instructors, setInstructors] = useState<PickerInstructor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newCreds, setNewCreds] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/instructors');
      const j = (await res.json()) as { instructors?: PickerInstructor[] };
      const all = j.instructors ?? [];
      setInstructors(all);
      return all;
    } catch {
      return [] as PickerInstructor[];
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // If no value is set yet and we have a default, auto-select it.
  useEffect(() => {
    if (!loaded) return;
    if (value) return;
    const def = instructors.find(i => i.is_default && i.active);
    if (def) onChange(def.id, def);
  }, [loaded, value, instructors, onChange]);

  const active = instructors.filter(i => i.active || i.id === value);
  const selected = instructors.find(i => i.id === value) ?? null;

  async function createInline() {
    if (!newName.trim() || !newTitle.trim()) {
      onMessage?.('Name and title are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/instructors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          title: newTitle.trim(),
          credentials: newCreds.trim() || null,
          active: true,
        }),
      });
      const j = (await res.json()) as { instructor?: PickerInstructor; error?: string };
      if (!res.ok || !j.instructor) throw new Error(j.error ?? 'Failed to create instructor');
      const all = await load();
      const created = all.find(i => i.id === j.instructor!.id) ?? j.instructor;
      onChange(created.id, created);
      setNewName(''); setNewTitle(''); setNewCreds('');
      setShowAdd(false);
      onMessage?.('Instructor added', 'success');
    } catch (e) {
      onMessage?.((e as Error).message, 'error');
    }
    setSaving(false);
  }

  return (
    <div style={{ background: LIGHT_BG, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <select
          value={value}
          onChange={e => {
            const id = e.target.value;
            const ins = instructors.find(i => i.id === id) ?? null;
            onChange(id, ins);
          }}
          style={{ ...field, flex: 1, cursor: 'pointer' }}
        >
          <option value="">— Select instructor —</option>
          {active.map(i => (
            <option key={i.id} value={i.id}>
              {i.name}{i.is_default ? ' (default)' : ''} — {i.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setShowAdd(s => !s)} style={btn(BLUE)}>
          {showAdd ? 'Cancel' : '+ New'}
        </button>
        <a href="/admin/training-hub/instructors" target="_blank" rel="noopener noreferrer"
           style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Manage ↗
        </a>
      </div>

      {showAdd && (
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>
            Quick-add creates an active instructor with just a name + title. Use the Manage page for bio, photo, links.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input style={field} placeholder="Name *" value={newName} onChange={e => setNewName(e.target.value)} />
            <input style={field} placeholder="Title *" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
            <input style={field} placeholder="Credentials (e.g. ACCA, FMVA)" value={newCreds} onChange={e => setNewCreds(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={createInline} disabled={saving}
                      style={{ ...btn(GREEN), opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Create & Select'}
              </button>
              <button type="button" onClick={() => { setShowAdd(false); setNewName(''); setNewTitle(''); setNewCreds(''); }}
                      style={{ ...btn('#fff', '#6B7280'), border: `1px solid ${BORDER}` }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {selected ? (
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 2 }}>
            PREVIEW
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{selected.name}</div>
          <div style={{ fontSize: 12, color: '#4B5563' }}>{selected.title}</div>
          {selected.credentials && (
            <div style={{ fontSize: 11.5, color: '#9CA3AF', marginTop: 2 }}>{selected.credentials}</div>
          )}
        </div>
      ) : loaded ? (
        <div style={{ fontSize: 12, color: '#9CA3AF' }}>
          No instructor selected. Pick one from the list or create a new one.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#9CA3AF' }}>Loading instructors…</div>
      )}
    </div>
  );
}
