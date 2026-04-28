/**
 * POST /api/admin/sessions/[tabKey]/reset-watch-progress
 *
 * Admin-only nuclear reset: wipes every student's watch-history row for
 * the given session. Used when the admin swaps a video and wants to
 * force-reset everyone (the per-student auto-detect already handles
 * future ticks, but this covers completed rows that won't receive
 * another tick from their owners).
 *
 * Routing by tabKey prefix:
 *   LIVE_<uuid>         → DELETE FROM session_watch_history     WHERE session_id=<uuid>
 *   else (e.g. 3SFM_S1) → DELETE FROM certification_watch_history WHERE tab_key=<tabKey>
 *
 * Works for 3SFM, BVM, live sessions, and any future course or session
 * type that uses those two tables — no per-type code.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role === 'admin';
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ tabKey: string }> },
) {
  if (!await checkAdmin()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { tabKey } = await params;
  if (!tabKey) {
    return NextResponse.json({ error: 'tabKey required' }, { status: 400 });
  }
  const sb = getServerClient();

  if (tabKey.startsWith('LIVE_')) {
    const sessionId = tabKey.slice(5);
    const { data, error } = await sb
      .from('session_watch_history')
      .delete()
      .eq('session_id', sessionId)
      .select('id');
    if (error) {
      console.error('[reset-watch-progress] live-session delete failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.log('[reset-watch-progress] LIVE_', sessionId, 'deleted', data?.length ?? 0, 'rows');
    return NextResponse.json({ ok: true, deleted: data?.length ?? 0, scope: 'live-session' });
  }

  // Course-session tabKey (3SFM_S1, BVM_L3, 3SFM_Final, etc.)
  const { data, error } = await sb
    .from('certification_watch_history')
    .delete()
    .eq('tab_key', tabKey)
    .select('id');
  if (error) {
    console.error('[reset-watch-progress] course-session delete failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.log('[reset-watch-progress]', tabKey, 'deleted', data?.length ?? 0, 'rows');
  return NextResponse.json({ ok: true, deleted: data?.length ?? 0, scope: 'course-session' });
}
