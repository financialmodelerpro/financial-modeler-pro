import { NextRequest, NextResponse, after } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { quizResultTemplate } from '@/src/shared/email/templates/quizResult';
import { lockedOutTemplate } from '@/src/shared/email/templates/lockedOut';
import { issueCertificateForStudent } from '@/src/hubs/training/lib/certificates/certificateEngine';
import { deleteInProgressForKey } from '@/src/hubs/training/lib/assessment/attemptInProgress';
import { getModelSubmissionStatus } from '@/src/hubs/training/lib/modelSubmission/checkApproval';
import { examLockedNoSubmission, resultWithheldUntilApproval } from '@/src/hubs/training/lib/modelSubmission/examGate';
import { resolveIsFinal } from '@/src/hubs/training/lib/assessment/modelGateScope';

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
 * Sends a quiz result email ONLY for the final exam (per-session passes and
 * fails are now visible on the dashboard - no per-session email noise),
 * a locked-out email when max attempts are exhausted regardless of session,
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

    // Model-submission gate (corrected flow). EXAM ACCESS is gated only by
    // "has the candidate submitted a model" (any status), NOT by approval, so
    // submitting unlocks the exam immediately. The exam is refused only when the
    // per-course requirement is on AND no model has been submitted at all. The
    // RESULT (and certificate) is then withheld until an admin approves: when the
    // model is submitted-but-not-yet-approved we still RECORD the attempt but
    // hold its declaration (no result email here; the approval route declares it
    // and the cert engine holds issuance until approval).
    //
    // The gate fires only when both the client body claims isFinal AND the
    // tabKey resolves to a known Final session in the COURSES config, so a
    // misreported isFinal=true on a per-session quiz cannot trigger it.
    const tabKeyIsFinal = resolveIsFinal(tabKey);
    let withholdFinalResult = false;
    if (isFinal === true && tabKeyIsFinal) {
      const courseCodeForGate = tabKey.toUpperCase().startsWith('BVM') ? 'BVM' : '3SFM';
      const cleanEmailForGate = email.trim().toLowerCase();
      try {
        const modelGate = await getModelSubmissionStatus(cleanEmailForGate, courseCodeForGate);
        if (examLockedNoSubmission(modelGate)) {
          console.warn('[submit-assessment] final-exam blocked: no model submitted', {
            email: cleanEmailForGate, courseCode: courseCodeForGate,
            latestStatus: modelGate.latestStatus,
          });
          return NextResponse.json({
            success: false,
            error: 'model_not_submitted',
            message: 'Submit your financial model to unlock the final exam.',
            modelStatus: {
              latestStatus: modelGate.latestStatus,
              attemptsUsed: modelGate.attemptsUsed,
              attemptsRemaining: modelGate.attemptsRemaining,
              maxAttempts: modelGate.maxAttempts,
            },
          }, { status: 403 });
        }
        // Submitted but not yet approved -> record the attempt, withhold the
        // result declaration until the admin approves the model.
        withholdFinalResult = resultWithheldUntilApproval(modelGate);
      } catch (gateErr) {
        // Fail-open on access: a settings or DB hiccup must not block a
        // legitimate submission. The cert engine gate still holds issuance.
        console.warn('[submit-assessment] model-gate check failed, allowing submission:', gateErr);
      }
    }

    // Compute attempt number server-side from Supabase, don't trust the
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
    // The `attempts` column records server-incremented attempt count, every
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

    // Final-exam gate uses the same defense-in-depth pattern as the model
    // gate above (client `isFinal` flag AND server-side resolveIsFinal),
    // so a misreported isFinal on a per-session quiz cannot trigger the
    // final-exam result email. When the result is withheld (model submitted
    // but not yet approved) we record the attempt but do NOT declare the
    // result here; the admin approval route declares it.
    const finalResultHeld = (isFinal ?? false) && tabKeyIsFinal && withholdFinalResult;
    const sendFinalEmail = (isFinal ?? false) && tabKeyIsFinal && !withholdFinalResult;

    after(async () => {
      if (sendFinalEmail) {
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
          console.error('[submit-assessment] Final-exam result email failed:', emailErr);
        }
      }

      // Send locked-out email if max attempts exhausted and not passed.
      // Applies to per-session quizzes too: students who exhaust attempts
      // need the support contact instructions, even though the regular
      // pass/fail result no longer emails. Skipped for a withheld final exam
      // (the outcome is held until the model is approved).
      if (!didPass && attempt >= maxAtt && !finalResultHeld) {
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
    // When the result is withheld (model submitted, not yet approved) we skip
    // cert issuance + BVM auto-unlock at exam time so nothing about the held
    // result leaks to the candidate. The admin approval route re-triggers both
    // once the model is approved. (The cert engine would hold issuance anyway;
    // gating here also avoids the BVM-unlock leak and keeps logs clean.)
    if (didPass && (isFinal ?? false) && !finalResultHeld) {
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
