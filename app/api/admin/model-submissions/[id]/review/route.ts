import { NextRequest, NextResponse, after } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { modelSubmissionApprovedTemplate } from '@/src/shared/email/templates/modelSubmissionApproved';
import { modelSubmissionRejectedTemplate } from '@/src/shared/email/templates/modelSubmissionRejected';
import { quizResultTemplate } from '@/src/shared/email/templates/quizResult';
import { issueCertificateForStudent } from '@/src/hubs/training/lib/certificates/certificateEngine';
import { COURSES } from '@/src/hubs/training/config/courses';
import type { ModelSubmissionRow } from '@/src/hubs/training/lib/modelSubmission/types';
import { ALLOWED_MODEL_EXT_TO_MIME, MAX_REVIEWED_MODEL_BYTES, safeModelFileName, fileExt } from '@/src/hubs/training/lib/modelSubmission/fileTypes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

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

  // Accept BOTH multipart/form-data (approve with an optional reviewed-model
  // file + comment) and JSON (backward compatible; reject and file-less approve).
  const contentType = req.headers.get('content-type') ?? '';
  let decision: 'approve' | 'reject' | undefined;
  let note = '';
  let reviewedFile: File | null = null;
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    const d = String(form.get('decision') ?? '');
    decision = d === 'approve' || d === 'reject' ? d : undefined;
    note = String(form.get('note') ?? '').trim();
    const f = form.get('file');
    reviewedFile = f instanceof File && f.size > 0 ? f : null;
  } else {
    const body = await req.json().catch(() => ({})) as { decision?: 'approve' | 'reject'; note?: string };
    decision = body.decision;
    note = (body.note ?? '').trim();
  }

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

  // Reviewed-model return (mig 185): on approve, the admin may attach a reviewed
  // model. Upload it to the SAME private bucket BEFORE the DB update so the row
  // carries the reference atomically; a validation failure rejects the request
  // and a DB-write failure rolls the uploaded object back (no orphaned bytes).
  let reviewedMeta: { path: string; name: string; size: number; mime: string } | null = null;
  if (decision === 'approve' && reviewedFile) {
    const ext = fileExt(reviewedFile.name);
    if (!ext || !(ext in ALLOWED_MODEL_EXT_TO_MIME)) {
      return NextResponse.json({ error: 'invalid_file_type', message: 'Allowed reviewed-model types: .xlsx, .xls, .xlsm, .pdf' }, { status: 400 });
    }
    if (reviewedFile.size > MAX_REVIEWED_MODEL_BYTES) {
      return NextResponse.json({ error: 'file_too_large', message: 'The reviewed model exceeds the 25 MB limit.' }, { status: 400 });
    }
    const mime = reviewedFile.type || ALLOWED_MODEL_EXT_TO_MIME[ext];
    const safeName = safeModelFileName(reviewedFile.name);
    const path = `reviewed/${submission.email.toLowerCase()}/${submission.course_code.toLowerCase()}/${submission.id}_${Date.now()}_${safeName}`;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await reviewedFile.arrayBuffer());
    } catch (readErr) {
      console.error('[model-submissions review] reviewed file read failed:', readErr);
      return NextResponse.json({ error: 'Failed to read the reviewed model upload' }, { status: 500 });
    }
    const { error: upErr } = await sb.storage.from('model-submissions').upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      console.error('[model-submissions review] reviewed file upload failed:', upErr);
      return NextResponse.json({ error: 'reviewed_upload_failed', message: upErr.message }, { status: 500 });
    }
    reviewedMeta = { path, name: reviewedFile.name, size: reviewedFile.size, mime };
  }

  const { error: updateErr } = await sb
    .from('model_submissions')
    .update({
      status: newStatus,
      reviewed_at: nowIso,
      reviewed_by_admin: adminEmail,
      review_note: reviewNoteToStore,
      ...(reviewedMeta ? {
        reviewed_file_path: reviewedMeta.path,
        reviewed_file_name: reviewedMeta.name,
        reviewed_file_size: reviewedMeta.size,
        reviewed_file_mime: reviewedMeta.mime,
      } : {}),
    })
    .eq('id', submission.id);

  if (updateErr) {
    console.error('[model-submissions review] update failed:', updateErr);
    // Roll back the reviewed-file object so we do not leak bytes on a row that
    // did not record them.
    if (reviewedMeta) {
      try { await sb.storage.from('model-submissions').remove([reviewedMeta.path]); }
      catch (rb) { console.error('[model-submissions review] reviewed rollback failed:', rb); }
    }
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
        // Reviewed-model return: a download link (never an attachment) to the
        // ownership-checked student proxy, only when a reviewed file was attached.
        reviewedFileUrl: reviewedMeta ? `${LEARN_URL}/api/training/model-submission/${submission.id}/reviewed-file` : null,
        reviewedFileName: reviewedMeta?.name ?? null,
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

  // Corrected flow: approving the model is the gate that DECLARES the (held)
  // exam result and lets the certificate path proceed. Under the new rule the
  // candidate could have already taken the final exam while the model was
  // pending; submit-assessment recorded the attempt but withheld its result
  // (no result email, cert held by the engine). On approval we now:
  //   1. Declare the held final-exam result (the result email), if taken.
  //   2. Re-trigger certificate issuance (idempotent + eligibility-gated; the
  //      cert engine's model-approval gate now passes).
  //   3. BVM auto-unlock when a passed 3SFM final was waiting on approval.
  // Fire-and-forget so the admin response is immediate. No-ops cleanly when the
  // student has not taken the final yet (then the normal exam-time path runs
  // once they do, because the model is now approved).
  if (decision === 'approve') {
    const courseCode = submission.course_code; // '3SFM' | 'BVM'
    const courseId = courseCode.toLowerCase();  // '3sfm' | 'bvm'
    const studentEmail = submission.email.toLowerCase();
    const finalSession = courseEntry?.sessions.find(s => s.isFinal);
    after(async () => {
      try {
        const { data: finalRow } = await sb
          .from('training_assessment_results')
          .select('score, passed, attempts')
          .ilike('email', studentEmail)
          .eq('course_id', courseId)
          .eq('is_final', true)
          .maybeSingle();

        // 1. Declare the held result (only when the final has actually been taken).
        if (finalRow) {
          try {
            const { subject, html, text } = await quizResultTemplate({
              name: firstName,
              sessionName: finalSession?.title ?? `${courseCode} Final Exam`,
              score: Number((finalRow as { score?: number }).score ?? 0),
              passMark: finalSession?.passingScore ?? 70,
              passed: (finalRow as { passed?: boolean }).passed === true,
              attemptsUsed: Number((finalRow as { attempts?: number }).attempts ?? 1),
              maxAttempts: finalSession?.maxAttempts ?? 1,
            });
            await sendEmail({ to: submission.email, subject, html, text, from: FROM.training });
            console.log('[model-submissions review] held result declared on approval', { email: studentEmail, course: courseCode });
          } catch (resErr) {
            console.error('[model-submissions review] result declaration email failed (non-fatal):', resErr);
          }
        }

        // 2. Re-trigger certificate issuance (idempotent; held until now by the
        //    cert engine's model-approval gate, which this approval satisfies).
        try {
          const res = await issueCertificateForStudent(studentEmail, courseCode as '3SFM' | 'BVM', { issuedVia: 'auto' });
          console.log('[model-submissions review] post-approval cert issuance', {
            email: studentEmail, course: courseCode,
            ok: res.ok, skipped: (res as { skipped?: boolean }).skipped === true,
            error: res.ok ? undefined : (res as { error?: string }).error,
          });
        } catch (certErr) {
          console.error('[model-submissions review] post-approval cert issuance threw (admin safety-net will surface):', certErr);
        }

        // 3. BVM auto-unlock when a passed 3SFM final was held pending approval.
        if (courseCode === '3SFM' && (finalRow as { passed?: boolean } | null)?.passed === true) {
          try {
            const { data: metaRow } = await sb
              .from('training_registrations_meta')
              .select('registration_id')
              .ilike('email', studentEmail)
              .maybeSingle();
            if (metaRow?.registration_id) {
              const { error: enrollErr } = await sb
                .from('training_enrollments')
                .insert({ registration_id: metaRow.registration_id, course_code: 'BVM' });
              if (enrollErr && !enrollErr.message.toLowerCase().includes('duplicate')) {
                console.error('[model-submissions review] BVM auto-unlock failed', { email: studentEmail, error: enrollErr.message });
              } else {
                console.log('[model-submissions review] BVM auto-unlocked on approval', { email: studentEmail });
              }
            }
          } catch (enrollErr) {
            console.error('[model-submissions review] BVM auto-unlock threw:', enrollErr);
          }
        }
      } catch (postErr) {
        console.error('[model-submissions review] post-approval re-trigger failed (non-fatal):', postErr);
      }
    });
  }

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
