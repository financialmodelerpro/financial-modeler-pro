import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') return null;
  return session;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Admin only' }, { status: 401 });

  const { id } = await ctx.params;
  let body: { name?: string };
  try { body = await req.json() as { name?: string }; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const sb = getServerClient();
  const { error } = await sb
    .from('marketing_uploaded_assets')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Admin only' }, { status: 401 });

  const { id } = await ctx.params;
  const sb = getServerClient();

  const { data: row, error: fetchErr } = await sb
    .from('marketing_uploaded_assets')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const path = (row as { storage_path: string }).storage_path;
  await sb.storage.from('marketing-assets').remove([path]).catch(() => {});

  const { error: delErr } = await sb.from('marketing_uploaded_assets').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
