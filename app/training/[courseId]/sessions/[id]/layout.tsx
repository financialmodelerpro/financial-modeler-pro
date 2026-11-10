import { notFound, redirect } from 'next/navigation';
import { getServerClient } from '@/src/core/db/supabase';
import { courseSessionPath } from '@/src/hubs/training/lib/liveCourse/paths';
import { listCourseSessionsCached } from '@/src/hubs/training/lib/liveCourse/cachedReads';

export const dynamic = 'force-dynamic';

/**
 * Only a session of THIS course opens here: one of another course goes to
 * its own course, and a single (course-less) session stays at
 * /training/live-sessions/<id>.
 */
export default async function CourseSessionLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ courseId: string; id: string }>;
}) {
  const { courseId, id } = await params;
  // Already in this course's (cached) published list: nothing to look up.
  if ((await listCourseSessionsCached(decodeURIComponent(courseId))).some((s) => s.id === id)) return <>{children}</>;
  const { data } = await getServerClient().from('live_sessions').select('course_code').eq('id', id).maybeSingle();
  const code = (data?.course_code as string | null) ?? null;
  if (!code) notFound();
  if (decodeURIComponent(courseId) !== code) {
    redirect(courseSessionPath(code, id));
  }
  return <>{children}</>;
}
