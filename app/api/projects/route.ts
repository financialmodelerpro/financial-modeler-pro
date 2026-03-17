import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { serverClient } from '@/src/lib/supabase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

// ── GET /api/projects — list projects or fetch a single project by ?id= ───────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  const id = req.nextUrl.searchParams.get('id');

  if (id) {
    // Single project fetch — verify ownership
    const { data, error } = await serverClient
      .from('projects')
      .select('id, name, platform, module_data, created_at, updated_at, user_id')
      .eq('id', id)
      .single();

    if (error || !data) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (data.user_id !== session.user.id) return unauthorized();

    return NextResponse.json({ project: data });
  }

  // List all active projects for the user
  const { data, error } = await serverClient
    .from('projects')
    .select('id, name, platform, module_data, created_at, updated_at')
    .eq('user_id', session.user.id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ projects: data });
}

// ── POST /api/projects — create a new project ─────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.name) return badRequest('name is required');

  // Check project limit
  const { data: user } = await serverClient
    .from('users')
    .select('projects_limit')
    .eq('id', session.user.id)
    .single();

  const limit: number = user?.projects_limit ?? 3;

  if (limit !== -1) {
    const { count } = await serverClient
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('is_archived', false);

    if ((count ?? 0) >= limit) {
      return NextResponse.json(
        { error: `Project limit reached (${limit}). Upgrade your plan to create more.` },
        { status: 403 },
      );
    }
  }

  const { data, error } = await serverClient
    .from('projects')
    .insert({
      user_id:     session.user.id,
      name:        body.name,
      platform:    body.platform ?? 'refm',
      module_data: body.module_data ?? {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ project: data }, { status: 201 });
}

// ── PUT /api/projects — update module_data for a project ──────────────────────
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.id) return badRequest('id is required');

  // Verify ownership before updating
  const { data: existing } = await serverClient
    .from('projects')
    .select('id, user_id')
    .eq('id', body.id)
    .single();

  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (existing.user_id !== session.user.id) return unauthorized();

  const updates: Record<string, unknown> = {};
  if (body.name        !== undefined) updates.name        = body.name;
  if (body.module_data !== undefined) updates.module_data = body.module_data;

  const { data, error } = await serverClient
    .from('projects')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ project: data });
}

// ── DELETE /api/projects — soft-delete (archive) a project ────────────────────
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  if (!id) return badRequest('id query param is required');

  const { data: existing } = await serverClient
    .from('projects')
    .select('id, user_id')
    .eq('id', id)
    .single();

  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (existing.user_id !== session.user.id) return unauthorized();

  const { error } = await serverClient
    .from('projects')
    .update({ is_archived: true })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
