import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

/* Article series CRUD + reorder (migration 200). Admin-gated via NextAuth; writes
   use the service-role client. Mirrors the categories route.

   - GET             -> all series, each with its ordered articles (for the manager).
   - POST { title }  -> create (idempotent on title, returns existing).
   - PATCH { id, title?, description? } -> rename / edit.
   - PUT { seriesId, orderedIds } -> set the reading order (drag-reorder): each
     article's series_order becomes its index in orderedIds.
   - DELETE ?id=     -> delete the series (articles.series_id resets to NULL via FK).

   No em dashes in this file. */

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!session?.user && (session.user as { role?: string }).role === 'admin';
}

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface SeriesArticleRow { id: string; title: string; slug: string; status: string; series_order: number | null }

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  const { data: series, error } = await sb.from('article_series').select('id,title,slug,description,created_at').order('title');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (series ?? []).map((s: { id: string }) => s.id);
  // Pull every series-assigned article once, group in memory, keep reading order.
  const byId = new Map<string, SeriesArticleRow[]>();
  if (ids.length) {
    const { data: arts } = await sb.from('articles')
      .select('id,title,slug,status,series_id,series_order')
      .in('series_id', ids)
      .order('series_order', { ascending: true });
    for (const a of (arts ?? []) as (SeriesArticleRow & { series_id: string })[]) {
      const list = byId.get(a.series_id) ?? [];
      list.push({ id: a.id, title: a.title, slug: a.slug, status: a.status, series_order: a.series_order });
      byId.set(a.series_id, list);
    }
  }
  const out = (series ?? []).map((s: { id: string; title: string; slug: string; description: string | null }) => ({
    ...s, articles: byId.get(s.id) ?? [],
  }));
  return NextResponse.json({ series: out });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { title, description } = await req.json();
  const clean = (title ?? '').trim();
  if (!clean) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const sb = getServerClient();
  const existing = await sb.from('article_series').select('id,title,slug,description').ilike('title', clean).maybeSingle();
  if (existing.data) return NextResponse.json({ series: existing.data });
  const { data, error } = await sb.from('article_series')
    .insert({ title: clean, slug: slugify(clean), description: (description ?? '').trim() || null })
    .select('id,title,slug,description').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ series: data });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, title, description } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (typeof title === 'string') {
    const clean = title.trim();
    if (!clean) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    update.title = clean; update.slug = slugify(clean);
  }
  if (description !== undefined) update.description = (description ?? '').trim() || null;
  if (!Object.keys(update).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('article_series').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PUT { seriesId, orderedIds } -> set the reading order by array index.
export async function PUT(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { seriesId, orderedIds } = await req.json();
  if (!seriesId || !Array.isArray(orderedIds)) return NextResponse.json({ error: 'seriesId and orderedIds required' }, { status: 400 });
  const sb = getServerClient();
  // Update each row's position to its index. Scoped to the series so a stray id
  // from another series cannot be reordered here.
  const results = await Promise.all(
    orderedIds.map((id: string, i: number) =>
      sb.from('articles').update({ series_order: i }).eq('id', id).eq('series_id', seriesId)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('article_series').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
