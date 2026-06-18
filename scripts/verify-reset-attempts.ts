/**
 * verify-reset-attempts.ts
 *
 * Unit coverage for the admin assessment-reset orchestration (resetAttemptsCore).
 * Proves the bug fixes with injected fakes (no DB / Apps Script / auth):
 *  - "Student not found" from Apps Script is NON-FATAL: the reset still succeeds
 *    and Supabase is still cleared (the FMP-2026-0012 bug).
 *  - Lookup works by RegID and by email (symmetric resolution).
 *  - Supabase is cleared by email AND reg_id.
 *  - Idempotent: nothing to clear is a clean success, never an error.
 *  - applyTabScope: single tab_key -> eq, ALL+course -> ilike, ALL -> unscoped.
 *
 * Run: npx tsx scripts/verify-reset-attempts.ts
 */
import {
  resetAttemptsCore, applyTabScope,
  type ResetStore, type ResetExternal, type ScopeArgs,
} from '../src/hubs/training/lib/admin/resetAttempts';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

// In-memory fake store. `rows` simulates training_assessment_results.
interface Row { email: string; reg_id: string; tab_key: string }
function makeStore(rows: Row[], roster: { regId: string; email: string }[]): ResetStore & { rows: Row[]; calls: string[] } {
  const calls: string[] = [];
  const inScope = (tab: string, scope: ScopeArgs): boolean => {
    if (!scope.isAll) return tab === scope.tabKey;
    if (scope.course && scope.course.trim()) return tab.toUpperCase().startsWith(`${scope.course.trim().toUpperCase()}_`);
    return true;
  };
  const store = {
    rows, calls,
    async emailForRegId(regId: string) { calls.push(`emailForRegId:${regId}`); return roster.find((r) => r.regId === regId)?.email ?? null; },
    async regIdForEmail(email: string) { calls.push(`regIdForEmail:${email}`); return roster.find((r) => r.email.toLowerCase() === email.toLowerCase())?.regId ?? null; },
    async clearResults(filter: { by: 'email' | 'reg_id'; value: string }, scope: ScopeArgs) {
      calls.push(`clearResults:${filter.by}=${filter.value}`);
      const before = store.rows.length;
      store.rows = store.rows.filter((r) => !((filter.by === 'email' ? r.email.toLowerCase() === filter.value.toLowerCase() : r.reg_id === filter.value) && inScope(r.tab_key, scope)));
      return before - store.rows.length;
    },
    async clearInProgress(email: string) { calls.push(`clearInProgress:${email}`); },
    async clearLive(email: string, sessionId: string) { calls.push(`clearLive:${email}:${sessionId}`); },
  };
  return store;
}
const appsScriptNotFound: ResetExternal = { async resetSheet() { return { ok: false, notFound: true, error: 'Student not found: FMP-2026-0012' }; } };
const appsScriptOk: ResetExternal = { async resetSheet() { return { ok: true }; } };
const appsScriptThrows: ResetExternal = { async resetSheet() { throw new Error('Apps Script unreachable'); } };

async function main(): Promise<void> {
console.log('=== Admin assessment reset (resetAttemptsCore) ===');

// 1. The FMP-2026-0012 bug: Apps Script "not found" must NOT block the reset.
{
  const store = makeStore(
    [{ email: 'stu@x.com', reg_id: 'FMP-2026-0012', tab_key: '3SFM_S16' }],
    [{ regId: 'FMP-2026-0012', email: 'stu@x.com' }],
  );
  const r = await resetAttemptsCore(store, appsScriptNotFound, { regId: 'FMP-2026-0012', tabKey: '3SFM_S16', course: '3sfm' });
  check('not-found Apps Script -> reset still succeeds', r.success === true, JSON.stringify(r));
  check('not-found Apps Script -> appsScript=not_found (non-fatal)', r.appsScript === 'not_found');
  check('not-found Apps Script -> Supabase row WAS cleared', r.clearedSupabase === true && store.rows.length === 0);
  check('not-found Apps Script -> warning captured, not error', (r.warnings ?? []).some((w) => /not found/i.test(w)) && !r.error);
}

// 2. Apps Script throwing is non-fatal too.
{
  const store = makeStore([{ email: 'a@b.com', reg_id: 'R1', tab_key: '3SFM_S1' }], [{ regId: 'R1', email: 'a@b.com' }]);
  const r = await resetAttemptsCore(store, appsScriptThrows, { regId: 'R1', tabKey: '3SFM_S1', course: '3sfm' });
  check('Apps Script throw -> reset succeeds + cleared', r.success === true && r.clearedSupabase === true && r.appsScript === 'error');
}

// 3. Lookup by RegID only resolves email and clears by both keys.
{
  const store = makeStore([{ email: 'reg@x.com', reg_id: 'R2', tab_key: '3SFM_S2' }], [{ regId: 'R2', email: 'reg@x.com' }]);
  const r = await resetAttemptsCore(store, appsScriptOk, { regId: 'R2', tabKey: '3SFM_S2', course: '3sfm' });
  check('RegID-only: email resolved from roster', store.calls.includes('emailForRegId:R2'));
  check('RegID-only: cleared by email AND reg_id', store.calls.includes('clearResults:email=reg@x.com') && store.calls.includes('clearResults:reg_id=R2'));
  check('RegID-only: success + cleared', r.success === true && r.clearedSupabase === true);
}

// 4. Lookup by email only resolves RegID.
{
  const store = makeStore([{ email: 'em@x.com', reg_id: 'R3', tab_key: '3SFM_S3' }], [{ regId: 'R3', email: 'em@x.com' }]);
  const r = await resetAttemptsCore(store, appsScriptOk, { email: 'em@x.com', tabKey: '3SFM_S3', course: '3sfm' });
  check('email-only: RegID resolved from roster', store.calls.includes('regIdForEmail:em@x.com'));
  check('email-only: success + cleared', r.success === true && r.clearedSupabase === true && store.rows.length === 0);
}

// 5. Idempotent: nothing to clear is a clean success, never an error.
{
  const store = makeStore([], [{ regId: 'R4', email: 'none@x.com' }]);
  const r = await resetAttemptsCore(store, appsScriptNotFound, { regId: 'R4', tabKey: '3SFM_S9', course: '3sfm' });
  check('empty store -> success (no error)', r.success === true && !r.error);
  check('empty store -> clearedSupabase=false (clean no-op)', r.clearedSupabase === false);
  check('empty store -> message says already reset', /already reset/i.test(r.message ?? ''));
}

// 6. ALL course-wide reset clears only that course's rows, leaves others.
{
  const store = makeStore([
    { email: 'm@x.com', reg_id: 'R5', tab_key: '3SFM_S1' },
    { email: 'm@x.com', reg_id: 'R5', tab_key: '3SFM_S2' },
    { email: 'm@x.com', reg_id: 'R5', tab_key: 'BVM_L1' },
  ], [{ regId: 'R5', email: 'm@x.com' }]);
  const r = await resetAttemptsCore(store, appsScriptOk, { regId: 'R5', tabKey: 'ALL', course: '3sfm' });
  check('ALL 3sfm: success', r.success === true);
  check('ALL 3sfm: 3SFM rows cleared, BVM row retained', store.rows.length === 1 && store.rows[0].tab_key === 'BVM_L1');
}

// 7. Validation: missing tabKey / missing both ids.
{
  const store = makeStore([], []);
  const r1 = await resetAttemptsCore(store, appsScriptOk, { regId: 'R', tabKey: '' });
  check('missing tabKey -> 400', r1.success === false && r1.status === 400);
  const r2 = await resetAttemptsCore(store, appsScriptOk, { tabKey: '3SFM_S1' });
  check('missing regId+email -> 400', r2.success === false && r2.status === 400);
}

// 8. applyTabScope semantics (fake query builder records calls).
{
  const calls: string[] = [];
  const builder: Record<string, (...a: unknown[]) => unknown> = {
    eq: (c, v) => { calls.push(`eq:${c}=${v}`); return builder; },
    ilike: (c, v) => { calls.push(`ilike:${c}=${v}`); return builder; },
  };
  applyTabScope(builder, { isAll: false, tabKey: '3SFM_S16' });
  check('scope single -> eq tab_key', calls.includes('eq:tab_key=3SFM_S16'));
  calls.length = 0;
  applyTabScope(builder, { isAll: true, course: '3sfm', tabKey: 'ALL' });
  check('scope ALL+course -> ilike 3SFM\\_%', calls.some((c) => c.startsWith('ilike:tab_key=3SFM\\_%')));
  calls.length = 0;
  applyTabScope(builder, { isAll: true, tabKey: 'ALL' });
  check('scope ALL no course -> unscoped (no eq/ilike)', calls.length === 0);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
}

void main();
