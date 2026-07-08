import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

/* Categories CRUD (Phase 2, junction-backed). Table created in migration 187.
   Admin-gated via NextAuth; writes use the service-role client. */

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!session?.user && (session.user as { role?: string }).role === 'admin';
}

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET -> all categories (name asc) with article counts.
export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  const { data, error } = await sb
    .from('categories')
    .select('id,name,slug,article_categories(article_id)')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const categories = (data ?? []).map((c: any) => ({
    id: c.id, name: c.name, slug: c.slug,
    count: Array.isArray(c.article_categories) ? c.article_categories.length : 0,
  }));
  return NextResponse.json({ categories });
}

// POST { name } -> create (inline create). Idempotent on name (returns existing).
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { name } = await req.json();
  const clean = (name ?? '').trim();
  if (!clean) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const sb = getServerClient();
  const existing = await sb.from('categories').select('id,name,slug').ilike('name', clean).maybeSingle();
  if (existing.data) return NextResponse.json({ category: existing.data });
  const { data, error } = await sb.from('categories')
    .insert({ name: clean, slug: slugify(clean) }).select('id,name,slug').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}

// PATCH { id, name } -> rename (name + slug).
export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, name } = await req.json();
  const clean = (name ?? '').trim();
  if (!id || !clean) return NextResponse.json({ error: 'id and name required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('categories').update({ name: clean, slug: slugify(clean) }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE ?id= -> delete (article_categories rows cascade).
export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
