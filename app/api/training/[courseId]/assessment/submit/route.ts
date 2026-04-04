import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';

interface QuestionOption {
  text: string;
  is_correct: boolean;
}

interface AssessmentQuestion {
  id: string;
  options: QuestionOption[];
  points: number;
}

interface SubmitBody {
  assessmentId: string;
  answers: Record<string, number>;
  timeTaken?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as SubmitBody;
  const { courseId } = await params;
  const sb = getServerClient();

  const { data: user } = await sb
    .from('users')
    .select('id, full_name')
    .eq('email', session.user.email)
    .maybeSingle();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: assessment } = await sb
    .from('assessments')
    .select('id, pass_score, max_attempts, title, assessment_questions(id, options, points)')
    .eq('id', body.assessmentId)
    .single();
  if (!assessment) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });

  const { count: attemptCount } = await sb
    .from('assessment_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('assessment_id', body.assessmentId)
    .eq('user_id', user.id);

  if ((attemptCount ?? 0) >= assessment.max_attempts) {
    return NextResponse.json({ error: 'Maximum attempts reached' }, { status: 429 });
  }

  const { data: existingCert } = await sb
    .from('certificates')
    .select('id')
    .eq('user_id', user.id)
    .eq('course_id', courseId)
    .maybeSingle();
  if (existingCert) return NextResponse.json({ error: 'Already certified' }, { status: 409 });

  const questions = assessment.assessment_questions as AssessmentQuestion[];
  let totalPoints = 0;
  let earnedPoints = 0;
  for (const q of questions) {
    totalPoints += q.points;
    const selectedIdx = body.answers[q.id];
    if (selectedIdx !== undefined && q.options[selectedIdx]?.is_correct) {
      earnedPoints += q.points;
    }
  }
  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const passed = score >= assessment.pass_score;

  const { data: attempt } = await sb
    .from('assessment_attempts')
    .insert({
      user_id: user.id,
      assessment_id: body.assessmentId,
      answers: body.answers,
      score,
      passed,
      time_taken: body.timeTaken ?? null,
    })
    .select()
    .single();

  let certificate: unknown = null;
  if (passed) {
    const certNum = `FMP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const { data: cert } = await sb
      .from('certificates')
      .insert({
        user_id: user.id,
        course_id: courseId,
        assessment_id: body.assessmentId,
        certificate_number: certNum,
      })
      .select()
      .single();
    certificate = cert;
  }

  const gradedQuestions = questions.map(q => ({
    id: q.id,
    correct_index: q.options.findIndex(o => o.is_correct),
    selected_index: body.answers[q.id] ?? null,
  }));

  return NextResponse.json({ score, passed, attempt, certificate, gradedQuestions });
}
