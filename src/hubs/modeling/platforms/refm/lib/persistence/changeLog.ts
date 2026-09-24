/**
 * changeLog.ts
 *
 * THE APPEND-ONLY CHANGE LOG, server side. Module 10 Collaboration, step 6.
 *
 * Who changed what, when. Writes to `refm_project_changes` (migration 234),
 * which a database trigger refuses to let anything rewrite.
 *
 * ── WHAT GETS LOGGED, AND WHY IT IS NOT THE WHOLE DIFF ────────────────────
 *
 * The autosave PATCHes one version row every 1.5 seconds, and the route
 * already holds BOTH the stored snapshot and the incoming one. Diffing those
 * two gives exactly what THIS SAVE changed, which is normally one field. That
 * is the right unit for an audit trail and it is naturally bounded.
 *
 * Diffing against `base_version_id` instead, which is what the version row's
 * own `change_log` does, would re-log the entire session on every beat: the
 * same edit written hundreds of times, growing with the length of the session
 * rather than with the number of changes.
 *
 * ── THE CAP, AND WHY IT SUMMARISES RATHER THAN TRUNCATES ──────────────────
 *
 * Some single saves legitimately change thousands of paths: the first save of
 * a project, switching a scenario case, changing a phase length that cascades.
 * Writing a row each would bury the log in noise and make it slow to read.
 * Past the cap, ONE summary row is written that states how many paths moved.
 * That is honest about what happened; truncating silently would leave a log
 * that looks complete and is not.
 *
 * ── FAILING TO LOG NEVER FAILS THE SAVE ───────────────────────────────────
 *
 * A deliberate trade, and it goes the other way for a compliance ledger. This
 * log exists so a team can see who did what; losing an entry is a gap in a
 * history, while failing the write would lose a user's actual work. So the
 * appender swallows its own errors. It is not silent to the operator: the
 * failure is logged server-side.
 *
 * No em dashes in this file.
 */
import { randomUUID } from 'node:crypto';
import { getServerClient } from '@/src/core/db/supabase';
import type { ChangeLogEntry } from './snapshot-diff';

/** Above this many changed paths in ONE save, a single summary row is written
 *  instead of one row per path. */
export const MAX_CHANGE_ROWS_PER_SAVE = 40;

/** The most paths one bulk row records by name (paths and kinds only). */
export const MAX_BULK_PATHS = 5000;

/** Cached like every other migration probe: false once the table is observed
 *  absent, so a pre-234 database simply does not log. */
let changesApplied: boolean | undefined;

function isMissingChangesTable(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /refm_project_changes/i.test(String(err.message ?? ''));
}

export interface ChangeRowInput {
  projectId: string;
  versionId: string | null;
  userId: string | null;
  action: string;
  path: string | null;
  /** The human sentence for this change, when the differ produced one. Null
   *  means the renderer falls back to the path, exactly as before mig 245. */
  label?: string | null;
  /** Which SAVE this row belongs to (mig 245). Every row of one save shares
   *  it, so the screen can render forty field changes as one entry. */
  saveId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Append rows. Never throws, and never fails the caller.
 *
 * Returns how many rows were written so a caller (or a test) can tell a real
 * append from a silent no-op, rather than assuming.
 */
export async function appendChanges(rows: readonly ChangeRowInput[]): Promise<{ written: number }> {
  if (changesApplied === false || rows.length === 0) return { written: 0 };
  try {
    const sb = getServerClient();
    const payload = rows.map((r) => ({
      project_id: r.projectId,
      version_id: r.versionId,
      user_id: r.userId,
      action: r.action,
      path: r.path,
      label: r.label ?? null,
      save_id: r.saveId ?? null,
      // `before` and `after` are jsonb. `undefined` is not valid JSON, so an
      // absent value is stored as SQL NULL rather than being dropped from the
      // object, which would leave the column unset and indistinguishable.
      before: r.before === undefined ? null : r.before,
      after: r.after === undefined ? null : r.after,
    }));
    const { error } = await sb.from('refm_project_changes').insert(payload);
    if (error) {
      if (isMissingChangesTable(error)) { changesApplied = false; return { written: 0 }; }
      // Not silent to the operator, even though it is silent to the user.
      console.error('[changeLog] append failed:', error.message);
      return { written: 0 };
    }
    changesApplied = true;
    return { written: payload.length };
  } catch (e) {
    console.error('[changeLog] append threw:', (e as { message?: string }).message);
    return { written: 0 };
  }
}

/**
 * Turn the delta of ONE save into rows, applying the cap.
 *
 * `entries` must be the diff between the STORED snapshot and the INCOMING one,
 * not against the session base. See the header.
 */
export function rowsForSave(
  projectId: string,
  versionId: string | null,
  userId: string | null,
  entries: readonly ChangeLogEntry[],
): ChangeRowInput[] {
  if (entries.length === 0) return [];
  // ONE ID PER SAVE, minted here because this is the one place that knows a
  // save's rows as a set (2026-09-22). Every row of a save carries it, so the
  // screen groups forty field changes into one entry.
  //
  // A UUID, NOT A TIMESTAMP TOLERANCE, by founder decision: no width is right
  // for both a 1.5-second autosave beat and a slow save, so a tolerance
  // eventually merges two saves or splits one, and it does so silently.
  const saveId = randomUUID();
  if (entries.length > MAX_CHANGE_ROWS_PER_SAVE) {
    return [{
      projectId, versionId, userId, saveId,
      action: 'bulk-change',
      path: null,
      before: null,
      // States the size rather than pretending to enumerate it, and keeps a
      // sample so the entry is not opaque.
      after: {
        changedPaths: entries.length,
        sample: entries.slice(0, 10).map((e) => e.path),
        // EVERY PATH, NOT A SAMPLE (2026-09-24): a reader must be able to see
        // WHAT a bulk save changed, not only how much. Paths and kinds only,
        // no values, so even a whole-project save stays small; capped so a
        // pathological save cannot write an unbounded row, and the count above
        // stays the truth when the cap bites.
        changes: entries.slice(0, MAX_BULK_PATHS).map((e) => ({ path: e.path, kind: e.kind ?? 'update' })),
        note: `More than ${MAX_CHANGE_ROWS_PER_SAVE} paths changed in one save, so this is recorded as a single entry.`,
      },
    }];
  }
  // THE LABEL IS CARRIED, not dropped (2026-09-22). `snapshot-diff` has
  // produced a human sentence since this log was built and it died here, so
  // the screen had nothing but the raw path to show.
  return entries.map((e) => ({
    projectId, versionId, userId, saveId,
    action: e.kind ?? 'update',
    path: e.path,
    label: e.label ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
  }));
}

export interface ProjectChange {
  id: string;
  versionId: string | null;
  userId: string | null;
  userName: string | null;
  action: string;
  path: string | null;
  /** Human sentence, or null when the differ did not label this entry. */
  label: string | null;
  /** The save this row belongs to. Null for rows written before mig 245,
   *  which belong to a save nobody recorded. */
  saveId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

/**
 * A project's history, newest first.
 *
 * EVERYONE WHO CAN READ THE PROJECT SEES THE SAME LOG. There is no per-row
 * redaction and no admin-only view: the log is the project's history, and a
 * history only half the team can see is not one they can rely on. An admin
 * sees more only in the sense that an admin can reach more projects.
 *
 * The caller is responsible for having established read access first, exactly
 * as every other project sub-resource does.
 */
export async function listProjectChanges(
  projectId: string,
  limit = 200,
): Promise<{ rows: ProjectChange[]; tableMissing: boolean; error: string | null }> {
  if (changesApplied === false) return { rows: [], tableMissing: true, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_changes')
      .select('id, version_id, user_id, action, path, label, save_id, before, after, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      // Bounded, because PostgREST silently truncates an unbounded read at its
      // own cap and a log is exactly the kind of table that outgrows it.
      .limit(Math.max(1, Math.min(limit, 1000)));
    if (error) {
      if (isMissingChangesTable(error)) { changesApplied = false; return { rows: [], tableMissing: true, error: null }; }
      return { rows: [], tableMissing: false, error: error.message };
    }
    changesApplied = true;
    const raw = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const names = await resolveNames(raw.map((r) => String(r.user_id ?? '')).filter(Boolean));
    return {
      rows: raw.map((r) => ({
        id: String(r.id),
        versionId: (r.version_id as string) ?? null,
        userId: (r.user_id as string) ?? null,
        // An unresolvable author reads as unknown, never as a uuid and never
        // as the project owner (migration 230's rule, applied here too).
        userName: r.user_id ? (names[String(r.user_id)] ?? null) : null,
        action: String(r.action),
        path: (r.path as string) ?? null,
        label: (r.label as string) ?? null,
        saveId: (r.save_id as string) ?? null,
        before: r.before ?? null,
        after: r.after ?? null,
        createdAt: String(r.created_at),
      })),
      tableMissing: false,
      error: null,
    };
  } catch (e) {
    return { rows: [], tableMissing: false, error: (e as { message?: string }).message ?? 'change log error' };
  }
}

async function resolveNames(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
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
