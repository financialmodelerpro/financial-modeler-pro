import { NextRequest, NextResponse } from 'next/server';
import { submitAttempt } from '@/src/lib/training/liveSessionAssessments';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';
import { getServerClient } from '@/src/core/db/supabase';
import { deleteInProgressForKey } from '@/src/lib/training/attemptInProgress';

export const dynamic = 'force-dynamic';

interface SubmitPayload {
  answers: Record<string, number>;
  timeTakenSeconds?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = (await req.json()) as SubmitPayload;
  if (!body || typeof body !== 'object' || !body.answers) {
    return NextResponse.json({ error: 'answers required' }, { status: 400 });
  }

  try {
    // Snapshot pause history off the in-progress row BEFORE submit deletes it.
    // The denormalized fields land on live_session_attempts so the admin
    // attempts viewer can surface pause counts after cleanup (migration 126).
    let pauseSnapshot: { pauseCount: number; totalPausedSeconds: number; pauseLog: unknown[] } | undefined;
    try {
      const sb = getServerClient();
      const { data: inProg } = await sb
        .from('assessment_attempts_in_progress')
        .select('pause_count, grace_seconds_used, pause_log')
        .eq('email', sess.email.toLowerCase())
        .eq('session_id', id)
        .order('attempt_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inProg) {
        pauseSnapshot = {
          pauseCount:         Number(inProg.pause_count ?? 0),
          totalPausedSeconds: Number(inProg.grace_seconds_used ?? 0),
          pauseLog:           Array.isArray(inProg.pause_log) ? inProg.pause_log : [],
        };
      }
    } catch (snapErr) {
      console.warn('[live-session submit] pause snapshot read failed:', snapErr);
    }

    const { attempt, canRetry, assessment } = await submitAttempt({
      sessionId: id,
      email: sess.email,
      regId: sess.registrationId || null,
      answers: body.answers,
      timeTakenSeconds: Number.isFinite(body.timeTakenSeconds) ? body.timeTakenSeconds! : null,
      pauseSnapshot,
    });

    // Build student-safe result payload. Per-question correctness always
    // returned so students can see what they missed. Correct answers + answer
    // explanations only revealed when they have passed (prevents farming).
    const explanations = attempt.passed
      ? assessment.questions
          .filter(q => !!q.explanation)
          .map(q => ({ id: q.id, explanation: q.explanation ?? '' }))
      : [];
    const correctAnswers = attempt.passed
      ? assessment.questions.reduce<Record<string, number>>((acc, q) => {
          acc[q.id] = q.correct_index;
          return acc;
        }, {})
      : {};
    // Correct-answer TEXT is sent too so the client can render it regardless of
    // whether options were shuffled client-side.
    const correctAnswerTexts = attempt.passed
      ? assessment.questions.reduce<Record<string, string>>((acc, q) => {
          acc[q.id] = q.options?.[q.correct_index] ?? '';
          return acc;
        }, {})
      : {};

    // Best-effort cleanup of the in-progress attempt row (migration 126).
    try {
      const sb = getServerClient();
      await deleteInProgressForKey(sb, sess.email, { kind: 'live', sessionId: id });
    } catch (cleanupErr) {
      console.warn('[live-session submit] in-progress cleanup failed:', cleanupErr);
    }

    return NextResponse.json({
      score: attempt.score,
      passed: attempt.passed,
      attempt_number: attempt.attempt_number,
      can_retry: canRetry,
      max_attempts: assessment.max_attempts,
      question_results: attempt.question_results,
      correct_answers: correctAnswers,
      correct_answer_texts: correctAnswerTexts,
      explanations,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
