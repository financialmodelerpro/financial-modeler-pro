import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return false;
  return true;
}

export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('modules').select('*').order('display_order');
    return NextResponse.json({ modules: data ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch modules' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const {
      id, status, name, description, icon, display_order, launch_date,
      short_name, color, bg_color, tagline, long_description,
      who_is_it_for, what_you_get,
    } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (status !== undefined) update.status = status;
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (icon !== undefined) update.icon = icon;
    if (display_order !== undefined) update.display_order = display_order;
    if (launch_date !== undefined) update.launch_date = launch_date;
    if (short_name !== undefined) update.short_name = short_name;
    if (color !== undefined) update.color = color;
    if (bg_color !== undefined) update.bg_color = bg_color;
    if (tagline !== undefined) update.tagline = tagline;
    if (long_description !== undefined) update.long_description = long_description;
    if (who_is_it_for !== undefined) update.who_is_it_for = who_is_it_for;
    if (what_you_get !== undefined) update.what_you_get = what_you_get;
    const sb = getServerClient();
    const { error } = await sb.from('modules').update(update).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update module' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const {
      slug, name, description, icon, status, display_order,
      short_name, color, bg_color, tagline, long_description,
      who_is_it_for, what_you_get,
    } = body;
    if (!slug || typeof slug !== 'string') {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!icon || typeof icon !== 'string') {
      return NextResponse.json({ error: 'icon is required' }, { status: 400 });
    }

    const sb = getServerClient();
    // Compute next display_order if not supplied.
    let nextOrder = display_order;
    if (typeof nextOrder !== 'number') {
      const { data: maxRow } = await sb
        .from('modules')
        .select('display_order')
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      nextOrder = (maxRow?.display_order ?? 0) + 1;
    }

    const insert: Record<string, unknown> = {
      slug,
      name,
      description: description ?? '',
      icon,
      status: status ?? 'coming_soon',
      display_order: nextOrder,
    };
    if (short_name !== undefined) insert.short_name = short_name;
    if (color !== undefined) insert.color = color;
    if (bg_color !== undefined) insert.bg_color = bg_color;
    if (tagline !== undefined) insert.tagline = tagline;
    if (long_description !== undefined) insert.long_description = long_description;
    if (who_is_it_for !== undefined) insert.who_is_it_for = who_is_it_for;
    if (what_you_get !== undefined) insert.what_you_get = what_you_get;

    const { data, error } = await sb.from('modules').insert(insert).select('*').single();
    if (error) {
      // Postgres unique violation: 23505
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'Slug already in use' }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ module: data });
  } catch {
    return NextResponse.json({ error: 'Failed to create module' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const sb = getServerClient();
    const { error } = await sb.rpc('delete_platform_cascade', { p_id: id });
    if (error) {
      const msg = error.message?.trim();
      if (!msg) {
        return NextResponse.json({ error: 'Failed to delete platform' }, { status: 500 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete platform' }, { status: 500 });
  }
}
