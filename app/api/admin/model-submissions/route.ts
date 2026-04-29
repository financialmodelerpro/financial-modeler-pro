import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import type { ModelSubmissionRow } from '@/src/hubs/training/lib/modelSubmission/types';

export const dynamic = 'force-dynamic';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

const VALID_STATUSES = new Set(['pending_review', 'approved', 'rejected']);
const VALID_COURSES = new Set(['3SFM', 'BVM']);

/**
 * GET /api/admin/model-submissions
 *
 * Powers the admin queue at /admin/training-hub/model-submissions. Defaults
 * to pending_review (Ahmad's review pile) but supports filter pills for
 * approved + rejected too. Pagination via limit/offset; the table page
 * passes limit=50 by default.
 *
 * Query params:
 *   status?     pending_review | approved | rejected | all (default pending_review)
 *   course?     3SFM | BVM | all
 *   limit?      1..200, default 50
 *   offset?     >=0, default 0
 *   search?     case-insensitive substring match on email or file_name
 *
 * Response:
 *   {
 *     rows: Array<ModelSubmissionRow & { student_name?, registration_id? }>,
 *     totalCount: number,
 *     pendingCount: number,    // for the sidebar badge
 *   }
 */
export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const statusParam = (sp.get('status') ?? 'pending_review').trim();
  const courseParam = (sp.get('course') ?? 'all').trim().toUpperCase();
  const search = (sp.get('search') ?? '').trim();
  const limit = Math.max(1, Math.min(200, parseInt(sp.get('limit') ?? '50', 10) || 50));
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);

  const sb = getServerClient();
  let query = sb
    .from('model_submissions')
    .select('*', { count: 'exact' })
    .order('submitted_at', { ascending: false });

  if (statusParam !== 'all') {
    if (!VALID_STATUSES.has(statusParam)) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
    }
    query = query.eq('status', statusParam);
  }

  if (courseParam !== 'ALL') {
    if (!VALID_COURSES.has(courseParam)) {
      return NextResponse.json({ error: 'Invalid course filter' }, { status: 400 });
    }
    query = query.eq('course_code', courseParam);
  }

  if (search) {
    // ilike across email + file_name. PostgREST `or` syntax requires
    // commas inside the value to be escaped, but our search is plain text
    // so a straight ilike pair works.
    const escaped = search.replace(/,/g, ' ');
    query = query.or(`email.ilike.%${escaped}%,file_name.ilike.%${escaped}%`);
  }

  query = query.range(offset, offset + limit - 1);

  const { data: rows, count: totalCount, error } = await query;
  if (error) {
    console.error('[admin/model-submissions GET] query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allRows = (rows ?? []) as ModelSubmissionRow[];

  // Decorate with student name + registration_id from training_registrations_meta
  // so the admin table can show a friendly label without the table page
  // having to round-trip per row. One IN query for the whole page.
  const emails = [...new Set(allRows.map(r => r.email.toLowerCase()))];
  const metaByEmail = new Map<string, { name: string; registrationId: string }>();
  if (emails.length > 0) {
    const { data: metas } = await sb
      .from('training_registrations_meta')
      .select('email, registration_id, name')
      .in('email', emails);
    for (const m of metas ?? []) {
      metaByEmail.set(((m.email as string) ?? '').toLowerCase(), {
        name: (m.name as string) ?? '',
        registrationId: (m.registration_id as string) ?? '',
      });
    }
  }

  // Pending count is independent of the current filter so the page header
  // chip ("12 pending") never lies. Cheap thanks to the partial index
  // idx_model_submissions_pending from migration 148.
  const { count: pendingCount } = await sb
    .from('model_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review');

  const decorated = allRows.map(r => {
    const meta = metaByEmail.get(r.email.toLowerCase());
    return {
      ...r,
      student_name: meta?.name ?? '',
      registration_id: meta?.registrationId ?? '',
    };
  });

  return NextResponse.json({
    rows: decorated,
    totalCount: totalCount ?? decorated.length,
    pendingCount: pendingCount ?? 0,
  });
}
