import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PerKeyStat { completed: number; in_progress: number; avgPct: number; rows: number }

interface LiveSessionRow {
  id: string;
  title: string;
  session_type: string;
  scheduled_datetime: string | null;
  is_published: boolean;
  has_assessment?: boolean | null;
  playlist_id?: string | null;
}

/**
 * GET /api/admin/watch-enforcement-stats
 *
 * Returns data the admin Watch Enforcement UI needs to render a union of all
 * trackable sessions:
 *   - every tab_key currently in COURSES config (handled client-side)
 *   - every tab_key with at least one certification_watch_history record
 *   - every live_sessions row (served here as `liveSessions[]` — client
 *     synthesizes `LIVE_<uuid>` tab_keys)
 *
 * Plus aggregate watch stats keyed by tab_key (rows across all students).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();

  // ── Certification course watch history ──────────────────────────────────────
  const { data: certHistory } = await sb
    .from('certification_watch_history')
    .select('tab_key, status, watch_percentage');

  const perKey: Record<string, PerKeyStat> = {};
  const addRow = (k: string, status: string, pct: number) => {
    if (!perKey[k]) perKey[k] = { completed: 0, in_progress: 0, avgPct: 0, rows: 0 };
    if (status === 'completed')   perKey[k].completed++;
    if (status === 'in_progress') perKey[k].in_progress++;
    perKey[k].avgPct = (perKey[k].avgPct * perKey[k].rows + pct) / (perKey[k].rows + 1);
    perKey[k].rows++;
  };
  for (const r of (certHistory ?? []) as { tab_key: string; status: string; watch_percentage: number | null }[]) {
    addRow(r.tab_key, r.status, typeof r.watch_percentage === 'number' ? r.watch_percentage : 0);
  }

  const historyTabKeys = Array.from(new Set((certHistory ?? []).map(r => r.tab_key as string).filter(Boolean)));

  // ── Live session watch history (mirrors certification_watch_history) ────────
  const { data: liveHistory } = await sb
    .from('session_watch_history')
    .select('session_id, status, watch_percentage');
  for (const r of (liveHistory ?? []) as { session_id: string; status: string | null; watch_percentage: number | null }[]) {
    addRow(`LIVE_${r.session_id}`, r.status ?? 'completed', typeof r.watch_percentage === 'number' ? r.watch_percentage : 100);
  }

  for (const k of Object.keys(perKey)) perKey[k].avgPct = Math.round(perKey[k].avgPct);

  // ── All live sessions (upcoming + live + recorded) ─────────────────────────
  const { data: liveRows } = await sb
    .from('live_sessions')
    .select('id, title, session_type, scheduled_datetime, is_published, has_assessment, playlist_id')
    .order('scheduled_datetime', { ascending: false });

  const liveSessions = (liveRows ?? []) as LiveSessionRow[];

  return NextResponse.json({ historyTabKeys, perKeyStats: perKey, liveSessions });
}
