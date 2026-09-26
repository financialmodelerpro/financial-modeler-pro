/**
 * GET /api/training/questions?tabKey=...
 *
 * The questions of one assessment, for the signed-in student.
 *
 * 2026-09-26: this used to send every question WITH its correct answer and
 * explanation (the browser scored itself), and took the student's identity
 * from the URL. Now identity is the SIGNED session, and each question carries
 * its key, text and options ONLY (publicQuestion in serverScoring.ts): the
 * answer key never leaves the server, which scores in submit-assessment.
 * The email and regId the page still sends in the URL are ignored.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAssessmentQuestions } from '@/src/hubs/training/lib/appsScript/sheets';
import { resolveIsFinal, looksLikeModelGateError } from '@/src/hubs/training/lib/assessment/modelGateScope';
import { publicQuestion, type SourceQuestion } from '@/src/hubs/training/lib/assessment/serverScoring';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export async function GET(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session?.email || !session.registrationId) {
    return NextResponse.json({ success: false, error: 'Please sign in again.' }, { status: 401 });
  }
  const tabKey = new URL(req.url).searchParams.get('tabKey');
  if (!tabKey) return NextResponse.json({ success: false, error: 'Missing tabKey' }, { status: 400 });

  // Assessment-type check from the static COURSES config, so the model-
  // submission gate can only fire on a Final Exam.
  const isFinal = resolveIsFinal(tabKey);
  const result = await getAssessmentQuestions(tabKey, session.email, session.registrationId, false, isFinal);

  if (!result.success) {
    const rawError = result.error ?? 'Failed to load questions';
    if (!isFinal && looksLikeModelGateError(rawError)) {
      console.error('[questions] Apps Script applied model gate to non-final session, ignoring:', { tabKey, rawError });
      return NextResponse.json({ success: false, error: 'Could not load questions. Please try again or contact support.' });
    }
    console.error('[questions] getAssessmentQuestions failed:', rawError, { tabKey });
    return NextResponse.json({ success: false, error: rawError });
  }

  const raw    = result as unknown as Record<string, unknown>;
  const nested = result.data;
  const rawQs  = (nested?.questions ?? (Array.isArray(raw.questions) ? raw.questions : [])) as SourceQuestion[];
  const questions = rawQs.map(publicQuestion);

  if (!questions.length) console.error('[questions] No questions in response:', { tabKey, hasNested: !!nested, rawKeys: Object.keys(raw) });

  return NextResponse.json({
    success: true,
    data: {
      tabKey:       nested?.tabKey       ?? raw.tabKey       ?? tabKey,
      sessionName:  nested?.sessionName  ?? raw.sessionName,
      course:       nested?.course       ?? raw.course,
      isFinal,
      questions,
      timeLimit:    nested?.timeLimit    ?? raw.timeLimit,
      passingScore: nested?.passingScore ?? raw.passingScore,
    },
  });
}
