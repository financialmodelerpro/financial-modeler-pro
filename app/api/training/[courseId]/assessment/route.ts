import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';

interface QuestionOption {
  text: string;
  is_correct: boolean;
}

interface AssessmentQuestion {
  id: string;
  question: string;
  options: QuestionOption[];
  points: number;
  display_order: number;
  explanation: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { courseId } = await params;
  const sb = getServerClient();

  const { data: assessment, error: aErr } = await sb
    .from('assessments')
    .select('id, title, description, pass_score, time_limit, max_attempts, assessment_questions(id, question, options, points, display_order, explanation)')
    .eq('course_id', courseId)
    .eq('visible', true)
    .maybeSingle();

  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!assessment) return NextResponse.json(null);

  const { data: user } = await sb
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .maybeSingle();

  let attempts: unknown[] = [];
  let certificate: unknown = null;

  if (user) {
    const { data: att } = await sb
      .from('assessment_attempts')
      .select('id, score, passed, submitted_at, time_taken')
      .eq('assessment_id', assessment.id)
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false });
    attempts = att ?? [];

    const { data: cert } = await sb
      .from('certificates')
      .select('certificate_number, issued_at')
      .eq('course_id', courseId)
      .eq('user_id', user.id)
      .maybeSingle();
    certificate = cert;
  }

  const safeQuestions = (assessment.assessment_questions as AssessmentQuestion[])
    ?.sort((a, b) => a.display_order - b.display_order)
    .map(q => ({
      id: q.id,
      question: q.question,
      options: q.options.map((o: QuestionOption) => ({ text: o.text })),
      points: q.points,
    }));

  return NextResponse.json({
    assessment: { ...assessment, assessment_questions: safeQuestions },
    attempts,
    certificate,
  });
}
