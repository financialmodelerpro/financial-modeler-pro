'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import type { ModelSubmissionRow } from '@/src/hubs/training/lib/modelSubmission/types';

/**
 * Admin review queue for student model submissions (migration 148, Phase D).
 *
 * Default view = pending_review. Status pills + course pills filter the
 * list. The review modal is the only place an admin can change a row's
 * state, so the API surface stays narrow: GET (list), POST (review).
 */

interface RowDecorated extends ModelSubmissionRow {
  student_name: string;
  registration_id: string;
}

const NAVY = '#1B3A6B';
const BLUE = '#1B4F8A';
const GREEN = '#2EAA4A';
const AMBER = '#F59E0B';
const RED = '#DC2626';
const BORDER = '#E5E7EB';

type StatusFilter = 'pending_review' | 'approved' | 'rejected' | 'all';
type CourseFilter = '3SFM' | 'BVM' | 'all';

const STATUS_LABEL: Record<RowDecorated['status'], string> = {
  pending_review: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_COLOR: Record<RowDecorated['status'], { bg: string; fg: string; border: string }> = {
  pending_review: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  approved:       { bg: '#DCFCE7', fg: '#166534', border: '#BBF7D0' },
  rejected:       { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso ?? '';
  }
}

export default function AdminModelSubmissionsPage() {
  const [rows, setRows] = useState<RowDecorated[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending_review');
  const [courseFilter, setCourseFilter] = useState<CourseFilter>('all');
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState<RowDecorated | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busyDecision, setBusyDecision] = useState<'approve' | 'reject' | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        status: statusFilter,
        course: courseFilter,
        limit: '100',
      });
      if (search.trim()) qs.set('search', search.trim());
      const res = await fetch(`/api/admin/model-submissions?${qs.toString()}`);
      const json = await res.json() as {
        rows?: RowDecorated[];
        totalCount?: number;
        pendingCount?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.rows ?? []);
      setTotalCount(json.totalCount ?? 0);
      setPendingCount(json.pendingCount ?? 0);
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, courseFilter, search, showToast]);

  useEffect(() => { void load(); }, [load]);

  function openReview(row: RowDecorated) {
    setReviewing(row);
    setReviewNote('');
  }
  function closeReview() {
    if (busyDecision) return;
    setReviewing(null);
    setReviewNote('');
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!reviewing) return;
    if (decision === 'reject' && !reviewNote.trim()) {
      showToast('A reviewer note is required when rejecting.', 'err');
      return;
    }
    setBusyDecision(decision);
    try {
      const res = await fetch(`/api/admin/model-submissions/${reviewing.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: reviewNote.trim() }),
      });
      const json = await res.json() as {
        ok?: boolean;
        error?: string;
        message?: string;
        emailSent?: boolean;
        attemptsRemaining?: number;
      };
      if (!res.ok || !json.ok) throw new Error(json.message ?? json.error ?? 'Review failed');
      showToast(
        decision === 'approve'
          ? `Approved. ${json.emailSent ? 'Student emailed.' : 'Email failed - check Resend logs.'}`
          : `Rejected. ${json.attemptsRemaining ?? 0} attempt${(json.attemptsRemaining ?? 0) === 1 ? '' : 's'} remaining for student. ${json.emailSent ? 'Student emailed.' : 'Email failed - check Resend logs.'}`,
        'ok',
      );
      setReviewing(null);
      setReviewNote('');
      await load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setBusyDecision(null);
    }
  }

  const headerStat = useMemo(() => {
    if (statusFilter === 'all') return `${totalCount} total`;
    if (statusFilter === 'pending_review') return `${totalCount} pending`;
    if (statusFilter === 'approved') return `${totalCount} approved`;
    return `${totalCount} rejected`;
  }, [statusFilter, totalCount]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/model-submissions" badges={{ '/admin/training-hub/model-submissions': pendingCount }} />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
              Model Submissions
            </h1>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
              Review student-built financial models. Approve unlocks the Final Exam; reject consumes one of the student&apos;s 3 attempts and sends them a note.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {pendingCount > 0 && (
              <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                🔍 {pendingCount} pending review
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <FilterPills
            label="Status"
            value={statusFilter}
            options={[
              { value: 'pending_review', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ]}
            onChange={v => setStatusFilter(v as StatusFilter)}
          />
          <FilterPills
            label="Course"
            value={courseFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: '3SFM', label: '3SFM' },
              { value: 'BVM', label: 'BVM' },
            ]}
            onChange={v => setCourseFilter(v as CourseFilter)}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search email or filename"
              style={{
                padding: '8px 10px',
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                fontSize: 12,
                width: 240,
                fontFamily: 'inherit',
              }}
            />
            <button onClick={() => void load()} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: BLUE, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Refresh
            </button>
          </div>
        </div>

        {/* Status line */}
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
          {loading ? 'Loading...' : headerStat}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
          {rows.length === 0 && !loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              {statusFilter === 'pending_review'
                ? 'No submissions waiting for review. Nice.'
                : 'No submissions match these filters.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <Th>Student</Th>
                  <Th>Course</Th>
                  <Th>Attempt</Th>
                  <Th>File</Th>
                  <Th>Submitted</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const palette = STATUS_COLOR[r.status];
                  return (
                    <tr key={r.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <Td>
                        <div style={{ fontWeight: 700, color: NAVY }}>{r.student_name || '(unnamed)'}</div>
                        <div style={{ fontSize: 11, color: '#6B7280' }}>{r.email}</div>
                        {r.registration_id && (
                          <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' }}>{r.registration_id}</div>
                        )}
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: '#EFF6FF', color: BLUE, fontWeight: 700, fontSize: 11 }}>
                          {r.course_code}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ fontWeight: 700 }}>{r.attempt_number}</span>
                        <span style={{ color: '#9CA3AF' }}> / 3</span>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 600, color: NAVY, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.file_name}>
                          {r.file_name}
                        </div>
                        <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                          {formatBytes(r.file_size)} · {(r.mime_type ?? '').split('/').pop() || ''}
                        </div>
                      </Td>
                      <Td>{formatDateTime(r.submitted_at)}</Td>
                      <Td>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}`, fontSize: 11, fontWeight: 700 }}>
                          {STATUS_LABEL[r.status]}
                        </span>
                        {r.status !== 'pending_review' && r.reviewed_at && (
                          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                            {formatDateTime(r.reviewed_at)}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <a
                            href={`/api/admin/model-submissions/${r.id}/file`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ padding: '6px 10px', borderRadius: 5, border: `1px solid ${BORDER}`, background: '#fff', color: NAVY, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}
                          >
                            ⬇ Download
                          </a>
                          {r.status === 'pending_review' ? (
                            <button onClick={() => openReview(r)} style={{ padding: '6px 12px', borderRadius: 5, border: 'none', background: BLUE, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                              Review
                            </button>
                          ) : (
                            <button onClick={() => openReview(r)} style={{ padding: '6px 12px', borderRadius: 5, border: `1px solid ${BORDER}`, background: '#F8FAFC', color: '#6B7280', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                              View
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', bottom: 20, right: 20,
            padding: '12px 18px', borderRadius: 8,
            background: toast.type === 'ok' ? '#1F2937' : '#7F1D1D',
            color: '#fff', fontSize: 12.5, fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            maxWidth: 360, lineHeight: 1.5,
          }}>
            {toast.msg}
          </div>
        )}

        {/* Review modal */}
        {reviewing && (
          <div
            onClick={closeReview}
            style={{ position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    {reviewing.course_code} · Attempt {reviewing.attempt_number} of 3
                  </div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: 0 }}>
                    {reviewing.student_name || reviewing.email}
                  </h2>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                    {reviewing.email}{reviewing.registration_id ? ` · ${reviewing.registration_id}` : ''}
                  </div>
                </div>
                <button
                  onClick={closeReview}
                  disabled={!!busyDecision}
                  style={{ background: 'transparent', border: 'none', fontSize: 22, color: '#9CA3AF', cursor: busyDecision ? 'not-allowed' : 'pointer', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>

              <div style={{ background: '#F8FAFC', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 4, wordBreak: 'break-all' }}>
                  {reviewing.file_name}
                </div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  {formatBytes(reviewing.file_size)} · submitted {formatDateTime(reviewing.submitted_at)}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a
                    href={`/api/admin/model-submissions/${reviewing.id}/file`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ padding: '7px 12px', borderRadius: 5, border: `1px solid ${BORDER}`, background: '#fff', color: NAVY, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
                  >
                    ⬇ Download to review
                  </a>
                  {(reviewing.mime_type ?? '').includes('pdf') && (
                    <a
                      href={`/api/admin/model-submissions/${reviewing.id}/file?inline=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ padding: '7px 12px', borderRadius: 5, border: `1px solid ${BORDER}`, background: '#fff', color: NAVY, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
                    >
                      👁 Preview PDF
                    </a>
                  )}
                </div>
              </div>

              {reviewing.student_notes && (
                <div style={{ marginBottom: 12, padding: '10px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Student note
                  </div>
                  <div style={{ fontSize: 12.5, color: '#78350F', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                    {reviewing.student_notes}
                  </div>
                </div>
              )}

              {reviewing.status !== 'pending_review' ? (
                <div style={{ padding: '12px 14px', background: STATUS_COLOR[reviewing.status].bg, border: `1px solid ${STATUS_COLOR[reviewing.status].border}`, borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[reviewing.status].fg, marginBottom: 6 }}>
                    {STATUS_LABEL[reviewing.status]} on {formatDateTime(reviewing.reviewed_at)}
                    {reviewing.reviewed_by_admin ? ` by ${reviewing.reviewed_by_admin}` : ''}
                  </div>
                  {reviewing.review_note && (
                    <div style={{ fontSize: 12.5, color: STATUS_COLOR[reviewing.status].fg, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                      {reviewing.review_note}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Reviewer note (required when rejecting)
                  </label>
                  <textarea
                    value={reviewNote}
                    onChange={e => setReviewNote(e.target.value)}
                    rows={4}
                    maxLength={3000}
                    placeholder="What worked, what needs another pass. The student sees this verbatim."
                    disabled={!!busyDecision}
                    style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                  />

                  <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      onClick={closeReview}
                      disabled={!!busyDecision}
                      style={{ padding: '9px 16px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: '#374151', fontSize: 12.5, fontWeight: 700, cursor: busyDecision ? 'not-allowed' : 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void decide('reject')}
                      disabled={!!busyDecision || !reviewNote.trim()}
                      style={{ padding: '9px 18px', borderRadius: 6, border: 'none', background: !reviewNote.trim() ? '#FCA5A5' : RED, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: !!busyDecision || !reviewNote.trim() ? 'not-allowed' : 'pointer' }}
                    >
                      {busyDecision === 'reject' ? 'Rejecting...' : '✕ Reject'}
                    </button>
                    <button
                      onClick={() => void decide('approve')}
                      disabled={!!busyDecision}
                      style={{ padding: '9px 18px', borderRadius: 6, border: 'none', background: GREEN, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: busyDecision ? 'not-allowed' : 'pointer' }}
                    >
                      {busyDecision === 'approve' ? 'Approving...' : '✓ Approve'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function FilterPills<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              style={{
                padding: '6px 12px',
                borderRadius: 16,
                border: active ? '1px solid ' + BLUE : `1px solid ${BORDER}`,
                background: active ? BLUE : '#fff',
                color: active ? '#fff' : '#374151',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
      {children}
    </td>
  );
}

// Suppress unused-vars for AMBER which is reserved for future "stale" badge
void AMBER;
