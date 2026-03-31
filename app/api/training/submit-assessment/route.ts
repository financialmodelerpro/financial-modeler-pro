import { NextRequest, NextResponse } from 'next/server';
import { submitAssessment } from '@/src/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { tabKey?: string; email?: string; regId?: string; answers?: number[] };
    const { tabKey, email, regId, answers } = body;

    if (!tabKey || !email || !regId || !Array.isArray(answers)) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const result = await submitAssessment(tabKey, email, regId, answers);

    if (!result.success) {
      console.error('[submit-assessment] Apps Script error:', result.error, { tabKey, email });
      return NextResponse.json({ success: false, error: result.error ?? 'Submission failed' });
    }

    // Apps Script may return fields at root level rather than nested under `data`
    if (!result.data) {
      const raw = result as unknown as Record<string, unknown>;
      // Handle field name variants: score/percentage, correctCount/correctAnswers, attempts/attemptsUsed
      const score        = (typeof raw.score === 'number'        ? raw.score        : Number(raw.percentage)    || 0);
      const correctCount = (typeof raw.correctCount === 'number' ? raw.correctCount : Number(raw.correctAnswers) || 0);
      const attempts     = (typeof raw.attemptsUsed === 'number' ? raw.attemptsUsed : Number(raw.attempts)      || 1);
      const data = {
        tabKey:         (raw.tabKey         as string)  ?? tabKey,
        score,
        passed:         (raw.passed         as boolean) ?? false,
        correctCount,
        totalQuestions: (raw.totalQuestions as number)  ?? 0,
        attempts,
        maxAttempts:    (raw.maxAttempts    as number)  ?? 3,
        canRetry:       (raw.canRetry       as boolean) ?? false,
        feedback:        raw.feedback as string | undefined,
        results:         Array.isArray(raw.results) ? raw.results : undefined,
      };
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
}
