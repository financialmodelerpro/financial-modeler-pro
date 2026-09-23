/**
 * lastSeen.ts
 *
 * WHEN DID THIS PERSON LAST LOOK AT THIS PROJECT? (migration 246)
 *
 * Read to mark what is new on the Collaborate screen; written when they look.
 *
 * ── WHY THE DATABASE AND NOT THE BROWSER ──────────────────────────────────
 *
 * Founder decision, 2026-09-22. Browser storage is lost on another device, in
 * another browser and on a cleared cache, and each of those makes the marker
 * WRONG rather than absent: somebody who reviewed yesterday on a laptop would
 * be told on their phone that everything is new. A marker that is sometimes
 * wrong is worse than no marker, because a reader trusts it.
 *
 * ── THE READ COMES BEFORE THE WRITE, ALWAYS ───────────────────────────────
 *
 * Opening the screen both ANSWERS "what changed since last time" and BECOMES
 * the new last time. If the write landed first, the answer would always be
 * "nothing", which is the whole feature destroyed by one ordering mistake. So
 * `getLastSeen` is called by the screen's read and `markSeen` is a separate
 * call the client makes AFTER it has its answer.
 *
 * ── FAILING NEVER FAILS THE CALLER ────────────────────────────────────────
 *
 * Same trade as the change log: this is a convenience marker, and losing one
 * is a worse-looking screen, while throwing would break a screen that is
 * otherwise fine. Both functions swallow their errors and say so to the
 * operator. A missing table (pre-246) simply has no marker.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';

/** Cached like every other migration probe: false once observed absent. */
let lastSeenApplied: boolean | undefined;

function isMissingTable(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /refm_project_last_seen/i.test(String(err.message ?? ''));
}

/**
 * When this person last opened this project, or null if never (or if the
 * table is not there yet, which reads the same way: nothing is marked).
 */
export async function getLastSeen(userId: string, projectId: string): Promise<string | null> {
  if (lastSeenApplied === false) return null;
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_last_seen')
      .select('seen_at')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) { lastSeenApplied = false; return null; }
      console.error('[lastSeen] read failed:', error.message);
      return null;
    }
    lastSeenApplied = true;
    return (data as { seen_at?: string } | null)?.seen_at ?? null;
  } catch (e) {
    console.error('[lastSeen] read threw:', (e as { message?: string }).message);
    return null;
  }
}

/**
 * Record that this person has now looked. One row per person per project, so
 * this is an upsert on the primary key and can never add a second row.
 *
 * Returns whether it was written, so a caller or a test can tell a real write
 * from a silent no-op rather than assuming.
 */
export async function markSeen(userId: string, projectId: string, at?: Date): Promise<{ written: boolean }> {
  if (lastSeenApplied === false) return { written: false };
  try {
    const sb = getServerClient();
    const { error } = await sb
      .from('refm_project_last_seen')
      .upsert(
        { user_id: userId, project_id: projectId, seen_at: (at ?? new Date()).toISOString() },
        { onConflict: 'user_id,project_id' },
      );
    if (error) {
      if (isMissingTable(error)) { lastSeenApplied = false; return { written: false }; }
      console.error('[lastSeen] write failed:', error.message);
      return { written: false };
    }
    lastSeenApplied = true;
    return { written: true };
  } catch (e) {
    console.error('[lastSeen] write threw:', (e as { message?: string }).message);
    return { written: false };
  }
}
