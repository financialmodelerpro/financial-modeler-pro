'use client';

/**
 * Teams for a live course's sessions (admin):
 *   - Create missing Teams meetings: for every upcoming session with no join
 *     link (no student email, no newsletter).
 *   - Apply meeting options to all sessions: lobby bypass Everyone (dial-in
 *     too), organizer-only presenters, record and transcribe automatically, on
 *     every course meeting, then each meeting is read back from Microsoft and
 *     shown per session (what Teams actually holds).
 */
import { useEffect, useState } from 'react';

interface Row { no: number | null; title: string; applied: boolean; error: string | null; lobbyScope: string | null; dialInBypass: boolean | null; presenters: string | null; recordAutomatically: boolean | null }

const yes = (v: boolean | null) => (v === true ? 'On' : v === false ? 'Off' : '?');

export function TeamsMeetingsButton({ courseCode, onDone }: { courseCode: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [report, setReport] = useState<{ at?: string; rows: Row[] } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { fetch(`/api/admin/live-course/${courseCode}/teams-settings`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.rows?.length) setReport(j); }).catch(() => {}); }, 0);
    return () => clearTimeout(t);
  }, [courseCode]);

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
  async function applyOptions() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/admin/live-course/${courseCode}/teams-settings`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? 'Applying the options failed.'); return; }
      setReport(j);
      setMsg('Options applied; below is what each meeting now holds in Teams.');
    } finally { setBusy(false); }
  }
  const btn = (primary: boolean) => ({ padding: '8px 16px', borderRadius: 6, border: '1px solid #1B4F8A', background: primary ? '#1B4F8A' : '#fff', color: primary ? '#fff' : '#1B4F8A', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' } as const);
  const th = { textAlign: 'left' as const, padding: '6px 8px', fontSize: 11, color: '#0D2E5A', borderBottom: '1px solid #E8EEF7' };
  const td = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid #F1F3F5' };
  return (
    <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button data-testid="create-teams-meetings" onClick={run} disabled={busy} style={btn(true)}>{busy ? 'Working…' : 'Create missing Teams meetings'}</button>
        <button data-testid="apply-teams-options" onClick={applyOptions} disabled={busy} style={btn(false)}>Apply meeting options to all sessions</button>
        <span style={{ fontSize: 12, color: '#5A6675' }}>Lobby: everyone (dial-in too), presenters: organizer only, record and transcribe automatically. Sends no email.</span>
      </div>
      {msg && <div data-testid="create-teams-meetings-msg" style={{ fontSize: 12.5, color: '#1B4F8A', fontWeight: 600 }}>{msg}</div>}
      {report && report.rows.length > 0 && (
        <div data-testid="teams-options-report" style={{ background: '#fff', border: '1px solid #E8EEF7', borderRadius: 8, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Session</th><th style={th}>Lobby bypass</th><th style={th}>Dial-in bypass</th><th style={th}>Presenters</th><th style={th}>Record automatically</th><th style={th}>Note</th></tr></thead>
            <tbody>{report.rows.map((r, i) => (
              <tr key={i}>
                <td style={td}>{r.no != null ? `Session ${r.no}` : r.title}</td>
                <td style={td}>{r.lobbyScope ?? '?'}</td>
                <td style={{ ...td, color: r.dialInBypass ? '#2E7D52' : '#B91C1C', fontWeight: 700 }}>{yes(r.dialInBypass)}</td>
                <td style={td}>{r.presenters ?? '?'}</td>
                <td style={{ ...td, color: r.recordAutomatically ? '#2E7D52' : '#B91C1C', fontWeight: 700 }}>{yes(r.recordAutomatically)}</td>
                <td style={{ ...td, color: '#9A5B00' }}>{r.error ?? ''}</td>
              </tr>
            ))}</tbody>
          </table>
          {report.at && <div style={{ fontSize: 11, color: '#5A6675', padding: '6px 8px' }}>Read from Microsoft Teams at {new Date(report.at).toLocaleString('en-GB')}</div>}
        </div>
      )}
    </div>
  );
}
