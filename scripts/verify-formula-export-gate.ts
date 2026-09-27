/**
 * verify-formula-export-gate.ts (2026-09-27)
 *
 * THE FORMULA-LINKED WORKBOOK IS A PREVIEW FOR ONE ACCOUNT, AND THE SERVER
 * ENFORCES IT (founder's decision). What must hold while it is built:
 *
 *   G1  the decision: the preview account passes (any case), nobody else, and
 *       an absent email never does.
 *   G2  LIVE, over the real users table: exactly the preview account passes,
 *       every other user is refused through the same function the route calls.
 *   G3  the route refuses BEFORE it reads anything about a project: the
 *       preview check precedes every project, version, party and plan read.
 *   G4  the GET that tells the dialog whether to show the option reads nothing
 *       but the preview decision.
 *   G5  called with no session (as a stranger would be), GET answers
 *       allowed:false and POST refuses; both run the real handlers.
 *   G6  the workbook's build code is reachable from the ROUTE and never from a
 *       browser component, so the capability does not ship to anyone else.
 *   G7  the dialog shows the option only on the server's answer.
 *
 * When the founder opens it up this becomes a plan entitlement and G1/G2 are
 * replaced by the entitlement's own checks; see formulaExportAccess.ts.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-formula-export-gate.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { formulaExportAllowedFor, formulaExportAllowed, FORMULA_EXPORT_PREVIEW_EMAILS } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaExportAccess';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? `\n        ${detail}` : ''}`); }
}
const ROUTE = 'app/api/refm/projects/[id]/export/formula-workbook/route.ts';
const MODAL = 'src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

(async () => {
  console.log('=== G1. The decision ===');
  check('G1a the preview list is exactly one account', FORMULA_EXPORT_PREVIEW_EMAILS.length === 1, JSON.stringify(FORMULA_EXPORT_PREVIEW_EMAILS));
  const owner = FORMULA_EXPORT_PREVIEW_EMAILS[0];
  check('G1b the preview account passes, in any case and with stray spaces', formulaExportAllowedFor(owner) && formulaExportAllowedFor(` ${owner.toUpperCase()} `));
  check('G1c anybody else is refused, including a lookalike', !formulaExportAllowedFor('someone@example.com') && !formulaExportAllowedFor(`x${owner}`) && !formulaExportAllowedFor(`${owner}.evil.com`));
  check('G1d no email is never a pass', !formulaExportAllowedFor(null) && !formulaExportAllowedFor(undefined) && !formulaExportAllowedFor(''));

  console.log('\n=== G2. Live, over the users table ===');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    check('G2 needs credentials (run with --env-file=.env.local)', false);
  } else {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const users: Array<{ id: string; email: string | null }> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('users').select('id, email').range(from, from + 999);
      if (error) { check('G2 users read', false, error.message); break; }
      users.push(...((data ?? []) as typeof users));
      if (!data || data.length < 1000) break;
    }
    const passes: string[] = [];
    for (const u of users) if (await formulaExportAllowed(u.id)) passes.push(u.email ?? u.id);
    check(`G2a of ${users.length} users, exactly one passes the route's own check, and it is the preview account`,
      users.length > 1 && passes.length === 1 && formulaExportAllowedFor(passes[0]), `passes: ${passes.join(', ')}`);
    check('G2b an unknown user id and no user id are refused', !(await formulaExportAllowed('00000000-0000-0000-0000-000000000000')) && !(await formulaExportAllowed(null)));
  }

  console.log('\n=== G3/G4. The route, in order ===');
  const src = readFileSync(ROUTE, 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  const gateAt = post.indexOf('formulaExportAllowed(');
  const reads = ['getProjectForAction(', 'getVersionById(', 'getLatestVersion(', 'listParties(', 'resolveUserGate(', 'savedVersionInputs(', 'generateFormulaWorkbookBuffer('];
  const early = reads.filter((r) => { const at = post.indexOf(r); return at < 0 || at < gateAt; });
  check('G3 POST checks the preview account before every project, version, party and plan read', gateAt > 0 && early.length === 0, `before the gate or missing: ${early.join(', ')}`);
  check('G3b a refusal is the same 404 a missing project gives (it reveals nothing)', /if \(!\(await formulaExportAllowed\(userId\)\)\) return notFound\(\);/.test(post));
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'));
  check('G4 GET reads nothing but the preview decision', get.includes('formulaExportAllowed(') && !reads.some((r) => get.includes(r)));

  console.log('\n=== G5. The real handlers, called with no session ===');
  const route = await import(`../${ROUTE}`) as { GET: () => Promise<Response>; POST: (req: unknown, ctx: unknown) => Promise<Response> };
  const g = await route.GET();
  const gj = await g.json() as { allowed?: boolean };
  check('G5a GET with no session answers allowed:false', g.status === 200 && gj.allowed === false, `${g.status} ${JSON.stringify(gj)}`);
  const p = await route.POST(new Request('http://x/', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: 'c417fc6a-4514-4438-857c-a72dc7472f65' }) });
  check('G5b POST with no session is refused and returns no workbook', p.status === 401 && !(p.headers.get('Content-Type') ?? '').includes('spreadsheet'), `status ${p.status}`);

  console.log('\n=== G6. The build code never reaches a browser component ===');
  const files = [...walk('app'), ...walk('src')];
  const BUILD = /from ['"][^'"]*(excel\/formulaWorkbook|excel\/liveLayers\/|excel\/formulaExportAccess)['"]/;
  const importers = files.filter((f) => BUILD.test(readFileSync(f, 'utf8')));
  const allowedImporter = (f: string): boolean => f === ROUTE || /\/lib\/excel\/(formulaWorkbook|liveLayers\/)/.test(f);
  const bad = importers.filter((f) => !allowedImporter(f));
  check('G6 only the route (and the builder\'s own files) import the formula workbook or its gate', importers.includes(ROUTE) && bad.length === 0, bad.join(', '));
  const clientish = importers.filter((f) => f.endsWith('.tsx') || readFileSync(f, 'utf8').startsWith("'use client'"));
  check('G6b no .tsx or client module imports them', clientish.length === 0, clientish.join(', '));

  console.log('\n=== G7. The dialog shows it only on the server\'s answer ===');
  const m = readFileSync(MODAL, 'utf8');
  check('G7a the option renders only under the server\'s answer', /\{formulaAllowed && \(\s*<button[\s\S]{0,200}export-option-excel-live/.test(m));
  const sets = [...m.matchAll(/setFormulaAllowed\(([^)]*\)?)\)/g)].map((x) => x[1]);
  check('G7b the answer is set only from the route\'s reply, or to false', sets.length > 0 && sets.every((x) => x === 'false' || x.includes("j?.allowed === true")), sets.join(' | '));
  check('G7c the dialog asks the route on open', m.includes('/export/formula-workbook`, { cache: \'no-store\' }'));

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
