/**
 * Admin reset of a student's model-submission attempts for one course.
 *
 * Supersedes the student's ACTIVE rows (mig 248) instead of deleting them:
 * the files and the review history stay, superseded rows stop counting as
 * attempts, and the next upload is attempt 1 of a fresh allowance. Refuses to
 * reset away an approval (that would silently withdraw a certificate basis)
 * or a submission still under review. Every reset writes an audit row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseCourseCode } from '@/src/hubs/training/lib/liveCourse/courseSettings';

export interface ResetResult { ok: boolean; superseded: number; error?: string }

export async function resetSubmissionAttempts(
  sb: SupabaseClient,
  p: { email: string; courseCode: string; by: string; reason?: string | null; adminId?: string | null },
  now: Date = new Date(),
): Promise<ResetResult> {
  const email = p.email.trim().toLowerCase();
  const code = normaliseCourseCode(p.courseCode);
  if (!email || !code) return { ok: false, superseded: 0, error: 'A student email and a course are required.' };

  const { data: rows, error } = await sb
    .from('model_submissions')
    .select('id, status, superseded_at')
    .ilike('email', email)
    .eq('course_code', code)
    .is('superseded_at', null);
  if (error) return { ok: false, superseded: 0, error: error.message };
  const active = rows ?? [];
  if (!active.length) return { ok: false, superseded: 0, error: 'This student has no attempts to reset for this course.' };
  if (active.some((r) => r.status === 'approved')) return { ok: false, superseded: 0, error: 'This student already has an approved model; there is nothing to reset.' };
  if (active.some((r) => r.status === 'pending_review')) return { ok: false, superseded: 0, error: 'A submission is still waiting for review. Review it first.' };

  const ids = active.map((r) => r.id as string);
  const { error: upErr } = await sb
    .from('model_submissions')
    .update({ superseded_at: now.toISOString(), superseded_by: p.by, superseded_reason: p.reason?.trim() || 'Attempts reset by admin' })
    .in('id', ids);
  if (upErr) return { ok: false, superseded: 0, error: upErr.message };

  const { error: auditErr } = await sb.from('admin_audit_log').insert({
    admin_id: p.adminId ?? null,
    action: 'model_submission_reset',
    after_value: { email, course_code: code, superseded_ids: ids, reason: p.reason ?? null, admin_email: p.by },
  });
  if (auditErr) console.error('[model-submission reset] audit insert failed:', auditErr.message);

  return { ok: true, superseded: ids.length };
}
