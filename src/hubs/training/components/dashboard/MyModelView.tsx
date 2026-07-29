'use client';

import { useEffect, useState } from 'react';
import type { ModelAttemptView } from '@/src/hubs/training/lib/modelSubmission/types';

/**
 * "My Model" dashboard view.
 *
 * The single home for a student's model submissions. Before this the reviewed
 * model was only reachable inside a course tab, in the approved state, for the
 * LATEST attempt, so earlier feedback disappeared on resubmission and nothing
 * in the sidebar pointed at any of it.
 *
 * Shows, per course, every attempt with: status, the file the student sent,
 * the reviewer's note, and the marked-up model returned by the reviewer (which
 * now comes back on a reject as well as an approve).
 *
 * Read-only. Submitting still happens on the course tab's ModelSubmissionCard,
 * which owns the upload state machine and the attempt guard.
 *
 * No em dashes in this file.
 */

const COURSE_LABELS: Record<string, string> = {
  '3SFM': '3-Statement Financial Modeling',
  BVM: 'Business Valuation Modeling',
};

type CoursesPayload = Record<string, ModelAttemptView[]>;

const STATUS_TONE: Record<string, { bg: string; fg: string; border: string; label: string; dot: string }> = {
  approved:       { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: 'Approved',       dot: '#16A34A' },
  rejected:       { bg: '#FEF2F2', fg: '#991B1B', border: '#FECACA', label: 'Needs work',     dot: '#DC2626' },
  pending_review: { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A', label: 'Under review',   dot: '#D97706' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function fmtSize(bytes: number | null): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function DownloadLink({ href, label, sub, tone, testId }: {
  href: string; label: string; sub?: string; tone: 'own' | 'reviewed'; testId?: string;
}) {
  const isReviewed = tone === 'reviewed';
  return (
    <a
      href={href}
      data-testid={testId}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
        background: isReviewed ? '#166534' : '#fff',
        color: isReviewed ? '#fff' : '#374151',
        border: `1px solid ${isReviewed ? '#166534' : '#E5E7EB'}`,
        borderRadius: 8, padding: '9px 13px', fontSize: 12.5, fontWeight: 700,
        flex: '1 1 240px', minWidth: 0,
      }}
    >
      <span style={{ fontSize: 14 }} aria-hidden>{isReviewed ? '📝' : '📄'}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block' }}>{label}</span>
        {sub && (
          <span style={{ display: 'block', fontWeight: 500, fontSize: 11, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sub}
          </span>
        )}
      </span>
      <span style={{ marginLeft: 'auto', fontSize: 13 }} aria-hidden>⬇</span>
    </a>
  );
}

function AttemptCard({ a }: { a: ModelAttemptView }) {
  const tone = STATUS_TONE[a.status] ?? STATUS_TONE.pending_review;
  return (
    <div style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone.dot, flexShrink: 0 }} aria-hidden />
        <span style={{ fontSize: 13.5, fontWeight: 800, color: tone.fg }}>Attempt {a.attemptNumber}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: tone.fg, background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 20, padding: '2px 10px' }}>
          {tone.label}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#6B7280' }}>
          Submitted {fmtDate(a.submittedAt)}
          {a.reviewedAt ? ` · reviewed ${fmtDate(a.reviewedAt)}` : ''}
        </span>
      </div>

      {a.reviewNote && (
        <div style={{ background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: tone.fg, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Reviewer comment
          </div>
          <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{a.reviewNote}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <DownloadLink
          href={`/api/training/model-submission/${a.id}/file`}
          label="Your submission"
          sub={[a.fileName, fmtSize(a.fileSize)].filter(Boolean).join(' · ')}
          tone="own"
          testId="own-model-download"
        />
        {a.hasReviewedFile ? (
          <DownloadLink
            href={`/api/training/model-submission/${a.id}/reviewed-file`}
            label="Reviewed model"
            sub={[a.reviewedFileName, fmtSize(a.reviewedFileSize)].filter(Boolean).join(' · ')}
            tone="reviewed"
            testId="reviewed-model-download"
          />
        ) : (
          <div style={{
            flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8,
            border: '1px dashed #D1D5DB', background: '#fff', padding: '9px 13px', fontSize: 11.5, color: '#9CA3AF',
          }}>
            {a.status === 'pending_review'
              ? 'Reviewed model appears here once your reviewer responds.'
              : 'No marked-up model was returned for this attempt.'}
          </div>
        )}
      </div>
    </div>
  );
}

export function MyModelView({ enrolledCourses }: { enrolledCourses: string[] }) {
  const [courses, setCourses] = useState<CoursesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/training/model-submission/history');
        const j = await res.json() as { ok?: boolean; courses?: CoursesPayload; error?: string };
        if (cancelled) return;
        if (!res.ok || !j.ok) { setError(j.error ?? 'Could not load your submissions.'); }
        else { setCourses(j.courses ?? {}); }
      } catch {
        if (!cancelled) setError('Could not load your submissions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Show a course when the student is enrolled OR has already submitted for it.
  const visible = (['3SFM', 'BVM'] as const).filter(code => {
    const enrolled = enrolledCourses.includes(code.toLowerCase());
    return enrolled || (courses?.[code]?.length ?? 0) > 0;
  });

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0D2E5A', margin: '0 0 6px' }}>My Model</h1>
        <p style={{ fontSize: 13.5, color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
          Every model you have submitted, the reviewer&apos;s comments, and the marked-up model they sent back.
          Submit or resubmit from the course page.
        </p>
      </div>

      {loading && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13.5 }}>Loading your submissions…</div>
      )}

      {!loading && error && (
        <div style={{ padding: '14px 16px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }} aria-hidden>📄</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>No model submissions yet</div>
          <div style={{ fontSize: 12.5, color: '#9CA3AF' }}>Open your course to submit your model for review.</div>
        </div>
      )}

      {!loading && !error && visible.map(code => {
        const attempts = courses?.[code] ?? [];
        return (
          <section key={code} style={{ marginBottom: 30 }} data-testid={`my-model-course-${code}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A', margin: 0 }}>{COURSE_LABELS[code] ?? code}</h2>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', background: '#F3F4F6', borderRadius: 20, padding: '2px 10px' }}>
                {attempts.length === 0 ? 'Not submitted' : `${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {attempts.length === 0 ? (
              <div style={{ padding: '18px 20px', background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: 10, fontSize: 12.5, color: '#9CA3AF' }}>
                You have not submitted a model for this course yet.
              </div>
            ) : (
              attempts.map(a => <AttemptCard key={a.id} a={a} />)
            )}
          </section>
        );
      })}
    </div>
  );
}
