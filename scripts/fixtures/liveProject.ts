/**
 * liveProject.ts (2026-09-21)
 *
 * THE ONE RULE FOR READING A REAL PROJECT IN A VERIFIER, so "the project is
 * gone" can never again read as "nothing to do".
 *
 * Three report verifiers each carried their own copy of this read, pointed at
 * FMP RE HUB by id, and each copy handled a failure differently and an EMPTY
 * result not at all: `if (error) ... else if (data?.length) ...` prints on an
 * error and says nothing when the query succeeds with no rows. That project
 * was soft-deleted on 2026-09-12, so from the 30-day purge onwards the whole
 * leg would have vanished from three verifiers in silence while they kept
 * reporting a pass.
 *
 * THE RULES HERE:
 *   - the project named is one that is OPEN, not soft-deleted;
 *   - no rows is a FAILURE, never a skip;
 *   - a transport error is retried ONCE and then reported as a failure, so a
 *     blip does not redden a suite but a real outage is not swallowed either;
 *   - missing credentials are the runner's business (it refuses to run without
 *     them unless --allow-offline), so they are reported as a notice.
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';

/** FMP - MARINA GATE: the live, fully priced project. */
export const LIVE_PROJECT_ID = 'c417fc6a-4514-4438-857c-a72dc7472f65';
export const LIVE_PROJECT_LABEL = 'FMP - MARINA GATE';

export type LiveRead =
  | { ok: true; snapshot: any; versionLabel: string; label: string }
  | { ok: false; noCredentials: true }
  | { ok: false; noCredentials?: false; reason: string };

/**
 * The newest saved version of the live project.
 *
 * Read-only, and never written back: a verifier must not edit a real project.
 */
export async function readLiveProjectVersion(): Promise<LiveRead> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, noCredentials: true };
  const sb = createClient(url, key, { auth: { persistSession: false } });
  let lastReason = '';
  // Two attempts: a dropped connection under load is not evidence that a
  // project was deleted, and treating it as such would make the suite flaky.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await sb.from('refm_project_versions')
        .select('snapshot,version_label').eq('project_id', LIVE_PROJECT_ID)
        .order('created_at', { ascending: false }).limit(1);
      if (error) { lastReason = `read failed: ${error.message}`; continue; }
      if (!data?.length) {
        // NOT retried: the query succeeded and the project has no versions.
        return { ok: false, reason: `no saved versions for ${LIVE_PROJECT_LABEL} (${LIVE_PROJECT_ID}). If it was deleted, point these verifiers at a project that is open, or at a committed fixture.` };
      }
      const row = data[0] as { snapshot: unknown; version_label: string | null };
      return {
        ok: true,
        snapshot: row.snapshot,
        versionLabel: row.version_label ?? '(unlabelled)',
        label: `${LIVE_PROJECT_LABEL} (saved version ${row.version_label ?? '(unlabelled)'})`,
      };
    } catch (e) {
      lastReason = `connection failed: ${(e as Error).message}`;
    }
  }
  return { ok: false, reason: lastReason || 'unknown read failure' };
}
