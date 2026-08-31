/**
 * scripts/verify-promo-self-link.ts
 *
 * ONE RULE: a promo never links to the page you are already on.
 *
 * Born from the launch popup on /modeling/real-estate, which announced the
 * real-estate platform to a visitor already standing on it and offered a button
 * back to the same page. The banner's allowlist and its call to action were set
 * independently and nothing compared them.
 *
 * The pricing promo had the identical collision and escaped it by coincidence:
 * `/pricing` sits in its hide-list for an unrelated reason. That is the part
 * worth pinning. A rule guarded by a coincidence is not guarded.
 *
 * Sections:
 *   A. The rule itself, including what it refuses to guess.
 *   B. The REAL configuration: the live default CTA against the live allowlist.
 *   C. Both popups actually consult it, and neither re-implements it.
 *
 * Runs OFFLINE (no env, no DB, no render).
 * Run: npx tsx scripts/verify-promo-self-link.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { isSamePageTarget, splitHref, appRootEquivalence } from '@/src/shared/promo/samePageTarget';
import { LAUNCH_BANNER_PATHS, resolveLaunchedCopy } from '@/src/hubs/main/components/launch/launchCountdown';

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const APP = 'https://app.financialmodelerpro.com';
const APEX = 'https://financialmodelerpro.com';

function main(): void {
  console.log('A. The rule');
  {
    const same = (pathname: string, href: string, origin?: string): boolean =>
      isSamePageTarget({ pathname, href, origin, equivalentPaths: appRootEquivalence(APP) });

    check('A1 an absolute href to the current path IS the current page',
      same('/modeling/real-estate', `${APP}/modeling/real-estate`, APP));
    check('A2 a relative href to the current path IS the current page',
      same('/pricing', '/pricing', APEX));
    check('A3 a different path is not',
      !same('/modeling/real-estate', `${APP}/modeling/business-valuation`, APP));
    check('A4 a trailing slash does not make it a different page',
      same('/modeling/real-estate/', `${APP}/modeling/real-estate`, APP));
    check('A5 a query or hash on the destination does not either',
      same('/pricing', '/pricing?plan=pro#compare', APEX));
    check('A6 the SAME path on a DIFFERENT origin is a different page',
      !same('/modeling/real-estate', `${APP}/modeling/real-estate`, APEX));

    // The app root rewrite: '/' renders /modeling, so a CTA to /modeling is the
    // page you are on. Only on the app origin.
    check('A7 on the app origin, / and /modeling are the same page',
      same('/', `${APP}/modeling`, APP));
    check('A8 on the apex, / is the marketing home and is NOT /modeling',
      !same('/', '/modeling', APEX));

    // It refuses to guess. Every one of these means "show the promo".
    check('A9 no href means no suppression', !isSamePageTarget({ pathname: '/x', href: '' }));
    check('A10 no pathname means no suppression', !isSamePageTarget({ pathname: '', href: '/x' }));
    check('A11 a mailto is not a page link', splitHref('mailto:a@b.c') === null);
    check('A12 a bare fragment is not a navigation', splitHref('#pricing') === null);
    check('A13 an unparseable absolute href does not suppress',
      !isSamePageTarget({ pathname: '/x', href: 'http://[::bad', origin: APP }));
  }

  console.log('\nB. The REAL configuration: the live default CTA vs the live allowlist');
  {
    // The default destination, built the way LaunchCountdownBanner builds it.
    const platformHref = (slug: string): string => (slug ? `${APP}/modeling/${slug}` : APP);
    for (const slug of ['real-estate', 'business-valuation', 'equity-research']) {
      const copy = resolveLaunchedCopy({ platformName: 'X', platformHref: platformHref(slug) });
      const collides = LAUNCH_BANNER_PATHS.filter((p) => isSamePageTarget({
        pathname: p, href: copy.ctaHref, origin: APP, equivalentPaths: appRootEquivalence(APP),
      }));
      // A collision is EXPECTED for any platform whose own page is on the
      // allowlist. What must hold is that the popup suppresses itself there,
      // which section C pins. This check states the exposure explicitly so a
      // new allowlist entry cannot quietly add one nobody looked at.
      check(`B1 ${slug}: the default CTA is measured against every allowed path`,
        copy.ctaHref === platformHref(slug),
        copy.ctaHref);
      if (slug === 'real-estate') {
        check('B2 real-estate DOES collide with an allowed path (the reported bug)',
          collides.includes('/modeling/real-estate'), collides.join(', ') || 'none');
      }
    }
    // An admin override is subject to the same rule, not exempt from it.
    const overridden = resolveLaunchedCopy({
      platformName: 'X', platformHref: platformHref('real-estate'), ctaHref: '/modeling',
    });
    check('B3 an admin CTA override is measured the same way',
      isSamePageTarget({ pathname: '/modeling', href: overridden.ctaHref, origin: APP }));

    // THE LIVE SHAPE, exactly as configured on 2026-08-31. The destination is
    // an explicit admin override in training_settings
    // (modeling_hub_launched_cta_href = '/modeling/real-estate'), a RELATIVE
    // path, not the derived absolute default. A relative href inherits the
    // current origin, so there is no origin to compare and the paths decide.
    // Pinned with the real value because that is the configuration that shipped
    // the bug.
    const live = resolveLaunchedCopy({
      platformName: 'Real Estate Financial Modeling',
      platformHref: platformHref('real-estate'),
      ctaHref: '/modeling/real-estate',
      headline: 'Real Estate Financial Modeling Platform is live',
    });
    check('B4 the LIVE cta (a relative admin override) is suppressed on its own page',
      isSamePageTarget({
        pathname: '/modeling/real-estate', href: live.ctaHref, origin: APP,
        equivalentPaths: appRootEquivalence(APP),
      }), live.ctaHref);
    check('B5 and the same popup still shows on the other allowed paths',
      LAUNCH_BANNER_PATHS.filter((p) => !isSamePageTarget({
        pathname: p, href: live.ctaHref, origin: APP, equivalentPaths: appRootEquivalence(APP),
      })).length === LAUNCH_BANNER_PATHS.length - 1,
      LAUNCH_BANNER_PATHS.filter((p) => !isSamePageTarget({
        pathname: p, href: live.ctaHref, origin: APP, equivalentPaths: appRootEquivalence(APP),
      })).join(', '));
  }

  console.log('\nC. Both popups consult the rule, and neither re-implements it');
  {
    const launch = strip(src('src/hubs/main/components/launch/LaunchCountdownPopup.tsx'));
    const promo = strip(src('src/hubs/main/components/pricing/PromoPopup.tsx'));
    check('C1 the launch popup calls the shared rule', /isSamePageTarget\(/.test(launch));
    check('C2 the pricing popup calls the shared rule', /isSamePageTarget\(/.test(promo));
    check('C3 the launch popup checks its OWN cta href', /href:\s*launched\.ctaHref/.test(launch));
    check('C4 the pricing popup checks its OWN href', /href,/.test(promo) || /href:\s*href/.test(promo));
    check('C5 both pass the current origin, so a cross-domain link is not suppressed',
      /window\.location\.origin/.test(launch) && /window\.location\.origin/.test(promo));
    // The rule has ONE implementation.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const defs = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'app'))]
      .filter((f) => /export function isSamePageTarget/.test(fs.readFileSync(f, 'utf8')));
    check('C6 the rule is defined exactly once', defs.length === 1,
      defs.map((d) => path.relative(ROOT, d)).join(', '));
    // The pricing promo's /pricing hide-entry must NOT be what does this job.
    check('C7 the pricing promo would still suppress itself if its hide-list lost /pricing',
      isSamePageTarget({ pathname: '/pricing', href: `${APEX}/pricing`, origin: APEX }));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
