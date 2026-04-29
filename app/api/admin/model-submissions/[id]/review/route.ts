import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { modelSubmissionApprovedTemplate } from '@/src/shared/email/templates/modelSubmissionApproved';
import { modelSubmissionRejectedTemplate } from '@/src/shared/email/templates/modelSubmissionRejected';
import { COURSES } from '@/src/hubs/training/config/courses';
import type { ModelSubmissionRow } from '@/src/hubs/training/lib/modelSubmission/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/model-submissions/[id]/review
 *
 * Body: { decision: 'approve' | 'reject', note?: string }
 *
 * Approve:
 *   - status = 'approved' (sticky; future submissions don't revoke).
 *   - email modelSubmissionApprovedTemplate.
 *   - audit log row.
 * Reject:
 *   - non-empty note required (rejection without explanation is the worst
 *     possible UX for a student staring at "your model needs work").
 *   - status = 'rejected'. The reject consumes one of the 3 attempts; this
 *     is implicit in the (email, course, attempt_number) row already
 *     existing - getModelSubmissionStatus counts rows for attemptsUsed.
 *   - email modelSubmissionRejectedTemplate. Includes attemptsRemaining so
 *     the student knows whether they can resubmit.
 *   - audit log row with reviewer note + remaining attempts captured.
 *
 * Idempotency: refuses to re-review an already-decided row (returns 409).
 * Admin can manually edit the row in Supabase if a real reversal is
 * required, but the happy path is one-shot.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const adminUser = session.user as { id?: string; email?: string };
  const adminId = adminUser.id ?? null;
  const adminEmail = adminUser.email ?? null;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Submission id required' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    decision?: 'approve' | 'reject';
    note?: string;
  };
  const decision = body.decision;
  const note = (body.note ?? '').trim();

  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
  }
  if (decision === 'reject' && !note) {
    return NextResponse.json({ error: 'A reviewer note is required when rejecting.' }, { status: 400 });
  }

  const sb = getServerClient();

  const { data: row, error: readErr } = await sb
    .from('model_submissions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[model-submissions review] read failed:', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

  const submission = row as ModelSubmissionRow;
  if (submission.status !== 'pending_review') {
    return NextResponse.json({
      error: 'already_reviewed',
      message: `This submission is already ${submission.status}.`,
    }, { status: 409 });
  }

  const newStatus = decision === 'approve' ? 'approved' : 'rejected';
  const reviewNoteToStore = decision === 'reject' ? note : (note || null);
  const nowIso = new Date().toISOString();

  const { error: updateErr } = await sb
    .from('model_submissions')
    .update({
      status: newStatus,
      reviewed_at: nowIso,
      reviewed_by_admin: adminEmail,
      review_note: reviewNoteToStore,
    })
    .eq('id', submission.id);

  if (updateErr) {
    console.error('[model-submissions review] update failed:', updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Compute remaining attempts for the audit log + the email. Counts every
  // row for (email, course_code) since each row is one consumed attempt
  // (pending_review counts too if the admin somehow chains an extra in,
  // though the upload route prevents that).
  const { data: settingsRows } = await sb
    .from('training_settings')
    .select('value')
    .eq('key', 'model_submission_max_attempts')
    .maybeSingle();
  const maxAttempts = Math.max(
    1,
    Math.min(10, parseInt(settingsRows?.value ?? '3', 10) || 3),
  );
  const { count: attemptsUsedCount } = await sb
    .from('model_submissions')
    .select('id', { count: 'exact', head: true })
    .ilike('email', submission.email.toLowerCase())
    .eq('course_code', submission.course_code);
  const attemptsUsed = attemptsUsedCount ?? submission.attempt_number;
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);

  // Audit log. admin_id can be null when getServerSession doesn't surface a
  // UUID (e.g. older session); we still record the event with admin_email
  // in after_value so the trail is complete.
  const auditPayload = {
    admin_id: adminId,
    action: 'model_submission_review',
    after_value: {
      submission_id: submission.id,
      email: submission.email,
      course_code: submission.course_code,
      attempt_number: submission.attempt_number,
      decision,
      previous_status: submission.status,
      new_status: newStatus,
      review_note: reviewNoteToStore,
      attempts_used: attemptsUsed,
      attempts_remaining: attemptsRemaining,
      max_attempts: maxAttempts,
      file_name: submission.file_name,
      admin_email: adminEmail,
    },
  };
  const { error: auditErr } = await sb.from('admin_audit_log').insert(auditPayload);
  if (auditErr) {
    // Audit failure is logged but does not unwind the review - the row is
    // the durable source of truth, audit is observability.
    console.error('[model-submissions review] audit insert failed:', auditErr.message);
  }

  // Best-effort student-name lookup so the email opens with their first
  // name. Falls back to no greeting when the meta row is missing.
  const { data: metaRow } = await sb
    .from('training_registrations_meta')
    .select('name')
    .ilike('email', submission.email.toLowerCase())
    .maybeSingle();
  const studentName = ((metaRow as { name?: string } | null)?.name ?? '').trim();
  const firstName = studentName ? studentName.split(/\s+/)[0] : '';

  // Course label for the email subject + body. Falls back to the short
  // course code when the COURSES config doesn't carry a matching entry.
  const courseEntry = Object.values(COURSES).find(
    c => c.shortTitle.toUpperCase() === submission.course_code,
  );
  const courseLabel = courseEntry?.title ?? submission.course_code;

  // Email is fire-and-forget from the admin's POV; we await it inside the
  // try/catch so the response can include `emailSent: false` when send
  // fails. The review itself stays committed regardless.
  let emailSent = false;
  let emailError: string | null = null;
  try {
    if (decision === 'approve') {
      const { subject, html, text } = await modelSubmissionApprovedTemplate({
        name: firstName,
        courseLabel,
        fileName: submission.file_name,
        attemptNumber: submission.attempt_number,
        reviewerNote: reviewNoteToStore,
      });
      await sendEmail({ to: submission.email, subject, html, text, from: FROM.training });
    } else {
      const { subject, html, text } = await modelSubmissionRejectedTemplate({
        name: firstName,
        courseLabel,
        fileName: submission.file_name,
        attemptNumber: submission.attempt_number,
        attemptsRemaining,
        maxAttempts,
        reviewerNote: note,
      });
      await sendEmail({ to: submission.email, subject, html, text, from: FROM.training });
    }
    emailSent = true;
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.error('[model-submissions review] email send failed:', emailError);
  }

  console.log('[model-submissions review]', {
    decision, id: submission.id, email: submission.email,
    course: submission.course_code, attempt: submission.attempt_number,
    attemptsRemaining, by: adminEmail, emailSent,
  });

  return NextResponse.json({
    ok: true,
    decision,
    newStatus,
    attemptsUsed,
    attemptsRemaining,
    maxAttempts,
    emailSent,
    emailError,
  });
}
