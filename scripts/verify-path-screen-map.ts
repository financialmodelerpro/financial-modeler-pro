/**
 * verify-path-screen-map.ts
 *
 * THE MAP THAT TELLS SOMEONE WHERE TO GO MUST NOT SEND THEM SOMEWHERE WRONG.
 *
 * A misfiled badge is a quiet lie: the reader opens the tab, does not find the
 * field, and nothing on that tab says the badge was wrong. So this checks the
 * PROPERTIES the map has to hold, not the screen names it happens to return
 * today (the standing rule in CLAUDE.md, which three verifiers broke in one
 * session by pinning state instead of rules).
 *
 *   A. every rule points at a tab THE SHELL ACTUALLY RENDERS;
 *   B. the map answers for every shape on the live project, or says it cannot;
 *   C. unmapped is a real answer, carrying a reason, and never a screen;
 *   D. a multi-home field names ALL its homes, never one of them;
 *   E. the two corrected rules stay corrected, stated as the PROPERTY
 *      ("not the tab the obvious guess would pick") rather than as a name;
 *   F. specific rules sit above the general ones they carve out of.
 *
 * Run: npx tsx scripts/verify-path-screen-map.ts
 *
 * Offline. No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import {
  screenForPath, pathShape, PATH_SCREEN_RULES, PATH_SCREEN_UNMAPPED,
} from '../src/hubs/modeling/platforms/refm/lib/collab/pathScreen';
import { MODULE_TABS } from '../src/hubs/modeling/platforms/refm/lib/moduleTabs';

let pass = 0, fail = 0;
const fails: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

const TAB_KEYS = new Set(Object.values(MODULE_TABS).flatMap((t) => t.map((x) => x.key)));

console.log('=== A. Every rule points at a tab that exists ===');
{
  const bad: string[] = [];
  for (const r of PATH_SCREEN_RULES) {
    for (const s of r.screens) if (!TAB_KEYS.has(s)) bad.push(`${r.prefix} -> ${s}`);
  }
  check('A1 no rule names a tab the shell does not render', bad.length === 0, bad.join(', '));
  check('A2 the registry was actually read (an empty tab set would pass A1 vacuously)',
    TAB_KEYS.size > 15, `${TAB_KEYS.size} tabs`);
  // The label a reader sees must be a NAME, not a sidebar position.
  const numbered = PATH_SCREEN_RULES
    .flatMap((r) => screenForPath(`${r.prefix}probe`)?.screens ?? [])
    .filter((s) => /^\d+\./.test(s.label));
  check('A3 no sentence shows a tab NUMBER, which moves when tabs are reordered',
    numbered.length === 0, numbered.map((s) => s.label).join(', '));
}

console.log('\n=== B. It answers, or it says it cannot. It never half answers ===');
{
  const samples = [
    'assets[id=a1].buaSqm', 'assets[id=a1].revenue.sell.saleStartYear',
    'assets[id=a1].opex.lines[0].rate', 'assets[id=a1].capexPhasing.curve',
    'phases[id=p1].constructionPeriods', 'parcels[id=pc1].areaSqm',
    'subUnits[id=s1].unitPrice', 'costLines[id=c1].rate',
    'costOverrides[id=o1].rate', 'financingTranches[id=t1].interestRatePct',
    'project.name', 'project.tax.zakatRatePct', 'project.covenants.minDscr',
    'project.fundTerms.hurdleRatePct', 'project.costEscalationPct',
  ];
  const broken = samples.filter((p) => {
    const r = screenForPath(p);
    return r !== null && !r.unmapped && (r.screens.length === 0 || !r.sentence);
  });
  check('B1 no sample returns screens-but-no-sentence or sentence-but-no-screens',
    broken.length === 0, broken.join(', '));
  const unanswered = samples.filter((p) => screenForPath(p) === null);
  check('B2 every sampled shape gets an answer', unanswered.length === 0, unanswered.join(', '));

  check('B3 an unknown root is NULL, not a guess',
    screenForPath('somethingNobodyModelled[].x') === null);
  check('B4 an empty path is null rather than a crash',
    screenForPath('') === null && screenForPath(null) === null && screenForPath(undefined) === null);
  check('B5 the id is stripped before matching, so two rows of one array agree',
    JSON.stringify(screenForPath('assets[id=a1].buaSqm'))
      === JSON.stringify(screenForPath('assets[id=zzz].buaSqm')));
  check('B6 pathShape reduces every subscript, not just the first',
    pathShape('a[id=1].b[2].c') === 'a[].b[].c');
}

console.log('\n=== C. Unmapped is an ANSWER, with a reason, and never a screen ===');
{
  for (const u of PATH_SCREEN_UNMAPPED) {
    const r = screenForPath(`${u.prefix}`);
    check(`C1 ${u.prefix} answers`, r !== null);
    check(`C1b ${u.prefix} is flagged unmapped`, r?.unmapped === true);
    check(`C1c ${u.prefix} names NO screen (or the badge would send someone somewhere)`,
      (r?.screens.length ?? -1) === 0);
    check(`C1d ${u.prefix} says WHY, in words a client can read`,
      typeof r?.sentence === 'string' && r.sentence.length > 20 && !/undefined/.test(r.sentence),
      r?.sentence);
  }
  // AN UNMAPPED ENTRY DOES ONE OF TWO JOBS, and this asserts the right one for
  // each rather than demanding both. The first draft demanded that every entry
  // carve out of a rule, and failed on `landAllocationMode`, which no rule
  // claims: its job is to turn "I do not know" into "deliberately not
  // editable", which is the more useful answer and is not a defect.
  const shadowed = PATH_SCREEN_UNMAPPED.filter((u) =>
    PATH_SCREEN_RULES.some((r) => u.prefix.startsWith(r.prefix) || u.prefix === r.prefix.replace(/\.$/, '')));
  check('C2 at least one unmapped entry OVERRIDES a rule, so the precedence is exercised',
    shadowed.length > 0, `${shadowed.length} of ${PATH_SCREEN_UNMAPPED.length}`);
  for (const u of shadowed) {
    check(`C2b ${u.prefix} beats the rule that would otherwise claim it`,
      screenForPath(u.prefix)?.unmapped === true);
  }
  // The others must still CHANGE the answer, or they are dead entries.
  for (const u of PATH_SCREEN_UNMAPPED.filter((x) => !shadowed.includes(x))) {
    check(`C2c ${u.prefix} turns an "I do not know" into a real answer`,
      screenForPath(u.prefix) !== null && screenForPath(u.prefix)?.unmapped === true);
  }
}

console.log('\n=== D. A field with two homes names BOTH ===');
{
  // Asserted as a property of the FAMILY, not as a pair of tab names: the
  // question is whether the map is capable of naming more than one home and
  // does so where the audit found more than one.
  const multi = PATH_SCREEN_RULES.filter((r) => r.screens.length > 1);
  check('D1 the map supports a field with more than one home at all', multi.length > 0);
  for (const r of multi) {
    const res = screenForPath(`${r.prefix}probe`);
    check(`D1b ${r.prefix} renders every home it declares`,
      (res?.screens.length ?? 0) === r.screens.length,
      `${res?.screens.length} of ${r.screens.length}`);
    check(`D1c ${r.prefix} joins them so a person can read it`,
      /\bor\b/.test(res?.sentence ?? ''), res?.sentence);
  }
  // THE ONE THE FOUNDER NAMED: capex phasing has two homes and must not pick.
  const cp = screenForPath('assets[id=a].capexPhasing.curve');
  check('D2 capex phasing names two screens, never one',
    (cp?.screens.length ?? 0) === 2, JSON.stringify(cp?.screens.map((s) => s.key)));
}

console.log('\n=== E. The two audit corrections hold, stated as properties ===');
{
  // The PROPERTY is "not the tab the obvious guess would pick", so this keeps
  // biting if someone reverts the rule, and does not break if a tab is renamed.
  const tax = screenForPath('project.tax.zakatRatePct');
  check('E1 tax is NOT filed on Project & Phases, which is the obvious wrong guess',
    !(tax?.screens ?? []).some((s) => s.key === 'project-phases'),
    JSON.stringify(tax?.screens.map((s) => s.key)));
  check('E1b and it IS filed somewhere', (tax?.screens.length ?? 0) > 0);

  const esc = screenForPath('project.costEscalationPct');
  check('E2 cost escalation is NOT filed on Capex, which is the obvious wrong guess',
    !(esc?.screens ?? []).some((s) => s.key === 'costs'),
    JSON.stringify(esc?.screens.map((s) => s.key)));
  check('E2b and it IS filed somewhere', (esc?.screens.length ?? 0) > 0);

  // The three view settings: WRITTEN, therefore mapped. Declaring them
  // unmapped was the instruction until the write evidence said otherwise.
  for (const p of ['project.displayScale', 'project.displayDecimals', 'project.resultsViewMode']) {
    const r = screenForPath(p);
    check(`E3 ${p} is mapped, because a screen writes it`, r?.unmapped === false && (r?.screens.length ?? 0) > 0);
  }
  check('E4 outputGranularity is the ONLY view setting declared unmapped',
    screenForPath('project.outputGranularity')?.unmapped === true);
}

console.log('\n=== F. Specific rules sit above the general ones ===');
{
  const idx = (p: string): number => PATH_SCREEN_RULES.findIndex((r) => r.prefix === p);
  const pairs: Array<[string, string]> = [
    ['assets[].revenue.', 'assets[].'],
    ['assets[].opex.', 'assets[].'],
    ['assets[].capexPhasing.', 'assets[].'],
    ['project.tax', 'project.'],
    ['project.costEscalationPct', 'project.'],
    ['project.displayScale', 'project.'],
  ];
  const wrong = pairs.filter(([a, b]) => idx(a) < 0 || idx(b) < 0 || idx(a) > idx(b));
  check('F1 every carve-out precedes the rule it carves out of', wrong.length === 0,
    wrong.map(([a, b]) => `${a} after ${b}`).join(', '));
  // Proves the ordering MATTERS rather than being decorative.
  check('F2 and the order is load bearing: a revenue path does not resolve as a plain asset field',
    screenForPath('assets[id=a].revenue.sell.x')?.screens.some((s) => s.key === 'm2-inputs') === true);
}

console.log('\n=== G. The file states its own evidence ===');
{
  const src = readFileSync('src/hubs/modeling/platforms/refm/lib/collab/pathScreen.ts', 'utf8');
  check('G1 it names the audit that verified it, so the claim is traceable',
    src.includes('audit-path-screen-map'));
  check('G2 it reads the LIVE tab registry rather than holding a copy',
    /from '\.\.\/moduleTabs'/.test(src) && !/key:\s*'m4-pl',\s*label:/.test(src));
  check('G3 no em dash', !src.includes('—'));
}

console.log('\n=== H. The anchor survives a mount, and is consumed exactly once ===');
{
  // TESTED AS BEHAVIOUR, not by reading the source: the latch exists because
  // the Comments composer mounts AFTER the click that sets the anchor, so an
  // event alone is delivered to nobody. Consume-once is what stops a stale
  // anchor attaching itself to an unrelated comment later.
  //
  // EXERCISED, not merely called once on an empty latch: "returns null when
  // nothing was set" passes on a latch that is broken and always returns null,
  // which is the vacuous-pass shape this session has been full of. So the
  // anchor is SET through the real entry point and then drained.
  const events: string[] = [];
  (globalThis as unknown as { window: unknown }).window = Object.assign(new EventTarget(), {
    dispatchEvent(e: Event) { events.push(e.type); return true; },
  });
  const badge = require('../src/hubs/modeling/platforms/refm/components/collab/ScreenBadge') as {
    takePendingAnchor: () => string | null;
    commentOnField: (p: string) => void;
  };
  check('H1 nothing pending reads as null', badge.takePendingAnchor() === null);
  badge.commentOnField('assets[id=a1].buaSqm');
  check('H2 raising a comment on a field LATCHES it, so a panel mounting later still gets it',
    badge.takePendingAnchor() === 'assets[id=a1].buaSqm');
  check('H3 and it is consumed: a second read is null, so it cannot attach to a later comment',
    badge.takePendingAnchor() === null);
  check('H4 it also navigates and announces, for a panel that is already open',
    events.includes('fmp:trace-to') && events.includes('fmp:comment-on'),
    events.join(', '));
}

console.log('\n=== I. The wiring obeys the rules the panels depend on ===');
{
  const panels = readFileSync('src/hubs/modeling/platforms/refm/components/collab/CollabPanels.tsx', 'utf8');
  const m10 = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module10Collaborate.tsx', 'utf8');

  check('I1 a new ROOT comment carries its field, so `path` is no longer always null',
    /path:\s*parentId\s*\?\s*null\s*:\s*anchorPath/.test(panels));
  check('I2 a REPLY carries none, exactly as it carries no version',
    /path:\s*parentId\s*\?\s*null/.test(panels) && /versionId:\s*parentId\s*\?\s*null/.test(panels));
  check('I3 the anchor is CLEARED after a successful post, so it cannot go sticky',
    /setDraft\(''\);\s*setAnchorPath\(null\);/.test(panels));
  check('I4 and the user can clear it themselves before posting',
    panels.includes('comment-anchor-clear'));
  check('I5 the panel drains the latch on mount, not only on the event',
    /takePendingAnchor\(\)/.test(panels));
  check('I6 arriving from a field lands on Comments, not on the Overview',
    /fmp:comment-on[\s\S]{0,200}setTab\('comments'\)/.test(m10)
    || /setTab\('comments'\)[\s\S]{0,200}fmp:comment-on/.test(m10));
  check('I7 both panels show where the field is edited',
    (panels.match(/<ScreenBadge/g) ?? []).length >= 3,
    `${(panels.match(/<ScreenBadge/g) ?? []).length} uses`);
  check('I8 the raw path is STILL shown, so no row lost information',
    panels.includes('-path`}') && /\{comment\.path\}/.test(panels));
  check('I9 navigation reuses the existing trace event rather than a second mechanism',
    readFileSync('src/hubs/modeling/platforms/refm/components/collab/ScreenBadge.tsx', 'utf8')
      .includes("'fmp:trace-to'"));
  check('I10 no em dash in either new file',
    !panels.includes('—')
    && !readFileSync('src/hubs/modeling/platforms/refm/components/collab/ScreenBadge.tsx', 'utf8').includes('—'));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
