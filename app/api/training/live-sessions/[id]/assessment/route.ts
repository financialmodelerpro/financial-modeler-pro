import { NextRequest, NextResponse } from 'next/server';
import { getAssessment, stripAnswersForStudent } from '@/src/hubs/training/lib/assessment/liveSessionAssessments';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const assessment = await getAssessment(id);
  if (!assessment || !assessment.enabled) {
    return NextResponse.json({ assessment: null });
  }
  return NextResponse.json({ assessment: stripAnswersForStudent(assessment) });
}
