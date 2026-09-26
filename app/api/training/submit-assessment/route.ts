import { NextRequest, NextResponse, after } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { quizResultTemplate } from '@/src/shared/email/templates/quizResult';
import { lockedOutTemplate } from '@/src/shared/email/templates/lockedOut';
import { issueCertificateForStudent } from '@/src/hubs/training/lib/certificates/certificateEngine';
import { deleteInProgressForKey } from '@/src/hubs/training/lib/assessment/attemptInProgress';
import { getModelSubmissionStatus } from '@/src/hubs/training/lib/modelSubmission/checkApproval';
import { examLockedNoSubmission, resultWithheldUntilApproval } from '@/src/hubs/training/lib/modelSubmission/examGate';
import { resolveIsFinal, maxAttemptsFor } from '@/src/hubs/training/lib/assessment/modelGateScope';
import { getAssessmentQuestions } from '@/src/hubs/training/lib/appsScript/sheets';
import {
  scoreSubmission, revealAnswerKey, type SourceQuestion, type SubmittedAnswer,
} from '@/src/hubs/training/lib/assessment/serverScoring';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export const maxDuration = 60;

/**
 * POST /api/training/submit-assessment
 * Body: { tabKey: string, answers: Array<{ key: string, choice: string }> }
 *
 * THE SERVER SCORES (2026-09-26). This route used to accept a PRE-SCORED
 * result (score, passed, isFinal, attempt number, attempt limit, pass mark)
 * from the browser, for whatever email and Registration ID the body named, and
 * issued a CERTIFICATE on a final-exam pass: anyone could post a pass for
 * anyone. Now:
 *   - the student is the SIGNED session, never the body;
 *   - the questions are re-read from the source and scored here
 *     (serverScoring.ts); a question key the source does not have is refused;
 *   - final or not, the attempt limit and the pass mark are the server's, and
 *     the limit is ENFORCED (a passed assessment or an exhausted one cannot be
 *     submitted again);
 *   - the answer is: score, pass or fail, which questions were wrong, and the
 *     correct answers ONLY once the final attempt is used; a final-exam result
 *     withheld until the model is approved is returned as held, with nothing
 *     else.
 * Emails, certificate issuance and the BVM unlock are unchanged, and now run
 * on the server's own result.
 */
export async function POST(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session?.email || !session.registrationId) {
    return NextResponse.json({ success: false, error: 'signed_out', message: 'Your sign-in has expired. Please sign in again; your answers are saved on this device.' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const tabKey = typeof body.tabKey === 'string' ? body.tabKey.trim() : '';
  const answers = Array.isArray(body.answers)
    ? (body.answers as unknown[]).filter((a): a is SubmittedAnswer =>
      !!a && typeof (a as SubmittedAnswer).key === 'string' && typeof (a as SubmittedAnswer).choice === 'string')
    : null;
  if (!tabKey || !answers) {
    return NextResponse.json({ success: false, error: 'Missing tabKey or answers' }, { status: 400 });
  }

  const cleanEmail = session.email;
  const regId = session.registrationId;
  const isFinal = resolveIsFinal(tabKey);
  const maxAtt = maxAttemptsFor(tabKey);

  try {
    // ── The model-submission gate on a final exam (unchanged) ──────────────
    let withholdFinalResult = false;
    if (isFinal) {
      const courseCodeForGate = tabKey.toUpperCase().startsWith('BVM') ? 'BVM' : '3SFM';
      try {
        const modelGate = await getModelSubmissionStatus(cleanEmail, courseCodeForGate);
        if (examLockedNoSubmission(modelGate)) {
          console.warn('[submit-assessment] final-exam blocked: no model submitted', { regId, courseCode: courseCodeForGate });
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
        withholdFinalResult = resultWithheldUntilApproval(modelGate);
      } catch (gateErr) {
        // Fail-open on access: the cert engine gate still holds issuance.
        console.warn('[submit-assessment] model-gate check failed, allowing submission:', gateErr);
      }
    }

    // ── The attempt limit, ENFORCED ─────────────────────────────────────────
    const sb = getServerClient();
    const { data: existing, error: readErr } = await sb
      .from('training_assessment_results')
      .select('attempts, passed')
      .eq('email', cleanEmail)
      .eq('tab_key', tabKey)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (existing?.passed) {
      return NextResponse.json({ success: false, error: 'already_passed', message: 'You have already passed this assessment.' }, { status: 409 });
    }
    const used = Number(existing?.attempts ?? 0);
    if (used >= maxAtt) {
      return NextResponse.json({ success: false, error: 'no_attempts_left', message: 'You have used every attempt for this assessment.' }, { status: 409 });
    }
    const attempt = used + 1;

    // ── Score on the server, from the source ────────────────────────────────
    const q = await getAssessmentQuestions(tabKey, cleanEmail, regId, false, isFinal);
    const rawQ = q as unknown as Record<string, unknown>;
    const source = (q.data?.questions ?? (Array.isArray(rawQ.questions) ? rawQ.questions : [])) as SourceQuestion[];
    if (!q.success || source.length === 0) {
      console.error('[submit-assessment] could not read the questions to score:', q.error ?? 'no questions', { tabKey });
      return NextResponse.json({ success: false, error: 'scoring_unavailable', message: 'We could not score your answers just now. Your answers are saved on this device; please press Submit again in a moment.' }, { status: 503 });
    }
    const scored = scoreSubmission(source, answers);
    if (scored.unknownKeys.length > 0) {
      console.warn('[submit-assessment] refused: answers for questions the source does not have', { tabKey, unknown: scored.unknownKeys.length });
      return NextResponse.json({ success: false, error: 'questions_changed', message: 'This assessment was updated while you were taking it. Please reload the page and submit again.' }, { status: 409 });
    }
    const passMark = Number(q.data?.passingScore ?? rawQ.passingScore ?? 70) || 70;
    const didPass = scored.score >= passMark;

    const { error: writeErr } = await sb.from('training_assessment_results').upsert({
      email: cleanEmail,
      reg_id: regId,
      tab_key: tabKey,
      course_id: tabKey.toUpperCase().startsWith('BVM') ? 'bvm' : '3sfm',
      score: scored.score,
      passed: didPass,
      attempts: attempt,
      is_final: isFinal,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'email,tab_key' });
    if (writeErr) {
      console.error('[submit-assessment] Supabase write failed:', writeErr.message);
      return NextResponse.json({ success: false, error: 'not_recorded', message: 'Your result could not be saved. Please press Submit again.' }, { status: 500 });
    }
    console.info('[submit-assessment] scored on the server', { tabKey, regId, attempt, maxAtt, score: scored.score, passed: didPass });

    try { await deleteInProgressForKey(sb, cleanEmail, { kind: 'cert', tabKey }); }
    catch (cleanupErr) { console.warn('[submit-assessment] in-progress cleanup failed:', cleanupErr); }

    const { data: meta } = await sb.from('training_registrations_meta').select('name').eq('registration_id', regId).maybeSingle();
    const studentName = (meta?.name as string | null) ?? undefined;
    const label = (q.data?.sessionName as string | undefined) || tabKey;

    const finalResultHeld = isFinal && withholdFinalResult;
    const sendFinalEmail = isFinal && !withholdFinalResult;

    after(async () => {
      if (sendFinalEmail) {
        try {
          const { subject, html, text } = await quizResultTemplate({
            name: studentName, sessionName: label, score: scored.score, passMark,
            passed: didPass, attemptsUsed: attempt, maxAttempts: maxAtt,
          });
          await sendEmail({ to: cleanEmail, subject, html, text, from: FROM.training });
        } catch (emailErr) {
          console.error('[submit-assessment] Final-exam result email failed:', emailErr);
        }
      }
      if (!didPass && attempt >= maxAtt && !finalResultHeld) {
        try {
          const { subject, html, text } = await lockedOutTemplate({
            name: studentName, sessionName: label, attemptsUsed: attempt, maxAttempts: maxAtt,
          });
          await sendEmail({ to: cleanEmail, subject, html, text, from: FROM.training });
        } catch (lockErr) {
          console.error('[submit-assessment] Locked-out email failed:', lockErr);
        }
      }
    });

    // Inline certificate issuance on a SERVER-SCORED final-exam pass.
    if (didPass && isFinal && !finalResultHeld) {
      const courseCode = tabKey.toUpperCase().startsWith('BVM') ? 'BVM' : '3SFM';
      after(async () => {
        console.log('[submit-assessment] cert trigger entering issueCertificateForStudent', { regId, courseCode });
        try {
          const res = await issueCertificateForStudent(cleanEmail, courseCode, { issuedVia: 'auto' });
          if (res.ok) {
            console.log('[submit-assessment] inline cert issuance:', { regId, courseCode, skipped: (res as { skipped?: boolean }).skipped === true, certificateId: res.certificateId });
          } else {
            console.error('[submit-assessment] inline cert issuance FAILED (admin safety-net will surface):', { regId, courseCode, error: res.error });
          }
        } catch (certErr) {
          console.error('[submit-assessment] inline cert issuance threw (admin safety-net will surface):', { regId, courseCode, err: String(certErr) });
        }
      });

      // BVM auto-unlock when a student passes the 3SFM Final (idempotent via
      // the UNIQUE (registration_id, course_code) of migration 132).
      if (courseCode === '3SFM') {
        after(async () => {
          try {
            const { error } = await getServerClient().from('training_enrollments').insert({ registration_id: regId, course_code: 'BVM' });
            if (error && !error.message.toLowerCase().includes('duplicate')) {
              console.error('[submit-assessment] BVM auto-unlock failed', { regId, error: error.message });
            } else {
              console.log('[submit-assessment] BVM auto-unlocked for', regId);
            }
          } catch (enrollErr) {
            console.error('[submit-assessment] BVM auto-unlock threw:', enrollErr);
          }
        });
      }
    }

    if (finalResultHeld) {
      return NextResponse.json({ success: true, recorded: true, held: true, attempts: attempt, maxAttempts: maxAtt });
    }
    const reveal = revealAnswerKey(attempt, maxAtt);
    return NextResponse.json({
      success: true,
      recorded: true,
      score: scored.score,
      passed: didPass,
      passingScore: passMark,
      correctCount: scored.correctCount,
      totalQuestions: scored.total,
      attempts: attempt,
      maxAttempts: maxAtt,
      canRetry: !didPass && attempt < maxAtt,
      wrong: scored.outcomes.filter((o) => !o.isCorrect).map((o) => o.key),
      // The answer key, ONLY once the final attempt is used.
      review: reveal ? scored.outcomes.map((o) => ({ key: o.key, correctText: o.correctText, explanation: o.explanation })) : undefined,
    });
  } catch (err) {
    console.error('[submit-assessment] Error:', err);
    return NextResponse.json({ success: false, error: 'error', message: 'Something went wrong. Your answers are saved on this device; please press Submit again.' }, { status: 500 });
  }
}
