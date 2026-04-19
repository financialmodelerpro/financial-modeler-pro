import { NextRequest, NextResponse } from 'next/server';
import { getStudentAttempts } from '@/src/lib/training/liveSessionAssessments';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const attempts = await getStudentAttempts(id, sess.email);

  // Never ship the raw `answers` jsonb back — students only need score +
  // attempt_number + pass/fail + per-question correctness for the history UI.
  return NextResponse.json({
    attempts: attempts.map(a => ({
      id: a.id,
      attempt_number: a.attempt_number,
      score: a.score,
      passed: a.passed,
      question_results: a.question_results,
      time_taken_seconds: a.time_taken_seconds,
      submitted_at: a.submitted_at,
    })),
  });
}
