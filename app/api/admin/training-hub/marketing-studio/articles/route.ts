import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('articles')
    .select('slug, title, category, cover_url, published_at, status, author_id')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(80);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ articles: data ?? [] });
}
