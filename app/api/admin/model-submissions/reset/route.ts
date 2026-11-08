import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { resetSubmissionAttempts } from '@/src/hubs/training/lib/modelSubmission/resetSubmissions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/model-submissions/reset  { email, courseCode, reason? }
 * Admin only. Gives a locked student a fresh set of attempts by superseding
 * (not deleting) their active submissions. Audited.
 */
export async function POST(req: NextRequest) {
  let session;
  try { session = await getServerSession(authOptions); } catch { session = null; }
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined;
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { email?: string; courseCode?: string; reason?: string };
  const res = await resetSubmissionAttempts(getServerClient(), {
    email: body.email ?? '',
    courseCode: body.courseCode ?? '',
    reason: body.reason ?? null,
    by: user.email ?? 'admin',
    adminId: user.id ?? null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json(res);
}
