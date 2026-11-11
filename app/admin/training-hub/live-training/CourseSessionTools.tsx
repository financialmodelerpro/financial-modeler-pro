'use client';

/**
 * Live-course session tools inside the ONE session editor (LiveSessionsManager):
 *   Materials   Replace (same name, same student link, old version kept), Add, Remove
 *   Reschedule  a new KSA date and time; this session only, or this and all
 *               following moved by the same gap. A course session is never
 *               cancelled; every enrolled student is emailed the change.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatSessionTime, utcToZonedParts } from '@/src/hubs/training/lib/liveCourse/time';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 6, border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: NAVY, color: '#fff' };

interface Material { id: string; file_name: string; size_bytes: number | null; version: number; updated_at: string }

export function CourseSessionTools({ sessionId, scheduledIso, onChanged, published, hasTeamsMeeting }: { sessionId: string; scheduledIso: string | null; onChanged: () => void; published?: boolean; hasTeamsMeeting?: boolean }) {
  // Remove the Teams meeting of an UNPUBLISHED session (e.g. a test session): the host calendar event goes, the session stays.
  async function removeTeamsMeeting() {
    const r = await fetch(`/api/admin/live-sessions/${sessionId}/teams-meeting`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alertMsg(j.error ?? 'Removing the Teams meeting failed.'); return; }
    alertMsg('Teams meeting removed from the host calendar.');
    onChanged();
  }
  const [teamsMsg, alertMsg] = useState('');
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState('');
  const start = scheduledIso ? utcToZonedParts(scheduledIso) : { date: '', time: '19:00' };
  const [newDate, setNewDate] = useState(start.date);
  const [newTime, setNewTime] = useState(start.time);
  const [mode, setMode] = useState<'single' | 'following'>('single');
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/admin/live-sessions/${sessionId}/materials`).then((r) => r.json()).then((j: { materials?: Material[] }) => setMaterials(j.materials ?? [])).catch(() => setMaterials([]));
  }, [sessionId]);
  useEffect(() => { load(); }, [load]);

  async function upload(file: File | undefined, replace?: string) {
    if (!file) return;
    setBusy('upload'); setMsg('');
    try {
      const fd = new FormData(); fd.append('file', file); if (replace) fd.append('replaceId', replace);
      const r = await fetch(`/api/admin/live-sessions/${sessionId}/materials`, { method: 'POST', body: fd });
      const j = await r.json() as { action?: string; error?: string };
      setMsg(r.ok ? (j.action === 'unchanged' ? 'Same file as before: nothing changed.' : j.action === 'changed' ? 'Replaced. Students keep the same link; the old version is kept.' : 'Added.') : `Upload failed: ${j.error}`);
      load();
    } finally { setBusy(''); setReplaceId(''); }
  }

  async function remove(id: string) {
    setBusy(`rm${id}`);
    await fetch(`/api/admin/live-sessions/${sessionId}/materials?materialId=${id}`, { method: 'DELETE' });
    setBusy(''); load();
  }

  async function reschedule() {
    setBusy('resched'); setMsg('');
    try {
      const r = await fetch(`/api/admin/live-sessions/${sessionId}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: newDate, time: newTime, mode }) });
      const j = await r.json() as { moves?: { no: number | null; newStart: string }[]; emailsSent?: number; teamsFailed?: string[]; teamsConfigured?: boolean; error?: string };
      if (!r.ok) { setMsg(`Reschedule failed: ${j.error}`); return; }
      const moved = (j.moves ?? []).map((m) => `S${m.no}`).join(', ');
      setMsg(`Moved ${moved}. ${j.emailsSent ?? 0} enrolled student(s) emailed.${j.teamsFailed?.length ? ` Teams not updated: ${j.teamsFailed.join('; ')}` : j.teamsConfigured ? ' Teams meeting time updated.' : ' Teams is not configured, so update the meeting time in Teams.'}`);
      setConfirming(false);
      onChanged();
    } finally { setBusy(''); }
  }

  return (
    <div data-testid="course-session-tools" style={{ display: 'grid', gap: 16, margin: '8px 0 20px' }}>
      {published === false && hasTeamsMeeting && (
        <div data-testid="remove-teams-meeting" style={{ border: '1px solid #FED7AA', borderRadius: 8, padding: 12, background: '#FFF7ED', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: '#9A5B00', flex: 1 }}>This unpublished session still has a Teams meeting on the host calendar.</span>
          <button type="button" onClick={removeTeamsMeeting} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #B45309', background: '#fff', color: '#B45309', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Remove Teams meeting</button>
          {teamsMsg && <span style={{ width: '100%', fontSize: 12, color: '#9A5B00' }}>{teamsMsg}</span>}
        </div>
      )}
      <div style={{ border: `1px solid ${PALE}`, borderRadius: 8, padding: 14, background: '#FAFBFD' }}>
        <h3 style={{ fontSize: 13, fontWeight: 800, color: NAVY, margin: '0 0 4px' }}>Materials</h3>
        <p style={{ fontSize: 11.5, color: SLATE, margin: '0 0 8px' }}>Released to enrolled students after the session ends (its current end time, so a reschedule moves it). Replace keeps the same student link.</p>
        {!materials && <div style={{ fontSize: 12, color: SLATE }}>Loading…</div>}
        {materials?.length === 0 && <div style={{ fontSize: 12, color: SLATE }}>No files yet. Add them here or run npm run sync:refm-materials.</div>}
        {materials?.map((m) => (
          <div key={m.id} data-testid="session-material-row" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${PALE}`, fontSize: 12.5 }}>
            <span style={{ flex: 1, minWidth: 0 }}><strong>{m.file_name}</strong> <span style={{ color: SLATE }}>v{m.version}{m.size_bytes ? ` · ${(m.size_bytes / 1024).toFixed(0)} KB` : ''}</span></span>
            <button style={btn} disabled={!!busy} onClick={() => { setReplaceId(m.id); replaceRef.current?.click(); }}>Replace</button>
            <button style={{ ...btn, borderColor: '#B91C1C', color: '#B91C1C' }} disabled={!!busy} onClick={() => remove(m.id)}>Remove</button>
          </div>
        ))}
        <input ref={replaceRef} type="file" style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files?.[0], replaceId); e.target.value = ''; }} />
        <input ref={addRef} type="file" style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        <button data-testid="session-material-add" style={{ ...btnPrimary, marginTop: 8 }} disabled={!!busy} onClick={() => addRef.current?.click()}>{busy === 'upload' ? 'Uploading…' : '+ Add file'}</button>
      </div>

      <div style={{ border: `1px solid ${PALE}`, borderRadius: 8, padding: 14, background: '#FAFBFD' }}>
        <h3 style={{ fontSize: 13, fontWeight: 800, color: NAVY, margin: '0 0 4px' }}>Reschedule</h3>
        <p style={{ fontSize: 11.5, color: SLATE, margin: '0 0 8px' }}>
          Currently {formatSessionTime(scheduledIso)}. A course session is never cancelled: it moves, keeps its number and still counts towards the certificate.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #CBD5E1' }} />
          <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #CBD5E1' }} />
          <span style={{ fontSize: 12, color: SLATE }}>KSA</span>
          <label style={{ fontSize: 12.5 }}><input type="radio" checked={mode === 'single'} onChange={() => setMode('single')} /> This session only</label>
          <label style={{ fontSize: 12.5 }}><input type="radio" checked={mode === 'following'} onChange={() => setMode('following')} /> This and all following, moved by the same gap</label>
        </div>
        {!confirming ? (
          <button data-testid="session-reschedule" style={{ ...btnPrimary, marginTop: 10 }} disabled={!newDate || !newTime || !!busy} onClick={() => setConfirming(true)}>Reschedule…</button>
        ) : (
          <div style={{ marginTop: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>Move {mode === 'single' ? 'this session' : 'this and every later session'} and email every enrolled student the new time?</span>
            <button data-testid="session-reschedule-confirm" style={btnPrimary} onClick={reschedule} disabled={busy === 'resched'}>{busy === 'resched' ? 'Moving…' : 'Yes, reschedule'}</button>
            <button style={btn} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
      {msg && <div data-testid="course-session-tools-msg" style={{ fontSize: 12.5, color: NAVY, fontWeight: 600 }}>{msg}</div>}
    </div>
  );
}
