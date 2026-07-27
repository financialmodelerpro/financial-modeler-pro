/**
 * verify-deck-toc.ts (REFM Module 7, IC deck: live ToC + hyperlinks)
 *
 * Pins the Table of Contents + hyperlink layer added on 2026-07-26. The ToC is
 * NOT baked: its entries are resolved from the deck's own slide list at export
 * time, and every hyperlink resolves a slide id to a PAGE number, so both survive
 * a reorder. Asserts:
 *
 *   - the ToC lists content slides only (scope 'sections'), excludes itself and
 *     the cover / section dividers, numbers them 01.., and pages them correctly,
 *   - reordering a slide re-pages the ToC entry AND any link to it (auto-sync),
 *   - a hidden slide drops out of the ToC and any link to it is dropped (never a
 *     dangling jump); an external url link passes through,
 *   - coerceDeck keeps a 'toc' object and an object's link across a jsonb round
 *     trip (they are not dropped as unknown),
 *   - the PPTX and PDF exporters build a real file from a deck with a ToC + links.
 *
 * Run: npx tsx scripts/verify-deck-toc.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveDeckExport, tocLayout, type TocPaint } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/exportModel';
import { makeDeckFmt } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import { buildDeckPptx } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckPptx';
import { buildDeckPdf } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckPdf';
import { coerceDeck } from '../src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
import { DEFAULT_BRANDING, textStyles } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/theme';
import type { Deck, DeckObject, Slide } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';
import type { ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

const model = {} as unknown as ICReportModel; // ToC + unbound text never read the model
const fmt = makeDeckFmt(icMoneyScaleSpec('millions', 'SAR'));

const tocObj = (): DeckObject => ({
  id: 'toc1', type: 'toc', x: 48, y: 128, w: 1184, h: 520, rot: 0,
  style: textStyles.body(), heading: 'Agenda', showNumbers: true, showPageNumbers: true, scope: 'sections',
} as any);
const linkText = (targetSlideId: string): DeckObject => ({
  id: 'lk', type: 'text', x: 48, y: 660, w: 200, h: 30, rot: 0, text: 'Go to BS', style: textStyles.body(),
  link: { kind: 'slide', slideId: targetSlideId },
} as any);
const slide = (id: string, title: string, chrome: Slide['chrome'], objects: DeckObject[] = [], hidden = false): Slide =>
  ({ id, title, chrome, objects, hidden } as Slide);

const mkDeck = (slides: Slide[]): Deck => ({
  schemaVersion: 1, projectId: 'p', title: 'IC Deck', slides,
  branding: DEFAULT_BRANDING, settings: { deckCase: 'management', moneyScale: 'millions', asOf: '2026-07-26' },
});

const baseSlides = (): Slide[] => [
  slide('cover', 'Cover', 'cover'),
  slide('toc', 'Contents', 'content', [tocObj(), linkText('bs')]),
  slide('ret', 'Returns Analysis', 'content'),
  slide('is', 'Income Statement', 'content'),
  slide('div', 'Part Two', 'section'),
  slide('bs', 'Balance Sheet', 'content'),
];

const tocOf = (ex: ReturnType<typeof resolveDeckExport>): TocPaint => {
  const s = ex.slides.find((sl) => sl.id === 'toc')!;
  return s.objects.find((o) => o.paint.kind === 'toc')!.paint as TocPaint;
};
const linkOf = (ex: ReturnType<typeof resolveDeckExport>) => {
  const s = ex.slides.find((sl) => sl.id === 'toc')!;
  return s.objects.find((o) => o.id === 'lk')?.link;
};

console.log('=== 1. ToC lists the right slides, numbered + paged ===');
{
  const ex = resolveDeckExport(mkDeck(baseSlides()), model, fmt);
  const toc = tocOf(ex);
  const titles = toc.entries.map((e) => e.title);
  check('lists content slides only (excludes cover, the section divider, and itself)',
    titles.join('|') === 'Returns Analysis|Income Statement|Balance Sheet', titles.join('|'));
  check('numbers entries 01..', toc.entries.map((e) => e.num).join(',') === '01,02,03');
  check('pages match visible order (cover=1, toc=2, ret=3, is=4, div=5, bs=6)',
    toc.entries.find((e) => e.title === 'Balance Sheet')!.page === 6);
  check('Income Statement pages at 4', toc.entries.find((e) => e.title === 'Income Statement')!.page === 4);
  check('heading rides through', toc.heading === 'Agenda');
}

console.log('\n=== 2. A slide link resolves to the target PAGE ===');
{
  const ex = resolveDeckExport(mkDeck(baseSlides()), model, fmt);
  const link = linkOf(ex);
  check('text link to "bs" resolves to page 6', !!link && link.kind === 'slide' && link.page === 6, JSON.stringify(link));
}

console.log('\n=== 3. Reorder re-pages the ToC AND the link (auto-sync) ===');
{
  // Move Balance Sheet to just after the cover+toc (index 2), pushing others down.
  const s = baseSlides();
  const bs = s.splice(5, 1)[0];
  s.splice(2, 0, bs); // cover, toc, bs, ret, is, div
  const ex = resolveDeckExport(mkDeck(s), model, fmt);
  const toc = tocOf(ex);
  check('Balance Sheet now pages at 3 in the ToC', toc.entries.find((e) => e.title === 'Balance Sheet')!.page === 3);
  check('ToC order follows the new slide order', toc.entries.map((e) => e.title).join('|') === 'Balance Sheet|Returns Analysis|Income Statement');
  check('the link to BS re-pages to 3 with no edit', linkOf(ex)?.kind === 'slide' && (linkOf(ex) as any).page === 3);
}

console.log('\n=== 4. Hidden target: drops from ToC and drops the link ===');
{
  const s = baseSlides();
  s.find((x) => x.id === 'bs')!.hidden = true;
  const ex = resolveDeckExport(mkDeck(s), model, fmt);
  const toc = tocOf(ex);
  check('hidden Balance Sheet is absent from the ToC', !toc.entries.some((e) => e.title === 'Balance Sheet'));
  check('remaining pages shift (Income Statement still 4, no gap)', toc.entries.find((e) => e.title === 'Income Statement')!.page === 4);
  check('a link to a hidden slide is DROPPED, never a dangling jump', linkOf(ex) === undefined);
}

console.log('\n=== 5. External URL link passes through ===');
{
  const s = baseSlides();
  (s[1].objects[1] as any).link = { kind: 'url', href: 'https://example.com/ic' };
  const ex = resolveDeckExport(mkDeck(s), model, fmt);
  const link = linkOf(ex);
  check('url link resolves to a url paint', !!link && link.kind === 'url' && link.href === 'https://example.com/ic');
}

console.log('\n=== 6. coerceDeck keeps the toc object + the link across jsonb ===');
{
  const raw = JSON.parse(JSON.stringify(mkDeck(baseSlides())));
  const coerced = coerceDeck(raw, 'p', '2026-07-26');
  check('coerce succeeds', !!coerced);
  const tocSlide = coerced!.slides.find((sl) => sl.id === 'toc')!;
  check('the toc object SURVIVES coercion (not dropped as unknown)', tocSlide.objects.some((o) => o.type === 'toc'));
  const lk = tocSlide.objects.find((o) => o.id === 'lk');
  check('the object link survives coercion', !!lk && (lk as any).link?.kind === 'slide' && (lk as any).link?.slideId === 'bs');
}

console.log('\n=== 6b. A long deck\'s agenda FITS: the ToC flows into columns ===');
{
  const box = { w: 1184, h: 520 };
  const mkPaint = (n: number): TocPaint => ({
    kind: 'toc', heading: '', style: { ...textStyles.body(), size: 15 },
    showPageNumbers: true, showNumbers: true,
    entries: Array.from({ length: n }, (_, i) => ({ num: String(i + 1).padStart(2, '0'), title: `Slide ${i + 1}`, page: i + 2, id: `s${i}` })),
  });
  const short = tocLayout(mkPaint(12), box, 0);
  check('a short agenda stays in one column', short.columns.length === 1);
  check('a short agenda keeps every entry', short.columns.flat().length === 12);
  // A deck carrying the full year-by-year schedules runs to ~40 slides.
  const long = tocLayout(mkPaint(42), box, 0);
  check('a long agenda breaks into columns rather than clipping', long.columns.length > 1);
  check('a long agenda still lists every slide exactly once',
    long.columns.flat().length === 42 && new Set(long.columns.flat().map((e) => e.id)).size === 42);
  check('the columns keep reading order (down, then across)',
    long.columns[0][0].id === 's0' && long.columns.flat().every((e, i) => e.id === `s${i}`));
  check('every column fits inside the box height',
    long.columns.every((c) => c.length * long.rowH <= box.h + 0.001), `${long.columns[0].length} x ${long.rowH}`);
  check('the columns fit inside the box width',
    long.columns.length * long.colWidth + (long.columns.length - 1) * long.colGap <= box.w + 0.001);
  check('the font shrinks with the row height but stays legible', long.fontSize >= 7 && long.fontSize <= 15);
  const huge = tocLayout(mkPaint(120), box, 0);
  check('an extreme deck caps at three columns (it never invents a fourth)', huge.columns.length === 3);
  check('an extreme deck still lists every slide', huge.columns.flat().length === 120);
}

console.log('\n=== 7. Exporters build a real file from a deck with a ToC + links ===');
(async () => {
  const deck = mkDeck(baseSlides());
  try {
    const pptx = buildDeckPptx({ deck, model, fmt });
    const buf = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
    check('PPTX builds a non-trivial file', buf.length > 5000, `${buf.length} bytes`);
    check('PPTX is a real PK zip', buf[0] === 0x50 && buf[1] === 0x4b);
  } catch (e) { check('PPTX builds without throwing', false, String(e)); }
  try {
    const bytes = await buildDeckPdf({ deck, model, fmt });
    check('PDF builds a non-trivial file', bytes.length > 2000, `${bytes.length} bytes`);
    check('PDF starts with %PDF', bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  } catch (e) { check('PDF builds without throwing', false, String(e)); }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
})();
