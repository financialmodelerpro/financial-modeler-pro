import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

/**
 * Public CMS content read endpoint.
 * GET /api/cms?section=training&keys=share_achievement_title,share_default_message
 * Returns a map of "section__key" → value.
 * Results are cached for 10 minutes - share text rarely changes.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') ?? '';
  const keys = (searchParams.get('keys') ?? '').split(',').map(k => k.trim()).filter(Boolean);

  try {
    const sb = getServerClient();
    let query = sb.from('cms_content').select('section, key, value');
    if (section) query = query.eq('section', section);
    if (keys.length > 0) query = query.in('key', keys);

    const { data, error } = await query;
    if (error) return NextResponse.json({ map: {} });

    const map: Record<string, string> = {};
    for (const row of data ?? []) map[`${row.section}__${row.key}`] = row.value;

    return NextResponse.json({ map }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
    });
  } catch {
    return NextResponse.json({ map: {} });
  }
}
