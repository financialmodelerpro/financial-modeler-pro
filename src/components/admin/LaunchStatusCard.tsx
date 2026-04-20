'use client';

import { useEffect, useState } from 'react';

// Auto-launch UI feature flag.
//
// Vercel Hobby limits cron jobs to once-per-day schedules, so the
// every-5-minutes auto-launch cron can't ship on the current plan.
// The checkbox + status readout are hidden until the project upgrades
// to Vercel Pro. On upgrade: flip this to `true` AND re-add the cron
// entry to vercel.json (path: /api/cron/auto-launch-check, schedule
// every 5 minutes). Backend (migration 118, settings keys, the
// /api/cron/auto-launch-check endpoint, PATCH fields) stays intact
// so the only required changes are this flag + vercel.json.
const AUTO_LAUNCH_UI_ENABLED = false;

interface Props {
  label: string;
  icon?: string;
  endpoint: string;
  previewUrl: string;
  onMessage?: (msg: string, type: 'success' | 'error') => void;
}

interface FetchedState {
  enabled:            boolean;
  launchDate:         string;
  autoLaunch:         boolean;
  lastAutoLaunchedAt: string;
}

function isoToLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function formatReadable(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function LaunchStatusCard({ label, icon = '🚀', endpoint, previewUrl, onMessage }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [launchDate, setLaunchDate] = useState('');
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [lastAutoLaunchedAt, setLastAutoLaunchedAt] = useState('');
  const [draft, setDraft] = useState('');
  const [togglingCS, setTogglingCS] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(endpoint)
      .then(r => r.json())
      .then((j: Partial<FetchedState>) => {
        setEnabled(j.enabled ?? false);
        const iso = j.launchDate ?? '';
        setLaunchDate(iso);
        setDraft(isoToLocal(iso));
        setAutoLaunch(j.autoLaunch ?? false);
        setLastAutoLaunchedAt(j.lastAutoLaunchedAt ?? '');
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [endpoint]);

  async function patch(body: Record<string, unknown>, successMsg: string): Promise<boolean> {
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { onMessage?.('Update failed', 'error'); return false; }
      const j = (await res.json()) as Partial<FetchedState>;
      setEnabled(j.enabled ?? false);
      setLaunchDate(j.launchDate ?? '');
      setDraft(isoToLocal(j.launchDate ?? ''));
      setAutoLaunch(j.autoLaunch ?? false);
      setLastAutoLaunchedAt(j.lastAutoLaunchedAt ?? '');
      onMessage?.(successMsg, 'success');
      return true;
    } catch {
      onMessage?.('Update failed', 'error');
      return false;
    }
  }

  async function toggle() {
    setTogglingCS(true);
    await patch(
      { enabled: !enabled },
      enabled ? `${label} is now LIVE` : `${label} set to Coming Soon`,
    );
    setTogglingCS(false);
  }

  async function saveDate() {
    setSavingDate(true);
    const iso = localToIso(draft);
    await patch({ launchDate: iso }, iso ? 'Launch date saved' : 'Launch date cleared');
    setSavingDate(false);
  }

  async function toggleAuto() {
    setTogglingAuto(true);
    await patch(
      { autoLaunch: !autoLaunch },
      autoLaunch ? 'Auto-launch disabled' : 'Auto-launch scheduled',
    );
    setTogglingAuto(false);
  }

  if (!loaded) return null;

  const draftIso = localToIso(draft);
  const dateChanged = draftIso !== launchDate;

  // Three-state status readout shown beneath the toggle/date controls:
  //   SCHEDULED   — Coming Soon on + auto-launch on + launch date set
  //   MANUAL      — any state where the cron won't fire automatically
  //   LAST FIRED  — shown when lastAutoLaunchedAt has a value (audit trail)
  const scheduled = enabled && autoLaunch && !!launchDate;
  const autoLaunchAllowed = enabled && !!launchDate;    // checkbox only makes sense with a target

  return (
    <div style={{ background: enabled ? '#FFFBEB' : '#F0FFF4', border: `1px solid ${enabled ? '#FDE68A' : '#BBF7D0'}`, borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
            {icon} {label} Launch Status
          </div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>
            {enabled
              ? `Coming Soon mode is ON — signin and register pages show ${launchDate ? 'a countdown' : 'a coming soon message'}. Admins can bypass via ?bypass=true on /signin.`
              : `${label} is LIVE — signin and register pages work normally.`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: enabled ? '#FEF3C7' : '#E8F7EC', color: enabled ? '#92400E' : '#1A7A30' }}>
            {enabled ? 'COMING SOON' : 'LIVE'}
          </span>
          <button onClick={toggle} disabled={togglingCS}
            style={{ padding: '8px 20px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: togglingCS ? 'not-allowed' : 'pointer', background: enabled ? '#1A7A30' : '#B45309', color: '#fff', opacity: togglingCS ? 0.6 : 1 }}>
            {togglingCS ? 'Updating…' : enabled ? 'Set to LIVE →' : 'Set to Coming Soon'}
          </button>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, fontWeight: 700, padding: '8px 14px', borderRadius: 7, border: '1px solid #1B4F8A', background: '#fff', color: '#1B4F8A', textDecoration: 'none' }}>
            Preview ↗
          </a>
        </div>
      </div>

      {enabled && (
        <div style={{ marginTop: 16, borderTop: '1px dashed #E5E7EB', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4, letterSpacing: '0.05em' }}>LAUNCH DATE &amp; TIME <span style={{ color: '#9CA3AF', fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>(optional — shows countdown if set)</span></div>
            <input
              type="datetime-local"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 6, color: '#1B3A6B', background: '#fff', fontFamily: "'Inter', sans-serif" }}
            />
            <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
              Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Leave empty to just show a Coming Soon message with no countdown.
            </div>
          </div>
          <button
            onClick={saveDate}
            disabled={savingDate || !dateChanged}
            style={{ padding: '8px 18px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: (savingDate || !dateChanged) ? 'not-allowed' : 'pointer', background: '#1B4F8A', color: '#fff', opacity: (savingDate || !dateChanged) ? 0.5 : 1 }}>
            {savingDate ? 'Saving…' : 'Save Launch Date'}
          </button>
          {draft && (
            <button
              onClick={() => setDraft('')}
              style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: '#fff', color: '#6B7280' }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Auto-launch checkbox + status readout are gated behind
          AUTO_LAUNCH_UI_ENABLED — see the flag comment at top of file for
          the Vercel Hobby constraint. When the flag is off this collapses
          to zero UI; the backend (migration 118, /api/cron/auto-launch-check,
          PATCH fields) still exists and is ready when the flag flips. */}
      {AUTO_LAUNCH_UI_ENABLED && enabled && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label
            title={!launchDate ? 'Set a launch date first to enable auto-launch.' : ''}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: autoLaunchAllowed ? 'pointer' : 'not-allowed', opacity: autoLaunchAllowed ? 1 : 0.55, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={autoLaunch}
              disabled={!autoLaunchAllowed || togglingAuto}
              onChange={toggleAuto}
              style={{ width: 16, height: 16, accentColor: '#1B4F8A', cursor: autoLaunchAllowed ? 'pointer' : 'not-allowed' }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1B3A6B' }}>
              Auto-launch at this date and time
            </span>
          </label>
          {togglingAuto && (
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>updating…</span>
          )}
        </div>
      )}

      {AUTO_LAUNCH_UI_ENABLED && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #E5E7EB', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {scheduled ? (
            <div style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 600 }}>
              ⏱ Scheduled: auto-launch at <strong>{formatReadable(launchDate)}</strong>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
              Manual control — admin must toggle this hub live.
            </div>
          )}
          {lastAutoLaunchedAt && (
            <div style={{ fontSize: 11, color: '#1A7A30', fontWeight: 500 }}>
              ✅ Last auto-launched at <strong>{formatReadable(lastAutoLaunchedAt)}</strong> by system
            </div>
          )}
        </div>
      )}
    </div>
  );
}
