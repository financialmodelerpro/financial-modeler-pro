import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') return false;
  return true;
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  const sb = getServerClient();
  if (id) {
    const { data } = await sb.from('articles').select('*').eq('id', id).single();
    return NextResponse.json({ article: data });
  }
  const { data } = await sb.from('articles').select('*').order('created_at', { ascending: false });
  return NextResponse.json({ articles: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { title, slug, body: articleBody, cover_url, category, status, featured, seo_title, seo_description } = body;
    if (!title || !slug) return NextResponse.json({ error: 'title and slug required' }, { status: 400 });
    const sb = getServerClient();
    const session = await getServerSession(authOptions);
    const insert: Record<string, unknown> = { title, slug, body: articleBody ?? '', category: category ?? 'General', status: status ?? 'draft', featured: featured ?? false, seo_title: seo_title ?? null, seo_description: seo_description ?? null, author_id: (session?.user as any)?.id ?? null };
    if (cover_url) insert.cover_url = cover_url;
    if (status === 'published') insert.published_at = new Date().toISOString();
    const { data, error } = await sb.from('articles').insert(insert).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ article: data });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create article' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const allowed = ['title', 'slug', 'body', 'cover_url', 'category', 'status', 'featured', 'seo_title', 'seo_description'];
    for (const k of allowed) { if (fields[k] !== undefined) update[k] = fields[k]; }
    if (fields.status === 'published' && !fields.published_at) update.published_at = new Date().toISOString();
    const sb = getServerClient();
    const { error } = await sb.from('articles').update(update).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to update article' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('articles').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
