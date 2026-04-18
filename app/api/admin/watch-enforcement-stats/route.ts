import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/admin/watch-enforcement-stats
 *
 * Returns data the admin Watch Enforcement UI needs to render a dynamic
 * session list that includes BOTH:
 *   - sessions currently defined in COURSES config (admin page reads that directly), and
 *   - any tab_key students have actually watched but that isn't in config yet.
 *
 * This means when a new session is added to COURSES in the future it shows up
 * automatically. And historical data for deprecated sessions is still visible.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();

  // Distinct tab_keys students have records for
  const { data: historyRows } = await sb
    .from('certification_watch_history')
    .select('tab_key');

  const historyTabKeys = Array.from(new Set((historyRows ?? []).map(r => r.tab_key as string).filter(Boolean)));

  // Aggregate stats — how many rows in each status across all students
  const { data: statusRows } = await sb
    .from('certification_watch_history')
    .select('tab_key, status, watch_percentage');

  const perKey: Record<string, { completed: number; in_progress: number; avgPct: number; rows: number }> = {};
  for (const r of (statusRows ?? []) as { tab_key: string; status: string; watch_percentage: number | null }[]) {
    const k = r.tab_key;
    if (!perKey[k]) perKey[k] = { completed: 0, in_progress: 0, avgPct: 0, rows: 0 };
    if (r.status === 'completed')   perKey[k].completed++;
    if (r.status === 'in_progress') perKey[k].in_progress++;
    const pct = typeof r.watch_percentage === 'number' ? r.watch_percentage : 0;
    perKey[k].avgPct = (perKey[k].avgPct * perKey[k].rows + pct) / (perKey[k].rows + 1);
    perKey[k].rows++;
  }
  // Round avgPct for display
  for (const k of Object.keys(perKey)) perKey[k].avgPct = Math.round(perKey[k].avgPct);

  return NextResponse.json({ historyTabKeys, perKeyStats: perKey });
}
