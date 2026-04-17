import { NextRequest, NextResponse } from 'next/server';
import { getAssessmentQuestions } from '@/src/lib/training/sheets';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tabKey  = searchParams.get('tabKey');
  const email   = searchParams.get('email');
  const regId   = searchParams.get('regId');
  const shuffle = searchParams.get('shuffle');

  if (!tabKey || !email || !regId) {
    return NextResponse.json({ success: false, error: 'Missing tabKey, email, or regId' }, { status: 400 });
  }

  const result = await getAssessmentQuestions(tabKey, email, regId, shuffle === 'false' ? false : undefined);

  if (!result.success) {
    console.error('[questions] getAssessmentQuestions failed:', result.error, { tabKey, email });
    return NextResponse.json({ success: false, error: result.error ?? 'Failed to load questions' });
  }

  // Normalize question fields - handle both nested `data` and flat root shapes
  const raw    = result as unknown as Record<string, unknown>;
  const nested = result.data;
  const rawQs  = nested?.questions ?? (Array.isArray(raw.questions) ? raw.questions : []);

  // Normalize each question: map field name variants + ensure correctIndex exists
  const normalizedQs = (rawQs as Record<string, unknown>[]).map((q) => ({
    ...q,
    // Normalise question text field
    q: (q.q as string) || (q.question as string) || (q.questionText as string) || '',
    // Normalise correct answer index: Apps Script may return as `correctAnswer`, `answer`, or `correctIndex`
    correctIndex: q.correctIndex ?? q.correctAnswer ?? q.answer ?? undefined,
    // Normalise explanation: Apps Script may use `explanation`, `hint`, or `rationale`
    explanation: (q.explanation as string) || (q.hint as string) || (q.rationale as string) || '',
  }));

  const data = {
    tabKey:       nested?.tabKey       ?? raw.tabKey       ?? tabKey,
    sessionName:  nested?.sessionName  ?? raw.sessionName,
    course:       nested?.course       ?? raw.course,
    isFinal:      nested?.isFinal      ?? raw.isFinal      ?? false,
    questions:    normalizedQs,
    timeLimit:    nested?.timeLimit     ?? raw.timeLimit,
    passingScore: nested?.passingScore  ?? raw.passingScore,
    maxAttempts:  nested?.maxAttempts   ?? raw.maxAttempts,
  };

  if (!normalizedQs.length) {
    console.error('[questions] No questions in response:', { tabKey, hasNested: !!nested, rawKeys: Object.keys(raw) });
  }

  console.log('[questions] Returning', normalizedQs.length, 'questions, first correctIndex:', normalizedQs[0]?.correctIndex, 'first explanation:', (normalizedQs[0]?.explanation as string)?.substring(0, 50) || '(empty)');

  return NextResponse.json({ success: true, data });
}
