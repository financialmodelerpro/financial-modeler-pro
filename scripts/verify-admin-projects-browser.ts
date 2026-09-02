/**
 * scripts/verify-admin-projects-browser.ts
 *
 * Pins the 2026-08-30 rebuild of the admin Projects Browser against the real
 * per-platform project tables:
 *   A. The PROJECT_SOURCES registry is the ONE place a project table is named:
 *      the API route and every repointed reader resolve tables through it, and
 *      the REFM entry matches the real schema. With DB creds, the registry
 *      query is run LIVE and must return the real projects with version counts.
 *   B. The legacy `projects` table has NO reader or writer left anywhere in
 *      app/ or src/ (comment-stripped), the dead /api/projects CRUD route and
 *      its orphan useProject hook are gone, and migration 220 deprecates the
 *      table WITHOUT dropping it (guarded, comment-only).
 *   C. Safety of the rebuilt actions: archive/unarchive write the platform's
 *      own archived column through the registry; hard delete demands the
 *      project name typed back SERVER-SIDE and is audited; the modal arms only
 *      on an exact name match and states what the cascade destroys.
 *   D. Platform extensibility: the UI's platform filter and badges come from
 *      the API's registry-driven sources, and an unknown platform is refused.
 *
 * Run: npx tsx scripts/verify-admin-projects-browser.ts
 *      (add --env-file=.env.local for the live section)
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_SOURCES, getProjectSource } from '../src/shared/admin/projectSources';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

async function main() {
  const route = src('app/api/admin/projects/route.ts');
  const routeCode = strip(route);
  const browser = src('src/components/admin/ProjectsBrowser.tsx');
  const registry = src('src/shared/admin/projectSources.ts');

  console.log('A. Registry is the one place a table is named');
  const refm = getProjectSource('refm');
  check('A1 refm entry matches the real schema',
    !!refm && refm.table === 'refm_projects' && refm.archivedColumn === 'archived'
    && refm.versionsTable === 'refm_project_versions' && refm.versionsFk === 'project_id'
    && refm.ownerColumn === 'user_id');
  check('A2 the route names NO project table of its own (resolves via the registry)',
    !routeCode.includes("'refm_projects'") && routeCode.includes('PROJECT_SOURCES')
    && /from\(source\.table\)/.test(routeCode));
  // THE OWNER EMBED MUST NAME THE COLUMN IT TRAVELS. Migration 231 added
  // refm_project_members, a two-FK junction between refm_projects and users,
  // which made a bare `users(...)` embed ambiguous: PostgREST answered
  // HTTP 300 PGRST201 and the entire Projects Browser went blank in production
  // with every project present. No code here had changed; a new TABLE broke a
  // query that had been correct for months. The hint must come from the
  // SOURCE'S OWN ownerColumn so ERM and BVM are disambiguated by their own
  // declaration rather than by a constraint name that only fits REFM.
  check('A2b the owner embed names its FK column, so a junction table cannot break it',
    /users!\$\{source\.ownerColumn\}\(/.test(routeCode));
  check('A2c no BARE users( embed survives in the route',
    !/(?<![!\w.])users\s*\(/.test(routeCode));
  check('A3 registry is pure data (no supabase import, client-safe)',
    !/@supabase|supabase-js|getServerClient/.test(registry));
  check('A4 CMS stat and profile count are registry-driven',
    strip(src('app/admin/cms/page.tsx')).includes('PROJECT_SOURCES')
    && strip(src('app/api/user/profile/route.ts')).includes('PROJECT_SOURCES'));

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && refm) {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from(refm.table)
      .select(`id, ${refm.nameColumn}, ${refm.ownerColumn}, ${refm.archivedColumn}, created_at, updated_at, users!${refm.ownerColumn}(email, name)`)
      .range(0, 199);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    check('A5 LIVE: the registry-driven list query works and returns real projects',
      !error && rows.length > 0, error?.message);
    const withOwner = rows.filter((r) => (r.users as { email?: string } | null)?.email);
    check('A6 LIVE: the owner embed resolves through the FK for every row',
      rows.length > 0 && withOwner.length === rows.length);
    let vc = 0;
    if (rows.length > 0) {
      const { count } = await sb.from(refm.versionsTable!).select('id', { count: 'exact', head: true }).eq(refm.versionsFk!, rows[0].id as string);
      vc = count ?? 0;
    }
    check('A7 LIVE: version counts resolve (first project has at least one version)', vc > 0);
  } else {
    console.log('  SKIP A5-A7 (no DB creds; run with --env-file=.env.local)');
  }

  console.log('B. The legacy table is dead code nowhere');
  const offenders: string[] = [];
  for (const dir of ['app', 'src']) {
    for (const f of walk(path.join(ROOT, dir))) {
      const code = strip(fs.readFileSync(f, 'utf8'));
      if (/from\((['"`])projects\1\)/.test(code)) offenders.push(path.relative(ROOT, f));
    }
  }
  check('B1 no from(\'projects\') reader or writer anywhere in app/ or src/',
    offenders.length === 0, offenders.join(', '));
  check('B2 the dead /api/projects CRUD route is gone', !exists('app/api/projects/route.ts'));
  check('B3 the orphan useProject hook is gone', !exists('src/shared/hooks/useProject.ts'));
  const mig = src('supabase/migrations/220_deprecate_legacy_projects.sql');
  // Strip SQL comments AND string literals: the deprecation notice itself
  // contains words like "dropped", which must not trip the statement scan.
  const migCode = mig.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''");
  check('B4 migration 220 deprecates WITHOUT dropping (comment-only, guarded)',
    /COMMENT ON TABLE public\.projects/.test(migCode)
    && /IF EXISTS/.test(migCode)
    && !/\bDROP\b/i.test(migCode)
    && !/\b(DELETE|TRUNCATE|UPDATE|ALTER)\b/i.test(migCode));

  console.log('C. Action safety');
  check('C1 archive/unarchive write the platform\'s own archived column via the registry',
    /\[source\.archivedColumn\]: body\.action === 'archive'/.test(route));
  check('C2 a source with no archive concept is refused, not faked',
    /if \(!source\.archivedColumn\)/.test(route));
  check('C3 hard delete demands the project name SERVER-SIDE',
    /\(body\.confirmName \?\? ''\) !== project\.name/.test(route)
    && route.includes('confirm_mismatch'));
  check('C4 all three mutations are audited with platform and name',
    /action: body\.action === 'archive' \? 'archive_project' : 'unarchive_project'/.test(route)
    && /action: 'delete_project'/.test(route)
    && (route.match(/afterValue: \{ platform: source\.key, project_id: project\.id, name: project\.name \}/g) ?? []).length === 2);
  check('C5 modal arms only on an exact name match and names the cascade',
    /confirmName === deleteTarget\.name/.test(browser)
    && /change history, report decks, fund terms and parties/.test(browser)
    && /It cannot be undone/.test(browser));
  check('C6 unknown platform refused on both mutations',
    (route.match(/getProjectSource\(body\.platform \?\? ''\)/g) ?? []).length === 2
    && /Unknown platform/.test(route));

  console.log('D. Platform extensibility');
  check('D1 GET returns the source list for the UI (registry-driven filter)',
    /sources: PROJECT_SOURCES\.map/.test(route));
  check('D2 GET supports ?platform= filtering and refuses unknown keys',
    /searchParams\.get\('platform'\)/.test(route) && /Unknown platform "\$\{platform\}"/.test(route));
  check('D3 UI platform filter and badges read the API sources, no hardcoded platform',
    /sources\.map\(\(s\) => <option/.test(browser)
    && /\{p\.platformLabel\}/.test(browser)
    && !strip(browser).includes("'refm_projects'"));
  check('D4 rows are keyed per platform so two platforms cannot collide',
    /key=\{`\$\{p\.platform\}:\$\{p\.id\}`\}/.test(browser));
  check('D5 a source read failure degrades to a note, never a broken browser',
    /sourceErrors/.test(route) && /sourceErrors/.test(browser));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
