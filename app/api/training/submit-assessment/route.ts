import { NextRequest, NextResponse, after } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { quizResultTemplate } from '@/src/shared/email/templates/quizResult';
import { lockedOutTemplate } from '@/src/shared/email/templates/lockedOut';
import { issueCertificateForStudent } from '@/src/hubs/training/lib/certificates/certificateEngine';
import { deleteInProgressForKey } from '@/src/hubs/training/lib/assessment/attemptInProgress';

// Cert generation (PDF render + satori/sharp badge + Storage upload + DB write
// + email) averages 5-10s. Default of 10s on Hobby was right at the edge; 60s
// gives comfortable headroom so `after()` callbacks below can finish cleanly.
export const maxDuration = 60;

/**
 * POST /api/training/submit-assessment
 *
 * Accepts a PRE-SCORED result from the client and records it in
 * training_assessment_results (Supabase, single source of truth).
 * Scoring is done entirely client-side - this endpoint does NOT re-fetch
 * questions or re-score.
 *
 * Also sends quiz result email (and locked-out email if max attempts reached),
 * and triggers inline certificate issuance on a passing final exam.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch (parseErr) {
    console.error('[submit-assessment] JSON parse error:', parseErr);
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    console.log('[submit-assessment] Received body:', JSON.stringify(body));

    const tabKey      = body.tabKey as string | undefined;
    const email       = body.email as string | undefined;
    const regId       = body.regId as string | undefined;
    const score       = body.score as number | undefined;
    const passed      = body.passed as boolean | undefined;
    const isFinal     = body.isFinal as boolean | undefined;
    const attemptNo   = body.attemptNo as number | undefined;
    const maxAttempts = body.maxAttempts as number | undefined;
    const studentName = body.studentName as string | undefined;
    const sessionName = body.sessionName as string | undefined;
    const passingScore = body.passingScore as number | undefined;

    if (!tabKey || !email || !regId || score === undefined || score === null) {
      console.error('[submit-assessment] Missing fields:', { tabKey: !!tabKey, email: !!email, regId: !!regId, score, scoreType: typeof score });
      return NextResponse.json({
        success: false,
        error: 'Missing required fields (tabKey, email, regId, score)',
        received: { tabKey, email: email ? '***' : undefined, regId, score, scoreType: typeof score },
      }, { status: 400 });
    }

    console.log('[submit-assessment] Recording score:', { tabKey, email, score, passed, attemptNo });

    const numScore = Number(score);
    const didPass = passed ?? numScore >= 70;

    // Compute attempt number server-side from Supabase — don't trust the
    // client. Source of truth: training_assessment_results.
    //
    // Simple increment: existing + 1. First attempt (no row) → 1.
    const cleanEmail = email.trim().toLowerCase();
    let serverAttempt = 1;
    try {
      const sbRead = getServerClient();
      const { data: existing } = await sbRead
        .from('training_assessment_results')
        .select('attempts')
        .eq('email', cleanEmail)
        .eq('tab_key', tabKey)
        .maybeSingle();
      const existingAttempts = Number(existing?.attempts ?? 0);
      serverAttempt = existingAttempts + 1;
    } catch (readErr) {
      console.warn('[submit-assessment] Supabase read failed, falling back to client attempt:', readErr);
      serverAttempt = Number(attemptNo ?? 1);
    }
    const attempt = serverAttempt;

    // training_assessment_results is the single source of truth for
    // per-session scores; the upsert below drives the dashboard,
    // attempt-status, progress, and certificate eligibility paths.
    console.log('[submit-assessment] Recording score:', { tabKey, email, score, passed, attempt });

    // Write to Supabase (primary source for dashboard - instant reads).
    // The `attempts` column records server-incremented attempt count — every
    // submission (pass OR fail) bumps it so students can see all three of
    // their attempts on the dashboard, not just the last passing one.
    try {
      const sb = getServerClient();
      await sb.from('training_assessment_results').upsert({
        email: cleanEmail,
        reg_id: regId,
        tab_key: tabKey,
        course_id: tabKey.toUpperCase().startsWith('BVM') ? 'bvm' : '3sfm',
        score: numScore,
        passed: didPass,
        attempts: attempt,
        is_final: isFinal ?? false,
        completed_at: new Date().toISOString(),
      }, { onConflict: 'email,tab_key' });
    } catch (sbErr) {
      console.error('[submit-assessment] Supabase write failed:', sbErr);
      // Supabase is now the single source of truth. A write failure here
      // means the score isn't recorded anywhere durable; surface it.
      return NextResponse.json({
        success:  true,
        recorded: false,
        warning:  'Score calculated but failed to save. Please refresh and try submitting again.',
      });
    }

    // Best-effort cleanup of the in-progress attempt row (migration 126).
    // Failure here doesn't affect the student's submission; the row is
    // harmless if left behind because attempt_number is server-incremented
    // on the next start.
    try {
      const sb = getServerClient();
      await deleteInProgressForKey(sb, cleanEmail, { kind: 'cert', tabKey });
    } catch (cleanupErr) {
      console.warn('[submit-assessment] in-progress cleanup failed:', cleanupErr);
    }

    // Post-response work runs via `after()` so Vercel keeps the Lambda alive
    // until the callback resolves. The previous bare IIFE could be torn down
    // before the email send + cert generation completed.
    const label = sessionName || tabKey;
    const passMark = passingScore ?? 70;
    const maxAtt = maxAttempts ?? (isFinal ? 1 : 3);

    after(async () => {
      try {
        const { subject, html, text } = await quizResultTemplate({
          name: studentName,
          sessionName: label,
          score: numScore,
          passMark,
          passed: didPass,
          attemptsUsed: attempt,
          maxAttempts: maxAtt,
        });
        await sendEmail({ to: email, subject, html, text, from: FROM.training });
      } catch (emailErr) {
        console.error('[submit-assessment] Quiz result email failed:', emailErr);
      }

      // Send locked-out email if max attempts exhausted and not passed
      if (!didPass && attempt >= maxAtt) {
        try {
          const { subject, html, text } = await lockedOutTemplate({
            name: studentName,
            sessionName: label,
            attemptsUsed: attempt,
            maxAttempts: maxAtt,
          });
          await sendEmail({ to: email, subject, html, text, from: FROM.training });
        } catch (lockErr) {
          console.error('[submit-assessment] Locked-out email failed:', lockErr);
        }
      }
    });

    // Inline certificate issuance fires the moment a student passes a final
    // exam. `after()` keeps the Lambda alive until the callback resolves, so
    // PDF generation + storage upload + DB write + issuance email all run to
    // completion even though the student's HTTP response returned immediately.
    // Idempotency is handled by the helper (skip-if-already-issued pre-check +
    // unique index on student_certificates). Failures log here and surface on
    // the admin "Eligible but not issued" safety-net panel.
    if (didPass && (isFinal ?? false)) {
      const courseCode = tabKey.toUpperCase().startsWith('BVM') ? 'BVM' : '3SFM';
      after(async () => {
        // Definitive "trigger fired" signal - distinct from the success /
        // failure logs below, which only fire once the whole pipeline has
        // reached its end. If this line doesn't show up in Vercel logs,
        // the trigger never ran. If it shows up but neither success nor
        // failure does, the runtime killed the Lambda mid-pipeline.
        console.log('[submit-assessment] cert trigger entering issueCertificateForStudent', {
          email: cleanEmail, courseCode,
        });
        try {
          const res = await issueCertificateForStudent(cleanEmail, courseCode, { issuedVia: 'auto' });
          if (res.ok) {
            console.log('[submit-assessment] inline cert issuance:', {
              email: cleanEmail, courseCode,
              skipped: (res as { skipped?: boolean }).skipped === true,
              certificateId: res.certificateId,
            });
          } else {
            console.error('[submit-assessment] inline cert issuance FAILED (admin safety-net will surface):', {
              email: cleanEmail, courseCode, error: res.error,
            });
          }
        } catch (certErr) {
          console.error('[submit-assessment] inline cert issuance threw (admin safety-net will surface):', {
            email: cleanEmail, courseCode, err: String(certErr),
          });
        }
      });

      // BVM auto-unlock when a student passes 3SFM Final. Students enroll
      // in 3SFM automatically at signup; BVM only appears on their
      // dashboard after this gate. Idempotent via the UNIQUE constraint
      // on (registration_id, course_code) from migration 132.
      if (courseCode === '3SFM') {
        after(async () => {
          try {
            const sb = getServerClient();
            const { data: metaRow } = await sb
              .from('training_registrations_meta')
              .select('registration_id')
              .eq('email', cleanEmail)
              .maybeSingle();
            if (!metaRow?.registration_id) {
              console.warn('[submit-assessment] BVM auto-unlock skipped; no meta row for', cleanEmail);
              return;
            }
            const { error } = await sb
              .from('training_enrollments')
              .insert({
                registration_id: metaRow.registration_id,
                course_code:     'BVM',
              });
            if (error && !error.message.toLowerCase().includes('duplicate')) {
              console.error('[submit-assessment] BVM auto-unlock failed', {
                email: cleanEmail,
                registration_id: metaRow.registration_id,
                error: error.message,
              });
            } else {
              console.log('[submit-assessment] BVM auto-unlocked for', cleanEmail);
            }
          } catch (enrollErr) {
            console.error('[submit-assessment] BVM auto-unlock threw:', enrollErr);
          }
        });
      }
    }

    return NextResponse.json({ success: true, recorded: true });
  } catch (err) {
    console.error('[submit-assessment] Error:', err);
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
}
