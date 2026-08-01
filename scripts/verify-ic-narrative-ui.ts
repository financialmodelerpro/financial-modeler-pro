/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scripts/verify-ic-narrative-ui.ts
 *
 * Unit 8 verifier: Generate buttons, quota UI, and the review step.
 *
 * The load-bearing claims here are about what CANNOT happen, so they are tested
 * from that direction:
 *
 *   1. A DRAFT CANNOT REACH A SLIDE WITHOUT A DECISION. The panel hands drafts
 *      up; only the review modal's Apply produces a patch. Asserted
 *      structurally (the panel never patches) and behaviourally (a target plus
 *      a draft produces a patch only when asked).
 *   2. THE TARGET RESOLUTION IS REAL. Every narrative field must resolve to a
 *      block on a deck seeded from the ACTUAL templates, built from a model the
 *      ACTUAL engine produced. A template heading change would break this,
 *      which is the point: it fails here rather than silently writing a draft
 *      into the wrong object.
 *   3. RESOLUTION NEVER GUESSES. A slide whose block was deleted yields no
 *      target rather than the nearest text object, because guessing would
 *      eventually overwrite a slide title.
 *   4. THE UI MIRRORS THE SERVER, NEVER SUBSTITUTES FOR IT. The quota shown
 *      comes from the server response; an unknown allowance renders as unknown
 *      rather than as zero.
 *
 * Pure + engine. No database, no network, no API key:
 *   npx tsx scripts/verify-ic-narrative-ui.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { buildICReportModel, type ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { seedDeck } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import {
  NARRATIVE_TEMPLATE_MAP,
  buildNarrativePatch,
  findNarrativeTarget,
  findNarrativeTargets,
  objectNarrativeText,
} from '../src/hubs/modeling/platforms/refm/lib/reports/deck/narrativeTargets';
import { isPlaceholderText } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/placeholders';
import { IC_NARRATIVE_FIELDS, IC_NARRATIVE_FIELD_KEYS } from '../src/hubs/modeling/platforms/refm/lib/ai/icNarrative';
import { DECK_THEME } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/theme';
import type { Deck } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ok(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, actual === expected);
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const UI_REL = 'src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi.tsx';
const TARGETS_REL = 'src/hubs/modeling/platforms/refm/lib/reports/deck/narrativeTargets.ts';
const SHELL_REL = 'src/hubs/modeling/platforms/refm/components/modules/Module7Deck.tsx';
const ROUTE_REL = 'app/api/refm/projects/[id]/ai/ic-narrative/route.ts';

// ---------------------------------------------------------------------------
//  A real model and a real seeded deck
// ---------------------------------------------------------------------------

function buildState(withCases: boolean): any {
  const project: any = makeDefaultProject();
  project.name = 'Narrative UI Development';
  project.location = 'Riyadh';
  project.country = 'KSA';
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };

  const p1: any = {
    ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2026-01-01',
    constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
    dividendPolicy: { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.5, mode: 'cash_above_min' },
  };
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: {
      assetId: 'H1', daysPerYear: 365, startingADR: 900,
      adrIndexation: { method: 'yoy_compound', rate: 0.03 },
      occupancyPerPeriodByPhase: Array(11).fill(0.75), guestsPerOccupiedRoom: 1.5,
      fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } },
      otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } },
    } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [
      { id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000,
        indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' },
    ] },
  };
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };

  return {
    project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [parcel],
    costLines: makeDefaultCostLines('p1', 2), costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [],
    ...(withCases ? { cases: [{ id: 'base', name: 'Management' }, { id: 'down', name: 'Downside' }] } : {}),
  };
}

function buildModel(state: any, scenarios: any = null): ICReportModel {
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  return buildICReportModel({
    project: state.project, phases: state.phases, assets: state.assets, subUnits: state.subUnits,
    rs, snap, parties: [], asOf: '2026-08-01', scenarios,
  });
}

async function main() {
  const state = buildState(false);
  const model = buildModel(state);
  const deck: Deck = seedDeck('proj-1', model, { inputs: null } as any, { asOf: '2026-08-01' });

  ok('the deck seeded slides to target', deck.slides.length > 5, `got ${deck.slides.length}`);

  // ── 1. Every mapped field resolves on a freshly seeded deck ──────────────
  const targets = findNarrativeTargets(deck);
  const found = new Set(targets.map((t) => t.field));

  // Scenario takeaway needs a multi-case model, so it is legitimately absent
  // here. Every other field must resolve.
  const expectedHere = IC_NARRATIVE_FIELD_KEYS.filter((k) => k !== 'scenarioTakeaway');
  for (const k of expectedHere) {
    ok(`"${k}" resolves to a block on the seeded deck`, found.has(k),
      `resolved: ${[...found].join(', ')}`);
  }
  eq('the single-case deck has no scenario target', found.has('scenarioTakeaway'), false);

  for (const t of targets) {
    ok(`${t.field} target names its slide`, !!t.slideId && !!t.slideTitle);
    ok(`${t.field} target names an object`, !!t.objectId);
    ok(`${t.field} block kind is writable`, ['text', 'bullets', 'riskMatrix'].includes(t.objectKind));
    const slide = deck.slides[t.slideIndex];
    eq(`${t.field} slideIndex points at its slide`, slide?.id, t.slideId);
    ok(`${t.field} object really lives on that slide`, !!slide?.objects.some((o) => o.id === t.objectId));
  }

  // Placeholder reporting must match how each template actually seeds.
  // Three seed a PLACEHOLDER (nothing to lose); the caption slides seed a
  // generic default SENTENCE, which is real prose and must NOT be reported as
  // empty, or the review would tell the user they are overwriting nothing when
  // they are overwriting a line that is on the slide today.
  const SEEDS_PLACEHOLDER = new Set(['executiveSummary', 'recommendation', 'risks']);
  for (const t of targets) {
    if (SEEDS_PLACEHOLDER.has(t.field)) {
      ok(`${t.field} seeds a placeholder and is reported as empty`, t.isPlaceholder, t.current.slice(0, 70));
    } else {
      ok(`${t.field} seeds default prose and is NOT reported as empty`, !t.isPlaceholder, t.current.slice(0, 70));
      ok(`${t.field} default prose is carried for the review diff`, t.current.trim().length > 20);
    }
  }

  // ── 2. Scenario takeaway appears once the model has cases ────────────────
  {
    const scenarios: any = {
      baseId: 'base',
      columns: [
        { id: 'base', name: 'Management', values: {}, drivers: [] },
        { id: 'down', name: 'Downside', values: {}, drivers: [] },
      ],
      kpis: [],
    };
    const multiState = buildState(true);
    const snapM = computeFinancialsSnapshot(multiState);
    const rsM = computeReturnsSnapshot(snapM, multiState.project);
    const multi = buildICReportModel({
      project: multiState.project, phases: multiState.phases, assets: multiState.assets,
      subUnits: multiState.subUnits, rs: rsM, snap: snapM, parties: [], asOf: '2026-08-01',
      scenarios, cases: multiState.cases,
    });
    const deck2: Deck = seedDeck('p', multi, { inputs: null } as any, { asOf: '2026-08-01' });
    const t2 = findNarrativeTarget(deck2, 'scenarioTakeaway');
    ok('scenario takeaway resolves when the deck has a scenario slide', !!t2,
      `slides: ${deck2.slides.map((s) => s.templateId).join(',')}`);
  }

  // ── 3. Resolution never guesses ──────────────────────────────────────────
  {
    // Delete the risk register; the slide remains but has no writable block.
    const stripped: Deck = {
      ...deck,
      slides: deck.slides.map((s) => (s.templateId === 'key_risks'
        ? { ...s, objects: s.objects.filter((o) => o.type !== 'riskMatrix') }
        : s)),
    };
    eq('a slide whose block was deleted yields no target', findNarrativeTarget(stripped, 'risks'), null);
    ok('and the other targets are unaffected', findNarrativeTargets(stripped).length === targets.length - 1);
  }
  {
    // Two bullet lists on the executive summary: ambiguous, so refuse.
    const dupe: Deck = {
      ...deck,
      slides: deck.slides.map((s) => {
        if (s.templateId !== 'executive_summary') return s;
        const b = s.objects.find((o) => o.type === 'bullets');
        return b ? { ...s, objects: [...s.objects, { ...b, id: 'extra-bullets' }] } : s;
      }),
    };
    eq('an ambiguous slide yields no target rather than a guess',
      findNarrativeTarget(dupe, 'executiveSummary'), null);
  }
  {
    const renamed: Deck = {
      ...deck,
      slides: deck.slides.map((s) => (s.templateId === 'returns'
        ? { ...s, objects: s.objects.map((o) => (o.type === 'shape' && o.name?.startsWith('Caption:') ? { ...o, name: 'Caption: Something else' } : o)) }
        : s)),
    };
    eq('a renamed caption yields no target rather than the wrong text',
      findNarrativeTarget(renamed, 'returnsCommentary'), null);
  }
  eq('a null deck yields nothing', findNarrativeTargets(null).length, 0);
  eq('an empty deck yields nothing', findNarrativeTargets({ slides: [] } as any).length, 0);

  // ── 4. The caption body is targeted, never the heading ───────────────────
  {
    const t = findNarrativeTarget(deck, 'returnsCommentary');
    ok('returns commentary resolved', !!t);
    if (t) {
      const slide = deck.slides.find((s) => s.id === t.slideId)!;
      const obj: any = slide.objects.find((o) => o.id === t.objectId);
      eq('the targeted object is a text block', obj?.type, 'text');
      ok('and it is NOT the caption heading', (obj?.text ?? '') !== 'Reading the returns', obj?.text);
      ok('and it is not the slide title', !/Returns Analysis/.test(obj?.text ?? ''));
    }
  }

  // ── 5. Patches match the block shape ─────────────────────────────────────
  {
    const bulletsTarget = findNarrativeTarget(deck, 'executiveSummary')!;
    const p: any = buildNarrativePatch(bulletsTarget, { draft: 'First point.\nSecond point.\n- Third point.' });
    ok('a bullets block receives items', Array.isArray(p?.items));
    eq('lines become items', p.items.length, 3);
    eq('a bullet marker is stripped', p.items[2], 'Third point.');

    const textTarget = findNarrativeTarget(deck, 'returnsCommentary')!;
    const p2: any = buildNarrativePatch(textTarget, { draft: 'The spread carries the return.' });
    eq('a text block receives text', p2.text, 'The spread carries the return.');
    eq('and not items', p2.items, undefined);

    const riskTarget = findNarrativeTarget(deck, 'risks')!;
    const slide = deck.slides.find((s) => s.id === riskTarget.slideId)!;
    const existing: any = slide.objects.find((o) => o.id === riskTarget.objectId);
    const p3: any = buildNarrativePatch(riskTarget, {
      draft: 'ignored for a risk register',
      risks: [{ risk: 'Leverage is high', mitigant: 'Cash sweep' }, { risk: 'Exit concentration', mitigant: 'Phase the sale' }],
    }, existing);
    eq('a risk register receives rows', p3.rows.length, 2);
    eq('the risk text maps across', p3.rows[0].risk, 'Leverage is high');
    eq('the mitigant maps to mitigation', p3.rows[0].mitigation, 'Cash sweep');
    ok('likelihood is inherited, not invented', p3.rows[0].likelihood === existing.rows[0].likelihood);
    eq('a row past the existing ones defaults to Medium', p3.rows[1].impact, existing.rows[1]?.impact ?? 'Medium');

    eq('an empty draft produces no patch', buildNarrativePatch(textTarget, { draft: '   ' }), null);
    eq('a risk register with no rows produces no patch', buildNarrativePatch(riskTarget, { draft: 'x', risks: [] }), null);
  }

  // ── 6. Reading the current text, for the review diff ─────────────────────
  {
    const t = findNarrativeTarget(deck, 'executiveSummary')!;
    ok('current text is read from the block', t.current.length > 0);
    ok('a seeded block reads as placeholder', isPlaceholderText(t.current.split('\n')[0]));

    const authored: Deck = {
      ...deck,
      slides: deck.slides.map((s) => (s.templateId === 'executive_summary'
        ? { ...s, objects: s.objects.map((o) => (o.type === 'bullets' ? { ...o, items: ['A real point the user wrote.'] } : o)) }
        : s)),
    };
    const t2 = findNarrativeTarget(authored, 'executiveSummary')!;
    eq('an authored block is NOT reported as placeholder', t2.isPlaceholder, false);
    eq('and its text is carried for the diff', t2.current, 'A real point the user wrote.');
  }

  // ── 6b. Rendered text per block kind, and the field labels the UI shows ──
  {
    const byKind = new Map(targets.map((t) => [t.objectKind, t]));
    for (const [kind, t] of byKind) {
      const slide = deck.slides.find((s) => s.id === t.slideId)!;
      const obj = slide.objects.find((o) => o.id === t.objectId)!;
      const rendered = objectNarrativeText(obj);
      ok(`a ${kind} block renders readable text for the review`, rendered.trim().length > 0);
      eq(`and it matches what the target carries (${kind})`, rendered, t.current);
    }
    for (const t of targets) {
      const spec = IC_NARRATIVE_FIELDS[t.field];
      ok(`${t.field} has a button label`, !!spec?.label && spec.label.length > 3);
    }
  }

  // ── 7. The map covers exactly the six fields ─────────────────────────────
  {
    const mapped = new Set(Object.values(NARRATIVE_TEMPLATE_MAP).map((m) => m.field));
    eq('every narrative field has a slide mapping', mapped.size, IC_NARRATIVE_FIELD_KEYS.length);
    for (const k of IC_NARRATIVE_FIELD_KEYS) ok(`"${k}" is mapped to a template`, mapped.has(k));
    const templateIds = new Set(deck.slides.map((s) => s.templateId));
    for (const id of Object.keys(NARRATIVE_TEMPLATE_MAP)) {
      if (id === 'scenario_comparison') continue; // gated on a multi-case model
      ok(`mapped template "${id}" exists in the seeded deck`, templateIds.has(id));
    }
  }

  // ── 8. UI contract, read structurally ────────────────────────────────────
  const ui = code(UI_REL);
  const uiRaw = read(UI_REL);

  ok('the panel never patches the deck itself',
    !/updateObject|onObjectPatch|buildNarrativePatch/.test(ui));
  ok('applying is routed through the shell', /onApply/.test(ui));
  ok('the review modal exists', /export function NarrativeReviewModal/.test(ui));
  ok('the draft is editable in the review', /<textarea/.test(uiRaw));
  ok('the review shows what is on the slide now', /ON THE SLIDE NOW/.test(uiRaw));
  ok('there is a per-field Apply', /ai-apply-/.test(uiRaw));
  ok('there is a per-field Discard', /ai-discard-/.test(uiRaw));
  ok('there is an Apply all', /ai-review-apply-all/.test(uiRaw));

  ok('a Generate button is rendered per field', /ai-generate-\$\{t\.field\}|ai-generate-/.test(uiRaw));
  ok('there is a Generate all', /ai-generate-all/.test(uiRaw));
  ok('generate all runs sequentially, not in parallel',
    /for \(const t of targets\)/.test(ui) && !/Promise\.all/.test(ui));
  ok('the panel states the cost of generate all', /Generate all \(\$\{allCost\}\)|allCost/.test(uiRaw));
  ok('a partial allowance is warned about before spending', /ai-partial-warning/.test(uiRaw));

  ok('the cap notice names the limit', /Monthly AI limit reached/.test(uiRaw));
  ok('the cap notice carries an upgrade route', /ai-upgrade-link/.test(uiRaw) && /\/pricing/.test(uiRaw));
  ok('an unknown allowance is not rendered as zero', /allowance not available/.test(uiRaw));
  ok('the panel hides itself when the feature is off', /!status\.enabled\) return null/.test(ui));
  ok('the quota comes from the server response, not a local counter',
    /res\.data\.meter\.remaining/.test(ui) && !/remaining - 1|remaining -= /.test(ui));

  ok('the audit result is surfaced per draft', /ai-audit-flag-|ai-audit-ok-/.test(uiRaw));
  ok('unsupported figures are listed for the reviewer', /could not be matched to a figure/.test(uiRaw));

  // Palette: the surface must use the locked deck theme, not ad hoc colours.
  const hexes = (uiRaw.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase());
  const allowed = new Set([
    ...Object.values(DECK_THEME).filter((v) => typeof v === 'string' && /^#/.test(v)).map((v) => (v as string).toUpperCase()),
    '#FFFFFF', '#FBF2F2',
  ]);
  const offPalette = [...new Set(hexes)].filter((h) => !allowed.has(h));
  eq(`every colour is on the deck palette (off-palette: ${offPalette.join(', ')})`, offPalette.length, 0);
  ok('the panel uses DECK_THEME', /DECK_THEME\./.test(ui));

  // ── 9. Shell wiring ──────────────────────────────────────────────────────
  const shell = code(SHELL_REL);
  ok('the shell renders the AI panel', /NarrativeAiPanel/.test(shell));
  ok('the shell renders the review modal', /NarrativeReviewModal/.test(shell));
  ok('applying goes through commit, so it is undoable and marks the deck dirty',
    /applyNarrativeDrafts[\s\S]{0,400}commit\(/.test(shell));
  ok('applying writes to the DRAFT slide, not the active slide',
    /updateObject\(acc, draft\.target\.slideId/.test(shell));
  ok('the shell fetches AI status', /getIcNarrativeStatus/.test(shell));
  ok('the AI panel is hidden in preview mode', /!presentMode \? \(\s*<>\s*<SectionLabel>AI drafting/.test(read(SHELL_REL)) || /model && !presentMode/.test(shell));
  ok('nothing auto-applies a draft on arrival',
    !/onDrafts=\{\(d\) => applyNarrativeDrafts/.test(shell));

  // ── 10. The status endpoint is read-only ────────────────────────────────
  const route = code(ROUTE_REL);
  ok('the route exposes a GET for status', /export async function GET/.test(route));
  ok('the status path never consumes a credit', !/checkAndConsume/.test(route));
  ok('status reports the toggle state', /enabled/.test(route));
  ok('status reports the remaining allowance', /remaining/.test(route));
  ok('status still checks project ownership', /getProject\(/.test(route));
  const getBlock = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  ok('the GET handler makes no AI call', !/runAi|generateIcNarrative/.test(getBlock));

  // ── 10b. Containment: the AI section cannot take the tab down ────────────
  //
  // Added after a live 500 on the Presentation tab. Whatever the cause turns
  // out to be, an accessory on the tab must never be able to break the tab, so
  // the properties below are pinned rather than assumed.
  {
    const shellRaw = read(SHELL_REL);
    ok('the AI section is wrapped in an error boundary', /<NarrativeAiBoundary>/.test(shellRaw));
    ok('the review modal is wrapped too', (shellRaw.match(/<NarrativeAiBoundary>/g) ?? []).length >= 2,
      `found ${(shellRaw.match(/<NarrativeAiBoundary>/g) ?? []).length}`);
    ok('the boundary renders nothing on failure, not an error box',
      /this\.state\.failed \? null : this\.props\.children/.test(code(UI_REL)));
    ok('a boundary failure is logged rather than swallowed',
      /componentDidCatch[\s\S]{0,300}console\.error/.test(code(UI_REL)));

    // The status fetch must fail soft: any failure resolves to a null status,
    // which hides the section. A throw escaping that effect would surface in
    // the tab.
    ok('the status fetch is wrapped in try/catch',
      /try \{[\s\S]{0,400}getIcNarrativeStatus[\s\S]{0,400}\} catch/.test(code(SHELL_REL)));
    ok('a failed status fetch sets null rather than leaving stale state',
      /catch[\s\S]{0,220}setAiStatus\(null\)/.test(code(SHELL_REL)));

    // Why the client-side boundary is sufficient: the AI section never renders
    // on the server, because the shell returns early while the deck is null and
    // the deck arrives from an effect.
    ok('the shell returns early while the deck is null', /if \(!deck\) return </.test(code(SHELL_REL)));
    ok('the AI section sits after that guard',
      code(SHELL_REL).indexOf('if (!deck) return <') < code(SHELL_REL).indexOf('<NarrativeAiBoundary>'));

    // The segment must never be statically prerendered: it is per-user.
    const layout = read('app/refm/layout.tsx');
    ok('the /refm segment is explicitly dynamic', /export const dynamic = 'force-dynamic'/.test(layout));
    ok('the layout reads the session, which is why it must be dynamic', /getServerSession/.test(layout));
  }

  // ── 10c. NO HOOK AFTER AN EARLY RETURN. The regression guard. ────────────
  //
  // This is the check that would have caught the live 500. Unit 8 added a
  // useCallback BELOW the component's early returns (no project / loading / no
  // model / no deck). On the first render the component bailed at `loading` and
  // never reached it; once the deck loaded it did, so React counted one more
  // hook than the render before and threw "Rendered more hooks than during the
  // previous render", killing the whole Presentation tab. It fired whether the
  // AI feature was on or off, because the hook ran regardless of the feature.
  //
  // ESLint's rules-of-hooks catches this too, and did. It is pinned here as
  // well because this file is the one a future AI unit will edit, and a lint
  // error is easy to scroll past where a failing verifier is not.
  {
    const src = read(SHELL_REL);
    const start = src.indexOf('export default function Module7Deck');
    ok('the deck component was found', start > 0);
    // The component body ends where the next top-level declaration begins.
    const after = src.slice(start);
    const endRel = after.slice(1).search(/\n(?:function|const|export) [A-Za-z]/);
    const body = endRel > 0 ? after.slice(0, endRel + 1) : after;

    const firstGuard = body.search(/\n {2}if \(![A-Za-z]+\) return </);
    ok('the component has early returns', firstGuard > 0);

    const tail = body.slice(firstGuard);
    const hooksAfter = [...tail.matchAll(/\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useContext)\s*\(/g)]
      .map((m) => m[1]);
    eq(`no React hook is called after an early return (found: ${hooksAfter.join(', ')})`, hooksAfter.length, 0);
  }

  // ── 11. House style ──────────────────────────────────────────────────────
  for (const rel of [UI_REL, TARGETS_REL]) {
    ok(`${rel} carries no em dash`, !/[\u2014\u2015]/.test(read(rel)));
  }

  console.log(`\nverify-ic-narrative-ui: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
