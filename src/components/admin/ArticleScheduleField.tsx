'use client';

/**
 * Publish date + time picker for a scheduled article (migration 198). The caller
 * renders it only when Status is "Scheduled".
 *
 * An <input type="datetime-local"> holds wall-clock text with NO timezone, so the
 * value is read and written in the ADMIN'S BROWSER timezone and converted to UTC on
 * the way to the API (the DB column is timestamptz). The resolved zone is shown
 * beside the field on purpose: "09:00" is ambiguous otherwise, and the one thing a
 * scheduling feature cannot afford is the admin being unsure which 09:00 they picked.
 */

import { useMemo } from 'react';

/** UTC ISO -> the wall-clock text a datetime-local input expects (browser-local). */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local wall-clock text (browser-local) -> UTC ISO for the API. */
export function toUtcIso(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface Props {
  /** datetime-local wall-clock text, browser-local. */
  value: string;
  onChange: (value: string) => void;
  inputStyle: React.CSSProperties;
  error?: string;
}

export function ArticleScheduleField({ value, onChange, inputStyle, error }: Props) {
  const tz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
  }, []);

  const parsed = value ? new Date(value) : null;
  const valid  = !!parsed && !Number.isNaN(parsed.getTime());
  const isPast = valid && parsed!.getTime() <= Date.now();

  const pretty = valid
    ? parsed!.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Publish at
      </label>
      <input
        type="datetime-local"
        value={value}
        onChange={e => onChange(e.target.value)}
        data-testid="article-schedule-at"
        style={{ ...inputStyle, border: `1px solid ${error ? '#DC2626' : '#D1D5DB'}` }}
      />
      {error ? (
        <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600, marginTop: 5 }}>{error}</div>
      ) : !valid ? (
        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 5, lineHeight: 1.5 }}>
          Pick the date and time this article goes live.{tz ? ` Times are in ${tz}.` : ''}
        </div>
      ) : isPast ? (
        <div style={{ fontSize: 11, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 6, padding: '6px 8px', marginTop: 5, lineHeight: 1.5 }}>
          That time has already passed. Saving will publish this article right away.
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#1A7A30', fontWeight: 600, marginTop: 5, lineHeight: 1.5 }}>
          Goes live automatically on {pretty}{tz ? ` (${tz})` : ''}.
        </div>
      )}
    </div>
  );
}
