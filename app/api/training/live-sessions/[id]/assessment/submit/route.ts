import { NextRequest, NextResponse } from 'next/server';
import { submitAttempt } from '@/src/lib/training/liveSessionAssessments';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';

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
    const { attempt, canRetry, assessment } = await submitAttempt({
      sessionId: id,
      email: sess.email,
      regId: sess.registrationId || null,
      answers: body.answers,
      timeTakenSeconds: Number.isFinite(body.timeTakenSeconds) ? body.timeTakenSeconds! : null,
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
