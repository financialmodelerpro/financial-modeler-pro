import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

/* GET /api/admin/articles/slug-check?slug=…&excludeId=…
   Slug-uniqueness pre-check for the article form. Returns { available }.
   excludeId lets the edit page ignore the article's own current slug. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const slug = (req.nextUrl.searchParams.get('slug') ?? '').trim();
  const excludeId = req.nextUrl.searchParams.get('excludeId');
  if (!slug) return NextResponse.json({ available: false, reason: 'empty' });

  const sb = getServerClient();
  let q = sb.from('articles').select('id').eq('slug', slug);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ available: (data ?? []).length === 0 });
}
