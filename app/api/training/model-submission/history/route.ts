import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import type { ModelSubmissionRow, ModelAttemptView } from '@/src/hubs/training/lib/modelSubmission/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CourseCode = ModelAttemptView['courseCode'];

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
 * AUTH: training_session cookie. Rows are selected BY the session email, so a
 * student can only ever read their own submissions (no id is accepted here).
 */
export async function GET() {
  const session = await getTrainingCookieSession();
  if (!session?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sb = getServerClient();
  const { data, error } = await sb
    .from('model_submissions')
    .select('id, course_code, attempt_number, status, submitted_at, reviewed_at, review_note, file_name, file_size, reviewed_file_path, reviewed_file_name, reviewed_file_size')
    .ilike('email', session.email.toLowerCase())
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('[model-submission history] read failed:', error);
    return NextResponse.json({ error: 'Failed to load your submissions' }, { status: 500 });
  }

  const byCourse: Record<CourseCode, ModelAttemptView[]> = { '3SFM': [], BVM: [] };
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const code = String(r.course_code ?? '').toUpperCase();
    if (code !== '3SFM' && code !== 'BVM') continue;
    byCourse[code].push({
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
    });
  }

  return NextResponse.json({ ok: true, courses: byCourse });
}
