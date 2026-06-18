/**
 * resetAttempts.ts
 *
 * Pure orchestration for the manual, admin-triggered assessment reset. The HTTP
 * route (app/api/admin/reset-attempts) wires real Supabase + Apps Script
 * implementations into this core; verify-reset-attempts injects fakes.
 *
 * Invariants this core enforces (the bug fixes):
 *  - Supabase (the dashboard's primary store) is cleared FIRST and
 *    unconditionally, by email AND reg_id, so a student visible in the
 *    Supabase-sourced admin list always resolves and clears.
 *  - Apps Script (legacy Google Sheet score) is best-effort: a "not found" or
 *    any failure is a non-fatal no-op and never aborts the reset.
 *  - Idempotent: nothing to clear is a clean success, never an error.
 *  - regId <-> email resolve symmetrically from the roster store.
 *
 * No em dashes in this file.
 */

export interface ScopeArgs {
  isAll: boolean;
  course?: string;
  tabKey: string;
}

/**
 * Apply the session-scope filter to a Supabase-style delete query builder that
 * has a tab_key column. Single tab_key -> eq; course-wide ALL -> ilike
 * 'COURSE\_%'; ALL with no course -> unscoped (every row for the identifier).
 * Generic over the builder so it stays free of supabase-js types.
 */
export function applyTabScope<T>(q: T, scope: ScopeArgs): T {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const query = q as any;
  if (!scope.isAll) return query.eq('tab_key', scope.tabKey);
  if (scope.course && scope.course.trim()) {
    return query.ilike('tab_key', `${scope.course.trim().toUpperCase()}\\_%`);
  }
  return query;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export type AppsScriptOutcome = 'cleared' | 'not_found' | 'skipped' | 'error';

export interface ResetStore {
  /** registration_id -> email (lowercased on the way out is fine), or null. */
  emailForRegId(regId: string): Promise<string | null>;
  /** email -> registration_id, or null. */
  regIdForEmail(email: string): Promise<string | null>;
  /** Delete matching training_assessment_results rows; return rows cleared. */
  clearResults(filter: { by: 'email' | 'reg_id'; value: string }, scope: ScopeArgs): Promise<number>;
  /** Delete matching assessment_attempts_in_progress rows (cert path). */
  clearInProgress(email: string, scope: ScopeArgs): Promise<void>;
  /** Delete live_session_attempts (+ in-progress) for one live session. */
  clearLive(email: string, sessionId: string): Promise<void>;
}

export interface ResetExternal {
  /** Best-effort legacy Sheet reset. notFound = student absent in the Sheet. */
  resetSheet(regId: string, tabKey: string, course: string | undefined): Promise<{ ok: boolean; notFound?: boolean; error?: string }>;
}

export interface ResetInput { regId?: string; email?: string; tabKey?: string; course?: string }
export interface ResetResult {
  success: boolean;
  status?: number;
  error?: string;
  message?: string;
  clearedSupabase?: boolean;
  appsScript?: AppsScriptOutcome;
  warnings?: string[];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function resetAttemptsCore(store: ResetStore, external: ResetExternal, input: ResetInput): Promise<ResetResult> {
  const tabKey = (input.tabKey ?? '').trim();
  let regId = (input.regId ?? '').trim();
  let email = (input.email ?? '').trim();

  if (!tabKey) return { success: false, status: 400, error: 'tabKey required' };
  if (!regId && !email) return { success: false, status: 400, error: 'regId or email required' };

  // Resolve the missing identifier from the roster (same store the admin list uses).
  if (!email && regId) email = (await store.emailForRegId(regId)) ?? '';
  if (!regId && email) regId = (await store.regIdForEmail(email)) ?? '';
  const normalizedEmail = email.toLowerCase();

  const isLive = tabKey.startsWith('LIVE_');
  const isAll = tabKey === 'ALL';
  const scope: ScopeArgs = { isAll, course: input.course, tabKey };

  // ── Live session branch ────────────────────────────────────────────────────
  if (isLive) {
    if (!normalizedEmail) return { success: false, status: 400, error: 'Email not resolvable for this student' };
    await store.clearLive(normalizedEmail, tabKey.slice('LIVE_'.length));
    return { success: true, message: 'Live session attempts cleared' };
  }

  // ── Course branch: clear Supabase first + unconditionally ──────────────────
  const warnings: string[] = [];
  let cleared = 0;

  if (normalizedEmail) {
    try { cleared += await store.clearResults({ by: 'email', value: normalizedEmail }, scope); }
    catch (e) { warnings.push(`results(email): ${errMsg(e)}`); }
  }
  if (regId) {
    try { cleared += await store.clearResults({ by: 'reg_id', value: regId }, scope); }
    catch (e) { warnings.push(`results(reg_id): ${errMsg(e)}`); }
  }
  if (normalizedEmail) {
    try { await store.clearInProgress(normalizedEmail, scope); }
    catch (e) { warnings.push(`in_progress: ${errMsg(e)}`); }
  }

  // ── Apps Script: best-effort, never fatal ──────────────────────────────────
  let appsScript: AppsScriptOutcome = 'skipped';
  if (regId) {
    try {
      const r = await external.resetSheet(regId, tabKey, input.course);
      if (r.ok) appsScript = 'cleared';
      else if (r.notFound) { appsScript = 'not_found'; warnings.push(`Apps Script: ${r.error ?? 'student not found'}`); }
      else { appsScript = 'error'; warnings.push(`Apps Script: ${r.error ?? 'reset failed'}`); }
    } catch (e) {
      appsScript = 'error';
      warnings.push(`Apps Script: ${errMsg(e)}`);
    }
  }

  const scopeLabel = isAll ? `all ${input.course ? input.course.toUpperCase() + ' ' : ''}sessions` : tabKey;
  return {
    success: true,
    clearedSupabase: cleared > 0,
    appsScript,
    warnings,
    message: cleared > 0 ? `Attempts reset for ${scopeLabel}` : `Nothing to clear for ${scopeLabel} (already reset)`,
  };
}
