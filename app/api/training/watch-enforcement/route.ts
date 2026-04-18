import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

/**
 * GET /api/training/watch-enforcement?tabKeys=3SFM_S1,3SFM_S2
 *
 * Returns the global enforcement flag, threshold, per-tab_key bypass flags,
 * and whether the calling user is an admin (admins always bypass).
 */
export async function GET(req: NextRequest) {
  const tabKeysParam = req.nextUrl.searchParams.get('tabKeys') ?? '';
  const tabKeys = tabKeysParam.split(',').map(s => s.trim()).filter(Boolean);

  const sb = getServerClient();

  // Admin role check via NextAuth (Modeling Hub session). Students of the
  // Training Hub sign in differently (custom cookie) — they are never admins.
  const session = await getServerSession(authOptions);
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  // Pull all relevant settings in one query
  const keys = ['watch_enforcement_enabled', 'watch_enforcement_threshold'];
  const bypassKeys = tabKeys.map(tk => `watch_enforcement_bypass_${tk}`);
  const { data } = await sb
    .from('training_settings')
    .select('key, value')
    .in('key', [...keys, ...bypassKeys]);

  const map: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) map[r.key] = r.value;

  const enabled = map.watch_enforcement_enabled !== 'false'; // default TRUE
  const threshold = Math.max(0, Math.min(100, parseInt(map.watch_enforcement_threshold || '70', 10) || 70));

  const sessionBypass: Record<string, boolean> = {};
  for (const tk of tabKeys) {
    sessionBypass[tk] = map[`watch_enforcement_bypass_${tk}`] === 'true';
  }

  return NextResponse.json({ enabled, threshold, sessionBypass, isAdmin });
}
