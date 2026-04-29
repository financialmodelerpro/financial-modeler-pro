import { NextRequest, NextResponse, after } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { getModelSubmissionStatus } from '@/src/hubs/training/lib/modelSubmission/checkApproval';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { modelSubmissionAdminAlertTemplate } from '@/src/shared/email/templates/modelSubmissionAdminAlert';
import { COURSES } from '@/src/hubs/training/config/courses';

// FormData uploads can stretch past the 10s default on slower connections;
// cap at 60s like submit-assessment so a 9 MB xlsx on a 1 Mbps link still
// has room to land before the Lambda is torn down.
export const maxDuration = 60;

const ALLOWED_EXT_TO_MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  pdf:  'application/pdf',
};

function normalizeCourseCode(input: string): '3SFM' | 'BVM' | null {
  const upper = input.trim().toUpperCase();
  return upper === '3SFM' || upper === 'BVM' ? (upper as '3SFM' | 'BVM') : null;
}

function safeFileName(name: string): string {
  // Strip path separators + odd characters; keep dot for extension. Mirrors
  // the convention used by /api/admin/attachments.
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * GET /api/training/model-submission?courseCode=3SFM|BVM
 *
 * Thin wrapper around getModelSubmissionStatus(). Used by ModelSubmissionCard
 * on the dashboard to drive its state machine. Auth via training_session
 * cookie - no email parameter accepted, so a student can't probe another
 * student's status.
 */
export async function GET(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const courseCode = req.nextUrl.searchParams.get('courseCode') ?? '';
  const code = normalizeCourseCode(courseCode);
  if (!code) return NextResponse.json({ error: 'courseCode must be 3SFM or BVM' }, { status: 400 });

  try {
    const status = await getModelSubmissionStatus(session.email, code);
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    console.error('[model-submission GET] failed:', err);
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
  }
}

/**
 * POST /api/training/model-submission
 *
 * FormData: file, courseCode (3SFM | BVM), studentNotes? (optional, <= 2k).
 *
 * Validation chain (each fails fast with a 400/403 + structured error code):
 *   1. Auth: training_session cookie present.
 *   2. courseCode: must be 3SFM or BVM.
 *   3. Settings gate: model_submission_required_<course> must be 'true'. The
 *      announcement-only soft-launch period leaves the per-course required
 *      flag 'false' so uploads are rejected with `gate_not_open` until admin
 *      flips the cutover. (UI hides the upload button in that mode.)
 *   4. File presence + extension (xlsx / xls / xlsm / pdf only).
 *   5. File size cap (10 MB default, override via training_settings).
 *   6. One-pending guard: if the latest row is pending_review, refuse with
 *      `pending_review_in_flight` so a student can't double-submit while
 *      Ahmad is reviewing.
 *   7. Attempts cap: hard refuse when attemptsUsed >= maxAttempts. 3 reject-
 *      ions consume all 3 attempts; after that the student contacts admin
 *      and the force-issue path stays available.
 *
 * On success: uploads to the private `model-submissions` bucket using the
 * service role client (no public read policy; admin Phase D fetches via a
 * proxy route) and inserts the row with status='pending_review'.
 */
export async function POST(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const cleanEmail = session.email;
  const regId = session.registrationId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = form.get('file') as File | null;
  const courseCodeRaw = (form.get('courseCode') as string | null) ?? '';
  const studentNotesRaw = (form.get('studentNotes') as string | null) ?? '';

  const code = normalizeCourseCode(courseCodeRaw);
  if (!code) return NextResponse.json({ error: 'courseCode must be 3SFM or BVM' }, { status: 400 });
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  // Read settings + status in one call. This mirrors the cert engine /
  // submit-assessment path so the gate behaviour is identical from every
  // surface, and gives us attemptsUsed + latest.status in the same query.
  const status = await getModelSubmissionStatus(cleanEmail, code);

  if (!status.required) {
    // Soft-launch mode. The dashboard UI suppresses the upload button when
    // announcementOnly is on; this is the defence-in-depth response if a
    // tester pokes the route directly.
    return NextResponse.json({
      error: 'gate_not_open',
      message: 'Model submission is not yet required for this course.',
    }, { status: 403 });
  }

  if (status.latestStatus === 'pending_review') {
    return NextResponse.json({
      error: 'pending_review_in_flight',
      message: 'Your previous submission is still being reviewed. Please wait for the admin response before uploading another file.',
    }, { status: 409 });
  }

  if (status.attemptsUsed >= status.maxAttempts) {
    return NextResponse.json({
      error: 'attempts_exhausted',
      message: `You have used all ${status.maxAttempts} of your submission attempts. Please contact the administrator.`,
    }, { status: 403 });
  }

  // File-size cap. Read once from training_settings so admin can dial it
  // without a redeploy. Default 10 MB; clamp to a sane 1-50 MB band so a
  // typo can't make the cap useless.
  const sb = getServerClient();
  const { data: capRow } = await sb
    .from('training_settings')
    .select('value')
    .eq('key', 'model_submission_max_file_size_mb')
    .maybeSingle();
  const capMb = Math.max(1, Math.min(50, parseInt(capRow?.value ?? '10', 10) || 10));
  const capBytes = capMb * 1024 * 1024;

  if (file.size > capBytes) {
    return NextResponse.json({
      error: 'file_too_large',
      message: `File too large. Maximum size is ${capMb} MB.`,
    }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file_empty', message: 'File is empty.' }, { status: 400 });
  }

  // Extension check beats mime-type sniffing here: browsers report wildly
  // different mime types for xlsm in particular, and pdf-disguised-as-xlsx
  // matters less than the admin being able to open the file. The mime_type
  // column captures whatever the browser actually sent.
  const lowerName = (file.name || '').toLowerCase();
  const ext = lowerName.includes('.') ? lowerName.split('.').pop() ?? '' : '';
  if (!ext || !(ext in ALLOWED_EXT_TO_MIME)) {
    return NextResponse.json({
      error: 'invalid_file_type',
      message: 'Allowed file types: .xlsx, .xls, .xlsm, .pdf',
    }, { status: 400 });
  }

  const studentNotes = studentNotesRaw.trim().slice(0, 2000) || null;
  const attemptNumber = (status.attemptsUsed + 1) as 1 | 2 | 3;
  const safeName = safeFileName(file.name);
  const storagePath = `${cleanEmail}/${code.toLowerCase()}/attempt${attemptNumber}_${Date.now()}_${safeName}`;
  const contentType = file.type || ALLOWED_EXT_TO_MIME[ext];

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch (readErr) {
    console.error('[model-submission POST] arrayBuffer failed:', readErr);
    return NextResponse.json({ error: 'Failed to read upload' }, { status: 500 });
  }

  const { error: uploadErr } = await sb.storage
    .from('model-submissions')
    .upload(storagePath, bytes, { contentType, upsert: false });
  if (uploadErr) {
    console.error('[model-submission POST] upload failed:', uploadErr);
    return NextResponse.json({
      error: 'upload_failed',
      message: uploadErr.message,
    }, { status: 500 });
  }

  const { data: row, error: insertErr } = await sb
    .from('model_submissions')
    .insert({
      email:          cleanEmail,
      course_code:    code,
      attempt_number: attemptNumber,
      storage_path:   storagePath,
      file_name:      file.name,
      file_size:      file.size,
      mime_type:      contentType,
      student_notes:  studentNotes,
      status:         'pending_review',
    })
    .select('id, attempt_number, status, submitted_at')
    .single();

  if (insertErr) {
    // Storage upload succeeded but the DB write failed. Roll back the
    // storage object so we don't leak bytes on a row that doesn't exist.
    try {
      await sb.storage.from('model-submissions').remove([storagePath]);
    } catch (rollbackErr) {
      console.error('[model-submission POST] rollback remove failed:', rollbackErr);
    }
    console.error('[model-submission POST] insert failed:', insertErr);
    return NextResponse.json({
      error: 'insert_failed',
      message: insertErr.message,
    }, { status: 500 });
  }

  console.log('[model-submission POST] accepted', {
    email: cleanEmail, regId, courseCode: code,
    attempt: attemptNumber, size: file.size, ext,
  });

  // Phase F.1 - admin alert email. Fire-and-forget after the response so
  // the student never waits on it. Honors two settings (both safe-defaulted
  // by migration 148):
  //   model_submission_admin_notify_enabled - 'true' | 'false', default 'true'
  //   model_submission_admin_notify_email   - recipient address, default ''
  // Empty recipient is the documented "off" state - log + skip rather than
  // erroring. Email failure is logged but never surfaces to the student.
  after(async () => {
    try {
      const sb2 = getServerClient();
      const { data: settingsRows } = await sb2
        .from('training_settings')
        .select('key, value')
        .in('key', [
          'model_submission_admin_notify_enabled',
          'model_submission_admin_notify_email',
        ]);
      const settings: Record<string, string> = {};
      for (const r of (settingsRows ?? []) as { key: string; value: string }[]) settings[r.key] = r.value;
      const enabled = settings.model_submission_admin_notify_enabled !== 'false';
      const recipient = (settings.model_submission_admin_notify_email ?? '').trim();
      if (!enabled || !recipient) {
        console.log('[model-submission POST] admin alert skipped', { enabled, hasRecipient: !!recipient });
        return;
      }

      // Best-effort student-name lookup so the alert subject opens with a
      // friendly name instead of just the email. Falls back to email-only
      // when the meta row is missing.
      const { data: metaRow } = await sb2
        .from('training_registrations_meta')
        .select('name')
        .ilike('email', cleanEmail)
        .maybeSingle();
      const studentName = ((metaRow as { name?: string } | null)?.name ?? '').trim() || null;

      const courseEntry = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === code);
      const courseLabel = courseEntry?.title ?? code;

      const { subject, html, text } = await modelSubmissionAdminAlertTemplate({
        studentName,
        studentEmail: cleanEmail,
        registrationId: regId || null,
        courseLabel,
        courseCode: code,
        fileName: file.name,
        fileSize: file.size,
        attemptNumber,
        maxAttempts: status.maxAttempts,
        studentNotes: studentNotes,
        submissionId: (row as { id: string }).id,
      });
      await sendEmail({ to: recipient, subject, html, text, from: FROM.training });
      console.log('[model-submission POST] admin alert sent', { recipient });
    } catch (alertErr) {
      console.error('[model-submission POST] admin alert failed (non-fatal):', alertErr);
    }
  });

  return NextResponse.json({
    ok: true,
    submission: row,
    status: {
      latestStatus: 'pending_review',
      attemptsUsed: attemptNumber,
      attemptsRemaining: Math.max(0, status.maxAttempts - attemptNumber),
      maxAttempts: status.maxAttempts,
    },
  });
}
