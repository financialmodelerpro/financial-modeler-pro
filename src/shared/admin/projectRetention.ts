/**
 * projectRetention.ts (SERVER ONLY)
 *
 * The retention half of soft delete: the purge that hard deletes projects
 * whose 30-day window has expired, and the admin restore. Both are REGISTRY
 * DRIVEN (PROJECT_SOURCES), so ERM and BVM inherit them by adding one entry
 * with a `deletedColumn`; neither function names a table of its own.
 *
 * Where the purge runs: the existing DAILY apply-scheduled-changes cron, not
 * a new cron entry. Two reasons, in order: Vercel is on the Hobby plan, where
 * a cron mistake has already taken down a whole deploy with no deployment
 * record (TRAPS / memory), so adding a seventh entry is a deploy risk taken
 * for nothing; and a scheduled hard delete IS a scheduled change, which is
 * what that cron is for.
 *
 * The purge uses the SAME hard delete path as before, so every existing FK
 * cascade applies: versions with their change log, report decks and deck
 * versions, fund terms, parties.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PROJECT_SOURCES, RETENTION_DAYS, type ProjectSource } from './projectSources';

export interface PurgeResult {
  /** Per platform key: how many projects were hard deleted. */
  purged: Record<string, number>;
  total: number;
  /** Platforms that could not be scanned (column or table absent), by key. */
  skipped: string[];
  errors: string[];
}

/** The cutoff instant: anything soft-deleted at or before this is due. */
export function purgeCutoffIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString();
}

/**
 * Hard delete every soft-deleted project past its retention window, across
 * every registered platform that supports soft delete.
 *
 * Deliberately selects the ids FIRST and deletes by id, rather than issuing
 * one bulk delete on the timestamp predicate: the ids are what the result
 * reports and what an audit could name, and a bulk delete would report a
 * count nobody could reconcile. Never throws.
 */
export async function purgeExpiredDeletedProjects(
  sb: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<PurgeResult> {
  const out: PurgeResult = { purged: {}, total: 0, skipped: [], errors: [] };
  const cutoff = purgeCutoffIso(nowMs);

  for (const source of PROJECT_SOURCES) {
    if (!source.deletedColumn) { out.skipped.push(source.key); continue; }
    try {
      const { data, error } = await sb
        .from(source.table)
        .select('id')
        .not(source.deletedColumn, 'is', null)
        .lte(source.deletedColumn, cutoff)
        .range(0, 499);
      if (error) {
        // Column or table absent (pre-migration): skip, never fail the cron.
        out.skipped.push(source.key);
        out.errors.push(`${source.key}: ${error.message}`);
        continue;
      }
      const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (ids.length === 0) { out.purged[source.key] = 0; continue; }

      const { error: delErr } = await sb.from(source.table).delete().in('id', ids);
      if (delErr) {
        out.errors.push(`${source.key}: ${delErr.message}`);
        out.purged[source.key] = 0;
        continue;
      }
      out.purged[source.key] = ids.length;
      out.total += ids.length;
      console.log(`[project-purge] ${source.key}: hard deleted ${ids.length} project(s) past ${RETENTION_DAYS} days`);
    } catch (e) {
      out.errors.push(`${source.key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

export type RestoreResult =
  | { ok: true; name: string; userId: string }
  | { ok: false; code: 'unknown_platform' | 'unsupported' | 'not_found' | 'not_deleted' | 'failed'; error: string };

/**
 * Admin restore: clears the soft-delete stamp and hands the project back to
 * its owner in whatever archived state it had.
 *
 * NOTE ON THE CAP, deliberately not enforced here: a restored ACTIVE project
 * can put a user at cap + 1. Blocking the restore would strand the user's data
 * to protect a limit the platform enforces at create and unarchive anyway, so
 * the restore wins and the cap re-asserts itself the next time they create.
 * The admin UI states this.
 */
export async function restoreDeletedProject(
  sb: SupabaseClient,
  platformKey: string,
  projectId: string,
): Promise<RestoreResult> {
  const source: ProjectSource | undefined = PROJECT_SOURCES.find((s) => s.key === platformKey);
  if (!source) return { ok: false, code: 'unknown_platform', error: 'Unknown platform' };
  if (!source.deletedColumn) {
    return { ok: false, code: 'unsupported', error: `${source.shortLabel} projects have no soft-delete state` };
  }

  const { data, error } = await sb
    .from(source.table)
    .select(`id, ${source.nameColumn}, ${source.ownerColumn}, ${source.deletedColumn}`)
    .eq('id', projectId)
    .maybeSingle();
  if (error) return { ok: false, code: 'failed', error: error.message };
  if (!data) return { ok: false, code: 'not_found', error: 'Project not found' };

  const row = data as unknown as Record<string, unknown>;
  if (row[source.deletedColumn] == null) {
    return { ok: false, code: 'not_deleted', error: 'That project is not deleted' };
  }

  const { error: updErr } = await sb
    .from(source.table)
    .update({ [source.deletedColumn]: null })
    .eq('id', projectId);
  if (updErr) return { ok: false, code: 'failed', error: updErr.message };

  return {
    ok: true,
    name: (row[source.nameColumn] as string | null) ?? '(unnamed project)',
    userId: row[source.ownerColumn] as string,
  };
}
