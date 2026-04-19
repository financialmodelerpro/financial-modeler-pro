import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';
import { getServerClient } from '@/src/lib/shared/supabase';
import {
  getAssessment,
  getStudentAttempts,
  getWatchPercentage,
  stripAnswersForStudent,
} from '@/src/lib/training/liveSessionAssessments';
import { AssessmentClient } from './AssessmentClient';

export const metadata: Metadata = {
  title: 'Assessment | FMP Real-World Financial Modeling',
};

export const dynamic = 'force-dynamic';

export default async function LiveSessionAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sess = await getTrainingCookieSession();
  if (!sess) redirect('/signin');

  const sb = getServerClient();
  const { data: sessionRow } = await sb
    .from('live_sessions')
    .select('id, title, instructor_name, duration_minutes, banner_url')
    .eq('id', id)
    .maybeSingle();

  if (!sessionRow) redirect('/training/live-sessions');

  const assessment = await getAssessment(id);
  if (!assessment || !assessment.enabled || (assessment.questions?.length ?? 0) === 0) {
    redirect(`/training/live-sessions/${id}`);
  }

  const attempts = await getStudentAttempts(id, sess.email);
  const watchPct = await getWatchPercentage(id, sess.email);

  return (
    <AssessmentClient
      session={sessionRow}
      assessment={stripAnswersForStudent(assessment)}
      previousAttempts={attempts.map(a => ({
        attempt_number: a.attempt_number,
        score: a.score,
        passed: a.passed,
        submitted_at: a.submitted_at,
      }))}
      watchPercentage={watchPct}
      studentEmail={sess.email}
    />
  );
}
