/**
 * GET /api/admin/users/[id]/projects - READ-ONLY list of one user's REFM
 * projects for the admin user list: name, created, last modified, archived
 * flag, and the saved-version count per project. Deliberately read-only and
 * deliberately shallow: no snapshot content is returned, because an admin does
 * not open or edit a user's model from here.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_projects')
    .select('id, name, archived, created_at, updated_at')
    .eq('user_id', id)
    .order('updated_at', { ascending: false })
    .range(0, 499);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{ id: string; name: string | null; archived: boolean | null; created_at: string; updated_at: string }>;

  // Version count per project. The project cap keeps this list short, so one
  // head-count query per project (in parallel) beats pulling every version row.
  const counts = await Promise.all(rows.map(async (p) => {
    try {
      const { count } = await sb
        .from('refm_project_versions')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', p.id);
      return count ?? 0;
    } catch {
      return 0;
    }
  }));

  return NextResponse.json({
    projects: rows.map((p, i) => ({
      id: p.id,
      name: p.name ?? '(unnamed project)',
      archived: !!p.archived,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      versionCount: counts[i],
    })),
  });
}
