import { NextRequest, NextResponse } from 'next/server';
import {
  getAssessmentQuestions,
  getAttemptStatus,
  submitAssessmentToAppsScript,
} from '@/src/lib/training/sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { tabKey?: string; email?: string; regId?: string; answers?: number[] };
    const { tabKey, email, regId, answers } = body;

    if (!tabKey || !email || !regId || !Array.isArray(answers)) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Fetch questions server-side (includes correctIndex for local scoring)
    const questionsRes = await getAssessmentQuestions(tabKey, email, regId);
    if (!questionsRes.success || !questionsRes.data) {
      return NextResponse.json({
        success: false,
        error: questionsRes.error ?? 'Failed to fetch assessment questions',
      });
    }

    const { questions, passingScore = 70, maxAttempts = 3, isFinal = false } = questionsRes.data;

    // 2. Score locally — compare submitted answer index to correctIndex
    let correctCount = 0;
    const results = questions.map((q, i) => {
      const submitted = typeof answers[i] === 'number' ? answers[i] : -1;
      const correct   = typeof q.correctIndex === 'number' ? q.correctIndex : -1;
      const isCorrect = correct >= 0 && submitted === correct;
      if (isCorrect) correctCount++;
      return {
        index:         i,
        q:             q.q,
        options:       q.options,
        submitted,
        submittedText: submitted >= 0 ? (q.options[submitted] ?? '') : '',
        correct,
        correctText:   correct   >= 0 ? (q.options[correct]   ?? '') : '',
        isCorrect,
        explanation:   '',
      };
    });

    const totalQuestions = questions.length;
    const score          = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const passed         = score >= passingScore;

    // 3. Get current attempt count to determine attemptNo
    const statusRes    = await getAttemptStatus(tabKey, email, regId);
    const attemptsUsed = statusRes.success && statusRes.data ? statusRes.data.attempts : 0;
    const attemptNo    = attemptsUsed + 1;
    const canRetry     = !passed && attemptNo < maxAttempts;

    // 4. Record scored result in Apps Script (V8: website scores, Apps Script stores)
    const recordRes = await submitAssessmentToAppsScript({
      tabKey, regId, email, score, passed, isFinal, attemptNo,
    });
    if (!recordRes.success) {
      console.error('[submit-assessment] Apps Script record failed:', recordRes.error, { tabKey, email });
      // Continue — return score to client even if Apps Script write fails
    }

    console.log('[submit-assessment] scored locally:', { tabKey, email, score, passed, attemptNo });

    return NextResponse.json({
      success: true,
      data: {
        tabKey,
        score,
        passed,
        correctCount,
        totalQuestions,
        attempts:   attemptNo,
        maxAttempts,
        canRetry,
        results,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
}
