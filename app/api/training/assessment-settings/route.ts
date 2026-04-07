import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const course = (req.nextUrl.searchParams.get('course') ?? '3sfm').toLowerCase();
  const code   = course === 'bvm' ? 'bvm' : '3sfm';

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key, value')
      .in('key', [`shuffle_questions_${code}`, `shuffle_options_${code}`]);

    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.key] = row.value;

    return NextResponse.json({
      shuffleQuestions: map[`shuffle_questions_${code}`] !== 'false',
      shuffleOptions:  map[`shuffle_options_${code}`] === 'true',
    });
  } catch {
    // Safe defaults
    return NextResponse.json({ shuffleQuestions: true, shuffleOptions: false });
  }
}
