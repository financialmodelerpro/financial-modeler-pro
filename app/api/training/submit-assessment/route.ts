import { NextRequest, NextResponse } from 'next/server';
import { submitAssessmentToAppsScript } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { quizResultTemplate } from '@/src/lib/email/templates/quizResult';
import { lockedOutTemplate } from '@/src/lib/email/templates/lockedOut';

/**
 * POST /api/training/submit-assessment
 *
 * Accepts a PRE-SCORED result from the client and records it in Apps Script.
 * Scoring is done entirely client-side - this endpoint does NOT re-fetch
 * questions or re-score. It only forwards the score to Apps Script for storage.
 *
 * Also sends quiz result email (and locked-out email if max attempts reached).
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

    // Record scored result in Apps Script (V8: website scores, Apps Script stores)
    const numScore = Number(score);
    const didPass = passed ?? numScore >= 70;

    // Compute attempt number server-side from Supabase — don't trust the
    // client. The client derives attemptNo from /api/training/attempt-status
    // which reads Apps Script; when Apps Script's counter is stale or not
    // incrementing on fail, every submission arrives as attempt #1 and the
    // counter never advances. Source of truth: training_assessment_results.
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
      const clientAttempt    = Number(attemptNo ?? 0);
      // Monotonic: never decrease. Take max(existing, client) + 1 so a stale
      // client value doesn't overwrite a higher server count.
      serverAttempt = Math.max(existingAttempts, clientAttempt) + 1;
    } catch (readErr) {
      console.warn('[submit-assessment] Supabase read failed, falling back to client attempt:', readErr);
      serverAttempt = Number(attemptNo ?? 1);
    }
    const attempt = serverAttempt;

    const recordRes = await submitAssessmentToAppsScript({
      tabKey,
      regId,
      email,
      score:     numScore,
      passed:    didPass,
      isFinal:   isFinal ?? false,
      attemptNo: attempt,
    });

    if (!recordRes.success) {
      console.error('[submit-assessment] Apps Script record failed:', recordRes.error, { tabKey, email });
      // Return success anyway - the score was calculated correctly client-side
      // The student should see their result even if the write-back fails
      return NextResponse.json({
        success: true,
        recorded: false,
        warning: 'Score calculated but failed to save to server. It will sync on next attempt.',
      });
    }

    console.log('[submit-assessment] Recorded successfully:', { tabKey, email, score, passed, attemptNo });

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
      // Non-fatal - Apps Script is the backup
    }

    // Send quiz result email (fire-and-forget - don't block the response)
    const label = sessionName || tabKey;
    const passMark = passingScore ?? 70;
    const maxAtt = maxAttempts ?? (isFinal ? 1 : 3);

    (async () => {
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
    })();

    return NextResponse.json({ success: true, recorded: true });
  } catch (err) {
    console.error('[submit-assessment] Error:', err);
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
}
