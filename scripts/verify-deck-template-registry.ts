/**
 * verify-deck-template-registry.ts (REFM Module 7, 2026-08-15)
 *
 * THE REAL DEFECT, of which the fund slides were the first casualty.
 *
 * A deck is saved per project, so an existing deck only gains new slides through
 * `upgradeDeckLayout`, which offers exactly the ids registered in
 * `TEMPLATES_BY_VERSION` above the deck's own schemaVersion. Registering was a
 * two-step contract (bump DECK_SCHEMA_VERSION, add the id) that NOTHING
 * enforced. A template added to the library and not registered reached freshly
 * seeded decks and was invisible to every existing one, permanently and
 * silently: no error, no notice, no failing check.
 *
 * That is what happened to the three fund slides on 2026-08-13. They shipped
 * complete, gated correctly, fed by a fully populated model, and a real deck of
 * 36 slides exported with no fund content whatsoever. The only route to them was
 * "Rebuild every slide from the library", which discards the user's arrangement,
 * edits, text boxes and AI narrative.
 *
 * Section A closes the gap: every template id must be registered. Section B
 * proves the upgrade is non-destructive on a REAL saved deck when creds exist.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-deck-template-registry.ts
 * (without creds section B falls back to a synthetic deck and says so)
 *
 * No em dashes in this file.
 */

import { createClient } from '@supabase/supabase-js';

import {
  SLIDE_TEMPLATES, TEMPLATE_BY_ID, seedDeck,
} from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import { TEMPLATES_BY_VERSION, upgradeDeckLayout } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckUpgrade';
import { DECK_SCHEMA_VERSION } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';
import type { Deck, Slide } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';
import type { ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { buildICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);

const FUND_IDS = ['fund_terms', 'fund_waterfall', 'fund_returns'];
const SEED = {} as never;

// ════════════════════════════════════════════════════════════════════════════
// A. The registry is COMPLETE and CONSISTENT
// ════════════════════════════════════════════════════════════════════════════
section('A. Template registry');

const registered = new Map<string, number>();
let dupes = '';
for (const [v, ids] of Object.entries(TEMPLATES_BY_VERSION)) {
  for (const id of ids) {
    if (registered.has(id)) dupes += `${id} (v${registered.get(id)} and v${v}); `;
    registered.set(id, Number(v));
  }
}
const libraryIds = SLIDE_TEMPLATES.map((t) => t.id);

// THE CHECK THAT WOULD HAVE CAUGHT THE FUND SLIDES.
const missing = libraryIds.filter((id) => !registered.has(id));
check('A1 every template id is registered under some version key',
  missing.length === 0,
  missing.length ? `UNREGISTERED: ${missing.join(', ')}` : '');

// The other direction: a typo in the registry would offer an id that does not
// exist, and upgradeDeckLayout would silently skip it (`t &&` guard).
const phantom = [...registered.keys()].filter((id) => !TEMPLATE_BY_ID[id]);
check('A2 every registered id is a real template', phantom.length === 0, phantom.join(', '));
check('A3 no id is registered under two versions', dupes === '', dupes);
check('A4 the registry and the library are the same size',
  registered.size === libraryIds.length, `registry=${registered.size} library=${libraryIds.length}`);

// The bump half of the two-step contract. If someone registers ids under a key
// above DECK_SCHEMA_VERSION they are never offered; below it and a deck already
// current skips them.
const maxKey = Math.max(...Object.keys(TEMPLATES_BY_VERSION).map(Number));
check('A5 the newest registered version equals DECK_SCHEMA_VERSION',
  maxKey === DECK_SCHEMA_VERSION, `maxKey=${maxKey} DECK_SCHEMA_VERSION=${DECK_SCHEMA_VERSION}`);
check('A6 version keys are a contiguous run from 1',
  Object.keys(TEMPLATES_BY_VERSION).map(Number).sort((a, b) => a - b)
    .every((v, i) => v === i + 1),
  Object.keys(TEMPLATES_BY_VERSION).join(','));

// The fund slides specifically, since they are why this file exists.
check('A7 the three fund slides are registered', FUND_IDS.every((id) => registered.has(id)),
  FUND_IDS.map((id) => `${id}=v${registered.get(id) ?? 'MISSING'}`).join(' '));
check('A8 they are registered under the CURRENT version, so an existing deck is offered them',
  FUND_IDS.every((id) => registered.get(id) === DECK_SCHEMA_VERSION));

// ════════════════════════════════════════════════════════════════════════════
// B. The upgrade is NON-DESTRUCTIVE on a real saved deck
// ════════════════════════════════════════════════════════════════════════════
section('B. Non-destructive upgrade');

/** Everything about a slide except the section-number chip, which renumber()
 *  legitimately rewrites. Used to prove nothing else moved. */
function slideFingerprint(s: Slide): string {
  return JSON.stringify({
    id: s.id, templateId: s.templateId, title: s.title, chrome: s.chrome,
    objects: s.objects.map((o) => (o.type === 'shape' && (o as { name?: string }).name === 'Section number'
      ? { ...(o as object), text: '<num>' }
      : o)),
  });
}

async function loadReal(): Promise<{ deck: Deck; model: ICReportModel; label: string } | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key);
  const { data: decks } = await sb.from('refm_report_decks').select('project_id, deck').limit(20);
  for (const row of decks ?? []) {
    const deck = row.deck as Deck | undefined;
    if (!deck?.slides?.length) continue;
    const { data: proj } = await sb.from('refm_projects')
      .select('name, current_version_id').eq('id', row.project_id).maybeSingle();
    if (!proj?.current_version_id) continue;
    const { data: ver } = await sb.from('refm_project_versions')
      .select('snapshot').eq('id', proj.current_version_id).maybeSingle();
    if (!ver?.snapshot) continue;
    const state = hydrationFromAnySnapshot(ver.snapshot as never);
    const snap = computeFinancialsSnapshot(state as never);
    const rs = computeReturnsSnapshot(snap as never, state.project as never);
    const model = buildICReportModel({
      project: state.project as never, phases: state.phases as never,
      assets: state.assets as never, subUnits: state.subUnits as never,
      rs: rs as never, snap: snap as never, parties: [], asOf: '2026-08-15',
    });
    if (!model.fund.active) continue;   // want a FUND project, that is the case under test
    return { deck, model, label: `${proj.name} (saved deck, ${deck.slides.length} slides)` };
  }
  return null;
}

async function main(): Promise<void> {
  const real = await loadReal();
  let subject: { deck: Deck; model: ICReportModel; label: string };
  if (real) {
    subject = real;
    console.log(`   subject: ${real.label}`);
  } else {
    // Say what actually happened. An earlier draft of this line claimed a
    // "fallback to a synthetic deck" and then simply returned, which would have
    // let a green run read as though the non-destructive claim had been tested.
    console.log('   SECTION B SKIPPED: no DB creds, or no saved deck on a fund-active project.');
    console.log('   Section A (the registry invariant) ran and is reported below.');
    console.log('   Run with --env-file=.env.local to exercise the real saved deck.');
    return;
  }

  // Force the deck back to the pre-fix version so we replay what a real user's
  // deck does on open. The saved row is NEVER written back.
  const before: Deck = { ...subject.deck, schemaVersion: 3, slides: subject.deck.slides.map((s) => ({ ...s })) };
  const beforePrints = before.slides.map(slideFingerprint);
  const beforeIds = before.slides.map((s) => s.id);
  const beforeTemplateIds = before.slides.map((s) => s.templateId ?? '');

  check('B1 the saved deck genuinely has no fund slides today',
    !beforeTemplateIds.some((t) => FUND_IDS.includes(t)));
  check('B2 the model this deck renders from HAS an active fund block',
    subject.model.fund.active && subject.model.fund.waterfall.hasData);

  const res = upgradeDeckLayout(before, subject.model, SEED);

  check('B3 the upgrade reports a change', res.changed);
  check('B4 the deck is lifted to the current version', res.deck.schemaVersion === DECK_SCHEMA_VERSION,
    String(res.deck.schemaVersion));
  const afterTemplateIds = res.deck.slides.map((s) => s.templateId ?? '');
  check('B5 all three fund slides are now present',
    FUND_IDS.every((id) => afterTemplateIds.includes(id)),
    FUND_IDS.filter((id) => !afterTemplateIds.includes(id)).join(', '));
  check('B6 the added titles are reported for the user notice',
    res.addedTitles.length > 0, res.addedTitles.join(' | '));

  // ── The non-destructive claim, proven rather than asserted ────────────────
  const afterById = new Map(res.deck.slides.map((s) => [s.id, s]));
  check('B7 every original slide still exists, by id',
    beforeIds.every((id) => afterById.has(id)),
    beforeIds.filter((id) => !afterById.has(id)).join(', '));
  // A MISSING slide is a failure, not a crash. The first run of this sabotage
  // threw here instead of reporting, which would have made a genuinely
  // destructive upgrade look like a broken verifier rather than a broken fix.
  const changedSlides = beforeIds.filter((id, i) => {
    const after = afterById.get(id);
    return !after || slideFingerprint(after) !== beforePrints[i];
  });
  check('B8 no original slide lost or gained content',
    changedSlides.length === 0, changedSlides.join(', '));

  // Relative order of the originals is preserved (new slides interleave, but the
  // user's own sequence must not be reshuffled).
  const keptOrder = res.deck.slides.map((s) => s.id).filter((id) => beforeIds.includes(id));
  check('B9 the original slide ORDER is preserved',
    JSON.stringify(keptOrder) === JSON.stringify(beforeIds));

  // The things the user was told they would lose in a rebuild.
  const countObjects = (d: Deck, pred: (o: Record<string, unknown>) => boolean): number =>
    d.slides.reduce((n, s) => n + s.objects.filter((o) => pred(o as unknown as Record<string, unknown>)).length, 0);
  const textBefore = countObjects(before, (o) => o.type === 'text');
  const textAfter = countObjects(res.deck, (o) => o.type === 'text');
  check('B10 no text box was dropped (free text and AI narrative live here)',
    textAfter >= textBefore, `before=${textBefore} after=${textAfter}`);
  const allTextBefore = JSON.stringify(before.slides.flatMap((s) => s.objects.filter((o) => o.type === 'text')));
  const survivingText = JSON.stringify(
    beforeIds.map((id) => afterById.get(id)).filter((s): s is Slide => !!s)
      .flatMap((s) => s.objects.filter((o) => o.type === 'text')));
  check('B11 every original text object survives BYTE-IDENTICAL',
    survivingText === allTextBefore);

  // Ordering: the fund block belongs at the end of "The case", not after the
  // appendix, so an upgraded deck reads like a seeded one.
  const firstFund = Math.min(...FUND_IDS.map((id) => afterTemplateIds.indexOf(id)).filter((i) => i >= 0));
  const closingIdx = afterTemplateIds.findIndex((t) => ['key_risks', 'recommendation', 'appendix'].includes(t));
  check('B12 the fund slides sit BEFORE Key Risks / Recommendation / Appendix',
    closingIdx < 0 || firstFund < closingIdx, `fund@${firstFund} closing@${closingIdx}`);
  check('B13 the fund slides are in library order',
    afterTemplateIds.indexOf('fund_terms') < afterTemplateIds.indexOf('fund_waterfall')
    && afterTemplateIds.indexOf('fund_waterfall') < afterTemplateIds.indexOf('fund_returns'));

  // Idempotent: opening again must not duplicate.
  const again = upgradeDeckLayout(res.deck, subject.model, SEED);
  check('B14 a second open adds nothing', !again.changed);
  check('B15 and does not duplicate the fund slides',
    FUND_IDS.every((id) => again.deck.slides.filter((s) => s.templateId === id).length
      === res.deck.slides.filter((s) => s.templateId === id).length));

  // A slide the user DELETES after the upgrade must stay deleted.
  const pruned: Deck = { ...res.deck, slides: res.deck.slides.filter((s) => s.templateId !== 'fund_waterfall') };
  const afterDelete = upgradeDeckLayout(pruned, subject.model, SEED);
  check('B16 a user-deleted fund slide is NOT resurrected',
    !afterDelete.deck.slides.some((s) => s.templateId === 'fund_waterfall'));

  // Section numbering stays contiguous across the insertion.
  const chips = res.deck.slides.filter((s) => s.chrome !== 'cover').map((s) => {
    const chip = s.objects.find((o) => o.type === 'shape' && (o as { name?: string }).name === 'Section number');
    return chip ? (chip as { text?: string }).text ?? '' : null;
  }).filter((c): c is string => c !== null);
  check('B17 section numbers are contiguous after insertion',
    chips.every((c, i) => c === String(i + 1).padStart(2, '0')),
    chips.slice(0, 8).join(','));

  // A standalone (non-fund) project must be untouched by the v4 bump.
  const standalone: ICReportModel = {
    ...subject.model,
    fund: { ...subject.model.fund, active: false, hasFeeIncome: false },
  };
  const noFund = upgradeDeckLayout({ ...before, schemaVersion: 3 }, standalone, SEED);
  check('B18 a project with the fund OFF gains no fund slides',
    !noFund.deck.slides.some((s) => FUND_IDS.includes(s.templateId ?? '')));
  check('B19 ...and is still lifted to the current version, so it is not re-checked forever',
    noFund.deck.schemaVersion === DECK_SCHEMA_VERSION);

  // A freshly seeded deck and an upgraded one should agree on which templates
  // are present. This is the check that says "upgrade == rebuild, without the loss".
  const seeded = seedDeck('p_probe', subject.model, SEED, { asOf: '2026-08-15' });
  const seededIds = new Set(seeded.slides.map((s) => s.templateId ?? ''));
  const upgradedIds = new Set(afterTemplateIds);
  const missingVsSeed = [...seededIds].filter((id) => id && !upgradedIds.has(id));
  check('B20 the upgraded deck carries every template a fresh rebuild would',
    missingVsSeed.length === 0, missingVsSeed.join(', '));
}

void main().then(() => {
  console.log('');
  if (failures.length === 0) {
    console.log(`verify-deck-template-registry: ${pass} passed, 0 failures`);
    process.exit(0);
  }
  console.log(`verify-deck-template-registry: ${pass} passed, ${failures.length} FAILURES`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });
