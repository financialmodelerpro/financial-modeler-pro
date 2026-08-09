/**
 * verify-launch-banner.ts
 *
 * Pins the launch countdown banner:
 *  - the SHOW/HIDE rule is the date alone (unset / unparseable / past all hide,
 *    future shows), tested on both sides of the boundary with an injected clock
 *    rather than the real one;
 *  - the path allowlist covers exactly the five target pages and matches them
 *    EXACTLY, so the banner cannot leak onto the workspace, admin, or a deeper
 *    route under one of them;
 *  - dismissal is keyed on the launch date, so it survives the session but a
 *    changed date is a new announcement;
 *  - the wiring: server component reads the admin key, client half is the only
 *    thing that touches storage, it is mounted once in the root layout, and the
 *    admin page can edit the key the banner reads.
 *
 * Run: npx tsx scripts/verify-launch-banner.ts
 */
import fs from 'fs';
import path from 'path';
import {
  LAUNCH_DATE_KEY, LAUNCH_BANNER_PATHS,
  isLaunchBannerPath, launchDismissKey, resolveLaunchCountdown,
} from '../src/hubs/main/components/launch/launchCountdown';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const NOW = Date.parse('2026-08-09T12:00:00.000Z');
const future = '2026-08-20T05:00:00.000Z';
const past = '2026-04-22T07:00:00.000Z';

console.log('=== 1. Show only before the launch date ===');
{
  const r = resolveLaunchCountdown({ launchDate: future, nowMs: NOW });
  check('a future launch date SHOWS', r.show === true && r.reason === 'ok');
  check('and carries the normalized ISO instant', r.targetIso === future, r.targetIso);

  const p = resolveLaunchCountdown({ launchDate: past, nowMs: NOW });
  check('a past launch date is HIDDEN', p.show === false && p.reason === 'already_launched');

  // The boundary, both sides, one millisecond apart.
  const t = Date.parse(future);
  check('one ms BEFORE the instant still shows',
    resolveLaunchCountdown({ launchDate: future, nowMs: t - 1 }).show === true);
  check('AT the exact instant it is hidden (the hub is live, not counting down)',
    resolveLaunchCountdown({ launchDate: future, nowMs: t }).show === false);
  check('one ms AFTER the instant it is hidden',
    resolveLaunchCountdown({ launchDate: future, nowMs: t + 1 }).show === false);
}

console.log('\n=== 2. Missing or malformed settings never render ===');
{
  for (const [label, value] of [['null', null], ['undefined', undefined], ['empty', ''], ['whitespace', '   ']] as const) {
    const r = resolveLaunchCountdown({ launchDate: value, nowMs: NOW });
    check(`a ${label} launch date is hidden (reason not_set)`, r.show === false && r.reason === 'not_set');
  }
  const bad = resolveLaunchCountdown({ launchDate: 'not a date', nowMs: NOW });
  check('an unparseable value is hidden rather than rendering "Invalid Date"',
    bad.show === false && bad.reason === 'invalid_date');
  check('a hidden decision never carries a target to render', bad.targetIso === '');
}

console.log('\n=== 3. The path allowlist is exactly the five target pages ===');
{
  check('five paths are allowed', LAUNCH_BANNER_PATHS.length === 5, String(LAUNCH_BANNER_PATHS.length));
  for (const p of ['/', '/modeling', '/modeling/real-estate', '/modeling-hub', '/modeling-hub/real-estate']) {
    check(`shows on ${p}`, isLaunchBannerPath(p) === true);
  }
  // The workspace, admin, auth and pricing surfaces must never see it.
  for (const p of ['/refm', '/admin', '/admin/modules', '/dashboard', '/pricing', '/pricing/refm',
                   '/signin', '/register', '/training', '/settings', '/choose-plan', '/articles']) {
    check(`hidden on ${p}`, isLaunchBannerPath(p) === false);
  }
  // EXACT matching: a deeper route under an allowed path is NOT allowed.
  for (const p of ['/modeling/business-valuation', '/modeling/real-estate/modules',
                   '/modeling-hub/business-valuation', '/modeling/dashboard']) {
    check(`hidden on the deeper route ${p}`, isLaunchBannerPath(p) === false);
  }
  check('a trailing slash still matches', isLaunchBannerPath('/modeling/') === true);
  check('a query string does not defeat the match', isLaunchBannerPath('/modeling?utm=x') === true);
  check('an empty pathname is hidden, not crashed', isLaunchBannerPath('') === false);
  check('a null pathname is hidden, not crashed', isLaunchBannerPath(null) === false);
}

console.log('\n=== 4. Dismissal is per launch date, for the session ===');
{
  check('the key includes the launch date', launchDismissKey(future).includes(future));
  check('a different date is a DIFFERENT key, so a rescheduled launch shows again',
    launchDismissKey(future) !== launchDismissKey(past));
  check('the same date is a stable key', launchDismissKey(future) === launchDismissKey(future));

  const popup = read('src/hubs/main/components/launch/LaunchCountdownPopup.tsx');
  check('dismissal uses sessionStorage (returns next session), not localStorage',
    /sessionStorage\.setItem/.test(popup) && !/localStorage/.test(popup));
  check('reaching zero hides the banner without writing a dismissal',
    /onComplete\s*=\s*useCallback\(\(\)\s*=>\s*setVisible\(false\)/.test(popup));
  check('storage access is guarded, so private mode cannot break the page',
    /catch\s*\{/.test(popup) && /try\s*\{/.test(popup));
}

console.log('\n=== 5. Wiring: reads admin settings, mounted once, never hardcoded ===');
{
  const server = read('src/hubs/main/components/launch/LaunchCountdownBanner.tsx');
  check('the server half reads training_settings', /from\('training_settings'\)/.test(server));
  check('it reads the hub-level launch key', new RegExp(LAUNCH_DATE_KEY).test(server) || /LAUNCH_DATE_KEY/.test(server));
  check('the key constant is the hub-level one', LAUNCH_DATE_KEY === 'modeling_hub_launch_date', LAUNCH_DATE_KEY);
  check('a settings failure returns null instead of throwing', /catch\s*\{[\s\S]*?return null/.test(server));
  check('no hardcoded date anywhere in the banner source',
    !/20\d\d-\d\d-\d\dT/.test(server) && !/20\d\d-\d\d-\d\dT/.test(read('src/hubs/main/components/launch/LaunchCountdownPopup.tsx')));

  const layout = read('app/layout.tsx');
  check('mounted in the root layout', /<LaunchCountdownBanner\s*\/>/.test(layout));
  check('mounted exactly once', (layout.match(/<LaunchCountdownBanner\s*\/>/g) ?? []).length === 1);

  const admin = read('app/admin/modules/page.tsx');
  check('the admin page exposes an editor for the key the banner reads',
    /endpoint="\/api\/admin\/modeling-coming-soon"/.test(admin));
  check('and keeps the date editable regardless of the coming-soon toggle',
    /alwaysShowDate/.test(admin));

  const route = read('app/api/admin/modeling-coming-soon/route.ts');
  check('that route writes the hub-level launch date', new RegExp(LAUNCH_DATE_KEY).test(route));
  check('and is admin-guarded', /role\s*!==\s*'admin'/.test(route));

  const cardSrc = read('src/components/admin/LaunchStatusCard.tsx');
  check('the shared admin card keeps its original copy when no override is passed',
    /description\?\.\w+\s*\?\?/.test(cardSrc));
}

console.log('\n=== 6. House style ===');
{
  const EM = String.fromCharCode(0x2014);
  for (const f of [
    'src/hubs/main/components/launch/launchCountdown.ts',
    'src/hubs/main/components/launch/LaunchCountdownBanner.tsx',
    'src/hubs/main/components/launch/LaunchCountdownPopup.tsx',
    'scripts/verify-launch-banner.ts',
  ]) check(`no em dash: ${f}`, !read(f).includes(EM));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
