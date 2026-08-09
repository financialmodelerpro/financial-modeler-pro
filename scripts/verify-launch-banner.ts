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
  LAUNCH_DATE_KEY, LAUNCH_BANNER_PATHS, LAUNCH_SETTING_KEYS,
  LAUNCH_HEADLINE_KEY, LAUNCH_SUBLINE_KEY, LAUNCH_PLATFORM_KEY,
  DEFAULT_LAUNCH_HEADLINE, DEFAULT_LAUNCH_SUBLINE, PLATFORM_TOKEN,
  isLaunchBannerPath, launchDismissKey, resolveLaunchCountdown,
  resolveLaunchCopy, applyPlatformToken,
} from '../src/hubs/main/components/launch/launchCountdown';
import { PLATFORMS, getPlatform } from '../src/hubs/modeling/config/platforms';

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
  check('the admin page mounts an editor for the banner', /<LaunchBannerCard/.test(admin));

  const bannerCard = read('src/components/admin/LaunchBannerCard.tsx');
  check('that editor writes the key the banner reads', bannerCard.includes('/api/admin/modeling-coming-soon'));
  check('and its date field is always editable (not hidden behind a coming-soon toggle)',
    /launch-banner-date/.test(bannerCard) && !/enabled &&/.test(bannerCard));

  const route = read('app/api/admin/modeling-coming-soon/route.ts');
  check('that route writes the hub-level launch date', new RegExp(LAUNCH_DATE_KEY).test(route));
  check('and is admin-guarded', /role\s*!==\s*'admin'/.test(route));

  const cardSrc = read('src/components/admin/LaunchStatusCard.tsx');
  check('the shared signin/register card is untouched by the banner work',
    /signin and register pages/.test(cardSrc));
}

console.log('\n=== 6. Editable copy: admin text wins, defaults fill in ===');
{
  const name = 'Real Estate Financial Modeling';

  const d = resolveLaunchCopy({ headline: '', subline: '', platformName: name });
  check('an unset headline falls back to the default', d.headline === applyPlatformToken(DEFAULT_LAUNCH_HEADLINE, name));
  check('an unset supporting line falls back to the default', d.subline === applyPlatformToken(DEFAULT_LAUNCH_SUBLINE, name));
  check('the default headline NAMES the platform rather than being generic', d.headline.includes(name), d.headline);

  const custom = resolveLaunchCopy({ headline: 'Doors open soon', subline: 'Get ready', platformName: name });
  check('admin headline wins over the default', custom.headline === 'Doors open soon');
  check('admin supporting line wins over the default', custom.subline === 'Get ready');

  const tokened = resolveLaunchCopy({ headline: `${PLATFORM_TOKEN} launches`, subline: `Built for ${PLATFORM_TOKEN}`, platformName: name });
  check('the platform token resolves in the headline', tokened.headline === 'Real Estate Financial Modeling launches');
  check('and in the supporting line', tokened.subline === 'Built for Real Estate Financial Modeling');
  check('a repeated token resolves every occurrence',
    applyPlatformToken(`${PLATFORM_TOKEN} and ${PLATFORM_TOKEN}`, 'X') === 'X and X');

  // A visitor must never see the raw token, whatever the platform lookup did.
  const noName = resolveLaunchCopy({ headline: `${PLATFORM_TOKEN} is coming`, subline: '', platformName: '' });
  check('an unresolved platform never leaks a literal token to a visitor',
    !noName.headline.includes(PLATFORM_TOKEN) && !noName.subline.includes(PLATFORM_TOKEN), noName.headline);

  check('whitespace-only admin text is treated as unset, not as a blank banner',
    resolveLaunchCopy({ headline: '   ', subline: '  ', platformName: name }).headline.includes(name));
}

console.log('\n=== 7. Platform naming is source-derived, never hardcoded ===');
{
  const refm = getPlatform('real-estate');
  check('the platform config resolves real-estate', !!refm);
  check('and carries the full product name', refm?.name === 'Real Estate Financial Modeling', refm?.name);
  const live = PLATFORMS.find((p) => p.status === 'live');
  check('a live platform exists for the auto choice', !!live);

  // The name must live in the config only. The banner and its settings may
  // reference a SLUG, never the product name.
  const pure = read('src/hubs/main/components/launch/launchCountdown.ts');
  const server = read('src/hubs/main/components/launch/LaunchCountdownBanner.tsx');
  const popup = read('src/hubs/main/components/launch/LaunchCountdownPopup.tsx');
  for (const [f, src] of [['launchCountdown.ts', pure], ['LaunchCountdownBanner.tsx', server], ['LaunchCountdownPopup.tsx', popup]] as const) {
    check(`${f} does not hardcode the platform name`, !src.includes('Real Estate Financial Modeling'));
  }
  check('the server component resolves the name from the platform config',
    /getPlatform\(/.test(server) && /PLATFORMS/.test(server));
  check('the stored setting is a SLUG, not a name', /LAUNCH_PLATFORM_KEY/.test(server) && LAUNCH_PLATFORM_KEY.endsWith('_platform'));
  check('the popup renders copy passed IN rather than composing its own',
    /headline/.test(popup) && /subline/.test(popup) && !/is almost here/.test(popup));
}

console.log('\n=== 8. Settings keys + admin wiring ===');
{
  check('all four settings keys are batched into one query',
    LAUNCH_SETTING_KEYS.length === 4
    && LAUNCH_SETTING_KEYS.includes(LAUNCH_DATE_KEY)
    && LAUNCH_SETTING_KEYS.includes(LAUNCH_HEADLINE_KEY)
    && LAUNCH_SETTING_KEYS.includes(LAUNCH_SUBLINE_KEY)
    && LAUNCH_SETTING_KEYS.includes(LAUNCH_PLATFORM_KEY));
  check('every key is namespaced to the modeling hub',
    LAUNCH_SETTING_KEYS.every((k) => k.startsWith('modeling_hub_launch')));

  const route = read('app/api/admin/modeling-coming-soon/route.ts');
  for (const k of [LAUNCH_HEADLINE_KEY, LAUNCH_SUBLINE_KEY, LAUNCH_PLATFORM_KEY]) {
    check(`the admin route reads and writes ${k}`, route.includes(k));
  }
  check('the route still guards writes on the admin role', /role\s*!==\s*'admin'/.test(route));
  check('an EMPTY copy field is written (clearing restores the default), not skipped',
    /typeof body\.headline === 'string'/.test(route));

  const card = read('src/components/admin/LaunchBannerCard.tsx');
  check('the admin card exists and posts to the hub route', /\/api\/admin\/modeling-coming-soon/.test(card));
  // The fix for the reported failure: the admin can SEE whether it is live.
  check('THE FIX: the card shows a live banner status', /launch-banner-status/.test(card));
  check('and derives that status from the SAME resolver the banner uses',
    /resolveLaunchCountdown\(/.test(card));
  check('status is computed from the SAVED date, not the unsaved draft',
    /resolveLaunchCountdown\(\{\s*launchDate:\s*saved\.launchDate/.test(card));
  check('the card previews the resolved copy through the shared resolver',
    /resolveLaunchCopy\(/.test(card));
  check('the save reports the resulting state so a no-op cannot read as success',
    /next\.launchDate \?/.test(card));

  const admin = read('app/admin/modules/page.tsx');
  check('the admin page mounts the dedicated banner card', /<LaunchBannerCard/.test(admin));

  // The shared signin/register card must be back to exactly its old shape.
  const shared = read('src/components/admin/LaunchStatusCard.tsx');
  check('the shared LaunchStatusCard carries no leftover unused props',
    !/alwaysShowDate/.test(shared) && !/description\?:/.test(shared));
}

console.log('\n=== 9. House style ===');
{
  const EM = String.fromCharCode(0x2014);
  for (const f of [
    'src/hubs/main/components/launch/launchCountdown.ts',
    'src/hubs/main/components/launch/LaunchCountdownBanner.tsx',
    'src/hubs/main/components/launch/LaunchCountdownPopup.tsx',
    'src/components/admin/LaunchBannerCard.tsx',
    'app/api/admin/modeling-coming-soon/route.ts',
    'scripts/verify-launch-banner.ts',
  ]) check(`no em dash: ${f}`, !read(f).includes(EM));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
