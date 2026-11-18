/**
 * verify-formula-export-gate.ts (2026-09-27; RE-AIMED 2026-11-17 when the founder opened the live workbook as a Beta)
 *
 * THE LIVE (FORMULA-LINKED) WORKBOOK IS A PLAN ENTITLEMENT, AND THE SERVER ENFORCES IT. 2026-11-17, founder: "The
 * live workbook download is gated by featureAllowed('excel_formula'): Pro and Firm only, Trial excluded." The
 * one-account preview list is gone (formulaExportAccess.ts said it would be deleted, not extended, when opened up).
 *
 *   G1  the decision is the entitlement: the gate reads featureAllowed(gate, 'excel_formula') through the live user
 *       gate and keeps no list of accounts; a plan with and without the feature passes and fails.
 *   G2  LIVE, over the real users table: a user passes exactly when the gate opens excel_formula for them; no trial
 *       or solo user passes unless the gate grants full access (an admin).
 *   G3  the route refuses BEFORE it reads anything about a project; a refusal is the 404 a missing project gives.
 *   G4  the GET that tells the dialog whether to show the option reads nothing but the decision.
 *   G5  called with no session, GET answers allowed:false and POST refuses; both run the real handlers.
 *   G6  the gate is the route's alone and no browser module imports the live build directly; the values file the
 *       browser makes from the same build holds no formula (RE-AIMED 2026-11-17: the values file IS the live
 *       layout frozen to its values, founder: "only the difference: values instead of formulas").
 *   G7  the dialog shows the option only on the server's answer, labelled Beta with a link to report an issue.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-formula-export-gate.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { formulaExportAllowed, FORMULA_EXPORT_FEATURE } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaExportAccess';
import { featureAllowed } from '../src/shared/entitlements/gate';
import { resolveUserGate } from '../src/shared/entitlements/resolveUser';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? `\n        ${detail}` : ''}`); }
}
const ROUTE = 'app/api/refm/projects/[id]/export/formula-workbook/route.ts';
const MODAL = 'src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx';
const ACCESS = 'src/hubs/modeling/platforms/refm/lib/excel/formulaExportAccess.ts';
const VALUES = 'src/hubs/modeling/platforms/refm/lib/excel/valuesWorkbook.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

(async () => {
  console.log('=== G1. The decision is the entitlement ===');
  const access = readFileSync(ACCESS, 'utf8');
  const code = access.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('G1a the feature is excel_formula', FORMULA_EXPORT_FEATURE === 'excel_formula');
  check('G1b the gate reads featureAllowed over the live user gate, and keeps no list of accounts',
    /resolveUserGate\(/.test(code) && /featureAllowed\(gate, FORMULA_EXPORT_FEATURE\)/.test(code) && !/@[a-z0-9-]+\.[a-z]{2,}/i.test(code));
  const plan = (included: boolean): { fullAccess: boolean; featureMap: never } => ({ fullAccess: false, featureMap: { excel_formula: { included } } as never });
  check('G1c a plan with the feature passes, one without it does not', featureAllowed(plan(true), 'excel_formula') && !featureAllowed(plan(false), 'excel_formula'));
  check('G1d no user is never a pass', !(await formulaExportAllowed(null)) && !(await formulaExportAllowed(undefined)));

  console.log('\n=== G2. Live, over the users table ===');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    check('G2 needs credentials (run with --env-file=.env.local)', false);
  } else {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: pp } = await sb.from('plan_permissions').select('plan_key, included').eq('feature_key', 'excel_formula');
    const opens = ((pp ?? []) as Array<{ plan_key: string; included: boolean }>).filter((x) => x.included).map((x) => x.plan_key);
    check('G2a no trial or solo plan opens excel_formula', !opens.includes('trial') && !opens.includes('solo'), opens.join(', '));
    const { data: us } = await sb.from('users').select('id').limit(150);
    const users = (us ?? []) as Array<{ id: string }>;
    const wrong: string[] = [];
    let passes = 0;
    for (const u of users) {
      const gate = await resolveUserGate(u.id, { sessionIsAdmin: false });
      const ok = await formulaExportAllowed(u.id);
      if (ok !== featureAllowed(gate, 'excel_formula')) wrong.push(u.id);
      if (ok) passes++;
    }
    check(`G2b of ${users.length} users, each passes exactly when the gate opens excel_formula (${passes} pass; plans opening it: ${opens.join(', ') || 'none until migration 257 is applied'})`,
      users.length > 1 && wrong.length === 0, wrong.slice(0, 5).join(', '));
    check('G2c an unknown user id is refused', !(await formulaExportAllowed('00000000-0000-0000-0000-000000000000')));
  }

  console.log('\n=== G3/G4. The route, in order ===');
  const src = readFileSync(ROUTE, 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  const gateAt = post.indexOf('formulaExportAllowed(');
  const reads = ['getProjectForAction(', 'getVersionById(', 'getLatestVersion(', 'listParties(', 'savedVersionInputs(', 'generateLiveWorkbook('];
  const early = reads.filter((r) => { const at = post.indexOf(r); return at < 0 || at < gateAt; });
  check('G3 POST checks the entitlement before every project, version and party read and before the build', gateAt > 0 && early.length === 0, `before the gate or missing: ${early.join(', ')}`);
  check('G3b a refusal is the same 404 a missing project gives (it reveals nothing)', /if \(!\(await formulaExportAllowed\(userId, isAdmin\)\)\) return notFound\(\);/.test(post));
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'));
  check('G4 GET reads nothing but the decision', get.includes('formulaExportAllowed(') && !reads.some((r) => get.includes(r)));

  console.log('\n=== G5. The real handlers, called with no session ===');
  const route = await import(`../${ROUTE}`) as { GET: () => Promise<Response>; POST: (req: unknown, ctx: unknown) => Promise<Response> };
  const g = await route.GET();
  const gj = await g.json() as { allowed?: boolean };
  check('G5a GET with no session answers allowed:false', g.status === 200 && gj.allowed === false, `${g.status} ${JSON.stringify(gj)}`);
  const p = await route.POST(new Request('http://x/', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: 'c417fc6a-4514-4438-857c-a72dc7472f65' }) });
  check('G5b POST with no session is refused and returns no workbook', p.status === 401 && !(p.headers.get('Content-Type') ?? '').includes('spreadsheet'), `status ${p.status}`);

  console.log("\n=== G6. The gate is the route's, and the browser's file holds no formula ===");
  const files = [...walk('app'), ...walk('src')];
  const gateUsers = files.filter((x) => /from ['"][^'"]*excel\/formulaExportAccess['"]/.test(readFileSync(x, 'utf8')));
  check('G6a only the route imports the entitlement gate', gateUsers.length === 1 && gateUsers[0] === ROUTE, gateUsers.join(', '));
  const BUILD = /from ['"][^'"]*(excel\/formulaWorkbook|excel\/liveLayers\/)['"]/;
  const clientish = files.filter((x) => (x.endsWith('.tsx') || readFileSync(x, 'utf8').startsWith("'use client'")) && BUILD.test(readFileSync(x, 'utf8')));
  check('G6b no .tsx or client module imports the live build directly', clientish.length === 0, clientish.join(', '));
  const vw = readFileSync(VALUES, 'utf8');
  const frozen = vw.slice(vw.indexOf('export function frozenLiveWorkbook'), vw.indexOf('export function buildValuesWorkbook'));
  // A BEHAVIOUR, NOT A SHAPE (2026-11-18): the freeze moved into freezeFormulas, which this check had pinned as
  // inline code. Run it on a workbook of formulas and require that none survives, and that the frozen live build
  // goes through it.
  const { freezeFormulas } = await import('../src/hubs/modeling/platforms/refm/lib/excel/valuesWorkbook');
  const ExcelJSmod = (await import('exceljs')).default;
  const twb = new ExcelJSmod.Workbook();
  const tws = twb.addWorksheet('T');
  tws.getCell('A1').value = 2;
  tws.getCell('B1').value = { formula: 'A1*2', result: 4 } as never;
  tws.getCell('C1').value = { formula: 'B1+1', result: 5 } as never;
  freezeFormulas(twb);
  let left = 0;
  tws.eachRow((r) => r.eachCell((c) => { const v = c.value as unknown; if (v && typeof v === 'object' && 'formula' in (v as object)) left++; }));
  check('G6c the values file freezes every formula of the live build before it leaves, and the dialog never builds the live file',
    left === 0 && tws.getCell('B1').value === 4 && tws.getCell('C1').value === 5
    && /freezeFormulas\(wb\)/.test(frozen) && !/generateLiveWorkbook/.test(readFileSync(MODAL, 'utf8')),
    `${left} formulas left; B1 ${String(tws.getCell('B1').value)}`);

  console.log("\n=== G7. The dialog shows it only on the server's answer ===");
  const m = readFileSync(MODAL, 'utf8');
  check("G7a the option renders only under the server's answer", /\{formulaAllowed && \(\s*<button[\s\S]{0,200}export-option-excel-live/.test(m));
  const sets = [...m.matchAll(/setFormulaAllowed\(([^)]*\)?)\)/g)].map((x) => x[1]);
  check("G7b the answer is set only from the route's reply, or to false", sets.length > 0 && sets.every((x) => x === 'false' || x.includes('j?.allowed === true')), sets.join(' | '));
  check('G7c the dialog asks the route on open', m.includes("/export/formula-workbook`, { cache: 'no-store' }"));
  check('G7d the dialog shows the section picker for the PDF and the hardcoded Excel only', m.includes(`{(reportKind === 'full' || reportKind === 'excel') && (\n              <div data-testid="export-groups"`));
  check('G7e the live route reads no section filter', !/\bparts\b/.test(src));
  check('G7f the option is labelled Beta, with a link to report an issue', /data-testid="export-live-beta"[^>]*>Beta</.test(m) && /data-testid="export-live-report"[\s\S]{0,300}>Report an issue</.test(m));

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
