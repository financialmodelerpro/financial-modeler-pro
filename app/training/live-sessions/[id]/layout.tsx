import { redirect } from 'next/navigation';
import { getServerClient } from '@/src/core/db/supabase';
import { courseSessionPath } from '@/src/hubs/training/lib/liveCourse/paths';

export const dynamic = 'force-dynamic';

/**
 * A session that belongs to a live course lives under its course
 * (/training/<CODE>/sessions/<id>); its old URL redirects there. Single
 * sessions are unchanged. Course sessions have no assessment, so the
 * assessment sub-page never needs to keep its own path.
 */
export default async function LiveSessionIdLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data } = await getServerClient().from('live_sessions').select('course_code').eq('id', id).maybeSingle();
  const code = (data?.course_code as string | null) ?? null;
  if (code) redirect(courseSessionPath(code, id));
  return <>{children}</>;
}
