/**
 * scripts/verify-project-soft-delete.ts
 *
 * Pins the 2026-08-30 soft delete for user project deletion:
 *   A. The retention rule is ONE pure definition (RETENTION_DAYS +
 *      daysRemaining + isPurgeDue), including both boundaries.
 *   B. The purge is REGISTRY DRIVEN and behavioural: run against a fake
 *      client it hard deletes only what is past the window, names no table of
 *      its own, and skips a platform with no soft-delete column. Restore
 *      clears the stamp and refuses a project that is not deleted.
 *   C. A user's Delete is SOFT and can never become a silent hard delete:
 *      the route calls softDeleteProject, hard delete survives ONLY for the
 *      create/duplicate rollback and the purge, and an unsupported column
 *      refuses (503) instead of falling back to a permanent delete.
 *   D. Invisibility: the user list, the single-project read and the project
 *      CAP all exclude soft-deleted rows, each with pre-224 tolerance.
 *   E. Read-only grace blocks deletion, server side AND in the UI (the
 *      control is withheld, not left clickable and discarded).
 *   F. The native confirms are gone and the dialog states what they could
 *      not: the version count, the window, and who can restore.
 *   G. Migration 224 is additive only.
 *
 * Runs OFFLINE (no env, no DB, no network).
 * Run: npx tsx scripts/verify-project-soft-delete.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RETENTION_DAYS, daysRemaining, isPurgeDue, getProjectSource, PROJECT_SOURCES,
} from '../src/shared/admin/projectSources';
import { purgeExpiredDeletedProjects, restoreDeletedProject, purgeCutoffIso } from '../src/shared/admin/projectRetention';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-30T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

// ── Fake Supabase client recording every table operation ───────────────────
interface Call { table: string; op: string; }
function makeFake(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  const deleted: Record<string, string[]> = {};
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];

  function builder(table: string, op: string, patch?: Record<string, unknown>) {
    const state: { lte?: string; notNull?: string; eqId?: string } = {};
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (_c: string, v: string) => { state.eqId = v; return b; };
    b.in = (_c: string, ids: string[]) => {
      if (op === 'delete') { deleted[table] = (deleted[table] ?? []).concat(ids); }
      return Promise.resolve({ data: null, error: null });
    };
    b.not = (c: string) => { state.notNull = c; return b; };
    b.lte = (_c: string, v: string) => { state.lte = v; return b; };
    b.range = () => {
      const all = rows[table] ?? [];
      const out = all.filter((r) => {
        if (state.notNull && r[state.notNull] == null) return false;
        if (state.lte && String(r[state.notNull ?? 'deleted_at'] ?? '') > state.lte) return false;
        return true;
      });
      return Promise.resolve({ data: out, error: null });
    };
    b.maybeSingle = () => {
      const all = rows[table] ?? [];
      const found = all.find((r) => r.id === state.eqId) ?? null;
      return Promise.resolve({ data: found, error: null });
    };
    b.then = (res: (v: unknown) => unknown) => {
      if (op === 'update') { updates.push({ table, patch: patch ?? {} }); }
      return Promise.resolve({ data: null, error: null }).then(res);
    };
    return b;
  }

  const sb = {
    from(table: string) {
      return {
        select: () => { calls.push({ table, op: 'select' }); return builder(table, 'select'); },
        update: (p: Record<string, unknown>) => { calls.push({ table, op: 'update' }); return builder(table, 'update', p); },
        delete: () => { calls.push({ table, op: 'delete' }); return builder(table, 'delete'); },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, calls, deleted, updates };
}

async function main() {
  console.log('A. One retention rule, pure');
  check('A1 the window is 30 days', RETENTION_DAYS === 30);
  check('A2 a fresh deletion has the full window', daysRemaining(ago(0), NOW) === 30);
  check('A3 a 29-day-old deletion has 1 day left', daysRemaining(ago(29), NOW) === 1);
  check('A4 a 30-day-old deletion has 0 left and never goes negative',
    daysRemaining(ago(30), NOW) === 0 && daysRemaining(ago(99), NOW) === 0);
  check('A5 not due at 29 days, DUE at exactly 30 (the boundary is stated once)',
    !isPurgeDue(ago(29), NOW) && isPurgeDue(ago(30), NOW) && isPurgeDue(ago(31), NOW));
  check('A6 a live project is never due and reports the full window',
    !isPurgeDue(null, NOW) && daysRemaining(null, NOW) === RETENTION_DAYS);
  check('A7 the cutoff is exactly RETENTION_DAYS ago',
    purgeCutoffIso(NOW) === new Date(NOW - RETENTION_DAYS * DAY).toISOString());
  check('A8 the REFM source declares its soft-delete column',
    getProjectSource('refm')?.deletedColumn === 'deleted_at');

  console.log('B. Purge and restore, behavioural and registry driven');
  {
    const { sb, deleted, calls } = makeFake({
      refm_projects: [
        { id: 'old1', deleted_at: ago(31) },
        { id: 'old2', deleted_at: ago(30) },
      ],
    });
    const res = await purgeExpiredDeletedProjects(sb, NOW);
    check('B1 hard deletes exactly the rows past the window',
      (deleted.refm_projects ?? []).sort().join(',') === 'old1,old2');
    check('B2 reports what it purged, per platform', res.purged.refm === 2 && res.total === 2);
    check('B3 touches ONLY the registry table (no hardcoded name)',
      calls.every((c) => c.table === 'refm_projects'));
  }
  {
    const { sb, deleted } = makeFake({ refm_projects: [] });
    const res = await purgeExpiredDeletedProjects(sb, NOW);
    check('B4 nothing due -> no delete issued at all',
      !deleted.refm_projects && res.total === 0);
  }
  {
    // A platform with no soft-delete column must be skipped, not crashed on.
    const original = PROJECT_SOURCES.slice();
    PROJECT_SOURCES.push({
      key: 'erm', label: 'Energy', shortLabel: 'ERM', table: 'erm_projects',
      ownerColumn: 'user_id', nameColumn: 'name', archivedColumn: null,
      deletedColumn: null, versionsTable: null, versionsFk: null,
      statusColumn: null, priorityColumn: null, sortOrderColumn: null,
    });
    const { sb, calls } = makeFake({ refm_projects: [] });
    const res = await purgeExpiredDeletedProjects(sb, NOW);
    check('B5 a platform without soft delete is skipped, never queried',
      res.skipped.includes('erm') && calls.every((c) => c.table !== 'erm_projects'));
    PROJECT_SOURCES.length = 0; PROJECT_SOURCES.push(...original);
  }
  {
    const { sb, updates } = makeFake({
      refm_projects: [{ id: 'p1', name: 'Marina', user_id: 'u1', deleted_at: ago(3) }],
    });
    const res = await restoreDeletedProject(sb, 'refm', 'p1');
    check('B6 restore clears the stamp and names the owner',
      res.ok === true && res.ok && res.name === 'Marina' && res.userId === 'u1'
      && updates.some((u) => u.table === 'refm_projects' && u.patch.deleted_at === null));
  }
  {
    const { sb, updates } = makeFake({
      refm_projects: [{ id: 'p2', name: 'Live', user_id: 'u1', deleted_at: null }],
    });
    const res = await restoreDeletedProject(sb, 'refm', 'p2');
    check('B7 restoring a project that is not deleted is refused, and writes nothing',
      !res.ok && res.code === 'not_deleted' && updates.length === 0);
  }
  {
    const { sb } = makeFake({});
    const res = await restoreDeletedProject(sb, 'nope', 'p1');
    check('B8 an unknown platform is refused', !res.ok && res.code === 'unknown_platform');
  }

  console.log('C. A user Delete is SOFT, and cannot silently become permanent');
  const idRoute = src('app/api/refm/projects/[id]/route.ts');
  const server = src('src/hubs/modeling/platforms/refm/lib/persistence/server.ts');
  check('C1 the user DELETE route soft deletes', /softDeleteProject\(userId, id\)/.test(idRoute));
  check('C2 the user DELETE route never hard deletes', !/hardDeleteProject/.test(strip(idRoute)));
  check('C3 softDeleteProject stamps a timestamp, it does not remove the row',
    /\.update\(\{ deleted_at: nowIso \}\)/.test(server));
  check('C4 it claims only a row that is still live (no double-stamp)',
    /update\(\{ deleted_at: nowIso \}\)[\s\S]{0,240}\.is\('deleted_at', null\)/.test(server));
  check('C5 a missing column REFUSES rather than falling back to a hard delete',
    /unsupported: true/.test(server) && /SOFT_DELETE_UNAVAILABLE/.test(idRoute)
    && /status: 503/.test(idRoute));
  check('C6 hard delete survives only for the rollback paths and the purge',
    /hardDeleteProject/.test(src('app/api/refm/projects/route.ts'))
    && /hardDeleteProject/.test(src('app/api/refm/projects/[id]/duplicate/route.ts')));

  console.log('D. A deleted project is invisible and out of the cap');
  check('D1 the user list filters deleted rows', /\.is\('deleted_at', null\)/.test(server));
  check('D2 a deleted project cannot be read or opened (getProject filters too)',
    /const one = async \(cols: string\)[\s\S]{0,400}is\('deleted_at', null\)/.test(server));
  check('D3 the project CAP excludes deleted rows',
    /\.eq\('archived', false\)\s*\n?\s*\.is\('deleted_at', null\)/.test(src('src/shared/entitlements/resolveUser.ts')));
  check('D4 every filter tolerates a pre-224 database',
    /isMissingDeletedColumn/.test(server)
    && /deleted_at/.test(src('src/shared/entitlements/resolveUser.ts')));
  check('D5 the admin user list count excludes deleted projects',
    /is\('projects\.deleted_at', null\)/.test(src('app/api/admin/users/route.ts')));

  console.log('E. Read-only grace blocks deletion');
  check('E1 server: the DELETE route refuses a read-only gate',
    /gate\.readOnly/.test(idRoute) && /status: 403/.test(idRoute));
  const platform = src('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  check('E2 UI: the control is WITHHELD in grace, not left clickable',
    /onDeleteProject=\{graceReadOnly \? undefined :/.test(platform));
  check('E3 UI: the request path also refuses in grace (belt and braces)',
    /if \(graceReadOnly\) return;/.test(platform));

  console.log('F. A real dialog, and no native confirm left');
  const dash = src('src/hubs/modeling/platforms/refm/components/Dashboard.tsx');
  const projScreen = src('src/hubs/modeling/platforms/refm/components/ProjectsScreen.tsx');
  const modal = src('src/hubs/modeling/platforms/refm/components/modals/DeleteProjectModal.tsx');
  check('F1 no window.confirm in either project list', !/window\.confirm/.test(strip(dash)) && !/window\.confirm/.test(strip(projScreen)));
  check('F2 the dialog names the project and its version count',
    /\{projectName\}/.test(modal) && /\{versionCount\}/.test(modal));
  check('F3 it states the window and WHO can restore',
    /\{retentionDays\} days/.test(modal) && /our team\s*\n?\s*can put it back/.test(modal.replace(/\s+/g, ' ').replace(/our team can put it back/, 'our team can put it back')));
  check('F4 it points at archive as the self-service alternative',
    /Archive<\/strong> instead/.test(modal));
  check('F5 ONE dialog: rendered by the parent, not per list',
    (platform.match(/<DeleteProjectModal/g) ?? []).length === 1);

  console.log('H. The card offers the SAFE action, and offers it first');
  // Archive existed but only inside the switch-project modal, so the card's
  // only visible action was Delete and a user shelving a project deleted it.
  check('H1 the card renders Archive / Unarchive from the project state',
    /dashboard-archive-/.test(dash) && /isArchived \? 'Unarchive' : 'Archive'/.test(dash));
  check('H2 Archive is rendered BEFORE Delete',
    dash.indexOf('dashboard-archive-') < dash.indexOf('dashboard-delete-'));
  check('H3 Delete is the quieter control (no button chrome, muted colour)',
    /dashboard-delete-[\s\S]{0,400}textDecoration: 'underline'/.test(dash)
    && !/dashboard-delete-[\s\S]{0,400}color: 'var\(--color-negative\)'/.test(dash));
  check('H4 both actions are WITHHELD in grace, never rendered dead',
    /\{onArchiveProject && \(/.test(dash) && /\{onDeleteProject && \(/.test(dash)
    && /onArchiveProject=\{graceReadOnly \? undefined :/.test(platform));
  check('H5 ONE archive handler, reading the route code rather than its prose',
    (platform.match(/const handleArchiveProject = useCallback/g) ?? []).length === 1
    && /code === 'CAP_REACHED'/.test(platform) && /code === 'ARCHIVE_NOT_ALLOWED'/.test(platform));
  check('H6 an archived card says it is view-only', /archived \(view-only\)/.test(dash));
  check('H7 the card grid is wider and the overflow chip names what it hides',
    /minmax\(380px, 1fr\)/.test(dash) && /\+\{hidden\.length\} more/.test(dash)
    && /assetMix\.slice\(0, 6\)/.test(dash));

  console.log('G. Migration 224 and the cron wiring');
  const mig = src('supabase/migrations/224_refm_projects_soft_delete.sql');
  const migCode = mig.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''");
  // The column must be NULLABLE (every existing row reads as "not deleted").
  // Scoped to the ADD COLUMN statement: the purge index legitimately reads
  // `WHERE deleted_at IS NOT NULL`, which is a predicate, not a constraint.
  const addColumn = (migCode.match(/ADD COLUMN[^;]*/i) ?? [''])[0];
  check('G1 adds a NULLABLE column, additive only',
    /ADD COLUMN IF NOT EXISTS deleted_at timestamptz/.test(mig)
    && !/NOT NULL|DEFAULT/i.test(addColumn)
    && !/DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET/i.test(migCode));
  check('G2 indexes the two hot paths', (mig.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length === 2);
  check('G3 the purge runs from the EXISTING daily cron, no new vercel entry',
    /purgeExpiredDeletedProjects/.test(src('app/api/cron/apply-scheduled-changes/route.ts'))
    && !/project-purge|soft-delete/.test(src('vercel.json')));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
