'use client';

/** Creates a Teams meeting for every upcoming course session that has no join link (no email, no newsletter). */
import { useState } from 'react';

export function TeamsMeetingsButton({ courseCode, onDone }: { courseCode: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function run() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/admin/live-course/${courseCode}/teams-meetings`, { method: 'POST' });
      const j = await r.json() as { created?: number[]; failed?: string[]; skipped?: number; error?: string };
      if (!r.ok && j.error) { setMsg(j.error); return; }
      setMsg(`${j.created?.length ?? 0} meeting(s) created${j.created?.length ? ` (sessions ${j.created.join(', ')})` : ''}; ${j.skipped ?? 0} already had a link or are past.${j.failed?.length ? ` Failed: ${j.failed.join('; ')}` : ''}`);
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
      <button data-testid="create-teams-meetings" onClick={run} disabled={busy}
        style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #1B4F8A', background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        {busy ? 'Creating…' : 'Create missing Teams meetings'}
      </button>
      <span style={{ fontSize: 12, color: '#5A6675' }}>For every upcoming session with no join link. Sends no student email and no newsletter.</span>
      {msg && <div data-testid="create-teams-meetings-msg" style={{ width: '100%', fontSize: 12.5, color: '#1B4F8A', fontWeight: 600 }}>{msg}</div>}
    </div>
  );
}
