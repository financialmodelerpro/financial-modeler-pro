import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

/** GET /api/admin/marketing-studio/designs/[id] — load one design */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const sb = getServerClient();
  const { data, error } = await sb.from('marketing_designs').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ design: data });
}

interface PatchBody {
  name?: string;
  template_type?: string;
  dimensions?: { width: number; height: number };
  background?: Record<string, unknown>;
  elements?: unknown[];
  ai_captions?: Record<string, string>;
  preview_url?: string;
}

/** PATCH /api/admin/marketing-studio/designs/[id] — update existing design */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let body: PatchBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name          !== undefined) patch.name          = body.name;
  if (body.template_type !== undefined) patch.template_type = body.template_type;
  if (body.dimensions    !== undefined) patch.dimensions    = body.dimensions;
  if (body.background    !== undefined) patch.background    = body.background;
  if (body.elements      !== undefined) patch.elements      = body.elements;
  if (body.ai_captions   !== undefined) patch.ai_captions   = body.ai_captions;
  if (body.preview_url   !== undefined) patch.preview_url   = body.preview_url;

  const sb = getServerClient();
  const { data, error } = await sb.from('marketing_designs').update(patch).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ design: data });
}

/** DELETE /api/admin/marketing-studio/designs/[id] */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const sb = getServerClient();
  const { error } = await sb.from('marketing_designs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
