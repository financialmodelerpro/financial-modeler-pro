'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ModelSubmissionRow,
  ModelSubmissionStatusResult,
} from '@/src/hubs/training/lib/modelSubmission/types';

/**
 * Student-facing card that drives the model-submission gate (migration 148).
 *
 * State machine, top to bottom:
 *   - Soft-launch (announcementOnly && !required)
 *       Amber notice banner only. No upload UI. Students see the heads-up
 *       7+ days before enforcement starts.
 *   - Locked (required && latestStatus === 'none')
 *       Empty state. File picker + Submit button. Attempts chip 3/3.
 *   - Pending review (latestStatus === 'pending_review')
 *       Read-only. Shows submitted filename + date + SLA copy.
 *   - Approved (hasApproved)
 *       Green confirmation panel. Final exam is unlocked elsewhere.
 *   - Rejected, attempts remain
 *       Red banner + reviewer note + resubmit button.
 *   - Exhausted (attemptsUsed >= maxAttempts && !hasApproved)
 *       Read-only "Contact administrator" panel. Force-issue stays available
 *       to admin via the existing /admin/certificates/force-issue path.
 *
 * One-pending guard, attempts cap, file-type and size checks all live in the
 * POST route. The card pre-validates client-side too so a rejected upload
 * never leaves the browser.
 */

const ALLOWED_EXTS = ['xlsx', 'xls', 'xlsm', 'pdf'] as const;
const ALLOWED_ACCEPT = '.xlsx,.xls,.xlsm,.pdf';
const MAX_BYTES_DEFAULT = 10 * 1024 * 1024;

interface Props {
  courseCode: '3SFM' | 'BVM';
  courseLabel: string;
  initialStatus: ModelSubmissionStatusResult | null;
  /** Optional callback fired after a successful upload so the parent can refresh. */
  onSubmitted?: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return '';
  }
}

function StatusPill({ tone, label }: { tone: 'amber' | 'green' | 'red' | 'gray'; label: string }) {
  const palette = {
    amber: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
    green: { bg: '#DCFCE7', fg: '#166534', border: '#BBF7D0' },
    red:   { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' },
    gray:  { bg: '#F3F4F6', fg: '#374151', border: '#E5E7EB' },
  }[tone];
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      background: palette.bg,
      color: palette.fg,
      border: `1px solid ${palette.border}`,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>{label}</span>
  );
}

export function ModelSubmissionCard({ courseCode, courseLabel, initialStatus, onSubmitted }: Props) {
  const [status, setStatus] = useState<ModelSubmissionStatusResult | null>(initialStatus);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate / refresh from the dedicated GET when the parent didn't pass a
  // pre-loaded value, or after a successful submit.
  useEffect(() => {
    if (initialStatus) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/training/model-submission?courseCode=${encodeURIComponent(courseCode)}`);
        const json = await res.json() as { status?: ModelSubmissionStatusResult };
        if (alive && json.status) setStatus(json.status);
      } catch { /* ignore - card stays in skeleton state */ }
    })();
    return () => { alive = false; };
  }, [courseCode, initialStatus]);

  if (!status) return null;

  // Visibility gate. Card renders only when the gate applies to this course
  // OR the announcement-only soft-launch banner is on.
  if (!status.required && !status.announcementOnly) return null;

  function pickFile(f: File | null) {
    setError(null);
    setSuccess(null);
    if (!f) { setFile(null); return; }
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_EXTS.includes(ext as typeof ALLOWED_EXTS[number])) {
      setError('Allowed file types: .xlsx, .xls, .xlsm, .pdf');
      setFile(null);
      return;
    }
    const cap = (status?.maxAttempts ? MAX_BYTES_DEFAULT : MAX_BYTES_DEFAULT);
    if (f.size > cap) {
      setError(`File too large. Maximum size is ${(cap / 1024 / 1024).toFixed(0)} MB.`);
      setFile(null);
      return;
    }
    if (f.size === 0) { setError('File is empty.'); setFile(null); return; }
    setFile(f);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('courseCode', courseCode);
      if (notes.trim()) fd.append('studentNotes', notes.trim().slice(0, 2000));
      const res = await fetch('/api/training/model-submission', { method: 'POST', body: fd });
      const json = await res.json() as {
        ok?: boolean;
        error?: string;
        message?: string;
        submission?: { id: string; attempt_number: number; status: string; submitted_at: string };
      };
      if (!res.ok || !json.ok) {
        setError(json.message ?? json.error ?? 'Upload failed');
        return;
      }
      setSuccess('Submitted. An admin will review your model within 5 business days.');
      setFile(null);
      setNotes('');
      if (inputRef.current) inputRef.current.value = '';
      // Refresh status from the server so the card transitions to
      // pending_review with the freshly-stored row.
      const refreshed = await fetch(`/api/training/model-submission?courseCode=${encodeURIComponent(courseCode)}`);
      const refreshedJson = await refreshed.json() as { status?: ModelSubmissionStatusResult };
      if (refreshedJson.status) setStatus(refreshedJson.status);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  // ── Render branches ──────────────────────────────────────────────────

  // Soft-launch announcement (no upload UI)
  if (status.announcementOnly && !status.required) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #FFFBF0, #FFF3D6)',
        border: '1px solid #FDE68A',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 18 }}>📢</span>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#92400E' }}>
            Coming soon: Model submission required before the Final Exam
          </div>
          <StatusPill tone="amber" label="Heads-up" />
        </div>
        <div style={{ fontSize: 12.5, color: '#78350F', lineHeight: 1.55, marginLeft: 28 }}>
          Soon, before unlocking the Final Exam for <strong>{courseLabel}</strong>, you will need to submit
          the financial model you have built. An admin will review it on an effort-based pass/reject
          basis. You will get up to 3 attempts and a 5 business day review window. We will email you
          when this requirement goes live so you have time to prepare.
        </div>
      </div>
    );
  }

  // Approved
  if (status.hasApproved) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)',
        border: '1px solid #BBF7D0',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#166534' }}>
            Model Approved
          </div>
          <StatusPill tone="green" label="Approved" />
        </div>
        <div style={{ fontSize: 12.5, color: '#14532D', lineHeight: 1.55, marginLeft: 28 }}>
          Your model has been approved. The Final Exam for <strong>{courseLabel}</strong> is unlocked.
        </div>
      </div>
    );
  }

  // Pending review (one-pending guard)
  if (status.latestStatus === 'pending_review') {
    const latest = status.latest;
    return (
      <div style={{
        background: 'linear-gradient(135deg, #FFFBF0, #FFF3D6)',
        border: '1px solid #FDE68A',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#92400E' }}>
            Under Review
          </div>
          <StatusPill tone="amber" label="Pending Review" />
        </div>
        <div style={{ fontSize: 12.5, color: '#78350F', lineHeight: 1.55, marginLeft: 28 }}>
          {latest && (
            <>
              <div style={{ marginBottom: 4 }}>
                <strong>{latest.file_name}</strong> ({formatBytes(latest.file_size)}) submitted
                {latest.submitted_at ? ` on ${formatDate(latest.submitted_at)}` : ''}.
              </div>
            </>
          )}
          <div>
            Admin review typically takes up to 5 business days. You will be emailed when a decision is
            made. The Final Exam will unlock automatically on approval.
          </div>
        </div>
      </div>
    );
  }

  // Exhausted
  if (status.attemptsRemaining === 0 && status.attemptsUsed >= status.maxAttempts) {
    const latest = status.latest;
    return (
      <div style={{
        background: '#FEF2F2',
        border: '1px solid #FECACA',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 18 }}>📨</span>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#991B1B' }}>
            Contact Administrator
          </div>
          <StatusPill tone="red" label={`${status.attemptsUsed} of ${status.maxAttempts} attempts used`} />
        </div>
        <div style={{ fontSize: 12.5, color: '#7F1D1D', lineHeight: 1.55, marginLeft: 28 }}>
          {latest?.review_note && (
            <div style={{ marginBottom: 6, padding: '8px 10px', background: '#fff', border: '1px solid #FECACA', borderRadius: 6, fontStyle: 'italic' }}>
              Last reviewer note: {latest.review_note}
            </div>
          )}
          You have used all {status.maxAttempts} of your model submission attempts. Please email the
          administrator to discuss next steps.
        </div>
      </div>
    );
  }

  // Rejected with attempts remaining, OR locked (none) - both render the
  // upload UI. Differs only in the header copy.
  const isResubmit = status.latestStatus === 'rejected';
  const latest = status.latest;
  const remaining = status.attemptsRemaining;

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${isResubmit ? '#FECACA' : '#E5E7EB'}`,
      borderRadius: 12,
      padding: '18px 20px',
      marginBottom: 20,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18 }}>{isResubmit ? '🔁' : '📤'}</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A' }}>
          {isResubmit ? 'Resubmit Your Model' : 'Submit Your Financial Model'}
        </div>
        <StatusPill
          tone={isResubmit ? 'red' : 'gray'}
          label={isResubmit ? 'Rejected' : 'Required'}
        />
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280', fontWeight: 600 }}>
          {remaining} of {status.maxAttempts} attempts remaining
        </span>
      </div>

      {/* Reviewer note when rejected */}
      {isResubmit && latest?.review_note && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          background: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: 8,
          fontSize: 12.5,
          color: '#7F1D1D',
          lineHeight: 1.5,
        }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>Reviewer note</strong>
          {latest.review_note}
        </div>
      )}

      {/* Explainer */}
      <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.55, marginBottom: 12 }}>
        Build your own financial model for <strong>{courseLabel}</strong> and upload it as an Excel file
        (.xlsx, .xls, .xlsm) or PDF. An admin will review it within 5 business days. Approval unlocks
        the Final Exam. Each rejection consumes one of your 3 attempts.
      </div>

      {/* File picker */}
      <div style={{ marginBottom: 10 }}>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_ACCEPT}
          onChange={e => pickFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          style={{
            display: 'block',
            width: '100%',
            fontSize: 12,
            padding: '8px 10px',
            border: '1px dashed #D1D5DB',
            borderRadius: 8,
            background: '#F9FAFB',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        />
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
          Allowed: .xlsx, .xls, .xlsm, .pdf · Max 10 MB
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 10 }}>
        <label htmlFor={`mn-${courseCode}`} style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Notes for the reviewer (optional)
        </label>
        <textarea
          id={`mn-${courseCode}`}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={busy}
          rows={2}
          maxLength={2000}
          placeholder="Anything the reviewer should know? Sources, assumptions, scope tweaks..."
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            fontSize: 12,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Errors / success */}
      {error && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, fontSize: 12, color: '#991B1B' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, fontSize: 12, color: '#166534' }}>
          {success}
        </div>
      )}

      {/* Submit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={submit}
          disabled={!file || busy}
          style={{
            padding: '9px 18px',
            borderRadius: 8,
            background: !file || busy ? '#9CA3AF' : '#1B4F8A',
            color: '#fff',
            border: 'none',
            cursor: !file || busy ? 'not-allowed' : 'pointer',
            fontSize: 12.5,
            fontWeight: 700,
          }}
        >
          {busy ? 'Uploading…' : isResubmit ? 'Resubmit for Review' : 'Submit for Review'}
        </button>
        {file && (
          <span style={{ fontSize: 12, color: '#374151' }}>
            {file.name} <span style={{ color: '#9CA3AF' }}>({formatBytes(file.size)})</span>
          </span>
        )}
      </div>
    </div>
  );
}

export type { ModelSubmissionRow };
