import { redirect } from 'next/navigation';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';

export const dynamic = 'force-dynamic';

/** The old course URL: a live course now lives at /training/<CODE> (paths.ts). */
export default async function OldLiveCourseUrl({ params, searchParams }: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') q.set(k, v);
  const qs = q.toString();
  redirect(`${coursePagePath(decodeURIComponent(code))}${qs ? `?${qs}` : ''}`);
}
