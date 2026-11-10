import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { listLiveCourses } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import type { ModelSubmissionRow, ModelAttemptView, MyModelLiveCourse } from '@/src/hubs/training/lib/modelSubmission/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/training/model-submission/history
 *
 * Every model-submission attempt for the signed-in student, grouped by course,
 * newest first. Powers the "My Model" dashboard view, which is the one place a
 * student can see their whole submission history: what they sent, what the
 * reviewer said, and the marked-up model returned for each attempt.
 *
 * The existing GET /api/training/model-submission?courseCode= returns only the
 * LATEST attempt (it exists to drive the gate + card state machine), so an
 * earlier attempt's reviewed file became unreachable as soon as the student
 * resubmitted. This route exposes the full list.
 *
 * Courses: 3SFM and BVM (exam courses), plus every LIVE course
 * (training_course_settings). `liveCourses` lists the live courses the student
 * is enrolled in or has submitted for, so the view can show each one with its
 * submission panel; the gate, attempts and lock stay on the status route.
 *
 * AUTH: training_session cookie. Rows are selected BY the session email, so a
 * student can only ever read their own submissions (no id is accepted here).
 */
export async function GET() {
  const session = await getTrainingCookieSession();
  if (!session?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sb = getServerClient();
  const { data, error } = await sb
    .from('model_submissions')
    .select('id, course_code, attempt_number, status, submitted_at, reviewed_at, review_note, file_name, file_size, reviewed_file_path, reviewed_file_name, reviewed_file_size, superseded_at')
    .ilike('email', session.email.toLowerCase())
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('[model-submission history] read failed:', error);
    return NextResponse.json({ error: 'Failed to load your submissions' }, { status: 500 });
  }

  const live = await listLiveCourses(sb, { includeInactive: true });
  const liveByCode = new Map(live.map((c) => [c.courseCode.toUpperCase(), c]));

  const byCourse: Record<string, ModelAttemptView[]> = { '3SFM': [], BVM: [] };
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const code = String(r.course_code ?? '').toUpperCase();
    if (code !== '3SFM' && code !== 'BVM' && !liveByCode.has(code)) continue;
    (byCourse[code] ??= []).push({
      id: String(r.id),
      courseCode: code,
      attemptNumber: Number(r.attempt_number ?? 0),
      status: r.status as ModelSubmissionRow['status'],
      submittedAt: String(r.submitted_at ?? ''),
      reviewedAt: (r.reviewed_at as string | null) ?? null,
      reviewNote: (r.review_note as string | null) ?? null,
      fileName: String(r.file_name ?? ''),
      fileSize: Number(r.file_size ?? 0),
      hasReviewedFile: !!r.reviewed_file_path,
      reviewedFileName: (r.reviewed_file_name as string | null) ?? null,
      reviewedFileSize: (r.reviewed_file_size as number | null) ?? null,
      superseded: !!r.superseded_at,
    });
  }

  // Live courses the student is enrolled in (by registration id), or has
  // already submitted for.
  const enrolledLive = new Set<string>();
  if (session.registrationId && live.length) {
    const { data: enr } = await sb
      .from('training_enrollments')
      .select('course_code')
      .eq('registration_id', session.registrationId)
      .in('course_code', live.map((c) => c.courseCode));
    for (const e of (enr ?? []) as { course_code: string }[]) enrolledLive.add(String(e.course_code).toUpperCase());
  }
  const liveCourses: MyModelLiveCourse[] = live
    .filter((c) => enrolledLive.has(c.courseCode.toUpperCase()) || (byCourse[c.courseCode.toUpperCase()]?.length ?? 0) > 0)
    .map((c) => ({ code: c.courseCode.toUpperCase(), title: c.title }));

  return NextResponse.json({ ok: true, courses: byCourse, liveCourses });
}
