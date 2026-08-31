/**
 * scripts/verify-admin-users-cleanup.ts
 *
 * Pins the 2026-08-30 admin user-management cleanup:
 *   A. The PROJECTS count reads refm_projects (the table projects actually
 *      live in), aliased so the client shape is unchanged; the dead legacy
 *      `projects` embed is gone. With DB creds, the embed is also run LIVE and
 *      checked against a direct refm_projects count per user (self-consistent,
 *      no hardcoded numbers).
 *   B. The Projects button opens the read-only per-user modal; the modal and
 *      its endpoint have NO write path (an admin does not open or edit a
 *      user's model from here).
 *   C. The duplicate badges beside the PLAN and STATUS dropdowns are gone, and
 *      the ACCESS column renders only when a row genuinely diverges from
 *      STATUS (date-driven grace / lapsed, or the durable cancel marker).
 *   D. The lockdown banner is driven by the LIVE mig-136 flags, never static.
 *   E. The never-asked real estate dash keeps its tooltip, discoverably.
 *
 * Run: npx tsx scripts/verify-admin-users-cleanup.ts
 *      (add --env-file=.env.local to include the live-embed section)
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function main() {
  const api = src('app/api/admin/users/route.ts');
  const page = src('app/admin/users/page.tsx');
  const modal = src('src/components/admin/UserProjectsModal.tsx');
  const projRoute = src('app/api/admin/users/[id]/projects/route.ts');
  // Absence assertions run against COMMENT-STRIPPED source (TRAPS: a comment
  // explaining what was removed must not read as the thing still existing).
  const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const apiCode = strip(api);
  const pageCode = strip(page);

  console.log('A. Project count source');
  check('A1 count embeds refm_projects aliased to projects',
    api.includes('projects:refm_projects(count)'));
  check('A2 the legacy bare projects(count) embed is gone',
    !/(?<![:\w])projects\(count\)/.test(apiCode));
  check('A3 page still reads the aliased shape', /u\.projects\?\.\[0\]\?\.count/.test(page));

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.from('users').select('id, email, projects:refm_projects(count)').range(0, 999);
    const { data: rp } = await sb.from('refm_projects').select('user_id').range(0, 4999);
    const direct = new Map<string, number>();
    for (const p of (rp ?? []) as Array<{ user_id: string }>) direct.set(p.user_id, (direct.get(p.user_id) ?? 0) + 1);
    let mismatches = 0; let nonZero = 0;
    for (const u of (data ?? []) as unknown as Array<{ id: string; projects?: [{ count: number }] }>) {
      const embedded = u.projects?.[0]?.count ?? 0;
      if (embedded !== (direct.get(u.id) ?? 0)) mismatches++;
      if (embedded > 0) nonZero++;
    }
    check('A4 LIVE: embed count equals a direct refm_projects count for every user',
      !error && mismatches === 0, error?.message ?? `${mismatches} mismatches`);
    check('A5 LIVE: at least one user shows a non-zero count (the reported defect)',
      nonZero > 0);
  } else {
    console.log('  SKIP A4/A5 (no DB creds; run with --env-file=.env.local)');
  }

  console.log('B. Read-only projects view');
  check('B1 Projects button opens the modal, not the dead /admin/projects link',
    /setProjectsTarget\(\{ id: u\.id, email: u\.email \}\)/.test(page)
    && !pageCode.includes('/admin/projects?userId='));
  check('B2 modal fetches the per-user endpoint', modal.includes('/api/admin/users/${userId}/projects'));
  check('B3 modal shows name, created, last modified, versions',
    /'Name', 'Created', 'Last modified', 'Versions'/.test(modal));
  check('B4 modal has NO write call (read-only)',
    !/method:\s*'(POST|DELETE|PATCH|PUT)'/.test(modal));
  check('B5 endpoint exports GET only',
    /export async function GET/.test(projRoute)
    && !/export async function (POST|DELETE|PATCH|PUT)/.test(projRoute));
  check('B6 endpoint is admin-guarded', /role[^\n]*!== 'admin'/.test(projRoute));
  check('B7 endpoint returns no snapshot content (shallow select)',
    /select\('id, name, archived, created_at, updated_at'\)/.test(projRoute));

  console.log('C. Duplicate columns');
  check('C1 PlanBadge is gone (definition and use)', !/PlanBadge/.test(page.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('C2 StatusBadge is gone (definition and use)', !/\bStatusBadge\b/.test(page.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('C3 Access column renders only when a row diverges',
    /const showAccessCol = users\.some\(accessDiverges\)/.test(page)
    && /\.\.\.\(showAccessCol \? \['Access'\] : \[\]\)/.test(page)
    && /\{showAccessCol && \(\s*<td/.test(page));
  check('C4 divergence = date-driven grace/lapsed or the cancel marker',
    /u\.lapseState === 'grace' \|\| u\.lapseState === 'lapsed'\) \|\| !!u\.cancelState/.test(page));
  check('C5 colSpan follows the column count', /colSpan=\{colCount\}/.test(page) && !/colSpan=\{11\}/.test(page));

  console.log('D. Lockdown banner');
  check('D1 banner gated on the live flags, both surfaces',
    /lockdown && \(lockdown\.signin \|\| lockdown\.register\)/.test(page));
  check('D2 flags come from the same routes the auth pages enforce',
    page.includes('/api/admin/modeling-signin-coming-soon') && page.includes('/api/admin/modeling-register-coming-soon'));
  check('D3 the static pre-launch claim is gone from the rendered copy',
    !page.includes('is in pre-launch lockdown'));

  console.log('E. Never-asked dash');
  // THE STATE, NOT THE SENTENCE. This pinned the tooltip's exact wording and
  // went red on 2026-08-30 when the signup question widened to "real estate /
  // hospitality". Nothing was broken: a copy edit failed a check about
  // behaviour. What must hold is that the never-asked dash still EXPLAINS
  // itself, so an admin cannot read it as "no".
  check('E1 dash keeps a tooltip naming the never-asked state',
    /title="Never asked:[^"]{10,}"/.test(page), (page.match(/title="Never asked:[^"]*"/) ?? ['none'])[0]);
  check('E2 tooltip is discoverable (help cursor)',
    /cursor: 'help'[^}]*borderBottom: '1px dotted/.test(page));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
