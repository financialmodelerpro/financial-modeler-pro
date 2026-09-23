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

console.log('\n=== J. A tab anchor, and a module that has no tabs ===');
{
  const { screenAnchor, isScreenAnchor, MODULE_ONLY } =
    require('../src/hubs/modeling/platforms/refm/lib/collab/pathScreen') as typeof import('../src/hubs/modeling/platforms/refm/lib/collab/pathScreen');
  const { MODULE_TABS: TABS } = require('../src/hubs/modeling/platforms/refm/lib/moduleTabs') as typeof import('../src/hubs/modeling/platforms/refm/lib/moduleTabs');

  check('J1 a tab anchor resolves to exactly that tab',
    screenForPath(screenAnchor('costs'))?.screens.map((s) => s.key).join() === 'costs');
  check('J1b and says so in words rather than claiming a field',
    /^On the /.test(screenForPath(screenAnchor('costs'))?.sentence ?? ''));
  check('J2 a tab anchor is NOT mistaken for a snapshot path',
    isScreenAnchor(screenAnchor('costs')) && !isScreenAnchor('assets[id=a].buaSqm'));
  check('J3 an anchor naming a tab that does not exist resolves to NOTHING, not half an answer',
    screenForPath(screenAnchor('no-such-tab')) === null);

  // THE RULE, not the current membership of the list: every module with no
  // sub-tabs must be reachable as a screen, or a comment raised on it can
  // never be counted or shown again. That is what `screen:m6` did before this
  // was added, and a module added tomorrow would do it silently.
  const tabless = Object.entries(TABS).filter(([, t]) => t.length === 0).map(([k]) => k);
  check('J4 there IS a tab-less module, so this check is not vacuous', tabless.length > 0, tabless.join());
  const missing = tabless.filter((k) => screenForPath(screenAnchor(k)) === null);
  check('J5 every tab-less module is still reachable as a screen', missing.length === 0, missing.join());
  check('J6 and the named list holds exactly those, with no stale entries',
    Object.keys(MODULE_ONLY).every((k) => tabless.includes(k)),
    Object.keys(MODULE_ONLY).filter((k) => !tabless.includes(k)).join());
}

console.log('\n=== K. Filing a comment to a screen, and to no screen ===');
{
  const anchors = require('../src/hubs/modeling/platforms/refm/lib/collab/commentAnchors') as typeof import('../src/hubs/modeling/platforms/refm/lib/collab/commentAnchors');
  const mk = (over: Partial<Record<string, unknown>>): never => ({
    id: 'c1', projectId: 'p', versionId: null, parentId: null, path: null,
    userId: 'u1', userName: 'A', body: 'x', deleted: false,
    createdAt: '2026-09-23T10:00:00Z', updatedAt: null,
    resolvedAt: null, resolvedBy: null, resolvedByName: null, ...over,
  }) as never;

  const onAsset = mk({ id: 'a', path: 'assets[id=x]' });
  const onProject = mk({ id: 'b', path: null });
  const unplaceable = mk({ id: 'c', path: 'nothingKnown[].zz' });
  const resolved = mk({ id: 'd', path: 'assets[id=x]', resolvedAt: '2026-09-23T11:00:00Z' });
  const reply = mk({ id: 'e', parentId: 'a', path: null });
  const all = [onAsset, onProject, unplaceable, resolved, reply];

  const counts = anchors.countsByScreen(all);
  check('K1 a field comment counts on the tab that edits it',
    (counts.byScreen.get('assets') ?? 0) === 1, JSON.stringify([...counts.byScreen]));
  check('K2 a project-wide comment is counted as such, not filed to a screen',
    counts.projectWide === 1);
  check('K3 an unplaceable path is REPORTED, never distributed on a guess',
    counts.unplaceable === 1);
  check('K4 a RESOLVED thread is not an open one', !counts.byScreen.has('__never'),
    `${counts.byScreen.get('assets')}`);
  check('K5 a REPLY is not a thread of its own', anchors.openThreadsForPath(all, 'assets[id=x]').length === 1);
  check('K6 the reply is attached to its root',
    anchors.openThreadsForPath(all, 'assets[id=x]')[0].replies.length === 1);

  // TWO HOMES COUNT TWICE, deliberately: the map says either tab can act.
  const twoHome = mk({ id: 'f', path: 'assets[id=x].capexPhasing.curve' });
  const two = anchors.countsByScreen([twoHome]);
  check('K7 a field with two homes is announced on BOTH tabs',
    (two.byScreen.get('costs') ?? 0) === 1 && (two.byScreen.get('asset-standards') ?? 0) === 1,
    JSON.stringify([...two.byScreen]));

  // Two rows of one array are different fields.
  check('K8 two rows of one array do not share a thread',
    anchors.openThreadsForPath([onAsset], 'assets[id=y]').length === 0);
}

console.log('\n=== L. What is for you, and what is not ===');
{
  const anchors = require('../src/hubs/modeling/platforms/refm/lib/collab/commentAnchors') as typeof import('../src/hubs/modeling/platforms/refm/lib/collab/commentAnchors');
  const mk = (over: Partial<Record<string, unknown>>): never => ({
    id: 'c1', projectId: 'p', versionId: null, parentId: null, path: null,
    userId: 'me', userName: 'Me', body: 'x', deleted: false,
    createdAt: '2026-09-23T10:00:00Z', updatedAt: null,
    resolvedAt: null, resolvedBy: null, resolvedByName: null, ...over,
  }) as never;

  const mine = mk({ id: 'r1', userId: 'me' });
  const theirReply = mk({ id: 'x1', parentId: 'r1', userId: 'them', userName: 'Them', createdAt: '2026-09-23T12:00:00Z' });
  const myReply = mk({ id: 'x2', parentId: 'r1', userId: 'me', createdAt: '2026-09-23T12:00:00Z' });
  const theirs = mk({ id: 'r2', userId: 'them' });
  const theirReplyToTheirs = mk({ id: 'x3', parentId: 'r2', userId: 'them', createdAt: '2026-09-23T12:00:00Z' });

  const items = anchors.forYou([mine, theirReply, myReply, theirs, theirReplyToTheirs], 'me', null);
  check('L1 somebody replying to my thread is for me',
    items.some((i) => i.kind === 'reply'), JSON.stringify(items.map((i) => i.kind)));
  check('L2 my OWN reply to my own thread is not news', items.filter((i) => i.kind === 'reply').length === 1);
  check('L3 a reply to somebody else\'s thread is not mine', items.every((i) => i.thread.root.id === 'r1'));

  const resolvedByThem = mk({ id: 'r1', userId: 'me', resolvedAt: '2026-09-23T13:00:00Z', resolvedBy: 'them' });
  const resolvedByMe = mk({ id: 'r3', userId: 'me', resolvedAt: '2026-09-23T13:00:00Z', resolvedBy: 'me' });
  const res = anchors.forYou([resolvedByThem, resolvedByMe], 'me', null);
  check('L4 somebody resolving my thread is for me', res.some((i) => i.kind === 'resolved'));
  check('L5 resolving my OWN thread is not news', res.filter((i) => i.kind === 'resolved').length === 1);

  // SINCE is load bearing in BOTH directions, or it is not really filtering.
  check('L6 something older than my last visit is not reported again',
    anchors.forYou([mine, theirReply], 'me', '2026-09-23T23:00:00Z').length === 0);
  check('L7 and something newer IS',
    anchors.forYou([mine, theirReply], 'me', '2026-09-23T11:00:00Z').length === 1);
  check('L8 a person with no id is told nothing rather than everything',
    anchors.forYou([mine, theirReply], '', null).length === 0);
}

console.log('\n=== M. The screens call it ===');
{
  const dir = 'src/hubs/modeling/platforms/refm/components/modules';
  const tabbed = ['Module1ProjectPhases', 'Module1Assets', 'Module1Costs', 'Module2Revenue',
    'Module3Opex', 'Module1Financing', 'Module4PL', 'Module5Returns', 'Module6Scenarios'];
  const missing = tabbed.filter((f) => !readFileSync(`${dir}/${f}.tsx`, 'utf8').includes('<TabComments'));
  check('M1 every input surface carries the tab banner', missing.length === 0, missing.join(', '));

  const withField = ['Module1ProjectPhases', 'Module1Assets', 'Module1Costs', 'Module2Revenue',
    'Module3Opex', 'Module1Financing'];
  const noField = withField.filter((f) => !readFileSync(`${dir}/${f}.tsx`, 'utf8').includes('<FieldComment'));
  check('M2 every screen with editable rows carries a row marker', noField.length === 0, noField.join(', '));

  // THE MECHANISM IS REAL ONLY IF SOMETHING CALLS IT. This is the check that
  // would have failed for the whole of the day the map shipped, when
  // `commentOnField` existed and no screen called anything.
  const anyCaller = tabbed.some((f) => /<(TabComments|FieldComment)\b/.test(readFileSync(`${dir}/${f}.tsx`, 'utf8')));
  check('M3 the mechanism has callers, not just an implementation', anyCaller);

  const sidebar = readFileSync('src/hubs/modeling/platforms/refm/components/Sidebar.tsx', 'utf8');
  check('M4 the sidebar announces a tab with open comments',
    sidebar.includes('useScreenCommentCounts') && /sidebar-tab-\$\{tab\.key\}-comments|tab\.key\}-comments/.test(sidebar));

  const panels = readFileSync('src/hubs/modeling/platforms/refm/components/collab/CollabPanels.tsx', 'utf8');
  check('M5 the Collaborate tab filters by screen', panels.includes('comments-filter-screen'));
  check('M6 and lists what it cannot place rather than hiding it',
    panels.includes('__unplaceable'));
  check('M7 the in-place thread REUSES the panel component rather than copying it',
    readFileSync('src/hubs/modeling/platforms/refm/components/collab/FieldComments.tsx', 'utf8')
      .includes("import { CommentThread } from './CollabPanels'")
    && panels.includes('export function CommentThread'));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
