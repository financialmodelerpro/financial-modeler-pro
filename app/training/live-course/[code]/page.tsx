import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { LiveCourseClient } from './LiveCourseClient';

export const metadata: Metadata = {
  title: 'Live Course | FMP Training Hub',
};

export const dynamic = 'force-dynamic';

export default async function LiveCoursePage({
  params, searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ enrol?: string }>;
}) {
  const { code } = await params;
  const { enrol } = await searchParams;
  const sess = await getTrainingCookieSession();
  if (!sess) {
    // Keep the course (and the enrol intent) through sign-in.
    const back = `/training/live-course/${encodeURIComponent(code)}${enrol === '1' ? '?enrol=1' : ''}`;
    redirect(`/signin?redirect=${encodeURIComponent(back)}`);
  }
  return <LiveCourseClient courseCode={code.toUpperCase()} autoEnrol={enrol === '1'} />;
}
