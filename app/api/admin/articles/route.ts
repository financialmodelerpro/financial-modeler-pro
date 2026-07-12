import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { sendAutoNewsletter } from '@/src/shared/newsletter/autoNotify';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

// Additive columns from migration 187. Writes stay schema-tolerant: if the column
// does not exist yet (migration not applied), we retry without these keys.
const ADDITIVE_KEYS = ['mid_image_url', 'mid_image_caption', 'og_image_url', 'tags', 'writer_id', 'writer_name', 'writer_title', 'hero_before_content', 'writer_avatar_url'] as const;

/** The linked instructor's photo, snapshotted onto the article byline (mig 194).
 *  Resolved server-side from writer_id so it cannot be spoofed and stays in sync
 *  with the instructor record at save time. Returns null when unavailable. */
async function resolveWriterAvatar(sb: ReturnType<typeof getServerClient>, writerId: unknown): Promise<string | null> {
  if (!writerId || typeof writerId !== 'string') return null;
  try {
    const { data } = await sb.from('instructors').select('photo_url').eq('id', writerId).single();
    return (data as { photo_url?: string | null } | null)?.photo_url ?? null;
  } catch { return null; }
}

/** Publish-ish statuses that require a writer (draft stays free). */
function requiresWriter(status: unknown): boolean {
  return status === 'published' || status === 'scheduled';
}
const WRITER_REQUIRED_MSG = 'A writer is required to publish';

function isMissingColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = (error.message ?? '').toLowerCase();
  return error.code === 'PGRST204' || m.includes('column') || m.includes('schema cache');
}

function stripAdditive(obj: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...obj };
  for (const k of ADDITIVE_KEYS) delete clone[k];
  return clone;
}

/** Names for the given category ids, in the given order (for the deprecated primary text column). */
async function resolveCategoryNames(sb: ReturnType<typeof getServerClient>, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await sb.from('categories').select('id,name').in('id', ids);
  const byId = new Map((data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
}

/** Replace an article's junction rows with the given category ids. Best-effort (never breaks the save). */
async function syncArticleCategories(sb: ReturnType<typeof getServerClient>, articleId: string, ids: string[]): Promise<void> {
  try {
    await sb.from('article_categories').delete().eq('article_id', articleId);
    if (ids.length) {
      await sb.from('article_categories').insert(ids.map((cid) => ({ article_id: articleId, category_id: cid })));
    }
  } catch { /* junction is additive; a failure must not break the article save */ }
}

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
    let { data, error } = await sb.from('articles').select('*, article_categories(category_id)').eq('id', id).single();
    if (error) ({ data } = await sb.from('articles').select('*').eq('id', id).single()); // fallback pre-junction
    let article = data as (Record<string, unknown> & { article_categories?: Array<{ category_id: string }> }) | null;
    if (article) {
      const { article_categories, ...rest } = article;
      article = { ...rest, category_ids: Array.isArray(article_categories) ? article_categories.map((r) => r.category_id) : [] } as any;
    }
    return NextResponse.json({ article });
  }
  const { data } = await sb.from('articles').select('*').order('created_at', { ascending: false });
  return NextResponse.json({ articles: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { title, slug, body: articleBody, cover_url, category, status, featured, seo_title, seo_description, mid_image_url, mid_image_caption, og_image_url, tags, category_ids, writer_id, writer_name, writer_title, hero_before_content } = body;
    if (!title || !slug) return NextResponse.json({ error: 'title and slug required' }, { status: 400 });
    if (requiresWriter(status) && !writer_id) return NextResponse.json({ error: WRITER_REQUIRED_MSG }, { status: 400 });
    const sb = getServerClient();
    const session = await getServerSession(authOptions);
    // Dual-write: keep the deprecated primary `category` text = first selected category.
    const ids: string[] = Array.isArray(category_ids) ? category_ids : [];
    const primaryName = ids.length ? (await resolveCategoryNames(sb, ids))[0] : undefined;
    const insert: Record<string, unknown> = { title, slug, body: articleBody ?? '', category: primaryName ?? category ?? 'General', status: status ?? 'draft', featured: featured ?? false, seo_title: seo_title ?? null, seo_description: seo_description ?? null, author_id: (session?.user as any)?.id ?? null };
    if (cover_url) insert.cover_url = cover_url;
    if (mid_image_url !== undefined) insert.mid_image_url = mid_image_url || null;
    if (mid_image_caption !== undefined) insert.mid_image_caption = mid_image_caption || null;
    if (og_image_url !== undefined) insert.og_image_url = og_image_url || null;
    if (tags !== undefined) insert.tags = Array.isArray(tags) ? tags : [];
    if (writer_id !== undefined) insert.writer_id = writer_id || null;
    if (writer_name !== undefined) insert.writer_name = writer_name || null;
    if (writer_title !== undefined) insert.writer_title = writer_title || null;
    // Snapshot the writer photo from the linked instructor (byline avatar).
    if (writer_id) insert.writer_avatar_url = await resolveWriterAvatar(sb, writer_id);
    else if (writer_id !== undefined) insert.writer_avatar_url = null;
    if (hero_before_content !== undefined) insert.hero_before_content = !!hero_before_content;
    if (status === 'published') insert.published_at = new Date().toISOString();
    let { data, error } = await sb.from('articles').insert(insert).select().single();
    if (error && isMissingColumnError(error)) {
      ({ data, error } = await sb.from('articles').insert(stripAdditive(insert)).select().single());
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data && category_ids !== undefined) await syncArticleCategories(sb, data.id, ids);
    if (data && status === 'published') {
      void sendAutoNewsletter('article_published', data.id, {
        title: data.title, description: data.seo_description ?? '', url: `${MAIN_URL}/articles/${data.slug}`,
      });
    }
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
    const allowed = ['title', 'slug', 'body', 'cover_url', 'category', 'status', 'featured', 'seo_title', 'seo_description', ...ADDITIVE_KEYS];
    for (const k of allowed) { if (fields[k] !== undefined) update[k] = fields[k]; }
    const sb = getServerClient();
    // Re-snapshot the writer photo whenever the writer changes (byline avatar).
    if (fields.writer_id !== undefined) update.writer_avatar_url = fields.writer_id ? await resolveWriterAvatar(sb, fields.writer_id) : null;
    // Publish gate: a writer is required to publish/schedule. Resolve from the payload
    // when provided, otherwise from the existing row (a status-only PATCH).
    if (requiresWriter(fields.status)) {
      let writerId = fields.writer_id;
      if (writerId === undefined) {
        const { data: cur } = await sb.from('articles').select('writer_id').eq('id', id).single();
        writerId = (cur as { writer_id?: string | null } | null)?.writer_id ?? null;
      }
      if (!writerId) return NextResponse.json({ error: WRITER_REQUIRED_MSG }, { status: 400 });
    }
    // Dual-write: junction is the source of truth; keep primary `category` text in sync.
    const hasCategoryIds = Array.isArray(fields.category_ids);
    const ids: string[] = hasCategoryIds ? fields.category_ids : [];
    if (hasCategoryIds && ids.length) update.category = (await resolveCategoryNames(sb, ids))[0] ?? update.category;
    if (fields.status === 'published' && !fields.published_at) update.published_at = new Date().toISOString();
    let { error } = await sb.from('articles').update(update).eq('id', id);
    if (error && isMissingColumnError(error)) {
      ({ error } = await sb.from('articles').update(stripAdditive(update)).eq('id', id));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (hasCategoryIds) await syncArticleCategories(sb, id, ids);
    if (fields.status === 'published') {
      const { data: art } = await sb.from('articles').select('id, title, slug, seo_description').eq('id', id).single();
      if (art) {
        void sendAutoNewsletter('article_published', art.id, {
          title: art.title, description: art.seo_description ?? '', url: `${MAIN_URL}/articles/${art.slug}`,
        });
      }
    }
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
