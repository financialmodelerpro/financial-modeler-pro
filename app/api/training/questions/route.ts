import { NextRequest, NextResponse } from 'next/server';
import { getAssessmentQuestions } from '@/src/lib/sheets';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tabKey = searchParams.get('tabKey');
  const email  = searchParams.get('email');
  const regId  = searchParams.get('regId');

  if (!tabKey || !email || !regId) {
    return NextResponse.json({ success: false, error: 'Missing tabKey, email, or regId' }, { status: 400 });
  }

  const result = await getAssessmentQuestions(tabKey, email, regId);

  if (!result.success) {
    console.error('[questions] getAssessmentQuestions failed:', result.error, { tabKey, email });
    return NextResponse.json({ success: false, error: result.error ?? 'Failed to load questions' });
  }

  // Apps Script may return fields at root level rather than nested under `data`
  if (!result.data) {
    const raw = result as unknown as Record<string, unknown>;
    const data = {
      tabKey:        raw.tabKey        ?? tabKey,
      sessionName:   raw.sessionName,
      course:        raw.course,
      isFinal:       raw.isFinal       ?? false,
      questions:     (Array.isArray(raw.questions) ? raw.questions : []).map((q: Record<string, unknown>) => ({
        ...q,
        // Normalise to `q` — Apps Script field is `q`; guard against `question`/`questionText` variants
        q: (q.q as string) || (q.question as string) || (q.questionText as string) || '',
      })),
      timeLimit:     raw.timeLimit,
      passingScore:  raw.passingScore,
      maxAttempts:   raw.maxAttempts,
    };
    if (!(data.questions as unknown[]).length) {
      console.error('[questions] No questions in response:', raw, { tabKey });
    }
    return NextResponse.json({ success: true, data });
  }

  return NextResponse.json(result);
}
