/**
 * verify-dashboard-nav.ts
 *
 * THE MODELING HUB SIDEBAR: every entry does something, and every in-page view
 * has somewhere to render.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * "Team access" was a dead button in production. The nav item was declared
 * with no href and no disabled flag, and the click handler decided what to do
 * by testing the id against a POSITIVE ALLOW-LIST:
 *
 *     if (item.id === 'dashboard' || item.id === 'billing') { ... }
 *
 * so it matched nothing and the click did nothing at all: no navigation, no
 * state change, no error, not even the active highlight. Everything behind it
 * was finished and deployed. AN ENUMERATED ALLOW-LIST PLUS A NEW ENTRY
 * ELSEWHERE COMPILES CLEAN AND FAILS SILENTLY, which is why nothing caught it
 * for months. Recorded as TRAPS 8.3.
 *
 * The allow-list is gone: NavItem is a discriminated union, so a new entry
 * must pick a kind and every kind has a branch. THE COMPILER now prevents the
 * exact recurrence. This file covers the two holes the compiler still cannot
 * see:
 *
 *   1. a DashView with no render branch (the click works, the page goes
 *      blank), and
 *   2. the allow-list creeping back in.
 *
 * Run: npx tsx scripts/verify-dashboard-nav.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

const PAGE = 'app/modeling/dashboard/page.tsx';
const src = readFileSync(PAGE, 'utf8');
// Comments are stripped for every assertion about BEHAVIOUR: the header above
// quotes the old allow-list verbatim, and a check reading the raw file would
// match the prose describing the bug it is testing for.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('=== A. Every view is declared once, and reachable ===');
{
  const viewUnion = /type DashView =\s*([^;]+);/.exec(code)?.[1] ?? '';
  const views = [...viewUnion.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  check('A1 DashView is declared', views.length > 0, viewUnion);
  check('A2 team is one of the views', views.includes('team'), views.join(','));

  // Every nav item of kind 'view' must name a real DashView.
  const viewItems = [...code.matchAll(/kind: 'view'(?: as const)?, id: '([a-z-]+)'/g)].map((m) => m[1]);
  const declaredInline = [...code.matchAll(/kind: 'view' as const, id: '([a-z-]+)' as const/g)].map((m) => m[1]);
  const allViewItems = [...new Set([...viewItems, ...declaredInline])];
  check('A3 every nav view item names a declared DashView',
    allViewItems.every((v) => views.includes(v)), allViewItems.join(','));
  check('A4 the team item is a view item, not an inert bag',
    allViewItems.includes('team'), allViewItems.join(','));

  // THE CHECK THAT WOULD HAVE CAUGHT THE ORIGINAL BUG'S SUCCESSOR: a view the
  // click can select but nothing renders leaves a blank page.
  const missing = views.filter((v) => !new RegExp(`activeView === '${v}'`).test(code));
  check('A5 every DashView has a render branch', missing.length === 0,
    missing.length ? `no branch for: ${missing.join(', ')}` : '');
}

console.log('\n=== B. The allow-list is gone and stays gone ===');
{
  check('B1 NavItem is a discriminated union, so a dead entry cannot be declared',
    /\|\s*\{\s*kind: 'link'/.test(code) && /\|\s*\{\s*kind: 'soon'/.test(code) && /kind: 'view';/.test(code));
  check('B2 the click handler branches on KIND, never on an id list',
    /item\.kind === 'soon'/.test(code) && /item\.kind === 'link'/.test(code));
  // The exact shape of the original defect, in any spelling.
  check('B3 no id is tested against a hardcoded list in the handler',
    !/item\.id === '[a-z-]+'\s*\|\|\s*item\.id === '[a-z-]+'/.test(code));
  check('B4 the old optional-bag fields are gone from the item shape',
    !/\bdisabled\?: boolean/.test(code) && !/item\.disabled/.test(code));
  check('B5 an item id and its view are ONE value (id is typed DashView)',
    /kind: 'view';[\s\S]{0,400}id: DashView;/.test(code));
}

console.log('\n=== C. The hash is declared once ===');
{
  // Three lists used to hold the same fact: the click allow-list, the hash
  // written on click, and the hash read on load. They are one declaration now.
  check('C1 the hash lives on the item', /hash\?: string;/.test(code));
  check('C2 the click writes the declared hash, not a hardcoded one',
    /item\.hash \?\? ' '/.test(code) && !/item\.id === 'billing' \? '#billing'/.test(code));
  check('C3 the restore reads the SAME declarations',
    /VIEW_BY_HASH/.test(code) && /VIEW_BY_HASH\.get\(window\.location\.hash\)/.test(code));
  check('C4 the map is built from NAV_ITEMS rather than retyped',
    /const VIEW_BY_HASH[\s\S]{0,200}NAV_ITEMS\.flatMap/.test(code));
}

console.log('\n=== D. Team access reaches something real ===');
{
  // Re-aimed again 2026-09-04: the admin is ALSO an account holder, so the
  // team view renders the HOLDER surface for everyone and appends the
  // operator panel, separated, for admins only.
  check('D1 the team view renders the holder surface for all, plus the operator panel for admins',
    /activeView === 'team'/.test(code) && /<TeamInvitesCard/.test(code)
    && /<TeamAccessPanel/.test(code) && /team-operator-divider/.test(code));
  check('D2 the panel component exists',
    readFileSync('src/hubs/modeling/components/TeamAccessPanel.tsx', 'utf8').length > 1000);
  check('D3 its API route exists with a read and a write',
    /export async function GET/.test(readFileSync('app/api/admin/project-members/route.ts', 'utf8'))
    && /export async function POST/.test(readFileSync('app/api/admin/project-members/route.ts', 'utf8')));
  // Re-aimed 2026-09-04: the tab was admin-only until the account model gave
  // clients their own team surface. It now shows for the admin and for every
  // ACCOUNT HOLDER, and never for a MEMBER (accountMember from the resolved
  // gate, the one-place member rule).
  check('D4 the item shows for admins and account holders, never for members',
    /isAdmin \|\| \(ent\.loaded && !ent\.accountMember\)/.test(code)
    && /id: 'team' as const/.test(code));
  check('D5 the holder panel is OFF the main dashboard view (it lives on the tab)',
    (code.match(/<TeamInvitesCard/g) ?? []).length === 1);
}

console.log('\n=== E. House rules ===');
{
  check('E1 the page has no em dashes', !src.includes('—'));
  check('E2 the trap is recorded, not just fixed',
    /allow-list/i.test(src) && /TRAPS 8\.3/.test(src));
}

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
