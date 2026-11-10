import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { listLiveCourses } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { createCourse } from '@/src/hubs/training/lib/liveCourse/courseAdmin';
import { invalidateLiveCourseCache } from '@/src/hubs/training/lib/liveCourse/cachedReads';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/live-course: every live course with its status, session
 * count, enrolment count and next session (admin list and pickers).
 */
export async function GET() {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const courses = await listLiveCourses(sb, { includeInactive: true });
  const codes = courses.map((c) => c.courseCode);
  const sessionsBy = new Map<string, { count: number; next: string | null }>();
  const enrolledBy = new Map<string, number>();
  if (codes.length) {
    const [{ data: sessions }, { data: enrols }] = await Promise.all([
      sb.from('live_sessions').select('course_code, scheduled_datetime').in('course_code', codes),
      sb.from('training_enrollments').select('course_code').in('course_code', codes).range(0, 49999),
    ]);
    const now = Date.now();
    for (const s of sessions ?? []) {
      const c = sessionsBy.get(s.course_code as string) ?? { count: 0, next: null };
      c.count++;
      const t = s.scheduled_datetime ? new Date(s.scheduled_datetime as string).getTime() : NaN;
      if (t > now && (!c.next || t < new Date(c.next).getTime())) c.next = s.scheduled_datetime as string;
      sessionsBy.set(s.course_code as string, c);
    }
    for (const e of enrols ?? []) enrolledBy.set(e.course_code as string, (enrolledBy.get(e.course_code as string) ?? 0) + 1);
  }
  return NextResponse.json({
    courses: courses.map((c) => ({
      ...c,
      sessionCount: sessionsBy.get(c.courseCode)?.count ?? 0,
      nextSessionAt: sessionsBy.get(c.courseCode)?.next ?? null,
      enrolledCount: enrolledBy.get(c.courseCode) ?? 0,
    })),
  });
}

/** POST /api/admin/live-course { courseCode, title }: a new course, as a draft. */
export async function POST(req: NextRequest) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { courseCode?: string; title?: string };
  const r = await createCourse(getServerClient(), { courseCode: body.courseCode ?? '', title: body.title ?? '' });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  invalidateLiveCourseCache();
  return NextResponse.json(r);
}
