/**
 * lock.ts
 *
 * THE EDIT LOCK, server side. Module 10 Collaboration, step 5.
 *
 * One person edits a project at a time. Everything here is a thin wrapper over
 * `refm_acquire_project_lock` (migration 233), which is the ONLY way a lock is
 * taken and is one atomic statement: two waiters racing for the same lock
 * cannot both win, proved with two live connections over 25 races.
 *
 * ── THE TTL LIVES HERE, ONCE ──────────────────────────────────────────────
 *
 * The client heartbeats, the server ages locks out, and the UI tells the user
 * how long a stale lock takes to clear. Those are three readers of one number,
 * so it is defined once and passed INTO the SQL function rather than hardcoded
 * on both sides where the two could drift.
 *
 * ── WHY A HEARTBEAT AND NOT AN UNLOAD HANDLER ─────────────────────────────
 *
 * `beforeunload` does not fire on a crash, a killed tab, a closed laptop or a
 * dropped network, which are precisely the cases that would otherwise hold a
 * lock forever on behalf of nobody. A heartbeat has no such gap: if the client
 * stops talking, for ANY reason, the lock ages out. The cost is a bounded
 * window where a lock is held by a session that has already gone. A release on
 * unload is still sent as a courtesy, because it makes the common case
 * instant, but nothing depends on it arriving.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';

/** How long a lock survives without a heartbeat. */
export const LOCK_TTL_SECONDS = 90;

/** How often the holder should heartbeat. Comfortably inside the TTL so a
 *  single dropped request does not lose the lock: three beats fit in one TTL,
 *  so it takes two consecutive failures plus a full interval to age out. */
export const LOCK_HEARTBEAT_SECONDS = 30;

export interface ProjectLock {
  projectId: string;
  holderUserId: string;
  holderName: string | null;
  acquiredAt: string;
  heartbeatAt: string;
  releaseRequestedBy: string | null;
  releaseRequestedByName: string | null;
  releaseRequestedAt: string | null;
  /** True when the caller is the holder. Decided server-side so no client has
   *  to compare ids. */
  isMine: boolean;
  /** True when the heartbeat has stopped and the next acquirer may take it. */
  isStale: boolean;
}

type Row = {
  project_id: string;
  holder_user_id: string;
  acquired_at: string;
  heartbeat_at: string;
  release_requested_by: string | null;
  release_requested_at: string | null;
};

/** Cached like every other migration probe: false once the table is observed
 *  absent, so a pre-233 database degrades to "no locking" rather than to "no
 *  editing". */
let locksApplied: boolean | undefined;

export function lockTableMissing(): boolean { return locksApplied === false; }

function isMissingLockTable(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST202' || err.code === 'PGRST205') return true;
  return /refm_project_locks|refm_acquire_project_lock/i.test(String(err.message ?? ''));
}

function isStale(heartbeatAt: string): boolean {
  const t = Date.parse(heartbeatAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > LOCK_TTL_SECONDS * 1000;
}

async function nameFor(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  try {
    const sb = getServerClient();
    const { data, error } = await sb.from('users').select('id, name, email').in('id', unique);
    if (error || !data) return {};
    const out: Record<string, string> = {};
    for (const r of data as Array<{ id: string; name: string | null; email: string | null }>) {
      const label = (r.name ?? '').trim() || (r.email ?? '').trim();
      if (label) out[r.id] = label;
    }
    return out;
  } catch { return {}; }
}

async function decorate(row: Row, userId: string): Promise<ProjectLock> {
  const names = await nameFor([row.holder_user_id, row.release_requested_by ?? '']);
  return {
    projectId: row.project_id,
    holderUserId: row.holder_user_id,
    holderName: names[row.holder_user_id] ?? null,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    releaseRequestedBy: row.release_requested_by,
    releaseRequestedByName: row.release_requested_by ? (names[row.release_requested_by] ?? null) : null,
    releaseRequestedAt: row.release_requested_at,
    isMine: row.holder_user_id === userId,
    isStale: isStale(row.heartbeat_at),
  };
}

/**
 * Take the lock, or refresh it if it is already mine.
 *
 * Returns the lock on success and `null` when someone else holds a live one.
 * THE SAME CALL IS BOTH ACQUIRE AND HEARTBEAT, deliberately: a heartbeat that
 * took a different path could succeed while the lock had actually been stolen,
 * and the holder would keep editing against a lock they no longer own.
 */
export async function acquireLock(
  projectId: string,
  userId: string,
): Promise<{ lock: ProjectLock | null; tableMissing: boolean; error: string | null }> {
  if (locksApplied === false) return { lock: null, tableMissing: true, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb.rpc('refm_acquire_project_lock', {
      p_project_id: projectId,
      p_user_id: userId,
      p_ttl_seconds: LOCK_TTL_SECONDS,
    });
    if (error) {
      if (isMissingLockTable(error)) { locksApplied = false; return { lock: null, tableMissing: true, error: null }; }
      return { lock: null, tableMissing: false, error: error.message };
    }
    locksApplied = true;
    const rows = (data ?? []) as unknown as Row[];
    // NO ROWS MEANS REFUSED. The SQL function returns SETOF precisely so that
    // an empty result is distinguishable from a row of nulls, which is what a
    // scalar return produced and which read as a WIN to a caller counting rows.
    if (!Array.isArray(rows) || rows.length === 0) return { lock: null, tableMissing: false, error: null };
    return { lock: await decorate(rows[0], userId), tableMissing: false, error: null };
  } catch (e) {
    return { lock: null, tableMissing: false, error: (e as { message?: string }).message ?? 'lock error' };
  }
}

/** Who holds this lock, if anyone. A read: it never takes or extends. */
export async function readLock(
  projectId: string,
  userId: string,
): Promise<{ lock: ProjectLock | null; tableMissing: boolean; error: string | null }> {
  if (locksApplied === false) return { lock: null, tableMissing: true, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_locks').select('*').eq('project_id', projectId).maybeSingle();
    if (error) {
      if (isMissingLockTable(error)) { locksApplied = false; return { lock: null, tableMissing: true, error: null }; }
      return { lock: null, tableMissing: false, error: error.message };
    }
    locksApplied = true;
    if (!data) return { lock: null, tableMissing: false, error: null };
    return { lock: await decorate(data as unknown as Row, userId), tableMissing: false, error: null };
  } catch (e) {
    return { lock: null, tableMissing: false, error: (e as { message?: string }).message ?? 'lock error' };
  }
}

/**
 * Release MY lock. Scoped to the holder, so a request naming someone else's
 * lock releases nothing rather than freeing a project out from under them.
 */
export async function releaseLock(
  projectId: string,
  userId: string,
): Promise<{ released: boolean; error: string | null }> {
  if (locksApplied === false) return { released: false, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_locks').delete()
      .eq('project_id', projectId)
      .eq('holder_user_id', userId)
      .select('project_id');
    if (error) {
      if (isMissingLockTable(error)) { locksApplied = false; return { released: false, error: null }; }
      return { released: false, error: error.message };
    }
    return { released: Array.isArray(data) && data.length > 0, error: null };
  } catch (e) {
    return { released: false, error: (e as { message?: string }).message ?? 'lock error' };
  }
}

/**
 * Ask the holder to save and release.
 *
 * Stamped on the lock row rather than pushed, so the holder learns of it on
 * their next heartbeat and no channel has to stay open. Scoped with a
 * `neq('holder_user_id', userId)` so nobody can request a release from
 * themselves, which would be noise the UI would then have to filter.
 */
export async function requestRelease(
  projectId: string,
  userId: string,
): Promise<{ requested: boolean; error: string | null }> {
  if (locksApplied === false) return { requested: false, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_locks')
      .update({ release_requested_by: userId, release_requested_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .neq('holder_user_id', userId)
      .select('project_id');
    if (error) {
      if (isMissingLockTable(error)) { locksApplied = false; return { requested: false, error: null }; }
      return { requested: false, error: error.message };
    }
    return { requested: Array.isArray(data) && data.length > 0, error: null };
  } catch (e) {
    return { requested: false, error: (e as { message?: string }).message ?? 'lock error' };
  }
}

/**
 * The holder DECLINES a release request: clear it and keep the lock.
 *
 * Accepting is not a separate operation. Accepting IS releasing, and the
 * release path already exists, so there is one way to give up a lock rather
 * than two that could diverge.
 */
export async function declineRelease(
  projectId: string,
  userId: string,
): Promise<{ declined: boolean; error: string | null }> {
  if (locksApplied === false) return { declined: false, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_locks')
      .update({ release_requested_by: null, release_requested_at: null })
      .eq('project_id', projectId)
      .eq('holder_user_id', userId)
      .select('project_id');
    if (error) {
      if (isMissingLockTable(error)) { locksApplied = false; return { declined: false, error: null }; }
      return { declined: false, error: error.message };
    }
    return { declined: Array.isArray(data) && data.length > 0, error: null };
  } catch (e) {
    return { declined: false, error: (e as { message?: string }).message ?? 'lock error' };
  }
}

/**
 * Does this caller hold the lock, for the purposes of allowing a write?
 *
 * TRUE ON A PRE-233 DATABASE, and that is the important case. With no lock
 * table there is no lock to hold, and the platform must keep working exactly
 * as it did before this migration: a single user would otherwise be unable to
 * save anything at all. Degrade to "no locking", never to "no editing".
 */
export async function holdsLock(projectId: string, userId: string): Promise<boolean> {
  const { lock, tableMissing } = await readLock(projectId, userId);
  if (tableMissing) return true;
  if (!lock) return false;
  // A stale lock is nobody's: the holder has gone, and the next acquirer will
  // take it. Treating it as held would block everyone until the TTL expired
  // AND someone happened to try to acquire.
  if (lock.isStale) return false;
  return lock.isMine;
}
