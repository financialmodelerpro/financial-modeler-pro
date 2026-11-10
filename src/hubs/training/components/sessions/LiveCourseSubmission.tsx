'use client';

/**
 * The model submission panel for a live course: status, the eligibility gate,
 * attempts and the lock, and the upload. ONE component, rendered on the course
 * page and in the dashboard's My Model tab, so both read the same status route
 * (getModelSubmissionStatus) and post to the same submission route, which
 * enforces the gate, the attempt cap and the lock on the server.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const GREEN = '#2E7D52';
const PALE = '#E8EEF7';

interface SubmissionStatus {
  required: boolean; hasApproved: boolean; latestStatus: 'none' | 'pending_review' | 'approved' | 'rejected';
  attemptsUsed: number; attemptsRemaining: number; maxAttempts: number; locked: boolean;
  eligibleToSubmit: boolean | null; guidance: string; sampleUrl: string | null;
  latest: { id: string; file_name: string; attempt_number: number; review_note: string | null; reviewed_file_name: string | null } | null;
}

/**
 * The model submission for a live course. Reuses the existing submission
 * system (same route, bucket, review queue and emails); this is only the
 * view of it. `title` null drops the heading (My Model heads the section itself).
 */
export function LiveCourseSubmission({ courseCode, onChange, title = 'Model submission' }: { courseCode: string; onChange?: () => void; title?: string | null }) {
  const [st, setSt] = useState<SubmissionStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/training/model-submission?courseCode=${encodeURIComponent(courseCode)}`);
    const j = await r.json() as { status?: SubmissionStatus };
    setSt(j.status ?? null);
  }, [courseCode]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('courseCode', courseCode); fd.append('studentNotes', notes);
      const r = await fetch('/api/training/model-submission', { method: 'POST', body: fd });
      const j = await r.json() as { error?: string; message?: string };
      if (!r.ok) { setMsg({ ok: false, text: j.message ?? j.error ?? 'Upload failed.' }); return; }
      setMsg({ ok: true, text: 'Submitted. You will get an email when it has been reviewed.' });
      setFile(null); setNotes('');
      await load(); onChange?.();
    } finally { setBusy(false); }
  }

  if (!st) return null;
  const box = (testid: string, bg: string, border: string, children: ReactNode) => (
    <div data-testid={testid} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 16px', fontSize: 14, lineHeight: 1.55 }}>{children}</div>
  );
  const latest = st.latest;
  const reviewedLink = latest?.reviewed_file_name
    ? <a href={`/api/training/model-submission/${latest.id}/reviewed-file`} style={{ color: NAVY, fontWeight: 700 }}>Download the reviewed model ({latest.reviewed_file_name})</a>
    : null;

  let body: ReactNode;
  if (st.hasApproved) {
    body = box('submission-approved', '#E7F4EC', '#B7DFC5', <><strong style={{ color: GREEN }}>✓ Your model is approved.</strong> Your certificate is issued by email.{reviewedLink && <div style={{ marginTop: 6 }}>{reviewedLink}</div>}</>);
  } else if (!st.eligibleToSubmit) {
    body = box('submission-gate-locked', '#F5F7FA', '#E2E8F0', 'Model submission unlocks once every session is complete: attended live, or its recording watched in full.');
  } else if (st.latestStatus === 'pending_review') {
    body = box('submission-pending', '#EFF6FF', '#BFDBFE', <>Attempt {latest?.attempt_number} of {st.maxAttempts} (<strong>{latest?.file_name}</strong>) is being reviewed. You will get an email with the result.</>);
  } else if (st.locked) {
    body = box('submission-attempts-locked', '#FEF2F2', '#FECACA', <>
      <strong style={{ color: '#B91C1C' }}>Uploads are locked.</strong> You have used all {st.maxAttempts} attempts and the last one was not approved.
      Please contact us; the administrator can reset your attempts.
      {latest?.review_note && <div style={{ marginTop: 8 }}><strong>Last reviewer note:</strong> {latest.review_note}</div>}
      {reviewedLink && <div style={{ marginTop: 6 }}>{reviewedLink}</div>}
    </>);
  } else {
    body = (
      <div data-testid="submission-upload" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: '14px 16px' }}>
        {st.latestStatus === 'rejected' && latest && (
          <div data-testid="submission-rejected" style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>
            <strong>Attempt {latest.attempt_number} was not approved.</strong> {st.attemptsRemaining} of {st.maxAttempts} attempts left.
            {latest.review_note && <div style={{ marginTop: 6 }}><strong>Reviewer note:</strong> {latest.review_note}</div>}
            {reviewedLink && <div style={{ marginTop: 6 }}>{reviewedLink}</div>}
          </div>
        )}
        <div style={{ fontSize: 14, marginBottom: 10 }}>
          Upload your model (Excel or PDF, up to 10 MB). Attempt {st.attemptsUsed + 1} of {st.maxAttempts}.
          {st.sampleUrl && <> <a href={st.sampleUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>Sample template</a></>}
        </div>
        {st.guidance && <div style={{ fontSize: 13, color: SLATE, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{st.guidance}</div>}
        <input data-testid="submission-file" type="file" accept=".xlsx,.xls,.xlsm,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <textarea placeholder="Notes for the reviewer (optional)" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 10, minHeight: 60, padding: 8, borderRadius: 6, border: '1px solid #CBD5E1', fontFamily: 'inherit' }} />
        <button data-testid="submission-submit" onClick={submit} disabled={!file || busy} style={{ marginTop: 10, background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 800, cursor: !file || busy ? 'not-allowed' : 'pointer', opacity: !file || busy ? 0.6 : 1 }}>
          {busy ? 'Uploading…' : 'Submit model'}
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: title ? 24 : 0 }}>
      {title && <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>{title}</h2>}
      {body}
      {msg && <div data-testid="submission-message" style={{ marginTop: 8, fontSize: 13, color: msg.ok ? GREEN : '#B91C1C' }}>{msg.text}</div>}
    </div>
  );
}
