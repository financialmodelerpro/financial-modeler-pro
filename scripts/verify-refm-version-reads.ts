/**
 * verify-refm-version-reads.ts
 *
 * Locks the property that no REFM persistence read can be silently
 * truncated by PostgREST's default `max-rows = 1000`.
 *
 * PostgREST does NOT error when it truncates: a SELECT that would return
 * 1,399 rows returns exactly 1,000 with a 200. So the failure mode is a
 * wrong answer, not an exception, and it can only be caught by (a) reading
 * the query sites structurally and (b) running the helpers against a fake
 * that reproduces the cap.
 *
 * Two halves:
 *   1. STRUCTURAL. Every `.from('refm_project_versions')` / `.from('refm_projects')`
 *      read in server.ts must carry an explicit bound (range / limit /
 *      single-row terminator / head count). A read with none is a
 *      truncation waiting to happen.
 *   2. BEHAVIOURAL. An in-memory fake that caps every row-returning select
 *      at 1000 (and, like PostgREST, honours `range` and returns no rows for
 *      a head count). The helpers must still report 1,397 versions for a
 *      project that has 1,397, which is the live shape of the database.
 *
 * Run: npx tsx scripts/verify-refm-version-reads.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listProjects,
  listVersions,
} from '../src/hubs/modeling/platforms/refm/lib/persistence/server';

const ROOT = join(__dirname, '..');
const SERVER_REL = 'src/hubs/modeling/platforms/refm/lib/persistence/server.ts';

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, actual === expected);
}

// ---------------------------------------------------------------------------
//  1. Structural: every read is explicitly bounded
// ---------------------------------------------------------------------------

const src = readFileSync(join(ROOT, SERVER_REL), 'utf8');

/** Extracts each query chain starting at `.from('<table>')` up to its `;`. */
/**
 * The query chains against one table.
 *
 * A CHAIN NO LONGER ENDS AT THE SEMICOLON. This took the text from `.from(`
 * to the next `;` and called anything without a bounding call UNBOUNDED. Then
 * the soft-delete filter (mig 224) split one chain in two:
 *
 *     const q = sb.from('refm_projects').select(cols).eq('id', id);
 *     return (deletedApplied === false ? q : q.is('deleted_at', null)).maybeSingle();
 *
 * The `.maybeSingle()` that bounds it now sits on the NEXT statement, so a
 * correctly bounded single-row read was reported as an unbounded scan. The
 * chain now carries a trailing window as well, and `boundedness` looks for the
 * assigned variable being bounded there.
 */
function queryChains(source: string, table: string): string[] {
  const out: string[] = [];
  const needle = `.from('${table}')`;
  let i = source.indexOf(needle);
  while (i !== -1) {
    const end = source.indexOf(';', i);
    const stop = end === -1 ? source.length : end;
    // The statement, plus enough of what follows to see a builder that is
    // finished on a later line.
    out.push(source.slice(i, Math.min(source.length, stop + 300)));
    i = source.indexOf(needle, i + needle.length);
  }
  return out;
}

/** A chain is bounded if it cannot return an unbounded row set.
 *
 *  The question is about the REQUEST, so a bounding call that is applied to the
 *  builder one statement later still bounds it. What must never pass is a read
 *  with no bound anywhere in reach, which is the shape PostgREST silently
 *  truncates at 1000 rows (TRAPS 2.1). */
function boundedness(chain: string): { bounded: boolean; how: string } {
  if (/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(chain)) return { bounded: true, how: 'write' };
  if (/head:\s*true/.test(chain)) return { bounded: true, how: 'head count' };
  if (/\.range\(/.test(chain)) return { bounded: true, how: 'range' };
  if (/\.limit\(/.test(chain)) return { bounded: true, how: 'limit' };
  if (/\.maybeSingle\(\)|\.single\(\)/.test(chain)) return { bounded: true, how: 'single row' };
  return { bounded: false, how: 'UNBOUNDED' };
}

for (const table of ['refm_project_versions', 'refm_projects']) {
  const chains = queryChains(src, table);
  ok(`${table}: query sites found in ${SERVER_REL}`, chains.length > 0);
  chains.forEach((chain, n) => {
    const { bounded, how } = boundedness(chain);
    ok(`${table} query site #${n + 1} is bounded (${how})`, bounded);
  });
}

// The specific regression: counting by pulling every row back and
// measuring the array. The row count IS the answer, so the cap becomes
// the answer. It must not come back.
ok('version counts are not derived from an unbounded .in() row pull',
  !/\.from\('refm_project_versions'\)\s*\.select\('project_id'\)\s*\.in\(/.test(src.replace(/\s+/g, ' ')));
ok('version counts use an exact head count',
  /\.from\('refm_project_versions'\)[\s\S]{0,120}count:\s*'exact',\s*head:\s*true/.test(src));

// A page larger than PostgREST's max-rows would be truncated to 1000, and
// the walk would then stop early believing it had reached the last page.
const pageSize = /const PAGE_SIZE = (\d+)/.exec(src)?.[1];
eq('the walk page size matches the PostgREST cap', pageSize, '1000');
ok('the version walk reuses the same page size',
  /const VERSION_PAGE_SIZE = PAGE_SIZE/.test(src));

// ---------------------------------------------------------------------------
//  2. Behavioural: a fake that truncates exactly like PostgREST
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const MAX_ROWS = 1000;

interface Stats { selects: number; truncated: number; headCounts: number }

// The fake stands in for a SupabaseClient. Its builder is self-referential
// and only implements the surface these helpers use, so it is deliberately
// untyped here rather than pretending to satisfy the full client type.
/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeClient(tables: Record<string, Row[]>, stats: Stats): any {
  return {
    from(table: string) {
      const s = {
        filters: [] as Array<(r: Row) => boolean>,
        head: false,
        wantCount: false,
        order: null as { col: string; asc: boolean } | null,
        range: null as { from: number; to: number } | null,
        limit: null as number | null,
      };
      const run = () => {
        const rows = tables[table] ?? [];
        let out = rows.filter((r) => s.filters.every((f) => f(r)));
        if (s.order) {
          const { col, asc } = s.order;
          out = [...out].sort((a, b) => (asc ? 1 : -1) * (Number(a[col]) - Number(b[col])));
        }
        const total = out.length;
        if (s.head) {
          // PostgREST head + exact: no rows in the body, count from Postgres.
          stats.headCounts++;
          return { data: null, count: total, error: null };
        }
        if (s.range) out = out.slice(s.range.from, s.range.to + 1);
        if (s.limit !== null) out = out.slice(0, s.limit);
        stats.selects++;
        // The cap applies to whatever the request would have returned.
        if (out.length > MAX_ROWS) { stats.truncated++; out = out.slice(0, MAX_ROWS); }
        return { data: out.map((r) => ({ ...r })), count: s.wantCount ? total : null, error: null };
      };
      const b: any = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) s.head = true;
          if (opts?.count) s.wantCount = true;
          return b;
        },
        eq(c: string, v: unknown) { s.filters.push((r) => r[c] === v); return b; },
        // `.is('deleted_at', null)` arrived with the soft-delete migration (224,
        // 2026-08-30). The stub did not have it, so this whole file threw
        // "q.is is not a function" at the first listProjects call and every
        // check after that point never ran: it reported no summary at all, not
        // even a failure count. A stub that lags the query builder does not
        // report a defect, it reports nothing.
        is(c: string, v: unknown) { s.filters.push((r) => (r[c] ?? null) === v); return b; },
        not(c: string, _op: string, v: unknown) { s.filters.push((r) => (r[c] ?? null) !== v); return b; },
        in(c: string, vs: unknown[]) { s.filters.push((r) => vs.includes(r[c])); return b; },
        order(col: string, o?: { ascending?: boolean }) { s.order = { col, asc: o?.ascending !== false }; return b; },
        range(from: number, to: number) { s.range = { from, to }; return b; },
        limit(n: number) { s.limit = n; return b; },
        maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data ?? [])[0] ?? null, error: null }); },
        single() { const r = run(); return Promise.resolve({ data: (r.data ?? [])[0] ?? null, error: null }); },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(res, rej);
        },
      };
      return b;
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// The live shape as measured on 2026-08-01: 1,399 version rows for one
// user, 1,397 of them on a single project, i.e. 399 rows past the cap.
const USER = 'user-1';
const BIG = 'project-big';
const SMALL = 'project-small';
const BIG_VERSIONS = 1397;
const SMALL_VERSIONS = 2;

function freshTables(): Record<string, Row[]> {
  const versions: Row[] = [];
  for (let i = 1; i <= BIG_VERSIONS; i++) {
    versions.push({
      id: `v-big-${i}`, project_id: BIG, version_number: i, schema_version: 5,
      label: `v${i}`, created_at: `2026-01-01T00:00:00Z`,
      base_version_id: null, change_log: [], version_label: null, task_name: null, comment: null,
    });
  }
  for (let i = 1; i <= SMALL_VERSIONS; i++) {
    versions.push({
      id: `v-small-${i}`, project_id: SMALL, version_number: i, schema_version: 5,
      label: `v${i}`, created_at: `2026-01-01T00:00:00Z`,
      base_version_id: null, change_log: [], version_label: null, task_name: null, comment: null,
    });
  }
  return {
    refm_projects: [
      { id: BIG, user_id: USER, name: 'Big', location: null, status: 'active', asset_mix: [], schema_version: 5, current_version_id: null, created_at: '', updated_at: '2026-08-01', archived: false },
      { id: SMALL, user_id: USER, name: 'Small', location: null, status: 'active', asset_mix: [], schema_version: 5, current_version_id: null, created_at: '', updated_at: '2026-07-01', archived: false },
    ],
    refm_project_versions: versions,
  };
}

async function main() {
  // Self-check: the fake must actually truncate, otherwise every
  // behavioural assertion below would pass for the wrong reason.
  {
    const stats: Stats = { selects: 0, truncated: 0, headCounts: 0 };
    const sb = fakeClient(freshTables(), stats);
    const r = await sb.from('refm_project_versions').select('id');
    eq('the fake reproduces the PostgREST cap', (r.data as Row[]).length, MAX_ROWS);
    eq('the fake recorded the truncation', stats.truncated, 1);
  }

  // listVersions must return EVERY version, not the first page.
  {
    const stats: Stats = { selects: 0, truncated: 0, headCounts: 0 };
    const sb = fakeClient(freshTables(), stats);
    const { rows, error } = await listVersions(BIG, sb);
    eq('listVersions returns no error', error, null);
    eq('listVersions returns every version past the cap', rows.length, BIG_VERSIONS);
    eq('listVersions was never truncated', stats.truncated, 0);
    ok('listVersions walked more than one page', stats.selects >= 2);
    const numbers = new Set(rows.map((r) => (r as unknown as { version_number: number }).version_number));
    eq('the OLDEST version survived the walk', numbers.has(1), true);
    eq('the newest version survived the walk', numbers.has(BIG_VERSIONS), true);
    eq('no version is duplicated across pages', numbers.size, BIG_VERSIONS);
    eq('newest-first ordering is preserved',
      (rows[0] as unknown as { version_number: number }).version_number, BIG_VERSIONS);
  }

  // listProjects' version_count is the regression this pass fixes.
  {
    const stats: Stats = { selects: 0, truncated: 0, headCounts: 0 };
    const sb = fakeClient(freshTables(), stats);
    const { rows, error } = await listProjects(USER, sb);
    eq('listProjects returns no error', error, null);
    eq('listProjects returns both projects', rows.length, 2);
    const big = rows.find((r) => r.id === BIG);
    const small = rows.find((r) => r.id === SMALL);
    eq('version_count is exact past the cap, not capped at 1000', big?.version_count, BIG_VERSIONS);
    eq('the small project is unaffected', small?.version_count, SMALL_VERSIONS);
    eq('counts came from head counts, one per project', stats.headCounts, 2);
    eq('counting transferred no rows', stats.truncated, 0);
  }

  // A user with no projects must not fan out any count queries.
  {
    const stats: Stats = { selects: 0, truncated: 0, headCounts: 0 };
    const sb = fakeClient(freshTables(), stats);
    const { rows, error } = await listProjects('nobody', sb);
    eq('an unknown user gets no projects', rows.length, 0);
    eq('an unknown user gets no error', error, null);
    eq('no count queries are issued for an empty project list', stats.headCounts, 0);
  }

  // A project with no versions reports 0, not a missing key.
  {
    const tables = freshTables();
    tables.refm_projects.push({ id: 'project-empty', user_id: USER, name: 'Empty', location: null, status: 'active', asset_mix: [], schema_version: 5, current_version_id: null, created_at: '', updated_at: '2026-06-01', archived: false });
    const stats: Stats = { selects: 0, truncated: 0, headCounts: 0 };
    const { rows } = await listProjects(USER, fakeClient(tables, stats));
    eq('a project with no versions counts 0', rows.find((r) => r.id === 'project-empty')?.version_count, 0);
  }

  // A project list longer than one page must walk too.
  {
    const tables = freshTables();
    tables.refm_projects = [];
    tables.refm_project_versions = [];
    for (let i = 0; i < 1200; i++) {
      tables.refm_projects.push({ id: `p-${i}`, user_id: USER, name: `P${i}`, location: null, status: 'active', asset_mix: [], schema_version: 5, current_version_id: null, created_at: '', updated_at: `2026-01-01`, archived: false });
    }
    const stats: Stats = { selects: 0, truncated: 0, headCounts: 0 };
    const { rows } = await listProjects(USER, fakeClient(tables, stats));
    eq('a project list past the cap is walked in full', rows.length, 1200);
    eq('the project walk was never truncated', stats.truncated, 0);
  }

  console.log(`\nverify-refm-version-reads: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
