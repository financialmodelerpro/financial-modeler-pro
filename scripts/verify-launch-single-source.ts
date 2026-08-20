/**
 * verify-launch-single-source.ts (2026-08-20)
 *
 * THE LAUNCH DATE IS THE SINGLE SOURCE FOR THE COMING SOON STATE.
 *
 * Before this, the date sat beside a stored flag doing nothing unless a THIRD
 * setting let a nightly cron flip the flag. On 2026-08-20 the date passed with
 * auto-launch off, so the public banner said "launched" while the workspace
 * stayed shut and every trial user was bounced back to the platform selector.
 * Two settings, one intention, and the site told two stories about itself.
 *
 * Run: npx tsx scripts/verify-launch-single-source.ts
 * No em dashes in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveComingSoonFromDate } from '../src/shared/comingSoon/resolveFromDate';

let passed = 0;
const failures: string[] = [];
const check = (l: string, ok: boolean, d = ''): void => { if (ok) { passed++; return; } failures.push(`${l}${d ? `  [${d}]` : ''}`); };
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 56 - t.length))}`);
const read = (r: string): string => fs.readFileSync(path.join(process.cwd(), r), 'utf8');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const NOW = Date.parse('2026-08-20T12:00:00Z');
const PAST = '2026-08-19T00:00:00Z';
const FUTURE = '2026-09-01T00:00:00Z';

section('A. The date outranks the flag whenever a date is set');
{
  // The exact case that broke: date passed, flag still says coming soon.
  const r = resolveComingSoonFromDate({ flag: true, launchDate: PAST, nowMs: NOW });
  check('A: a passed date opens the hub even with the flag ON', r.enabled === false);
  check('A: and says why', /Live since/.test(r.reason) && r.source === 'date_passed');

  // And the mirror: a future date closes it even if somebody left the flag off.
  const f = resolveComingSoonFromDate({ flag: false, launchDate: FUTURE, nowMs: NOW });
  check('A: a future date gates the hub even with the flag OFF', f.enabled === true);
  check('A: and says why', /Coming Soon until/.test(f.reason) && f.source === 'date_pending');
}

section('B. With no date, the stored flag still decides');
{
  for (const empty of ['', '   ', null, undefined]) {
    const on = resolveComingSoonFromDate({ flag: true, launchDate: empty, nowMs: NOW });
    const off = resolveComingSoonFromDate({ flag: false, launchDate: empty, nowMs: NOW });
    check(`B: no date, flag on, stays gated (${JSON.stringify(empty)})`, on.enabled === true && on.source === 'flag');
    check(`B: no date, flag off, stays live (${JSON.stringify(empty)})`, off.enabled === false && off.source === 'flag');
  }
  // A TYPO MUST NOT LAUNCH OR CLOSE ANYTHING. It falls back to the last state
  // somebody actually chose.
  const bad = resolveComingSoonFromDate({ flag: true, launchDate: 'next tuesday', nowMs: NOW });
  check('B: an unparseable date falls back to the flag', bad.enabled === true && bad.source === 'flag');
}

section('C. The boundary is exact');
{
  const at = Date.parse(FUTURE);
  check('C: one millisecond before the date, still gated',
    resolveComingSoonFromDate({ flag: false, launchDate: FUTURE, nowMs: at - 1 }).enabled === true);
  check('C: exactly at the date, live',
    resolveComingSoonFromDate({ flag: false, launchDate: FUTURE, nowMs: at }).enabled === false);
  check('C: one millisecond after, live',
    resolveComingSoonFromDate({ flag: false, launchDate: FUTURE, nowMs: at + 1 }).enabled === false);
}

section('D. One rule, wired everywhere, and auto-launch is retired');
{
  const state = strip(read('src/hubs/modeling/lib/comingSoon.ts'));
  const adminApi = strip(read('app/api/admin/modeling-coming-soon/route.ts'));
  const cron = strip(read('app/api/cron/auto-launch-check/route.ts'));
  const card = strip(read('src/components/admin/LaunchBannerCard.tsx'));

  check('D: the live guard resolves through the shared rule',
    state.includes('resolveComingSoonFromDate'));
  check('D: and no longer reads the flag directly for `enabled`',
    !/enabled:\s*map\.get\('modeling_hub_coming_soon'\)/.test(state));
  check('D: the admin API reports the DERIVED state, so the card cannot disagree',
    adminApi.includes('resolveComingSoonFromDate') && adminApi.includes('effectiveEnabled'));

  // RETIRED, not deleted.
  check('D: the admin API no longer writes auto_launch',
    !/rows\.push\(\{ key: 'modeling_hub_auto_launch'/.test(adminApi));
  check('D: modeling is off the auto-launch cron',
    !cron.includes('modeling_hub_coming_soon'));
  check('D: but training is still on it, untouched',
    cron.includes('training_hub_coming_soon'));
  check('D: and the stored key is not dropped anywhere',
    !/DELETE .*modeling_hub_auto_launch/i.test(adminApi));

  // THE WARNING BEFORE SAVE.
  check('D: the card warns before closing an open hub', card.includes('window.confirm'));
  check('D: only when the change actually gates it',
    /willGate && isOpenNow/.test(card));
  check('D: and the field says what it now controls',
    read('src/components/admin/LaunchBannerCard.tsx').includes('launch-date-gates-hub'));
}

console.log(`\n${'='.repeat(62)}`);
if (failures.length === 0) console.log(`verify-launch-single-source: ${passed} passed, 0 failed`);
else { console.log(`verify-launch-single-source: ${passed} passed, ${failures.length} FAILED`); for (const f of failures) console.log(`  FAIL  ${f}`); process.exit(1); }
