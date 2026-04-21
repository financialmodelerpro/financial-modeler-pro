import { redirect } from 'next/navigation';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';
import { getServerClient } from '@/src/lib/shared/supabase';
import { EnrollClient } from './EnrollClient';

export const revalidate = 0;

/**
 * Post-login course enrollment page. Reached when a freshly-registered
 * student lands on /training/dashboard with no training_enrollments rows.
 * The dashboard server-redirects here; this page lists available courses
 * and lets the student pick one (or both). After enroll, we send them to
 * the dashboard for that course.
 */
export default async function TrainingEnrollPage() {
  const session = await getTrainingCookieSession();
  if (!session) {
    redirect('/signin?next=/training/enroll');
  }

  const sb = getServerClient();
  const { data: enrollments } = await sb
    .from('training_enrollments')
    .select('course_code')
    .eq('registration_id', session.registrationId);

  const enrolled = new Set((enrollments ?? []).map(e => e.course_code));

  return (
    <EnrollClient
      enrolled={Array.from(enrolled)}
    />
  );
}
