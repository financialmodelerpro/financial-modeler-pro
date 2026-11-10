'use client';

/**
 * The announcement audience picker and the daily email budget panel
 * (2026-11-10, founder). ONE picker for the session announcement and the
 * course announcement: Active students (default), All students, Enrolled in a
 * course, Not yet enrolled in a course, Active in the last N days. The server
 * resolves the audience (announcements/audience.ts) and always excludes
 * unsubscribed and bounced addresses; the count shows before sending.
 */
import { useCallback, useEffect, useState } from 'react';

export type AudienceKind = 'active' | 'all' | 'enrolled' | 'not_enrolled' | 'active_days';
export interface AudienceValue { audience: AudienceKind; courseCode: string; days: number }

export const DEFAULT_AUDIENCE: AudienceValue = { audience: 'active', courseCode: '', days: 30 };

const LABELS: Record<AudienceKind, string> = {
  active: 'Active students',
  all: 'All students',
  enrolled: 'Enrolled in a course',
  not_enrolled: 'Not yet enrolled in a course',
  active_days: 'Active in the last N days',
};

const NAVY = '#0D2E5A';
const SLATE = '#6B7280';

/** Query string for the audience GET endpoints. */
export function audienceQuery(v: AudienceValue): string {
  const q = new URLSearchParams({ audience: v.audience });
  if ((v.audience === 'enrolled' || v.audience === 'not_enrolled') && v.courseCode) q.set('courseCode', v.courseCode);
  if (v.audience === 'active_days') q.set('days', String(v.days));
  return q.toString();
}

export function AudiencePicker({ value, onChange, disabled }: { value: AudienceValue; onChange: (v: AudienceValue) => void; disabled?: boolean }) {
  const [courses, setCourses] = useState<{ code: string; title: string }[]>([{ code: '3SFM', title: '3-Statement Financial Modeling' }, { code: 'BVM', title: 'Business Valuation Modeling' }]);
  useEffect(() => {
    fetch('/api/admin/live-course').then((r) => (r.ok ? r.json() : { courses: [] })).then((j: { courses?: { courseCode: string; title: string }[] }) => {
      setCourses((prev) => [...prev, ...(j.courses ?? []).filter((c) => !prev.some((p) => p.code === c.courseCode)).map((c) => ({ code: c.courseCode, title: c.title }))]);
    }).catch(() => {});
  }, []);
  const needsCourse = value.audience === 'enrolled' || value.audience === 'not_enrolled';
  const sel = { padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 } as const;
  return (
    <div data-testid="announcement-audience" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>Audience</label>
      <select data-testid="announcement-audience-kind" value={value.audience} disabled={disabled} onChange={(e) => onChange({ ...value, audience: e.target.value as AudienceKind })} style={sel}>
        {(Object.keys(LABELS) as AudienceKind[]).map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
      </select>
      {needsCourse && (
        <select data-testid="announcement-audience-course" value={value.courseCode} disabled={disabled} onChange={(e) => onChange({ ...value, courseCode: e.target.value })} style={sel}>
          <option value="">Pick a course…</option>
          {courses.map((c) => <option key={c.code} value={c.code}>{c.code}: {c.title}</option>)}
        </select>
      )}
      {value.audience === 'active_days' && (
        <span style={{ fontSize: 13 }}>
          <input data-testid="announcement-audience-days" type="number" min={1} max={3650} value={value.days} disabled={disabled}
            onChange={(e) => onChange({ ...value, days: Math.max(1, Math.round(Number(e.target.value) || 1)) })} style={{ ...sel, width: 80 }} /> days
        </span>
      )}
    </div>
  );
}

/** "N will be emailed (M unsubscribed, K bounced excluded). X go today, the rest is queued." */
export function AudienceCountLine({ counts, allowance }: { counts: { total: number; excludedUnsubscribed: number; excludedBounced: number } | null; allowance: number | null }) {
  if (!counts) return <span style={{ fontSize: 12.5, color: SLATE }}>Counting…</span>;
  const today = allowance == null ? counts.total : Math.min(counts.total, allowance);
  return (
    <span data-testid="announcement-count" style={{ fontSize: 12.5, color: '#374151' }}>
      <strong>{counts.total}</strong> recipient{counts.total === 1 ? '' : 's'}
      {(counts.excludedUnsubscribed || counts.excludedBounced) ? <span style={{ color: SLATE }}> ({counts.excludedUnsubscribed} unsubscribed, {counts.excludedBounced} bounced excluded)</span> : null}
      {allowance != null && counts.total > today && <span style={{ color: '#9A5B00' }}>. {today} go today; {counts.total - today} are queued for the next days.</span>}
    </span>
  );
}

interface BudgetData {
  usage: { day: string; system: number; announcement: number; total: number; dailyLimit: number; announcementCap: number; activeDays: number; tracking: boolean };
  allowance: number;
  students: { active: number; inactive: number; total: number };
  jobs: { id: string; created_at: string; kind: string; label: string; total: number; sent: number; failed: number; status: string }[];
}

/** Today's email usage against the limit, active / inactive students, settings and the queue. */
export function EmailBudgetPanel({ compact }: { compact?: boolean }) {
  const [d, setD] = useState<BudgetData | null>(null);
  const [form, setForm] = useState<{ dailyLimit: string; announcementCap: string; activeDays: string } | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await fetch('/api/admin/email-budget');
    if (!r.ok) return;
    const j = await r.json() as BudgetData;
    setD(j);
    setForm({ dailyLimit: String(j.usage.dailyLimit), announcementCap: String(j.usage.announcementCap), activeDays: String(j.usage.activeDays) });
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  async function save() {
    if (!form) return;
    const r = await fetch('/api/admin/email-budget', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyLimit: Number(form.dailyLimit), announcementCap: Number(form.announcementCap), activeDays: Number(form.activeDays) }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Saved.' : j.error ?? 'Save failed.');
    if (r.ok) void load();
  }
  if (!d || !form) return <div style={{ fontSize: 12.5, color: SLATE }}>Loading email budget…</div>;
  const u = d.usage;
  const pct = Math.min(100, Math.round((u.total / Math.max(1, u.dailyLimit)) * 100));
  const queued = d.jobs.filter((j) => j.status === 'queued');
  const input = { padding: '5px 8px', borderRadius: 6, border: '1px solid #CBD5E1', width: 80, fontSize: 13 } as const;
  return (
    <div data-testid="email-budget-panel" style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Emails today ({u.day} UTC)</div>
          <div data-testid="email-budget-usage" style={{ fontSize: 22, fontWeight: 800, color: pct >= 90 ? '#B91C1C' : NAVY }}>{u.total} <span style={{ fontSize: 13, color: SLATE, fontWeight: 600 }}>of {u.dailyLimit}</span></div>
          <div style={{ height: 8, background: '#EEF2F7', borderRadius: 4, overflow: 'hidden', margin: '6px 0' }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? '#DC2626' : '#2E7D52' }} /></div>
          <div style={{ fontSize: 12, color: SLATE }}>{u.system} system, {u.announcement} announcement (cap {u.announcementCap}). <strong>{d.allowance}</strong> announcement emails may still go today.</div>
          {!u.tracking && <div style={{ fontSize: 12, color: '#9A5B00', marginTop: 4 }}>Counting starts once migration 255 is applied.</div>}
        </div>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Students</div>
          <div data-testid="email-budget-students" style={{ fontSize: 13.5, marginTop: 4 }}><strong>{d.students.active}</strong> active, <strong>{d.students.inactive}</strong> inactive <span style={{ color: SLATE }}>(last {u.activeDays} days)</span></div>
        </div>
      </div>
      {!compact && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
          <label>Daily limit <input style={input} type="number" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} /></label>
          <label>Announcements per day <input style={input} type="number" value={form.announcementCap} onChange={(e) => setForm({ ...form, announcementCap: e.target.value })} /></label>
          <label>Active means the last <input style={input} type="number" value={form.activeDays} onChange={(e) => setForm({ ...form, activeDays: e.target.value })} /> days</label>
          <button onClick={save} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: NAVY, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save</button>
          {msg && <span style={{ color: SLATE }}>{msg}</span>}
        </div>
      )}
      {d.jobs.length > 0 && (
        <div data-testid="email-budget-queue">
          <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Announcement queue{queued.length ? ` (${queued.length} waiting)` : ''}</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {d.jobs.slice(0, compact ? 3 : 10).map((j) => (
              <div key={j.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, alignItems: 'center' }}>
                <span style={{ minWidth: 90, color: SLATE }}>{new Date(j.created_at).toLocaleDateString('en-GB')}</span>
                <span style={{ flex: 1 }}>{j.label}</span>
                <span>{j.sent} / {j.total} sent{j.failed ? `, ${j.failed} failed` : ''}</span>
                <span style={{ fontWeight: 700, color: j.status === 'done' ? '#2E7D52' : '#9A5B00' }}>{j.status === 'done' ? 'Done' : 'Queued'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
