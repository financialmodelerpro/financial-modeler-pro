import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('page_sections')
      .select('page_slug')
      .like('page_slug', 'modeling-%')
      .limit(200);

    // Extract unique slugs that have sections, strip 'modeling-' prefix
    const slugs = [...new Set((data ?? []).map((r: { page_slug: string }) => r.page_slug.replace('modeling-', '')))];
    return NextResponse.json({ slugs });
  } catch {
    return NextResponse.json({ slugs: [] });
  }
}
