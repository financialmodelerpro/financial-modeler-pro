/**
 * verify-platform-tour.ts (2026-08-20)
 *
 * THE TOUR COVERS THE WHOLE PLATFORM, IN ORDER, FROM THE SAME CONTENT AS THE
 * GUIDE, AND REMEMBERS EACH USER.
 *
 * The properties pinned here:
 *
 *   COVERAGE. Every live module in canonical order, and within each module
 *   every tab (Module 6, which has no sidebar tabs, walks its four declared
 *   page surfaces). Coverage is measured against the LIVE registry in
 *   lib/moduleTabs.ts, never a copy, for the reason written on that file.
 *
 *   ONE SOURCE. A tour step's text IS the guide's text for the same surface,
 *   asserted by string identity, so the two cannot drift. The tour file
 *   writes no module or tab prose of its own.
 *
 *   MECHANICS. Skip, pause, back and resume exist; every exit persists;
 *   auto-run fires only for a user who has neither completed nor skipped.
 *
 *   PERSISTENCE. Per user (mig 217, additive only), schema tolerant, with a
 *   localStorage fallback that never blocks the tour.
 *
 * Run: npx tsx scripts/verify-platform-tour.ts
 * No em dashes in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODULE_TABS, GUIDE_MODULE_ORDER } from '../src/hubs/modeling/platforms/refm/lib/moduleTabs';
import { MODULE_INTRO, TAB_CONTENT, MODULE6_SURFACES } from '../src/hubs/modeling/platforms/refm/lib/guide/guideContent';
import { buildPlatformTour } from '../src/hubs/modeling/platforms/refm/lib/guide/tour';
import { tourShouldAutoRun } from '../src/hubs/modeling/platforms/refm/lib/guide/tourState';

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 58 - t.length))}`);
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const stripComments = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const steps = buildPlatformTour();
const ids = steps.map((s) => s.id);

// ---------------------------------------------------------------------------
section('A. Every module, in canonical order, and every tab within it');

{
  check('A: the tour opens with a welcome and closes with a finish',
    ids[0] === 'welcome' && ids[ids.length - 1] === 'finish');

  // Canonical module order, measured on the step list itself.
  const moduleIdx = GUIDE_MODULE_ORDER.map((mk) => ids.indexOf(mk));
  check('A: all seven modules appear', moduleIdx.every((i) => i > 0), moduleIdx.join(','));
  check('A: in canonical order', moduleIdx.every((v, i) => i === 0 || v > moduleIdx[i - 1]));

  // Every tab, directly after its module and before the next one.
  for (const [mk, tabs] of Object.entries(MODULE_TABS)) {
    const mi = ids.indexOf(mk);
    for (const t of tabs) {
      const ti = ids.indexOf(`${mk}/${t.key}`);
      check(`A: ${mk}/${t.key} is a step`, ti > mi, String(ti));
    }
  }
  // Module 6 walks its surfaces.
  for (const sf of MODULE6_SURFACES) {
    check(`A: ${sf.id} is a step`, ids.includes(sf.id));
  }
  // The count is structural: welcome + modules + tabs + m6 surfaces + finish.
  const tabCount = Object.values(MODULE_TABS).reduce((n, t) => n + t.length, 0);
  const expected = 1 + GUIDE_MODULE_ORDER.length + tabCount + MODULE6_SURFACES.length + 1;
  check('A: the step count is exactly the structure', steps.length === expected, `${steps.length} vs ${expected}`);
}

// ---------------------------------------------------------------------------
section('B. One content source: tour text IS guide text');

{
  // String identity, not resemblance. A paraphrase is a second copy that
  // drifts; the rule is that the overlap is ONE string used twice.
  for (const mk of GUIDE_MODULE_ORDER) {
    const st = steps.find((s) => s.id === mk);
    check(`B: ${mk} step body is the module intro verbatim`, st?.body === MODULE_INTRO[mk]);
  }
  for (const [mk, tabs] of Object.entries(MODULE_TABS)) {
    for (const t of tabs) {
      const st = steps.find((s) => s.id === `${mk}/${t.key}`);
      const c = TAB_CONTENT[`${mk}/${t.key}`];
      check(`B: ${mk}/${t.key} step body starts with the tab intro verbatim`,
        !!st && !!c && st.body.startsWith(c.intro));
    }
  }
  for (const sf of MODULE6_SURFACES) {
    const st = steps.find((s) => s.id === sf.id);
    check(`B: ${sf.id} step body is the surface body verbatim`, st?.body === sf.body);
  }
  // The tour builder holds no prose: no long string literal that is not in
  // guideContent. Checked structurally: the source declares no steps.push
  // with an inline body except the two framing steps.
  const tour = stripComments(read('src/hubs/modeling/platforms/refm/lib/guide/tour.ts'));
  check('B: the tour imports the shared content', tour.includes("from './guideContent'"));
  const inlineBodies = (tour.match(/body: '/g) ?? []).length;
  check('B: only the welcome and finish steps carry their own text', inlineBodies === 2, String(inlineBodies));
}

// ---------------------------------------------------------------------------
section('C. Each step highlights the element it describes');

{
  // Module steps anchor on their sidebar entry; tab steps on the main
  // surface; module 6 surfaces on their own section testids. Anchors must
  // point at testids that EXIST in the components, or the spotlight silently
  // never fires, which is the tour equivalent of a hidden row.
  const shell = read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  const sidebar = read('src/hubs/modeling/platforms/refm/components/Sidebar.tsx');
  const topbar = read('src/hubs/modeling/platforms/refm/components/Topbar.tsx');
  const m6 = read('src/hubs/modeling/platforms/refm/components/modules/Module6Scenarios.tsx');

  check('C: the main surface carries the tour anchor', shell.includes('data-testid="platform-main"'));
  check('C: the sidebar renders per-module testids', sidebar.includes('data-testid={`sidebar-${mod.key}`}'));
  check('C: the finish step anchors on the real Guide button',
    steps[steps.length - 1].anchors[0].includes('topbar-open-guide') && topbar.includes('topbar-open-guide'));
  for (const sf of MODULE6_SURFACES) {
    check(`C: ${sf.anchor} exists on the Module 6 page`, m6.includes(`data-testid="${sf.anchor}"`));
  }
  // Every tab step both navigates and anchors, and has a fallback.
  for (const s of steps) {
    if (!s.id.includes('/')) continue;
    check(`C: ${s.id} navigates before it highlights`, !!s.nav);
    check(`C: ${s.id} has a fallback anchor`, s.anchors.length >= 2 || s.id.startsWith('module6/'));
  }
}

// ---------------------------------------------------------------------------
section('D. Skip, pause, back, resume, and per-user completion');

{
  const comp = stripComments(read('src/hubs/modeling/platforms/refm/components/PlatformTour.tsx'));
  check('D: skip exists and marks skippedAt', comp.includes('tour-skip') && /skippedAt: new Date\(\)\.toISOString\(\)/.test(comp));
  check('D: pause exists and keeps the step', comp.includes('tour-pause') && comp.includes("onClose('paused')"));
  check('D: back exists', comp.includes('tour-back'));
  check('D: finish marks completedAt', /completedAt: new Date\(\)\.toISOString\(\)/.test(comp));
  check('D: every step change persists the resume position', /const go = [\s\S]{0,200}persist\(\{ step: clamped \}\)/.test(comp));
  check('D: progress is shown', comp.includes('tour-progress'));
  check('D: Escape pauses rather than discarding', /Escape[\s\S]{0,40}pause\(\)/.test(comp));
  check('D: the component writes no module prose of its own',
    !comp.includes('cohort') && !comp.includes('capex') && !comp.includes('waterfall'));

  // The auto-run rule, on the pure function.
  check('D: a fresh user auto-runs', tourShouldAutoRun(null) === true);
  check('D: a paused user auto-runs (resume)', tourShouldAutoRun({ step: 7 }) === true);
  check('D: a completed user does not', tourShouldAutoRun({ completedAt: 'x' }) === false);
  check('D: a skipped user does not', tourShouldAutoRun({ skippedAt: 'x' }) === false);

  // Wiring: auto-run on platform open, resume at the saved step, restart from
  // the guide.
  const shell = stripComments(read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx'));
  check('D: the platform auto-runs the tour for an unfinished user',
    shell.includes('loadTourState()') && shell.includes('tourShouldAutoRun(st)'));
  check('D: and resumes at the saved step', shell.includes('setTourStartStep(st?.step ?? 0)'));
  check('D: the guide can restart it', shell.includes('onStartTour={()'));
  const guide = stripComments(read('src/hubs/modeling/platforms/refm/components/modals/PlatformGuideModal.tsx'));
  check('D: the guide renders the restart button', guide.includes('guide-start-tour'));
}

// ---------------------------------------------------------------------------
section('E. Persistence is per user, additive, and schema tolerant');

{
  const mig = read('supabase/migrations/217_users_refm_tour.sql');
  check('E: the migration is one additive column',
    mig.includes('add column if not exists refm_tour jsonb') && !/drop |alter column|delete from/i.test(mig));
  const route = stripComments(read('app/api/refm/tour-state/route.ts'));
  check('E: the route resolves the user from the session, never the request',
    route.includes('getRefmUserId()') && !route.includes('userId ='.replace('userId', 'body.userId')));
  check('E: a missing column reports unavailable instead of erroring',
    route.includes('available: false') && route.includes('COLUMN_MISSING'));
  check('E: the state size is capped', /length > 2_?000/.test(route));
  const state = stripComments(read('src/hubs/modeling/platforms/refm/lib/guide/tourState.ts'));
  check('E: the client reads the server first and falls back to localStorage',
    state.indexOf("fetch('/api/refm/tour-state'") < state.indexOf('return readLocal();')
    && state.includes('localStorage.getItem'));
  check('E: writes go to both stores', /writeLocal\(s\);[\s\S]{0,80}fetch\('\/api\/refm\/tour-state'/.test(state));
  check('E: a failed persist never blocks the tour',
    /void fetch\('\/api\/refm\/tour-state'[^]{0,220}\.catch\(/.test(state));
}

// ---------------------------------------------------------------------------
section('F. Locked palette');

{
  const comp = read('src/hubs/modeling/platforms/refm/components/PlatformTour.tsx');
  const colourish = stripComments(comp).match(/#[0-9a-fA-F]{3,8}\b|rgb\(/g) ?? [];
  check('F: the tour uses design tokens only', colourish.length === 0, colourish.slice(0, 4).join(', '));
  check('F: and actually uses them', (comp.match(/var\(--color-/g) ?? []).length > 8);
}

console.log(`\n${'='.repeat(64)}`);
if (failures.length === 0) {
  console.log(`verify-platform-tour: ${passed} passed, 0 failed`);
} else {
  console.log(`verify-platform-tour: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
