import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/share-templates/[key]
 *
 * Admin-only — partial update of a share template. template_key itself is
 * immutable (it's the join key used across the codebase).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { key } = await params;
  const body = await req.json() as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string')             patch.title           = body.title;
  if (typeof body.template_text === 'string')     patch.template_text   = body.template_text;
  if (Array.isArray(body.hashtags))               patch.hashtags        = body.hashtags.filter((h: unknown): h is string => typeof h === 'string');
  if (typeof body.mention_brand === 'boolean')    patch.mention_brand   = body.mention_brand;
  if (typeof body.mention_founder === 'boolean')  patch.mention_founder = body.mention_founder;
  if (typeof body.active === 'boolean')           patch.active          = body.active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('share_templates')
    .update(patch)
    .eq('template_key', key)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
