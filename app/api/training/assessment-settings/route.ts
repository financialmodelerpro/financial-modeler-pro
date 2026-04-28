import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/assessment-settings
 *
 * Returns the global shuffle settings that apply to every assessment —
 * 3SFM, BVM, and live sessions. The per-course keys are superseded by
 * `shuffle_questions_enabled` / `shuffle_options_enabled` in
 * `training_settings` (migration 108).
 *
 * Shuffle is applied client-side after questions load, so the same
 * settings work uniformly across Apps Script-backed and native Supabase-backed
 * assessments.
 */
export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key, value')
      .in('key', ['shuffle_questions_enabled', 'shuffle_options_enabled']);

    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;

    return NextResponse.json({
      shuffleQuestions: map.shuffle_questions_enabled !== 'false', // default ON
      shuffleOptions:   map.shuffle_options_enabled   === 'true',  // default OFF
    });
  } catch {
    return NextResponse.json({ shuffleQuestions: true, shuffleOptions: false });
  }
}
