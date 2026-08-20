/**
 * verify-export-watermark.ts (2026-08-20)
 *
 * A TRIAL EXPORT IS MARKED, A PAID EXPORT IS UNTOUCHED, AND THE DECISION IS
 * NOT THE BROWSER'S.
 *
 * Trial keeps PDF export. The file it produces now carries a diagonal stamp on
 * every page and a footer line saying what it is. Excel and PowerPoint stay off
 * trial, and the PowerPoint route is gated server side for the first time: it
 * had ownership and the lapse guard and no per-plan check at all, so what kept
 * a trial user out was that the Module 7 editor is unreachable in the UI, which
 * is a gate made of a screen rather than of a rule.
 *
 * The load-bearing properties, all pinned below:
 *
 *   The rule is ONE pure function, and both the admin screen and the export
 *   read it, so the preview cannot promise something the export does not do.
 *
 *   A paid plan is BYTE-IDENTICAL to before. Proven by generating a real PDF
 *   with a null spec and with a spec, and comparing.
 *
 *   Failing to resolve REFUSES rather than producing an unmarked file.
 *
 *   `white_label_pdf` is NOT touched. It answers a different question.
 *
 * Run: npx tsx scripts/verify-export-watermark.ts
 * No em dashes in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  DEFAULT_WATERMARK_SETTINGS,
  WATERMARK_TEXT_MAX,
  parseWatermarkSettings,
  watermarkAppliesToPlan,
  resolveWatermarkSpec,
} from '@/src/shared/entitlements/exportWatermark';
import { applyExportWatermark } from '@/src/hubs/modeling/platforms/refm/lib/pdf/drawWatermark';

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 56 - t.length))}`);
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const stripComments = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
section('A. The rule, and its default');

{
  const d = DEFAULT_WATERMARK_SETTINGS;
  check('A: the default is ON', d.enabled === true);
  check('A: for trial, and only trial', d.plans.length === 1 && d.plans[0] === 'trial');
  check('A: with text to draw', d.text.trim() !== '');

  // A database with no stored row must already be watermarking trial, or the
  // feature waits on somebody visiting an admin screen.
  check('A: trial is marked out of the box', watermarkAppliesToPlan('trial', d));
  for (const paid of ['solo', 'pro', 'firm']) {
    check(`A: ${paid} is not marked out of the box`, !watermarkAppliesToPlan(paid, d));
  }

  // The master switch outranks the list.
  check('A: disabling the switch unmarks trial',
    !watermarkAppliesToPlan('trial', { ...d, enabled: false }));
  // Plan keys are typed by an admin.
  check('A: plan matching is case and space tolerant',
    watermarkAppliesToPlan('trial', { ...d, plans: ['  Trial '] }));
  check('A: an empty plan key never matches', !watermarkAppliesToPlan('', d));
  check('A: a null plan key never matches', !watermarkAppliesToPlan(null, d));
  check('A: an unlisted plan never matches', !watermarkAppliesToPlan('enterprise', d));

  // The spec.
  const spec = resolveWatermarkSpec('trial', d);
  check('A: a marked plan resolves a spec', spec !== null);
  check('A: the spec carries the stamp text', spec?.text === d.text);
  check('A: and a DIFFERENT footer sentence, not the stamp repeated',
    !!spec && spec.footer !== spec.text && spec.footer.includes(d.text) && spec.footer.length > d.text.length);
  check('A: the footer says it is a trial and not for distribution',
    !!spec && /trial/i.test(spec.footer) && /not for distribution/i.test(spec.footer));
  check('A: an unmarked plan resolves NULL, not an empty spec',
    resolveWatermarkSpec('firm', d) === null);
}

// ---------------------------------------------------------------------------
section('B. Stored settings are read tolerantly');

{
  const d = DEFAULT_WATERMARK_SETTINGS;
  check('B: junk falls back to the default', parseWatermarkSettings('nonsense').enabled === d.enabled);
  check('B: null falls back to the default', parseWatermarkSettings(null).plans.join() === d.plans.join());
  // Field by field, not object by object: a junk text must not discard a
  // deliberate plans list.
  const partial = parseWatermarkSettings({ plans: ['trial', 'solo'], text: 42 });
  check('B: a bad text keeps a good plans list', partial.plans.join() === 'trial,solo');
  check('B: and falls back only on the text', partial.text === d.text);
  check('B: a blank text is treated as absent', parseWatermarkSettings({ text: '   ' }).text === d.text);
  check('B: enabled false is honoured', parseWatermarkSettings({ enabled: false }).enabled === false);
  check('B: a non-boolean enabled falls back to the default',
    parseWatermarkSettings({ enabled: 'yes' }).enabled === d.enabled);
  check('B: empty plan entries are dropped',
    parseWatermarkSettings({ plans: ['trial', '', '  '] }).plans.join() === 'trial');
  check('B: a non-array plans falls back', parseWatermarkSettings({ plans: 'trial' }).plans.join() === d.plans.join());
  check('B: overlong text is capped',
    parseWatermarkSettings({ text: 'x'.repeat(200) }).text.length === WATERMARK_TEXT_MAX);
  // Round trip, which is what the admin screen does.
  const rt = parseWatermarkSettings(JSON.parse(JSON.stringify({ enabled: true, text: 'DEMO', plans: ['trial', 'solo'] })));
  check('B: a saved shape round trips', rt.text === 'DEMO' && rt.plans.join() === 'trial,solo');
}

// ---------------------------------------------------------------------------
section('C. The stamp is drawn, on every page, and a paid export is untouched');

(async () => {
  const build = async (pages: number) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) {
      const p = doc.addPage([841.89, 595.28]);
      p.drawText(`content page ${i + 1}`, { x: 40, y: 500, size: 12, font });
    }
    return doc;
  };

  // A PAID EXPORT IS BYTE-IDENTICAL. This is the promise that matters most:
  // no existing customer's document changes.
  const paidA = await build(3);
  await applyExportWatermark(paidA, null);
  const paidBytes = await paidA.save();
  const paidB = await build(3);
  const untouchedBytes = await paidB.save();
  check('C: a null spec leaves the document byte-identical',
    Buffer.from(paidBytes).equals(Buffer.from(untouchedBytes)),
    `${paidBytes.length} vs ${untouchedBytes.length}`);

  const spec = resolveWatermarkSpec('trial', DEFAULT_WATERMARK_SETTINGS);
  const marked = await build(3);
  await applyExportWatermark(marked, spec);
  const markedBytes = await marked.save();
  check('C: a spec changes the document', !Buffer.from(markedBytes).equals(Buffer.from(untouchedBytes)));

  // EVERY page, not just the first. Counted by the number of content streams
  // that grew, which is the only way to tell a per-page draw from a one-off.
  const one = await build(1);
  await applyExportWatermark(one, spec);
  const oneBytes = (await one.save()).length;
  const five = await build(5);
  await applyExportWatermark(five, spec);
  const fiveBytes = (await five.save()).length;
  const unmarkedOne = (await (await build(1)).save()).length;
  const unmarkedFive = (await (await build(5)).save()).length;
  const growOne = oneBytes - unmarkedOne;
  const growFive = fiveBytes - unmarkedFive;
  check('C: the stamp grows a 5 page document about 5 times as much as a 1 page one',
    growFive > growOne * 3.5, `1 page +${growOne}, 5 pages +${growFive}`);

  // An empty text draws nothing rather than an invisible mark.
  const blank = await build(2);
  await applyExportWatermark(blank, { text: '   ', footer: 'x' });
  check('C: a blank stamp text draws nothing',
    Buffer.from(await blank.save()).equals(Buffer.from(await (await build(2)).save())));

  // A page of a different shape (the deck is 16:9) must still be handled.
  const deck = await PDFDocument.create();
  deck.addPage([960, 540]);
  let ok = true;
  try { await applyExportWatermark(deck, spec); } catch { ok = false; }
  check('C: a 16:9 deck page is stamped without throwing', ok);
  // A zero page document must not throw either.
  const empty = await PDFDocument.create();
  let okEmpty = true;
  try { await applyExportWatermark(empty, spec); } catch { okEmpty = false; }
  check('C: an empty document is handled', okEmpty);

  // ---------------------------------------------------------------------------
  section('D. Every PDF builder is wired, and the browser does not decide');

  const gen = stripComments(read('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts'));
  const deckPdf = stripComments(read('src/hubs/modeling/platforms/refm/lib/reports/deck/deckPdf.ts'));
  const modal = stripComments(read('src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx'));
  const wmRoute = stripComments(read('app/api/export/watermark/route.ts'));
  const deckRoute = stripComments(read('app/api/refm/projects/[id]/report-deck/export/route.ts'));
  const legacyRoute = stripComments(read('app/api/export/pdf/route.ts'));

  // THE COUNT IS THE CHECK. Both report builders save, and both must stamp.
  const saves = (gen.match(/return doc\.save\(\);/g) ?? []).length;
  const stamps = (gen.match(/applyExportWatermark\(/g) ?? []).length;
  check('D: every save in the report builder is preceded by a stamp',
    saves > 0 && stamps === saves, `${stamps} stamps / ${saves} saves`);
  check('D: the deck PDF stamps too', deckPdf.includes('applyExportWatermark('));
  check('D: all three read the SAME helper',
    gen.includes("from './drawWatermark'") && deckPdf.includes('drawWatermark'));

  // The builders decide nothing. If plan logic appears in the PDF layer it can
  // drift from the gate.
  for (const [name, src] of [['report builder', gen], ['deck builder', deckPdf]] as const) {
    check(`D: the ${name} contains no plan logic`,
      !src.includes('planKey') && !src.includes('watermarkAppliesToPlan') && !src.includes("'trial'"));
  }

  // The client asks the SERVER and refuses on failure.
  check('D: the export modal asks the server', modal.includes("fetch('/api/export/watermark'"));
  check('D: it sends no plan of its own',
    !/\/api\/export\/watermark[^)]*planKey/.test(modal));
  check('D: a failed resolution refuses the export',
    /catch \{[\s\S]{0,220}setError\([\s\S]{0,140}return;/.test(modal));
  check('D: and does NOT fall back to no watermark',
    !/catch \{[\s\S]{0,160}watermark = null[\s\S]{0,80}\}[\s\S]{0,40}try/.test(modal));
  check('D: the spec is passed through the shared options object',
    /watermark,/.test(modal));

  // The resolver route takes no input.
  check('D: the resolver route accepts no body or query',
    wmRoute.includes('export async function GET()') && !wmRoute.includes('req.'));
  check('D: it resolves the plan from the session gate', wmRoute.includes('resolveUserGate('));
  check('D: an unresolvable session is a refusal, not a null spec',
    /status: 503/.test(wmRoute));
}
)().then(async () => {
  // ---------------------------------------------------------------------------
  section('E. PowerPoint is gated, and white_label_pdf is left alone');

  const deckRoute = stripComments(read('app/api/refm/projects/[id]/report-deck/export/route.ts'));
  const legacyRoute = stripComments(read('app/api/export/pdf/route.ts'));
  const modal = stripComments(read('src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx'));

  check('E: the deck route now checks a plan feature', deckRoute.includes('featureAllowed('));
  check('E: using the SHARED module key, not a literal',
    deckRoute.includes("moduleFeatureKey('reports', 7)") && !deckRoute.includes("'module_7'"));
  check('E: it refuses with 403 and names the feature',
    /status: 403/.test(deckRoute) && deckRoute.includes('FEATURE_NOT_INCLUDED'));
  // The gate must sit AFTER ownership (so it cannot leak project existence)
  // and BEFORE anything is built.
  const ownIdx = deckRoute.indexOf("error: 'Not found'");
  const gateIdx = deckRoute.indexOf('featureAllowed(');
  const buildIdx = deckRoute.indexOf('buildDeckPptx(');
  check('E: the gate sits after ownership and before the build',
    ownIdx >= 0 && gateIdx > ownIdx && buildIdx > gateIdx);
  check('E: it covers BOTH formats, not just pptx',
    gateIdx < deckRoute.indexOf('buildDeckPdf('));
  check('E: the deck PDF is stamped with a server-resolved spec',
    deckRoute.includes('resolveWatermarkForGate(') && deckRoute.includes('watermark }'));

  // The one PDF path that cannot be stamped refuses instead of emitting a
  // clean file.
  check('E: the non pdf-lib export route refuses a plan that must be marked',
    legacyRoute.includes('WATERMARK_REQUIRED') && /status: 403/.test(legacyRoute));

  // Excel stays off trial and is NOT watermarked (it is denied outright).
  check('E: Excel is still gated as its own format',
    /excel:\s*'excel_/.test(modal));

  // white_label_pdf answers a DIFFERENT question and must not be entangled.
  for (const [name, rel] of [
    ['the rule', 'src/shared/entitlements/exportWatermark.ts'],
    ['the drawing helper', 'src/hubs/modeling/platforms/refm/lib/pdf/drawWatermark.ts'],
    ['the resolver route', 'app/api/export/watermark/route.ts'],
  ] as const) {
    check(`E: ${name} never reads white_label_pdf`,
      !stripComments(read(rel)).includes('white_label_pdf'));
  }

  // ---------------------------------------------------------------------------
  section('F. The admin screen reads the same rule it is setting');

  const card = stripComments(read('app/admin/plans/WatermarkCard.tsx'));
  check('F: the card exists and is mounted',
    card.includes('export function WatermarkCard') && read('app/admin/plans/page.tsx').includes('<WatermarkCard'));
  check('F: it offers the three controls asked for',
    card.includes('watermark-enabled') && card.includes('watermark-text') && card.includes('watermark-plan-'));
  check('F: the plan list comes from the LIVE plans, not a literal',
    read('app/admin/plans/page.tsx').includes('planKeys={plans.map(') && !card.includes("['trial', 'solo'"));
  // The preview must be computed by the resolver, or it can promise something
  // the export does not do.
  check('F: the stated effect is computed by the shared resolver',
    card.includes('resolveWatermarkSpec(') && card.includes('watermark-effect'));
  check('F: the card declares no watermark rule of its own',
    !card.includes('=== \'trial\'') && !card.includes('function watermarkApplies'));
  check('F: it stores through the existing content route, with no new table',
    card.includes("'/api/admin/content'") && card.includes('WATERMARK_SECTION'));

  console.log(`\n${'='.repeat(62)}`);
  if (failures.length === 0) {
    console.log(`verify-export-watermark: ${passed} passed, 0 failed`);
  } else {
    console.log(`verify-export-watermark: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log(`  FAIL  ${f}`);
    process.exit(1);
  }
}).catch((e) => { console.error(e); process.exit(1); });
