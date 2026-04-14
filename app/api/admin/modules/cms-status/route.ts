import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET() {
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
