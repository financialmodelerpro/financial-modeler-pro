import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { getLiveCourseSettings, isLiveCourseRow, listCourseSessions } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { courseUpdateFromBody, isCourseStatus, statusUpdate } from '@/src/hubs/training/lib/liveCourse/courseAdmin';
import { previewToken } from '@/src/hubs/training/lib/liveCourse/preview';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/enrolment';
import { invalidateLiveCourseCache } from '@/src/hubs/training/lib/liveCourse/cachedReads';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export const dynamic = 'force-dynamic';

/** GET /api/admin/live-course/[code]: the course, its sessions (published or not) and attendance counts. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { code } = await params;
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });
  const sessions = await listCourseSessions(sb, course.courseCode, { publishedOnly: false });
  const ids = sessions.map((s) => s.id);

  const counts = new Map<string, { matched: number; unmatched: number }>();
  const sync = new Map<string, { attendance_synced_at: string | null; attendance_sync_error: string | null; has_link: boolean }>();
  if (ids.length) {
    const [{ data: att }, { data: meta }] = await Promise.all([
      sb.from('live_session_attendance').select('session_id, student_email').in('session_id', ids),
      sb.from('live_sessions').select('id, attendance_synced_at, attendance_sync_error, live_url').in('id', ids),
    ]);
    for (const a of att ?? []) {
      const c = counts.get(a.session_id as string) ?? { matched: 0, unmatched: 0 };
      if (a.student_email) c.matched++; else c.unmatched++;
      counts.set(a.session_id as string, c);
    }
    for (const m of meta ?? []) sync.set(m.id as string, {
      attendance_synced_at: (m.attendance_synced_at as string | null) ?? null,
      attendance_sync_error: (m.attendance_sync_error as string | null) ?? null,
      has_link: !!(m.live_url as string | null),
    });
  }
  return NextResponse.json({
    course,
    // A link that shows the course page before it is published (draft/archived).
    previewUrl: `${LEARN_URL}${coursePagePath(course.courseCode)}?preview=${previewToken(course.courseCode)}`,
    sessions: sessions.map((s) => ({ ...s, ...(sync.get(s.id) ?? {}), attendance: counts.get(s.id) ?? { matched: 0, unmatched: 0 } })),
  });
}

/**
 * PATCH /api/admin/live-course/[code]
 *   { ...details and rules }            validated by courseUpdateFromBody
 *   { status: 'draft' | 'published' | 'archived' }   Publish / Unpublish / Archive
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const by = await adminEmail();
  if (!by) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { code } = await params;
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { ok, update, errors } = courseUpdateFromBody(body);
  if (!ok) return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  if (body.status !== undefined) {
    if (!isCourseStatus(body.status)) return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
    Object.assign(update, statusUpdate(body.status));
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  update.updated_at = new Date().toISOString();

  const { error } = await sb.from('training_course_settings').update(update).eq('course_code', course.courseCode);
  if (error) {
    const hint = /column .* does not exist|schema cache/i.test(error.message) ? ' (apply migration 249)' : '';
    return NextResponse.json({ error: `${error.message}${hint}` }, { status: 500 });
  }
  invalidateLiveCourseCache();
  return NextResponse.json({ ok: true, course: await getLiveCourseSettings(sb, course.courseCode) });
}
