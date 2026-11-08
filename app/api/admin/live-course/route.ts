import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { listLiveCourses } from '@/src/hubs/training/lib/liveCourse/courseSettings';

export const dynamic = 'force-dynamic';

/** GET /api/admin/live-course: every active live course (admin pickers and pages). */
export async function GET() {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ courses: await listLiveCourses(getServerClient()) });
}
