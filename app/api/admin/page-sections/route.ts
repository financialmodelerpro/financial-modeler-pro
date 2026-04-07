import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

// ── GET — list sections for a page (or list all pages) ───────────────────────

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sb   = getServerClient();
  const slug = req.nextUrl.searchParams.get('slug');

  // If no slug, return page list from cms_pages
  if (!slug) {
    const { data: pages } = await sb
      .from('cms_pages')
      .select('*')
      .order('is_system', { ascending: false })
      .order('title');
    return NextResponse.json({ pages: pages ?? [] });
  }

  // Return sections for a specific page
  const { data: sections } = await sb
    .from('page_sections')
    .select('*')
    .eq('page_slug', slug)
    .order('display_order');

  // Also return page metadata
  const { data: page } = await sb
    .from('cms_pages')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  return NextResponse.json({ page, sections: sections ?? [] });
}

// ── POST — create a new section (or a new page) ─────────────────────────────

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sb   = getServerClient();
  const body = await req.json() as Record<string, unknown>;

  // Create a new CMS page
  if (body.action === 'create_page') {
    const slug  = (body.slug as string ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const title = (body.title as string ?? '').trim();
    if (!slug || !title) return NextResponse.json({ error: 'slug and title required' }, { status: 400 });

    const { data, error } = await sb
      .from('cms_pages')
      .insert({ slug, title, status: (body.status as string) ?? 'draft', is_system: false })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Page slug already exists' }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ page: data });
  }

  // Create a new section
  const pageSlug    = (body.page_slug as string ?? '').trim();
  const sectionType = (body.section_type as string ?? '').trim();
  if (!pageSlug || !sectionType) {
    return NextResponse.json({ error: 'page_slug and section_type required' }, { status: 400 });
  }

  // Get max display_order for this page
  const { data: maxRow } = await sb
    .from('page_sections')
    .select('display_order')
    .eq('page_slug', pageSlug)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.display_order ?? -1) + 1;

  const { data, error } = await sb
    .from('page_sections')
    .insert({
      page_slug:     pageSlug,
      section_type:  sectionType,
      content:       body.content ?? {},
      display_order: body.display_order ?? nextOrder,
      visible:       body.visible ?? true,
      styles:        body.styles ?? {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ section: data });
}

// ── PATCH — update a section or page ─────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sb   = getServerClient();
  const body = await req.json() as Record<string, unknown>;

  // Update page metadata
  if (body.action === 'update_page') {
    const id = body.id as string;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined)           updates.title = body.title;
    if (body.seo_title !== undefined)       updates.seo_title = body.seo_title;
    if (body.seo_description !== undefined) updates.seo_description = body.seo_description;
    if (body.status !== undefined)          updates.status = body.status;

    const { error } = await sb.from('cms_pages').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Bulk reorder sections
  if (body.action === 'reorder') {
    const items = body.items as { id: string; display_order: number }[];
    if (!Array.isArray(items)) return NextResponse.json({ error: 'items array required' }, { status: 400 });

    for (const item of items) {
      await sb.from('page_sections')
        .update({ display_order: item.display_order, updated_at: new Date().toISOString() })
        .eq('id', item.id);
    }
    return NextResponse.json({ ok: true });
  }

  // Update a single section
  const id = body.id as string;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.content !== undefined)       updates.content = body.content;
  if (body.section_type !== undefined)  updates.section_type = body.section_type;
  if (body.visible !== undefined)       updates.visible = body.visible;
  if (body.styles !== undefined)        updates.styles = body.styles;
  if (body.display_order !== undefined) updates.display_order = body.display_order;

  const { error } = await sb.from('page_sections').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── DELETE — remove a section or page ────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sb   = getServerClient();
  const body = await req.json() as Record<string, unknown>;

  // Delete a page (and its sections)
  if (body.action === 'delete_page') {
    const slug = body.slug as string;
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    // Prevent deleting system pages
    const { data: page } = await sb.from('cms_pages').select('is_system').eq('slug', slug).maybeSingle();
    if (page?.is_system) return NextResponse.json({ error: 'Cannot delete system page' }, { status: 403 });

    // Delete sections first, then page
    await sb.from('page_sections').delete().eq('page_slug', slug);
    await sb.from('cms_pages').delete().eq('slug', slug);
    return NextResponse.json({ ok: true });
  }

  // Delete a single section
  const id = body.id as string;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await sb.from('page_sections').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
