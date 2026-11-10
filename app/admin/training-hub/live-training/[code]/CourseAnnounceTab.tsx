'use client';

/**
 * Send course announcement (2026-11-10, founder): ONE email for the whole
 * course (title, tagline, start date, the full schedule in KSA, the Enrol
 * link), never one per session. Same audience choices as the session
 * announcement; the count shows before sending; today's share goes out now and
 * the rest is queued for the next days (the daily email budget).
 */
import { useCallback, useEffect, useState } from 'react';
import type { LiveCourseSettings } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { AudiencePicker, AudienceCountLine, EmailBudgetPanel, audienceQuery, DEFAULT_AUDIENCE, type AudienceValue } from '../AnnouncementAudience';

const NAVY = '#0D2E5A';

export function CourseAnnounceTab({ course }: { course: LiveCourseSettings }) {
  // Default: active students not yet enrolled in THIS course is a natural pick, but the founder's default is Active students.
  const [aud, setAud] = useState<AudienceValue>({ ...DEFAULT_AUDIENCE, courseCode: course.courseCode });
  const [info, setInfo] = useState<{ counts: { total: number; excludedUnsubscribed: number; excludedBounced: number }; allowance: number; published: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string>('');
  const [budgetKey, setBudgetKey] = useState(0);

  const count = useCallback(async () => {
    setInfo(null);
    const r = await fetch(`/api/admin/live-course/${course.courseCode}/announce?${audienceQuery(aud)}`);
    if (r.ok) setInfo(await r.json());
  }, [aud, course.courseCode]);
  useEffect(() => { void count(); }, [count]);

  async function send() {
    setBusy(true); setResult('');
    try {
      const r = await fetch(`/api/admin/live-course/${course.courseCode}/announce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aud) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setResult(j.error ?? 'Send failed.'); return; }
      setResult(`Sent ${j.sentNow}${j.failedNow ? `, ${j.failedNow} failed` : ''}.${j.queued ? ` ${j.queued} queued for the next days.` : ''}${j.notSent ? ` ${j.notSent} NOT sent: apply migration 255 to queue them.` : ''}`);
      setConfirm(false); setBudgetKey((k) => k + 1); void count();
    } finally { setBusy(false); }
  }

  const needsCourse = aud.audience === 'enrolled' || aud.audience === 'not_enrolled';
  return (
    <div data-testid="course-announce-tab" style={{ display: 'grid', gap: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>Send course announcement</div>
          <div style={{ fontSize: 12.5, color: '#6B7280', marginTop: 4 }}>One email for the whole course: title, tagline, start date, every session with its KSA date and time, and the Enrol button. Sessions of a course are never announced on their own.</div>
        </div>
        {info && !info.published && <div style={{ fontSize: 12.5, color: '#9A5B00' }}>Publish the course before announcing it.</div>}
        <AudiencePicker value={aud} onChange={(v) => { setAud(v); setConfirm(false); }} disabled={busy} />
        <AudienceCountLine counts={info?.counts ?? null} allowance={info?.allowance ?? null} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!confirm ? (
            <button data-testid="course-announce-send" disabled={busy || !info || !info.published || info.counts.total === 0 || (needsCourse && !aud.courseCode)} onClick={() => setConfirm(true)}
              style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: NAVY, color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: busy || !info || !info.published || info.counts.total === 0 ? 0.5 : 1 }}>Send course announcement</button>
          ) : (
            <>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Send to {info?.counts.total} recipients?</span>
              <button data-testid="course-announce-confirm" disabled={busy} onClick={send} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#B91C1C', color: '#fff', fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Sending…' : 'Yes, send'}</button>
              <button disabled={busy} onClick={() => setConfirm(false)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer' }}>Cancel</button>
            </>
          )}
          {result && <span data-testid="course-announce-result" style={{ fontSize: 13, color: '#374151' }}>{result}</span>}
        </div>
      </div>
      <EmailBudgetPanel key={budgetKey} compact />
    </div>
  );
}
