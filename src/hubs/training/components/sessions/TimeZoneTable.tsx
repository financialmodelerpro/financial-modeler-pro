'use client';

/**
 * THE time zone table (course page, session pages, and collapsed on the
 * course card). Computed from the stored instant with IANA zones
 * (liveCourse/timeZones.ts). "Your local time" is read from the visitor's
 * browser after mount, so the server render and the first client render agree.
 */
import { useEffect, useState } from 'react';
import { zoneTimes, regionsFor, regionLabel, type ZoneTime } from '@/src/hubs/training/lib/liveCourse/timeZones';
import { KSA_TZ } from '@/src/hubs/training/lib/liveCourse/time';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';

export function TimeZoneTable({
  iso, zones, baseTz = KSA_TZ, collapsible = false, title = 'Times in your region', anchorId,
}: {
  iso: string | null | undefined;
  /** The course's IANA zones; null = the default list. */
  zones?: string[] | null;
  baseTz?: string;
  collapsible?: boolean;
  /** An id to link to (emails link #time-zones); the table opens when the page arrives on it. */
  anchorId?: string;
  title?: string;
}) {
  const [local, setLocal] = useState<ZoneTime | null>(null);
  // Arriving on #<anchorId> (the course emails' "See the time in your region") opens the table.
  const [openFromHash, setOpenFromHash] = useState(false);
  useEffect(() => {
    if (!anchorId) return;
    const t = setTimeout(() => { if (typeof window !== 'undefined' && window.location.hash === `#${anchorId}`) setOpenFromHash(true); }, 0);
    return () => clearTimeout(t);
  }, [anchorId]);
  useEffect(() => {
    if (!iso) return;
    // Deferred one tick (like the hash read above) so the state is set from a callback, not the effect body.
    const t = setTimeout(() => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) setLocal(zoneTimes(iso, [{ tz, label: `Your local time (${regionLabel(tz)})` }], baseTz)[0] ?? null);
      } catch { /* no zone: the line is simply omitted */ }
    }, 0);
    return () => clearTimeout(t);
  }, [iso, baseTz]);

  if (!iso) return null;
  const rows = zoneTimes(iso, regionsFor(zones), baseTz);
  if (!rows.length) return null;

  const table = (
    <table data-testid="time-zone-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <tbody>
        {local && (
          <tr data-testid="time-zone-local" style={{ background: '#E7F4EC' }}>
            <td style={{ padding: '6px 10px', fontWeight: 700, color: '#2E7D52' }}>{local.label}</td>
            <td style={{ padding: '6px 10px', fontWeight: 700, color: '#2E7D52', whiteSpace: 'nowrap' }}>{local.weekday} {local.time}</td>
            <td style={{ padding: '6px 10px', color: '#2E7D52', whiteSpace: 'nowrap' }}>{local.dayMark}</td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.tz} style={{ borderBottom: `1px solid ${PALE}` }}>
            <td style={{ padding: '6px 10px', color: '#2A3440' }}>{r.label}</td>
            <td style={{ padding: '6px 10px', fontWeight: 600, color: NAVY, whiteSpace: 'nowrap' }}>{r.weekday} {r.time}</td>
            <td style={{ padding: '6px 10px', color: r.dayOffset ? '#9A5B00' : SLATE, fontWeight: r.dayOffset ? 700 : 400, whiteSpace: 'nowrap' }}>{r.dayMark}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (collapsible) {
    return (
      <details id={anchorId} open={openFromHash || undefined} style={{ marginTop: 10, scrollMarginTop: 90 }}>
        <summary style={{ cursor: 'pointer', color: NAVY, fontWeight: 700, fontSize: 13 }}>See times in your region</summary>
        <div style={{ marginTop: 8 }}>{table}</div>
      </details>
    );
  }
  return (
    <div style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontWeight: 800, color: NAVY, fontSize: 14, marginBottom: 6 }}>{title}</div>
      {table}
    </div>
  );
}
