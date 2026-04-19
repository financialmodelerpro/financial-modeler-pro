import { getServerClient } from '@/src/lib/shared/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';

export interface EnforcementContext {
  enabled: boolean;
  threshold: number;
  bypassed: boolean;       // this specific session is bypassed
  isAdmin: boolean;        // NextAuth admin role
}

/**
 * Server-side watch enforcement lookup for a given `tab_key`. Callers pass the
 * `tab_key` the student would be marking complete — for courses that's
 * `3SFM_S1`, for live sessions it's `LIVE_<uuid>`.
 *
 * The tamper-resistant pattern: before any API route flips a watch record to
 * `status='completed'`, verify `getWatchEnforcement(tk)` + the stored
 * `watch_percentage` together. If enforcing and the stored percentage is
 * below threshold, refuse with 403 — NEVER trust client-provided values.
 */
export async function getWatchEnforcement(tabKey: string): Promise<EnforcementContext> {
  const sb = getServerClient();
  const session = await getServerSession(authOptions);
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  const { data } = await sb
    .from('training_settings')
    .select('key, value')
    .in('key', [
      'watch_enforcement_enabled',
      'watch_enforcement_threshold',
      `watch_enforcement_bypass_${tabKey}`,
    ]);

  const map: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) map[r.key] = r.value;

  return {
    enabled:   map.watch_enforcement_enabled !== 'false',
    threshold: Math.max(0, Math.min(100, parseInt(map.watch_enforcement_threshold ?? '70', 10) || 70)),
    bypassed:  map[`watch_enforcement_bypass_${tabKey}`] === 'true',
    isAdmin,
  };
}

/**
 * Returns true if the caller is allowed to flip `status='completed'` given
 * the supplied enforcement context + the stored watch percentage. Pure
 * function — callers fetch the pieces then pass them in, which keeps the
 * DB access at the call site and the decision tree readable.
 */
export function canCompleteWith(ctx: EnforcementContext, storedWatchPct: number): boolean {
  if (!ctx.enabled || ctx.bypassed || ctx.isAdmin) return true;
  return storedWatchPct >= ctx.threshold;
}
