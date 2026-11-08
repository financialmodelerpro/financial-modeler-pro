import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { loadCourseView } from '@/src/hubs/training/lib/liveCourse/courseView';

export const dynamic = 'force-dynamic';

/** GET /api/training/live-course/[code]: the signed student's course page. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const { code } = await params;
  const view = await loadCourseView(getServerClient(), sess, code);
  if (!view) return NextResponse.json({ error: 'Course not found.' }, { status: 404 });
  return NextResponse.json(view);
}
